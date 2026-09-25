"use strict";
// S2-1: hostscript.jsx MI_PURE 블록(ES3 순수 헬퍼)을 node:vm에서 그대로 돌린다 + v27 부분이 한 바이트도 바뀌지 않았는지.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { loadHostPure, loadRegions, fnv1a32, plain, HOST_JSX } = require("../lib/loadRegions");

const H = loadHostPure();
const SEP_A = String.fromCharCode(0x2028);
const SEP_B = String.fromCharCode(0x2029);
const BS = String.fromCharCode(92);

test("MI_PURE: 헬퍼가 모두 있다", () => {
	for (const nm of ["MI__json", "MI__str", "MI__esc", "MI__isArr", "MI__isInt", "MI__idx", "MI__parseTag", "MI__makeTag", "MI__frameOf", "MI__ticks"]) {
		assert.equal(typeof H[nm], "function", nm);
	}
	assert.equal(H.MI__TPS, 254016000000);
	assert.equal(H.MI__READ_MAX, 40);
});

test("MI__json: 제어 문자·따옴표·역슬래시·U+2028/2029를 이스케이프하고, JSON.parse로 되돌아온다", () => {
	const s = "a\"b" + BS + "c\n\r\t" + String.fromCharCode(0, 1, 8, 12, 0x1f) + SEP_A + SEP_B + "한글 [MI:ab12-1.1]";
	const out = H.MI__json({ s, arr: [s] });
	assert.equal(out.indexOf(SEP_A), -1, "날 U+2028이 남지 않는다");
	assert.equal(out.indexOf(SEP_B), -1, "날 U+2029가 남지 않는다");
	assert.ok(/^[^\u0000-\u001f]*$/.test(out), "날 제어 문자가 남지 않는다");
	assert.ok(out.indexOf(BS + "u2028") !== -1 && out.indexOf(BS + "u2029") !== -1);
	assert.ok(out.indexOf(BS + "u0000") !== -1 && out.indexOf(BS + "u001f") !== -1);
	assert.ok(out.indexOf("한글") !== -1, "한글은 그대로");
	assert.deepEqual(JSON.parse(out), { s, arr: [s] });
});

test("MI__json: NaN·Infinity → null, undefined·함수 속성은 빠지고 배열 속 undefined는 null", () => {
	const out = H.MI__json({ a: NaN, b: Infinity, c: -Infinity, d: undefined, e: () => 1, f: [undefined, 1, NaN, null, () => 2], g: true, h: false, i: null, j: -0.5, k: 1e21 });
	assert.deepEqual(JSON.parse(out), { a: null, b: null, c: null, f: [null, 1, null, null, null], g: true, h: false, i: null, j: -0.5, k: 1e21 });
	assert.equal(H.MI__json(undefined), "null");
	assert.equal(H.MI__json("x"), "\"x\"");
	assert.equal(H.MI__json([]), "[]");
	assert.equal(H.MI__json({}), "{}");
});

test("MI__json: 중첩 객체·배열이 JSON.stringify와 같은 값으로 되읽힌다", () => {
	const v = { ok: true, results: [{ key: "k7q2-57", status: "placed", sf: 296, ef: 354, texts: ["오늘 날씨", "a\nb"], lay: [["텍스트", "t"], ["색", "o"]], before: null, deco: { comps: 3, keyed: [] } }], dur: { "C:/m/x.mogrt": 5.005 } };
	assert.deepEqual(JSON.parse(H.MI__json(v)), v);
	assert.equal(H.MI__json(v), JSON.stringify(v), "이스케이프가 필요 없는 값은 JSON.stringify와 글자까지 같다");
});

test("MI__parseTag / MI__makeTag: 왕복, 이름 끝의 태그만, salt는 소문자·숫자 4자", () => {
	const tag = H.MI__makeTag("k7q2", 57, 3);
	assert.equal(tag, "[MI:k7q2-57.3]");
	assert.deepEqual(plain(H.MI__parseTag("철수 " + tag)), { salt: "k7q2", id: 57, g: 3 });
	assert.deepEqual(plain(H.MI__parseTag(tag + "  ")), { salt: "k7q2", id: 57, g: 3 }, "뒤 공백은 된다");
	for (const bad of ["[MI:K7Q2-1.1]", "[MI:ab1-1.1]", "[MI:abcde-1.1]", "[MI:ab12-1.1] 뒤", "[MI:ab12-1]", "[MI:ab12-x.1]", "", null, undefined]) {
		assert.equal(H.MI__parseTag(bad), null, String(bad));
	}
	assert.deepEqual(plain(H.MI__parseTag("[MI:0000-1.1] [MI:ab12-2.9]")), { salt: "ab12", id: 2, g: 9 }, "마지막 태그");
});

test("MI__parseTag는 패널 core parseClipTag와 같은 규칙이다", () => {
	const C = loadRegions(["src/mi/core.ts"]);
	const names = ["철수 [MI:k7q2-57.1]", "[MI:ab12-1.10]  ", "[MI:AB12-1.1]", "x [MI:ab12-1.1] y", "영희 [MI:zz99-100.2]", "[MI:a_b1-1.1]"];
	for (const nm of names) {
		const h = H.MI__parseTag(nm);
		const c = C.parseClipTag(nm);
		assert.deepEqual(h ? plain(h) : null, c ? { salt: c.salt, id: c.id, g: c.g } : null, nm);
		if (c) assert.equal(C.makeClipTag(c.salt, c.id, c.g), H.MI__makeTag(c.salt, c.id, c.g));
	}
});

test("MI__frameOf / MI__ticks: 4개 프레임레이트, 700,000 프레임까지 정확 (sf × frameTicks)", () => {
	for (const ft of [10594584000, 8475667200, 10160640000, 4237833600]) {
		for (const f of [0, 1, 24, 719, 720, 86400, 700000]) {
			const t = H.MI__ticks(f, ft);
			assert.equal(t, String(BigInt(f) * BigInt(ft)), "ticks " + f + "@" + ft);
			assert.equal(H.MI__frameOf(t, ft), f);
			assert.equal(H.MI__frameOf(String(Number(t) + ft * 0.49), ft), f, "반 프레임 안은 가까운 프레임");
		}
		assert.equal(H.MI__frameOf(ft * 719.5, ft), 720, "반 프레임은 올림 (S0-3 q)");
	}
});

test("MI__idx·MI__isArr·MI__isInt", () => {
	assert.equal(H.MI__idx(["a", "b"], "b"), 1);
	assert.equal(H.MI__idx(["a"], "z"), -1);
	assert.equal(H.MI__idx(null, "z"), -1);
	assert.equal(H.MI__idx([1, "1"], "1"), 1, "엄격 비교");
	assert.equal(H.MI__isArr([]), true);
	assert.equal(H.MI__isArr({ length: 0 }), false);
	assert.equal(H.MI__isInt(3), true);
	assert.equal(H.MI__isInt(3.5), false);
	assert.equal(H.MI__isInt("3"), false);
	assert.equal(H.MI__isInt(NaN), false);
});

// v27 호스트 함수는 한 바이트도 바꾸지 않는다 (§0.1). 머리 주석(버전 줄)과 MI:BEGIN 구역을 뺀 본문의 해시를
// v27 태그(0aa8b82)의 hostscript.jsx에서 잰 값과 비교한다 (git show v27:extension/jsx/hostscript.jsx).
const V27_BODY_FNV = "7d850663";
function v27Body(src) {
	src = String(src).replace(/\r\n/g, "\n");
	const a = src.indexOf("*/\n") + 3;
	const b = src.indexOf("/* MI:BEGIN v28 */");
	return src.slice(a, b === -1 ? src.length : b).replace(/\n+$/, "");
}
test("v27 부분(머리 주석 뒤 ~ MI:BEGIN 앞)이 v27과 바이트까지 같다", () => {
	const src = fs.readFileSync(HOST_JSX, "utf8");
	assert.equal(fnv1a32(v27Body(src)), V27_BODY_FNV);
	assert.ok(src.indexOf("/* MI:BEGIN v28 */") !== -1 && /\/\* MI:END \*\/\n$/.test(src.replace(/\r\n/g, "\n")), "MI 구역이 파일 끝에 있다");
	assert.match(src, /var MI_BUILD = "@@BUILD@@";/, "빌드 스탬프 자리 (stamp.js buildOfHost가 읽는다)");
});
