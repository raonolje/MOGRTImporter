"use strict";
// S4-1: 화면 위치 호스트 — MI__motionPos, MI_setMotion, MI_placeChunk의 motion을 가짜 Premiere(tests/lib/premiereSim.js)에서.
// 실제 Premiere 동작(AE·네이티브 되읽기, 키 보존, 40개 10초, 다시 놓은 클립의 위치)은 하드 케이스 tests/premiere/cases/s4_1_motion.case.js 몫이다.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createSim, FT, aeText, num } = require("../lib/premiereSim");
const { loadHostPure, plain } = require("../lib/loadRegions");

const HP = loadHostPure();
const BUILD = "@@BUILD@@";
const AE = "C:/m/자동 줄바꿈 박스.mogrt";
const NAT = "C:/m/baked/nb1-aaaa.mogrt";

function setup(o = {}) {
	const sim = createSim();
	const seq = sim.addSequence({ name: "T_23976", id: "seq-A", ft: FT.f23976, tracks: o.tracks || 5 });
	sim.addTemplate(AE, { kind: "ae", name: "[라온올제] 자동 줄바꿈 박스", params: [aeText("전체 텍스트", "기본"), num("박스 여백", 20)] });
	sim.addTemplate(NAT, { kind: "native", texts: 2 });
	const base = { seqId: seq.id, build: BUILD };
	const chunk = (items) => sim.call("MI_placeChunk", Object.assign({}, base, { frameTicks: seq.ft, items }));
	const setMotion = (items, extra) => sim.call("MI_setMotion", Object.assign({}, base, { items }, extra || {}));
	return { sim, seq, base, chunk, setMotion };
}
const tag = (n, g) => "철수 [MI:ab12-" + n + "." + g + "]";
const place = (n, track, sf, ef, extra) => Object.assign({ key: "ab12-" + n, op: "place", g: 1, track, sf, ef, mogrtPath: AE, durSec: 5.005, params: [], name: tag(n, 1), guard: [] }, extra || {});
const near = (a, b) => Math.abs(a - b) <= 1e-9;

test("순수: MI__motionOk·MI__vec2·MI__checkItem motion", () => {
	assert.equal(HP.MI__motionOk({ x: 0.35, y: 0.5 }), true);
	assert.equal(HP.MI__motionOk({ x: 0, y: -0.2 }), true, "쌓기는 0 밑으로 갈 수 있다");
	assert.equal(HP.MI__motionOk({ x: 960, y: 540 }), false, "픽셀 좌표는 받지 않는다");
	assert.equal(HP.MI__motionOk({ x: "0.5", y: 0.5 }), false);
	assert.equal(HP.MI__motionOk({ x: NaN, y: 0.5 }), false);
	assert.equal(HP.MI__motionOk([0.5, 0.5]), false);
	assert.equal(HP.MI__motionOk(null), false);
	assert.deepEqual(plain(HP.MI__vec2([0.25, 0.75])), [0.25, 0.75]);
	assert.equal(HP.MI__vec2("0.5,0.5"), null);
	assert.equal(HP.MI__vec2([0.5]), null);
	assert.equal(HP.MI__vec2(null), null);
	const ok = { key: "ab12-1", op: "place", track: 2, sf: 10, ef: 20, mogrtPath: "x" };
	assert.equal(HP.MI__checkItem(Object.assign({}, ok, { motion: null })), "");
	assert.equal(HP.MI__checkItem(Object.assign({}, ok, { motion: { x: 0.35, y: 0.5 } })), "");
	assert.equal(HP.MI__checkItem(Object.assign({}, ok, { motion: { x: 0.35 } })), "motion");
});

test("place + motion → Position (0.35, 0.5) 되읽기, motion applied · motion 없으면 none (위치 그대로)", () => {
	const { sim, seq, chunk } = setup();
	const r = chunk([place(1, 2, 100, 150, { motion: { x: 0.35, y: 0.5 } }), place(2, 2, 300, 350)]);
	assert.equal(r.ok, true, JSON.stringify(r));
	const [a, b] = r.results;
	assert.deepEqual([a.status, a.motion], ["placed", "applied"]);
	assert.ok(near(a.pos[0], 0.35) && near(a.pos[1], 0.5), JSON.stringify(a.pos));
	assert.equal(a.pos0, undefined, "새로 놓은 클립은 쓰기 전 값(템플릿 기본)을 적지 않는다");
	assert.deepEqual([b.status, b.motion, b.pos], ["placed", "none", undefined]);
	const [ca, cb] = sim.clips(seq, 2);
	assert.deepEqual(sim.posOf(ca), [0.35, 0.5]);
	assert.deepEqual(sim.posOf(cb), [0.5, 0.5], "motion 없는 작업은 Motion을 건드리지 않는다");
	assert.equal(sim.S.counts.setTimeVarying, 0);
});

test("update·move + motion → 쓰기 전 값 pos0, 속성·텍스트 그대로 (motion만)", () => {
	const { sim, seq, chunk } = setup();
	let r = chunk([place(1, 2, 100, 150, { motion: { x: 0.35, y: 0.5 } }), place(2, 2, 300, 350)]);
	const [p1, p2] = r.results;
	const texts0 = [p1.texts, p2.texts];
	r = chunk([
		{ key: "ab12-1", op: "update", g: 1, track: 2, keepTime: true, own: { track: 2, sf: 100, nodeId: p1.nodeId }, params: [], name: null, motion: { x: 0.65, y: 0.5 } },
		{ key: "ab12-2", op: "move", g: 1, track: 2, sf: 310, ef: 360, own: { track: 2, sf: 300, nodeId: p2.nodeId }, params: [], name: null, motion: { x: 0.5, y: 0.35 } }
	]);
	const [u, m] = r.results;
	assert.deepEqual([u.status, u.motion, u.nodeId], ["updated", "applied", p1.nodeId]);
	assert.deepEqual(plain(u.pos0), [0.35, 0.5], "update: 쓰기 전 값");
	assert.deepEqual([m.status, m.motion, m.nodeId, m.sf], ["moved", "applied", p2.nodeId, 310]);
	assert.deepEqual(plain(m.pos0), [0.5, 0.5]);
	assert.deepEqual([u.texts, m.texts], texts0, "텍스트 되읽기 그대로");
	const [c1, c2] = sim.clips(seq, 2);
	assert.deepEqual([sim.posOf(c1), sim.posOf(c2)], [[0.65, 0.5], [0.5, 0.35]]);
	assert.equal(sim.textOf(c1, "전체 텍스트"), "기본");
});

test("키가 있는 Position → keyframed, 값 그대로, setTimeVarying을 부르지 않는다 (placeChunk update · setMotion)", () => {
	const { sim, seq, chunk, setMotion } = setup();
	const r0 = chunk([place(1, 2, 100, 150, { motion: { x: 0.35, y: 0.5 } })]);
	const c = sim.clips(seq, 2)[0];
	sim.keyMotion(c);
	const r = chunk([{ key: "ab12-1", op: "update", g: 1, track: 2, keepTime: true, own: { track: 2, sf: 100, nodeId: r0.results[0].nodeId }, params: [], name: null, motion: { x: 0.65, y: 0.5 } }]);
	assert.deepEqual([r.results[0].status, r.results[0].motion], ["updated", "keyframed"], "작업 상태는 그대로, 위치만 keyframed");
	assert.deepEqual(plain(r.results[0].pos), [0.35, 0.5]);
	const s = setMotion([{ key: "ab12-1", g: 1, track: 2, nodeId: r0.results[0].nodeId, x: 0.65, y: 0.5 }]);
	assert.deepEqual([s.results[0].status, s.results[0].x, s.results[0].y], ["keyframed", 0.35, 0.5]);
	assert.deepEqual(sim.posOf(c), [0.35, 0.5], "값 그대로");
	assert.equal(sim.prop(c, "Position").keyed, true, "키 그대로");
	assert.equal(sim.S.counts.setTimeVarying, 0, "setTimeVarying(false)는 절대 부르지 않는다");
});

test("템플릿의 Opacity 키(네이티브 페이드)는 Position 쓰기를 막지 않는다 · 네이티브 되읽기", () => {
	const { sim, seq, chunk, setMotion } = setup();
	const r0 = chunk([place(1, 2, 100, 150, { mogrtPath: NAT, motion: { x: 0.65, y: 0.5 } })]);
	assert.deepEqual([r0.results[0].status, r0.results[0].kind, r0.results[0].motion], ["placed", "native", "applied"]);
	const c = sim.clips(seq, 2)[0];
	assert.deepEqual(sim.posOf(c), [0.65, 0.5]);
	sim.keyOpacity(c);
	const s = setMotion([{ key: "ab12-1", g: 1, track: 2, nodeId: r0.results[0].nodeId, x: 0.5, y: 0.35 }]);
	assert.deepEqual([s.results[0].status, s.results[0].x0, s.results[0].y0, s.results[0].x, s.results[0].y], ["applied", 0.65, 0.5, 0.5, 0.35]);
	assert.deepEqual(sim.posOf(c), [0.5, 0.35]);
});

test("Motion은 matchName으로 찾는다 (현지화된 이름 '모션'·'위치'), 컴포넌트 순서와 상관없이 · Motion이 없으면 failed", () => {
	const { sim, seq, chunk, setMotion } = setup();
	const r0 = chunk([place(1, 2, 100, 150), place(2, 2, 300, 350)]);
	const [c1, c2] = sim.clips(seq, 2);
	const mot = c1.comps.find((x) => x.matchName === "AE.ADBE Motion");
	mot.displayName = "모션";
	mot.props[0].displayName = "위치";
	// Motion 앞에 displayName이 "Motion"인 다른 효과를 둔다 (이름으로 찾으면 이것을 쓴다)
	c1.comps.unshift({ matchName: "AE.ADBE Transform", displayName: "Motion", props: [{ displayName: "Position", value: [0.5, 0.5], keyed: false, numItems: 0 }] });
	c2.comps = c2.comps.filter((x) => x.matchName !== "AE.ADBE Motion");
	const s = setMotion([{ key: "ab12-1", g: 1, track: 2, nodeId: r0.results[0].nodeId, x: 0.35, y: 0.5 }, { key: "ab12-2", g: 1, track: 2, nodeId: r0.results[1].nodeId, x: 0.35, y: 0.5 }]);
	assert.equal(s.results[0].status, "applied");
	assert.deepEqual(mot.props[0].value, [0.35, 0.5]);
	assert.deepEqual(c1.comps[0].props[0].value, [0.5, 0.5], "다른 효과는 건드리지 않았다");
	assert.deepEqual([s.results[1].status, s.results[1].detail], ["failed", "Motion 컴포넌트 없음"]);
});

test("moveRegen·legacyMove·replace로 다시 놓은 클립에도 위치를 다시 쓴다 (새 클립은 템플릿 기본에서 시작)", () => {
	const { sim, seq, chunk } = setup();
	let r = chunk([place(1, 2, 100, 150, { motion: { x: 0.35, y: 0.5 } }), place(2, 2, 400, 450, { motion: { x: 0.35, y: 0.5 } })]);
	const [p1, p2] = r.results;
	// 옛 클립(태그 없음)을 V2에 놓고 legacyMove로 V3에 옮긴다
	const leg = sim.place(seq, 1, AE, 700, 750, null);
	r = chunk([
		{ key: "ab12-1", op: "moveRegen", g: 2, track: 3, sf: 120, ef: 170, own: { track: 2, sf: 100, nodeId: p1.nodeId }, mogrtPath: AE, durSec: 5.005, params: [], name: tag(1, 2), guard: [], motion: { x: 0.35, y: 0.5 } },
		{ key: "ab12-2", op: "replace", g: 2, track: 2, sf: 400, ef: 450, own: { track: 2, sf: 400, nodeId: p2.nodeId, m: AE }, mogrtPath: NAT, durSec: 5.005, params: [], name: tag(2, 2), guard: [], motion: { x: 0.65, y: 0.5 } },
		{ key: "ab12-3", op: "legacyMove", g: 1, track: 3, sf: 700, ef: 750, own: null, removeAfter: { track: 1, nodeId: sim.nodeId(leg) }, mogrtPath: AE, durSec: 5.005, params: [], name: tag(3, 1), guard: [], motion: { x: 0.5, y: 0.35 } }
	]);
	assert.deepEqual(r.results.map((x) => [x.status, x.motion]), [["moved", "applied"], ["replaced", "applied"], ["moved", "applied"]], JSON.stringify(r.results.map((x) => [x.status, x.reason, x.detail])));
	assert.deepEqual(r.results.map((x) => x.pos0), [undefined, undefined, undefined], "다시 놓은 클립은 pos0를 적지 않는다");
	const v3 = sim.clips(seq, 3);
	assert.deepEqual(v3.map((m) => [m.name, sim.posOf(m)]), [[tag(1, 2), [0.35, 0.5]], [tag(3, 1), [0.5, 0.35]]]);
	assert.deepEqual(sim.clips(seq, 2).map((m) => [m.kind, sim.posOf(m)]), [["native", [0.65, 0.5]]]);
	assert.equal(sim.clips(seq, 1).length, 0, "옛 레거시 클립은 지웠다");
	// 되돌리기 'before' 스냅숏에 옛 클립의 위치 (moveRegen·replace)
	assert.deepEqual([plain(r.results[0].before.pos), r.results[0].before.posKeyed], [[0.35, 0.5], false]);
	assert.deepEqual(plain(r.results[1].before.pos), [0.35, 0.5]);
});

test("replace가 실패해 옛 템플릿을 되놓으면(restored-old) 옛 위치도 되쓴다 · 옛 Position에 키가 있었으면 되살리지 않고 알린다", () => {
	const { sim, seq, chunk } = setup();
	let r = chunk([place(1, 2, 100, 150, { motion: { x: 0.35, y: 0.5 } }), place(2, 2, 400, 450)]);
	const [p1, p2] = r.results;
	assert.deepEqual([p1.motion, p2.motion], ["applied", "none"]);
	// 새 템플릿 경로가 없어 놓지 못한다 → 옛 클립(0.35, 0.5)을 되놓는다
	r = chunk([{ key: "ab12-1", op: "replace", g: 2, track: 2, sf: 100, ef: 150, own: { track: 2, sf: 100, nodeId: p1.nodeId, m: AE }, mogrtPath: "C:/m/없는.mogrt", durSec: 5.005, params: [], name: tag(1, 2), guard: [], motion: { x: 0.35, y: 0.5 } }]);
	let x = r.results[0];
	assert.deepEqual([x.status, x.reason, x.motion, plain(x.before.pos)], ["failed", "restored-old", "none", [0.35, 0.5]], JSON.stringify([x.reason, x.detail]));
	let back = sim.clips(seq, 2).find((m) => m.name === tag(1, 1));
	assert.ok(back, "옛 이름으로 되놓았다");
	assert.deepEqual(sim.posOf(back), [0.35, 0.5], "되놓은 클립의 위치 = 옛 위치 (템플릿 기본 0.5, 0.5가 아니다)");
	assert.doesNotMatch(x.detail || "", /위치/);
	// 원래 자리였던 옛 클립: 위치를 쓰지 않는다 (이미 같다)
	const sv0 = sim.S.counts.setValue;
	r = chunk([{ key: "ab12-2", op: "replace", g: 2, track: 2, sf: 400, ef: 450, own: { track: 2, sf: 400, nodeId: p2.nodeId, m: AE }, mogrtPath: "C:/m/없는.mogrt", durSec: 5.005, params: [], name: tag(2, 2), guard: [] }]);
	assert.deepEqual([r.results[0].status, r.results[0].reason], ["failed", "restored-old"]);
	assert.deepEqual(sim.posOf(sim.clips(seq, 2).find((m) => m.name === tag(2, 1))), [0.5, 0.5]);
	assert.equal(sim.S.counts.setValue - sv0, 2, "옛 속성 2개만 되쓴다 (위치는 이미 같아 쓰지 않는다)");
	// 옛 Position에 키 → 되놓은 클립에 위치를 쓰지 않고 detail로 알린다
	sim.keyMotion(back);
	r = chunk([{ key: "ab12-1", op: "replace", g: 2, track: 2, sf: 100, ef: 150, own: { track: 2, sf: 100, nodeId: sim.nodeId(back), m: AE }, mogrtPath: "C:/m/없는.mogrt", durSec: 5.005, params: [], name: tag(1, 2), guard: [] }]);
	x = r.results[0];
	assert.deepEqual([x.status, x.reason, x.before.posKeyed], ["failed", "restored-old", true]);
	assert.match(x.detail, /키프레임은 되살리지 못했다/);
	back = sim.clips(seq, 2).find((m) => m.name === tag(1, 1));
	assert.deepEqual(sim.posOf(back), [0.5, 0.5]);
	assert.equal(sim.S.counts.setTimeVarying, 0);
});

test("실패한 작업(충돌)에는 위치를 쓰지 않는다 · 잘못된 motion은 bad-item", () => {
	const { sim, seq, chunk } = setup();
	sim.placeOther(seq, 2, 90, 400, "영상.mp4");
	const r = chunk([place(1, 2, 100, 150, { motion: { x: 0.35, y: 0.5 } }), place(2, 3, 100, 150, { motion: { x: 960, y: 540 } })]);
	assert.deepEqual([r.results[0].status, r.results[0].motion], ["conflict", "none"]);
	assert.deepEqual([r.results[1].status, r.results[1].reason, r.results[1].detail], ["failed", "bad-item", "motion"]);
	assert.equal(sim.clips(seq, 3).length, 0, "잘못된 motion이면 아무것도 놓지 않는다");
	assert.deepEqual(sim.posOf(sim.clips(seq, 2)[0]), [0.5, 0.5]);
});

test("MI_setMotion: 태그 확인(notFound tag), 자르기 ambiguous, 잠김, 없는 클립, 잘못된 항목, 가드, 상한", () => {
	const { sim, seq, base, chunk, setMotion } = setup();
	const r0 = chunk([place(1, 2, 100, 150), place(2, 2, 300, 400), place(3, 3, 100, 150)]);
	const [a, b, c] = r0.results;
	sim.razor(seq, 2, 350);
	sim.S.seqs[0].tracks[3].locked = true;
	const s = setMotion([
		{ key: "ab12-1", g: 2, track: 2, nodeId: a.nodeId, x: 0.35, y: 0.5 },
		{ key: "ab12-9", g: 1, track: 2, nodeId: a.nodeId, x: 0.35, y: 0.5 },
		{ key: "ab12-2", g: 1, track: 2, nodeId: b.nodeId, x: 0.35, y: 0.5 },
		{ key: "ab12-3", g: 1, track: 3, nodeId: c.nodeId, x: 0.35, y: 0.5 },
		{ key: "ab12-4", g: 1, track: 2, nodeId: "ffffffff", x: 0.35, y: 0.5 },
		{ key: "ab12-1", g: 1, track: 2, nodeId: a.nodeId, x: "0.35", y: 0.5 },
		{ key: "ab12-1", g: 1, track: 9, nodeId: a.nodeId, x: 0.35, y: 0.5 },
		{ key: "ab12-1", g: 1, track: 2, nodeId: a.nodeId, x: 0.2, y: 0.8 }
	]);
	assert.equal(s.ok, true);
	assert.equal(s.done, 8);
	assert.deepEqual(s.results.map((x) => [x.status, x.reason || ""]), [
		["notFound", "tag"], ["notFound", "tag"], ["ambiguous", ""], ["locked", ""], ["notFound", ""], ["failed", "bad-item"], ["notFound", "no-track"], ["applied", ""]
	]);
	assert.equal(s.results[0].detail, tag(1, 1));
	assert.deepEqual(sim.posOf(sim.clips(seq, 2)[0]), [0.2, 0.8]);
	assert.ok(sim.clips(seq, 2).slice(1).every((m) => sim.posOf(m)[0] === 0.5), "자른 두 조각은 그대로");
	assert.deepEqual(sim.posOf(sim.clips(seq, 3)[0]), [0.5, 0.5], "잠긴 트랙은 그대로 (풀지 않는다)");
	// 태그 없는 key(레거시 "r12")는 태그를 보지 않는다
	const leg = sim.place(seq, 1, AE, 900, 950, null);
	const s2 = setMotion([{ key: "r12", g: 0, track: 1, nodeId: sim.nodeId(leg), x: 0.65, y: 0.5 }]);
	assert.equal(s2.results[0].status, "applied");
	// 가드·형식
	assert.equal(sim.call("MI_setMotion", Object.assign({}, base, { build: "other" }, { items: [] })).error, "build-mismatch");
	assert.equal(sim.call("MI_setMotion", Object.assign({}, base, { seqId: "seq-X", items: [] })).error, "seq-mismatch");
	assert.equal(sim.call("MI_setMotion", Object.assign({}, base, { items: {} })).error, "bad-payload");
	const many = [];
	for (let i = 0; i < 201; i++) many.push({ key: "ab12-1", g: 1, track: 2, nodeId: a.nodeId, x: 0.5, y: 0.5 });
	assert.equal(setMotion(many).error, "bad-payload");
});

test("MI_setMotion 40개 · 예산 · 텍스트 그대로 (위치만)", () => {
	const { sim, seq, chunk, setMotion } = setup();
	const items = [];
	for (let i = 0; i < 40; i++) items.push(place(i + 1, 2, 100 + i * 200, 150 + i * 200, { params: [{ index: 0, type: "text", displayName: "전체 텍스트", value: "자막 " + (i + 1), rawValue: "" }] }));
	const placed = [];
	for (let i = 0; i < 40; i += 8) placed.push(...chunk(items.slice(i, i + 8)).results);
	assert.equal(placed.filter((x) => x.status === "placed").length, 40);
	const before = sim.clips(seq, 2).map((m) => sim.textOf(m, "전체 텍스트"));
	const setVals0 = sim.S.counts.setValue;
	const s = setMotion(placed.map((x, i) => ({ key: x.key, g: 1, track: 2, nodeId: x.nodeId, x: 0.35, y: 0.5 })));
	assert.deepEqual([s.done, s.results.filter((x) => x.status === "applied").length], [40, 40]);
	assert.equal(sim.S.counts.setValue - setVals0, 40, "클립마다 Position setValue 한 번");
	assert.deepEqual(sim.clips(seq, 2).map((m) => sim.textOf(m, "전체 텍스트")), before, "텍스트 그대로");
	assert.ok(sim.clips(seq, 2).every((m) => sim.posOf(m)[0] === 0.35));
	// 예산이 다 되면 나머지는 하지 않는다 (첫 항목은 늘 한다)
	const t = sim.ctx.MI__now;
	let n = 0;
	sim.ctx.MI__now = () => (n++ < 1 ? 0 : 1e12);
	try {
		const s2 = setMotion(placed.slice(0, 3).map((x) => ({ key: x.key, g: 1, track: 2, nodeId: x.nodeId, x: 0.65, y: 0.5 })), { budgetMs: 5 });
		assert.equal(s2.done, 1);
		assert.equal(s2.results.length, 1);
	} finally {
		sim.ctx.MI__now = t;
	}
});

test("되읽기가 ±0.001을 넘으면 failed (0.0005 차이는 applied)", () => {
	const { sim, seq, chunk, setMotion } = setup();
	const r0 = chunk([place(1, 2, 100, 150)]);
	const c = sim.clips(seq, 2)[0];
	const p = sim.prop(c, "Position");
	// Premiere가 값을 깎는 경우를 흉내: 값 대입 뒤 한 번 어긋나게 둔다
	Object.defineProperty(p, "value", { get: () => [0.352, 0.5], set: () => {}, configurable: true });
	const s = setMotion([{ key: "ab12-1", g: 1, track: 2, nodeId: r0.results[0].nodeId, x: 0.35, y: 0.5 }]);
	assert.deepEqual([s.results[0].status, s.results[0].x], ["failed", 0.352]);
	assert.match(s.results[0].detail, /^되읽기 /);
	// 0.0005 차이는 받아들인다
	Object.defineProperty(p, "value", { get: () => [0.3505, 0.5], set: () => {}, configurable: true });
	assert.equal(setMotion([{ key: "ab12-1", g: 1, track: 2, nodeId: r0.results[0].nodeId, x: 0.35, y: 0.5 }]).results[0].status, "applied");
});

test("MI_readClipTexts want.pos → pos·posKeyed · removeClips before에 위치", () => {
	const { sim, seq, base, chunk } = setup();
	const r0 = chunk([place(1, 2, 100, 150, { motion: { x: 0.65, y: 0.5 } }), place(2, 2, 300, 350)]);
	sim.keyMotion(sim.clips(seq, 2)[1]);
	const rd = sim.call("MI_readClipTexts", Object.assign({}, base, { items: r0.results.map((x) => ({ track: 2, nodeId: x.nodeId })), want: { pos: true } }));
	assert.deepEqual(rd.results.map((x) => [x.pos, x.posKeyed]), [[[0.65, 0.5], false], [[0.5, 0.5], true]]);
	const rm = sim.call("MI_removeClips", Object.assign({}, base, { items: [{ key: "ab12-1", track: 2, nodeId: r0.results[0].nodeId, expectName: tag(1, 1) }] }));
	assert.deepEqual([rm.results[0].status, rm.results[0].before.pos, rm.results[0].before.posKeyed], ["removed", [0.65, 0.5], false]);
});
