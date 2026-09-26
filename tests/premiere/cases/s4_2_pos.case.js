"use strict";
/**
 * S4-2 하드: 화자 표 위치(.cast-pos) · 위치만 보내는 다시 적용 · ⋯ '위치만 다시 적용' · 되돌리기 · 동시 발화 쌓기 · 키 보존 · 다시 놓은 클립
 * (DEV 패널 + DEV 호스트 MID_, MI_test.prproj의 T_ 시퀀스). 타임라인은 스크래치 사본 하나에서만 바꾼다 (V2 이상을 먼저 비운다).
 * S4-1 호스트(MID_setMotion, placeChunk motion)가 필요하다 — JSX를 바꾼 뒤 Premiere를 다시 시작하고 돌린다.
 * 같은 흐름의 Premiere 없는 판은 tests/unit/panel_pos.test.js (premiereSim)다.
 *   자막: C1 철수 [2, 4] · [14, 17] · [20, 23], C2 영희 [6, 8] · [14.5, 16.5] · [20.5, 22.5], C3 민수 [10, 12] · [21, 22] (초)
 *         → 혼자 말하는 줄 셋(2·6·10초)과 동시 발화 둘(14초 C1+C2, 20초 C1+C2+C3)
 *   (0) 위치 '변경 안 함'으로 ▶ → 모든 클립 Position (0.5, 0.5) 그대로 (Motion을 건드리지 않는다)
 *   (1) C1 왼쪽 · C2 오른쪽 · C3 위 → ▶: 보낸 placeChunk 항목이 모두 update·속성 0·이름 null·keepTime·motion(화자 위치), readClipTexts 없음,
 *       nodeId·텍스트 되읽기·시작·끝 그대로, 화자마다 모든 클립의 Position ±0.001. PNG: %TEMP%\mi_s4_2_{c1_left,c2_right,c3_top,both,three}.png
 *   (2) 다시 ▶ → 보낼 것 없음 (placeChunk 없음)
 *   (3) C3 직접 (0.5, 0.3) → ⋯ '위치만 다시 적용' → MID_setMotion만 (placeChunk 없음), C3 Position (0.5, 0.3), C1·C2 그대로,
 *       모든 클립의 텍스트·이름·시작·끝 그대로 → 다시 ▶ 보낼 것 없음
 *   (4) 되돌리기(명령 undo = 히스토리 '↶ 마지막 적용 되돌리기') → C3 Position이 위(0.5, 0.35)로
 *   (5) 동시 발화 쌓기 켬 → ▶ → 14.5초 C2는 y 0.38, 20.5초 C2는 0.38·21초 C3은 0.35 − 2 × 0.12 = 0.11, 혼자인 줄은 그대로.
 *       PNG mi_s4_2_stack_both·stack_three → 끔 → ▶ → 쌓기 전 자리
 *   (6) C1 첫 클립 Position에 키 2개 → C1 원래 자리 → ▶ → 그 줄 '키프레임이 있어 위치를 바꾸지 않음', 키 수·값 그대로, 상태 '위치 키프레임 1'
 *   (7) C3 트랙 고정(다른 트랙) + 위치 '변경 안 함' → ▶ → C3 클립이 새 트랙으로 다시 놓이고(moveRegen) 위치(0.5, 0.35)를 가져간다
 *       → 되돌리기 → 옛 트랙에 되놓인 클립도 위치 (0.5, 0.35)
 * 프로젝트 단위 cast_defaults.json(DEV 캐시)은 끝나면 시작 전 내용으로 되돌린다. 실행: npm run hard -- s4_2   (PNG 경로는 로그의 'PNG' 줄)
 */
const fs = require("node:fs");
const path = require("node:path");
const H = require("../lib/hard");
const { loadRegions } = require("../../lib/loadRegions");

const CORE = loadRegions(["src/mi/core.ts"]);
const SNAP = "window._mogrtDebug.snapshot()";
const SCR = H.SCRATCH_PREFIX;
const LONG = 240000;
const EPS = 0.001;
const NAMES = { C1: "철수", C2: "영희", C3: "민수" };
const CUES = {
	C1: [[2, 4, "S42 철수 혼자 왼쪽"], [14, 17, "S42 철수 둘이 말함"], [20, 23, "S42 철수 셋이 말함"]],
	C2: [[6, 8, "S42 영희 혼자 오른쪽"], [14.5, 16.5, "S42 영희 둘이 말함"], [20.5, 22.5, "S42 영희 셋이 말함"]],
	C3: [[10, 12, "S42 민수 혼자 위"], [21, 22, "S42 민수 셋이 말함"]]
};
const POS = { left: { x: 0.35, y: 0.5 }, right: { x: 0.65, y: 0.5 }, top: { x: 0.5, y: 0.35 }, orig: { x: 0.5, y: 0.5 } };

// ── 페이지 ──
const click = (id) => "document.getElementById(" + JSON.stringify(id) + ").click(), true";
const castRowExpr = (K) => "Array.from(document.querySelectorAll('#castRows .cast-row')).find((x) => x.dataset.key === " + JSON.stringify(K) + ")";
/** 화자 K의 위치 칸 (select .cast-pos) → 값 */
function pageSetPos(K, v) {
	return "(() => { const r = " + castRowExpr(K) + "; if (!r) return 'no-row'; const s = r.querySelector('.cast-pos'); s.value = " + JSON.stringify(v) + "; s.dispatchEvent(new Event('change')); return s.value; })()";
}
/** 화자 K의 직접 칸 (select '직접' → x·y 입력) → 저장된 위치 */
function pageSetCustom(K, x, y) {
	return "(() => { let r = " + castRowExpr(K) + "; const s = r.querySelector('.cast-pos'); s.value = 'custom'; s.dispatchEvent(new Event('change'));" +
		" r = " + castRowExpr(K) + "; const xi = r.querySelector('.cast-x'); xi.value = " + JSON.stringify(String(x)) + "; xi.dispatchEvent(new Event('change'));" +
		" r = " + castRowExpr(K) + "; const yi = r.querySelector('.cast-y'); yi.value = " + JSON.stringify(String(y)) + "; yi.dispatchEvent(new Event('change'));" +
		" return window._mogrtDebug.snapshot().mi.cast[" + JSON.stringify(K) + "].pos; })()";
}
/** 화자 K의 트랙 칸 → 값 */
function pageSetCastTrack(K, v) {
	return "(() => { const r = " + castRowExpr(K) + "; const s = r.querySelector('.cast-track'); s.value = " + JSON.stringify(String(v)) + "; s.dispatchEvent(new Event('change')); return s.value; })()";
}
/** ⋯ 메뉴의 act 항목을 누른다 → true | 까닭 */
function pageCastMenu(K, act) {
	return "(() => { const r = " + castRowExpr(K) + "; if (!r) return 'no-row'; r.querySelector('.cast-more').click();" +
		" const b = Array.from((" + castRowExpr(K) + ").querySelectorAll('.cast-menu button')).find((x) => x.dataset.act === " + JSON.stringify(act) + ");" +
		" if (!b) return 'no-item'; b.click(); return true; })()";
}
function pageStack(on) {
	return "(() => { const c = document.getElementById('castStackChk'); c.checked = " + (on ? "true" : "false") + "; c.dispatchEvent(new Event('change')); return window._mogrtDebug.snapshot().mi.stack; })()";
}
const pageRowRes = (id) => "(() => { const e = document.querySelector('#row-" + Number(id) + " .sub-res'); return e ? e.textContent : null; })()";
// placeChunk 항목 기록 (window.__s42items), 풀 때는 PAGE_UNRECORD_CHUNKS
const PAGE_RECORD_CHUNKS = "(() => { const m = window._mogrtDebug.hostMi; if (!window.__s42chunkOrig) window.__s42chunkOrig = m.placeChunk; window.__s42items = [];" +
	" m.placeChunk = (p) => { ((p && p.items) || []).forEach((it) => window.__s42items.push({ key: it.key, op: it.op, keepTime: it.keepTime, params: (it.params || []).length, name: it.name, motion: it.motion })); return window.__s42chunkOrig(p); }; return true; })()";
const PAGE_UNRECORD_CHUNKS = "(() => { if (window.__s42chunkOrig) { window._mogrtDebug.hostMi.placeChunk = window.__s42chunkOrig; delete window.__s42chunkOrig; } return true; })()";

// ── 호스트 JSX (ES3, 스크래치만. 예약어를 키로 쓰지 않는다) ──
const JSX_NUM_TRACKS = "(function(){var s=app.project.activeSequence;return String(s.videoTracks.numTracks);})()";
/** nodeId 클립의 Motion Position에 키 두 개 ([0.3, 0.5] · [0.7, 0.5]) → "true" | 까닭 */
function jsxKeyPosition(ti, nodeId) {
	return "(function(){var seq=app.project.activeSequence;if(String(seq.name).indexOf('" + SCR + "')!==0)return 'not-scratch';" +
		"var ft=Number(seq.getSettings().videoFrameRate.ticks);var c=MID__nodeMap(seq.videoTracks[" + Number(ti) + "])['n'+" + JSON.stringify(String(nodeId)) + "];if(!c)return 'no-clip';" +
		"var pos=MID__motionProp(c);if(!pos)return 'no-motion';var inT=Number(c.inPoint.ticks);pos.setTimeVarying(true);var k1=MID__T(inT+12*ft);var k2=MID__T(inT+36*ft);" +
		"pos.addKey(k1);pos.setValueAtKey(k1,[0.3,0.5],true);pos.addKey(k2);pos.setValueAtKey(k2,[0.7,0.5],true);return String(pos.isTimeVarying());})()";
}
/** nodeId 클립의 Position 키 → MID__json {keyed, keys, kv} */
function jsxKeys(ti, nodeId) {
	return "(function(){var seq=app.project.activeSequence;var c=MID__nodeMap(seq.videoTracks[" + Number(ti) + "])['n'+" + JSON.stringify(String(nodeId)) + "];if(!c)return MID__json({error:'no-clip'});" +
		"var pr=MID__motionProp(c);var o={keyed:false,keys:null,kv:[]};try{o.keyed=pr.isTimeVarying()===true;}catch(e1){}" +
		"var ks=null;try{ks=pr.getKeys();}catch(e2){}if(ks){o.keys=ks.length;for(var i=0;i<ks.length;i++){var v=null;try{v=MID__vec2(pr.getValueAtKey(ks[i]));}catch(e3){}o.kv.push(v);}}return MID__json(o);})()";
}
/** 스크래치 사본의 sec초 프레임을 %TEMP%\<name>.png로 (역슬래시, 확장자 없이: S0-3 §3 10) → 경로 | 'ERR …' */
function jsxExportFrame(sec, name) {
	return "(function(){var seq=app.project.activeSequence;if(String(seq.name).indexOf('" + SCR + "')!==0)return 'not-scratch';" +
		"app.enableQE();var t=new Time();t.seconds=" + Number(sec) + ";seq.setPlayerPosition(String(t.ticks));var qs=qe.project.getActiveSequence();" +
		"var f=Folder.temp.fsName+'\\\\" + String(name).replace(/[^A-Za-z0-9_]/g, "_") + "';try{qs.exportFramePNG(qs.CTI.timecode,f);}catch(e){return 'ERR '+e.message;}return f+'.png';})()";
}
async function waitFile(p, ms) {
	const t0 = Date.now();
	while (Date.now() - t0 < (ms || 30000)) {
		try {
			if (fs.existsSync(p) && fs.statSync(p).size > 0) return true;
		} catch (_) {}
		await H.sleep(300);
	}
	return false;
}
const close = (v, want) => Array.isArray(v) && Math.abs(v[0] - want.x) <= EPS && Math.abs(v[1] - want.y) <= EPS;

module.exports = {
	name: "S4-2 화자별 화면 위치 (화자 표·위치만 보내는 적용·위치만 다시 적용·되돌리기·쌓기·키·다시 놓은 클립)",
	run: async (api) => {
		const { panel, host, mi, assert, log } = api;
		await H.waitKeys(panel);
		assert.equal(await panel(H.pageSetMiCast(null)), true, "다화자 기본값은 켬");
		const root = await H.devCacheRoot(panel);
		const rootFs = root.replace(/\//g, path.sep);
		const snap0 = await panel(SNAP);
		const defPath = path.join(rootFs, snap0.keys.proj, "cast_defaults.json");
		const defBefore = fs.existsSync(defPath) ? fs.readFileSync(defPath) : null;
		const ok = await panel("await window._mogrtDebug.miHostOk()");
		assert.equal(ok.ok, true, "v28 호스트·같은 빌드 (S4-1 호스트): " + JSON.stringify(ok));
		const pick = (list) => list.filter((p) => !p.native && p.captionFid).sort((a, b) => b.fields.length - a.fields.length)[0] || null;
		let P = pick((await panel(H.pageCmd("presets", {}))).data);
		if (!P) {
			await H.ensurePreset(api);
			P = pick((await panel(H.pageCmd("presets", {}))).data);
		}
		assert.ok(P, "캡션 필드가 있는 AE 프리셋이 필요하다");
		const PP = (await panel(SNAP)).presets[P.id];
		log("프리셋 " + P.id + " " + P.name);

		// ── 도우미 ──
		const ping = async () => mi("ping");
		const apply = async (onPf) => H.miApplyButton(api, onPf, { timeoutMs: LONG });
		// 줄마다 지금 클립 {id: {K, track, nodeId, sf, ef, name, pos, keyed, texts}} (MID_getTracks + MID_readClipTexts want.pos)
		const clipsOfRows = async () => {
			const s = await panel(SNAP);
			const p = await ping();
			const scan = await mi("getTracks", { seqId: p.seqId, build: p.build, tracks: null });
			assert.equal(scan.ok, true, JSON.stringify(scan).slice(0, 300));
			const idx = CORE.scanIndex(scan, s.mi.salt);
			const out = {};
			const items = [];
			s.subtitles.forEach((x) => {
				const c = idx.current[s.mi.salt + "-" + x.id];
				assert.ok(c, x.spk + " 줄 " + x.id + " 클립이 있어야 한다");
				out[x.id] = { K: x.spk, track: c.track, nodeId: c.nodeId, sf: c.sf, ef: c.ef, name: c.name };
				items.push({ track: c.track, nodeId: c.nodeId });
			});
			for (let i = 0; i < items.length; i += 40) {
				const rd = await mi("readClipTexts", { seqId: p.seqId, build: p.build, items: items.slice(i, i + 40), want: { texts: true, lay: false, deco: false, params: false, pos: true } });
				assert.equal(rd.ok, true, JSON.stringify(rd).slice(0, 300));
				rd.results.forEach((r) => {
					const id = Object.keys(out).find((k) => out[k].nodeId === r.nodeId);
					Object.assign(out[id], { pos: r.pos, keyed: r.posKeyed, texts: r.texts });
				});
			}
			return out;
		};
		const same = (a, b, what) => {
			Object.keys(a).forEach((id) => {
				assert.deepEqual([b[id].nodeId, b[id].name, b[id].sf, b[id].ef, b[id].texts], [a[id].nodeId, a[id].name, a[id].sf, a[id].ef, a[id].texts], what + ": 줄 " + id + " nodeId·이름·시작·끝·텍스트 그대로");
			});
		};
		const expectPos = (cl, want, what) => {
			Object.keys(cl).forEach((id) => {
				const w = typeof want === "function" ? want(Number(id), cl[id]) : want[cl[id].K];
				if (!w) return;
				assert.ok(close(cl[id].pos, w), what + ": 줄 " + id + " (" + cl[id].K + ") Position " + JSON.stringify(cl[id].pos) + " ≠ " + JSON.stringify(w));
			});
		};
		const png = async (sec, name, expect) => {
			const p = await host(jsxExportFrame(sec, "mi_s4_2_" + name));
			assert.ok(!/^(ERR|not-scratch)/.test(p), "exportFramePNG: " + p);
			const okf = await waitFile(p, 30000);
			log("PNG " + name + " (" + sec + "s, 기대: " + expect + "): " + p + (okf ? "" : "  ← 파일이 아직 없다"));
			assert.ok(okf, "PNG 파일 " + p);
		};
		const idsOf = (s, K) => s.subtitles.filter((x) => x.spk === K).map((x) => x.id);

		try {
			await H.withScratchSequence(api, "s4_2", async () => {
				const n = Number(await host(JSX_NUM_TRACKS));
				for (let i = 1; i < n; i++) assert.match(String(await host(H.jsxClearVideoTrack(i))), /^0$/, "V" + (i + 1) + " 비우기");
				assert.equal(await panel(H.pageSelectTrack(2)), "2");
				assert.equal(await panel(H.pageDropSrts(["C1", "C2", "C3"].map((K) => ({ name: K + ".srt", content: H.srtOf(CUES[K]) })))), "sent");
				await H.waitFor(panel, "(() => { const m = " + H.PAGE_IMPORT_MODAL + "; return m && m.open && m.rows.length === 3 ? m : null; })()", { what: "가져오기 창 (3개)" });
				assert.equal(await panel("(() => { const by = " + JSON.stringify({ C1: NAMES.C1, C2: NAMES.C2, C3: NAMES.C3 }) + "; let k = 0; document.querySelectorAll('#impBody tr.imp-row').forEach((r) => {" +
					" const K = (r.querySelector('.imp-key') || {}).value; if (!by[K]) return; k++; const nm = r.querySelector('.imp-name'); nm.value = by[K]; nm.dispatchEvent(new Event('input'));" +
					" const p = r.querySelector('.imp-preset'); p.value = " + JSON.stringify(P.id) + "; p.dispatchEvent(new Event('change')); }); return k; })()"), 3);
				await panel(click("impOk"));
				await H.waitFor(panel, "document.querySelectorAll('#listWrap .sub-row').length === 8", { timeoutMs: 60000, what: "8줄" });
				await H.waitFor(panel, "(() => { const s = " + SNAP + "; return s.subtitles.every((x) => (s.rowStates[x.id]._allParams || []).length > 0); })()", { timeoutMs: 120000, what: "줄 속성" });
				// 이 프로젝트의 cast_defaults에 위치가 남아 있으면 '변경 안 함'으로 시작한다
				for (const K of ["C1", "C2", "C3"]) assert.equal(await panel(pageSetPos(K, "")), "");
				// 쌓기는 기본으로 켜져 있다(2026-09-26 사용자 결정) → (0)~(4)는 쌓기 없이 보고, (5)에서 켠다
				assert.equal(await panel(pageStack(false)), false, "쌓기 끔으로 시작");
				await panel(H.PAGE_UNCHECK_ALL);

				// ═══ (0) 위치 '변경 안 함' ▶ → Motion 그대로 ═══
				let r = await apply();
				assert.match(r.status.text, /^화자별 배치: 놓음 8/, r.status.text);
				let cl = await clipsOfRows();
				expectPos(cl, () => POS.orig, "(0)");
				log("(0) 위치 '변경 안 함': 8개 모두 (0.5, 0.5)");

				// ═══ (1) C1 왼쪽 · C2 오른쪽 · C3 위 → ▶ 위치만 ═══
				assert.equal(await panel(pageSetPos("C1", "left")), "left");
				assert.equal(await panel(pageSetPos("C2", "right")), "right");
				assert.equal(await panel(pageSetPos("C3", "top")), "top");
				let s = await panel(SNAP);
				assert.deepEqual([s.mi.cast.C1.pos, s.mi.cast.C2.pos, s.mi.cast.C3.pos], [POS.left, POS.right, POS.top]);
				const cl0 = cl;
				await panel(PAGE_RECORD_CHUNKS);
				await panel(H.PAGE_RECORD_HOST_CALLS);
				r = await apply();
				const items = await panel("window.__s42items.slice()");
				const called = await panel("window.__hostCalls.slice()");
				assert.equal(items.length, 8, JSON.stringify(items));
				assert.ok(items.every((it) => it.op === "update" && it.keepTime === true && it.params === 0 && it.name === null && it.motion), "위치만 보내는 update: " + JSON.stringify(items[0]));
				assert.ok(called.indexOf("MID_readClipTexts") === -1, "되읽기 없음: " + called.join(","));
				assert.match(r.status.text, /^화자별 배치: 갱신 8 · 위치만 8$/, r.status.text);
				cl = await clipsOfRows();
				same(cl0, cl, "(1)");
				expectPos(cl, { C1: POS.left, C2: POS.right, C3: POS.top }, "(1)");
				log("(1) 위치만 보냄 8개 (update·속성 0·keepTime), nodeId·텍스트·시간 그대로, C1 왼쪽·C2 오른쪽·C3 위");
				await png(3, "c1_left", "철수 자막이 왼쪽 (Position 0.35, 0.5)");
				await png(7, "c2_right", "영희 자막이 오른쪽 (0.65, 0.5)");
				await png(11, "c3_top", "민수 자막이 위 (0.5, 0.35)");
				await png(15.5, "both", "철수 왼쪽 + 영희 오른쪽 동시");
				await png(21.5, "three", "철수 왼쪽 + 영희 오른쪽 + 민수 위 동시");

				// ═══ (2) 다시 ▶ → 보낼 것 없음 ═══
				await panel(PAGE_RECORD_CHUNKS);
				r = await apply();
				assert.deepEqual(await panel("window.__s42items.length"), 0);
				assert.match(r.status.text, /^변경 없음/, r.status.text);

				// ═══ (3) C3 직접 (0.5, 0.3) → ⋯ 위치만 다시 적용 ═══
				assert.deepEqual(await panel(pageSetCustom("C3", 0.5, 0.3)), { x: 0.5, y: 0.3 });
				await panel(H.PAGE_RECORD_HOST_CALLS);
				await panel(H.PAGE_CLEAR_STATUS);
				assert.equal(await panel(pageCastMenu("C3", "pos")), true);
				const st3 = await H.waitStatus(panel, /위치만 다시 적용|위치를|멈춤|중단/, { timeoutMs: 60000 });
				assert.equal(st3.text, "C3 " + NAMES.C3 + " 위치만 다시 적용: 위치 2개", st3.text);
				const called3 = await panel("window.__hostCalls.slice()");
				assert.ok(called3.indexOf("MID_setMotion") !== -1 && called3.indexOf("MID_placeChunk") === -1, "setMotion만: " + called3.join(","));
				const cl3 = await clipsOfRows();
				same(cl, cl3, "(3)");
				expectPos(cl3, { C1: POS.left, C2: POS.right, C3: { x: 0.5, y: 0.3 } }, "(3)");
				await panel(PAGE_RECORD_CHUNKS);
				r = await apply();
				assert.deepEqual([await panel("window.__s42items.length"), /^변경 없음/.test(r.status.text)], [0, true], "(3) 뒤 ▶: " + r.status.text);
				log("(3) 위치만 다시 적용: MID_setMotion만, C3 (0.5, 0.3), 나머지·텍스트·시간 그대로, 다음 ▶ 보낼 것 없음");

				// ═══ (4) 되돌리기 → C3 위 ═══
				const u = await panel(H.pageCmd("undo", {}));
				assert.equal(u.ok, true, JSON.stringify(u));
				const cl4 = await clipsOfRows();
				same(cl, cl4, "(4)");
				expectPos(cl4, { C1: POS.left, C2: POS.right, C3: POS.top }, "(4)");
				log("(4) 되돌리기: C3 위치 (0.5, 0.35)로, 텍스트·시간 그대로 — " + JSON.stringify(u.data));
				// 되돌린 줄은 '변경 줄' → 지금 위치(직접 0.5, 0.3)로 다시 맞춘 뒤 '위'로 두고 쌓기로 간다
				assert.equal(await panel(pageSetPos("C3", "top")), "top");
				r = await apply();

				// ═══ (5) 동시 발화 쌓기 ═══
				assert.equal(await panel(pageStack(true)), true);
				r = await apply();
				s = await panel(SNAP);
				const c1 = idsOf(s, "C1");
				const c2 = idsOf(s, "C2");
				const c3 = idsOf(s, "C3");
				cl = await clipsOfRows();
				const stacked = { [c2[1]]: { x: 0.65, y: 0.38 }, [c2[2]]: { x: 0.65, y: 0.38 }, [c3[1]]: { x: 0.5, y: 0.11 } };
				expectPos(cl, (id, c) => stacked[id] || { C1: POS.left, C2: POS.right, C3: POS.top }[c.K], "(5) 쌓기");
				log("(5) 쌓기 켬: " + r.status.text + " — 14.5초 C2 y 0.38, 20.5초 C2 0.38, 21초 C3 0.11");
				await png(15.5, "stack_both", "영희가 철수보다 한 줄 위 (영희 y 0.38)");
				await png(21.5, "stack_three", "철수 · 영희(한 줄 위) · 민수(두 줄 위, y 0.11) 층");
				assert.equal(await panel(pageStack(false)), false);
				r = await apply();
				cl = await clipsOfRows();
				expectPos(cl, { C1: POS.left, C2: POS.right, C3: POS.top }, "(5) 쌓기 끔");
				log("(5) 쌓기 끔: " + r.status.text + " — 쌓기 전 자리");

				// ═══ (6) 키가 있는 Position ═══
				const k1 = cl[c1[0]];
				assert.equal(await host(jsxKeyPosition(k1.track, k1.nodeId)), "true", "Position 키 2개");
				const kb = JSON.parse(await host(jsxKeys(k1.track, k1.nodeId)));
				assert.equal(await panel(pageSetPos("C1", "orig")), "orig");
				r = await apply();
				assert.match(r.status.text, /위치 키프레임 1 \(바꾸지 않음\)/, r.status.text);
				assert.equal(await panel(pageRowRes(c1[0])), "키프레임이 있어 위치를 바꾸지 않음");
				const ka = JSON.parse(await host(jsxKeys(k1.track, k1.nodeId)));
				assert.deepEqual([ka.keyed, ka.keys, ka.kv], [kb.keyed, kb.keys, kb.kv], "키 수·값 그대로");
				cl = await clipsOfRows();
				expectPos(cl, (id, c) => (id === c1[0] ? null : { C1: POS.orig, C2: POS.right, C3: POS.top }[c.K]), "(6)");
				log("(6) 키 있는 Position: keyframed, 키 " + ka.keys + "개 그대로, 나머지 C1은 원래 자리");

				// ═══ (7) 다시 놓은 클립이 위치를 가져간다 → 되돌리기 ═══
				const before7 = cl;
				const t3 = cl[c3[0]].track;
				const tNew = Math.max(...Object.keys(cl).map((id) => cl[id].track)) + 1;
				assert.equal(await panel(pageSetPos("C3", "")), "");
				assert.equal(await panel(pageSetCastTrack("C3", tNew)), String(tNew));
				r = await apply();
				assert.match(r.status.text, /옮김 2/, r.status.text);
				cl = await clipsOfRows();
				c3.forEach((id) => {
					assert.equal(cl[id].track, tNew, "C3 줄 " + id + " 새 트랙 V" + (tNew + 1));
					assert.notEqual(cl[id].nodeId, before7[id].nodeId, "다시 놓은 클립");
					assert.ok(close(cl[id].pos, POS.top), "다시 놓은 C3 줄 " + id + " 위치 " + JSON.stringify(cl[id].pos));
				});
				const u7 = await panel(H.pageCmd("undo", {}));
				assert.equal(u7.ok, true, JSON.stringify(u7));
				cl = await clipsOfRows();
				c3.forEach((id) => {
					assert.equal(cl[id].track, t3, "되돌린 C3 줄 " + id + " 옛 트랙");
					assert.ok(close(cl[id].pos, POS.top), "되놓은 C3 줄 " + id + " 위치 " + JSON.stringify(cl[id].pos));
				});
				log("(7) 트랙 고정 → moveRegen 2개가 위치 (0.5, 0.35)를 가져감, 되돌리기로 옛 트랙에 되놓은 클립도 같은 위치");
			});
		} finally {
			try {
				if (defBefore) fs.writeFileSync(defPath, defBefore);
				else if (fs.existsSync(defPath)) fs.unlinkSync(defPath);
				log("cast_defaults.json 되돌림: " + (defBefore ? "시작 전 내용" : "지움 (시작 전에는 없었다)"));
			} catch (e) {
				log("경고: cast_defaults.json을 되돌리지 못했다 — " + e.message);
			}
			for (const [what, expr] of [["placeChunk 기록", PAGE_UNRECORD_CHUNKS], ["다화자 기본값", H.pageSetMiCast(null)]]) {
				try {
					await panel(expr);
				} catch (e) {
					log("경고: " + what + " 되돌리기 실패 — " + e.message);
				}
			}
		}
	}
};
