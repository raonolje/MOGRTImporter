"use strict";
// S1-5: mi 블록·cast.json·id/salt 안전·runCommand — panelHarness로 app.js 전체를 돌린다
const test = require("node:test");
const assert = require("node:assert/strict");
const { bootPanel, cachePaths: P } = require("../lib/panelHarness");
const { regionHash } = require("../lib/loadRegions");
const { build } = require("../fixtures/presets_synth");

const PROJ = "C:/work/mi.prproj";
const PROJ2 = "C:/work/mi_saveas.prproj";
const A = { seqId: "aaaa-0001", seqName: "T_A", projPath: PROJ };
const B = { seqId: "bbbb-0002", seqName: "T_B", projPath: PROJ };
const C = { seqId: "cccc-0003", seqName: "T_C", projPath: PROJ };
const DEFAULT_MI = { v: 1, salt: "", hwm: 0, legacyTrack: null, remapped: false, castOrder: [], cast: {}, stack: false, stackDy: 0.12, applied: {} };
const DOT = String.fromCharCode(0xb7);
const clone = (v) => JSON.parse(JSON.stringify(v));

function sub(id, index, text, spk) {
	const tc = (x) => "00:00:" + String(Math.floor(x)).padStart(2, "0") + ".000";
	const s = { index, startTime: tc(index * 2), endTime: tc(index * 2 + 1), startSec: index * 2, endSec: index * 2 + 1, text, id };
	if (spk) { s.spk = spk; s.srtNo = index; }
	return s;
}
function rsOf(presetId) {
	return { presetId: presetId || "", params: [], _allParams: [], open: false, checked: false };
}
function session(rows, extra) {
	const rowStates = {};
	rows.forEach((r) => { rowStates[r.id] = rsOf(); });
	return Object.assign({ subtitles: rows, rowStates, trashBin: [], nextId: rows.length ? Math.max(...rows.map((r) => r.id)) + 1 : 1 }, extra || {});
}
function miBlock(extra) {
	return Object.assign({
		v: 1, salt: "k7q2", hwm: 64, legacyTrack: null, remapped: false, castOrder: ["C1", "C2"],
		cast: { C1: { name: "철수", track: null, autoTrack: 2, presetId: "", color: 0, file: "인터뷰_C1.srt", path: null, size: 10, mtime: null, pos: null },
			C2: { name: "영희", track: 3, autoTrack: null, presetId: "", color: 1, file: "인터뷰_C2.srt", path: null, size: 12, mtime: null, pos: null } },
		stack: false, stackDy: 0.12,
		applied: { "k7q2-57": { g: 1, m: "C:/x.mogrt", ls: "5b1f0e2d", h: "a91f03c2", fh: { 0: "1c2d99e0" }, rh: "5d20e7aa", k: "ae" } }
	}, extra || {});
}
function castSession() {
	return session([sub(57, 1, "철수 하나", "C1"), sub(58, 2, "영희 하나", "C2"), sub(59, 3, "철수 둘", "C1")], { nextId: 65, mi: miBlock() });
}
function noErrors(h) {
	assert.deepEqual(h.errors().map((e) => String(e.message || e).slice(0, 300)), [], "패널 예외");
}
async function boot(opts) {
	const h = await bootPanel(Object.assign({ seq: A }, opts || {}));
	await h.advance(1000);
	return h;
}
async function switchTo(h, seq) {
	h.host.seq = seq;
	await h.advance(300);
	assert.equal(h.snapshot().keys.seqId, seq.seqId);
}
// 결과를 이 realm의 값으로 (vm 객체는 deepStrictEqual이 프로토타입 때문에 실패한다)
const cmd = async (h, op, args) => JSON.parse(JSON.stringify(await h.win._mogrtDebug.cmd(op, args)));

// ── 저장 형식 ──

test("단일 화자 세션: 불러오고 저장해도 JSON이 같고 키 4개 (mi 없음), SRT 로드 뒤에도 mi를 쓰지 않는다", async () => {
	const { presets } = build();
	const p3 = presets.preset_3;
	const sess = session([sub(1, 1, "하나"), sub(2, 2, "둘")]);
	sess.rowStates[1] = { presetId: "preset_3", params: [clone(p3.params[0])], _allParams: clone(p3.params), open: false, checked: false };
	const orig = clone(sess);
	const h = await boot({ files: { [P.presets(PROJ)]: { presets: { preset_3: p3 }, presetTrash: [], nextPresetId: 4 }, [P.session(PROJ, A.seqId)]: sess } });
	// 속성창 토글(열기·닫기) → 저장 두 번
	const txt = h.$("row-1").querySelector(".sub-text");
	txt.click();
	txt.click();
	h.win._mogrtDebug.saveSession();
	const saved = h.fs.readJson(P.session(PROJ, A.seqId));
	assert.deepEqual(Object.keys(saved), ["subtitles", "rowStates", "trashBin", "nextId"]);
	assert.deepEqual(saved, orig);
	assert.deepEqual(h.snapshot().mi, DEFAULT_MI);
	// SRT 로드: id를 줄 때 hwm이 메모리에서 오르지만 파일에는 여전히 키 4개
	// (프리셋이 걸린 줄이 있어 병합/교체를 묻는다 → v27 교체, S1-9)
	await h.dropSrt("새.srt", "1\n00:00:01,000 --> 00:00:02,000\n가\n\n2\n00:00:03,000 --> 00:00:04,000\n나\n");
	assert.equal(h.$("confirmAlt").textContent, "교체 (지금까지 방식)");
	h.$("confirmAlt").click();
	await h.flush();
	const s = h.snapshot();
	assert.deepEqual(s.subtitles.map((x) => x.id), [3, 4]);
	assert.equal(s.mi.hwm, 4);
	assert.deepEqual(Object.keys(h.fs.readJson(P.session(PROJ, A.seqId))), ["subtitles", "rowStates", "trashBin", "nextId"]);
	assert.equal(h.fs.files.has(P.cast(PROJ, A.seqId)), false, "cast.json을 만들지 않는다");
	const hist = h.fs.readJson(P.historyAuto(PROJ, A.seqId));
	assert.equal(hist[0].mi, undefined, "히스토리 항목에도 mi가 없다");
	noErrors(h);
});

test("mi가 있는 파일: salt·hwm·applied를 그대로 읽고, 다시 써도 같으며 cast.json을 맞춘다", async () => {
	const sess = castSession();
	const h = await boot({ files: { [P.session(PROJ, A.seqId)]: sess } });
	const s = h.snapshot();
	assert.deepEqual(s.mi, miBlock());
	h.win._mogrtDebug.saveSession();
	assert.deepEqual(h.fs.readJson(P.session(PROJ, A.seqId)), sess, "왕복");
	const side = h.fs.readJson(P.cast(PROJ, A.seqId));
	assert.deepEqual(Object.keys(side), ["v", "savedAt", "salt", "hwm", "legacyTrack", "castOrder", "cast", "stack", "stackDy"]);
	assert.deepEqual([side.salt, side.hwm, side.castOrder], ["k7q2", 64, ["C1", "C2"]]);
	assert.deepEqual(side.cast, miBlock().cast);
	assert.equal(side.applied, undefined, "applied는 사이드카에 없다");
	// 내용이 같으면 다시 쓰지 않는다
	const n = h.fs.writes.filter((p) => /cast\.json$/.test(p)).length;
	h.win._mogrtDebug.saveSession();
	assert.equal(h.fs.writes.filter((p) => /cast\.json$/.test(p)).length, n);
	noErrors(h);
});

test("mi가 있는 시퀀스에서 mi 없는·파일 없는 시퀀스로 가면 miDefault (누수 없음), 그 파일에 mi를 쓰지 않는다", async () => {
	const bSess = session([sub(1, 1, "B 줄")]);
	const h = await boot({ files: { [P.session(PROJ, A.seqId)]: castSession(), [P.session(PROJ, B.seqId)]: clone(bSess) } });
	assert.equal(h.snapshot().mi.salt, "k7q2");
	await switchTo(h, B);
	assert.deepEqual(h.snapshot().mi, DEFAULT_MI);
	const chk = h.$("row-1").querySelector("input[type=checkbox]");
	chk.checked = true;
	h.change(chk);
	h.win._mogrtDebug.saveSession();
	const bFile = h.fs.readJson(P.session(PROJ, B.seqId));
	assert.equal(bFile.mi, undefined);
	assert.deepEqual(Object.keys(bFile), ["subtitles", "rowStates", "trashBin", "nextId"]);
	await switchTo(h, C);
	assert.deepEqual(h.snapshot().mi, DEFAULT_MI, "파일 없는 키");
	assert.equal(h.fs.files.has(P.session(PROJ, C.seqId)), false);
	await switchTo(h, A);
	assert.equal(h.snapshot().mi.salt, "k7q2", "돌아오면 다시 읽는다");
	noErrors(h);
});

test("v27이 mi를 버리고 저장한 세션 + cast.json: spk 줄 id ≤ hwm이면 화자 표·salt를 되살리고, 넘으면 무시한다", async () => {
	const v27 = castSession();
	delete v27.mi;
	const side = Object.assign({ v: 1, savedAt: "2026-09-25T00:00:00Z" }, clone(miBlock()));
	delete side.applied;
	delete side.remapped;
	let h = await boot({ files: { [P.session(PROJ, A.seqId)]: clone(v27), [P.cast(PROJ, A.seqId)]: side } });
	let mi = h.snapshot().mi;
	assert.deepEqual([mi.salt, mi.hwm, mi.castOrder, mi.applied, mi.remapped], ["k7q2", 64, ["C1", "C2"], {}, false]);
	assert.deepEqual(mi.cast, miBlock().cast);
	assert.equal(mi.savedAt, undefined);
	// 저장하면 mi가 session.json에 다시 들어간다
	h.win._mogrtDebug.saveSession();
	assert.equal(h.fs.readJson(P.session(PROJ, A.seqId)).mi.salt, "k7q2");
	noErrors(h);
	// spk 줄 id가 hwm보다 크면 낡은 사이드카
	const stale = clone(v27);
	stale.subtitles[2].id = 65;
	stale.rowStates = { 57: rsOf(), 58: rsOf(), 65: rsOf() };
	stale.nextId = 66;
	h = await boot({ files: { [P.session(PROJ, A.seqId)]: stale, [P.cast(PROJ, A.seqId)]: side } });
	assert.deepEqual(h.snapshot().mi, DEFAULT_MI);
	noErrors(h);
});

test("cast.json에서 되살린 hwm이 파일의 nextId보다 크면 nextId를 hwm 위로 올린다 (다음 SRT가 쓴 id를 다시 받지 않는다)", async () => {
	// v27 복원·작업 불러오기가 nextId를 내리고 mi 없이 저장한 모양: spk 줄 57·58, nextId 59, cast.json hwm 64
	const v27 = session([sub(57, 1, "철수 하나", "C1"), sub(58, 2, "영희 하나", "C2")], { nextId: 59 });
	const side = Object.assign({ v: 1, savedAt: "2026-09-25T00:00:00Z" }, clone(miBlock()));
	delete side.applied;
	delete side.remapped;
	const h = await boot({ files: { [P.session(PROJ, A.seqId)]: v27, [P.cast(PROJ, A.seqId)]: side } });
	let s = h.snapshot();
	assert.deepEqual([s.mi.salt, s.mi.hwm, s.nextId], ["k7q2", 64, 65]);
	await h.dropSrt("새.srt", "1\n00:00:01,000 --> 00:00:02,000\n가\n");
	s = h.snapshot();
	assert.ok(s.subtitles.every((x) => x.id > 64), "새 id " + JSON.stringify(s.subtitles.map((x) => x.id)));
	noErrors(h);
});

test("타입이 틀린 session.json(trashBin·subtitles가 객체)으로 가도 이전 시퀀스의 mi·nextId가 새지 않는다", async () => {
	const bSess = session([sub(1, 1, "B 줄")]);
	bSess.trashBin = {};
	const cSess = { subtitles: {}, rowStates: {}, trashBin: [], nextId: 4 };
	const h = await boot({ files: { [P.session(PROJ, A.seqId)]: castSession(), [P.session(PROJ, B.seqId)]: clone(bSess), [P.session(PROJ, C.seqId)]: clone(cSess) } });
	assert.equal(h.snapshot().mi.salt, "k7q2");
	await switchTo(h, B);
	let s = h.snapshot();
	assert.deepEqual(s.mi, DEFAULT_MI);
	assert.deepEqual([s.subtitles.length, s.trashBin, s.nextId], [1, [], 2]);
	h.win._mogrtDebug.saveSession();
	const bFile = h.fs.readJson(P.session(PROJ, B.seqId));
	assert.equal(bFile.mi, undefined, "B에 A의 mi를 쓰지 않는다");
	assert.equal(h.fs.files.has(P.cast(PROJ, B.seqId)), false, "B의 cast.json을 만들지 않는다");
	await switchTo(h, A);
	await switchTo(h, C);
	s = h.snapshot();
	assert.deepEqual([s.mi, s.subtitles, s.nextId], [DEFAULT_MI, [], 4]);
	noErrors(h);
});

// ── 히스토리 ──

test("히스토리: 화자 표가 있으면 항목에 mi 스냅숏(salt·hwm·applied 제외), 복원은 salt를 지키고 nextId를 내리지 않는다", async () => {
	const h = await boot({ files: { [P.session(PROJ, A.seqId)]: castSession() } });
	h.$("btnHistory").click();
	h.$("historyDropdown").querySelectorAll("button").find((b) => b.textContent === "저장").click();
	const entry = h.fs.readJson(P.historyManual(PROJ, A.seqId))[0];
	assert.deepEqual(Object.keys(entry.mi).sort(), ["cast", "castOrder", "legacyTrack", "stack", "stackDy"]);
	// 다른 salt·화자 표·낮은 nextId를 가진 항목을 복원한다
	const other = clone(entry);
	other.label = "다른 기록";
	other.mi = { cast: { C3: { name: "민수" } }, castOrder: ["C3"], stack: true, stackDy: 0.2, legacyTrack: 1 };
	other.nextId = 2;
	delete other.hash;
	h.fs.files.set(P.historyManual(PROJ, A.seqId), JSON.stringify([other]));
	h.$("btnHistory").click();
	if (!h.$("historyDropdown").classList.contains("open")) h.$("btnHistory").click();
	h.$("historyDropdown").querySelector(".history-item").childNodes[0].click();
	h.$("confirmYes").click();
	const s = h.snapshot();
	assert.deepEqual([s.mi.salt, s.mi.hwm], ["k7q2", 64], "salt·hwm은 지금 값");
	assert.deepEqual(s.mi.applied, miBlock().applied, "applied도 지금 값");
	assert.deepEqual([s.mi.castOrder, s.mi.stack, s.mi.legacyTrack], [["C3"], true, 1]);
	assert.equal(s.nextId, 65, "nextId를 내리지 않는다");
	assert.deepEqual(h.fs.readJson(P.cast(PROJ, A.seqId)).castOrder, ["C3"], "cast.json도 따라간다");
	noErrors(h);
});

test("히스토리: mi 없는 항목(단일 화자)을 복원하면 화자 표가 비고 salt는 남는다", async () => {
	const single = { ts: 1, label: "단일", isManual: false, sequenceKey: "x", subtitles: [sub(3, 1, "단일 줄")], rowStates: { 3: rsOf() }, trashBin: [], nextId: 4, trackValue: "2" };
	const h = await boot({ files: { [P.session(PROJ, A.seqId)]: castSession(), [P.historyAuto(PROJ, A.seqId)]: [single] } });
	h.$("btnHistory").click();
	h.$("historySafety").parentNode.childNodes[2].querySelector(".history-item").childNodes[0].click();
	h.$("confirmYes").click();
	const s = h.snapshot();
	assert.deepEqual([s.mi.salt, s.mi.castOrder, s.mi.cast], ["k7q2", [], {}]);
	assert.equal(s.nextId, 65);
	noErrors(h);
});

// ── 작업 파일 ──

function workOf(seqKey, sess, mi) {
	const w = Object.assign({ version: 2, savedAt: "2026-09-25T00:00:00Z", sequenceKey: seqKey }, clone(sess), { trackValue: "2" });
	if (mi) w.mi = mi;
	return w;
}

test("작업 파일: 다른 GUID → hwm 위로 id를 다시 매기고 rowStates 키도 바뀌며 remapped, salt는 받지 않는다", async () => {
	const h = await boot({ files: { [P.session(PROJ, A.seqId)]: castSession() } });
	const src = session([sub(1, 1, "다른 하나", "C1"), sub(2, 2, "다른 둘", "C2")]);
	src.rowStates[2].checked = true;
	src.trashBin = [{ sub: sub(3, 3, "다른 휴지통", "C1"), state: rsOf(), position: 2 }];
	src.nextId = 4;
	const work = workOf("proj_other_seq_zzzz-9999", src, Object.assign(clone(miBlock({ salt: "zzzz" })), { hwm: undefined }));
	await h.dropWork("다른 시퀀스.json", work);
	const s = h.snapshot();
	assert.deepEqual(s.subtitles.map((x) => [x.id, x.text]), [[65, "다른 하나"], [66, "다른 둘"]], "hwm(64) 위에서 시작");
	assert.deepEqual(Object.keys(s.rowStates).sort(), ["65", "66"]);
	assert.equal(s.rowStates[66].checked, true, "rowStates가 새 id를 따라간다");
	assert.deepEqual(s.trashBin.map((t) => t.sub.id), [67]);
	assert.equal(s.nextId, 68);
	assert.equal(s.mi.hwm, 67);
	assert.equal(s.mi.remapped, true);
	assert.equal(s.mi.salt, "k7q2", "salt는 받지 않는다");
	assert.deepEqual(s.mi.applied, miBlock().applied);
	const saved = h.fs.readJson(P.session(PROJ, A.seqId));
	assert.equal(saved.mi.remapped, true);
	noErrors(h);
});

test("작업 파일: 같은 GUID(다른 projKey, 'Save As') → id 유지, 지금 salt가 비었으면 파일의 salt를 받는다", async () => {
	const h = await boot({ files: { [P.session(PROJ, A.seqId)]: session([sub(1, 1, "지금 줄")]) } });
	const src = castSession();
	const miSnap = { cast: clone(miBlock().cast), castOrder: ["C1", "C2"], stack: false, stackDy: 0.12, legacyTrack: null, salt: "k7q2" };
	const saveAsKey = h.projKeyOf(PROJ2) + "_seq_" + A.seqId;
	await h.dropWork("save-as.json", workOf(saveAsKey, src, miSnap));
	let s = h.snapshot();
	assert.deepEqual(s.subtitles.map((x) => x.id), [57, 58, 59], "id 유지");
	assert.equal(s.nextId, 65);
	assert.equal(s.mi.salt, "k7q2", "비어 있던 salt를 받는다");
	assert.deepEqual(s.mi.castOrder, ["C1", "C2"]);
	assert.equal(s.mi.remapped, false);
	assert.equal(s.mi.hwm, 64);
	assert.equal(h.fs.readJson(P.cast(PROJ, A.seqId)).salt, "k7q2", "salt가 생기면 cast.json");
	// 지금 salt가 있으면 파일의 다른 salt를 받지 않는다
	await h.dropWork("save-as2.json", workOf(saveAsKey, src, Object.assign({}, miSnap, { salt: "zzzz" })));
	s = h.snapshot();
	assert.equal(s.mi.salt, "k7q2");
	noErrors(h);
});

test("작업 저장: 단일 화자는 v27 모양(mi 없음), 화자 표가 있으면 mi(salt 포함, hwm·applied 없음)", async () => {
	let h = await boot({ files: { [P.session(PROJ, A.seqId)]: session([sub(1, 1, "단일")]) } });
	h.$("btnSaveWork").click();
	await h.flush();
	let w = JSON.parse(h.host.savedFiles[0].content);
	assert.deepEqual(Object.keys(w), ["version", "savedAt", "sequenceKey", "subtitles", "rowStates", "trashBin", "nextId", "trackValue"]);
	noErrors(h);
	h = await boot({ files: { [P.session(PROJ, A.seqId)]: castSession() } });
	h.$("btnSaveWork").click();
	await h.flush();
	w = JSON.parse(h.host.savedFiles[0].content);
	assert.deepEqual(Object.keys(w.mi).sort(), ["cast", "castOrder", "legacyTrack", "salt", "stack", "stackDy"]);
	assert.equal(w.mi.salt, "k7q2");
	noErrors(h);
});

test("새 프리셋 id는 화자 표(mi.cast)가 가리키는 id도 피한다", async () => {
	const { presets } = build();
	const p3 = presets.preset_3;
	const sess = castSession();
	sess.mi.cast.C2.presetId = "preset_12";
	const path = "D:/MOGRT/새 템플릿.mogrt";
	const h = await boot({
		mogrts: [{ name: "새 템플릿", path }],
		params: { [path]: clone(p3.params) },
		files: { [P.presets(PROJ)]: { presets: { preset_3: p3 }, presetTrash: [], nextPresetId: 4 }, [P.session(PROJ, A.seqId)]: sess }
	});
	h.$("btnAddPreset").click();
	await h.flush();
	h.$("defaultMogrtSel").value = path;
	h.change(h.$("defaultMogrtSel"));
	await h.advance(10);
	h.$("presetNameInput").value = "새 프리셋";
	h.$("btnSaveDefault").click();
	const s = h.snapshot();
	assert.equal(Object.keys(s.presets).find((id) => s.presets[id].name === "새 프리셋"), "preset_13");
	noErrors(h);
});

// ── runCommand ──

test("runCommand: 모르는 명령·잘못된 인자는 bad-args, 결과는 {ok, data}", async () => {
	const h = await boot();
	assert.deepEqual(await cmd(h, "nope", {}), { ok: false, error: "bad-args", detail: "모르는 명령: nope" });
	assert.equal((await cmd(h, "rows", [])).error, "bad-args");
	assert.equal((await cmd(h, "rows", { filter: "x" })).error, "bad-args");
	assert.equal((await cmd(h, "rows", { count: 201 })).error, "bad-args");
	assert.equal((await cmd(h, "resolve", { label: "열두 번째" })).error, "bad-args");
	assert.equal((await cmd(h, "resolve", { label: "#1" })).error, "not-found");
	assert.equal((await cmd(h, "status")).ok, true, "args 없이도 된다");
	noErrors(h);
});

test("runCommand status: 키·시퀀스·줄 수·화자·coreHash(= 설치된 app.js core region 해시)", async () => {
	const h = await boot({ files: { [P.session(PROJ, A.seqId)]: castSession() } });
	const r = await cmd(h, "status", {});
	assert.equal(r.ok, true);
	const d = r.data;
	assert.deepEqual(d.seq, { id: A.seqId, name: "T_A" });
	assert.equal(d.seqKey, h.snapshot().keys.seq);
	assert.equal(d.rows, 3);
	assert.equal(d.castMode, true);
	assert.deepEqual(d.speakers, [{ key: "C1", name: "철수", track: null, presetId: "", count: 2 }, { key: "C2", name: "영희", track: 3, presetId: "", count: 1 }]);
	assert.equal(d.busy, false);
	assert.equal(d.coreHash, regionHash("src/mi/core.ts"));
	assert.deepEqual(d.panel, { v: 28, build: null });
	noErrors(h);
});

test("runCommand rows·resolve: '#12'는 index 12인 줄의 uid와 문장, 필드 주소, 다화자 라벨", async () => {
	const { presets } = build();
	const p3 = presets.preset_3;
	const rows = [];
	for (let i = 1; i <= 14; i++) rows.push(sub(100 + i, i, "합성 문장 " + i));
	const sess = session(rows);
	const all = clone(p3.params);
	all[1].value = "합성 문장 12";
	all[2].value = "문장";
	sess.rowStates[112] = { presetId: "preset_3", params: [all[1], all[2]], _allParams: all, open: false, checked: false, mm: "text" };
	const h = await boot({ files: { [P.presets(PROJ)]: { presets: { preset_3: p3 }, presetTrash: [], nextPresetId: 4 }, [P.session(PROJ, A.seqId)]: sess } });
	let r = await cmd(h, "resolve", { label: "#12" });
	assert.equal(r.ok, true);
	assert.deepEqual([r.data.uid, r.data.id, r.data.label, r.data.text, r.data.captionFid], ["112", 112, "#12", "합성 문장 12", "T1"]);
	assert.deepEqual(r.data.fields, { T1: "합성 문장 12", T2: "문장" });
	assert.equal(r.data.sig, "T1=텍스트|T2=포인트 텍스트");
	r = await cmd(h, "resolve", { label: "#12 T2" });
	assert.deepEqual(r.data.field, { fid: "T2", index: 2, displayName: "포인트 텍스트", value: "문장", caption: false });
	r = await cmd(h, "resolve", { label: "#12 T9" });
	assert.equal(r.data.field, null);
	// rows: 쪽 나누기와 filter
	r = await cmd(h, "rows", { from: 10, count: 3 });
	assert.deepEqual([r.data.total, r.data.from, r.data.rows.map((x) => x.label)], [14, 10, ["#11", "#12", "#13"]]);
	r = await cmd(h, "rows", { filter: "changed" });
	assert.deepEqual(r.data.rows.map((x) => x.uid), ["112"]);
	// 결과는 사본이다
	r.data.rows[0].fields.T1 = "바꿈";
	assert.equal((await cmd(h, "resolve", { label: "#12" })).data.fields.T1, "합성 문장 12");
	noErrors(h);
});

test("runCommand 다화자: 라벨 'C2·2', uid 'salt-id', 화자 없는 '#1'이 여럿이면 bad-args, cast.get·session.snapshot", async () => {
	const sess = session([sub(57, 1, "철수 하나", "C1"), sub(58, 1, "영희 하나", "C2"), sub(59, 2, "철수 둘", "C1")], { nextId: 65, mi: miBlock() });
	const h = await boot({ files: { [P.session(PROJ, A.seqId)]: sess } });
	let r = await cmd(h, "resolve", { label: "C2" + DOT + "1" });
	assert.deepEqual([r.data.uid, r.data.label, r.data.spk, r.data.text], ["k7q2-58", "C2" + DOT + "1", "C2", "영희 하나"]);
	r = await cmd(h, "resolve", { label: "#1" });
	assert.equal(r.error, "bad-args");
	assert.match(r.detail, /C1·1, C2·1/);
	r = await cmd(h, "rows", { spk: "C1" });
	assert.deepEqual(r.data.rows.map((x) => x.uid), ["k7q2-57", "k7q2-59"]);
	r = await cmd(h, "cast.get");
	assert.deepEqual(r.data, { salt: "k7q2", castOrder: ["C1", "C2"], cast: miBlock().cast, legacyTrack: null, stack: false, stackDy: 0.12, remapped: false });
	r = await cmd(h, "session.snapshot");
	assert.deepEqual(r.data.subtitles, sess.subtitles);
	assert.deepEqual(r.data.mi, miBlock());
	r.data.subtitles[0].text = "바꿈";
	assert.equal(h.snapshot().subtitles[0].text, "철수 하나", "사본");
	noErrors(h);
});

test("runCommand presets: 프리셋마다 T-ID·캡션·서명·규칙 문구", async () => {
	const { presets } = build();
	const h = await boot({ files: { [P.presets(PROJ)]: { presets: { preset_6: presets.preset_6, preset_1: presets.preset_1 }, presetTrash: [], nextPresetId: 7 } } });
	const r = await cmd(h, "presets");
	assert.deepEqual(r.data.map((p) => p.id), ["preset_1", "preset_6"]);
	assert.deepEqual(r.data[0].fields.map((f) => [f.fid, f.index, f.caption]), [["T1", 4, true], ["T2", 6, false], ["T3", 8, false]]);
	assert.equal(r.data[0].sig, "T1=전체 텍스트|T2=포인트 텍스트|T3=서브 포인트 텍스트");
	assert.equal(r.data[1].captionFid, "T1");
	assert.ok(r.data[1].notes.length > 0);
	noErrors(h);
});
