var _setStatus = () => {};
var _updateMultiSelect = () => {};
var _renderTrash = () => {};
// 프리셋 ID → 색상 인덱스 맵 (실행 중 유지)
const _presetColorMap = {};
let _presetColorNext = 0;
function _getPresetColorIndex(presetId) {
	if (!presetId) return -1;
	if (_presetColorMap[presetId] === undefined) {
		_presetColorMap[presetId] = _presetColorNext % 12;
		_presetColorNext++;
	}
	return _presetColorMap[presetId];
}
function _buildRowClass(subId, rs) {
	const colorIdx = _getPresetColorIndex(rs.presetId);
	let cls = "sub-row";
	if (rs.presetId) cls += " has-mogrt preset-color-" + colorIdx;
	else cls += " no-mogrt";
	if (rs.checked) cls += " is-checked";
	return cls;
}
function initSubtitleList(setStatus, updateMultiSelect, renderTrash) {
	_setStatus = setStatus;
	_updateMultiSelect = updateMultiSelect;
	_renderTrash = renderTrash;
}
function renderAll() {
	const listWrap = document.getElementById("listWrap");
	const emptyMsg = document.getElementById("emptyMsg");
	emptyMsg.style.display = state.subtitles.length === 0 ? "flex" : "none";
	listWrap.querySelectorAll(".sub-row").forEach((el) => el.parentNode?.removeChild(el));
	state.subtitles.forEach((sub) => {
		listWrap.appendChild(makeRow(sub));
		// DOM 삽입 후 params 복원/렌더링
		const rs = state.rowStates[sub.id];
		const tBtn = document.getElementById("toggle-" + sub.id);
		if (rs && rs.presetId && (!rs.params || rs.params.length === 0)) {
			loadParamsFromPreset(sub.id, rs.presetId, sub.text, rs.open !== false);
			if (tBtn) { tBtn.style.display = ""; tBtn.textContent = rs.open ? "▲" : "▼"; }
		} else if (rs && rs.params && rs.params.length > 0) {
			const panel = document.getElementById("params-" + sub.id);
			if (panel) panel.className = "sub-params" + (rs.open ? " open" : "");
			if (tBtn) { tBtn.style.display = ""; tBtn.textContent = rs.open ? "▲" : "▼"; }
			renderParamsPanel(sub.id);
		}
	});
}
function makeRow(sub) {
	let rowState = state.rowStates[sub.id];
	if (!rowState) {
		rowState = {
			presetId: "",
			params: [],
			_allParams: [],
			open: false,
			checked: false
		};
		state.rowStates[sub.id] = rowState;
	}
	const row = document.createElement("div");
	row.className = _buildRowClass(sub.id, rowState);
	row.id = "row-" + sub.id;
	const hdr = document.createElement("div");
	hdr.className = "sub-header";
	const chkWrap = document.createElement("div");
	chkWrap.className = "chk-wrap";
	const chk = document.createElement("input");
	chk.type = "checkbox";
	chk.checked = rowState.checked;
	chk.addEventListener("change", (e) => {
		e.stopPropagation();
		rowState.checked = chk.checked;
		row.className = _buildRowClass(sub.id, rowState);
		_updateMultiSelect();
	});
	chkWrap.appendChild(chk);
	const numEl = document.createElement("span");
	numEl.className = "sub-num";
	numEl.textContent = String(sub.index);
	const timeEl = document.createElement("span");
	timeEl.className = "sub-time";
	timeEl.textContent = sub.startTime + " → " + sub.endTime;
	const textEl = document.createElement("span");
	textEl.className = "sub-text";
	textEl.title = sub.text;
	textEl.textContent = sub.text;
	textEl.style.cursor = "pointer";
	textEl.addEventListener("click", (e) => {
		e.stopPropagation();
		if (!rowState.params || rowState.params.length === 0) return;
		rowState.open = !rowState.open;
		paramsPanel.className = "sub-params" + (rowState.open ? " open" : "");
		if (toggleBtn) toggleBtn.textContent = rowState.open ? "▲" : "▼";
		saveSessionToStorage();
		_updateMultiSelect();
	});
	const sel = document.createElement("select");
	sel.className = "mogrt-sel";
	sel.id = "sel-" + sub.id;
	buildPresetOptions(sel, rowState.presetId);
	sel.addEventListener("change", (e) => {
		e.stopPropagation();
		const newPid = sel.value;
		const checkedIds = Object.entries(state.rowStates).filter(([, rs]) => rs.checked).map(([id]) => parseInt(id, 10));
		if (checkedIds.length > 0 && checkedIds.includes(sub.id)) {
			checkedIds.forEach((tid) => {
				const tsub = state.subtitles.find((s) => s.id === tid);
				if (!tsub) return;
				const tstate = state.rowStates[tid];
				tstate.presetId = newPid;
				const trow = document.getElementById("row-" + tid);
				if (trow) trow.className = _buildRowClass(tid, tstate);
				const tsel = document.getElementById("sel-" + tid);
				if (tsel) tsel.value = newPid;
			if (newPid) loadParamsFromPreset(tid, newPid, tsub.text, false);
			else {
				tstate.params = [];
				tstate._allParams = [];
				const tpanel = document.getElementById("params-" + tid);
				if (tpanel) { tpanel.innerHTML = ""; tpanel.className = "sub-params"; }
				tstate.open = false;
				const ttBtn = document.getElementById("toggle-" + tid);
				if (ttBtn) ttBtn.style.display = "none";
			}
		});
			saveSessionToStorage();
			_setStatus(checkedIds.length + "개 항목에 프리셋 일괄 적용", "ok");
			_applyPresetFilter();
		} else {
			rowState.presetId = newPid;
			row.className = _buildRowClass(sub.id, rowState);
			if (newPid) loadParamsFromPreset(sub.id, newPid, sub.text, true);
			else {
				rowState.params = [];
				rowState._allParams = [];
				const panel = document.getElementById("params-" + sub.id);
				if (panel) { panel.innerHTML = ""; panel.className = "sub-params"; }
				rowState.open = false;
				toggleBtn.style.display = "none";
			}
			saveSessionToStorage();
			_applyPresetFilter();
		}
	});
	// 속성 열기/닫기: 텍스트 클릭으로만 동작 (전용 버튼 제거)
	const toggleBtn = null; // 참조 유지 (다른 코드에서 null 체크)
	const seekBtn = document.createElement("button");
	seekBtn.className = "btn-del";
	seekBtn.textContent = "▶";
	seekBtn.title = "타임라인에서 이 자막 위치로 이동";
	seekBtn.style.color = "#64b5f6";
	seekBtn.addEventListener("click", async (e) => {
		e.stopPropagation();
		const res = await evalScriptWithPayload("seekToClip", { startSec: sub.startSec });
		if (res.startsWith("SUCCESS")) _setStatus("이동: " + sub.startTime, "ok");
		else _setStatus(res || "이동 실패", "err");
	});
	const updateBtn = document.createElement("button");
	updateBtn.className = "btn-update";
	updateBtn.title = "이 자막만 타임라인에 업데이트";
	updateBtn.textContent = "↑";
	updateBtn.addEventListener("click", async (e) => {
		e.stopPropagation();
		await updateSingleClip(sub);
	});
	const delBtn = document.createElement("button");
	delBtn.className = "btn-del";
	delBtn.innerHTML = "✕";
	delBtn.title = "삭제 (휴지통으로)";
	delBtn.addEventListener("click", (e) => {
		e.stopPropagation();
		deleteSubtitle(sub.id);
	});
	hdr.appendChild(chkWrap);
	hdr.appendChild(numEl);
	hdr.appendChild(timeEl);
	hdr.appendChild(textEl);
	hdr.appendChild(sel);
	hdr.appendChild(seekBtn);
	hdr.appendChild(updateBtn);
	hdr.appendChild(delBtn);
	const paramsPanel = document.createElement("div");
	paramsPanel.className = "sub-params" + (rowState.open ? " open" : "");
	paramsPanel.id = "params-" + sub.id;
	// 텍스트 클릭 토글 제거 - 전용 버튼으로만 열고 닫음
	row.appendChild(hdr);
	row.appendChild(paramsPanel);
	// params 렌더링은 DOM 삽입 후 renderAll에서 처리
	return row;
}
function renderParamsPanel(subId) {
	const panel = document.getElementById("params-" + subId);
	if (!panel) return;
	const rs = state.rowStates[subId];
	if (!rs) return;
	const exposedFontFields = (rs.presetId ? state.presets[rs.presetId] : null)?.exposedFontFields ?? null;
	const doRender = () => {
		renderParams(panel, rs.params, (changedParam) => {
			syncToAllParams(subId, changedParam);
			saveSessionToStorage();
		}, exposedFontFields ?? void 0);
	};
	// 시스템 폰트 캐시가 없으면 먼저 로드 후 렌더링
	if (!_cachedSystemFonts) {
		evalScript("getSystemFonts()").then((fontRes) => {
			if (fontRes && !fontRes.startsWith("ERROR")) {
				try { _cachedSystemFonts = JSON.parse(fontRes); } catch(_) {}
			}
			doRender();
		}).catch(() => doRender());
	} else {
		doRender();
	}
}
function syncToAllParams(subId, changedParam) {
	const rs = state.rowStates[subId];
	if (!rs) return;
	const allParams = rs._allParams;
	if (allParams) {
		for (const p of allParams) if (p.index === changedParam.index) {
			p.value = changedParam.value;
			if (changedParam.rawValue !== void 0) p.rawValue = changedParam.rawValue;
			if (changedParam.colorHex !== void 0) p.colorHex = changedParam.colorHex;
			break;
		}
	}
	const params = rs.params;
	if (params) {
		for (const p of params) if (p.index === changedParam.index) {
			p.value = changedParam.value;
			if (changedParam.rawValue !== void 0) p.rawValue = changedParam.rawValue;
			if (changedParam.colorHex !== void 0) p.colorHex = changedParam.colorHex;
			break;
		}
	}
}
function loadParamsFromPreset(subId, presetId, subText, showPanel) {
	const preset = state.presets[presetId];
	if (!preset) {
		_setStatus("프리셋을 찾을 수 없습니다.", "err");
		return;
	}
	const paramsCopy = JSON.parse(JSON.stringify(preset.params));
	if (preset.textParamIndex >= 0) {
		for (const p of paramsCopy) if (p.index === preset.textParamIndex) {
			p.value = subText;
			if (p.rawValue?.includes("\"textEditValue\"")) try {
				const parsed = JSON.parse(p.rawValue);
				if (parsed && typeof parsed.textEditValue !== "undefined") {
					parsed.textEditValue = subText;
					if (parsed.fontTextRunLength) parsed.fontTextRunLength = [subText.length];
					p.rawValue = JSON.stringify(parsed);
				}
			} catch (_) {}
			break;
		}
	}
	let exposedParams = [];
	if (preset.exposedIndices && preset.exposedIndices.length > 0) exposedParams = paramsCopy.filter((p) => preset.exposedIndices.includes(p.index));
	const rs = state.rowStates[subId];
	rs.params = exposedParams;
	rs._allParams = paramsCopy;
	if (showPanel !== false && exposedParams.length > 0) {
		rs.open = true;
		const panel = document.getElementById("params-" + subId);
		if (panel) panel.className = "sub-params open";
	} else if (exposedParams.length === 0) {
		rs.open = false;
		const panel = document.getElementById("params-" + subId);
		if (panel) panel.className = "sub-params";
	}
	// toggleBtn 업데이트
	const tBtn = document.getElementById("toggle-" + subId);
	if (tBtn) {
		tBtn.style.display = exposedParams.length > 0 ? "" : "none";
		tBtn.textContent = rs.open ? "▲" : "▼";
	}
	renderParamsPanel(subId);
	_setStatus("프리셋 로드: " + preset.name, "ok");
}
function deleteSubtitle(id) {
	const idx = state.subtitles.findIndex((s) => s.id === id);
	if (idx === -1) return;
	state.trashBin.push({
		sub: state.subtitles[idx],
		state: JSON.parse(JSON.stringify(state.rowStates[id])),
		position: idx
	});
	state.subtitles.splice(idx, 1);
	delete state.rowStates[id];
	const row = document.getElementById("row-" + id);
	if (row) row.parentNode?.removeChild(row);
	const emptyMsg = document.getElementById("emptyMsg");
	if (state.subtitles.length === 0) emptyMsg.style.display = "flex";
	_updateMultiSelect();
	_renderTrash();
	saveSessionToStorage();
}
function buildPresetOptions(sel, selectedId) {
	sel.innerHTML = "";
	const none = document.createElement("option");
	none.value = "";
	none.textContent = "-- 프리셋 선택 --";
	sel.appendChild(none);
	for (const [pid, preset] of Object.entries(state.presets)) {
		const opt = document.createElement("option");
		opt.value = pid;
		opt.textContent = preset.name;
		if (pid === selectedId) opt.selected = true;
		sel.appendChild(opt);
	}
}
function refreshAllSelects() {
	state.subtitles.forEach((sub) => {
		const sel = document.getElementById("sel-" + sub.id);
		if (sel) buildPresetOptions(sel, state.rowStates[sub.id]?.presetId ?? "");
	});
	const mogrtSel = document.getElementById("defaultMogrtSel");
	if (mogrtSel) {
		const curVal = mogrtSel.value;
		mogrtSel.innerHTML = "";
		const none = document.createElement("option");
		none.value = "";
		none.textContent = "-- MOGRT 선택 --";
		mogrtSel.appendChild(none);
		state.mogrtList.forEach((m) => {
			const opt = document.createElement("option");
			opt.value = m.path;
			opt.textContent = m.name;
			if (m.path === curVal) opt.selected = true;
			mogrtSel.appendChild(opt);
		});
	}
}
async function updateSingleClip(sub) {
	const rs = state.rowStates[sub.id];
	if (!rs.presetId) {
		_setStatus("프리셋이 선택되지 않았습니다.", "err");
		return;
	}
	const preset = state.presets[rs.presetId];
	if (!preset) {
		_setStatus("프리셋을 찾을 수 없습니다.", "err");
		return;
	}
	const params = rs._allParams.length > 0 ? rs._allParams : rs.params;
	const trackSel = document.getElementById("trackSel");
	const trackIndex = parseInt(trackSel.value, 10);
	_setStatus("클립 업데이트 중...", "info");
	const res = await evalScriptWithPayload("updateClipAtTime", {
		videoTrackIndex: trackIndex,
		startSec: sub.startSec,
		endSec: sub.endSec,
		mogrtPath: preset.mogrtPath,
		params
	});
	if (res.startsWith("SUCCESS")) _setStatus("[" + sub.index + "] " + res.replace("SUCCESS:", "").trim(), "ok");
	else _setStatus(res.replace("ERROR:", "").trim(), "err");
}
function updateMultiSelect() {
	const count = Object.values(state.rowStates).filter((rs) => rs.checked).length;
	const toolbar = document.getElementById("multiSelectToolbar");
	const countEl = document.getElementById("multiSelectCount");
	const toggleBtn = document.getElementById("btnToggleSelect");
	if (count > 0) {
		toolbar.classList.add("active");
		countEl.textContent = count + "개 선택됨";
		if (toggleBtn) { toggleBtn.textContent = "선택 해제"; toggleBtn.classList.add("has-selection"); }
	} else {
		toolbar.classList.remove("active");
		if (toggleBtn) { toggleBtn.textContent = "전체 선택"; toggleBtn.classList.remove("has-selection"); }
	}
	// 속성닫기 버튼: 체크 여부와 무관하게 열린 속성이 있을 때만 활성화
	const closeBtn = document.getElementById("btnCloseAllParams");
	const hasOpenParams = Object.values(state.rowStates).some((rs) => rs.open);
	if (closeBtn) closeBtn.disabled = !hasOpenParams;
}
async function syncFromTimeline() {
	const trackSel = document.getElementById("trackSel");
	const trackIndex = parseInt(trackSel.value, 10);
	_setStatus("타임라인에서 동기화 중...", "info");
	const res = await evalScript(`syncAllClipsFromTimeline(${trackIndex})`);
	if (!res || res.startsWith("ERROR")) {
		_setStatus("동기화 실패: " + (res || "응답 없음"), "err");
		return;
	}
	let syncData;
	try {
		syncData = JSON.parse(res);
	} catch (_) {
		_setStatus("동기화 데이터 파싱 실패", "err");
		return;
	}
	if (!syncData || syncData.length === 0) {
		showAlert("트랙에서 MOGRT 클립을 찾을 수 없습니다.");
		return;
	}
	let updatedCount = 0;
	const mismatchedSubs = [];
	for (const clipData of syncData) {
		const matchedSub = state.subtitles.find((sub) => {
			return Math.abs(sub.startSec - clipData.startSec) < .5;
		});
		if (!matchedSub) continue;
		const rs = state.rowStates[matchedSub.id];
		if (!rs) continue;
		if (rs.presetId && rs._allParams && rs._allParams.length > 0) {
			const preset = state.presets[rs.presetId];
			if (preset) {
				if (checkParamMismatchForSync(rs._allParams, clipData.params, preset.exposedIndices)) mismatchedSubs.push({
					subId: matchedSub.id,
					presetId: rs.presetId,
					clipParams: clipData.params,
					mogrtPath: clipData.mogrtPath
				});
			}
		}
		rs._allParams = clipData.params;
		if (rs.presetId && state.presets[rs.presetId]) {
			const preset = state.presets[rs.presetId];
			if (preset.exposedIndices && preset.exposedIndices.length > 0) rs.params = clipData.params.filter((p) => preset.exposedIndices.includes(p.index));
			else rs.params = [];
		} else rs.params = [];
		renderParamsPanel(matchedSub.id);
		updatedCount++;
	}
	saveSessionToStorage();
	if (mismatchedSubs.length > 0) showConfirm(`${updatedCount}개 자막이 동기화되었습니다.\n${mismatchedSubs.length}개 자막의 파라미터가 프리셋에 없는 값으로 변경되었습니다.\n새 프리셋으로 저장하시겠습니까?`, () => {
		createPresetsFromMismatch(mismatchedSubs);
	}, () => {
		_setStatus(`동기화 완료: ${updatedCount}개 업데이트`, "ok");
	});
	else _setStatus(`동기화 완료: ${updatedCount}개 업데이트`, "ok");
}
function createPresetsFromMismatch(mismatchedSubs) {
	let createdCount = 0;
	for (const item of mismatchedSubs) {
		const rs = state.rowStates[item.subId];
		if (!rs) continue;
		const origPreset = state.presets[item.presetId];
		if (!origPreset) continue;
		const newId = "preset_" + state.nextPresetId++;
		const newName = origPreset.name + "_sync_" + (/* @__PURE__ */ new Date()).toLocaleTimeString("ko-KR", {
			hour: "2-digit",
			minute: "2-digit"
		});
		state.presets[newId] = {
			id: newId,
			name: newName,
			mogrtPath: item.mogrtPath || origPreset.mogrtPath,
			params: JSON.parse(JSON.stringify(item.clipParams)),
			exposedIndices: [...origPreset.exposedIndices],
			textParamIndex: origPreset.textParamIndex,
			exposedFontFields: JSON.parse(JSON.stringify(origPreset.exposedFontFields || {}))
		};
		rs.presetId = newId;
		const selEl = document.getElementById("sel-" + item.subId);
		if (selEl) buildPresetOptions(selEl, newId);
		createdCount++;
	}
	if (createdCount > 0) {
		savePresetsToStorage();
		renderPresetList();
		refreshAllSelects();
		_setStatus(`동기화 완료: ${createdCount}개 새 프리셋 생성`, "ok");
	} else _setStatus("동기화 완료", "ok");
}
function checkParamMismatchForSync(currentParams, clipParams, exposedIndices) {
	for (const cp of clipParams) {
		if (cp.type === "text" || cp.type === "textsetting") continue;
		if (exposedIndices.includes(cp.index)) continue;
		const pp = currentParams.find((p) => p.index === cp.index);
		if (!pp) continue;
		if (pp.type === "text" || pp.type === "textsetting") continue;
		if (pp.value !== cp.value) return true;
		if (pp.colorHex !== void 0 && cp.colorHex !== void 0 && pp.colorHex !== cp.colorHex) return true;
	}
	return false;
}
