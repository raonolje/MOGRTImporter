"use strict";
/**
 * 설치된 패널의 순수 core(//#region src/mi/core.ts)를 읽는다 (M5.2).
 * 저장소의 app.js가 아니라 패널이 heartbeat에 알린 extPath의 html/js/app.js — 사용자가 실제로 쓰는 패널과 같은 코드로 확인한다.
 * 패널이 알린 coreHash와 여기서 잰 해시가 다르면 쓰기 도구를 막는다 (panel-version-mismatch).
 *
 *   const C = require("./lib/core");
 *   const r = C.loadCore(hb, { withCore: true });   // {ok: true, hash, file, core} | {ok: false, code, message, hint, server, panel}
 *   r.core.validateSuggestion({...})
 *
 * region을 자르는 규칙·해시는 loadRegions.js(tests/lib의 복사본, 바이트까지 같다)와 패널 _coreHash가 같다.
 */
const fs = require("node:fs");
const path = require("node:path");
const { loadRegions, regionHash } = require("./loadRegions");

const CORE_REGION = "src/mi/core.ts";
let _memo = null; // {file, mtimeMs, size, hash, core}

function installedAppJs(extPath) {
	return path.join(String(extPath), "html", "js", "app.js");
}

/** 설치본 파일의 core 해시 (수정 시각·크기가 같으면 다시 읽지 않는다) → {ok, file, hash} | {ok: false, code, message, hint} */
function installedCoreHash(extPath) {
	if (!extPath) return { ok: false, code: "core-unavailable", message: "패널이 설치 폴더(extPath)를 알리지 않았습니다.", hint: "패널을 새로 고치거나 Premiere를 다시 시작한 뒤 다시 시도하세요." };
	const file = installedAppJs(extPath);
	let st;
	try {
		st = fs.statSync(file);
	} catch (e) {
		return { ok: false, code: "core-unavailable", message: "설치된 패널 파일을 읽지 못했습니다: " + file, hint: "패널 설치 폴더가 옮겨졌거나 지워졌을 수 있습니다. 패널을 다시 연 뒤 get_status로 확인하세요." };
	}
	if (_memo && _memo.file === file && _memo.mtimeMs === st.mtimeMs && _memo.size === st.size) return { ok: true, file, hash: _memo.hash };
	let hash;
	try {
		hash = regionHash(CORE_REGION, file);
	} catch (e) {
		return { ok: false, code: "core-unavailable", message: "설치된 패널 파일에서 core를 찾지 못했습니다: " + String(e.message || e), hint: "v28 이전 패널일 수 있습니다. 패널을 새 버전으로 설치하세요." };
	}
	_memo = { file, mtimeMs: st.mtimeMs, size: st.size, hash, core: null };
	return { ok: true, file, hash };
}

/**
 * heartbeat(hb)의 extPath에서 core를 싣고 hb.coreHash와 맞춘다.
 * opts.withCore면 region을 vm에서 실행해 함수들을 돌려준다 (같은 파일이면 한 번만).
 * → {ok: true, hash, file, core?} | {ok: false, code: core-unavailable | panel-version-mismatch, message, hint, server, panel}
 */
function loadCore(hb, opts = {}) {
	const h = installedCoreHash(hb && hb.extPath);
	if (!h.ok) return Object.assign({ server: null, panel: (hb && hb.coreHash) || null }, h);
	const panel = (hb && hb.coreHash) || null;
	if (!panel || panel !== h.hash) {
		return {
			ok: false, code: "panel-version-mismatch",
			message: panel ? "패널이 쓰는 core(" + panel + ")와 서버가 읽은 설치본 core(" + h.hash + ")가 다릅니다." : "패널이 core 해시를 알리지 않았습니다.",
			hint: "패널 파일이 바뀐 뒤 패널을 새로 고치지 않았을 수 있습니다. 패널을 새로 고치거나(또는 Premiere 재시작) 다시 시도하세요. 그 전까지 쓰기 도구는 쓰지 않습니다.",
			server: h.hash, panel, file: h.file
		};
	}
	if (opts.withCore && !_memo.core) {
		try {
			_memo.core = loadRegions([CORE_REGION], h.file);
		} catch (e) {
			return { ok: false, code: "core-unavailable", message: "설치본 core를 실행하지 못했습니다: " + String(e.message || e), hint: "패널 버전을 확인하세요.", server: h.hash, panel };
		}
	}
	return { ok: true, hash: h.hash, file: h.file, core: opts.withCore ? _memo.core : undefined };
}

module.exports = { CORE_REGION, installedAppJs, installedCoreHash, loadCore };
