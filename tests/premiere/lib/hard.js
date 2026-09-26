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

/**
 * 프로젝트의 __MOGRT_PREVIEW__ 시퀀스를 지운다 (이 이름과 정확히 같은 시퀀스만) → "deleted:n left:m".
 * 패널이 필요할 때 setupPreviewSequence로 다시 만든다. '프리뷰 시퀀스가 없는 프로젝트' 경로를 시험할 때만 쓴다.
 */
function jsxDeletePreviewSequence() {
	return "(function(){var p=app.project,n=0,m=0;for(var k=p.sequences.numSequences-1;k>=0;k--){var s=p.sequences[k];" +
		"if(String(s.name)==='__MOGRT_PREVIEW__'){try{p.deleteSequence(s);n++;}catch(e){}}}" +
		"for(var j=0;j<p.sequences.numSequences;j++){if(String(p.sequences[j].name)==='__MOGRT_PREVIEW__')m++;}" +
		"return 'deleted:'+n+' left:'+m;})()";
}

/** ticks 문자열 → 프레임 (timebase = 프레임당 ticks) */
function ticksToFrame(ticks, timebase) {
	return Math.round(Number(ticks) / Number(timebase));
}

// ── 패널(페이지 표현식) ──

/** #srtInput에 파일 하나를 넣고 change를 보낸다. content: 문자열(UTF-8) 또는 바이트 배열 */
function pageDropSrt(name, content) {
	return pageDropSrts([{ name, content }]);
}

/**
 * #srtInput에 여러 파일을 한 번에 넣는다 (다화자 가져오기, S1-7). list: [{name, content}]
 * 플래그가 꺼져 있으면 패널은 첫 파일만 읽는다 (window._mogrtDebug.setMiCast(true)로 켠다)
 */
function pageDropSrts(list) {
	const parts = list.map((f) => {
		const part = typeof f.content === "string" ? JSON.stringify(f.content) : "new Uint8Array(" + JSON.stringify(Array.from(f.content)) + ")";
		return "dt.items.add(new File([" + part + "], " + JSON.stringify(f.name) + "));";
	}).join(" ");
	return "(() => { const input = document.getElementById('srtInput'); if (!input) return 'no-input';" +
		" const dt = new DataTransfer(); " + parts +
		" input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true }));" +
		" return input.disabled ? 'sent-disabled' : 'sent'; })()";
}

/**
 * 여러 SRT 가져오기 플래그를 켜고 끈다 (DEV 디버그 훅, 코드를 고치지 않는다) → 적용된 값
 * on === null: 덮어쓰기를 풀고 코드 기본값(MI_CAST_ENABLED, S2-4부터 true)으로 돌린다. 스위트는 케이스 사이에 패널을 새로 고치지 않는다
 */
function pageSetMiCast(on) {
	return "window._mogrtDebug.setMiCast(" + (on === null ? "null" : on ? "true" : "false") + ")";
}

/**
 * 레거시 안전 경로를 1단계(v27 호스트) 경로로 고정한다 (false) / 코드 기본값으로 돌린다 (null: v28 호스트가 답하면 v28 경로, S2-5).
 * 1단계 경로는 v28 호스트가 답하지 않을 때(캐시된 옛 호스트) 여전히 쓰인다 — s1_9·s1_10이 그 경로를 시험한다 → 적용된 값
 */
function pageSetLegacyV28(on) {
	return "window._mogrtDebug.setLegacyV28(" + (on === false ? "false" : "null") + ")";
}

/**
 * 'SRT 가져오기' 창: {open, rows: [{file, key, name, preset, count, action, dup}], ok, okText, error, stats, info, legacy}
 * action은 이미 있는 화자면 선택 값(merge|replace), 아니면 칸의 글자(새 화자·병합·건너뜀). legacy는 분배 모드일 때만
 */
const PAGE_IMPORT_MODAL = "(() => { const m = document.getElementById('importModal'); if (!m) return null;" +
	" const rows = Array.from(document.querySelectorAll('#impBody tr.imp-row')).map((r) => ({" +
	"  file: (r.querySelector('.imp-file span') || {}).textContent || ''," +
	"  key: (r.querySelector('.imp-key') || {}).value || ''," +
	"  name: (r.querySelector('.imp-name') || {}).value || ''," +
	"  preset: (r.querySelector('.imp-preset') || {}).value || ''," +
	"  count: (r.querySelector('.imp-count') || {}).textContent || ''," +
	"  action: r.querySelector('.imp-act') ? r.querySelector('.imp-act').value : ((r.querySelector('.imp-action') || {}).textContent || '')," +
	"  dup: r.classList.contains('imp-dup') }));" +
	" const ok = document.getElementById('impOk');" +
	" const lg = document.getElementById('impLegacy');" +
	" return { open: m.classList.contains('open'), rows, ok: !!ok && !ok.disabled, okText: ok ? ok.textContent : ''," +
	"  legacy: lg && lg.style.display !== 'none' ? { info: (document.getElementById('impLegacyInfo') || {}).textContent || '', mode: (document.getElementById('impLegacyMode') || {}).value || ''," +
	"   ambiguous: Array.from(document.querySelectorAll('#impAmbList .imp-amb')).map((a) => a.textContent) } : null," +
	"  error: (document.getElementById('impError') || {}).textContent || ''," +
	"  stats: Array.from(document.querySelectorAll('#impBody .imp-stats')).map((e) => e.textContent)," +
	"  info: Array.from(document.querySelectorAll('#impBody .imp-info')).map((e) => e.textContent) }; })()";

/** #workInput에 작업 파일(객체 → JSON)을 넣고 change를 보낸다 */
function pageLoadWork(name, obj) {
	return "(() => { const input = document.getElementById('workInput'); if (!input) return 'no-input';" +
		" const dt = new DataTransfer(); dt.items.add(new File([" + JSON.stringify(JSON.stringify(obj)) + "], " + JSON.stringify(name) + ", { type: 'application/json' }));" +
		" input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true }));" +
		" return input.disabled ? 'sent-disabled' : 'sent'; })()";
}

/** runCommand 결과 (window._mogrtDebug.cmd, 약속을 기다린다) */
function pageCmd(op, args) {
	// replMode 평가라 맨 앞의 await가 있어야 약속이 풀린다 (없으면 {}가 돌아온다)
	return "await window._mogrtDebug.cmd(" + JSON.stringify(op) + ", " + JSON.stringify(args || {}) + ")";
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

/**
 * 패널이 부르는 호스트 함수 이름을 순서대로 window.__hostCalls에 남기기 시작한다 (기록을 비운다).
 * CSInterface.prototype.evalScript를 감싼다. 케이스의 host()가 보내는 (function(){…})() 식은 이름이 없어 빠진다.
 * 패널의 ExtendScript 식은 맨 앞 주석 /*host:이름 …*\/의 이름으로 남는다 (S1-11 removeNativeClipsAt)
 */
const PAGE_RECORD_HOST_CALLS = "(() => { window.__hostCalls = []; if (!window.__hostCallsHooked) { window.__hostCallsHooked = true;" +
	" const orig = CSInterface.prototype.evalScript; CSInterface.prototype.evalScript = function (script, cb) {" +
	"  const m = /^\\s*(?:\\/\\*host:([A-Za-z_$][\\w$]*)|([A-Za-z_$][\\w$]*)\\s*\\()/.exec(String(script)); if (m) window.__hostCalls.push(m[1] || m[2]); return orig.call(this, script, cb); }; }" +
	" return true; })()";

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

// ── 적용·구조 맞춤 케이스 공용 (S1-9, S1-10) ──

const TPS = 254016000000;

/**
 * 활성 스크래치 사본의 트랙 idx 클립마다 {s, e, nodeId, props: [[이름, 값]]} (JSON 문자열).
 * 텍스트 값은 "T:" + textEditValue, 나머지는 getValue() 문자열. MGT 컴포넌트가 없으면 props는 빈 배열
 */
function jsxTrackProps(idx) {
	return "(function(){var seq=app.project.activeSequence;if(!seq)return JSON.stringify({error:'no-seq'});" +
		"if(String(seq.name).indexOf('" + SCRATCH_PREFIX + "')!==0)return JSON.stringify({error:'not-scratch'});" +
		"var t=seq.videoTracks[" + Number(idx) + "];var out=[];" +
		"for(var k=0;k<t.clips.numItems;k++){var c=t.clips[k];var o={s:String(c.start.ticks),e:String(c.end.ticks),nodeId:String(c.nodeId),props:[]};" +
		"var comp=null;try{comp=c.getMGTComponent();}catch(e){}" +
		"if(comp){var ps=comp.properties;for(var j=0;j<ps.numItems;j++){var p=ps[j];var v='';try{v=String(p.getValue());}catch(e){v='?';}" +
		"if(v.indexOf('\"textEditValue\"')!==-1){try{v='T:'+JSON.parse(v).textEditValue;}catch(e){}}" +
		"o.props.push([String(p.displayName),v]);}}out.push(o);}return JSON.stringify(out);})()";
}
/** jsxTrackProps 클립의 이름 name 속성 값 (없으면 undefined) */
function propValue(clip, name) {
	const p = (clip.props || []).find((x) => x[0] === name);
	return p ? p[1] : undefined;
}
/** MOGRT 하나를 활성 스크래치 사본의 트랙 idx, s초에 importMGT로 놓고 끝을 e초로 → "ok" | 까닭 */
function jsxPlaceMogrt(mogrtPath, idx, s, e) {
	return "(function(){var seq=app.project.activeSequence;if(String(seq.name).indexOf('" + SCRATCH_PREFIX + "')!==0)return 'not-scratch';" +
		"var c=seq.importMGT(" + JSON.stringify(mogrtPath) + "," + JSON.stringify(String(Math.round(s * TPS))) + "," + Number(idx) + ",0);" +
		"if(!c)return 'null';var t=new Time();t.seconds=" + Number(e) + ";c.end=t;return 'ok';})()";
}
/** 확인창이 열릴 때까지 기다린다 → {msg, yes, alt (숨김이면 null), no} */
async function waitConfirm(panel, opts = {}) {
	return waitFor(panel, "(() => { const m = document.getElementById('confirmModal'); if (!m || !m.classList.contains('open')) return null;" +
		" const alt = document.getElementById('confirmAlt');" +
		" return { msg: document.getElementById('confirmMessage').textContent, yes: document.getElementById('confirmYes').textContent," +
		"  alt: alt && alt.style.display !== 'none' ? alt.textContent : null, no: document.getElementById('confirmNo').textContent }; })()", { timeoutMs: opts.timeoutMs || 15000, what: "확인창" });
}
/** 상태 줄을 비운다 (이전 문구를 다음 결과로 오인하지 않게, 테스트 전용 DOM 조작) */
const PAGE_CLEAR_STATUS = "(() => { const s = document.getElementById('statusBar'); s.textContent = ''; s.className = ''; return true; })()";
/** #trackSel 값을 바꾸고 change → 값 */
function pageSelectTrack(v) {
	return "(() => { const t = document.getElementById('trackSel'); t.value = " + JSON.stringify(String(v)) + "; t.dispatchEvent(new Event('change')); return t.value; })()";
}
/** 줄 체크박스를 켠다 → true | false(행 없음) */
function pageCheckRow(id) {
	return "(() => { const c = document.querySelector('#row-" + Number(id) + " input[type=checkbox]'); if (!c) return false; c.checked = true; c.dispatchEvent(new Event('change')); return true; })()";
}
/** 줄 속성창의 T-ID 필드 textarea에 쓴다 (사용자가 치는 것과 같다). 그 필드가 속성창에 없으면 false */
function pageTypeField(id, fid, text) {
	return "(() => { const b = Array.from(document.querySelectorAll('#params-" + Number(id) + " .fid-badge')).find((x) => x.textContent === " + JSON.stringify(fid) + ");" +
		" if (!b) return false; const ta = b.parentNode.parentNode.querySelector('textarea'); if (!ta) return false;" +
		" ta.value = " + JSON.stringify(text) + "; ta.dispatchEvent(new Event('input')); return true; })()";
}

/** [[시작, 끝(초), 문장]] → SRT 문자열 (합성 픽스처용) */
function srtOf(cues) {
	const tc = (sec) => {
		const ms = Math.round(sec * 1000);
		const p = (n, w) => String(n).padStart(w, "0");
		return p(Math.floor(ms / 3600000), 2) + ":" + p(Math.floor((ms % 3600000) / 60000), 2) + ":" + p(Math.floor((ms % 60000) / 1000), 2) + "," + p(ms % 1000, 3);
	};
	return cues.map(([s, e, t], i) => (i + 1) + "\n" + tc(s) + " --> " + tc(e) + "\n" + t + "\n").join("\n");
}
/** mogrtPath(파일 이름으로 비교)를 쓰는 프리셋 {id, …프리셋} — 없으면 모달로 만든다 */
async function pickPresetForMogrt(api, mogrtPath) {
	const { panel, log } = api;
	const base = (p) => String(p || "").replace(/\\/g, "/").split("/").pop();
	const find = async () => {
		const s = await panel("window._mogrtDebug.snapshot()");
		const id = Object.keys(s.presets).find((k) => base(s.presets[k].mogrtPath) === base(mogrtPath));
		return id ? Object.assign({}, s.presets[id], { id }) : null;
	};
	let p = await find();
	if (!p) {
		const mogrts = await waitMogrts(panel, 1);
		const m = mogrts.find((x) => base(x[0]) === base(mogrtPath));
		if (!m) throw new Error("MOGRT 목록에 " + base(mogrtPath) + "이 없다");
		if (log) log("프리셋 만들기: " + m[1]);
		await createPresetViaModal(api, m[0]);
		p = await find();
	}
	return p;
}
/** 빈 목록에 SRT([[시작, 끝, 문장]])를 열고 모든 줄에 프리셋을 건다 (속성이 채워질 때까지) → 줄 id */
async function loadRowsWithPreset(api, name, cues, presetId) {
	const { panel, assert } = api;
	const SNAP = "window._mogrtDebug.snapshot()";
	assert.equal(await panel(pageDropSrt(name, srtOf(cues))), "sent");
	await waitFor(panel, "document.querySelectorAll('#listWrap .sub-row').length === " + cues.length, { what: cues.length + "줄" });
	const ids = (await panel(SNAP)).subtitles.map((s) => s.id);
	for (const id of ids) assert.equal(await panel(pageSetRowPreset(id, presetId)), presetId);
	await waitFor(panel, "(() => { const s = " + SNAP + "; return s.subtitles.every((x) => (s.rowStates[x.id]._allParams || []).length > 0); })()", { timeoutMs: 60000, what: "줄 속성" });
	return ids;
}
/** ▶ → 확인창 [안전하게 적용 (wantN)] → 결과 상태 (S1-9) → {confirm, status} */
async function safeApplyClick(api, wantN) {
	const { panel, assert } = api;
	await panel(PAGE_CLEAR_STATUS);
	await panel("document.getElementById('btnApply').click(), true");
	const c = await waitConfirm(panel);
	assert.equal(c.yes, "안전하게 적용 (" + wantN + ")", c.msg);
	assert.deepEqual([c.alt, c.no], ["지금 방식으로 전체 적용", "취소"]);
	await panel("document.getElementById('confirmYes').click(), true");
	const st = await waitStatus(panel, /^(중지함 — )?안전하게 적용: /, { timeoutMs: 120000 });
	return { confirm: c, status: st };
}

// ── 화자별 배치 ▶ (S2-4 _miApply, S3-4 케이스 공용) ──

/**
 * ▶ 진행 상태: 점검 창(열렸으면 요약 줄·빠진 줄·고친 클립 선택지), 바쁨, 진행 문구(#miBusyText), 워치독 문구(#miBusyWatch, 보일 때만),
 * 확인창(열렸으면 문구 — 체크된 줄이 있으면 ▶가 '선택된 n개만?'을 먼저 묻는다). 점검 창 줄에는 화자 키·이름·트랙·수만 있다 (자막 문장 없음)
 */
const PAGE_MI_APPLY_STATE = "(() => { const m = document.getElementById('preflightModal'); let pf = null;" +
	" if (m && m.classList.contains('open')) { const opt = (id) => { const cb = document.getElementById(id); const row = cb.closest('label');" +
	"  return { shown: row.style.display !== 'none', checked: cb.checked, text: row.querySelector('span').textContent }; };" +
	"  pf = { lines: Array.from(document.querySelectorAll('#pfSummary .pf-line')).map((e) => e.textContent), orphans: opt('pfOrphans'), edited: opt('pfOverwriteEdited') }; }" +
	" const w = document.getElementById('miBusyWatch'); const cm = document.getElementById('confirmModal');" +
	" return { pf, busy: window._mogrtDebug.miBusy(), text: (document.getElementById('miBusyText') || {}).textContent || ''," +
	"  watch: w && w.style.display !== 'none' ? w.textContent : ''," +
	"  confirm: cm && cm.classList.contains('open') ? document.getElementById('confirmMessage').textContent : null }; })()";
/**
 * 화자 줄 ▶: ▶ → (점검 창이 뜨면 onPf(창 정보) 뒤 [적용]) → 끝날 때까지. 진행 문구('… 전체 n/m')를 모은다 → {pf, status, ms, progress}.
 * onPf가 던지면 [취소]로 닫고 다시 던진다 (패널이 적용 중으로 남지 않게). 체크된 줄이 있어 확인창이 뜨면 [취소]로 닫고 실패한다
 * (부르는 쪽이 먼저 PAGE_UNCHECK_ALL).
 * opts.timeoutMs(기본 240000)를 넘기면 '시간 초과(…ms): 화자별 적용 …'으로 실패한다 — Premiere 모달(메모리 경고 등)이
 * ExtendScript를 막아도 페이지는 돌아 이 문구가 나오고, 스위트가 모달 안내를 덧붙인다. 마지막 진행·워치독 문구를 싣는다
 */
async function miApplyButton(api, onPf, opts = {}) {
	const { panel } = api;
	const limit = opts.timeoutMs || 240000;
	await panel(PAGE_CLEAR_STATUS);
	const t0 = Date.now();
	await panel("document.getElementById('btnApply').click(), true");
	let pf = null;
	const progress = [];
	for (;;) {
		const st = await panel(PAGE_MI_APPLY_STATE);
		if (st.confirm !== null && !st.busy && !pf) {
			await panel("document.getElementById('confirmNo').click(), true");
			throw new Error("▶가 점검 창 대신 확인창을 띄웠다 (체크된 줄?): " + st.confirm);
		}
		if (st.pf && !pf) {
			pf = st.pf;
			try {
				if (onPf) await onPf(pf);
			} catch (e) {
				await panel("document.getElementById('pfCancel').click(), true");
				throw e;
			}
			await panel("document.getElementById('pfOk').click(), true");
			continue;
		}
		if (/전체 \d+\/\d+$/.test(st.text) && progress.indexOf(st.text) === -1) progress.push(st.text);
		if (!st.busy && !st.pf) break;
		if (Date.now() - t0 > limit) {
			throw new Error("시간 초과(" + limit + "ms): 화자별 적용이 끝나지 않았다 — 마지막 문구: " + (st.text || "(없음)") + (st.watch ? " · 워치독: " + st.watch : ""));
		}
		await sleep(500);
	}
	return { pf, status: await panel(PAGE_STATUS), ms: Date.now() - t0, progress };
}

/** DEV 캐시 루트인지 확인한다 (운영 캐시에는 절대 쓰지 않는다) → 루트 */
async function devCacheRoot(panel) {
	const root = await panel("window._mogrtDebug.getCacheRoot()");
	if (!/CEP_MogrtImporter_dev\/cache$/.test(String(root || ""))) throw new Error("DEV 캐시가 아니다 — 쓰지 않는다: " + root);
	return root;
}

module.exports = {
	sleep, waitFor, ticksToFrame,
	jsxReadVideoTrack, jsxClearVideoTrack, jsxHasSequenceNamed, jsxDeletePreviewSequence, jsxCloneActiveAsScratch, jsxDropScratch, withScratchSequence, SCRATCH_PREFIX,
	pageDropSrt, pageDropSrts, pageSetMiCast, pageSetLegacyV28, pageLoadWork, pageCmd, pageSetRowPreset, pageImportPresetsText,
	PAGE_ROWS, PAGE_STATUS, PAGE_ALERT, PAGE_UNCHECK_ALL, PAGE_PRESET_OPTIONS, PAGE_MOGRT_OPTIONS, PAGE_RECORD_HOST_CALLS, PAGE_IMPORT_MODAL,
	reloadClean, waitKeys, waitMogrts, createPresetViaModal, ensurePreset, confirmYes, waitStatus, devCacheRoot,
	jsxTrackProps, propValue, jsxPlaceMogrt, waitConfirm, PAGE_CLEAR_STATUS, pageSelectTrack, pageCheckRow, pageTypeField,
	srtOf, pickPresetForMogrt, loadRowsWithPreset, safeApplyClick, PAGE_MI_APPLY_STATE, miApplyButton
};
