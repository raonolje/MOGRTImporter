"use strict";
// S2-4: core 배치 계획 — planPlacement(트랙·인식·옛 클립 옮기기·그대로·바뀐 속성만·고침·지운 클립·옛 gen·템플릿·옛 버전·효과),
// orderOps(작업 뒤 범위, 순환 끊기), chunkOps(새 클립 이웃), hostItemOf, appliedEntryOf, recoverSalt.
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadRegions, plain } = require("../lib/loadRegions");

const C = loadRegions(["src/mi/core.ts"]);
const TPS = 254016000000;
const FT = 10594584000; // 23.976
const SALT = "ab12";
const DOT = String.fromCharCode(0xb7);
const sec = (f) => (f * FT) / TPS;
const D5 = Math.round((5.005 * TPS) / FT); // 120f

function textRaw(t) {
	return JSON.stringify({ fontEditValue: ["X"], fontTextRunLength: [String(t).length], textEditValue: String(t) });
}
const T = (index, displayName, value) => ({ index, type: "text", displayName, value, rawValue: textRaw(value) });
const COL = (index, displayName, v) => ({ index, type: "color", displayName, value: String(v), rawValue: String(v) });
const PRESET = (extra) => Object.assign({
	id: "preset_3", name: "p3", mogrtPath: "C:/m/a.mogrt", textParamIndex: 0,
	params: [T(0, "텍스트", "기본"), T(1, "포인트 텍스트", ""), COL(2, "색", 4294967295)], exposedIndices: [0, 1], exposedFontFields: {}
}, extra || {});
function row(id, spk, sf, ef, text, o) {
	const p = (o && o.preset) || PRESET();
	const sub = { index: id, startTime: "", endTime: "", startSec: sec(sf), endSec: sec(ef), text, id };
	if (spk) { sub.spk = spk; sub.srtNo = id; }
	const all = JSON.parse(JSON.stringify(p.params));
	all[0].value = text;
	all[0].rawValue = textRaw(text);
	const rs = Object.assign({ presetId: p.id, params: all.filter((x) => p.exposedIndices.indexOf(x.index) !== -1), _allParams: all, open: false, checked: false }, (o && o.rs) || {});
	return { sub, rs, preset: p, baked: (o && o.baked) || null, bakeWhy: (o && o.bakeWhy) || null, oldBaked: (o && o.oldBaked) || null };
}
const castOf = (keys, extra) => {
	const c = {};
	keys.forEach((K, i) => { c[K] = Object.assign({ name: K === "C1" ? "철수" : K === "C2" ? "영희" : K, track: null, autoTrack: null, presetId: "preset_3", color: i }, (extra && extra[K]) || {}); });
	return c;
};
const clip = (sf, ef, nodeId, name) => ({ sf, ef, nodeId, name: name || "" });
const tag = (K, id, g) => (K === "C1" ? "철수" : "영희") + " [MI:" + SALT + "-" + id + "." + g + "]";
function scanOf(n, tracks) {
	return { ok: true, frameTicks: String(FT), numVideoTracks: n, tracks: Object.keys(tracks).map((i) => ({ i: Number(i), locked: false, clips: tracks[i] })) };
}
const det = (texts, o) => Object.assign({ found: true, kind: "ae", pin: "a", texts, lay: [["텍스트", "t"], ["포인트 텍스트", "t"], ["색", "o"]], deco: { comps: 3, keyed: [] } }, o || {});
function plan(rows, o) {
	const x = o || {};
	const subs = (x.allRows || rows).map((r) => (r.sub ? r.sub : r));
	return C.planPlacement({
		rows, allRows: subs, trash: x.trash || {}, base: x.base === undefined ? 2 : x.base,
		mi: { salt: x.salt === undefined ? SALT : x.salt, cast: x.cast || castOf(["C1", "C2"]), castOrder: x.castOrder || ["C1", "C2"], applied: x.applied || {}, legacyTrack: x.legacyTrack === undefined ? null : x.legacyTrack },
		scan: x.scan || scanOf(3, { 1: [], 2: [] }), details: x.details || {}, durs: x.durs || { "c:/m/a.mogrt": 5.005 }, opts: x.opts || {}
	});
}
const ops = (p) => plain(p.ops).map((o) => [o.op, o.id, o.track, o.sf, o.ef]);
// 첫 계획이 되읽을 클립을 다 읽은 것으로 하고 다시 계획한다 (패널 _miPlanFor와 같은 순서)
function planRead(rows, o, readFn) {
	const x = Object.assign({ details: {} }, o || {});
	let p = plan(rows, x);
	for (let i = 0; i < 4 && p.needReads.length; i++) {
		p.needReads.forEach((r) => { x.details[r.nodeId] = readFn(r) || { found: false }; });
		p = plan(rows, x);
	}
	return p;
}

test("speakerFrames: 프레임은 반올림, 같은 화자 겹침은 앞 줄 끝을 뒤 줄 시작에, 다른 화자는 겹쳐도 그대로", () => {
	const subs = [row(1, "C1", 100, 160, "a").sub, row(2, "C1", 150, 200, "b").sub, row(3, "C2", 120, 170, "c").sub, row(4, "C2", 170, 170, "d").sub];
	const f = plain(C.speakerFrames(subs, FT));
	assert.deepEqual(f[1], { sf: 100, ef: 150, clamped: true, zero: false });
	assert.deepEqual(f[2], { sf: 150, ef: 200, clamped: false, zero: false });
	assert.deepEqual(f[3], { sf: 120, ef: 170, clamped: false, zero: false });
	assert.deepEqual(f[4], { sf: 170, ef: 171, clamped: false, zero: false }, "길이 0이면 한 프레임");
});

test("빈 시퀀스 2화자: 첫 화자는 기본 트랙(V3), 다음 화자는 새 트랙(V4) — place, 이름 태그, 트랙 늘리기, 같은 화자 겹침 맞춤", () => {
	const rows = [row(1, "C1", 100, 160, "철수 하나"), row(2, "C2", 120, 180, "영희 하나"), row(3, "C1", 150, 220, "철수 둘")];
	const p = plan(rows);
	assert.deepEqual(plain(p.tracks), { C1: { track: 2, auto: true, create: false, locked: false }, C2: { track: 3, auto: true, create: true, locked: false } });
	assert.deepEqual([p.minCount, p.tracksToAdd], [4, 1]);
	assert.deepEqual(ops(p), [["place", 1, 2, 100, 150], ["place", 2, 3, 120, 180], ["place", 3, 2, 150, 220]], "시작 순, C1 첫 줄은 150에서 끝");
	const o1 = plain(p.ops[0]);
	assert.equal(o1.name, "철수 [MI:ab12-1.1]");
	assert.equal(o1.g, 1);
	assert.equal(o1.durSec, 5.005);
	assert.equal(o1.D, D5);
	assert.equal(o1.params[0].value, "철수 하나");
	assert.equal(p.overlaps, 1);
	// 첫 줄(100)의 템플릿 길이 창 [100, 220)에 셋째 줄은 아직 없다 (시작 순으로 놓는다) → 이웃 없음
	assert.deepEqual(o1.guard, []);
	assert.deepEqual(plain(p.needReads), []);
	assert.deepEqual(plain(p.perSpeaker.C1.counts).place, 2);
});

test("다시 적용: applied.h가 같고 클립이 그 자리면 보내지 않는다 (none, 되읽기도 없다). 바뀐 속성만 보낸다", () => {
	const rows = [row(1, "C1", 100, 160, "철수 하나")];
	const first = plan(rows);
	const op = plain(first.ops[0]);
	const applied = { "ab12-1": plain(C.appliedEntryOf(op, { g: 1, lay: [["텍스트", "t"]], texts: ["철수 하나", ""], kind: "ae", ef: 160 })) };
	const scan = scanOf(3, { 2: [clip(100, 160, "n1", tag("C1", 1, 1))] });
	let p = plan(rows, { scan, applied });
	assert.deepEqual([p.ops.length, plain(p.none), plain(p.needReads)], [0, [1], []]);
	// T2 값만 바꾼다 → 되읽기 → update, 바뀐 index 1만
	rows[0].rs._allParams[1].value = "하나";
	rows[0].rs._allParams[1].rawValue = textRaw("하나");
	p = plan(rows, { scan, applied });
	assert.deepEqual(plain(p.needReads), [{ track: 2, nodeId: "n1" }]);
	p = plan(rows, { scan, applied, details: { n1: det(["철수 하나", ""]) } });
	assert.deepEqual(ops(p), [["update", 1, 2, 100, 160]]);
	assert.deepEqual(plain(p.ops[0].params).map((x) => x.index), [1]);
	assert.equal(p.ops[0].name, null, "이름은 그대로라 보내지 않는다");
	assert.deepEqual(plain(p.ops[0].own), { track: 2, sf: 100, nodeId: "n1" });
	// Premiere에서 문장을 고친 클립 (rh 다름) → 기본은 건너뜀, 덮어쓰기를 고르면 update
	p = plan(rows, { scan, applied, details: { n1: det(["철수 하나 고침", ""]) } });
	assert.deepEqual([p.ops.length, plain(p.edited), plain(p.rowOps[1]).skip], [0, [1], "edited"]);
	p = plan(rows, { scan, applied, details: { n1: det(["철수 하나 고침", ""]) }, opts: { overwriteEdited: true } });
	assert.deepEqual(ops(p), [["update", 1, 2, 100, 160]]);
	// 끝만 바뀌었다 (늘어남 → 5단계, 속성 없음)
	rows[0].rs._allParams[1].value = "";
	rows[0].rs._allParams[1].rawValue = textRaw("");
	rows[0].sub.endSec = sec(170);
	p = plan(rows, { scan, applied, details: { n1: det(["철수 하나", ""]) } });
	assert.deepEqual(ops(p), [["update", 1, 2, 100, 170]]);
	assert.deepEqual([p.ops[0].phase, p.ops[0].params.length], [5, 0]);
});

test("태그 없는 기존 클립(v27): 같은 자리 + 문장을 담으면 인식(adopt), 문장이 다르면 확인 필요(충돌), 켜면 인식", () => {
	const rows = [row(1, "C1", 100, 160, "오늘 날씨"), row(2, "C1", 300, 360, "산책")];
	const scan = scanOf(3, { 2: [clip(100, 161, "v1", "[라온올제] 자막"), clip(301, 360, "v2", "[라온올제] 자막")] });
	const read = (r) => (r.nodeId === "v1" ? det(["오늘 날씨", ""]) : det(["전혀 다른 문장", ""]));
	let p = planRead(rows, { scan }, read);
	assert.deepEqual(plain(p.adopt), { certain: 1, uncertain: 1 });
	assert.deepEqual(ops(p), [["adopt", 1, 2, 100, 160]]);
	assert.equal(p.ops[0].name, "철수 [MI:ab12-1.1]");
	assert.deepEqual(plain(p.conflicts).map((c) => [c.id, c.why]), [[2, "occupied"]]);
	assert.match(p.conflicts[0].detail, /문장이 다름/);
	p = planRead(rows, { scan, opts: { adoptUncertain: true } }, read);
	assert.deepEqual(ops(p).map((o) => o.slice(0, 2)), [["adopt", 1], ["adopt", 2]]);
	// 인식을 끄면 그 자리는 남의 클립 → 충돌
	p = planRead(rows, { scan, opts: { adopt: false } }, read);
	assert.deepEqual(plain(p.conflicts).map((c) => c.id).sort(), [1, 2]);
});

test("다른 salt 태그 클립(복제한 시퀀스): 문장으로 인식하고 그 트랙을 화자 트랙으로 (id로는 받지 않는다)", () => {
	const rows = [row(1, "C1", 100, 160, "철수 하나"), row(2, "C2", 200, 260, "영희 하나"), row(3, "C2", 400, 460, "영희 둘")];
	// 원본 salt zz99로 C1은 V3, C2는 V5에 놓였다. id 2의 클립은 문장이 다르다 (id가 같아도 받지 않는다)
	const scan = scanOf(5, { 2: [clip(100, 160, "f1", "철수 [MI:zz99-1.1]")], 3: [], 4: [clip(200, 260, "f2", "영희 [MI:zz99-2.1]"), clip(400, 460, "f3", "영희 [MI:zz99-7.1]")] });
	const read = (r) => (r.nodeId === "f1" ? det(["철수 하나"]) : r.nodeId === "f2" ? det(["엉뚱한 문장"]) : det(["영희 둘"]));
	const p = planRead(rows, { scan }, read);
	assert.equal(p.tracks.C2.track, 4, "문장이 맞는 다른 salt 클립이 있는 트랙");
	assert.deepEqual(plain(p.foreignAdopt), { certain: 2, uncertain: 1 });
	assert.deepEqual(ops(p).map((o) => o.slice(0, 3)), [["adopt", 1, 2], ["adopt", 3, 4]]);
	assert.equal(p.ops[1].name, "영희 [MI:ab12-3.1]", "우리 salt 태그로 바꾼다");
	assert.deepEqual(plain(p.conflicts).map((c) => [c.id, c.why]), [[2, "occupied"]]);
	// 끄면 인식하지 않는다 (그 자리는 충돌)
	const q = planRead(rows, { scan, opts: { adoptForeign: false } }, read);
	assert.deepEqual(q.ops.filter((o) => o.op === "adopt").length, 0);
});

test("나눈 레거시 목록: legacyTrack(V3)에 있던 C2의 옛 클립은 C2 트랙으로 legacyMove (새로 놓고 옛 클립 지움), 효과가 있는 클립은 빼고 새로 놓는다", () => {
	const rows = [row(1, "C1", 100, 160, "철수 하나"), row(2, "C2", 200, 260, "영희 하나"), row(3, "C2", 400, 460, "영희 둘")];
	const scan = scanOf(3, { 2: [clip(100, 160, "v1", "[라온올제] 자막"), clip(200, 260, "v2", "[라온올제] 자막"), clip(400, 460, "v3", "[라온올제] 자막")] });
	const read = (r) => (r.nodeId === "v1" ? det(["철수 하나"]) : r.nodeId === "v2" ? det(["영희 하나"]) : det(["영희 둘"], { deco: { comps: 4, keyed: [] } }));
	const p = planRead(rows, { scan, legacyTrack: 2, cast: castOf(["C1", "C2"]) }, read);
	const byId = {};
	plain(p.ops).forEach((o) => { byId[o.id] = o; });
	assert.deepEqual([byId[1].op, byId[1].track, byId[1].name], ["adopt", 2, "철수 [MI:ab12-1.1]"], "C1(첫 화자 = 기본 트랙 = legacyTrack)은 제자리 인식");
	assert.deepEqual([byId[2].op, byId[2].track, byId[2].removeAfter], ["legacyMove", 3, { track: 2, nodeId: "v2" }]);
	assert.deepEqual([byId[3].op, byId[3].track], ["legacyMove", 3], "기본 컴포넌트 수를 모르고 키도 없으면 효과 없음으로 본다");
	assert.deepEqual(plain(p.conflicts), []);
	// 프리셋이 기본 컴포넌트 수(3)를 배웠으면 4개인 클립은 효과가 있는 것 → 옮기지 않고 새로 놓는다 (옛 클립은 남아 두 번 나온다)
	const pr = PRESET({ mogrtBaseComps: 3 });
	const rows2 = [row(1, "C1", 100, 160, "철수 하나", { preset: pr }), row(2, "C2", 200, 260, "영희 하나", { preset: pr }), row(3, "C2", 400, 460, "영희 둘", { preset: pr })];
	const q = planRead(rows2, { scan, legacyTrack: 2 }, read);
	const b2 = {};
	plain(q.ops).forEach((o) => { b2[o.id] = o; });
	assert.deepEqual([b2[2].op, b2[3].op], ["legacyMove", "place"]);
	assert.deepEqual([q.legacyMove, q.legacyDecorated, plain(q.legacyKept)], [1, 1, [3]]);
	// 옮기기를 끄면 모두 새로 놓고 옛 클립은 남는다
	const r = planRead(rows2, { scan, legacyTrack: 2, opts: { moveLegacy: false } }, read);
	assert.deepEqual(plain(r.legacyKept).sort(), [2, 3]);
	// 효과가 있어도 다시 놓기를 고르면 옮긴다
	const s = planRead(rows2, { scan, legacyTrack: 2, opts: { moveDecorated: true } }, read);
	assert.equal(plain(s.ops).find((o) => o.id === 3).op, "legacyMove");
});

test("나중 화자는 남의 클립이 있는 트랙을 건너뛰고 기억한 autoTrack을 다시 쓴다, 고정 겹침은 막는다, 잠긴 트랙은 건너뜀", () => {
	const rows = [row(1, "C1", 100, 160, "a"), row(2, "C2", 120, 180, "b")];
	const scan = scanOf(6, { 2: [], 3: [clip(0, 500, "png", "외부.png")], 4: [], 5: [] });
	let p = plan(rows, { scan });
	assert.equal(p.tracks.C2.track, 4, "V4에 남의 클립 → V5");
	p = plan(rows, { scan, cast: castOf(["C1", "C2"], { C2: { autoTrack: 5 } }) });
	assert.equal(p.tracks.C2.track, 5, "기억한 트랙");
	p = plan(rows, { scan, cast: castOf(["C1", "C2"], { C1: { track: 4 }, C2: { track: 4 } }) });
	assert.deepEqual(plain(p.blocked), [{ keys: ["C1", "C2"], track: 4 }]);
	assert.deepEqual(plain(p.conflicts).map((c) => c.why), ["pinned-overlap", "pinned-overlap"]);
	assert.equal(p.ops.length, 0);
	const locked = scanOf(6, { 2: [], 3: [], 4: [] });
	locked.tracks[1].locked = true;
	p = plan(rows, { scan: locked, cast: castOf(["C1", "C2"], { C2: { track: 3 } }) });
	assert.deepEqual([plain(p.locked), plain(p.rowOps[2]).skip], [[2], "locked"]);
});

test("자리 확인 (작업 뒤 범위): 남의 클립이 시작을 덮으면 occupied, 템플릿 길이 안이면 tail, 우리 클립은 이웃(guard)", () => {
	const rows = [row(1, "C1", 100, 130, "a"), row(2, "C1", 400, 430, "b"), row(3, "C1", 600, 630, "c")];
	const scan = scanOf(3, { 2: [clip(90, 110, "u1", "B-roll.mp4"), clip(450, 470, "u2", "B-roll2.mp4"), clip(650, 700, "o9", tag("C1", 9, 1))] });
	const p = planRead(rows, { scan, allRows: rows.map((r) => r.sub).concat([row(9, "C1", 650, 700, "z").sub]) }, () => det(["z"]));
	assert.deepEqual(plain(p.conflicts).map((c) => [c.id, c.why]), [[1, "occupied"], [2, "tail"]]);
	assert.match(p.conflicts[0].detail, /^V3 3\.\d~4\.\d B-roll\.mp4$/);
	assert.deepEqual(ops(p), [["place", 3, 2, 600, 630]]);
	assert.deepEqual(plain(p.ops[0].guard), ["o9"], "우리 클립은 머리를 되돌릴 이웃");
	// 줄이지 않는 우리 클립이 시작을 덮으면 occupied-own
	const rows2 = [row(5, "C1", 200, 260, "새 줄")];
	const scan2 = scanOf(3, { 2: [clip(150, 300, "o8", tag("C1", 8, 1))] });
	const q = plan(rows2, { scan: scan2, allRows: [rows2[0].sub, row(8, "C1", 150, 300, "옛 줄").sub] });
	assert.deepEqual(plain(q.conflicts).map((c) => c.why), ["occupied-own"]);
});

test("나누기 1→2 · 합치기 2→1을 한 번에 (작업 뒤 범위로 확인): 줄이는 갱신 → 배치, 목록에서 빠진 줄 제거 → 늘리는 갱신", () => {
	// 나누기: 줄 1이 [100, 300) → [100, 200), 새 줄 2가 [200, 300)
	const r1 = row(1, "C1", 100, 200, "앞 조각");
	const r2 = row(2, "C1", 200, 300, "뒤 조각");
	const e1 = plain(C.appliedEntryOf(plain(plan([row(1, "C1", 100, 300, "나누기 전")]).ops[0]), { g: 1, texts: ["나누기 전", ""], kind: "ae", ef: 300 }));
	const scan = scanOf(3, { 2: [clip(100, 300, "n1", tag("C1", 1, 1))] });
	let p = planRead([r1, r2], { scan, applied: { "ab12-1": e1 } }, () => det(["나누기 전", ""]));
	assert.deepEqual(ops(p), [["update", 1, 2, 100, 200], ["place", 2, 2, 200, 300]]);
	assert.deepEqual([p.ops[0].phase, p.ops[1].phase], [2, 4]);
	assert.deepEqual(plain(p.conflicts), []);
	// 합치기: 줄 1이 [100, 300)로 늘고 줄 2는 병합으로 휴지통 (클립은 그대로, Premiere에서 고치지 않음) → 2 제거 뒤 1 늘리기
	const m1 = row(1, "C1", 100, 300, "합친 문장");
	const a1 = plain(C.appliedEntryOf(plain(plan([row(1, "C1", 100, 200, "앞")]).ops[0]), { g: 1, texts: ["앞", ""], kind: "ae", ef: 200 }));
	const a2 = plain(C.appliedEntryOf(plain(plan([row(2, "C1", 200, 300, "뒤")]).ops[0]), { g: 1, texts: ["뒤", ""], kind: "ae", ef: 300 }));
	const scanJ = scanOf(3, { 2: [clip(100, 200, "n1", tag("C1", 1, 1)), clip(200, 300, "n2", tag("C1", 2, 1))] });
	const read = (r) => (r.nodeId === "n1" ? det(["앞", ""]) : det(["뒤", ""]));
	p = planRead([m1], { scan: scanJ, applied: { "ab12-1": a1, "ab12-2": a2 }, trash: { 2: "merge" } }, read);
	assert.deepEqual(plain(p.removals).map((x) => [x.uid, x.why]), [["ab12-2", "orphan"]]);
	assert.deepEqual(plain(p.orphans).map((x) => [x.uid, x.pre]), [["ab12-2", true]]);
	assert.deepEqual(ops(p), [["update", 1, 2, 100, 300]]);
	assert.equal(p.ops[0].phase, 5, "늘리는 갱신은 제거 뒤 (5단계)");
	// 목록 밖 클립을 Premiere에서 고쳤거나 사용자가 지운 줄이면 미리 체크하지 않는다
	p = planRead([m1], { scan: scanJ, applied: { "ab12-1": a1, "ab12-2": a2 }, trash: { 2: "" } }, read);
	assert.deepEqual([plain(p.removals), plain(p.orphans).map((x) => x.pre)], [[], [false]]);
	p = planRead([m1], { scan: scanJ, applied: { "ab12-1": a1, "ab12-2": a2 }, trash: { 2: "" }, opts: { orphans: "all" } }, read);
	assert.equal(p.removals.length, 1);
});

test("시간이 바뀐 줄: 같은 트랙이면 move(효과 유지), 다른 트랙이면 moveRegen, 효과가 있으면 옮기지 않고 제자리 갱신. 사용자가 옮긴 클립은 제자리", () => {
	const r = row(1, "C1", 100, 160, "a");
	const e = plain(C.appliedEntryOf(plain(plan([r]).ops[0]), { g: 1, texts: ["a", ""], kind: "ae", ef: 160 }));
	// 줄 시간이 200으로 바뀜 (applied 자리 100과 다르다) → move
	const moved = row(1, "C1", 200, 260, "a");
	const scan = scanOf(3, { 2: [clip(100, 160, "n1", tag("C1", 1, 1))] });
	let p = planRead([moved], { scan, applied: { "ab12-1": e } }, () => det(["a", ""]));
	assert.deepEqual(ops(p), [["move", 1, 2, 200, 260]]);
	assert.equal(p.ops[0].g, 1);
	// 트랙을 고정해 바꾸면 다른 트랙 → moveRegen (gen 2)
	p = planRead([moved], { scan, applied: { "ab12-1": e }, cast: castOf(["C1", "C2"], { C1: { track: 4 } }) }, () => det(["a", ""]));
	assert.deepEqual(ops(p), [["moveRegen", 1, 4, 200, 260]]);
	assert.deepEqual([p.ops[0].g, p.ops[0].name], [2, "철수 [MI:ab12-1.2]"]);
	// 효과가 있으면 옮기지 않는다 → decorated 목록. 쓸 것이 없으면 보내지 않고(건너뜀 '효과 있어 제자리'), 문장이 바뀌었으면 제자리 갱신(keepTime, stay)
	const keyed = () => det(["a", ""], { deco: { comps: 3, keyed: ["AE.ADBE Motion"] } });
	p = planRead([moved], { scan, applied: { "ab12-1": e }, cast: castOf(["C1", "C2"], { C1: { track: 4 } }) }, keyed);
	assert.deepEqual([p.ops.length, plain(p.decorated), plain(p.rowOps[1]).skip], [0, [1], "decorated"]);
	const movedT = row(1, "C1", 200, 260, "a 고침");
	p = planRead([movedT], { scan, applied: { "ab12-1": e }, cast: castOf(["C1", "C2"], { C1: { track: 4 } }) }, keyed);
	assert.deepEqual([ops(p)[0], p.ops[0].keepTime, p.ops[0].stay, plain(p.decorated)], [["update", 1, 2, 100, 160], true, true, [1]]);
	assert.deepEqual(plain(p.ops[0].params).map((x) => x.index), [0]);
	// 결과 applied는 클립이 있는 자리(V3 100~160)를 적는다 → 다음 계획도 시간 변경을 보고 decorated (다시 놓기를 고를 수 있다)
	const e2 = plain(C.appliedEntryOf(plain(p.ops[0]), { status: "updated", g: 1, texts: ["a 고침", ""], kind: "ae", ef: 160 }, e));
	assert.deepEqual([e2.t, e2.sf, e2.ef], [2, 100, 160]);
	p = planRead([movedT], { scan, applied: { "ab12-1": e2 }, cast: castOf(["C1", "C2"], { C1: { track: 4 } }) }, () => det(["a 고침", ""], { deco: { comps: 3, keyed: ["AE.ADBE Motion"] } }));
	assert.deepEqual([p.ops.length, plain(p.decorated), plain(p.rowOps[1]).skip, plain(p.userMoved)], [0, [1], "decorated", []]);
	p = planRead([movedT], { scan, applied: { "ab12-1": e2 }, cast: castOf(["C1", "C2"], { C1: { track: 4 } }), opts: { moveDecorated: true } }, () => det(["a 고침", ""], { deco: { comps: 3, keyed: ["AE.ADBE Motion"] } }));
	assert.deepEqual(ops(p), [["moveRegen", 1, 4, 200, 260]]);
	// 줄은 그대로인데 클립이 다른 자리 (사용자가 옮김) → intent가 같으면 보내지 않는다, 되돌리기를 고르면 move
	const scanU = scanOf(3, { 2: [clip(130, 190, "n1", tag("C1", 1, 1))] });
	p = plan([r], { scan: scanU, applied: { "ab12-1": e } });
	assert.deepEqual([p.ops.length, plain(p.userMoved), plain(p.none)], [0, [1], [1]]);
	p = planRead([r], { scan: scanU, applied: { "ab12-1": e }, opts: { restoreMoved: true } }, () => det(["a", ""]));
	assert.deepEqual(ops(p), [["move", 1, 2, 100, 160]]);
});

test("템플릿: applied.m이 다르면 replace(먼저 지우고 새로), 배운 mogrtLs와 다른 클립은 옛 버전(이름으로 갱신, 고르면 교체), 네이티브 템플릿 모름은 충돌", () => {
	const r = row(1, "C1", 100, 160, "a");
	const e = plain(C.appliedEntryOf(plain(plan([r]).ops[0]), { g: 1, texts: ["a", ""], kind: "ae", ef: 160 }));
	const scan = scanOf(3, { 2: [clip(100, 160, "n1", tag("C1", 1, 1))] });
	const r2 = row(1, "C1", 100, 160, "a", { preset: PRESET({ mogrtPath: "C:/m/b.mogrt" }) });
	let p = planRead([r2], { scan, applied: { "ab12-1": e } }, () => det(["a", ""]));
	assert.deepEqual(ops(p), [["replace", 1, 2, 100, 160]]);
	assert.deepEqual([p.ops[0].g, p.ops[0].m, plain(p.ops[0].own)], [2, "C:/m/b.mogrt", { m: "C:/m/a.mogrt", track: 2, sf: 100, nodeId: "n1" }]);
	// applied가 없으면: 배운 이름(pin)으로, 그것도 없으면 같은 종류면 같은 템플릿 (확인 안 됨)
	p = planRead([row(1, "C1", 100, 160, "a", { preset: PRESET({ mogrtItemName: "B 템플릿" }) })], { scan }, () => det(["a", ""], { pin: "A 템플릿" }));
	assert.equal(ops(p)[0][0], "replace");
	p = planRead([r], { scan }, () => det(["a", ""]));
	assert.deepEqual([ops(p)[0][0], plain(p.unverifiedTemplate)], ["update", [1]]);
	// 옛 버전 (mogrtLs 다름): 기본은 update (이름 확인 쓰기), upgradeOld면 replace
	const ls = C.clipLs([["새 텍스트", "t"]]);
	const rOld = row(1, "C1", 100, 160, "a", { preset: PRESET({ mogrtLs: ls }) });
	p = planRead([rOld], { scan }, () => det(["a", ""]));
	assert.deepEqual([ops(p)[0][0], plain(p.oldVersion)], ["update", [1]]);
	p = planRead([rOld], { scan, opts: { upgradeOld: true } }, () => det(["a", ""]));
	assert.equal(ops(p)[0][0], "replace");
	// 네이티브 클립, 프리셋은 AE (종류가 다름) → 되놓을 경로가 없어 충돌 template-unknown
	p = planRead([r], { scan }, () => det(["", ""], { kind: "native", lay: { n: 2 }, pin: null }));
	assert.deepEqual([plain(p.conflicts).map((c) => c.why), plain(p.unknownTemplate)], [["template-unknown"], [1]]);
});

test("네이티브 줄: 구운 경로로 놓고 텍스트 params는 보내지 않는다. 문구가 바뀌면(구운 경로가 다름) replace, 같으면 그대로", () => {
	const NP = PRESET({ id: "preset_n", mogrtPath: "C:/m/native.mogrt", params: [{ index: 0, type: "text", displayName: "텍스트 1", value: "", rawValue: "", nativeText: true }], exposedIndices: [0] });
	const baked = { path: "C:/cache/baked/aaaa.mogrt", key: "aaaa", durSec: 5.005 };
	const r = row(1, "C1", 100, 160, "네이티브", { preset: NP, baked });
	let p = plan([r]);
	assert.deepEqual([ops(p)[0][0], p.ops[0].m, p.ops[0].params.length, p.ops[0].kind, p.ops[0].nk], ["place", baked.path, 0, "native", "aaaa"]);
	const e = plain(C.appliedEntryOf(plain(p.ops[0]), { g: 1, texts: [""], kind: "native", ef: 160 }));
	const scan = scanOf(3, { 2: [clip(100, 160, "n1", tag("C1", 1, 1))] });
	p = plan([r], { scan, applied: { "ab12-1": e } });
	assert.deepEqual([p.ops.length, plain(p.none)], [0, [1]]);
	const r2 = row(1, "C1", 100, 160, "네이티브 고침", { preset: NP, baked: { path: "C:/cache/baked/bbbb.mogrt", key: "bbbb", durSec: 5.005 } });
	p = planRead([r2], { scan, applied: { "ab12-1": e } }, () => det([""], { kind: "native", lay: { n: 1 }, pin: null }));
	assert.deepEqual([ops(p)[0][0], plain(p.ops[0].own).m], ["replace", baked.path]);
	// 굽지 못한 줄은 건너뛴다
	p = plan([row(3, "C1", 300, 360, "x", { preset: NP, bakeWhy: "fields" })]);
	assert.deepEqual([p.ops.length, plain(p.bakeFailed)], [0, [{ id: 3, why: "fields" }]]);
});

test("지운 클립(applied는 있는데 타임라인에 없음)은 기본 다시 놓기 (끄면 건너뜀), 프리셋 없는 줄·같은 태그 둘(자르기)은 건너뜀, 옛 gen은 제거", () => {
	const r = row(1, "C1", 100, 160, "a");
	const e = plain(C.appliedEntryOf(plain(plan([r]).ops[0]), { g: 1, texts: ["a", ""], kind: "ae", ef: 160 }));
	let p = plan([r], { applied: { "ab12-1": e } });
	assert.deepEqual([ops(p), plain(p.missing)], [[["place", 1, 2, 100, 160]], [1]]);
	assert.equal(p.ops[0].g, 2, "다시 놓는 클립은 다음 gen");
	p = plan([r], { applied: { "ab12-1": e }, opts: { replaceMissing: false } });
	assert.deepEqual([p.ops.length, plain(p.rowOps[1]).skip], [0, "missing"]);
	const np = row(2, "C1", 300, 360, "b");
	np.preset = null;
	np.rs.presetId = "";
	p = plan([np]);
	assert.deepEqual(plain(p.noPreset), [2]);
	const scan = scanOf(3, { 2: [clip(100, 130, "d1", tag("C1", 1, 2)), clip(130, 160, "d2", tag("C1", 1, 2)), clip(500, 560, "s1", tag("C1", 1, 1))] });
	p = plan([r], { scan, applied: { "ab12-1": e } });
	assert.deepEqual([plain(p.dup), plain(p.rowOps[1]).skip], [["ab12-1"], "dup"]);
	assert.deepEqual(plain(p.removals).map((x) => [x.nodeId, x.why, x.expectName]), [["s1", "stale", tag("C1", 1, 1)]]);
	p = plan([r], { scan, applied: { "ab12-1": e }, opts: { cleanupStale: false } });
	assert.deepEqual([plain(p.removals), p.cleanup.length], [[], 1]);
	// 한 줄 적용(↑)은 옛 gen·목록 밖 클립을 보지 않는다
	p = plan([r], { scan, applied: { "ab12-1": e }, opts: { single: true } });
	assert.deepEqual([plain(p.removals), p.cleanup.length], [[], 0]);
});

test("orderOps: 이동이 다른 이동의 옛 자리를 쓰면 그 뒤에, 순환(자리 바꾸기)은 하나를 '먼저 지우고 나중에 놓기'로 끊는다", () => {
	const mv = (id, fromSf, fromEf, sf, ef) => ({ id, uid: SALT + "-" + id, op: "move", phase: 3, track: 2, sf, ef, D: 0, own: { track: 2, sf: fromSf, nodeId: "n" + id }, src: { track: 2, sf: fromSf, ef: fromEf, nodeId: "n" + id, name: "x" + id, g: 1 } });
	// A: [100,200) → [150,250) 는 B의 옛 자리 [200,300)와 겹친다 → B 먼저
	let r = C.orderOps([mv(1, 100, 200, 150, 250), mv(2, 200, 300, 260, 360)]);
	assert.deepEqual(plain(r.ordered.map((o) => o.id)), [2, 1]);
	assert.deepEqual(plain(r.removals), []);
	// 자리 바꾸기: A [100,200) → [200,300), B [200,300) → [100,200) → 순환. 가는 자리의 시작이 이른 B를 끊는다:
	// B 옛 클립 제거(1단계), B는 4단계 배치
	r = C.orderOps([mv(1, 100, 200, 200, 300), mv(2, 200, 300, 100, 200)]);
	assert.deepEqual(plain(r.ordered.map((o) => [o.id, o.op, o.phase])), [[1, "move", 3], [2, "place", 4]]);
	assert.deepEqual(plain(r.removals).map((x) => [x.nodeId, x.why]), [["n2", "cycle"]]);
	// planPlacement에서: 두 줄의 문장이 자리를 바꿨다 → 한 번에 된다
	const e1 = plain(C.appliedEntryOf(plain(plan([row(1, "C1", 100, 200, "a")]).ops[0]), { g: 1, texts: ["a", ""], kind: "ae", ef: 200 }));
	const e2 = plain(C.appliedEntryOf(plain(plan([row(2, "C1", 200, 300, "b")]).ops[0]), { g: 1, texts: ["b", ""], kind: "ae", ef: 300 }));
	const scan = scanOf(3, { 2: [clip(100, 200, "n1", tag("C1", 1, 1)), clip(200, 300, "n2", tag("C1", 2, 1))] });
	const p = planRead([row(1, "C1", 200, 300, "a"), row(2, "C1", 100, 200, "b")], { scan, applied: { "ab12-1": e1, "ab12-2": e2 } }, (x) => det([x.nodeId === "n1" ? "a" : "b", ""]));
	assert.deepEqual(plain(p.conflicts), []);
	assert.deepEqual(plain(p.removals).map((x) => x.nodeId), ["n2"]);
	assert.deepEqual(ops(p), [["move", 1, 2, 200, 300], ["place", 2, 2, 100, 200]]);
	assert.deepEqual(plain(p.ops[1].guard), ["n1"], "옮긴 A가 B 템플릿 길이 창 안 → 이웃");
	// 끊은 배치는 새 클립(템플릿 기본값)에 놓으므로 줄의 속성 전부와 다음 gen 태그를 싣는다 (바뀐 속성만 보내는 move 모양이 아니다)
	const br = plain(p.ops[1]);
	assert.deepEqual([br.g, br.name, br.params.length, br.params[0].value], [2, "철수 [MI:ab12-2.2]", 3, "b"]);
	assert.equal(plain(p.ops[0]).params.length, 0, "옮기기만 하는 줄은 바뀐 속성 없음");
	// 의도 해시도 새 gen·새 이름으로 (지운 클립을 다시 놓는 계획과 같다) → 다시 적용하면 그대로
	const again = plan([row(2, "C1", 100, 200, "b")], { applied: { "ab12-2": e2 } });
	assert.deepEqual([ops(again), again.ops[0].g], [[["place", 2, 2, 100, 200]], 2]);
	assert.equal(br.h, again.ops[0].h);
});

test("인식 후보는 한 클립에 한 줄 (동시 발화): 같은 문장이면 그 트랙의 줄이 제자리 인식, 다른 줄은 새로 놓는다 — 옛 클립을 옮기며 지우지 않는다", () => {
	const v27 = (text, ef) => scanOf(3, { 2: [clip(100, ef, "v1", "[라온올제] 자막")] });
	// C1 '네'와 C2 '네'가 같은 자리: 태그 없는 클립 하나(V3 = C1 트랙 = legacyTrack)
	let p = planRead([row(1, "C1", 100, 160, "네"), row(2, "C2", 100, 160, "네")], { scan: v27("네", 160), legacyTrack: 2 }, () => det(["네", ""]));
	assert.deepEqual(ops(p), [["place", 2, 3, 100, 160], ["adopt", 1, 2, 100, 160]], "배치(4단계) → 끝이 같은 인식(5단계)");
	assert.deepEqual([plain(p.conflicts), plain(p.removals), p.legacyMove, plain(p.adopt)], [[], [], 0, { certain: 1, uncertain: 0 }]);
	// C1 '네' + C2 '네 맞아요' (v27이 같은 트랙에서 앞 줄을 덮어써 '네 맞아요' 클립만 남았다): C1이 제자리 인식하며 문장을 다시 쓰고, C2는 C2 트랙에 새로
	p = planRead([row(1, "C1", 100, 160, "네"), row(2, "C2", 100, 180, "네 맞아요")], { scan: v27("네 맞아요", 180), legacyTrack: 2 }, () => det(["네 맞아요", ""]));
	assert.deepEqual(ops(p), [["adopt", 1, 2, 100, 160], ["place", 2, 3, 100, 180]]);
	assert.deepEqual([plain(p.conflicts), plain(p.removals), p.legacyMove], [[], [], 0]);
	// 문장이 C2에만 맞으면 C2가 가져가 옮기고(옛 클립 지움), C1은 새로 놓는다
	p = planRead([row(1, "C1", 100, 160, "네 맞아요"), row(2, "C2", 100, 160, "네")], { scan: v27("네", 160), legacyTrack: 2 }, () => det(["네", ""]));
	assert.deepEqual(ops(p), [["legacyMove", 2, 3, 100, 160], ["place", 1, 2, 100, 160]]);
	assert.deepEqual(plain(p.conflicts), []);
	// 네이티브 (문장을 읽을 수 없다): 두 줄의 마지막 적용 자리(ap)가 같은 클립 → 그 트랙의 줄은 '확인 필요'(충돌), 다른 줄은 새로
	const NP = PRESET({ id: "preset_n", mogrtPath: "C:/m/native.mogrt", params: [{ index: 0, type: "text", displayName: "텍스트 1", value: "", rawValue: "", nativeText: true }], exposedIndices: [0] });
	const nrow = (id, spk, text) => row(id, spk, 100, 160, text, { preset: NP, baked: { path: "C:/cache/baked/" + id + ".mogrt", key: "k" + id, durSec: 5.005 }, rs: { ap: { s: sec(100), e: sec(160), cap: text, ps: "x", t: 2 } } });
	const nscan = scanOf(3, { 2: [clip(100, 160, "g1", "Graphic")] });
	const nread = () => det([""], { kind: "native", lay: { n: 1 }, pin: null });
	p = planRead([nrow(1, "C1", "하나"), nrow(2, "C2", "둘")], { scan: nscan, legacyTrack: 2 }, nread);
	assert.deepEqual(ops(p), [["place", 2, 3, 100, 160]]);
	assert.deepEqual(plain(p.conflicts).map((c) => [c.id, c.why]), [[1, "occupied"]]);
	assert.match(p.conflicts[0].detail, /문장으로 가릴 수 없음/);
	assert.deepEqual([plain(p.adopt), plain(p.removals)], [{ certain: 0, uncertain: 1 }, []]);
	// 한 줄만 원하면 그대로 인식
	p = planRead([nrow(1, "C1", "하나")], { scan: nscan, legacyTrack: 2 }, nread);
	assert.deepEqual(ops(p), [["adopt", 1, 2, 100, 160]]);
});

test("새 트랙은 이번 작업이 쓰는 트랙까지만: ↑ 한 줄이나 줄이 없는 화자의 트랙은 만들지 않는다 (자리 미리보기는 그대로)", () => {
	const scan = scanOf(3, { 1: [], 2: [] });
	let p = plan([row(1, "C1", 100, 160, "a")], { scan, opts: { single: true } });
	assert.deepEqual([plain(p.tracks.C2), p.minCount, p.tracksToAdd, ops(p)], [{ track: 3, auto: true, create: false, locked: false }, 0, 0, [["place", 1, 2, 100, 160]]]);
	// C2 줄이 있어도 건너뛰면(프리셋 없음) 만들지 않는다
	const np = row(2, "C2", 300, 360, "b");
	np.preset = null;
	np.rs.presetId = "";
	p = plan([row(1, "C1", 100, 160, "a"), np], { scan });
	assert.deepEqual([p.minCount, p.tracks.C2.create], [0, false]);
	// C3(V6)만 줄이 있으면 사이의 V5(C2)도 생긴다 → C2도 create
	p = plan([row(3, "C3", 100, 160, "c")], { scan, cast: castOf(["C1", "C2", "C3"], { C3: { track: 5 } }), castOrder: ["C1", "C2", "C3"] });
	assert.deepEqual([p.minCount, p.tracksToAdd, p.tracks.C2.create, p.tracks.C3.create, p.tracks.C1.create], [6, 3, true, true, false]);
});

test("목록에서 빠진 네이티브 클립은 미리 체크하지 않는다 (Source Text는 늘 \"\"로 읽혀 고쳤는지 알 수 없다)", () => {
	const rows = [row(1, "C1", 100, 160, "a")];
	const scan = scanOf(3, { 2: [clip(300, 360, "n7", tag("C1", 7, 1))] });
	const e7 = { g: 1, m: "C:/cache/baked/x.mogrt", ls: "", h: "h", fh: {}, rh: C.textsHash(["", ""]), k: "native", t: 2, sf: 300, ef: 360, cef: 360 };
	let p = planRead(rows, { scan, applied: { "ab12-7": e7 }, trash: { 7: "merge" } }, () => det(["", ""], { kind: "native", lay: { n: 2 }, pin: null }));
	assert.deepEqual([plain(p.orphans).map((x) => [x.uid, x.pre]), plain(p.removals)], [[["ab12-7", false]], []]);
	// AE는 그대로: 고치지 않았으면 미리 체크
	const a7 = Object.assign({}, e7, { k: "ae", rh: C.textsHash(["옛 문장", ""]) });
	p = planRead(rows, { scan, applied: { "ab12-7": a7 }, trash: { 7: "merge" } }, () => det(["옛 문장", ""]));
	assert.deepEqual(plain(p.orphans).map((x) => x.pre), [true]);
});

test("appliedEntryOf: partial은 못 쓴 속성의 fh를 빼고 h를 비운다 → 다음 계획이 그 속성을 다시 보낸다. 텍스트를 쓰지 않은 작업은 rh를 그대로 둔다", () => {
	const r = row(1, "C1", 100, 160, "새 문장");
	const op = plain(plan([r]).ops[0]);
	const e = plain(C.appliedEntryOf(op, { status: "partial", g: 1, texts: ["옛 문장", ""], kind: "ae", ef: 160, keyed: ["텍스트"], skipped: [] }));
	assert.deepEqual([e.h, Object.keys(e.fh).sort()], ["", ["1", "2"]]);
	const scan = scanOf(3, { 2: [clip(100, 160, "n1", tag("C1", 1, 1))] });
	const p = planRead([r], { scan, applied: { "ab12-1": e } }, () => det(["옛 문장", ""]));
	assert.deepEqual([ops(p), plain(p.none)], [[["update", 1, 2, 100, 160]], []]);
	assert.deepEqual(plain(p.ops[0].params).map((x) => x.index), [0], "키프레임이라 못 쓴 캡션만 다시");
	// 텍스트를 쓰지 않은 이동(바뀐 속성 없음): Premiere에서 고친 문장이 되읽혀도 rh는 지난 값 (다음에 '고침'으로 보인다)
	const prev = { rh: C.textsHash(["우리가 쓴 문장", ""]) };
	const mv = { op: "move", g: 1, m: "C:/m/a.mogrt", h: "h", fhAll: {}, kind: "ae", track: 2, sf: 110, ef: 170, params: [] };
	assert.equal(C.appliedEntryOf(mv, { status: "moved", texts: ["편집자가 고친 문장", ""], kind: "ae" }, prev).rh, prev.rh);
	assert.equal(C.appliedEntryOf(mv, { status: "moved", texts: ["편집자가 고친 문장", ""], kind: "ae" }).rh, C.textsHash(["편집자가 고친 문장", ""]), "지난 값이 없으면 되읽은 값");
	const up = Object.assign({}, mv, { op: "update", params: [T(0, "텍스트", "새")] });
	assert.equal(C.appliedEntryOf(up, { status: "updated", texts: ["새", ""], kind: "ae" }, prev).rh, C.textsHash(["새", ""]), "텍스트를 쓴 작업은 되읽은 값");
});

test("chunkOps·hostItemOf: 8개씩, 같은 청크에서 만들 클립을 이웃으로 가리키면 끊는다. 'new:uid' 이웃은 만든 nodeId로 푼다", () => {
	const mk = (id, op, guard) => ({ id, uid: SALT + "-" + id, op, phase: 4, track: 2, sf: id * 10, ef: id * 10 + 5, D: 0, guard: guard || [], m: "C:/m/a.mogrt", durSec: 5, params: [], name: "n", g: 1, own: null });
	const list = [];
	for (let i = 1; i <= 10; i++) list.push(mk(i, "place"));
	assert.deepEqual(plain(C.chunkOps(list, 8).map((c) => c.length)), [8, 2]);
	const dep = [mk(1, "moveRegen"), mk(2, "place", ["new:" + SALT + "-1", "x9"]), mk(3, "place")];
	assert.deepEqual(plain(C.chunkOps(dep, 8).map((c) => c.map((o) => o.id))), [[1], [2, 3]]);
	const item = plain(C.hostItemOf(dep[1], { [SALT + "-1"]: "000f9999" }));
	assert.deepEqual(item.guard, ["000f9999", "x9"]);
	assert.deepEqual(Object.keys(item).sort(), ["durSec", "ef", "g", "guard", "keepTime", "key", "mogrtPath", "motion", "name", "op", "own", "params", "removeAfter", "sf", "track"]);
	assert.deepEqual(plain(C.hostItemOf(dep[1], {})).guard, ["x9"], "못 풀면 뺀다");
});

test("recoverSalt: 표본의 80%가 줄 문장을 담아야 받는다 (id만 같아서는 받지 않는다), 되읽을 표본을 먼저 알린다", () => {
	const scan = scanOf(3, { 2: [clip(0, 10, "a", "x [MI:k7q2-1.1]"), clip(20, 30, "b", "x [MI:k7q2-2.1]"), clip(40, 50, "c", "x [MI:zz99-1.1]")] });
	const rows = { 1: { caps: [C.normText("하나")] }, 2: { caps: [C.normText("둘")] } };
	let r = plain(C.recoverSalt(scan, rows, {}));
	assert.deepEqual([r.salt, r.need.map((x) => x.nodeId)], [null, ["a", "b", "c"]]);
	r = plain(C.recoverSalt(scan, rows, { a: { found: true, texts: ["하나"] }, b: { found: true, texts: ["둘"] }, c: { found: true, texts: ["엉뚱"] } }));
	assert.equal(r.salt, "k7q2");
	r = plain(C.recoverSalt(scan, rows, { a: { found: true, texts: ["하나"] }, b: { found: true, texts: ["엉뚱"] }, c: { found: true, texts: ["엉뚱"] } }));
	assert.equal(r.salt, null, "50%");
});

test("appliedEntryOf·intentHash·textsHash: 제자리 갱신은 줄이 원한 자리를 적고, 텍스트 해시는 NFC·줄바꿈 LF", () => {
	const op = { g: 1, m: "C:/m/a.mogrt", h: "h1", fhAll: { 0: "x" }, kind: "ae", track: 5, sf: 10, ef: 20, intent: { t: 2, sf: 100, ef: 160 } };
	const e = plain(C.appliedEntryOf(op, { g: 3, lay: [["a", "t"]], texts: ["가\r\n나"], kind: "ae", ef: 22 }));
	assert.deepEqual([e.g, e.t, e.sf, e.ef, e.cef, e.k, e.ls], [3, 2, 100, 160, 22, "ae", C.clipLs([["a", "t"]])]);
	assert.equal(e.rh, C.textsHash(["가\n나"]));
	const nfd = "가".normalize("NFD");
	assert.equal(C.textsHash([nfd]), C.textsHash(["가"]));
	const a = C.intentHash({ presetId: "p", sig: "s", fh: { 0: "x" }, track: 2, sf: 1, ef: 2, m: "C:\\M\\A.mogrt", name: "n" });
	const b = C.intentHash({ presetId: "p", sig: "s", fh: { 0: "x" }, track: 2, sf: 1, ef: 2, m: "c:/m/a.mogrt", name: "n" });
	assert.equal(a, b, "경로 구분자·대소문자 무시");
	assert.notEqual(a, C.intentHash({ presetId: "p", sig: "s", fh: { 0: "x" }, track: 3, sf: 1, ef: 2, m: "c:/m/a.mogrt", name: "n" }));
});

test("캡션 필드를 찾지 못한 줄·길이 0 줄은 건너뛴다, 화자 표에 없는 화자도", () => {
	const r = row(1, "C1", 100, 160, "a");
	r.rs._allParams[0].displayName = "다른 이름";
	r.rs._allParams[0].index = 7;
	let p = plan([r]);
	assert.deepEqual([plain(p.noCaption), plain(p.rowOps[1]).skip], [[1], "no-caption-field"]);
	p = plan([row(2, "C1", 100, 160, "a"), row(3, "C1", 100, 160, "b")]);
	assert.deepEqual(plain(p.zeroLength), [2]);
	p = plan([row(4, "C9", 100, 160, "a")]);
	assert.equal(plain(p.rowOps[4]).skip, "no-speaker");
});
