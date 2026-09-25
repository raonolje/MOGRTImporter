"use strict";
/**
 * S1-11 하드: 네이티브 MOGRT 굽기 (DEV 패널, MI_test.prproj의 T_ 시퀀스, 스크래치 사본 T_scratch_s1_11의 V3).
 * 프리셋: Premiere 기본 설치 네이티브 템플릿 'Lower Thirds/Classic Lower Third Two Lines.mogrt' (없으면 모달로 만든다.
 * 네이티브 프리셋은 T1이 캡션, T2가 후반 작업 필드). 플래그는 끈다 (운영과 같은 v27 한 트랙 경로).
 *   (1) 한글 캡션 3줄(2초, 10초, 12.5초) ▶ → V3에 네이티브 그래픽 클립 3개(MGT 컴포넌트 없음·Text 컴포넌트 2개), 줄마다 ap.nk,
 *       DEV 캐시 baked/<nk>.mogrt (definition capsuleName " [MI]", TextLayer·Source Text에 캡션).
 *       각 클립 가운데 프레임을 %TEMP%\mi_s1_11_*.png로 내보내 경로를 찍는다 → 메인 세션이 눈으로 확인한다
 *       (캡션이 보여야 한다. v27은 이 자리에 빈 글자를 그렸다)
 *   (2) 그대로 다시 ▶ → removeNativeClipsAt 없음, 클립 nodeId 그대로 (v27이 끝만 맞춘다), 프로젝트 항목 수 그대로
 *   (3) 첫째 클립을 타임라인에서 지우고 ▶ → 같은 구운 사본을 다시 importMGT: 프로젝트 항목 수 그대로(같은 capsuleID →
 *       Premiere가 이미 가져온 항목을 다시 쓴다), 프레임에 캡션 (재사용한 항목이 기본 문구가 아니라 구운 문구)
 *   (4) 둘째 줄 캡션(T1)만 고치고 ▶ → 둘째 교체(새 nodeId) + 둘째의 새 클립(약 5초) 창 안에 있는 셋째도 연쇄로 다시 놓아
 *       셋째의 시작·끝이 자막 그대로 (머리 잘림 없음), 첫째 그대로, 프레임에 새 캡션·셋째 캡션
 *   (5) 첫째 줄 T2(후반 작업)를 쓰고 ↑ → 첫째 클립만 교체, updateClipAtTime 없음, 프레임에 캡션 + T2 두 줄
 * 시간은 스크래치 시퀀스 프레임에 맞춘다 (v27 재적용 키 Math.round(시작×100)가 프레임 스냅과 어긋나지 않게).
 * 실행: npm run hard -- s1_11     (PNG 경로는 로그의 'PNG' 줄)
 */
const fs = require("node:fs");
const path = require("node:path");
const H = require("../lib/hard");
const N = require("../../fixtures/mogrt/make_native_mogrt");

const TRACK = 2; // V3
const TPS = 254016000000;
const SNAP = "window._mogrtDebug.snapshot()";
const NATIVE_REL = "Lower Thirds/Classic Lower Third Two Lines.mogrt";
const click = (id) => "document.getElementById(" + JSON.stringify(id) + ").click(), true";
const norm = (p) => String(p || "").replace(/\\/g, "/");

/** 활성 스크래치 사본의 트랙 idx 클립 [{s, e (초), nodeId, name, native, textComps}] (JSON) */
function jsxClips(idx) {
	return "(function(){var seq=app.project.activeSequence;if(String(seq.name).indexOf('" + H.SCRATCH_PREFIX + "')!==0)return JSON.stringify({error:'not-scratch'});" +
		"var t=seq.videoTracks[" + Number(idx) + "];var out=[];for(var k=0;k<t.clips.numItems;k++){var c=t.clips[k];" +
		"var mg=null;try{mg=c.getMGTComponent();}catch(e){}var txt=0;try{for(var ci=0;ci<c.components.numItems;ci++){if(String(c.components[ci].matchName).indexOf('Text')!==-1)txt++;}}catch(e){}" +
		"out.push({s:c.start.seconds,e:c.end.seconds,nodeId:String(c.nodeId),name:String(c.name),isNative:(!mg&&txt>0),textComps:txt});}" +
		"return JSON.stringify(out);})()";
}
/** 프로젝트 항목 수와 이름에 '[MI]'가 든 항목 [{name, nodeId, path}] (JSON) */
const JSX_PROJECT_ITEMS = "(function(){var n=0,mi=[];function walk(it,p){var k=0;try{k=it.children.numItems;}catch(e){return;}" +
	"for(var i=0;i<k;i++){var c=it.children[i];n++;var nm=String(c.name);if(nm.indexOf('[MI]')!==-1)mi.push({name:nm,nodeId:String(c.nodeId),path:p+'/'+nm});" +
	"if(c.type===2)walk(c,p+'/'+nm);}}walk(app.project.rootItem,'');return JSON.stringify({total:n,mi:mi});})()";
/** 트랙 idx의 k번째 클립을 지운다 → 'ok' | 까닭 */
function jsxRemoveClip(idx, k) {
	return "(function(){var seq=app.project.activeSequence;if(String(seq.name).indexOf('" + H.SCRATCH_PREFIX + "')!==0)return 'not-scratch';" +
		"var t=seq.videoTracks[" + Number(idx) + "];var c=t.clips[" + Number(k) + "];if(!c)return 'no-clip';c.remove(false,false);return 'ok';})()";
}
/** 스크래치 사본의 sec초 프레임을 %TEMP%\<name>.png로 내보낸다 (역슬래시, 확장자 없이: S0-3 §3 10) → 경로 | 'ERR …' */
function jsxExportFrame(sec, name) {
	return "(function(){var seq=app.project.activeSequence;if(String(seq.name).indexOf('" + H.SCRATCH_PREFIX + "')!==0)return 'not-scratch';" +
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
/** 클립마다 가운데 프레임 PNG를 내보내고 경로를 찍는다 */
async function exportFrames(api, tag, clips, labels) {
	const { host, assert, log } = api;
	for (let i = 0; i < clips.length; i++) {
		const c = clips[i];
		const p = await host(jsxExportFrame((c.s + c.e) / 2, "mi_s1_11_" + tag + "_" + (i + 1)));
		assert.ok(!/^(ERR|not-scratch)/.test(p), "exportFramePNG: " + p);
		const ok = await waitFile(p, 30000);
		log("PNG " + tag + " #" + (i + 1) + " (" + c.s.toFixed(3) + "~" + c.e.toFixed(3) + "s, 기대 문구: " + labels[i] + "): " + p + (ok ? "" : "  ← 파일이 아직 없다"));
		assert.ok(ok, "PNG 파일 " + p);
	}
}
/** 프레임에 맞춘 시작 초: 목표 초 근처에서 SRT(ms)와 스냅된 클립의 v27 키(Math.round(초×100))가 같은 프레임 */
function alignedSec(target, frameSec) {
	const f0 = Math.round(target / frameSec);
	for (let f = f0; f < f0 + 1000; f++) {
		const exact = f * frameSec;
		const ms = Math.round(exact * 1000) / 1000;
		if (Math.round(ms / frameSec) === f && Math.round(ms * 100) === Math.round(exact * 100)) return ms;
	}
	return Math.round(f0 * frameSec * 1000) / 1000;
}
// ▶ (체크 없음) → 결과 상태. 확인창이 뜨면 실패로 본다 (이 목록은 병합 표시·위험한 줄이 없다)
async function applyPlain(api) {
	const { panel, assert } = api;
	await panel(H.PAGE_CLEAR_STATUS);
	await panel(H.PAGE_UNCHECK_ALL);
	await panel(click("btnApply"));
	const st = await H.waitStatus(panel, /배치 완료|놓을 줄이 없습니다|멈췄습니다|실패/, { timeoutMs: 180000 });
	assert.equal(st.cls, "ok", st.text);
	return st;
}
const nodeIds = (clips) => clips.map((c) => c.nodeId);

/** 호스트 JSON 결과: 파싱 실패면 어느 호출이 무엇을 돌려줬는지 보여 준다 */
async function hostJson(host, jsx, what) {
	const raw = await host(jsx);
	try { return JSON.parse(raw); } catch (_) { throw new Error("호스트 결과를 읽지 못함 (" + what + "): " + String(raw).slice(0, 200)); }
}
module.exports = {
	name: "S1-11 네이티브 MOGRT 굽기 (문구가 화면에 보인다, 같은 문구는 같은 항목, 바뀌면 교체)",
	run: async (api) => {
		const { panel, host, assert, log } = api;
		await H.waitKeys(panel);
		assert.equal(await panel(H.pageSetMiCast(false)), false, "운영처럼 플래그를 끈다");
		const mogrts = await H.waitMogrts(panel, 1);
		const hit = mogrts.find((m) => norm(m[0]).slice(-NATIVE_REL.length) === NATIVE_REL);
		assert.ok(hit, "MOGRT 목록에 " + NATIVE_REL + "이 있어야 한다 (Premiere 기본 설치 템플릿)");
		const P = await H.pickPresetForMogrt(api, hit[0]);
		const texts = P.params.filter((p) => p.type === "text");
		assert.ok(texts.length === 2 && texts.every((p) => p.nativeText === true), "네이티브 프리셋 (텍스트 2개): " + JSON.stringify(texts.map((p) => p.displayName)));
		assert.equal(P.textParamIndex, texts[0].index, "T1이 캡션");
		log("프리셋 " + P.id + " " + P.name + " — " + texts.map((p) => p.displayName).join(" / "));
		const cacheRoot = await H.devCacheRoot(panel);

		await H.withScratchSequence(api, "s1_11", async () => {
			assert.equal(await host(H.jsxClearVideoTrack(TRACK)), "0", "V3 비우기");
			assert.equal(await panel(H.pageSelectTrack(TRACK)), String(TRACK));
			const tb = await hostJson(host, H.jsxReadVideoTrack(TRACK), "H.jsxReadVideoTrack(TRACK)");
			const frameSec = Number(tb.timebase) / TPS;
			// 첫째는 떨어져 있고(2초), 둘째(10초)와 셋째(12.5초)는 2.5초 간격: 둘째를 다시 놓으면 새 클립(약 5초)이 셋째 자리를 덮는다
			const starts = [alignedSec(2, frameSec), alignedSec(10, frameSec), alignedSec(12.5, frameSec)];
			const CAP = ["첫째 네이티브 하드 자막", "둘째 네이티브 하드 자막", "셋째 네이티브 하드 자막"];
			const cues = starts.map((st, i) => [st, Math.round((st + 2) * 1000) / 1000, CAP[i]]);
			log("프레임 " + (1 / frameSec).toFixed(3) + "fps, 시작 " + starts.join(" / ") + "초");
			const ids = await H.loadRowsWithPreset(api, "s1_11_native.srt", cues, P.id);
			const items0 = await hostJson(host, JSX_PROJECT_ITEMS, "JSX_PROJECT_ITEMS");
			const intact = (c, i, what) => {
				assert.ok(Math.abs(c.s - cues[i][0]) < frameSec, what + " 시작 " + i + ": " + c.s + " (자막 " + cues[i][0] + ")");
				assert.ok(Math.abs(c.e - cues[i][1]) < frameSec, what + " 끝 " + i + ": " + c.e + " (자막 " + cues[i][1] + ")");
			};

			// ── (1) 첫 ▶ ──
			await panel(H.PAGE_RECORD_HOST_CALLS);
			const st1 = await applyPlain(api);
			let calls = await panel("window.__hostCalls.slice()");
			assert.equal(calls.filter((c) => c === "updateClipAtTime" || c === "applyPreviewParams").length, 0, "Source Text에 쓰는 호출 없음: " + calls.join(","));
			const c1 = await hostJson(host, jsxClips(TRACK), "jsxClips(TRACK)");
			assert.equal(c1.length, 3, "클립 3개");
			c1.forEach((c, i) => {
				assert.equal(c.isNative, true, "네이티브 그래픽 클립 " + i);
				assert.equal(c.textComps, 2, "Text 컴포넌트 2개");
				intact(c, i, "(1)");
			});
			let s = await panel(SNAP);
			const nk = ids.map((id) => s.rowStates[id].ap && s.rowStates[id].ap.nk);
			assert.ok(nk.every((k) => /^[0-9a-f]{32}$/.test(k || "")), "ap.nk: " + JSON.stringify(nk));
			assert.equal(new Set(nk).size, 3);
			nk.forEach((k, i) => {
				const f = path.join(cacheRoot, s.keys.proj, "baked", k + ".mogrt");
				assert.ok(fs.existsSync(f), "구운 사본 " + f);
				const r = N.readNativeMogrt(fs.readFileSync(f));
				assert.match(r.def.capsuleName, / \[MI\]$/);
				assert.deepEqual(r.def.clientControls.filter((c) => c.type === 6).map((c) => c.value.strDB[0].str), [CAP[i], ""]);
				Object.keys(r.graphics).forEach((g) => assert.deepEqual(r.graphics[g].entries.map((e) => e.texts[0]), [CAP[i]], g + " Source Text"));
				log("구운 사본 #" + (i + 1) + ": " + f + " (capsuleID " + r.def.capsuleID + ", prgraphic " + Object.keys(r.graphics).join("·") + ")");
			});
			const items1 = await hostJson(host, JSX_PROJECT_ITEMS, "JSX_PROJECT_ITEMS");
			log("(1) " + st1.text + " — 프로젝트 항목 " + items0.total + " → " + items1.total + ", [MI] 항목 " + items0.mi.length + " → " + items1.mi.length +
				(items1.mi.length ? " (" + items1.mi.slice(-3).map((x) => x.path).join(", ") + ")" : ""));
			await exportFrames(api, "1_first", c1, CAP);

			// ── (2) 그대로 다시 ▶: 지우지 않고 끝만 맞춘다 ──
			await panel(H.PAGE_RECORD_HOST_CALLS);
			await applyPlain(api);
			calls = await panel("window.__hostCalls.slice()");
			assert.equal(calls.filter((c) => c === "removeNativeClipsAt").length, 0, "지우지 않는다: " + calls.join(","));
			const c2 = await hostJson(host, jsxClips(TRACK), "jsxClips(TRACK)");
			assert.deepEqual(nodeIds(c2), nodeIds(c1), "클립 그대로 (nodeId)");
			const items2 = await hostJson(host, JSX_PROJECT_ITEMS, "JSX_PROJECT_ITEMS");
			assert.equal(items2.total, items1.total, "프로젝트 항목 수 그대로");
			log("(2) 같은 문구 다시 ▶: 클립·항목 그대로");

			// ── (3) 첫째 클립을 지우고 ▶: 같은 사본(같은 capsuleID) → 이미 가져온 항목을 다시 쓴다 ──
			assert.equal(await host(jsxRemoveClip(TRACK, 0)), "ok");
			await applyPlain(api);
			const c3 = await hostJson(host, jsxClips(TRACK), "jsxClips(TRACK)");
			assert.equal(c3.length, 3, "다시 놓았다");
			assert.notEqual(c3[0].nodeId, c1[0].nodeId, "첫째는 새 클립");
			assert.deepEqual(nodeIds(c3).slice(1), nodeIds(c1).slice(1), "둘째·셋째 그대로");
			intact(c3[0], 0, "(3)");
			const items3 = await hostJson(host, JSX_PROJECT_ITEMS, "JSX_PROJECT_ITEMS");
			assert.equal(items3.total, items2.total, "같은 문구를 다시 놓아도 프로젝트 항목이 늘지 않는다 (capsule 재사용)");
			s = await panel(SNAP);
			assert.equal(s.rowStates[ids[0]].ap.nk, nk[0], "같은 사본");
			await exportFrames(api, "3_reused", [c3[0]], [CAP[0]]);
			log("(3) 지운 클립을 같은 사본으로 다시 놓음: 항목 수 " + items3.total + " 그대로");

			// ── (4) 둘째 캡션만 고치고 ▶: 둘째 교체 + 창 안의 셋째도 그대로 다시 놓는다 (머리 잘림 없음) ──
			const CAP2 = "둘째 줄 고친 네이티브 자막";
			assert.equal(await panel(H.pageTypeField(ids[1], "T1", CAP2)), true, "T1 입력");
			await panel(H.PAGE_RECORD_HOST_CALLS);
			await applyPlain(api);
			calls = await panel("window.__hostCalls.slice()");
			assert.equal(calls.filter((c) => c === "removeNativeClipsAt").length, 1, "네이티브 클립 지우기 (트랙 하나에 한 번): " + calls.join(","));
			const c4 = await hostJson(host, jsxClips(TRACK), "jsxClips(TRACK)");
			assert.equal(c4.length, 3);
			assert.equal(c4[0].nodeId, c3[0].nodeId, "첫째 그대로");
			assert.notEqual(c4[1].nodeId, c3[1].nodeId, "둘째 교체");
			assert.notEqual(c4[2].nodeId, c3[2].nodeId, "셋째는 연쇄로 다시 놓았다");
			[1, 2].forEach((i) => intact(c4[i], i, "(4)"));
			const items4 = await hostJson(host, JSX_PROJECT_ITEMS, "JSX_PROJECT_ITEMS");
			assert.ok(items4.total - items3.total <= 1, "새 문구 하나에 항목은 많아야 하나 (셋째는 같은 capsule): " + items3.total + " → " + items4.total);
			s = await panel(SNAP);
			assert.notEqual(s.rowStates[ids[1]].ap.nk, nk[1], "둘째 새 사본");
			assert.equal(s.rowStates[ids[2]].ap.nk, nk[2], "셋째 같은 사본");
			await exportFrames(api, "4_changed", [c4[1], c4[2]], [CAP2, CAP[2]]);
			log("(4) 캡션 변경 → 둘째 교체·셋째 연쇄, 항목 " + items3.total + " → " + items4.total);

			// ── (5) ↑: 첫째 줄 T2(후반 작업)를 쓰고 ↑ (창 안에 뒤 줄이 없다) ──
			const T2 = "후반 작업 하드 둘째 줄";
			assert.equal(await panel(H.pageTypeField(ids[0], "T2", T2)), true, "T2 입력");
			await panel(H.PAGE_RECORD_HOST_CALLS);
			await panel(H.PAGE_CLEAR_STATUS);
			await panel("document.querySelector('#row-" + Number(ids[0]) + " .btn-update').click(), true");
			// '네이티브 클립 지우는 중…'(진행 중)이 아니라 끝난 상태를 기다린다
			const st5 = await H.waitStatus(panel, /교체 완료|굽지 못|지우지 못|실패/, { timeoutMs: 120000 });
			assert.equal(st5.text, "[1] 네이티브 클립 교체 완료", st5.text);
			calls = await panel("window.__hostCalls.slice()");
			assert.deepEqual(calls.filter((c) => /^(removeNativeClipsAt|applyToTimeline|updateClipAtTime)$/.test(c)), ["removeNativeClipsAt", "applyToTimeline"], calls.join(","));
			const c5 = await hostJson(host, jsxClips(TRACK), "jsxClips(TRACK)");
			assert.equal(c5.length, 3);
			assert.notEqual(c5[0].nodeId, c4[0].nodeId, "첫째 교체");
			assert.deepEqual(nodeIds(c5).slice(1), nodeIds(c4).slice(1), "둘째·셋째 그대로");
			intact(c5[0], 0, "(5)");
			await exportFrames(api, "5_up_t2", [c5[0]], [CAP[0] + " / " + T2]);
			log("(5) ↑ T2 → 첫째 교체");
			log("눈으로 확인할 PNG: %TEMP%\\mi_s1_11_*.png — 모두 기대 문구가 보여야 한다 (빈 글자·'Insert Name Here'·'ADD TITLE HERE'면 실패)");
		});
	}
};
