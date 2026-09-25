"use strict";
// S1-2 (패널 경로): 프리셋 휴지통 복구, 프리셋 가져오기, 새 프리셋 저장 — panelHarness로 app.js 전체를 돌린다
const test = require("node:test");
const assert = require("node:assert/strict");
const { bootPanel, cachePaths: P } = require("../lib/panelHarness");
const { build } = require("../fixtures/presets_synth");

const PROJ = "C:/work/presets.prproj";
const A = { seqId: "aaaa-0001", seqName: "T_A", projPath: PROJ };
const clone = (v) => JSON.parse(JSON.stringify(v));

function realLike() {
	const { presets } = build();
	const trashP2 = Object.assign(clone(presets.preset_2), { name: "FHD 합성 그라데이션", mogrtPath: "D:/MOGRT/FHD 합성 그라데이션.mogrt" });
	return { presets, presetTrash: [{ preset: trashP2, deletedAt: "2026-06-01T00:00:00.000Z" }], nextPresetId: 2 };
}
function mogrtsOf(file) {
	const all = Object.values(file.presets).concat(file.presetTrash.map((t) => t.preset));
	const seen = {};
	return all.filter((p) => !seen[p.mogrtPath] && (seen[p.mogrtPath] = true)).map((p) => ({ name: p.name, path: p.mogrtPath }))
		.concat([{ name: "다른 템플릿", path: "D:/MOGRT/다른 템플릿.mogrt" }]);
}
function sessionWith(presetByRow) {
	const subtitles = presetByRow.map((pid, i) => ({ index: i + 1, startTime: "00:00:0" + i + ".000", endTime: "00:00:0" + (i + 1) + ".000", startSec: i, endSec: i + 1, text: "줄 " + (i + 1), id: i + 1 }));
	const rowStates = {};
	subtitles.forEach((s, i) => { rowStates[s.id] = { presetId: presetByRow[i], params: [], _allParams: [], open: false, checked: false }; });
	return { subtitles, rowStates, trashBin: [], nextId: subtitles.length + 1 };
}
async function boot(file, rows) {
	const h = await bootPanel({ seq: A, mogrts: mogrtsOf(file), files: { [P.presets(PROJ)]: file, [P.session(PROJ, A.seqId)]: sessionWith(rows || []) } });
	await h.advance(1000); // MOGRT 스캔 끝
	return h;
}
function noErrors(h) {
	assert.deepEqual(h.errors().map((e) => String(e.message || e).slice(0, 300)), [], "패널 예외");
}
/** 가져오기 버튼 → (파일 대화상자 대신) text를 넣고 → 확인창 [확인] */
async function importPresets(h, obj) {
	const origCreate = h.doc.createElement.bind(h.doc);
	let input = null;
	h.doc.createElement = (tag) => {
		const el = origCreate(tag);
		if (String(tag).toLowerCase() === "input") { input = el; el.click = () => {}; }
		return el;
	};
	try { h.$("btnImportPresets").click(); } finally { h.doc.createElement = origCreate; }
	assert.ok(input, "가져오기 input");
	const text = JSON.stringify(obj);
	input.files = [{ name: "presets.json", _text: text, size: text.length }];
	h.change(input);
	await h.flush();
	if (h.$("confirmModal").classList.contains("open")) h.$("confirmYes").click();
	await h.flush();
}

test("프리셋 휴지통 복구: 같은 id가 살아 있으면 새 id (preset_9), 살아 있는 preset_2는 그대로", async () => {
	const file = realLike();
	const h = await boot(file);
	const row = h.$("presetTrashWrap").querySelector(".trash-row");
	assert.equal(row.querySelector(".trash-text").textContent, "FHD 합성 그라데이션");
	row.querySelector(".btn-restore").click();
	const s = h.snapshot();
	assert.equal(s.presets.preset_9.name, "FHD 합성 그라데이션");
	assert.equal(s.presets.preset_9.id, "preset_9");
	assert.equal(s.presets.preset_2.name, file.presets.preset_2.name);
	assert.equal(s.nextPresetId, 10);
	assert.equal(s.presetTrash.length, 0);
	assert.match(h.status().text, /새 ID로 복구 \(preset_9\)/);
	const saved = h.fs.readJson(P.presets(PROJ));
	assert.equal(saved.nextPresetId, 10);
	assert.ok(saved.presets.preset_9);
	noErrors(h);
});

test("같은 프리셋 파일을 다시 가져오면 id·행·휴지통·카운터가 그대로", async () => {
	const file = realLike();
	const h = await boot(file, ["preset_1", "preset_3", "preset_3", ""]);
	const before = h.snapshot();
	await importPresets(h, { version: 1, exportedAt: "x", presets: clone(file.presets) });
	const s = h.snapshot();
	assert.deepEqual(Object.keys(s.presets).sort(), Object.keys(before.presets).sort());
	for (const id of Object.keys(s.presets)) assert.deepEqual([s.presets[id].name, s.presets[id].mogrtPath], [before.presets[id].name, before.presets[id].mogrtPath], id);
	assert.deepEqual([1, 2, 3, 4].map((i) => s.rowStates[i].presetId), ["preset_1", "preset_3", "preset_3", ""]);
	assert.equal(s.presetTrash.length, 1);
	assert.equal(s.nextPresetId, 2, "새 id를 받지 않았다");
	assert.match(h.status().text, /프리셋 불러오기: 6개 교체 \(ID 유지 6개\)/);
	noErrors(h);
});

test("preset_3이 다른 MOGRT인 파일: 옛 preset_3은 휴지통(why import), 가져온 것은 새 id, 그 행은 프리셋 없음", async () => {
	const file = realLike();
	const h = await boot(file, ["preset_1", "preset_3", "preset_3"]);
	const other = clone(file.presets);
	other.preset_3.mogrtPath = "D:/MOGRT/다른 템플릿.mogrt";
	await importPresets(h, { version: 1, presets: other });
	const s = h.snapshot();
	assert.equal(s.presets.preset_3, undefined);
	assert.deepEqual(s.presetTrash.filter((t) => t.why === "import").map((t) => t.preset.id), ["preset_3"]);
	const fresh = Object.values(s.presets).find((p) => p.name === file.presets.preset_3.name);
	assert.equal(fresh.id, "preset_9");
	assert.equal(fresh.mogrtPath, "D:/MOGRT/다른 템플릿.mogrt");
	assert.deepEqual([1, 2, 3].map((i) => s.rowStates[i].presetId), ["preset_1", "", ""]);
	assert.deepEqual([1, 2, 3].map((i) => h.$("sel-" + i).value), ["preset_1", "", ""], "행 select도 프리셋 없음");
	assert.match(h.status().text, /2개 줄의 프리셋 연결이 끊어졌습니다 \(프리셋 휴지통에서 복구 가능\)/);
	assert.match(h.$("presetTrashWrap").textContent, /가져오기로 교체됨/);
	const saved = h.fs.readJson(P.presets(PROJ));
	assert.equal(saved.nextPresetId, 10);
	assert.deepEqual(h.fs.readJson(P.session(PROJ, A.seqId)).rowStates[2].presetId, "");
	noErrors(h);
});

test("새 프리셋 저장은 preset_9 (빈 번호 preset_5·7을 메우지 않고 휴지통 id도 피한다)", async () => {
	const file = realLike();
	const { presets } = build();
	const path = "D:/MOGRT/다른 템플릿.mogrt";
	const h = await bootPanel({ seq: A, mogrts: mogrtsOf(file), params: { [path]: clone(presets.preset_3.params) }, files: { [P.presets(PROJ)]: file } });
	await h.advance(1000);
	h.$("btnAddPreset").click();
	await h.flush();
	h.$("defaultMogrtSel").value = path;
	h.change(h.$("defaultMogrtSel"));
	await h.advance(10);
	h.$("presetNameInput").value = "새 합성 프리셋";
	h.$("btnSaveDefault").click();
	const s = h.snapshot();
	assert.equal(s.presets.preset_9 && s.presets.preset_9.name, "새 합성 프리셋");
	assert.equal(s.presets.preset_2.name, file.presets.preset_2.name, "preset_2를 덮어쓰지 않는다");
	assert.equal(s.nextPresetId, 10);
	noErrors(h);
});
