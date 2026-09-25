"use strict";
/**
 * S2-4 하드 E2E: 화자별 배치 (DEV 패널 + DEV 호스트 MID_, MI_test.prproj의 T_ 시퀀스). 타임라인은 스크래치 사본에서만 바꾼다.
 * 스크래치 사본마다 V2 이상을 먼저 비운다 (원본 T_ 시퀀스의 S0-3 확인용 클립이 사본에도 있다).
 * 프로젝트 단위 cast_defaults.json(DEV 캐시)은 끝나면 시작 전 내용으로 되돌린다.
 *   (a) 2화자 × 20줄(동시 발화 5쌍), 기본 트랙 위(V4)에 남의 클립 → C1은 기본 트랙, C2는 남의 클립이 없는 위 트랙,
 *       태그 클립 40개, 같은 트랙 겹침 없음, 화자 트랙이 섞이지 않음
 *   (c) 첫 청크 뒤 중지 → 히스토리 '↶ 마지막 적용 되돌리기 (… · 40줄) (중단된 적용)' → 다시 적용 → uid마다 현재 클립 하나, (a) 확인
 *   (b) 다시 적용 → 보낸 작업 0, 3초 안
 *   (d) JSX로 한 클립의 캡션이 아닌 텍스트를 고치고 패널에서 그 줄 필드를 바꿈 → 점검 창 'Premiere에서 고친 클립 1개 덮어쓰기'(꺼짐)
 *       → 그 클립은 그대로, 줄 표시 'Premiere에서 고침'
 *   (e) ↑ 한 줄 → 그 클립만 갱신 (nodeId 그대로), 다른 클립은 그대로
 *   (f) v27로 적용한 섞인 목록(기본 트랙) → C1·C2로 나눔 → ▶ → C1은 기본 트랙에서 인식(nodeId 그대로), C2의 옛 클립은 C2 트랙으로, 중복 없음
 *   (g) 적용한 스크래치를 Sequence.clone → 같은 SRT를 새로 가져와 적용 → 다른 salt 태그를 문장으로 인식, 충돌 0, 새 salt로 이름
 *   (h) 긴 타임라인 120줄 → 적용 뒤 그대로 다시 계획하면 스캔(getTracks)이 3초 예산 안, 되읽기 0
 * 메모리 경고 모달을 피하려고 줄 수는 작게 둔다 (긴 타임라인은 120줄). 실행: npm run hard -- s2_4
 */
const fs = require("node:fs");
const path = require("node:path");
const H = require("../lib/hard");
const CAP = require("../../fixtures/make_cap_fixtures");
const { loadRegions } = require("../../lib/loadRegions");

const CORE = loadRegions(["src/mi/core.ts"]);
const SNAP = "window._mogrtDebug.snapshot()";
const SCR = H.SCRATCH_PREFIX;
const LONG = 180000;

// ── 페이지 ──
const PAGE_BUSY = "window._mogrtDebug.miBusy()";
const PAGE_PF = "(() => { const m = document.getElementById('preflightModal'); if (!m || !m.classList.contains('open')) return null;" +
	" const opt = (id) => { const cb = document.getElementById(id); const row = cb.closest('label'); return { shown: row.style.display !== 'none', checked: cb.checked, text: row.querySelector('span').textContent }; };" +
	" return { lines: Array.from(document.querySelectorAll('#pfSummary .pf-line')).map((e) => e.textContent), adopt: opt('pfAdopt'), foreign: opt('pfAdoptForeign'), legacy: opt('pfMoveLegacy'), edited: opt('pfOverwriteEdited') }; })()";
const pageImportPresets = (presetId) => "(() => { document.querySelectorAll('#impBody tr.imp-row').forEach((r) => { const p = r.querySelector('.imp-preset'); p.value = " + JSON.stringify(presetId) + "; p.dispatchEvent(new Event('change')); }); return true; })()";
const pageRowRes = (id) => "(() => { const e = document.querySelector('#row-" + Number(id) + " .sub-res'); return e ? e.textContent : null; })()";
const pageBadges = (id) => "Array.from(document.querySelectorAll('#params-" + Number(id) + " .fid-badge')).map((b) => b.textContent)";
const pageUpdateRow = (id) => "(() => { const b = Array.from(document.querySelectorAll('#row-" + Number(id) + " button')).find((x) => x.title === '이 자막만 타임라인에 업데이트'); if (!b) return false; b.click(); return true; })()";
// 다음 placeChunk 한 번 뒤에 [중지] (청크 사이에서 멈춘다)
const PAGE_STOP_AFTER_FIRST_CHUNK = "(() => { const m = window._mogrtDebug.hostMi; const orig = m.placeChunk; m.placeChunk = (p) => { m.placeChunk = orig; const r = orig(p); window._mogrtDebug.miStop(); return r; }; return true; })()";

// ── 호스트 JSX (ES3, 스크래치만) ──
const JSX_NUM_TRACKS = "(function(){var s=app.project.activeSequence;return String(s.videoTracks.numTracks);})()";
/** nodeId 클립의 displayName 텍스트 속성을 text로 (v27 JSON 폴리필로 textEditValue만 바꾼다) → "ok" | 까닭 */
function jsxEditText(ti, nodeId, displayName, text) {
	return "(function(){var seq=app.project.activeSequence;if(String(seq.name).indexOf('" + SCR + "')!==0)return 'not-scratch';" +
		"var c=MID__nodeMap(seq.videoTracks[" + Number(ti) + "])['n'+" + JSON.stringify(String(nodeId)) + "];if(!c)return 'no-clip';" +
		"var mg=c.getMGTComponent();for(var j=0;j<mg.properties.numItems;j++){var p=mg.properties[j];if(String(p.displayName)!==" + JSON.stringify(displayName) + ")continue;" +
		"var v=JSON.parse(String(p.getValue()));v.textEditValue=" + JSON.stringify(text) + ";if(v.fontTextRunLength)v.fontTextRunLength=[" + JSON.stringify(text) + ".length];p.setValue(JSON.stringify(v),true);return 'ok';}return 'no-prop';})()";
}

function readJson(file) {
	return JSON.parse(fs.readFileSync(file, "utf8"));
}
const srtOf = (cues) => H.srtOf(cues);

module.exports = {
	name: "S2-4 화자별 배치 E2E (2화자·다시 적용·중지·고침·↑·레거시 나누기·복제·긴 타임라인)",
	run: async (api) => {
		const { panel, host, mi, assert, log } = api;
		await H.waitKeys(panel);
		// 앞 케이스가 플래그를 꺼 둔 채 끝났을 수 있다 (스위트는 새로 고치지 않는다) → 코드 기본값(켬)
		assert.equal(await panel(H.pageSetMiCast(null)), true, "다화자 기본값은 켬");
		const root = await H.devCacheRoot(panel);
		const rootFs = root.replace(/\//g, path.sep);
		const snap0 = await panel(SNAP);
		const defPath = path.join(rootFs, snap0.keys.proj, "cast_defaults.json");
		const defBefore = fs.existsSync(defPath) ? fs.readFileSync(defPath) : null;
		const ok = await panel("await window._mogrtDebug.miHostOk()");
		assert.equal(ok.ok, true, "v28 호스트·같은 빌드: " + JSON.stringify(ok));
		// 캡션이 있는 AE 프리셋 (텍스트 필드가 많은 것)
		const pick = (list) => list.filter((p) => !p.native && p.captionFid).sort((a, b) => b.fields.length - a.fields.length)[0] || null;
		let P = pick((await panel(H.pageCmd("presets", {}))).data);
		if (!P) {
			await H.ensurePreset(api);
			P = pick((await panel(H.pageCmd("presets", {}))).data);
		}
		assert.ok(P, "캡션 필드가 있는 AE 프리셋이 필요하다");
		const PP = (await panel(SNAP)).presets[P.id];
		log("프리셋 " + P.id + " " + P.name + " (" + P.fields.map((f) => f.fid + (f.caption ? "*" : "") + " " + f.label).join(" · ") + ")");

		// 공용 도우미
		const clearV2up = async () => {
			const n = Number(await host(JSX_NUM_TRACKS));
			for (let i = 1; i < n; i++) assert.match(String(await host(H.jsxClearVideoTrack(i))), /^0$/, "V" + (i + 1) + " 비우기");
			return n;
		};
		const scanAll = async () => {
			const ping = await mi("ping");
			const r = await mi("getTracks", { seqId: ping.seqId, build: ping.build, tracks: null });
			assert.equal(r.ok, true, JSON.stringify(r).slice(0, 300));
			return r;
		};
		// ▶ → 점검 창이 뜨면 onPf(창 정보)를 부르고 [적용] → 끝날 때까지 → {pf, status}
		const applyButton = async (onPf) => {
			await panel(H.PAGE_CLEAR_STATUS);
			await panel("document.getElementById('btnApply').click(), true");
			const first = await H.waitFor(panel, "(() => { const pf = " + PAGE_PF + "; if (pf) return { pf }; return window._mogrtDebug.miBusy() ? null : { pf: null }; })()", { timeoutMs: LONG, stepMs: 400, what: "점검 창 또는 적용 끝" });
			if (first.pf) {
				if (onPf) await onPf(first.pf);
				await panel("document.getElementById('pfOk').click(), true");
			}
			await H.waitFor(panel, "!window._mogrtDebug.miBusy()", { timeoutMs: LONG, stepMs: 500, what: "적용 끝" });
			return { pf: first.pf, status: await panel(H.PAGE_STATUS) };
		};
		const importTwo = async (c1, c2, n) => {
			assert.equal(await panel(H.pageDropSrts([{ name: "C1.srt", content: srtOf(c1) }, { name: "C2.srt", content: srtOf(c2) }])), "sent");
			await H.waitFor(panel, "(() => { const m = " + H.PAGE_IMPORT_MODAL + "; return m && m.open && m.rows.length === 2 ? m : null; })()", { what: "가져오기 창" });
			await panel(pageImportPresets(P.id));
			await panel("document.getElementById('impOk').click(), true");
			await H.waitFor(panel, "document.querySelectorAll('#listWrap .sub-row').length === " + n, { what: n + "줄" });
			await H.waitFor(panel, "(() => { const s = " + SNAP + "; return s.subtitles.every((x) => (s.rowStates[x.id]._allParams || []).length > 0); })()", { timeoutMs: 60000, what: "줄 속성" });
		};
		const lastApply = async () => {
			const s = await panel(SNAP);
			return readJson(path.join(rootFs, s.keys.proj, s.keys.seq, "last_apply.json"));
		};
		// 스캔 → 우리 salt의 현재 클립, 같은 트랙 겹침 없음
		const checkLayout = async (salt, nRows, what) => {
			const scan = await scanAll();
			const idx = CORE.scanIndex(scan, salt);
			const cur = Object.keys(idx.current).map((u) => idx.current[u]);
			assert.equal(cur.length, nRows, what + ": uid마다 현재 클립 하나");
			assert.equal(idx.stale.length, 0, what + ": 옛 gen 없음");
			assert.equal(Object.keys(idx.dup).length, 0, what + ": 같은 태그 중복 없음");
			scan.tracks.forEach((t) => {
				const c = t.clips.slice().sort((a, b) => a.sf - b.sf);
				for (let i = 1; i < c.length; i++) assert.ok(c[i - 1].ef <= c[i].sf, what + ": V" + (t.i + 1) + " 겹침 " + c[i - 1].name + " / " + c[i].name);
			});
			return { scan, idx, cur };
		};
		try {
			// ═══ (a)(c)(b)(d)(e) ═══
			await H.withScratchSequence(api, "s2_4a", async () => {
				const nTracks = await clearV2up();
				// 기본 트랙(V3) 위 V4에 남의 클립 (태그 없는 MOGRT, 줄들과 문장이 다르다) → C2는 V4를 건너뛴다
				assert.equal(await host(H.jsxPlaceMogrt(PP.mogrtPath, 3, 0, 90)), "ok");
				assert.equal(await panel(H.pageSelectTrack(2)), "2");
				const c1 = [];
				const c2 = [];
				for (let k = 0; k < 20; k++) {
					const s = 1 + k * 3;
					c1.push([s, s + 1.5, "S24 철수 " + (k + 1) + "번째 말"]);
					c2.push(k < 5 ? [s + 0.5, s + 1.8, "S24 영희 " + (k + 1) + "번째 겹친 말"] : [s + 1.6, s + 2.8, "S24 영희 " + (k + 1) + "번째 말"]);
				}
				await importTwo(c1, c2, 40);
				let snap = await panel(SNAP);
				const salt = snap.mi.salt;
				log("(a) 40줄, salt " + salt + ", 트랙 " + nTracks + "개, 요약 " + (await panel("document.getElementById('castTrackSummary').textContent")));

				// (c) 첫 청크 뒤 중지
				await panel(PAGE_STOP_AFTER_FIRST_CHUNK);
				const r1 = await applyButton();
				assert.match(r1.status.text, /^중지함 — 다시 적용하면 이어서 진행/, r1.status.text);
				let la = await lastApply();
				assert.equal(la.complete, false);
				assert.ok(la.created.length >= 1 && la.created.length < 40, "일부만: " + la.created.length);
				await panel("document.getElementById('btnHistory').click(), true");
				const undo = await H.waitFor(panel, "(() => { const e = document.getElementById('btnUndoApply'); return e ? e.textContent : null; })()", { what: "마지막 적용 항목" });
				assert.match(undo, /^↶ 마지막 적용 되돌리기 \(.+ · 40줄\) \(중단된 적용\)$/, undo);
				await panel("document.getElementById('btnHistory').click(), true");
				log("(c) 중지: " + la.created.length + "개 놓고 멈춤 — " + undo);
				const r2 = await applyButton();
				assert.match(r2.status.text, /^화자별 배치: /, r2.status.text);
				assert.doesNotMatch(r2.status.text, /충돌|실패/);
				la = await lastApply();
				assert.equal(la.complete, true);
				const L = await checkLayout(salt, 40, "(c) 다시 적용");
				// (a) 화자 트랙
				const byTrack = { C1: {}, C2: {} };
				snap = await panel(SNAP);
				const spkOf = {};
				snap.subtitles.forEach((s) => { spkOf[s.id] = s.spk; });
				L.cur.forEach((c) => { byTrack[spkOf[c.id]][c.track] = (byTrack[spkOf[c.id]][c.track] || 0) + 1; });
				assert.deepEqual(Object.keys(byTrack.C1), ["2"], "C1은 기본 트랙 V3에만");
				const t2 = Object.keys(byTrack.C2);
				assert.equal(t2.length, 1, "C2는 한 트랙에만");
				assert.ok(Number(t2[0]) > 3, "C2는 남의 클립이 있는 V4를 건너뛴다: V" + (Number(t2[0]) + 1));
				assert.equal(snap.mi.cast.C2.autoTrack, Number(t2[0]));
				log("(a) C1 → V3 20개, C2 → V" + (Number(t2[0]) + 1) + " 20개, 겹침 없음 (" + r2.status.text + ")");

				// (b) 다시 적용 → 0개, 3초 안
				const t0 = Date.now();
				const rb = await panel(H.pageCmd("apply", {}));
				const ms = Date.now() - t0;
				assert.equal(rb.ok, true, JSON.stringify(rb));
				assert.deepEqual([rb.data.ops, rb.data.none], [0, 40], JSON.stringify(rb.data));
				assert.ok(ms < 3000, "다시 적용 " + ms + "ms");
				log("(b) 다시 적용: 보낸 작업 0, " + ms + "ms");

				// (d) Premiere에서 고친 클립
				const capF = P.fields.find((f) => f.caption);
				const other = P.fields.find((f) => !f.caption) || capF;
				const row1 = snap.subtitles.find((s) => s.spk === "C1");
				const clip1 = L.idx.current[salt + "-" + row1.id];
				assert.equal(await host(jsxEditText(clip1.track, clip1.nodeId, other.label, "S24 Premiere에서 고침")), "ok");
				await H.waitFor(panel, pageBadges(row1.id) + ".length > 0", { timeoutMs: 60000, what: "속성창 배지" });
				const badges = await panel(pageBadges(row1.id));
				const fid = badges.indexOf(capF.fid) !== -1 ? capF.fid : badges[0];
				assert.equal(await panel(H.pageTypeField(row1.id, fid, "S24 패널에서 바꾼 " + fid)), true);
				const rd = await applyButton(async (pf) => {
					assert.deepEqual(pf.edited, { shown: true, checked: false, text: "Premiere에서 고친 클립 1개 덮어쓰기" }, JSON.stringify(pf));
				});
				assert.ok(rd.pf, "점검 창이 떴다");
				const after = await mi("readClipTexts", Object.assign({ seqId: (await mi("ping")).seqId, build: (await mi("ping")).build }, { items: [{ track: clip1.track, nodeId: clip1.nodeId }], want: { texts: true } }));
				assert.ok(after.results[0].texts.indexOf("S24 Premiere에서 고침") !== -1, "고친 클립 그대로: " + JSON.stringify(after.results[0].texts));
				assert.equal(await panel(pageRowRes(row1.id)), "Premiere에서 고침");
				log("(d) 고친 클립 건너뜀 — " + rd.status.text);

				// (e) ↑ 한 줄
				const before = (await scanAll()).tracks;
				const row2 = snap.subtitles.filter((s) => s.spk === "C2")[3];
				await H.waitFor(panel, pageBadges(row2.id) + ".length > 0", { timeoutMs: 60000, what: "속성창 배지 (C2)" });
				const b2 = await panel(pageBadges(row2.id));
				assert.equal(await panel(H.pageTypeField(row2.id, b2[b2.length - 1], "S24 한 줄 갱신")), true);
				await panel(H.PAGE_CLEAR_STATUS);
				assert.equal(await panel(pageUpdateRow(row2.id)), true);
				await H.waitStatus(panel, /^화자별 배치: 갱신 1$/, { timeoutMs: 60000 });
				const afterE = (await scanAll()).tracks;
				const flat = (ts) => ts.reduce((a, t) => a.concat(t.clips.map((c) => t.i + ":" + c.nodeId + ":" + c.sf + ":" + c.ef + ":" + c.name)), []).sort();
				assert.deepEqual(flat(afterE), flat(before), "클립 자리·nodeId·이름 그대로");
				const c2clip = L.idx.current[salt + "-" + row2.id];
				const t2r = await mi("readClipTexts", Object.assign({ seqId: (await mi("ping")).seqId, build: (await mi("ping")).build }, { items: [{ track: c2clip.track, nodeId: c2clip.nodeId }], want: { texts: true } }));
				assert.ok(t2r.results[0].texts.indexOf("S24 한 줄 갱신") !== -1, JSON.stringify(t2r.results[0].texts));
				log("(e) ↑ 한 줄: 그 클립만 갱신 (nodeId " + c2clip.nodeId + " 그대로)");
			});

			// ═══ (f) 레거시 목록 나누기 ═══
			await H.withScratchSequence(api, "s2_4f", async () => {
				await clearV2up();
				assert.equal(await panel(H.pageSelectTrack(2)), "2");
				const mixed = CAP.C1.concat(CAP.C2).sort((a, b) => a[0] - b[0]);
				assert.equal(await panel(H.pageDropSrt("s24_mixed.srt", CAP.srt(mixed))), "sent");
				await H.waitFor(panel, "document.querySelectorAll('#listWrap .sub-row').length === 13", { what: "섞인 목록 13줄" });
				let snap = await panel(SNAP);
				const ids = snap.subtitles.map((s) => s.id);
				for (const id of ids) assert.equal(await panel(H.pageSetRowPreset(id, P.id)), P.id);
				await H.waitFor(panel, "(() => { const s = " + SNAP + "; return s.subtitles.every((x) => (s.rowStates[x.id]._allParams || []).length > 0); })()", { timeoutMs: 60000, what: "줄 속성" });
				// 레거시 ▶ = v27 applyToTimeline (화자 표 없음)
				await panel(H.PAGE_RECORD_HOST_CALLS);
				await panel(H.PAGE_UNCHECK_ALL);
				await panel(H.PAGE_CLEAR_STATUS);
				await panel("document.getElementById('btnApply').click(), true");
				// v27 ▶: '타임라인에 배치 중... (13개)' 다음에 결과 문구가 오고 버튼이 다시 켜진다
				const st27 = await H.waitFor(panel, "(() => { const s = document.getElementById('statusBar').textContent; return s && s.indexOf('배치 중') === -1 && !document.getElementById('btnApply').disabled ? s : null; })()", { timeoutMs: LONG, stepMs: 500, what: "v27 적용 끝" });
				log("(f) v27 ▶: " + st27);
				const calls = await panel("window.__hostCalls");
				assert.ok(calls.indexOf("applyToTimeline") !== -1, "레거시는 v27 applyToTimeline: " + calls.join(","));
				const v27 = (await scanAll()).tracks.find((t) => t.i === 2).clips;
				assert.equal(v27.length, 13, "v27이 V3에 13개");
				const oldIds = v27.map((c) => c.nodeId);
				// C1·C2로 나눈다 (분배)
				assert.equal(await panel(H.pageDropSrts([{ name: "C1.srt", content: CAP.srt(CAP.C1) }, { name: "C2.srt", content: CAP.srt(CAP.C2) }])), "sent");
				await H.waitFor(panel, "(() => { const m = " + H.PAGE_IMPORT_MODAL + "; return m && m.open && m.legacy ? m : null; })()", { what: "분배 모드 창" });
				await panel("document.getElementById('impOk').click(), true");
				await H.waitFor(panel, "(() => { const s = " + SNAP + "; return s.subtitles.length === 13 && s.subtitles.every((x) => x.spk); })()", { what: "화자가 붙은 13줄" });
				snap = await panel(SNAP);
				assert.equal(snap.mi.legacyTrack, 2);
				const salt = snap.mi.salt;
				const rf = await applyButton(async (pf) => {
					assert.equal(pf.adopt.shown && pf.adopt.checked, true, JSON.stringify(pf));
					assert.match(pf.adopt.text, /^태그 없는 기존 클립 7개를/);
					assert.equal(pf.legacy.checked, true);
					assert.match(pf.legacy.text, /^기본 트랙\(V3\)에 있던 옛 클립 6개를 화자 트랙으로 옮기기/);
				});
				assert.doesNotMatch(rf.status.text, /충돌|실패/, rf.status.text);
				const L = await checkLayout(salt, 13, "(f)");
				const v3 = L.scan.tracks.find((t) => t.i === 2).clips;
				assert.equal(v3.length, 7, "V3에는 C1 7개만");
				assert.ok(v3.every((c) => oldIds.indexOf(c.nodeId) !== -1), "C1은 v27 클립 그대로 (nodeId)");
				const c2 = L.cur.filter((c) => snap.subtitles.find((s) => s.id === c.id).spk === "C2");
				assert.equal(c2.length, 6);
				assert.ok(c2.every((c) => c.track !== 2 && oldIds.indexOf(c.nodeId) === -1), "C2는 C2 트랙에 새로");
				const total = L.scan.tracks.reduce((n, t) => n + t.clips.length, 0);
				assert.equal(total, 13, "중복 없음");
				log("(f) 나눔: C1 인식 7 (V3), C2 옮김 6 (V" + (c2[0].track + 1) + ") — " + rf.status.text);
			});

			// ═══ (g) 복제한 시퀀스 ═══
			await H.withScratchSequence(api, "s2_4g", async (info) => {
				await clearV2up();
				assert.equal(await panel(H.pageSelectTrack(2)), "2");
				await importTwo(CAP.C1, CAP.C2, 13);
				await applyButton();
				const salt1 = (await panel(SNAP)).mi.salt;
				await checkLayout(salt1, 13, "(g) 원본 적용");
				// 이 스크래치를 복제 → 패널이 복제본으로 간다 (빈 목록)
				const cl = JSON.parse(await host(H.jsxCloneActiveAsScratch("s2_4g_clone")));
				assert.ok(!cl.error, JSON.stringify(cl));
				let projKey = null;
				try {
					await H.waitFor(panel, SNAP + ".keys.seqId === " + JSON.stringify(cl.clone.id), { timeoutMs: 15000, what: "패널이 복제본으로" });
					await H.waitKeys(panel);
					projKey = (await panel(SNAP)).keys.proj;
					assert.equal((await panel(SNAP)).subtitles.length, 0, "복제본은 빈 목록");
					await importTwo(CAP.C1, CAP.C2, 13);
					const salt2 = (await panel(SNAP)).mi.salt;
					assert.notEqual(salt2, salt1);
					const rg = await applyButton(async (pf) => {
						assert.equal(pf.foreign.checked, true, JSON.stringify(pf));
						assert.match(pf.foreign.text, /^다른 시퀀스에서 온 태그 클립 13개를 이 목록 클립으로 인식$/);
					});
					assert.doesNotMatch(rg.status.text, /충돌|실패/, rg.status.text);
					assert.match(rg.status.text, /인식 13/);
					const L = await checkLayout(salt2, 13, "(g) 복제본");
					assert.equal(L.idx.foreignMi.length, 0, "옛 salt 클립이 남지 않는다");
					assert.equal(L.scan.tracks.reduce((n, t) => n + t.clips.length, 0), 13);
					log("(g) 복제본: salt " + salt1 + " → " + salt2 + ", " + rg.status.text);
				} finally {
					log("복제본 정리: " + await host(H.jsxDropScratch(info.clone.id, cl.clone.id)));
					await H.waitFor(panel, SNAP + ".keys.seqId === " + JSON.stringify(info.clone.id), { timeoutMs: 15000, what: "스크래치로 복귀" });
					if (projKey) {
						const dir = path.join(rootFs, projKey, projKey + "_seq_" + cl.clone.id.replace(/[^a-zA-Z0-9-]/g, "_"));
						if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
					}
				}
			});

			// ═══ (h) 긴 타임라인 120줄 ═══
			await H.withScratchSequence(api, "s2_4h", async () => {
				await clearV2up();
				assert.equal(await panel(H.pageSelectTrack(2)), "2");
				const c1 = [];
				const c2 = [];
				for (let k = 0; k < 60; k++) {
					const s = 1 + k * 2.5;
					c1.push([s, s + 1, "S24 긴 철수 " + (k + 1)]);
					c2.push([s + 1.2, s + 2.2, "S24 긴 영희 " + (k + 1)]);
				}
				await importTwo(c1, c2, 120);
				const t0 = Date.now();
				const r = await applyButton();
				log("(h) 120줄 적용 " + (Date.now() - t0) + "ms — " + r.status.text);
				assert.doesNotMatch(r.status.text, /충돌|실패|중단/, r.status.text);
				const salt = (await panel(SNAP)).mi.salt;
				await checkLayout(salt, 120, "(h)");
				const ping = await mi("ping");
				const scan = await mi("getTracks", { seqId: ping.seqId, build: ping.build, tracks: null, fromFrame: 0, toFrame: ping.endFrame + 1000 });
				assert.ok(scan.ms < 3000, "스캔 " + scan.ms + "ms (예산 3초)");
				const t1 = Date.now();
				const pl = await panel(H.pageCmd("plan", {}));
				const planMs = Date.now() - t1;
				assert.equal(pl.ok, true, JSON.stringify(pl).slice(0, 300));
				assert.deepEqual([pl.data.plan.none, Object.keys(pl.data.plan.ops).length], [120, 0]);
				assert.ok(planMs < 10000, "그대로 계획 " + planMs + "ms");
				log("(h) 스캔 " + scan.ms + "ms, 그대로 계획 " + planMs + "ms (되읽기 0)");
			});
		} finally {
			await panel(H.pageSetMiCast(null));
			if (defBefore) fs.writeFileSync(defPath, defBefore);
			else if (fs.existsSync(defPath)) fs.unlinkSync(defPath);
			log("cast_defaults.json 되돌림: " + (defBefore ? "시작 전 내용" : "지움 (시작 전에는 없었다)"));
		}
	}
};
