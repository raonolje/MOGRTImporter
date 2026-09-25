"use strict";
// S2-3: 화자 표(#castBar)·화자 칩(#speakerChips)·필터 다시 걸기·휴지통 라벨과 되살리기·cast_defaults.json — panelHarness로 app.js 전체를 돌린다.
// 단일 화자 줄의 DOM과 휴지통 되살리기 자리는 git tag v27의 app.js를 같은 하네스에서 돌려 비교한다.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { bootPanel, cachePaths: P, projKeyOf, CACHE_ROOT } = require("../lib/panelHarness");
const { build } = require("../fixtures/presets_synth");
const { loadRegions, plain } = require("../lib/loadRegions");

const ROOT = path.resolve(__dirname, "..", "..");
const PROJ = "C:/work/cast.prproj";
const A = { seqId: "cast-0001", seqName: "T_CAST", projPath: PROJ };
const B = { seqId: "cast-0002", seqName: "T_CAST2", projPath: PROJ };
const DOT = String.fromCharCode(0xb7);
const DEFAULTS = CACHE_ROOT + "/" + projKeyOf(PROJ) + "/cast_defaults.json";
const clone = (v) => JSON.parse(JSON.stringify(v));
const CORE = loadRegions(["src/mi/core.ts"]);

function tc(x) {
	const ms = Math.round(x * 1000);
	const p = (n, w) => String(n).padStart(w, "0");
	return p(Math.floor(ms / 3600000), 2) + ":" + p(Math.floor((ms % 3600000) / 60000), 2) + ":" + p(Math.floor((ms % 60000) / 1000), 2) + "." + p(ms % 1000, 3);
}
function row(id, index, s, e, text, spk) {
	const r = { index, startTime: tc(s), endTime: tc(e), startSec: s, endSec: e, text, id };
	if (spk) { r.spk = spk; r.srtNo = index; }
	return r;
}
function rs(presetId) {
	return { presetId: presetId || "", params: [], _allParams: [], open: false, checked: false };
}
function castEntry(name, presetId, color, extra) {
	return Object.assign({ name, track: null, autoTrack: null, presetId: presetId || "", color, file: name + ".srt", path: null, size: 10, mtime: null, pos: null }, extra || {});
}
// 3화자 세션: C1 철수(preset_3) · C2 영희(preset_6) · C3 민수(없음), 시간순
function castSession() {
	const subs = [
		row(1, 1, 1, 2, "철수 하나", "C1"), row(2, 1, 2, 3, "영희 하나", "C2"), row(3, 1, 3, 4, "민수 하나", "C3"),
		row(4, 2, 5, 6, "철수 둘", "C1"), row(5, 2, 6, 7, "영희 둘", "C2"), row(6, 2, 8, 9, "민수 둘", "C3")
	];
	const rowStates = {};
	subs.forEach((s) => { rowStates[s.id] = rs(s.spk === "C1" ? "preset_3" : s.spk === "C2" ? "preset_6" : ""); });
	return {
		subtitles: subs, rowStates, trashBin: [], nextId: 7,
		mi: { v: 1, salt: "ab12", hwm: 6, legacyTrack: null, remapped: false, castOrder: ["C1", "C2", "C3"],
			cast: { C1: castEntry("철수", "preset_3", 0), C2: castEntry("영희", "preset_6", 1), C3: castEntry("민수", "", 2) },
			stack: false, stackDy: 0.12, applied: {} }
	};
}
function presetsFile() {
	const { presets } = build();
	return { presets: { preset_1: presets.preset_1, preset_3: presets.preset_3, preset_6: presets.preset_6 }, presetTrash: [], nextPresetId: 9 };
}
async function boot(opts) {
	const o = Object.assign({ seq: A }, opts || {});
	const h = await bootPanel(o);
	await h.advance(1000);
	return h;
}
function noErrors(h) {
	assert.deepEqual(h.errors().map((e) => String(e.message || e).slice(0, 300)), [], "패널 예외");
}
const castRows = (h) => h.$("castRows").querySelectorAll(".cast-row");
const castRow = (h, K) => castRows(h).find((r) => r.dataset.key === K);
const chips = (h) => h.$("speakerChips").querySelectorAll(".spk-chip");
const chip = (h, label) => chips(h).find((c) => c.textContent === label);
const visibleIds = (h) => h.rows().filter((r) => !/(search|preset-filter|speaker-filter)-hidden/.test(r.className)).map((r) => parseInt(r.id.slice(4), 10));
const autoList = (h, seq) => h.fs.readJson(P.historyAuto(PROJ, (seq || A).seqId)) || [];
const safetyList = (h, seq) => h.fs.readJson(P.historySafety(PROJ, (seq || A).seqId)) || [];
function setSel(h, el, v) {
	el.value = v;
	h.change(el);
}
function menuClick(h, K, act) {
	castRow(h, K).querySelector(".cast-more").click();
	const b = castRow(h, K).querySelector(".cast-menu").querySelectorAll("button").find((x) => x.dataset.act === act);
	assert.ok(b, "메뉴 " + act);
	b.click();
}
async function bootCast(extra) {
	return boot(Object.assign({ files: { [P.presets(PROJ)]: presetsFile(), [P.session(PROJ, A.seqId)]: castSession() } }, extra || {}));
}

// ── core ──

test("core resolveTracks: 첫 자동 화자는 기본 트랙, 다음은 기억한 autoTrack·빈 위 트랙, 고정 겹침은 막고, 남의 클립·잠긴 트랙은 피한다", () => {
	const cast = (o) => Object.assign({ track: null, autoTrack: null }, o || {});
	let r = plain(CORE.resolveTracks(["C1", "C2", "C3"], { C1: cast(), C2: cast(), C3: cast() }, 2));
	assert.deepEqual(Object.keys(r.tracks).map((K) => [K, r.tracks[K].track, r.tracks[K].auto]), [["C1", 2, true], ["C2", 3, true], ["C3", 4, true]]);
	assert.equal(r.minCount, 0, "트랙 수를 모르면 늘릴지도 모른다");
	// 기억한 autoTrack, 고정 트랙이 기본 트랙이면 첫 자동 화자는 위로
	r = plain(CORE.resolveTracks(["C1", "C2", "C3"], { C1: cast({ autoTrack: 6 }), C2: cast({ track: 2 }), C3: cast({ autoTrack: 5 }) }, 2, { numTracks: 6 }));
	assert.deepEqual([r.tracks.C1.track, r.tracks.C2.track, r.tracks.C3.track], [6, 2, 5]);
	assert.deepEqual([r.tracks.C1.create, r.tracks.C3.create, r.minCount], [true, false, 7]);
	// 고정 둘이 한 트랙: 겹치면 blocked, 안 겹치면 괜찮다
	const pin = { C1: cast({ track: 3 }), C3: cast({ track: 3 }) };
	r = plain(CORE.resolveTracks(["C1", "C3"], pin, 2, { spans: { C1: [[0, 10], [20, 30]], C3: [[10, 20], [30, 40]] } }));
	assert.deepEqual(r.blocked, []);
	r = plain(CORE.resolveTracks(["C1", "C3"], pin, 2, { spans: { C1: [[0, 10], [20, 31]], C3: [[10, 20], [30, 40]] } }));
	assert.deepEqual(r.blocked, [{ keys: ["C1", "C3"], track: 3 }]);
	// 스캔: V4(3)에 남의 클립이 C2 구간과 겹치고, V5(4)는 잠김 → C2는 V6(5). 우리 C2 클립은 막지 않는다
	const scan = { numVideoTracks: 6, tracks: [
		{ i: 2, locked: false, clips: [] },
		{ i: 3, locked: false, clips: [{ sf: 100, ef: 200, nodeId: "x", name: "B-roll.png" }] },
		{ i: 4, locked: true, clips: [] },
		{ i: 5, locked: false, clips: [{ sf: 120, ef: 130, nodeId: "o", name: "영희 [MI:ab12-7.1]" }] }
	] };
	r = plain(CORE.resolveTracks(["C1", "C2"], { C1: cast(), C2: cast() }, 2, { scan, salt: "ab12", rowSpk: { 7: "C2" }, spans: { C1: [[0, 50]], C2: [[150, 300]] } }));
	assert.deepEqual([r.tracks.C1.track, r.tracks.C2.track, r.tracks.C2.create, r.minCount], [2, 5, false, 0]);
	// 다른 salt 클립이 문장까지 맞는 트랙(affinity)을 기억한 트랙이 없는 자동 화자가 먼저 쓴다
	r = plain(CORE.resolveTracks(["C1", "C2"], { C1: cast(), C2: cast() }, 2, { scan, spans: { C2: [[150, 300]] }, affinity: { C2: 3 } }));
	assert.equal(r.tracks.C2.track, 3);
	// 잠긴 트랙을 고정하면 그대로 두고 locked로 알린다
	r = plain(CORE.resolveTracks(["C1"], { C1: cast({ track: 4 }) }, 2, { scan }));
	assert.deepEqual([r.tracks.C1.track, r.tracks.C1.locked], [4, true]);
});

test("core castDefaultsOf / castDefaultsMerge: C번호 키만, 이름이 키 그대로면 이전 이름을 지킨다", () => {
	const d = plain(CORE.castDefaultsOf({ v: 1, C1: { name: "철수", presetId: "preset_3", color: 0, pos: null }, junk: { name: "x" }, C2: "틀림" }));
	assert.deepEqual(d, { C1: { name: "철수", presetId: "preset_3", color: 0, pos: null } });
	const m = plain(CORE.castDefaultsMerge(d, { C1: { name: "C1", presetId: "", color: 3 }, C2: { name: "영희", presetId: "preset_6", color: 1, pos: { x: 0.35, y: 0.5 } } }, ["C1", "C2", "C9"]));
	assert.deepEqual(m, { C1: { name: "철수", presetId: "", color: 3, pos: null }, C2: { name: "영희", presetId: "preset_6", color: 1, pos: { x: 0.35, y: 0.5 } } });
	assert.deepEqual(d.C1.presetId, "preset_3", "입력은 그대로");
});

// ── 화자 표 ──

test("(1)(9) 3화자 세션: 부팅(bootDone, 예외 없음) → 화자 표 3줄 · 칩 4개 · 트랙 미리보기 · 줄 번호 'C2·1'과 색 줄", async () => {
	const h = await bootCast();
	assert.equal(h.win._mogrtDebug.bootDone, true);
	assert.equal(h.$("castBar").style.display, "");
	assert.equal(h.$("castTitle").textContent, "화자 3명");
	assert.deepEqual(castRows(h).map((r) => [r.dataset.key, r.querySelector(".cast-name").value, r.querySelector(".cast-count").textContent]), [["C1", "철수", "2줄"], ["C2", "영희", "2줄"], ["C3", "민수", "2줄"]]);
	// 기본 트랙 V3(#trackSel 2) → C1 자동 (V3), C2 자동 (V4), C3 자동 (V5). 다른 화자가 쓰는 트랙에는 이름
	const opts = (K) => castRow(h, K).querySelector(".cast-track").options.map((o) => o.textContent);
	assert.equal(opts("C1")[0], "자동 (V3)");
	assert.equal(opts("C2")[0], "자동 (V4)");
	assert.equal(opts("C3")[0], "자동 (V5)");
	assert.ok(opts("C1").indexOf("V4 (영희)") !== -1 && opts("C1").indexOf("V5 (민수)") !== -1, opts("C1").join(" | "));
	assert.equal(castRow(h, "C1").querySelector(".cast-preset").value, "preset_3");
	assert.equal(castRow(h, "C3").querySelector(".cast-preset").value, "");
	assert.deepEqual(chips(h).map((c) => c.textContent), ["전체", "C1 철수", "C2 영희", "C3 민수"]);
	assert.equal(chip(h, "전체").className, "spk-chip active");
	assert.deepEqual(h.rows().map((r) => r.querySelector(".sub-num").textContent), ["C1" + DOT + "1", "C2" + DOT + "1", "C3" + DOT + "1", "C1" + DOT + "2", "C2" + DOT + "2", "C3" + DOT + "2"]);
	assert.match(h.$("row-2").className, / spk-C2$/);
	assert.equal(h.$("row-2").style.borderLeft, "3px solid #ef5350");
	// 기본 트랙을 바꾸면 미리보기가 따라간다
	setSel(h, h.$("trackSel"), "4");
	assert.equal(opts("C1")[0], "자동 (V5)");
	assert.equal(opts("C2")[0], "자동 (V6)");
	noErrors(h);
});

test("(2)(3) 화자 칩: 고른 화자만 보이고 숨은 줄은 체크가 풀린다 · 전체 선택 → 선택 삭제는 보이는 줄만 · 줄을 새로 그려도 필터 유지", async () => {
	const h = await bootCast();
	// 먼저 C1 줄 하나를 체크해 둔다 → C2만 보이면 체크가 풀린다
	const c1 = h.$("row-1").querySelector("input[type=checkbox]");
	c1.checked = true;
	h.change(c1);
	chip(h, "C2 영희").click();
	assert.deepEqual(visibleIds(h), [2, 5]);
	assert.equal(h.snapshot().rowStates[1].checked, false, "숨은 줄은 체크를 푼다");
	assert.equal(chip(h, "C2 영희").className, "spk-chip active");
	assert.equal(castRow(h, "C2").querySelector(".cast-key").className, "cast-key filtered");
	chip(h, "C3 민수").click();
	assert.deepEqual(visibleIds(h), [2, 3, 5, 6], "여럿 고를 수 있다");
	// 체크박스 하나를 바꿔 className을 새로 써도 필터는 남는다
	const c5 = h.$("row-5").querySelector("input[type=checkbox]");
	c5.checked = true;
	h.change(c5);
	assert.deepEqual(visibleIds(h), [2, 3, 5, 6]);
	c5.checked = false;
	h.change(c5);
	// 전체 선택 → 보이는 줄만, 선택 삭제 → 보이는 줄만 휴지통
	h.$("btnToggleSelect").click();
	const s = h.snapshot();
	assert.deepEqual(s.subtitles.filter((x) => s.rowStates[x.id].checked).map((x) => x.id), [2, 3, 5, 6]);
	h.$("btnMultiDel").click();
	assert.deepEqual(h.snapshot().subtitles.map((x) => x.id), [1, 4]);
	assert.deepEqual(h.snapshot().trashBin.map((t) => t.sub.id).sort(), [2, 3, 5, 6]);
	// 키를 눌러도 같은 필터 (C1만) → 전체를 누르면 모두
	chip(h, "전체").click();
	assert.deepEqual(visibleIds(h), [1, 4]);
	castRow(h, "C1").querySelector(".cast-key").click();
	assert.equal(chip(h, "C1 철수").className, "spk-chip active");
	noErrors(h);
});

test("(4) 이름 바꾸기 → session.json·cast.json·cast_defaults.json 셋에 남고 히스토리 자동 항목, 다른 시퀀스에서 C2를 가져오면 그 이름·프리셋이 기본값", async () => {
	const h = await bootCast();
	const inp = castRow(h, "C2").querySelector(".cast-name");
	inp.value = "  지영 ";
	h.change(inp);
	assert.equal(h.fs.readJson(P.session(PROJ, A.seqId)).mi.cast.C2.name, "지영");
	assert.equal(h.fs.readJson(P.cast(PROJ, A.seqId)).cast.C2.name, "지영");
	const d = h.fs.readJson(DEFAULTS);
	assert.deepEqual([d.v, d.C2], [1, { name: "지영", presetId: "preset_6", color: 1, pos: null }]);
	assert.deepEqual(autoList(h).map((e) => e.label), ["화자 이름: C2 지영"]);
	assert.equal(autoList(h)[0].mi.cast.C2.name, "지영", "히스토리 항목에 화자 표");
	assert.deepEqual(chips(h).map((c) => c.textContent), ["전체", "C1 철수", "C2 지영", "C3 민수"]);
	// 트랙 고정 → 저장, 미리보기의 다른 화자 트랙이 바뀐다
	setSel(h, castRow(h, "C2").querySelector(".cast-track"), "6");
	assert.equal(h.fs.readJson(P.session(PROJ, A.seqId)).mi.cast.C2.track, 6);
	assert.equal(castRow(h, "C3").querySelector(".cast-track").options[0].textContent, "자동 (V4)");
	assert.equal(autoList(h)[0].label, "화자 트랙: C2 V7");
	// 색 점 → 저장하되 히스토리는 남기지 않는다
	castRow(h, "C1").querySelector(".cast-dot").click();
	assert.equal(h.fs.readJson(P.session(PROJ, A.seqId)).mi.cast.C1.color, 1);
	assert.equal(h.$("row-1").style.borderLeft, "3px solid #ef5350");
	assert.equal(autoList(h).length, 2);
	// 다른 시퀀스(같은 프로젝트)에서 인터뷰_C2.srt를 가져오면 창의 이름·프리셋 기본값이 cast_defaults
	h.win._mogrtDebug.setMiCast(true);
	h.host.seq = B;
	await h.advance(300);
	await h.dropSrts([{ name: "인터뷰_C2.srt", content: "1\n00:00:01,000 --> 00:00:02,000\n가\n" }]);
	const tr = h.$("impBody").querySelectorAll("tr.imp-row")[0];
	assert.deepEqual([tr.querySelector(".imp-name").value, tr.querySelector(".imp-preset").value], ["지영", "preset_6"]);
	h.$("impOk").click();
	await h.flush();
	const mi = h.snapshot().mi;
	assert.deepEqual([mi.cast.C2.name, mi.cast.C2.presetId, mi.cast.C2.color], ["지영", "preset_6", 1]);
	noErrors(h);
});

test("(5) 프리셋 삭제: 화자 기본 프리셋에서도 비우고, 숨은 화자는 숨은 채, 확인창에 'C1·1, C1·2'와 화자 기본 프리셋 안내", async () => {
	const h = await bootCast();
	chip(h, "C2 영희").click();
	assert.deepEqual(visibleIds(h), [2, 5]);
	h.$("tabBtnPresets").click();
	// deletePreset은 확인창을 띄운다 → 문구 확인 후 [확인]
	const del = h.$("presetList").querySelectorAll(".preset-row").map((r) => r.querySelector(".btn.danger"));
	const names = h.$("presetList").querySelectorAll(".preset-row").map((r) => r.querySelector(".preset-name").textContent);
	const i3 = names.indexOf(build().presets.preset_3.name);
	assert.ok(i3 !== -1, names.join(","));
	del[i3].click();
	const msg = h.$("confirmMessage").textContent;
	assert.match(msg, new RegExp("자막 C1" + DOT + "1, C1" + DOT + "2에 적용되어 있습니다"));
	assert.match(msg, /화자 기본 프리셋: C1 철수/);
	h.$("confirmYes").click();
	const s = h.snapshot();
	assert.equal(s.mi.cast.C1.presetId, "");
	assert.equal(h.fs.readJson(P.session(PROJ, A.seqId)).mi.cast.C1.presetId, "");
	assert.equal(castRow(h, "C1").querySelector(".cast-preset").value, "");
	assert.deepEqual(visibleIds(h), [2, 5], "숨은 화자는 숨은 채");
	assert.match(h.$("row-1").className, /speaker-filter-hidden/);
	assert.match(h.$("row-1").className, /no-mogrt/);
	// 프리셋 휴지통에서 되살리면 화자 표 선택지에 다시 나온다 (연결은 다시 잇지 않는다)
	h.$("presetTrashWrap").querySelectorAll(".btn-restore")[0].click();
	assert.ok(castRow(h, "C1").querySelector(".cast-preset").options.some((o) => o.value === "preset_3"));
	assert.equal(castRow(h, "C1").querySelector(".cast-preset").value, "");
	noErrors(h);
});

test("(6) 새 프리셋(가져오기)이 생기면 화자 표의 기본 프리셋 선택지가 따라간다, 새 프리셋 id는 cast_defaults의 id도 피한다", async () => {
	const { presets } = build();
	const files = { [P.presets(PROJ)]: { presets: { preset_3: presets.preset_3 }, presetTrash: [], nextPresetId: 4 }, [P.session(PROJ, A.seqId)]: castSession(), [DEFAULTS]: { v: 1, C7: { name: "옛 화자", presetId: "preset_12", color: 3, pos: null } } };
	const h = await boot({ files, mogrts: [{ name: "x", path: presets.preset_6.mogrtPath }, { name: "y", path: presets.preset_3.mogrtPath }] });
	assert.deepEqual(castRow(h, "C2").querySelector(".cast-preset").options.map((o) => o.value), ["", "preset_3"]);
	// 프리셋 파일 가져오기 (preset_6: 다른 이름·MOGRT → 새 id)
	await h.advance(100);
	// preset_3은 이름·MOGRT가 같아 id를 지키고, preset_6은 새 id
	const text = JSON.stringify({ presets: { preset_3: presets.preset_3, preset_6: presets.preset_6 } });
	const origCreate = h.doc.createElement.bind(h.doc);
	h.doc.createElement = (tag) => {
		const el = origCreate(tag);
		if (String(tag).toLowerCase() === "input") el.click = () => { el.files = [{ name: "p.json", _text: text }]; h.change(el); };
		return el;
	};
	h.$("btnImportPresets").click();
	h.doc.createElement = origCreate;
	await h.flush();
	if (h.$("confirmModal").classList.contains("open")) h.$("confirmYes").click();
	await h.flush();
	const ids = Object.keys(h.snapshot().presets);
	assert.deepEqual(ids.sort(), ["preset_13", "preset_3"], "cast_defaults의 preset_12 다음 번호");
	assert.deepEqual(castRow(h, "C2").querySelector(".cast-preset").options.map((o) => o.value), ["", "preset_3", "preset_13"]);
	noErrors(h);
});

test("⋯ 이 화자 줄에 기본 프리셋 적용: 안전 지점을 먼저, 다른 프리셋 줄이 있으면 묻고 [빈 줄만]은 빈 줄만, 이미 같은 프리셋 줄은 그대로", async () => {
	const sess = castSession();
	sess.rowStates[3].presetId = "preset_1"; // C3 줄 하나는 다른 프리셋
	sess.mi.cast.C3.presetId = "preset_3";
	const h = await bootCast({ files: { [P.presets(PROJ)]: presetsFile(), [P.session(PROJ, A.seqId)]: sess } });
	menuClick(h, "C3", "preset");
	assert.equal(h.$("confirmModal").classList.contains("open"), true);
	assert.match(h.$("confirmMessage").textContent, /C3 민수 줄 2개 중 1개에는 이미 다른 프리셋이 걸려 있습니다/);
	assert.deepEqual([h.$("confirmYes").textContent, h.$("confirmAlt").textContent, h.$("confirmNo").textContent], ["모두 적용 (2)", "빈 줄만 (1)", "취소"]);
	h.$("confirmAlt").click();
	let s = h.snapshot();
	assert.deepEqual([s.rowStates[3].presetId, s.rowStates[6].presetId], ["preset_1", "preset_3"]);
	assert.ok(s.rowStates[6]._allParams.length > 0, "프리셋 값으로 채운다");
	assert.deepEqual(safetyList(h).map((e) => e.label), ["기본 프리셋 일괄 적용 전: C3"]);
	assert.equal(safetyList(h)[0].rowStates[6].presetId, "", "안전 지점은 바꾸기 전 상태");
	assert.equal(autoList(h)[0].label, "기본 프리셋 일괄 적용: C3 (1줄)");
	// 다시: 다른 프리셋 줄 → [모두 적용]
	menuClick(h, "C3", "preset");
	h.$("confirmYes").click();
	s = h.snapshot();
	assert.deepEqual([s.rowStates[3].presetId, s.rowStates[6].presetId], ["preset_3", "preset_3"]);
	assert.equal(h.$("sel-3").value, "preset_3");
	// 모두 같으면 묻지도 바꾸지도 않는다
	const before = JSON.stringify(h.snapshot().rowStates);
	menuClick(h, "C3", "preset");
	assert.equal(h.$("confirmModal").classList.contains("open"), false);
	assert.equal(JSON.stringify(h.snapshot().rowStates), before);
	assert.match(h.status().text, /바꿀 줄이 없습니다/);
	// 기본 프리셋이 없으면 안내
	menuClick(h, "C3", "preset");
	castRow(h, "C1").querySelector(".cast-preset").value = "";
	h.change(castRow(h, "C1").querySelector(".cast-preset"));
	menuClick(h, "C1", "preset");
	assert.match(h.status().text, /C1 철수: 기본 프리셋을 먼저 고르세요/);
	noErrors(h);
});

test("⋯ 이 화자 줄 선택 · 화자 삭제(줄은 휴지통, 휴지통 라벨 'C2·1') · 휴지통에서 되살리면 시간 자리와 화자 표가 돌아온다", async () => {
	const h = await bootCast();
	menuClick(h, "C2", "select");
	let s = h.snapshot();
	assert.deepEqual(s.subtitles.filter((x) => s.rowStates[x.id].checked).map((x) => x.id), [2, 5]);
	assert.match(h.status().text, /C2 영희 줄 2개 선택/);
	menuClick(h, "C2", "delete");
	assert.match(h.$("confirmMessage").textContent, /화자 C2 영희을\(를\) 삭제합니다/);
	h.$("confirmYes").click();
	s = h.snapshot();
	assert.deepEqual(s.subtitles.map((x) => x.id), [1, 3, 4, 6]);
	assert.deepEqual(s.mi.castOrder, ["C1", "C3"]);
	assert.equal(s.mi.cast.C2, undefined);
	assert.deepEqual(s.trashBin.map((t) => [t.sub.id, t.why]), [[2, undefined], [5, undefined]], "사용자가 지운 것과 같다 (why 없음)");
	assert.deepEqual(safetyList(h).map((e) => e.label), ["화자 삭제 전: C2"]);
	assert.equal(castRows(h).length, 2);
	assert.deepEqual(h.$("trashWrap").querySelectorAll(".trash-row").map((r) => r.querySelector(".trash-num").textContent), ["C2" + DOT + "1", "C2" + DOT + "2"]);
	// 둘째(5, 6초)를 먼저 되살린다 → 시간 자리(4와 6 사이), 화자 표에 C2가 다시 생기고 번호는 C2·1
	h.$("trashWrap").querySelectorAll(".btn-restore")[1].click();
	s = h.snapshot();
	assert.deepEqual(s.subtitles.map((x) => x.id), [1, 3, 4, 5, 6]);
	assert.deepEqual(s.mi.castOrder, ["C1", "C2", "C3"]);
	assert.equal(s.mi.cast.C2.name, "C2", "cast_defaults가 없으면 키");
	assert.equal(s.subtitles.find((x) => x.id === 5).index, 1);
	assert.match(h.status().text, new RegExp("자막 C2" + DOT + "1번 복구됨"));
	// 전체 복구 → 2가 시간 자리로, 번호 다시
	h.$("btnRestoreAll").click();
	s = h.snapshot();
	assert.deepEqual(s.subtitles.map((x) => [x.id, x.index]), [[1, 1], [2, 1], [3, 1], [4, 2], [5, 2], [6, 2]]);
	noErrors(h);
});

// ── 단일 화자는 v27 그대로 ──

function domOf(el) {
	const o = { tag: el.tagName, id: el.id, cls: el.className, title: el.title, text: el._text, style: JSON.stringify(el.style) };
	if (el.tagName === "INPUT") Object.assign(o, { type: el.type, checked: el.checked });
	if (el.tagName === "OPTION") Object.assign(o, { value: el.value, selected: el.selected });
	o.kids = el.childNodes.filter((c) => c.nodeType === 1).map(domOf);
	return o;
}
function v27Src() {
	return execFileSync("git", ["show", "v27:extension/html/js/app.js"], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}
const SINGLE_SRT = "1\n00:00:01,000 --> 00:00:02,000\n하나\n\n2\n00:00:03,000 --> 00:00:04,000\n둘\n\n3\n00:00:05,000 --> 00:00:06,000\n셋\n\n4\n00:00:07,000 --> 00:00:08,000\n넷\n\n5\n00:00:09,000 --> 00:00:10,000\n다섯\n";

async function singleFlow(appSrc) {
	const { presets } = build();
	const h = await bootPanel({ seq: A, appSrc, mogrts: [{ name: "p3", path: presets.preset_3.mogrtPath }], files: { [P.presets(PROJ)]: { presets: { preset_3: presets.preset_3 }, presetTrash: [], nextPresetId: 4 } } });
	await h.advance(1000);
	await h.dropSrt("single.srt", SINGLE_SRT);
	setSel(h, h.$("sel-2"), "preset_3");
	const c = h.$("row-4").querySelector("input[type=checkbox]");
	c.checked = true;
	h.change(c);
	const rowsDom = h.rows().map(domOf);
	// 2·4를 지우고 4를 먼저, 그다음 2를 되살린다 (지웠던 자리 기준 — v27 규칙)
	h.$("row-2").querySelectorAll("button").find((b) => b.title === "삭제 (휴지통으로)").click();
	h.$("row-4").querySelectorAll("button").find((b) => b.title === "삭제 (휴지통으로)").click();
	// 순서는 목록 DOM으로 본다 (v27에는 snapshot 훅이 없다)
	const ids = () => h.rows().map((r) => parseInt(r.id.slice(4), 10));
	const order = [];
	h.$("trashWrap").querySelectorAll(".btn-restore")[1].click();
	order.push(ids());
	h.$("trashWrap").querySelectorAll(".btn-restore")[0].click();
	order.push(ids());
	return { h, rowsDom, order, castBar: h.$("castBar") };
}

test("(7)(8) 단일 화자: 줄 DOM이 v27 app.js와 같고 화자 표·칩은 숨김, 휴지통 되살리기 자리도 v27과 같다", async () => {
	const now = await singleFlow();
	const old = await singleFlow(v27Src());
	assert.deepEqual(now.rowsDom, old.rowsDom, "줄 DOM (클래스·style·자식) 그대로");
	assert.equal(now.castBar.style.display, "none");
	assert.equal(now.h.$("speakerChips").style.display, "none");
	assert.deepEqual(now.order, old.order);
	assert.deepEqual(now.order, [[1, 3, 4, 5], [1, 2, 3, 4, 5]], "v27: 지웠던 자리(position)에 넣는다");
	noErrors(now.h);
});
