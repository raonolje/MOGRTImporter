"use strict";
// S4-2: 화면 위치 끝에서 끝까지 — panelHarness(app.js 전체) + premiereSim(hostscript.jsx 전체).
// 실제 Premiere 동작(왼쪽·오른쪽 클립, 위치만 보내는 다시 적용, 위치만 다시 적용, 되돌리기, PNG)은 하드 케이스 tests/premiere/cases/s4_2_pos.case.js 몫이다.
//   (a) 화자 표 .cast-pos: 기본 '변경 안 함'(Motion을 건드리지 않는다), 왼쪽·오른쪽 → session·cast.json·cast_defaults·히스토리, 직접 → x·y 칸
//   (b) 위치를 바꾼 뒤 ▶ → 위치만 보내는 update(속성·이름 없음, keepTime, 되읽기 없음), 텍스트 그대로 → 다시 ▶는 보낼 것 없음
//   (c) 키가 있는 Position → 그대로·줄 표시·상태 '위치 키프레임' → 다음 ▶가 그 줄만 다시 알린다
//   (d) ⋯ '위치만 다시 적용' → MI_setMotion만 (placeChunk 없음), applied 해시 → 다음 ▶ 보낼 것 없음 → 되돌리기가 위치를 되돌린다
//   (e) 동시 발화 쌓기 켬/끔 → 겹치는 C2 줄만 위로, 끄면 쌓기 전 자리
//   (f) ▶ 되돌리기 → 위치 되돌림
const test = require("node:test");
const assert = require("node:assert/strict");
const { bootPanel, cachePaths: P } = require("../lib/panelHarness");
const { createSim, FT, TPS, aeText, color } = require("../lib/premiereSim");

const PROJ = "C:/work/pos.prproj";
const A = { seqId: "seq-pos-1", seqName: "T_POS", projPath: PROJ };
const MOGRT = "C:/m/[라온올제] 합성 자막.mogrt";
const SALT = "ab12";
const F = FT.f23976;
const sec = (f) => (f * F) / TPS;
const HOST_FNS = ["ping", "getTracks", "readClipTexts", "ensureVideoTracks", "placeChunk", "removeClips", "setMotion"];
const LA = () => P.session(PROJ, A.seqId).replace("session.json", "last_apply.json");
const DEFAULTS = () => P.session(PROJ, A.seqId).replace(/[^/\\]+[/\\]session\.json$/, "cast_defaults.json");

function tc(x) {
	const ms = Math.round(x * 1000);
	const p = (n, w) => String(n).padStart(w, "0");
	return p(Math.floor(ms / 3600000), 2) + ":" + p(Math.floor((ms % 3600000) / 60000), 2) + ":" + p(Math.floor((ms % 60000) / 1000), 2) + "." + p(ms % 1000, 3);
}
function makeSim() {
	const sim = createSim();
	const seq = sim.addSequence({ name: A.seqName, id: A.seqId, ft: F, tracks: 6 });
	sim.addTemplate(MOGRT, { kind: "ae", name: "[라온올제] 합성 자막", params: [aeText("텍스트", "기본"), aeText("포인트 텍스트", ""), color("색", 4294967295)] });
	const probe = sim.place(seq, 0, MOGRT, 90000, 90100);
	const r = sim.call("MI_readClipTexts", { seqId: seq.id, build: "@@BUILD@@", items: [{ track: 0, nodeId: sim.nodeId(probe) }], want: { params: true } });
	probe.track.clips.splice(probe.track.clips.indexOf(probe), 1);
	const params = r.results[0].params.map((p) => Object.assign({}, p, { group: "" }));
	const preset = { id: "preset_3", name: "합성 자막", mogrtPath: MOGRT, params, exposedIndices: [0, 1], textParamIndex: 0, exposedFontFields: {} };
	return { sim, seq, preset };
}
function withCaption(preset, text) {
	const all = JSON.parse(JSON.stringify(preset.params));
	const raw = JSON.parse(all[0].rawValue);
	raw.textEditValue = text;
	raw.fontTextRunLength = [text.length];
	all[0].value = text;
	all[0].rawValue = JSON.stringify(raw);
	return all;
}
// rows: [[id, spk, sf, ef, 문장]]
function castSession(preset, rows, mi) {
	const subtitles = [];
	const rowStates = {};
	const n = {};
	rows.forEach(([id, spk, sf, ef, text]) => {
		n[spk] = (n[spk] || 0) + 1;
		subtitles.push({ index: n[spk], startTime: tc(sec(sf)), endTime: tc(sec(ef)), startSec: sec(sf), endSec: sec(ef), text, id, spk, srtNo: n[spk] });
		const all = withCaption(preset, text);
		rowStates[id] = { presetId: preset.id, params: all.filter((p) => preset.exposedIndices.indexOf(p.index) !== -1), _allParams: all, open: false, checked: false };
	});
	return {
		subtitles, rowStates, trashBin: [], nextId: Math.max(...rows.map((r) => r[0])) + 1,
		mi: Object.assign({ v: 1, salt: SALT, hwm: Math.max(...rows.map((r) => r[0])), legacyTrack: null, remapped: false, castOrder: ["C1", "C2"],
			cast: { C1: { name: "철수", track: null, autoTrack: null, presetId: preset.id, color: 0, pos: null }, C2: { name: "영희", track: null, autoTrack: null, presetId: preset.id, color: 1, pos: null } },
			stack: false, stackDy: 0.12, applied: {} }, mi || {})
	};
}
async function boot(sim, preset, session) {
	const h = await bootPanel({
		seq: A,
		mogrts: [{ name: preset.name, path: preset.mogrtPath }],
		files: { [P.presets(PROJ)]: { presets: { [preset.id]: preset }, presetTrash: [], nextPresetId: 4 }, [P.session(PROJ, A.seqId)]: session }
	});
	HOST_FNS.forEach((n) => {
		h.host.handlers["MI_" + n] = (json) => sim.callRaw("MI_" + n, json === undefined ? undefined : JSON.stringify(json));
	});
	await h.advance(1000);
	return h;
}
async function settle(h) {
	for (let i = 0; i < 400; i++) {
		await h.flush();
		if (!h.win._mogrtDebug.miBusy() || h.$("preflightModal").classList.contains("open")) return;
	}
	throw new Error("적용이 끝나지 않았다");
}
async function done(h) {
	for (let i = 0; i < 400 && h.win._mogrtDebug.miBusy(); i++) await h.flush();
	assert.equal(h.win._mogrtDebug.miBusy(), false, "적용이 끝났다");
}
async function applyAll(h) {
	h.$("btnApply").click();
	await settle(h);
	if (h.$("preflightModal").classList.contains("open")) h.$("pfOk").click();
	await done(h);
}
const cmd = async (h, op, args) => JSON.parse(JSON.stringify(await h.win._mogrtDebug.cmd(op, args)));
const calls = (h, fn) => h.host.calls.filter((c) => c.fn === fn);
// 호스트에 보낸 payload (JSON 글자 → 객체)
const sent = (h, fn, from) => calls(h, fn).slice(from || 0).map((c) => JSON.parse(c.args[0]));
const castRow = (h, K) => h.$("castRows").querySelectorAll(".cast-row").find((r) => r.dataset.key === K);
function setSel(h, el, v) {
	el.value = v;
	h.change(el);
}
function menuClick(h, K, act) {
	castRow(h, K).querySelector(".cast-more").click();
	const b = castRow(h, K).querySelector(".cast-menu").querySelectorAll("button").find((x) => x.dataset.act === act);
	assert.ok(b, "메뉴 " + act);
	b.click();
}
// 트랙 ti 클립 [[태그 id, 위치 x, y, 캡션]]
const posRows = (sim, seq, ti) => sim.clips(seq, ti).map((m) => {
	const t = /-(\d+)\.\d+\]$/.exec(m.name);
	const p = sim.posOf(m);
	return [t ? Number(t[1]) : m.name, p[0], p[1], sim.textOf(m, "텍스트")];
});
function noErrors(h) {
	assert.deepEqual(h.errors().map((e) => String(e.message || e).slice(0, 300)), [], "패널 예외");
}
// 2화자 × 4줄 (1·2, 5·6이 동시 발화)
const ROWS = [[1, "C1", 100, 160, "철수 하나"], [2, "C2", 130, 190, "영희 하나"], [3, "C1", 300, 360, "철수 둘"], [4, "C2", 500, 560, "영희 둘"],
	[5, "C1", 700, 760, "철수 셋"], [6, "C2", 720, 780, "영희 셋"], [7, "C1", 900, 960, "철수 넷"], [8, "C2", 1100, 1160, "영희 넷"]];

test("(a)(b) 화자 표 위치: 기본은 Motion 그대로 → 왼쪽·오른쪽 → ▶는 위치만 보낸다 (되읽기·속성·이름 없음), 다시 ▶는 보낼 것 없음", async () => {
	const { sim, seq, preset } = makeSim();
	const h = await boot(sim, preset, castSession(preset, ROWS));
	const sel = castRow(h, "C1").querySelector(".cast-pos");
	assert.deepEqual(sel.options.map((o) => [o.value, o.textContent]), [["", "위치: 변경 안 함"], ["orig", "원래 자리"], ["left", "왼쪽"], ["right", "오른쪽"], ["top", "위"], ["custom", "직접"]]);
	assert.equal(sel.value, "");
	assert.equal(castRow(h, "C1").querySelector(".cast-x").style.display, "none");
	assert.equal(h.$("castStack").style.display, "", "화자가 둘이면 쌓기 칸이 보인다");
	assert.equal(h.$("castStackChk").checked, false);
	await applyAll(h);
	assert.match(h.status().text, /^화자별 배치: 놓음 8/);
	const setVals0 = sim.S.counts.setValue;
	assert.ok(sim.clips(seq, 2).concat(sim.clips(seq, 3)).every((m) => sim.posOf(m)[0] === 0.5 && sim.posOf(m)[1] === 0.5), "위치 '변경 안 함'이면 Motion 그대로");
	const placeItems = sent(h, "MI_placeChunk").reduce((a, c) => a.concat(c.items || []), []);
	assert.ok(placeItems.length === 8 && placeItems.every((it) => it.motion === null), "motion null");
	// 왼쪽·오른쪽
	setSel(h, castRow(h, "C1").querySelector(".cast-pos"), "left");
	setSel(h, castRow(h, "C2").querySelector(".cast-pos"), "right");
	let s = h.snapshot();
	assert.deepEqual([s.mi.cast.C1.pos, s.mi.cast.C2.pos], [{ x: 0.35, y: 0.5 }, { x: 0.65, y: 0.5 }]);
	assert.deepEqual(h.fs.readJson(P.session(PROJ, A.seqId)).mi.cast.C2.pos, { x: 0.65, y: 0.5 }, "session.json");
	assert.deepEqual(h.fs.readJson(DEFAULTS()).C1.pos, { x: 0.35, y: 0.5 }, "cast_defaults.json");
	assert.equal(h.fs.readJson(P.historyAuto(PROJ, A.seqId))[0].label, "화자 위치: C2 오른쪽");
	assert.equal(castRow(h, "C1").querySelector(".cast-pos").value, "left");
	// ▶: 위치만 (되읽기 없음, update keepTime, 속성·이름 없음)
	const nRead = calls(h, "MI_readClipTexts").length;
	const nPlace = calls(h, "MI_placeChunk").length;
	await applyAll(h);
	assert.equal(calls(h, "MI_readClipTexts").length, nRead, "되읽기 없음");
	const items = sent(h, "MI_placeChunk", nPlace).reduce((a, c) => a.concat(c.items), []);
	assert.equal(items.length, 8);
	assert.ok(items.every((it) => it.op === "update" && it.keepTime === true && it.params.length === 0 && it.name === null), JSON.stringify(items[0]));
	assert.deepEqual(items.map((it) => [it.key, it.motion.x]).sort(), [["ab12-1", 0.35], ["ab12-2", 0.65], ["ab12-3", 0.35], ["ab12-4", 0.65], ["ab12-5", 0.35], ["ab12-6", 0.65], ["ab12-7", 0.35], ["ab12-8", 0.65]]);
	assert.match(h.status().text, /^화자별 배치: 갱신 8 · 위치만 8$/);
	assert.equal(sim.S.counts.setValue - setVals0, 8, "속성은 쓰지 않았다 (Position만 8번)");
	assert.deepEqual(posRows(sim, seq, 2), [[1, 0.35, 0.5, "철수 하나"], [3, 0.35, 0.5, "철수 둘"], [5, 0.35, 0.5, "철수 셋"], [7, 0.35, 0.5, "철수 넷"]]);
	assert.deepEqual(posRows(sim, seq, 3).map((r) => [r[0], r[1], r[3]]), [[2, 0.65, "영희 하나"], [4, 0.65, "영희 둘"], [6, 0.65, "영희 셋"], [8, 0.65, "영희 넷"]]);
	s = h.snapshot();
	assert.deepEqual([s.mi.applied["ab12-1"].mo, typeof s.mi.applied["ab12-1"].hb], [{ x: 0.35, y: 0.5 }, "string"]);
	const la = h.fs.readJson(LA());
	assert.deepEqual([la.updated.length, la.updated[0].pos0], [8, [0.5, 0.5]], "되돌리기용 쓰기 전 위치");
	// 다시 ▶: 보낼 것 없음
	const n2 = calls(h, "MI_placeChunk").length;
	await applyAll(h);
	assert.equal(calls(h, "MI_placeChunk").length, n2);
	assert.match(h.status().text, /^변경 없음 — 보낼 줄이 없습니다 \(8줄 그대로\)$/);
	// '변경 안 함'으로 되돌려도 클립은 그대로
	setSel(h, castRow(h, "C2").querySelector(".cast-pos"), "");
	assert.equal(h.snapshot().mi.cast.C2.pos, null);
	await applyAll(h);
	assert.equal(calls(h, "MI_placeChunk").length, n2, "보내지 않는다");
	assert.equal(posRows(sim, seq, 3)[0][1], 0.65);
	// 직접: x·y 칸 → 고치면 저장
	setSel(h, castRow(h, "C2").querySelector(".cast-pos"), "custom");
	assert.equal(castRow(h, "C2").querySelector(".cast-x").style.display, "");
	assert.equal(h.snapshot().mi.cast.C2.pos, null, "칸을 고치기 전에는 그대로");
	const xi = castRow(h, "C2").querySelector(".cast-x");
	xi.value = "0.7";
	h.change(xi);
	assert.deepEqual(h.snapshot().mi.cast.C2.pos, { x: 0.7, y: 0.5 });
	assert.equal(castRow(h, "C2").querySelector(".cast-pos").value, "custom", "직접 칸은 닫히지 않는다");
	const yi = castRow(h, "C2").querySelector(".cast-y");
	yi.value = "1.5";
	h.change(yi);
	assert.deepEqual(h.snapshot().mi.cast.C2.pos, { x: 0.7, y: 0.5 }, "0~1 밖은 받지 않는다");
	assert.match(h.status().text, /0~1/);
	noErrors(h);
});

test("(c) 키가 있는 Position은 그대로 두고 알린다 → 다음 ▶가 그 줄만 다시 보낸다", async () => {
	const { sim, seq, preset } = makeSim();
	const h = await boot(sim, preset, castSession(preset, ROWS));
	await applyAll(h);
	const c3 = sim.clips(seq, 2)[1];
	sim.keyMotion(c3);
	setSel(h, castRow(h, "C1").querySelector(".cast-pos"), "top");
	await applyAll(h);
	assert.match(h.status().text, /^화자별 배치: 갱신 4 · 그대로 4 · 위치만 4 · 위치 키프레임 1 \(바꾸지 않음\)$/);
	assert.equal(h.status().cls, "err");
	assert.equal(h.$("row-3").querySelector(".sub-res").textContent, "키프레임이 있어 위치를 바꾸지 않음");
	assert.deepEqual(sim.posOf(c3), [0.5, 0.5], "값 그대로");
	assert.equal(sim.S.counts.setTimeVarying, 0);
	assert.deepEqual(posRows(sim, seq, 2).map((r) => r[2]), [0.35, 0.5, 0.35, 0.35]);
	const n = calls(h, "MI_placeChunk").length;
	await applyAll(h);
	const items = sent(h, "MI_placeChunk", n).reduce((a, c) => a.concat(c.items), []);
	assert.deepEqual(items.map((it) => [it.key, it.op, it.params.length, it.motion]), [["ab12-3", "update", 0, { x: 0.5, y: 0.35 }]], "그 줄만 위치를 다시");
	noErrors(h);
});

test("(d) ⋯ '위치만 다시 적용' → MI_setMotion만, 텍스트·시간 그대로 → 다음 ▶는 보낼 것 없음 → 되돌리기가 위치를 되돌린다", async () => {
	const { sim, seq, preset } = makeSim();
	const h = await boot(sim, preset, castSession(preset, ROWS));
	setSel(h, castRow(h, "C2").querySelector(".cast-pos"), "right");
	await applyAll(h);
	assert.deepEqual(posRows(sim, seq, 3).map((r) => r[1]), [0.65, 0.65, 0.65, 0.65], "새로 놓을 때 위치");
	const before = posRows(sim, seq, 3).map((r) => [r[0], r[3]]);
	const times = sim.clips(seq, 3).map((m) => [m.s, m.e, m.name]);
	// 위치를 '위'로 바꾸고 ⋯ 위치만 다시 적용
	setSel(h, castRow(h, "C2").querySelector(".cast-pos"), "top");
	const nPlace = calls(h, "MI_placeChunk").length;
	menuClick(h, "C2", "pos");
	await done(h);
	assert.equal(calls(h, "MI_placeChunk").length, nPlace, "placeChunk 없음");
	const sm = sent(h, "MI_setMotion");
	assert.equal(sm.length, 1);
	assert.deepEqual(sm[0].items.map((it) => [it.key, it.x, it.y]), [["ab12-2", 0.5, 0.35], ["ab12-4", 0.5, 0.35], ["ab12-6", 0.5, 0.35], ["ab12-8", 0.5, 0.35]]);
	assert.equal(h.status().text, "C2 영희 위치만 다시 적용: 위치 4개");
	assert.deepEqual(posRows(sim, seq, 3).map((r) => [r[0], r[1], r[2], r[3]]), before.map((b) => [b[0], 0.5, 0.35, b[1]]));
	assert.deepEqual(sim.clips(seq, 3).map((m) => [m.s, m.e, m.name]), times, "시간·이름 그대로");
	assert.deepEqual(posRows(sim, seq, 2).map((r) => r[1]), [0.5, 0.5, 0.5, 0.5], "다른 화자는 그대로");
	assert.equal(h.fs.readJson(P.historyAuto(PROJ, A.seqId))[0].label, "위치만 다시 적용: C2 (4개)");
	// 다음 ▶: 보낼 것 없음 (의도 해시가 새 위치)
	await applyAll(h);
	assert.equal(calls(h, "MI_placeChunk").length, nPlace);
	assert.match(h.status().text, /^변경 없음/);
	// 되돌리기 → 위치가 '오른쪽'으로
	const r = await cmd(h, "undo", {});
	assert.equal(r.ok, true, JSON.stringify(r));
	assert.deepEqual(posRows(sim, seq, 3).map((x) => [x[1], x[2], x[3]]), before.map((b) => [0.65, 0.5, b[1]]));
	assert.deepEqual(sim.clips(seq, 3).map((m) => [m.s, m.e, m.name]), times);
	// 되돌린 뒤 ▶ → 다시 '위'로 (위치만)
	await applyAll(h);
	assert.deepEqual(posRows(sim, seq, 3).map((x) => x[2]), [0.35, 0.35, 0.35, 0.35]);
	// 위치가 '변경 안 함'인 화자 → 보내지 않고 알린다
	menuClick(h, "C1", "pos");
	await done(h);
	assert.match(h.status().text, /^C1 철수: 위치가 '변경 안 함'입니다/);
	noErrors(h);
});

test("(e) 동시 발화 쌓기: 켜면 겹치는 C2 줄만 한 줄 위로 (y − 0.12), 끄면 쌓기 전 자리로", async () => {
	const { sim, seq, preset } = makeSim();
	const h = await boot(sim, preset, castSession(preset, ROWS));
	await applyAll(h);
	const chk = h.$("castStackChk");
	chk.checked = true;
	h.change(chk);
	assert.equal(h.snapshot().mi.stack, true);
	assert.equal(h.$("castStackDy").disabled, false);
	assert.equal(h.fs.readJson(P.historyAuto(PROJ, A.seqId))[0].label, "동시 발화 쌓기: 켬");
	await applyAll(h);
	assert.deepEqual(posRows(sim, seq, 3).map((r) => [r[0], r[1], r[2]]), [[2, 0.5, 0.38], [4, 0.5, 0.5], [6, 0.5, 0.38], [8, 0.5, 0.5]], "겹치는 2·6만");
	assert.deepEqual(posRows(sim, seq, 2).map((r) => r[2]), [0.5, 0.5, 0.5, 0.5], "C1은 층 0");
	// 간격 0.2
	const dy = h.$("castStackDy");
	dy.value = "0.2";
	h.change(dy);
	assert.equal(h.snapshot().mi.stackDy, 0.2);
	await applyAll(h);
	assert.deepEqual(posRows(sim, seq, 3).map((r) => r[2]), [0.3, 0.5, 0.3, 0.5]);
	chk.checked = false;
	h.change(chk);
	await applyAll(h);
	assert.deepEqual(posRows(sim, seq, 3).map((r) => r[2]), [0.5, 0.5, 0.5, 0.5], "쌓기 전 자리");
	const n = calls(h, "MI_placeChunk").length;
	await applyAll(h);
	assert.equal(calls(h, "MI_placeChunk").length, n, "다시 ▶는 보낼 것 없음");
	noErrors(h);
});

test("(f) ▶로 바꾼 위치도 되돌리기가 되돌린다 · 다시 놓은 클립(트랙 고정)은 지난 위치를 가져간다", async () => {
	const { sim, seq, preset } = makeSim();
	const h = await boot(sim, preset, castSession(preset, ROWS));
	setSel(h, castRow(h, "C1").querySelector(".cast-pos"), "left");
	await applyAll(h);
	setSel(h, castRow(h, "C1").querySelector(".cast-pos"), "right");
	await applyAll(h);
	assert.deepEqual(posRows(sim, seq, 2).map((r) => r[1]), [0.65, 0.65, 0.65, 0.65]);
	const r = await cmd(h, "undo", {});
	assert.equal(r.ok, true, JSON.stringify(r));
	assert.deepEqual(posRows(sim, seq, 2).map((x) => x[1]), [0.35, 0.35, 0.35, 0.35], "▶ 전 위치 (왼쪽)");
	// 위치를 '변경 안 함'으로 두고 C1 트랙을 V6에 고정 → 다른 트랙에 다시 놓는 클립은 지난 위치(왼쪽)를 가져간다
	setSel(h, castRow(h, "C1").querySelector(".cast-pos"), "");
	setSel(h, castRow(h, "C1").querySelector(".cast-track"), "5");
	await applyAll(h);
	assert.equal(h.status().text, "화자별 배치: 옮김 8", "C1은 V6으로, 자동인 C2는 첫 자동 화자라 기본 트랙(V3)으로");
	assert.deepEqual(posRows(sim, seq, 2).map((x) => [x[0], x[1]]), [[2, 0.5], [4, 0.5], [6, 0.5], [8, 0.5]], "C2는 위치를 쓴 적이 없다 (원래 자리 그대로)");
	assert.deepEqual(posRows(sim, seq, 5).map((x) => [x[0], x[1], x[3]]), [[1, 0.35, "철수 하나"], [3, 0.35, "철수 둘"], [5, 0.35, "철수 셋"], [7, 0.35, "철수 넷"]]);
	noErrors(h);
});
