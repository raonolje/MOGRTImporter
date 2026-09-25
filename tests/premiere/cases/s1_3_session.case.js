"use strict";
/**
 * S1-3 하드: 세션 생명주기·부팅·V1 보호 (DEV 패널, MI_test.prproj의 T_ 시퀀스).
 *   (9) 새로 고침 예외 없음, bootDone, ▶ 핸들러
 *   (8) 키가 정해지면 SRT 열기·▶가 열린다 (시퀀스가 없을 때 막히는 것은 수동: 모든 시퀀스를 닫고 새로 고침)
 *   (1) 다른 T_ 시퀀스 3개를 돌아도 DEV 캐시 파일 수가 그대로
 *   (3) 읽지 못하는 session.json → 목록 유지, 쓰지 않음, 오류 표시 (원래 파일은 되돌린다)
 *   (4) 체크 안 된 줄에서 '-- 프리셋 선택 --' → 예외 없음
 *   (7) 히스토리 복원 → 새로 고친 뒤에도 #trackSel 복원
 *   (10) 모달 캐시가 없을 때 V1 클립이 그대로 (프리뷰 시퀀스가 없던 프로젝트면 패널이 만든다)
 *   (11) 같은 MOGRT를 두 번째로 열 때 definition 패치(드롭다운 이름)가 캐시에 있다
 * 필요: T_ 시퀀스 4개 이상. (2) 프로젝트 전환 네 조합은 두 번째 프로젝트가 필요해 수동이다 (보고서 참조).
 * 실행: npm run hard -- s1_3
 */
const fs = require("node:fs");
const path = require("node:path");
const H = require("../lib/hard");

const SRT = "1\n00:00:01,000 --> 00:00:02,000\nS13 합성 하나\n\n2\n00:00:03,000 --> 00:00:04,000\nS13 합성 둘\n";

// T_ 시퀀스 목록 [{name, id}]
const JSX_T_SEQS = "(function(){var p=app.project,o=[];for(var k=0;k<p.sequences.numSequences;k++){var s=p.sequences[k];if(String(s.name).indexOf('T_')===0)o.push({name:String(s.name),id:String(s.sequenceID)});}return JSON.stringify(o);})()";
const jsxOpenSeq = (id) => "(function(){try{return String(app.project.openSequence(" + JSON.stringify(id) + "));}catch(e){return 'ERR '+e;}})()";
const JSX_ACTIVE = "(function(){var s=app.project.activeSequence;return s?String(s.sequenceID):'';})()";
const JSX_ACTIVE_INFO = "(function(){var s=app.project.activeSequence;return JSON.stringify({name:String(s.name),id:String(s.sequenceID)});})()";

function countFiles(dir) {
	let n = 0;
	const walk = (d) => {
		for (const e of fs.readdirSync(d, { withFileTypes: true })) {
			if (e.isDirectory()) walk(path.join(d, e.name));
			else n++;
		}
	};
	if (fs.existsSync(dir)) walk(dir);
	return n;
}

async function switchTo(api, seq) {
	const { panel, host } = api;
	const r = await host(jsxOpenSeq(seq.id));
	if (r !== "true") throw new Error("openSequence 실패: " + seq.name + " → " + r);
	await H.waitFor(panel, "window._mogrtDebug.snapshot().keys.seqId === " + JSON.stringify(seq.id), { timeoutMs: 15000, what: "패널이 " + seq.name + "로 전환" });
}

module.exports = {
	name: "S1-3 세션 생명주기·부팅·V1 보호",
	run: async (api) => {
		const { panel, host, assert, log, reload } = api;
		// (9)(8)
		await H.reloadClean(reload, assert, log);
		await H.waitKeys(panel);
		assert.equal(await panel("window._mogrtDebug.bootDone === true"), true, "bootDone");
		let snap = await panel("window._mogrtDebug.snapshot()");
		assert.deepEqual([snap.flags.keysResolved, snap.flags.filtersReady], [true, true]);
		assert.equal(await panel("document.getElementById('btnApply').disabled"), false);
		const root = await H.devCacheRoot(panel);
		const cacheDir = root.replace(/\//g, path.sep);

		const home = JSON.parse(await host(JSX_ACTIVE_INFO));
		const others = JSON.parse(await host(JSX_T_SEQS)).filter((s) => s.id !== home.id);
		assert.ok(others.length >= 3, "다른 T_ 시퀀스가 3개 이상 필요하다: " + others.map((s) => s.name).join(","));
		const errProbe = "(() => { window.__s13errs = []; if (!window.__s13hook) { window.__s13hook = true; window.addEventListener('error', (e) => window.__s13errs.push(String(e.message))); } return true; })()";
		await panel(errProbe);

		try {
			// (1) 세션 없는 시퀀스 3개를 돌아도 파일 수 그대로 — 돌기 전에 이 세 시퀀스의 세션 유무를 기록
			const before = countFiles(cacheDir);
			for (const s of others.slice(0, 3)) await switchTo(api, s);
			await switchTo(api, home);
			const after = countFiles(cacheDir);
			log("DEV 캐시 파일: " + before + " → " + after);
			assert.equal(after, before, "시퀀스를 돌아다니기만 해서 파일이 생기면 안 된다");

			// (3) 읽지 못하는 session.json
			const B = others[0];
			snap = await panel("window._mogrtDebug.snapshot()");
			const bSessPath = path.join(cacheDir, snap.keys.proj, snap.keys.proj + "_seq_" + B.id.replace(/[^a-zA-Z0-9-]/g, "_"), "session.json");
			const bBackup = fs.existsSync(bSessPath) ? fs.readFileSync(bSessPath) : null;
			assert.equal(await panel(H.pageDropSrt("s1_3.srt", SRT)), "sent");
			await H.waitFor(panel, "document.querySelectorAll('#listWrap .sub-row').length === 2", { what: "홈 시퀀스 행 2개" });
			fs.mkdirSync(path.dirname(bSessPath), { recursive: true });
			fs.writeFileSync(bSessPath, "{ S13 깨진 JSON");
			try {
				await switchTo(api, B);
				snap = await panel("window._mogrtDebug.snapshot()");
				assert.equal(snap.flags.sessionReadFailed, true);
				assert.deepEqual(snap.subtitles.map((x) => x.text), ["S13 합성 하나", "S13 합성 둘"], "메모리 목록 유지");
				const st = await panel(H.PAGE_STATUS);
				assert.equal(st.cls, "err");
				log("오류 표시: " + st.text);
				await panel("(() => { const b = document.getElementById('btnCloseAllParams'); b.disabled = false; b.click(); window._mogrtDebug.saveSession(); return true; })()");
				assert.equal(fs.readFileSync(bSessPath, "utf8"), "{ S13 깨진 JSON", "읽지 못한 파일을 덮어쓰지 않는다");
				await switchTo(api, home);
				snap = await panel("window._mogrtDebug.snapshot()");
				assert.equal(snap.flags.sessionReadFailed, false);
			} finally {
				if (bBackup) fs.writeFileSync(bSessPath, bBackup);
				else fs.unlinkSync(bSessPath);
			}

			// (4) 체크 안 된 줄에서 '-- 프리셋 선택 --'
			const [pid] = await H.ensurePreset(api);
			const rows = await panel(H.PAGE_ROWS);
			await panel(H.pageSetRowPreset(rows[0].id, pid));
			await panel("window.__s13errs = [], true");
			await panel(H.pageSetRowPreset(rows[0].id, ""));
			assert.deepEqual(await panel("window.__s13errs"), [], "select '' 예외");
			snap = await panel("window._mogrtDebug.snapshot()");
			assert.equal(snap.rowStates[rows[0].id].presetId, "");

			// (7) 히스토리 복원 → 새로 고침 뒤에도 트랙 복원
			await panel("(() => { const t = document.getElementById('trackSel'); t.value = '5'; t.dispatchEvent(new Event('change')); return t.value; })()");
			await panel("(() => { document.getElementById('btnHistory').click(); return true; })()");
			await H.waitFor(panel, "!!document.querySelector('#historyDropdown input[type=text]')", { what: "히스토리 드롭다운" });
			await panel("(() => { const d = document.getElementById('historyDropdown'); d.querySelector('input[type=text]').value = 'S13 트랙6'; return true; })()");
			await panel("(() => { const b = Array.from(document.querySelectorAll('#historyDropdown button')).find((x) => x.textContent === '저장'); b.click(); return true; })()");
			await panel("(() => { const t = document.getElementById('trackSel'); t.value = '2'; t.dispatchEvent(new Event('change')); return t.value; })()");
			await panel("(() => { const d = document.getElementById('historyDropdown'); if (!d.classList.contains('open')) document.getElementById('btnHistory').click(); return true; })()");
			const clickedHist = await panel("(() => { const it = Array.from(document.querySelectorAll('#historyDropdown .history-item')).find((x) => x.textContent.indexOf('S13 트랙6') !== -1); if (!it) return false; it.firstChild.click(); return true; })()");
			assert.equal(clickedHist, true, "수동저장 'S13 트랙6' 항목");
			await H.confirmYes(panel);
			assert.equal(await panel("document.getElementById('trackSel').value"), "5");
			await H.reloadClean(reload, assert, log);
			await H.waitKeys(panel);
			assert.equal(await panel("document.getElementById('trackSel').value"), "5", "새로 고친 뒤에도 트랙 복원");

			// (10)(11) 모달: V1 보호와 패치 캐시
			const hadPreview = (await host(H.jsxHasSequenceNamed("__MOGRT_PREVIEW__"))) === "true";
			if (hadPreview) log("주의: __MOGRT_PREVIEW__가 이미 있다 — 프로젝트 패널에서 지운 뒤 다시 돌리면 '없던 프로젝트' 경로까지 확인한다");
			const v1Before = JSON.parse(await host(H.jsxReadVideoTrack(0)));
			const mogrts = await H.waitMogrts(panel, 1);
			const pick = mogrts.find((m) => /라온올제/.test(m[1])) || mogrts[0];
			await panel("document.getElementById('btnAddPreset').click(), true");
			await panel("(() => { const s = document.getElementById('defaultMogrtSel'); s.value = " + JSON.stringify(pick[0]) + "; s.dispatchEvent(new Event('change')); return true; })()");
			await H.waitFor(panel, "!!window._mogrtDebug.snapshot().mogrtOriginals[" + JSON.stringify(pick[0]) + "]", { timeoutMs: 120000, what: "모달 파라미터 (캐시)" });
			const v1After = JSON.parse(await host(H.jsxReadVideoTrack(0)));
			assert.deepEqual(v1After.clips, v1Before.clips, "V1 클립 수·시작·끝이 그대로");
			assert.equal(await host(H.jsxHasSequenceNamed("__MOGRT_PREVIEW__")), "true", "프리뷰 시퀀스가 있다");
			const cached = (await panel("window._mogrtDebug.snapshot()")).mogrtOriginals[pick[0]];
			const drops = cached.filter((p) => p.type === "dropdown");
			log("캐시 드롭다운 " + drops.length + "개: " + drops.map((p) => p.displayName + "=" + (p.dropdownOptions || []).join("/")).join(" · "));
			drops.forEach((p) => assert.ok(Array.isArray(p.dropdownOptions) && p.dropdownOptions.length > 0, p.displayName + " 드롭다운 이름"));
			// 두 번째 열기: 호스트를 부르지 않고 캐시(패치 포함)를 쓴다
			await panel("(() => { const b = document.getElementById('btnCloseModal'); if (b) b.click(); return true; })()");
			await panel("document.getElementById('btnAddPreset').click(), true");
			await panel("(() => { const s = document.getElementById('defaultMogrtSel'); s.value = " + JSON.stringify(pick[0]) + "; s.dispatchEvent(new Event('change')); return true; })()");
			await H.sleep(1500);
			const cached2 = (await panel("window._mogrtDebug.snapshot()")).mogrtOriginals[pick[0]];
			assert.deepEqual(cached2, cached, "두 번째 열기도 같은 (패치된) 캐시");
			await panel("(() => { const b = document.getElementById('btnCloseModal'); if (b) b.click(); return true; })()");
			return "파일 수 그대로 · 읽기 실패 보호 · 트랙 복원 · V1 그대로" + (hadPreview ? " (프리뷰 시퀀스는 원래 있었음)" : " (패널이 프리뷰 시퀀스를 만듦)");
		} finally {
			const act = await host(JSX_ACTIVE);
			if (act !== home.id) await host(jsxOpenSeq(home.id));
		}
	}
};
