"use strict";
// S1-9 core: 레거시 목록 적용 (바꾸지 않은 v27 호스트) — 결과 판정, 적용 자리, ap 기록, 안전 적용 속성·계획
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadRegions, plain } = require("../lib/loadRegions");
const { build } = require("../fixtures/presets_synth");

const core = loadRegions(["src/mi/core.ts"]);
const clone = (v) => JSON.parse(JSON.stringify(v));
const sub = (id, s, e, text) => ({ id, index: id, startSec: s, endSec: e, startTime: "", endTime: "", text });
// 프리셋에서 채운 줄 (loadParamsFromPreset과 같은 모양: 캡션 필드 = 문장)
function rowOf(preset, text) {
	const all = clone(preset.params);
	const cap = all.find((p) => p.index === preset.textParamIndex);
	if (cap) core.setTextValue(cap, text);
	return { presetId: preset.id, params: all.filter((p) => preset.exposedIndices.indexOf(p.index) !== -1), _allParams: all, open: false, checked: false };
}

test("v27ResultOk·v27FailCount: 실패가 있어도 SUCCESS인 v27 결과", () => {
	assert.equal(core.v27ResultOk("SUCCESS: MOGRT 20개 + 텍스트 레이어 0개 배치 완료"), true);
	assert.equal(core.v27ResultOk("SUCCESS: MOGRT 18개 + 텍스트 레이어 0개 배치 완료 (실패 2개: importMGT)"), false);
	assert.equal(core.v27ResultOk("ERROR: 활성 시퀀스 없음"), false);
	assert.equal(core.v27ResultOk(""), false);
	assert.equal(core.v27ResultOk(null), false);
	assert.equal(core.v27FailCount("SUCCESS: MOGRT 18개 + 텍스트 레이어 0개 배치 완료 (실패 2개: importMGT)"), 2);
	assert.equal(core.v27FailCount("SUCCESS: … (실패 13개)"), 13);
	assert.equal(core.v27FailCount("SUCCESS: MOGRT 20개"), 0);
});

test("applyLocate·rowTimeChanged: ap → mmPrev → 지금 시간, 적용한 시간으로 돌아왔으면 바뀐 것이 아니다", () => {
	const s = sub(1, 10.4, 12, "문장");
	assert.deepEqual(plain(core.applyLocate({}, s)), { s: 10.4, e: 12, from: "sub" });
	assert.equal(core.rowTimeChanged({}, s), false, "기록이 없으면 비교할 것이 없다");
	assert.deepEqual(plain(core.applyLocate({ mmPrev: { s: 10, e: 12, cap: "x" } }, s)), { s: 10, e: 12, from: "mmPrev" });
	assert.equal(core.rowTimeChanged({ mm: "time", mmPrev: { s: 10, e: 12 } }, s), true);
	assert.deepEqual(plain(core.applyLocate({ ap: { s: 10.4, e: 12 }, mmPrev: { s: 9, e: 12 } }, s)), { s: 10.4, e: 12, from: "ap" }, "ap가 먼저");
	assert.equal(core.rowTimeChanged({ mm: "time", mmPrev: { s: 10.4, e: 12 } }, s), false, "mm이 time이어도 되돌아왔으면 false");
	assert.equal(core.rowTimeChanged({ mmPrev: { s: 10.43, e: 12 } }, s), false, "0.05초 이하는 같다");
	assert.equal(core.rowTimeChanged({ mmPrev: { s: 10.4, e: 12.2 } }, s), true, "끝만 바뀌어도");
});

test("needsApplyBook·markApplied: 병합 표시·위험·기존 ap가 있는 줄만, ap = {s, e, cap, ps, t}", () => {
	const { presets } = build();
	const p3 = presets.preset_3;
	assert.equal(core.needsApplyBook({}, false), false, "v27 줄은 적지 않는다");
	assert.equal(core.needsApplyBook({ mm: "text" }, false), true);
	assert.equal(core.needsApplyBook({}, true), true);
	assert.equal(core.needsApplyBook({ ap: {} }, false), true);
	const rs = rowOf(p3, "새 문장");
	rs.mm = "text";
	rs.mmPrev = { s: 1, e: 2, cap: "옛 문장" };
	core.markApplied(rs, sub(7, 1, 2, "새 문장(sub)"), p3, 3);
	assert.deepEqual(plain(rs.ap), { s: 1, e: 2, cap: "새 문장", ps: core.paramSig(rs._allParams), t: 3 });
	assert.equal(rs.mm, undefined);
	assert.equal(rs.mmPrev, undefined);
	assert.equal(core.isV27Unsafe(rs, p3), false, "적은 ps는 지금 서명과 같다");
	const bare = { presetId: "", params: [], _allParams: [] };
	core.markApplied(bare, sub(8, 3, 4, "프리셋 없는 줄"), null, 2);
	assert.equal(bare.ap.cap, "프리셋 없는 줄", "캡션 필드가 없으면 문장");
});

test("legacySafeParams: 문장 줄은 캡션 하나(이름이 유일하면 index -1), 위험한 줄은 이름으로 쓸 수 있는 속성 전부", () => {
	const { presets, STALE_1, NATIVE } = build();
	const p1 = presets.preset_1;
	const r1 = core.legacySafeParams(rowOf(p1, "새 캡션"), p1, false);
	assert.deepEqual(plain(r1.params.map((p) => [p.index, p.displayName, p.value])), [[-1, "전체 텍스트", "새 캡션"]]);
	// preset_3: 그룹 '텍스트'와 캡션 '텍스트'가 이름이 겹친다 → 이름으로 못 쓴다
	const p3 = presets.preset_3;
	const r3 = core.legacySafeParams(rowOf(p3, "밴드 문장"), p3, false);
	assert.deepEqual(plain(r3.params.map((p) => [p.index, p.displayName, p.value])), [[1, "텍스트", "밴드 문장"]], "위험하지 않으면 v27과 같은 index");
	assert.deepEqual(plain(core.legacySafeParams(rowOf(p3, "밴드 문장"), p3, true)), { skip: "caption-name" }, "위험한 줄은 index로 보내지 않는다");
	// 옛 8속성 줄 + 지금 15속성 프리셋 → 8개 모두 이름으로
	const stale = { presetId: "preset_1", params: [], _allParams: clone(STALE_1) };
	stale._allParams[0].value = "옛 구조 캡션";
	assert.equal(core.isV27Unsafe(stale, p1), true);
	const rs = core.legacySafeParams(stale, p1, true);
	assert.deepEqual(plain(rs.params.map((p) => [p.index, p.displayName])), STALE_1.map((p) => [-1, p.displayName]));
	assert.equal(rs.params[0].value, "옛 구조 캡션");
	assert.equal(stale._allParams[0].index, 0, "줄 목록은 바꾸지 않는다 (사본)");
	// 15속성 줄이 위험하면(psOld) 그룹·comment는 빼고 이름으로만
	const cur = rowOf(p1, "캡션");
	cur.psOld = "77aa01bc";
	const rc = core.legacySafeParams(cur, p1, true);
	assert.ok(rc.params.every((p) => p.index === -1));
	assert.deepEqual(plain(rc.params.map((p) => p.type)).filter((t) => t === "group" || t === "comment"), []);
	assert.equal(rc.params.length, p1.params.length - 2);
	// 네이티브·프리셋 없음·캡션 없음
	const nat = { id: "preset_n", params: clone(NATIVE), exposedIndices: [0, 1], textParamIndex: 0 };
	assert.deepEqual(plain(core.legacySafeParams(rowOf(nat, "x"), nat, false)), { skip: "native" });
	assert.deepEqual(plain(core.legacySafeParams(rowOf(p1, "x"), null, false)), { skip: "no-preset" });
	const p8 = presets.preset_8;
	assert.deepEqual(plain(core.legacySafeParams(rowOf(p8, ""), p8, false)), { skip: "no-caption" });
	assert.equal(core.legacySafeParams(rowOf(p8, ""), p8, true).params.length, p8.params.length, "캡션 없는 프리셋의 위험한 줄은 이름으로 전부");
});

test("legacyNeighbors·nearOtherRow: 같은 트랙에서 ap·mmPrev·지금 시간 ±0.5초, 휴지통 항목도 본다", () => {
	const subs = [sub(1, 10, 11, "a"), sub(2, 10.3, 11, "b"), sub(3, 20, 21, "c"), Object.assign(sub(4, 30, 31, "d"), { spk: "C1" })];
	const rsOf = { 1: {}, 2: {}, 3: { ap: { s: 20, e: 21, t: 5 } }, 4: {} };
	const trash = [{ sub: sub(9, 25.2, 26, "지운 줄"), state: { mmPrev: { s: 25.2, e: 26 } } }];
	const nb = core.legacyNeighbors(subs, rsOf, trash, 2);
	assert.deepEqual(plain(nb.map((o) => [o.id, o.track, o.at])), [[1, 2, [10]], [2, 2, [10.3]], [3, 5, [20, 20]], [9, 2, [25.2, 25.2]]], "화자 줄은 빼고 휴지통은 넣는다");
	assert.equal(core.nearOtherRow(1, 2, 10, nb), true, "0.3초 옆 줄");
	assert.equal(core.nearOtherRow(3, 5, 20, nb), false, "자기 자신은 빼고");
	assert.equal(core.nearOtherRow(7, 2, 20.2, nb), false, "다른 트랙(ap.t = 5)");
	assert.equal(core.nearOtherRow(7, 5, 20.2, nb), true);
	assert.equal(core.nearOtherRow(7, 2, 25, nb), true, "휴지통 항목의 클립도 남아 있다");
	assert.equal(core.nearOtherRow(7, 2, 10.8, nb), false, "0.5초는 넘지 않는다 (10.3 → 0.5)");
});

test("legacySafePlan: 문장 줄은 갱신(병합 전 자리), 새 줄·시간 변경·근처 줄은 건너뛴다", () => {
	const { presets } = build();
	const p1 = presets.preset_1;
	const mk = (id, s, e, text, extra) => ({ sub: sub(id, s, e, text), rs: Object.assign(rowOf(p1, text), extra || {}), preset: p1, track: 2 });
	const rows = [
		mk(1, 10, 12, "문장 바뀜", { mm: "text", mmPrev: { s: 10, e: 12, cap: "옛" } }),
		mk(2, 20.4, 22, "시간 바뀜", { mm: "time", mmPrev: { s: 20, e: 22, cap: "시간 바뀜" } }),
		mk(3, 30, 31, "새 줄", { mm: "new" }),
		mk(4, 40, 41, "근처", { mm: "text", mmPrev: { s: 40, e: 41, cap: "옛" } }),
		mk(5, 50, 51, "구조", { psOld: "77aa01bc" })
	];
	const nb = [{ id: 99, track: 2, at: [40.3] }];
	const plan = core.legacySafePlan(rows, nb);
	assert.deepEqual(plain(plan.map((p) => [p.id, p.op, p.why, p.startSec])), [
		[1, "update", "", 10], [2, "skip", "time", 20.4], [3, "skip", "new", 30], [4, "skip", "near", 40], [5, "update", "", 50]
	]);
	assert.deepEqual(plain(plan[0].params.map((p) => [p.index, p.value])), [[-1, "문장 바뀜"]]);
	assert.ok(plan[4].params.length > 1 && plan[4].params.every((p) => p.index === -1), "위험한 줄은 이름으로 전부");
	assert.equal(plan[0].track, 2);
});
