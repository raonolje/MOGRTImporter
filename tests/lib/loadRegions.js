"use strict";
/**
 * app.js(단일 IIFE)의 //#region 블록을 잘라 node:vm에서 실행한다.
 * 빌드 단계가 없으므로 패널이 로드하는 바로 그 파일을 테스트가 읽는다.
 *
 *   const { parseSRT } = loadRegions(["src/srtParser.ts"]);
 *   const { MI__json } = loadHostPure();          // S2-1 이전에는 {}
 *   regionHash("src/mi/core.ts")                  // 5단계 MCP 드리프트 검사용
 *
 * - vm 컨텍스트에는 console, TextDecoder, TextEncoder만 있다.
 * - 순수성 가드: 불러오는 region이 document, window, state., host.,
 *   localStorage, cep(, CSInterface)를 언급하면 예외를 던진다. 주석·문자열은 보지 않는다.
 * - vm에서 만든 객체는 프로토타입이 달라 assert.deepStrictEqual이 실패한다.
 *   비교할 때는 plain()으로 현재 realm 객체로 바꾼다.
 */
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { maskJs } = require("./jsmask");

const ROOT = path.resolve(__dirname, "..", "..");
const APP_JS = path.join(ROOT, "extension", "html", "js", "app.js");
const HOST_JSX = path.join(ROOT, "extension", "jsx", "hostscript.jsx");

// 순수 region이 언급하면 안 되는 이름 (앞에 '.'이 붙은 속성 접근은 제외)
const IMPURE_PANEL = [
	{ re: /(^|[^.\w$])document\b/, what: "document" },
	{ re: /(^|[^.\w$])window\b/, what: "window" },
	{ re: /(^|[^.\w$])state\s*[.[]/, what: "state." },
	{ re: /(^|[^.\w$])host\s*[.[]/, what: "host." },
	{ re: /(^|[^.\w$])localStorage\b/, what: "localStorage" },
	{ re: /(^|[^.\w$])cep\b/, what: "cep" },
	{ re: /(^|[^.\w$])CSInterface\b/, what: "CSInterface" },
	{ re: /(^|[^.\w$])__adobe_cep__\b/, what: "__adobe_cep__" }
];
// MI_PURE 블록(ES3)이 언급하면 안 되는 ExtendScript 호스트 객체
const IMPURE_HOST = [
	{ re: /(^|[^.\w$])app\s*\./, what: "app." },
	{ re: /(^|[^.\w$])qe\s*\./, what: "qe." },
	{ re: /(^|[^\w$])\$\s*\./, what: "$." },
	{ re: /(^|[^.\w$])(File|Folder)\s*\(/, what: "File/Folder" },
	{ re: /\bnew\s+(File|Folder)\b/, what: "new File/Folder" }
];

function _read(file) {
	return fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
}

/** 파일 안의 region 이름과 줄 번호 목록 */
function listRegions(file = APP_JS) {
	const lines = _read(file).split("\n");
	const out = [];
	lines.forEach((ln, i) => {
		const m = ln.match(/^\s*\/\/#region\s+(.+?)\s*$/);
		if (m) out.push({ name: m[1], line: i + 1 });
	});
	return out;
}

/**
 * //#region <name> 과 짝이 맞는 //#endregion 사이의 텍스트(표식 줄 제외).
 * @returns {{name: string, text: string, startLine: number}} startLine = 본문 첫 줄 번호
 */
function sliceRegion(name, src) {
	const lines = src.split("\n");
	const open = lines.findIndex((ln) => {
		const m = ln.match(/^\s*\/\/#region\s+(.+?)\s*$/);
		return m && m[1] === name;
	});
	if (open < 0) {
		const known = lines.map((ln) => (ln.match(/^\s*\/\/#region\s+(.+?)\s*$/) || [])[1]).filter(Boolean);
		throw new Error("region 없음: " + name + " (있는 region: " + known.join(", ") + ")");
	}
	let depth = 0;
	for (let i = open + 1; i < lines.length; i++) {
		if (/^\s*\/\/#region\b/.test(lines[i])) depth++;
		else if (/^\s*\/\/#endregion\b/.test(lines[i])) {
			if (depth === 0) {
				return { name, text: lines.slice(open + 1, i).join("\n"), startLine: open + 2 };
			}
			depth--;
		}
	}
	throw new Error("//#endregion 없음: " + name);
}

function _checkPure(label, text, rules, startLine) {
	const code = maskJs(text).code;
	const lines = code.split("\n");
	for (let i = 0; i < lines.length; i++) {
		for (const r of rules) {
			if (r.re.test(lines[i])) {
				throw new Error("순수성 가드: " + label + " " + (startLine + i) + "번 줄이 " + r.what + " 를 언급한다: " + text.split("\n")[i].trim());
			}
		}
	}
}

/** 가린 코드에서 중괄호 깊이 0의 function/var/let/const 이름 */
function _topLevelNames(text) {
	const code = maskJs(text).code;
	const names = [];
	let depth = 0;
	const re = /[{}]|\bfunction\s+([A-Za-z_$][\w$]*)|\b(?:var|let|const)\s+([A-Za-z_$][\w$]*)/g;
	let m;
	while ((m = re.exec(code))) {
		if (m[0] === "{") depth++;
		else if (m[0] === "}") depth--;
		else if (depth === 0) {
			const nm = m[1] || m[2];
			if (names.indexOf(nm) === -1) names.push(nm);
		}
	}
	return names;
}

/** 코드를 함수 스코프에서 실행하고 최상위 이름들을 객체로 돌려준다 */
function _run(code, names, filename) {
	const ctx = vm.createContext({ console, TextDecoder, TextEncoder });
	const exportsObj = names
		.map((nm) => JSON.stringify(nm) + ": (typeof " + nm + " === \"undefined\" ? undefined : " + nm + ")")
		.join(",\n");
	const wrapped = "(function () {\n" + code + "\n;return {\n" + exportsObj + "\n};\n})()";
	const out = vm.runInContext(wrapped, ctx, { filename });
	const res = {};
	for (const nm of names) if (out[nm] !== undefined) res[nm] = out[nm];
	return res;
}

/**
 * region들을 이어 붙여 한 스코프에서 실행하고, 최상위 함수·상수를 돌려준다.
 * @param {string|string[]} names  예: "src/srtParser.ts"
 * @param {string} [file]           기본은 저장소의 app.js (MCP 서버는 설치본 경로를 넘긴다)
 */
function loadRegions(names, file = APP_JS) {
	const list = Array.isArray(names) ? names : [names];
	const src = _read(file);
	const parts = list.map((nm) => sliceRegion(nm, src));
	parts.forEach((p) => _checkPure(p.name + " (" + path.basename(file) + ")", p.text, IMPURE_PANEL, p.startLine));
	const code = parts.map((p) => "/* region " + p.name + " @" + p.startLine + " */\n" + p.text).join("\n");
	const allNames = [];
	parts.forEach((p) => _topLevelNames(p.text).forEach((nm) => { if (allNames.indexOf(nm) === -1) allNames.push(nm); }));
	return _run(code, allNames, path.basename(file) + "#" + list.join("+"));
}

/**
 * hostscript.jsx의 MI_PURE 블록(ES3 순수 함수)을 그대로 node에서 실행한다.
 * 블록이 없으면(S2-1 이전) 빈 객체.
 */
function loadHostPure(file = HOST_JSX) {
	const src = _read(file);
	const re = /\/\*\s*MI_PURE_BEGIN\s*\*\/([\s\S]*?)\/\*\s*MI_PURE_END\s*\*\//g;
	const blocks = [];
	let m;
	while ((m = re.exec(src))) blocks.push(m[1]);
	if (!blocks.length) return {};
	const code = blocks.join("\n");
	_checkPure("MI_PURE (" + path.basename(file) + ", 블록 기준)", code, IMPURE_HOST, 1);
	return _run(code, _topLevelNames(code), path.basename(file) + "#MI_PURE");
}

/** FNV-1a 32비트 (UTF-8 바이트 기준) → 8자리 hex */
function fnv1a32(str) {
	const bytes = Buffer.from(String(str), "utf8");
	let h = 0x811c9dc5;
	for (let i = 0; i < bytes.length; i++) {
		h ^= bytes[i];
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return h.toString(16).padStart(8, "0");
}

/** region 본문(표식 줄 제외, LF 정규화)의 fnv1a32 */
function regionHash(name, file = APP_JS) {
	return fnv1a32(sliceRegion(name, _read(file)).text);
}

/** vm realm 객체를 현재 realm의 평범한 값으로 (deepStrictEqual 비교용) */
function plain(v) {
	return v === undefined ? v : structuredClone(v);
}

module.exports = { loadRegions, loadHostPure, regionHash, sliceRegion, listRegions, fnv1a32, plain, APP_JS, HOST_JSX, ROOT };
