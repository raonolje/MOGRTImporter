"use strict";
// S2-1: 읽기 전용 MI_ 진입점(MI_ping, MI_getTracks, MI_readClipTexts)과 MI__guard를 가짜 Premiere(tests/lib/premiereSim.js)에서.
// hostscript.jsx 전체를 vm에서 돌린다 (v27 함수 detectParamType·collectNativeTextProps·parsePayload 포함).
const test = require("node:test");
const assert = require("node:assert/strict");
const { createSim, FT, aeText, num, color, bool, point } = require("../lib/premiereSim");

const BUILD = "@@BUILD@@"; // 저장소 hostscript의 MI_BUILD (설치할 때 스탬프가 찍힌다)
const SEP_A = String.fromCharCode(0x2028);
const BS = String.fromCharCode(92);
const AE = "C:/m/자동 줄바꿈 박스.mogrt";
const NAT = "C:/m/Classic Lower Third Two Lines.mogrt";

function setup(o = {}) {
	const sim = createSim();
	const seq = sim.addSequence({ name: "T_23976", id: "seq-A", ft: o.ft || FT.f23976, tracks: o.tracks || 5 });
	sim.addTemplate(AE, {
		kind: "ae",
		name: "[라온올제] 자동 줄바꿈 박스",
		params: [aeText("전체 텍스트", "기본 문장"), color("박스 색상", 4294901760), num("크기", 50), aeText("포인트 텍스트", "포인트"), bool("그림자", true), point("위치", 0.5, 0.25)]
	});
	sim.addTemplate(NAT, { kind: "native", texts: 2 });
	const base = { seqId: seq.id, build: BUILD };
	return { sim, seq, base };
}

test("MI_ping: v 28, 빌드·접두사, 활성 시퀀스 정보 (가드 없음)", () => {
	const { sim, seq } = setup();
	sim.place(seq, 2, AE, 100, 700);
	const p = sim.call("MI_ping");
	assert.deepEqual(p, { ok: true, v: 28, build: BUILD, prefix: "MI_", seqId: "seq-A", seqName: "T_23976", isPreview: false, docId: "doc-sim-1", frameTicks: "10594584000", zeroPoint: "0", endFrame: 700 });
	sim.setActive(null);
	const q = sim.call("MI_ping");
	assert.equal(q.ok, true);
	assert.equal(q.seqId, "");
	const pv = sim.addSequence({ name: "__MOGRT_PREVIEW__", id: "seq-P", active: true });
	assert.equal(sim.call("MI_ping").isPreview, true);
	assert.ok(pv);
});

test("MI__guard: bad-payload → build-mismatch → no-sequence → preview-active → seq-mismatch, 응답은 늘 JSON", () => {
	const { sim, base } = setup();
	const raw = sim.callRaw("MI_getTracks", JSON.stringify("{not json"));
	assert.ok(raw.length > 0 && !/^ERROR/.test(raw));
	assert.equal(JSON.parse(raw).error, "bad-payload");
	assert.equal(JSON.parse(sim.callRaw("MI_getTracks", "")).error, "bad-payload", "인자 없음");
	assert.equal(sim.call("MI_getTracks", [1, 2]).error, "bad-payload", "배열은 객체가 아니다");
	assert.deepEqual([sim.call("MI_getTracks", Object.assign({}, base, { build: "dev-0000000" })).ok, sim.call("MI_getTracks", Object.assign({}, base, { build: "dev-0000000" })).error], [false, "build-mismatch"]);
	assert.equal(sim.call("MI_getTracks", { seqId: base.seqId }).error, "build-mismatch", "빌드 없음");
	assert.equal(sim.call("MI_getTracks", Object.assign({}, base, { seqId: "other" })).error, "seq-mismatch");
	assert.equal(sim.call("MI_readClipTexts", Object.assign({}, base, { seqId: "other", items: [] })).error, "seq-mismatch");
	sim.addSequence({ name: "__MOGRT_PREVIEW__", id: "seq-P", active: true });
	assert.equal(sim.call("MI_getTracks", base).error, "preview-active");
	assert.equal(sim.call("MI_getTracks", Object.assign({}, base, { seqId: "seq-P" })).error, "preview-active", "프리뷰는 seqId가 맞아도 거부");
	sim.setActive(null);
	assert.equal(sim.call("MI_getTracks", base).error, "no-sequence");
});

test("MI_getTracks: tracks null이면 V1 뺀 전부, 트랙·범위 필터, 잠김, 태그 읽기, 시작순 (move 뒤에도)", () => {
	const { sim, seq, base } = setup();
	sim.place(seq, 0, AE, 0, 50, "V1 영상 흉내");
	const v27 = sim.place(seq, 1, AE, 100, 150);
	sim.place(seq, 1, AE, 300, 350);
	const tagged = sim.place(seq, 2, AE, 200, 260, "철수 [MI:ab12-1.1]");
	seq.tracks[3].locked = true;
	sim.place(seq, 4, AE, 5000, 5050);
	let r = sim.call("MI_getTracks", Object.assign({}, base, { tracks: null }));
	assert.equal(r.ok, true);
	assert.equal(r.numVideoTracks, 5);
	assert.equal(r.frameTicks, "10594584000");
	assert.deepEqual(r.tracks.map((t) => t.i), [1, 2, 3, 4], "V1(0)은 스캔하지 않는다");
	assert.deepEqual(r.tracks.map((t) => t.locked), [false, false, true, false]);
	const v3 = r.tracks[1].clips;
	assert.deepEqual(v3, [{ sf: 200, ef: 260, nodeId: tagged.nodeId, name: "철수 [MI:ab12-1.1]", salt: "ab12", id: 1, g: 1 }]);
	assert.deepEqual(r.tracks[0].clips.map((c) => [c.sf, c.ef, c.salt]), [[100, 150, undefined], [300, 350, undefined]]);
	assert.equal(typeof r.ms, "number");
	// 범위: 250~320 프레임과 겹치는 클립만
	r = sim.call("MI_getTracks", Object.assign({}, base, { tracks: [1, 2, 9, 1], fromFrame: 250, toFrame: 320 }));
	assert.deepEqual(r.tracks.map((t) => [t.i, t.clips.map((c) => c.sf)]), [[1, [300]], [2, [200]]], "없는 트랙 9와 중복은 건너뛴다");
	// move 뒤 track.clips 순서가 어긋나도 시작순
	sim.S.active.tracks[1].clips[0].s += 1000 * seq.ft;
	sim.S.active.tracks[1].clips[0].e += 1000 * seq.ft;
	r = sim.call("MI_getTracks", Object.assign({}, base, { tracks: [1] }));
	assert.deepEqual(r.tracks[0].clips.map((c) => c.sf), [300, 1100]);
	assert.equal(r.tracks[0].clips[1].nodeId, v27.nodeId);
	assert.equal(sim.call("MI_getTracks", Object.assign({}, base, { tracks: [1.5] })).error, "bad-payload");
	assert.equal(sim.call("MI_getTracks", Object.assign({}, base, { tracks: "1" })).error, "bad-payload");
	assert.equal(sim.call("MI_getTracks", Object.assign({}, base, { tracks: [1], fromFrame: "0" })).error, "bad-payload");
});

test("MI_getTracks: 23.976 프레임은 가장 가까운 프레임, v27 소수 끝도 반올림", () => {
	const { sim, seq, base } = setup();
	const c = sim.place(seq, 2, AE, 719, 800);
	c.e = Math.round(800.4 * seq.ft); // v27 클립: 끝이 프레임 경계가 아니다 (S0-3 p)
	const r = sim.call("MI_getTracks", Object.assign({}, base, { tracks: [2] }));
	assert.deepEqual([r.tracks[0].clips[0].sf, r.tracks[0].clips[0].ef], [719, 800]);
});

test("MI_readClipTexts: AE 텍스트는 두 번 읽어도 같고, lay는 템플릿 속성 이름, deco, 타입 있는 params(colorHex 없음)", () => {
	const { sim, seq, base } = setup();
	const c = sim.place(seq, 2, AE, 100, 150, "철수 [MI:ab12-1.1]", { texts: ["오늘 날씨 좋다", "날씨"] });
	sim.addEffect(c);
	sim.keyMotion(c);
	const req = Object.assign({}, base, { items: [{ track: 2, nodeId: c.nodeId || sim.nodeId(c) }], want: { texts: true, lay: true, deco: true, params: true } });
	const a = sim.call("MI_readClipTexts", req);
	const b = sim.call("MI_readClipTexts", req);
	assert.equal(a.ok, true);
	const r = a.results[0];
	assert.deepEqual(r.texts, ["오늘 날씨 좋다", "날씨"]);
	assert.deepEqual(b.results[0].texts, r.texts, "두 번 읽어도 같다");
	assert.deepEqual(r.lay, [["전체 텍스트", "t"], ["박스 색상", "o"], ["크기", "o"], ["포인트 텍스트", "t"], ["그림자", "o"], ["위치", "o"]]);
	assert.deepEqual([r.found, r.kind, r.pin, r.track, r.sf, r.ef, r.name], [true, "ae", "[라온올제] 자동 줄바꿈 박스", 2, 100, 150, "철수 [MI:ab12-1.1]"]);
	assert.deepEqual(r.deco, { comps: 4, keyed: ["AE.ADBE Motion"] });
	assert.deepEqual(r.params.map((p) => [p.index, p.type, p.displayName, p.value]), [
		[0, "text", "전체 텍스트", "오늘 날씨 좋다"],
		[1, "color", "박스 색상", "4294901760"],
		[2, "number", "크기", "50"],
		[3, "text", "포인트 텍스트", "날씨"],
		[4, "boolean", "그림자", "true"],
		[5, "point", "위치", "0.5,0.25"]
	]);
	assert.ok(r.params.every((p) => !("colorHex" in p)), "colorHex 없음 (rawValue로 되돌린다)");
	assert.equal(JSON.parse(r.params[0].rawValue).textEditValue, "오늘 날씨 좋다");
});

test("MI_readClipTexts: 네이티브는 kind native·pin null·한 글자 초깃값은 빈 값, 없는 nodeId·다른 클립, 40개 상한, want 기본값", () => {
	const { sim, seq, base } = setup();
	const n = sim.place(seq, 3, NAT, 10, 60);
	const other = sim.placeOther(seq, 3, 100, 200, "b-roll.mp4");
	const a = sim.place(seq, 2, AE, 10, 60);
	const r = sim.call("MI_readClipTexts", Object.assign({}, base, { items: [{ track: 3, nodeId: sim.nodeId(n) }, { track: 3, nodeId: "ffffffff" }, { track: 3, nodeId: sim.nodeId(other) }, { track: 7, nodeId: sim.nodeId(a) }, { track: 2, nodeId: sim.nodeId(a) }], want: { texts: true, lay: true, params: true } }));
	const [rn, miss, ro, badTrack, ra] = r.results;
	assert.deepEqual([rn.kind, rn.pin, rn.texts, rn.lay, rn.name], ["native", null, ["", ""], { n: 2 }, "Graphic"]);
	assert.deepEqual(rn.params, [
		{ index: 0, type: "text", displayName: "텍스트 1", value: "", rawValue: "", nativeText: true },
		{ index: 1, type: "text", displayName: "텍스트 2", value: "", rawValue: "", nativeText: true }
	]);
	assert.equal(rn.deco, undefined, "want에 없으면 읽지 않는다");
	assert.deepEqual(miss, { nodeId: "ffffffff", found: false });
	assert.deepEqual([ro.kind, ro.texts, ro.lay, ro.params], ["other", [], null, []]);
	assert.equal(badTrack.found, false, "다른 트랙에서는 찾지 않는다");
	assert.equal(ra.found, true);
	const d = sim.call("MI_readClipTexts", Object.assign({}, base, { items: [{ track: 2, nodeId: sim.nodeId(a) }] }));
	assert.deepEqual(Object.keys(d.results[0]).filter((k) => ["texts", "lay", "deco", "params"].indexOf(k) !== -1), ["texts", "lay", "deco"], "want가 없으면 texts·lay·deco");
	const many = Array.from({ length: 41 }, () => ({ track: 2, nodeId: "x" }));
	assert.equal(sim.call("MI_readClipTexts", Object.assign({}, base, { items: many })).error, "bad-payload");
	assert.equal(sim.call("MI_readClipTexts", Object.assign({}, base, { items: many.slice(0, 40) })).ok, true);
	assert.equal(sim.call("MI_readClipTexts", Object.assign({}, base, { items: "x" })).error, "bad-payload");
});

test("U+2028: 이스케이프해 보낸 payload는 읽히고, 호스트 응답은 날 U+2028 없이 이스케이프한다", () => {
	const { sim, seq, base } = setup();
	const c = sim.place(seq, 2, AE, 100, 150, "줄" + SEP_A + "바꿈 [MI:ab12-3.1]", { texts: ["가" + SEP_A + "나"] });
	const raw = sim.callRaw("MI_getTracks", JSON.stringify(JSON.stringify(Object.assign({}, base, { tracks: [2], note: "x" + SEP_A + "y" })).split(SEP_A).join(BS + "u2028")));
	assert.equal(raw.indexOf(SEP_A), -1, "응답에 날 U+2028이 없다");
	assert.ok(raw.indexOf(BS + "u2028") !== -1);
	const r = JSON.parse(raw);
	assert.equal(r.tracks[0].clips[0].name, "줄" + SEP_A + "바꿈 [MI:ab12-3.1]");
	assert.equal(r.tracks[0].clips[0].g, 1, "태그는 이름 끝");
	const t = sim.call("MI_readClipTexts", Object.assign({}, base, { items: [{ track: 2, nodeId: sim.nodeId(c) }] }));
	assert.deepEqual(t.results[0].texts, ["가" + SEP_A + "나", "포인트"]);
});
