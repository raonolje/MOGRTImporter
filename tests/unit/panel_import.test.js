"use strict";
// S1-7: SRT 열기 라우터, 인코딩 확인(레거시), 'SRT 가져오기' 창(플래그 뒤), 화자 표 만들기 — panelHarness로 app.js 전체를 돌린다
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { bootPanel, cachePaths: P } = require("../lib/panelHarness");
const { build } = require("../fixtures/presets_synth");
const { loadRegions, plain } = require("../lib/loadRegions");

const PROJ = "C:/work/import.prproj";
const A = { seqId: "impo-0001", seqName: "T_IMP", projPath: PROJ };
const FIX = path.join(__dirname, "..", "fixtures", "srt");
const bytesOf = (name) => fs.readFileSync(path.join(FIX, name));
const GOLDEN = bytesOf("golden_crlf.srt").toString("utf8");
const DOT = String.fromCharCode(0xb7);
const core = loadRegions(["src/srtParser.ts", "src/mi/core.ts"]);

function noErrors(h) {
	assert.deepEqual(h.errors().map((e) => String(e.message || e).slice(0, 300)), [], "패널 예외");
}
async function boot(opts) {
	const { presets } = build();
	const h = await bootPanel(Object.assign({
		seq: A,
		files: { [P.presets(PROJ)]: { presets: { preset_1: presets.preset_1, preset_3: presets.preset_3, preset_4: presets.preset_4, preset_6: presets.preset_6, preset_8: presets.preset_8 }, presetTrash: [], nextPresetId: 9 } }
	}, opts || {}));
	await h.advance(1000);
	return h;
}
const snap = (h) => h.snapshot();
// 결과를 이 realm의 값으로 (source: test 기본, "agent"는 cmdAs)
const cmd = async (h, op, args, source) => JSON.parse(JSON.stringify(await (source ? h.win._mogrtDebug.cmdAs(source, op, args) : h.win._mogrtDebug.cmd(op, args))));
const confirmOpen = (h) => h.$("confirmModal").classList.contains("open");
const importOpen = (h) => h.$("importModal").classList.contains("open");
const impRows = (h) => h.$("impBody").querySelectorAll("tr.imp-row");
const autoList = (h) => h.fs.readJson(P.historyAuto(PROJ, A.seqId)) || [];
const safetyList = (h) => h.fs.readJson(P.historySafety(PROJ, A.seqId)) || [];
function setSel(h, el, v) {
	el.value = v;
	h.change(el);
}

// ── 플래그 꺼짐 (운영 = v27) ──

test("(a) 플래그 꺼짐: 평범한 SRT 하나 → v27 골든과 같은 줄, mi 없음, multiple 없음", async () => {
	const h = await boot();
	assert.equal(h.$("srtInput").multiple, false, "multiple 속성 없음");
	await h.dropSrt("golden_crlf.srt", GOLDEN);
	const s = snap(h);
	const want = plain(core.parseSRT(GOLDEN)).map((c, i) => Object.assign({}, c, { id: i + 1 }));
	assert.deepEqual(s.subtitles, want, "v27 parseSRT(opts 없음) 그대로 — 태그·U+2028 유지, srtNo·spk 없음");
	assert.equal(s.mi.salt, "");
	assert.deepEqual(Object.keys(h.fs.readJson(P.session(PROJ, A.seqId))), ["subtitles", "rowStates", "trashBin", "nextId"]);
	assert.equal(h.fs.files.has(P.cast(PROJ, A.seqId)), false);
	assert.deepEqual(autoList(h).map((e) => e.label), ["SRT 로드: golden_crlf.srt"]);
	assert.equal(importOpen(h), false);
	assert.equal(confirmOpen(h), false);
	noErrors(h);
});

test("(b) 플래그 꺼짐: 인터뷰_C2.srt·여러 파일도 레거시 (첫 파일 하나, 화자 없음)", async () => {
	const h = await boot();
	await h.dropSrts([{ name: "인터뷰_C2.srt", content: bytesOf("cap_interview_C2.srt") }, { name: "C1.srt", content: bytesOf("cap_C1.srt") }]);
	const s = snap(h);
	assert.equal(s.subtitles.length, 6, "첫 파일(C2)만");
	assert.ok(s.subtitles.every((x) => x.spk === undefined && x.srtNo === undefined));
	assert.equal(s.subtitles[4].text, "<i>좋아요</i>", "레거시는 태그를 지우지 않는다 (v27)");
	assert.deepEqual(s.mi.cast, {});
	assert.equal(importOpen(h), false);
	noErrors(h);
});

test("(c) 플래그 꺼짐: CP949 파일 → 목록을 바꾸기 전에 'CP949로 읽었습니다' + 한글 미리보기, 취소하면 그대로", async () => {
	const h = await boot();
	await h.dropSrt("old.srt", "1\n00:00:01,000 --> 00:00:02,000\n기존 줄\n");
	await h.dropSrt("enc_cp949.srt", bytesOf("enc_cp949.srt"));
	assert.equal(confirmOpen(h), true, "확인창");
	const msg = h.$("confirmMessage").textContent;
	assert.match(msg, /^‘enc_cp949\.srt’를 CP949로 읽었습니다\./);
	assert.match(msg, /첫 자막: 00:00:01\.000 {2}안녕하세요 합성 자막/, "한글이 제대로: " + msg);
	assert.equal(h.$("confirmYes").textContent, "가져오기");
	assert.deepEqual(snap(h).subtitles.map((x) => x.text), ["기존 줄"], "묻는 동안 목록은 그대로");
	h.$("confirmNo").click();
	await h.flush();
	assert.deepEqual(snap(h).subtitles.map((x) => x.text), ["기존 줄"]);
	assert.match(h.status().text, /취소/);
	// 다시 → [가져오기]
	await h.dropSrt("enc_cp949.srt", bytesOf("enc_cp949.srt"));
	h.$("confirmYes").click();
	await h.flush();
	assert.deepEqual(snap(h).subtitles.map((x) => x.text), ["안녕하세요 합성 자막", "두 번째 줄입니다"]);
	assert.deepEqual(safetyList(h).map((e) => e.label), ["SRT 가져오기 전: enc_cp949.srt"]);
	noErrors(h);
});

test("(d) 깨진 바이트 하나가 있는 UTF-8 → UTF-8로 읽고 '깨진 글자 3개' (euc-kr 모지바케가 아니다)", async () => {
	const h = await boot();
	await h.dropSrt("enc_utf8_badbyte.srt", bytesOf("enc_utf8_badbyte.srt"));
	assert.equal(confirmOpen(h), true);
	const msg = h.$("confirmMessage").textContent;
	assert.match(msg, /‘enc_utf8_badbyte\.srt’에 깨진 글자 3개가 있습니다 \(UTF-8로 읽음\)/);
	assert.match(msg, /합성 자막/, "나머지 한글은 그대로");
	h.$("confirmYes").click();
	await h.flush();
	const s = snap(h);
	assert.equal(s.subtitles[1].text, "두 번째 줄입니다");
	assert.equal((s.subtitles[0].text.match(/\uFFFD/g) || []).length, 3);
	noErrors(h);
});

test("UTF-16 LE BOM·UTF-8 BOM: BOM 파일은 첫 자막을 잃지 않고, UTF-16은 확인을 받는다", async () => {
	const h = await boot();
	await h.dropSrt("enc_utf8_bom.srt", bytesOf("enc_utf8_bom.srt"));
	assert.equal(confirmOpen(h), false, "UTF-8 BOM은 묻지 않는다");
	assert.equal(snap(h).subtitles[0].text, "안녕하세요 합성 자막");
	await h.dropSrt("enc_utf16le_bom.srt", bytesOf("enc_utf16le_bom.srt"));
	assert.match(h.$("confirmMessage").textContent, /UTF-16 LE로 읽었습니다/);
	h.$("confirmYes").click();
	await h.flush();
	assert.equal(snap(h).subtitles.length, 2);
	noErrors(h);
});

test("화자 줄이 없으면 ▶는 v27 그대로, 부팅 게이트 전에는 열지 않는다", async () => {
	const h = await bootPanel({ seq: null });
	await h.advance(500);
	await h.dropSrt("x.srt", GOLDEN);
	assert.equal(h.snapshot().subtitles.length, 0);
	assert.match(h.status().text, /시퀀스를 열면/);
	noErrors(h);
});

// ── 플래그 켜짐 (DEV: window._mogrtDebug.setMiCast) ──

async function bootCast(opts) {
	const h = await boot(opts);
	assert.equal(h.win._mogrtDebug.setMiCast(true), true);
	assert.equal(h.$("srtInput").multiple, true);
	return h;
}

test("(e) 플래그 켜짐: C1.srt + 인터뷰_C2.srt → 가져오기 창 → 화자 C1·C2, 줄은 spk·srtNo·시간순, cast.json", async () => {
	const h = await bootCast();
	await h.dropSrts([
		{ name: "인터뷰_C2.srt", content: bytesOf("cap_interview_C2.srt"), path: "D:\\srt\\인터뷰_C2.srt", lastModified: 1790000000000 },
		{ name: "C1.srt", content: bytesOf("cap_C1.srt") }
	]);
	assert.equal(importOpen(h), true, "가져오기 창");
	const rows = impRows(h);
	assert.equal(rows.length, 2);
	assert.deepEqual(rows.map((r) => r.querySelector(".imp-key").value), ["C2", "C1"]);
	assert.deepEqual(rows.map((r) => r.querySelector(".imp-count").textContent), ["6줄", "7줄"]);
	assert.deepEqual(rows.map((r) => r.querySelector(".imp-action").textContent), ["새 화자", "새 화자"]);
	// 기본 프리셋 선택지: 캡션 필드가 있는 프리셋만 (preset_4·preset_8 제외)
	const opts = rows[0].querySelector(".imp-preset").options.map((o) => o.value);
	assert.deepEqual(opts, ["", "preset_1", "preset_3", "preset_6"]);
	assert.equal(h.$("impOk").disabled, false);
	assert.equal(h.$("impError").textContent, "");
	// 이름·프리셋 입력
	const nm = rows[1].querySelector(".imp-name");
	nm.value = "철수";
	nm.dispatchEvent({ type: "input" });
	setSel(h, rows[1].querySelector(".imp-preset"), "preset_3");
	assert.deepEqual(snap(h).subtitles, [], "OK 전에는 아무것도 바뀌지 않는다");
	h.$("impOk").click();
	await h.flush();
	assert.equal(importOpen(h), false);
	const s = snap(h);
	assert.deepEqual(s.mi.castOrder, ["C1", "C2"]);
	assert.equal(s.mi.cast.C1.name, "철수");
	assert.equal(s.mi.cast.C2.name, "C2", "이름을 비우면 키 (파일 이름에서 가져오지 않는다)");
	assert.equal(s.mi.cast.C1.presetId, "preset_3");
	assert.deepEqual([s.mi.cast.C2.file, s.mi.cast.C2.path, s.mi.cast.C2.size, s.mi.cast.C2.mtime], ["인터뷰_C2.srt", "D:/srt/인터뷰_C2.srt", bytesOf("cap_interview_C2.srt").length, 1790000000000]);
	assert.match(s.mi.salt, /^[a-z0-9]{4}$/);
	assert.equal(s.subtitles.length, 13);
	assert.ok(s.subtitles.every((x) => (x.spk === "C1" || x.spk === "C2") && typeof x.srtNo === "number"));
	for (let i = 1; i < 13; i++) assert.ok(s.subtitles[i - 1].startSec <= s.subtitles[i].startSec);
	assert.ok(s.subtitles.some((x) => x.text === "기울임 강조 문장입니다"), "태그를 지운다");
	assert.equal(s.mi.hwm, 13);
	// C1 줄은 프리셋을 받고 속성이 채워진다 (캡션 = 문장)
	const c1a = s.subtitles.find((x) => x.spk === "C1" && x.index === 1);
	assert.equal(s.rowStates[c1a.id].presetId, "preset_3");
	assert.ok(s.rowStates[c1a.id]._allParams.length > 0);
	// 행 번호 표시 "C1·1"
	assert.equal(h.$("row-" + c1a.id).querySelector(".sub-num").textContent, "C1" + DOT + "1");
	// 저장: session.json에 mi, cast.json
	const sess = h.fs.readJson(P.session(PROJ, A.seqId));
	assert.equal(sess.mi.salt, s.mi.salt);
	const side = h.fs.readJson(P.cast(PROJ, A.seqId));
	assert.deepEqual([side.salt, side.hwm, side.castOrder], [s.mi.salt, 13, ["C1", "C2"]]);
	// 빈 목록이었으므로 안전 지점은 없고, 자동 항목 하나
	assert.deepEqual(safetyList(h), []);
	assert.deepEqual(autoList(h).map((e) => e.label), ["SRT 가져오기: C1 철수(7) · C2 C2(6)"]);
	assert.equal(h.status().text, "SRT 가져오기: C1 철수(7) · C2 C2(6)");
	noErrors(h);
});

test("(f) 같은 키(C2) 두 파일 → 두 줄이 빨갛고 가져오기 버튼이 꺼진다, 키를 바꾸면 풀린다", async () => {
	const h = await bootCast();
	await h.dropSrts([{ name: "a_C2.srt", content: bytesOf("cap_interview_C2.srt") }, { name: "b_C2.srt", content: bytesOf("cap_C1.srt") }]);
	let rows = impRows(h);
	assert.ok(rows.every((r) => r.classList.contains("imp-dup")));
	assert.equal(h.$("impError").textContent, "C2가 두 파일에 지정되었습니다");
	assert.equal(h.$("impOk").disabled, true);
	h.$("impOk").click();
	assert.equal(importOpen(h), true, "꺼진 버튼은 아무것도 하지 않는다");
	setSel(h, rows[1].querySelector(".imp-key"), "C1");
	rows = impRows(h);
	assert.ok(rows.every((r) => !r.classList.contains("imp-dup")));
	assert.equal(h.$("impOk").disabled, false);
	h.$("impCancel").click();
	assert.equal(importOpen(h), false);
	assert.deepEqual(snap(h).subtitles, []);
	noErrors(h);
});

test("C번호가 없거나 모호한 파일은 키를 골라야 하고, 자막 없는 파일은 건너뛴다", async () => {
	const h = await bootCast();
	await h.dropSrts([
		{ name: "C1_C2.srt", content: bytesOf("cap_C1.srt") },
		{ name: "narration.srt", content: bytesOf("cap_interview_C2.srt") },
		{ name: "empty_C5.srt", content: "아무것도 없음\n" }
	]);
	let rows = impRows(h);
	assert.deepEqual(rows.map((r) => r.querySelector(".imp-key").value), ["", "", "C5"]);
	assert.equal(rows[2].querySelector(".imp-count").textContent, "자막 없음");
	assert.equal(rows[2].querySelector(".imp-action").textContent, "건너뜀");
	assert.equal(rows[2].querySelector(".imp-key").disabled, true);
	const info = h.$("impBody").querySelectorAll(".imp-info").map((e) => e.textContent);
	assert.match(info[0], /여럿입니다 \(C1·C2\)/);
	assert.match(info[1], /캡션 트랙 번호\(C1, C2…\)가 없습니다/);
	assert.equal(h.$("impOk").disabled, true);
	assert.match(h.$("impError").textContent, /^캡션 트랙을 고르세요: C1_C2\.srt, narration\.srt$/);
	setSel(h, rows[0].querySelector(".imp-key"), "C1");
	rows = impRows(h);
	setSel(h, rows[1].querySelector(".imp-key"), "C3");
	assert.equal(h.$("impOk").disabled, false);
	h.$("impOk").click();
	await h.flush();
	const s = snap(h);
	assert.deepEqual(s.mi.castOrder, ["C1", "C3"]);
	assert.equal(s.subtitles.length, 13);
	noErrors(h);
});

test("이미 있는 화자를 다시 가져오면 교체 — 지금 줄은 휴지통(why replace), 안전 지점 하나, 다른 화자는 그대로", async () => {
	const h = await bootCast();
	await h.dropSrts([{ name: "C1.srt", content: bytesOf("cap_C1.srt") }, { name: "C2.srt", content: bytesOf("cap_interview_C2.srt") }]);
	h.$("impOk").click();
	await h.flush();
	const s1 = snap(h);
	const c2 = s1.subtitles.filter((x) => x.spk === "C2");
	await h.dropSrt("cap_C1_edit.srt", bytesOf("cap_C1_edit.srt"));
	const rows = impRows(h);
	assert.equal(rows[0].querySelector(".imp-action").textContent, "교체");
	assert.match(h.$("impBody").querySelector(".imp-info").textContent, /지금 C1 줄 7개는 휴지통으로/);
	assert.equal(rows[0].querySelector(".imp-name").value, "C1", "지금 이름이 기본값");
	h.$("impOk").click();
	await h.flush();
	const s2 = snap(h);
	assert.equal(s2.trashBin.length, 7);
	assert.ok(s2.trashBin.every((t) => t.why === "replace" && typeof t.at === "number"));
	assert.deepEqual(s2.subtitles.filter((x) => x.spk === "C2"), c2);
	assert.equal(s2.subtitles.filter((x) => x.spk === "C1").length, 8);
	assert.deepEqual(safetyList(h).map((e) => e.label), ["SRT 가져오기 전: C1 cap_C1_edit.srt"]);
	assert.equal(safetyList(h)[0].subtitles.length, 13, "바꾸기 전 상태");
	assert.deepEqual(autoList(h).map((e) => e.label), ["SRT 가져오기: C1 C1(8)", "SRT 가져오기: C1 C1(7) · C2 C2(6)"]);
	// 휴지통 탭에도 보인다
	assert.equal(h.$("trashWrap").querySelectorAll(".trash-row").length, 7);
	noErrors(h);
});

test("플래그 켜짐: C번호 없는 파일 하나 + 화자 표 없음 → 레거시(v27 교체)", async () => {
	const h = await bootCast();
	await h.dropSrt("golden_crlf.srt", GOLDEN);
	assert.equal(importOpen(h), false);
	const s = snap(h);
	assert.equal(s.subtitles.length, 3);
	assert.ok(s.subtitles.every((x) => !x.spk && x.srtNo === undefined));
	noErrors(h);
});

test("플래그 켜짐: 화자 없는 줄이 있는 목록에 C번호 파일 → 이 커밋에서는 거부 (목록 그대로)", async () => {
	const h = await bootCast();
	await h.dropSrt("golden_crlf.srt", GOLDEN);
	const before = snap(h);
	await h.dropSrt("C1.srt", bytesOf("cap_C1.srt"));
	assert.equal(importOpen(h), false);
	assert.equal(h.$("alertModal").classList.contains("open"), true);
	assert.match(h.$("alertMessage").textContent, /기존 목록 나누기는 다음 단계에서 지원/);
	assert.match(h.status().text, /기존 목록 나누기는 다음 단계에서 지원/);
	assert.deepEqual(snap(h).subtitles, before.subtitles);
	noErrors(h);
});

test("화자 줄이 있으면 ▶·↑는 '화자별 배치는 개발 중입니다' (호스트를 부르지 않는다)", async () => {
	const h = await bootCast();
	await h.dropSrts([{ name: "C1.srt", content: bytesOf("cap_C1.srt") }]);
	h.$("impOk").click();
	await h.flush();
	const n = h.host.calls.length;
	h.$("btnApply").click();
	await h.flush();
	assert.equal(h.status().text, "화자별 배치는 개발 중입니다");
	const id = snap(h).subtitles[0].id;
	h.$("row-" + id).querySelectorAll("button").find((b) => b.title === "이 자막만 타임라인에 업데이트").click();
	await h.flush();
	assert.equal(h.status().text, "화자별 배치는 개발 중입니다");
	assert.deepEqual(h.host.calls.slice(n).filter((c) => /applyToTimeline|updateClipAtTime/.test(c.fn)), []);
	noErrors(h);
});

test("setMiCast(false)면 multiple이 꺼지고 레거시로 돌아간다", async () => {
	const h = await bootCast();
	assert.equal(h.win._mogrtDebug.setMiCast(false), false);
	assert.equal(h.$("srtInput").multiple, false);
	await h.dropSrt("C1.srt", bytesOf("cap_C1.srt"));
	assert.equal(importOpen(h), false);
	assert.ok(snap(h).subtitles.every((x) => !x.spk));
	noErrors(h);
});

test("runCommand importSrt: 파일을 고른 것과 같다 (경로·파일 요약), agent는 needs-approval, 잘못된 인자는 bad-args", async () => {
	const h = await bootCast();
	const b64 = (name) => bytesOf(name).toString("base64");
	const files = [{ name: "C1.srt", b64: b64("cap_C1.srt") }, { name: "인터뷰_C2.srt", b64: b64("cap_interview_C2.srt") }];
	const ag = await cmd(h, "importSrt", { files }, "agent");
	assert.deepEqual([ag.ok, ag.error], [false, "needs-approval"]);
	assert.equal(importOpen(h), false, "agent는 아무것도 열지 않는다");
	const r1 = await cmd(h, "importSrt", { files });
	assert.equal(r1.ok, true, JSON.stringify(r1));
	assert.equal(r1.data.route, "modal");
	assert.deepEqual(r1.data.files.map((f) => [f.name, f.key, f.encoding, f.replaced, f.cues]), [["C1.srt", "C1", "utf-8", 0, 7], ["인터뷰_C2.srt", "C2", "utf-8", 0, 6]]);
	assert.equal(importOpen(h), true);
	h.$("impCancel").click();
	const bad = await cmd(h, "importSrt", { files: [{ name: "x.srt" }] });
	assert.deepEqual([bad.ok, bad.error], [false, "bad-args"]);
	const bad2 = await cmd(h, "importSrt", {});
	assert.deepEqual([bad2.ok, bad2.error], [false, "bad-args"]);
	noErrors(h);
});
