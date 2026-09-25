"use strict";
/**
 * S3-3 하드: 타임라인 검수(읽기만)와 화자 표 ⟳·바뀜 알림 (DEV 패널 + DEV 호스트 MID_, MI_test.prproj의 T_ 시퀀스 스크래치 사본).
 * 스크래치 사본의 V2 이상을 먼저 비운다. 합성 SRT는 저장소 밖 임시 폴더(os.tmpdir())에 쓰고 끝나면 지운다.
 * 프로젝트 단위 cast_defaults.json(DEV 캐시)은 끝나면 시작 전 내용으로 되돌린다.
 *   C1·C2 SRT를 경로로 가져와({path}, 화자 표에 경로가 남는다) 캡션 필드가 있는 AE 프리셋으로 적용한다 (C1 4줄, C2 4줄)
 *   (1) JSX로 C1 첫 클립 지우기 · C1 둘째 끝 0.5초 자르기 · C1 셋째 자르기(QE razor) · C2 첫 클립 캡션 고치기 · C2 둘째 Motion Position 키 두 개
 *       → #btnVerify → #verifyModal에 정확히 그 다섯 줄(타임라인에 없음·옮겨짐·같은 태그 중복·Premiere에서 고침·효과·키프레임), 정상 3,
 *       검수 중 호스트 호출은 MID_ping·MID_getTracks·MID_readClipTexts뿐 (쓰기 없음). 줄을 누르면 재생 헤드가 그 클립 시작으로 간다
 *   (2) C1 SRT 파일의 수정 시각을 바꾸면 5초 안에 #castToast '…(C1) 파일이 바뀌었습니다', 스스로 병합하지 않는다
 *   (3) 화자 표 C1의 ⟳ → 'SRT 가져오기' 창이 C1 병합으로 열린다 (취소)
 * 실행: npm run hard -- s3_3
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const H = require("../lib/hard");
const { loadRegions } = require("../../lib/loadRegions");

const CORE = loadRegions(["src/mi/core.ts"]);
const SNAP = "window._mogrtDebug.snapshot()";
const SCR = H.SCRATCH_PREFIX;
const DOT = String.fromCharCode(0xb7);
const LONG = 180000;
const JSX_NUM_TRACKS = "(function(){var s=app.project.activeSequence;return String(s.videoTracks.numTracks);})()";
const PAGE_VF = "(() => { const m = document.getElementById('verifyModal'); if (!m || !m.classList.contains('open')) return null;" +
	" return { summary: document.getElementById('vfSummary').textContent, items: Array.from(document.querySelectorAll('#vfList .vf-item')).map((e) => [e.dataset.cat, e.querySelector('.vf-label').textContent, e.querySelector('.vf-detail').textContent]) }; })()";
const PAGE_TOAST = "(() => { const t = document.getElementById('castToast'); return t && t.style.display !== 'none' ? document.getElementById('castToastText').textContent : null; })()";

// ── 호스트 JSX (ES3, 스크래치만) ──
const pre = (ti, nodeId) => "(function(){var seq=app.project.activeSequence;if(String(seq.name).indexOf('" + SCR + "')!==0)return 'not-scratch';" +
	"var ft=Number(seq.getSettings().videoFrameRate.ticks);var c=MID__nodeMap(seq.videoTracks[" + Number(ti) + "])['n'+" + JSON.stringify(String(nodeId)) + "];if(!c)return 'no-clip';";
const jsxRemove = (ti, nodeId) => pre(ti, nodeId) + "return String(c.remove(false,false));})()";
const jsxTrimEnd = (ti, nodeId, frames) => pre(ti, nodeId) + "c.end=MID__T(Number(c.end.ticks)-" + Number(frames) + "*ft);return 'ok';})()";
function jsxRazor(ti, frame) {
	return "(function(){var seq=app.project.activeSequence;if(String(seq.name).indexOf('" + SCR + "')!==0)return 'not-scratch';" +
		"app.enableQE();var ft=Number(seq.getSettings().videoFrameRate.ticks);var t=MID__at(" + Number(frame) + ",ft);" +
		"var tc=t.getFormatted(seq.getSettings().videoFrameRate,seq.getSettings().videoDisplayFormat);" +
		"qe.project.getActiveSequence().getVideoTrackAt(" + Number(ti) + ").razor(tc);return 'ok';})()";
}
const jsxEditText = (ti, nodeId, displayName, text) => pre(ti, nodeId) +
	"var mg=c.getMGTComponent();for(var j=0;j<mg.properties.numItems;j++){var p=mg.properties[j];if(String(p.displayName)!==" + JSON.stringify(displayName) + ")continue;" +
	"var v=JSON.parse(String(p.getValue()));v.textEditValue=" + JSON.stringify(text) + ";if(v.fontTextRunLength)v.fontTextRunLength=[" + JSON.stringify(text) + ".length];p.setValue(JSON.stringify(v),true);return 'ok';}return 'no-prop';})()";
const jsxKeyMotion = (ti, nodeId) => pre(ti, nodeId) +
	"var mot=null;for(var ci=0;ci<c.components.numItems;ci++){if(String(c.components[ci].matchName)==='AE.ADBE Motion')mot=c.components[ci];}if(!mot)return 'no-motion';" +
	"var pos=mot.properties[0];var inT=Number(c.inPoint.ticks);pos.setTimeVarying(true);var k1=MID__T(inT+6*ft);var k2=MID__T(inT+30*ft);" +
	"pos.addKey(k1);pos.setValueAtKey(k1,[0.45,0.5],true);pos.addKey(k2);pos.setValueAtKey(k2,[0.55,0.5],true);return String(pos.isTimeVarying());})()";

module.exports = {
	name: "S3-3 타임라인 검수(읽기만)·⟳ 다시 가져오기·바뀜 알림",
	run: async (api) => {
		const { panel, host, mi, assert, log } = api;
		await H.waitKeys(panel);
		assert.equal(await panel(H.pageSetMiCast(null)), true, "다화자 기본값은 켬");
		const root = await H.devCacheRoot(panel);
		const snap0 = await panel(SNAP);
		const defPath = path.join(root.replace(/\//g, path.sep), snap0.keys.proj, "cast_defaults.json");
		const defBefore = fs.existsSync(defPath) ? fs.readFileSync(defPath) : null;
		const ok = await panel("await window._mogrtDebug.miHostOk()");
		assert.equal(ok.ok, true, "v28 호스트·같은 빌드: " + JSON.stringify(ok));
		const pick = (list) => list.filter((p) => !p.native && p.captionFid).sort((a, b) => b.fields.length - a.fields.length)[0] || null;
		let P = pick((await panel(H.pageCmd("presets", {}))).data);
		if (!P) {
			await H.ensurePreset(api);
			P = pick((await panel(H.pageCmd("presets", {}))).data);
		}
		assert.ok(P, "캡션 필드가 있는 AE 프리셋이 필요하다");
		const capF = P.fields.find((f) => f.caption);
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mi_s3_3_"));
		const f1 = path.join(tmp, "C1.srt");
		const f2 = path.join(tmp, "C2.srt");
		const c1 = [];
		const c2 = [];
		for (let k = 0; k < 4; k++) {
			c1.push([1 + k * 6, 2.5 + k * 6, "S33 철수 " + (k + 1) + "번째 말"]);
			c2.push([4 + k * 6, 5.5 + k * 6, "S33 영희 " + (k + 1) + "번째 말"]);
		}
		fs.writeFileSync(f1, H.srtOf(c1), "utf8");
		fs.writeFileSync(f2, H.srtOf(c2), "utf8");
		try {
			await H.withScratchSequence(api, "s3_3", async () => {
				const n = Number(await host(JSX_NUM_TRACKS));
				for (let i = 1; i < n; i++) assert.match(String(await host(H.jsxClearVideoTrack(i))), /^0$/, "V" + (i + 1) + " 비우기");
				let r = await panel(H.pageCmd("mergeCommit", { files: [{ path: f1, presetId: P.id }, { path: f2, presetId: P.id }] }));
				assert.equal(r.ok, true, JSON.stringify(r));
				await H.waitFor(panel, "document.querySelectorAll('#listWrap .sub-row').length === 8", { what: "8줄" });
				await H.waitFor(panel, "(() => { const s = " + SNAP + "; return s.subtitles.every((x) => (s.rowStates[x.id]._allParams || []).length > 0); })()", { timeoutMs: 60000, what: "줄 속성" });
				let snap = await panel(SNAP);
				assert.equal(snap.mi.cast.C1.path, f1.replace(/\\/g, "/"), "화자 표에 경로");
				r = await panel(H.pageCmd("apply", {}));
				assert.equal(r.ok, true, JSON.stringify(r));
				assert.equal(r.data.created, 8, JSON.stringify(r.data));
				snap = await panel(SNAP);
				const salt = snap.mi.salt;
				const ping = await mi("ping");
				const scan = await mi("getTracks", { seqId: ping.seqId, build: ping.build, tracks: null });
				const idx = CORE.scanIndex(scan, salt);
				const rowsOf = (K) => snap.subtitles.filter((s) => s.spk === K);
				const clipOf = (s) => idx.current[salt + "-" + s.id];
				const [a1, a2, a3] = rowsOf("C1");
				const [b1, b2] = rowsOf("C2");
				const labelOf = (s) => s.spk + DOT + s.index;
				// (1) 다섯 가지 손질
				assert.equal(await host(jsxRemove(clipOf(a1).track, clipOf(a1).nodeId)), "true");
				assert.equal(await host(jsxTrimEnd(clipOf(a2).track, clipOf(a2).nodeId, 12)), "ok");
				const k3 = clipOf(a3);
				assert.equal(await host(jsxRazor(k3.track, Math.round((k3.sf + k3.ef) / 2))), "ok");
				assert.equal(await host(jsxEditText(clipOf(b1).track, clipOf(b1).nodeId, capF.label, "S33 Premiere에서 고침")), "ok");
				assert.equal(await host(jsxKeyMotion(clipOf(b2).track, clipOf(b2).nodeId)), "true");
				log("(1) 손질: 지움 " + labelOf(a1) + " · 끝 자름 " + labelOf(a2) + " · 자르기 " + labelOf(a3) + " · 캡션 고침 " + labelOf(b1) + " · Motion 키 " + labelOf(b2));
				await panel(H.PAGE_RECORD_HOST_CALLS);
				await panel("document.getElementById('btnVerify').click(), true");
				const v = await H.waitFor(panel, PAGE_VF, { timeoutMs: LONG, stepMs: 400, what: "검수 창" });
				const calls = await panel("window.__hostCalls.slice()");
				const miCalls = calls.filter((x) => /^MID?_/.test(x));
				assert.deepEqual([...new Set(miCalls)].sort(), ["MID_getTracks", "MID_ping", "MID_readClipTexts"], "검수는 읽기만: " + calls.join(","));
				assert.equal(calls.filter((x) => /^(applyToTimeline|updateClipAtTime|removeNativeClipsAt|syncAllClipsFromTimeline)$/.test(x)).length, 0);
				assert.deepEqual(v.items.map((x) => [x[0], x[1]]), [["missing", labelOf(a1)], ["moved", labelOf(a2)], ["dup", labelOf(a3)], ["edited", labelOf(b1)], ["decorated", labelOf(b2)]], JSON.stringify(v.items));
				assert.equal(v.summary, "정상 3 · 타임라인에 없음 1 · 옮겨짐 1 · 같은 태그 중복 1 · 옛 세대 0 · Premiere에서 고침 1 · 옛 버전 템플릿 0 · 효과·키프레임 1 · 미적용 0 · 목록에 없는 클립 0");
				log("(1) " + v.summary);
				v.items.forEach((x) => log("    " + x[0] + " " + x[1] + " — " + x[2]));
				// 줄을 누르면 재생 헤드 (옮긴 클립 = 그 클립 시작)
				await panel("document.querySelectorAll('#vfList .vf-item')[1].click(), true");
				await H.waitStatus(panel, /^검수: .+초로 이동$/);
				const pos = await host("(function(){return String(app.project.activeSequence.getPlayerPosition().ticks);})()");
				assert.ok(Math.abs(Math.round(Number(pos) / Number(scan.frameTicks)) - clipOf(a2).sf) <= 1, "재생 헤드가 그 클립 시작 (±1f, 스크립트 시간은 0 기준): " + pos);
				await panel("document.getElementById('vfClose').click(), true");
				// 검수는 바꾸지 않았다: 다시 스캔하면 손질한 그대로
				const scan2 = await mi("getTracks", { seqId: ping.seqId, build: ping.build, tracks: null });
				const idx2 = CORE.scanIndex(scan2, salt);
				assert.equal(Object.keys(idx2.current).length, 6, "현재 클립 6개 (지운 것 1, 자른 것 1은 dup)");

				// (2) 바뀜 알림
				assert.equal(await panel(PAGE_TOAST), null);
				const st = fs.statSync(f1);
				fs.utimesSync(f1, st.atime, new Date(st.mtimeMs + 120000));
				const t0 = Date.now();
				const toast = await H.waitFor(panel, PAGE_TOAST, { timeoutMs: 5000, stepMs: 200, what: "#castToast (5초 안)" });
				assert.match(toast, /\(C1\) 파일이 바뀌었습니다$/);
				log("(2) 알림 " + (Date.now() - t0) + "ms: " + toast);
				const s0 = JSON.stringify((await panel(SNAP)).subtitles);
				await H.sleep(3500);
				assert.equal(JSON.stringify((await panel(SNAP)).subtitles), s0, "스스로 병합하지 않는다");
				await panel("document.getElementById('castToastClose').click(), true");

				// (3) ⟳ → 병합 창
				await panel("document.querySelector('#castRows .cast-row[data-key=C1] .cast-reimport').click(), true");
				const m = await H.waitFor(panel, "(() => { const m = " + H.PAGE_IMPORT_MODAL + "; return m && m.open ? m : null; })()", { what: "가져오기 창" });
				assert.deepEqual(m.rows.map((x) => [x.key, x.action]), [["C1", "merge"]], JSON.stringify(m));
				log("(3) ⟳ → 가져오기 창 " + JSON.stringify(m.rows) + " " + (m.stats[0] || ""));
				await panel("document.getElementById('impCancel').click(), true");
			});
		} finally {
			try {
				if (defBefore) fs.writeFileSync(defPath, defBefore);
				else if (fs.existsSync(defPath)) fs.unlinkSync(defPath);
			} catch (e) {
				log("cast_defaults 되돌리기 경고: " + e.message);
			}
			try {
				fs.rmSync(tmp, { recursive: true, force: true });
			} catch (_) {}
			await panel(H.pageSetMiCast(null));
		}
	}
};
