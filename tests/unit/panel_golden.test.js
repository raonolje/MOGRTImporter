"use strict";
// 단일 화자 골든 (패널 전체): SRT 하나 → 프리셋 → ▶ 가 v27과 같은 호스트 페이로드와 같은 session.json을 만든다.
// 이 테스트는 v27 app.js(git tag v27)에서도 그대로 통과해야 한다 — 단일 화자 경로가 바뀌지 않았다는 증거다.
// ↑(한 줄 갱신)는 같은 흐름을 v27 app.js와 나란히 돌려 비교한다 (S3-4 리뷰: spec (1) 'import, preset, apply, ↑').
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { bootPanel, cachePaths: P } = require("../lib/panelHarness");
const { build } = require("../fixtures/presets_synth");

const PROJ = "C:/work/golden.prproj";
const A = { seqId: "gold-0001", seqName: "T_GOLD", projPath: PROJ };
const GOLDEN = fs.readFileSync(path.join(__dirname, "..", "fixtures", "srt", "golden_crlf.srt"), "utf8");

test("단일 화자: SRT → 프리셋 → ▶ 페이로드와 session.json이 v27과 같다", async () => {
	const { presets } = build();
	const p3 = presets.preset_3;
	const h = await bootPanel({
		seq: A,
		mogrts: [{ name: p3.name, path: p3.mogrtPath }],
		files: { [P.presets(PROJ)]: { presets: { preset_3: p3 }, presetTrash: [], nextPresetId: 4 } }
	});
	await h.advance(1000);
	await h.dropSrt("golden_crlf.srt", GOLDEN);
	assert.deepEqual(h.rows().map((r) => r.querySelector(".sub-num").textContent), ["1", "2", "3"]);
	// 두 줄 체크 → 체크된 줄 select로 일괄 적용, 나머지 한 줄은 따로
	const chk = (i) => h.$("row-" + i).querySelector("input[type=checkbox]");
	chk(1).checked = true; h.change(chk(1));
	chk(2).checked = true; h.change(chk(2));
	h.$("sel-1").value = "preset_3"; h.change(h.$("sel-1"));
	h.$("btnToggleSelect").click(); // 선택 해제
	h.$("sel-3").value = "preset_3"; h.change(h.$("sel-3"));
	h.$("trackSel").value = "3"; h.change(h.$("trackSel"));
	h.$("btnApply").click();
	await h.flush();

	const call = h.host.calls.find((c) => c.fn === "applyToTimeline");
	assert.ok(call, "applyToTimeline 호출");
	const payload = JSON.parse(call.args[0]);
	const caption = (text) => {
		const params = JSON.parse(JSON.stringify(p3.params));
		const t = params.find((p) => p.index === p3.textParamIndex);
		t.value = text;
		const raw = JSON.parse(t.rawValue);
		raw.textEditValue = text;
		raw.fontTextRunLength = [text.length];
		t.rawValue = JSON.stringify(raw);
		return params;
	};
	const LS = String.fromCharCode(0x2028);
	const texts = ["합성 자막 하나", "<i>기울임 합성 자막</i>\n둘째 줄", "줄 구분자 앞" + LS + "줄 구분자 뒤"];
	assert.deepEqual(payload, {
		videoTrackIndex: 3,
		subtitles: [[1, 2.5], [4.5, 6], [7, 8.25]].map(([s, e], i) => ({ mogrtPath: p3.mogrtPath, startSec: s, endSec: e, text: texts[i], params: caption(texts[i]) }))
	});
	assert.match(h.status().text, /하네스/);

	const saved = h.fs.readJson(P.session(PROJ, A.seqId));
	assert.deepEqual(Object.keys(saved), ["subtitles", "rowStates", "trashBin", "nextId"], "session.json은 키 4개 그대로");
	assert.deepEqual(saved.subtitles.map((s) => [s.id, s.index, s.text]), [[1, 1, texts[0]], [2, 2, texts[1]], [3, 3, texts[2]]]);
	assert.equal(saved.nextId, 4);
	assert.deepEqual(Object.keys(saved.rowStates[1]).sort(), ["_allParams", "checked", "open", "params", "presetId"]);
	assert.deepEqual(h.fs.readJson(P.settings(PROJ, A.seqId)), { trackValue: "3" });
	const errs = h.errors().map((e) => String(e.message || e).slice(0, 300));
	assert.deepEqual(errs, []);
});

// ↑ (한 줄 갱신, v27 updateClipAtTime): 같은 흐름을 지금 app.js와 v27 app.js(git tag v27)에서 돌려 호스트 호출·session.json이 같은지 본다
function v27Src() {
	return execFileSync("git", ["show", "v27:extension/html/js/app.js"], { cwd: path.join(__dirname, "..", ".."), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}
async function upFlow(appSrc) {
	const { presets } = build();
	const p3 = presets.preset_3;
	const h = await bootPanel({
		seq: A,
		appSrc,
		mogrts: [{ name: p3.name, path: p3.mogrtPath }],
		files: { [P.presets(PROJ)]: { presets: { preset_3: p3 }, presetTrash: [], nextPresetId: 4 } }
	});
	h.host.handlers.updateClipAtTime = () => "SUCCESS: 클립 업데이트 완료";
	await h.advance(1000);
	await h.dropSrt("golden_crlf.srt", GOLDEN);
	[1, 2, 3].forEach((i) => { h.$("sel-" + i).value = "preset_3"; h.change(h.$("sel-" + i)); });
	h.$("trackSel").value = "3";
	h.change(h.$("trackSel"));
	h.$("btnApply").click();
	await h.flush();
	// 2번 줄 속성창의 캡션 textarea를 고치고 ↑
	const ta = h.$("params-2").querySelectorAll(".mogrt-text-area")[0];
	ta.value = "↑로 고친 합성 자막";
	ta.dispatchEvent({ type: "input" });
	h.$("row-2").querySelector(".btn-update").click();
	await h.flush();
	return { h, calls: h.host.calls.filter((c) => c.fn === "updateClipAtTime" || c.fn === "applyToTimeline").map((c) => [c.fn, c.args[0]]) };
}

test("단일 화자 ↑: 캡션을 고친 줄의 updateClipAtTime 페이로드·상태·session.json이 v27 app.js와 바이트까지 같다", async () => {
	const now = await upFlow();
	const old = await upFlow(v27Src());
	assert.deepEqual(now.calls.map((c) => c[0]), ["applyToTimeline", "updateClipAtTime"], "▶ 한 번, ↑ 한 번");
	assert.deepEqual(now.calls, old.calls, "호스트에 보낸 글자 그대로 (v27)");
	const { presets } = build();
	const p3 = presets.preset_3;
	const params = JSON.parse(JSON.stringify(p3.params));
	const cap = params.find((p) => p.index === p3.textParamIndex);
	cap.value = "↑로 고친 합성 자막";
	const raw = JSON.parse(cap.rawValue);
	raw.textEditValue = cap.value;
	raw.fontTextRunLength = [cap.value.length];
	cap.rawValue = JSON.stringify(raw);
	assert.deepEqual(JSON.parse(now.calls[1][1]), { videoTrackIndex: 3, startSec: 4.5, endSec: 6, mogrtPath: p3.mogrtPath, params }, "2번 줄 시간 그대로, 고친 캡션");
	assert.deepEqual(now.h.status(), old.h.status(), "상태 줄");
	assert.match(now.h.status().text, /^\[2\] 클립 업데이트 완료$/);
	const saved = now.h.fs.readJson(P.session(PROJ, A.seqId));
	assert.deepEqual(saved, old.h.fs.readJson(P.session(PROJ, A.seqId)), "session.json 그대로 (v27)");
	assert.deepEqual(Object.keys(saved), ["subtitles", "rowStates", "trashBin", "nextId"]);
	assert.deepEqual(Object.keys(saved.rowStates[2]).sort(), ["_allParams", "checked", "open", "params", "presetId"], "ap·mm 없음");
	assert.deepEqual(now.h.errors().map((e) => String(e.message || e).slice(0, 300)), []);
});
