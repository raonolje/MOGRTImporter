"use strict";
// S1-9: 레거시 목록 적용 — ▶ 확인창 [안전하게 적용] / [지금 방식으로 전체 적용], "(실패" 확인과 ap 기록,
// 한 줄씩 updateClipAtTime(mogrtPath "") 제자리 갱신, 근처 줄·클립 없음·중지, ↑의 이름 쓰기 — panelHarness
const test = require("node:test");
const assert = require("node:assert/strict");
const { bootPanel, cachePaths: P } = require("../lib/panelHarness");
const { build } = require("../fixtures/presets_synth");

const PROJ = "C:/work/legacy.prproj";
const A = { seqId: "lega-0001", seqName: "T_LEG", projPath: PROJ };
const clone = (v) => JSON.parse(JSON.stringify(v));

function noErrors(h) {
	assert.deepEqual(h.errors().map((e) => String(e.message || e).slice(0, 300)), [], "패널 예외");
}
const tc = (sec) => {
	const ms = Math.round(sec * 1000);
	const p = (n, w) => String(n).padStart(w, "0");
	return "00:00:" + p(Math.floor(ms / 1000), 2) + "," + p(ms % 1000, 3);
};
// [[시작, 끝, 문장]] → SRT
const srtOf = (cues) => cues.map(([s, e, t], i) => (i + 1) + "\n" + tc(s) + " --> " + tc(e) + "\n" + t + "\n").join("\n");
const V1 = [[1, 3, "첫째 합성 줄"], [4, 6, "둘째 합성 줄"], [7, 9, "셋째 합성 줄"], [10, 12, "넷째 합성 줄"], [13, 15, "다섯째 합성 줄"], [16, 18, "여섯째 합성 줄"]];
// 둘째·다섯째 문장, 셋째 시간(+0.4초), 새 줄 하나
const V2 = [[1, 3, "첫째 합성 줄"], [4, 6, "둘째 합성 줄 고침"], [7.4, 9.4, "셋째 합성 줄"], [10, 12, "넷째 합성 줄"], [13, 15, "다섯째 합성 줄 고침"], [16, 18, "여섯째 합성 줄"], [19, 20, "새로 더한 합성 줄"]];

async function boot(opts) {
	const { presets } = build();
	const h = await bootPanel(Object.assign({
		seq: A,
		mogrts: [presets.preset_1, presets.preset_3].map((p) => ({ name: p.name, path: p.mogrtPath })),
		files: { [P.presets(PROJ)]: { presets: { preset_1: presets.preset_1, preset_3: presets.preset_3 }, presetTrash: [], nextPresetId: 9 } }
	}, opts || {}));
	await h.advance(1000);
	return h;
}
function setSel(h, el, v) {
	el.value = v;
	h.change(el);
}
const confirmOpen = (h) => h.$("confirmModal").classList.contains("open");
const calls = (h, fn) => h.host.calls.filter((c) => c.fn === fn).map((c) => JSON.parse(c.args[0]));
const autoList = (h) => h.fs.readJson(P.historyAuto(PROJ, A.seqId)) || [];
const resOf = (h, id) => { const el = h.$("row-" + id).querySelector(".sub-res"); return el ? el.textContent : null; };
const mmOf = (h, id) => { const el = h.$("row-" + id).querySelector(".sub-mm"); return el ? el.className : null; };
// V1을 열고 모든 줄에 프리셋 → V2로 병합 (운영: 플래그 꺼짐, S1-9부터 병합 선택이 열린다)
async function mergedList(h, presetId) {
	await h.dropSrt("interview.srt", srtOf(V1));
	const ids = h.snapshot().subtitles.map((s) => s.id);
	ids.forEach((id) => setSel(h, h.$("sel-" + id), presetId || "preset_1"));
	await h.flush();
	await h.dropSrt("interview_v2.srt", srtOf(V2));
	assert.equal(confirmOpen(h), true, "병합/교체 선택");
	h.$("confirmYes").click();
	await h.flush();
	return ids;
}
async function settle(h) {
	for (let i = 0; i < 4; i++) await h.flush();
}

test("병합 뒤 ▶ → [안전하게 적용]: 문장만 바뀐 줄만 updateClipAtTime(mogrtPath '')으로 캡션을 이름으로, 시간 변경·새 줄은 건너뛰고 표시, ap를 적고 mm을 지운다", async () => {
	const h = await boot();
	const ids = await mergedList(h);
	let s = h.snapshot();
	assert.deepEqual(ids.map((id) => s.rowStates[id].mm || "same"), ["same", "text", "time", "same", "text", "same"]);
	const newId = s.subtitles.find((x) => ids.indexOf(x.id) === -1).id;
	assert.equal(s.rowStates[newId].mm, "new");
	h.host.handlers.updateClipAtTime = () => "SUCCESS: 클립 업데이트 완료";
	h.$("btnApply").click();
	await h.flush();
	assert.equal(confirmOpen(h), true, "확인창");
	assert.match(h.$("confirmMessage").textContent, /^바뀐 줄 4개\(시간 변경 1개 포함\)가 있습니다\./);
	assert.match(h.$("confirmMessage").textContent, /시간이 바뀐 줄 1개는 이 버전에서 자동으로 옮길 수 없습니다/);
	assert.deepEqual([h.$("confirmYes").textContent, h.$("confirmAlt").textContent, h.$("confirmNo").textContent], ["안전하게 적용 (2)", "지금 방식으로 전체 적용", "취소"]);
	h.$("confirmYes").click();
	await settle(h);
	assert.equal(calls(h, "applyToTimeline").length, 0, "v27 전체 적용은 부르지 않는다");
	const sent = calls(h, "updateClipAtTime");
	assert.deepEqual(sent.map((p) => [p.videoTrackIndex, p.startSec, p.endSec, p.mogrtPath]), [[2, 4, 6, ""], [2, 13, 15, ""]]);
	assert.deepEqual(sent.map((p) => p.params.map((x) => [x.index, x.displayName, x.type, x.value])), [[[-1, "전체 텍스트", "text", "둘째 합성 줄 고침"]], [[-1, "전체 텍스트", "text", "다섯째 합성 줄 고침"]]]);
	assert.match(sent[0].params[0].rawValue, /"textEditValue":"둘째 합성 줄 고침"/);
	s = h.snapshot();
	const p1 = s.presets.preset_1;
	[ids[1], ids[4]].forEach((id) => {
		const rs = s.rowStates[id];
		const sub = s.subtitles.find((x) => x.id === id);
		assert.equal(rs.mm, undefined, "mm 지움");
		assert.equal(rs.mmPrev, undefined);
		assert.deepEqual(rs.ap, { s: sub.startSec, e: sub.endSec, cap: sub.text, ps: rs.ap.ps, t: 2 });
		assert.match(rs.ap.ps, /^[0-9a-f]{8}$/);
		assert.equal(mmOf(h, id), null, "점 없음");
	});
	assert.equal(s.rowStates[ids[2]].mm, "time", "시간 변경 줄은 그대로");
	assert.equal(resOf(h, ids[2]), "시간이 바뀜: 이 버전에서 자동으로 옮길 수 없음");
	assert.equal(resOf(h, newId), "새 줄: 타임라인에 아직 없음");
	assert.equal(resOf(h, ids[1]), null);
	assert.equal(h.status().text, "안전하게 적용: 갱신 2 · 시간 변경 1 · 새 줄 1 — 시간이 바뀐 줄 1개는 이 버전에서 자동으로 옮길 수 없습니다");
	assert.equal(h.status().cls, "ok");
	assert.equal(autoList(h)[0].label, "안전하게 적용 (2개)");
	assert.equal(h.$("btnSelectChanged").textContent, "변경 줄 (2)");
	const saved = h.fs.readJson(P.session(PROJ, A.seqId));
	assert.deepEqual(saved.rowStates[ids[1]].ap, s.rowStates[ids[1]].ap, "저장");
	assert.deepEqual(Object.keys(saved), ["subtitles", "rowStates", "trashBin", "nextId"], "단일 화자 파일 모양");
	assert.equal(p1.id, "preset_1");
	assert.equal(h.$("btnApply").disabled, false);
	assert.equal(h.$("btnApplyStop").style.display, "none");
	noErrors(h);
});

test("안전하게 적용: 0.5초 안에 다른 줄이 있으면 건너뛰고, 클립 없음은 '타임라인에 클립 없음'(mm 유지), [중지]는 줄 사이에서 멈춘다", async () => {
	const h = await boot();
	const base = [[1, 3, "가 합성"], [1.3, 3.5, "나 합성"], [6, 8, "다 합성"], [10, 12, "라 합성"], [14, 16, "마 합성"]];
	await h.dropSrt("near.srt", srtOf(base));
	const ids = h.snapshot().subtitles.map((s) => s.id);
	ids.forEach((id) => setSel(h, h.$("sel-" + id), "preset_1"));
	await h.flush();
	const edit = base.map((c, i) => (i === 1 ? c : [c[0], c[1], c[2] + " 고침"]));
	await h.dropSrt("near_v2.srt", srtOf(edit));
	h.$("confirmYes").click();
	await h.flush();
	assert.deepEqual(ids.map((id) => h.snapshot().rowStates[id].mm || "same"), ["text", "same", "text", "text", "text"]);
	let n = 0;
	h.host.handlers.updateClipAtTime = () => {
		n++;
		if (n === 1) return "ERROR: 클립 없음 + mogrtPath 미지정";
		if (n === 2) h.$("btnApplyStop").click(); // 두 번째 줄을 보내는 동안 [중지]
		return "SUCCESS: 클립 업데이트 완료";
	};
	h.$("btnApply").click();
	await h.flush();
	assert.match(h.$("confirmMessage").textContent, /0\.5초 안에 다른 줄이 있는 1개는 건너뜁니다/);
	assert.equal(h.$("confirmYes").textContent, "안전하게 적용 (3)");
	h.$("confirmYes").click();
	await settle(h);
	const sent = calls(h, "updateClipAtTime");
	assert.deepEqual(sent.map((p) => p.startSec), [6, 10], "근처 줄(1초·1.3초)은 보내지 않고, 중지 뒤 셋째는 보내지 않는다");
	const s = h.snapshot();
	assert.equal(resOf(h, ids[0]), "근처에 다른 줄이 있어 건너뜀");
	assert.equal(s.rowStates[ids[0]].mm, "text");
	assert.equal(resOf(h, ids[2]), "타임라인에 클립 없음");
	assert.equal(s.rowStates[ids[2]].mm, "text", "클립 없음 → mm 그대로");
	assert.equal(s.rowStates[ids[3]].mm, undefined, "중지 전에 보낸 줄은 적용");
	assert.equal(s.rowStates[ids[4]].mm, "text", "중지 뒤 줄은 그대로");
	assert.equal(h.status().text, "중지함 — 안전하게 적용: 갱신 1 · 클립 없음 1 · 근처 줄 1");
	assert.equal(h.status().cls, "err");
	assert.equal(h.$("btnApplyStop").style.display, "none");
	noErrors(h);
});

test("[지금 방식으로 전체 적용]: 위험한 줄만 이름으로, 나머지는 v27 바이트. 결과에 '(실패'가 있으면 mm을 남기고 실패 수, 없으면 ap를 적고 mm을 지운다", async () => {
	const { presets, STALE_1 } = build();
	const p1 = presets.preset_1;
	const all = (text) => {
		const a = clone(p1.params);
		a[4].value = text;
		return a;
	};
	const row = (id, st, text) => ({ index: id, startTime: tc(st), endTime: tc(st + 1), startSec: st, endSec: st + 1, text, id });
	const stale = clone(STALE_1);
	stale[0].value = "옛 구조 줄";
	const sess = {
		subtitles: [row(1, 1, "보통 줄"), row(2, 3, "바뀐 줄"), row(3, 5, "옛 구조 줄")],
		rowStates: {
			1: { presetId: "preset_1", params: all("보통 줄").filter((p) => p.type === "text"), _allParams: all("보통 줄"), open: false, checked: false },
			2: { presetId: "preset_1", params: all("바뀐 줄").filter((p) => p.type === "text"), _allParams: all("바뀐 줄"), open: false, checked: false, mm: "text", mmPrev: { s: 3, e: 4, cap: "옛 문장" } },
			3: { presetId: "preset_1", params: stale.filter((p) => p.type === "text"), _allParams: stale, open: false, checked: false }
		},
		trashBin: [],
		nextId: 4
	};
	const h = await boot({ files: { [P.presets(PROJ)]: { presets: { preset_1: p1 }, presetTrash: [], nextPresetId: 9 }, [P.session(PROJ, A.seqId)]: sess } });
	const before = h.snapshot().rowStates;
	h.host.handlers.applyToTimeline = () => "SUCCESS: MOGRT 2개 + 텍스트 레이어 0개 배치 완료 (실패 1개: importMGT null)";
	h.$("btnApply").click();
	await h.flush();
	assert.match(h.$("confirmMessage").textContent, /^바뀐 줄 1개와 구조가 바뀐 줄 1개가 있습니다\./);
	h.$("confirmAlt").click();
	await settle(h);
	let payload = calls(h, "applyToTimeline")[0];
	assert.deepEqual(payload.subtitles[0].params, before[1]._allParams, "보통 줄: v27과 같은 바이트");
	assert.deepEqual(payload.subtitles[1].params, before[2]._allParams, "문장만 바뀐 줄도 구조가 같으면 v27 바이트");
	assert.deepEqual(payload.subtitles[2].params.map((p) => [p.index, p.displayName]), STALE_1.map((p) => [-1, p.displayName]), "옛 구조 줄은 이름으로");
	let s = h.snapshot();
	assert.equal(s.rowStates[2].mm, "text", "실패가 있으면 mm을 남긴다");
	assert.equal(s.rowStates[2].ap, undefined);
	assert.equal(h.status().cls, "err");
	assert.match(h.status().text, /실패 1개가 있어 바뀐 줄 1개의 표시를 남겼습니다$/);
	assert.equal(autoList(h)[0].label, "타임라인 적용 (3개)", "v27처럼 기록은 남는다");
	// 다시: 실패 없음
	h.host.handlers.applyToTimeline = () => "SUCCESS: MOGRT 3개 + 텍스트 레이어 0개 배치 완료";
	h.$("btnApply").click();
	await h.flush();
	h.$("confirmAlt").click();
	await settle(h);
	s = h.snapshot();
	assert.equal(s.rowStates[2].mm, undefined);
	assert.deepEqual(s.rowStates[2].ap, { s: 3, e: 4, cap: "바뀐 줄", ps: s.rowStates[2].ap.ps, t: 2 });
	assert.equal(typeof s.rowStates[3].ap, "object", "위험한 줄도 ap");
	assert.equal(s.rowStates[1].ap, undefined, "보통 줄은 ap를 적지 않는다 (v27 모양)");
	assert.equal(h.status().text, "MOGRT 3개 + 텍스트 레이어 0개 배치 완료");
	assert.equal(h.status().cls, "ok");
	// 옛 구조 줄은 계속 위험 → 다음 ▶도 묻는다. 문장 줄은 이제 v27 경로
	payload = null;
	h.$("btnApply").click();
	await h.flush();
	assert.match(h.$("confirmMessage").textContent, /^구조가 바뀐 줄 1개가 있습니다\./);
	h.$("confirmNo").click();
	assert.equal(h.status().text, "타임라인 적용 취소");
	noErrors(h);
});

test("▶ 평소 흐름(병합 표시·위험한 줄 없음): 확인창 없이 v27 applyToTimeline, ap를 쓰지 않는다", async () => {
	const h = await boot();
	await h.dropSrt("plain.srt", srtOf(V1));
	const ids = h.snapshot().subtitles.map((s) => s.id);
	ids.forEach((id) => setSel(h, h.$("sel-" + id), "preset_3"));
	await h.flush();
	h.$("btnApply").click();
	await settle(h);
	assert.equal(confirmOpen(h), false);
	const payload = calls(h, "applyToTimeline")[0];
	const s = h.snapshot();
	assert.deepEqual(payload, {
		videoTrackIndex: 2,
		subtitles: s.subtitles.map((sub) => ({ mogrtPath: s.presets.preset_3.mogrtPath, startSec: sub.startSec, endSec: sub.endSec, text: sub.text, params: s.rowStates[sub.id]._allParams }))
	});
	ids.forEach((id) => assert.deepEqual(Object.keys(s.rowStates[id]).sort(), ["_allParams", "checked", "open", "params", "presetId"]));
	assert.equal(calls(h, "updateClipAtTime").length, 0);
	noErrors(h);
});

test("↑: 위험한 줄·시간이 바뀐 줄은 이름으로(프리셋 mogrtPath), 보통 줄은 v27 그대로. 문장 줄 성공은 ap·mm 지움, 시간 줄은 mm 유지", async () => {
	const h = await boot();
	const ids = await mergedList(h);
	h.host.handlers.updateClipAtTime = () => "SUCCESS: 클립 업데이트 완료";
	const up = (id) => h.$("row-" + id).querySelector(".btn-update").click();
	// 보통 줄 (병합에서 같음)
	up(ids[0]);
	await settle(h);
	let s = h.snapshot();
	let sent = calls(h, "updateClipAtTime");
	assert.deepEqual(sent[0].params, s.rowStates[ids[0]]._allParams, "v27 바이트");
	assert.equal(sent[0].mogrtPath, s.presets.preset_1.mogrtPath);
	assert.equal(s.rowStates[ids[0]].ap, undefined, "보통 줄은 ap 없음");
	// 문장 줄: 구조가 같아 v27 바이트, 성공이면 ap·mm 지움
	up(ids[1]);
	await settle(h);
	s = h.snapshot();
	sent = calls(h, "updateClipAtTime");
	assert.deepEqual(sent[1].params, s.rowStates[ids[1]]._allParams);
	assert.equal(s.rowStates[ids[1]].mm, undefined);
	assert.equal(s.rowStates[ids[1]].ap.s, 4);
	// 시간 줄: 이름으로, 찾은 클립은 옛 자리 → mm 유지
	up(ids[2]);
	await settle(h);
	s = h.snapshot();
	sent = calls(h, "updateClipAtTime");
	assert.ok(sent[2].params.filter((p) => p.type !== "group" && p.type !== "comment").every((p) => p.index === -1), "이름으로");
	assert.equal(sent[2].startSec, 7.4, "v27처럼 지금 시간으로 찾는다");
	assert.equal(s.rowStates[ids[2]].mm, "time");
	assert.match(h.status().text, /시간은 옮기지 않았습니다/);
	// 새 클립을 놓았으면 검증된 적용
	h.host.handlers.updateClipAtTime = () => "SUCCESS: 새 클립 배치 완료";
	up(ids[2]);
	await settle(h);
	assert.equal(h.snapshot().rowStates[ids[2]].mm, undefined);
	noErrors(h);
});
