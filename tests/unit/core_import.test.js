"use strict";
// S1-7 core: SRT 열기 경로, 인코딩 표시, 화자 만들기(importIntoData: 새 화자·교체), 정렬·번호·휴지통 상한
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadRegions, plain } = require("../lib/loadRegions");
const { build } = require("../fixtures/presets_synth");

const core = loadRegions(["src/srtParser.ts", "src/mi/core.ts"]);
const FIX = path.join(__dirname, "..", "fixtures", "srt");
const cuesOf = (name) => core.parseSRT(core.decodeSrtBytes(fs.readFileSync(path.join(FIX, name))).text, { keepNo: true, stripTags: true });
const clone = (v) => JSON.parse(JSON.stringify(v));

function emptyData() {
	return { subtitles: [], rowStates: {}, trashBin: [], nextId: 1, mi: plain(core.miDefault()) };
}
const fileOf = (name) => ({ name, path: null, size: 10, mtime: null });

test("srtImportRoute: 플래그·파일 수·C번호·화자 표·화자 없는 줄", () => {
	const R = (o) => core.srtImportRoute(o);
	const one = (key, ambiguous) => [{ key: key || null, ambiguous: !!ambiguous }];
	// 플래그 꺼짐: 레거시 (병합 선택만 S1-9부터 플래그와 무관)
	assert.equal(R({ castEnabled: false, files: one("C2"), castEmpty: true, legacyLive: 0 }), "legacy");
	assert.equal(R({ castEnabled: false, files: [{ key: "C1" }, { key: "C2" }], castEmpty: false, legacyLive: 5 }), "legacy");
	assert.equal(R({ castEnabled: false, files: one("C2"), castEmpty: true, legacyLive: 5, legacyPreset: 2 }), "legacy", "C번호 파일은 플래그가 꺼져 있으면 v27");
	assert.equal(R({ castEnabled: false, files: one(null), castEmpty: false, legacyLive: 5, legacyPreset: 2 }), "legacy", "화자 표가 있으면 병합 선택 없음 (플래그 꺼짐)");
	assert.equal(R({ castEnabled: false, files: one(null, true), castEmpty: true, legacyLive: 5, legacyPreset: 2 }), "legacy", "모호한 이름");
	// 플래그 켜짐
	assert.equal(R({ castEnabled: true, files: one(null), castEmpty: true, legacyLive: 12 }), "legacy", "C번호 없는 한 파일 + 화자 표 없음");
	assert.equal(R({ castEnabled: true, files: one(null), castEmpty: true, legacyLive: 12, legacyPreset: 1 }), "choice", "프리셋이 걸린 줄이 있으면 병합/교체/취소");
	assert.equal(R({ castEnabled: false, files: one(null), castEmpty: true, legacyLive: 12, legacyPreset: 1 }), "choice", "S1-9: 플래그가 꺼져 있어도 병합/교체/취소");
	assert.equal(R({ castEnabled: false, files: one(null), castEmpty: true, legacyLive: 12, legacyPreset: 0 }), "legacy", "프리셋이 없으면 v27 교체");
	assert.equal(R({ castEnabled: true, files: one(null), castEmpty: false, legacyLive: 0 }), "modal", "화자 표가 있으면 키를 골라야 한다");
	assert.equal(R({ castEnabled: true, files: one(null, true), castEmpty: true, legacyLive: 0 }), "modal", "C1_C2 (모호)");
	assert.equal(R({ castEnabled: true, files: one("C1"), castEmpty: true, legacyLive: 0 }), "modal");
	assert.equal(R({ castEnabled: true, files: [{ key: null }, { key: null }], castEmpty: true, legacyLive: 0 }), "modal", "2개 이상");
	assert.equal(R({ castEnabled: true, files: one("C1"), castEmpty: true, legacyLive: 3 }), "distribute", "C번호 파일 + 화자 없는 줄");
	assert.equal(R({ castEnabled: true, files: [{ key: null }, { key: "C2" }], castEmpty: true, legacyLive: 3 }), "distribute");
	assert.equal(R({ castEnabled: true, files: [], castEmpty: true, legacyLive: 0 }), "legacy");
});

test("encodingLabel·needsEncodingConfirm", () => {
	assert.equal(core.encodingLabel("euc-kr"), "CP949");
	assert.equal(core.encodingLabel("utf-16le"), "UTF-16 LE");
	assert.equal(core.encodingLabel("utf-16be"), "UTF-16 BE");
	assert.equal(core.encodingLabel("utf-8"), "UTF-8");
	assert.equal(core.needsEncodingConfirm({ encoding: "utf-8", replaced: 0 }), false);
	assert.equal(core.needsEncodingConfirm({ encoding: "utf-8", replaced: 3 }), true);
	assert.equal(core.needsEncodingConfirm({ encoding: "euc-kr", replaced: 0 }), true);
	assert.equal(core.needsEncodingConfirm({ encoding: "utf-16le", replaced: 0 }), true);
});

test("sortCastKeys·castKeyNum·castColorFree", () => {
	assert.deepEqual(plain(core.sortCastKeys(["C12", "C2", "C1", "C10"])), ["C1", "C2", "C10", "C12"]);
	assert.equal(core.castKeyNum("C7"), 7);
	assert.equal(core.castKeyNum("X"), 0);
	assert.equal(core.castColorFree({}), 0);
	assert.equal(core.castColorFree({ C1: { color: 0 }, C3: { color: 2 } }), 1);
	const full = {};
	for (let i = 0; i < 8; i++) full["C" + (i + 1)] = { color: i };
	assert.equal(core.castColorFree(full), 0, "모두 쓰였으면 화자 수 % 8");
});

test("캡션 픽스처: BOM·CRLF·두 줄·태그·원래 번호, 01:00:00 오프셋 변형", () => {
	const c1 = cuesOf("cap_C1.srt");
	assert.equal(core.decodeSrtBytes(fs.readFileSync(path.join(FIX, "cap_C1.srt"))).encoding, "utf-8");
	assert.equal(c1.length, 7);
	assert.deepEqual(plain(c1.map((c) => c.srtNo)), [1, 2, 3, 4, 5, 6, 7]);
	assert.equal(c1[2].text, "두 줄로 된 자막\n아래 줄은 조금 더 깁니다", "두 줄은 LF로");
	assert.equal(c1[3].text, "기울임 강조 문장입니다", "<i> 제거");
	assert.equal(c1[5].text, "굵게 말한 부분", "<b> 제거");
	assert.equal(c1[0].text.charCodeAt(0) === 0xfeff, false, "BOM 없음");
	const c2 = cuesOf("cap_interview_C2.srt");
	const tc = cuesOf("cap_C2_tc1h.srt");
	assert.deepEqual(plain(tc.map((c) => c.startSec - 3600)), plain(c2.map((c) => c.startSec)), "오프셋 변형은 3600초 뒤");
	assert.deepEqual(plain(core.parseCaptionKey("cap_interview_C2.srt")).key, "C2");
	assert.deepEqual(plain(core.parseCaptionKey("cap_C2_tc1h.srt")).key, "C2");
	assert.deepEqual(plain(core.parseCaptionKey("cap_C1_edit.srt")).key, "C1");
});

test("importIntoData: 새 화자 둘 → 화자 표(이름=입력>키, 색, C번호 순), 줄(spk·srtNo·화자 안 번호), 시간순, salt", () => {
	const { presets } = build();
	const d = emptyData();
	d.nextId = 5;
	const job = {
		files: [
			{ key: "C2", name: "", presetId: "preset_6", action: "new", file: { name: "cap_interview_C2.srt", path: "D:/srt/cap_interview_C2.srt", size: 415, mtime: 1790000000000 }, cues: cuesOf("cap_interview_C2.srt") },
			{ key: "C1", name: "  철수 ", presetId: "preset_3", action: "new", file: fileOf("cap_C1.srt"), cues: cuesOf("cap_C1.srt") }
		]
	};
	const rep = plain(core.importIntoData(d, job, { now: 1000, salt: "k7q2", presets }));
	assert.deepEqual(rep.files.map((f) => [f.key, f.action, f.count, f.name]), [["C2", "new", 6, "C2"], ["C1", "new", 7, "철수"]]);
	const mi = plain(d.mi);
	assert.equal(mi.salt, "k7q2");
	assert.deepEqual(mi.castOrder, ["C1", "C2"]);
	assert.deepEqual(mi.cast.C2, { name: "C2", track: null, autoTrack: null, presetId: "preset_6", color: 0, file: "cap_interview_C2.srt", path: "D:/srt/cap_interview_C2.srt", size: 415, mtime: 1790000000000, pos: null });
	assert.equal(mi.cast.C1.name, "철수");
	assert.equal(mi.cast.C1.color, 1, "비어 있는 첫 색");
	const subs = plain(d.subtitles);
	assert.equal(subs.length, 13);
	for (let i = 1; i < subs.length; i++) assert.ok(subs[i - 1].startSec <= subs[i].startSec, "시간순");
	assert.deepEqual(subs.slice(0, 3).map((s) => [s.spk, s.index, s.srtNo, s.text.slice(0, 5)]), [["C1", 1, 1, "안녕하세요"], ["C2", 1, 1, "네 반갑습"], ["C1", 2, 2, "오늘 날씨"]]);
	assert.deepEqual(Object.keys(subs[0]), ["index", "startTime", "endTime", "startSec", "endSec", "text", "id", "spk", "srtNo"]);
	// id: C2 파일을 먼저 넣었으므로 C2가 5..10, C1이 11..17
	assert.deepEqual(subs.filter((s) => s.spk === "C2").map((s) => s.id), [5, 6, 7, 8, 9, 10]);
	assert.equal(d.nextId, 18);
	assert.deepEqual(plain(d.rowStates[11]), { presetId: "preset_3", params: [], _allParams: [], open: false, checked: false });
	assert.equal(d.rowStates[5].presetId, "preset_6");
	assert.deepEqual(plain(d.trashBin), []);
});

test("importIntoData: 없는 프리셋은 쓰지 않고, 이미 있는 salt는 그대로, 키 없는·빈 파일은 건너뛴다", () => {
	const { presets } = build();
	const d = emptyData();
	d.mi.salt = "abcd";
	const rep = plain(core.importIntoData(d, { files: [
		{ key: "C3", name: "", presetId: "preset_404", action: "new", file: fileOf("c3.srt"), cues: cuesOf("cap_C1.srt").slice(0, 2) },
		{ key: "", name: "", presetId: "", action: "", file: fileOf("x.srt"), cues: cuesOf("cap_C1.srt") },
		{ key: "C4", name: "", presetId: "", action: "new", file: fileOf("empty.srt"), cues: [] }
	] }, { now: 1, salt: "zzzz", presets }));
	assert.deepEqual(rep.files.map((f) => f.key), ["C3"]);
	assert.equal(d.mi.salt, "abcd");
	assert.equal(d.mi.cast.C3.presetId, "");
	assert.deepEqual(plain(d.mi.castOrder), ["C3"]);
	assert.equal(d.subtitles.length, 2);
	// 가져올 것이 없으면 salt도 만들지 않는다
	const e = emptyData();
	core.importIntoData(e, { files: [{ key: "C1", cues: [] }] }, { salt: "qqqq" });
	assert.equal(e.mi.salt, "");
});

test("importIntoData: 이미 있는 화자는 교체 — 살아 있는 줄은 휴지통(why replace, at, position), 다른 화자 줄은 그대로", () => {
	const d = emptyData();
	core.importIntoData(d, { files: [
		{ key: "C1", name: "철수", presetId: "", action: "new", file: fileOf("a_C1.srt"), cues: cuesOf("cap_C1.srt") },
		{ key: "C2", name: "영희", presetId: "", action: "new", file: fileOf("a_C2.srt"), cues: cuesOf("cap_interview_C2.srt") }
	] }, { now: 100, salt: "k7q2" });
	const c2Before = clone(d.subtitles.filter((s) => s.spk === "C2"));
	d.rowStates[d.subtitles[0].id].checked = true;
	const positions = d.subtitles.map((s, i) => [s.spk, i]).filter((x) => x[0] === "C1").map((x) => x[1]);
	const rep = plain(core.importIntoData(d, { files: [
		{ key: "C1", name: "", presetId: "", action: "replace", file: fileOf("b_C1.srt"), cues: cuesOf("cap_C1_edit.srt") }
	] }, { now: 200 }));
	assert.deepEqual(rep.files.map((f) => [f.key, f.action, f.name]), [["C1", "replace", "철수"]], "이름을 비우면 지금 이름");
	assert.equal(d.mi.cast.C1.file, "b_C1.srt");
	assert.equal(d.mi.cast.C1.color, 0, "색은 그대로");
	assert.equal(d.trashBin.length, 7);
	assert.ok(d.trashBin.every((t) => t.why === "replace" && t.at === 200 && t.sub.spk === "C1"));
	assert.deepEqual(d.trashBin.map((t) => t.position), positions, "옮기기 전 자리 (오름차순)");
	assert.equal(d.trashBin[0].state.checked, true, "후반 작업·체크 상태는 휴지통 항목에 남는다");
	assert.deepEqual(clone(d.subtitles.filter((s) => s.spk === "C2")), c2Before);
	const c1 = d.subtitles.filter((s) => s.spk === "C1");
	assert.deepEqual(c1.map((s) => s.index), [1, 2, 3, 4, 5, 6, 7, 8]);
	assert.ok(c1.every((s) => s.id > 13), "새 id");
});

test("trimAutoTrash: merge·replace 항목만 300개로 (오래된 at부터), 사용자 삭제는 그대로", () => {
	const trash = [];
	for (let i = 0; i < 5; i++) trash.push({ sub: { id: 1000 + i }, state: {}, position: 0 });
	for (let i = 0; i < 305; i++) trash.push({ sub: { id: i }, state: {}, position: 0, why: i % 2 ? "merge" : "replace", at: 10000 - i });
	const n = core.trimAutoTrash(trash, 300);
	assert.equal(n, 5);
	assert.equal(trash.length, 305);
	assert.equal(trash.filter((t) => !t.why).length, 5);
	assert.deepEqual(trash.filter((t) => t.why).map((t) => t.sub.id).slice(-3), [297, 298, 299], "at가 작은(오래된) 300~304가 빠졌다");
	assert.equal(core.TRASH_AUTO_MAX, 300);
});
