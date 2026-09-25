"use strict";
// S1-8: 다시 가져오기 병합(가져오기 창), 레거시 병합 선택, 분배, mm 점·포인트 경고·변경 줄, 안전 지점 복원, merge 명령 — panelHarness
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { bootPanel, cachePaths: P } = require("../lib/panelHarness");
const { build } = require("../fixtures/presets_synth");
const CAP = require("../fixtures/make_cap_fixtures");

const PROJ = "C:/work/merge.prproj";
const A = { seqId: "merg-0001", seqName: "T_MRG", projPath: PROJ };
const FIX = path.join(__dirname, "..", "fixtures", "srt");
const bytesOf = (name) => fs.readFileSync(path.join(FIX, name));
const DOT = String.fromCharCode(0xb7);
const clone = (v) => JSON.parse(JSON.stringify(v));

function noErrors(h) {
	assert.deepEqual(h.errors().map((e) => String(e.message || e).slice(0, 300)), [], "패널 예외");
}
async function boot(opts) {
	const { presets } = build();
	const h = await bootPanel(Object.assign({
		seq: A,
		files: { [P.presets(PROJ)]: { presets: { preset_3: presets.preset_3, preset_6: presets.preset_6 }, presetTrash: [], nextPresetId: 9 } }
	}, opts || {}));
	await h.advance(1000);
	return h;
}
async function bootCast() {
	const h = await boot();
	h.win._mogrtDebug.setMiCast(true);
	return h;
}
const snap = (h) => h.snapshot();
const cmd = async (h, op, args, source) => JSON.parse(JSON.stringify(await (source ? h.win._mogrtDebug.cmdAs(source, op, args) : h.win._mogrtDebug.cmd(op, args))));
const importOpen = (h) => h.$("importModal").classList.contains("open");
const confirmOpen = (h) => h.$("confirmModal").classList.contains("open");
const impRows = (h) => h.$("impBody").querySelectorAll("tr.imp-row");
const autoList = (h) => h.fs.readJson(P.historyAuto(PROJ, A.seqId)) || [];
const safetyList = (h) => h.fs.readJson(P.historySafety(PROJ, A.seqId)) || [];
function setSel(h, el, v) {
	el.value = v;
	h.change(el);
}
// 행 속성창의 T-ID 필드 textarea에 쓴다 (사용자가 치는 것과 같다)
function typeField(h, id, fid, text) {
	const badge = h.$("params-" + id).querySelectorAll(".fid-badge").find((b) => b.textContent === fid);
	assert.ok(badge, "#" + id + " " + fid + " 배지");
	const ta = badge.parentNode.parentNode.querySelector("textarea");
	ta.value = text;
	ta.dispatchEvent({ type: "input" });
}
const fieldOf = (s, id, idx) => s.rowStates[id]._allParams.find((p) => p.index === idx).value;
// C1.srt를 preset_3으로 가져오고 T2 세 줄 (인터뷰·날씨·산책)
async function importC1WithT2(h) {
	await h.dropSrts([{ name: "C1.srt", content: bytesOf("cap_C1.srt") }]);
	setSel(h, impRows(h)[0].querySelector(".imp-preset"), "preset_3");
	h.$("impOk").click();
	await h.flush();
	const rows = snap(h).subtitles;
	typeField(h, rows[0].id, "T2", "인터뷰");
	typeField(h, rows[1].id, "T2", "날씨");
	typeField(h, rows[4].id, "T2", "산책");
	await h.flush();
	return rows.map((s) => s.id);
}

test("다시 가져오기(병합): 통계가 창과 결과에 맞고, T2는 그대로, 포인트 경고, 빠진 줄은 휴지통(병합), 안전 지점을 복원하면 정확히 전으로", async () => {
	const h = await bootCast();
	const ids = await importC1WithT2(h);
	const prior = snap(h);
	assert.equal(fieldOf(prior, ids[1], 2), "날씨");
	await h.dropSrt("cap_C1_edit.srt", bytesOf("cap_C1_edit.srt"));
	assert.equal(importOpen(h), true);
	const row = impRows(h)[0];
	assert.equal(row.querySelector(".imp-key").value, "C1");
	assert.equal(row.querySelector(".imp-act").value, "merge", "이미 있는 화자는 병합이 기본");
	// 나눈 첫 조각(17~18초)은 끝도 바뀌어 '문장·시간'
	const statsText = h.$("impBody").querySelector(".imp-stats").textContent;
	assert.equal(statsText, "같음 3 · 문장 1 · 시간 1 · 문장·시간 1 · 새 줄 2 · 빠짐 1 · 포인트 확인 1");
	h.$("impOk").click();
	await h.flush();
	const s = snap(h);
	// 통계대로
	const c1 = s.subtitles.filter((x) => x.spk === "C1");
	assert.equal(c1.length, 8, "7 − 빠짐 1 + 새 줄 2");
	const mm = {};
	c1.forEach((x) => { const k = s.rowStates[x.id].mm || "same"; mm[k] = (mm[k] || 0) + 1; });
	assert.deepEqual(mm, { same: 3, text: 1, time: 1, both: 1, new: 2 });
	// T2는 그대로 (id를 지킨 세 줄)
	assert.deepEqual(ids.filter((id) => [ids[0], ids[1], ids[4]].indexOf(id) !== -1).map((id) => fieldOf(s, id, 2)), ["인터뷰", "날씨", "산책"]);
	// 문장이 바뀐 줄: 캡션 필드도 새 문장, 포인트 경고
	assert.equal(fieldOf(s, ids[1], 1), "오늘 하늘이 정말 맑네요");
	assert.deepEqual(s.rowStates[ids[1]].warn, [{ fid: "T2", missing: ["날씨"], dup: [] }]);
	const warnEl = h.$("row-" + ids[1]).querySelector(".sub-warn");
	assert.ok(warnEl, "경고 표시");
	assert.equal(warnEl.title, "T2 포인트 텍스트 ‘날씨’이 문장에 없음");
	assert.equal(h.$("row-" + ids[1]).querySelector(".sub-mm").className, "sub-mm mm-text");
	assert.match(h.$("row-" + ids[2]).querySelector(".sub-mm").title, /시간 변경 9\.00→9\.40/);
	// 빠진 줄 → 휴지통 (why merge), 휴지통 탭 "C1·4 (병합)"
	const tr = s.trashBin.find((t) => t.sub.id === ids[3]);
	assert.deepEqual([tr.why, typeof tr.at], ["merge", "number"]);
	assert.deepEqual(h.$("trashWrap").querySelectorAll(".trash-num").map((e) => e.textContent), ["C1" + DOT + "4 (병합)"]);
	// 새 줄은 화자 기본 프리셋
	const added = c1.filter((x) => x.id > Math.max(...ids));
	assert.deepEqual(added.map((x) => s.rowStates[x.id].presetId), ["preset_3", "preset_3"]);
	// 안전 지점 하나 + 자동 항목 하나
	assert.deepEqual(safetyList(h).map((e) => e.label), ["SRT 가져오기 전: C1 cap_C1_edit.srt"]);
	assert.equal(autoList(h)[0].label, "SRT 병합: C1 (문장 2 · 시간 2 · 새 2 · 빠짐 1 · 충돌 0 · 복구 0)");
	// 변경 줄 (5)
	const btn = h.$("btnSelectChanged");
	assert.deepEqual([btn.style.display, btn.textContent], ["", "변경 줄 (5)"]);
	btn.click();
	const checked = snap(h).subtitles.filter((x) => snap(h).rowStates[x.id].checked).map((x) => x.id).sort((a, b) => a - b);
	assert.deepEqual(checked, c1.filter((x) => s.rowStates[x.id].mm).map((x) => x.id).sort((a, b) => a - b));
	h.$("btnToggleSelect").click();
	// 안전 지점 복원 → 병합 전과 정확히 같다 (nextId는 내리지 않고 hwm도 그대로)
	const hwm = snap(h).mi.hwm;
	h.$("btnHistory").click();
	h.$("historySafety").querySelectorAll(".history-item")[0].childNodes[0].click();
	h.$("confirmYes").click();
	await h.flush();
	const back = snap(h);
	assert.deepEqual(back.subtitles, prior.subtitles);
	assert.deepEqual(back.rowStates, prior.rowStates);
	assert.deepEqual(back.trashBin, prior.trashBin);
	assert.ok(back.nextId >= prior.nextId && back.nextId > hwm, "nextId " + back.nextId);
	assert.equal(back.mi.hwm, hwm, "hwm 그대로");
	assert.equal(h.$("btnSelectChanged").style.display, "none", "변경 줄 없음");
	noErrors(h);
});

test("같은 파일을 두 번 가져오면 '변경 없음' — 상태·히스토리·안전 지점 그대로", async () => {
	const h = await bootCast();
	await importC1WithT2(h);
	await h.dropSrt("C1.srt", bytesOf("cap_C1.srt"));
	assert.equal(h.$("impBody").querySelector(".imp-stats").textContent, "변경 없음 (같음 7)");
	const s0 = snap(h);
	const nAuto = autoList(h).length;
	const nSafe = safetyList(h).length;
	h.$("impOk").click();
	await h.flush();
	assert.deepEqual(snap(h), s0);
	assert.equal(autoList(h).length, nAuto);
	assert.equal(safetyList(h).length, nSafe);
	assert.match(h.status().text, /^변경 없음: C1 C1\.srt$/);
	noErrors(h);
});

test("충돌: 패널에서 고친 캡션 + 바뀐 SRT → 기본은 SRT 문장, '패널 문장 유지'면 패널 문장 (둘 다 mm conflict)", async () => {
	for (const keep of [false, true]) {
		const h = await bootCast();
		const ids = await importC1WithT2(h);
		typeField(h, ids[1], "T1", "패널에서 고친 문장");
		await h.dropSrt("cap_C1_edit.srt", bytesOf("cap_C1_edit.srt"));
		assert.match(h.$("impBody").querySelector(".imp-stats").textContent, /충돌 1/);
		if (keep) {
			const k = h.$("impKeepPanelEdits");
			k.checked = true;
			h.change(k);
		}
		h.$("impOk").click();
		await h.flush();
		const s = snap(h);
		assert.equal(s.subtitles.find((x) => x.id === ids[1]).text, "오늘 하늘이 정말 맑네요");
		assert.equal(fieldOf(s, ids[1], 1), keep ? "패널에서 고친 문장" : "오늘 하늘이 정말 맑네요");
		assert.equal(s.rowStates[ids[1]].mm, "conflict");
		assert.equal(h.$("row-" + ids[1]).querySelector(".sub-mm").className, "sub-mm mm-conflict");
		noErrors(h);
	}
});

test("[교체]를 고른 뒤 다시 [병합]: 교체로 빠졌던 줄이 돌아오면 후반 작업과 함께 복구 (mm restored)", async () => {
	const h = await bootCast();
	const ids = await importC1WithT2(h);
	// 줄 5(산책)가 빠진 파일로 교체
	const noWalk = CAP.srt(CAP.C1.filter((_, i) => i !== 4));
	await h.dropSrt("C1.srt", noWalk);
	setSel(h, impRows(h)[0].querySelector(".imp-act"), "replace");
	h.$("impOk").click();
	await h.flush();
	assert.equal(snap(h).subtitles.some((x) => x.id === ids[4]), false);
	// 전체 파일로 병합
	await h.dropSrt("C1.srt", bytesOf("cap_C1.srt"));
	assert.match(h.$("impBody").querySelector(".imp-stats").textContent, /휴지통에서 복구 1/);
	h.$("impOk").click();
	await h.flush();
	const s = snap(h);
	assert.ok(s.subtitles.some((x) => x.id === ids[4]));
	assert.equal(fieldOf(s, ids[4], 2), "산책");
	assert.equal(s.rowStates[ids[4]].mm, "restored");
	assert.equal(h.$("row-" + ids[4]).querySelector(".sub-mm").className, "sub-mm mm-restored");
	noErrors(h);
});

test("의심 파일: C2 파일이 C1과 같으면 [가져오기]가 '그래도 가져오기'로 바뀌고 두 번째에 가져온다", async () => {
	const h = await bootCast();
	await importC1WithT2(h);
	await h.dropSrt("인터뷰_C2.srt", bytesOf("cap_C1.srt"));
	assert.match(h.$("impBody").querySelector(".imp-info").textContent, /이 파일이 C2 캡션이 맞는지 확인하세요 \(C1과 같아 보임\)/);
	h.$("impOk").click();
	await h.flush();
	assert.equal(importOpen(h), true, "첫 누름은 확인만");
	assert.equal(h.$("impOk").textContent, "그래도 가져오기");
	assert.equal(snap(h).subtitles.filter((x) => x.spk === "C2").length, 0);
	h.$("impOk").click();
	await h.flush();
	assert.equal(importOpen(h), false);
	assert.equal(snap(h).subtitles.filter((x) => x.spk === "C2").length, 7);
	noErrors(h);
});

test("레거시 목록 + 프리셋 + C번호 없는 파일 (플래그 켜짐): [병합] [교체] [취소] — 병합은 id·후반 작업을 지킨다", async () => {
	const legacyText = CAP.srt(CAP.C1);
	const edited = CAP.srt(CAP.C1_EDIT);
	for (const pick of ["merge", "replace", "cancel"]) {
		const h = await bootCast();
		await h.dropSrt("interview.srt", legacyText);
		const ids = snap(h).subtitles.map((x) => x.id);
		setSel(h, h.$("sel-" + ids[1]), "preset_3");
		await h.flush();
		typeField(h, ids[1], "T2", "날씨");
		const before = snap(h);
		await h.dropSrt("interview_v2.srt", edited);
		assert.equal(confirmOpen(h), true, "선택 창");
		assert.match(h.$("confirmMessage").textContent, /^이미 후반 작업\(프리셋\)이 있는 자막 목록입니다\./);
		assert.deepEqual([h.$("confirmYes").textContent, h.$("confirmAlt").textContent, h.$("confirmAlt").style.display, h.$("confirmNo").textContent], ["병합 (후반 작업 유지)", "교체 (지금까지 방식)", "", "취소"]);
		h.$(pick === "merge" ? "confirmYes" : pick === "replace" ? "confirmAlt" : "confirmNo").click();
		await h.flush();
		const s = snap(h);
		if (pick === "merge") {
			assert.ok(s.subtitles.every((x) => !x.spk), "화자 없음");
			assert.ok(s.subtitles.some((x) => x.id === ids[1]));
			assert.equal(fieldOf(s, ids[1], 1), "오늘 하늘이 정말 맑네요");
			assert.equal(fieldOf(s, ids[1], 2), "날씨");
			assert.equal(s.rowStates[ids[1]].mm, "text");
			assert.equal(s.mi.salt, "", "레거시 병합은 salt를 만들지 않는다");
			assert.deepEqual(Object.keys(h.fs.readJson(P.session(PROJ, A.seqId))), ["subtitles", "rowStates", "trashBin", "nextId"], "단일 화자 파일 모양 그대로");
			assert.match(autoList(h)[0].label, /^SRT 병합: interview_v2\.srt \(문장 2 · 시간 2 · 새 2 · 빠짐 1 · 충돌 0 · 복구 0\)$/);
			assert.equal(h.$("trashWrap").querySelectorAll(".trash-num")[0].textContent, "4 (병합)");
		} else if (pick === "replace") {
			assert.equal(s.subtitles.some((x) => x.id === ids[1]), false, "v27 교체");
			assert.deepEqual(s.trashBin, []);
			assert.equal(autoList(h)[0].label, "SRT 로드: interview_v2.srt");
		} else assert.deepEqual(s.subtitles, before.subtitles);
		assert.equal(h.$("confirmAlt").style.display, "none", "닫으면 셋째 버튼을 숨긴다");
		noErrors(h);
	}
});

test("플래그 꺼짐(운영): 프리셋이 있는 목록에도 선택 창 없이 v27 교체", async () => {
	const h = await boot();
	await h.dropSrt("interview.srt", CAP.srt(CAP.C1));
	const id = snap(h).subtitles[1].id;
	setSel(h, h.$("sel-" + id), "preset_3");
	await h.dropSrt("interview_v2.srt", CAP.srt(CAP.C1_EDIT));
	assert.equal(confirmOpen(h), false);
	assert.equal(snap(h).subtitles.some((x) => x.id === id), false);
	assert.equal(h.$("btnSelectChanged").style.display, "none");
	assert.equal(h.$("listWrap").querySelectorAll(".sub-mm").length, 0);
	noErrors(h);
});

test("분배: 화자 없는 기존 목록 + C1·C2 → 나눔 머리 줄, 후반 작업 그대로 화자로, mi.legacyTrack = 트랙", async () => {
	const h = await bootCast();
	const mixed = CAP.C1.map((x) => x).concat(CAP.C2).sort((a, b) => a[0] - b[0]);
	await h.dropSrt("mixed.srt", CAP.srt(mixed));
	const ids = snap(h).subtitles.map((x) => x.id);
	setSel(h, h.$("sel-" + ids[2]), "preset_3");
	await h.flush();
	typeField(h, ids[2], "T2", "날씨");
	setSel(h, h.$("trackSel"), "4");
	await h.dropSrts([{ name: "C1.srt", content: bytesOf("cap_C1.srt") }, { name: "C2.srt", content: bytesOf("cap_interview_C2.srt") }]);
	assert.equal(importOpen(h), true);
	assert.equal(h.$("impLegacyInfo").textContent, "기존 목록 (화자 없음, 13줄) → C1 7 · C2 6");
	assert.equal(h.$("impLegacyMode").value, "split");
	assert.deepEqual(impRows(h).map((r) => r.querySelector(".imp-action").textContent), ["병합", "병합"]);
	h.$("impOk").click();
	await h.flush();
	const s = snap(h);
	assert.deepEqual(s.subtitles.map((x) => x.id), ids, "같은 id, 같은 순서");
	assert.ok(s.subtitles.every((x) => x.spk === "C1" || x.spk === "C2"));
	assert.equal(s.subtitles.find((x) => x.id === ids[2]).spk, "C1");
	assert.equal(fieldOf(s, ids[2], 2), "날씨");
	assert.deepEqual(s.mi.castOrder, ["C1", "C2"]);
	assert.equal(s.mi.legacyTrack, 4);
	assert.equal(h.$("row-" + ids[2]).querySelector(".sub-num").textContent, "C1" + DOT + "2");
	assert.deepEqual(s.trashBin, []);
	assert.match(autoList(h)[0].label, /^기존 목록 13줄 나눔 \/ SRT 병합: C1 \(/);
	noErrors(h);
});

test("분배: '모두 한 화자로'와 '휴지통으로 보내고 새로 시작'", async () => {
	const h = await bootCast();
	await h.dropSrt("only_one.srt", CAP.srt(CAP.C1));
	const ids = snap(h).subtitles.map((x) => x.id);
	await h.dropSrts([{ name: "C1.srt", content: bytesOf("cap_C1_edit.srt") }, { name: "C2.srt", content: bytesOf("cap_interview_C2.srt") }]);
	setSel(h, h.$("impLegacyMode"), "one");
	assert.equal(h.$("impLegacyKey").style.display, "");
	assert.equal(h.$("impLegacyInfo").textContent, "기존 목록 (화자 없음, 7줄) → 모두 C1");
	h.$("impOk").click();
	await h.flush();
	let s = snap(h);
	assert.ok(ids.filter((id) => id !== ids[3]).every((id) => s.subtitles.find((x) => x.id === id).spk === "C1"), "기존 줄은 C1 (빠진 줄 하나 빼고)");
	assert.equal(s.subtitles.filter((x) => x.spk === "C2").length, 6);
	// 휴지통으로 보내고 새로 시작
	const h2 = await bootCast();
	await h2.dropSrt("only_one.srt", CAP.srt(CAP.C1));
	await h2.dropSrts([{ name: "C1.srt", content: bytesOf("cap_C1.srt") }]);
	setSel(h2, h2.$("impLegacyMode"), "trash");
	h2.$("impOk").click();
	await h2.flush();
	s = snap(h2);
	assert.equal(s.trashBin.length, 7);
	assert.ok(s.trashBin.every((t) => t.why === "replace" && !t.sub.spk));
	assert.equal(s.subtitles.filter((x) => x.spk === "C1").length, 7);
	noErrors(h);
	noErrors(h2);
});

test("runCommand mergePreview는 아무것도 바꾸지 않고 통계를 주고, mergeCommit은 창의 [가져오기]와 같다 (agent는 needs-approval)", async () => {
	const h = await bootCast();
	await importC1WithT2(h);
	const b64 = bytesOf("cap_C1_edit.srt").toString("base64");
	const s0 = snap(h);
	const pv = await cmd(h, "mergePreview", { files: [{ name: "C1.srt", b64 }] });
	assert.equal(pv.ok, true, JSON.stringify(pv));
	assert.deepEqual([pv.data.changed, pv.data.files[0].key, pv.data.files[0].action, pv.data.files[0].statsText], [true, "C1", "merge", "같음 3 · 문장 1 · 시간 1 · 문장·시간 1 · 새 줄 2 · 빠짐 1 · 포인트 확인 1"]);
	assert.deepEqual(snap(h), s0, "미리 보기는 상태를 바꾸지 않는다");
	const ag = await cmd(h, "mergeCommit", { files: [{ name: "C1.srt", b64 }] }, "agent");
	assert.deepEqual([ag.ok, ag.error], [false, "needs-approval"]);
	assert.deepEqual(snap(h), s0);
	const cm = await cmd(h, "mergeCommit", { files: [{ name: "C1.srt", b64 }], keepPanelEdits: false });
	assert.equal(cm.ok, true);
	assert.equal(cm.data.changed, true);
	assert.equal(snap(h).subtitles.filter((x) => x.spk === "C1").length, 8);
	const again = await cmd(h, "mergeCommit", { files: [{ name: "C1.srt", b64 }] });
	assert.equal(again.data.changed, false, "같은 파일 두 번");
	const rows = await cmd(h, "rows", { filter: "changed" });
	assert.equal(rows.data.total, 5);
	const bad = await cmd(h, "mergePreview", { files: [{ name: "x.srt", b64, key: "Q1" }] });
	assert.equal(bad.error, "bad-args");
	h.win._mogrtDebug.setMiCast(false);
	const off = await cmd(h, "mergePreview", { files: [{ name: "C1.srt", b64 }] });
	assert.equal(off.error, "bad-args", "플래그가 꺼져 있으면 쓰지 않는다");
	noErrors(h);
});
