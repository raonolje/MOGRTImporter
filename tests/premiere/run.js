#!/usr/bin/env node
"use strict";
/**
 * 하드 테스트 실행기. DEV 패널(7778)에 CDP로 붙어 파일을 실행한다.
 *
 *   node tests/premiere/run.js [--port 7778] [--timeout ms] [--no-guard] [--check-build] [--reload] <file>...
 *   node tests/premiere/run.js --prod --port 7777 tests/premiere/smoke.expr.txt     (배포 뒤 읽기 전용 스모크)
 *
 * 파일 종류
 *   .expr.txt  '---' 줄로 나눈 페이지 표현식. 예외가 나면 실패 (top-level await 가능)
 *   .jsx       패널의 CSInterface로 $.evalFile. DEV에서는 \bMI_ → MID_ 로 바꾼 임시 사본을 쓴다
 *              (한글이 있으면 \uXXXX로 바꾼 사본). "EvalScript error."면 실패
 *   .case.js   module.exports = { name?, run: async ({ panel, host, mi, assert, log, reload, info }) => … }
 *              panel(expr) 페이지 평가 · host(jsx) 호스트 평가(문자열) · mi(name, payload) MID_<name> 호출(JSON)
 *
 * 가드(lib/guard.js): MI_test.prproj의 T_ 시퀀스가 아니면 아무것도 실행하지 않는다.
 * --prod: 운영 패널, .expr.txt만, 가드 없음 (읽기 전용 표현식만 넣는다).
 * --check-build: 설치된 빌드 스탬프와 호스트 MID_ping().build(와 패널 status.build)가 같은지 확인.
 * 종료 코드: 0 통과 · 1 실패 · 2 연결 실패 · 3 가드 거부 · 64 사용법
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { Cdp, checkPort, DEV_PORT } = require("./cdp");
const { guard, GuardError } = require("./lib/guard");

/** '---' 줄로 표현식 나누기. label = 첫 줄 */
function splitExprs(text) {
	return ("\n" + String(text))
		.replace(/\r\n?/g, "\n")
		.split(/\n-{3,}[ \t]*(?=\n|$)/)
		.map((s) => s.trim())
		.filter(Boolean)
		.map((code) => ({ label: code.split("\n")[0].slice(0, 80), code }));
}

/** JSX 소스의 비ASCII 문자를 \uXXXX로 (문자열·정규식·주석 어디서나 뜻이 같다; U+2028도 안전) */
function asciiJsx(src) {
	return String(src).replace(/[^\x00-\x7f]/g, (ch) => "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0"));
}

/** ExtendScript 문자열 리터럴 (ASCII만, 제어 문자·U+2028/2029 이스케이프) */
function jsxString(s) {
	return "\"" + String(s).replace(/[\\"\u0000-\u001f\u007f-￿]/g, (ch) => {
		if (ch === "\\") return "\\\\";
		if (ch === "\"") return "\\\"";
		if (ch === "\n") return "\\n";
		if (ch === "\r") return "\\r";
		if (ch === "\t") return "\\t";
		return "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0");
	}) + "\"";
}

/** fn("<payload JSON>") 호출 소스 */
function hostCallSource(fn, payload) {
	if (!/^[A-Za-z_$][\w$]*$/.test(fn)) throw new Error("함수 이름이 이상하다: " + fn);
	return fn + "(" + (payload === undefined ? "" : jsxString(JSON.stringify(payload))) + ")";
}

/** 패널에서 호스트 JSX를 평가하는 페이지 표현식 */
function evalScriptExpr(jsx) {
	return "new Promise((resolve) => { new CSInterface().evalScript(" + JSON.stringify(asciiJsx(jsx)) + ", (v) => resolve(String(v))); })";
}

function rewriteMiForDev(src) {
	return String(src).replace(/\bMI_/g, "MID_");
}

function extDir() {
	if (process.env.MI_CEP_EXT_DIR) return process.env.MI_CEP_EXT_DIR;
	const roaming = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
	return path.join(roaming, "Adobe", "CEP", "extensions");
}

/** 설치본에서 기대 빌드 스탬프 읽기: hostscript의 MI(D)_BUILD, 없으면 DEV의 .mi_build 첫 줄 */
function expectedBuild(opts = {}) {
	const { buildOfHost } = require("../../tools/lib/stamp");
	const dir = path.join(opts.extDir || extDir(), opts.prod ? "CEP_MogrtImporter" : "CEP_MogrtImporter_dev");
	const hostFile = path.join(dir, "jsx", "hostscript.jsx");
	const fromHost = fs.existsSync(hostFile) ? buildOfHost(fs.readFileSync(hostFile, "utf8")) : null;
	if (fromHost && fromHost !== "@@BUILD@@") return { build: fromHost, source: hostFile };
	const stampFile = path.join(dir, ".mi_build");
	if (!opts.prod && fs.existsSync(stampFile)) {
		return { build: fs.readFileSync(stampFile, "utf8").split(/\r?\n/)[0].trim(), source: stampFile };
	}
	return { build: null, source: dir };
}

function _findBuild(o, depth = 0) {
	if (!o || typeof o !== "object" || depth > 2) return null;
	if (typeof o.build === "string") return o.build;
	for (const k of Object.keys(o)) {
		const b = _findBuild(o[k], depth + 1);
		if (b) return b;
	}
	return null;
}

/** 페이지·호스트 도우미 묶음 */
function makeApi(client, opts = {}) {
	const prefix = opts.prod ? "MI_" : "MID_";
	const panel = (expr, o) => client.evaluate(expr, o);
	const host = (jsx, o) => client.evaluate(evalScriptExpr(jsx), o);
	const mi = async (name, payload, o) => {
		const raw = await host(hostCallSource(prefix + name, payload), o);
		try { return JSON.parse(raw); } catch (_) { return raw; }
	};
	const reload = (o) => client.reload(o);
	return { panel, host, mi, reload, prefix };
}

async function checkBuildStamp(client, opts = {}) {
	const api = makeApi(client, opts);
	const exp = expectedBuild(opts);
	const lines = ["설치 빌드: " + (exp.build || "(없음)") + "  ← " + exp.source];
	const raw = await api.host("typeof " + api.prefix + "ping === \"function\" ? " + api.prefix + "ping() : \"__NO_PING__\"");
	if (raw === "__NO_PING__") {
		lines.push("호스트: " + api.prefix + "ping 없음 (v28 호스트 이전) — 빌드 비교 건너뜀");
		return { ok: true, skipped: true, lines };
	}
	let ping;
	try { ping = JSON.parse(raw); } catch (_) { ping = null; }
	const hostBuild = ping && ping.build;
	lines.push("호스트 빌드: " + (hostBuild || "(읽지 못함: " + String(raw).slice(0, 120) + ")"));
	let ok = !!hostBuild && (!exp.build || hostBuild === exp.build);
	if (!ok) lines.push("!! 호스트 빌드가 설치 빌드와 다르다 — JSX는 Premiere를 다시 시작할 때까지 캐시된다. Premiere를 재시작한다");
	const panelRaw = await api.panel("(window._mogrtDebug && typeof window._mogrtDebug.cmd === \"function\") ? JSON.stringify(window._mogrtDebug.cmd(\"status\", {})) : \"\"");
	let panelBuild = null;
	if (panelRaw) {
		try { panelBuild = _findBuild(JSON.parse(panelRaw)); } catch (_) { panelBuild = null; }
	}
	if (panelBuild) {
		lines.push("패널 빌드: " + panelBuild);
		if (exp.build && panelBuild !== exp.build) {
			ok = false;
			lines.push("!! 패널 빌드가 설치 빌드와 다르다 — node tests/premiere/cdp.js --port " + client.port + " --reload");
		}
	} else {
		lines.push("패널: status.build 없음 — 비교 건너뜀");
	}
	return { ok, skipped: false, lines };
}

async function runExprFile(client, file, log) {
	const exprs = splitExprs(fs.readFileSync(file, "utf8"));
	let failed = 0;
	for (const ex of exprs) {
		try {
			const v = await client.evaluate(ex.code);
			log("  ok   " + ex.label + "\n       " + String(typeof v === "string" ? v : JSON.stringify(v)).slice(0, 2000));
		} catch (e) {
			failed++;
			log("  FAIL " + ex.label + "\n       " + e.message);
		}
	}
	if (failed) throw new Error(failed + "/" + exprs.length + " 표현식 실패");
	return exprs.length + "건 통과";
}

async function runJsxFile(client, file, opts, log) {
	const src = fs.readFileSync(file, "utf8");
	let target = path.resolve(file);
	let tmp = null;
	const needMid = !opts.prod && /\bMI_/.test(src);
	if (needMid || /[^\x00-\x7f]/.test(src)) {
		tmp = path.join(os.tmpdir(), "mi_run_" + process.pid + "_" + path.basename(file));
		fs.writeFileSync(tmp, asciiJsx(needMid ? rewriteMiForDev(src) : src), "utf8");
		target = tmp;
	}
	try {
		const api = makeApi(client, opts);
		const out = await api.host("$.evalFile(" + jsxString(target.split(path.sep).join("/")) + ")", { timeoutMs: opts.timeoutMs });
		if (out === "EvalScript error.") throw new Error("EvalScript error. (JSX 예외)");
		log("  " + String(out).slice(0, 20000));
		return out;
	} finally {
		if (tmp) try { fs.unlinkSync(tmp); } catch (_) { /* 무시 */ }
	}
}

async function runCaseFile(client, file, opts, info, log) {
	const mod = require(path.resolve(file));
	if (!mod || typeof mod.run !== "function") throw new Error("run 함수가 없다: " + file);
	const api = makeApi(client, opts);
	return mod.run({ ...api, assert, log: (...a) => log("  " + a.join(" ")), info, port: client.port });
}

/**
 * 파일 하나 실행. 실패하면 throw.
 * @param {Cdp} client
 * @param {{prod?: boolean, guard?: boolean, timeoutMs?: number}} opts
 */
async function runFile(client, file, opts = {}, log = console.log) {
	const kind = /\.expr\.txt$/i.test(file) ? "expr" : /\.case\.js$/i.test(file) ? "case" : /\.jsx$/i.test(file) ? "jsx" : null;
	if (!kind) throw new Error("모르는 파일 종류: " + file + " (.expr.txt | .jsx | .case.js)");
	if (opts.prod && kind !== "expr") throw new Error("--prod에서는 .expr.txt(읽기 전용)만 실행한다: " + file);
	let info = null;
	if (!opts.prod && opts.guard !== false) info = await guard((jsx) => client.evaluate(evalScriptExpr(jsx)));
	else if (!opts.prod && kind !== "expr") throw new Error("--no-guard는 .expr.txt에만 쓸 수 있다: " + file);
	if (kind === "expr") return runExprFile(client, file, log);
	if (kind === "jsx") return runJsxFile(client, file, opts, log);
	return runCaseFile(client, file, opts, info, log);
}

function parseArgs(argv) {
	const o = { port: DEV_PORT, prod: false, guard: true, checkBuild: false, reload: false, timeoutMs: 120000, files: [] };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--port") o.port = Number(argv[++i]);
		else if (a === "--prod") o.prod = true;
		else if (a === "--no-guard") o.guard = false;
		else if (a === "--check-build") o.checkBuild = true;
		else if (a === "--reload") o.reload = true;
		else if (a === "--timeout") o.timeoutMs = Number(argv[++i]);
		else if (a.startsWith("--")) throw new Error("모르는 인자: " + a);
		else o.files.push(a);
	}
	checkPort(o.port, o);
	if (!o.files.length && !o.checkBuild && !o.reload) throw new Error("실행할 파일이 없다");
	return o;
}

async function main(argv) {
	let o;
	try {
		o = parseArgs(argv);
	} catch (e) {
		console.log("!! " + e.message);
		return 64;
	}
	let client;
	try {
		client = await Cdp.connect(o.port, { prod: o.prod, timeoutMs: o.timeoutMs });
	} catch (e) {
		console.log("!! " + e.message);
		return 2;
	}
	console.log("=== " + client.target.url + " (포트 " + client.port + (o.prod ? ", 운영 읽기 전용" : ", DEV") + ")");
	let failed = 0;
	try {
		if (o.reload) {
			const logs = await client.reload();
			console.log("--- 새로 고침\n" + (logs.length ? logs.join("\n") : "(콘솔 출력 없음)"));
		}
		if (o.checkBuild) {
			const r = await checkBuildStamp(client, o);
			console.log("--- 빌드 확인\n  " + r.lines.join("\n  "));
			if (!r.ok) failed++;
		}
		for (const f of o.files) {
			const t0 = Date.now();
			console.log("--- " + f);
			try {
				const res = await runFile(client, f, o);
				console.log("PASS " + f + " (" + (Date.now() - t0) + "ms)" + (res !== undefined && typeof res !== "object" ? " — " + res : ""));
			} catch (e) {
				failed++;
				console.log("FAIL " + f + " — " + e.message);
				if (e instanceof GuardError) return 3;
			}
		}
		if (client.logs.length) console.log("--- 패널 콘솔 (마지막 20)\n" + client.logs.slice(-20).join("\n"));
	} finally {
		client.close();
	}
	return failed ? 1 : 0;
}

if (require.main === module) {
	main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => { console.log("FATAL " + e.stack); process.exitCode = 1; });
}

module.exports = {
	splitExprs, asciiJsx, jsxString, hostCallSource, evalScriptExpr, rewriteMiForDev, expectedBuild, checkBuildStamp,
	makeApi, runFile, parseArgs, main
};
