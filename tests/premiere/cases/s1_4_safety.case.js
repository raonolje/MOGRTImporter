"use strict";
/**
 * S1-4 하드: 안전 지점(history_safety.json)과 자동저장 중복 건너뛰기 (DEV 패널, MI_test.prproj의 T_ 시퀀스).
 * 모두 스크래치 사본(T_scratch_s1_4)에서 돈다. 사본의 DEV 세션 폴더는 끝나면 지워진다. 타임라인은 바꾸지 않는다.
 *   (3) 14줄 목록 위에 SRT를 열면 가장 최근 안전 지점 = 옛 14줄 ('SRT 가져오기 전: …')
 *   (1) 변화 없이 30분 무작업(Date.now를 앞당기고 idleAutosaveTick 6번) → '자동저장 (5분 무작업)' 1개
 *   (2) 히스토리 복원 → '히스토리 복원 전'이 먼저 남고, 그것을 #historySafety에서 복원하면 직전 상태와 정확히 같다
 *   (4) 자동저장 25개 뒤에도 안전 지점이 그대로 (자동저장은 20개)
 * 실행: npm run hard -- s1_4
 */
const fs = require("node:fs");
const path = require("node:path");
const H = require("../lib/hard");

const MIN = 60 * 1000;
const srtOf = (texts) => texts.map((t, i) => {
	const s = 1 + i * 2;
	const tc = (x) => "00:00:" + String(x).padStart(2, "0") + ",000";
	return (i + 1) + "\n" + tc(s) + " --> " + tc(s + 1) + "\n" + t + "\n";
}).join("\n");
const ROWS14 = Array.from({ length: 14 }, (_, i) => "S14 합성 줄 " + (i + 1));

// 페이지: Date.now를 멈춘 시계로 바꾸고(window.__s14now) 앞당기는 함수를 둔다
const PAGE_FREEZE_NOW = "(() => { if (!window.__s14realNow) window.__s14realNow = Date.now; window.__s14now = window.__s14realNow(); Date.now = () => window.__s14now; return true; })()";
const PAGE_UNFREEZE_NOW = "(() => { if (window.__s14realNow) { Date.now = window.__s14realNow; delete window.__s14realNow; } return true; })()";
const pageIdleTicks = (n) => "(() => { for (let i = 0; i < " + Number(n) + "; i++) { window.__s14now += " + (5 * MIN + 1000) + "; window._mogrtDebug.idleAutosaveTick(); } return true; })()";
const PAGE_PICK = "(() => { const s = window._mogrtDebug.snapshot(); return { subtitles: s.subtitles, rowStates: s.rowStates, trashBin: s.trashBin }; })()";
const pick = (e) => ({ subtitles: e.subtitles, rowStates: e.rowStates, trashBin: e.trashBin });

module.exports = {
	name: "S1-4 안전 지점·자동저장 중복",
	run: async (api) => {
		const { panel, assert, log } = api;
		await H.waitKeys(panel);
		const root = await H.devCacheRoot(panel);
		await H.withScratchSequence(api, "s1_4", async () => {
			const snap0 = await panel("window._mogrtDebug.snapshot()");
			const dir = path.join(root.replace(/\//g, path.sep), snap0.keys.proj, snap0.keys.seq);
			const read = (f) => { const p = path.join(dir, f); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : []; };
			const auto = () => read("history_auto.json");
			const safety = () => read("history_safety.json");
			try {
				// (3) 14줄 목록 위에 SRT
				assert.equal(await panel(H.pageDropSrt("s1_4_14.srt", srtOf(ROWS14))), "sent");
				await H.waitFor(panel, "document.querySelectorAll('#listWrap .sub-row').length === 14", { what: "14줄" });
				const old14 = await panel(PAGE_PICK);
				assert.equal(await panel(H.pageDropSrt("s1_4_new.srt", srtOf(["S14 새 하나", "S14 새 둘"]))), "sent");
				await H.waitFor(panel, "document.querySelectorAll('#listWrap .sub-row').length === 2", { what: "새 목록 2줄" });
				let sl = safety();
				assert.equal(sl[0].label, "SRT 가져오기 전: s1_4_new.srt");
				assert.equal(sl[0].kind, "safety");
				assert.deepEqual(pick(sl[0]), old14, "가장 최근 안전 지점 = 옛 14줄");
				log("(3) 안전 지점 " + sl.length + "개, 최근 " + sl[0].subtitles.length + "줄");

				// (1) 줄 하나를 지운 뒤 30분 무작업 → 자동저장 1개
				await panel("(() => { const b = Array.from(document.querySelectorAll('#listWrap .sub-row')[0].querySelectorAll('button')).find((x) => x.title === '삭제 (휴지통으로)'); b.click(); return true; })()");
				const autoBefore = auto().length;
				await panel(PAGE_FREEZE_NOW);
				await panel(pageIdleTicks(6));
				const a1 = auto();
				assert.equal(a1.length - autoBefore, 1, "30분 무작업 → 자동저장 1개 (6개가 아니다)");
				assert.equal(a1[0].label, "자동저장 (5분 무작업)");
				assert.match(a1[0].hash, /^[0-9a-f]{8}$/);
				log("(1) 자동저장 " + autoBefore + " → " + a1.length);

				// (2) 수동저장 X → 체크로 Y → X 복원 → '히스토리 복원 전'(=Y) → 그것을 복원하면 Y
				await panel("(() => { document.getElementById('btnHistory').click(); return true; })()");
				await H.waitFor(panel, "!!document.querySelector('#historyDropdown input[type=text]')", { what: "히스토리 드롭다운" });
				await panel("(() => { const d = document.getElementById('historyDropdown'); d.querySelector('input[type=text]').value = 'S14 X'; Array.from(d.querySelectorAll('button')).find((b) => b.textContent === '저장').click(); return true; })()");
				const X = await panel(PAGE_PICK);
				await panel("(() => { const c = document.querySelector('#listWrap .sub-row input[type=checkbox]'); c.click(); return c.checked; })()");
				const Y = await panel(PAGE_PICK);
				assert.notDeepEqual(Y, X);
				await panel("(() => { const d = document.getElementById('historyDropdown'); if (!d.classList.contains('open')) document.getElementById('btnHistory').click(); return true; })()");
				const clickedX = await panel("(() => { const it = Array.from(document.querySelectorAll('#historyDropdown .history-item')).find((x) => x.textContent.indexOf('S14 X') !== -1); if (!it) return false; it.firstChild.click(); return true; })()");
				assert.equal(clickedX, true, "수동저장 'S14 X'");
				await H.confirmYes(panel);
				assert.deepEqual(await panel(PAGE_PICK), X, "X로 복원");
				sl = safety();
				assert.equal(sl[0].label, "히스토리 복원 전");
				assert.deepEqual(pick(sl[0]), Y, "안전 지점 = 복원 직전(Y)");
				await panel("(() => { const d = document.getElementById('historyDropdown'); if (!d.classList.contains('open')) document.getElementById('btnHistory').click(); return true; })()");
				const order = await panel("(() => { const d = document.getElementById('historyDropdown'); const s = document.getElementById('historySafety'); return s ? Array.from(d.children).indexOf(s) : -1; })()");
				assert.equal(order, 1, "#historySafety는 수동저장과 자동저장 사이");
				await panel("(() => { document.querySelector('#historySafety .history-item').firstChild.click(); return true; })()");
				await H.confirmYes(panel);
				assert.deepEqual(await panel(PAGE_PICK), Y, "안전 지점 복원 = 복원 직전 상태");
				log("(2) 복원 → 되돌리기 정확");

				// (4) 자동저장 25개 (매번 체크를 바꿔 내용을 다르게) → 안전 지점 그대로
				const safetyBefore = safety();
				for (let i = 0; i < 25; i++) {
					await panel("(() => { document.querySelector('#listWrap .sub-row input[type=checkbox]').click(); return true; })()");
					await panel(pageIdleTicks(1));
				}
				assert.equal(auto().length, 20, "자동저장은 20개에서 잘린다");
				assert.deepEqual(safety(), safetyBefore, "안전 지점은 그대로");
				log("(4) 자동저장 25번 뒤 안전 지점 " + safety().length + "개 그대로");
			} finally {
				await panel(PAGE_UNFREEZE_NOW);
			}
		});
	}
};
