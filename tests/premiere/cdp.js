#!/usr/bin/env node
"use strict";
/**
 * CEP 패널의 CEF 원격 디버깅 포트(CDP)에 붙는 작은 클라이언트.
 * 하드 테스트는 DEV 패널(7778, CEP_MogrtImporter_dev)만 몬다. 운영 7777은 --prod일 때만,
 * 그것도 저장소의 읽기 전용 스모크(PROD_SMOKE_FILES)에만 쓴다. 운영 페이지에는 _mogrtDebug._fsWrite·
 * saveSession과 evalScript가 있어 아무 표현식이나 돌리면 운영 캐시·실제 프로젝트를 바꿀 수 있다.
 * 그래서 --prod에서는 다른 --expr-file과 --reload(부팅이 캐시를 다시 쓸 수 있다)를 거부한다(run.js도 같다).
 *
 * 모듈:  const { Cdp } = require("./cdp");  const c = await Cdp.connect(7778);  await c.evaluate("1+1");
 * CLI:   node tests/premiere/cdp.js [--port 7778] [--prod] [--reload] [--settle ms] [--expr-file f]
 *        (예전 형식 `node cdp.js 7778 --reload`도 받는다)
 *   --reload     Page.reload 후 load 이벤트 + settle 동안의 콘솔·예외를 모아 보여 준다 (app.js/index.html만 바꿨을 때)
 *   --expr-file  '---' 줄로 나눈 표현식들을 차례로 평가해 결과를 찍는다
 * 종료 코드: 0 정상 · 1 오류 · 2 포트 연결 실패 · 3 대상 페이지 없음 · 4 표현식 예외
 */
const path = require("node:path");

const PROD_PORT = 7777;
const DEV_PORT = 7778;
const DEV_DIR_RE = /CEP_MogrtImporter_dev\//i;
const PROD_DIR_RE = /CEP_MogrtImporter\//i;
// --prod(운영 패널)에서 평가해도 되는 파일: 저장소에 커밋된 읽기 전용 스모크만
const PROD_SMOKE_FILES = [path.join(__dirname, "smoke.expr.txt")];

/** --prod 파일 정책: PROD_SMOKE_FILES가 아니면 throw. 절대 경로를 돌려준다 */
function checkProdFile(file) {
	const abs = path.resolve(String(file));
	const norm = (p) => (process.platform === "win32" ? p.toLowerCase() : p);
	if (!PROD_SMOKE_FILES.some((p) => norm(p) === norm(abs))) {
		throw new Error("--prod(운영 패널)에서는 읽기 전용 스모크만 실행한다: " +
			PROD_SMOKE_FILES.map((p) => path.relative(process.cwd(), p) || p).join(", ") + " (받은 것: " + file + ")");
	}
	return abs;
}

/** 포트 정책: 운영 포트는 --prod일 때만, --prod는 운영 포트에서만 */
function checkPort(port, opts = {}) {
	const p = Number(port);
	if (!Number.isInteger(p) || p <= 0 || p > 65535) throw new Error("포트가 이상하다: " + port);
	if (opts.prod && p !== PROD_PORT) throw new Error("--prod는 운영 포트 " + PROD_PORT + "에서만 쓴다");
	if (!opts.prod && p === PROD_PORT) {
		throw new Error(PROD_PORT + "은 운영 패널이다 — 하드 테스트는 DEV " + DEV_PORT + ". 운영 읽기 전용 스모크만 --prod로 실행한다");
	}
	return p;
}

/** /json 목록에서 대상 페이지 고르기: DEV면 CEP_MogrtImporter_dev 페이지만 */
function pickTarget(targets, opts = {}) {
	const pages = (targets || []).filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
	if (!pages.length) {
		const e = new Error("페이지 대상이 없다 (패널이 열려 있나?)");
		e.code = "NO_PAGE_TARGET";
		throw e;
	}
	const url = (t) => {
		let u = String(t.url || "");
		try { u = decodeURIComponent(u); } catch (_) { /* 깨진 % 시퀀스는 그대로 */ }
		return u.replace(/\\/g, "/");
	};
	const want = opts.prod
		? pages.filter((t) => PROD_DIR_RE.test(url(t)) && !DEV_DIR_RE.test(url(t)))
		: pages.filter((t) => DEV_DIR_RE.test(url(t)));
	if (!want.length) {
		const e = new Error((opts.prod ? "운영(CEP_MogrtImporter)" : "DEV(CEP_MogrtImporter_dev)") +
			" 패널 페이지가 아니다: " + pages.map((t) => t.url).join(", "));
		e.code = "NO_PAGE_TARGET";
		throw e;
	}
	return want[0];
}

async function listTargets(port) {
	let res;
	try {
		res = await fetch("http://127.0.0.1:" + port + "/json");
	} catch (e) {
		const err = new Error("포트 " + port + "에 연결할 수 없다 (" + (e.cause && e.cause.code ? e.cause.code : e.message) + ")");
		err.code = "PORT_UNREACHABLE";
		throw err;
	}
	return res.json();
}

function fmtRemote(ro) {
	if (!ro) return "undefined";
	if (ro.type === "string") return JSON.stringify(ro.value);
	if ("value" in ro) return JSON.stringify(ro.value);
	if (ro.unserializableValue) return String(ro.unserializableValue);
	return ro.description || ro.type;
}

function describeException(d) {
	if (!d) return "알 수 없는 예외";
	if (d.exception && d.exception.description) return d.exception.description.split("\n")[0];
	if (d.exception && "value" in d.exception) return String(d.exception.value);
	return d.text || "예외";
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Cdp {
	constructor(ws, target, opts = {}) {
		this.ws = ws;
		this.target = target;
		this.timeoutMs = opts.timeoutMs || 120000;
		this.nextId = 0;
		this.pending = new Map();
		this.waiters = [];
		this.logs = [];
		ws.onmessage = (ev) => this._onMessage(ev);
	}

	/** @param {{prod?: boolean, timeoutMs?: number}} opts */
	static async connect(port, opts = {}) {
		const p = checkPort(port, opts);
		const target = pickTarget(await listTargets(p), opts);
		const ws = new WebSocket(target.webSocketDebuggerUrl);
		await new Promise((resolve, reject) => {
			ws.onopen = resolve;
			ws.onerror = () => reject(new Error("WebSocket 연결 실패: " + target.webSocketDebuggerUrl));
		});
		const c = new Cdp(ws, target, opts);
		c.port = p;
		c.prod = !!opts.prod;
		await c.send("Runtime.enable");
		await c.send("Log.enable");
		await c.send("Page.enable");
		return c;
	}

	_onMessage(ev) {
		const msg = JSON.parse(typeof ev.data === "string" ? ev.data : String(ev.data));
		if (msg.id && this.pending.has(msg.id)) {
			const { resolve, reject, timer } = this.pending.get(msg.id);
			clearTimeout(timer);
			this.pending.delete(msg.id);
			if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
			else resolve(msg.result || {});
			return;
		}
		if (msg.method === "Runtime.consoleAPICalled") {
			this.logs.push("[" + msg.params.type + "] " + (msg.params.args || []).map(fmtRemote).join(" "));
		} else if (msg.method === "Runtime.exceptionThrown") {
			this.logs.push("[EXCEPTION] " + describeException(msg.params.exceptionDetails));
		} else if (msg.method === "Log.entryAdded") {
			const e = msg.params.entry;
			if (e.level === "error" || e.level === "warning") this.logs.push("[log:" + e.level + "] " + e.text + (e.url ? " @" + e.url : ""));
		}
		if (msg.method) {
			this.waiters = this.waiters.filter((w) => {
				if (w.method !== msg.method) return true;
				clearTimeout(w.timer);
				w.resolve(msg.params);
				return false;
			});
		}
	}

	send(method, params, timeoutMs) {
		const id = ++this.nextId;
		const ms = timeoutMs || this.timeoutMs;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				if (this.pending.has(id)) {
					this.pending.delete(id);
					reject(new Error("시간 초과(" + ms + "ms): " + method));
				}
			}, ms);
			this.pending.set(id, { resolve, reject, timer });
			this.ws.send(JSON.stringify({ id, method, params: params || {} }));
		});
	}

	waitEvent(method, timeoutMs) {
		return new Promise((resolve, reject) => {
			const w = { method, resolve };
			w.timer = setTimeout(() => {
				this.waiters = this.waiters.filter((x) => x !== w);
				reject(new Error("시간 초과: " + method));
			}, timeoutMs || this.timeoutMs);
			this.waiters.push(w);
		});
	}

	/** 페이지에서 표현식을 평가한다 (top-level await 가능). 예외면 throw */
	async evaluate(expression, opts = {}) {
		const r = await this.send("Runtime.evaluate", {
			expression,
			awaitPromise: true,
			returnByValue: true,
			replMode: true,
			allowUnsafeEvalBlockedByCSP: true
		}, opts.timeoutMs);
		if (r.exceptionDetails) {
			const e = new Error(describeException(r.exceptionDetails));
			e.name = "PageError";
			throw e;
		}
		const ro = r.result || {};
		if ("value" in ro) return ro.value;
		if (ro.unserializableValue) return ro.unserializableValue;
		if (ro.type === "undefined") return undefined;
		return ro.description || ro.type;
	}

	/** 패널 새로 고침: load 이벤트 + settle 동안 모인 콘솔·예외를 돌려준다 */
	async reload(opts = {}) {
		this.logs.length = 0;
		const loaded = this.waitEvent("Page.loadEventFired", opts.timeoutMs || 60000);
		await this.send("Page.reload", { ignoreCache: true });
		await loaded;
		await sleep(opts.settleMs == null ? 3000 : opts.settleMs);
		return this.logs.slice();
	}

	close() {
		try { this.ws.close(); } catch (_) { /* 무시 */ }
	}
}

function parseCliArgs(argv) {
	const o = { port: DEV_PORT, prod: false, reload: false, settleMs: 3000, exprFile: null };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--port") o.port = Number(argv[++i]);
		else if (a === "--prod") o.prod = true;
		else if (a === "--reload") o.reload = true;
		else if (a === "--settle") o.settleMs = Number(argv[++i]);
		else if (a === "--expr-file") o.exprFile = argv[++i];
		else if (/^\d+$/.test(a)) o.port = Number(a); // 예전 형식: 첫 인자가 포트
		else throw new Error("모르는 인자: " + a);
	}
	if (o.prod && o.reload) throw new Error("--prod --reload는 받지 않는다 — 운영 패널 부팅이 캐시를 다시 쓸 수 있다. 운영은 Premiere를 다시 시작한다");
	if (o.prod && o.exprFile) checkProdFile(o.exprFile);
	return o;
}

async function cli(argv) {
	let o;
	try {
		o = parseCliArgs(argv);
		checkPort(o.port, o);
	} catch (e) {
		console.log("!! " + e.message);
		return 64;
	}
	let c;
	try {
		c = await Cdp.connect(o.port, o);
	} catch (e) {
		console.log("!! " + e.message);
		return e.code === "PORT_UNREACHABLE" ? 2 : e.code === "NO_PAGE_TARGET" ? 3 : 1;
	}
	console.log("=== 대상: " + c.target.title + " :: " + c.target.url + " (포트 " + c.port + ")");
	let code = 0;
	try {
		if (o.reload) {
			console.log("\n=== 패널 새로 고침 (로드 중 콘솔·예외) ===");
			const logs = await c.reload({ settleMs: o.settleMs });
			console.log(logs.length ? logs.join("\n") : "(로드 중 콘솔 출력 없음)");
		}
		if (o.exprFile) {
			const { splitExprs } = require("./run");
			const exprs = splitExprs(require("node:fs").readFileSync(o.exprFile, "utf8"));
			console.log("\n=== 표현식 " + exprs.length + "건 ===");
			for (const ex of exprs) {
				console.log("\n> " + ex.label);
				try {
					const v = await c.evaluate(ex.code);
					console.log("  " + String(typeof v === "string" ? v : JSON.stringify(v)).slice(0, 20000));
				} catch (e) {
					console.log("  THREW: " + e.message);
					code = 4;
				}
			}
		}
		if (c.logs.length) console.log("\n=== 콘솔 ===\n" + c.logs.slice(-40).join("\n"));
	} finally {
		c.close();
	}
	return code;
}

if (require.main === module) {
	cli(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => { console.log("FATAL " + e.message); process.exitCode = 1; });
}

module.exports = { Cdp, checkPort, checkProdFile, pickTarget, listTargets, describeException, parseCliArgs, PROD_PORT, DEV_PORT, PROD_SMOKE_FILES };
