"use strict";
/**
 * S2-5 하드: 마지막 적용 되돌리기(타임라인만)와 레거시 안전 경로 (DEV 패널 + DEV 호스트 MID_, MI_test.prproj의 T_ 시퀀스).
 * 타임라인은 스크래치 사본에서만 바꾼다. 스크래치 사본마다 V2 이상을 먼저 비운다. 호스트(JSX)는 S2-2 그대로다 (패널만 바뀜).
 * 프리셋: 캡션 AE 프리셋 P(텍스트 필드가 많은 것), 템플릿이 다른 캡션 AE 프리셋 P2(없으면 '[라온올제]' MOGRT로 모달에서 만든다),
 * 네이티브 'Lower Thirds/Classic Lower Third Two Lines.mogrt' 프리셋 PN(없으면 모달로 만든다).
 *   (1)(2) 2화자: C1 AE 4줄(P), C2 네이티브 2줄(PN, 구운 사본) → ▶ = 적용 전 모습 S0
 *       → C1 다시 가져오기(첫째 문장 고침 = update, 넷째 빠짐 = 목록에서 빠진 줄의 클립 지우기, 새 줄 = place),
 *         C1 둘째 프리셋 → P2 (다른 템플릿 = replace), C2 트랙 고정 V5 (네이티브 moveRegen 2개) → ▶ (점검 창 기본값)
 *       → (2) JSX로 새로 놓은 클립의 캡션을 고친다
 *       → 히스토리 '↶ 마지막 적용 되돌리기' → 확인창 → 되돌리기:
 *         새 클립은 '그 뒤로 바뀜'으로 건너뛰고 남는다. 나머지 S0 클립은 (uid, 트랙, 시작, 끝)과 MGT 속성 raw 값이 모두 S0과 같다
 *         (색은 getColorValue ARGB 8비트로 비교 — 64비트 raw는 되쓰면 달라진다). 네이티브는 Source Text가 늘 ''로 읽히고 TrackItem에
 *         projectItem도 없어(S0-3 k) 클립에서 문구를 확인할 수 없다 → 되돌리기가 보낸 placeChunk 항목의 템플릿이 S0에 놓은 구운 사본
 *         (ap.nk)이고 줄의 ap.nk가 S0으로 돌아왔는지 본다. 되돌린 줄은 mm undone, 히스토리 항목은 사라진다
 *   (3) 되돌린 뒤 ▶: 점검 창의 '목록에서 빠진 줄의 클립 지우기'(미리 체크)를 끄면 그 클립은 남는다
 *   (4) 레거시 목록(화자 표 없음) 5줄 v27 ▶ → 둘째 문장 고침·셋째 +0.4초 SRT 병합 → ▶ [안전하게 적용 (2)] (v28 경로):
 *       셋째 클립은 같은 nodeId로 +0.4초, 둘째는 캡션만, 이웃(첫째·넷째·다섯째)은 nodeId·시작·끝 그대로, 클립 5개(중복 없음), 태그 없음,
 *       v27 호스트(updateClipAtTime·applyToTimeline)를 부르지 않는다 → 되돌리기(명령) → 둘 다 원래대로
 *   (5) 중지한 적용: C1 12줄 적용 → 12줄 모두 문장 고침 → ▶ 첫 청크 뒤 중지 → 히스토리 '(중단된 적용)' → 되돌리기 → 기록된 8줄만
 *       되돌림, 12개 클립 모두 S0 문장
 * 줄 간격은 템플릿 기본 길이(약 5초)보다 넓게 둔다 (덮인 이웃 다시 놓기는 단위 테스트 panel_undo (5)(8)가 본다).
 * 프로젝트 단위 cast_defaults.json(DEV 캐시)은 끝나면 시작 전 내용으로 되돌린다. 메모리 경고 모달을 피하려고 줄 수는 작게 둔다.
 * 실행: npm run hard -- s2_5
 */
const fs = require("node:fs");
const path = require("node:path");
const H = require("../lib/hard");
const { loadRegions } = require("../../lib/loadRegions");

const CORE = loadRegions(["src/mi/core.ts"]);
const SNAP = "window._mogrtDebug.snapshot()";
const SCR = H.SCRATCH_PREFIX;
const LONG = 180000;
const NATIVE_REL = "Lower Thirds/Classic Lower Third Two Lines.mogrt";
const norm = (p) => String(p || "").replace(/\\/g, "/");
const click = (id) => "document.getElementById(" + JSON.stringify(id) + ").click(), true";

// ── 페이지 ──
const PAGE_PF = "(() => { const m = document.getElementById('preflightModal'); if (!m || !m.classList.contains('open')) return null;" +
	" const opt = (id) => { const cb = document.getElementById(id); const row = cb.closest('label'); return { shown: row.style.display !== 'none', checked: cb.checked, text: row.querySelector('span').textContent }; };" +
	" return { lines: Array.from(document.querySelectorAll('#pfSummary .pf-line')).map((e) => e.textContent), orphans: opt('pfOrphans'), edited: opt('pfOverwriteEdited') }; })()";
// 가져오기 창의 줄마다 프리셋 (캡션 트랙 번호 → 프리셋 id)
const pageImportPresetsBy = (byKey) => "(() => { const by = " + JSON.stringify(byKey) + "; document.querySelectorAll('#impBody tr.imp-row').forEach((r) => {" +
	" const k = (r.querySelector('.imp-key') || {}).value; const p = r.querySelector('.imp-preset'); if (p && by[k]) { p.value = by[k]; p.dispatchEvent(new Event('change')); } }); return true; })()";
const pageCastTrack = (K, v) => "(() => { const r = Array.from(document.querySelectorAll('#castRows .cast-row')).find((x) => x.dataset.key === " + JSON.stringify(K) + ");" +
	" const s = r && r.querySelector('.cast-track'); if (!s) return null; s.value = " + JSON.stringify(String(v)) + "; s.dispatchEvent(new Event('change')); return s.value; })()";
const pageRowRes = (id) => "(() => { const e = document.querySelector('#row-" + Number(id) + " .sub-res'); return e ? e.textContent : null; })()";
// 다음 placeChunk 한 번 뒤에 [중지] (청크 사이에서 멈춘다)
const PAGE_STOP_AFTER_FIRST_CHUNK = "(() => { const m = window._mogrtDebug.hostMi; const orig = m.placeChunk; m.placeChunk = (p) => { m.placeChunk = orig; const r = orig(p); window._mogrtDebug.miStop(); return r; }; return true; })()";
const PAGE_UNDO_ITEM = "(() => { const e = document.getElementById('btnUndoApply'); return e ? e.textContent : ''; })()";
// placeChunk 항목 기록 (window.__s25items: {key, op, mogrtPath, track, sf}). 풀 때는 PAGE_UNRECORD_CHUNKS
const PAGE_RECORD_CHUNKS = "(() => { const m = window._mogrtDebug.hostMi; if (!window.__s25orig) window.__s25orig = m.placeChunk; window.__s25items = [];" +
	" m.placeChunk = (p) => { ((p && p.items) || []).forEach((it) => window.__s25items.push({ key: it.key, op: it.op, mogrtPath: it.mogrtPath, track: it.track, sf: it.sf })); return window.__s25orig(p); }; return true; })()";
const PAGE_UNRECORD_CHUNKS = "(() => { if (window.__s25orig) { window._mogrtDebug.hostMi.placeChunk = window.__s25orig; delete window.__s25orig; } return true; })()";

// ── 호스트 JSX (ES3, 스크래치만. 예약어를 키로 쓰지 않는다) ──
const JSX_NUM_TRACKS = "(function(){var s=app.project.activeSequence;return String(s.videoTracks.numTracks);})()";
/** 트랙 ti 클립 [{s, e (ticks 글자), nodeId, name, pi(projectItem nodeId, 네이티브는 ''), props: [[이름, raw, ARGB]] (네이티브는 [])}] */
function jsxTrackFull(ti) {
	return "(function(){var seq=app.project.activeSequence;if(String(seq.name).indexOf('" + SCR + "')!==0)return MID__json({error:'not-scratch'});" +
		"var t=seq.videoTracks[" + Number(ti) + "];if(!t)return MID__json([]);var out=[];" +
		"for(var k=0;k<t.clips.numItems;k++){var c=t.clips[k];var o={s:String(c.start.ticks),e:String(c.end.ticks),nodeId:String(c.nodeId),name:String(c.name),pi:'',props:[]};" +
		"try{o.pi=c.projectItem?String(c.projectItem.nodeId):'';}catch(e0){}" +
		"var mg=null;try{mg=c.getMGTComponent();}catch(e1){}" +
		"if(mg){for(var j=0;j<mg.properties.numItems;j++){var p=mg.properties[j];var v='';try{v=String(p.getValue());}catch(e2){v='?';}var cv='';try{var ca=p.getColorValue();if(ca&&ca.length>=4)cv=ca.join(',');}catch(e3){}o.props.push([String(p.displayName),v,cv]);}}" +
		"out.push(o);}return MID__json(out);})()";
}
/** nodeId 클립의 displayName 텍스트 속성을 text로 (v27 JSON 폴리필로 textEditValue만 바꾼다) → "ok" | 까닭 */
function jsxEditText(ti, nodeId, displayName, text) {
	return "(function(){var seq=app.project.activeSequence;if(String(seq.name).indexOf('" + SCR + "')!==0)return 'not-scratch';" +
		"var c=MID__nodeMap(seq.videoTracks[" + Number(ti) + "])['n'+" + JSON.stringify(String(nodeId)) + "];if(!c)return 'no-clip';" +
		"var mg=c.getMGTComponent();for(var j=0;j<mg.properties.numItems;j++){var p=mg.properties[j];if(String(p.displayName)!==" + JSON.stringify(displayName) + ")continue;" +
		"var v=JSON.parse(String(p.getValue()));v.textEditValue=" + JSON.stringify(text) + ";if(v.fontTextRunLength)v.fontTextRunLength=[" + JSON.stringify(text) + ".length];p.setValue(JSON.stringify(v),true);return 'ok';}return 'no-prop';})()";
}
const textOfRaw = (raw) => {
	try { return JSON.parse(raw).textEditValue; } catch (_) { return undefined; }
};

module.exports = {
	name: "S2-5 마지막 적용 되돌리기(6범주·가드·네이티브·중단된 적용)와 레거시 안전 경로(+0.4초)",
	run: async (api) => {
		const { panel, host, mi, assert, log } = api;
		await H.waitKeys(panel);
		// 앞 케이스가 플래그를 꺼 두었을 수 있다 (스위트는 새로 고치지 않는다) → 코드 기본값
		assert.equal(await panel(H.pageSetMiCast(null)), true, "다화자 기본값은 켬");
		assert.equal(await panel(H.pageSetLegacyV28(null)), null, "레거시 안전 경로 기본값 (v28 호스트가 답하면 v28)");
		const root = await H.devCacheRoot(panel);
		const rootFs = root.replace(/\//g, path.sep);
		const snap0 = await panel(SNAP);
		const defPath = path.join(rootFs, snap0.keys.proj, "cast_defaults.json");
		const defBefore = fs.existsSync(defPath) ? fs.readFileSync(defPath) : null;
		const ok = await panel("await window._mogrtDebug.miHostOk()");
		assert.equal(ok.ok, true, "v28 호스트·같은 빌드: " + JSON.stringify(ok));

		// ── 프리셋 ──
		const listAe = async () => (await panel(H.pageCmd("presets", {}))).data.filter((p) => !p.native && p.captionFid).sort((a, b) => b.fields.length - a.fields.length);
		let ae = await listAe();
		if (!ae.length) {
			await H.ensurePreset(api);
			ae = await listAe();
		}
		assert.ok(ae.length, "캡션 필드가 있는 AE 프리셋이 필요하다");
		const presetsNow = async () => (await panel(SNAP)).presets;
		let PS = await presetsNow();
		const P = ae[0];
		const pathOf = (id) => norm(PS[id].mogrtPath).toLowerCase();
		let P2 = ae.find((p) => pathOf(p.id) !== pathOf(P.id)) || null;
		if (!P2) {
			const mogrts = await H.waitMogrts(panel, 1);
			const pick = mogrts.find((m) => /라온올제/.test(m[1]) && norm(m[0]).toLowerCase() !== pathOf(P.id) && norm(m[0]).slice(-NATIVE_REL.length) !== NATIVE_REL);
			assert.ok(pick, "템플릿이 다른 '[라온올제]' MOGRT가 하나 더 있어야 한다 (replace)");
			log("둘째 AE 프리셋 만들기: " + pick[1]);
			await H.createPresetViaModal(api, pick[0]);
			PS = await presetsNow();
			P2 = (await listAe()).find((p) => pathOf(p.id) !== pathOf(P.id)) || null;
			assert.ok(P2, "둘째 AE 캡션 프리셋");
		}
		const mogrts = await H.waitMogrts(panel, 1);
		const hitN = mogrts.find((m) => norm(m[0]).slice(-NATIVE_REL.length) === NATIVE_REL);
		assert.ok(hitN, "MOGRT 목록에 " + NATIVE_REL + "이 있어야 한다 (Premiere 기본 설치 템플릿)");
		const PN = await H.pickPresetForMogrt(api, hitN[0]);
		PS = await presetsNow();
		const capF = P.fields.find((f) => f.caption);
		log("프리셋 P " + P.id + " " + P.name + " (캡션 " + capF.fid + " " + capF.label + ") · P2 " + P2.id + " " + P2.name + " · PN " + PN.id + " " + PN.name);

		// ── 공용 도우미 ──
		const clearV2up = async () => {
			const n = Number(await host(JSX_NUM_TRACKS));
			for (let i = 1; i < n; i++) assert.match(String(await host(H.jsxClearVideoTrack(i))), /^0$/, "V" + (i + 1) + " 비우기");
			return n;
		};
		const ping = async () => mi("ping");
		const ftOf = async () => Number((await ping()).frameTicks);
		// 모든 트랙(V2 이상)의 클립 → {key: {track, sf, ef, nodeId, name, pi, props}} (key = 태그 uid, 태그 없으면 "n:"+nodeId)
		const snapAll = async () => {
			const n = Number(await host(JSX_NUM_TRACKS));
			const ft = await ftOf();
			const out = {};
			for (let i = 1; i < n; i++) {
				const list = JSON.parse(await host(jsxTrackFull(i)));
				assert.ok(Array.isArray(list), "트랙 " + i + ": " + JSON.stringify(list));
				list.forEach((c) => {
					const tg = CORE.parseClipTag(c.name);
					out[tg ? tg.uid : "n:" + c.nodeId] = { track: i, sf: Math.round(Number(c.s) / ft), ef: Math.round(Number(c.e) / ft), nodeId: c.nodeId, name: c.name, pi: c.pi, props: c.props };
				});
			}
			return out;
		};
		// S0의 클립이 모두 같은가: (uid, 트랙, 시작, 끝), AE는 MGT 속성 raw (색은 ARGB)·projectItem, 네이티브(MGT 없음)는 자리만 (문구는 따로)
		const sameAs = (s0, now, what, skipKeys) => {
			let n = 0;
			Object.keys(s0).forEach((k) => {
				if (skipKeys && skipKeys.indexOf(k) !== -1) return;
				const a = s0[k];
				const b = now[k];
				assert.ok(b, what + ": " + k + " 클립이 있다");
				assert.deepEqual([b.track, b.sf, b.ef], [a.track, a.sf, a.ef], what + ": " + k + " 자리");
				assert.equal(b.props.length === 0, a.props.length === 0, what + ": " + k + " 종류 (AE·네이티브)");
				if (a.props.length) {
					const diff = a.props.map((p, i) => {
						const q = b.props[i];
						if (!q || q[0] !== p[0]) return p[0] + ": 속성 구조가 다름";
						return q[1] === p[1] || (p[2] && q[2] === p[2]) ? null : p[0] + ": " + p[1].slice(0, 80) + " → " + q[1].slice(0, 80);
					}).filter(Boolean);
					assert.deepEqual(diff, [], what + ": " + k + " 속성 raw 값 (색은 ARGB 8비트)");
				}
				n++;
			});
			return n;
		};
		// ▶ → 점검 창이 뜨면 onPf(창 정보)를 부르고 [적용] → 끝날 때까지 → {pf, status}
		const applyButton = async (onPf) => {
			await panel(H.PAGE_CLEAR_STATUS);
			await panel(click("btnApply"));
			const first = await H.waitFor(panel, "(() => { const pf = " + PAGE_PF + "; if (pf) return { pf }; return window._mogrtDebug.miBusy() ? null : { pf: null }; })()", { timeoutMs: LONG, stepMs: 400, what: "점검 창 또는 적용 끝" });
			if (first.pf) {
				if (onPf) await onPf(first.pf);
				await panel(click("pfOk"));
			}
			await H.waitFor(panel, "!window._mogrtDebug.miBusy()", { timeoutMs: LONG, stepMs: 500, what: "적용 끝" });
			return { pf: first.pf, status: await panel(H.PAGE_STATUS) };
		};
		const waitRowsReady = async (n) => {
			await H.waitFor(panel, "document.querySelectorAll('#listWrap .sub-row').length === " + n, { what: n + "줄" });
			await H.waitFor(panel, "(() => { const s = " + SNAP + "; return s.subtitles.every((x) => (s.rowStates[x.id]._allParams || []).length > 0); })()", { timeoutMs: 60000, what: "줄 속성" });
		};
		const importFiles = async (files, byKey, n) => {
			assert.equal(await panel(H.pageDropSrts(files)), "sent");
			await H.waitFor(panel, "(() => { const m = " + H.PAGE_IMPORT_MODAL + "; return m && m.open && m.rows.length === " + files.length + " ? m : null; })()", { what: "가져오기 창" });
			if (byKey) await panel(pageImportPresetsBy(byKey));
			await panel(click("impOk"));
			await waitRowsReady(n);
		};
		const lastApply = async () => panel("window._mogrtDebug.lastApply()");
		// 히스토리 '↶ 마지막 적용 되돌리기' → 확인창 → 되돌리기 → 끝난 상태 줄
		const undoByHistory = async (wantPartial) => {
			await panel(H.PAGE_CLEAR_STATUS);
			await panel(click("btnHistory"));
			const label = await H.waitFor(panel, PAGE_UNDO_ITEM, { what: "마지막 적용 항목" });
			assert.match(label, wantPartial ? /^↶ 마지막 적용 되돌리기 \(.+ · \d+줄\) \(중단된 적용\)$/ : /^↶ 마지막 적용 되돌리기 \(.+ · \d+줄\)$/, label);
			await panel(click("btnUndoApply"));
			const c = await H.waitConfirm(panel);
			assert.match(c.msg, /^타임라인만 되돌립니다\. 자막 목록과 후반 작업 값은 그대로이며, 되돌린 줄은 '변경 줄'로 표시됩니다\./, c.msg);
			if (wantPartial) assert.match(c.msg, /중단된 적용입니다: 기록된 청크만 되돌립니다\.$/);
			assert.equal(c.yes, "되돌리기");
			await panel(click("confirmYes"));
			const st = await H.waitStatus(panel, /마지막 적용 되돌리기: /, { timeoutMs: LONG });
			await H.waitFor(panel, "!window._mogrtDebug.miBusy()", { timeoutMs: LONG, what: "되돌리기 끝" });
			return { label, status: st };
		};
		const historyItem = async () => {
			await panel(click("btnHistory"));
			const t = await panel(PAGE_UNDO_ITEM);
			await panel(click("btnHistory"));
			return t;
		};
		try {
			// ═══ (1)(2)(3) 2화자: 6범주 되돌리기, 네이티브, 그 뒤로 바뀜, 목록에서 빠진 줄 ═══
			await H.withScratchSequence(api, "s2_5a", async () => {
				await clearV2up();
				assert.equal(await panel(H.pageSelectTrack(2)), "2");
				const c1 = [[1, 2.5, "S25 철수 첫째 말"], [7, 8.5, "S25 철수 둘째 말"], [13, 14.5, "S25 철수 셋째 말"], [19, 20.5, "S25 철수 넷째 말"]];
				const c2 = [[3.5, 5, "S25 영희 첫째"], [9.5, 11, "S25 영희 둘째"]];
				await importFiles([{ name: "C1.srt", content: H.srtOf(c1) }, { name: "C2.srt", content: H.srtOf(c2) }], { C1: P.id, C2: PN.id }, 6);
				let s = await panel(SNAP);
				const salt = s.mi.salt;
				// 줄 id는 처음 가져온 문장으로 찾는다 (병합이 문장을 바꿔도 id는 그대로)
				const ID0 = {};
				s.subtitles.forEach((x) => { ID0[x.text] = x.id; });
				const idOf = (text) => ID0[text];
				const r0 = await applyButton();
				assert.doesNotMatch(r0.status.text, /충돌|실패|건너뜀/, r0.status.text);
				const S0 = await snapAll();
				s = await panel(SNAP);
				const k = (text) => salt + "-" + idOf(text);
				assert.equal(Object.keys(S0).length, 6, "클립 6개: " + Object.keys(S0).join(","));
				assert.ok(!S0[k(c2[0][2])].props.length && !S0[k(c2[1][2])].props.length, "C2는 네이티브 (MGT 없음)");
				// 네이티브 줄이 S0에 놓은 구운 사본 (ap.nk → DEV 캐시 baked/<키>.mogrt)
				const nk0 = [c2[0][2], c2[1][2]].map((t) => s.rowStates[idOf(t)].ap && s.rowStates[idOf(t)].ap.nk);
				assert.ok(nk0.every((x) => /^[0-9a-f]{32}$/.test(x || "")), "네이티브 줄 ap.nk: " + JSON.stringify(nk0));
				log("(1) S0: " + r0.status.text + " — " + Object.keys(S0).map((x) => x + "@V" + (S0[x].track + 1)).join(" "));

				// 바꾸기: C1 다시 가져오기 · 둘째 프리셋 P2 · C2 트랙 V5
				const c1b = [[1, 2.5, "S25 철수 첫째 말 (고침)"], [7, 8.5, "S25 철수 둘째 말"], [13, 14.5, "S25 철수 셋째 말"], [25, 26.5, "S25 철수 새 줄"]];
				await importFiles([{ name: "C1.srt", content: H.srtOf(c1b) }], null, 6);
				s = await panel(SNAP);
				const idNew = s.subtitles.find((x) => x.text === c1b[3][2]).id;
				const idGone = s.trashBin.find((t) => t.sub.text === c1[3][2]).sub.id;
				assert.equal(s.trashBin.find((t) => t.sub.id === idGone).why, "merge");
				const id2 = idOf(c1[1][2]);
				assert.equal(await panel(H.pageSetRowPreset(id2, P2.id)), P2.id);
				await H.waitFor(panel, "(() => { const s = " + SNAP + "; const r = s.rowStates[" + id2 + "]; return r.presetId === " + JSON.stringify(P2.id) + " && (r._allParams || []).length > 0; })()", { what: "둘째 줄 P2" });
				assert.equal(await panel(pageCastTrack("C2", 4)), "4");
				assert.equal((await panel(SNAP)).mi.cast.C2.track, 4, "C2 → V5 고정");
				const r1 = await applyButton(async (pf) => {
					assert.deepEqual([pf.orphans.shown, pf.orphans.checked], [true, true], "목록에서 빠진 줄의 클립 지우기 (미리 체크): " + JSON.stringify(pf));
				});
				assert.doesNotMatch(r1.status.text, /충돌|실패/, r1.status.text);
				const la = await lastApply();
				const cnt = ["created", "updated", "moved", "adopted", "replaced", "removed"].map((c) => c + " " + la[c].length).join(" · ");
				assert.deepEqual(["created", "updated", "moved", "replaced", "removed"].map((c) => la[c].length), [1, 1, 2, 1, 1], cnt);
				assert.equal(la.complete, true);
				const S1 = await snapAll();
				assert.ok(!S1[salt + "-" + idGone], "목록에서 빠진 줄의 클립을 지웠다 (체크)");
				assert.equal(S1[k(c2[0][2])].track, 4, "C2는 V5");
				log("(1) 적용: " + r1.status.text + " — last_apply " + cnt);

				// (2) 새로 놓은 클립을 Premiere에서 고친다 → 되돌리기가 건너뛴다
				const created = S1[salt + "-" + idNew];
				assert.ok(created, "새 줄 클립");
				assert.equal(await host(jsxEditText(created.track, created.nodeId, capF.label, "S25 Premiere에서 고친 새 줄")), "ok");
				await panel(PAGE_RECORD_CHUNKS);
				let u;
				let items;
				try {
					u = await undoByHistory(false);
					items = await panel("window.__s25items.slice()");
				} finally {
					await panel(PAGE_UNRECORD_CHUNKS);
				}
				log("(1) 되돌리기: " + u.status.text);
				assert.match(u.status.text, /^마지막 적용 되돌리기: /);
				assert.match(u.status.text, /그 뒤로 바뀜 1 \(건너뜀\)/, u.status.text);
				assert.doesNotMatch(u.status.text, /실패|되살리지 못함/, u.status.text);
				const S2 = await snapAll();
				const nCmp = sameAs(S0, S2, "(1) 되돌린 뒤 = S0");
				const kept = S2[salt + "-" + idNew];
				assert.ok(kept && kept.nodeId === created.nodeId, "(2) 고친 새 클립은 남는다");
				assert.equal(textOfRaw((kept.props.find((p) => p[0] === capF.label) || [])[1]), "S25 Premiere에서 고친 새 줄");
				assert.equal(Object.keys(S2).length, 7, "S0 6개 + 남은 새 클립: " + Object.keys(S2).join(","));
				assert.equal(await panel(pageRowRes(idNew)), "되돌리지 않음 — 그 뒤로 바뀜 (Premiere에서 문장을 고침)");
				s = await panel(SNAP);
				[c1[0][2], c1[1][2], c2[0][2], c2[1][2]].forEach((t) => assert.equal(s.rowStates[idOf(t)].mm, "undone", t + " 되돌린 줄"));
				assert.equal(s.subtitles.find((x) => x.id === idOf(c1[0][2])).text, c1b[0][2], "자막 목록은 그대로");
				assert.equal(s.rowStates[id2].presetId, P2.id, "프리셋도 그대로");
				assert.equal(await historyItem(), "", "다 되돌린 기록은 히스토리 항목이 없다");
				// 네이티브: 되돌리기가 S0의 구운 사본을 V4에 다시 놓고(moveRegen) 줄의 ap.nk가 S0으로 돌아왔다
				[c2[0][2], c2[1][2]].forEach((t, i) => {
					const it = items.find((x) => x.key === k(t));
					assert.ok(it, t + " 되돌리기 항목: " + JSON.stringify(items));
					assert.equal(it.op, "moveRegen");
					assert.equal(it.track, S0[k(t)].track);
					assert.ok(norm(it.mogrtPath).slice(-(nk0[i].length + 6)) === nk0[i] + ".mogrt" && norm(it.mogrtPath).indexOf("/baked/") !== -1, t + " 구운 사본 " + it.mogrtPath + " / " + nk0[i]);
					assert.equal(s.rowStates[idOf(t)].ap.nk, nk0[i], t + " ap.nk");
				});
				const laU = await lastApply();
				assert.deepEqual(laU.moved.map((e) => [e.k, norm(e.from.m).slice(-(32 + 6))]).sort(), nk0.map((x) => ["native", x + ".mogrt"]).sort(), "기록한 옛 템플릿 = S0 구운 사본");
				log("(1)(2) S0 클립 " + nCmp + "개 (uid·자리·속성·네이티브 템플릿) 같음, 고친 새 클립은 남음");

				// (3) 되돌린 뒤 ▶: 목록에서 빠진 줄의 클립 지우기를 끄면 남는다
				const r3 = await applyButton(async (pf) => {
					assert.deepEqual([pf.orphans.shown, pf.orphans.checked], [true, true], JSON.stringify(pf));
					await panel("(() => { document.getElementById('pfOrphans').checked = false; return true; })()");
				});
				assert.doesNotMatch(r3.status.text, /실패/, r3.status.text);
				const S3 = await snapAll();
				assert.ok(S3[salt + "-" + idGone], "(3) 체크를 끄면 목록에서 빠진 줄의 클립은 남는다");
				assert.equal((await lastApply()).removed.length, 0);
				log("(3) 빠진 줄 클립: 체크하면 지움 (1), 끄면 남음 — " + r3.status.text);
			});

			// ═══ (4) 레거시 목록 +0.4초 → v28 안전 경로 → 되돌리기 ═══
			await H.withScratchSequence(api, "s2_5b", async () => {
				await clearV2up();
				assert.equal(await panel(H.pageSelectTrack(2)), "2");
				const cues = [[1, 3, "S25 레거시 첫째"], [4, 6, "S25 레거시 둘째"], [7, 9, "S25 레거시 셋째"], [10, 12, "S25 레거시 넷째"], [13, 15, "S25 레거시 다섯째"]];
				const ids = await H.loadRowsWithPreset(api, "s2_5_legacy.srt", cues, P.id);
				assert.equal((await panel(SNAP)).mi.castOrder.length, 0, "화자 표 없음 (레거시)");
				await panel(H.PAGE_CLEAR_STATUS);
				await panel(H.PAGE_UNCHECK_ALL);
				await panel(click("btnApply"));
				const st0 = await H.waitStatus(panel, /배치 완료/, { timeoutMs: LONG });
				assert.equal(st0.cls, "ok", st0.text);
				const before = JSON.parse(await host(jsxTrackFull(2)));
				assert.equal(before.length, 5, "v27로 5개");
				// 병합: 둘째 문장, 셋째 +0.4초
				const v2 = cues.map((c, i) => (i === 1 ? [c[0], c[1], c[2] + " (고침)"] : i === 2 ? [c[0] + 0.4, c[1] + 0.4, c[2]] : c));
				assert.equal(await panel(H.pageDropSrt("s2_5_legacy.srt", H.srtOf(v2))), "sent");
				const mc = await H.waitConfirm(panel);
				assert.equal(mc.yes, "병합 (후반 작업 유지)");
				await panel(click("confirmYes"));
				await H.waitStatus(panel, /^SRT 병합: /);
				let s = await panel(SNAP);
				assert.deepEqual(ids.map((id) => s.rowStates[id].mm || ""), ["", "text", "time", "", ""]);
				await panel(H.PAGE_RECORD_HOST_CALLS);
				const r = await H.safeApplyClick(api, 2);
				assert.match(r.confirm.msg, /클립만 타임라인에서 찾아\(nodeId\) 제자리 갱신·시간 이동·새로 놓기/, r.confirm.msg);
				assert.equal(r.status.text, "안전하게 적용: 갱신 1 · 옮김 1", r.status.text);
				const calls = await panel("window.__hostCalls.slice()");
				assert.equal(calls.filter((c) => c === "updateClipAtTime" || c === "applyToTimeline").length, 0, "v27 호스트를 부르지 않는다: " + calls.join(","));
				const after = JSON.parse(await host(jsxTrackFull(2)));
				const ft = await ftOf();
				const fr = (ticks) => Math.round(Number(ticks) / ft);
				assert.equal(after.length, 5, "중복 없음");
				assert.ok(after.every((c) => !CORE.parseClipTag(c.name)), "태그 없음: " + after.map((c) => c.name).join(","));
				[0, 3, 4].forEach((i) => assert.deepEqual([after[i].nodeId, after[i].s, after[i].e], [before[i].nodeId, before[i].s, before[i].e], "이웃 " + i + " 그대로"));
				assert.equal(after[1].nodeId, before[1].nodeId);
				assert.equal(textOfRaw(H.propValue(after[1], capF.label)), v2[1][2], "둘째 캡션");
				const moved = after.find((c) => c.nodeId === before[2].nodeId);
				assert.ok(moved, "셋째는 같은 클립 (TrackItem.move)");
				assert.ok(Math.abs(fr(moved.s) - Math.round((7.4 * 254016000000) / ft)) <= 1, "셋째 시작 +0.4초: " + fr(moved.s));
				assert.ok(Math.abs(fr(moved.e) - Math.round((9.4 * 254016000000) / ft)) <= 1, "셋째 끝 +0.4초: " + fr(moved.e));
				s = await panel(SNAP);
				assert.ok(ids.every((id) => !s.rowStates[id].mm), "mm 모두 지움");
				const la = await lastApply();
				assert.deepEqual([la.legacy, la.updated.length, la.moved.length], [true, 1, 1]);
				log("(4) 레거시 +0.4초: " + r.status.text + " — 셋째 nodeId " + moved.nodeId + " 그대로, 이웃 그대로");
				// 되돌리기 (명령)
				const u = await panel(H.pageCmd("undo", {}));
				assert.equal(u.ok, true, JSON.stringify(u));
				assert.deepEqual([u.data.restored, u.data.moved, u.data.changed, u.data.failed], [1, 1, 0, 0], JSON.stringify(u.data));
				const back = JSON.parse(await host(jsxTrackFull(2)));
				assert.deepEqual(back.map((c) => [c.nodeId, fr(c.s), fr(c.e)]), before.map((c) => [c.nodeId, fr(c.s), fr(c.e)]), "자리·nodeId가 적용 전과 같다");
				back.forEach((c, i) => assert.deepEqual(c.props.map((p) => (p[2] ? p[2] : p[1])), before[i].props.map((p) => (p[2] ? p[2] : p[1])), "클립 " + i + " 속성 (색은 ARGB)"));
				s = await panel(SNAP);
				assert.deepEqual([s.rowStates[ids[1]].mm, s.rowStates[ids[2]].mm], ["undone", "undone"]);
				log("(4) 되돌리기: " + (await panel(H.PAGE_STATUS)).text);
			});

			// ═══ (5) 중지한 적용의 되돌리기 ═══
			await H.withScratchSequence(api, "s2_5c", async () => {
				await clearV2up();
				assert.equal(await panel(H.pageSelectTrack(2)), "2");
				const cues = Array.from({ length: 12 }, (_, i) => [1 + 6 * i, 2.5 + 6 * i, "S25 중단 " + (i + 1)]);
				await importFiles([{ name: "C1.srt", content: H.srtOf(cues) }], { C1: P.id }, 12);
				const r0 = await applyButton();
				assert.doesNotMatch(r0.status.text, /충돌|실패/, r0.status.text);
				const S0 = await snapAll();
				assert.equal(Object.keys(S0).length, 12);
				const edited = cues.map((c) => [c[0], c[1], c[2] + " 고침"]);
				await importFiles([{ name: "C1.srt", content: H.srtOf(edited) }], null, 12);
				await panel(PAGE_STOP_AFTER_FIRST_CHUNK);
				const r1 = await applyButton();
				assert.match(r1.status.text, /^중지함 — /, r1.status.text);
				const la = await lastApply();
				assert.equal(la.complete, false);
				assert.ok(la.updated.length >= 1 && la.updated.length < 12, "일부만: " + la.updated.length);
				const u = await undoByHistory(true);
				assert.equal(u.status.text, "마지막 적용 되돌리기: 되돌림 " + la.updated.length, u.status.text);
				const S2 = await snapAll();
				const n = sameAs(S0, S2, "(5) 되돌린 뒤 = S0");
				assert.equal(n, 12);
				const s = await panel(SNAP);
				assert.equal(s.subtitles.filter((x) => s.rowStates[x.id].mm === "undone").length, la.updated.length, "기록된 줄만 되돌린 줄");
				log("(5) 중지: " + la.updated.length + "줄 고침 → 되돌리기 " + u.status.text + ", 12개 모두 S0");
			});
		} finally {
			await panel(H.pageSetMiCast(null));
			await panel(H.pageSetLegacyV28(null));
			if (defBefore) fs.writeFileSync(defPath, defBefore);
			else if (fs.existsSync(defPath)) fs.unlinkSync(defPath);
			log("cast_defaults.json 되돌림: " + (defBefore ? "시작 전 내용" : "지움 (시작 전에는 없었다)"));
		}
	}
};
