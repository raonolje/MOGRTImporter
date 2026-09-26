"use strict";
/**
 * S2-3 하드: 화자 표·화자 칩·필터·휴지통 라벨·cast_defaults.json (DEV 패널, MI_test.prproj의 T_ 시퀀스). 타임라인은 바꾸지 않는다.
 * 스크래치 사본(T_scratch_s2_3a / _b)에서 돈다. 플래그는 window._mogrtDebug.setMiCast로만 켜고 끄며, 끝나면 코드 기본값으로 돌린다(setMiCast(null)).
 * 프로젝트 단위 cast_defaults.json(DEV 캐시)은 시작 전 내용으로 되돌린다. 모달로 만든 시험 프리셋은 지워서 프리셋 휴지통에 남는다.
 *   (1) C1·인터뷰_C2·C3 세 파일 → 화자 표 3줄 · 칩 4개 · 줄 번호 'C2·1'
 *   (4) C2 이름 바꾸기 → session.json · cast.json · cast_defaults.json 셋에 남는다
 *   (2)(3) 칩 C2 → C2 줄만 보인다 → 전체 선택 → 선택 삭제는 보이는 C2 줄만 휴지통 (휴지통 라벨 'C2·1'), 전체 복구로 되돌린다
 *   (6) 모달로 새 프리셋 → 화자 표의 기본 프리셋 선택지에 나온다
 *   (5) 그 프리셋을 C3 기본 프리셋으로 걸고 ⋯ 적용 → 칩 C2만 → 프리셋 탭에서 삭제 → 화자 표 C3 기본 프리셋이 비고, C2만 보이는 필터는 그대로
 *   (9) 패널을 새로 고친다 (화자 세션이 있는 시퀀스) → 예외 없이 bootDone, 화자 표 3줄
 *   (7)(8) 단일 화자(플래그 끔) 다섯 줄 → 화자 표·칩 숨김, 줄 DOM이 v27 모양(인라인 style 없음, spk- 없음, 자식 순서),
 *          2·4를 지우고 4 → 2 순서로 되살리면 v27 자리 규칙대로 [1,3,4,5] → [1,2,3,4,5]
 * 실행: npm run hard -- s2_3
 */
const fs = require("node:fs");
const path = require("node:path");
const H = require("../lib/hard");

const FIX = path.join(__dirname, "..", "..", "fixtures", "srt");
const bytesOf = (name) => fs.readFileSync(path.join(FIX, name));
const SNAP = "window._mogrtDebug.snapshot()";
const DOT = String.fromCharCode(0xb7);
const C3_SRT = H.srtOf([[27, 28.5, "S23 세 번째 화자 하나"], [29, 30, "S23 세 번째 화자 둘"], [31, 32.5, "S23 세 번째 화자 셋"]]);
const SINGLE_SRT = H.srtOf([[1, 2, "S23 하나"], [3, 4, "S23 둘"], [5, 6, "S23 셋"], [7, 8, "S23 넷"], [9, 10, "S23 다섯"]]);

// 페이지 표현식
const PAGE_CAST = "(() => { const bar = document.getElementById('castBar'); return { shown: bar.style.display !== 'none', title: (document.getElementById('castTitle') || {}).textContent || ''," +
	" rows: Array.from(document.querySelectorAll('#castRows .cast-row')).map((r) => ({ key: r.dataset.key, name: r.querySelector('.cast-name').value," +
	"  track: r.querySelector('.cast-track').options[0].textContent, preset: r.querySelector('.cast-preset').value," +
	"  presets: Array.from(r.querySelector('.cast-preset').options).map((o) => o.value), count: r.querySelector('.cast-count').textContent }))," +
	" chips: document.getElementById('speakerChips').style.display === 'none' ? null : Array.from(document.querySelectorAll('#speakerChips .spk-chip')).map((c) => c.textContent + (c.classList.contains('active') ? '*' : '')) }; })()";
// 필터로 숨지 않은 줄 (목록 탭이 가려져 있어도 같은 값이 나오게 클래스로 본다)
const PAGE_VISIBLE = "Array.from(document.querySelectorAll('#listWrap .sub-row')).filter((r) => !/(search|preset-filter|speaker-filter)-hidden/.test(r.className)).map((r) => parseInt(r.id.slice(4), 10))";
const pageChip = (label) => "(() => { const c = Array.from(document.querySelectorAll('#speakerChips .spk-chip')).find((x) => x.textContent === " + JSON.stringify(label) + "); if (!c) return false; c.click(); return true; })()";
const pageCastName = (K, v) => "(() => { const i = document.querySelector('#castRows .cast-row[data-key=" + K + "] .cast-name'); i.value = " + JSON.stringify(v) + "; i.dispatchEvent(new Event('change')); return i.value; })()";
const pageCastPreset = (K, v) => "(() => { const s = document.querySelector('#castRows .cast-row[data-key=" + K + "] .cast-preset'); s.value = " + JSON.stringify(v) + "; s.dispatchEvent(new Event('change')); return s.value; })()";
const pageCastMenu = (K, act) => "(() => { const r = document.querySelector('#castRows .cast-row[data-key=" + K + "]'); r.querySelector('.cast-more').click();" +
	" const b = Array.from(r.querySelectorAll('.cast-menu button')).find((x) => x.dataset.act === " + JSON.stringify(act) + "); if (!b) return false; b.click(); return true; })()";
const pageDelRow = (id) => "(() => { const r = document.getElementById('row-" + Number(id) + "'); if (!r) return false; const b = Array.from(r.querySelectorAll('button')).find((x) => x.title === '삭제 (휴지통으로)'); b.click(); return true; })()";
const pageRestore = (i) => "(() => { const b = document.querySelectorAll('#trashWrap .btn-restore')[" + Number(i) + "]; if (!b) return false; b.click(); return true; })()";
const PAGE_ROW_IDS = "Array.from(document.querySelectorAll('#listWrap .sub-row')).map((r) => parseInt(r.id.slice(4), 10))";
// v27 makeRow 모양: 줄 = sub-header + sub-params, 머리 = 체크 · 번호 · 시간 · 문장 · 프리셋 · ▶ · ↑ · ✕, 인라인 style 없음
const PAGE_ROW_SHAPE = "Array.from(document.querySelectorAll('#listWrap .sub-row')).map((r) => ({ cls: r.className, style: r.getAttribute('style')," +
	" kids: Array.from(r.children).map((c) => c.className), head: Array.from(r.querySelector('.sub-header').children).map((c) => c.className) }))";

function readJson(file) {
	return JSON.parse(fs.readFileSync(file, "utf8"));
}

module.exports = {
	name: "S2-3 화자 표·화자 칩·필터·휴지통 라벨·cast_defaults",
	run: async (api) => {
		const { panel, assert, log, reload } = api;
		await H.waitKeys(panel);
		const root = await H.devCacheRoot(panel);
		const snap0 = await panel(SNAP);
		const defPath = path.join(root.replace(/\//g, path.sep), snap0.keys.proj, "cast_defaults.json");
		const defBefore = fs.existsSync(defPath) ? fs.readFileSync(defPath) : null;
		// 캡션이 있는 AE 프리셋 하나 (C1 기본 프리셋)
		const pick = (list) => list.filter((p) => !p.native && p.captionFid).sort((a, b) => b.fields.length - a.fields.length)[0] || null;
		let P = pick((await panel(H.pageCmd("presets", {}))).data);
		if (!P) {
			await H.ensurePreset(api);
			P = pick((await panel(H.pageCmd("presets", {}))).data);
		}
		assert.ok(P, "캡션 필드가 있는 AE 프리셋이 필요하다");
		const mogrtOf = (id) => panel("window._mogrtDebug.snapshot().presets[" + JSON.stringify(id) + "].mogrtPath");
		try {
			await H.withScratchSequence(api, "s2_3a", async () => {
				assert.equal(await panel(H.pageSetMiCast(true)), true);
				// (1) 세 화자
				assert.equal(await panel(H.pageDropSrts([
					{ name: "C1.srt", content: bytesOf("cap_C1.srt") },
					{ name: "인터뷰_C2.srt", content: bytesOf("cap_interview_C2.srt") },
					{ name: "C3.srt", content: C3_SRT }
				])), "sent");
				await H.waitFor(panel, "(() => { const m = " + H.PAGE_IMPORT_MODAL + "; return m && m.open && m.rows.length === 3 ? m : null; })()", { what: "가져오기 창 3줄" });
				await panel("(() => { const rows = document.querySelectorAll('#impBody tr.imp-row'); const names = ['S23 철수', 'S23 영희', 'S23 민수'];" +
					" rows.forEach((r, i) => { const n = r.querySelector('.imp-name'); n.value = names[i]; n.dispatchEvent(new Event('input')); });" +
					" const p = rows[0].querySelector('.imp-preset'); p.value = " + JSON.stringify(P.id) + "; p.dispatchEvent(new Event('change')); return true; })()");
				await panel("document.getElementById('impOk').click(), true");
				await H.waitFor(panel, "document.querySelectorAll('#listWrap .sub-row').length === 16", { what: "16줄" });
				let cast = await panel(PAGE_CAST);
				assert.equal(cast.shown, true);
				assert.equal(cast.title, "화자 3명");
				assert.deepEqual(cast.rows.map((r) => [r.key, r.name, r.count]), [["C1", "S23 철수", "7줄"], ["C2", "S23 영희", "6줄"], ["C3", "S23 민수", "3줄"]]);
				assert.equal(cast.rows[0].preset, P.id);
				assert.deepEqual(cast.chips, ["전체*", "C1 S23 철수", "C2 S23 영희", "C3 S23 민수"]);
				const trackSel = Number(await panel("document.getElementById('trackSel').value"));
				assert.equal(cast.rows[0].track, "자동 (V" + (trackSel + 1) + ")", "첫 화자는 기본 트랙");
				assert.equal(cast.rows[1].track, "자동 (V" + (trackSel + 2) + ")");
				const nums = await panel("Array.from(document.querySelectorAll('#listWrap .sub-row .sub-num')).slice(0, 2).map((e) => e.textContent)");
				assert.deepEqual(nums, ["C1" + DOT + "1", "C2" + DOT + "1"]);
				const stripe = await panel("document.querySelector('#listWrap .sub-row.spk-C2').style.borderLeft");
				assert.match(stripe, /^3px solid/);
				log("(1) 화자 3명, 16줄, 칩 4개, 트랙 미리보기 " + cast.rows.map((r) => r.track).join(" / "));

				// (4) 이름 → 파일 셋
				assert.equal(await panel(pageCastName("C2", "S23 지영")), "S23 지영");
				let snap = await panel(SNAP);
				const dir = path.join(root.replace(/\//g, path.sep), snap.keys.proj, snap.keys.seq);
				assert.equal(readJson(path.join(dir, "session.json")).mi.cast.C2.name, "S23 지영");
				assert.equal(readJson(path.join(dir, "cast.json")).cast.C2.name, "S23 지영");
				assert.equal(readJson(defPath).C2.name, "S23 지영");
				const hist = readJson(path.join(dir, "history_auto.json"));
				assert.equal(hist[0].label, "화자 이름: C2 S23 지영");
				log("(4) 이름 → session.json · cast.json · cast_defaults.json");

				// (2)(3) 칩 필터 → 전체 선택 → 선택 삭제는 보이는 줄만
				const c2ids = snap.subtitles.filter((s) => s.spk === "C2").map((s) => s.id);
				assert.equal(await panel(pageChip("C2 S23 지영")), true);
				assert.deepEqual((await panel(PAGE_VISIBLE)).sort((a, b) => a - b), c2ids.slice().sort((a, b) => a - b), "C2 줄만 보인다");
				await panel("document.getElementById('btnToggleSelect').click(), true");
				snap = await panel(SNAP);
				assert.deepEqual(snap.subtitles.filter((s) => snap.rowStates[s.id].checked).map((s) => s.id), c2ids, "보이는 줄만 선택");
				await panel("document.getElementById('btnMultiDel').click(), true");
				await H.waitFor(panel, "document.querySelectorAll('#listWrap .sub-row').length === 10", { what: "C2 여섯 줄 삭제" });
				snap = await panel(SNAP);
				assert.ok(snap.subtitles.every((s) => s.spk !== "C2"), "C1·C3 줄은 그대로");
				const labels = await panel("Array.from(document.querySelectorAll('#trashWrap .trash-row .trash-num')).map((e) => e.textContent)");
				assert.equal(labels[0], "C2" + DOT + "1");
				await panel("document.getElementById('btnRestoreAll').click(), true");
				await H.waitFor(panel, "document.querySelectorAll('#listWrap .sub-row').length === 16", { what: "전체 복구" });
				snap = await panel(SNAP);
				for (let i = 1; i < snap.subtitles.length; i++) assert.ok(snap.subtitles[i - 1].startSec <= snap.subtitles[i].startSec, "되살린 줄은 시간 자리에");
				assert.equal(await panel(pageChip("전체")), true);
				assert.equal((await panel(PAGE_VISIBLE)).length, 16);
				log("(2)(3) 칩 C2 → 전체 선택·선택 삭제 6줄(C2만), 휴지통 '" + labels[0] + "', 전체 복구 시간순");

				// (6) 새 프리셋 → 화자 표 선택지
				const before = Object.keys((await panel(SNAP)).presets);
				await H.createPresetViaModal(api, await mogrtOf(P.id), { name: "S23 삭제 시험" });
				await H.waitFor(panel, "Object.keys(window._mogrtDebug.snapshot().presets).length === " + (before.length + 1), { what: "새 프리셋" });
				await panel("(() => { const b = document.getElementById('btnCancelPresetEdit'); if (b && document.getElementById('presetEditModal').classList.contains('open')) b.click(); return true; })()");
				const newId = Object.keys((await panel(SNAP)).presets).find((id) => before.indexOf(id) === -1);
				cast = await panel(PAGE_CAST);
				assert.ok(cast.rows[2].presets.indexOf(newId) !== -1, "화자 표 선택지에 " + newId);
				log("(6) 새 프리셋 " + newId + " → 화자 표 선택지");

				// (5) C3 기본 프리셋 = 새 프리셋 → ⋯ 적용 → 칩 C2 → 프리셋 삭제
				assert.equal(await panel(pageCastPreset("C3", newId)), newId);
				assert.equal(await panel(pageCastMenu("C3", "preset")), true);
				await H.waitFor(panel, "(() => { const s = " + SNAP + "; return s.subtitles.filter((x) => x.spk === 'C3').every((x) => s.rowStates[x.id].presetId === " + JSON.stringify(newId) + "); })()", { what: "C3 줄에 기본 프리셋" });
				const safety = readJson(path.join(dir, "history_safety.json"));
				assert.equal(safety[0].label, "기본 프리셋 일괄 적용 전: C3");
				assert.equal(await panel(pageChip("C2 S23 지영")), true);
				await panel("document.getElementById('tabBtnPresets').click(), true");
				await panel("(() => { const rows = Array.from(document.querySelectorAll('#presetList .preset-row')); const r = rows.find((x) => x.querySelector('.preset-name').textContent === " + JSON.stringify((await panel(SNAP)).presets[newId].name) + "); r.querySelector('.btn.danger').click(); return true; })()");
				const msg = await H.confirmYes(panel);
				assert.match(msg, new RegExp("자막 C3" + DOT + "1, C3" + DOT + "2, C3" + DOT + "3에 적용되어 있습니다"), msg);
				assert.match(msg, /화자 기본 프리셋: C3 S23 민수/);
				await panel("document.getElementById('tabBtnList').click(), true");
				snap = await panel(SNAP);
				assert.equal(snap.mi.cast.C3.presetId, "");
				assert.equal(snap.presets[newId], undefined);
				cast = await panel(PAGE_CAST);
				assert.equal(cast.rows[2].preset, "");
				assert.deepEqual((await panel(PAGE_VISIBLE)).sort((a, b) => a - b), c2ids.slice().sort((a, b) => a - b), "숨은 화자는 숨은 채");
				log("(5) 프리셋 삭제 → C3 기본 프리셋 비움, C2 필터 유지");

				// (9) 새로 고침 → bootDone, 화자 표 3줄
				await H.reloadClean(reload, assert, log);
				await H.waitKeys(panel);
				assert.equal(await panel("window._mogrtDebug.bootDone === true"), true);
				cast = await H.waitFor(panel, "(() => { const c = " + PAGE_CAST + "; return c.rows.length === 3 ? c : null; })()", { what: "새로 고친 뒤 화자 표" });
				assert.deepEqual(cast.rows.map((r) => r.name), ["S23 철수", "S23 지영", "S23 민수"]);
				log("(9) 새로 고침 → bootDone, 화자 표 3줄");
			});

			await H.withScratchSequence(api, "s2_3b", async () => {
				// (7)(8) 단일 화자 (플래그 끔: 레거시 경로)
				await panel(H.pageSetMiCast(false));
				assert.equal(await panel(H.pageDropSrt("s23_single.srt", SINGLE_SRT)), "sent");
				await H.waitFor(panel, "document.querySelectorAll('#listWrap .sub-row').length === 5", { what: "5줄" });
				const cast = await panel(PAGE_CAST);
				assert.deepEqual([cast.shown, cast.chips], [false, null], "화자 표·칩 숨김");
				const shape = await panel(PAGE_ROW_SHAPE);
				shape.forEach((r) => {
					assert.match(r.cls, /^sub-row (no-mogrt|has-mogrt preset-color-\d+)( is-checked)?$/, r.cls);
					assert.equal(r.style, null, "인라인 style 없음");
					assert.deepEqual(r.kids, ["sub-header", "sub-params"]);
					assert.deepEqual(r.head, ["chk-wrap", "sub-num", "sub-time", "sub-text", "mogrt-sel", "btn-del", "btn-update", "btn-del"]);
				});
				const ids = await panel(PAGE_ROW_IDS);
				assert.equal(await panel(pageDelRow(ids[1])), true);
				assert.equal(await panel(pageDelRow(ids[3])), true);
				assert.equal(await panel(pageRestore(1)), true);
				const o1 = await panel(PAGE_ROW_IDS);
				assert.equal(await panel(pageRestore(0)), true);
				const o2 = await panel(PAGE_ROW_IDS);
				assert.deepEqual([o1, o2], [[ids[0], ids[2], ids[3], ids[4]], ids], "v27 자리 규칙 (지웠던 position)");
				log("(7)(8) 단일 화자: 화자 표 없음, v27 줄 모양, 되살리기 자리 v27");
			});
		} finally {
			// 파일을 먼저 되돌린다: 패널 호출(CDP)이 실패해도 DEV 캐시의 프로젝트 파일은 제자리로 (S3-4 리뷰, s3_4_e2e와 같은 순서)
			try {
				if (defBefore) fs.writeFileSync(defPath, defBefore);
				else if (fs.existsSync(defPath)) fs.unlinkSync(defPath);
				log("cast_defaults.json 되돌림: " + (defBefore ? "시작 전 내용" : "지움 (시작 전에는 없었다)"));
			} catch (e) {
				log("경고: cast_defaults.json을 되돌리지 못했다 — " + e.message);
			}
			try {
				await panel(H.pageSetMiCast(null));
			} catch (e) {
				log("경고: 다화자 기본값 되돌리기 실패 — " + e.message);
			}
		}
	}
};
