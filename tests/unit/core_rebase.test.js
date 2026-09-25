"use strict";
// S1-10 core: T-ID 기준 구조 맞춤 (rebaseRowParams), 못 옮긴 텍스트 합치기, 줄에 넣기(psOld)
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadRegions, plain } = require("../lib/loadRegions");
const { build } = require("../fixtures/presets_synth");

const core = loadRegions(["src/mi/core.ts"]);
const clone = (v) => JSON.parse(JSON.stringify(v));
const pick = (list, idx) => list.find((p) => p.index === idx);
const exposedOf = (preset, all) => all.filter((p) => preset.exposedIndices.indexOf(p.index) !== -1);

test("옛 8속성 preset_1 줄 → 15속성: T1 캡션·T2·T3 옮김, 노출 색상은 이름으로 줄 값, 노출 안 된 숫자는 프리셋 값", () => {
	const { presets, STALE_1 } = build();
	const p1 = clone(presets.preset_1);
	p1.exposedIndices = [1, 4, 5, 6, 8]; // 박스 색상·강조 색상도 노출
	const row = clone(STALE_1);
	core.setTextValue(row[0], "옛 구조 캡션");
	core.setTextValue(row[2], "구조$$캡션");
	core.setTextValue(row[4], "서브 값");
	row[5].colorHex = "#123456"; // 박스 색상 (줄에서 고침)
	row[1].colorHex = "#abcdef"; // 강조 색상 (줄에서 고침)
	row[6].value = "99"; // 박스 가로 여백: 노출 안 됨 → 프리셋 값
	const rowExposed = [row[0], row[1], row[2], row[4], row[5]]; // 줄에서 고칠 수 있던 속성
	const r = core.rebaseRowParams(row, p1, { rowExposed, caption: "옛 구조 캡션" });
	assert.deepEqual(plain(r.params.map((p) => [p.index, p.displayName, p.type])), p1.params.map((p) => [p.index, p.displayName, p.type]), "지금 15속성 구조");
	assert.deepEqual(plain(core.textFields(r.params).map((t) => [t.fid, r.params[t.pos].value])), [["T1", "옛 구조 캡션"], ["T2", "구조$$캡션"], ["T3", "서브 값"]]);
	assert.equal(JSON.parse(pick(r.params, 4).rawValue).textEditValue, "옛 구조 캡션", "rawValue에도 문장");
	assert.equal(pick(r.params, 1).colorHex, "#123456", "노출된 박스 색상 = 줄 값 (이름으로)");
	assert.equal(pick(r.params, 5).colorHex, "#abcdef", "노출된 강조 색상 = 줄 값");
	assert.equal(pick(r.params, 2).value, "40", "노출 안 된 박스 가로 여백 = 프리셋 값");
	assert.equal(pick(r.params, 7).colorHex, "#ff8800", "옛 구조에 있어도 노출 안 된 포인트 색상 = 프리셋 값");
	assert.deepEqual(plain(r.orphanFields), []);
	assert.equal(core.layoutMismatch(r.params, p1.params), false);
	assert.equal(row[0].index, 0, "줄 목록은 바꾸지 않는다");
});

test("지금 구조 줄: 노출 안 된 값만 프리셋 값으로 바뀌고 나머지(T2·노출 속성)는 그대로", () => {
	const { presets } = build();
	const p3 = presets.preset_3;
	const all = clone(p3.params);
	core.setTextValue(pick(all, 1), "밴드 캡션");
	core.setTextValue(pick(all, 2), "밴드$$캡션");
	pick(all, 3).colorHex = "#00ff00"; // 밴드 색상: 노출 안 됨 (프리셋 exposedIndices는 텍스트만)
	const next = clone(p3);
	pick(next.params, 3).colorHex = "#ff0000"; // 프리셋에서 바꾼 색
	const r = core.rebaseRowParams(all, next, { rowExposed: exposedOf(p3, all), caption: "밴드 캡션" });
	const want = clone(all);
	pick(want, 3).colorHex = "#ff0000";
	assert.deepEqual(plain(r.params), want);
	assert.deepEqual(plain(r.orphanFields), []);
});

test("이름이 바뀐 텍스트 필드는 orphanFields로 (프리셋 기본값·빈 값은 빼고), 캡션은 opts.caption", () => {
	const { presets } = build();
	const p6 = presets.preset_6;
	const all = clone(p6.params);
	core.setTextValue(pick(all, 0), "첫 줄 캡션");
	core.setTextValue(pick(all, 2), "둘째 줄 후반 작업");
	const next = clone(p6);
	pick(next.params, 2).displayName = "두 번째 자막";
	const r = core.rebaseRowParams(all, next, { rowExposed: exposedOf(p6, all), caption: "첫 줄 캡션", oldParams: p6.params });
	assert.deepEqual(plain(r.orphanFields), [{ displayName: "자막 2 텍스트", value: "둘째 줄 후반 작업" }]);
	assert.equal(pick(r.params, 2).value, pick(next.params, 2).value, "새 이름 필드는 프리셋 기본값");
	assert.equal(pick(r.params, 0).value, "첫 줄 캡션");
	// 기본값 그대로인 텍스트는 고아가 아니다
	const all2 = clone(p6.params);
	const r2 = core.rebaseRowParams(all2, next, { caption: pick(all2, 0).value, oldParams: p6.params });
	assert.deepEqual(plain(r2.orphanFields), [], "'합성 둘째 줄'은 옛 프리셋 기본값");
	// 캡션 필드 이름이 바뀌어도 캡션은 opts.caption으로, 옛 캡션 필드 값은 고아가 아니다
	const next3 = clone(p6);
	pick(next3.params, 0).displayName = "첫째 자막";
	const r3 = core.rebaseRowParams(all, next3, { caption: "첫 줄 캡션" });
	assert.equal(pick(r3.params, 0).value, "첫 줄 캡션");
	assert.equal(pick(r3.params, 2).value, "둘째 줄 후반 작업", "나머지 필드는 서수·이름으로");
	assert.deepEqual(plain(r3.orphanFields), [], "캡션 문장을 가진 옛 캡션 필드는 옮긴 것으로 친다");
});

test("'T'(캡션)를 다른 필드로 옮긴 저장: 새 캡션 필드는 캡션, 그 자리에 있던 후반 작업은 고아", () => {
	const { presets } = build();
	const p3 = presets.preset_3;
	const all = clone(p3.params);
	core.setTextValue(pick(all, 1), "밴드 캡션");
	core.setTextValue(pick(all, 2), "포인트 후반");
	const next = clone(p3);
	next.textParamIndex = 2;
	const r = core.rebaseRowParams(all, next, { caption: "밴드 캡션" });
	assert.equal(pick(r.params, 2).value, "밴드 캡션", "새 캡션 필드");
	assert.equal(pick(r.params, 1).value, "밴드 캡션", "T1은 제 값 (이제 후반 작업 필드)");
	assert.deepEqual(plain(r.orphanFields), [{ displayName: "포인트 텍스트", value: "포인트 후반" }]);
});

test("네이티브: '텍스트 N' 줄과 이름 붙은 프리셋은 서수로, 글꼴을 고칠 수 있던 필드는 줄 rawValue", () => {
	const { NATIVE } = build();
	const row = clone(NATIVE);
	row[0].value = "이름 캡션";
	row[1].value = "직함";
	const pre = { id: "preset_n", params: clone(NATIVE), exposedIndices: [0, 1], textParamIndex: 0, exposedFontFields: {} };
	pre.params[0].displayName = "Insert Name Here";
	pre.params[1].displayName = "ADD TITLE HERE";
	const r = core.rebaseRowParams(row, pre, { caption: "이름 캡션" });
	assert.deepEqual(plain(r.params.map((p) => [p.displayName, p.value])), [["Insert Name Here", "이름 캡션"], ["ADD TITLE HERE", "직함"]]);
	assert.deepEqual(plain(r.orphanFields), []);
	// nativeText 표시가 없는 '텍스트 N' 줄도 개수가 같으면 서수
	const bare = row.map((p) => { const q = clone(p); delete q.nativeText; return q; });
	const r2 = core.rebaseRowParams(bare, pre, {});
	assert.deepEqual(plain(r2.params.map((p) => p.value)), ["이름 캡션", "직함"]);
	// 글꼴 노출 필드: 줄 rawValue(글꼴)를 쓴다
	const { presets, helpers } = build();
	const p3 = clone(presets.preset_3);
	p3.exposedFontFields = { 1: ["font", "size"] };
	const all = clone(p3.params);
	pick(all, 1).rawValue = helpers.textRaw("밴드 캡션", { fontEditValue: ["줄 글꼴"] });
	pick(all, 1).value = "밴드 캡션";
	pick(all, 2).rawValue = helpers.textRaw("포인트", { fontEditValue: ["줄 글꼴 2"] });
	pick(all, 2).value = "포인트";
	const r3 = core.rebaseRowParams(all, p3, { rowExposed: exposedOf(p3, all), caption: "밴드 캡션" });
	assert.deepEqual(JSON.parse(pick(r3.params, 1).rawValue).fontEditValue, ["줄 글꼴"], "글꼴을 고칠 수 있던 필드");
	assert.deepEqual(JSON.parse(pick(r3.params, 2).rawValue).fontEditValue, ["NanumSquareRoundOTF"], "나머지는 프리셋 글꼴");
	assert.equal(JSON.parse(pick(r3.params, 2).rawValue).textEditValue, "포인트");
});

test("mergeOrphanFields·applyRebase: 노출 목록은 같은 객체로 다시 고르고, ap가 없고 서명이 바뀌면 psOld", () => {
	assert.deepEqual(plain(core.mergeOrphanFields([{ displayName: "a", value: "1" }], [{ displayName: "a", value: "1" }, { displayName: "b", value: "2" }])), { list: [{ displayName: "a", value: "1" }, { displayName: "b", value: "2" }], added: 1 });
	const { presets, STALE_1 } = build();
	const p1 = presets.preset_1;
	const rs = { presetId: "preset_1", params: clone(STALE_1).filter((p) => p.type === "text"), _allParams: clone(STALE_1), open: true, checked: false };
	const oldSig = core.paramSig(rs._allParams);
	const r = core.rebaseRowParams(rs._allParams, p1, { rowExposed: rs.params, caption: "옛 구조 합성 문장" });
	assert.equal(core.applyRebase(rs, p1, r), 0);
	assert.equal(rs.psOld, oldSig);
	assert.deepEqual(plain(rs.params.map((p) => p.index)), p1.exposedIndices);
	assert.ok(rs.params.every((p) => rs._allParams.indexOf(p) !== -1), "노출 목록은 _allParams의 같은 객체");
	assert.equal(rs.orphanFields, undefined, "못 옮긴 텍스트가 없으면 키를 만들지 않는다");
	assert.equal(core.isV27Unsafe(rs, p1), true, "psOld → 이름으로 쓴다");
	// 서명이 같으면 psOld를 만들지 않는다, ap가 있으면 만들지 않는다
	const rs2 = { presetId: "preset_1", params: [], _allParams: clone(p1.params) };
	core.applyRebase(rs2, p1, core.rebaseRowParams(rs2._allParams, p1, {}));
	assert.equal(rs2.psOld, undefined);
	const rs3 = { presetId: "preset_1", params: [], _allParams: clone(STALE_1), ap: { s: 1, e: 2, cap: "", ps: oldSig, t: 2 } };
	core.applyRebase(rs3, p1, core.rebaseRowParams(rs3._allParams, p1, {}));
	assert.equal(rs3.psOld, undefined);
	assert.equal(core.isV27Unsafe(rs3, p1), true, "ap.ps가 지금 서명과 달라 위험");
});
