"use strict";
// S3-1·S3-2 core: AI 제안 확인 (validateSuggestion·suggState·suggCheckText), 줄 uid
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadRegions, plain } = require("../lib/loadRegions");
const { build } = require("../fixtures/presets_synth");

const core = loadRegions(["src/mi/core.ts"]);
const clone = (v) => JSON.parse(JSON.stringify(v));

// preset_3 줄: T1 캡션 "오늘 날씨가 좋고 하늘이 맑다", T2 포인트 텍스트 (규칙: 최대 3개)
function row3(caption) {
	const { presets } = build();
	const p3 = presets.preset_3;
	const all = clone(p3.params);
	core.setTextValue(all.find((p) => p.index === 1), caption);
	const rs = { presetId: "preset_3", params: all.filter((p) => p.type === "text"), _allParams: all, open: false, checked: false };
	const sub = { id: 12, index: 12, text: caption, startSec: 1, endSec: 2 };
	return { p3, rs, sub, sig: core.fieldSignature(all) };
}
const CAP = "오늘 날씨가 좋고 하늘이 맑다";
const v = (x, fid, value, extra) => plain(core.validateSuggestion(Object.assign({ sub: x.sub, rs: x.rs, preset: x.p3, fid, value, sig: x.sig }, extra || {})));

test("받는 제안: '날씨$$하늘'은 포인트 텍스트 (조각이 캡션에 그대로 있다), 캡션 해시·필드 이름", () => {
	const x = row3(CAP);
	const r = v(x, "T2", "날씨$$하늘");
	assert.deepEqual([r.ok, r.error, r.kind, r.segs, r.missing, r.warn, r.max, r.field], [true, "", "point", ["날씨", "하늘"], [], [], 3, "포인트 텍스트"]);
	assert.equal(r.capHash, core.suggCapHash(CAP));
	assert.equal(core.suggCheckText(r), "✓ 본문에 있음");
});

test("거절: 캡션 필드, 없는 필드, 서명 다름(fields-changed), 조각이 캡션에 없음, 최대 3개 넘김, 빈 값, 500자 넘김", () => {
	const x = row3(CAP);
	assert.equal(v(x, "T1", "날씨").error, "caption-field");
	assert.equal(v(x, "T3", "날씨").error, "unknown-field");
	assert.equal(v(x, "T2", "날씨", { sig: "T1=텍스트" }).error, "fields-changed");
	const miss = v(x, "T2", "날씨$$바다");
	assert.deepEqual([miss.ok, miss.error, miss.missing], [false, "missing-segment", ["바다"]]);
	assert.equal(core.suggCheckText(miss), "✕ ‘바다’가 문장에 없습니다");
	const many = v(x, "T2", "오늘$$날씨$$하늘$$맑다");
	assert.deepEqual([many.ok, many.error, many.segs.length, many.max], [false, "too-many", 4, 3]);
	assert.equal(core.suggCheckText(many), "✕ 조각 4개 — 최대 3개");
	assert.equal(v(x, "T2", "  ").error, "empty");
	assert.equal(v(x, "T2", "$$").error, "empty");
	assert.equal(v(x, "T2", 3).error, "empty");
	assert.equal(v(x, "T2", "가".repeat(501)).error, "too-long");
	assert.equal(v(x, "T2", "가".repeat(500)).error, "", "500자까지는 된다 (캡션에 없어 경고만)");
});

test("자유 문구('$$' 없음): 캡션에 없으면 받되 not-in-caption 경고, 캡션 안의 한 조각은 경고 없음", () => {
	const x = row3(CAP);
	const free = v(x, "T2", "오늘의 인터뷰");
	assert.deepEqual([free.ok, free.kind, free.warn], [true, "text", ["not-in-caption"]]);
	assert.equal(core.suggCheckText(free), "! 본문에 없는 문구");
	const one = v(x, "T2", "하늘");
	assert.deepEqual([one.ok, one.warn], [true, []]);
});

test("두 번 나오는 조각은 받되 dup 경고 (첫 번째만 칠해진다)", () => {
	const x = row3("좋다 좋다 날씨");
	const r = v(x, "T2", "좋다$$날씨");
	assert.deepEqual([r.ok, r.warn, r.dup], [true, ["dup"], ["좋다"]]);
	assert.equal(core.suggCheckText(r), "✓ 본문에 있음 · ‘좋다’가 두 번 나와 첫 번째만 칠해집니다");
});

test("낡은 제안: 제안 때 캡션 해시와 지금 캡션이 다르면 stale, 서명이 다르면 stale(fields-changed)", () => {
	const x = row3(CAP);
	const cap0 = core.suggCapHash(CAP);
	const entry = { v: "날씨$$하늘", by: "codex", ts: 1, cap: cap0, sig: x.sig, st: "pending", note: "" };
	let s = plain(core.suggState(x.sub, x.rs, x.p3, "T2", entry));
	assert.deepEqual([s.ok, s.stale], [true, false]);
	// 캡션이 바뀜 (조각은 여전히 있어도 다시 확인해야 한다)
	core.setRowFieldValue(x.rs, x.p3, "T1", "오늘 날씨가 좋고 하늘이 아주 맑다");
	s = plain(core.suggState(x.sub, x.rs, x.p3, "T2", entry));
	assert.deepEqual([s.ok, s.stale, s.error], [false, true, "stale"]);
	assert.equal(core.suggCheckText(s), "캡션이 바뀌어 다시 확인이 필요합니다");
	// 필드 구조가 바뀜
	s = plain(core.suggState(x.sub, x.rs, x.p3, "T2", Object.assign({}, entry, { cap: core.suggCapHash("오늘 날씨가 좋고 하늘이 아주 맑다"), sig: "T1=텍스트" })));
	assert.deepEqual([s.stale, s.error], [true, "fields-changed"]);
	assert.equal(core.suggCheckText(s), "필드 구조가 바뀌어 다시 확인이 필요합니다");
	// 캡션 해시는 normText 기준 (공백·줄바꿈 모양만 다르면 같은 캡션)
	assert.equal(core.suggCapHash("오늘  날씨\r\n좋다 "), core.suggCapHash("오늘 날씨\n좋다"));
});

test("캡션이 아닌 모든 텍스트 필드에 받는다 (결정 10): preset_6의 T3 '자막 2 텍스트', 캡션 필드가 없는 preset_8은 모든 필드", () => {
	const { presets } = build();
	const p6 = presets.preset_6;
	const all = clone(p6.params);
	core.setTextValue(all[0], "첫 줄 문장");
	const rs = { presetId: "preset_6", params: [], _allParams: all };
	const sub = { id: 3, index: 3, text: "첫 줄 문장" };
	const r = plain(core.validateSuggestion({ sub, rs, preset: p6, fid: "T3", value: "둘째 줄 제목", sig: core.fieldSignature(all) }));
	assert.deepEqual([r.ok, r.field, r.warn], [true, "자막 2 텍스트", ["not-in-caption"]]);
	const p8 = presets.preset_8;
	const all8 = clone(p8.params);
	const r8 = plain(core.validateSuggestion({ sub: { id: 4, text: "타이틀" }, rs: { _allParams: all8 }, preset: p8, fid: "T1", value: "제목 제안", sig: core.fieldSignature(all8) }));
	assert.equal(r8.ok, true, "캡션 필드가 없으면 T1도 후반 작업 필드");
});

test("거절: 프리셋 없음, 속성 없음, 순서 미확인 네이티브 (AI 제안을 끈다)", () => {
	const { NATIVE } = build();
	const x = row3(CAP);
	assert.equal(plain(core.validateSuggestion({ sub: x.sub, rs: x.rs, preset: null, fid: "T2", value: "날씨", sig: x.sig })).error, "no-preset");
	assert.equal(plain(core.validateSuggestion({ sub: x.sub, rs: { _allParams: [] }, preset: x.p3, fid: "T2", value: "날씨", sig: "" })).error, "no-fields");
	// 네이티브: 이름이 '텍스트 N'뿐이면 순서 미확인 → 거절, definition 이름이 붙었으면 받는다
	const nat = { id: "preset_9", name: "네이티브", mogrtPath: "D:/MOGRT/n.mogrt", params: clone(NATIVE), textParamIndex: 0 };
	const all = clone(NATIVE);
	all[0].value = CAP;
	const r = plain(core.validateSuggestion({ sub: x.sub, rs: { _allParams: all }, preset: nat, fid: "T2", value: "날씨", sig: core.fieldSignature(all) }));
	assert.equal(r.error, "native-unverified");
	const named = Object.assign({}, nat, { params: clone(NATIVE).map((p, i) => Object.assign(p, { displayName: ["제목", "부제"][i] })) });
	const allN = clone(named.params);
	allN[0].value = CAP;
	const ok = plain(core.validateSuggestion({ sub: x.sub, rs: { _allParams: allN }, preset: named, fid: "T2", value: "날씨", sig: core.fieldSignature(allN) }));
	assert.deepEqual([ok.ok, ok.field], [true, "부제"]);
});

test("uidToId: 다화자는 지금 salt의 'salt-id'만, 단일 화자(salt 없음)는 id 글자", () => {
	assert.equal(core.uidToId("k7q2-57", "k7q2"), 57);
	assert.equal(core.uidToId("zz99-57", "k7q2"), null, "다른 salt");
	assert.equal(core.uidToId("57", "k7q2"), null, "다화자에서 id만");
	assert.equal(core.uidToId("57", ""), 57);
	assert.equal(core.uidToId(" 57 ", ""), 57);
	assert.equal(core.uidToId("k7q2-57", ""), null);
	assert.equal(core.uidToId("#12", ""), null);
	assert.equal(core.uidToId(null, ""), null);
});

test("quoteIga: 끝 글자 받침에 맞춘 조사 ('하늘’이 · ‘날씨’가 · 영문은 이(가))", () => {
	assert.equal(core.quoteIga(["하늘"]), "‘하늘’이");
	assert.equal(core.quoteIga(["날씨"]), "‘날씨’가");
	assert.equal(core.quoteIga(["바다", "하늘"]), "‘바다’, ‘하늘’이", "마지막 낱말을 따른다");
	assert.equal(core.quoteIga(["AI"]), "‘AI’이(가)");
});
