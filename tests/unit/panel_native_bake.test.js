"use strict";
// S1-11: 네이티브 MOGRT 굽기 — ▶·↑·프리셋 창 미리보기가 구운 사본(cache/{projKey}/baked/<키>.mogrt)을 텍스트 params 없이
// v27 호스트에 보낸다. 문구가 바뀐 줄은 네이티브 클립을 먼저 지운다(교체). 같은 문구는 같은 사본을 다시 쓴다. 정리(30일) — panelHarness
const test = require("node:test");
const assert = require("node:assert/strict");
const { bootPanel, cachePaths: P, CACHE_ROOT, projKeyOf } = require("../lib/panelHarness");
const { loadRegions } = require("../lib/loadRegions");
const { build } = require("../fixtures/presets_synth");
const N = require("../fixtures/mogrt/make_native_mogrt");

const core = loadRegions(["src/mi/core.ts"]);
const PROJ = "C:/work/native.prproj";
const A = { seqId: "natv-0001", seqName: "T_NAT", projPath: PROJ };
const SRC = "D:/MOGRT/합성 네이티브.mogrt";
const MTIME = 1727000000000;
const BAKED = CACHE_ROOT + "/" + projKeyOf(PROJ) + "/baked/";
const clone = (v) => JSON.parse(JSON.stringify(v));

function noErrors(h) {
	assert.deepEqual(h.errors().map((e) => String(e.message || e).slice(0, 300)), [], "패널 예외");
}
const tc = (sec) => {
	const ms = Math.round(sec * 1000);
	const p = (n, w) => String(n).padStart(w, "0");
	return "00:00:" + p(Math.floor(ms / 1000), 2) + "," + p(ms % 1000, 3);
};
const srtOf = (cues) => cues.map(([s, e, t], i) => (i + 1) + "\n" + tc(s) + " --> " + tc(e) + "\n" + t + "\n").join("\n");
const CUES = [[1, 3, "첫째 네이티브 합성 문장"], [4, 6, "둘째 네이티브 합성 문장"]];

function nativePreset() {
	const { NATIVE } = build();
	const params = clone(NATIVE);
	params[0].displayName = "합성 이름 칸";
	params[1].displayName = "합성 제목 칸";
	return { id: "preset_9", name: "네이티브 합성", mogrtPath: SRC, params, exposedIndices: [0, 1], textParamIndex: 0, exposedFontFields: {}, thumbnailData: null };
}
async function boot(opts) {
	const o = opts || {};
	const { presets } = build();
	const list = { preset_9: nativePreset(), preset_1: presets.preset_1 };
	const h = await bootPanel(Object.assign({
		seq: A,
		mogrts: [{ name: "합성 네이티브", path: SRC }, { name: presets.preset_1.name, path: presets.preset_1.mogrtPath }],
		params: { [SRC]: clone(build().NATIVE) },
		files: Object.assign({ [P.presets(PROJ)]: { presets: list, presetTrash: [], nextPresetId: 10 } }, o.files || {}),
		node: o.node === false ? undefined : { files: Object.assign({ [SRC]: { data: N.buildNativeMogrt(o.mogrt), mtimeMs: MTIME } }, o.nodeFiles || {}) }
	}, o.boot || {}));
	await h.advance(1000);
	h.host.handlers.applyToTimeline = () => "SUCCESS: MOGRT 0개 + 텍스트 레이어 0개 배치 완료 (하네스)";
	return h;
}
function setSel(h, el, v) {
	el.value = v;
	h.change(el);
}
function typeField(h, id, fid, text) {
	const badge = h.$("params-" + id).querySelectorAll(".fid-badge").find((b) => b.textContent === fid);
	assert.ok(badge, "#" + id + " " + fid + " 배지");
	const ta = badge.parentNode.parentNode.querySelector("textarea");
	ta.value = text;
	ta.dispatchEvent({ type: "input" });
}
const calls = (h, fn) => h.host.calls.filter((c) => c.fn === fn).map((c) => JSON.parse(c.args[0]));
const resOf = (h, id) => { const el = h.$("row-" + id).querySelector(".sub-res"); return el ? el.textContent : null; };
// JSZip은 진짜 setImmediate로 돈다 → 조건이 맞을 때까지 여러 번 비운다
async function until(h, cond, what) {
	for (let i = 0; i < 400; i++) {
		if (cond()) return;
		await h.flush();
	}
	assert.fail("기다리다 끝남: " + what + " — 상태 줄 " + h.status().text);
}
async function rowsWith(h, presetIds, cues) {
	await h.dropSrt("native.srt", srtOf(cues || CUES));
	const ids = h.snapshot().subtitles.map((s) => s.id);
	ids.forEach((id, k) => setSel(h, h.$("sel-" + id), presetIds[k] || presetIds[0]));
	await h.flush();
	return ids;
}
async function apply(h) {
	const n = h.host.calls.filter((c) => c.fn === "applyToTimeline").length;
	h.$("btnApply").click();
	await until(h, () => h.host.calls.filter((c) => c.fn === "applyToTimeline").length > n || /놓을 줄이 없습니다|멈췄습니다|취소했습니다/.test(h.status().text), "▶ 끝");
	await h.flush();
}
const keyOf = (texts) => core.nativeBakeKey(SRC, MTIME, texts);
const bakedFile = (h, key) => h.nodeFs.files.get(BAKED + key + ".mogrt");

test("▶: 네이티브 줄은 구운 사본을 텍스트 params 없이 보내고(처음은 그 자리 네이티브 클립을 지운다), 사본은 definition·모든 prgraphic에 문구가 들어 있다", async () => {
	const h = await boot();
	const ids = await rowsWith(h, ["preset_9"]);
	await apply(h);
	const k1 = keyOf([CUES[0][2], ""]);
	const k2 = keyOf([CUES[1][2], ""]);
	assert.deepEqual(calls(h, "removeNativeClipsAt"), [{ t: 2, s: [1, 4] }], "처음은 지금 자리 (v27이 빈 글자로 놓은 네이티브 클립일 수 있다)");
	const sent = calls(h, "applyToTimeline");
	assert.equal(sent.length, 1);
	assert.deepEqual(sent[0], {
		videoTrackIndex: 2,
		subtitles: [
			{ mogrtPath: BAKED + k1 + ".mogrt", startSec: 1, endSec: 3, text: CUES[0][2], params: [] },
			{ mogrtPath: BAKED + k2 + ".mogrt", startSec: 4, endSec: 6, text: CUES[1][2], params: [] }
		]
	});
	// 구운 사본
	[[k1, CUES[0][2]], [k2, CUES[1][2]]].forEach(([k, cap]) => {
		const f = bakedFile(h, k);
		assert.ok(f, "사본 " + k);
		const r = N.readNativeMogrt(f.data);
		assert.equal(r.def.capsuleID, core.uuidFromHash(k), "capsuleID = 문구에서 정한 UUID");
		assert.equal(r.def.capsuleName, "합성 네이티브 [MI]");
		assert.deepEqual(r.def.clientControls.filter((c) => c.type === 6).map((c) => c.value.strDB.map((e) => e.str)), [[cap, cap], ["", ""]]);
		assert.match(r.defText, /"ticksperframe":9223372036854775807/, "int64 글자 그대로");
		assert.deepEqual(Object.keys(r.graphics), ["project.prgraphic", "project_ko_KR.prgraphic"]);
		Object.values(r.graphics).forEach((g) => {
			assert.deepEqual(g.entries.map((e) => [e.gz, e.texts]), [[true, [cap, ""]]], "gzip .prproj의 Source Text");
			g.entries.forEach((e) => e.refs.forEach((hh) => assert.ok(hh in e.full, "끊긴 참조 없음")));
		});
		assert.equal(r.graphics["project_ko_KR.prgraphic"].entries[0].name, "무제.prproj", "한글 항목 이름 그대로");
		assert.deepEqual(r.names.filter((n) => /^thumb/.test(n)), ["thumb.png"], "썸네일 동영상·지역화 썸네일은 뺀다");
	});
	let s = h.snapshot();
	ids.forEach((id, i) => {
		assert.equal(s.rowStates[id].ap.nk, [k1, k2][i], "ap.nk");
		assert.equal(s.rowStates[id].ap.t, 2);
	});
	assert.equal(h.fs.readJson(P.session(PROJ, A.seqId)).rowStates[ids[0]].ap.nk, k1, "저장");
	assert.equal(h.status().cls, "ok", h.status().text);
	// 같은 문구로 다시 ▶: 지우지 않고(v27이 끝만 맞춘다) 같은 사본을 다시 쓴다
	const writes = h.nodeFs.writes.length;
	await apply(h);
	assert.equal(calls(h, "removeNativeClipsAt").length, 1, "다시 지우지 않는다");
	assert.deepEqual(calls(h, "applyToTimeline")[1], sent[0], "같은 사본 경로");
	assert.equal(h.nodeFs.writes.length, writes, "다시 굽지 않는다");
	// 둘째 줄 캡션만 고침 → 그 자리만 지우고 새 사본
	typeField(h, ids[1], "T1", "둘째 줄 고친 합성");
	await apply(h);
	const k2b = keyOf(["둘째 줄 고친 합성", ""]);
	assert.deepEqual(calls(h, "removeNativeClipsAt")[1], { t: 2, s: [4] }, "바뀐 줄 자리만");
	assert.deepEqual(calls(h, "applyToTimeline")[2].subtitles.map((x) => x.mogrtPath), [BAKED + k1 + ".mogrt", BAKED + k2b + ".mogrt"]);
	assert.deepEqual(N.readNativeMogrt(bakedFile(h, k2b).data).graphics["project.prgraphic"].entries[0].texts, ["둘째 줄 고친 합성", ""]);
	s = h.snapshot();
	assert.equal(s.rowStates[ids[1]].ap.nk, k2b);
	assert.equal(calls(h, "updateClipAtTime").length + calls(h, "applyPreviewParams").length, 0, "Source Text에 쓰는 호출 없음");
	noErrors(h);
});

test("↑: 네이티브 줄은 굽고 → 바뀌었으면 지우고 → applyToTimeline 한 줄 (updateClipAtTime·텍스트 params 없음)", async () => {
	const h = await boot();
	const ids = await rowsWith(h, ["preset_9"]);
	const up = (id) => h.$("row-" + id).querySelector(".btn-update").click();
	up(ids[0]);
	await until(h, () => calls(h, "applyToTimeline").length === 1, "↑ 1");
	await h.flush();
	const k1 = keyOf([CUES[0][2], ""]);
	assert.deepEqual(calls(h, "removeNativeClipsAt"), [{ t: 2, s: [1] }]);
	assert.deepEqual(calls(h, "applyToTimeline")[0], { videoTrackIndex: 2, subtitles: [{ mogrtPath: BAKED + k1 + ".mogrt", startSec: 1, endSec: 3, text: CUES[0][2], params: [] }] });
	assert.equal(h.snapshot().rowStates[ids[0]].ap.nk, k1);
	assert.equal(h.status().text, "[1] 네이티브 클립 교체 완료");
	// 그대로 다시 ↑: 지우지 않는다
	up(ids[0]);
	await until(h, () => calls(h, "applyToTimeline").length === 2, "↑ 2");
	await h.flush();
	assert.equal(calls(h, "removeNativeClipsAt").length, 1);
	assert.equal(h.status().text, "[1] 네이티브 클립 적용 완료");
	// 후반 작업 필드(T2)를 고치면 교체
	typeField(h, ids[0], "T2", "후반 작업 합성");
	up(ids[0]);
	await until(h, () => calls(h, "applyToTimeline").length === 3, "↑ 3");
	await h.flush();
	const k1b = keyOf([CUES[0][2], "후반 작업 합성"]);
	assert.deepEqual(calls(h, "removeNativeClipsAt")[1], { t: 2, s: [1] });
	assert.equal(calls(h, "applyToTimeline")[2].subtitles[0].mogrtPath, BAKED + k1b + ".mogrt");
	assert.deepEqual(N.readNativeMogrt(bakedFile(h, k1b).data).def.clientControls.filter((c) => c.type === 6).map((c) => c.value.strDB[0].str), [CUES[0][2], "후반 작업 합성"]);
	assert.equal(calls(h, "updateClipAtTime").length, 0);
	// v27 결과에 실패가 있으면 ap를 적지 않는다
	h.host.handlers.applyToTimeline = () => "SUCCESS: MOGRT 0개 + 텍스트 레이어 0개 배치 완료 (실패 1개)";
	typeField(h, ids[0], "T2", "후반 작업 다시 합성");
	up(ids[0]);
	await until(h, () => calls(h, "applyToTimeline").length === 4, "↑ 4");
	await h.flush();
	assert.equal(h.snapshot().rowStates[ids[0]].ap.nk, k1b, "그대로");
	assert.equal(h.status().cls, "err");
	noErrors(h);
});

test("AE 줄과 섞인 목록: AE 줄은 v27 바이트 그대로, 네이티브 줄만 굽는다. AE만 있는 목록은 굽기·지우기를 하지 않는다", async () => {
	const h = await boot();
	const ids = await rowsWith(h, ["preset_1", "preset_9"]);
	await apply(h);
	const s = h.snapshot();
	const sent = calls(h, "applyToTimeline")[0];
	assert.deepEqual(sent.subtitles[0], { mogrtPath: s.presets.preset_1.mogrtPath, startSec: 1, endSec: 3, text: CUES[0][2], params: s.rowStates[ids[0]]._allParams }, "AE 줄 v27 바이트");
	assert.equal(sent.subtitles[1].mogrtPath, BAKED + keyOf([CUES[1][2], ""]) + ".mogrt");
	assert.deepEqual(calls(h, "removeNativeClipsAt"), [{ t: 2, s: [4] }], "네이티브 줄 자리만");
	assert.equal(s.rowStates[ids[0]].ap, undefined, "AE 줄은 v27처럼 ap 없음");
	noErrors(h);

	const h2 = await boot();
	await rowsWith(h2, ["preset_1"]);
	await apply(h2);
	assert.equal(calls(h2, "removeNativeClipsAt").length, 0);
	assert.equal(h2.nodeFs.writes.length, 0, "굽지 않는다");
	assert.ok(calls(h2, "applyToTimeline")[0].subtitles.every((x) => x.params.length > 0));
	noErrors(h2);
});

test("전에 네이티브로 놓은 줄을 AE 프리셋으로 바꾸면 그 네이티브 클립을 먼저 지운다 (v27이 네이티브 클립에 AE 속성을 쓰지 않게) — ▶·↑", async () => {
	const h = await boot();
	const ids = await rowsWith(h, ["preset_9"]);
	await apply(h);
	// ▶: 구조가 바뀐 줄(ap.ps가 네이티브 서명) → 확인창. 안전하게 적용은 그 줄을 제자리에서 고치지 않는다
	setSel(h, h.$("sel-" + ids[0]), "preset_1");
	await h.flush();
	h.$("btnApply").click();
	await h.flush();
	assert.equal(h.$("confirmModal").classList.contains("open"), true, "확인창");
	assert.equal(h.$("confirmYes").textContent, "안전하게 적용 (0)", "네이티브 클립에는 제자리 갱신을 하지 않는다");
	h.$("confirmAlt").click();
	await until(h, () => calls(h, "applyToTimeline").length === 2, "전체 적용");
	await h.flush();
	// v27이 1초에 AE 템플릿을 새로 놓는다(약 5초 창 [1, 6.6)) → 4초 네이티브 줄도 연쇄로 지우고 다시 놓는다 (머리 잘림 방지)
	assert.deepEqual(calls(h, "removeNativeClipsAt")[1], { t: 2, s: [1, 4] });
	const sent = calls(h, "applyToTimeline")[1];
	assert.equal(sent.subtitles[0].mogrtPath, h.snapshot().presets.preset_1.mogrtPath);
	assert.equal(sent.subtitles[1].mogrtPath, BAKED + keyOf([CUES[1][2], ""]) + ".mogrt", "그대로인 네이티브 줄은 같은 사본");
	assert.equal(h.snapshot().rowStates[ids[0]].ap.nk, undefined, "AE로 놓았다");
	assert.equal(h.status().cls, "ok", h.status().text);
	// ↑: 둘째 줄도 AE로 바꾸고 ↑ → 그 네이티브 클립을 지운 뒤 v27 applyToTimeline 한 줄 (updateClipAtTime은 ±0.5초 안의
	// 다른 클립을 잡거나 insertClip으로 뒤 클립을 밀 수 있다)
	setSel(h, h.$("sel-" + ids[1]), "preset_1");
	await h.flush();
	h.$("row-" + ids[1]).querySelector(".btn-update").click();
	await until(h, () => calls(h, "applyToTimeline").length === 3, "↑");
	await h.flush();
	assert.deepEqual(calls(h, "removeNativeClipsAt")[2], { t: 2, s: [4] });
	const s = h.snapshot();
	// 속성은 ↑가 보내던 그대로 (구조가 바뀐 줄 → 이름으로: namedParams)
	assert.deepEqual(calls(h, "applyToTimeline")[2], { videoTrackIndex: 2, subtitles: [{ mogrtPath: s.presets.preset_1.mogrtPath, startSec: 4, endSec: 6, text: CUES[1][2], params: clone(core.namedParams(s.rowStates[ids[1]]._allParams)) }] });
	assert.equal(calls(h, "updateClipAtTime").length, 0);
	assert.equal(s.rowStates[ids[1]].ap.nk, undefined);
	assert.equal(s.rowStates[ids[1]].ap.s, 4);
	assert.equal(h.status().text, "[2] 네이티브 클립을 AE 템플릿으로 교체 완료");
	noErrors(h);
});

test("굽지 못하면 놓지 않고 줄에 까닭을 적는다: Node 없음, 새 형식(이진) 템플릿, TextLayer 수가 다름. 지우기 실패는 적용을 멈춘다", async () => {
	// Node 없음 (하네스 기본값)
	let h = await boot({ node: false });
	let ids = await rowsWith(h, ["preset_9"]);
	await apply(h);
	assert.equal(calls(h, "applyToTimeline").length, 0, "놓을 줄이 없다");
	assert.equal(calls(h, "removeNativeClipsAt").length, 0);
	assert.match(h.status().text, /^타임라인에 놓을 줄이 없습니다 — 네이티브 2줄은 문구를 굽지 못해 놓지 않았습니다/);
	assert.equal(resOf(h, ids[0]), "네이티브 굽기 실패: Node 모듈을 쓸 수 없음");
	noErrors(h);
	// 새 형식 (Source Text가 이진)
	h = await boot({ mogrt: { format: "binary" } });
	ids = await rowsWith(h, ["preset_9", "preset_1"]);
	await apply(h);
	const sent = calls(h, "applyToTimeline")[0];
	assert.equal(sent.subtitles.length, 1, "AE 줄만 놓는다");
	assert.match(resOf(h, ids[0]), /^네이티브 굽기 실패: 이 템플릿의 텍스트 형식을 모름 \(새 형식\) \(project\.prgraphic: Source Text 0 · 필드 2\)$/);
	assert.equal(h.status().cls, "err");
	assert.match(h.status().text, /네이티브 1줄은 문구를 굽지 못해/);
	assert.equal([...h.nodeFs.files.keys()].filter((k) => k.indexOf(BAKED) === 0).length, 0, "사본을 남기지 않는다");
	noErrors(h);
	// TextLayer 3개 템플릿에 필드 2개 프리셋
	h = await boot({ mogrt: { texts: ["가 합성", "나 합성", "다 합성"] } });
	ids = await rowsWith(h, ["preset_9"]);
	await apply(h);
	assert.match(resOf(h, ids[0]), /^네이티브 굽기 실패: 텍스트 필드 수가 템플릿과 다름 \(TextLayer 3 · 필드 2\)$/);
	noErrors(h);
	// 지우기 실패 (활성 시퀀스 없음)
	h = await boot();
	await rowsWith(h, ["preset_9"]);
	h.host.handlers.removeNativeClipsAt = () => "ERROR: no-seq";
	await apply(h);
	assert.equal(calls(h, "applyToTimeline").length, 0);
	assert.equal(h.status().text, "네이티브 클립을 지우지 못해 적용을 멈췄습니다: no-seq");
	assert.equal(h.$("btnApply").disabled, false);
	noErrors(h);
	// 활성 시퀀스가 작업 시퀀스가 아니다 (적용 중에 바꿨다): 지우지 않았고 놓지도 않는다
	h = await boot();
	await rowsWith(h, ["preset_9"]);
	h.host.handlers.removeNativeClipsAt = () => "ERROR: seq-changed";
	await apply(h);
	assert.equal(calls(h, "applyToTimeline").length, 0);
	assert.equal(h.status().text, "시퀀스가 바뀌어 적용을 취소했습니다");
	noErrors(h);
});

test("빈 요소 참조가 있는 템플릿도 두 필드가 제 문구를 받는다 (패널 굽기 전체 경로)", async () => {
	const h = await boot({ mogrt: { texts: ["같은 기본 문구", "같은 기본 문구"], selfRef: true, localized: false } });
	const ids = await rowsWith(h, ["preset_9"], [[1, 3, "빈 요소 합성 캡션"]]);
	typeField(h, ids[0], "T2", "빈 요소 합성 후반");
	await apply(h);
	const r = N.readNativeMogrt(bakedFile(h, keyOf(["빈 요소 합성 캡션", "빈 요소 합성 후반"])).data);
	const e = r.graphics["project.prgraphic"].entries[0];
	assert.deepEqual(e.texts, ["빈 요소 합성 캡션", "빈 요소 합성 후반"]);
	e.refs.forEach((hh) => assert.ok(hh in e.full, "끊긴 참조 없음"));
	noErrors(h);
});

test("프리셋 창 미리보기: 네이티브는 지금 문구를 구운 사본을 프리뷰에 놓고 applyPreviewParams를 부르지 않는다", async () => {
	const h = await boot();
	const edit = h.$("presetList").querySelectorAll("button").filter((b) => b.textContent === "편집");
	const btn = edit.find((b) => { for (let x = b.parentNode; x; x = x.parentNode) if (x.textContent && x.textContent.indexOf("네이티브 합성") !== -1 && x.querySelectorAll("button").filter((y) => y.textContent === "편집").length === 1) return true; return false; });
	assert.ok(btn, "편집 버튼");
	btn.click();
	await h.flush();
	await h.advance(1300);
	const key = keyOf(["", ""]);
	await until(h, () => h.host.calls.some((c) => c.fn === "setupPreviewSequence" && JSON.parse(c.args[0]).mogrtPath === BAKED + key + ".mogrt"), "미리보기 굽기");
	await h.advance(10);
	await h.flush();
	assert.equal(h.host.calls.filter((c) => c.fn === "applyPreviewParams").length, 0, "Source Text에 쓰지 않는다");
	assert.ok(bakedFile(h, key), "구운 사본");
	noErrors(h);
});

test("정리: 어떤 줄도 가리키지 않고 30일 넘게 쓰지 않은 사본과 하루 넘은 .tmp만 지운다 (다른 시퀀스 세션이 가리키면 둔다)", async () => {
	const day = 24 * 3600 * 1000;
	const old = Date.now() - 40 * day;
	const kOld = "1".repeat(32);
	const kRef = "2".repeat(32);
	const kNew = "3".repeat(32);
	const otherSeq = P.session(PROJ, "other-0002");
	const h = await boot({
		files: { [otherSeq]: { subtitles: [], rowStates: { 5: { presetId: "preset_9", params: [], _allParams: [], ap: { s: 1, e: 2, t: 2, nk: kRef } } }, trashBin: [], nextId: 6 } },
		nodeFiles: {
			[BAKED + kOld + ".mogrt"]: { data: "x", mtimeMs: old },
			[BAKED + kRef + ".mogrt"]: { data: "x", mtimeMs: old },
			[BAKED + kNew + ".mogrt"]: { data: "x", mtimeMs: Date.now() - day },
			[BAKED + kOld + ".mogrt.abc123.tmp"]: { data: "x", mtimeMs: Date.now() - 2 * day },
			[BAKED + "메모.txt"]: { data: "x", mtimeMs: old }
		}
	});
	await rowsWith(h, ["preset_9"]);
	await apply(h);
	const left = [...h.nodeFs.files.keys()].filter((k) => k.indexOf(BAKED) === 0).map((k) => k.slice(BAKED.length)).sort();
	assert.deepEqual(left, [kRef + ".mogrt", kNew + ".mogrt", keyOf([CUES[0][2], ""]) + ".mogrt", keyOf([CUES[1][2], ""]) + ".mogrt", "메모.txt"].sort());
	noErrors(h);
});

test("removeNativeClipsAt 식(ExtendScript): 시작이 반 프레임 안이고 MGT 컴포넌트가 없고 Text 컴포넌트가 있는 클립만 지운다", async () => {
	const h = await boot();
	let script = "";
	h.win.CSInterface.prototype.evalScript = (s, cb) => { script = s; Promise.resolve().then(() => cb("SUCCESS: 0")); };
	await h.win._mogrtDebug.removeNativeClipsAt({ t: 2, s: [2.002, 6.006] });
	assert.match(script, /^\/\*host:removeNativeClipsAt \{"t":2,"s":\[2\.002,6\.006\]\}\*\/\(function\(t,s,id\)\{/);
	assert.match(script, /\)\(2,\[2\.002,6\.006\],decodeURIComponent\("natv-0001"\)\)$/, "작업 시퀀스 식별자를 넘긴다");
	assert.match(script, /^[\x20-\x7e]*$/, "ASCII만");
	// 모의 Premiere 객체로 식을 돌린다
	const removed = [];
	const clip = (name, start, opts) => ({
		name, start: { seconds: start },
		getMGTComponent: () => (opts.mgt ? {} : null),
		components: (() => { const list = (opts.comps || []).map((m) => ({ matchName: m })); list.numItems = list.length; return list; })(),
		remove: () => { removed.push(name); return true; }
	});
	const G = ["ADBE Opacity", "ADBE Motion", "AE.ADBE Text", "AE.ADBE Text", "AE.ADBE Shape"];
	const clips = [
		clip("네이티브 맞음", 2.0020833, { comps: G }),
		clip("AE MOGRT", 6.0062, { mgt: true, comps: ["AE.ADBE Capsule"] }),
		clip("영상", 6.006, { comps: ["ADBE Opacity", "ADBE Motion"] }),
		clip("반 프레임 밖", 2.03, { comps: G }),
		clip("네이티브 둘째", 6.0, { comps: G })
	];
	clips.numItems = clips.length;
	const seq = { sequenceID: "natv-0001", name: "T_NAT", videoTracks: [null, null, { clips }], getSettings: () => ({ videoFrameRate: { seconds: 1001 / 24000 } }) };
	const run = (active) => new Function("app", "return " + script.replace(/^\/\*[^*]*\*\//, ""))({ project: { activeSequence: active } });
	assert.equal(run(seq), "SUCCESS: 2");
	assert.deepEqual(removed.sort(), ["네이티브 둘째", "네이티브 맞음"]);
	assert.equal(run(null), "ERROR: no-seq");
	// 다른 시퀀스가 활성이면 지우지 않는다 (적용 중에 시퀀스를 바꿨다)
	removed.length = 0;
	assert.equal(run(Object.assign({}, seq, { sequenceID: "other-0002" })), "ERROR: seq-changed");
	assert.deepEqual(removed, []);
	// 트랙이 없으면 지울 것이 없다 → 성공 0 (v27은 그 번호로도 놓는다: 전체 적용을 멈추지 않는다)
	assert.equal(run(Object.assign({}, seq, { videoTracks: [null, null] })), "SUCCESS: 0");
	noErrors(h);
});

// 2초 간격 네이티브 세 줄: 새 클립(약 5초)이 뒤 두 줄의 클립 자리를 덮는다
const CLOSE = [[1, 2.5, "가까운 첫째 합성"], [3, 4.5, "가까운 둘째 합성"], [5, 6.5, "가까운 셋째 합성"]];

test("연쇄 ▶: 바뀐 줄의 새 클립 창(약 5초) 안에 있는 뒤 네이티브 줄도 지우고 시작 순서로 다시 놓는다 (머리 잘림 방지)", async () => {
	const h = await boot();
	const ids = await rowsWith(h, ["preset_9"], CLOSE);
	await apply(h);
	const keys = CLOSE.map((c) => keyOf([c[2], ""]));
	assert.deepEqual(calls(h, "removeNativeClipsAt"), [{ t: 2, s: [1, 3, 5] }], "처음 (ap 없음)");
	typeField(h, ids[0], "T1", "가까운 첫째 고침 합성");
	await apply(h);
	const k0 = keyOf(["가까운 첫째 고침 합성", ""]);
	assert.deepEqual(calls(h, "removeNativeClipsAt")[1], { t: 2, s: [1, 3, 5] }, "첫째 창 [1, 6.6) → 둘째(3초) → 둘째 창 → 셋째(5초)");
	assert.deepEqual(calls(h, "applyToTimeline")[1].subtitles.map((x) => [x.startSec, x.mogrtPath]), [[1, BAKED + k0 + ".mogrt"], [3, BAKED + keys[1] + ".mogrt"], [5, BAKED + keys[2] + ".mogrt"]]);
	const s = h.snapshot();
	assert.deepEqual(ids.map((id) => s.rowStates[id].ap.nk), [k0, keys[1], keys[2]]);
	assert.equal(h.status().cls, "ok", h.status().text);
	// 셋째만 바꾸면 창 안에 뒤 줄이 없어 셋째만
	typeField(h, ids[2], "T1", "가까운 셋째 고침 합성");
	await apply(h);
	assert.deepEqual(calls(h, "removeNativeClipsAt")[2], { t: 2, s: [5] });
	noErrors(h);
});

test("연쇄 ↑: 대상 밖 뒤 네이티브 줄은 마지막 적용 그대로(ap.nk 사본, ap 시간) 다시 놓고 ap는 그대로. 사본이 없거나 AE 줄이면 위험 표시", async () => {
	const h = await boot();
	const ids = await rowsWith(h, ["preset_9"], CLOSE);
	await apply(h);
	const keys = CLOSE.map((c) => keyOf([c[2], ""]));
	const before = h.snapshot();
	// 둘째 줄 문구를 고쳐 두지만 적용하지 않는다 → ↑ 첫째의 연쇄는 둘째를 '적용한 문구' 그대로 다시 놓는다
	typeField(h, ids[1], "T1", "둘째 적용 안 한 고침");
	typeField(h, ids[0], "T2", "첫째 후반 합성");
	h.$("row-" + ids[0]).querySelector(".btn-update").click();
	await until(h, () => calls(h, "applyToTimeline").length === 2, "↑");
	await h.flush();
	const k0 = keyOf([CLOSE[0][2], "첫째 후반 합성"]);
	assert.deepEqual(calls(h, "removeNativeClipsAt")[1], { t: 2, s: [1, 3, 5] });
	assert.deepEqual(calls(h, "applyToTimeline")[1].subtitles.map((x) => [x.startSec, x.endSec, x.mogrtPath, x.params.length]),
		[[1, 2.5, BAKED + k0 + ".mogrt", 0], [3, 4.5, BAKED + keys[1] + ".mogrt", 0], [5, 6.5, BAKED + keys[2] + ".mogrt", 0]]);
	let s = h.snapshot();
	assert.equal(s.rowStates[ids[0]].ap.nk, k0);
	assert.deepEqual(s.rowStates[ids[1]].ap, before.rowStates[ids[1]].ap, "대상 밖 줄의 ap는 그대로");
	assert.equal(h.status().text, "[1] 네이티브 클립 교체 완료 — 바로 뒤 네이티브 줄 2개도 그대로 다시 놓았습니다");
	// 셋째 줄 사본이 없어졌고(정리), 둘째 줄은 AE로 놓았다 → ↑ 첫째: 둘째(AE)·셋째(사본 없음)는 위험
	h.nodeFs.files.delete(BAKED + keys[2] + ".mogrt");
	setSel(h, h.$("sel-" + ids[1]), "preset_1");
	await h.flush();
	h.$("row-" + ids[1]).querySelector(".btn-update").click();
	await until(h, () => calls(h, "applyToTimeline").length === 3, "AE ↑");
	await h.flush();
	// 둘째 AE 클립의 창 [3, 8.6) 안의 셋째는 사본이 없어 다시 놓지 못한다 → 위험
	assert.deepEqual(calls(h, "removeNativeClipsAt").slice(-1)[0], { t: 2, s: [3] });
	assert.deepEqual(calls(h, "applyToTimeline")[2].subtitles.map((x) => x.startSec), [3]);
	assert.equal(h.status().text, "[2] 네이티브 클립을 AE 템플릿으로 교체 완료 — 뒤 줄 1개는 새로 놓은 클립(약 5초)에 앞부분이 잘렸을 수 있습니다 (줄에 표시)");
	assert.equal(resOf(h, ids[2]), "앞부분이 잘렸을 수 있음 (앞 줄 네이티브 교체)");
	assert.equal(h.snapshot().rowStates[ids[1]].ap.nk, undefined, "둘째는 AE로 놓았다 (ap 있음)");
	typeField(h, ids[0], "T2", "첫째 후반 다시 합성");
	h.$("row-" + ids[0]).querySelector(".btn-update").click();
	await until(h, () => calls(h, "applyToTimeline").length === 4, "↑ 2");
	await h.flush();
	assert.deepEqual(calls(h, "removeNativeClipsAt").slice(-1)[0], { t: 2, s: [1] }, "위험한 줄은 지우지 않는다");
	assert.equal(calls(h, "applyToTimeline")[3].subtitles.length, 1);
	assert.equal(resOf(h, ids[1]), "앞부분이 잘렸을 수 있음 (앞 줄 네이티브 교체)");
	assert.equal(resOf(h, ids[2]), "앞부분이 잘렸을 수 있음 (앞 줄 네이티브 교체)");
	assert.equal(h.status().text, "[1] 네이티브 클립 교체 완료 — 뒤 줄 2개는 새로 놓은 클립(약 5초)에 앞부분이 잘렸을 수 있습니다 (줄에 표시)");
	assert.equal(h.status().cls, "err");
	s = h.snapshot();
	noErrors(h);
});

// ── 리뷰 반영 (S1-11) ──
const RISK = "앞부분이 잘렸을 수 있음 (앞 줄 네이티브 교체)";
// ▶ 확인창이 뜨면 '지금 방식으로 전체 적용'을 누른다
async function applyAll(h) {
	const n = calls(h, "applyToTimeline").length;
	h.$("btnApply").click();
	await h.flush();
	if (h.$("confirmModal").classList.contains("open")) h.$("confirmAlt").click();
	await until(h, () => calls(h, "applyToTimeline").length > n || /놓을 줄이 없습니다|멈췄습니다|취소했습니다/.test(h.status().text), "▶ 끝");
	await h.flush();
}

test("▶ 위험 표시는 남는다: 새 네이티브 클립 창 안의 AE 대상 줄(ap 있음)은 ap를 다시 적지 않고 표시를 지우지 않는다", async () => {
	const h = await boot();
	const ids = await rowsWith(h, ["preset_9"], CLOSE);
	await apply(h);
	setSel(h, h.$("sel-" + ids[1]), "preset_1");
	await h.flush();
	await applyAll(h);
	const before = clone(h.snapshot().rowStates[ids[1]].ap);
	assert.ok(before && !before.nk, "둘째는 AE로 놓았다 (ap 있음, nk 없음)");
	typeField(h, ids[0], "T1", "가까운 첫째 위험 합성");
	await apply(h);
	assert.deepEqual(calls(h, "removeNativeClipsAt").slice(-1)[0], { t: 2, s: [1, 5] }, "AE 줄(3초)은 지우지 않고, 5초 네이티브는 연쇄");
	const s = h.snapshot();
	assert.equal(resOf(h, ids[1]), RISK, "▶가 끝난 뒤에도 표시가 남는다");
	assert.deepEqual(s.rowStates[ids[1]].ap, before, "머리가 잘렸을 수 있는 클립을 검증된 적용으로 적지 않는다");
	assert.equal(s.rowStates[ids[0]].ap.nk, keyOf(["가까운 첫째 위험 합성", ""]));
	assert.equal(h.status().cls, "err");
	assert.match(h.status().text, /뒤 줄 1개는 새로 놓은 클립\(약 5초\)에 앞부분이 잘렸을 수 있습니다/);
	noErrors(h);
});

test("▶ ap가 없는 AE 줄: 트랙에 그 줄 클립이 있으면(getTimelineClips) 창 안에서 위험, 아직 놓지 않았으면 표시하지 않는다", async () => {
	const h = await boot();
	const ids = await rowsWith(h, ["preset_9", "preset_1", "preset_9"], CLOSE);
	// 처음 ▶: 트랙이 비어 있다 → AE 줄은 v27이 네이티브 뒤에 새로 놓는다 (위험 아님)
	await apply(h);
	assert.equal(calls(h, "getTimelineClips").length, 1, "새로 놓는 네이티브 줄이 있어 트랙을 읽는다");
	assert.deepEqual(calls(h, "getTimelineClips")[0], { videoTrackIndex: 2 });
	assert.equal(resOf(h, ids[1]), null);
	assert.equal(h.status().cls, "ok", h.status().text);
	// 그대로 다시 ▶: 새로 놓는 줄이 없으면 읽지 않는다
	await apply(h);
	assert.equal(calls(h, "getTimelineClips").length, 1);
	// 첫째 문구를 고치고 ▶: 3초 AE 클립(프레임 스냅 12ms)이 첫째 창 [1, 6.6) 안에 있다
	h.host.handlers.getTimelineClips = () => JSON.stringify([1, 2.988, 5].map((s) => ({ startSec: s, endSec: s + 1.5, name: "x" })));
	typeField(h, ids[0], "T1", "가까운 첫째 섞인 합성");
	await apply(h);
	assert.deepEqual(calls(h, "removeNativeClipsAt").slice(-1)[0], { t: 2, s: [1, 5] });
	assert.equal(resOf(h, ids[1]), RISK);
	assert.equal(h.snapshot().rowStates[ids[1]].ap, undefined, "v27 AE 줄은 ap를 적지 않는다");
	assert.equal(h.status().cls, "err");
	// 트랙을 읽지 못하면 ap가 없는 줄은 모르는 채로 (전과 같다: 위험으로 세지 않는다)
	h.host.handlers.getTimelineClips = () => "ERROR: 트랙 접근 실패";
	typeField(h, ids[0], "T1", "가까운 첫째 섞인 합성 둘");
	await apply(h);
	assert.equal(h.status().cls, "ok", h.status().text);
	assert.doesNotMatch(h.status().text, /잘렸을/);
	noErrors(h);
});

test("↑ 네이티브 → AE: AE 템플릿 길이(definition 10초) 창 안의 뒤 네이티브 줄도 연쇄로 다시 놓는다", async () => {
	const { presets } = build();
	const AE = presets.preset_1.mogrtPath;
	const cues = [[1, 2.5, "긴 AE 첫째 합성"], [8, 9.5, "긴 AE 둘째 합성"]];
	const h = await boot({ nodeFiles: { [AE]: { data: N.buildNativeMogrt({ durationSec: 10 }), mtimeMs: MTIME } } });
	const ids = await rowsWith(h, ["preset_9"], cues);
	await apply(h);
	const k2 = keyOf([cues[1][2], ""]);
	setSel(h, h.$("sel-" + ids[0]), "preset_1");
	await h.flush();
	h.$("row-" + ids[0]).querySelector(".btn-update").click();
	await until(h, () => calls(h, "applyToTimeline").length === 2, "↑");
	await h.flush();
	assert.deepEqual(calls(h, "removeNativeClipsAt").slice(-1)[0], { t: 2, s: [1, 8] }, "창 [1, 11.6) → 8초 줄");
	assert.deepEqual(calls(h, "applyToTimeline")[1].subtitles.map((x) => [x.startSec, x.mogrtPath]), [[1, AE], [8, BAKED + k2 + ".mogrt"]]);
	assert.equal(h.status().text, "[1] 네이티브 클립을 AE 템플릿으로 교체 완료 — 바로 뒤 네이티브 줄 1개도 그대로 다시 놓았습니다");
	assert.equal(calls(h, "updateClipAtTime").length, 0);
	noErrors(h);
});

test("패널을 다시 연 뒤 다시 쓰는 사본·대상 밖 줄도 템플릿 길이(definition 9초)로 연쇄 창을 잡는다", async () => {
	const cues = [[1, 2.5, "다시 연 첫째 합성"], [8, 9.5, "다시 연 둘째 합성"], [15.5, 16.5, "다시 연 셋째 합성"]];
	const mogrt = { durationSec: 9 };
	const h = await boot({ mogrt });
	const ids = await rowsWith(h, ["preset_9"], cues);
	await apply(h);
	typeField(h, ids[0], "T1", "다시 연 첫째 고침 합성");
	await apply(h);
	assert.deepEqual(calls(h, "removeNativeClipsAt").slice(-1)[0], { t: 2, s: [1, 8, 15.5] }, "9초 창의 연쇄 (새로 구운 사본)");
	const kA = keyOf([cues[0][2], ""]);
	assert.ok(bakedFile(h, kA), "처음 문구의 사본이 남아 있다");
	// 패널을 다시 연다 (길이 기억이 비었다): 같은 캐시·세션·사본
	const nodeFiles = {};
	h.nodeFs.files.forEach((v, k) => { if (k !== SRC) nodeFiles[k] = { data: v.data, mtimeMs: v.mtimeMs }; });
	const h2 = await boot({ mogrt, nodeFiles, files: { [P.session(PROJ, A.seqId)]: h.fs.readJson(P.session(PROJ, A.seqId)) } });
	assert.deepEqual(h2.snapshot().subtitles.map((s) => s.id), ids);
	h2.$("row-" + ids[0]).querySelector(".sub-header").click();
	await h2.flush();
	typeField(h2, ids[0], "T1", cues[0][2]);
	h2.$("row-" + ids[0]).querySelector(".btn-update").click();
	await until(h2, () => calls(h2, "applyToTimeline").length === 1, "↑");
	await h2.flush();
	assert.equal(h2.nodeFs.writes.filter((p) => /\.mogrt$/.test(p)).length, 0, "굽지 않고 다시 쓴다");
	assert.deepEqual(calls(h2, "removeNativeClipsAt"), [{ t: 2, s: [1, 8, 15.5] }], "첫째 창 [1, 10.5) → 둘째(대상 밖) 창 [8, 17.5) → 셋째");
	assert.deepEqual(calls(h2, "applyToTimeline")[0].subtitles.map((x) => [x.startSec, x.mogrtPath]),
		[[1, BAKED + kA + ".mogrt"], [8, BAKED + keyOf([cues[1][2], ""]) + ".mogrt"], [15.5, BAKED + keyOf([cues[2][2], ""]) + ".mogrt"]]);
	noErrors(h2);
});
