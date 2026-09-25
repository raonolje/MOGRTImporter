"use strict";
// S2-5: core 되돌리기·레거시 안전 경로 — undoChains(key마다 작업 전·뒤), buildUndoOps(가드 6범주: nodeId + gen + 텍스트 해시,
// 네이티브는 텍스트 없이, 옛 템플릿 되놓기, 이미 되돌린 것 건너뛰기, 자리 흉내), legacyMiPlan(문장만 → update, 시간 → move,
// 없음 → place + 이웃 보호, 모호·확인 필요, 네이티브 빼기), legacyClipOwners, repairOps, undoRetag, laUndoable, fitWindow.
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadRegions, plain } = require("../lib/loadRegions");

const C = loadRegions(["src/mi/core.ts"]);
const TPS = 254016000000;
const FT = 10594584000; // 23.976
const SALT = "ab12";
const sec = (f) => (f * FT) / TPS;
const M = "C:/m/a.mogrt";
const M_OLD = "C:/m/old.mogrt";

function textRaw(t) {
	return JSON.stringify({ fontEditValue: ["X"], fontTextRunLength: [String(t).length], textEditValue: String(t) });
}
const T = (index, displayName, value) => ({ index, type: "text", displayName, value, rawValue: textRaw(value) });
const COL = (index, displayName, v) => ({ index, type: "color", displayName, value: String(v), rawValue: String(v) });
const tag = (id, g) => "철수 [MI:" + SALT + "-" + id + "." + g + "]";
function scanOf(tracks) {
	return { ok: true, frameTicks: String(FT), numVideoTracks: 6, tracks: Object.keys(tracks).map((i) => ({ i: Number(i), locked: false, clips: tracks[i] })) };
}
const clip = (sf, ef, nodeId, name) => ({ sf, ef, nodeId, name: name || "" });
const det = (texts, kind) => ({ found: true, kind: kind || "ae", texts });
const P0 = [T(0, "텍스트", "처음 문장"), T(1, "포인트 텍스트", ""), COL(2, "색", 4294901760)];
const la0 = (extra) => Object.assign({ v: 1, runId: "r1", ts: 1, seqId: "seq-1", salt: SALT, complete: true, rows: 5, superseded: false,
	created: [], updated: [], moved: [], adopted: [], replaced: [], removed: [], prev: {} }, extra || {});

test("undoRetag·laUndoable·isUidKey", () => {
	assert.equal(C.undoRetag(tag(5, 1), SALT + "-5", 3), tag(5, 3));
	assert.equal(C.undoRetag(tag(5, 1), SALT + "-6", 3), tag(5, 1), "다른 uid는 그대로");
	assert.equal(C.undoRetag("[라온올제] 합성 자막", "r5", 0), "[라온올제] 합성 자막");
	const la = la0({ created: [{ key: SALT + "-1", g: 1, track: 2, sf: 10, nodeId: "n1", rh: "x" }] });
	assert.equal(C.laUndoable(la, "seq-1"), true);
	assert.equal(C.laUndoable(la, "seq-2"), false, "다른 시퀀스");
	assert.equal(C.laUndoable(Object.assign({}, la, { superseded: true }), "seq-1"), false, "v27 ▶가 덮었다");
	assert.equal(C.laUndoable(Object.assign({}, la, { undone: { complete: true } }), "seq-1"), false, "이미 되돌렸다");
	assert.equal(C.laUndoable(Object.assign({}, la, { undone: { complete: false } }), "seq-1"), true, "멈춘 되돌리기는 이어서");
	assert.equal(C.laUndoable(la0(), "seq-1"), false, "항목 없음");
	assert.deepEqual([C.isUidKey(SALT + "-12"), C.isUidKey("r12"), C.isUidKey("fix:00f1")], [true, false, false]);
});

test("undoChains: key마다 기록 순서로 묶는다 — 첫 항목의 작업 전(origin), 마지막 클립(final), 순환 먼저 지우기는 묶고 옛 gen·목록 밖 제거는 따로", () => {
	const la = la0({
		created: [{ key: SALT + "-1", g: 1, track: 2, sf: 10, nodeId: "n1", rh: "h1", n: 1 }, { key: SALT + "-2", g: 2, track: 2, sf: 400, nodeId: "n9", rh: "h9", n: 5 }],
		updated: [{ key: SALT + "-2", g: 1, track: 2, sf: 300, nodeId: "n2", rh: "h2", n: 2, before: P0, from: { track: 2, sf: 300, ef: 360, name: tag(2, 1) }, m: M }],
		removed: [
			{ key: SALT + "-3", g: 1, track: 2, sf: 500, ef: 560, name: tag(3, 1), nodeId: "n3", why: "cycle", n: 0, m: M, params: P0 },
			{ key: SALT + "-4", g: 1, track: 3, sf: 700, ef: 760, name: tag(4, 1), nodeId: "n4", why: "stale", n: 3, m: M, params: P0 }
		],
		moved: [{ key: SALT + "-3", g: 2, track: 2, sf: 520, nodeId: "n5", rh: "h5", n: 4, op: "place" }]
	});
	const r = plain(C.undoChains(la));
	assert.deepEqual(r.chains.map((c) => [c.key, c.cats.join(","), c.origin ? c.origin.nodeId : null, c.final ? c.final.nodeId : null]), [
		[SALT + "-3", "removed,moved", "n3", "n5"],
		[SALT + "-1", "created", null, "n1"],
		[SALT + "-2", "updated,created", "n2", "n9"]
	]);
	assert.deepEqual(r.chains[2].origin, { nodeId: "n2", track: 2, sf: 300, ef: 360, g: null, name: tag(2, 1), kind: "", m: M, pi: null, params: P0 });
	assert.deepEqual(r.lone.map((e) => e.nodeId), ["n4"]);
});

test("buildUndoOps: created → 지움, updated → 작업 전 속성 전부·이름·끝으로 update, 확인이 먼저 (되읽기)", () => {
	const la = la0({
		created: [{ key: SALT + "-1", g: 1, track: 2, sf: 100, nodeId: "n1", rh: C.textsHash(["새 줄", ""]), n: 0, k: "ae", m: M }],
		updated: [{ key: SALT + "-2", g: 1, track: 2, sf: 300, nodeId: "n2", rh: C.textsHash(["바뀐 문장", ""]), n: 1, k: "ae", m: M, before: P0, from: { track: 2, sf: 300, ef: 360, name: "영희 [MI:ab12-2.1]" } }]
	});
	const scan = scanOf({ 2: [clip(100, 160, "n1", tag(1, 1)), clip(300, 380, "n2", tag(2, 1))] });
	let p = plain(C.buildUndoOps({ la, scan, details: {}, durs: {}, repairM: {} }));
	assert.deepEqual(p.needReads.map((x) => x.nodeId), ["n1", "n2"], "먼저 텍스트를 읽는다");
	assert.deepEqual([p.ops.length, p.removals.length], [0, 0]);
	p = plain(C.buildUndoOps({ la, scan, details: { n1: det(["새 줄", ""]), n2: det(["바뀐 문장", ""]) }, durs: {}, repairM: {} }));
	assert.deepEqual(p.skipped, []);
	assert.deepEqual(p.removals.map((x) => [x.key, x.track, x.nodeId, x.expectName, x.why]), [[SALT + "-1", 2, "n1", tag(1, 1), "undo"]]);
	assert.equal(p.ops.length, 1);
	const u = p.ops[0];
	assert.deepEqual([u.op, u.key, u.track, u.sf, u.ef, u.keepTime, u.name], ["update", SALT + "-2", 2, 300, 360, false, "영희 [MI:ab12-2.1]"], "끝(380 → 360)·이름도 되돌린다");
	assert.deepEqual(u.own, { track: 2, sf: 300, nodeId: "n2" });
	assert.deepEqual(u.params, P0, "작업 전 ParamDef 전부 (색은 raw)");
	assert.deepEqual(p.acts, { [SALT + "-1"]: "remove", [SALT + "-2"]: "restore" });
	const item = plain(C.hostItemOf(u, {}));
	assert.deepEqual([item.key, item.op, item.keepTime, item.mogrtPath, item.name], [SALT + "-2", "update", false, M, "영희 [MI:ab12-2.1]"]);
});

test("buildUndoOps 가드: 클립 없음·태그 gen이 다름·문장을 고침 → '그 뒤로 바뀜'으로 건너뛴다. 네이티브는 텍스트를 보지 않는다 (늘 ''), 종류가 바뀌면 건너뛴다", () => {
	const rh = C.textsHash(["문장", ""]);
	const la = la0({
		created: [
			{ key: SALT + "-1", g: 1, track: 2, sf: 100, nodeId: "n1", rh, n: 0, k: "ae", m: M },
			{ key: SALT + "-2", g: 1, track: 2, sf: 300, nodeId: "n2", rh, n: 1, k: "ae", m: M },
			{ key: SALT + "-3", g: 1, track: 2, sf: 500, nodeId: "n3", rh, n: 2, k: "ae", m: M },
			{ key: SALT + "-4", g: 1, track: 2, sf: 700, nodeId: "n4", rh: C.textsHash(["", ""]), n: 3, k: "native", m: "C:/cache/baked/aa.mogrt" },
			{ key: SALT + "-5", g: 1, track: 2, sf: 900, nodeId: "n5", rh, n: 4, k: "ae", m: M }
		]
	});
	const scan = scanOf({ 2: [clip(300, 360, "n2", tag(2, 2)), clip(500, 560, "n3", tag(3, 1)), clip(700, 760, "n4", "영희 [MI:ab12-4.1]"), clip(900, 960, "n5", tag(5, 1))] });
	const p = plain(C.buildUndoOps({ la, scan, details: { n3: det(["문장 (Premiere에서 고침)", ""]), n4: det(["", ""], "native"), n5: det(["", ""], "native") }, durs: {}, repairM: {} }));
	assert.deepEqual(p.skipped.map((s) => [s.key, s.why]), [[SALT + "-1", "gone"], [SALT + "-2", "renamed"], [SALT + "-3", "edited"], [SALT + "-5", "kind"]]);
	assert.deepEqual(p.removals.map((x) => x.nodeId), ["n4"], "네이티브는 nodeId·gen·종류로 확인하고 지운다 (텍스트 해시는 보지 않는다)");
	// 레거시 기록(key r<id>)은 태그가 없어야 한다
	const lg = la0({ legacy: true, salt: "", created: [{ key: "r7", g: 0, track: 2, sf: 100, nodeId: "m1", rh, n: 0, k: "ae", m: M }, { key: "r8", g: 0, track: 2, sf: 300, nodeId: "m2", rh, n: 1, k: "ae", m: M }] });
	const q = plain(C.buildUndoOps({ la: lg, scan: scanOf({ 2: [clip(100, 160, "m1", "[라온올제] 합성 자막"), clip(300, 360, "m2", tag(8, 1))] }), details: { m1: det(["문장", ""]), m2: det(["문장", ""]) }, durs: {}, repairM: {} }));
	assert.deepEqual(q.removals.map((x) => [x.key, x.nodeId]), [["r7", "m1"]]);
	assert.deepEqual(q.skipped.map((s) => [s.key, s.why]), [["r8", "renamed"]]);
});

test("buildUndoOps: 같은 트랙 TrackItem.move → move로 되돌림(nodeId 그대로), 다른 트랙 moveRegen → 옛 자리에 되놓고(gen+1) 지금 클립 지움, replace → 옛 템플릿(m)으로", () => {
	const rh = C.textsHash(["문장", ""]);
	const snap = (nodeId, track, sf, ef, name, m) => ({ nodeId, track, sf, ef, g: 1, name, kind: "ae", m, pi: "pi0", params: P0 });
	const la = la0({
		moved: [
			{ key: SALT + "-1", g: 1, track: 2, sf: 130, nodeId: "n1", rh, n: 0, k: "ae", m: M, op: "move", from: snap("n1", 2, 100, 160, tag(1, 1), null) },
			{ key: SALT + "-2", g: 2, track: 4, sf: 300, nodeId: "n9", rh, n: 1, k: "ae", m: M, op: "moveRegen", from: snap("n2", 3, 300, 360, tag(2, 1), M) }
		],
		replaced: [{ key: SALT + "-3", g: 2, track: 2, sf: 500, nodeId: "n8", rh, n: 2, k: "ae", m: M, from: snap("n3", 2, 500, 560, tag(3, 1), M_OLD) }]
	});
	const scan = scanOf({ 2: [clip(130, 190, "n1", tag(1, 1)), clip(500, 560, "n8", tag(3, 2))], 3: [], 4: [clip(300, 360, "n9", tag(2, 2))] });
	const d = { n1: det(["문장", ""]), n8: det(["문장", ""]), n9: det(["문장", ""]) };
	const p = plain(C.buildUndoOps({ la, scan, details: d, durs: { "c:/m/old.mogrt": 5.005, "c:/m/a.mogrt": 5.005 }, repairM: {} }));
	assert.deepEqual(p.skipped, []);
	const by = {};
	p.ops.forEach((o) => { by[o.key] = o; });
	assert.deepEqual([by[SALT + "-1"].op, by[SALT + "-1"].track, by[SALT + "-1"].sf, by[SALT + "-1"].ef, by[SALT + "-1"].own.nodeId, by[SALT + "-1"].name], ["move", 2, 100, 160, "n1", null]);
	assert.deepEqual(by[SALT + "-1"].params, P0);
	const r2 = by[SALT + "-2"];
	assert.deepEqual([r2.op, r2.track, r2.sf, r2.ef, r2.g, r2.name, r2.m, r2.own.nodeId, r2.own.track], ["moveRegen", 3, 300, 360, 3, tag(2, 3), M, "n9", 4], "gen 올림 (지금 클립이 남아도 옛 gen)");
	const r3 = by[SALT + "-3"];
	assert.deepEqual([r3.op, r3.track, r3.sf, r3.g, r3.name, r3.m, r3.own.m], ["replace", 2, 500, 3, tag(3, 3), M_OLD, M], "옛 템플릿으로, 실패하면 지금 템플릿(own.m)을 되놓는다");
	assert.deepEqual(p.acts, { [SALT + "-1"]: "move", [SALT + "-2"]: "replace", [SALT + "-3"]: "replace" });
	// 옛 템플릿 경로를 모르면 건너뛴다
	const la2 = la0({ replaced: [{ key: SALT + "-3", g: 2, track: 2, sf: 500, nodeId: "n8", rh, n: 0, k: "ae", m: M, from: snap("n3", 2, 500, 560, tag(3, 1), null) }] });
	const q = plain(C.buildUndoOps({ la: la2, scan, details: d, durs: {}, repairM: {} }));
	assert.deepEqual(q.skipped.map((s) => [s.key, s.why]), [[SALT + "-3", "template-unknown"]]);
});

test("buildUndoOps: adopted → 원래 이름(태그 없음)·속성, 지운 클립(목록 밖·옛 gen) → 되놓기 (자리가 비어야 한다), 이미 되돌린 key는 건너뛴다", () => {
	const rh = C.textsHash(["문장", ""]);
	const la = la0({
		adopted: [{ key: SALT + "-1", g: 1, track: 2, sf: 100, nodeId: "n1", rh, n: 0, k: "ae", m: M, from: { name: "[라온올제] 합성 자막", params: P0, track: 2, sf: 100, ef: 170 } }],
		removed: [
			{ key: SALT + "-9", g: 1, track: 2, sf: 400, ef: 460, name: tag(9, 1), kind: "ae", nodeId: "n9", why: "orphan", n: 1, m: M, params: P0, pa: { g: 1, m: M } },
			{ key: SALT + "-8", g: 1, track: 2, sf: 600, ef: 660, name: tag(8, 1), kind: "ae", nodeId: "n7", why: "stale", n: 2, m: M, params: P0 }
		]
	});
	// 옛 gen 자리(600)에는 남의 클립이 있다 → 막힘
	const scan = scanOf({ 2: [clip(100, 160, "n1", tag(1, 1)), clip(610, 700, "x1", "남의 클립")] });
	const p = plain(C.buildUndoOps({ la, scan, details: { n1: det(["문장", ""]) }, durs: { "c:/m/a.mogrt": 1 }, repairM: {} }));
	const ad = p.ops.find((o) => o.key === SALT + "-1");
	assert.deepEqual([ad.op, ad.name, ad.ef, ad.keepTime], ["update", "[라온올제] 합성 자막", 170, false]);
	const un = p.ops.find((o) => o.key === SALT + "-9");
	assert.deepEqual([un.op, un.uid, un.track, un.sf, un.ef, un.name, un.undo, un.entry.why], ["place", SALT + "-9#1", 2, 400, 460, tag(9, 1), "unremove", "orphan"]);
	assert.deepEqual(p.skipped.map((s) => [s.key, s.why]), [[SALT + "-8", "occupied"]]);
	// 이미 되돌린 것
	const q = plain(C.buildUndoOps({ la, scan, details: { n1: det(["문장", ""]) }, durs: {}, repairM: {}, skipKeys: { [SALT + "-1"]: "restore", [SALT + "-9#1"]: "unremove" } }));
	assert.deepEqual(q.ops.map((o) => o.key), [], "옛 gen은 여전히 막힘, 나머지는 이미 했다");
	assert.deepEqual(q.skipped.map((s) => s.key), [SALT + "-8"]);
});

test("buildUndoOps 자리 흉내: 되놓는 템플릿 길이 안의 보호할 수 있는 이웃(repairM)은 guard, 모르는 클립은 tail로 건너뛴다", () => {
	const rh = C.textsHash(["문장", ""]);
	const la = la0({ removed: [{ key: SALT + "-9", g: 1, track: 2, sf: 100, ef: 150, name: tag(9, 1), kind: "ae", nodeId: "n9", why: "orphan", n: 0, m: M, params: P0 }] });
	const D = 120;
	const scan = scanOf({ 2: [clip(160, 200, "o1", tag(1, 1)), clip(300, 340, "o2", "[v27] 합성")] });
	let p = plain(C.buildUndoOps({ la, scan, details: {}, durs: { "c:/m/a.mogrt": 5.005 }, repairM: { o1: M } }));
	assert.equal(D, Math.round((5.005 * TPS) / FT));
	assert.deepEqual(p.ops.map((o) => [o.key, o.guard]), [[SALT + "-9", ["o1"]]], "220f 안의 o1만 (o2는 창 밖)");
	const scan2 = scanOf({ 2: [clip(160, 200, "o1", tag(1, 1)), clip(210, 240, "o3", "남의 클립")] });
	p = plain(C.buildUndoOps({ la, scan: scan2, details: {}, durs: { "c:/m/a.mogrt": 5.005 }, repairM: { o1: M } }));
	assert.deepEqual(p.ops, []);
	assert.equal(p.skipped[0].why, "tail");
	assert.match(p.skipped[0].detail, /^V3 .+ 남의 클립 \(템플릿 길이 5\.0초 안\)$/);
	void rh;
});

test("legacyClipOwners·repairOps: 줄 자리의 태그 없는 클립 → 주인 줄·템플릿, 망가진 이웃은 있으면 replace·없으면 place", () => {
	const scan = scanOf({ 2: [clip(24, 72, "a", "[v27]"), clip(96, 144, "b", tag(1, 1)), clip(200, 240, "c", "[v27]")] });
	const own = plain(C.legacyClipOwners(scan, [{ id: 1, track: null, at: [sec(24)], m: M }, { id: 2, track: 3, at: [sec(200)], m: M }, { id: 3, track: 2, at: [sec(96)], m: M }], FT));
	assert.deepEqual(own, { a: { id: 1, m: M } }, "태그 클립은 빼고, 트랙이 다른 줄은 빼고");
	const snaps = [{ nodeId: "c", track: 2, sf: 200, ef: 240, name: "[v27]", params: P0, m: M, durSec: 1 }, { nodeId: "z", track: 2, sf: 300, ef: 340, name: tag(4, 2), params: P0, m: M, durSec: 1 }];
	const rp = plain(C.repairOps(snaps, scan, {}, FT));
	assert.deepEqual(rp.ops.map((o) => [o.op, o.uid, o.sf, o.ef, o.g, o.own ? o.own.nodeId : null, o.name]), [["replace", "fix:c", 200, 240, 0, "c", "[v27]"], ["place", "fix:z", 300, 340, 2, null, tag(4, 2)]]);
});

// ── 레거시 안전 경로 계획 ──
const PRESET = { id: "preset_1", name: "p1", mogrtPath: M, textParamIndex: 0, params: [T(0, "전체 텍스트", "기본"), T(1, "포인트 텍스트", ""), COL(2, "박스 색상", 4294967295)], exposedIndices: [0, 1], mogrtDurSec: 5.005 };
function lrow(id, s, e, text, rs) {
	const all = JSON.parse(JSON.stringify(PRESET.params));
	all[0].value = text;
	all[0].rawValue = textRaw(text);
	const sub = { id, index: id, startSec: s, endSec: e, text };
	return { sub, rs: Object.assign({ presetId: "preset_1", params: all.slice(0, 2), _allParams: all }, rs || {}), preset: PRESET, unsafe: false, track: 2 };
}
const lplan = (rows, scan, details, o) => plain(C.legacyMiPlan({ rows, scan, details: details || {}, durs: {}, owners: (o && o.owners) || {}, opts: (o && o.opts) || {} }));

test("legacyMiPlan: 문장만 바뀜 → 캡션 속성 하나로 update(keepTime, 이름 null), 시간이 바뀜 → move, 없음 → place(속성 전부), 되읽기가 먼저", () => {
	const f = (s) => Math.round((s * TPS) / FT);
	const rows = [
		lrow(1, 4, 6, "둘째 고침", { mm: "text", mmPrev: { s: 4, e: 6, cap: "둘째" } }),
		lrow(2, 7.4, 9.4, "셋째", { mm: "time", mmPrev: { s: 7, e: 9, cap: "셋째" } }),
		lrow(3, 19, 20, "새 줄", { mm: "new" })
	];
	const scan = scanOf({ 2: [clip(f(4), f(6), "c2", "[v27]"), clip(f(7), f(9), "c3", "[v27]"), clip(f(10), f(12), "c4", "[v27]")] });
	let p = lplan(rows, scan);
	assert.deepEqual(p.needReads.map((x) => x.nodeId), ["c2", "c3"]);
	assert.deepEqual(p.ops, []);
	p = lplan(rows, scan, { c2: det(["둘째", ""]), c3: det(["셋째", ""]) });
	assert.deepEqual(p.uncertain, []);
	const by = {};
	p.ops.forEach((o) => { by[o.id] = o; });
	assert.deepEqual([by[1].op, by[1].key, by[1].g, by[1].keepTime, by[1].name, by[1].own.nodeId], ["update", "r1", 0, true, null, "c2"]);
	assert.deepEqual(by[1].params.map((x) => [x.index, x.displayName, x.value]), [[0, "전체 텍스트", "둘째 고침"]], "캡션 하나 (호스트가 이름으로 확인)");
	assert.deepEqual([by[2].op, by[2].sf, by[2].ef, by[2].own.nodeId, by[2].params.length], ["move", f(7.4), f(9.4), "c3", 0], "시간만: 옮기기만");
	assert.deepEqual([by[3].op, by[3].sf, by[3].ef, by[3].own, by[3].params.length, by[3].m, by[3].name], ["place", f(19), f(20), null, 3, M, null]);
	// 이웃 보호: 새 줄 [19, 20)의 템플릿 길이(5초) 안에 레거시 줄의 클립이 있으면 guard, 모르는 클립이면 tail
	const scan2 = scanOf({ 2: [clip(f(4), f(6), "c2", "[v27]"), clip(f(7), f(9), "c3", "[v27]"), clip(f(21), f(23), "c9", "[v27]")] });
	const d2 = { c2: det(["둘째", ""]), c3: det(["셋째", ""]) };
	p = lplan(rows, scan2, d2, { owners: { c9: { id: 9, m: M } } });
	assert.deepEqual(p.ops.find((o) => o.id === 3).guard, ["c9"]);
	p = lplan(rows, scan2, d2);
	assert.deepEqual([p.rowOps[3].skip, p.rowOps[3].why], ["conflict", "tail"]);
});

test("legacyMiPlan: 위험한 줄·되돌린 줄·↑(full)은 속성 전부, 같은 자리 문장이 다른 한 클립 → uncertain (고르면 갱신), 여럿이면 ambiguous, 네이티브·프리셋 없음은 빼고, 클립 하나는 한 줄만", () => {
	const f = (s) => Math.round((s * TPS) / FT);
	const scan = scanOf({ 2: [clip(f(1), f(3), "a", "[v27]"), clip(f(4), f(6), "b", "[v27]")] });
	const d = { a: det(["첫째", ""]), b: det(["전혀 다른 문장", ""]) };
	const r1 = lrow(1, 1, 3, "첫째", { mm: "undone" });
	const r2 = lrow(2, 4, 6, "둘째", { mm: "text", mmPrev: { s: 4, e: 6, cap: "둘째 옛" } });
	let p = lplan([r1, r2], scan, d);
	assert.equal(p.ops.find((o) => o.id === 1).params.length, 3, "되돌린 줄은 전부");
	assert.deepEqual(p.uncertain, [2]);
	assert.equal(p.rowOps[2].skip, "uncertain");
	p = lplan([r1, r2], scan, d, { opts: { uncertain: true } });
	assert.deepEqual(p.ops.find((o) => o.id === 2).own.nodeId, "b");
	p = lplan([Object.assign({}, r2, { unsafe: true })], scan, { a: d.a, b: det(["둘째 옛", ""]) });
	assert.equal(p.ops[0].params.length, 3, "위험한 줄은 전부");
	p = lplan([r2], scan, { a: d.a, b: det(["둘째 옛", ""]) }, { opts: { full: true } });
	assert.equal(p.ops[0].params.length, 3, "↑는 전부");
	// 네이티브·프리셋 없음
	const nat = lrow(3, 1, 3, "첫째", { ap: { s: 1, e: 3, cap: "첫째", ps: "x", t: 2, nk: "k" } });
	const none = Object.assign(lrow(4, 1, 3, "첫째"), { preset: null });
	p = lplan([nat, none], scan, d);
	assert.deepEqual([p.rowOps[3].skip, p.rowOps[4].skip], ["native", "no-preset"]);
	// 두 줄이 한 클립을 가리키면 먼저 온 줄만
	const twin = lrow(5, 1, 3, "첫째", { mm: "text" });
	p = lplan([lrow(1, 1, 3, "첫째", { mm: "text", ap: { s: 1, e: 3, cap: "첫째 옛", ps: "x", t: 2 } }), twin], scan, { a: det(["첫째 옛", ""]), b: d.b });
	assert.equal(p.ops.filter((o) => o.own && o.own.nodeId === "a").length, 1);
	assert.deepEqual([p.rowOps[5].skip, p.rowOps[5].why], ["conflict", "occupied-own"], "다른 줄은 클립이 없는 것으로 보고 놓으려 하지만 그 자리는 앞 줄의 클립");
});

test("fitWindow: 시작을 덮으면 occupied(-own), 안쪽 이웃은 끝 맞춤·guard, 뒤쪽 남의 클립은 tail", () => {
	const L = [{ id: "a", sf: 90, ef: 110, own: true }, { id: "b", sf: 130, ef: 140, own: true }, { id: "c", sf: 170, ef: 180, own: false }];
	assert.deepEqual(plain(C.fitWindow(L, 100, 150, 0, {})), { conflict: "occupied-own", clip: L[0] });
	assert.deepEqual(plain(C.fitWindow(L, 100, 150, 0, { a: true })), { conflict: null, ef: 130, clamped: true, guard: ["b"] });
	assert.equal(C.fitWindow(L, 100, 120, 80, { a: true }).conflict, "tail");
	assert.deepEqual(plain(C.fitWindow(L, 100, 120, 60, { a: true })), { conflict: null, ef: 120, clamped: false, guard: ["b"] });
});

test("buildUndoOps: 첫 기록이 이웃 복구(fix)인 key는 그대로 둔다 (kept) — 뒤에 다른 기록이 있어도 실행 전 모습을 모른다", () => {
	const rh = C.textsHash(["문장", ""]);
	const la = la0({ created: [{ key: SALT + "-2", g: 2, track: 2, sf: 130, nodeId: "n2", rh, n: 3, k: "ae", m: M, fix: true }, { key: SALT + "-5", g: 1, track: 2, sf: 300, nodeId: "n5", rh, n: 4, k: "ae", m: M }] });
	const scan = scanOf({ 2: [clip(130, 140, "n2", tag(2, 2)), clip(300, 360, "n5", tag(5, 1))] });
	const p = plain(C.buildUndoOps({ la, scan, details: { n2: det(["문장", ""]), n5: det(["문장", ""]) }, durs: {}, repairM: {} }));
	assert.deepEqual(p.kept, [SALT + "-2"]);
	assert.deepEqual(p.removals.map((x) => x.key), [SALT + "-5"]);
	assert.equal(C.undoChains(la).chains[0].fix, true);
});
