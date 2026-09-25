"use strict";
/**
 * S1-7 하드: SRT 열기 라우터·인코딩 확인·여러 SRT 가져오기 (DEV 패널, MI_test.prproj의 T_ 시퀀스).
 * 스크래치 사본(T_scratch_s1_7a / _b)에서 돈다. 사본의 DEV 세션 폴더는 끝나면 지워진다.
 * 플래그는 디버그 훅 window._mogrtDebug.setMiCast로만 켜고 끈다 (코드를 고치지 않는다). 끝나면 끈다.
 * 가져오기는 Premiere를 건드리지 않는다: 호스트 호출 기록에 배치·갱신 함수가 없어야 한다.
 *   (a) 플래그 꺼짐, 평범한 SRT 하나 → v27 골든과 같은 줄, session.json 키 4개(mi 없음), #srtInput에 multiple 없음
 *   (b) 플래그 꺼짐, 인터뷰_C2.srt → 레거시 (화자·srtNo 없음, 태그 그대로)
 *   (c) 플래그 꺼짐, CP949 파일 → 확인창 '…CP949로 읽었습니다' + 한글 미리보기 → [가져오기]
 *   (d) 깨진 바이트 하나가 있는 UTF-8 → 'UTF-8로 읽음'·'깨진 글자 3개' (모지바케가 아니다) → [가져오기]
 *   (e) 플래그 켜짐, C1.srt + 인터뷰_C2.srt → 가져오기 창 → 화자 C1·C2, 줄에 spk·srtNo, 시간순, cast.json
 *   (f) C2 두 파일 → 두 줄 빨강, [가져오기] 꺼짐, 'C2가 두 파일에 지정되었습니다'
 * 실행: npm run hard -- s1_7
 */
const fs = require("node:fs");
const path = require("node:path");
const H = require("../lib/hard");
const { loadRegions } = require("../../lib/loadRegions");

const FIX = path.join(__dirname, "..", "..", "fixtures", "srt");
const bytesOf = (name) => fs.readFileSync(path.join(FIX, name));
const core = loadRegions(["src/srtParser.ts", "src/mi/core.ts"]);
const SNAP = "window._mogrtDebug.snapshot()";
const BAD_CALLS = /^(applyToTimeline|updateClipAtTime|insertClip|seekToClip|MI_|MID_)/;

module.exports = {
	name: "S1-7 SRT 열기 라우터·인코딩 확인·여러 SRT 가져오기 (플래그)",
	run: async (api) => {
		const { panel, assert, log } = api;
		await H.waitKeys(panel);
		const root = await H.devCacheRoot(panel);
		await panel(H.pageSetMiCast(false));
		try {
			await H.withScratchSequence(api, "s1_7a", async () => {
				await panel(H.PAGE_RECORD_HOST_CALLS);
				// (a) 골든
				assert.equal(await panel("document.getElementById('srtInput').multiple || document.getElementById('srtInput').hasAttribute('multiple')"), false, "multiple 없음");
				const golden = bytesOf("golden_crlf.srt");
				assert.equal(await panel(H.pageDropSrt("golden_crlf.srt", golden)), "sent");
				await H.waitFor(panel, "document.querySelectorAll('#listWrap .sub-row').length === 3", { what: "골든 3줄" });
				let snap = await panel(SNAP);
				const want = JSON.parse(JSON.stringify(core.parseSRT(golden.toString("utf8"))));
				assert.deepEqual(snap.subtitles.map((s) => { const c = Object.assign({}, s); delete c.id; return c; }), want, "v27 parseSRT 그대로");
				const dir = path.join(root.replace(/\//g, path.sep), snap.keys.proj, snap.keys.seq);
				const sess = JSON.parse(fs.readFileSync(path.join(dir, "session.json"), "utf8"));
				assert.deepEqual(Object.keys(sess), ["subtitles", "rowStates", "trashBin", "nextId"], "키 4개 (mi 없음)");
				assert.equal(fs.existsSync(path.join(dir, "cast.json")), false);
				log("(a) 골든 3줄, 키 4개, multiple 없음");

				// (b) C번호 파일도 플래그가 꺼져 있으면 레거시
				assert.equal(await panel(H.pageDropSrt("인터뷰_C2.srt", bytesOf("cap_interview_C2.srt"))), "sent");
				await H.waitFor(panel, "document.querySelectorAll('#listWrap .sub-row').length === 6", { what: "C2 6줄" });
				snap = await panel(SNAP);
				assert.ok(snap.subtitles.every((s) => s.spk === undefined && s.srtNo === undefined), "화자·srtNo 없음");
				assert.ok(snap.subtitles.some((s) => s.text === "<i>좋아요</i>"), "태그 그대로 (v27)");
				assert.equal(await panel("document.getElementById('importModal').classList.contains('open')"), false);
				log("(b) 인터뷰_C2.srt → 레거시 6줄");

				// (c) CP949
				assert.equal(await panel(H.pageDropSrt("enc_cp949.srt", bytesOf("enc_cp949.srt"))), "sent");
				const msgC = await H.confirmYes(panel);
				assert.match(msgC, /^‘enc_cp949\.srt’를 CP949로 읽었습니다\./, msgC);
				assert.match(msgC, /첫 자막: 00:00:01\.000 {2}안녕하세요 합성 자막/, "한글 미리보기: " + msgC);
				await H.waitFor(panel, "(() => { const s = " + SNAP + "; return s.subtitles.length === 2 && s.subtitles[0].text === '안녕하세요 합성 자막'; })()", { what: "CP949 2줄" });
				log("(c) " + msgC.split("\n")[0]);

				// (d) 깨진 바이트
				assert.equal(await panel(H.pageDropSrt("enc_utf8_badbyte.srt", bytesOf("enc_utf8_badbyte.srt"))), "sent");
				const msgD = await H.confirmYes(panel);
				assert.match(msgD, /깨진 글자 3개가 있습니다 \(UTF-8로 읽음\)/, msgD);
				assert.match(msgD, /합성 자막/);
				await H.waitFor(panel, "(() => { const s = " + SNAP + "; return s.subtitles.length === 2 && s.subtitles[1].text === '두 번째 줄입니다'; })()", { what: "깨진 바이트 파일 2줄" });
				snap = await panel(SNAP);
				assert.equal((snap.subtitles[0].text.match(/�/g) || []).length, 3);
				log("(d) " + msgD.split("\n")[0]);
				const calls = await panel("window.__hostCalls");
				assert.deepEqual(calls.filter((c) => BAD_CALLS.test(c)), [], "가져오기는 Premiere 타임라인을 부르지 않는다: " + calls.join(","));
			});

			await H.withScratchSequence(api, "s1_7b", async () => {
				assert.equal(await panel(H.pageSetMiCast(true)), true);
				assert.equal(await panel("document.getElementById('srtInput').multiple"), true);
				await panel(H.PAGE_RECORD_HOST_CALLS);
				// (e) C1 + 인터뷰_C2
				assert.equal(await panel(H.pageDropSrts([{ name: "C1.srt", content: bytesOf("cap_C1.srt") }, { name: "인터뷰_C2.srt", content: bytesOf("cap_interview_C2.srt") }])), "sent");
				let m = await H.waitFor(panel, "(() => { const m = " + H.PAGE_IMPORT_MODAL + "; return m && m.open && m.rows.length === 2 ? m : null; })()", { what: "가져오기 창 2줄" });
				assert.deepEqual(m.rows.map((r) => [r.key, r.count, r.action]), [["C1", "7줄", "새 화자"], ["C2", "6줄", "새 화자"]]);
				assert.equal(m.ok, true);
				await panel("(() => { const i = document.querySelector('#impBody tr.imp-row .imp-name'); i.value = 'S17 철수'; i.dispatchEvent(new Event('input')); return true; })()");
				await panel("document.getElementById('impOk').click(), true");
				await H.waitFor(panel, "document.querySelectorAll('#listWrap .sub-row').length === 13", { what: "13줄" });
				const snap = await panel(SNAP);
				assert.deepEqual(snap.mi.castOrder, ["C1", "C2"]);
				assert.deepEqual([snap.mi.cast.C1.name, snap.mi.cast.C2.name], ["S17 철수", "C2"]);
				assert.ok(snap.subtitles.every((s) => (s.spk === "C1" || s.spk === "C2") && typeof s.srtNo === "number"), "spk·srtNo");
				for (let i = 1; i < snap.subtitles.length; i++) assert.ok(snap.subtitles[i - 1].startSec <= snap.subtitles[i].startSec, "시간순");
				assert.match(snap.mi.salt, /^[a-z0-9]{4}$/);
				const dir = path.join(root.replace(/\//g, path.sep), snap.keys.proj, snap.keys.seq);
				const side = JSON.parse(fs.readFileSync(path.join(dir, "cast.json"), "utf8"));
				assert.deepEqual([side.salt, side.castOrder, side.hwm], [snap.mi.salt, ["C1", "C2"], snap.mi.hwm]);
				const sess = JSON.parse(fs.readFileSync(path.join(dir, "session.json"), "utf8"));
				assert.equal(sess.mi.salt, snap.mi.salt);
				const nums = await panel("Array.from(document.querySelectorAll('#listWrap .sub-row .sub-num')).slice(0, 2).map((e) => e.textContent)");
				assert.deepEqual(nums, ["C1" + String.fromCharCode(0xb7) + "1", "C2" + String.fromCharCode(0xb7) + "1"]);
				log("(e) 화자 C1·C2, 13줄, salt " + snap.mi.salt + ", cast.json hwm " + side.hwm);
				// ▶는 화자 줄을 v27 한 트랙 경로로 보내지 않는다
				await panel("document.getElementById('btnApply').click(), true");
				await H.waitStatus(panel, /화자별 배치는 개발 중입니다/);

				// (f) C2 두 파일
				assert.equal(await panel(H.pageDropSrts([{ name: "a_C2.srt", content: bytesOf("cap_interview_C2.srt") }, { name: "b_C2.srt", content: bytesOf("cap_C1.srt") }])), "sent");
				m = await H.waitFor(panel, "(() => { const m = " + H.PAGE_IMPORT_MODAL + "; return m && m.open && m.rows.length === 2 ? m : null; })()", { what: "가져오기 창 (C2 두 파일)" });
				assert.deepEqual(m.rows.map((r) => r.dup), [true, true], "두 줄 빨강");
				assert.equal(m.ok, false, "가져오기 꺼짐");
				assert.equal(m.error, "C2가 두 파일에 지정되었습니다");
				await panel("document.getElementById('impCancel').click(), true");
				assert.equal((await panel(SNAP)).subtitles.length, 13, "취소하면 그대로");
				log("(f) " + m.error);
				const calls = await panel("window.__hostCalls");
				assert.deepEqual(calls.filter((c) => BAD_CALLS.test(c)), [], "가져오기는 Premiere 타임라인을 부르지 않는다: " + calls.join(","));
			});
		} finally {
			await panel(H.pageSetMiCast(false));
		}
	}
};
