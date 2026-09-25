"use strict";
// S1-4: 안전 지점(history_safety.json)과 자동저장 중복 건너뛰기 — panelHarness로 app.js 전체를 돌린다
const test = require("node:test");
const assert = require("node:assert/strict");
const { bootPanel, cachePaths: P } = require("../lib/panelHarness");
const { build } = require("../fixtures/presets_synth");

const PROJ = "C:/work/safety.prproj";
const A = { seqId: "aaaa-0001", seqName: "T_A", projPath: PROJ };
const clone = (v) => JSON.parse(JSON.stringify(v));
const MIN = 60 * 1000;

function sub(id, index, text) {
	const tc = (x) => "00:00:" + String(Math.floor(x)).padStart(2, "0") + ".000";
	return { index, startTime: tc(index * 2), endTime: tc(index * 2 + 1), startSec: index * 2, endSec: index * 2 + 1, text, id };
}
function session(n, prefix, presetId) {
	const subtitles = [];
	const rowStates = {};
	for (let i = 1; i <= n; i++) {
		subtitles.push(sub(i, i, (prefix || "합성 줄 ") + i));
		rowStates[i] = { presetId: presetId || "", params: [], _allParams: [], open: false, checked: false };
	}
	return { subtitles, rowStates, trashBin: [], nextId: n + 1 };
}
function srtOf(texts) {
	return texts.map((t, i) => (i + 1) + "\n00:00:0" + i + ",000 --> 00:00:0" + i + ",900\n" + t + "\n").join("\n");
}
function noErrors(h) {
	assert.deepEqual(h.errors().map((e) => String(e.message || e).slice(0, 300)), [], "패널 예외");
}
const autoList = (h) => h.fs.readJson(P.historyAuto(PROJ, A.seqId)) || [];
const safetyList = (h) => h.fs.readJson(P.historySafety(PROJ, A.seqId)) || [];
const pick = (s) => ({ subtitles: s.subtitles, rowStates: s.rowStates, trashBin: s.trashBin });

async function boot(opts) {
	const h = await bootPanel(Object.assign({ seq: A }, opts || {}));
	await h.advance(1000);
	return h;
}
/** Date.now를 멈춘 시계로 바꾼다 → 앞당기는 함수 */
function freezeNow(h) {
	let now = Date.now();
	h.win.Date.now = () => now;
	return (ms) => { now += ms; return now; };
}
function rowButton(h, id, title) {
	return h.$("row-" + id).querySelectorAll("button").find((b) => b.title === title);
}
function openHistory(h) {
	const dd = h.$("historyDropdown");
	if (!dd.classList.contains("open")) h.$("btnHistory").click();
	return dd;
}
/** 드롭다운 섹션(#historySafety 등)의 idx번째 항목을 눌러 복원한다 */
function restoreFrom(h, sectionEl, idx) {
	const items = sectionEl.querySelectorAll(".history-item");
	assert.ok(items[idx], "히스토리 항목 " + idx);
	items[idx].childNodes[0].click();
	assert.equal(h.$("confirmModal").classList.contains("open"), true, "복원 확인창");
	h.$("confirmYes").click();
}

// ── 자동저장 중복 건너뛰기 ──

test("5분 무작업 자동저장: 변화 없이 30분이면 1개(6개가 아니다), 바뀌면 다시 1개", async () => {
	const h = await boot({ files: { [P.session(PROJ, A.seqId)]: session(3) } });
	const fwd = freezeNow(h);
	for (let i = 0; i < 6; i++) {
		fwd(5 * MIN + 1000);
		h.win._mogrtDebug.idleAutosaveTick();
	}
	let list = autoList(h);
	assert.deepEqual(list.map((e) => e.label), ["자동저장 (5분 무작업)"]);
	assert.match(list[0].hash, /^[0-9a-f]{8}$/, "새 항목은 hash를 싣는다");
	// 1분 타이머도 같은 확인을 부른다
	fwd(6 * MIN);
	await h.advance(61 * 1000);
	assert.equal(autoList(h).length, 1, "타이머: 내용이 같으면 건너뛴다");
	// 줄 하나를 지운다 → 다음 무작업 확인에서 하나 더, 그 뒤로는 다시 건너뛴다
	rowButton(h, 1, "삭제 (휴지통으로)").click();
	for (let i = 0; i < 6; i++) {
		fwd(5 * MIN + 1000);
		h.win._mogrtDebug.idleAutosaveTick();
	}
	list = autoList(h);
	assert.equal(list.length, 2);
	assert.deepEqual(list[0].subtitles.map((s) => s.id), [2, 3]);
	assert.equal(list[0].trashBin.length, 1);
	noErrors(h);
});

test("자동저장 비교는 가장 최근 자동 항목(hash 없는 옛 항목은 그 자리에서 계산)과 한다", async () => {
	const sess = session(2);
	// v27이 남긴 항목: hash가 없다. 내용은 지금 세션과 같다
	const old = { ts: 1, label: "SRT 로드: 옛.srt", isManual: false, sequenceKey: "x", subtitles: clone(sess.subtitles), rowStates: clone(sess.rowStates), trashBin: [], nextId: 3, trackValue: "2" };
	const h = await boot({ files: { [P.session(PROJ, A.seqId)]: sess, [P.historyAuto(PROJ, A.seqId)]: [old] } });
	const fwd = freezeNow(h);
	fwd(5 * MIN + 1000);
	h.win._mogrtDebug.idleAutosaveTick();
	assert.deepEqual(autoList(h).map((e) => e.label), ["SRT 로드: 옛.srt"], "같은 내용 → 건너뜀");
	assert.equal(autoList(h)[0].hash, undefined, "옛 항목은 고쳐 쓰지 않는다");
	noErrors(h);
});

test("SRT 로드·수동저장 항목도 hash를 싣고, v27 이름은 그대로다", async () => {
	const h = await boot();
	await h.dropSrt("합성.srt", srtOf(["가", "나"]));
	const list = autoList(h);
	assert.deepEqual(list.map((e) => e.label), ["SRT 로드: 합성.srt"]);
	assert.match(list[0].hash, /^[0-9a-f]{8}$/);
	assert.deepEqual(Object.keys(list[0]), ["ts", "label", "isManual", "sequenceKey", "subtitles", "rowStates", "trashBin", "nextId", "trackValue", "hash"]);
	openHistory(h);
	h.$("historyDropdown").querySelector("input[type=text]").value = "합성 수동";
	h.$("historyDropdown").querySelectorAll("button").find((b) => b.textContent === "저장").click();
	const manual = h.fs.readJson(P.historyManual(PROJ, A.seqId));
	assert.deepEqual(manual.map((e) => [e.label, e.isManual, typeof e.hash]), [["합성 수동", true, "string"]]);
	assert.equal(manual[0].hash, list[0].hash, "같은 내용 → 같은 hash");
	noErrors(h);
});

// ── 안전 지점 ──

test("SRT를 14줄 목록 위에 열면 가장 최근 안전 지점이 옛 14줄(과 휴지통)을 담는다", async () => {
	const sess = session(14);
	sess.trashBin = [{ sub: sub(20, 15, "휴지통 줄"), state: { presetId: "", params: [], _allParams: [], open: false, checked: false }, position: 14 }];
	sess.nextId = 21;
	const h = await boot({ files: { [P.session(PROJ, A.seqId)]: sess } });
	const before = pick(h.snapshot());
	await h.dropSrt("새 파일.srt", srtOf(["새 하나", "새 둘"]));
	const list = safetyList(h);
	assert.equal(list.length, 1);
	assert.equal(list[0].label, "SRT 가져오기 전: 새 파일.srt");
	assert.equal(list[0].kind, "safety");
	assert.equal(list[0].subtitles.length, 14);
	assert.deepEqual(pick(list[0]), before, "옛 목록·rowStates·휴지통 그대로");
	assert.equal(h.snapshot().subtitles.length, 2);
	// v27 사후 항목도 그대로 남는다
	assert.deepEqual(autoList(h).map((e) => e.label), ["SRT 로드: 새 파일.srt"]);
	noErrors(h);
});

test("빈 목록에 SRT를 열면 안전 지점을 남기지 않는다", async () => {
	const h = await boot();
	await h.dropSrt("첫 파일.srt", srtOf(["가"]));
	assert.equal(h.fs.files.has(P.historySafety(PROJ, A.seqId)), false);
	noErrors(h);
});

test("히스토리 복원은 먼저 '히스토리 복원 전'을 남기고, 그것을 복원하면 복원 직전과 정확히 같다", async () => {
	const h = await boot({ files: { [P.session(PROJ, A.seqId)]: session(3, "처음 ") } });
	// 상태 X를 수동저장
	openHistory(h);
	h.$("historyDropdown").querySelectorAll("button").find((b) => b.textContent === "저장").click();
	const X = pick(h.snapshot());
	// 상태 Y: 줄 하나 지우고 하나 체크
	rowButton(h, 2, "삭제 (휴지통으로)").click();
	const chk = h.$("row-3").querySelector("input[type=checkbox]");
	chk.checked = true;
	h.change(chk);
	const Y = pick(h.snapshot());
	assert.notDeepEqual(Y, X);
	// X로 복원
	let dd = openHistory(h);
	restoreFrom(h, dd.childNodes[0], 0);
	assert.deepEqual(pick(h.snapshot()), X, "X로 복원");
	const list = safetyList(h);
	assert.deepEqual(list.map((e) => e.label), ["히스토리 복원 전"]);
	assert.deepEqual(pick(list[0]), Y, "안전 지점 = 복원 직전 상태");
	// 드롭다운 '안전 지점'에서 되돌린다 (같은 복원 흐름)
	dd = openHistory(h);
	const safety = h.$("historySafety");
	assert.ok(safety, "#historySafety 섹션");
	assert.equal(dd.childNodes.indexOf(safety), 1, "수동저장과 자동저장 사이");
	restoreFrom(h, safety, 0);
	assert.deepEqual(pick(h.snapshot()), Y, "복원 직전 상태로 돌아왔다");
	assert.deepEqual(pick(h.fs.readJson(P.session(PROJ, A.seqId))), Y, "session.json도");
	// 두 번째 복원도 그 직전(X)을 안전 지점으로 남긴다
	assert.deepEqual(safetyList(h).map((e) => e.label), ["히스토리 복원 전", "히스토리 복원 전"]);
	assert.deepEqual(pick(safetyList(h)[0]), X);
	noErrors(h);
});

test("안전 지점은 자동저장 25개 뒤에도 남는다 (자동저장은 20개에서 잘린다)", async () => {
	const h = await boot({ files: { [P.session(PROJ, A.seqId)]: session(4) } });
	await h.dropSrt("합성.srt", srtOf(["가", "나", "다"]));
	assert.equal(safetyList(h).length, 1);
	const fwd = freezeNow(h);
	for (let i = 0; i < 25; i++) {
		// 체크를 바꿔 내용을 매번 다르게 한다 (같은 내용이면 건너뛴다)
		const id = h.snapshot().subtitles[i % 3].id;
		const c = h.$("row-" + id).querySelector("input[type=checkbox]");
		c.checked = !c.checked;
		h.change(c);
		fwd(5 * MIN + 1000);
		h.win._mogrtDebug.idleAutosaveTick();
	}
	assert.equal(autoList(h).length, 20);
	assert.ok(autoList(h).every((e) => e.label === "자동저장 (5분 무작업)"), "자동저장이 20칸을 채웠다");
	const list = safetyList(h);
	assert.deepEqual(list.map((e) => e.label), ["SRT 가져오기 전: 합성.srt"]);
	assert.equal(list[0].subtitles.length, 4);
	noErrors(h);
});

test("안전 지점은 최대 10개이고, 가장 최근 것과 내용이 같으면 새로 남기지 않는다", async () => {
	const h = await boot({ files: { [P.session(PROJ, A.seqId)]: session(2) } });
	for (let i = 0; i < 12; i++) await h.dropSrt("f" + i + ".srt", srtOf(["줄 " + i]));
	let list = safetyList(h);
	assert.equal(list.length, 10);
	assert.equal(list[0].label, "SRT 가져오기 전: f11.srt");
	assert.equal(list[0].subtitles[0].text, "줄 10");
	assert.equal(list[9].label, "SRT 가져오기 전: f2.srt");
	// 올바른 작업 파일이 아니면 목록을 바꾸지 않으므로 안전 지점도 남기지 않는다
	await h.dropWork("bad.json", { version: 2, sequenceKey: "x", subtitles: null, rowStates: {}, trashBin: [], nextId: 1 });
	assert.equal(safetyList(h)[0].label, "SRT 가져오기 전: f11.srt");
	noErrors(h);
});

test("같은 상태에서 안전 지점을 두 번 남기려 하면 하나만 남는다 (작업 불러오기를 두 번)", async () => {
	const h = await boot({ files: { [P.session(PROJ, A.seqId)]: session(3) } });
	const w = session(2, "작업 ");
	const work = Object.assign({ version: 2, savedAt: "x", sequenceKey: h.snapshot().keys.seq, trackValue: "2" }, w);
	await h.dropWork("w.json", work);
	assert.deepEqual(safetyList(h).map((e) => [e.label, e.subtitles.length]), [["작업 불러오기 전", 3]]);
	// 같은 파일을 다시 불러온다: 지금 상태(작업 2줄) → 안전 지점 하나 더
	await h.dropWork("w.json", work);
	assert.deepEqual(safetyList(h).map((e) => [e.label, e.subtitles.length]), [["작업 불러오기 전", 2], ["작업 불러오기 전", 3]]);
	// 세 번째: 지금 상태가 가장 최근 안전 지점과 같다 → 건너뛴다
	await h.dropWork("w.json", work);
	assert.equal(safetyList(h).length, 2);
	noErrors(h);
});

test("프리셋 저장이 줄을 바꾸면 '프리셋 저장 전: 이름'을 먼저 남긴다", async () => {
	const { presets } = build();
	const p3 = presets.preset_3;
	const h = await boot({
		mogrts: [{ name: p3.name, path: p3.mogrtPath }],
		params: { [p3.mogrtPath]: clone(p3.params) },
		files: { [P.presets(PROJ)]: { presets: { preset_3: p3 }, presetTrash: [], nextPresetId: 4 }, [P.session(PROJ, A.seqId)]: session(2, "프리셋 줄 ", "preset_3") }
	});
	const before = pick(h.snapshot());
	h.$("presetList").querySelectorAll("button").find((b) => b.textContent === "편집").click();
	await h.flush();
	await h.advance(10);
	h.$("presetNameInput").value = "고친 이름";
	h.$("btnSaveDefault").click();
	assert.equal(h.$("confirmModal").classList.contains("open"), true, "사용 중 확인");
	h.$("confirmYes").click();
	const list = safetyList(h);
	assert.deepEqual(list.map((e) => e.label), ["프리셋 저장 전: 고친 이름"]);
	assert.deepEqual(pick(list[0]), before);
	noErrors(h);
});

test("프리셋 가져오기가 줄의 연결을 끊을 때만 '프리셋 가져오기 전'을 남긴다", async () => {
	const { presets } = build();
	const file = { presets: { preset_1: presets.preset_1, preset_3: presets.preset_3 }, presetTrash: [], nextPresetId: 4 };
	const mogrts = [presets.preset_1, presets.preset_3].map((p) => ({ name: p.name, path: p.mogrtPath })).concat([{ name: "다른", path: "D:/MOGRT/다른.mogrt" }]);
	const sess = session(3);
	sess.rowStates[1].presetId = "preset_1";
	sess.rowStates[2].presetId = "preset_3";
	const h = await boot({ mogrts, files: { [P.presets(PROJ)]: file, [P.session(PROJ, A.seqId)]: sess } });
	const importIt = async (obj) => {
		const origCreate = h.doc.createElement.bind(h.doc);
		let input = null;
		h.doc.createElement = (tag) => {
			const el = origCreate(tag);
			if (String(tag).toLowerCase() === "input") { input = el; el.click = () => {}; }
			return el;
		};
		try { h.$("btnImportPresets").click(); } finally { h.doc.createElement = origCreate; }
		const text = JSON.stringify(obj);
		input.files = [{ name: "presets.json", _text: text, size: text.length }];
		h.change(input);
		await h.flush();
		if (h.$("confirmModal").classList.contains("open")) h.$("confirmYes").click();
		await h.flush();
	};
	// 같은 파일 → 끊기는 줄 없음 → 안전 지점 없음
	await importIt({ version: 1, presets: clone(file.presets) });
	assert.equal(h.fs.files.has(P.historySafety(PROJ, A.seqId)), false);
	const before = pick(h.snapshot());
	// preset_3이 다른 MOGRT → 줄 2가 끊긴다
	const other = clone(file.presets);
	other.preset_3.mogrtPath = "D:/MOGRT/다른.mogrt";
	await importIt({ version: 1, presets: other });
	const list = safetyList(h);
	assert.deepEqual(list.map((e) => e.label), ["프리셋 가져오기 전"]);
	assert.deepEqual(pick(list[0]), before, "끊기기 전 presetId");
	assert.equal(list[0].rowStates[2].presetId, "preset_3");
	assert.equal(h.snapshot().rowStates[2].presetId, "");
	const imported3 = Object.keys(h.snapshot().presets).find((id) => h.snapshot().presets[id].mogrtPath === "D:/MOGRT/다른.mogrt");
	// 그 안전 지점을 복원하면 옛 preset_3이 프리셋 휴지통에서 되살아나고 줄 2가 다시 이어진다
	openHistory(h);
	restoreFrom(h, h.$("historySafety"), 0);
	const s = h.snapshot();
	assert.equal(s.rowStates[2].presetId, "preset_3");
	assert.equal(s.presets.preset_3.mogrtPath, file.presets.preset_3.mogrtPath, "옛 MOGRT의 preset_3");
	assert.ok(s.presets[imported3], "가져온 프리셋은 그대로");
	assert.equal(s.presetTrash.some((t) => t.preset.id === "preset_3"), false, "휴지통에서 빠졌다");
	assert.equal(h.$("sel-2").value, "preset_3", "행 select");
	assert.equal(h.fs.readJson(P.session(PROJ, A.seqId)).rowStates[2].presetId, "preset_3", "session.json");
	assert.ok(h.fs.readJson(P.presets(PROJ)).presets.preset_3, "presets.json");
	assert.match(h.status().text, /히스토리 복원: 3개 · 프리셋 1개를 프리셋 휴지통에서 되살렸습니다/);
	noErrors(h);
});

test("프리셋 삭제는 그 프리셋을 쓰는 줄이 있을 때 '프리셋 삭제 전: 이름'을 남기고, 복원하면 줄의 값과 프리셋이 돌아온다", async () => {
	const { presets } = build();
	const p3 = presets.preset_3;
	const p6 = presets.preset_6;
	const sess = session(3);
	[1, 2].forEach((i) => {
		const all = clone(p3.params);
		all[2].value = "후반 작업 " + i;
		sess.rowStates[i] = { presetId: "preset_3", params: [clone(all[1]), clone(all[2])], _allParams: all, open: false, checked: false };
	});
	const h = await boot({ files: { [P.presets(PROJ)]: { presets: { preset_3: p3, preset_6: p6 }, presetTrash: [], nextPresetId: 7 }, [P.session(PROJ, A.seqId)]: sess } });
	const delOf = (name) => {
		const btn = h.$("presetList").querySelectorAll("button").filter((b) => b.textContent === "삭제")
			.find((b) => { let el = b; while (el && el.textContent.indexOf(name) === -1) el = el.parentNode; return !!el && el !== h.$("presetList"); });
		assert.ok(btn, "삭제 버튼 " + name);
		btn.click();
		h.$("confirmYes").click();
	};
	// 쓰는 줄이 없는 프리셋 → 안전 지점 없음
	delOf(p6.name);
	assert.equal(h.fs.files.has(P.historySafety(PROJ, A.seqId)), false);
	const before = pick(h.snapshot());
	delOf(p3.name);
	assert.equal(h.snapshot().rowStates[1]._allParams.length, 0, "삭제가 줄의 값을 비웠다");
	assert.deepEqual(safetyList(h).map((e) => e.label), ["프리셋 삭제 전: " + p3.name]);
	assert.deepEqual(pick(safetyList(h)[0]), before);
	openHistory(h);
	restoreFrom(h, h.$("historySafety"), 0);
	const s = h.snapshot();
	assert.deepEqual(pick(s), before, "줄의 프리셋·후반 작업 값이 돌아왔다");
	assert.ok(s.presets.preset_3, "preset_3이 휴지통에서 되살아났다");
	assert.equal(s.presets.preset_6, undefined, "쓰지 않는 프리셋은 휴지통에 그대로");
	assert.deepEqual(s.presetTrash.map((t) => t.preset.id), ["preset_6"]);
	noErrors(h);
});

test("휴지통 비우기는 먼저 '휴지통 비우기 전'을 남기고, 복원하면 휴지통의 줄이 돌아온다", async () => {
	const h = await boot({ files: { [P.session(PROJ, A.seqId)]: session(3) } });
	// 빈 휴지통을 비우면 남기지 않는다
	h.$("btnEmptyTrash").click();
	assert.equal(h.fs.files.has(P.historySafety(PROJ, A.seqId)), false);
	rowButton(h, 2, "삭제 (휴지통으로)").click();
	const before = pick(h.snapshot());
	assert.equal(before.trashBin.length, 1);
	h.$("btnEmptyTrash").click();
	assert.equal(h.snapshot().trashBin.length, 0);
	assert.deepEqual(safetyList(h).map((e) => e.label), ["휴지통 비우기 전"]);
	openHistory(h);
	restoreFrom(h, h.$("historySafety"), 0);
	assert.deepEqual(pick(h.snapshot()), before);
	noErrors(h);
});

test("체크한 여러 줄의 프리셋을 한꺼번에 바꾸면 '프리셋 일괄 적용 전'을 남긴다 (잃을 값이 있을 때만)", async () => {
	const { presets } = build();
	const p3 = presets.preset_3;
	const p6 = presets.preset_6;
	const sess = session(3);
	[1, 2].forEach((i) => {
		const all = clone(p3.params);
		all[2].value = "후반 작업 " + i;
		sess.rowStates[i] = { presetId: "preset_3", params: [clone(all[1]), clone(all[2])], _allParams: all, open: false, checked: true };
	});
	const h = await boot({ files: { [P.presets(PROJ)]: { presets: { preset_3: p3, preset_6: p6 }, presetTrash: [], nextPresetId: 7 }, [P.session(PROJ, A.seqId)]: sess } });
	// 체크하지 않은 줄 하나만 바꾸면 남기지 않는다 (한 줄 선택은 v27 그대로)
	h.$("sel-3").value = "preset_6";
	h.change(h.$("sel-3"));
	await h.flush();
	assert.equal(h.fs.files.has(P.historySafety(PROJ, A.seqId)), false);
	const before = pick(h.snapshot());
	h.$("sel-1").value = "preset_6";
	h.change(h.$("sel-1"));
	await h.flush();
	const s = h.snapshot();
	assert.deepEqual([s.rowStates[1].presetId, s.rowStates[2].presetId], ["preset_6", "preset_6"]);
	assert.equal(JSON.stringify(s.rowStates).indexOf("후반 작업"), -1, "일괄 적용이 후반 작업 값을 덮었다");
	assert.deepEqual(safetyList(h).map((e) => e.label), ["프리셋 일괄 적용 전"]);
	assert.deepEqual(pick(safetyList(h)[0]), before);
	openHistory(h);
	restoreFrom(h, h.$("historySafety"), 0);
	assert.deepEqual(pick(h.snapshot()), before, "후반 작업 값이 돌아왔다");
	noErrors(h);
});

test("안전 지점 섹션: 비어 있으면 '안전 지점 없음', × 삭제는 그 목록에서만", async () => {
	const h = await boot({ files: { [P.session(PROJ, A.seqId)]: session(2) } });
	openHistory(h);
	assert.match(h.$("historySafety").textContent, /안전 지점\s*0\/10/);
	assert.match(h.$("historySafety").textContent, /안전 지점 없음/);
	await h.dropSrt("a.srt", srtOf(["가"]));
	await h.dropSrt("b.srt", srtOf(["나"]));
	openHistory(h);
	h.$("btnHistory").click(); // 닫고
	openHistory(h); // 다시 연다 (새로 그린다)
	const items = h.$("historySafety").querySelectorAll(".history-item");
	assert.equal(items.length, 2);
	assert.equal(h.$("btnHistory").classList.contains("has-history"), true);
	items[1].querySelectorAll("button").find((b) => b.textContent === "×").click();
	assert.deepEqual(safetyList(h).map((e) => e.label), ["SRT 가져오기 전: b.srt"]);
	assert.deepEqual(autoList(h).map((e) => e.label), ["SRT 로드: b.srt", "SRT 로드: a.srt"], "자동저장은 그대로");
	noErrors(h);
});

test("드롭다운을 연 사이 밀려나 이미 없는 항목의 ×는 아무것도 지우지 않는다 (그 자리의 다른 항목을 지우지 않는다)", async () => {
	const auto = [];
	for (let i = 0; i < 20; i++) {
		const e = session(1, "v" + i + " ");
		auto.push(Object.assign({ ts: 1000 + (20 - i), label: "E" + i, isManual: false, sequenceKey: "x", trackValue: "2" }, e));
	}
	const h = await boot({ files: { [P.session(PROJ, A.seqId)]: session(1), [P.historyAuto(PROJ, A.seqId)]: auto } });
	openHistory(h);
	const items = h.$("historyDropdown").childNodes[2].querySelectorAll(".history-item");
	assert.equal(items.length, 20);
	// 드롭다운이 열린 채 5분 무작업 자동저장이 E19를 밀어낸다
	const fwd = freezeNow(h);
	fwd(6 * MIN);
	h.win._mogrtDebug.idleAutosaveTick();
	const labels = () => autoList(h).map((e) => e.label);
	assert.deepEqual(labels().slice(-2), ["E17", "E18"]);
	// 낡은 E19 항목의 ×
	items[19].querySelectorAll("button").find((b) => b.textContent === "×").click();
	assert.deepEqual(labels().slice(-2), ["E17", "E18"], "E18을 지우지 않았다");
	assert.equal(autoList(h).length, 20);
	assert.match(h.status().text, /이미 없는 항목입니다/);
	// 새로 그린 목록에서는 그대로 지워진다
	const fresh = h.$("historyDropdown").childNodes[2].querySelectorAll(".history-item");
	fresh[20 - 1].querySelectorAll("button").find((b) => b.textContent === "×").click();
	assert.deepEqual(labels().slice(-2), ["E16", "E17"]);
	noErrors(h);
});

test("키가 정해지기 전과 세션 파일을 읽지 못한 키에서는 안전 지점을 쓰지 않는다", async () => {
	const badSeq = { seqId: "bbbb-0002", seqName: "T_B", projPath: PROJ };
	const h = await boot({ files: { [P.session(PROJ, A.seqId)]: session(2), [P.session(PROJ, badSeq.seqId)]: "{ 깨진" } });
	h.host.seq = badSeq;
	await h.advance(300);
	assert.equal(h.snapshot().flags.sessionReadFailed, true);
	const work = Object.assign({ version: 2, savedAt: "x", sequenceKey: "x", trackValue: "2" }, session(1, "작업 "));
	await h.dropWork("w.json", work);
	assert.equal(h.fs.files.has(P.historySafety(PROJ, badSeq.seqId)), false);
	noErrors(h);
});
