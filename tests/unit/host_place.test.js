"use strict";
// S2-2: 쓰기 호스트(MI_ensureVideoTracks, MI__applyParamsSafe, MI_placeChunk, MI_removeClips)를 가짜 Premiere(tests/lib/premiereSim.js)에서.
// 하드 케이스 T1~T17(tests/premiere/cases/s2_2_place.case.js)과 같은 상황을 node에서 먼저 확인한다. 실제 Premiere 동작은 하드 케이스 몫이다.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createSim, FT, TPS, IN_POINT, aeText, num, color } = require("../lib/premiereSim");
const { loadRegions, loadHostPure, plain } = require("../lib/loadRegions");

const CORE = loadRegions(["src/mi/core.ts"]);
const HP = loadHostPure();
const BUILD = "@@BUILD@@";
const AE = "C:/m/자동 줄바꿈 박스.mogrt";
const AE2 = "C:/m/반응형 설명 자막.mogrt";
const NAT = "C:/m/baked/nb1-aaaa.mogrt";
const NAT_OLD = "C:/m/baked/nb1-bbbb.mogrt";

// 새 구조(6속성)와 옛 구조(4속성, 순서가 다르다 — index로 쓰면 틀린 속성에 들어간다, S0-3 x)
const NEW_PARAMS = [aeText("전체 텍스트", "기본"), color("박스 색상", 4278190335), num("박스 여백", 20), aeText("포인트 텍스트", "포인트"), color("포인트 색상", 4294901760), aeText("서브 포인트 텍스트", "서브")];
const OLD_PARAMS = [num("박스 여백", 10), aeText("전체 텍스트", "옛 기본"), color("박스 색상", 4278255360), aeText("서브 포인트 텍스트", "옛 서브")];

function setup(o = {}) {
	const sim = createSim();
	const seq = sim.addSequence({ name: o.name || "T_23976", id: "seq-A", ft: o.ft || FT.f23976, tracks: o.tracks || 5 });
	sim.addTemplate(AE, { kind: "ae", name: "[라온올제] 자동 줄바꿈 박스", params: NEW_PARAMS, oldParams: o.drift ? OLD_PARAMS : undefined });
	sim.addTemplate(AE2, { kind: "ae", name: "[라온올제] 반응형 설명 자막", params: [aeText("자막 1 텍스트", "a"), aeText("자막 1 포인트 텍스트", "b")] });
	sim.addTemplate(NAT, { kind: "native", texts: 2 });
	sim.addTemplate(NAT_OLD, { kind: "native", texts: 2 });
	const base = { seqId: seq.id, build: BUILD, frameTicks: seq.ft };
	const chunk = (items, extra) => sim.call("MI_placeChunk", Object.assign({}, base, { items }, extra || {}));
	return { sim, seq, base, chunk };
}
// 패널이 보내는 모양의 ParamDef (프리셋 = getMogrtParams 결과를 흉내: 호스트 MI__readParams로 타입을 매긴 목록)
function presetParams(sim, seq, base, path) {
	const probe = sim.place(seq, 4, path, 9000, 9100);
	const r = sim.call("MI_readClipTexts", Object.assign({}, base, { items: [{ track: 4, nodeId: sim.nodeId(probe) }], want: { params: true } }));
	probe.track.clips.splice(probe.track.clips.indexOf(probe), 1);
	return r.results[0].params;
}
function withCaption(params, text, idx = 0) {
	return params.map((p) => (p.index === idx ? Object.assign({}, p, { value: text }) : Object.assign({}, p)));
}
const place = (key, track, sf, ef, extra) => Object.assign({ key, op: "place", g: 1, track, sf, ef, mogrtPath: AE, durSec: 5.005, params: [], name: "철수 [MI:" + key + ".1]", guard: [] }, extra || {});
const valuesOf = (m) => m.comps.map((c) => c.props.map((p) => JSON.stringify(p.value)));

test("순수: MI__occupy — 시작을 덮으면 occupied, 안쪽 이웃은 끝 맞춤, 뒤쪽 남의 클립은 tail, guardAll, noTail", () => {
	const ft = 100;
	const L = (id, s, e) => ({ id, s: s * ft, e: e * ft });
	const occ = (list, sf, ef, hi, o = {}) => plain(HP.MI__occupy(list, sf * ft, ef * ft, hi * ft, ft, o.skip || {}, o.guard || {}, !!o.noTail, !!o.all));
	assert.deepEqual(occ([L("a", 0, 10)], 10, 20, 30).conflict, null, "끝이 딱 맞닿으면 비어 있다");
	assert.deepEqual(occ([L("a", 0, 10.4)], 10, 20, 30).conflict, null, "반 프레임 안 걸침은 무시");
	assert.deepEqual(occ([L("a", 0, 11)], 10, 20, 30).conflict, { reason: "occupied", id: "a" });
	assert.deepEqual(occ([L("a", 10, 11)], 10, 20, 30).conflict, { reason: "occupied", id: "a" }, "같은 시작");
	assert.deepEqual(occ([L("a", 0, 11)], 10, 20, 30, { skip: { na: true } }).conflict, null, "치울 클립은 건너뛴다");
	assert.deepEqual(occ([L("b", 15, 40)], 10, 20, 30).conflict, { reason: "occupied", id: "b" }, "안쪽 남의 클립");
	const g = occ([L("b", 15, 40)], 10, 20, 30, { guard: { nb: true } });
	assert.deepEqual([g.conflict, g.efT, g.clamped, g.guards.map((x) => x.id)], [null, 15 * ft, true, ["b"]], "안쪽 이웃 → 끝 맞춤 + 되돌리기");
	assert.deepEqual(occ([L("c", 25, 40)], 10, 20, 30).conflict, { reason: "tail", id: "c" });
	assert.deepEqual(occ([L("c", 25, 40)], 10, 20, 30, { all: true }).guards.map((x) => x.id), ["c"]);
	assert.deepEqual(occ([L("c", 30, 40)], 10, 20, 30).conflict, null, "덮이는 범위 밖");
	const mv = occ([L("b", 15, 40), L("c", 25, 40)], 10, 20, 20, { noTail: true });
	assert.deepEqual([mv.conflict, mv.efT, mv.clamped, mv.guards.length], [null, 15 * ft, true, 0], "옮기기: 남의 클립이어도 끝만 맞춘다");
	assert.deepEqual(occ([L("b", 10.5, 40)], 10, 20, 30, { guard: { nb: true } }).conflict, { reason: "occupied", id: "" }, "한 프레임보다 짧아지면 occupied");
	assert.equal(HP.MI__nextStart([L("x", 5, 9), L("y", 12, 20), L("z", 30, 40)], 10 * ft, {}), 12 * ft);
	assert.equal(HP.MI__nextStart([L("y", 12, 20)], 10 * ft, { ny: true }), null);
});

test("순수: MI__checkItem — 작업별 필수 항목", () => {
	const ok = { key: "ab12-1", op: "place", track: 2, sf: 10, ef: 20, mogrtPath: "x" };
	assert.equal(HP.MI__checkItem(ok), "");
	assert.equal(HP.MI__checkItem(Object.assign({}, ok, { op: "zap" })), "op: zap");
	assert.equal(HP.MI__checkItem(Object.assign({}, ok, { ef: 10 })), "ef");
	assert.equal(HP.MI__checkItem(Object.assign({}, ok, { mogrtPath: "" })), "mogrtPath");
	assert.equal(HP.MI__checkItem({ key: "k", op: "update", track: 2, keepTime: true, own: { track: 2, nodeId: "0001" } }), "", "keepTime이면 시간 없이");
	assert.equal(HP.MI__checkItem({ key: "k", op: "update", track: 2, own: { track: 2, nodeId: "0001" } }), "sf");
	assert.equal(HP.MI__checkItem({ key: "k", op: "move", track: 2, sf: 1, ef: 5 }), "own");
	assert.equal(HP.MI__checkItem({ key: "k", op: "legacyMove", track: 4, sf: 1, ef: 5, mogrtPath: "x" }), "legacyMove에는 own이나 removeAfter가 있어야 한다");
	assert.equal(HP.MI__checkItem(Object.assign({}, ok, { params: {} })), "params");
	assert.equal(HP.MI__checkItem(Object.assign({}, ok, { name: 3 })), "name");
});

test("T1 ensure → 새 V6에 3개 place: 태그 .1, 시작 = sf × frameTicks 정확히 (23.976·29.97), 끝 = ef × frameTicks, D·컴포넌트 수", () => {
	for (const ft of [FT.f23976, FT.f2997]) {
		const { sim, seq, base, chunk } = setup({ ft });
		let e = sim.call("MI_ensureVideoTracks", Object.assign({}, base, { minCount: 6 }));
		assert.deepEqual(e, { ok: true, before: 5, after: 6, added: 1 });
		e = sim.call("MI_ensureVideoTracks", Object.assign({}, base, { minCount: 4 }));
		assert.deepEqual(e, { ok: true, before: 6, after: 6, added: 0 }, "이미 있으면 그대로");
		assert.equal(sim.call("MI_ensureVideoTracks", Object.assign({}, base, { minCount: 0 })).error, "bad-payload");
		const P = presetParams(sim, seq, base, AE);
		const spans = [[24, 70], [719, 760], [100000, 100030]];
		const items = spans.map(([sf, ef], i) => place("ab12-" + (i + 1), 5, sf, ef, { params: withCaption(P, "캡션 " + (i + 1)) }));
		const r = chunk(items);
		assert.equal(r.ok, true, JSON.stringify(r));
		assert.equal(r.done, 3);
		const clips = sim.clips(seq, 5);
		assert.equal(clips.length, 3);
		r.results.forEach((x, i) => {
			assert.equal(x.status, "placed", JSON.stringify(x));
			assert.equal(x.name, "철수 [MI:ab12-" + (i + 1) + ".1]");
			assert.deepEqual([x.sf, x.ef, x.track, x.g], [spans[i][0], spans[i][1], 5, 1]);
			assert.equal(clips[i].s, spans[i][0] * ft, "시작 ticks 정확");
			assert.equal(clips[i].e, spans[i][1] * ft, "끝 ticks 정확 (스냅되지 않는 끝)");
			assert.equal(x.nodeId, clips[i].nodeId);
			assert.equal(x.texts[0], "캡션 " + (i + 1));
			assert.equal(x.pin, "[라온올제] 자동 줄바꿈 박스");
			assert.deepEqual(x.deco, { comps: 3, keyed: [] });
		});
		const dF = Math.round((5.005 * TPS) / ft);
		assert.deepEqual(r.dur, { [AE]: (dF * ft) / TPS });
		assert.deepEqual(r.comps, { [AE]: 3 });
		assert.deepEqual([sim.S.counts.importMGT, sim.S.counts.overwriteClip], [1, 2], "첫 클립만 importMGT, 나머지는 이 청크에서 캐시한 projectItem으로 overwriteClip");
		assert.deepEqual(r.damaged, []);
	}
});

test("T2 update: nodeId 그대로, before는 타입 있는 ParamDef, before를 다시 쓰면 모든 속성 raw 값이 정확히 돌아온다 (AE)", () => {
	const { sim, seq, base, chunk } = setup();
	const P = presetParams(sim, seq, base, AE);
	const r0 = chunk([place("ab12-1", 2, 100, 150, { params: withCaption(P, "처음 캡션") }), place("ab12-2", 2, 200, 250, { params: withCaption(P, "둘째") })]);
	const ids = r0.results.map((x) => x.nodeId);
	const snap0 = sim.clips(seq, 2).map(valuesOf);
	const upd = (params, extra) => r0.results.map((x, i) => Object.assign({ key: x.key, op: "update", g: 1, track: 2, sf: x.sf, ef: x.ef, own: { track: 2, sf: x.sf, nodeId: x.nodeId }, params: params(i), name: x.name }, extra || {}));
	const changed = (i) => withCaption(P, "바뀐 캡션 " + i).map((p) => (p.displayName === "박스 여백" ? Object.assign({}, p, { value: "33" }) : p));
	const r1 = chunk(upd(changed));
	assert.deepEqual(r1.results.map((x) => [x.status, x.nodeId]), [["updated", ids[0]], ["updated", ids[1]]]);
	assert.equal(sim.textOf(sim.clips(seq, 2)[0], "전체 텍스트"), "바뀐 캡션 0");
	assert.equal(sim.prop(sim.clips(seq, 2)[1], "박스 여백").value, 33);
	const before = r1.results.map((x) => x.before);
	before.forEach((b) => {
		assert.ok(Array.isArray(b) && b.length === NEW_PARAMS.length);
		assert.deepEqual(b.map((p) => p.type), ["text", "color", "number", "text", "color", "text"]);
		assert.ok(b.every((p) => !("colorHex" in p) && typeof p.rawValue === "string"));
	});
	assert.equal(before[0][0].value, "처음 캡션");
	// 되돌리기처럼 before를 그대로 다시 쓴다
	const r2 = chunk(upd((i) => before[i]));
	assert.deepEqual(r2.results.map((x) => x.status), ["updated", "updated"]);
	assert.deepEqual(sim.clips(seq, 2).map(valuesOf), snap0, "모든 속성 값이 처음과 같다");
	assert.deepEqual(sim.clips(seq, 2).map((c) => c.nodeId), ids);
});

test("T2 네이티브: Source Text에는 절대 쓰지 않는다 — 같은 값은 건너뛰고, 다른 값은 skipped(partial), before 다시 쓰기는 그대로", () => {
	const { sim, seq, base, chunk } = setup();
	const r0 = chunk([place("ab12-1", 3, 100, 150, { mogrtPath: NAT })]);
	assert.equal(r0.results[0].status, "placed");
	assert.equal(r0.results[0].kind, "native");
	assert.equal(r0.results[0].pin, null);
	const x = r0.results[0];
	const own = { track: 3, sf: 100, nodeId: x.nodeId };
	const r1 = chunk([{ key: "ab12-1", op: "update", g: 1, track: 3, sf: 100, ef: 150, own, params: [{ index: 0, type: "text", displayName: "텍스트 1", value: "새 문구", nativeText: true }], name: x.name }]);
	assert.deepEqual([r1.results[0].status, r1.results[0].skipped], ["partial", ["텍스트 1"]]);
	assert.deepEqual(r1.results[0].before.map((p) => [p.type, p.value, p.nativeText]), [["text", "", true], ["text", "", true]]);
	const r2 = chunk([{ key: "ab12-1", op: "update", g: 1, track: 3, sf: 100, ef: 150, own, params: r1.results[0].before, name: x.name }]);
	assert.deepEqual([r2.results[0].status, r2.results[0].skipped], ["updated", []]);
	assert.equal(sim.S.counts.nativeTextWrites, 0, "네이티브 Source Text setValue 0번");
});

test("T3 끝 맞추기: 안쪽에서 시작하는 이웃(guard)이면 끝을 그 시작에, 갱신도 다음 클립 시작까지만", () => {
	const { sim, seq, chunk } = setup();
	const nb = sim.place(seq, 2, AE, 140, 400, "철수 [MI:ab12-9.1]"); // 놓으면 [100, 220)이 머리를 덮는다
	const nbIn = nb.inT;
	const r = chunk([place("ab12-1", 2, 100, 160, { guard: [sim.nodeId(nb)] })]);
	const x = r.results[0];
	assert.deepEqual([x.status, x.clamped, x.ef], ["placed", true, 140]);
	assert.deepEqual([nb.s, nb.e, nb.inT, nb.removed], [140 * seq.ft, 400 * seq.ft, nbIn, false], "이웃은 그대로 (머리를 되돌렸다)");
	assert.deepEqual(r.damaged, []);
	// 갱신: 끝을 늘리면 다음 클립 시작에서 멈춘다
	const u = chunk([{ key: "ab12-1", op: "update", g: 1, track: 2, sf: 100, ef: 180, own: { track: 2, sf: 100, nodeId: x.nodeId }, params: [], name: x.name }]);
	assert.deepEqual([u.results[0].status, u.results[0].clamped, u.results[0].ef], ["updated", true, 140]);
	const k = chunk([{ key: "ab12-1", op: "update", g: 1, track: 2, keepTime: true, own: { track: 2, sf: 100, nodeId: x.nodeId }, params: [], name: x.name }]);
	assert.deepEqual([k.results[0].ef, k.results[0].clamped], [140, false], "keepTime이면 끝을 건드리지 않는다");
});

test("T4 남의 클립: 시작을 덮으면 occupied, 뒤쪽이면 tail — 아무것도 놓지 않는다. D를 모르면 60초 안을 본다", () => {
	const { sim, seq, chunk } = setup();
	sim.placeOther(seq, 2, 90, 110, "b-roll.mp4");
	sim.placeOther(seq, 3, 180, 300, "logo.png");
	const before = sim.all(seq);
	let r = chunk([place("ab12-1", 2, 100, 150)]);
	assert.deepEqual([r.results[0].status, r.results[0].reason], ["conflict", "occupied"]);
	r = chunk([place("ab12-2", 3, 100, 150)]);
	assert.deepEqual([r.results[0].status, r.results[0].reason], ["conflict", "tail"], "놓으면 [100, 220)이 logo 머리를 자른다");
	assert.equal(sim.all(seq), before, "클립 수 그대로");
	assert.equal(sim.S.counts.importMGT, 0);
	// 템플릿 길이를 모르면(durSec 없음) 60초 안의 남의 클립을 tail로 본다. 알면 놓는다
	sim.placeOther(seq, 4, 1500, 1600, "far.png");
	r = chunk([place("ab12-3", 4, 1000, 1050, { durSec: undefined })]);
	assert.deepEqual([r.results[0].status, r.results[0].reason], ["conflict", "tail"]);
	assert.match(r.results[0].detail, /60초/);
	r = chunk([place("ab12-3", 4, 1000, 1050)]);
	assert.equal(r.results[0].status, "placed");
});

test("T5 잠긴 트랙 → locked, T6 트랙 번호 ≥ 트랙 수(ensure 없이) → no-track이고 어디에도 클립이 생기지 않는다", () => {
	const { sim, seq, chunk } = setup();
	seq.tracks[3].locked = true;
	let r = chunk([place("ab12-1", 3, 100, 150)]);
	assert.equal(r.results[0].status, "locked");
	const n0 = sim.all(seq);
	r = chunk([place("ab12-2", 5, 100, 150), place("ab12-3", 9, 100, 150)]);
	assert.deepEqual(r.results.map((x) => [x.status, x.reason]), [["failed", "no-track"], ["failed", "no-track"]]);
	assert.equal(sim.all(seq), n0, "마지막 트랙에도 놓이지 않았다 (spike #14)");
	assert.equal(sim.S.counts.importMGT, 0);
});

test("T7 moveRegen V4 → V5: V5에 gen 2, 옛 클립은 nodeId로 지운다. T8 중단(옛 gen 남음) → scanIndex stale", () => {
	const { sim, seq, base, chunk } = setup();
	const old = sim.place(seq, 3, AE, 100, 150, "영희 [MI:ab12-7.1]", { texts: ["옛 자리"] });
	const oldId = sim.nodeId(old);
	const r = chunk([{ key: "ab12-7", op: "moveRegen", g: 2, track: 4, sf: 300, ef: 360, own: { track: 3, sf: 100, nodeId: oldId }, mogrtPath: AE, durSec: 5.005, params: [], name: "영희 [MI:ab12-7.2]", guard: [] }]);
	const x = r.results[0];
	assert.deepEqual([x.status, x.track, x.sf, x.ef, x.name, x.reason], ["moved", 4, 300, 360, "영희 [MI:ab12-7.2]", ""]);
	assert.equal(old.removed, true);
	assert.deepEqual([x.before.track, x.before.sf, x.before.ef, x.before.g, x.before.name, x.before.kind], [3, 100, 150, 1, "영희 [MI:ab12-7.1]", "ae"]);
	assert.equal(x.before.params[0].value, "옛 자리");
	assert.match(String(x.before.pi), /^[0-9a-f]{8}$/);
	// 중단: gen 2를 놓았는데 옛 gen 1을 지우지 못한 채 끝남 → 다음 스캔에서 stale
	sim.place(seq, 3, AE, 500, 550, "영희 [MI:ab12-8.1]");
	chunk([place("ab12-8", 4, 700, 760, { name: "영희 [MI:ab12-8.2]" })]);
	const scan = sim.call("MI_getTracks", Object.assign({}, base, { tracks: [3, 4] }));
	const idx = CORE.scanIndex(scan, "ab12");
	assert.deepEqual(Array.from(idx.stale, (c) => c.name), ["영희 [MI:ab12-8.1]"]);
	assert.equal(idx.current["ab12-8"].track, 4);
	assert.equal(idx.current["ab12-7"].sf, 300);
});

test("T9 자르기 → ambiguous (nodeId로 찾아도 같은 태그가 둘), stale-plan (없어짐·옮겨짐), 태그로 다시 찾기", () => {
	const { sim, seq, chunk } = setup();
	const c = sim.place(seq, 2, AE, 100, 200, "철수 [MI:ab12-1.1]");
	const id = sim.nodeId(c);
	sim.razor(seq, 2, 150);
	const upd = (own, extra) => Object.assign({ key: "ab12-1", op: "update", g: 1, track: 2, keepTime: true, own, params: [], name: "철수 [MI:ab12-1.1]" }, extra || {});
	let r = chunk([upd({ track: 2, sf: 100, nodeId: id })]);
	assert.equal(r.results[0].status, "ambiguous");
	const d = sim.place(seq, 3, AE, 100, 200, "철수 [MI:ab12-2.1]");
	const did = sim.nodeId(d);
	r = chunk([upd({ track: 3, sf: 100, nodeId: "deadbeef" }, { key: "ab12-2", name: "철수 [MI:ab12-2.1]" })]);
	assert.deepEqual([r.results[0].status, r.results[0].nodeId], ["updated", did], "nodeId가 달라도 태그(uid)와 sf ±1로 찾는다");
	r = chunk([upd({ track: 3, sf: 100, nodeId: "deadbeef" }, { key: "ab12-2", name: null })]);
	assert.deepEqual([r.results[0].status, r.results[0].reason], ["stale-plan", "not-found"], "태그 없는 작업은 nodeId로만");
	r = chunk([upd({ track: 3, sf: 90, nodeId: did }, { key: "ab12-2" })]);
	assert.deepEqual([r.results[0].status, r.results[0].reason], ["stale-plan", "moved"]);
});

test("T10 removeClips: nodeId로 지우고 before를 준다, expectName이 다르면 notOurs, 없으면 notFound, 잠겼으면 locked", () => {
	const { sim, seq, base } = setup();
	const a = sim.place(seq, 2, AE, 100, 150, "철수 [MI:ab12-1.1]", { texts: ["지울 문장"] });
	const b = sim.place(seq, 2, AE, 300, 350, "사용자가 바꾼 이름");
	const l = sim.place(seq, 3, AE, 100, 150, "철수 [MI:ab12-3.1]");
	seq.tracks[3].locked = true;
	const r = sim.call("MI_removeClips", Object.assign({}, base, { items: [
		{ key: "ab12-1", track: 2, nodeId: sim.nodeId(a), expectName: "철수 [MI:ab12-1.1]" },
		{ key: "ab12-2", track: 2, nodeId: sim.nodeId(b), expectName: "철수 [MI:ab12-2.1]" },
		{ key: "ab12-9", track: 2, nodeId: "ffffffff", expectName: null },
		{ key: "ab12-3", track: 3, nodeId: sim.nodeId(l), expectName: null },
		{ key: "x", track: 2 }
	] }));
	assert.deepEqual(r.results.map((x) => x.status), ["removed", "notOurs", "notFound", "locked", "failed"]);
	assert.deepEqual([a.removed, b.removed, l.removed], [true, false, false]);
	const bf = r.results[0].before;
	assert.deepEqual([bf.track, bf.sf, bf.ef, bf.g, bf.name, bf.kind, bf.m], [2, 100, 150, 1, "철수 [MI:ab12-1.1]", "ae", null]);
	assert.equal(bf.params[0].value, "지울 문장");
	assert.equal(r.results[1].name, "사용자가 바꾼 이름");
});

test("T11 이웃: guard 이웃의 잘린 머리를 되돌린다(R: nodeId·시작·끝·inPoint 그대로), 통째로 덮인 이웃은 damaged(C)", () => {
	const { sim, seq, chunk } = setup();
	const n1 = sim.place(seq, 2, AE, 124, 300, "철수 [MI:ab12-2.1]"); // S + 24f(1초) 뒤, [100, 220)에 머리가 덮인다
	const n2 = sim.place(seq, 3, AE, 130, 180, "철수 [MI:ab12-5.1]"); // [100, 220) 안에 통째로
	const s1 = [n1.nodeId || sim.nodeId(n1), n1.s, n1.e, n1.inT];
	const id2 = sim.nodeId(n2);
	const r = chunk([place("ab12-1", 2, 100, 120, { guard: [s1[0]] }), place("ab12-4", 3, 100, 120, { guard: [id2] })]);
	assert.deepEqual(r.results.map((x) => x.status), ["placed", "placed"]);
	assert.deepEqual([n1.nodeId, n1.s, n1.e, n1.inT, n1.removed], [s1[0], s1[1], s1[2], s1[3], false], "머리 되돌림");
	assert.equal(n2.removed, true);
	assert.deepEqual(r.damaged, [id2], "되돌리지 못한 이웃 → 패널이 다시 놓는다");
	assert.equal(n1.inT, IN_POINT);
});

test("T12 replace: 새 템플릿을 놓지 못하면 옛 템플릿을 되놓는다 (AE는 projectItem, 네이티브는 own.m), 네이티브에 m이 없으면 template-unknown", () => {
	const { sim, seq, base, chunk } = setup();
	// AE → 없는 경로. 옛 클립은 이 호스트로 놓은 것 (applyParamsToItem이 쓴 텍스트 JSON 모양 그대로 되돌아오는지 본다)
	const P = presetParams(sim, seq, base, AE);
	const r0 = chunk([place("ab12-1", 2, 100, 150, { params: withCaption(P, "옛 문장") })]);
	const a = sim.clips(seq, 2)[0];
	assert.equal(a.nodeId, r0.results[0].nodeId);
	const aVals = valuesOf(a);
	let r = chunk([{ key: "ab12-1", op: "replace", g: 2, track: 2, sf: 100, ef: 150, own: { track: 2, sf: 100, nodeId: sim.nodeId(a) }, mogrtPath: "C:/m/없는.mogrt", durSec: 5.005, params: [], name: "철수 [MI:ab12-1.2]" }]);
	let x = r.results[0];
	assert.deepEqual([x.status, x.reason], ["failed", "restored-old"]);
	const back = sim.clips(seq, 2);
	assert.equal(back.length, 1);
	assert.deepEqual(valuesOf(back[0]), aVals, "속성 그대로");
	assert.deepEqual([back[0].name, back[0].s, back[0].e], ["철수 [MI:ab12-1.1]", 100 * seq.ft, 150 * seq.ft]);
	assert.equal(x.nodeId, back[0].nodeId);
	// 네이티브 → 없는 경로, own.m(구운 경로)으로 되놓는다
	const n = sim.place(seq, 3, NAT_OLD, 100, 150, "철수 [MI:ab12-2.1]");
	r = chunk([{ key: "ab12-2", op: "replace", g: 2, track: 3, sf: 100, ef: 150, own: { track: 3, sf: 100, nodeId: sim.nodeId(n), m: NAT_OLD }, mogrtPath: "C:/m/baked/없는.mogrt", durSec: 5.005, params: [], name: "철수 [MI:ab12-2.2]" }]);
	x = r.results[0];
	assert.deepEqual([x.status, x.reason, x.kind], ["failed", "restored-old", "native"]);
	assert.deepEqual(sim.clips(seq, 3).map((c) => [c.tpl.path, c.name]), [[NAT_OLD, "철수 [MI:ab12-2.1]"]]);
	// 네이티브, m 없음 → 시작하지 않는다
	const n3 = sim.place(seq, 4, NAT_OLD, 100, 150, "철수 [MI:ab12-3.1]");
	r = chunk([{ key: "ab12-3", op: "replace", g: 2, track: 4, sf: 100, ef: 150, own: { track: 4, sf: 100, nodeId: sim.nodeId(n3) }, mogrtPath: NAT, durSec: 5.005, params: [], name: "철수 [MI:ab12-3.2]" }]);
	assert.deepEqual([r.results[0].status, r.results[0].reason], ["conflict", "template-unknown"]);
	assert.equal(n3.removed, false);
	// 성공하는 replace: 새 템플릿, gen 2, before에 옛 템플릿 식별자
	r = chunk([{ key: "ab12-3", op: "replace", g: 2, track: 4, sf: 100, ef: 150, own: { track: 4, sf: 100, nodeId: sim.nodeId(n3), m: NAT_OLD }, mogrtPath: NAT, durSec: 5.005, params: [], name: "철수 [MI:ab12-3.2]" }]);
	x = r.results[0];
	assert.deepEqual([x.status, x.name, x.before.m, x.before.kind], ["replaced", "철수 [MI:ab12-3.2]", NAT_OLD, "native"]);
	assert.equal(sim.clips(seq, 4)[0].tpl.path, NAT);
	assert.equal(sim.S.counts.nativeTextWrites, 0);
});

test("T13 seq-mismatch·build-mismatch·frameTicks가 다르면 아무것도 하지 않는다", () => {
	const { sim, base } = setup();
	const items = [place("ab12-1", 2, 100, 150)];
	assert.equal(sim.call("MI_placeChunk", Object.assign({}, base, { seqId: "other", items })).error, "seq-mismatch");
	assert.equal(sim.call("MI_placeChunk", Object.assign({}, base, { build: "dev-x", items })).error, "build-mismatch");
	assert.equal(sim.call("MI_placeChunk", Object.assign({}, base, { frameTicks: FT.f2997, items })).error, "bad-payload");
	assert.equal(sim.call("MI_removeClips", Object.assign({}, base, { seqId: "other", items: [] })).error, "seq-mismatch");
	assert.equal(sim.call("MI_ensureVideoTracks", Object.assign({}, base, { seqId: "other", minCount: 9 })).error, "seq-mismatch");
	assert.equal(sim.S.counts.importMGT + sim.S.counts.addTracks, 0);
});

test("T14 예산: 8개는 기본 예산 안에 모두, 시계가 7초를 넘기면 새 작업을 시작하지 않는다 (done < items)", () => {
	const { sim, chunk } = setup();
	const items = Array.from({ length: 8 }, (_, i) => place("ab12-" + (i + 1), 2, 100 + i * 200, 150 + i * 200));
	let r = chunk(items);
	assert.deepEqual([r.done, r.results.length], [8, 8]);
	// 가짜 시계: getTime을 부를 때마다 1.5초
	let t = 0;
	sim.ctx.Date = function FakeDate() { this.getTime = () => (t += 1500); };
	const items2 = Array.from({ length: 8 }, (_, i) => place("cd34-" + (i + 1), 3, 100 + i * 200, 150 + i * 200));
	r = chunk(items2);
	assert.ok(r.done >= 1 && r.done < 8, "done " + r.done);
	assert.equal(r.results.length, r.done);
});

test("T15 키프레임이 있는 MOGRT 속성 → partial + keyed, 값은 그대로", () => {
	const { sim, seq, base, chunk } = setup();
	const P = presetParams(sim, seq, base, AE);
	const c = sim.place(seq, 2, AE, 100, 150, "철수 [MI:ab12-1.1]");
	sim.prop(c, "박스 여백").keyed = true;
	const params = P.map((p) => (p.displayName === "박스 여백" ? Object.assign({}, p, { value: "77" }) : p.displayName === "전체 텍스트" ? Object.assign({}, p, { value: "키 옆 캡션" }) : p));
	const r = chunk([{ key: "ab12-1", op: "update", g: 1, track: 2, sf: 100, ef: 150, own: { track: 2, sf: 100, nodeId: sim.nodeId(c) }, params, name: "철수 [MI:ab12-1.1]" }]);
	assert.deepEqual([r.results[0].status, r.results[0].keyed, r.results[0].skipped], ["partial", ["박스 여백"], []]);
	assert.equal(sim.prop(c, "박스 여백").value, 20, "키 있는 속성은 쓰지 않았다");
	assert.equal(sim.textOf(c, "전체 텍스트"), "키 옆 캡션", "나머지는 썼다");
});

test("T16 옛 구조(4속성) 클립 + 새 구조(6속성) 프리셋 params → 이름으로 쓴다: 캡션은 '전체 텍스트', 색은 제자리, 새 전용 속성은 skipped", () => {
	const { sim, seq, base, chunk } = setup({ drift: true });
	const P = presetParams(sim, seq, base, AE);
	assert.deepEqual(P.map((p) => p.displayName), NEW_PARAMS.map((p) => p.displayName));
	const old = sim.place(seq, 2, AE, 100, 150, "철수 [MI:ab12-1.1]", { old: true });
	assert.deepEqual(sim.capsule(old).props.map((p) => p.displayName), OLD_PARAMS.map((p) => p.displayName));
	const params = P.map((p) => {
		if (p.displayName === "전체 텍스트") return Object.assign({}, p, { value: "옛 클립 캡션" });
		if (p.displayName === "박스 색상") return Object.assign({}, p, { value: "#ff0000", colorHex: "#ff0000" });
		return p;
	});
	const r = chunk([{ key: "ab12-1", op: "update", g: 1, track: 2, keepTime: true, own: { track: 2, sf: 100, nodeId: sim.nodeId(old) }, params, name: "철수 [MI:ab12-1.1]" }]);
	const x = r.results[0];
	assert.equal(x.status, "partial");
	assert.deepEqual(x.skipped, ["포인트 텍스트", "포인트 색상"], "옛 버전에 없는 속성");
	assert.equal(sim.textOf(old, "전체 텍스트"), "옛 클립 캡션");
	assert.equal(sim.prop(old, "박스 색상").value, 4294901760, "박스 색상 = #ff0000 (index 1이 아니라 이름으로 찾은 index 2)");
	assert.equal(sim.prop(old, "박스 여백").value, 20, "박스 여백은 새 프리셋 값(20)으로 — index 0이 아니라 이름으로");
	assert.equal(sim.textOf(old, "서브 포인트 텍스트"), "서브");
	assert.deepEqual(x.lay.map((l) => l[0]), OLD_PARAMS.map((p) => p.displayName), "되읽은 lay는 옛 구조");
});

test("itemCache: 캐시로 overwriteClip한 클립의 구조가 importMGT와 다르면(재저장된 MOGRT) 지우고 캐시를 끈다", () => {
	const { sim, seq, chunk } = setup({ drift: true });
	const r = chunk([place("ab12-1", 2, 100, 150), place("ab12-2", 2, 300, 350), place("ab12-3", 2, 500, 550)]);
	assert.deepEqual(r.results.map((x) => x.status), ["placed", "placed", "placed"]);
	assert.ok(r.results.every((x) => x.lay.length === NEW_PARAMS.length), "모두 새 구조");
	assert.deepEqual([sim.S.counts.importMGT, sim.S.counts.overwriteClip], [3, 1], "옛 구조가 나온 뒤로는 importMGT만");
	assert.equal(sim.clips(seq, 2).length, 3, "옛 구조 클립은 남지 않았다");
});

test("misplaced: importMGT가 다른 트랙에 놓으면 지우고 misplaced", () => {
	const { sim, seq, chunk } = setup();
	sim.S.misplaceNext = true;
	const r = chunk([place("ab12-1", 2, 100, 150)]);
	assert.deepEqual([r.results[0].status, r.results[0].reason], ["misplaced", "misplaced"]);
	assert.equal(sim.all(seq), 0);
});

test("T17 move: nodeId·이름·효과·키프레임 그대로, 시작 = sf, 끝 = ef. 자리가 막혀 있으면 conflict, 안쪽 클립이면 끝 맞춤", () => {
	const { sim, seq, chunk } = setup();
	const c = sim.place(seq, 2, AE, 100, 150, "철수 [MI:ab12-1.1]", { texts: ["움직일 문장"] });
	sim.addEffect(c);
	sim.keyMotion(c);
	const id = sim.nodeId(c);
	const mv = (sf, ef) => ({ key: "ab12-1", op: "move", g: 1, track: 2, sf, ef, own: { track: 2, sf: c.s / seq.ft, nodeId: id }, params: [], name: "철수 [MI:ab12-1.1]" });
	let r = chunk([mv(40, 110)]);
	let x = r.results[0];
	assert.deepEqual([x.status, x.nodeId, x.sf, x.ef, x.name], ["moved", id, 40, 110, "철수 [MI:ab12-1.1]"]);
	assert.deepEqual([c.s, c.e], [40 * seq.ft, 110 * seq.ft]);
	assert.equal(c.comps.length, 4, "효과 그대로");
	assert.equal(c.comps.find((k) => k.matchName === "AE.ADBE Motion").props[0].keyed, true, "키프레임 그대로");
	assert.equal(sim.textOf(c, "전체 텍스트"), "움직일 문장");
	assert.deepEqual([x.before.sf, x.before.ef], [100, 150]);
	sim.placeOther(seq, 2, 300, 400, "b-roll.mp4");
	r = chunk([mv(310, 350)]);
	assert.deepEqual([r.results[0].status, r.results[0].reason], ["conflict", "occupied"]);
	r = chunk([mv(250, 330)]);
	x = r.results[0];
	assert.deepEqual([x.status, x.clamped, x.sf, x.ef], ["moved", true, 250, 300]);
	r = chunk([Object.assign(mv(10, 30), { track: 3 })]);
	assert.deepEqual([r.results[0].status, r.results[0].reason], ["failed", "bad-item"], "다른 트랙은 moveRegen");
});

test("adopt: 태그 없는 클립에 태그를 쓰고 속성을 이름으로, legacyMove: 화자 트랙에 새로 놓고 레거시 클립을 지운다", () => {
	const { sim, seq, base, chunk } = setup();
	const P = presetParams(sim, seq, base, AE);
	const v27 = sim.place(seq, 2, AE, 100, 150, null, { texts: ["v27 문장"] });
	const r = chunk([{ key: "ab12-1", op: "adopt", g: 1, track: 2, sf: 100, ef: 160, own: { track: 2, sf: 100, nodeId: sim.nodeId(v27) }, params: withCaption(P, "v27 문장"), name: "철수 [MI:ab12-1.1]" }]);
	assert.deepEqual([r.results[0].status, v27.name, v27.e], ["adopted", "철수 [MI:ab12-1.1]", 160 * seq.ft]);
	assert.equal(r.results[0].before[0].value, "v27 문장");
	const leg = sim.place(seq, 2, AE, 400, 450, null, { texts: ["레거시"] });
	const l = chunk([{ key: "ab12-2", op: "legacyMove", g: 1, track: 4, sf: 400, ef: 450, own: null, removeAfter: { track: 2, nodeId: sim.nodeId(leg) }, mogrtPath: AE, durSec: 5.005, params: withCaption(P, "레거시"), name: "영희 [MI:ab12-2.1]" }]);
	assert.deepEqual([l.results[0].status, l.results[0].track, leg.removed], ["moved", 4, true]);
	assert.equal(l.results[0].before.name, "[라온올제] 자동 줄바꿈 박스");
	assert.equal(sim.textOf(sim.clips(seq, 4)[0], "전체 텍스트"), "레거시");
});

test("name:null이면 이름을 건드리지 않는다 (레거시 안전 경로), 잘못된 작업은 bad-item, 예외는 작업 하나만 failed", () => {
	const { sim, seq, chunk } = setup();
	const r = chunk([place("ab12-1", 2, 100, 150, { name: null }), { key: "bad", op: "place", track: 2 }, place("ab12-3", 2, 400, 450)]);
	assert.deepEqual(r.results.map((x) => [x.status, x.reason]), [["placed", ""], ["failed", "bad-item"], ["placed", ""]]);
	assert.equal(sim.clips(seq, 2)[0].name, "[라온올제] 자동 줄바꿈 박스", "템플릿 이름 그대로");
	assert.equal(sim.call("MI_placeChunk", { seqId: "seq-A", build: BUILD, items: "x" }).error, "bad-payload");
	assert.equal(sim.call("MI_placeChunk", { seqId: "seq-A", build: BUILD, items: Array.from({ length: 61 }, () => ({})) }).error, "bad-payload");
});
