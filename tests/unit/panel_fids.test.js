"use strict";
// S1-6: T1..Tn 필드 ID 배지 (행 편집기·프리셋 모달), 주소 복사, 네이티브 필드 이름 — panelHarness로 app.js 전체를 돌린다
const test = require("node:test");
const assert = require("node:assert/strict");
const { bootPanel, cachePaths: P } = require("../lib/panelHarness");
const { build } = require("../fixtures/presets_synth");

const PROJ = "C:/work/fids.prproj";
const A = { seqId: "aaaa-0001", seqName: "T_A", projPath: PROJ };
const DOT = String.fromCharCode(0xb7);
const clone = (v) => JSON.parse(JSON.stringify(v));

function sub(id, index, text, spk) {
	const tc = (x) => "00:00:" + String(Math.floor(x)).padStart(2, "0") + ".000";
	const s = { index, startTime: tc(index * 2), endTime: tc(index * 2 + 1), startSec: index * 2, endSec: index * 2 + 1, text, id };
	if (spk) s.spk = spk;
	return s;
}
function rowOf(preset, text, open) {
	const all = clone(preset.params);
	const cap = all.find((p) => p.index === preset.textParamIndex);
	if (cap) cap.value = text;
	return { presetId: preset.id, params: all.filter((p) => preset.exposedIndices.indexOf(p.index) !== -1), _allParams: all, open: open !== false, checked: false };
}
function noErrors(h) {
	assert.deepEqual(h.errors().map((e) => String(e.message || e).slice(0, 300)), [], "패널 예외");
}
async function boot(opts) {
	const h = await bootPanel(Object.assign({ seq: A }, opts || {}));
	await h.advance(1000);
	return h;
}
const badges = (root) => root.querySelectorAll(".fid-badge").map((b) => [b.textContent, b.classList.contains("cap")]);
function presetsFile(list, extra) {
	const presets = {};
	list.forEach((p) => { presets[p.id] = p; });
	return Object.assign({ presets, presetTrash: [], nextPresetId: 10 }, extra || {});
}
async function openEdit(h, name) {
	const items = h.$("presetList").querySelectorAll(".preset-item, .preset-card, div");
	const edit = h.$("presetList").querySelectorAll("button").filter((b) => b.textContent === "편집");
	let btn = edit[0];
	if (name) {
		const hit = items.find((el) => el.querySelectorAll("button").some((b) => b.textContent === "편집") && el.textContent.indexOf(name) !== -1 && el.querySelectorAll("button").filter((b) => b.textContent === "편집").length === 1);
		if (hit) btn = hit.querySelectorAll("button").find((b) => b.textContent === "편집");
	}
	assert.ok(btn, "편집 버튼");
	btn.click();
	await h.flush();
	await h.advance(10);
}
function modalHeaderOf(h, fid) {
	const b = h.$("defaultModalBody").querySelectorAll(".fid-badge").find((x) => x.textContent === fid);
	assert.ok(b, "모달 배지 " + fid);
	return b.parentNode;
}

// ── 프리셋 모달 ──

test("프리셋 모달(preset_6): T1..T4 배지가 T 버튼과 이름 사이에 있고 T1이 초록, T를 T3으로 옮기면 초록도 옮겨 간다", async () => {
	const { presets } = build();
	const p6 = presets.preset_6;
	const h = await boot({ mogrts: [{ name: p6.name, path: p6.mogrtPath }], params: { [p6.mogrtPath]: clone(p6.params) }, files: { [P.presets(PROJ)]: presetsFile([p6]) } });
	await openEdit(h);
	const body = h.$("defaultModalBody");
	assert.deepEqual(badges(body), [["T1", true], ["T2", false], ["T3", false], ["T4", false]]);
	// 배지 자리: [노출 체크] [T] [T1] [이름] [↺]
	const hdr = modalHeaderOf(h, "T1");
	assert.deepEqual(hdr.childNodes.map((n) => n.className), ["modal-expose-chk", "modal-text-target-btn active", "fid-badge cap", "modal-mogrt-label", "modal-reset-btn"]);
	assert.equal(hdr.childNodes[3].textContent, "자막 1 텍스트");
	assert.match(body.querySelectorAll(".fid-badge")[0].title, /캡션 필드/);
	// 안내 문구
	assert.match(body.querySelector(".modal-guide").innerHTML, /<b>T1·T2…<\/b>: 위에서부터 매긴 텍스트 필드 번호 \(후반 작업·AI 지정용\)$/);
	// T3의 T 버튼 → 초록이 T3으로
	modalHeaderOf(h, "T3").querySelector(".modal-text-target-btn").click();
	assert.deepEqual(badges(body), [["T1", false], ["T2", false], ["T3", true], ["T4", false]]);
	assert.match(body.querySelectorAll(".fid-badge")[2].title, /캡션 필드/);
	assert.match(body.querySelectorAll(".fid-badge")[0].title, /텍스트 필드 T1/);
	// 같은 T를 다시 누르면 캡션 없음 → 초록 없음
	modalHeaderOf(h, "T3").querySelector(".modal-text-target-btn").click();
	assert.deepEqual(badges(body).map((b) => b[1]), [false, false, false, false]);
	noErrors(h);
});

test("프리셋 모달: 텍스트가 아닌 속성에는 배지가 없고, 텍스트 필드가 없는 프리셋(preset_4)은 배지 0개", async () => {
	const { presets } = build();
	const p1 = presets.preset_1;
	const p4 = presets.preset_4;
	const h = await boot({ mogrts: [p1, p4].map((p) => ({ name: p.name, path: p.mogrtPath })), params: { [p1.mogrtPath]: clone(p1.params), [p4.mogrtPath]: clone(p4.params) }, files: { [P.presets(PROJ)]: presetsFile([p1, p4]) } });
	await openEdit(h, p1.name);
	assert.deepEqual(badges(h.$("defaultModalBody")), [["T1", true], ["T2", false], ["T3", false]], "preset_1: 캡션 idx4 = T1");
	assert.equal(modalHeaderOf(h, "T1").querySelector(".modal-mogrt-label").textContent, "전체 텍스트");
	await openEdit(h, p4.name);
	assert.deepEqual(badges(h.$("defaultModalBody")), []);
	noErrors(h);
});

// ── 행 편집기 ──

test("행 속성창: 모달과 같은 배지(T1 초록), 라벨은 [배지][이름], 누르면 '#12 T2'를 복사하고 상태 줄에 알린다", async () => {
	const { presets } = build();
	const p6 = presets.preset_6;
	const p3 = presets.preset_3;
	const subs = [];
	const rowStates = {};
	for (let i = 1; i <= 12; i++) {
		subs.push(sub(i, i, "합성 줄 " + i));
		rowStates[i] = { presetId: "", params: [], _allParams: [], open: false, checked: false };
	}
	rowStates[1] = rowOf(p6, "합성 줄 1");
	rowStates[12] = rowOf(p3, "합성 줄 12");
	const h = await boot({ files: { [P.presets(PROJ)]: presetsFile([p6, p3]), [P.session(PROJ, A.seqId)]: { subtitles: subs, rowStates, trashBin: [], nextId: 13 } } });
	const panel1 = h.$("params-1");
	assert.deepEqual(badges(panel1), [["T1", true], ["T2", false], ["T3", false], ["T4", false]]);
	const lbl = panel1.querySelector(".mogrt-text-block-label");
	assert.equal(lbl.childNodes.length, 2);
	assert.equal(lbl.childNodes[0].className, "fid-badge cap");
	assert.equal(lbl.childNodes[1].nodeType, 3, "이름은 글자 노드");
	assert.equal(lbl.childNodes[1].textContent, "자막 1 텍스트");
	const panel12 = h.$("params-12");
	assert.deepEqual(badges(panel12), [["T1", true], ["T2", false]]);
	const t2 = panel12.querySelectorAll(".fid-badge")[1];
	assert.match(t2.title, /'#12 T2' 복사/);
	t2.click();
	await h.flush();
	assert.deepEqual(h.clipboard, ["#12 T2"]);
	assert.deepEqual(h.status(), { text: "복사됨: #12 T2 (포인트 텍스트) — AI에게 붙여 넣으면 됩니다", cls: "ok" });
	// 배지를 눌러도 속성창이 접히거나 저장되지 않는다
	assert.equal(h.snapshot().rowStates[12].open, true);
	noErrors(h);
});

test("클립보드 API가 없으면 execCommand('copy')로 복사하고, 그것도 안 되면 오류를 알린다", async () => {
	const { presets } = build();
	const p3 = presets.preset_3;
	const h = await boot({ files: { [P.presets(PROJ)]: presetsFile([p3]), [P.session(PROJ, A.seqId)]: { subtitles: [sub(5, 3, "합성")], rowStates: { 5: rowOf(p3, "합성") }, trashBin: [], nextId: 6 } } });
	delete h.win.navigator.clipboard;
	const copied = [];
	h.doc.execCommand = (cmd) => { copied.push(cmd); return true; };
	h.$("params-5").querySelectorAll(".fid-badge")[0].click();
	assert.deepEqual(copied, ["copy"]);
	assert.equal(h.status().text, "복사됨: #3 T1 (텍스트) — AI에게 붙여 넣으면 됩니다");
	h.doc.execCommand = () => false;
	h.$("params-5").querySelectorAll(".fid-badge")[1].click();
	assert.deepEqual(h.status(), { text: "클립보드에 넣지 못했습니다: #3 T2", cls: "err" });
	noErrors(h);
});

test("옛 구조(8속성) preset_1 줄: T1이 index 0 '전체 텍스트'(초록), T2 index 2, T3 index 4", async () => {
	const { presets, STALE_1 } = build();
	const p1 = presets.preset_1;
	const all = clone(STALE_1);
	const rs = { presetId: "preset_1", params: all.filter((p) => p.type === "text"), _allParams: all, open: true, checked: false };
	const h = await boot({ files: { [P.presets(PROJ)]: presetsFile([p1]), [P.session(PROJ, A.seqId)]: { subtitles: [sub(9, 1, "옛 구조 합성 문장")], rowStates: { 9: rs }, trashBin: [], nextId: 10 } } });
	const panel = h.$("params-9");
	const blocks = panel.querySelectorAll(".mogrt-text-block-label");
	assert.deepEqual(blocks.map((b) => b.textContent), ["T1전체 텍스트", "T2포인트 텍스트", "T3서브 포인트 텍스트"]);
	assert.deepEqual(badges(panel), [["T1", true], ["T2", false], ["T3", false]]);
	assert.deepEqual(h.snapshot().rowStates[9]._allParams, all, "구조를 맞추지 않는다");
	noErrors(h);
});

test("다화자 줄은 'C2·12 T2'를 복사한다", async () => {
	const { presets } = build();
	const p3 = presets.preset_3;
	const mi = { v: 1, salt: "k7q2", hwm: 64, legacyTrack: null, remapped: false, castOrder: ["C2"], cast: { C2: { name: "영희" } }, stack: false, stackDy: 0.12, applied: {} };
	const h = await boot({ files: { [P.presets(PROJ)]: presetsFile([p3]), [P.session(PROJ, A.seqId)]: { subtitles: [sub(57, 12, "합성", "C2")], rowStates: { 57: rowOf(p3, "합성") }, trashBin: [], nextId: 65, mi } } });
	h.$("params-57").querySelectorAll(".fid-badge")[1].click();
	await h.flush();
	assert.deepEqual(h.clipboard, ["C2" + DOT + "12 T2"]);
	noErrors(h);
});

test("프리셋이 없는 줄·텍스트가 아닌 속성에는 배지가 없고, 행 DOM의 다른 부분은 그대로다", async () => {
	const { presets } = build();
	const p1 = presets.preset_1;
	const rs = rowOf(p1, "합성");
	rs.params = rs._allParams.filter((p) => [1, 4, 5].indexOf(p.index) !== -1); // 색상·텍스트·색상
	const h = await boot({ files: { [P.presets(PROJ)]: presetsFile([p1]), [P.session(PROJ, A.seqId)]: { subtitles: [sub(1, 1, "합성"), sub(2, 2, "없음")], rowStates: { 1: rs, 2: { presetId: "", params: [], _allParams: [], open: false, checked: false } }, trashBin: [], nextId: 3 } } });
	assert.deepEqual(badges(h.$("params-1")), [["T1", true]]);
	assert.equal(h.$("params-1").querySelectorAll(".mogrt-prop-row").length, 2, "색상 두 줄");
	assert.equal(h.$("params-1").querySelectorAll(".mogrt-prop-row .fid-badge").length, 0);
	assert.equal(h.$("row-2").querySelectorAll(".fid-badge").length, 0);
	assert.equal(h.$("row-1").querySelector(".sub-num").textContent, "1", "번호 표시는 그대로");
	noErrors(h);
});

// ── 네이티브 템플릿 이름 (S0-3 결정 4) ──

function nativeDef(n) {
	const layer = (en, ko) => ({ type: 6, uiName: "TextLayer", value: { strDB: [{ localeString: "en_US", str: en }].concat(ko ? [{ localeString: "ko_KR", str: ko }] : []) } });
	const ctrls = [layer("Insert Name Here", "이름을 넣으세요"), { type: 2, uiName: "Color" }, layer("ADD TITLE HERE")];
	return { capsuleName: "Classic", clientControls: n === 1 ? ctrls.slice(0, 2) : ctrls };
}
function withJsZip(h, def, calls) {
	h.win.JSZip = { loadAsync: async () => { if (calls) calls.n++; return { file: (nm) => (nm === "definition.json" ? { async: async () => JSON.stringify(def) } : null) }; } };
}
const nativePath = "D:/MOGRT/Classic Lower Third.mogrt";

test("네이티브: definition.json TextLayer 기본 문구가 필드 이름이 되고, 저장한 프리셋을 두 번 열어도 이름이 같다", async () => {
	const { NATIVE } = build();
	const h = await boot({ mogrts: [{ name: "Classic Lower Third", path: nativePath }], params: { [nativePath]: clone(NATIVE) }, files: { [nativePath]: "ZmFrZQ==" } });
	const calls = { n: 0 };
	withJsZip(h, nativeDef(2), calls);
	h.$("btnAddPreset").click();
	await h.flush();
	h.$("defaultMogrtSel").value = nativePath;
	h.change(h.$("defaultMogrtSel"));
	await h.advance(10);
	const labels = () => h.$("defaultModalBody").querySelectorAll(".modal-text-block-header .modal-mogrt-label").map((x) => x.textContent);
	assert.deepEqual(labels(), ["Insert Name Here", "ADD TITLE HERE"]);
	assert.deepEqual(badges(h.$("defaultModalBody")), [["T1", true], ["T2", false]]);
	assert.doesNotMatch(h.$("defaultModalBody").querySelectorAll(".fid-badge")[0].title, /순서 미확인/);
	assert.deepEqual(h.snapshot().mogrtOriginals[nativePath].map((p) => p.displayName), ["Insert Name Here", "ADD TITLE HERE"], "패치 뒤 캐시");
	h.$("presetNameInput").value = "네이티브 합성";
	h.$("btnSaveDefault").click();
	let s = h.snapshot();
	const pid = Object.keys(s.presets).find((id) => s.presets[id].name === "네이티브 합성");
	assert.deepEqual(s.presets[pid].params.map((p) => p.displayName), ["Insert Name Here", "ADD TITLE HERE"]);
	// 두 번 열기 (첫 번째는 저장 전 새 프리셋 모달이었다 → 편집으로 두 번)
	for (let k = 0; k < 2; k++) {
		await openEdit(h, "네이티브 합성");
		assert.deepEqual(labels(), ["Insert Name Here", "ADD TITLE HERE"], "편집 " + (k + 1));
	}
	assert.equal(calls.n, 1, "두 번째부터는 캐시 (definition을 다시 읽지 않는다)");
	s = h.snapshot();
	assert.deepEqual(s.presets[pid].params.map((p) => p.displayName), ["Insert Name Here", "ADD TITLE HERE"]);
	noErrors(h);
});

test("네이티브: UI 로캘(ko_KR) 문구를 먼저 쓰고, TextLayer 개수가 다르면 '텍스트 N'과 '순서 미확인'", async () => {
	const { NATIVE } = build();
	let h = await boot({ mogrts: [{ name: "Classic", path: nativePath }], params: { [nativePath]: clone(NATIVE) }, files: { [nativePath]: "ZmFrZQ==" } });
	h.win.CSInterface.prototype.hostEnvironment = { appUILocale: "ko_KR" };
	withJsZip(h, nativeDef(2));
	h.$("btnAddPreset").click();
	await h.flush();
	h.$("defaultMogrtSel").value = nativePath;
	h.change(h.$("defaultMogrtSel"));
	await h.advance(10);
	assert.deepEqual(h.$("defaultModalBody").querySelectorAll(".modal-text-block-header .modal-mogrt-label").map((x) => x.textContent), ["이름을 넣으세요", "ADD TITLE HERE"]);
	noErrors(h);
	h = await boot({ mogrts: [{ name: "Classic", path: nativePath }], params: { [nativePath]: clone(NATIVE) }, files: { [nativePath]: "ZmFrZQ==" } });
	withJsZip(h, nativeDef(1));
	h.$("btnAddPreset").click();
	await h.flush();
	h.$("defaultMogrtSel").value = nativePath;
	h.change(h.$("defaultMogrtSel"));
	await h.advance(10);
	assert.deepEqual(h.$("defaultModalBody").querySelectorAll(".modal-text-block-header .modal-mogrt-label").map((x) => x.textContent), ["텍스트 1", "텍스트 2"]);
	assert.match(h.$("defaultModalBody").querySelectorAll(".fid-badge")[1].title, /^네이티브 템플릿: 순서 미확인 · /);
	noErrors(h);
});

test("네이티브: definition을 읽지 못한 캐시로 기존 프리셋을 열면 프리셋의 이름을 가져간다 (다시 저장해도 '텍스트 N'으로 돌아가지 않는다)", async () => {
	const { NATIVE } = build();
	const named = clone(NATIVE);
	named[0].displayName = "Insert Name Here";
	named[1].displayName = "ADD TITLE HERE";
	const p9 = { id: "preset_9", name: "네이티브 저장본", mogrtPath: nativePath, params: named, exposedIndices: [0, 1], textParamIndex: 0, exposedFontFields: {}, thumbnailData: null };
	const h = await boot({ mogrts: [{ name: "Classic", path: nativePath }], params: { [nativePath]: clone(NATIVE) }, files: { [P.presets(PROJ)]: presetsFile([p9]) } });
	// JSZip 없음 → definition 패치 없이 캐시 (일반 이름)
	for (let k = 0; k < 2; k++) {
		await openEdit(h);
		assert.deepEqual(h.$("defaultModalBody").querySelectorAll(".modal-text-block-header .modal-mogrt-label").map((x) => x.textContent), ["Insert Name Here", "ADD TITLE HERE"], "열기 " + (k + 1));
	}
	assert.deepEqual(h.snapshot().mogrtOriginals[nativePath].map((p) => p.displayName), ["텍스트 1", "텍스트 2"], "캐시는 원래(호스트) 이름");
	h.$("btnSaveDefault").click();
	if (h.$("confirmModal").classList.contains("open")) h.$("confirmYes").click();
	assert.deepEqual(h.snapshot().presets.preset_9.params.map((p) => p.displayName), ["Insert Name Here", "ADD TITLE HERE"]);
	noErrors(h);
});

test("네이티브: '텍스트 N'으로 저장된 프리셋은 definition을 읽을 수 있어도 첫 번째·두 번째 열기의 이름이 같고(프리셋 이름), 저장해도 바뀌지 않는다", async () => {
	const { NATIVE } = build();
	const p9 = { id: "preset_9", name: "v27 네이티브", mogrtPath: nativePath, params: clone(NATIVE), exposedIndices: [0, 1], textParamIndex: 0, exposedFontFields: {}, thumbnailData: null };
	const h = await boot({ mogrts: [{ name: "Classic", path: nativePath }], params: { [nativePath]: clone(NATIVE) }, files: { [nativePath]: "ZmFrZQ==", [P.presets(PROJ)]: presetsFile([p9]) } });
	const calls = { n: 0 };
	withJsZip(h, nativeDef(2), calls);
	const labels = () => h.$("defaultModalBody").querySelectorAll(".modal-text-block-header .modal-mogrt-label").map((x) => x.textContent);
	await openEdit(h);
	assert.equal(calls.n, 1, "첫 번째 열기는 캐시가 없어 definition을 읽었다");
	assert.deepEqual(labels(), ["텍스트 1", "텍스트 2"], "열기 1 (캐시 없음)");
	assert.deepEqual(h.snapshot().mogrtOriginals[nativePath].map((p) => p.displayName), ["Insert Name Here", "ADD TITLE HERE"], "캐시는 definition 이름");
	h.$("btnSaveDefault").click();
	if (h.$("confirmModal").classList.contains("open")) h.$("confirmYes").click();
	assert.deepEqual(h.snapshot().presets.preset_9.params.map((p) => p.displayName), ["텍스트 1", "텍스트 2"], "저장해도 프리셋 이름 그대로");
	await openEdit(h);
	assert.equal(calls.n, 1, "두 번째는 캐시");
	assert.deepEqual(labels(), ["텍스트 1", "텍스트 2"], "열기 2 (캐시)");
	noErrors(h);
});

test("네이티브: 편집 중인 프리셋과 다른 MOGRT를 고르면 그 템플릿의 이름을 쓴다 (프리셋 이름을 옮겨 붙이지 않는다)", async () => {
	const { NATIVE } = build();
	const otherPath = "D:/MOGRT/Other Native.mogrt";
	const named = clone(NATIVE);
	named[0].displayName = "옛 이름 A";
	named[1].displayName = "옛 이름 B";
	const p9 = { id: "preset_9", name: "네이티브 저장본", mogrtPath: nativePath, params: named, exposedIndices: [0, 1], textParamIndex: 0, exposedFontFields: {}, thumbnailData: null };
	const h = await boot({
		mogrts: [{ name: "Classic", path: nativePath }, { name: "Other", path: otherPath }],
		params: { [nativePath]: clone(NATIVE), [otherPath]: clone(NATIVE) },
		files: { [nativePath]: "ZmFrZQ==", [otherPath]: "ZmFrZQ==", [P.presets(PROJ)]: presetsFile([p9]) }
	});
	withJsZip(h, nativeDef(2));
	const labels = () => h.$("defaultModalBody").querySelectorAll(".modal-text-block-header .modal-mogrt-label").map((x) => x.textContent);
	await openEdit(h);
	assert.deepEqual(labels(), ["옛 이름 A", "옛 이름 B"]);
	h.$("defaultMogrtSel").value = otherPath;
	h.change(h.$("defaultMogrtSel"));
	await h.flush();
	await h.advance(10);
	assert.deepEqual(labels(), ["Insert Name Here", "ADD TITLE HERE"]);
	noErrors(h);
});
