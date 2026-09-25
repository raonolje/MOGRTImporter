"use strict";
/**
 * S1-6 하드: T1..Tn 필드 ID 배지 (DEV 패널, MI_test.prproj의 T_ 시퀀스). 스크래치 사본(T_scratch_s1_6)에서 돈다.
 * 프리셋은 저장하지 않는다 (모달은 닫기만 한다). 타임라인은 바꾸지 않는다.
 *   (1) 텍스트 필드가 2개 이상인 프리셋의 편집 모달: 배지 T1..Tn이 [T 버튼]과 [이름] 사이, 캡션 필드만 초록
 *       (스펙은 preset_6이지만 DEV 캐시의 프리셋 id는 다를 수 있어 조건에 맞는 프리셋을 고른다. 없으면 모달로 만든다)
 *   (2) 다른 필드의 T를 누르면 초록이 옮겨 가고, 원래 T를 누르면 돌아온다 (저장하지 않는다)
 *   (3) 행 속성창에도 같은 배지 (#12 줄에 그 프리셋)
 *   (5) #12 줄의 배지를 누르면 '#12 Tk'가 클립보드에 (상태 줄 + navigator.clipboard 기록 + Windows 클립보드)
 *   (4) 옛 구조 줄(텍스트만 0부터 다시 매긴 _allParams) → T1이 index 0 (resolve '#1 T1'.field.index === 0)
 *   (6) 네이티브 'Basic Lower Third'를 새 프리셋 모달로 두 번 열어도 같은 이름(definition.json TextLayer 기본 문구)
 * 실행: npm run hard -- s1_6
 */
const { execFileSync } = require("node:child_process");
const H = require("../lib/hard");

const srtOf = (texts) => texts.map((t, i) => {
	const s = 1 + i * 2;
	const tc = (x) => "00:00:" + String(x).padStart(2, "0") + ",000";
	return (i + 1) + "\n" + tc(s) + " --> " + tc(s + 1) + "\n" + t + "\n";
}).join("\n");
const SNAP = "window._mogrtDebug.snapshot()";
// 모달 배지 [{fid, cap, prev, next, label}]
const PAGE_MODAL_BADGES = "Array.from(document.querySelectorAll('#defaultModalBody .fid-badge')).map((b) => ({ fid: b.textContent, cap: b.classList.contains('cap'), title: b.title," +
	" prev: b.previousElementSibling ? b.previousElementSibling.className : '', next: b.nextElementSibling ? b.nextElementSibling.className : ''," +
	" label: b.nextElementSibling ? b.nextElementSibling.textContent : '' }))";
const pageRowBadges = (id) => "Array.from(document.querySelectorAll('#params-" + Number(id) + " .fid-badge')).map((b) => ({ fid: b.textContent, cap: b.classList.contains('cap'), label: b.parentNode.textContent.slice(b.textContent.length) }))";
const PAGE_CLOSE_MODALS = "(() => { const a = document.getElementById('btnClosePresetEdit'); if (a) a.click(); const b = document.getElementById('btnCloseModal'); if (b) b.click(); return true; })()";
const pageClickT = (fid) => "(() => { const b = Array.from(document.querySelectorAll('#defaultModalBody .fid-badge')).find((x) => x.textContent === " + JSON.stringify(fid) + "); if (!b) return false; b.parentNode.querySelector('.modal-text-target-btn').click(); return true; })()";
const pageOpenEdit = (pid) => "(() => { const ids = Object.keys(window._mogrtDebug.snapshot().presets); const k = ids.indexOf(" + JSON.stringify(pid) + "); const btns = Array.from(document.querySelectorAll('#presetList button')).filter((b) => b.textContent === '편집'); if (k < 0 || !btns[k]) return false; btns[k].click(); return true; })()";

function winClipboard() {
	try {
		return execFileSync("powershell", ["-NoProfile", "-Command", "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-Clipboard"], { encoding: "utf8", timeout: 15000 }).replace(/\r?\n$/, "");
	} catch (e) {
		return null;
	}
}

module.exports = {
	name: "S1-6 T1..Tn 필드 ID 배지",
	run: async (api) => {
		const { panel, assert, log } = api;
		await H.waitKeys(panel);
		await H.withScratchSequence(api, "s1_6", async () => {
			// 프리셋 고르기: 네이티브가 아니고 캡션이 있고 텍스트 필드가 2개 이상 (많을수록 좋다)
			const pick = (list) => list.filter((p) => !p.native && p.captionFid && p.fields.length >= 2).sort((a, b) => b.fields.length - a.fields.length)[0] || null;
			let P = pick((await panel(H.pageCmd("presets", {}))).data);
			if (!P) {
				await H.ensurePreset(api);
				P = pick((await panel(H.pageCmd("presets", {}))).data);
			}
			assert.ok(P, "텍스트 필드가 2개 이상이고 캡션이 있는 프리셋이 필요하다");
			log("프리셋 " + P.id + " (" + P.fields.map((f) => f.fid + (f.caption ? "*" : "")).join(" ") + ")");

			// (1) 편집 모달
			assert.equal(await panel(pageOpenEdit(P.id)), true, "편집 버튼");
			await H.waitFor(panel, "document.querySelectorAll('#defaultModalBody .fid-badge').length === " + P.fields.length, { timeoutMs: 120000, stepMs: 500, what: "모달 배지 " + P.fields.length + "개" });
			let mb = await panel(PAGE_MODAL_BADGES);
			assert.deepEqual(mb.map((b) => b.fid), P.fields.map((f) => f.fid));
			assert.deepEqual(mb.map((b) => b.cap), P.fields.map((f) => f.fid === P.captionFid), "캡션 필드만 초록");
			assert.ok(mb.every((b) => /modal-text-target-btn/.test(b.prev) && b.next === "modal-mogrt-label"), "배지 자리: T 버튼과 이름 사이 " + JSON.stringify(mb.map((b) => [b.prev, b.next])));
			// 이름은 MOGRT에서 새로 읽은 것이라 프리셋 저장 뒤 MOGRT를 다시 저장했다면 다를 수 있다 → 기록만
			if (mb.some((b, k) => b.label !== P.fields[k].label)) log("모달 이름이 프리셋과 다르다(MOGRT 재저장?): " + JSON.stringify(mb.map((b) => b.label)));
			assert.equal(await panel("/T1·T2…/.test(document.querySelector('#defaultModalBody .modal-guide').innerHTML)"), true, "안내 문구");

			// (2) T 이동
			const other = P.fields.find((f) => !f.caption);
			assert.equal(await panel(pageClickT(other.fid)), true);
			mb = await panel(PAGE_MODAL_BADGES);
			assert.deepEqual(mb.filter((b) => b.cap).map((b) => b.fid), [other.fid], "초록이 " + other.fid + "로");
			assert.equal(await panel(pageClickT(P.captionFid)), true);
			mb = await panel(PAGE_MODAL_BADGES);
			assert.deepEqual(mb.filter((b) => b.cap).map((b) => b.fid), [P.captionFid], "원래대로");
			await panel(PAGE_CLOSE_MODALS);
			log("(1)(2) 모달 배지·T 이동");

			// (3) 행 속성창
			const texts = Array.from({ length: 12 }, (_, i) => "S16 합성 줄 " + (i + 1));
			assert.equal(await panel(H.pageDropSrt("s1_6.srt", srtOf(texts))), "sent");
			await H.waitFor(panel, "document.querySelectorAll('#listWrap .sub-row').length === 12", { what: "12줄" });
			const snap = await panel(SNAP);
			const row12 = snap.subtitles.find((s) => s.index === 12);
			await panel(H.pageSetRowPreset(row12.id, P.id));
			await H.waitFor(panel, "document.querySelectorAll('#params-" + row12.id + " .fid-badge').length > 0", { what: "#12 속성창 배지" });
			const rb = await panel(pageRowBadges(row12.id));
			const byFid = {};
			P.fields.forEach((f) => { byFid[f.fid] = f; });
			rb.forEach((b) => {
				assert.ok(byFid[b.fid], "행 배지 " + b.fid + "는 프리셋 필드");
				assert.equal(b.label, byFid[b.fid].label, b.fid + " 이름");
				assert.equal(b.cap, b.fid === P.captionFid, b.fid + " 초록");
			});
			log("(3) 행 배지 " + rb.map((b) => b.fid + (b.cap ? "*" : "")).join(" "));

			// (5) 복사
			const target = rb[1] || rb[0];
			await panel("(() => { window.__s16clip = []; const c = navigator.clipboard; if (c && !window.__s16hook) { window.__s16hook = true; const orig = c.writeText.bind(c); c.writeText = (t) => { window.__s16clip.push(t); return orig(t); }; } return true; })()");
			await panel("(() => { const b = Array.from(document.querySelectorAll('#params-" + row12.id + " .fid-badge')).find((x) => x.textContent === " + JSON.stringify(target.fid) + "); b.click(); return true; })()");
			const want = "#12 " + target.fid;
			const st = await H.waitStatus(panel, /^(복사됨|클립보드에 넣지 못했습니다)/);
			assert.equal(st.text, "복사됨: " + want + " (" + target.label + ") — AI에게 붙여 넣으면 됩니다", "상태 줄: " + st.text);
			const rec = await panel("window.__s16clip");
			log("navigator.clipboard 기록: " + JSON.stringify(rec));
			const clip = winClipboard();
			if (clip === null) log("Windows 클립보드를 읽지 못했다 (PowerShell) — 상태 줄로만 확인");
			else assert.equal(clip, want, "Windows 클립보드");
			log("(5) 복사: " + want);

			// (4) 옛 구조 줄: 텍스트만 0부터 다시 매긴 _allParams
			const full = snap.presets[P.id].params;
			const stale = full.filter((p) => p.type === "text").map((p, i) => Object.assign({}, p, { index: i }));
			const work = {
				version: 2, savedAt: new Date().toISOString(), sequenceKey: snap.keys.seq,
				subtitles: [{ index: 1, startTime: "00:00:01.000", endTime: "00:00:02.000", startSec: 1, endSec: 2, text: "S16 옛 구조", id: 9001 }],
				rowStates: { 9001: { presetId: P.id, params: stale, _allParams: stale, open: true, checked: false } },
				trashBin: [], nextId: 9002, trackValue: "2"
			};
			assert.equal(await panel(H.pageLoadWork("s1_6_stale.json", work)), "sent");
			await H.waitFor(panel, "document.querySelectorAll('#params-9001 .fid-badge').length === " + stale.length, { what: "옛 구조 줄 배지" });
			const sb = await panel(pageRowBadges(9001));
			assert.deepEqual(sb.map((b) => b.fid), stale.map((_, i) => "T" + (i + 1)));
			assert.equal(sb[0].label, stale[0].displayName);
			const r1 = await panel(H.pageCmd("resolve", { label: "#1 T1" }));
			assert.equal(r1.ok, true, JSON.stringify(r1));
			assert.equal(r1.data.field.index, 0, "T1 = index 0");
			log("(4) 옛 구조 줄 T1 → index 0 (" + sb[0].label + ")");

			// (6) 네이티브 두 번 열기
			const mogrts = await H.waitMogrts(panel, 1);
			const nat = mogrts.find((m) => /Basic Lower Third/i.test(m[1]) || /Basic Lower Third\.mogrt$/i.test(m[0]));
			if (!nat) {
				log("(6) 'Basic Lower Third'가 MOGRT 목록에 없다 — 건너뜀 (사람이 네이티브 MOGRT로 확인)");
				return;
			}
			const openNew = async () => {
				await panel(PAGE_CLOSE_MODALS);
				await panel("document.getElementById('btnAddPreset').click(), true");
				await H.waitFor(panel, "document.getElementById('defaultMogrtSel').options.length > 1", { what: "모달 MOGRT 목록" });
				await panel("(() => { const s = document.getElementById('defaultMogrtSel'); s.value = " + JSON.stringify(nat[0]) + "; s.dispatchEvent(new Event('change')); return s.value; })()");
				await H.waitFor(panel, "document.querySelectorAll('#defaultModalBody .fid-badge').length > 0", { timeoutMs: 120000, stepMs: 500, what: "네이티브 모달 배지" });
				return panel(PAGE_MODAL_BADGES);
			};
			const n1 = await openNew();
			const n2 = await openNew();
			await panel(PAGE_CLOSE_MODALS);
			log("(6) 네이티브 이름: " + JSON.stringify(n1.map((b) => b.fid + "=" + b.label)));
			assert.deepEqual(n2.map((b) => [b.fid, b.label]), n1.map((b) => [b.fid, b.label]), "두 번 열어도 같은 이름");
			const orig = (await panel(SNAP)).mogrtOriginals[nat[0]] || [];
			assert.ok(orig.length > 0 && orig.every((p) => p.nativeText === true), "네이티브 목록 (nativeText)");
			assert.deepEqual(n1.map((b) => b.label), orig.map((p) => p.displayName), "캐시도 같은 이름 (패치 뒤 캐시)");
			assert.ok(n1.every((b) => !/^텍스트 \d+$/.test(b.label)), "definition.json 이름 (TextLayer 개수가 같으면)");
			const EXPECT = [["Second Line is Smaller", "두 번째 라인이 더 작음"], ["Your Name Here", "여기에 이름 표시"]];
			if (n1.length === 2) n1.forEach((b, k) => assert.ok(EXPECT[k].indexOf(b.label) !== -1, b.fid + " = " + b.label));
		});
	}
};
