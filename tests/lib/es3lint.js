#!/usr/bin/env node
"use strict";
/**
 * hostscript.jsx의 v28 구역(/* MI:BEGIN … *\/ ~ /* MI:END *\/)만 검사하는 ES3 린트.
 * ExtendScript는 ES3이라 아래 구문을 만나면 로드 단계에서 통째로 죽거나(문법)
 * 실행 중에 undefined 메서드를 부른다. v27 코드는 검사하지 않는다.
 *
 *   node tests/lib/es3lint.js extension/jsx/hostscript.jsx   (npm run lint:jsx)
 *   종료 코드: 0 통과 · 1 위반 · 2 사용법/표식 오류
 *
 * 금지: let, const, =>, class, 템플릿 문자열, 배열 고차 함수(forEach·map·filter·some·every·reduce),
 * Array.isArray, 배열 indexOf(문자열 indexOf는 허용 — 수신자가 문자열 리터럴이거나 String(...),
 * .toLowerCase() 같은 문자열 메서드 결과여야 한다. 배열 멤버십은 MI__idx),
 * trim, Object.keys/create(및 ES5 Object.*), bind, Date.now, normalize, get/set 리터럴,
 * 예약어 속성 이름(x.default, {new: …}), JSON.*(MI__json·parsePayload를 쓴다),
 * 그 밖의 ES5+ 문자열/정적 메서드, 전개 연산자, for…of, 기본 매개변수.
 */
const fs = require("node:fs");
const path = require("node:path");
const { maskJs, lineOf } = require("./jsmask");

const BEGIN_RE = /\/\*\s*MI:BEGIN\b[^*]*\*\//g;
const END_RE = /\/\*\s*MI:END\s*\*\//g;

// ES3 예약어 + 미래 예약어 + 리터럴. 점 표기 속성이나 따옴표 없는 키로 쓰면 ExtendScript가 거부한다.
const RESERVED = ("break case catch continue default delete do else finally for function if in instanceof new " +
	"return switch this throw try typeof var void while with " +
	"abstract boolean byte char class const debugger double enum export extends final float goto implements " +
	"import int interface long native package private protected public short static super synchronized throws " +
	"transient volatile null true false").split(" ");
const RESERVED_ALT = RESERVED.join("|");

// 문자열을 돌려주는 것이 확실한 수신자 (이 뒤의 .indexOf는 String.prototype.indexOf)
const STRING_CALLS = /(?:(?:^|[^\w$.])(?:String|encodeURIComponent|decodeURIComponent|escape|unescape)|\.(?:toLowerCase|toUpperCase|substr|substring|charAt|replace|toString|join|toFixed|fromCharCode))\s*$/;

/**
 * 규칙: { id, re (전역 정규식, 가린 코드에 적용), msg, ok?(code, match) → true면 통과 }
 */
const RULES = [
	{ id: "let", re: /\blet\s+[A-Za-z_$[{]/g, msg: "let은 ES3에 없다 — var" },
	{ id: "const", re: /\bconst\b/g, msg: "const는 ES3에 없다 — var" },
	{ id: "arrow", re: /=>/g, msg: "화살표 함수는 ES3에 없다 — function" },
	{ id: "class", re: /(^|[^.\w$])class\b/g, msg: "class는 ES3에 없다" },
	{ id: "array-hof", re: /\.\s*(forEach|map|filter|some|every|reduce|reduceRight)\s*\(/g, msg: "배열 고차 함수는 ES3에 없다 — for 루프" },
	{ id: "Array.isArray", re: /\bArray\s*\.\s*isArray\b/g, msg: "Array.isArray는 ES3에 없다 — instanceof Array" },
	{
		id: "array-indexOf",
		re: /\.\s*(indexOf|lastIndexOf)\s*\(/g,
		msg: "배열 indexOf는 ES3에 없다 — 배열은 MI__idx(arr, x), 문자열이면 String(x).indexOf(...)",
		ok: _isStringReceiver
	},
	{ id: "trim", re: /\.\s*trim(Left|Right|Start|End)?\s*\(/g, msg: "trim은 ES3에 없다 — replace(/^\\s+|\\s+$/g, \"\")" },
	{ id: "Object.es5", re: /\bObject\s*\.\s*(keys|create|assign|freeze|seal|defineProperty|defineProperties|getPrototypeOf|getOwnPropertyNames|entries|values)\b/g, msg: "Object.keys/create 등 ES5+ Object 메서드는 ES3에 없다 — for…in" },
	{ id: "bind", re: /\.\s*bind\s*\(/g, msg: "Function.prototype.bind는 ES3에 없다 — 클로저" },
	{ id: "Date.now", re: /\bDate\s*\.\s*now\b/g, msg: "Date.now는 ES3에 없다 — new Date().getTime()" },
	{ id: "normalize", re: /\.\s*normalize\s*\(/g, msg: "String.prototype.normalize는 ES3에 없다" },
	{ id: "get/set", re: /\b(get|set)\s+[A-Za-z_$][\w$]*\s*\([^)]*\)\s*\{/g, msg: "get/set 접근자 리터럴은 ES3에 없다" },
	{ id: "reserved-member", re: new RegExp("\\.\\s*(" + RESERVED_ALT + ")\\b", "g"), msg: "예약어를 점 표기 속성으로 쓸 수 없다 — x[\"default\"]", ok: _notSpread },
	{ id: "reserved-key", re: new RegExp("([{,])\\s*(" + RESERVED_ALT + ")\\s*:(?!:)", "g"), msg: "예약어를 따옴표 없는 객체 키로 쓸 수 없다 — {\"new\": …}", ok: _isBlockBrace },
	{ id: "JSON", re: /\bJSON\s*\./g, msg: "JSON.*은 쓰지 않는다 — MI__json / parsePayload" },
	{ id: "es5-string", re: /\.\s*(includes|startsWith|endsWith|padStart|padEnd|repeat|codePointAt|trimStart|trimEnd)\s*\(/g, msg: "ES2015+ 문자열·배열 메서드는 ES3에 없다" },
	{ id: "es6-static", re: /\b(Array\s*\.\s*(from|of)|Number\s*\.\s*(isNaN|isFinite|isInteger|parseFloat|parseInt|EPSILON)|String\s*\.\s*(fromCodePoint|raw)|Math\s*\.\s*(sign|trunc|log10|log2|hypot|cbrt))\b/g, msg: "ES2015+ 정적 메서드는 ES3에 없다" },
	{ id: "es6-global", re: /\b(Promise|Symbol|Map|Set|WeakMap|WeakSet|Proxy|Reflect)\s*[.(]|\bnew\s+(Promise|Map|Set|WeakMap|WeakSet|Proxy)\b/g, msg: "ES2015+ 전역 객체는 ES3에 없다" },
	{ id: "spread", re: /\.\.\./g, msg: "전개/나머지 연산자는 ES3에 없다" },
	{ id: "for-of", re: /\bfor\s*\(\s*(var\s+)?[A-Za-z_$][\w$]*\s+of\b/g, msg: "for…of는 ES3에 없다" },
	{ id: "default-param", re: /\bfunction\b[^(]*\([^)]*=[^)]*\)/g, msg: "기본 매개변수는 ES3에 없다" }
];

/** array-indexOf: 수신자가 문자열이 확실하면 통과 */
function _isStringReceiver(code, m) {
	let k = m.index - 1;
	while (k >= 0 && /\s/.test(code[k])) k--;
	const ch = code[k];
	if (ch === '"' || ch === "'") return true; // 문자열 리터럴(가린 코드에서 따옴표는 남는다)
	if (ch !== ")") return false;
	// 짝이 맞는 '(' 를 찾고 그 앞의 호출 이름을 본다
	let depth = 0;
	for (; k >= 0; k--) {
		if (code[k] === ")") depth++;
		else if (code[k] === "(") {
			depth--;
			if (depth === 0) break;
		}
	}
	if (k < 0) return false;
	// (x + "") 같은 문자열 강제 변환
	const inner = code.slice(k + 1, m.index).replace(/\)\s*$/, "");
	if (/\+\s*(""|'')\s*$/.test(inner) || /^\s*(""|'')\s*\+/.test(inner)) return true;
	return STRING_CALLS.test(code.slice(Math.max(0, k - 40), k));
}

/** reserved-member: "...new Foo"의 점은 전개 연산자 규칙이 잡는다 */
function _notSpread(code, m) {
	return m.index >= 2 && code[m.index - 1] === "." && code[m.index - 2] === ".";
}

/** reserved-key: '{' 가 객체 리터럴이 아니라 블록(switch 등)이면 통과 ({ default: …) */
function _isBlockBrace(code, m) {
	if (m[1] !== "{") return false; // ", new:" 는 항상 객체 리터럴 키
	let k = m.index - 1;
	while (k >= 0 && /\s/.test(code[k])) k--;
	if (k < 0) return true;
	if (code[k] === ")") return true; // switch (x) {, if (x) {, function f() {
	if (/[;{}]/.test(code[k])) return true; // 문장 시작의 블록
	const tail = code.slice(Math.max(0, k - 8), k + 1);
	return /(^|[^\w$])(else|do|try|finally)$/.test(tail);
}

/**
 * @param {string} src 파일 전체 소스
 * @returns {{sections: {begin: number, end: number, startLine: number, endLine: number}[], violations: object[], error?: string}}
 */
function lintSource(src) {
	src = String(src).replace(/\r\n/g, "\n");
	const begins = [];
	const ends = [];
	let m;
	BEGIN_RE.lastIndex = 0;
	END_RE.lastIndex = 0;
	while ((m = BEGIN_RE.exec(src))) begins.push({ at: m.index, after: m.index + m[0].length });
	while ((m = END_RE.exec(src))) ends.push({ at: m.index, after: m.index + m[0].length });
	if (begins.length !== ends.length) {
		return { sections: [], violations: [], error: "MI:BEGIN " + begins.length + "개, MI:END " + ends.length + "개 — 짝이 맞지 않는다" };
	}
	const sections = [];
	for (let i = 0; i < begins.length; i++) {
		const b = begins[i];
		const e = ends[i];
		if (e.at < b.after || (begins[i + 1] && begins[i + 1].at < e.after)) {
			return { sections: [], violations: [], error: "MI:BEGIN/MI:END 순서가 어긋났다 (" + lineOf(src, b.at) + "번 줄)" };
		}
		sections.push({ begin: b.after, end: e.at, startLine: lineOf(src, b.at), endLine: lineOf(src, e.at) });
	}
	const masked = maskJs(src);
	const code = masked.code;
	const srcLines = src.split("\n");
	const violations = [];
	const seen = {};
	const push = (rule, offset, msg) => {
		const line = lineOf(src, offset);
		const key = rule + "@" + line;
		if (seen[key]) return;
		seen[key] = true;
		violations.push({ rule, line, msg, text: (srcLines[line - 1] || "").trim() });
	};
	for (const s of sections) {
		for (const t of masked.templates) {
			if (t >= s.begin && t < s.end) push("template", t, "템플릿 문자열은 ES3에 없다 — 문자열 + 연결");
		}
		const body = code.slice(s.begin, s.end);
		for (const r of RULES) {
			r.re.lastIndex = 0;
			let mm;
			while ((mm = r.re.exec(body))) {
				if (mm[0] === "") { r.re.lastIndex++; continue; }
				// 규칙 검사는 구역 앞부분 문맥까지 본다(수신자 추적 등)
				const abs = s.begin + mm.index;
				const ctxMatch = Object.assign([], mm, { index: abs });
				if (r.ok && r.ok(code, ctxMatch)) continue;
				push(r.id, abs, r.msg);
			}
		}
	}
	violations.sort((a, b) => a.line - b.line);
	return { sections, violations };
}

function main(argv) {
	const files = argv.filter((a) => !a.startsWith("-"));
	if (!files.length) {
		console.error("사용법: node tests/lib/es3lint.js <file.jsx> [...]");
		return 2;
	}
	let bad = 0;
	for (const f of files) {
		let src;
		try {
			src = fs.readFileSync(f, "utf8");
		} catch (e) {
			console.error("es3lint: 읽을 수 없음 " + f + " — " + e.message);
			return 2;
		}
		const res = lintSource(src);
		const rel = path.relative(process.cwd(), f) || f;
		if (res.error) {
			console.error(rel + ": " + res.error);
			return 2;
		}
		if (!res.sections.length) {
			console.log("es3lint: " + rel + " — MI:BEGIN 구역 없음 (검사할 v28 코드 없음)");
			continue;
		}
		const lines = res.sections.reduce((n, s) => n + (s.endLine - s.startLine + 1), 0);
		for (const v of res.violations) {
			console.log(rel + ":" + v.line + "  [" + v.rule + "] " + v.msg + "\n    > " + v.text);
		}
		bad += res.violations.length;
		console.log("es3lint: " + rel + " — 구역 " + res.sections.length + "개, " + lines + "줄, 위반 " + res.violations.length + "건");
	}
	return bad ? 1 : 0;
}

if (require.main === module) {
	process.exitCode = main(process.argv.slice(2));
}

module.exports = { lintSource, RULES, RESERVED, main };
