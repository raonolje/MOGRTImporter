"use strict";
/**
 * S3-4 하드 E2E: 3화자 동시 발화 · 나누기·합치기 다시 가져오기 · 되돌리기 · 성능 (DEV 패널 + DEV 호스트 MID_, MI_test.prproj의 T_ 시퀀스).
 * 타임라인은 스크래치 사본 하나에서만 바꾼다 (V2 이상을 먼저 비운다). 호스트는 바뀌지 않는다 (패널만 새로 고쳐도 된다).
 * 같은 자막·같은 순서의 Premiere 없는 판은 tests/unit/panel_e2e.test.js (premiereSim)다.
 *   (A) 3화자 × 40줄, 모든 차례에 세 화자가 동시에 말한다 (C1 [s, s+1.5] · C2 [s+0.5, s+2] · C3 [s+1, s+2.5], s = 1 + 3k초).
 *       기본 트랙 V3 위 트랙(V4 ~ 마지막)마다 남의 클립(태그 없는 MOGRT)을 깔아 C2·C3가 새 트랙을 쓰게 한다 → 가져오기 창(이름·프리셋)
 *       → ▶ 점검 창에 계획한 트랙 'C1 철수 V3 40 · C2 영희 Vn 40 · C3 민수 Vn+1 40'과 '새 비디오 트랙 2개' → 화자마다 자기 트랙,
 *       클립마다 시작·끝 = 자막 ±1프레임 (잘린 클립 없음), 같은 트랙 겹침 없음, 남의 클립 그대로
 *   (C) 성능 줄 (같은 120줄): 적용 시간(진행률 문구를 본다), 다시 적용(보낸 작업 0, 5초 안), 다시 계획, 검수 시간('정상 120'),
 *       가장 긴 evalScript 한 번 ≤ 8초 (spec) — (A) 적용부터 (B) 적용·되돌리기까지 MI 호출을 모두 잰다 (버퍼 하나, 도중에 비우지 않는다).
 *       템플릿의 첫 importMGT(Premiere 시작 뒤 ≈ 8.9초, docs/spike_s0.md)는 재기 전에 남의 클립(없으면 V2 예열 클립)으로 치른다
 *   (B) C1 다시 내보내기: 11번째 줄을 s+0.5에서 둘로 나누고(문장도 다듬음), 마지막 두 줄을 하나로 합침
 *       → 가져오기 창 '같음 37 · 나눔·합침 확인 2 · 새 줄 1 · 빠짐 1' (줄 mm check·check·new, 빠진 줄은 휴지통 why merge)
 *       → ▶ 한 번 (점검 창 '목록에서 빠진 줄의 클립 1개 지우기' 미리 체크): 앞 조각 줄이기 → 뒤 조각 놓기(템플릿 길이가 덮는 이웃
 *       12번째 줄을 guard로 보냄) → 합친 줄 늘리기 순서, 모든 줄이 자막 ±1프레임 (이웃 머리 잘림 없음), C1 트랙 클립 40개(남은 클립 없음),
 *       앞 조각·합친 줄은 같은 nodeId, C2·C3 트랙은 그대로, 다시 계획하면 0개
 *       → 히스토리 '↶ 마지막 적용 되돌리기' → C1 트랙이 (B) 전과 같다 (uid·시작·끝·캡션), C2·C3 그대로
 *   (D) 스캔 예산 (spec 'the scan within budget with 600 V1 clips', S2-4 (h), 맨 먼저 돈다): 읽기만 — T_BIG(V1 스틸 600 · V2 네이티브 20 · V3 AE 150)을
 *       잠깐 활성으로 두고 MID_getTracks {tracks: null}(V1 뺀 모든 트랙, 검수·적용 스캔과 같은 호출) 한 번의 호스트 ms < 3초
 *       (S0-3 결정 12: 호출 하나 예산 3초). V1까지 읽는 스캔(600개 포함)은 로그만. 끝나면 원래 T_ 시퀀스로 돌아간다
 * 12번째 C1 줄은 길다(s+3 ~ s+5.9): 뒤 조각(s+0.5)의 템플릿 길이(5.005~5.09초)가 머리만 덮는다. 합칠 두 줄은 C1의 마지막이라
 * 되돌리기가 빠진 줄을 템플릿 길이로 되놓을 때 뒤에 C1 클립이 없다.
 * 프로젝트 단위 cast_defaults.json(DEV 캐시)은 끝나면 시작 전 내용으로 되돌린다 (패널 훅보다 먼저). 메모리 경고 모달을 피하려고 스크래치 하나에서 끝낸다.
 * 실행: npm run hard -- s3_4
 */
const fs = require("node:fs");
const path = require("node:path");
const H = require("../lib/hard");
const { loadRegions } = require("../../lib/loadRegions");

const CORE = loadRegions(["src/mi/core.ts"]);
const SNAP = "window._mogrtDebug.snapshot()";
const SCR = H.SCRATCH_PREFIX;
const LONG = 240000;
const TPS = 254016000000;
const click = (id) => "document.getElementById(" + JSON.stringify(id) + ").click(), true";

// ── 자막 (tests/unit/panel_e2e.test.js와 같다) ──
const N = 40;
const SPLIT = 10;
const SPLIT_AT = 0.5;
const JOIN = 38;
const turn = (k) => 1 + 3 * k;
const NAMES = { C1: "철수", C2: "영희", C3: "민수" };
const TXT_SPLIT = "S34 철수 열한째 말은 첫 조각과 둘째 조각";
const TXT_P1 = "S34 첫 조각입니다";
const TXT_P2 = "그리고 둘째 조각이에요";
const TXT_JOIN = "S34 철수 39번째 말에 이어진 다음 말까지 하나로 합쳤습니다";
function cuesOf() {
	const c1 = [];
	const c2 = [];
	const c3 = [];
	for (let k = 0; k < N; k++) {
		const s = turn(k);
		c1.push([s, k === SPLIT + 1 ? s + 2.9 : s + 1.5, k === SPLIT ? TXT_SPLIT : "S34 철수 " + (k + 1) + "번째 말"]);
		c2.push([s + 0.5, s + 2, "S34 영희 " + (k + 1) + "번째 겹친 말"]);
		c3.push([s + 1, s + 2.5, "S34 민수 " + (k + 1) + "번째 겹친 말"]);
	}
	return { c1, c2, c3 };
}
function splitJoin(c1) {
	const out = [];
	c1.forEach(([s, e, t], k) => {
		if (k === SPLIT) {
			out.push([s, s + SPLIT_AT, TXT_P1]);
			out.push([s + SPLIT_AT, e, TXT_P2]);
		} else if (k === JOIN) out.push([s, c1[k + 1][1], TXT_JOIN]);
		else if (k !== JOIN + 1) out.push([s, e, t]);
	});
	return out;
}
// 남의 클립 끝 (자막 전체를 덮는다, 초)
const FOREIGN_END = turn(N - 1) + 10;

// ── 페이지 ──
// 가져오기 창의 줄마다 이름·프리셋 (캡션 트랙 번호 → {name, presetId})
const pageImportSetup = (byKey) => "(() => { const by = " + JSON.stringify(byKey) + "; let n = 0; document.querySelectorAll('#impBody tr.imp-row').forEach((r) => {" +
	" const o = by[(r.querySelector('.imp-key') || {}).value]; if (!o) return; n++;" +
	" const nm = r.querySelector('.imp-name'); if (nm && o.name) { nm.value = o.name; nm.dispatchEvent(new Event('input')); }" +
	" const p = r.querySelector('.imp-preset'); if (p && o.presetId) { p.value = o.presetId; p.dispatchEvent(new Event('change')); } }); return n; })()";
const PAGE_VF = "(() => { const m = document.getElementById('verifyModal'); if (!m || !m.classList.contains('open')) return null;" +
	" return { summary: document.getElementById('vfSummary').textContent, items: Array.from(document.querySelectorAll('#vfList .vf-item')).map((e) => [e.dataset.cat, e.querySelector('.vf-label').textContent]) }; })()";
const PAGE_UNDO_ITEM = "(() => { const e = document.getElementById('btnUndoApply'); return e ? e.textContent : ''; })()";
// evalScript 한 번마다 걸린 시간 (window.__s34times: [[이름, ms]]). 이름은 PAGE_RECORD_HOST_CALLS와 같은 규칙 (없으면 '?' — 케이스의 JSX).
// 부를 때마다 버퍼를 비운다 → 한 번만 부르고, 구간은 버퍼 길이(PAGE_TIMES_LEN)로 나눈다
const PAGE_TIME_HOST_CALLS = "(() => { window.__s34times = []; if (!window.__s34evalOrig) { const orig = CSInterface.prototype.evalScript; window.__s34evalOrig = orig;" +
	" CSInterface.prototype.evalScript = function (script, cb) { const m = /^\\s*(?:\\/\\*host:([A-Za-z_$][\\w$]*)|([A-Za-z_$][\\w$]*)\\s*\\()/.exec(String(script));" +
	"  const n = m ? (m[1] || m[2]) : '?'; const t0 = Date.now(); return orig.call(this, script, function (r) { window.__s34times.push([n, Date.now() - t0]); if (cb) cb(r); }); }; }" +
	" return true; })()";
const PAGE_TIMES_LEN = "(window.__s34times || []).length";
const PAGE_UNTIME_HOST_CALLS = "(() => { if (window.__s34evalOrig) { CSInterface.prototype.evalScript = window.__s34evalOrig; delete window.__s34evalOrig; } return true; })()";
// placeChunk 항목 기록 (window.__s34items: {key, op, sf, ef, guard}). 풀 때는 PAGE_UNRECORD_CHUNKS
const PAGE_RECORD_CHUNKS = "(() => { const m = window._mogrtDebug.hostMi; if (!window.__s34chunkOrig) window.__s34chunkOrig = m.placeChunk; window.__s34items = [];" +
	" m.placeChunk = (p) => { ((p && p.items) || []).forEach((it) => window.__s34items.push({ key: it.key, op: it.op, sf: it.sf, ef: it.ef, guard: (it.guard || []).map(String) })); return window.__s34chunkOrig(p); }; return true; })()";
const PAGE_UNRECORD_CHUNKS = "(() => { if (window.__s34chunkOrig) { window._mogrtDebug.hostMi.placeChunk = window.__s34chunkOrig; delete window.__s34chunkOrig; } return true; })()";

// ── 호스트 JSX (ES3, 스크래치만. 예약어를 키로 쓰지 않는다) ──
const JSX_NUM_TRACKS = "(function(){var s=app.project.activeSequence;return String(s.videoTracks.numTracks);})()";
/** 이름이 name인 시퀀스의 id → JSON {id} | {error} (읽기만) */
function jsxSeqIdByName(name) {
	return "(function(){var p=app.project;for(var k=0;k<p.sequences.numSequences;k++){var s=p.sequences[k];if(String(s.name)===" + JSON.stringify(String(name)) + ")return MID__json({id:String(s.sequenceID)});}" +
		"return MID__json({error:'not-found'});})()";
}
/** 시퀀스를 활성으로 (Project.openSequence, 읽기만 — 시퀀스 내용은 바꾸지 않는다) → "true" | 까닭 */
function jsxOpenSeq(id) {
	return "(function(){try{return String(app.project.openSequence(" + JSON.stringify(String(id)) + "));}catch(e){return 'ERR '+e.message;}})()";
}
// S0-3 결정 12: MI_getTracks 호출 하나의 예산 (≈ 1,500클립)
const SCAN_BUDGET_MS = 3000;
// spec S3-4: evalScript 한 번 > 8초 없음
const EVAL_MAX_MS = 8000;
/** 트랙 ti 클립 [{sf, ef (프레임), nodeId, name, cap (label 속성의 textEditValue, 없으면 null)}] */
function jsxTrackCaps(ti, label) {
	return "(function(){var seq=app.project.activeSequence;if(String(seq.name).indexOf('" + SCR + "')!==0)return MID__json({error:'not-scratch'});" +
		"var ft=Number(seq.getSettings().videoFrameRate.ticks);var t=seq.videoTracks[" + Number(ti) + "];if(!t)return MID__json([]);var out=[];" +
		"for(var k=0;k<t.clips.numItems;k++){var c=t.clips[k];var o={sf:Math.round(Number(c.start.ticks)/ft),ef:Math.round(Number(c.end.ticks)/ft),nodeId:String(c.nodeId),name:String(c.name),cap:null};" +
		"var mg=null;try{mg=c.getMGTComponent();}catch(e1){}" +
		"if(mg){for(var j=0;j<mg.properties.numItems;j++){var p=mg.properties[j];if(String(p.displayName)!==" + JSON.stringify(label) + ")continue;" +
		"try{o.cap=JSON.parse(String(p.getValue())).textEditValue;}catch(e2){o.cap='?';}break;}}" +
		"out.push(o);}return MID__json(out);})()";
}

module.exports = {
	name: "S3-4 E2E: 3화자 동시 발화 · 나누기·합치기 다시 가져오기 · 되돌리기 · 성능 (3 × 40줄)",
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
		const capF = P.fields.find((f) => f.caption);
		log("프리셋 " + P.id + " " + P.name + " (캡션 " + capF.fid + " " + capF.label + ")");

		// ── 공용 도우미 ──
		const ping = async () => mi("ping");
		const scanAll = async () => {
			const p = await ping();
			const r = await mi("getTracks", { seqId: p.seqId, build: p.build, tracks: null });
			assert.equal(r.ok, true, JSON.stringify(r).slice(0, 300));
			return r;
		};
		// ▶ → (점검 창이 뜨면 onPf(창 정보) 뒤 [적용]) → 끝날 때까지 → {pf, status, ms, progress} (시간 초과는 '시간 초과(…)' 문구)
		const applyButton = async (onPf) => H.miApplyButton(api, onPf, { timeoutMs: LONG });
		const lastApply = async () => panel("window._mogrtDebug.lastApply()");
		const fr = (sec, ft) => Math.round((sec * TPS) / ft);
		// 줄마다 지금 클립 (태그 uid) — 시작·끝이 자막 ±1프레임, 같은 태그 하나, 옛 gen 없음, 목록 밖 우리 클립 없음, 같은 트랙 겹침 없음
		// → {scan, idx, tracksOf: {K: [트랙]}, salt, rows}
		const checkRows = async (what) => {
			const s = await panel(SNAP);
			const salt = s.mi.salt;
			const scan = await scanAll();
			const ft = Number(scan.frameTicks);
			const idx = CORE.scanIndex(scan, salt);
			assert.equal(idx.stale.length, 0, what + ": 옛 gen 없음");
			assert.deepEqual(Object.keys(idx.dup), [], what + ": 같은 태그 중복 없음");
			const live = {};
			s.subtitles.forEach((x) => { live[salt + "-" + x.id] = true; });
			assert.deepEqual(Object.keys(idx.own).filter((u) => !live[u]), [], what + ": 목록에 없는 우리 클립 없음 (남은 클립)");
			const tracksOf = {};
			const bad = [];
			s.subtitles.forEach((x) => {
				const c = idx.current[salt + "-" + x.id];
				if (!c) {
					bad.push(x.spk + " 줄 " + x.id + " 클립 없음");
					return;
				}
				const ws = fr(x.startSec, ft);
				const we = fr(x.endSec, ft);
				if (Math.abs(c.sf - ws) > 1 || Math.abs(c.ef - we) > 1) bad.push(x.spk + " 줄 " + x.id + " " + c.sf + "~" + c.ef + " / 자막 " + ws + "~" + we);
				const t = (tracksOf[x.spk] = tracksOf[x.spk] || []);
				if (t.indexOf(c.track) === -1) t.push(c.track);
			});
			assert.deepEqual(bad, [], what + ": 클립마다 자막 ±1프레임 (잘린 클립 없음)");
			scan.tracks.forEach((t) => {
				const c = t.clips.slice().sort((a, b) => a.sf - b.sf);
				for (let i = 1; i < c.length; i++) assert.ok(c[i - 1].ef <= c[i].sf, what + ": V" + (t.i + 1) + " 겹침 " + c[i - 1].name + " / " + c[i].name);
			});
			return { scan, idx, tracksOf, salt, rows: s.subtitles, s };
		};
		const clipsOn = (scan, ti) => ((scan.tracks.find((t) => t.i === ti) || { clips: [] }).clips).map((c) => [c.name, c.sf, c.ef, c.nodeId]);
		// 트랙의 우리 클립 [uid, 시작, 끝, 캡션] (시간순). 태그 없는 클립이 있으면 실패
		const capsOf = async (ti) => {
			const list = JSON.parse(await host(jsxTrackCaps(ti, capF.label)));
			assert.ok(Array.isArray(list), "트랙 " + ti + ": " + JSON.stringify(list));
			return list.slice().sort((a, b) => a.sf - b.sf).map((c) => {
				const tg = CORE.parseClipTag(c.name);
				assert.ok(tg, "V" + (ti + 1) + "에 태그 없는 클립: " + c.name);
				return [tg.uid, c.sf, c.ef, c.cap];
			});
		};

		try {
			// ═══ (D) 스캔 예산: T_BIG (읽기만, 무거운 적용 전에 — 메모리가 덜 찬 Premiere에서 잰다) ═══
			const origId = (await panel(SNAP)).keys.seqId;
			const big = JSON.parse(await host(jsxSeqIdByName("T_BIG")));
			assert.ok(big.id, "MI_test.prproj에 T_BIG(V1 스틸 600 · V3 AE 150, docs/spike_s0.md)이 있어야 한다: " + JSON.stringify(big));
			try {
				log("(D) T_BIG 활성: " + await host(jsxOpenSeq(big.id)));
				await H.waitFor(panel, SNAP + ".keys.seqId === " + JSON.stringify(big.id), { timeoutMs: 30000, what: "패널이 T_BIG으로" });
				const pb = await ping();
				assert.equal(pb.seqId, big.id, "활성 시퀀스 = T_BIG");
				const tS = Date.now();
				const rs = await mi("getTracks", { seqId: pb.seqId, build: pb.build, tracks: null });
				const wall = Date.now() - tS;
				assert.equal(rs.ok, true, JSON.stringify(rs).slice(0, 300));
				const all = [];
				for (let i = 0; i < rs.numVideoTracks; i++) all.push(i);
				const ra0 = await mi("getTracks", { seqId: pb.seqId, build: pb.build, tracks: all });
				assert.equal(ra0.ok, true, JSON.stringify(ra0).slice(0, 300));
				const count = (r) => r.tracks.reduce((a, t) => a + t.clips.length, 0);
				const v1 = (ra0.tracks.find((t) => t.i === 0) || { clips: [] }).clips.length;
				log("(D) T_BIG 스캔 (V1 뺀 모든 트랙): " + count(rs) + "클립 " + rs.ms + "ms (호출 " + wall + "ms, 예산 " + SCAN_BUDGET_MS + "ms)" +
					" · V1까지: " + count(ra0) + "클립 (V1 " + v1 + ") " + ra0.ms + "ms (로그만)");
				assert.ok(v1 >= 600, "T_BIG V1 클립 600개 (" + v1 + ")");
				assert.ok(rs.ms < SCAN_BUDGET_MS, "스캔 " + rs.ms + "ms — 호출 하나 예산 " + SCAN_BUDGET_MS + "ms (S0-3 결정 12)");
			} finally {
				await host(jsxOpenSeq(origId));
				await H.waitFor(panel, SNAP + ".keys.seqId === " + JSON.stringify(origId), { timeoutMs: 30000, what: "패널이 원래 시퀀스로 복귀" });
			}

			await H.withScratchSequence(api, "s3_4", async () => {
				// ═══ (A) 3화자 동시 발화 ═══
				const n = Number(await host(JSX_NUM_TRACKS));
				for (let i = 1; i < n; i++) assert.match(String(await host(H.jsxClearVideoTrack(i))), /^0$/, "V" + (i + 1) + " 비우기");
				// 기본 트랙(V3) 위 트랙마다 남의 클립 → C2·C3는 그 위 새 트랙
				for (let i = 3; i < n; i++) assert.equal(await host(H.jsxPlaceMogrt(PP.mogrtPath, i, 0, FOREIGN_END)), "ok", "V" + (i + 1) + " 남의 클립");
				// 템플릿의 첫 importMGT(Premiere 시작 뒤 ≈ 8.9초)는 evalScript를 재기 전에 치른다: 남의 클립이 없으면(트랙 3개 이하) V2에 하나 놓고 지운다
				if (n <= 3) {
					assert.equal(await host(H.jsxPlaceMogrt(PP.mogrtPath, 1, FOREIGN_END + 5, FOREIGN_END + 6)), "ok", "V2 예열 클립");
					assert.match(String(await host(H.jsxClearVideoTrack(1))), /^0$/, "V2 예열 클립 지우기");
				}
				const t2 = Math.max(3, n);
				const t3 = t2 + 1;
				const made = [t2, t3].filter((t) => t >= n).map((t) => "V" + (t + 1));
				assert.equal(await panel(H.pageSelectTrack(2)), "2");
				const { c1, c2, c3 } = cuesOf();
				assert.equal(await panel(H.pageDropSrts([{ name: "C1.srt", content: H.srtOf(c1) }, { name: "C2.srt", content: H.srtOf(c2) }, { name: "C3.srt", content: H.srtOf(c3) }])), "sent");
				const im = await H.waitFor(panel, "(() => { const m = " + H.PAGE_IMPORT_MODAL + "; return m && m.open && m.rows.length === 3 ? m : null; })()", { what: "가져오기 창 (3개)" });
				assert.deepEqual(im.rows.map((r) => r.key).sort(), ["C1", "C2", "C3"]);
				assert.equal(await panel(pageImportSetup({ C1: { name: NAMES.C1, presetId: P.id }, C2: { name: NAMES.C2, presetId: P.id }, C3: { name: NAMES.C3, presetId: P.id } })), 3);
				await panel(click("impOk"));
				// 줄은 나눠 그린다 → 행 수와 줄 속성을 기다린다
				await H.waitFor(panel, "document.querySelectorAll('#listWrap .sub-row').length === " + 3 * N, { timeoutMs: 60000, what: 3 * N + "줄" });
				await H.waitFor(panel, "(() => { const s = " + SNAP + "; return s.subtitles.every((x) => (s.rowStates[x.id]._allParams || []).length > 0); })()", { timeoutMs: 120000, what: "줄 속성" });
				let snap = await panel(SNAP);
				assert.deepEqual(snap.mi.castOrder, ["C1", "C2", "C3"]);
				assert.deepEqual(snap.mi.castOrder.map((K) => snap.mi.cast[K].name), [NAMES.C1, NAMES.C2, NAMES.C3]);
				log("(A) " + 3 * N + "줄, salt " + snap.mi.salt + ", 트랙 " + n + "개 (남의 클립 V4~V" + n + ")");

				// 여기서부터 (B) 되돌리기까지 evalScript를 모두 잰다 (버퍼 하나. 구간은 버퍼 길이로 나눈다)
				await panel(PAGE_TIME_HOST_CALLS);
				const marks = [["(A) 적용", 0]];
				const mark = async (label) => marks.push([label, await panel(PAGE_TIMES_LEN)]);
				const ra = await applyButton(async (pf) => {
					assert.equal(pf.lines[0], "배치 " + 3 * N + "줄: C1 " + NAMES.C1 + " V3 " + N + " · C2 " + NAMES.C2 + " V" + (t2 + 1) + " " + N + " · C3 " + NAMES.C3 + " V" + (t3 + 1) + " " + N, JSON.stringify(pf.lines));
					assert.ok(pf.lines.indexOf("새 비디오 트랙 " + made.length + "개 (" + made.join(", ") + ")") !== -1, JSON.stringify(pf.lines));
					log("(A) 점검 창: " + pf.lines.join(" | "));
				});
				assert.ok(ra.pf, "새 트랙이 있어 점검 창이 떴다");
				assert.match(ra.status.text, new RegExp("^화자별 배치: 놓음 " + 3 * N + " · 새 트랙 " + made.length + "$"), ra.status.text);
				const LA = await checkRows("(A)");
				assert.deepEqual([LA.tracksOf.C1, LA.tracksOf.C2, LA.tracksOf.C3], [[2], [t2], [t3]], "화자마다 자기 트랙: " + JSON.stringify(LA.tracksOf));
				[2, t2, t3].forEach((t) => assert.equal(clipsOn(LA.scan, t).length, N, "V" + (t + 1) + " 클립 " + N + "개"));
				for (let i = 3; i < n; i++) assert.equal(clipsOn(LA.scan, i).length, 1, "V" + (i + 1) + " 남의 클립 그대로");
				const prog = ra.progress.filter((x) => /전체 \d+\/\d+$/.test(x) && x.slice(-(String(3 * N).length + 1)) === "/" + 3 * N);
				assert.ok(prog.length >= 2, "진행률 문구 ('… 전체 n/" + 3 * N + "'): " + JSON.stringify(ra.progress));
				log("(A) " + ra.status.text + " — C1 V3 · C2 V" + (t2 + 1) + " · C3 V" + (t3 + 1) + ", 클립마다 자막 ±1프레임, 겹침 없음");

				// ═══ (C) 성능 ═══
				await mark("다시 적용");
				const tRe = Date.now();
				const re = await panel(H.pageCmd("apply", {}));
				const reMs = Date.now() - tRe;
				assert.equal(re.ok, true, JSON.stringify(re).slice(0, 300));
				assert.deepEqual([re.data.ops, re.data.none], [0, 3 * N], JSON.stringify(re.data));
				assert.ok(reMs < 5000, "다시 적용(변경 없음 " + 3 * N + "줄) " + reMs + "ms (5초 안)");
				await mark("다시 계획·스캔");
				const tPl = Date.now();
				const pl = await panel(H.pageCmd("plan", {}));
				const plMs = Date.now() - tPl;
				assert.equal(pl.ok, true, JSON.stringify(pl).slice(0, 300));
				assert.deepEqual([pl.data.plan.none, Object.keys(pl.data.plan.ops).length], [3 * N, 0]);
				const p0 = await ping();
				const sc = await mi("getTracks", { seqId: p0.seqId, build: p0.build, tracks: null });
				await mark("검수");
				const tVf = Date.now();
				await panel(click("btnVerify"));
				const vf = await H.waitFor(panel, PAGE_VF, { timeoutMs: LONG, stepMs: 300, what: "검수 창" });
				const vfMs = Date.now() - tVf;
				assert.equal(vf.summary, "정상 " + 3 * N + " · 타임라인에 없음 0 · 옮겨짐 0 · 같은 태그 중복 0 · 옛 세대 0 · Premiere에서 고침 0 · 옛 버전 템플릿 0 · 효과·키프레임 0 · 미적용 0 · 목록에 없는 클립 0", JSON.stringify(vf.items));
				await panel(click("vfClose"));
				log("(C) 성능 3화자 × " + N + "줄: 적용 " + ra.ms + "ms (spec 목표 ≤ ~100초, 진행률 문구 " + prog.length + "개: " + prog[0] + " … " + prog[prog.length - 1] + ")" +
					" · 다시 적용 " + reMs + "ms (보낸 작업 0) · 다시 계획 " + plMs + "ms · 스캔 " + sc.ms + "ms · 검수 " + vfMs + "ms (" + vf.summary.split(" · ")[0] + ")");

				// ═══ (B) 나누기·합치기 다시 가져오기 → ▶ 한 번 → 되돌리기 ═══
				const salt = LA.salt;
				const c1Rows = LA.rows.filter((x) => x.spk === "C1");
				const idSplit = c1Rows[SPLIT].id;
				const idNext = c1Rows[SPLIT + 1].id;
				const idJoin = c1Rows[JOIN].id;
				const idGone = c1Rows[JOIN + 1].id;
				assert.equal(c1Rows[SPLIT].text, TXT_SPLIT);
				const before = { c1: await capsOf(2), c2: clipsOn(LA.scan, t2), c3: clipsOn(LA.scan, t3) };
				assert.equal(before.c1.length, N);
				const nodeOf0 = (id) => LA.idx.current[salt + "-" + id].nodeId;
				const n0 = { split: nodeOf0(idSplit), next: nodeOf0(idNext), join: nodeOf0(idJoin) };
				const c1b = splitJoin(c1);
				assert.equal(await panel(H.pageDropSrt("C1.srt", H.srtOf(c1b))), "sent");
				const mb = await H.waitFor(panel, "(() => { const m = " + H.PAGE_IMPORT_MODAL + "; return m && m.open && m.rows.length === 1 && m.stats.length ? m : null; })()", { what: "가져오기 창 (C1 병합)" });
				assert.deepEqual([mb.rows[0].key, mb.rows[0].action], ["C1", "merge"], JSON.stringify(mb.rows));
				assert.equal(mb.stats[0], "같음 37 · 나눔·합침 확인 2 · 새 줄 1 · 빠짐 1", JSON.stringify(mb));
				log("(B) 가져오기 창: " + mb.stats[0]);
				await panel(click("impOk"));
				await H.waitFor(panel, "(() => { const s = " + SNAP + "; const x = s.subtitles.find((r) => r.text === " + JSON.stringify(TXT_P2) + ");" +
					" return !!x && !!document.getElementById('row-' + x.id) && s.subtitles.every((r) => (s.rowStates[r.id]._allParams || []).length > 0); })()", { timeoutMs: 60000, what: "병합한 줄 (새 줄 행·속성)" });
				snap = await panel(SNAP);
				const idNew = snap.subtitles.find((x) => x.text === TXT_P2).id;
				assert.equal(snap.subtitles.filter((x) => x.spk === "C1").length, N, "C1 40 - 1 + 1");
				assert.deepEqual([snap.rowStates[idSplit].mm, snap.rowStates[idJoin].mm, snap.rowStates[idNew].mm], ["check", "check", "new"]);
				assert.deepEqual([snap.subtitles.find((x) => x.id === idSplit).text, snap.subtitles.find((x) => x.id === idJoin).text], [TXT_P1, TXT_JOIN]);
				assert.equal((snap.trashBin.find((t) => t.sub.id === idGone) || {}).why, "merge", "빠진 줄은 휴지통 (병합)");

				await mark("(B) 적용");
				await panel(PAGE_RECORD_CHUNKS);
				let rb;
				let items;
				try {
					rb = await applyButton(async (pf) => {
						assert.deepEqual([pf.orphans.shown, pf.orphans.checked], [true, true], "목록에서 빠진 줄의 클립 지우기 (미리 체크): " + JSON.stringify(pf));
						assert.equal(pf.orphans.text, "목록에서 빠진 줄의 클립 1개 지우기 (병합·교체로 빠졌고 Premiere에서 고치지 않은 것)");
						assert.equal(pf.lines[0], "배치 " + 3 * N + "줄: C1 " + NAMES.C1 + " V3 3 · C2 " + NAMES.C2 + " V" + (t2 + 1) + " 0 · C3 " + NAMES.C3 + " V" + (t3 + 1) + " 0 (변경 없음 " + (3 * N - 3) + "줄은 보내지 않음)", JSON.stringify(pf.lines));
					});
					items = await panel("window.__s34items.slice()");
				} finally {
					await panel(PAGE_UNRECORD_CHUNKS);
				}
				assert.ok(rb.pf, "빠진 줄 클립이 있어 점검 창이 떴다");
				assert.doesNotMatch(rb.status.text, /충돌|실패|건너뜀|일부 속성/, rb.status.text);
				assert.match(rb.status.text, /갱신 2/, rb.status.text);
				assert.match(rb.status.text, /지움 1/, rb.status.text);
				const la = await lastApply();
				assert.equal(la.complete, true);
				assert.deepEqual([la.updated.length, la.removed.length], [2, 1], "last_apply 갱신 2 · 지움 1");
				assert.ok(la.created.length >= 1, "뒤 조각 놓음");
				// 단계 순서: 앞 조각 줄이기(2) → 뒤 조각 놓기(4, 템플릿 길이가 덮는 이웃을 guard로) → 합친 줄 늘리기(5)
				const pos = (id) => items.findIndex((x) => x.key === salt + "-" + id);
				assert.ok(pos(idSplit) !== -1 && pos(idNew) !== -1 && pos(idJoin) !== -1, JSON.stringify(items));
				assert.ok(pos(idSplit) < pos(idNew) && pos(idNew) < pos(idJoin), "단계 순서: " + items.map((x) => x.key + ":" + x.op).join(", "));
				assert.deepEqual([items[pos(idSplit)].op, items[pos(idNew)].op, items[pos(idJoin)].op], ["update", "place", "update"]);
				assert.ok(items[pos(idNew)].guard.indexOf(String(n0.next)) !== -1, "뒤 조각이 덮는 이웃(12번째 줄)을 guard로: " + JSON.stringify(items[pos(idNew)]));
				const LB = await checkRows("(B)");
				assert.deepEqual([LB.tracksOf.C1, LB.tracksOf.C2, LB.tracksOf.C3], [[2], [t2], [t3]]);
				const after = await capsOf(2);
				assert.equal(after.length, N, "C1 트랙 클립 " + N + "개 (남은 클립 없음)");
				const at = (id) => after.find((x) => x[0] === salt + "-" + id);
				assert.equal(at(idGone), undefined, "빠진 줄의 클립은 지웠다");
				assert.deepEqual([at(idSplit)[3], at(idNew)[3], at(idJoin)[3]], [TXT_P1, TXT_P2, TXT_JOIN], "캡션");
				const cur = (id) => LB.idx.current[salt + "-" + id];
				assert.equal(cur(idSplit).nodeId, n0.split, "앞 조각은 같은 클립 (끝만 줄임)");
				assert.equal(cur(idJoin).nodeId, n0.join, "합친 줄은 같은 클립 (끝만 늘림)");
				assert.deepEqual([clipsOn(LB.scan, t2), clipsOn(LB.scan, t3)], [before.c2, before.c3], "C2·C3 트랙은 그대로 (이름·자리·nodeId)");
				for (let i = 3; i < n; i++) assert.equal(clipsOn(LB.scan, i).length, 1, "V" + (i + 1) + " 남의 클립 그대로");
				const pl2 = await panel(H.pageCmd("plan", {}));
				assert.deepEqual([pl2.data.plan.none, Object.keys(pl2.data.plan.ops).length], [3 * N, 0], "한 번에 끝났다: 다시 계획하면 0개");
				log("(B) ▶ 한 번: " + rb.status.text + " (" + rb.ms + "ms) — 보낸 작업 " + items.map((x) => x.op).join("·") +
					", 이웃 머리 " + (cur(idNext).nodeId === n0.next ? "되돌림 (같은 nodeId)" : "덮여 다시 놓음 (nodeId " + n0.next + " → " + cur(idNext).nodeId + ")") + ", 다시 계획 0개");

				// 되돌리기 (히스토리) → C1 트랙이 (B) 전과 같다
				await mark("되돌리기");
				await panel(H.PAGE_CLEAR_STATUS);
				await panel(click("btnHistory"));
				const label = await H.waitFor(panel, PAGE_UNDO_ITEM, { what: "마지막 적용 항목" });
				assert.match(label, /^↶ 마지막 적용 되돌리기 \(.+ · \d+줄\)$/, label);
				await panel(click("btnUndoApply"));
				const cf = await H.waitConfirm(panel);
				assert.equal(cf.yes, "되돌리기", cf.msg);
				await panel(click("confirmYes"));
				const us = await H.waitStatus(panel, /마지막 적용 되돌리기: /, { timeoutMs: LONG });
				await H.waitFor(panel, "!window._mogrtDebug.miBusy()", { timeoutMs: LONG, what: "되돌리기 끝" });
				const ust = await panel(H.PAGE_STATUS);
				assert.doesNotMatch(ust.text, /실패|되살리지 못함|그 뒤로 바뀜/, ust.text);
				const back = await capsOf(2);
				assert.deepEqual(back, before.c1, "C1 트랙이 적용 전과 같다 (uid·시작·끝·캡션)");
				const scanU = await scanAll();
				assert.deepEqual([clipsOn(scanU, t2), clipsOn(scanU, t3)], [before.c2, before.c3], "C2·C3 트랙 그대로");
				const idxU = CORE.scanIndex(scanU, salt);
				assert.deepEqual([idxU.stale.length, Object.keys(idxU.dup).length], [0, 0]);
				snap = await panel(SNAP);
				assert.deepEqual([snap.rowStates[idSplit].mm, snap.rowStates[idJoin].mm], ["undone", "undone"], "되돌린 줄");
				assert.equal(snap.subtitles.find((x) => x.id === idSplit).text, TXT_P1, "자막 목록은 그대로");
				log("(B) 되돌리기: " + (ust.text || us.text) + " — C1 " + N + "개 (uid·시작·끝·캡션) 적용 전과 같음, C2·C3 그대로");

				// (C) 가장 긴 evalScript: (A) 적용 ~ 되돌리기의 MI 호출 전부 (패널이 부른 것 + 케이스의 mi() 스캔·핑). 케이스 자신의 JSX('?')와
				// v27 함수(폴러 등, S2-4부터 적용·검수 중에는 쉰다)는 뺀다. spec: evalScript 한 번 > 8초 없음
				const times = await panel("window.__s34times.slice()");
				const calls = times.map((c, i) => [c[0], c[1], i]).filter((c) => /^MID?_/.test(c[0]));
				assert.ok(calls.length > 0, "잰 MI 호출이 있다");
				const phaseOf = (i) => marks.filter((m) => m[1] <= i).pop()[0];
				const top = calls.slice().sort((a, b) => b[1] - a[1]).slice(0, 3).map((c) => c[0] + " " + c[1] + "ms (" + phaseOf(c[2]) + ")");
				const perPhase = marks.map(([label, from], k) => {
					const to = k + 1 < marks.length ? marks[k + 1][1] : times.length;
					const cs = calls.filter((c) => c[2] >= from && c[2] < to);
					return label + " " + cs.length + "번 최대 " + cs.reduce((a, c) => Math.max(a, c[1]), 0) + "ms";
				});
				log("(C) evalScript (MI) " + calls.length + "번: " + perPhase.join(" · ") + " — 가장 긴 것 " + top.join(", "));
				assert.ok(calls.every((c) => c[1] <= EVAL_MAX_MS), "evalScript 한 번이 " + EVAL_MAX_MS + "ms를 넘었다 (spec S3-4): " + top.join(", "));
			});
		} finally {
			// 파일을 먼저 되돌린다: 패널 호출(CDP)이 실패해도 DEV 캐시의 프로젝트 파일은 제자리로 (s3_1·s3_3과 같은 순서)
			try {
				if (defBefore) fs.writeFileSync(defPath, defBefore);
				else if (fs.existsSync(defPath)) fs.unlinkSync(defPath);
				log("cast_defaults.json 되돌림: " + (defBefore ? "시작 전 내용" : "지움 (시작 전에는 없었다)"));
			} catch (e) {
				log("경고: cast_defaults.json을 되돌리지 못했다 — " + e.message);
			}
			// 페이지 훅·플래그는 하나씩 (하나가 실패해도 나머지는 푼다)
			for (const [what, expr] of [["evalScript 재기", PAGE_UNTIME_HOST_CALLS], ["placeChunk 기록", PAGE_UNRECORD_CHUNKS], ["다화자 기본값", H.pageSetMiCast(null)]]) {
				try {
					await panel(expr);
				} catch (e) {
					log("경고: " + what + " 되돌리기 실패 — " + e.message);
				}
			}
		}
	}
};
