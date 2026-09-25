"use strict";
// S1-1 core: mi 블록, id 다시 매기기, 복원 뒤 nextId, sequenceKey GUID, 줄 라벨
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadRegions, plain } = require("../lib/loadRegions");

const core = loadRegions(["src/mi/core.ts"]);

const DEFAULT = { v: 1, salt: "", hwm: 0, legacyTrack: null, remapped: false, castOrder: [], cast: {}, stack: false, stackDy: 0.12, applied: {} };

test("miDefault·miHasData", () => {
	assert.deepEqual(plain(core.miDefault()), DEFAULT);
	assert.notEqual(core.miDefault(), core.miDefault(), "매번 새 객체");
	assert.equal(core.miHasData(core.miDefault()), false);
	assert.equal(core.miHasData(null), false);
	assert.equal(core.miHasData(Object.assign(core.miDefault(), { salt: "k7q2" })), true);
	assert.equal(core.miHasData(Object.assign(core.miDefault(), { cast: { C1: { name: "철수" } } })), true);
	assert.equal(core.miHasData(Object.assign(core.miDefault(), { hwm: 64 })), false, "hwm만으로는 쓰지 않는다");
});

test("miFromFile: salt·hwm·applied와 모르는 키를 그대로 두고 기본값만 채운다", () => {
	const file = {
		v: 1, salt: "k7q2", hwm: 64, castOrder: ["C1"],
		cast: { C1: { name: "철수", track: null, autoTrack: 2, presetId: "preset_3", color: 0 } },
		applied: { "k7q2-57": { g: 1, m: "C:/x.mogrt", ls: "5b1f0e2d", h: "a91f03c2", fh: { 0: "1c2d99e0" }, rh: "5d20e7aa", k: "ae" } },
		future: { x: 1 }
	};
	const mi = plain(core.miFromFile(file));
	assert.equal(mi.salt, "k7q2");
	assert.equal(mi.hwm, 64);
	assert.deepEqual(mi.applied, file.applied);
	assert.deepEqual(mi.cast, file.cast);
	assert.deepEqual(mi.future, { x: 1 });
	assert.equal(mi.legacyTrack, null);
	assert.equal(mi.stackDy, 0.12);
	assert.equal(mi.remapped, false);
	// 입력과 공유하지 않는다
	const live = core.miFromFile(file);
	live.cast.C1.name = "바뀜";
	assert.equal(file.cast.C1.name, "철수");
	// 형식이 틀린 값은 기본값
	const bad = plain(core.miFromFile({ salt: 5, hwm: -1, castOrder: "C1", cast: [], applied: null, stack: "yes", stackDy: "x", legacyTrack: "2", remapped: "true" }));
	assert.deepEqual(bad, DEFAULT);
	assert.deepEqual(plain(core.miFromFile(null)), DEFAULT);
	assert.deepEqual(plain(core.miFromFile([1, 2])), DEFAULT);
	// 두 번 돌려도 같다 (멱등)
	assert.deepEqual(plain(core.miFromFile(core.miFromFile(file))), mi);
});

test("miSnapshotOf·miRestoreFrom: 화자 표만 오가고 salt·hwm·applied는 현재 값", () => {
	const cur = core.miFromFile({ salt: "aaaa", hwm: 80, remapped: true, applied: { "aaaa-1": { g: 2 } }, castOrder: ["C1"], cast: { C1: { name: "현재" } } });
	const old = core.miFromFile({ salt: "zzzz", hwm: 10, applied: { "zzzz-1": { g: 1 } }, castOrder: ["C1", "C2"], cast: { C1: { name: "철수" }, C2: { name: "영희" } }, stack: true, stackDy: 0.2, legacyTrack: 2 });
	const snap = plain(core.miSnapshotOf(old));
	assert.deepEqual(Object.keys(snap).sort(), ["cast", "castOrder", "legacyTrack", "stack", "stackDy"]);
	const back = plain(core.miRestoreFrom(cur, snap));
	assert.deepEqual([back.salt, back.hwm, back.remapped, back.applied], ["aaaa", 80, true, { "aaaa-1": { g: 2 } }]);
	assert.deepEqual(back.castOrder, ["C1", "C2"]);
	assert.deepEqual(back.cast, { C1: { name: "철수" }, C2: { name: "영희" } });
	assert.deepEqual([back.stack, back.stackDy, back.legacyTrack], [true, 0.2, 2]);
	// 스냅숏이 없으면 현재 그대로 (히스토리 v27 항목)
	assert.deepEqual(plain(core.miRestoreFrom(cur, undefined)), plain(core.miFromFile(cur)));
	// 스냅숏을 바꿔도 복원 결과와 공유하지 않는다
	const r2 = core.miRestoreFrom(cur, snap);
	snap.cast.C1.name = "바뀜";
	assert.equal(r2.cast.C1.name, "철수");
});

test("safeNextId: max(복원 nextId, hwm+1, 현재 nextId, 최대 id+1)", () => {
	const data = { nextId: 5, subtitles: [{ id: 3 }, { id: 9 }], trashBin: [{ sub: { id: 12 } }] };
	assert.equal(core.safeNextId(data), 13);
	assert.equal(core.safeNextId(data, 64), 65);
	assert.equal(core.safeNextId(data, 0, 70), 70);
	assert.equal(core.safeNextId({ nextId: 30, subtitles: [], trashBin: [] }, 0), 30);
	assert.equal(core.safeNextId({}), 1);
	assert.equal(core.safeNextId(null, null, null), 1);
});

test("remapIds: 줄 id와 rowStates 키가 함께 바뀌고 휴지통도 새 id를 받는다", () => {
	const data = {
		subtitles: [{ id: 7, index: 1, text: "가" }, { id: 3, index: 2, text: "나" }],
		rowStates: { 7: { presetId: "preset_1", checked: true }, 3: { presetId: "", checked: false }, 99: { presetId: "orphan" } },
		trashBin: [{ sub: { id: 5, index: 3, text: "다" }, state: { presetId: "preset_3" }, position: 1 }, { sub: { id: 7, text: "중복" }, state: {}, position: 0 }],
		nextId: 10
	};
	const before = JSON.parse(JSON.stringify(data));
	const r = plain(core.remapIds(data, 65));
	assert.deepEqual(data, before, "입력은 바꾸지 않는다");
	assert.deepEqual(r.subtitles.map((s) => [s.id, s.text]), [[65, "가"], [66, "나"]]);
	assert.deepEqual(Object.keys(r.rowStates).sort(), ["65", "66"], "고아 rowState는 버린다");
	assert.deepEqual(r.rowStates[65], { presetId: "preset_1", checked: true });
	assert.deepEqual(r.rowStates[66], { presetId: "", checked: false });
	assert.deepEqual(r.trashBin.map((t) => [t.sub.id, t.sub.text, t.state.presetId]), [[67, "다", "preset_3"], [68, "중복", undefined]]);
	assert.equal(r.nextId, 69);
	assert.deepEqual(r.map, { 3: 66, 5: 67, 7: 65 });
	// 새 id끼리 겹치지 않는다
	const ids = r.subtitles.map((s) => s.id).concat(r.trashBin.map((t) => t.sub.id));
	assert.equal(new Set(ids).size, ids.length);
	assert.deepEqual(plain(core.remapIds({}, 0)), { subtitles: [], rowStates: {}, trashBin: [], nextId: 1, map: {} });
});

test("seqGuidOf: '_seq_' 뒤의 GUID, 이름 기반·기본 키는 null", () => {
	assert.equal(core.seqGuidOf("proj_8oybc8_seq_8c4e3131-84c9-4d4c-9f00-407a60135bcc"), "8c4e3131-84c9-4d4c-9f00-407a60135bcc");
	// Premiere 'Save As'로 projKey만 바뀐 경우 GUID는 같다
	assert.equal(core.seqGuidOf("proj_zzz_seq_8c4e3131-84c9-4d4c-9f00-407a60135bcc"), core.seqGuidOf("proj_8oybc8_seq_8c4e3131-84c9-4d4c-9f00-407a60135bcc"));
	assert.equal(core.seqGuidOf("proj_8oybc8_seq_name_1x2y"), null);
	assert.equal(core.seqGuidOf("default_seq"), null);
	assert.equal(core.seqGuidOf(""), null);
	assert.equal(core.seqGuidOf(undefined), null);
});

test("rowLabel: 단일 '#12', 다화자 'C2·12'", () => {
	assert.equal(core.rowLabel({ index: 12 }, false), "#12");
	assert.equal(core.rowLabel({ index: 12, spk: "C2" }, false), "#12");
	assert.equal(core.rowLabel({ index: 12, spk: "C2" }, true), "C2" + String.fromCharCode(0xb7) + "12");
	assert.equal(core.rowLabel({ index: 3 }, true), "#3");
	assert.equal(core.rowLabel(null, true), "");
});
