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
	// 휴지통 복구만으로는 줄이 다시 이어지지 않는다 → 줄과 프리셋을 함께 되돌리는 안전 지점을 알린다
	assert.match(h.status().text, /2개 줄의 프리셋 연결이 끊어졌습니다 \(이전 프리셋은 프리셋 휴지통에 있습니다\. 히스토리의 안전 지점 '프리셋 가져오기 전'을 복원하면 줄과 프리셋이 함께 돌아옵니다\)/);
	assert.match(h.$("presetTrashWrap").textContent, /가져오기로 교체됨/);
	const saved = h.fs.readJson(P.presets(PROJ));
	assert.equal(saved.nextPresetId, 10);
	assert.deepEqual(h.fs.readJson(P.session(PROJ, A.seqId)).rowStates[2].presetId, "");
	noErrors(h);
});

/** 모달로 새 프리셋 하나를 저장한다 → 새 id */
async function createPreset(h, path, name) {
	h.$("btnAddPreset").click();
	await h.flush();
	h.$("defaultMogrtSel").value = path;
	h.change(h.$("defaultMogrtSel"));
	await h.advance(10);
	h.$("presetNameInput").value = name;
	h.$("btnSaveDefault").click();
	const s = h.snapshot();
	return Object.keys(s.presets).find((id) => s.presets[id].name === name);
}

test("새 프리셋 저장은 preset_9 (빈 번호 preset_5·7을 메우지 않고 휴지통 id도 피한다)", async () => {
	const file = realLike();
	const { presets } = build();
	const path = "D:/MOGRT/다른 템플릿.mogrt";
	const h = await bootPanel({ seq: A, mogrts: mogrtsOf(file), params: { [path]: clone(presets.preset_3.params) }, files: { [P.presets(PROJ)]: file } });
	await h.advance(1000);
	assert.equal(await createPreset(h, path, "새 합성 프리셋"), "preset_9");
	const s = h.snapshot();
	assert.equal(s.presets.preset_2.name, file.presets.preset_2.name, "preset_2를 덮어쓰지 않는다");
	assert.equal(s.nextPresetId, 10);
	noErrors(h);
});

test("가장 큰 id의 프리셋을 지우고 프리셋 휴지통을 비워도 그 id(와 빈 번호)를 다시 주지 않는다 (저장된 카운터가 낡은 경우)", async () => {
	const { presets } = build();
	const file = { presets: clone(presets), presetTrash: [], nextPresetId: 2 }; // 실제 모양: preset_1,2,3,4,6,8 / 카운터 2
	const path = "D:/MOGRT/다른 템플릿.mogrt";
	const h = await bootPanel({ seq: A, mogrts: mogrtsOf(file), params: { [path]: clone(presets.preset_3.params) }, files: { [P.presets(PROJ)]: file } });
	await h.advance(1000);
	// 목록 순서 = Object.entries(presets) → preset_8이 마지막 행
	const delBtns = h.$("presetList").querySelectorAll("button").filter((b) => b.textContent === "삭제");
	delBtns[delBtns.length - 1].click();
	if (h.$("confirmModal").classList.contains("open")) h.$("confirmYes").click();
	let s = h.snapshot();
	assert.deepEqual(s.presetTrash.map((t) => t.preset.id), ["preset_8"]);
	h.$("btnEmptyPresetTrash").click();
	s = h.snapshot();
	assert.equal(s.presetTrash.length, 0);
	assert.equal(s.nextPresetId, 9, "비우기 전에 카운터를 휴지통 id 위로 올린다");
	assert.equal(h.fs.readJson(P.presets(PROJ)).nextPresetId, 9, "저장도 된다");
	const made = [await createPreset(h, path, "새 하나"), await createPreset(h, path, "새 둘")];
	assert.deepEqual(made, ["preset_9", "preset_10"], "preset_7(빈 번호)·preset_8(지운 id)을 주지 않는다");
	noErrors(h);
});

test("다른 시퀀스의 session.json·히스토리만 가리키는 id는 새 프리셋에 주지 않는다 (v27 가져오기가 지운 프리셋)", async () => {
	const { presets } = build();
	const file = { presets: { preset_1: clone(presets.preset_1), preset_2: clone(presets.preset_2) }, presetTrash: [], nextPresetId: 1 };
	const path = "D:/MOGRT/다른 템플릿.mogrt";
	const B = { seqId: "bbbb-0002", seqName: "T_B", projPath: PROJ };
	const C = { seqId: "cccc-0003", seqName: "T_C", projPath: PROJ };
	const sessB = sessionWith(["preset_3"]);
	const histC = [Object.assign({ ts: 1, label: "기록", isManual: false, sequenceKey: "x" }, sessionWith(["preset_5"]))];
	const h = await bootPanel({
		seq: A, mogrts: mogrtsOf(file).concat([{ name: "다른", path }]), params: { [path]: clone(presets.preset_3.params) },
		files: { [P.presets(PROJ)]: file, [P.session(PROJ, B.seqId)]: sessB, [P.historyAuto(PROJ, C.seqId)]: histC }
	});
	await h.advance(1000);
	assert.equal(await createPreset(h, path, "새 프리셋 Y"), "preset_6", "B의 preset_3, C 히스토리의 preset_5를 피한다");
	// B로 가면 그 줄은 '프리셋 없음' (새 프리셋 Y로 바뀌지 않는다)
	h.host.seq = B;
	await h.advance(300);
	const s = h.snapshot();
	assert.equal(s.keys.seqId, B.seqId);
	assert.equal(s.rowStates[1].presetId, "");
	noErrors(h);
});

test("작업 파일이 가리키던(지금은 없는) id도 새 프리셋에 주지 않는다", async () => {
	const { presets } = build();
	const file = { presets: { preset_1: clone(presets.preset_1) }, presetTrash: [], nextPresetId: 2 };
	const path = "D:/MOGRT/다른 템플릿.mogrt";
	const h = await bootPanel({ seq: A, mogrts: mogrtsOf(file).concat([{ name: "다른", path }]), params: { [path]: clone(presets.preset_3.params) }, files: { [P.presets(PROJ)]: file } });
	await h.advance(1000);
	const work = Object.assign({ version: 2, trackValue: "2" }, sessionWith(["preset_1", "preset_12"]));
	await h.dropWork("work.json", work);
	assert.deepEqual([1, 2].map((i) => h.snapshot().rowStates[i].presetId), ["preset_1", ""]);
	assert.equal(await createPreset(h, path, "새 프리셋 Z"), "preset_13");
	noErrors(h);
});

test("같은 파일 이름의 MOGRT가 두 폴더에 있어도 다시 가져오기가 프리셋을 다른 폴더 파일로 바꾸지 않는다", async () => {
	const { presets } = build();
	const p3 = clone(presets.preset_3);
	const base = p3.mogrtPath.split(/[\\/]/).pop();
	const other = "E:/OLD/" + base; // 스캔 목록에서 앞에 있는 옛 사본
	const file = { presets: { preset_3: p3 }, presetTrash: [], nextPresetId: 4 };
	const h = await bootPanel({
		seq: A, mogrts: [{ name: "옛 사본", path: other }, { name: p3.name, path: p3.mogrtPath }],
		files: { [P.presets(PROJ)]: file, [P.session(PROJ, A.seqId)]: sessionWith(["preset_3"]) }
	});
	await h.advance(1000);
	// 1) 같은 파일 (경로가 그대로 있다) → 정확한 경로가 이긴다
	await importPresets(h, { version: 1, presets: clone(file.presets) });
	let s = h.snapshot();
	assert.equal(s.presets.preset_3.mogrtPath, p3.mogrtPath);
	assert.equal(s.rowStates[1].presetId, "preset_3");
	assert.match(h.status().text, /\(ID 유지 1개\)/);
	assert.doesNotMatch(h.status().text, /경로가 바뀐/);
	// 2) 다른 PC에서 내보낸 파일 (경로가 없고 파일 이름만 맞는다) → 지금 프리셋의 경로를 지킨다
	const foreign = clone(file.presets);
	foreign.preset_3.mogrtPath = "C:/Users/someone/MOGRT/" + base;
	await importPresets(h, { version: 1, presets: foreign });
	s = h.snapshot();
	assert.equal(s.presets.preset_3.mogrtPath, p3.mogrtPath);
	// 3) 파일이 스캔된 다른 폴더를 정확히 가리키면 그 경로로 바꾸되, 상태에 알린다
	const moved = clone(file.presets);
	moved.preset_3.mogrtPath = other;
	await importPresets(h, { version: 1, presets: moved });
	s = h.snapshot();
	assert.equal(s.presets.preset_3.mogrtPath, other);
	assert.match(h.status().text, /MOGRT 경로가 바뀐 프리셋 1개/);
	noErrors(h);
});
