"use strict";
// S3-4: 끝에서 끝까지 — panelHarness(app.js 전체) + premiereSim(hostscript.jsx 전체, 가짜 Premiere).
// 하드 케이스 tests/premiere/cases/s3_4_e2e.case.js와 같은 자막·같은 순서다 (실제 Premiere는 하드 케이스 몫).
//   (A) 3화자 × 40줄, 모든 차례에 세 화자가 동시에 말한다 (겹친 자막) → 가져오기 창 → ▶ 점검 창에 계획한 트랙
//       (C1 기본 트랙 V3, 남의 클립이 있는 V4를 건너뛰어 C2 V5·C3 V6 새 트랙) → 화자마다 자기 트랙, 잘린 클립 없음
//       (클립마다 시작·끝 = 자막 ±1프레임), 다시 적용 0개, 검수 '정상 120'
//   (B) C1을 다시 내보냄: 한 줄은 둘로 나눔, 붙은 두 줄은 하나로 합침 → 가져오기 창 '나눔·합침 확인 2 · 새 줄 1 · 빠짐 1'
//       → ▶ 한 번에 (점검 창: 목록에서 빠진 줄의 클립 지우기) — 앞 조각은 줄이고(단계 2) 뒤 조각은 새로(단계 4), 합친 줄은 빠진 줄을
//       지운(단계 1) 뒤 늘린다(단계 5). 뒤 조각의 템플릿 길이가 덮은 이웃 머리는 되돌린다 (잘린 머리 없음), 남은 클립 없음,
//       다시 계획하면 0개 → '↶ 마지막 적용 되돌리기' → 타임라인이 적용 전과 같다 (uid·트랙·시작·끝·문장)
const test = require("node:test");
const assert = require("node:assert/strict");
const { bootPanel, cachePaths: P } = require("../lib/panelHarness");
const { createSim, FT, TPS, aeText, color } = require("../lib/premiereSim");
const { loadRegions } = require("../lib/loadRegions");

const CORE = loadRegions(["src/mi/core.ts"]);
const PROJ = "C:/work/e2e.prproj";
const A = { seqId: "seq-e2e-1", seqName: "T_E2E", projPath: PROJ };
const MOGRT = "C:/m/[라온올제] 합성 자막.mogrt";
const F = FT.f23976;
const HOST_FNS = ["ping", "getTracks", "readClipTexts", "ensureVideoTracks", "placeChunk", "removeClips"];
const LA = () => P.session(PROJ, A.seqId).replace("session.json", "last_apply.json");
const frameOf = (s) => Math.round((s * TPS) / F);

// ── 자막 (하드 케이스 s3_4_e2e와 같은 모양) ──
// 차례 k(0~39)는 1 + 3k초에서 시작하고, 세 화자가 모두 겹친다: C1 [s, s+1.5], C2 [s+0.5, s+2], C3 [s+1, s+2.5].
// C1의 나눌 줄(SPLIT) 바로 뒤 줄은 길다 (s+3 ~ s+5.9): 뒤 조각(s+0.5)의 템플릿 길이(5.005~5.09초)가 그 머리만 덮는다
// (끝까지 덮지 않는다 → 호스트가 머리를 되돌리는 경로). 합칠 두 줄(JOIN, JOIN+1)은 C1의 마지막 두 줄이다
// (되돌리기가 빠진 줄을 템플릿 길이로 되놓을 때 뒤에 C1 클립이 없다).
const N = 40;
const SPLIT = 10;
const SPLIT_AT = 0.5;
const JOIN = 38;
const turn = (k) => 1 + 3 * k;
function cuesOf() {
	const c1 = [];
	const c2 = [];
	const c3 = [];
	for (let k = 0; k < N; k++) {
		const s = turn(k);
		c1.push([s, k === SPLIT + 1 ? s + 2.9 : s + 1.5, k === SPLIT ? "S34 철수 열한째 말은 첫 조각과 둘째 조각" : "S34 철수 " + (k + 1) + "번째 말"]);
		c2.push([s + 0.5, s + 2, "S34 영희 " + (k + 1) + "번째 겹친 말"]);
		c3.push([s + 1, s + 2.5, "S34 민수 " + (k + 1) + "번째 겹친 말"]);
	}
	return { c1, c2, c3 };
}
// C1 다시 내보내기: SPLIT을 둘로 (문장도 다듬어 유사도 0.5 밑 → 확인), JOIN·JOIN+1을 하나로
function splitJoin(c1) {
	const out = [];
	c1.forEach(([s, e, t], k) => {
		if (k === SPLIT) {
			out.push([s, s + SPLIT_AT, "S34 첫 조각입니다"]);
			out.push([s + SPLIT_AT, e, "그리고 둘째 조각이에요"]);
		} else if (k === JOIN) out.push([s, c1[k + 1][1], "S34 철수 39번째 말에 이어진 다음 말까지 하나로 합쳤습니다"]);
		else if (k !== JOIN + 1) out.push([s, e, t]);
	});
	return out;
}
function srtOf(cues) {
	const tc = (sec) => {
		const ms = Math.round(sec * 1000);
		const p = (n, w) => String(n).padStart(w, "0");
		return p(Math.floor(ms / 3600000), 2) + ":" + p(Math.floor((ms % 3600000) / 60000), 2) + ":" + p(Math.floor((ms % 60000) / 1000), 2) + "," + p(ms % 1000, 3);
	};
	return cues.map(([s, e, t], i) => (i + 1) + "\n" + tc(s) + " --> " + tc(e) + "\n" + t + "\n").join("\n");
}

function makeSim() {
	const sim = createSim();
	const seq = sim.addSequence({ name: A.seqName, id: A.seqId, ft: F, tracks: 4 });
	sim.addTemplate(MOGRT, { kind: "ae", name: "[라온올제] 합성 자막", params: [aeText("텍스트", "기본"), aeText("포인트 텍스트", ""), color("색", 4294967295)] });
	const probe = sim.place(seq, 0, MOGRT, 90000, 90100);
	const r = sim.call("MI_readClipTexts", { seqId: seq.id, build: "@@BUILD@@", items: [{ track: 0, nodeId: sim.nodeId(probe) }], want: { params: true } });
	probe.track.clips.splice(probe.track.clips.indexOf(probe), 1);
	const params = r.results[0].params.map((p) => Object.assign({}, p, { group: "" }));
	const preset = { id: "preset_3", name: "합성 자막", mogrtPath: MOGRT, params, exposedIndices: [0, 1], textParamIndex: 0, exposedFontFields: {} };
	// T_ 시퀀스처럼 V4에 남의 클립 (자막 구간 전체) → C2·C3는 V4를 건너뛴다
	sim.placeOther(seq, 3, 0, frameOf(130), "외부.png");
	return { sim, seq, preset };
}
async function boot(sim, preset) {
	const h = await bootPanel({
		seq: A,
		mogrts: [{ name: preset.name, path: preset.mogrtPath }],
		files: { [P.presets(PROJ)]: { presets: { [preset.id]: preset }, presetTrash: [], nextPresetId: 4 } }
	});
	HOST_FNS.forEach((n) => {
		h.host.handlers["MI_" + n] = (json) => sim.callRaw("MI_" + n, json === undefined ? undefined : JSON.stringify(json));
	});
	h.host.params[preset.mogrtPath] = preset.params;
	await h.advance(1000);
	return h;
}
async function settle(h) {
	for (let i = 0; i < 800; i++) {
		await h.flush();
		if (h.$("preflightModal").classList.contains("open")) return;
		if (!h.win._mogrtDebug.miBusy()) return;
	}
	throw new Error("끝나지 않았다");
}
const pfOpen = (h) => h.$("preflightModal").classList.contains("open");
const pfLines = (h) => h.$("pfSummary").querySelectorAll(".pf-line").map((e) => e.textContent);
const pfOpt = (h, id) => {
	const cb = h.$(id);
	const row = cb.parentNode;
	return { shown: row.style.display !== "none", checked: cb.checked, text: row.querySelector("span").textContent };
};
const cmd = async (h, op, args) => JSON.parse(JSON.stringify(await h.win._mogrtDebug.cmd(op, args)));
const impRows = (h) => h.$("impBody").querySelectorAll("tr.imp-row");
function noErrors(h) {
	assert.deepEqual(h.errors().map((e) => String(e.message || e).slice(0, 300)), [], "패널 예외");
}
function noOverlap(seq) {
	seq.tracks.forEach((tr, ti) => {
		const c = tr.clips.slice().sort((a, b) => a.s - b.s);
		for (let i = 1; i < c.length; i++) assert.ok(c[i - 1].e <= c[i].s, "트랙 " + ti + " 겹침: " + c[i - 1].name + " / " + c[i].name);
	});
}
// 화자 트랙의 클립 [uid, 시작, 끝, 문장] (시간순)
function trackRows(sim, seq, ti) {
	return sim.clips(seq, ti).slice().sort((a, b) => a.s - b.s).map((m) => {
		const tg = CORE.parseClipTag(m.name);
		return [tg ? tg.uid : m.name, Math.round(m.s / F), Math.round(m.e / F), sim.textOf(m, "텍스트")];
	});
}
// 줄마다 지금 클립이 자막과 같은가 (시작·끝 ±1프레임, 문장) → 화자별 트랙
function checkRowsOnTracks(h, sim, seq, what) {
	const s = h.snapshot();
	const salt = s.mi.salt;
	const trackOf = {};
	const byUid = {};
	seq.tracks.forEach((tr, ti) => tr.clips.forEach((m) => {
		const tg = CORE.parseClipTag(m.name);
		if (!tg || tg.salt !== salt) return;
		assert.ok(!byUid[tg.uid], what + ": 같은 태그 클립이 둘 — " + m.name);
		byUid[tg.uid] = { ti, m };
	}));
	s.subtitles.forEach((x) => {
		const c = byUid[salt + "-" + x.id];
		assert.ok(c, what + ": " + x.spk + " 줄 " + x.id + " 클립");
		assert.ok(Math.abs(Math.round(c.m.s / F) - frameOf(x.startSec)) <= 1, what + ": 줄 " + x.id + " 시작 " + Math.round(c.m.s / F) + " / " + frameOf(x.startSec));
		assert.ok(Math.abs(Math.round(c.m.e / F) - frameOf(x.endSec)) <= 1, what + ": 줄 " + x.id + " 끝 " + Math.round(c.m.e / F) + " / " + frameOf(x.endSec) + " (잘림)");
		assert.equal(sim.textOf(c.m, "텍스트"), x.text, what + ": 줄 " + x.id + " 문장");
		(trackOf[x.spk] = trackOf[x.spk] || {})[c.ti] = true;
	});
	assert.equal(Object.keys(byUid).length, s.subtitles.length, what + ": 남은 태그 클립 없음");
	return trackOf;
}
// (A)까지: 3화자 가져오기 → ▶ (점검 창 확인) → 적용
async function setupThree() {
	const { sim, seq, preset } = makeSim();
	const h = await boot(sim, preset);
	const { c1, c2, c3 } = cuesOf();
	await h.dropSrts([{ name: "C1.srt", content: srtOf(c1) }, { name: "C2.srt", content: srtOf(c2) }, { name: "C3.srt", content: srtOf(c3) }]);
	assert.equal(h.$("importModal").classList.contains("open"), true, "가져오기 창");
	const names = { C1: "철수", C2: "영희", C3: "민수" };
	impRows(h).forEach((r) => {
		const k = r.querySelector(".imp-key").value;
		const nm = r.querySelector(".imp-name");
		nm.value = names[k];
		nm.dispatchEvent(h.win.Event("input"));
		const p = r.querySelector(".imp-preset");
		p.value = preset.id;
		h.change(p);
	});
	h.$("impOk").click();
	await h.flush();
	await h.advance(500);
	const s = h.snapshot();
	assert.equal(s.subtitles.length, 3 * N);
	assert.deepEqual(s.mi.castOrder, ["C1", "C2", "C3"]);
	assert.ok(s.subtitles.every((x) => (s.rowStates[x.id]._allParams || []).length > 0), "줄 속성");
	return { sim, seq, preset, h, c1, c2, c3 };
}

test("(A) 3화자 동시 발화: 점검 창에 계획한 트랙(C1 V3 · C2 V5 · C3 V6, 새 트랙 2개) → 화자마다 자기 트랙, 클립마다 자막 ±1프레임, 다시 적용 0개, 검수 정상 120", async () => {
	const { sim, seq, h } = await setupThree();
	h.$("btnApply").click();
	await settle(h);
	assert.equal(pfOpen(h), true, "새 트랙이 있어 점검 창");
	const lines = pfLines(h);
	assert.equal(lines[0], "배치 120줄: C1 철수 V3 40 · C2 영희 V5 40 · C3 민수 V6 40");
	assert.ok(lines.indexOf("새 비디오 트랙 2개 (V5, V6)") !== -1, lines.join(" | "));
	h.$("pfOk").click();
	await settle(h);
	assert.equal(h.win._mogrtDebug.miBusy(), false);
	assert.match(h.status().text, /^화자별 배치: 놓음 120 · 새 트랙 2$/, h.status().text);
	assert.equal(seq.tracks.length, 6);
	const tracks = checkRowsOnTracks(h, sim, seq, "(A)");
	assert.deepEqual([Object.keys(tracks.C1), Object.keys(tracks.C2), Object.keys(tracks.C3)], [["2"], ["4"], ["5"]], "화자마다 자기 트랙");
	assert.equal(sim.clips(seq, 3).length, 1, "V4의 남의 클립 그대로");
	noOverlap(seq);
	// 다시 적용: 보내는 작업 0
	const t0 = Date.now();
	const r = await cmd(h, "apply", {});
	assert.equal(r.ok, true, JSON.stringify(r));
	assert.deepEqual([r.data.ops, r.data.none], [0, 3 * N], JSON.stringify(r.data));
	assert.ok(Date.now() - t0 < 5000, "다시 적용 " + (Date.now() - t0) + "ms");
	// 검수: 모두 정상
	h.$("btnVerify").click();
	await settle(h);
	assert.equal(h.$("verifyModal").classList.contains("open"), true);
	assert.equal(h.$("vfSummary").textContent, "정상 120 · 타임라인에 없음 0 · 옮겨짐 0 · 같은 태그 중복 0 · 옛 세대 0 · Premiere에서 고침 0 · 옛 버전 템플릿 0 · 효과·키프레임 0 · 미적용 0 · 목록에 없는 클립 0");
	h.$("vfClose").click();
	noErrors(h);
});

test("(B) 나누기·합치기 다시 가져오기: 가져오기 창 분류(확인 2 · 새 줄 1 · 빠짐 1) → ▶ 한 번에 (잘린 이웃 머리·남은 클립 없음) → 되돌리기로 적용 전 타임라인", async () => {
	const { sim, seq, h, c1 } = await setupThree();
	h.$("btnApply").click();
	await settle(h);
	h.$("pfOk").click();
	await settle(h);
	const salt = h.snapshot().mi.salt;
	const before = [2, 4, 5].map((ti) => trackRows(sim, seq, ti));
	const nodeIds0 = sim.clips(seq, 2).slice().sort((a, b) => a.s - b.s).map((m) => sim.nodeId(m));
	let s = h.snapshot();
	const c1Ids = s.subtitles.filter((x) => x.spk === "C1").map((x) => x.id);
	const idSplit = c1Ids[SPLIT];
	const idNext = c1Ids[SPLIT + 1];
	const idJoin = c1Ids[JOIN];
	const idGone = c1Ids[JOIN + 1];

	// C1 다시 내보내기 → 가져오기 창 (이미 있는 화자 = 병합)
	const c1b = splitJoin(c1);
	await h.dropSrts([{ name: "C1.srt", content: srtOf(c1b) }]);
	assert.equal(h.$("importModal").classList.contains("open"), true);
	const rows = impRows(h);
	assert.equal(rows.length, 1);
	assert.equal(rows[0].querySelector(".imp-act").value, "merge");
	assert.equal(h.$("impBody").querySelector(".imp-stats").textContent, "같음 37 · 나눔·합침 확인 2 · 새 줄 1 · 빠짐 1");
	h.$("impOk").click();
	await h.flush();
	await h.advance(500);
	s = h.snapshot();
	assert.equal(s.subtitles.filter((x) => x.spk === "C1").length, N, "40 - 1 + 1");
	const idNew = s.subtitles.find((x) => x.text === "그리고 둘째 조각이에요").id;
	assert.deepEqual([s.rowStates[idSplit].mm, s.rowStates[idJoin].mm, s.rowStates[idNew].mm], ["check", "check", "new"]);
	assert.equal(s.trashBin.find((t) => t.sub.id === idGone).why, "merge");
	assert.equal(s.subtitles.find((x) => x.id === idSplit).text, "S34 첫 조각입니다");

	// ▶ 한 번: 점검 창은 목록에서 빠진 줄의 클립 지우기 (미리 체크). 보낸 작업을 남긴다
	const sent = [];
	h.host.handlers.MI_placeChunk = (json) => {
		(JSON.parse(json).items || []).forEach((it) => sent.push({ key: it.key, op: it.op, sf: it.sf, ef: it.ef, guard: it.guard || [] }));
		return sim.callRaw("MI_placeChunk", JSON.stringify(json));
	};
	h.$("btnApply").click();
	await settle(h);
	assert.equal(pfOpen(h), true);
	assert.deepEqual(pfOpt(h, "pfOrphans"), { shown: true, checked: true, text: "목록에서 빠진 줄의 클립 1개 지우기 (병합·교체로 빠졌고 Premiere에서 고치지 않은 것)" });
	assert.match(pfLines(h)[0], /^배치 120줄: C1 철수 V3 3 · C2 영희 V5 0 · C3 민수 V6 0 \(변경 없음 117줄은 보내지 않음\)$/, pfLines(h)[0]);
	h.$("pfOk").click();
	await settle(h);
	assert.equal(h.win._mogrtDebug.miBusy(), false);
	assert.equal(h.status().text, "화자별 배치: 놓음 1 · 갱신 2 · 지움 1 · 그대로 117");
	const la = h.fs.readJson(LA());
	assert.equal(la.complete, true);
	assert.deepEqual(["created", "updated", "removed"].map((c) => la[c].length), [1, 2, 1], JSON.stringify(la).slice(0, 400));
	checkRowsOnTracks(h, sim, seq, "(B)");
	const v3 = trackRows(sim, seq, 2);
	assert.equal(v3.length, N, "C1 트랙 클립 40개 (남은 클립 없음)");
	// 나눈 줄: 앞 조각은 같은 클립(줄임), 뒤 조각은 새 클립. 뒤 조각이 덮은 이웃(idNext)은 머리가 그대로
	const at = (uid) => v3.find((x) => x[0] === uid);
	assert.deepEqual(at(salt + "-" + idSplit).slice(1), [frameOf(turn(SPLIT)), frameOf(turn(SPLIT) + SPLIT_AT), "S34 첫 조각입니다"]);
	assert.deepEqual(at(salt + "-" + idNew).slice(1), [frameOf(turn(SPLIT) + SPLIT_AT), frameOf(turn(SPLIT) + 1.5), "그리고 둘째 조각이에요"]);
	assert.deepEqual(at(salt + "-" + idNext).slice(1), [frameOf(turn(SPLIT + 1)), frameOf(turn(SPLIT + 1) + 2.9), "S34 철수 12번째 말"], "이웃 머리가 잘리지 않았다");
	assert.deepEqual(at(salt + "-" + idJoin).slice(1), [frameOf(turn(JOIN)), frameOf(turn(JOIN + 1) + 1.5), "S34 철수 39번째 말에 이어진 다음 말까지 하나로 합쳤습니다"]);
	assert.equal(at(salt + "-" + idGone), undefined, "빠진 줄의 클립은 지웠다");
	const nodeOf = (id) => sim.nodeId(sim.clips(seq, 2).find((m) => (CORE.parseClipTag(m.name) || {}).uid === salt + "-" + id));
	assert.equal(nodeOf(idSplit), nodeIds0[SPLIT], "앞 조각은 같은 클립 (끝만 줄임)");
	assert.equal(nodeOf(idJoin), nodeIds0[JOIN], "합친 줄은 같은 클립 (끝만 늘림)");
	assert.equal(nodeOf(idNext), nodeIds0[SPLIT + 1], "이웃은 같은 클립 (머리를 되돌렸다)");
	// 뒤 조각을 놓을 때 템플릿 길이가 이웃 머리를 덮는다 → 이웃을 guard로 보냈다 (호스트가 머리를 되돌린다)
	const put = sent.find((x) => x.key === salt + "-" + idNew);
	assert.ok(put && put.op === "place", JSON.stringify(sent));
	assert.ok(put.guard.map(String).indexOf(String(nodeIds0[SPLIT + 1])) !== -1, "이웃 guard: " + JSON.stringify(put));
	assert.deepEqual(sent.map((x) => x.key).sort(), [salt + "-" + idJoin, salt + "-" + idNew, salt + "-" + idSplit].sort(), "C1의 세 줄만 보냈다");
	// 단계 순서: 앞 조각 줄이기(2) → 뒤 조각 놓기(4) → 합친 줄 늘리기(5). 빠진 줄 클립은 그 전에 removeClips(1)
	const pos = (id) => sent.findIndex((x) => x.key === salt + "-" + id);
	assert.ok(pos(idSplit) < pos(idNew) && pos(idNew) < pos(idJoin), "단계 순서: " + sent.map((x) => x.key + ":" + x.op).join(", "));
	assert.deepEqual([sent[pos(idSplit)].op, sent[pos(idJoin)].op], ["update", "update"]);
	assert.deepEqual([trackRows(sim, seq, 4), trackRows(sim, seq, 5)], [before[1], before[2]], "C2·C3 트랙은 그대로");
	noOverlap(seq);
	// 한 번에 끝났다: 다시 계획하면 0개
	const pl = await cmd(h, "plan", {});
	assert.equal(pl.ok, true, JSON.stringify(pl).slice(0, 300));
	assert.deepEqual([pl.data.plan.none, Object.keys(pl.data.plan.ops).length], [3 * N, 0]);

	// 되돌리기 → 적용 전 타임라인
	h.$("btnHistory").click();
	await h.flush();
	const item = h.$("btnUndoApply");
	assert.ok(item, "마지막 적용 항목");
	assert.match(item.textContent, /^↶ 마지막 적용 되돌리기 \(.+ · \d+줄\)$/);
	item.click();
	await h.flush();
	assert.equal(h.$("confirmModal").classList.contains("open"), true);
	h.$("confirmYes").click();
	await settle(h);
	assert.equal(h.status().text, "마지막 적용 되돌리기: 지움 1 · 되돌림 2 · 되놓음 1");
	assert.deepEqual([2, 4, 5].map((ti) => trackRows(sim, seq, ti)), before, "적용 전과 같다 (uid·시작·끝·문장)");
	noOverlap(seq);
	s = h.snapshot();
	assert.equal(s.subtitles.find((x) => x.id === idSplit).text, "S34 첫 조각입니다", "자막 목록은 그대로");
	assert.deepEqual([s.rowStates[idSplit].mm, s.rowStates[idJoin].mm], ["undone", "undone"]);
	noErrors(h);
});
