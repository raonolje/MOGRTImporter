"use strict";
// S2-4: 화자별 배치 끝에서 끝까지 — panelHarness(app.js 전체) + premiereSim(hostscript.jsx 전체, 가짜 Premiere).
// 패널의 host.mi 호출(MI_*)을 시뮬레이터로 잇는다. 실제 Premiere 동작은 하드 케이스 tests/premiere/cases/s2_4_e2e.case.js 몫이다.
//   (a) 2화자: 적용 전 점검(새 트랙) → V3·V5(새), 태그 클립, 같은 트랙 겹침 없음, 화자 트랙 섞이지 않음, applied·ap·학습 필드·last_apply·히스토리
//   (b) 다시 적용 → 보내는 작업 0 (placeChunk 없음)
//   (c) 첫 청크 뒤 [중지] → last_apply complete false, 히스토리 '(중단된 적용)' → 다시 적용하면 uid마다 현재 클립 하나
//   (d) Premiere에서 고친 클립 + 패널에서 캡션 바꿈 → 점검 창에 '고친 클립 1개 덮어쓰기'(꺼짐) → 그 클립은 그대로, 줄에 'Premiere에서 고침'
//   (e) ↑ 한 줄 → 그 클립만 갱신 (nodeId 그대로, 점검 창 없음)
//   (f) 나눈 레거시 목록 → C1은 기본 트랙에서 인식, C2의 옛 클립은 C2 트랙으로 옮김, 중복 없음
//   (g) 복제한 시퀀스(다른 salt 태그) → 문장으로 인식, 충돌 0, 우리 salt로 이름 바꿈
//   워치독(20초), 이웃이 통째로 덮이면 다시 놓기(분기 C), plan·apply 명령
const test = require("node:test");
const assert = require("node:assert/strict");
const { bootPanel, cachePaths: P } = require("../lib/panelHarness");
const { createSim, FT, TPS, aeText, aeTextValue, color } = require("../lib/premiereSim");
const { loadRegions, plain } = require("../lib/loadRegions");

const CORE = loadRegions(["src/mi/core.ts"]);
const PROJ = "C:/work/apply.prproj";
const A = { seqId: "seq-apply-1", seqName: "T_APPLY", projPath: PROJ };
const MOGRT = "C:/m/[라온올제] 합성 자막.mogrt";
const SALT = "ab12";
const F = FT.f23976;
const sec = (f) => (f * F) / TPS;
const HOST_FNS = ["ping", "getTracks", "readClipTexts", "ensureVideoTracks", "placeChunk", "removeClips"];

function tc(x) {
	const ms = Math.round(x * 1000);
	const p = (n, w) => String(n).padStart(w, "0");
	return p(Math.floor(ms / 3600000), 2) + ":" + p(Math.floor((ms % 3600000) / 60000), 2) + ":" + p(Math.floor((ms % 60000) / 1000), 2) + "." + p(ms % 1000, 3);
}
// 시뮬레이터 템플릿에서 프리셋 속성 (호스트 MI__readParams 결과 = getMogrtParams와 같은 모양으로 쓴다)
function makeSim(o) {
	const sim = createSim();
	const seq = sim.addSequence({ name: A.seqName, id: A.seqId, ft: F, tracks: (o && o.tracks) || 4 });
	sim.addTemplate(MOGRT, { kind: "ae", name: "[라온올제] 합성 자막", params: [aeText("텍스트", "기본"), aeText("포인트 텍스트", ""), color("색", 4294967295)] });
	const probe = sim.place(seq, 0, MOGRT, 90000, 90100);
	const r = sim.call("MI_readClipTexts", { seqId: seq.id, build: "@@BUILD@@", items: [{ track: 0, nodeId: sim.nodeId(probe) }], want: { params: true } });
	probe.track.clips.splice(probe.track.clips.indexOf(probe), 1);
	const params = r.results[0].params.map((p) => Object.assign({}, p, { group: "" }));
	const preset = { id: "preset_3", name: "합성 자막", mogrtPath: MOGRT, params, exposedIndices: [0, 1], textParamIndex: 0, exposedFontFields: {} };
	return { sim, seq, preset };
}
function withCaption(preset, text, point) {
	const all = JSON.parse(JSON.stringify(preset.params));
	const set = (p, t) => {
		p.value = t;
		const raw = JSON.parse(p.rawValue);
		raw.textEditValue = t;
		raw.fontTextRunLength = [t.length];
		p.rawValue = JSON.stringify(raw);
	};
	set(all[0], text);
	if (point !== undefined) set(all[1], point);
	return all;
}
// 화자 줄 세션 (rows: [[id, spk, sf, ef, 문장]])
function castSession(preset, rows, extra) {
	const subtitles = [];
	const rowStates = {};
	const n = { C1: 0, C2: 0, C3: 0 };
	rows.forEach(([id, spk, sf, ef, text]) => {
		const s = { index: ++n[spk], startTime: tc(sec(sf)), endTime: tc(sec(ef)), startSec: sec(sf), endSec: sec(ef), text, id };
		if (spk) { s.spk = spk; s.srtNo = s.index; }
		subtitles.push(s);
		const all = withCaption(preset, text);
		rowStates[id] = { presetId: preset.id, params: all.filter((p) => preset.exposedIndices.indexOf(p.index) !== -1), _allParams: all, open: false, checked: false };
	});
	const x = extra || {};
	return {
		subtitles, rowStates, trashBin: x.trashBin || [], nextId: Math.max(...rows.map((r) => r[0])) + 1,
		mi: Object.assign({ v: 1, salt: SALT, hwm: Math.max(...rows.map((r) => r[0])), legacyTrack: null, remapped: false, castOrder: ["C1", "C2"],
			cast: { C1: { name: "철수", track: null, autoTrack: null, presetId: preset.id, color: 0 }, C2: { name: "영희", track: null, autoTrack: null, presetId: preset.id, color: 1 } },
			stack: false, stackDy: 0.12, applied: {} }, x.mi || {})
	};
}
async function boot(sim, preset, session, o) {
	const h = await bootPanel(Object.assign({
		seq: A,
		mogrts: [{ name: preset.name, path: preset.mogrtPath }],
		files: { [P.presets(PROJ)]: { presets: { [preset.id]: preset }, presetTrash: [], nextPresetId: 4 }, [P.session(PROJ, A.seqId)]: session }
	}, o || {}));
	HOST_FNS.forEach((n) => {
		h.host.handlers["MI_" + n] = (json) => sim.callRaw("MI_" + n, json === undefined ? undefined : JSON.stringify(json));
	});
	await h.advance(1000);
	return h;
}
async function settle(h) {
	for (let i = 0; i < 400; i++) {
		await h.flush();
		if (!h.win._mogrtDebug.miBusy() && !h.$("preflightModal").classList.contains("open")) return;
		if (h.$("preflightModal").classList.contains("open")) return;
	}
	throw new Error("적용이 끝나지 않았다");
}
async function done(h) {
	for (let i = 0; i < 400 && h.win._mogrtDebug.miBusy(); i++) await h.flush();
	assert.equal(h.win._mogrtDebug.miBusy(), false, "적용이 끝났다");
}
const pfOpen = (h) => h.$("preflightModal").classList.contains("open");
const pfLines = (h) => h.$("pfSummary").querySelectorAll(".pf-line").map((e) => e.textContent);
const pfOpt = (h, id) => {
	const cb = h.$(id);
	const row = cb.parentNode;
	return { shown: row.style.display !== "none", checked: cb.checked, text: row.querySelector("span").textContent };
};
async function applyAll(h, answer) {
	h.$("btnApply").click();
	await settle(h);
	if (pfOpen(h)) {
		if (answer) answer(h);
		h.$("pfOk").click();
	}
	await done(h);
}
const cmd = async (h, op, args) => JSON.parse(JSON.stringify(await h.win._mogrtDebug.cmd(op, args)));
const mtags = (sim, seq, ti) => sim.clips(seq, ti).map((m) => [Math.round(m.s / F), Math.round(m.e / F), m.name]);
const textOf = (sim, m) => sim.textOf(m, "텍스트");
function noOverlap(sim, seq) {
	seq.tracks.forEach((tr, ti) => {
		const c = tr.clips.slice().sort((a, b) => a.s - b.s);
		for (let i = 1; i < c.length; i++) assert.ok(c[i - 1].e <= c[i].s, "트랙 " + ti + " 겹침: " + c[i - 1].name + " / " + c[i].name);
	});
}
function noErrors(h) {
	assert.deepEqual(h.errors().map((e) => String(e.message || e).slice(0, 300)), [], "패널 예외");
}
const calls = (h, fn) => h.host.calls.filter((c) => c.fn === fn);

// 2화자 × 10줄, 동시 발화 3쌍 (C1과 C2의 시간이 겹친다)
function twoSpeakerRows() {
	const rows = [];
	let id = 1;
	for (let k = 0; k < 10; k++) {
		const s = 100 + k * 150;
		rows.push([id++, "C1", s, s + 60, "철수 " + (k + 1)]);
		const t = k < 3 ? s + 30 : s + 80;
		rows.push([id++, "C2", t, t + 50, "영희 " + (k + 1)]);
	}
	return rows;
}

test("(a)(b) 2화자: 새 트랙 점검 → 화자마다 트랙, 태그 클립, 겹침 없음 · 다시 적용하면 보내는 작업 0", async () => {
	const { sim, seq, preset } = makeSim({ tracks: 4 });
	sim.placeOther(seq, 3, 0, 3000, "외부.png"); // V4에 남의 클립 (T_ 시퀀스처럼) → C2는 V5(새로 만든다)
	const h = await boot(sim, preset, castSession(preset, twoSpeakerRows()));
	assert.equal(h.$("trackSelLabel").textContent, "기본 트랙");
	assert.equal(h.$("castTrackSummary").textContent, "C1→V3 · C2→V4", "스캔 전 미리보기");
	h.$("btnApply").click();
	await settle(h);
	assert.equal(pfOpen(h), true, "새 트랙이 있어 점검 창");
	const lines = pfLines(h);
	assert.match(lines[0], /^배치 20줄: C1 철수 V3 10 · C2 영희 V5 10$/);
	assert.ok(lines.indexOf("새 비디오 트랙 1개 (V5)") !== -1, lines.join(" | "));
	assert.equal(pfOpt(h, "pfReplaceMissing").shown, false, "해당 없는 선택지는 숨긴다");
	h.$("pfOk").click();
	await done(h);
	assert.equal(seq.tracks.length, 5, "V5를 만들었다");
	const v3 = mtags(sim, seq, 2);
	const v5 = mtags(sim, seq, 4);
	assert.equal(v3.length, 10);
	assert.equal(v5.length, 10);
	assert.ok(v3.every((c) => /^철수 \[MI:ab12-\d+\.1\]$/.test(c[2])), "C1은 V3");
	assert.ok(v5.every((c) => /^영희 \[MI:ab12-\d+\.1\]$/.test(c[2])), "C2는 V5");
	assert.deepEqual(v3[0], [100, 160, "철수 [MI:ab12-1.1]"]);
	assert.deepEqual(v5[0], [130, 180, "영희 [MI:ab12-2.1]"]);
	noOverlap(sim, seq);
	assert.equal(textOf(sim, sim.clips(seq, 4)[0]), "영희 1");
	let s = h.snapshot();
	assert.deepEqual([s.mi.cast.C1.autoTrack, s.mi.cast.C2.autoTrack], [2, 4]);
	assert.equal(Object.keys(s.mi.applied).length, 20);
	const ap = s.mi.applied["ab12-2"];
	assert.deepEqual([ap.g, ap.t, ap.sf, ap.ef, ap.k, ap.m], [1, 4, 130, 180, "ae", MOGRT]);
	assert.equal(ap.rh, CORE.textsHash(["영희 1", ""]));
	assert.deepEqual([s.rowStates[2].ap.t, s.rowStates[2].ap.cap], [4, "영희 1"]);
	// 프리셋 학습 필드 (첫 새 배치)
	const pr = s.presets.preset_3;
	assert.deepEqual([pr.mogrtItemName, pr.mogrtDurSec, pr.mogrtBaseComps], ["[라온올제] 합성 자막", 5.005, 3]);
	assert.equal(pr.mogrtLs, CORE.clipLs([["텍스트", "t"], ["포인트 텍스트", "t"], ["색", "o"]]));
	assert.equal(h.fs.readJson(P.presets(PROJ)).presets.preset_3.mogrtLs, pr.mogrtLs, "presets.json에 저장");
	// last_apply·히스토리·상태
	const la = h.fs.readJson(P.session(PROJ, A.seqId).replace("session.json", "last_apply.json"));
	assert.deepEqual([la.complete, la.created.length, la.seqId, la.salt, la.rows], [true, 20, A.seqId, SALT, 20]);
	assert.equal(la.created[0].nodeId, sim.nodeId(sim.clips(seq, 2)[0]));
	const auto = h.fs.readJson(P.historyAuto(PROJ, A.seqId));
	assert.equal(auto[0].label, "타임라인 적용 (20개)");
	assert.match(h.status().text, /^화자별 배치: 놓음 20 · 새 트랙 1$/);
	assert.equal(h.$("castTrackSummary").textContent, "C1→V3 · C2→V5");
	// (b) 다시 적용: 점검 창 없이 '변경 없음', placeChunk·readClipTexts 없음
	const nPlace = calls(h, "MI_placeChunk").length;
	const nRead = calls(h, "MI_readClipTexts").length;
	h.$("btnApply").click();
	await done(h);
	assert.equal(pfOpen(h), false);
	assert.equal(calls(h, "MI_placeChunk").length, nPlace, "보낸 작업 0");
	assert.equal(calls(h, "MI_readClipTexts").length, nRead, "되읽기도 없다");
	assert.match(h.status().text, /^변경 없음 — 보낼 줄이 없습니다 \(20줄 그대로\)$/);
	s = h.snapshot();
	assert.equal(s.mi.cast.C2.autoTrack, 4);
	noErrors(h);
});

test("(c) 첫 청크 뒤 [중지] → last_apply complete false, 히스토리 '(중단된 적용)' → 다시 적용하면 이어서, uid마다 현재 클립 하나", async () => {
	const { sim, seq, preset } = makeSim({ tracks: 6 });
	const h = await boot(sim, preset, castSession(preset, twoSpeakerRows()));
	let n = 0;
	h.host.handlers.MI_placeChunk = (json) => {
		n++;
		if (n === 1) h.win._mogrtDebug.miStop();
		return sim.callRaw("MI_placeChunk", JSON.stringify(json));
	};
	await applyAll(h);
	assert.equal(n, 1, "청크 하나 뒤 멈춤");
	assert.match(h.status().text, /^중지함 — 다시 적용하면 이어서 진행 · 화자별 배치: 놓음 8/);
	const la = h.fs.readJson(P.session(PROJ, A.seqId).replace("session.json", "last_apply.json"));
	assert.deepEqual([la.complete, la.created.length], [false, 8]);
	h.$("btnHistory").click();
	const undo = h.$("btnUndoApply");
	assert.ok(undo, "마지막 적용 항목");
	assert.match(undo.textContent, /^↶ 마지막 적용 되돌리기 \(.+ · 20줄\) \(중단된 적용\)$/);
	h.$("btnHistory").click();
	// 다시 적용 → 나머지 12개만
	h.host.handlers.MI_placeChunk = (json) => sim.callRaw("MI_placeChunk", JSON.stringify(json));
	await applyAll(h);
	const all = [];
	seq.tracks.forEach((tr, ti) => tr.clips.forEach((m) => all.push({ i: ti, name: m.name })));
	const idx = plain(CORE.scanIndex(seq.tracks.map((tr, ti) => ({ i: ti, clips: tr.clips.map((m) => ({ sf: 0, ef: 1, nodeId: sim.nodeId(m), name: m.name })) })), SALT));
	assert.equal(Object.keys(idx.current).length, 20, "uid마다 현재 클립 하나");
	assert.deepEqual([idx.stale.length, Object.keys(idx.dup).length], [0, 0]);
	assert.match(h.status().text, /^화자별 배치: 놓음 12 · 그대로 8$/);
	const la2 = h.fs.readJson(P.session(PROJ, A.seqId).replace("session.json", "last_apply.json"));
	assert.deepEqual([la2.complete, la2.created.length], [true, 12]);
	noOverlap(sim, seq);
	noErrors(h);
});

test("(d) Premiere에서 고친 클립(T2) + 패널에서 캡션(T1) 바꿈 → 점검 창 '고친 클립 1개 덮어쓰기'(꺼짐) → 건너뜀, 켜면 덮어쓴다", async () => {
	const { sim, seq, preset } = makeSim({ tracks: 6 });
	const h = await boot(sim, preset, castSession(preset, [[1, "C1", 100, 160, "철수 하나"], [2, "C1", 300, 360, "철수 둘"]]));
	await applyAll(h);
	// Premiere에서 첫 클립의 T2(포인트 텍스트)를 고친다
	const m1 = sim.clips(seq, 2)[0];
	sim.prop(m1, "포인트 텍스트").value = aeTextValue("고친 포인트");
	// 패널에서 두 줄의 캡션(T1)을 바꾼다: 행 속성창 textarea (사용자가 치는 것과 같다)
	const typeT1 = (id, text) => {
		const badge = h.$("params-" + id).querySelectorAll(".fid-badge").find((b) => b.textContent === "T1");
		assert.ok(badge, "T1 배지");
		const ta = badge.parentNode.parentNode.querySelector("textarea");
		ta.value = text;
		ta.dispatchEvent({ type: "input" });
	};
	h.$("row-1").querySelector(".sub-text").click();
	h.$("row-2").querySelector(".sub-text").click();
	await h.flush();
	typeT1(1, "철수 하나 새");
	typeT1(2, "철수 둘 새");
	await h.flush();
	h.$("btnApply").click();
	await settle(h);
	assert.equal(pfOpen(h), true);
	assert.deepEqual(pfOpt(h, "pfOverwriteEdited"), { shown: true, checked: false, text: "Premiere에서 고친 클립 1개 덮어쓰기" });
	h.$("pfOk").click();
	await done(h);
	assert.equal(textOf(sim, sim.clips(seq, 2)[0]), "철수 하나", "고친 클립은 그대로");
	assert.equal(sim.textOf(sim.clips(seq, 2)[0], "포인트 텍스트"), "고친 포인트");
	assert.equal(textOf(sim, sim.clips(seq, 2)[1]), "철수 둘 새", "다른 줄은 갱신");
	assert.equal(h.$("row-1").querySelector(".sub-res").textContent, "Premiere에서 고침");
	// 덮어쓰기를 켜면 쓴다
	h.$("btnApply").click();
	await settle(h);
	assert.equal(pfOpen(h), true);
	h.$("pfOverwriteEdited").checked = true;
	h.$("pfOk").click();
	await done(h);
	assert.equal(textOf(sim, sim.clips(seq, 2)[0]), "철수 하나 새");
	assert.equal(h.$("row-1").querySelector(".sub-res"), null);
	noErrors(h);
});

test("(e) ↑ 한 줄: 그 클립만 갱신 (nodeId 그대로, 점검 창 없음, 다른 줄은 보내지 않는다)", async () => {
	const { sim, seq, preset } = makeSim({ tracks: 6 });
	const h = await boot(sim, preset, castSession(preset, twoSpeakerRows()));
	await applyAll(h);
	const target = sim.clips(seq, 3)[2]; // C2는 V4 (남의 클립이 없다)
	const node = sim.nodeId(target);
	h.$("row-6").querySelector(".sub-text").click();
	await h.flush();
	const badge = h.$("params-6").querySelectorAll(".fid-badge").find((b) => b.textContent === "T2");
	const ta = badge.parentNode.parentNode.querySelector("textarea");
	ta.value = "영희";
	ta.dispatchEvent({ type: "input" });
	const before = calls(h, "MI_placeChunk").length;
	h.$("row-6").querySelectorAll("button").find((b) => b.title === "이 자막만 타임라인에 업데이트").click();
	await done(h);
	assert.equal(pfOpen(h), false);
	const pc = calls(h, "MI_placeChunk").slice(before);
	assert.equal(pc.length, 1, h.status().text);
	const items = JSON.parse(pc[0].args[0]).items;
	assert.deepEqual(items.map((x) => [x.op, x.key, x.own.nodeId]), [["update", "ab12-6", node]]);
	assert.deepEqual(items[0].params.map((p) => p.displayName), ["포인트 텍스트"], "바뀐 속성만");
	assert.equal(sim.nodeId(sim.clips(seq, 3)[2]), node);
	assert.equal(sim.textOf(sim.clips(seq, 3)[2], "포인트 텍스트"), "영희");
	assert.match(h.status().text, /^화자별 배치: 갱신 1$/);
	noErrors(h);
});

test("(f) 나눈 레거시 목록: 기본 트랙(V3)의 v27 클립 — C1은 제자리 인식(nodeId 그대로), C2는 C2 트랙으로 옮김(옛 클립 지움), 중복 없음", async () => {
	const { sim, seq, preset } = makeSim({ tracks: 4 });
	const rows = [[1, "C1", 100, 160, "철수 하나"], [2, "C2", 200, 260, "영희 하나"], [3, "C1", 400, 460, "철수 둘"], [4, "C2", 500, 560, "영희 둘"]];
	// v27이 V3에 놓은 클립 (태그 없음, 끝은 프레임에 맞지 않을 수 있다)
	const olds = rows.map(([, , sf, ef, text]) => sim.place(seq, 2, MOGRT, sf, ef, null, { texts: [text] }));
	const oldIds = olds.map((m) => sim.nodeId(m));
	const sess = castSession(preset, rows, { mi: { legacyTrack: 2 } });
	rows.forEach(([id, , sf, ef, text]) => { sess.rowStates[id].ap = { s: sec(sf), e: sec(ef), cap: text, ps: "x", t: 2 }; });
	const h = await boot(sim, preset, sess);
	h.$("btnApply").click();
	await settle(h);
	assert.equal(pfOpen(h), true);
	assert.deepEqual(pfOpt(h, "pfAdopt"), { shown: true, checked: true, text: "태그 없는 기존 클립 2개를 이 목록 클립으로 인식" });
	assert.deepEqual(pfOpt(h, "pfMoveLegacy"), { shown: true, checked: true, text: "기본 트랙(V3)에 있던 옛 클립 2개를 화자 트랙으로 옮기기" });
	h.$("pfOk").click();
	await done(h);
	const v3 = sim.clips(seq, 2);
	assert.deepEqual(v3.map((m) => m.name), ["철수 [MI:ab12-1.1]", "철수 [MI:ab12-3.1]"]);
	assert.deepEqual(v3.map((m) => sim.nodeId(m)), [oldIds[0], oldIds[2]], "C1은 같은 클립");
	const c2 = sim.clips(seq, 3);
	assert.deepEqual(c2.map((m) => [Math.round(m.s / F), Math.round(m.e / F), m.name]), [[200, 260, "영희 [MI:ab12-2.1]"], [500, 560, "영희 [MI:ab12-4.1]"]]);
	assert.ok(c2.every((m) => oldIds.indexOf(sim.nodeId(m)) === -1), "C2는 새로 놓았다");
	assert.equal(sim.all(seq), 4, "중복 없음");
	assert.match(h.status().text, /옮김 2 · 인식 2/);
	noErrors(h);
});

test("(g) 복제한 시퀀스: 다른 salt 태그 클립을 문장으로 인식 → 충돌 0, 우리 salt로 이름을 바꾼다 (다른 salt는 받지 않는다)", async () => {
	const { sim, seq, preset } = makeSim({ tracks: 6 });
	const rows = [[1, "C1", 100, 160, "철수 하나"], [2, "C2", 120, 180, "영희 하나"], [3, "C1", 400, 460, "철수 둘"], [4, "C2", 420, 480, "영희 둘"]];
	// 원본 시퀀스에서 salt zz99로 C1은 V3, C2는 V5에 놓은 클립 (id는 다르다: 원본의 id)
	sim.place(seq, 2, MOGRT, 100, 160, "철수 [MI:zz99-11.1]", { texts: ["철수 하나"] });
	sim.place(seq, 2, MOGRT, 400, 460, "철수 [MI:zz99-13.1]", { texts: ["철수 둘"] });
	sim.place(seq, 4, MOGRT, 120, 180, "영희 [MI:zz99-12.1]", { texts: ["영희 하나"] });
	sim.place(seq, 4, MOGRT, 420, 480, "영희 [MI:zz99-14.1]", { texts: ["영희 둘"] });
	const h = await boot(sim, preset, castSession(preset, rows));
	h.$("btnApply").click();
	await settle(h);
	assert.equal(pfOpen(h), true);
	assert.deepEqual(pfOpt(h, "pfAdoptForeign"), { shown: true, checked: true, text: "다른 시퀀스에서 온 태그 클립 4개를 이 목록 클립으로 인식" });
	assert.ok(pfLines(h)[0].indexOf("C2 영희 V5") !== -1, "C2는 문장이 맞는 V5: " + pfLines(h)[0]);
	h.$("pfOk").click();
	await done(h);
	assert.deepEqual(mtags(sim, seq, 2).map((c) => c[2]), ["철수 [MI:ab12-1.1]", "철수 [MI:ab12-3.1]"]);
	assert.deepEqual(mtags(sim, seq, 4).map((c) => c[2]), ["영희 [MI:ab12-2.1]", "영희 [MI:ab12-4.1]"]);
	assert.equal(sim.all(seq), 4);
	assert.equal(h.snapshot().mi.salt, SALT);
	assert.match(h.status().text, /^화자별 배치: 인식 4$/);
	noErrors(h);
});

test("워치독: 호스트 호출이 20초 넘게 돌아오지 않으면 'Premiere에 대화상자가 떠 있을 수 있습니다', 돌아오면 지운다", async () => {
	const { sim, preset } = makeSim({ tracks: 6 });
	const h = await boot(sim, preset, castSession(preset, [[1, "C1", 100, 160, "철수 하나"]]));
	let release = null;
	h.host.handlers.MI_placeChunk = (json) => new Promise((resolve) => { release = () => resolve(sim.callRaw("MI_placeChunk", JSON.stringify(json))); });
	h.$("btnApply").click();
	for (let i = 0; i < 50 && !release; i++) await h.flush();
	assert.ok(release, "placeChunk를 불렀다");
	assert.equal(h.$("miBusy").style.display, "", "진행 덮개");
	assert.match(h.$("miBusyText").textContent, /^배치 중… C1 철수 0\/1 · 전체 0\/1$/);
	assert.equal(h.$("miBusyWatch").style.display, "none");
	await h.advance(21000);
	assert.equal(h.$("miBusyWatch").style.display, "");
	assert.equal(h.$("miBusyWatch").textContent, "Premiere에 대화상자가 떠 있을 수 있습니다 — Premiere 창을 확인하세요");
	// 적용 중에는 폴러가 쉬고 ▶는 거절한다
	h.$("btnApply").click();
	await h.flush();
	assert.equal(h.status().text, "타임라인 적용이 이미 실행 중입니다");
	release();
	await done(h);
	assert.equal(h.$("miBusy").style.display, "none");
	assert.equal(h.$("miBusyWatch").style.display, "none");
	assert.match(h.status().text, /^화자별 배치: 놓음 1/);
	noErrors(h);
});

test("분기 C: 새 줄의 템플릿 길이가 뒤의 우리 짧은 클립을 통째로 덮으면(damaged) 그 줄을 다시 놓는다", async () => {
	const { sim, seq, preset } = makeSim({ tracks: 6 });
	const h = await boot(sim, preset, castSession(preset, [[2, "C1", 130, 140, "짧은 줄"]]));
	await applyAll(h);
	const short0 = sim.nodeId(sim.clips(seq, 2)[0]);
	// 앞에 새 줄 (100~110): 템플릿 길이 120f가 130~140의 짧은 클립을 통째로 덮는다 → 호스트가 damaged로 알린다 → 다시 놓는다
	const s = h.snapshot();
	const sess = JSON.parse(JSON.stringify({ subtitles: s.subtitles, rowStates: s.rowStates, trashBin: s.trashBin, nextId: s.nextId, mi: s.mi }));
	const extra = castSession(preset, [[5, "C1", 100, 110, "새 앞 줄"]]);
	sess.subtitles.unshift(extra.subtitles[0]);
	sess.rowStates[5] = extra.rowStates[5];
	sess.nextId = 6;
	// 다른 시퀀스로 갔다가(떠날 때 A를 저장한다) 파일을 바꾸고 돌아와 다시 읽는다
	h.host.seq = { seqId: "other", seqName: "T_OTHER", projPath: PROJ };
	await h.advance(300);
	h.fs.files.set(P.session(PROJ, A.seqId), JSON.stringify(sess));
	h.host.seq = A;
	await h.advance(300);
	assert.equal(h.snapshot().subtitles.length, 2);
	await applyAll(h);
	const v3 = sim.clips(seq, 2).map((m) => [Math.round(m.s / F), Math.round(m.e / F), m.name]);
	assert.deepEqual(v3, [[100, 110, "철수 [MI:ab12-5.1]"], [130, 140, "철수 [MI:ab12-2.2]"]], "덮인 줄은 다음 gen으로 다시 놓았다");
	assert.notEqual(sim.nodeId(sim.clips(seq, 2)[1]), short0);
	noErrors(h);
});

test("다시 가져오기로 시간이 바뀐 줄 → move (nodeId·이름 그대로, 새 자리), 나누기(새 줄)는 한 번에 (점검 창 없이)", async () => {
	const { sim, seq, preset } = makeSim({ tracks: 6 });
	const h = await boot(sim, preset, castSession(preset, [[1, "C1", 100, 160, "철수 하나"], [2, "C1", 300, 400, "철수 둘 그리고 셋"]]));
	await applyAll(h);
	const n1 = sim.nodeId(sim.clips(seq, 2)[0]);
	const n2 = sim.nodeId(sim.clips(seq, 2)[1]);
	const srtTc = (f) => tc(sec(f)).replace(".", ",");
	const srt = (cues) => cues.map(([sf, ef, t], i) => (i + 1) + "\n" + srtTc(sf) + " --> " + srtTc(ef) + "\n" + t + "\n").join("\n");
	// 줄 1은 10프레임 뒤로, 줄 2는 둘로 나뉜다 (앞 조각은 문장이 바뀌어 끝이 줄고, 뒤 조각은 새 줄)
	const b64 = Buffer.from(srt([[110, 170, "철수 하나"], [300, 350, "철수 둘"], [350, 400, "그리고 셋"]]), "utf8").toString("base64");
	const r = await cmd(h, "mergeCommit", { files: [{ name: "C1.srt", b64 }] });
	assert.equal(r.ok, true, JSON.stringify(r));
	const s = h.snapshot();
	assert.equal(s.rowStates[1].mm, "time");
	// 옮기기·줄이기·새 줄은 볼 것이 없어 점검 창 없이 바로 간다
	h.$("btnApply").click();
	await done(h);
	assert.equal(pfOpen(h), false);
	assert.match(h.status().text, /^화자별 배치: /);
	const res = { data: { moved: (h.fs.readJson(P.session(PROJ, A.seqId).replace("session.json", "last_apply.json")).moved || []).length, created: (h.fs.readJson(P.session(PROJ, A.seqId).replace("session.json", "last_apply.json")).created || []).length } };
	const v3 = sim.clips(seq, 2).slice().sort((a, b) => a.s - b.s);
	assert.deepEqual(v3.map((m) => [Math.round(m.s / F), Math.round(m.e / F), textOf(sim, m)]), [[110, 170, "철수 하나"], [300, 350, "철수 둘"], [350, 400, "그리고 셋"]]);
	assert.equal(v3[0].name, "철수 [MI:ab12-1.1]");
	assert.equal(sim.nodeId(v3[0]), n1, "옮긴 클립은 같은 클립 (TrackItem.move)");
	// 병합이 '철수 둘 그리고 셋'(줄 2)을 어느 조각과 짝지었든, 새 줄의 템플릿 길이가 옮긴 줄 2를 덮으면 분기 C로 다시 놓는다 → 줄마다 클립 하나
	const idx = plain(CORE.scanIndex([{ i: 2, clips: v3.map((m) => ({ sf: 0, ef: 1, nodeId: sim.nodeId(m), name: m.name })) }], SALT));
	assert.deepEqual(Object.keys(idx.current).sort(), h.snapshot().subtitles.map((x) => SALT + "-" + x.id).sort());
	assert.ok(res.data.moved >= 1 && res.data.created >= 1, JSON.stringify(res.data));
	assert.ok(n2);
	assert.equal(h.snapshot().rowStates[1].mm, undefined, "검증된 적용은 표시를 지운다");
	noOverlap(sim, seq);
	noErrors(h);
});

test("적용 전 점검 [취소]: 트랙도 만들지 않고 아무것도 보내지 않는다", async () => {
	const { sim, seq, preset } = makeSim({ tracks: 3 });
	const h = await boot(sim, preset, castSession(preset, twoSpeakerRows()));
	h.$("btnApply").click();
	await settle(h);
	assert.equal(pfOpen(h), true);
	h.$("pfCancel").click();
	await done(h);
	assert.deepEqual([calls(h, "MI_placeChunk").length, calls(h, "MI_ensureVideoTracks").length, seq.tracks.length, sim.all(seq)], [0, 0, 3, 0]);
	assert.equal(h.status().text, "타임라인 적용 취소");
	assert.equal(h.fs.files.has(P.session(PROJ, A.seqId).replace("session.json", "last_apply.json")), false);
	noErrors(h);
});

test("호스트가 청크 중간에 실패하면(seq-mismatch) 그 자리에서 멈춘다: 한 일은 기록하고 last_apply는 complete false, 다시 적용하면 이어서", async () => {
	const { sim, seq, preset } = makeSim({ tracks: 6 });
	const h = await boot(sim, preset, castSession(preset, twoSpeakerRows()));
	let n = 0;
	h.host.handlers.MI_placeChunk = (json) => {
		n++;
		if (n === 2) return JSON.stringify({ ok: false, error: "seq-mismatch", detail: "활성 x / 요청 y" });
		return sim.callRaw("MI_placeChunk", JSON.stringify(json));
	};
	await applyAll(h);
	assert.match(h.status().text, /^중단됨 — 다시 적용하면 이어서 진행: placeChunk: seq-mismatch \(활성 x \/ 요청 y\) — 화자별 배치: 놓음 8/);
	const la = h.fs.readJson(P.session(PROJ, A.seqId).replace("session.json", "last_apply.json"));
	assert.deepEqual([la.complete, la.created.length], [false, 8]);
	assert.equal(Object.keys(h.snapshot().mi.applied).length, 8, "한 일은 기록");
	assert.equal(h.fs.readJson(P.session(PROJ, A.seqId)).mi.applied["ab12-1"].g, 1, "session.json에도");
	h.host.handlers.MI_placeChunk = (json) => sim.callRaw("MI_placeChunk", JSON.stringify(json));
	await applyAll(h);
	assert.equal(sim.all(seq), 20);
	assert.match(h.status().text, /^화자별 배치: 놓음 12 · 그대로 8$/);
	noErrors(h);
});

test("plan·apply 명령: plan은 타임라인을 바꾸지 않고 요약, apply는 점검 창 없이 선택지로, agent는 needs-approval", async () => {
	const { sim, seq, preset } = makeSim({ tracks: 6 });
	const h = await boot(sim, preset, castSession(preset, twoSpeakerRows()));
	let r = await cmd(h, "plan", {});
	assert.equal(r.ok, true);
	assert.deepEqual([r.data.plan.ops.place, r.data.plan.minCount, r.data.plan.tracks.C2.track], [20, 0, 3]);
	assert.equal(sim.all(seq), 0, "plan은 바꾸지 않는다");
	r = await cmd(h, "plan", { ids: [1, 2], single: true });
	assert.deepEqual(r.data.plan.ops, { place: 2 });
	r = JSON.parse(JSON.stringify(await h.win._mogrtDebug.cmdAs("agent", "apply", {})));
	assert.deepEqual([r.ok, r.error], [false, "needs-approval"]);
	r = await cmd(h, "apply", { opts: { bogus: true } });
	assert.deepEqual([r.ok, r.error], [false, "bad-args"]);
	r = await cmd(h, "apply", { ids: [1, 3] });
	assert.deepEqual([r.ok, r.data.created, r.data.ok], [true, 2, true]);
	assert.equal(sim.all(seq), 2);
	r = await cmd(h, "status", {});
	assert.equal(r.data.busy, false);
	noErrors(h);
});

// ── 리뷰 반영 (S2-3·S2-4) ──

// 세션 파일을 바꾸고 다시 읽는다 (다른 시퀀스로 갔다가 돌아온다: 떠날 때 A를 저장한다)
async function reloadWith(h, edit) {
	h.host.seq = { seqId: "other", seqName: "T_OTHER", projPath: PROJ };
	await h.advance(300);
	const sess = h.fs.readJson(P.session(PROJ, A.seqId));
	edit(sess);
	h.fs.files.set(P.session(PROJ, A.seqId), JSON.stringify(sess));
	h.host.seq = A;
	await h.advance(300);
}
const srtB64 = (cues) => Buffer.from(cues.map(([sf, ef, t], i) => (i + 1) + "\n" + tc(sec(sf)).replace(".", ",") + " --> " + tc(sec(ef)).replace(".", ",") + "\n" + t + "\n").join("\n"), "utf8").toString("base64");
const resText = (h, id) => { const el = h.$("row-" + id).querySelector(".sub-res"); return el ? el.textContent : null; };
const withTexts = (sim, seq, ti) => sim.clips(seq, ti).map((m) => [Math.round(m.s / F), Math.round(m.e / F), m.name, textOf(sim, m)]);

test("자리 바꾸기(순환): 끊은 줄은 속성 전부·다음 gen 태그로 새로 놓는다 → 문장·태그가 맞고, 다시 적용하면 그대로", async () => {
	const { sim, seq, preset } = makeSim({ tracks: 6 });
	const h = await boot(sim, preset, castSession(preset, [[1, "C1", 100, 200, "첫째 문장"], [2, "C1", 200, 300, "둘째 문장"]]));
	await applyAll(h);
	await reloadWith(h, (s) => {
		const [a, b] = s.subtitles;
		const t = [a.startSec, a.endSec, a.startTime, a.endTime];
		[a.startSec, a.endSec, a.startTime, a.endTime] = [b.startSec, b.endSec, b.startTime, b.endTime];
		[b.startSec, b.endSec, b.startTime, b.endTime] = t;
		s.subtitles = [b, a];
		s.rowStates[1].mm = "time";
		s.rowStates[2].mm = "time";
	});
	await applyAll(h);
	assert.match(h.status().text, /^화자별 배치: 놓음 1 · 옮김 1 · 지움 1$/);
	assert.deepEqual(withTexts(sim, seq, 2), [[100, 200, "철수 [MI:ab12-2.2]", "둘째 문장"], [200, 300, "철수 [MI:ab12-1.1]", "첫째 문장"]]);
	assert.deepEqual([h.snapshot().rowStates[1].mm, h.snapshot().rowStates[2].mm], [undefined, undefined]);
	await applyAll(h);
	assert.match(h.status().text, /^변경 없음 — 보낼 줄이 없습니다 \(2줄 그대로\)$/);
	noErrors(h);
});

test("partial(키프레임이라 캡션을 못 씀)은 검증된 적용이 아니다: 다시 적용해도 그 속성을 다시 보내고 병합 표시·'속성 N개 적용 안 됨'이 남는다", async () => {
	const { sim, seq, preset } = makeSim({ tracks: 6 });
	const h = await boot(sim, preset, castSession(preset, [[1, "C1", 100, 200, "첫째 문장입니다"], [2, "C1", 300, 400, "둘째 문장입니다"]]));
	await applyAll(h);
	sim.prop(sim.clips(seq, 2)[0], "텍스트").keyed = true;
	const r = await cmd(h, "mergeCommit", { files: [{ name: "C1.srt", b64: srtB64([[100, 200, "첫째 문장입니다 고침"], [300, 400, "둘째 문장입니다"]]) }] });
	assert.equal(r.ok, true);
	assert.equal(h.snapshot().rowStates[1].mm, "text");
	await applyAll(h);
	assert.match(h.status().text, /일부 속성 빠짐 1/);
	assert.deepEqual([h.snapshot().rowStates[1].mm, resText(h, 1)], ["text", "속성 1개 적용 안 됨 (키프레임)"]);
	const n = calls(h, "MI_placeChunk").length;
	await applyAll(h);
	assert.equal(calls(h, "MI_placeChunk").length, n + 1, "못 쓴 캡션을 다시 보낸다");
	assert.match(h.status().text, /일부 속성 빠짐 1/);
	assert.deepEqual([h.snapshot().rowStates[1].mm, resText(h, 1)], ["text", "속성 1개 적용 안 됨 (키프레임)"]);
	assert.equal(textOf(sim, sim.clips(seq, 2)[0]), "첫째 문장입니다", "클립은 여전히 옛 문장");
	// 키프레임을 풀면 다음 적용에서 쓰고 표시를 지운다
	sim.prop(sim.clips(seq, 2)[0], "텍스트").keyed = false;
	await applyAll(h);
	assert.equal(textOf(sim, sim.clips(seq, 2)[0]), "첫째 문장입니다 고침");
	assert.deepEqual([h.snapshot().rowStates[1].mm, resText(h, 1)], [undefined, null]);
	noErrors(h);
});

test("Premiere에서 고친 클립을 시간만 옮겨도 rh는 우리가 쓴 값 그대로: 다음 캡션 변경은 '고친 클립'으로 건너뛴다", async () => {
	const { sim, seq, preset } = makeSim({ tracks: 6 });
	const h = await boot(sim, preset, castSession(preset, [[1, "C1", 100, 200, "첫째 문장입니다"], [2, "C1", 300, 400, "둘째 문장입니다"]]));
	await applyAll(h);
	const edited = "첫째 문장입니다 (편집자가 Premiere에서 고침)";
	sim.prop(sim.clips(seq, 2)[0], "텍스트").value = aeTextValue(edited);
	await cmd(h, "mergeCommit", { files: [{ name: "C1.srt", b64: srtB64([[110, 210, "첫째 문장입니다"], [300, 400, "둘째 문장입니다"]]) }] });
	await applyAll(h);
	assert.match(h.status().text, /^화자별 배치: 옮김 1/);
	assert.deepEqual(withTexts(sim, seq, 2)[0], [110, 210, "철수 [MI:ab12-1.1]", edited]);
	await cmd(h, "mergeCommit", { files: [{ name: "C1.srt", b64: srtB64([[110, 210, "첫째 문장입니다 새 버전"], [300, 400, "둘째 문장입니다"]]) }] });
	h.$("btnApply").click();
	await settle(h);
	assert.equal(pfOpen(h), true, "고친 클립이 있어 점검 창");
	assert.deepEqual(pfOpt(h, "pfOverwriteEdited"), { shown: true, checked: false, text: "Premiere에서 고친 클립 1개 덮어쓰기" });
	h.$("pfOk").click();
	await done(h);
	assert.equal(textOf(sim, sim.clips(seq, 2)[0]), edited, "고친 문장은 그대로");
	assert.equal(resText(h, 1), "Premiere에서 고침");
	noErrors(h);
});

test("효과가 있어 옮기지 않은 클립은 시간 변경이 남는다: mm·'효과 있어 제자리'를 남기고, 다음에도 '효과 있는 클립도 다시 놓기'를 고를 수 있다", async () => {
	const { sim, seq, preset } = makeSim({ tracks: 6 });
	const h = await boot(sim, preset, castSession(preset, [[1, "C1", 100, 200, "첫째 문장입니다"], [2, "C1", 300, 400, "둘째 문장입니다"]]));
	await applyAll(h);
	sim.keyMotion(sim.clips(seq, 2)[0]);
	await cmd(h, "mergeCommit", { files: [{ name: "C1.srt", b64: srtB64([[130, 230, "첫째 문장입니다 새"], [300, 400, "둘째 문장입니다"]]) }] });
	await reloadWith(h, (s) => { s.mi.cast.C1.track = 4; }); // C1을 V5에 고정 → 다른 트랙으로 옮겨야 한다
	assert.equal(h.snapshot().rowStates[1].mm, "both");
	h.$("btnApply").click();
	await settle(h);
	assert.equal(pfOpen(h), true);
	assert.ok(pfLines(h).indexOf("효과·키프레임이 있는 클립 1개는 자리를 옮기지 않음") !== -1, pfLines(h).join(" | "));
	h.$("pfOk").click();
	await done(h);
	// 문장은 제자리에서 바꿨지만 시간은 아직: V3 100~200 그대로, 표시가 남는다
	const m1 = sim.clips(seq, 2)[0];
	assert.deepEqual([Math.round(m1.s / F), Math.round(m1.e / F), m1.name, textOf(sim, m1)], [100, 200, "철수 [MI:ab12-1.1]", "첫째 문장입니다 새"]);
	let s = h.snapshot();
	assert.deepEqual([s.rowStates[1].mm, resText(h, 1), s.rowStates[1].ap.t, Math.round(s.rowStates[1].ap.s / sec(1))], ["both", "효과 있어 제자리", 2, 100]);
	assert.deepEqual([s.mi.applied["ab12-1"].t, s.mi.applied["ab12-1"].sf], [2, 100], "applied는 클립이 있는 자리");
	// 다음 적용: 다시 효과 있는 클립으로 보인다 (사용자가 옮긴 클립이 아니다). 고르면 옮긴다
	h.$("btnApply").click();
	await settle(h);
	assert.equal(pfOpen(h), true);
	assert.deepEqual([pfOpt(h, "pfMoveDecorated").shown, pfOpt(h, "pfRestoreMoved").shown], [true, false]);
	h.$("pfMoveDecorated").checked = true;
	h.$("pfOk").click();
	await done(h);
	assert.equal(sim.clips(seq, 2).length, 0, "V3에서 떠났다");
	assert.deepEqual(withTexts(sim, seq, 4).map((c) => c.slice(0, 3)), [[130, 230, "철수 [MI:ab12-1.2]"], [300, 400, "철수 [MI:ab12-2.2]"]]);
	s = h.snapshot();
	assert.deepEqual([s.rowStates[1].mm, resText(h, 1)], [undefined, null]);
	noErrors(h);
});

test("동시 발화 두 줄이 옛 클립 하나를 두고: 한 줄만 가진다 (C1은 제자리 인식하며 문장을 다시 쓰고, C2는 C2 트랙에 새로) — 클립이 사라지지 않는다", async () => {
	const { sim, seq, preset } = makeSim({ tracks: 4 });
	const rows = [[1, "C1", 100, 160, "네"], [2, "C2", 100, 180, "네 맞아요"]];
	const old = sim.place(seq, 2, MOGRT, 100, 180, null, { texts: ["네 맞아요"] }); // v27이 같은 트랙에서 앞 줄을 덮어썼다
	const sess = castSession(preset, rows, { mi: { legacyTrack: 2 } });
	rows.forEach(([id, , sf, ef, text]) => { sess.rowStates[id].ap = { s: sec(sf), e: sec(ef), cap: text, ps: "x", t: 2 }; });
	const h = await boot(sim, preset, sess);
	h.$("btnApply").click();
	await settle(h);
	assert.equal(pfOpen(h), true);
	assert.deepEqual(pfOpt(h, "pfAdopt"), { shown: true, checked: true, text: "태그 없는 기존 클립 1개를 이 목록 클립으로 인식" });
	assert.equal(pfOpt(h, "pfMoveLegacy").shown, false, "같은 클립을 옮기기로 또 세지 않는다");
	h.$("pfOk").click();
	await done(h);
	assert.deepEqual(withTexts(sim, seq, 2), [[100, 160, "철수 [MI:ab12-1.1]", "네"]]);
	assert.equal(sim.nodeId(sim.clips(seq, 2)[0]), sim.nodeId(old), "C1은 같은 클립");
	assert.deepEqual(withTexts(sim, seq, 3), [[100, 180, "영희 [MI:ab12-2.1]", "네 맞아요"]]);
	assert.equal(sim.all(seq), 2);
	assert.match(h.status().text, /^화자별 배치: 놓음 1 · 인식 1/);
	await applyAll(h);
	assert.match(h.status().text, /^변경 없음 — 보낼 줄이 없습니다 \(2줄 그대로\)$/);
	noErrors(h);
});

test("스캔은 기본 트랙부터 위·화자 트랙만 (기본 트랙 아래 B-roll은 읽지 않는다). 우리 클립을 못 찾은 줄이 있으면 나머지 트랙을 한 번 더 읽는다", async () => {
	const { sim, seq, preset } = makeSim({ tracks: 6 });
	sim.placeOther(seq, 1, 0, 3000, "B-roll.mp4");
	const h = await boot(sim, preset, castSession(preset, [[1, "C1", 100, 160, "철수 하나"]]));
	await applyAll(h);
	const gt = calls(h, "MI_getTracks").map((c) => JSON.parse(c.args[0]).tracks);
	assert.equal(gt.length, 1);
	assert.deepEqual([gt[0][0], gt[0].indexOf(1), gt[0].indexOf(0), gt[0].indexOf(5)], [2, -1, -1, 3], "V3부터, V1·V2 없음");
	// 사용자가 클립을 V2(기본 트랙 아래)로 옮겼다 → 첫 스캔에 없다 → V2도 읽어 찾는다 (다시 놓지 않는다)
	const m = sim.clips(seq, 2)[0];
	seq.tracks[2].clips.splice(seq.tracks[2].clips.indexOf(m), 1);
	seq.tracks[1].clips.push(m);
	m.track = seq.tracks[1];
	await applyAll(h);
	const gt2 = calls(h, "MI_getTracks").slice(1).map((c) => JSON.parse(c.args[0]).tracks);
	assert.equal(gt2.length, 2);
	assert.deepEqual(gt2[1], [1], "나머지 트랙 (V1 빼고)");
	assert.match(h.status().text, /^변경 없음 — 보낼 줄이 없습니다 \(1줄 그대로\)$/);
	assert.equal(sim.all(seq), 2, "다시 놓지 않았다 (B-roll + 옮긴 자막)");
	noErrors(h);
});

test("적용을 누를 때 이미 떠난 폴러 호출이 늦게 돌아와도(CEP 호출은 차례대로) 다른 시퀀스로 옮겨 그 목록을 적용하지 않는다", async () => {
	const { sim, seq, preset } = makeSim({ tracks: 6 });
	const B = { seqId: "seq-apply-2", seqName: "T_APPLY_B", projPath: PROJ };
	const seqB = sim.addSequence({ name: B.seqName, id: B.seqId, ft: F, tracks: 6 });
	const h = await boot(sim, preset, castSession(preset, [[1, "C1", 100, 160, "A 하나"]]));
	h.fs.files.set(P.session(PROJ, B.seqId), JSON.stringify(castSession(preset, [[1, "C1", 100, 160, "B 하나"], [2, "C1", 300, 360, "B 둘"]], { mi: { salt: "zz99" } })));
	// 호스트 호출은 차례대로 (CEP evalScript) · 폴러 호출 하나를 붙잡는다
	let release = null;
	let armed = false;
	const seqInfo = h.host.handlers.getActiveSequenceInfo;
	h.host.handlers.getActiveSequenceInfo = (...a) => {
		if (!armed) return seqInfo(...a);
		armed = false;
		return new Promise((resolve) => { release = () => resolve(seqInfo(...a)); });
	};
	let chain = Promise.resolve();
	Object.keys(h.host.handlers).forEach((k) => {
		const fn = h.host.handlers[k];
		h.host.handlers[k] = (...a) => {
			const p = chain.then(() => fn(...a));
			chain = p.then(() => {}, () => {});
			return p;
		};
	});
	// Premiere에서 B로 바꿨다. 폴러가 그것을 묻는 호출을 보냈는데 아직 돌아오지 않았다
	h.host.seq = B;
	sim.setActive(seqB);
	armed = true;
	await h.advance(150);
	assert.ok(release, "폴러가 물었다");
	h.$("btnApply").click();
	await h.flush();
	release();
	await done(h);
	assert.match(h.status().text, /활성 시퀀스가 패널의 시퀀스와 다릅니다/);
	assert.deepEqual([sim.all(seq), sim.all(seqB), calls(h, "MI_placeChunk").length], [0, 0, 0], "어느 시퀀스에도 놓지 않았다");
	// 적용이 끝난 뒤 폴러는 B로 따라간다
	await h.advance(300);
	assert.equal(h.snapshot().subtitles.length, 2);
	noErrors(h);
});

test("시퀀스를 바꾸면 트랙 수(_miNumTracks)를 잊는다: 화자 표의 '(새)'가 다른 시퀀스의 트랙 수로 나오지 않는다", async () => {
	const { sim, preset } = makeSim({ tracks: 3 });
	const h = await boot(sim, preset, castSession(preset, [[1, "C1", 100, 160, "A 하나"]]));
	await applyAll(h);
	assert.equal(h.$("castTrackSummary").textContent, "C1→V3 · C2→V4 (새)", "A는 트랙 3개");
	const B = { seqId: "seq-apply-2", seqName: "T_APPLY_B", projPath: PROJ };
	h.fs.files.set(P.session(PROJ, B.seqId), JSON.stringify(castSession(preset, [[1, "C1", 100, 160, "B 하나"], [2, "C2", 300, 360, "B 둘"]], { mi: { salt: "zz99" } })));
	h.host.seq = B;
	await h.advance(300);
	assert.equal(h.snapshot().subtitles[0].text, "B 하나");
	assert.equal(h.$("castTrackSummary").textContent, "C1→V3 · C2→V4", "B의 트랙 수는 아직 모른다");
	noErrors(h);
});
