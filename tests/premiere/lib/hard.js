"use strict";
/**
 * 하드 케이스(tests/premiere/cases/*.case.js) 공용 도우미.
 * Premiere·패널에는 케이스가 넘겨준 panel()/host()로만 닿는다. 이 파일 자체는 아무 데도 붙지 않는다.
 *
 *   const H = require("../lib/hard");
 *   await H.waitFor(panel, "document.querySelectorAll('#listWrap .sub-row').length === 3", { what: "행 3개" });
 *   const v3 = JSON.parse(await host(H.jsxReadVideoTrack(2)));
 *
 * - JSX 문자열은 ES3로 쓴다 (host()가 ASCII로 바꿔 evalScript에 넘긴다).
 * - 타임라인을 바꾸는 케이스는 withScratchSequence(활성 T_ 시퀀스의 복제본 T_scratch_…)에서 돈다.
 *   트랙 비우기는 스크래치 사본의 V2 이상에서만 한다. V1(영상)과 원본 T_ 시퀀스는 건드리지 않는다.
 */

const fs = require("node:fs");
const path = require("node:path");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 페이지 표현식이 참이 될 때까지 기다린다. 참 값을 돌려준다 */
async function waitFor(panel, expr, opts = {}) {
	const timeoutMs = opts.timeoutMs || 30000;
	const stepMs = opts.stepMs || 250;
	const t0 = Date.now();
	let last;
	while (Date.now() - t0 < timeoutMs) {
		try {
			last = await panel(expr);
			if (last) return last;
		} catch (e) {
			last = "예외: " + e.message;
		}
		await sleep(stepMs);
	}
	throw new Error("시간 초과(" + timeoutMs + "ms): " + (opts.what || expr) + " — 마지막 값: " + JSON.stringify(last));
}

// ── 호스트(JSX, ES3) ──

/** 활성 시퀀스의 비디오 트랙 idx 클립 목록 → JSON {seqName, timebase, clips:[{s, e, name, nodeId}]} (ticks 문자열) */
function jsxReadVideoTrack(idx) {
	const i = Number(idx);
	if (!(i >= 0)) throw new Error("트랙 번호가 이상하다: " + idx);
	return "(function(){var seq=app.project.activeSequence;if(!seq)return JSON.stringify({error:'no-seq'});" +
		"var t=seq.videoTracks[" + i + "];if(!t)return JSON.stringify({error:'no-track'});var out=[];" +
		"for(var k=0;k<t.clips.numItems;k++){var c=t.clips[k];out.push({s:String(c.start.ticks),e:String(c.end.ticks),name:String(c.name),nodeId:String(c.nodeId)});}" +
		"return JSON.stringify({seqName:String(seq.name),timebase:String(seq.timebase),clips:out});})()";
}

/**
 * 활성 스크래치 시퀀스(T_scratch_…)의 비디오 트랙 idx(1 이상)를 비운다 → 남은 클립 수 문자열.
 * T_23976 등 원본 T_ 시퀀스에는 S0-3 수동 확인용 클립이 있으므로 스크래치 사본에서만 지운다
 * ('not-scratch'를 돌려준다). 스크래치 사본은 withScratchSequence로 만든다.
 */
function jsxClearVideoTrack(idx) {
	const i = Number(idx);
	if (!(i >= 1)) throw new Error("V1(트랙 0)은 비우지 않는다: " + idx);
	return "(function(){var seq=app.project.activeSequence;if(!seq)return 'no-seq';" +
		"if(String(seq.name).indexOf('" + SCRATCH_PREFIX + "')!==0)return 'not-scratch';" +
		"var t=seq.videoTracks[" + i + "];if(!t)return 'no-track';" +
		"for(var k=t.clips.numItems-1;k>=0;k--){try{t.clips[k].remove(false,false);}catch(e){}}" +
		"return String(t.clips.numItems);})()";
}

// ── 스크래치 시퀀스 (S0-3 결정 3: Sequence.clone → 이름 T_… → 테스트 → deleteSequence) ──

const SCRATCH_PREFIX = "T_scratch_";

/** 활성 T_ 시퀀스를 복제해 T_scratch_<tag>로 이름 짓고 활성화 → JSON {orig:{id,name}, clone:{id,name}} */
function jsxCloneActiveAsScratch(tag) {
	const name = SCRATCH_PREFIX + String(tag).replace(/[^A-Za-z0-9_]/g, "_");
	return "(function(){var p=app.project,o=p.activeSequence;if(!o)return JSON.stringify({error:'no-seq'});" +
		"if(String(o.name).indexOf('T_')!==0)return JSON.stringify({error:'not-T'});" +
		"var before={};for(var k=0;k<p.sequences.numSequences;k++)before[String(p.sequences[k].sequenceID)]=1;" +
		"var ok=o.clone();var c=null;for(var j=0;j<p.sequences.numSequences;j++){var s=p.sequences[j];if(!before[String(s.sequenceID)]){c=s;break;}}" +
		"if(!c)return JSON.stringify({error:'clone-failed',ok:String(ok)});" +
		"c.name=" + JSON.stringify(name) + ";p.openSequence(String(c.sequenceID));" +
		"return JSON.stringify({orig:{id:String(o.sequenceID),name:String(o.name)},clone:{id:String(c.sequenceID),name:String(c.name)}});})()";
}

/** 원본을 다시 활성화하고 스크래치 사본(이름이 T_scratch_로 시작할 때만)을 지운다 → 결과 문자열 */
function jsxDropScratch(origId, cloneId) {
	return "(function(){var p=app.project;try{p.openSequence(" + JSON.stringify(String(origId)) + ");}catch(e){}" +
		"for(var k=0;k<p.sequences.numSequences;k++){var s=p.sequences[k];if(String(s.sequenceID)===" + JSON.stringify(String(cloneId)) + "){" +
		"if(String(s.name).indexOf('" + SCRATCH_PREFIX + "')!==0)return 'not-scratch';return String(p.deleteSequence(s));}}return 'not-found';})()";
}

/**
 * 활성 T_ 시퀀스의 스크래치 사본에서 fn({clone, orig})을 돌린다. 끝나면 원본으로 돌아가 사본을 지우고,
 * DEV 캐시에 생긴 사본의 세션 폴더도 지운다.
 */
async function withScratchSequence(api, tag, fn) {
	const { panel, host, log } = api;
	const info = JSON.parse(await host(jsxCloneActiveAsScratch(tag)));
	if (info.error) throw new Error("스크래치 시퀀스를 만들지 못했다: " + JSON.stringify(info));
	if (log) log("스크래치 시퀀스: " + info.clone.name + " (원본 " + info.orig.name + ")");
	let projKey = null;
	try {
		await waitFor(panel, "window._mogrtDebug.snapshot().keys.seqId === " + JSON.stringify(info.clone.id), { timeoutMs: 15000, what: "패널이 스크래치 시퀀스로 전환" });
		await waitKeys(panel);
		projKey = (await panel("window._mogrtDebug.snapshot()")).keys.proj;
		return await fn(info);
	} finally {
		const r = await host(jsxDropScratch(info.orig.id, info.clone.id));
		if (log) log("스크래치 시퀀스 정리: " + r);
		try {
			await waitFor(panel, "window._mogrtDebug.snapshot().keys.seqId === " + JSON.stringify(info.orig.id), { timeoutMs: 15000, what: "패널이 원본 시퀀스로 복귀" });
			const root = await devCacheRoot(panel);
			if (projKey) {
				const dir = path.join(root, projKey, projKey + "_seq_" + info.clone.id.replace(/[^a-zA-Z0-9-]/g, "_"));
				if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
			}
		} catch (e) {
			if (log) log("정리 경고: " + e.message);
		}
	}
}

/** 이름이 있는 시퀀스가 프로젝트에 있는가 → "true"/"false" */
function jsxHasSequenceNamed(name) {
	return "(function(){var n=" + JSON.stringify(String(name)) + ";var p=app.project;for(var k=0;k<p.sequences.numSequences;k++){if(String(p.sequences[k].name)===n)return 'true';}return 'false';})()";
}

/** ticks 문자열 → 프레임 (timebase = 프레임당 ticks) */
function ticksToFrame(ticks, timebase) {
	return Math.round(Number(ticks) / Number(timebase));
}

// ── 패널(페이지 표현식) ──

/** #srtInput에 파일 하나를 넣고 change를 보낸다. content: 문자열(UTF-8) 또는 바이트 배열 */
function pageDropSrt(name, content) {
	const part = typeof content === "string" ? JSON.stringify(content) : "new Uint8Array(" + JSON.stringify(Array.from(content)) + ")";
	return "(() => { const input = document.getElementById('srtInput'); if (!input) return 'no-input';" +
		" const dt = new DataTransfer(); dt.items.add(new File([" + part + "], " + JSON.stringify(name) + "));" +
		" input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true }));" +
		" return input.disabled ? 'sent-disabled' : 'sent'; })()";
}

/** 목록 행 요약 [{id, num, text, preset, checked, cls}] */
const PAGE_ROWS = "Array.from(document.querySelectorAll('#listWrap .sub-row')).map((r) => ({" +
	" id: parseInt(r.id.slice(4), 10)," +
	" num: (r.querySelector('.sub-num') || {}).textContent || ''," +
	" text: (r.querySelector('.sub-text') || {}).textContent || ''," +
	" preset: (r.querySelector('select.mogrt-sel') || {}).value || ''," +
	" checked: !!(r.querySelector('input[type=checkbox]') || {}).checked," +
	" cls: r.className }))";

const PAGE_STATUS = "(() => { const s = document.getElementById('statusBar'); return s ? { text: s.textContent, cls: s.className } : null; })()";

/** 행 select로 프리셋 하나를 행 하나에 건다 (체크된 행이 없을 때 = 한 줄 경로) */
function pageSetRowPreset(rowId, presetId) {
	return "(() => { const s = document.getElementById('sel-' + " + Number(rowId) + "); if (!s) return 'no-select';" +
		" s.value = " + JSON.stringify(String(presetId)) + "; s.dispatchEvent(new Event('change')); return s.value; })()";
}

/** 모든 행의 체크를 끈다 (▶가 확인창 없이 전체를 적용하도록) */
const PAGE_UNCHECK_ALL = "(() => { const b = document.getElementById('btnToggleSelect'); const any = document.querySelector('#listWrap .sub-row input[type=checkbox]:checked'); if (any && b) b.click(); return !document.querySelector('#listWrap .sub-row input[type=checkbox]:checked'); })()";

/** 행 select에 보이는 프리셋 [[id, 이름]] */
const PAGE_PRESET_OPTIONS = "(() => { const s = document.querySelector('#listWrap select.mogrt-sel'); return s ? Array.from(s.options).filter((o) => o.value).map((o) => [o.value, o.textContent]) : []; })()";

/** 스캔된 MOGRT [[경로, 이름]] (#defaultMogrtSel 옵션) */
const PAGE_MOGRT_OPTIONS = "Array.from((document.getElementById('defaultMogrtSel') || { options: [] }).options).filter((o) => o.value).map((o) => [o.value, o.textContent])";

/** 새로 고침하고 [EXCEPTION] 로그가 없는지 확인한다 → 로그 */
async function reloadClean(reload, assert, log) {
	const logs = await reload();
	const bad = logs.filter((l) => /^\[EXCEPTION\]/.test(l));
	if (log) logs.filter((l) => /^\[(EXCEPTION|error|log:error)/.test(l)).forEach((l) => log("  " + l));
	assert.equal(bad.length, 0, "새로 고침 중 예외: " + bad.join(" | "));
	return logs;
}

/** 시퀀스 키가 확정되고(T_ 시퀀스) SRT 열기가 열릴 때까지 기다린다 (S1-3 부팅 게이트 포함) */
async function waitKeys(panel, opts = {}) {
	return waitFor(panel, "(() => { const l = (document.getElementById('activeSeqLabel') || {}).textContent || '';" +
		" const i = document.getElementById('srtInput'); return l.indexOf('T_') !== -1 && i && !i.disabled; })()",
	{ timeoutMs: opts.timeoutMs || 30000, what: "시퀀스 키 확정 + SRT 열기 가능" });
}

/** 스캔된 MOGRT 목록을 기다린다 → [[경로, 이름]] */
async function waitMogrts(panel, min = 1) {
	return waitFor(panel, "(() => { const o = " + PAGE_MOGRT_OPTIONS + "; return o.length >= " + Number(min) + " ? o : null; })()", { timeoutMs: 90000, what: "MOGRT 스캔 " + min + "개 이상" });
}

/**
 * 프리셋 모달로 새 프리셋 하나를 만든다 (MOGRT 경로 하나).
 * v27 getMogrtParams는 프리뷰 시퀀스가 없으면 작업 시퀀스 V1 0~5초를 자르므로,
 * 모달을 열기 전에 호스트 setupPreviewSequence로 __MOGRT_PREVIEW__를 먼저 만든다.
 */
async function createPresetViaModal(api, mogrtPath, opts = {}) {
	const { panel, host, log } = api;
	if (!opts.skipPreviewSetup) {
		const setup = await host("setupPreviewSequence(" + JSON.stringify(JSON.stringify({ mogrtPath, durationSec: 5 })) + ")");
		if (String(setup).indexOf("SUCCESS") !== 0) throw new Error("setupPreviewSequence 실패: " + setup);
	}
	await panel("document.getElementById('btnAddPreset').click(), true");
	await waitFor(panel, "document.getElementById('defaultMogrtSel').options.length > 1", { what: "모달 MOGRT 목록" });
	await panel("(() => { const s = document.getElementById('defaultMogrtSel'); s.value = " + JSON.stringify(mogrtPath) + "; s.dispatchEvent(new Event('change')); return s.value; })()");
	if (opts.name) await panel("(() => { const n = document.getElementById('presetNameInput'); if (n) n.value = " + JSON.stringify(opts.name) + "; return true; })()");
	// 이전 상태 문구가 '프리셋 저장'으로 오인되지 않게 비운다 (테스트 전용 DOM 조작)
	await panel("(() => { const s = document.getElementById('statusBar'); s.textContent = ''; return true; })()");
	// 파라미터가 오기 전에는 저장이 '파라미터가 없습니다.'로 끝난다 → 될 때까지 누른다
	await waitFor(panel, "(() => { document.getElementById('btnSaveDefault').click(); return /프리셋 저장/.test(document.getElementById('statusBar').textContent); })()",
		{ timeoutMs: 120000, stepMs: 1500, what: "프리셋 저장" });
	if (log) log("프리셋 저장: " + (await panel(PAGE_STATUS)).text);
}

/**
 * 프리셋이 하나도 없으면 모달로 하나 만든다 (행 select 옵션 기준).
 * → [id, 이름]
 */
async function ensurePreset(api, opts = {}) {
	const { panel, log } = api;
	const have = await panel(PAGE_PRESET_OPTIONS);
	if (have.length) return have[0];
	const mogrts = await waitMogrts(panel, 1);
	const re = opts.prefer || /라온올제/;
	const pick = mogrts.find((m) => re.test(m[1])) || mogrts[0];
	if (log) log("프리셋 만들기: " + pick[1]);
	await createPresetViaModal(api, pick[0]);
	const after = await waitFor(panel, "(() => { const o = " + PAGE_PRESET_OPTIONS + "; return o.length ? o : null; })()", { what: "행 select의 새 프리셋" });
	return after[after.length - 1];
}

/**
 * 프리셋 가져오기 버튼을 누르되, 파일 대화상자 대신 text를 파일로 넣는다.
 * (핸들러가 만드는 <input type=file>의 click을 잠깐 바꿔 change를 바로 보낸다)
 */
function pageImportPresetsText(text, name = "hard_presets.json") {
	return "(() => { const text = " + JSON.stringify(text) + "; const orig = document.createElement;" +
		" document.createElement = function (tag, o) { const el = orig.call(document, tag, o);" +
		"  if (String(tag).toLowerCase() === 'input') { el.click = function () { const dt = new DataTransfer();" +
		"   dt.items.add(new File([text], " + JSON.stringify(name) + ", { type: 'application/json' })); el.files = dt.files; el.dispatchEvent(new Event('change')); }; }" +
		"  return el; };" +
		" try { document.getElementById('btnImportPresets').click(); } finally { document.createElement = orig; }" +
		" return true; })()";
}

/** 열린 확인창의 [확인]을 누른다 (창이 뜰 때까지 기다린다) → 확인창 문구 */
async function confirmYes(panel, opts = {}) {
	const msg = await waitFor(panel, "(() => { const m = document.getElementById('confirmModal'); return m && m.classList.contains('open') ? document.getElementById('confirmMessage').textContent : null; })()", { timeoutMs: opts.timeoutMs || 15000, what: "확인창" });
	await panel("document.getElementById('confirmYes').click(), true");
	return msg;
}

/** 열린 알림창 문구 (없으면 null) */
const PAGE_ALERT = "(() => { const m = document.getElementById('alertModal'); return m && m.classList.contains('open') ? document.getElementById('alertMessage').textContent : null; })()";

/** 상태 줄이 정규식에 맞을 때까지 기다린다 → {text, cls} */
async function waitStatus(panel, re, opts = {}) {
	return waitFor(panel, "(() => { const s = " + PAGE_STATUS + "; return s && " + re.toString() + ".test(s.text) ? s : null; })()", { timeoutMs: opts.timeoutMs || 30000, what: "상태 " + re });
}

/** DEV 캐시 루트인지 확인한다 (운영 캐시에는 절대 쓰지 않는다) → 루트 */
async function devCacheRoot(panel) {
	const root = await panel("window._mogrtDebug.getCacheRoot()");
	if (!/CEP_MogrtImporter_dev\/cache$/.test(String(root || ""))) throw new Error("DEV 캐시가 아니다 — 쓰지 않는다: " + root);
	return root;
}

module.exports = {
	sleep, waitFor, ticksToFrame,
	jsxReadVideoTrack, jsxClearVideoTrack, jsxHasSequenceNamed, jsxCloneActiveAsScratch, jsxDropScratch, withScratchSequence, SCRATCH_PREFIX,
	pageDropSrt, pageSetRowPreset, pageImportPresetsText,
	PAGE_ROWS, PAGE_STATUS, PAGE_ALERT, PAGE_UNCHECK_ALL, PAGE_PRESET_OPTIONS, PAGE_MOGRT_OPTIONS,
	reloadClean, waitKeys, waitMogrts, createPresetViaModal, ensurePreset, confirmYes, waitStatus, devCacheRoot
};
