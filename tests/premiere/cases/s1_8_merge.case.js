"use strict";
/**
 * S1-8 하드: 다시 가져오기 병합·휴지통 규칙·안전 지점 복원, 기존 목록 나누기 (DEV 패널, MI_test.prproj의 T_ 시퀀스).
 * 스크래치 사본(T_scratch_s1_8a / _b)에서 돈다. 플래그는 window._mogrtDebug.setMiCast로만 켜고 끝나면 끈다.
 * 병합은 Premiere를 부르지 않는다 (호스트 호출 기록에 배치·갱신 함수가 없어야 한다).
 *   (A) C1.srt를 캡션 프리셋으로 가져오고 세 줄에 후반 작업 필드(캡션이 아닌 첫 텍스트 필드, 이하 Tp)를 쓴다
 *       → 고친 C1(cap_C1_edit.srt)을 다시 가져오면 창 통계가 "같음 3 · 문장 1 · 시간 1 · 문장·시간 1 · 새 줄 2 · 빠짐 1 · 포인트 확인 1",
 *       결과 줄 수·mm이 통계와 같고, Tp는 그대로, 포인트 경고(.sub-warn)가 보이고, 빠진 줄은 휴지통(why merge, '(병합)')
 *       → 같은 파일을 한 번 더: '변경 없음', 히스토리·안전 지점 그대로
 *       → 안전 지점 'SRT 가져오기 전: C1 cap_C1_edit.srt'를 복원하면 subtitles·rowStates·trashBin이 병합 전과 정확히 같고,
 *         nextId ≥ 병합 전, hwm은 그대로
 *   (B) 화자 없는 기존 목록(두 화자가 섞인 SRT 하나, 한 줄에 프리셋) + C1.srt·C2.srt → 창의 분배 머리 줄
 *       "기존 목록 (화자 없음, 13줄) → C1 7 · C2 6" → 가져오기: id·순서·프리셋 그대로 화자가 붙고, mi.legacyTrack = 트랙 선택
 * 실행: npm run hard -- s1_8
 */
const fs = require("node:fs");
const path = require("node:path");
const H = require("../lib/hard");
const CAP = require("../../fixtures/make_cap_fixtures");

const FIX = path.join(__dirname, "..", "..", "fixtures", "srt");
const bytesOf = (name) => fs.readFileSync(path.join(FIX, name));
const SNAP = "window._mogrtDebug.snapshot()";
const DOT = String.fromCharCode(0xb7);
const BAD_CALLS = /^(applyToTimeline|updateClipAtTime|insertClip|MI_|MID_)/;

// 행 속성창에서 T-ID 필드 textarea에 쓴다 (사용자가 치는 것과 같다). 그 필드가 속성창에 없으면 false
const pageTypeField = (id, fid, text) => "(() => { const b = Array.from(document.querySelectorAll('#params-" + Number(id) + " .fid-badge')).find((x) => x.textContent === " + JSON.stringify(fid) + ");" +
	" if (!b) return false; const ta = b.parentNode.parentNode.querySelector('textarea'); if (!ta) return false;" +
	" ta.value = " + JSON.stringify(text) + "; ta.dispatchEvent(new Event('input')); return true; })()";
const pageSelect = (sel, value) => "(() => { const s = document.querySelector(" + JSON.stringify(sel) + "); if (!s) return null; s.value = " + JSON.stringify(value) + "; s.dispatchEvent(new Event('change')); return s.value; })()";

module.exports = {
	name: "S1-8 병합·휴지통 규칙·안전 지점 복원·기존 목록 나누기 (플래그)",
	run: async (api) => {
		const { panel, assert, log } = api;
		await H.waitKeys(panel);
		// 프리셋: 네이티브가 아니고 캡션이 있고 텍스트 필드가 2개 이상
		const pick = (list) => list.filter((p) => !p.native && p.captionFid && p.fields.length >= 2).sort((a, b) => b.fields.length - a.fields.length)[0] || null;
		let P = pick((await panel(H.pageCmd("presets", {}))).data);
		if (!P) {
			await H.ensurePreset(api);
			P = pick((await panel(H.pageCmd("presets", {}))).data);
		}
		assert.ok(P, "캡션이 있고 텍스트 필드가 2개 이상인 프리셋이 필요하다");
		log("프리셋 " + P.id + " (" + P.fields.map((f) => f.fid + (f.caption ? "*" : "")).join(" ") + ")");
		const capIdx = P.fields.find((f) => f.caption).index;
		try {
			await H.withScratchSequence(api, "s1_8a", async () => {
				assert.equal(await panel(H.pageSetMiCast(true)), true);
				await panel(H.PAGE_RECORD_HOST_CALLS);
				// (A) C1 + 프리셋
				assert.equal(await panel(H.pageDropSrts([{ name: "C1.srt", content: bytesOf("cap_C1.srt") }])), "sent");
				await H.waitFor(panel, "(() => { const m = " + H.PAGE_IMPORT_MODAL + "; return m && m.open && m.rows.length === 1; })()", { what: "가져오기 창" });
				assert.equal(await panel(pageSelect("#impBody tr.imp-row .imp-preset", P.id)), P.id);
				await panel("document.getElementById('impOk').click(), true");
				await H.waitFor(panel, "document.querySelectorAll('#listWrap .sub-row').length === 7", { what: "C1 7줄" });
				let snap = await panel(SNAP);
				const ids = snap.subtitles.map((s) => s.id);
				// 후반 작업 필드: 속성창에 배지가 있는 캡션 아닌 텍스트 필드
				await H.waitFor(panel, "document.querySelectorAll('#params-" + ids[1] + " .fid-badge').length > 0", { timeoutMs: 60000, what: "속성창 배지" });
				const badges = await panel("Array.from(document.querySelectorAll('#params-" + ids[1] + " .fid-badge')).map((b) => b.textContent)");
				const Tp = badges.find((fid) => fid !== P.captionFid);
				assert.ok(Tp, "속성창에 캡션이 아닌 텍스트 필드가 노출되어 있어야 한다 (배지: " + badges.join(",") + ")");
				const tpIdx = P.fields.find((f) => f.fid === Tp).index;
				const vals = { 0: "인터뷰", 1: "날씨", 4: "산책" };
				for (const k of Object.keys(vals)) assert.equal(await panel(pageTypeField(ids[k], Tp, vals[k])), true, "#" + k + " " + Tp);
				await H.waitFor(panel, "(() => { const s = " + SNAP + "; const p = s.rowStates[" + ids[1] + "]._allParams.find((x) => x.index === " + tpIdx + "); return p && p.value === '날씨'; })()", { what: Tp + " 값" });
				const prior = await panel(SNAP);
				log("(A) C1 7줄 + " + Tp + " 세 줄 (" + P.id + ")");

				// 고친 C1 병합
				assert.equal(await panel(H.pageDropSrts([{ name: "cap_C1_edit.srt", content: bytesOf("cap_C1_edit.srt") }])), "sent");
				const m = await H.waitFor(panel, "(() => { const m = " + H.PAGE_IMPORT_MODAL + "; return m && m.open && m.stats.length ? m : null; })()", { what: "병합 통계" });
				assert.equal(m.rows[0].action, "merge", "이미 있는 화자는 병합이 기본");
				assert.equal(m.stats[0], "같음 3 · 문장 1 · 시간 1 · 문장·시간 1 · 새 줄 2 · 빠짐 1 · 포인트 확인 1");
				await panel("document.getElementById('impOk').click(), true");
				await H.waitFor(panel, "document.querySelectorAll('#listWrap .sub-row').length === 8", { what: "병합 뒤 8줄" });
				snap = await panel(SNAP);
				const mm = {};
				snap.subtitles.forEach((s) => { const k = snap.rowStates[s.id].mm || "same"; mm[k] = (mm[k] || 0) + 1; });
				assert.deepEqual(mm, { same: 3, text: 1, time: 1, both: 1, new: 2 }, "통계와 같은 결과");
				const valOf = (s, id, idx) => (s.rowStates[id]._allParams.find((p) => p.index === idx) || {}).value;
				assert.deepEqual([0, 1, 4].map((k) => valOf(snap, ids[k], tpIdx)), ["인터뷰", "날씨", "산책"], Tp + " 그대로");
				assert.equal(valOf(snap, ids[1], capIdx), "오늘 하늘이 정말 맑네요", "캡션 필드는 새 문장");
				assert.deepEqual(snap.rowStates[ids[1]].warn, [{ fid: Tp, missing: ["날씨"], dup: [] }]);
				assert.equal(await panel("!!document.querySelector('#row-" + ids[1] + " .sub-warn')"), true, "경고 표시");
				assert.equal(await panel("(document.querySelector('#row-" + ids[1] + " .sub-mm') || {}).className"), "sub-mm mm-text");
				const tr = snap.trashBin.find((t) => t.sub.id === ids[3]);
				assert.ok(tr && tr.why === "merge", "빠진 줄은 휴지통 (why merge)");
				assert.deepEqual(await panel("Array.from(document.querySelectorAll('#trashWrap .trash-num')).map((e) => e.textContent)"), ["C1" + DOT + "4 (병합)"]);
				assert.equal(await panel("document.getElementById('btnSelectChanged').textContent"), "변경 줄 (5)");
				log("(A) 병합: " + JSON.stringify(mm) + ", 휴지통 1, 경고 1");

				// 같은 파일 한 번 더 → 변경 없음
				const beforeSame = await panel(SNAP);
				assert.equal(await panel(H.pageDropSrts([{ name: "cap_C1_edit.srt", content: bytesOf("cap_C1_edit.srt") }])), "sent");
				const m2 = await H.waitFor(panel, "(() => { const m = " + H.PAGE_IMPORT_MODAL + "; return m && m.open && m.stats.length ? m : null; })()", { what: "두 번째 병합 창" });
				assert.match(m2.stats[0], /^변경 없음/);
				await panel("document.getElementById('impOk').click(), true");
				await H.waitStatus(panel, /^변경 없음/);
				const afterSame = await panel(SNAP);
				assert.deepEqual([afterSame.subtitles, afterSame.rowStates, afterSame.trashBin, afterSame.nextId], [beforeSame.subtitles, beforeSame.rowStates, beforeSame.trashBin, beforeSame.nextId], "같은 파일 두 번: 변화 없음");
				log("(A) 같은 파일 두 번: 변경 없음");

				// 안전 지점 복원
				const hwm = afterSame.mi.hwm;
				await panel("document.getElementById('btnHistory').click(), true");
				const label = await H.waitFor(panel, "(() => { const it = document.querySelector('#historySafety .history-item .hist-label'); return it ? it.textContent : null; })()", { what: "안전 지점 항목" });
				assert.equal(label, "SRT 가져오기 전: C1 cap_C1_edit.srt");
				await panel("document.querySelector('#historySafety .history-item').childNodes[0].click(), true");
				await H.confirmYes(panel);
				await H.waitFor(panel, "document.querySelectorAll('#listWrap .sub-row').length === 7", { what: "복원 뒤 7줄" });
				const back = await panel(SNAP);
				assert.deepEqual(back.subtitles, prior.subtitles, "subtitles");
				assert.deepEqual(back.rowStates, prior.rowStates, "rowStates");
				assert.deepEqual(back.trashBin, prior.trashBin, "trashBin");
				assert.ok(back.nextId >= prior.nextId, "nextId " + back.nextId + " ≥ " + prior.nextId);
				assert.equal(back.mi.hwm, hwm, "hwm 그대로");
				log("(A) 안전 지점 복원: 병합 전과 같음, nextId " + back.nextId + ", hwm " + hwm);
				const calls = await panel("window.__hostCalls");
				assert.deepEqual(calls.filter((c) => BAD_CALLS.test(c)), [], "병합은 Premiere 타임라인을 부르지 않는다: " + calls.join(","));
			});

			await H.withScratchSequence(api, "s1_8b", async () => {
				// (B) 화자 없는 기존 목록 (플래그를 켠 채 C번호 없는 파일 하나 → v27 교체)
				assert.equal(await panel(H.pageSetMiCast(true)), true);
				const mixed = CAP.C1.concat(CAP.C2).sort((a, b) => a[0] - b[0]);
				assert.equal(await panel(H.pageDropSrt("mixed.srt", CAP.srt(mixed))), "sent");
				await H.waitFor(panel, "document.querySelectorAll('#listWrap .sub-row').length === 13", { what: "섞인 목록 13줄" });
				let snap = await panel(SNAP);
				const ids = snap.subtitles.map((s) => s.id);
				assert.ok(snap.subtitles.every((s) => !s.spk), "화자 없음");
				await panel(H.pageSetRowPreset(ids[2], P.id));
				await H.waitFor(panel, "(() => { const s = " + SNAP + "; return (s.rowStates[" + ids[2] + "]._allParams || []).length > 0; })()", { what: "프리셋 속성" });
				assert.equal(await panel(pageSelect("#trackSel", "4")), "4");
				assert.equal(await panel(H.pageDropSrts([{ name: "C1.srt", content: bytesOf("cap_C1.srt") }, { name: "C2.srt", content: bytesOf("cap_interview_C2.srt") }])), "sent");
				const m = await H.waitFor(panel, "(() => { const m = " + H.PAGE_IMPORT_MODAL + "; return m && m.open && m.legacy ? m : null; })()", { what: "분배 모드 창" });
				assert.equal(m.legacy.info, "기존 목록 (화자 없음, 13줄) → C1 7 · C2 6");
				assert.equal(m.legacy.mode, "split");
				await panel("document.getElementById('impOk').click(), true");
				await H.waitFor(panel, "(() => { const s = " + SNAP + "; return s.subtitles.length === 13 && s.subtitles.every((x) => x.spk); })()", { what: "화자가 붙은 13줄" });
				snap = await panel(SNAP);
				assert.deepEqual(snap.subtitles.map((s) => s.id), ids, "같은 id·순서");
				assert.equal(snap.rowStates[ids[2]].presetId, P.id, "프리셋 그대로");
				assert.equal(snap.subtitles.find((s) => s.id === ids[2]).spk, "C1");
				assert.deepEqual(snap.mi.castOrder, ["C1", "C2"]);
				assert.equal(snap.mi.legacyTrack, 4);
				log("(B) 분배: " + m.legacy.info + " → legacyTrack " + snap.mi.legacyTrack);
			});
		} finally {
			await panel(H.pageSetMiCast(false));
		}
	}
};
