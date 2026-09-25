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
	// 타입이 틀린 파일(배열이 아닌 subtitles·trashBin)에서 던지지 않는다
	assert.equal(core.safeNextId({ nextId: 7, subtitles: {}, trashBin: {} }, 64), 65);
	assert.equal(core.safeNextId({ nextId: 7, subtitles: "x", trashBin: 3 }), 7);
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

// ── S1-5: cast.json 사이드카, 줄 주소, 명령 요약 ──

const castSide = () => ({ v: 1, savedAt: "2026-09-25T12:03:00Z", salt: "k7q2", hwm: 64, legacyTrack: 2, castOrder: ["C1", "C2"],
	cast: { C1: { name: "철수", track: null, presetId: "preset_3", color: 0 }, C2: { name: "영희", track: 3, presetId: "preset_6", color: 1 } }, stack: false, stackDy: 0.12 });

test("castSidecarOf: applied를 빼고 salt·hwm·화자 표를 싣는다", () => {
	const mi = core.miFromFile(Object.assign(castSide(), { applied: { "k7q2-1": { g: 1 } }, remapped: true }));
	const side = plain(core.castSidecarOf(mi));
	assert.deepEqual(Object.keys(side), ["v", "salt", "hwm", "legacyTrack", "castOrder", "cast", "stack", "stackDy"]);
	assert.equal(side.salt, "k7q2");
	assert.equal(side.hwm, 64);
	assert.deepEqual(side.cast, castSide().cast);
	side.cast.C1.name = "바뀜";
	assert.equal(mi.cast.C1.name, "철수", "사본");
});

test("castSidecarUsable: spk 줄이 있고 mi가 없고 모든 spk 줄 id ≤ hwm일 때만", () => {
	const sess = (ids, extra) => Object.assign({ subtitles: ids.map((id) => ({ id, index: id, spk: id > 0 ? "C1" : undefined })), rowStates: {}, trashBin: [], nextId: 99 }, extra || {});
	assert.equal(core.castSidecarUsable(sess([1, 64]), castSide()), true);
	assert.equal(core.castSidecarUsable(sess([1, 65]), castSide()), false, "spk 줄 id > hwm → 낡은 사이드카");
	assert.equal(core.castSidecarUsable(sess([1, 2], { mi: { salt: "zzzz" } }), castSide()), false, "session에 mi가 있으면 쓰지 않는다");
	assert.equal(core.castSidecarUsable({ subtitles: [{ id: 1, index: 1 }] }, castSide()), false, "spk 줄이 없다");
	assert.equal(core.castSidecarUsable(sess([1]), null), false);
	assert.equal(core.castSidecarUsable(sess([1]), Object.assign(castSide(), { hwm: "x" })), false);
	// spk 없는 줄의 id는 hwm을 넘어도 된다 (v27이 SRT를 다시 열었다면 spk 줄 자체가 없다)
	const mixed = { subtitles: [{ id: 3, spk: "C1" }, { id: 500 }] };
	assert.equal(core.castSidecarUsable(mixed, castSide()), true);
});

test("miFromCast: savedAt을 버리고 applied는 비우고 remapped는 false", () => {
	const mi = plain(core.miFromCast(Object.assign(castSide(), { applied: { x: 1 }, remapped: true })));
	assert.equal(mi.savedAt, undefined);
	assert.deepEqual(mi.applied, {});
	assert.equal(mi.remapped, false);
	assert.deepEqual([mi.salt, mi.hwm, mi.legacyTrack, mi.castOrder], ["k7q2", 64, 2, ["C1", "C2"]]);
});

test("parseRowLabel·findRowsByLabel", () => {
	const dot = String.fromCharCode(0xb7);
	assert.deepEqual(plain(core.parseRowLabel("#12")), { spk: null, index: 12, fid: null });
	assert.deepEqual(plain(core.parseRowLabel(" 12 ")), { spk: null, index: 12, fid: null });
	assert.deepEqual(plain(core.parseRowLabel("#12 T2")), { spk: null, index: 12, fid: "T2" });
	assert.deepEqual(plain(core.parseRowLabel("C2" + dot + "12")), { spk: "C2", index: 12, fid: null });
	assert.deepEqual(plain(core.parseRowLabel("c02 - 12 t3")), { spk: "C2", index: 12, fid: "T3" });
	assert.deepEqual(plain(core.parseRowLabel("C12.7")), { spk: "C12", index: 7, fid: null });
	for (const bad of ["", "#", "T2", "#12T2", "C0·1", "C2", "abc", null, undefined]) assert.equal(core.parseRowLabel(bad), null, String(bad));
	const subs = [{ id: 1, index: 12, spk: "C1" }, { id: 2, index: 12, spk: "C2" }, { id: 3, index: 13 }];
	assert.deepEqual(core.findRowsByLabel(subs, core.parseRowLabel("#12")).map((s) => s.id), [1, 2], "화자 없이 쓰면 여럿");
	assert.deepEqual(core.findRowsByLabel(subs, core.parseRowLabel("C2" + dot + "12")).map((s) => s.id), [2]);
	assert.deepEqual(core.findRowsByLabel(subs, core.parseRowLabel("#13")).map((s) => s.id), [3]);
	assert.deepEqual(plain(core.findRowsByLabel(subs, null)), []);
});

test("rowSummary: uid·label·T-ID 필드 값(프리셋 기준 해석), rs.params로는 매기지 않는다", () => {
	const { build } = require("../fixtures/presets_synth");
	const { presets, STALE_1: stale1 } = build();
	const p1 = presets.preset_1;
	const all = JSON.parse(JSON.stringify(p1.params));
	all[4].value = "캡션 문장";
	all[6].value = "문장";
	const sub = { id: 57, index: 12, startSec: 1.5, endSec: 3, text: "캡션 문장", spk: "C2" };
	const rs = { presetId: "preset_1", params: [all[4]], _allParams: all, open: false, checked: false, warn: [{ fid: "T2", missing: ["x"], dup: [] }] };
	const r = plain(core.rowSummary(sub, rs, p1, "k7q2", true));
	assert.equal(r.uid, "k7q2-57");
	assert.equal(r.label, "C2" + String.fromCharCode(0xb7) + "12");
	assert.deepEqual([r.id, r.index, r.spk, r.s, r.e, r.presetId, r.captionFid], [57, 12, "C2", 1.5, 3, "preset_1", "T1"]);
	assert.deepEqual(r.fields, { T1: "캡션 문장", T2: "문장", T3: "" });
	assert.equal(r.sig, "T1=전체 텍스트|T2=포인트 텍스트|T3=서브 포인트 텍스트");
	assert.deepEqual(r.warn, rs.warn);
	// 단일 화자: uid는 id, label "#12"
	const single = plain(core.rowSummary({ id: 5, index: 3, text: "가" }, { presetId: "", params: [], _allParams: [] }, null, "", false));
	assert.deepEqual([single.uid, single.label, single.spk, single.sig, single.captionFid, single.fields], ["5", "#3", null, "", null, {}]);
	// 옛 8속성 줄: T1이 idx0 '전체 텍스트'
	assert.ok(stale1 && stale1.length === 8, "옛 구조 픽스처");
	const r8 = plain(core.rowSummary({ id: 9, index: 1, text: "x" }, { presetId: "preset_1", params: [], _allParams: stale1 }, p1, "", false));
	assert.deepEqual(Object.keys(r8.fields), ["T1", "T2", "T3"]);
	assert.equal(r8.fields.T1, stale1[0].value);
	// 노출 속성만 있고 _allParams가 비면 ID를 매기지 않는다
	const onlyParams = plain(core.rowSummary(sub, { presetId: "preset_1", params: [all[6]], _allParams: [] }, p1, "", false));
	assert.deepEqual(onlyParams.fields, {});
});

test("presetSummary: T-ID·캡션·서명·규칙 문구, 네이티브 순서 확인", () => {
	const { build } = require("../fixtures/presets_synth");
	const { presets } = build();
	const s3 = plain(core.presetSummary(presets.preset_3));
	assert.equal(s3.captionFid, "T1");
	assert.deepEqual(s3.fields.map((f) => [f.fid, f.caption]), [["T1", true], ["T2", false]]);
	assert.equal(s3.native, false);
	assert.equal(s3.orderVerified, true);
	assert.ok(s3.notes.some((n) => /최대 3개/.test(n)), JSON.stringify(s3.notes));
	const s8 = plain(core.presetSummary(presets.preset_8));
	assert.equal(s8.captionFid, null);
	assert.equal(s8.fields.length, 5);
	const s4 = plain(core.presetSummary(presets.preset_4));
	assert.deepEqual([s4.fields, s4.sig, s4.captionFid], [[], "", null]);
	const nat = (names) => ({ id: "preset_9", name: "n", textParamIndex: 0, params: names.map((n, i) => ({ index: i, displayName: n, type: "text", value: "", rawValue: "", nativeText: true })) });
	assert.equal(core.presetSummary(nat(["텍스트 1", "텍스트 2"])).orderVerified, false, "일반 라벨 = 순서 미확인");
	assert.equal(core.presetSummary(nat(["Insert Name Here", "ADD TITLE HERE"])).orderVerified, true);
	assert.equal(core.presetSummary(nat(["텍스트 1"])).native, true);
});

test("regionTextOf: loadRegions.regionHash와 같은 본문 (coreHash)", () => {
	const fs = require("node:fs");
	const L = require("../lib/loadRegions");
	const src = fs.readFileSync(L.APP_JS, "utf8");
	assert.equal(core.fnv1a32(core.regionTextOf(src, "src/mi/core.ts")), L.regionHash("src/mi/core.ts"));
	assert.equal(core.regionTextOf(src.replace(/\n/g, "\r\n"), "src/mi/core.ts"), L.sliceRegion("src/mi/core.ts", src.replace(/\r\n/g, "\n")).text, "CRLF도 같다");
	assert.equal(core.regionTextOf(src, "없는/region"), null);
	assert.equal(core.regionTextOf("a\n\t//#region x\nb\n\t//#region y\nc\n\t//#endregion\nd\n\t//#endregion\ne", "x"), "b\n\t//#region y\nc\n\t//#endregion\nd");
});
