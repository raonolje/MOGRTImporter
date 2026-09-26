"use strict";
// S3-3: 타임라인 검수(#btnVerify·#verifyModal, 읽기만)와 화자 표 ⟳ 다시 가져오기·바뀜 알림(#castToast).
// panelHarness(app.js 전체) + premiereSim(hostscript.jsx 전체, 가짜 Premiere). 실제 Premiere는 하드 케이스 s3_3_verify가 본다.
const test = require("node:test");
const assert = require("node:assert/strict");
const { bootPanel, cachePaths: P } = require("../lib/panelHarness");
const { createSim, FT, TPS, aeText, aeTextValue, color } = require("../lib/premiereSim");
const { loadRegions } = require("../lib/loadRegions");

const CORE = loadRegions(["src/mi/core.ts"]);
const PROJ = "C:/work/verify.prproj";
const A = { seqId: "seq-verify-1", seqName: "T_VERIFY", projPath: PROJ };
const MOGRT = "C:/m/[라온올제] 합성 자막.mogrt";
const SALT = "ab12";
const F = FT.f23976;
const sec = (f) => (f * F) / TPS;
const HOST_FNS = ["ping", "getTracks", "readClipTexts", "ensureVideoTracks", "placeChunk", "removeClips"];
const DOT = String.fromCharCode(0xb7);

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
// rows: [[id, spk, sf, ef, 문장]], cast: {C1: {path, size, mtime}}
function castSession(preset, rows, castExtra) {
	const subtitles = [];
	const rowStates = {};
	const n = {};
	rows.forEach(([id, spk, sf, ef, text]) => {
		n[spk || ""] = (n[spk || ""] || 0) + 1;
		const s = { index: n[spk || ""], startTime: tc(sec(sf)), endTime: tc(sec(ef)), startSec: sec(sf), endSec: sec(ef), text, id };
		if (spk) { s.spk = spk; s.srtNo = s.index; }
		subtitles.push(s);
		const all = JSON.parse(JSON.stringify(preset.params));
		CORE.setTextValue(all[0], text);
		rowStates[id] = { presetId: preset.id, params: all.filter((p) => preset.exposedIndices.indexOf(p.index) !== -1), _allParams: all, open: false, checked: false };
	});
	const out = { subtitles, rowStates, trashBin: [], nextId: Math.max(...rows.map((r) => r[0])) + 1 };
	if (rows.some((r) => r[1])) {
		const c = castExtra || {};
		out.mi = { v: 1, salt: SALT, hwm: out.nextId - 1, legacyTrack: null, remapped: false, castOrder: ["C1", "C2"],
			cast: { C1: Object.assign({ name: "철수", track: null, autoTrack: null, presetId: preset.id, color: 0, file: "C1.srt", path: null, size: null, mtime: null }, c.C1 || {}),
				C2: Object.assign({ name: "영희", track: null, autoTrack: null, presetId: preset.id, color: 1, file: "C2.srt", path: null, size: null, mtime: null }, c.C2 || {}) },
			stack: false, stackDy: 0.12, applied: {} };
	}
	return out;
}
function rowsSix() {
	const rows = [];
	let id = 1;
	for (let k = 0; k < 3; k++) {
		const s = 100 + k * 200;
		rows.push([id++, "C1", s, s + 60, "철수 " + (k + 1) + " 말"]);
		rows.push([id++, "C2", s + 100, s + 160, "영희 " + (k + 1) + " 말"]);
	}
	return rows;
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
	h.host.handlers.seekToClip = (json) => "SUCCESS: " + JSON.parse(json).startSec + "초로 이동";
	await h.advance(1000);
	return h;
}
const cmd = async (h, op, args) => JSON.parse(JSON.stringify(await h.win._mogrtDebug.cmd(op, args)));
async function settle(h) {
	for (let i = 0; i < 400; i++) {
		await h.flush();
		if (!h.win._mogrtDebug.miBusy()) return;
	}
	throw new Error("끝나지 않았다");
}
const vf = (h) => ({
	open: h.$("verifyModal").classList.contains("open"),
	summary: h.$("vfSummary").textContent,
	cats: h.$("vfList").querySelectorAll(".vf-cat").map((e) => e.textContent),
	items: h.$("vfList").querySelectorAll(".vf-item").map((e) => [e.dataset.cat, e.querySelector(".vf-label").textContent])
});
const impModal = (h) => ({
	open: h.$("importModal").classList.contains("open"),
	rows: h.$("impBody").querySelectorAll("tr.imp-row").map((r) => ({ key: r.querySelector(".imp-key").value, act: r.querySelector(".imp-act") ? r.querySelector(".imp-act").value : (r.querySelector(".imp-action") || {}).textContent }))
});
function noErrors(h) {
	assert.deepEqual(h.errors().map((e) => String(e.message || e).slice(0, 300)), [], "패널 예외");
}

test("(1) 지움·끝 자름·자르기·문장 고침·Motion 키 → 검수 창에 정확히 그 다섯 줄, 쓰기 호출 없음, 줄을 누르면 그 자리로", async () => {
	const { sim, seq, preset } = makeSim();
	const h = await boot(sim, preset, castSession(preset, rowsSix()));
	assert.equal(h.$("btnVerify").style.display, "", "다화자 목록이면 검수 버튼");
	const ap = await cmd(h, "apply", {});
	assert.deepEqual([ap.ok, ap.data.created], [true, 6]);
	const v3 = () => sim.clips(seq, 2).slice().sort((a, b) => a.s - b.s);
	const v4 = () => sim.clips(seq, 3).slice().sort((a, b) => a.s - b.s);
	// 1 지움 (C1·1), 3 끝 자름 (C1·2), 5 자르기 (C1·3), 2 문장 고침 (C2·1), 4 Motion 키 (C2·2), 6 그대로 (C2·3)
	const c1 = v3();
	const c2 = v4();
	const del = c1[0];
	del.track.clips.splice(del.track.clips.indexOf(del), 1);
	del.removed = true;
	c1[1].e -= 20 * F;
	sim.razor(seq, 2, 530);
	sim.prop(c2[0], "텍스트").value = aeTextValue("Premiere에서 고친 영희");
	sim.keyMotion(c2[1]);
	const before = h.host.calls.length;
	h.$("btnVerify").click();
	await settle(h);
	const v = vf(h);
	assert.equal(v.open, true);
	assert.equal(v.summary, "정상 1 · 타임라인에 없음 1 · 옮겨짐 1 · 같은 태그 중복 1 · 옛 세대 0 · Premiere에서 고침 1 · 옛 버전 템플릿 0 · 효과·키프레임 1 · 미적용 0 · 목록에 없는 클립 0");
	assert.deepEqual(v.cats, ["타임라인에 없음 1", "옮겨짐 1", "같은 태그 중복 1", "Premiere에서 고침 1", "효과·키프레임 1"]);
	assert.deepEqual(v.items, [["missing", "C1" + DOT + "1"], ["moved", "C1" + DOT + "2"], ["dup", "C1" + DOT + "3"], ["edited", "C2" + DOT + "1"], ["decorated", "C2" + DOT + "2"]]);
	const fns = [...new Set(h.host.calls.slice(before).map((c) => c.fn))].sort();
	assert.deepEqual(fns, ["MI_getTracks", "MI_ping", "MI_readClipTexts"], "읽기만");
	assert.match(h.status().text, /^검수: 정상 1 · /);
	// 줄을 누르면: 목록의 그 줄 표시 + 재생 헤드 (옮긴 클립은 클립 시작)
	h.$("vfList").querySelectorAll(".vf-item")[1].click();
	await h.flush();
	const seek = h.host.calls.filter((c) => c.fn === "seekToClip");
	assert.equal(seek.length, 1);
	assert.ok(Math.abs(JSON.parse(seek[0].args[0]).startSec - sec(300)) < 1e-6);
	assert.ok(h.$("row-3").classList.contains("vf-hit"));
	// 지운 클립은 마지막 적용 자리로
	h.$("vfList").querySelectorAll(".vf-item")[0].click();
	await h.flush();
	assert.ok(Math.abs(JSON.parse(h.host.calls.filter((c) => c.fn === "seekToClip")[1].args[0]).startSec - sec(100)) < 1e-6);
	assert.equal(sim.clips(seq, 2).length, 3, "검수는 아무것도 바꾸지 않는다 (C1: 자른 두 조각 + 끝 자른 클립)");
	h.$("vfClose").click();
	assert.equal(h.$("verifyModal").classList.contains("open"), false);
	noErrors(h);
});

test("검수: 옛 gen·목록에 없는 줄의 클립·아직 적용 안 한 변경 (패널에서 바꾼 값)", async () => {
	const { sim, seq, preset } = makeSim();
	const h = await boot(sim, preset, castSession(preset, rowsSix()));
	await cmd(h, "apply", {});
	// 목록에 없는 줄의 우리 클립, 옛 gen
	sim.place(seq, 2, MOGRT, 5000, 5060, "철수 [MI:" + SALT + "-99.1]");
	sim.place(seq, 4, MOGRT, 6000, 6060, "철수 [MI:" + SALT + "-1.0]");
	// 패널에서 C2·3 포인트 텍스트를 바꾼다 (아직 적용 안 함)
	const b = h.$("params-6").querySelectorAll(".fid-badge").find((x) => x.textContent === "T2");
	const ta = b.parentNode.parentNode.querySelector("textarea");
	ta.value = "새 포인트";
	ta.dispatchEvent(new h.win.Event("input"));
	const r = await cmd(h, "verify", {});
	assert.equal(r.ok, true);
	assert.deepEqual([r.data.counts.ok, r.data.counts.stale, r.data.counts.orphan, r.data.counts.unapplied], [5, 1, 1, 1]);
	const it = r.data.items.find((x) => x.cat === "unapplied");
	assert.deepEqual([it.label, it.detail], ["C2" + DOT + "3", "패널에서 바뀐 값이 있음"]);
	noErrors(h);
});

test("검수 버튼: 단일 화자 목록에는 없다 (적용 바 v27 그대로), v28 호스트가 없으면 상태 줄에 까닭", async () => {
	const { sim, preset } = makeSim();
	const h = await boot(sim, preset, castSession(preset, [[1, null, 100, 160, "하나"]]));
	assert.equal(h.$("btnVerify").style.display, "none");
	const h2 = await boot(sim, preset, castSession(preset, rowsSix()));
	delete h2.host.handlers.MI_ping;
	h2.$("btnVerify").click();
	await settle(h2);
	assert.equal(h2.$("verifyModal").classList.contains("open"), false);
	assert.match(h2.status().text, /^검수 못 함: 다른 버전의 호스트 스크립트/);
	noErrors(h);
	noErrors(h2);
});

test("(3) ⟳: 기억한 경로에서 읽어 가져오기 창을 그 화자의 병합으로 연다; 경로가 없으면 파일을 고르게 하고 C번호 없는 파일은 그 화자로", async () => {
	const { sim, preset } = makeSim();
	const srt1 = "1\n00:00:04,171 --> 00:00:06,673\n철수 1 말\n\n2\n00:00:12,512 --> 00:00:15,015\n철수 2 말 바뀜\n";
	const h = await boot(sim, preset, castSession(preset, rowsSix(), { C1: { path: "D:/srt/인터뷰.srt", size: 10, mtime: 1790000000000 } }),
		{ node: { files: { "D:/srt/인터뷰.srt": { data: srt1, mtimeMs: 1790000000000 } } } });
	const btn = h.$("castRows").querySelectorAll(".cast-row")[0].querySelector(".cast-reimport");
	assert.equal(btn.textContent, "⟳");
	assert.equal(btn.title, "다시 가져오기 (병합): D:/srt/인터뷰.srt");
	btn.click();
	await h.flush();
	let m = impModal(h);
	assert.equal(m.open, true);
	assert.deepEqual(m.rows, [{ key: "C1", act: "merge" }], "파일 이름에 C번호가 없어도 그 화자");
	assert.match(h.$("impBody").querySelector(".imp-stats").textContent, /^같음 1 · 문장 1 · 빠짐 1$/);
	h.$("impCancel").click();
	// 경로 없는 C2: 파일 대화상자 (#srtInput) → 고른 파일(C번호 없음)은 C2의 병합으로
	let clicked = 0;
	h.$("srtInput").addEventListener("click", () => { clicked++; });
	h.$("castRows").querySelectorAll(".cast-row")[1].querySelector(".cast-reimport").click();
	assert.equal(clicked, 1, "파일 대화상자를 연다");
	assert.match(h.status().text, /^C2 영희: 파일 위치를 모릅니다 — 파일을 고르세요$/);
	await h.dropSrts([{ name: "영희 다시.srt", content: "1\n00:00:08,341 --> 00:00:10,844\n영희 1 말\n" }]);
	await h.flush();
	m = impModal(h);
	assert.deepEqual([m.open, m.rows], [true, [{ key: "C2", act: "merge" }]]);
	h.$("impCancel").click();
	// 다음 SRT 열기는 보통 경로 (C번호로)
	await h.dropSrts([{ name: "C1.srt", content: srt1 }]);
	assert.deepEqual(impModal(h).rows, [{ key: "C1", act: "merge" }]);
	h.$("impCancel").click();
	noErrors(h);
});

test("(2) 바뀜 알림: 경로의 수정 시각·크기가 바뀌면 3초 안에 #castToast, 적용 중·가져오기 창이 열린 동안은 쉰다, 같은 바뀜은 한 번, 스스로 병합하지 않는다", async () => {
	const { sim, preset } = makeSim();
	const srt1 = "1\n00:00:04,171 --> 00:00:06,673\n철수 1 말\n";
	const h = await boot(sim, preset, castSession(preset, rowsSix(), { C1: { path: "D:/srt/C1.srt", size: Buffer.byteLength(srt1), mtime: 1790000000000 } }),
		{ node: { files: { "D:/srt/C1.srt": { data: srt1, mtimeMs: 1790000000000.6 } } } });
	// 하네스는 style 속성의 display를 읽지 않는다 (처음에는 undefined = 숨김, 보이면 "")
	const toast = () => (h.$("castToast").style.display === "" ? h.$("castToastText").textContent : null);
	await h.advance(3000);
	assert.equal(toast(), null, "그대로면 알리지 않는다 (소수 ms 차이는 같은 시각)");
	const f = h.nodeFs.files.get("D:/srt/C1.srt");
	f.mtimeMs = 1790000060000;
	// 가져오기 창이 열려 있으면 쉰다
	h.$("castRows").querySelectorAll(".cast-row")[1].querySelector(".cast-reimport").click();
	await h.dropSrts([{ name: "C2.srt", content: "1\n00:00:08,341 --> 00:00:10,844\n영희 1 말\n" }]);
	assert.equal(impModal(h).open, true);
	await h.advance(3000);
	assert.equal(toast(), null, "가져오기 창이 열린 동안");
	h.$("impCancel").click();
	await h.advance(3000);
	assert.equal(toast(), "철수(C1) 파일이 바뀌었습니다");
	const s0 = JSON.stringify(h.snapshot().subtitles);
	await h.advance(9000);
	assert.equal(JSON.stringify(h.snapshot().subtitles), s0, "스스로 병합하지 않는다");
	h.$("castToastClose").click();
	assert.equal(toast(), null);
	await h.advance(6000);
	assert.equal(toast(), null, "닫은 바뀜은 다시 알리지 않는다");
	// 또 바뀌면 다시 알리고, [병합 미리보기]는 가져오기 창을 병합으로 연다
	f.mtimeMs = 1790000120000;
	f.data = Buffer.from(srt1 + "\n2\n00:00:12,512 --> 00:00:15,015\n새 줄\n", "utf8");
	await h.advance(3000);
	assert.equal(toast(), "철수(C1) 파일이 바뀌었습니다");
	h.$("castToastMerge").click();
	await h.flush();
	assert.equal(toast(), null);
	assert.deepEqual(impModal(h).rows, [{ key: "C1", act: "merge" }]);
	// [가져오기] → 화자 표의 파일 정보가 새 파일로 → 더 알리지 않는다
	h.$("impOk").click();
	await h.flush();
	const c = h.snapshot().mi.cast.C1;
	assert.deepEqual([c.size, c.mtime], [f.data.length, 1790000120000]);
	await h.advance(6000);
	assert.equal(toast(), null);
	noErrors(h);
});

// rowsSix의 화자 K 줄을 그대로 적은 SRT (같은 문장·시간 → 병합하면 '변경 없음')
function srtOf(K) {
	const t = (x) => tc(x).replace(".", ",");
	return rowsSix().filter((r) => r[1] === K).map((r, i) => (i + 1) + "\n" + t(sec(r[2])) + " --> " + t(sec(r[3])) + "\n" + r[4] + "\n").join("\n");
}

test("⟳ 대화상자를 취소하면 다음 보통 'SRT 열기'(C번호 없는 파일)는 보통 경로; 시퀀스가 바뀌면 ⟳를 잊는다", async () => {
	const { sim, preset } = makeSim();
	const B = { seqId: "seq-verify-2", seqName: "T_VERIFY_B", projPath: PROJ };
	const h = await boot(sim, preset, castSession(preset, rowsSix()), {
		files: {
			[P.presets(PROJ)]: { presets: { [preset.id]: preset }, presetTrash: [], nextPresetId: 4 },
			[P.session(PROJ, A.seqId)]: castSession(preset, rowsSix()),
			[P.session(PROJ, B.seqId)]: castSession(preset, rowsSix())
		}
	});
	const file = [{ name: "인터뷰 최종.srt", content: "1\n00:00:08,341 --> 00:00:10,844\n영희 1 말\n" }];
	await h.dropSrts(file);
	const base = impModal(h).rows;
	assert.deepEqual(base, [{ key: "", act: "" }], "보통 경로: 키를 고르지 않은 창");
	h.$("impCancel").click();
	// ⟳ (경로 없는 C2) → 대화상자를 취소 (change 없음) → 30초 뒤 보통 'SRT 열기' (label → #srtInput click → change)
	const reimport = (i) => h.$("castRows").querySelectorAll(".cast-row")[i].querySelector(".cast-reimport").click();
	reimport(1);
	await h.advance(30000);
	h.$("srtInput").click();
	await h.dropSrts(file);
	assert.deepEqual(impModal(h).rows, base, "취소한 ⟳는 보통 'SRT 열기'를 C2 병합으로 보내지 않는다");
	h.$("impCancel").click();
	// ⟳ 뒤 Premiere에서 시퀀스가 바뀌면 (같은 화자 키가 있는 시퀀스) 그 대화상자에서 고른 파일도 보통 경로
	reimport(1);
	h.host.seq = B;
	await h.advance(1000);
	assert.equal(h.snapshot().keys.seqId, B.seqId);
	await h.dropSrts(file);
	assert.deepEqual(impModal(h).rows, base, "다른 시퀀스의 C2에 병합하지 않는다");
	h.$("impCancel").click();
	// ⟳ 바로 뒤에 고른 파일은 여전히 그 화자
	reimport(1);
	await h.dropSrts(file);
	assert.deepEqual(impModal(h).rows, [{ key: "C2", act: "merge" }]);
	h.$("impCancel").click();
	noErrors(h);
});

test("바뀜 알림: 다른 화자의 ⟳는 보이는 알림의 바뀜을 '본 것'으로 만들지 않는다", async () => {
	const { sim, preset } = makeSim();
	const s1 = srtOf("C1");
	const s2 = srtOf("C2");
	const h = await boot(sim, preset, castSession(preset, rowsSix(), {
		C1: { path: "D:/srt/C1.srt", size: Buffer.byteLength(s1), mtime: 1790000000000 },
		C2: { path: "D:/srt/C2.srt", size: Buffer.byteLength(s2), mtime: 1790000000000 }
	}), { node: { files: { "D:/srt/C1.srt": { data: s1, mtimeMs: 1790000000000 }, "D:/srt/C2.srt": { data: s2, mtimeMs: 1790000000000 } } } });
	const toast = () => (h.$("castToast").style.display === "" ? h.$("castToastText").textContent : null);
	h.nodeFs.files.get("D:/srt/C1.srt").mtimeMs = 1790000060000;
	await h.advance(3000);
	assert.equal(toast(), "철수(C1) 파일이 바뀌었습니다");
	h.$("castRows").querySelectorAll(".cast-row")[1].querySelector(".cast-reimport").click();
	await h.flush();
	assert.deepEqual(impModal(h).rows, [{ key: "C2", act: "merge" }]);
	assert.equal(toast(), null, "창이 열린 동안은 숨긴다");
	h.$("impCancel").click();
	await h.advance(3000);
	assert.equal(toast(), "철수(C1) 파일이 바뀌었습니다", "C1의 바뀜은 아직 처리하지 않았다");
	// 그 화자의 ⟳는 그 바뀜을 처리한 것으로 본다
	h.$("castRows").querySelectorAll(".cast-row")[0].querySelector(".cast-reimport").click();
	await h.flush();
	assert.deepEqual(impModal(h).rows, [{ key: "C1", act: "merge" }]);
	h.$("impCancel").click();
	await h.advance(6000);
	assert.equal(toast(), null);
	noErrors(h);
});

test("바뀜 알림: 내용이 같은 파일을 다시 내보낸 것도 [가져오기]('변경 없음')하면 화자 표의 파일 정보를 새로 둔다 → 패널을 다시 열어도 알리지 않는다", async () => {
	const { sim, preset } = makeSim();
	const s1 = srtOf("C1");
	const sess = castSession(preset, rowsSix(), { C1: { path: "D:/srt/C1.srt", size: Buffer.byteLength(s1), mtime: 1790000000000 } });
	const node = () => ({ node: { files: { "D:/srt/C1.srt": { data: s1, mtimeMs: 1790000060000 } } } });
	const h = await boot(sim, preset, sess, node());
	const toast = (x) => (x.$("castToast").style.display === "" ? x.$("castToastText").textContent : null);
	await h.advance(3000);
	assert.equal(toast(h), "철수(C1) 파일이 바뀌었습니다");
	const nAuto = (h.fs.readJson(P.historyAuto(PROJ, A.seqId)) || []).length;
	const nSafe = (h.fs.readJson(P.historySafety(PROJ, A.seqId)) || []).length;
	h.$("castToastMerge").click();
	await h.flush();
	assert.match(h.$("impBody").querySelector(".imp-stats").textContent, /^변경 없음 \(같음 3\)$/);
	h.$("impOk").click();
	await h.flush();
	assert.match(h.status().text, /^변경 없음: C1 C1\.srt$/);
	assert.equal(h.snapshot().mi.cast.C1.mtime, 1790000060000);
	const saved = h.fs.readJson(P.session(PROJ, A.seqId));
	assert.deepEqual([saved.mi.cast.C1.path, saved.mi.cast.C1.size, saved.mi.cast.C1.mtime], ["D:/srt/C1.srt", Buffer.byteLength(s1), 1790000060000]);
	assert.equal((h.fs.readJson(P.historyAuto(PROJ, A.seqId)) || []).length, nAuto, "히스토리 항목은 남기지 않는다");
	assert.equal((h.fs.readJson(P.historySafety(PROJ, A.seqId)) || []).length, nSafe, "안전 지점도");
	// 저장된 세션으로 패널을 다시 연다
	const h2 = await boot(sim, preset, saved, node());
	await h2.advance(6000);
	assert.equal(toast(h2), null);
	noErrors(h);
	noErrors(h2);
});

test("바뀜 알림: 적용이 도는 동안과 패널이 숨었을 때는 쉰다", async () => {
	const { sim, preset } = makeSim();
	const s1 = srtOf("C1");
	const h = await boot(sim, preset, castSession(preset, rowsSix(), { C1: { path: "D:/srt/C1.srt", size: Buffer.byteLength(s1), mtime: 1790000000000 } }),
		{ node: { files: { "D:/srt/C1.srt": { data: s1, mtimeMs: 1790000000000 } } } });
	const toast = () => (h.$("castToast").style.display === "" ? h.$("castToastText").textContent : null);
	// ping을 잡아 두어 적용이 도는 동안을 만든다
	let release;
	const ping = h.host.handlers.MI_ping;
	h.host.handlers.MI_ping = (json) => new Promise((res) => { release = () => res(ping(json)); });
	const running = h.win._mogrtDebug.cmd("apply", {});
	await h.flush();
	assert.equal(h.win._mogrtDebug.miBusy(), true);
	h.nodeFs.files.get("D:/srt/C1.srt").mtimeMs = 1790000060000;
	await h.advance(3000);
	assert.equal(toast(), null, "적용 중");
	h.host.handlers.MI_ping = ping;
	release();
	assert.equal(JSON.parse(JSON.stringify(await running)).ok, true);
	await settle(h);
	// 패널이 숨으면 쉰다
	h.doc.hidden = true;
	await h.advance(6000);
	assert.equal(toast(), null, "숨은 동안");
	h.doc.hidden = false;
	await h.advance(3000);
	assert.equal(toast(), "철수(C1) 파일이 바뀌었습니다");
	noErrors(h);
});
