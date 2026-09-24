"use strict";
// 하네스 자체 테스트: region 잘라내기, vm 격리, 순수성 가드, regionHash, loadHostPure
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const L = require("../lib/loadRegions");

function tmpFile(name, text) {
	const f = path.join(os.tmpdir(), "mi_loadRegions_" + process.pid + "_" + name);
	fs.writeFileSync(f, text, "utf8");
	return f;
}

const APP = [
	"(function() {",
	"\t//#region src/pure.ts",
	"\t// 주석 속 state.subtitles 와 document 는 괜찮다",
	"\tconst LIMIT = 3;",
	"\tvar label = \"window.x 문자열도 괜찮다\";",
	"\tfunction twice(x) { const inner = x * 2; return inner; }",
	"\tfunction env() { return [typeof require, typeof process, typeof TextDecoder, typeof console]; }",
	"\t//#endregion",
	"\t//#region src/impure.ts",
	"\tfunction bad() { return state.subtitles.length; }",
	"\t//#endregion",
	"\t//#region src/dom.ts",
	"\tfunction dom() { return document.getElementById(\"x\"); }",
	"\t//#endregion",
	"})();"
].join("\n");

test("region의 최상위 함수·상수를 돌려주고 중첩 이름은 숨긴다", () => {
	const f = tmpFile("app.js", APP);
	try {
		const r = L.loadRegions(["src/pure.ts"], f);
		assert.deepEqual(Object.keys(r).sort(), ["LIMIT", "env", "label", "twice"]);
		assert.equal(r.twice(4), 8);
		assert.equal(r.LIMIT, 3);
	} finally { fs.unlinkSync(f); }
});

test("vm에는 console, TextDecoder, TextEncoder만 있다", () => {
	const f = tmpFile("app2.js", APP);
	try {
		const { env } = L.loadRegions("src/pure.ts", f);
		assert.deepEqual(L.plain(env()), ["undefined", "undefined", "function", "object"]);
	} finally { fs.unlinkSync(f); }
});

test("순수성 가드: state. / document 를 쓰는 region은 거부한다", () => {
	const f = tmpFile("app3.js", APP);
	try {
		assert.throws(() => L.loadRegions(["src/impure.ts"], f), /순수성 가드.*state\./);
		assert.throws(() => L.loadRegions(["src/dom.ts"], f), /순수성 가드.*document/);
		assert.throws(() => L.loadRegions(["src/nope.ts"], f), /region 없음/);
	} finally { fs.unlinkSync(f); }
});

test("실제 app.js: srtParser region은 순수, storage region은 거부", () => {
	assert.ok(L.listRegions().some((r) => r.name === "src/srtParser.ts"));
	assert.doesNotThrow(() => L.loadRegions(["src/srtParser.ts"]));
	assert.throws(() => L.loadRegions(["src/storage.ts"]), /순수성 가드/);
});

test("regionHash: 8자리 hex, 본문이 바뀌면 달라지고 CRLF에는 둔감하다", () => {
	const h = L.regionHash("src/srtParser.ts");
	assert.match(h, /^[0-9a-f]{8}$/);
	assert.equal(L.regionHash("src/srtParser.ts"), h);
	const a = tmpFile("h1.js", APP);
	const b = tmpFile("h2.js", APP.replace("LIMIT = 3", "LIMIT = 4"));
	const c = tmpFile("h3.js", APP.replace(/\n/g, "\r\n"));
	try {
		assert.notEqual(L.regionHash("src/pure.ts", a), L.regionHash("src/pure.ts", b));
		assert.equal(L.regionHash("src/pure.ts", a), L.regionHash("src/pure.ts", c));
		assert.equal(L.regionHash("src/impure.ts", a), L.regionHash("src/impure.ts", b));
	} finally { [a, b, c].forEach((x) => fs.unlinkSync(x)); }
	// FNV-1a 알려진 값
	assert.equal(L.fnv1a32(""), "811c9dc5");
	assert.equal(L.fnv1a32("a"), "e40c292c");
});

test("loadHostPure: 블록이 없으면 {} (S2-1 이전), 있으면 ES3 코드를 그대로 실행", () => {
	assert.deepEqual(L.loadHostPure(), {});
	const jsx = tmpFile("h.jsx", [
		"function v27() { return app.project; }",
		"/* MI:BEGIN v28 */",
		"/* MI_PURE_BEGIN */",
		"var MI__K = 7;",
		"function MI__idx(arr, x) { for (var i = 0; i < arr.length; i++) { if (arr[i] === x) return i; } return -1; }",
		"/* MI_PURE_END */",
		"function MI_ping() { return app.version; }",
		"/* MI:END */"
	].join("\n"));
	const bad = tmpFile("bad.jsx", "/* MI_PURE_BEGIN */\nfunction MI__x() { return app.project.path; }\n/* MI_PURE_END */\n");
	try {
		const h = L.loadHostPure(jsx);
		assert.deepEqual(Object.keys(h).sort(), ["MI__K", "MI__idx"]);
		assert.equal(h.MI__idx(["a", "b"], "b"), 1);
		assert.throws(() => L.loadHostPure(bad), /순수성 가드.*app\./);
	} finally { fs.unlinkSync(jsx); fs.unlinkSync(bad); }
});
