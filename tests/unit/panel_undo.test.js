"use strict";
// S2-5: 마지막 적용 되돌리기·레거시 안전 경로 끝에서 끝까지 — panelHarness(app.js 전체) + premiereSim(hostscript.jsx 전체, 가짜 Premiere).
// 실제 Premiere 동작은 하드 케이스 tests/premiere/cases/s2_5_undo.case.js 몫이다.
//   (1) 화자별 배치(놓기·갱신·다른 트랙 다시 놓기·템플릿 교체·목록에서 빠진 줄 지우기) → 되돌리기 → 모든 클립의 (uid, 트랙, 시작, 끝)과 속성 값이
//       적용 전과 같다, 줄은 '되돌린 줄'(mm undone), applied·ap는 실행 전으로 → 다시 ▶하면 같은 결과
//   (2) 적용 뒤 Premiere에서 고친 클립 → 되돌리기가 '그 뒤로 바뀜'으로 건너뛴다
//   (3) 중지한 적용(첫 청크만) → 되돌리기는 기록된 청크만
//   (4) 레거시 목록 +0.4초·문장 변경 → [안전하게 적용](v28): nodeId로 옮기고 갱신, 이웃 그대로, 중복 없음, 태그 없음 → 되돌리기
//   (5) 레거시 새 줄 놓기: 템플릿 길이가 뒤 줄 클립을 덮으면 스냅숏으로 다시 놓는다
//   (6) ↑: 시간이 바뀐 레거시 줄은 v28 경로 (move), v27 ▶는 기록을 superseded로 → 히스토리 항목이 사라진다
//   (7) 네이티브(구운 사본): 문구 교체·이동을 되돌리면 옛 구운 사본이 옛 자리에 (텍스트는 읽을 수 없어 nodeId·gen으로 확인)
const test = require("node:test");
const assert = require("node:assert/strict");
const { bootPanel, cachePaths: P } = require("../lib/panelHarness");
const { createSim, FT, TPS, aeText, aeTextValue, color } = require("../lib/premiereSim");
const { loadRegions } = require("../lib/loadRegions");

const CORE = loadRegions(["src/mi/core.ts"]);
const PROJ = "C:/work/undo.prproj";
const A = { seqId: "seq-undo-1", seqName: "T_UNDO", projPath: PROJ };
const MOGRT = "C:/m/[라온올제] 합성 자막.mogrt";
const MOGRT2 = "C:/m/[라온올제] 다른 자막.mogrt";
const SALT = "ab12";
const F = FT.f23976;
const sec = (f) => (f * F) / TPS;
const HOST_FNS = ["ping", "getTracks", "readClipTexts", "ensureVideoTracks", "placeChunk", "removeClips"];
const LA = () => P.session(PROJ, A.seqId).replace("session.json", "last_apply.json");

function tc(x) {
	const ms = Math.round(x * 1000);
	const p = (n, w) => String(n).padStart(w, "0");
	return p(Math.floor(ms / 3600000), 2) + ":" + p(Math.floor((ms % 3600000) / 60000), 2) + ":" + p(Math.floor((ms % 60000) / 1000), 2) + "." + p(ms % 1000, 3);
}
const srtTc = (f) => tc(sec(f)).replace(".", ",");
const srt = (cues) => cues.map(([sf, ef, t], i) => (i + 1) + "\n" + srtTc(sf) + " --> " + srtTc(ef) + "\n" + t + "\n").join("\n");
// 시뮬레이터 템플릿 → 프리셋 속성 (호스트 되읽기 = getMogrtParams 모양)
function presetOf(sim, seq, id, path, name, exposed) {
	const probe = sim.place(seq, 0, path, 90000, 90100);
	const r = sim.call("MI_readClipTexts", { seqId: seq.id, build: "@@BUILD@@", items: [{ track: 0, nodeId: sim.nodeId(probe) }], want: { params: true } });
	probe.track.clips.splice(probe.track.clips.indexOf(probe), 1);
	const params = r.results[0].params.map((p) => Object.assign({}, p, { group: "" }));
	return { id, name, mogrtPath: path, params, exposedIndices: exposed, textParamIndex: 0, exposedFontFields: {} };
}
function makeSim(o) {
	const sim = createSim();
	const seq = sim.addSequence({ name: A.seqName, id: A.seqId, ft: F, tracks: (o && o.tracks) || 6 });
	sim.addTemplate(MOGRT, { kind: "ae", name: "[라온올제] 합성 자막", params: [aeText("텍스트", "기본"), aeText("포인트 텍스트", ""), color("색", 4294901760)] });
	sim.addTemplate(MOGRT2, { kind: "ae", name: "[라온올제] 다른 자막", params: [aeText("텍스트", "기본 2"), color("박스", 4278190335)] });
	const preset = presetOf(sim, seq, "preset_3", MOGRT, "합성 자막", [0, 1]);
	const preset2 = presetOf(sim, seq, "preset_4", MOGRT2, "다른 자막", [0]);
	return { sim, seq, preset, preset2 };
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
function rowState(preset, text, extra) {
	const all = withCaption(preset, text);
	return Object.assign({ presetId: preset.id, params: all.filter((p) => preset.exposedIndices.indexOf(p.index) !== -1), _allParams: all, open: false, checked: false }, extra || {});
}
// 화자 줄 세션 (rows: [[id, spk, sf, ef, 문장]]). mk: 줄 상태 만들기 (없으면 AE 캡션)
function castSession(preset, rows, mk) {
	const subtitles = [];
	const rowStates = {};
	const n = { C1: 0, C2: 0 };
	rows.forEach(([id, spk, sf, ef, text]) => {
		subtitles.push({ index: ++n[spk], startTime: tc(sec(sf)), endTime: tc(sec(ef)), startSec: sec(sf), endSec: sec(ef), text, id, spk, srtNo: n[spk] });
		rowStates[id] = mk ? mk(text) : rowState(preset, text);
	});
	return {
		subtitles, rowStates, trashBin: [], nextId: Math.max(...rows.map((r) => r[0])) + 1,
		mi: { v: 1, salt: SALT, hwm: Math.max(...rows.map((r) => r[0])), legacyTrack: null, remapped: false, castOrder: ["C1", "C2"],
			cast: { C1: { name: "철수", track: null, autoTrack: null, presetId: preset.id, color: 0 }, C2: { name: "영희", track: null, autoTrack: null, presetId: preset.id, color: 1 } },
			stack: false, stackDy: 0.12, applied: {} }
	};
}
async function boot(sim, presets, session) {
	const h = await bootPanel({
		seq: A,
		mogrts: presets.map((p) => ({ name: p.name, path: p.mogrtPath })),
		files: { [P.presets(PROJ)]: { presets: Object.fromEntries(presets.map((p) => [p.id, p])), presetTrash: [], nextPresetId: 5 }, [P.session(PROJ, A.seqId)]: session }
	});
	HOST_FNS.forEach((n) => {
		h.host.handlers["MI_" + n] = (json) => sim.callRaw("MI_" + n, json === undefined ? undefined : JSON.stringify(json));
	});
	presets.forEach((p) => { h.host.params[p.mogrtPath] = p.params; });
	await h.advance(1000);
	return h;
}
async function done(h) {
	for (let i = 0; i < 600; i++) {
		await h.flush();
		if (!h.win._mogrtDebug.miBusy() && !h.$("preflightModal").classList.contains("open")) return;
		if (h.$("preflightModal").classList.contains("open")) return;
	}
	throw new Error("끝나지 않았다");
}
async function applyAll(h, answer) {
	h.$("btnApply").click();
	await done(h);
	if (h.$("preflightModal").classList.contains("open")) {
		if (answer) answer(h);
		h.$("pfOk").click();
		await done(h);
	}
	assert.equal(h.win._mogrtDebug.miBusy(), false);
}
const cmd = async (h, op, args) => JSON.parse(JSON.stringify(await h.win._mogrtDebug.cmd(op, args)));
const confirmOpen = (h) => h.$("confirmModal").classList.contains("open");
const resOf = (h, id) => { const el = h.$("row-" + id).querySelector(".sub-res"); return el ? el.textContent : null; };
function noErrors(h) {
	assert.deepEqual(h.errors().map((e) => String(e.message || e).slice(0, 300)), [], "패널 예외");
}
function noOverlap(seq) {
	seq.tracks.forEach((tr, ti) => {
		const c = tr.clips.slice().sort((a, b) => a.s - b.s);
		for (let i = 1; i < c.length; i++) assert.ok(c[i - 1].e <= c[i].s, "트랙 " + ti + " 겹침: " + c[i - 1].name + " / " + c[i].name);
	});
}
// 타임라인 전체 모습: 트랙마다 [uid(또는 이름), 시작, 끝, {속성: 값}] (태그 gen은 빼고 uid로 비교 — 되놓은 클립은 gen을 올린다)
function timeline(sim, seq) {
	const out = [];
	seq.tracks.forEach((tr, ti) => {
		if (ti === 0) return;
		tr.clips.slice().sort((a, b) => a.s - b.s).forEach((m) => {
			const tg = CORE.parseClipTag(m.name);
			const cap = sim.capsule(m);
			const props = {};
			(cap ? cap.props : []).forEach((p) => { props[p.displayName] = typeof p.value === "string" && p.value.indexOf("textEditValue") !== -1 ? "T:" + JSON.parse(p.value).textEditValue : p.value; });
			out.push([ti, tg ? tg.uid : m.name, Math.round(m.s / F), Math.round(m.e / F), m.tpl ? m.tpl.name : m.kind, props]);
		});
	});
	return out;
}
async function openHistory(h) {
	h.$("btnHistory").click();
	await h.flush();
	return h.$("btnUndoApply");
}

test("(1) 화자별 배치 → 되돌리기: 놓기·갱신·다른 트랙 다시 놓기·템플릿 교체·목록에서 빠진 줄 지우기가 모두 적용 전으로 (uid·트랙·시작·끝·속성), 줄은 '되돌린 줄' → 다시 ▶하면 같은 결과", async () => {
	const { sim, seq, preset, preset2 } = makeSim();
	const rows = [[1, "C1", 100, 160, "철수 하나"], [2, "C2", 120, 180, "영희 하나"], [3, "C1", 300, 360, "철수 둘"], [4, "C2", 420, 480, "영희 둘"], [5, "C1", 500, 560, "철수 셋"], [7, "C1", 700, 760, "철수 넷"]];
	const h = await boot(sim, [preset, preset2], castSession(preset, rows));
	await applyAll(h);
	assert.match(h.status().text, /^화자별 배치: 놓음 6$/);
	const s0 = timeline(sim, seq);
	const applied0 = h.snapshot().mi.applied;
	const ap0 = h.snapshot().rowStates[1].ap;
	// 바꾸기: C1 다시 가져오기 (줄 1 문장, 줄 7 빠짐 → 휴지통(병합), 새 줄), 줄 3 프리셋 → 다른 템플릿, C2 트랙 고정 V6
	const b64 = Buffer.from(srt([[100, 160, "철수 하나 고침"], [300, 360, "철수 둘"], [500, 560, "철수 셋"], [900, 960, "철수 새 줄"]]), "utf8").toString("base64");
	const mr = await cmd(h, "mergeCommit", { files: [{ name: "C1.srt", b64 }] });
	assert.equal(mr.ok, true, JSON.stringify(mr));
	let s = h.snapshot();
	const newId = s.subtitles.find((x) => x.text === "철수 새 줄").id;
	assert.equal(s.trashBin.find((t) => t.sub.id === 7).why, "merge");
	const sel = h.$("sel-3");
	sel.value = "preset_4";
	h.change(sel);
	await h.flush();
	assert.equal(h.snapshot().rowStates[3].presetId, "preset_4");
	const castTrack = h.$("castRows").querySelectorAll(".cast-row").find((r) => r.dataset.key === "C2").querySelector(".cast-track");
	castTrack.value = "5";
	h.change(castTrack);
	await applyAll(h);
	assert.match(h.status().text, /^화자별 배치: 놓음 1 · 갱신 1 · 옮김 2 · 교체 1 · 지움 1/, h.status().text);
	const la = h.fs.readJson(LA());
	assert.deepEqual(["created", "updated", "moved", "adopted", "replaced", "removed"].map((c) => la[c].length), [1, 1, 2, 0, 1, 1]);
	assert.equal(la.removed[0].why, "orphan");
	assert.equal(la.removed[0].m, MOGRT, "지운 클립의 템플릿 = applied.m");
	assert.ok(la.prev[SALT + "-3"] && la.prev[SALT + "-3"].a.m === MOGRT, "실행 전 줄 기록");
	assert.equal(la.updated[0].from.ef, 160);
	assert.equal(la.replaced[0].from.m, MOGRT);
	const s1 = timeline(sim, seq);
	assert.notDeepEqual(s1, s0);
	// 히스토리 맨 위 → 확인창 → 되돌리기
	const item = await openHistory(h);
	assert.ok(item);
	assert.match(item.textContent, /^↶ 마지막 적용 되돌리기 \(.+ · 6줄\)$/);
	item.click();
	await h.flush();
	assert.equal(confirmOpen(h), true);
	assert.equal(h.$("confirmMessage").textContent, "타임라인만 되돌립니다. 자막 목록과 후반 작업 값은 그대로이며, 되돌린 줄은 '변경 줄'로 표시됩니다.");
	assert.equal(h.$("confirmYes").textContent, "되돌리기");
	h.$("confirmYes").click();
	await done(h);
	assert.match(h.status().text, /^마지막 적용 되돌리기: 지움 1 · 되돌림 1 · 다시 놓음 3 · 되놓음 1/, h.status().text);
	assert.deepEqual(timeline(sim, seq), s0, "모든 클립이 적용 전과 같다 (uid·트랙·시작·끝·템플릿·속성)");
	noOverlap(seq);
	s = h.snapshot();
	// 자막 목록은 그대로 (문장·프리셋·새 줄), 되돌린 줄은 mm undone
	assert.equal(s.subtitles.find((x) => x.id === 1).text, "철수 하나 고침");
	assert.equal(s.rowStates[3].presetId, "preset_4");
	assert.deepEqual([1, 2, 3, 4, newId].map((id) => s.rowStates[id].mm), ["undone", "undone", "undone", "undone", "undone"]);
	assert.equal(s.rowStates[5].mm, undefined, "바뀌지 않은 줄");
	assert.deepEqual(s.rowStates[1].ap, ap0, "ap는 실행 전으로");
	assert.equal(s.mi.applied[SALT + "-" + newId], undefined, "새 줄은 applied 없음");
	assert.deepEqual(s.mi.applied[SALT + "-7"], applied0[SALT + "-7"], "목록에서 빠진 줄의 applied도 되살린다");
	assert.deepEqual(Object.assign({}, s.mi.applied[SALT + "-2"], { g: 1 }), applied0[SALT + "-2"], "다시 놓은 줄은 gen만 올렸다");
	assert.equal(s.mi.applied[SALT + "-2"].g, 3);
	assert.equal(h.$("row-1").querySelector(".sub-mm").className, "sub-mm mm-undone");
	assert.equal(h.$("btnSelectChanged").textContent, "변경 줄 (5)");
	const la2 = h.fs.readJson(LA());
	assert.equal(la2.undone.complete, true);
	assert.equal(await openHistory(h), null, "다 되돌린 기록은 항목이 없다");
	h.$("btnHistory").click();
	assert.equal(h.fs.readJson(P.historyAuto(PROJ, A.seqId))[0].label, "마지막 적용 되돌리기 (6개)");
	// 다시 ▶ → 적용 뒤 모습과 같다 (되돌린 줄의 기록이 맞다)
	await applyAll(h);
	assert.doesNotMatch(h.status().text, /충돌|실패|건너뜀/, h.status().text);
	const s2 = timeline(sim, seq);
	assert.deepEqual(s2, s1);
	assert.equal(h.snapshot().rowStates[1].mm, undefined);
	noErrors(h);
});

test("(2) 적용 뒤 Premiere에서 고친 클립은 '그 뒤로 바뀜'으로 건너뛰고 나머지만 되돌린다", async () => {
	const { sim, seq, preset, preset2 } = makeSim();
	const h = await boot(sim, [preset, preset2], castSession(preset, [[1, "C1", 100, 160, "철수 하나"], [3, "C1", 300, 360, "철수 둘"]]));
	await applyAll(h);
	const b64 = Buffer.from(srt([[100, 160, "철수 하나 고침"], [300, 360, "철수 둘"], [600, 660, "철수 새 줄"]]), "utf8").toString("base64");
	assert.equal((await cmd(h, "mergeCommit", { files: [{ name: "C1.srt", b64 }] })).ok, true);
	await applyAll(h);
	const la = h.fs.readJson(LA());
	assert.deepEqual([la.created.length, la.updated.length], [1, 1]);
	// Premiere에서 새로 놓은 클립의 문장을 고친다
	const created = sim.clips(seq, 2).find((m) => sim.nodeId(m) === la.created[0].nodeId);
	sim.prop(created, "텍스트").value = aeTextValue("Premiere에서 고친 새 줄");
	const r = await cmd(h, "undo", {});
	assert.equal(r.ok, true, JSON.stringify(r));
	assert.deepEqual([r.data.restored, r.data.removed, r.data.changed], [1, 0, 1]);
	assert.match(h.status().text, /^마지막 적용 되돌리기: 되돌림 1 · 그 뒤로 바뀜 1 \(건너뜀\)$/);
	const v3 = sim.clips(seq, 2).slice().sort((a, b) => a.s - b.s);
	assert.deepEqual(v3.map((m) => sim.textOf(m, "텍스트")), ["철수 하나", "철수 둘", "Premiere에서 고친 새 줄"], "고친 클립은 그대로");
	const newId = h.snapshot().subtitles.find((x) => x.text === "철수 새 줄").id;
	assert.equal(resOf(h, newId), "되돌리지 않음 — 그 뒤로 바뀜 (Premiere에서 문장을 고침)");
	assert.equal(h.snapshot().rowStates[newId].mm, undefined, "건너뛴 줄은 적용 뒤 그대로 (검증된 적용으로 지운 표시)");
	assert.equal(h.snapshot().rowStates[1].mm, "undone");
	// agent는 승인 전까지 되돌리지 못한다
	const ag = JSON.parse(JSON.stringify(await h.win._mogrtDebug.cmdAs("agent", "undo", {})));
	assert.equal(ag.error, "needs-approval");
	noErrors(h);
});

test("(3) 중지한 적용(첫 청크)의 되돌리기는 기록된 청크만 지운다 — 히스토리 항목에 '(중단된 적용)'", async () => {
	const { sim, seq, preset, preset2 } = makeSim();
	const rows = [];
	for (let k = 0; k < 12; k++) rows.push([k + 1, "C1", 100 + k * 100, 160 + k * 100, "철수 " + (k + 1)]);
	const h = await boot(sim, [preset, preset2], castSession(preset, rows));
	let n = 0;
	h.host.handlers.MI_placeChunk = (json) => {
		n++;
		if (n === 1) h.win._mogrtDebug.miStop();
		return sim.callRaw("MI_placeChunk", JSON.stringify(json));
	};
	await applyAll(h);
	assert.equal(sim.clips(seq, 2).length, 8);
	const item = await openHistory(h);
	assert.match(item.textContent, /\(중단된 적용\)$/);
	item.click();
	await h.flush();
	assert.match(h.$("confirmMessage").textContent, /중단된 적용입니다: 기록된 청크만 되돌립니다\.$/);
	h.$("confirmYes").click();
	await done(h);
	assert.match(h.status().text, /^마지막 적용 되돌리기: 지움 8$/);
	assert.equal(sim.clips(seq, 2).length, 0);
	const s = h.snapshot();
	assert.deepEqual(rows.map((r) => s.rowStates[r[0]].mm || ""), ["undone", "undone", "undone", "undone", "undone", "undone", "undone", "undone", "", "", "", ""]);
	assert.equal(Object.keys(s.mi.applied).length, 0);
	noErrors(h);
});

// ── 레거시 목록 (화자 표 없음) ──
// 병합 뒤 상태의 레거시 목록 (rows: [[id, 시작 초, 끝 초, 문장, rs 덧붙임]]). v27이 놓은 클립은 테스트가 sim.place로 둔다 (태그 없음)
function legacySession(preset, rows) {
	const subtitles = [];
	const rowStates = {};
	rows.forEach(([id, s, e, text, extra], i) => {
		subtitles.push({ index: i + 1, startTime: tc(s), endTime: tc(e), startSec: s, endSec: e, text, id });
		rowStates[id] = rowState(preset, text, extra);
	});
	return { subtitles, rowStates, trashBin: [], nextId: Math.max(...rows.map((r) => r[0])) + 1 };
}
const f24 = (s) => Math.round((s * TPS) / F);

test("(4) 레거시 목록 +0.4초·문장 변경 → [안전하게 적용](v28): 옮긴 클립은 같은 nodeId로 새 자리, 문장은 이름으로, 이웃 그대로, 중복·태그 없음 → 되돌리기", async () => {
	const { sim, seq, preset, preset2 } = makeSim();
	const cues = [[1, 1, 3, "첫째 합성 줄"], [2, 4, 6, "둘째 합성 줄"], [3, 7, 9, "셋째 합성 줄"], [4, 10, 12, "넷째 합성 줄"]];
	const clips = cues.map(([, s, e, t]) => sim.place(seq, 2, MOGRT, f24(s), f24(e), null, { texts: [t] }));
	const ids0 = clips.map((m) => sim.nodeId(m));
	const sess = legacySession(preset, [
		[1, 1, 3, "첫째 합성 줄"],
		[2, 4, 6, "둘째 합성 줄 고침", { mm: "text", mmPrev: { s: 4, e: 6, cap: "둘째 합성 줄" } }],
		[3, 7.4, 9.4, "셋째 합성 줄", { mm: "time", mmPrev: { s: 7, e: 9, cap: "셋째 합성 줄" } }],
		[4, 10, 12, "넷째 합성 줄"]
	]);
	const h = await boot(sim, [preset, preset2], sess);
	const before4 = [sim.nodeId(clips[3]), clips[3].s, clips[3].e];
	h.$("btnApply").click();
	await done(h);
	assert.equal(confirmOpen(h), true);
	assert.match(h.$("confirmMessage").textContent, /^바뀐 줄 2개\(시간 변경 1개 포함\)가 있습니다\./);
	assert.match(h.$("confirmMessage").textContent, /클립만 타임라인에서 찾아\(nodeId\) 제자리 갱신·시간 이동·새로 놓기/);
	assert.match(h.$("confirmMessage").textContent, /시간이 바뀐 줄 1개는 클립을 새 시간으로 옮깁니다/);
	assert.equal(h.$("confirmYes").textContent, "안전하게 적용 (2)");
	h.$("confirmYes").click();
	await done(h);
	assert.equal(h.status().text, "안전하게 적용: 갱신 1 · 옮김 1");
	const v3 = sim.clips(seq, 2).slice().sort((a, b) => a.s - b.s);
	assert.equal(v3.length, 4, "중복 없음");
	assert.deepEqual(v3.map((m) => [sim.nodeId(m), Math.round(m.s / F), Math.round(m.e / F), sim.textOf(m, "텍스트")]), [
		[ids0[0], f24(1), f24(3), "첫째 합성 줄"], [ids0[1], f24(4), f24(6), "둘째 합성 줄 고침"], [ids0[2], f24(7.4), f24(9.4), "셋째 합성 줄"], [ids0[3], f24(10), f24(12), "넷째 합성 줄"]
	]);
	assert.deepEqual([sim.nodeId(v3[3]), v3[3].s, v3[3].e], before4, "이웃 그대로");
	assert.ok(v3.every((m) => !CORE.parseClipTag(m.name)), "태그 없음");
	assert.equal(h.host.calls.filter((c) => c.fn === "updateClipAtTime" || c.fn === "applyToTimeline").length, 0, "v27 호스트는 부르지 않는다");
	let s = h.snapshot();
	assert.equal(s.rowStates[3].mm, undefined);
	assert.deepEqual([s.rowStates[3].ap.s, s.rowStates[3].ap.t], [7.4, 2]);
	assert.deepEqual(Object.keys(h.fs.readJson(P.session(PROJ, A.seqId))), ["subtitles", "rowStates", "trashBin", "nextId"], "단일 화자 파일 모양");
	const la = h.fs.readJson(LA());
	assert.deepEqual([la.legacy, la.updated.map((e) => e.key), la.moved.map((e) => e.key), la.moved[0].from.sf], [true, ["r2"], ["r3"], f24(7)]);
	assert.equal(h.fs.readJson(P.historyAuto(PROJ, A.seqId))[0].label, "안전하게 적용 (2개)");
	// 되돌리기
	const r = await cmd(h, "undo", {});
	assert.equal(r.ok, true, JSON.stringify(r));
	const v3b = sim.clips(seq, 2).slice().sort((a, b) => a.s - b.s);
	assert.deepEqual(v3b.map((m) => [sim.nodeId(m), Math.round(m.s / F), Math.round(m.e / F), sim.textOf(m, "텍스트")]), [
		[ids0[0], f24(1), f24(3), "첫째 합성 줄"], [ids0[1], f24(4), f24(6), "둘째 합성 줄"], [ids0[2], f24(7), f24(9), "셋째 합성 줄"], [ids0[3], f24(10), f24(12), "넷째 합성 줄"]
	]);
	s = h.snapshot();
	assert.deepEqual([s.rowStates[2].mm, s.rowStates[3].mm, s.rowStates[3].ap, s.rowStates[3].mmPrev.s], ["undone", "undone", undefined, 7]);
	// 되돌린 줄은 다시 안전하게 적용할 수 있다 (속성 전부)
	h.$("btnApply").click();
	await done(h);
	assert.equal(h.$("confirmYes").textContent, "안전하게 적용 (2)");
	h.$("confirmYes").click();
	await done(h);
	assert.equal(h.status().text, "안전하게 적용: 갱신 1 · 옮김 1");
	assert.equal(sim.textOf(sim.clips(seq, 2).find((m) => sim.nodeId(m) === ids0[1]), "텍스트"), "둘째 합성 줄 고침");
	noErrors(h);
});

test("(5) 레거시 새 줄: 템플릿 길이(5초)가 뒤 줄의 짧은 클립을 통째로 덮으면 놓기 전에 읽어 둔 스냅숏으로 다시 놓는다 (속성·이름 그대로)", async () => {
	const { sim, seq, preset, preset2 } = makeSim();
	const nb = sim.place(seq, 2, MOGRT, f24(5), f24(7), null, { texts: ["다음 줄"] });
	sim.prop(nb, "색").value = 4278255360;
	const sess = legacySession(preset, [[1, 3, 4.5, "새로 더한 줄", { mm: "new" }], [2, 5, 7, "다음 줄"]]);
	const h = await boot(sim, [preset, preset2], sess);
	const r = await h.win._mogrtDebug.legacySafeApply([1], {});
	assert.equal(r.ok, true, JSON.stringify(r));
	assert.deepEqual([r.created, r.repaired, r.lost], [1, 1, 0]);
	assert.equal(h.status().text, "안전하게 적용: 놓음 1 · 덮인 이웃 다시 놓음 1");
	const v3 = sim.clips(seq, 2).slice().sort((a, b) => a.s - b.s);
	assert.deepEqual(v3.map((m) => [Math.round(m.s / F), Math.round(m.e / F), sim.textOf(m, "텍스트"), sim.prop(m, "색").value]), [
		[f24(3), f24(4.5), "새로 더한 줄", 4294901760], [f24(5), f24(7), "다음 줄", 4278255360]
	]);
	assert.ok(v3.every((m) => !CORE.parseClipTag(m.name)));
	noOverlap(seq);
	// 되돌리기: 놓은 줄만 지운다 (다시 놓은 이웃은 그대로)
	const u = await cmd(h, "undo", {});
	assert.equal(u.data.removed, 1);
	assert.deepEqual(sim.clips(seq, 2).map((m) => sim.textOf(m, "텍스트")), ["다음 줄"]);
	noErrors(h);
});

test("(6) ↑: 시간이 바뀐 레거시 줄은 v28 경로로 옮긴다 (nodeId 그대로) · v27 ▶는 기록을 superseded로 바꿔 히스토리 항목이 사라진다", async () => {
	const { sim, seq, preset, preset2 } = makeSim();
	const m1 = sim.place(seq, 2, MOGRT, f24(2), f24(4), null, { texts: ["하나"] });
	sim.place(seq, 2, MOGRT, f24(8), f24(10), null, { texts: ["둘"] });
	const sess = legacySession(preset, [[1, 2.4, 4.4, "하나", { mm: "time", mmPrev: { s: 2, e: 4, cap: "하나" } }], [2, 8, 10, "둘"]]);
	const h = await boot(sim, [preset, preset2], sess);
	h.$("row-1").querySelectorAll("button").find((b) => b.title === "이 자막만 타임라인에 업데이트").click();
	await done(h);
	assert.equal(h.status().text, "안전하게 적용: 옮김 1");
	assert.deepEqual([sim.nodeId(sim.clips(seq, 2)[0]), Math.round(sim.clips(seq, 2)[0].s / F)], [sim.nodeId(m1), f24(2.4)]);
	assert.equal(h.host.calls.filter((c) => c.fn === "updateClipAtTime").length, 0);
	assert.ok(await openHistory(h), "되돌릴 수 있다");
	h.$("btnHistory").click();
	// v27 ▶ (전체 적용): 기록은 superseded
	h.host.handlers.applyToTimeline = () => "SUCCESS: 2개 배치";
	h.$("btnApply").click();
	await done(h);
	assert.equal(h.fs.readJson(LA()).superseded, true);
	assert.equal(await openHistory(h), null);
	h.$("btnHistory").click();
	const u = await cmd(h, "undo", {});
	assert.equal(u.error, "not-found");
	noErrors(h);
});

test("(7) 네이티브(구운 사본): 문구 교체·같은 트랙 이동을 되돌리면 옛 구운 사본이 옛 자리에, 옮긴 클립은 같은 nodeId로 제자리 (텍스트는 읽을 수 없어 nodeId·gen으로만 확인)", async () => {
	const N = require("../fixtures/mogrt/make_native_mogrt");
	const { build } = require("../fixtures/presets_synth");
	const { CACHE_ROOT, projKeyOf } = require("../lib/panelHarness");
	const SRC = "D:/MOGRT/합성 네이티브.mogrt";
	const sim = createSim();
	const seq = sim.addSequence({ name: A.seqName, id: A.seqId, ft: F, tracks: 6 });
	// 구운 사본(cache/…/baked/<키>.mogrt)은 어느 경로든 두 줄짜리 네이티브 템플릿으로 놓인다
	const baked = {};
	sim.S.templates = new Proxy(sim.S.templates, {
		get: (t, k) => t[k] || (typeof k === "string" && k.indexOf("/baked/") !== -1 ? (baked[k] = baked[k] || { path: k, kind: "native", name: "Graphic", durSec: 5.005, texts: 2, params: [] }) : undefined)
	});
	const preset = { id: "preset_9", name: "네이티브 합성", mogrtPath: SRC, params: JSON.parse(JSON.stringify(build().NATIVE)), exposedIndices: [0, 1], textParamIndex: 0, exposedFontFields: {} };
	const nrow = (text) => {
		const all = JSON.parse(JSON.stringify(preset.params));
		all[0].value = text;
		return { presetId: preset.id, params: all.slice(), _allParams: all, open: false, checked: false };
	};
	const sess = castSession(preset, [[1, "C1", 100, 160, "첫째 네이티브"], [2, "C1", 400, 460, "둘째 네이티브"]], nrow);
	const h = await bootPanel({
		seq: A,
		mogrts: [{ name: preset.name, path: SRC }],
		params: { [SRC]: JSON.parse(JSON.stringify(build().NATIVE)) },
		files: { [P.presets(PROJ)]: { presets: { preset_9: preset }, presetTrash: [], nextPresetId: 10 }, [P.session(PROJ, A.seqId)]: sess },
		node: { files: { [SRC]: { data: N.buildNativeMogrt({}), mtimeMs: 1727000000000 } } }
	});
	HOST_FNS.forEach((n) => { h.host.handlers["MI_" + n] = (json) => sim.callRaw("MI_" + n, json === undefined ? undefined : JSON.stringify(json)); });
	await h.advance(1000);
	await applyAll(h);
	assert.match(h.status().text, /^화자별 배치: 놓음 2$/, h.status().text);
	const v3 = () => sim.clips(seq, 2).slice().sort((a, b) => a.s - b.s).map((m) => [sim.nodeId(m), Math.round(m.s / F), Math.round(m.e / F), m.kind, m.tpl.path, CORE.parseClipTag(m.name).uid]);
	const s0 = v3();
	assert.ok(s0.every((c) => c[3] === "native" && c[4].indexOf(CACHE_ROOT + "/" + projKeyOf(PROJ) + "/baked/") === 0), JSON.stringify(s0));
	// 첫째 문구 → 교체 (새 구운 사본), 둘째 +10프레임 → 같은 트랙 이동
	const b64 = Buffer.from(srt([[100, 160, "첫째 네이티브 고침"], [410, 470, "둘째 네이티브"]]), "utf8").toString("base64");
	assert.equal((await cmd(h, "mergeCommit", { files: [{ name: "C1.srt", b64 }] })).ok, true);
	await applyAll(h);
	assert.match(h.status().text, /^화자별 배치: 옮김 1 · 교체 1$/, h.status().text);
	const s1 = v3();
	assert.notEqual(s1[0][4], s0[0][4], "새 구운 사본");
	assert.deepEqual([s1[1][0], s1[1][1]], [s0[1][0], 410], "이동은 같은 클립");
	const la = h.fs.readJson(LA());
	assert.deepEqual([la.replaced[0].k, la.replaced[0].from.m, la.moved[0].k], ["native", s0[0][4], "native"]);
	const r = await cmd(h, "undo", {});
	assert.equal(r.ok, true, JSON.stringify(r));
	assert.deepEqual([r.data.replaced, r.data.moved, r.data.changed], [1, 1, 0]);
	const s2 = v3();
	assert.deepEqual(s2.map((c) => c.slice(1)), s0.map((c) => c.slice(1)), "자리·종류·구운 사본(템플릿)·uid가 적용 전과 같다");
	assert.equal(s2[1][0], s0[1][0], "옮긴 클립은 같은 nodeId로 되돌렸다");
	assert.equal(sim.S.counts.nativeTextWrites, 0, "네이티브 Source Text에는 쓰지 않는다");
	assert.deepEqual([1, 2].map((id) => h.snapshot().rowStates[id].mm), ["undone", "undone"]);
	noErrors(h);
});

test("(8) 적용 중 덮여 사라진 이웃을 다시 놓은 기록(fix)은 되돌리기가 지우지 않는다 · 되놓은 옛 템플릿이 그 이웃을 다시 덮으면 스냅숏으로 되살린다", async () => {
	const { sim, seq, preset, preset2 } = makeSim();
	const h = await boot(sim, [preset, preset2], castSession(preset, [[1, "C1", 100, 120, "짧은 하나"], [2, "C1", 130, 140, "짧은 둘"]]));
	await applyAll(h);
	const s0 = timeline(sim, seq);
	const sel = h.$("sel-1");
	sel.value = "preset_4";
	h.change(sel);
	await h.flush();
	await applyAll(h);
	const la = h.fs.readJson(LA());
	assert.equal(la.replaced.length, 1);
	assert.deepEqual(la.created.map((e) => [e.key, e.fix]), [[SALT + "-2", true]], "덮인 줄 2를 다시 놓았다 (fix)");
	assert.deepEqual(timeline(sim, seq).map((c) => [c[1], c[4]]), [[SALT + "-1", "[라온올제] 다른 자막"], [SALT + "-2", "[라온올제] 합성 자막"]]);
	const r = await cmd(h, "undo", {});
	assert.equal(r.ok, true, JSON.stringify(r));
	assert.deepEqual([r.data.replaced, r.data.kept, r.data.removed, r.data.lost, r.data.repaired], [1, 1, 0, 0, 1], "옛 템플릿(5초)이 줄 2를 다시 덮어 스냅숏으로 되살렸다");
	assert.match(h.status().text, /덮여서 다시 놓은 이웃 1개는 그대로/);
	assert.deepEqual(timeline(sim, seq), s0, "줄 1은 옛 템플릿, 줄 2는 남아 있다");
	assert.equal(h.snapshot().rowStates[2].mm, undefined, "그대로 둔 줄은 표시하지 않는다");
	noErrors(h);
});
