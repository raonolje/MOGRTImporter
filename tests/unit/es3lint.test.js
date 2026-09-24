"use strict";
// es3lint 자체 테스트: 금지 구문마다 픽스처 하나가 실패하고, 깨끗한 픽스처와 문자열 indexOf는 통과한다.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { lintSource } = require("../lib/es3lint");
const { HOST_JSX, ROOT } = require("../lib/loadRegions");

const wrap = (body) => "// v27 코드 (검사 대상 아님)\nvar before = 1;\n/* MI:BEGIN v28 */\n" + body + "\n/* MI:END */\n";
const rulesOf = (body) => {
	const res = lintSource(wrap(body));
	assert.equal(res.error, undefined, res.error);
	return res.violations.map((v) => v.rule);
};

// [규칙 id, 금지 구문 한 가지만 담은 픽스처]
const BANNED = [
	["let", "function f() { let a = 1; return a; }"],
	["const", "const A = 1;"],
	["arrow", "var f = function (xs) { return g(xs, (x) => x); };"],
	["class", "class Foo {}"],
	["template", "var s = `a${b}c`;"],
	["array-hof", "xs.forEach(function (x) { n += x; });"],
	["array-hof", "var ys = xs.map(function (x) { return x; });"],
	["array-hof", "var ys = xs.filter(function (x) { return x; });"],
	["array-hof", "var ok = xs.some(function (x) { return x; });"],
	["array-hof", "var ok = xs.every(function (x) { return x; });"],
	["array-hof", "var n = xs.reduce(function (a, x) { return a + x; }, 0);"],
	["Array.isArray", "if (Array.isArray(x)) { n = 1; }"],
	["array-indexOf", "var i = arr.indexOf(x);"],
	["array-indexOf", "if (list.lastIndexOf(x) !== -1) { n = 1; }"],
	["trim", "var t = s.trim();"],
	["Object.es5", "var ks = Object.keys(o);"],
	["Object.es5", "var o2 = Object.create(null);"],
	["bind", "var g = f.bind(null);"],
	["Date.now", "var t = Date.now();"],
	["normalize", "var n = String(s).normalize(\"NFC\");"],
	["get/set", "var o = { get x() { return 1; } };"],
	["get/set", "var o = { set x(v) { y = v; } };"],
	["reserved-member", "var d = x.default;"],
	["reserved-member", "var c = e.class;"],
	["reserved-key", "var o = {new: 1};"],
	["reserved-key", "var o = { a: 1, default: 2 };"],
	["reserved-key", "f({ in: 1 });"],
	["JSON", "var s = JSON.stringify(o);"],
	["JSON", "var o = JSON.parse(s);"],
	["es5-string", "if (String(s).includes(\"a\")) { n = 1; }"],
	["es6-static", "var a = Array.from(x);"],
	["es6-global", "var m = new Map();"],
	["spread", "f(...xs);"],
	["for-of", "for (var x of xs) { n += x; }"],
	["default-param", "function f(a, b = 1) { return a + b; }"]
];

for (const [rule, body] of BANNED) {
	test("금지: " + rule + " — " + body, () => {
		const got = rulesOf(body);
		assert.ok(got.includes(rule), "기대 " + rule + ", 실제 " + JSON.stringify(got));
	});
}

const CLEAN = `
// 주석 속 금지어는 무시한다: let const => JSON.parse xs.map( Object.keys( \`템플릿\`
/* 블록 주석도: class Foo {} x.default {new: 1} */
var MI__RE_ARROW = /=>|\\.map\\(/;
function MI__idx(arr, x) {
    for (var i = 0; i < arr.length; i++) { if (arr[i] === x) return i; }
    return -1;
}
function MI__clean(s, name, list) {
    var msg = "문자열 속 금지어: let const => JSON.stringify xs.forEach( Date.now";
    var a = String(s).indexOf("[MI:");
    var b = "abc".indexOf("b");
    var c = (name + "").indexOf("x");
    var d = String(name).toLowerCase().indexOf("t");
    var e = list.join(",").indexOf("q");
    var f = String(s).lastIndexOf("]");
    var o = { "new": 1, "default": 2, className: "k", value: s };
    var g = o["default"] + o.className;
    var t = new Date().getTime();
    var trimmed = String(s).replace(/^\\s+|\\s+$/g, "");
    switch (a) {
        case 0: g = 1; break;
        default: g = 2;
    }
    if (b) { g += 1; } else { g -= 1; }
    try { g = MI__idx(list, s); } catch (err) { g = -1; }
    return msg + a + b + c + d + e + f + g + t + trimmed + MI__RE_ARROW.test(msg);
}
`;

test("깨끗한 ES3 픽스처는 통과한다", () => {
	assert.deepEqual(rulesOf(CLEAN), []);
});

test("문자열 indexOf는 통과한다", () => {
	assert.deepEqual(rulesOf("var i = String(clipName).indexOf(\"[MI:\");"), []);
	assert.deepEqual(rulesOf("var i = \"a,b\".indexOf(\",\");"), []);
	assert.deepEqual(rulesOf("var i = String(n).toUpperCase().indexOf(\"T\");"), []);
});

test("MI 구역 밖(v27)은 검사하지 않는다", () => {
	const src = "let x = () => JSON.parse(s);\n/* MI:BEGIN v28 */\nvar ok = 1;\n/* MI:END */\nconst y = [].map(f);\n";
	const res = lintSource(src);
	assert.equal(res.sections.length, 1);
	assert.deepEqual(res.violations, []);
});

test("위반 줄 번호는 파일 기준이다", () => {
	const res = lintSource(wrap("var a = 1;\nvar b = JSON.parse(s);"));
	assert.deepEqual(res.violations.map((v) => [v.rule, v.line]), [["JSON", 5]]);
});

test("MI:BEGIN/MI:END 짝이 맞지 않으면 오류", () => {
	assert.match(lintSource("/* MI:BEGIN v28 */\nvar a;\n").error, /짝이 맞지 않는다/);
	assert.match(lintSource("/* MI:END */\nvar a;\n/* MI:BEGIN v28 */\n").error, /순서/);
});

test("구역이 없으면 통과 (v27 hostscript)", () => {
	const res = lintSource("function a() { return JSON.stringify(1); }\n");
	assert.deepEqual(res, { sections: [], violations: [] });
});

test("CLI: 저장소 hostscript.jsx는 통과, 위반 파일은 종료 코드 1", () => {
	const lint = path.join(ROOT, "tests", "lib", "es3lint.js");
	execFileSync(process.execPath, [lint, HOST_JSX], { encoding: "utf8" });
	const bad = path.join(require("node:os").tmpdir(), "es3lint_bad_" + process.pid + ".jsx");
	require("node:fs").writeFileSync(bad, wrap("const A = 1;"));
	try {
		assert.throws(() => execFileSync(process.execPath, [lint, bad], { encoding: "utf8", stdio: "pipe" }), (e) => e.status === 1 && /\[const\]/.test(e.stdout));
	} finally {
		require("node:fs").unlinkSync(bad);
	}
});
