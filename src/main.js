function setStatus(msg, cls) {
	const el = document.getElementById("statusBar");
	el.textContent = msg;
	el.className = cls || "";
}
initSubtitleList(setStatus, updateMultiSelect, renderTrash);
initTrash(setStatus);
initPresetList(setStatus, openPresetModal);
initModal(setStatus);
initTabs();
bindModalEvents();
bindTrashEvents();
bindPresetViewToggle();
document.getElementById("srtInput")?.addEventListener("change", (e) => {
	const input = e.target;
	const file = input.files?.[0];
	if (!file) return;
	const reader = new FileReader();
	reader.onload = (ev) => {
		const text = ev.target?.result;
		const parsed = parseSRT(text);
		state.subtitles = [];
		state.rowStates = {};
		state.trashBin = [];
		state.nextId = 1;
		parsed.forEach((p) => {
			const id = state.nextId++;
			state.subtitles.push({
				...p,
				id
			});
			state.rowStates[id] = {
				presetId: "",
				params: [],
				_allParams: [],
				open: false,
				checked: false
			};
		});
		renderAll();
		renderTrash();
		updateMultiSelect();
		saveSessionToStorage();
		_saveHistoryOnAction("SRT 로드: " + file.name);
		setStatus("SRT 로드: " + file.name + " (" + state.subtitles.length + "개)", "ok");
	};
	reader.onerror = () => setStatus("SRT 읽기 실패", "err");
	reader.readAsText(file, "UTF-8");
	input.value = "";
});
// MOGRT 스캔 중복 실행 방지 플래그
var _scanInProgress = false;
function doScanMogrt(silent) {
	if (_scanInProgress) return; // 이미 스캔 중이면 스킵
	_scanInProgress = true;
	const mogrtStatus = document.getElementById("mogrtStatus");
	if (!silent) {
		mogrtStatus.textContent = "MOGRT 스캔 중...";
		mogrtStatus.className = "";
	}
	// 1단계: 스캔 대상 폴더 목록 가져오기 (빠른 JSX 호출)
	evalScript("getMogrtScanDirs()").then((dirsRes) => {
		let dirs = [];
		try {
			if (dirsRes && !dirsRes.startsWith("ERROR")) dirs = JSON.parse(dirsRes);
		} catch(_) {}
		if (dirs.length === 0) {
			if (!silent) mogrtStatus.textContent = "MOGRT 없음";
			_scanInProgress = false;
			return;
		}
		// 2단계: 폴더별로 순차 스캔 (각 호출 사이에 다른 evalScript 끼어들기 가능)
		let idx = 0;
		let totalAdded = 0;
		function scanNext() {
			if (idx >= dirs.length) {
				// 스캔 완료
				mogrtStatus.textContent = state.mogrtList.length + "개";
				mogrtStatus.className = "ok";
				if (totalAdded > 0) refreshAllSelects();
				_scanInProgress = false;
				// 스캔 완료 후 시퀀스 폴링 시작 (스캔 전 폴링이 JSX 큐를 점유하지 않도록)
				startSequencePolling();
				return;
			}
			const folderPath = dirs[idx++];
			// 폴더 경로를 인코딩하여 JSX에 전달
			const encoded = encodeURIComponent(folderPath);
			evalScript(`scanMogrtFolder(decodeURIComponent("${encoded}"))`).then((res) => {
				try {
					if (res && !res.startsWith("ERROR") && res !== "[]") {
						const list = JSON.parse(res);
						list.forEach((item) => {
							if (!state.mogrtList.some((m) => m.path === item.path)) {
								state.mogrtList.push(item);
								totalAdded++;
							}
						});
					}
				} catch(_) {}
				// 다음 폴더 스캔 (setTimeout 0으로 큐 양보)
				setTimeout(scanNext, 0);
			});
		}
		scanNext();
	});
}
// UI 초기화 (로컈 스토리지 로드 등 JSX 필요 없는 작업 먼저 실행)
loadAllFromStorage();
renderAll();
renderTrash();
renderPresetList();
renderPresetTrash();
refreshAllSelects();
updateMultiSelect();
updatePresetTabCount();
// MOGRT 폴더 트리 프리로드: 첫 모달 오픈 시 즉시 표시를 위해 백그라운드에서 미리 로드
setTimeout(() => {
	if (!window._cachedFolderTree) {
		evalScript("getMogrtFolderTree()").then((treeRes) => {
			if (treeRes && !treeRes.startsWith("ERROR")) {
				try { window._cachedFolderTree = JSON.parse(treeRes); } catch(_) {}
			}
		});
	}
}, 1000);
// MOGRT 스캔: JSX 응답을 기다리지 않고 독립적으로 시작 (스캔이 시퀀스 정보에 의존하지 않음)
setTimeout(() => doScanMogrt(false), 0);
setInterval(() => doScanMogrt(true), 3e4);
// 시퀀스 정보는 백그라운드로 비동기 로드 (스캔을 블로킹하지 않음)
evalScript("getActiveSequenceInfo()").then((res) => {
	if (res && !res.startsWith("ERROR")) try {
		const info = JSON.parse(res);
		const hashFn = (s) => {
			let h = 0;
			for (let i = 0; i < s.length; i++) {
				h = (h << 5) - h + s.charCodeAt(i);
				h = h & h;
			}
			return Math.abs(h).toString(36);
		};
		if (info.projPath) state.currentProjectKey = "proj_" + hashFn(info.projPath);
		if (info.seqId) {
			state.currentSequenceId = info.seqId;
			state.currentSequenceKey = state.currentProjectKey + "_seq_" + info.seqId.replace(/[^a-zA-Z0-9\-]/g, "_");
		} else if (info.seqName) state.currentSequenceKey = state.currentProjectKey + "_seq_name_" + hashFn(info.seqName);
		const seqLabelInit = document.getElementById("activeSeqLabel");
		if (seqLabelInit) seqLabelInit.textContent = (info.seqName || info.seqId) ? "활성 시퀀스 : " + (info.seqName || info.seqId) : "";
		// 프로젝트/시퀀스 키 확정 후 프리셋+자막 모두 올바른 키로 재로드
		loadAllFromStorage();
		renderAll();
		renderTrash();
		renderPresetList();
		renderPresetTrash();
		refreshAllSelects();
		updateMultiSelect();
		updatePresetTabCount();
		_loadTrackFromStorage();
	} catch (_) {}
});
function simpleHash(str) {
	let hash = 0;
	for (let i = 0; i < str.length; i++) {
		const char = str.charCodeAt(i);
		hash = (hash << 5) - hash + char;
		hash = hash & hash;
	}
	return Math.abs(hash).toString(36);
}
var _seqPollingActive = false;
function startSequencePolling() {
	if (_seqPollingActive) return;
	_seqPollingActive = true;
	setInterval(async () => {
		const res = await evalScript("getActiveSequenceInfo()");
		if (!res || res.startsWith("ERROR")) return;
		try {
			const info = JSON.parse(res);
			const newSeqId = info.seqId || "";
			const newSeqName = info.seqName || "";
			const newProjPath = info.projPath || "";
			const seqIdentifier = newSeqId || newSeqName;
			if (!seqIdentifier) return;
			// 프리뷰 시퀀스는 폴링에서 완전히 무시 (활성 시퀀스 전환 방지)
			if (newSeqName === "__MOGRT_PREVIEW__") return;
			const newProjKey = newProjPath ? "proj_" + simpleHash(newProjPath) : state.currentProjectKey;
			const seqPart = newSeqId ? newSeqId.replace(/[^a-zA-Z0-9\-]/g, "_") : "name_" + simpleHash(newSeqName);
			const newSeqKey = newProjKey + "_seq_" + seqPart;
			const seqLabel = document.getElementById("activeSeqLabel");
			if (seqLabel) seqLabel.textContent = (newSeqName || newSeqId) ? "활성 시퀀스 : " + (newSeqName || newSeqId) : "";
			if (newSeqKey === state.currentSequenceKey) return;
			const isSameProject = newProjKey === state.currentProjectKey;
			saveSessionToStorage();
			state.currentProjectKey = newProjKey;
			state.currentSequenceKey = newSeqKey;
			state.currentSequenceId = seqIdentifier;
		if (!isSameProject) loadAllFromStorage();
		else {
			// 시퀀스 전환 시에만 빈 데이터로 초기화 허용
			loadSessionFromStorage._clearOnEmpty = true;
			loadSessionFromStorage();
			loadSessionFromStorage._clearOnEmpty = false;
		}
			renderAll();
			renderTrash();
			renderPresetList();
			renderPresetTrash();
			refreshAllSelects();
			updateMultiSelect();
			updatePresetTabCount();
			// 시쿼스 전환 후 트랙 복원
			_loadTrackFromStorage();
			setStatus((isSameProject ? "시쿼스 전환: " : "프로젝트 변경: ") + (info.seqName || newSeqId), "ok");
		} catch (_) {}
}, 100);
}
// startSequencePolling()은 doScanMogrt 완료 후 호출됨 (스캔 전 JSX 큐 점유 방지)
// ── 검색 필터 ──
const _subSearchInput = document.getElementById("subSearchInput");
function _applySubSearch() {
	const q = (_subSearchInput?.value || "").trim().toLowerCase();
	state.subtitles.forEach((sub) => {
		const row = document.getElementById("row-" + sub.id);
		if (!row) return;
		if (!q || sub.text.toLowerCase().includes(q)) row.classList.remove("search-hidden");
		else row.classList.add("search-hidden");
	});
}
_subSearchInput?.addEventListener("input", _applySubSearch);

// ── 프리셋 필터 (엑셀 방식 드롭다운) ──
let _presetFilterSelected = new Set(); // 선택된 프리셋 ID 세트 (null = 프리셋 없음)
function _applyPresetFilter() {
	const active = _presetFilterSelected.size > 0;
	const btn = document.getElementById("btnPresetFilter");
	if (btn) btn.classList.toggle("active", active);
	state.subtitles.forEach((sub) => {
		const row = document.getElementById("row-" + sub.id);
		if (!row) return;
		const rs = state.rowStates[sub.id];
		if (!active) { row.classList.remove("preset-filter-hidden"); return; }
		const pid = (rs && rs.presetId) ? rs.presetId : null;
		if (_presetFilterSelected.has(pid)) {
			row.classList.remove("preset-filter-hidden");
		} else {
			row.classList.add("preset-filter-hidden");
			// 필터로 숨겨진 행의 체크 해제
			if (rs && rs.checked) {
				rs.checked = false;
				// is-checked만 제거 (preset-filter-hidden은 유지)
				row.classList.remove("is-checked");
				const chk = row.querySelector("input[type=checkbox]");
				if (chk) chk.checked = false;
			}
		}
	});
	updateMultiSelect();
}
function _buildPresetFilterDropdown() {
	const dropdown = document.getElementById("presetFilterDropdown");
	if (!dropdown) return;
	dropdown.innerHTML = "";
	// 전체 선택 / 전체 해제
	const allRow = document.createElement("div");
	allRow.className = "preset-filter-item";
	allRow.innerHTML = '<span style="font-size:10px;color:#888;flex:1;">전체 표시</span>';
	allRow.addEventListener("click", () => {
		_presetFilterSelected.clear();
		_applyPresetFilter();
		_buildPresetFilterDropdown();
	});
	dropdown.appendChild(allRow);
	const divider = document.createElement("hr");
	divider.className = "preset-filter-divider";
	dropdown.appendChild(divider);
	// 프리셋 없음 항목
	const noneRow = document.createElement("div");
	noneRow.className = "preset-filter-item";
	const noneChk = document.createElement("input");
	noneChk.type = "checkbox";
	noneChk.checked = _presetFilterSelected.has(null);
	const noneLbl = document.createElement("span");
	noneLbl.textContent = "(프리셋 없음)";
	noneLbl.style.color = "#888";
	noneRow.appendChild(noneChk);
	noneRow.appendChild(noneLbl);
	noneRow.addEventListener("click", (e) => {
		if (e.target !== noneChk) noneChk.checked = !noneChk.checked;
		if (noneChk.checked) _presetFilterSelected.add(null);
		else _presetFilterSelected.delete(null);
		_applyPresetFilter();
	});
	dropdown.appendChild(noneRow);
	// 프리셋별 항목
	Object.entries(state.presets).forEach(([pid, preset]) => {
		const item = document.createElement("div");
		item.className = "preset-filter-item";
		const chk = document.createElement("input");
		chk.type = "checkbox";
		chk.checked = _presetFilterSelected.has(pid);
		const lbl = document.createElement("span");
		lbl.textContent = preset.name || pid;
		lbl.style.cssText = "flex:1;overflow:hidden;text-overflow:ellipsis;";
		item.appendChild(chk);
		item.appendChild(lbl);
		item.addEventListener("click", (e) => {
			if (e.target !== chk) chk.checked = !chk.checked;
			if (chk.checked) _presetFilterSelected.add(pid);
			else _presetFilterSelected.delete(pid);
			_applyPresetFilter();
		});
		dropdown.appendChild(item);
	});
}
const _btnPresetFilter = document.getElementById("btnPresetFilter");
_btnPresetFilter?.addEventListener("click", (e) => {
	e.stopPropagation();
	_buildPresetFilterDropdown();
	const dropdown = document.getElementById("presetFilterDropdown");
	if (dropdown) dropdown.classList.toggle("open");
});
document.addEventListener("click", (e) => {
	const wrap = document.getElementById("presetFilterWrap");
	if (wrap && !wrap.contains(e.target)) {
		const dd = document.getElementById("presetFilterDropdown");
		if (dd) dd.classList.remove("open");
	}
});

// ── 속성창 일괄 닫기 ──
document.getElementById("btnCloseAllParams")?.addEventListener("click", () => {
	state.subtitles.forEach((sub) => {
		const rs = state.rowStates[sub.id];
		if (!rs || !rs.open) return;
		rs.open = false;
		const panel = document.getElementById("params-" + sub.id);
		if (panel) panel.className = "sub-params";
		const tBtn = document.getElementById("toggle-" + sub.id);
		if (tBtn) tBtn.textContent = "▼";
	});
	saveSessionToStorage();
	updateMultiSelect();
	setStatus("속성창 모두 닫기", "ok");
});

// ── 드래그 다중 체크 ──
// 드래그 시작 영역: .chk-wrap(체크박스) 또는 .sub-tc(타임코드) 영역에서만 드래그 체크 시작
// 체크박스 단순 클릭은 드래그 시작에서 제외 (기본 change 이벤트로 체크)
let _dragCheckActive = false;
let _dragCheckValue = true;
let _dragStarted = false; // 실제 드래그 이동이 발생했는지 여부
let _dragOriginRow = null; // 드래그 시작 행
function _applyDragCheck(rowEl) {
	const rowId = parseInt(rowEl.id.replace("row-", ""), 10);
	if (isNaN(rowId)) return;
	const rs = state.rowStates[rowId];
	if (!rs || rs.checked === _dragCheckValue) return;
	rs.checked = _dragCheckValue;
	rowEl.className = _buildRowClass(rowId, rs);
	const chk = rowEl.querySelector("input[type=checkbox]");
	if (chk) chk.checked = _dragCheckValue;
	updateMultiSelect();
}
document.addEventListener("mousedown", (e) => {
	if (e.button !== 0) return;
	_dragCheckActive = false;
	_dragStarted = false;
	_dragOriginRow = null;
	const rowEl = e.target.closest(".sub-row");
	if (!rowEl) return;
	// 드래그 시작 가능 영역: .chk-wrap(체크박스), .sub-num(번호), .sub-time(타임코드)
	const inDragZone = e.target.closest(".chk-wrap, .sub-num, .sub-time");
	if (!inDragZone) return;
	const rowId = parseInt(rowEl.id.replace("row-", ""), 10);
	if (isNaN(rowId)) return;
	const rs = state.rowStates[rowId];
	if (!rs) return;
	_dragCheckActive = true;
	_dragCheckValue = !rs.checked;
	_dragOriginRow = rowEl;
	// 체크박스 영역에서 마우스다운 시 기본 체크 동작을 막지 않음
	// 실제 드래그 이동 후 mousemove에서 _dragStarted=true로 설정
}, true);
document.addEventListener("mousemove", (e) => {
	if (!_dragCheckActive) return;
	const el = document.elementFromPoint(e.clientX, e.clientY);
	if (!el) return;
	const rowEl = el.closest(".sub-row");
	if (!rowEl) return;
	// 실제 다른 행으로 이동했을 때만 드래그 체크 시작
	if (!_dragStarted && rowEl !== _dragOriginRow) {
		_dragStarted = true;
		// 시작 행에 체크 적용
		_applyDragCheck(_dragOriginRow);
	}
	if (_dragStarted) _applyDragCheck(rowEl);
});
document.addEventListener("mouseup", () => {
	_dragCheckActive = false;
	_dragStarted = false;
	_dragOriginRow = null;
});

// ── 트랙 번호 기억 ──
	// 트랙 번호 기억: 프로젝트+시퀀스 단위로 파일 저장
	function _saveTrackToStorage() {
		const trackSel = document.getElementById("trackSel");
		if (!trackSel) return;
		try {
			const path = _getTrackPath();
			if (path) _fsWrite(path, { trackValue: trackSel.value });
		} catch(_) {}
	}
	function _loadTrackFromStorage() {
		const trackSel = document.getElementById("trackSel");
		if (!trackSel) return;
		try {
			const path = _getTrackPath();
			const data = path ? _fsRead(path) : null;
			if (data && data.trackValue !== undefined) trackSel.value = data.trackValue;
		} catch(_) {}
	}
	document.getElementById("trackSel")?.addEventListener("change", _saveTrackToStorage);
	// 트랙 복원은 getActiveSequenceInfo 완료 후 호출되므로 여기서는 생략 (아래 수정 참조)

// ── 전체선택/선택해제 통합 버튼 ──
document.getElementById("btnToggleSelect")?.addEventListener("click", () => {
	const hasSelection = Object.values(state.rowStates).some((rs) => rs.checked);
	if (hasSelection) {
		// 선택 해제
		state.subtitles.forEach((sub) => {
			const rs = state.rowStates[sub.id];
			rs.checked = false;
			const chk = document.querySelector("#row-" + sub.id + " input[type=checkbox]");
			if (chk) chk.checked = false;
			const rowEl = document.getElementById("row-" + sub.id);
			if (rowEl) rowEl.className = _buildRowClass(sub.id, rs);
		});
	} else {
		// 전체 선택
		state.subtitles.forEach((sub) => {
			const rs = state.rowStates[sub.id];
			rs.checked = true;
			const chk = document.querySelector("#row-" + sub.id + " input[type=checkbox]");
			if (chk) chk.checked = true;
			const rowEl = document.getElementById("row-" + sub.id);
			if (rowEl) rowEl.className = _buildRowClass(sub.id, rs); // 노란색 is-checked 적용
		});
	}
	updateMultiSelect();
});
document.getElementById("btnMultiDel")?.addEventListener("click", () => {
	Object.entries(state.rowStates).filter(([, rs]) => rs.checked).map(([id]) => parseInt(id, 10)).forEach((id) => deleteSubtitle(id));
});
document.getElementById("btnApply")?.addEventListener("click", async () => {
	if (state.subtitles.length === 0) {
		setStatus("먼저 SRT 파일을 열어주세요.", "err");
		return;
	}
	const checkedIds = Object.entries(state.rowStates).filter(([, rs]) => rs.checked).map(([id]) => parseInt(id, 10));
	if (checkedIds.length > 0) showConfirm(checkedIds.length + "개 자막이 선택되어 있습니다.\n\n확인: 선택된 " + checkedIds.length + "개만 적용\n취소: 전체 " + state.subtitles.length + "개 적용", () => doApplyToTimeline(state.subtitles.filter((sub) => checkedIds.includes(sub.id))), () => doApplyToTimeline(state.subtitles));
	else doApplyToTimeline(state.subtitles);
});
async function doApplyToTimeline(targetSubs) {
	const trackSel = document.getElementById("trackSel");
	const trackIndex = parseInt(trackSel.value, 10);
	const items = targetSubs.map((sub) => {
		const rs = state.rowStates[sub.id];
		const preset = rs.presetId ? state.presets[rs.presetId] : null;
		const params = rs._allParams.length > 0 ? rs._allParams : rs.params;
		return {
			mogrtPath: preset ? preset.mogrtPath : "",
			startSec: sub.startSec,
			endSec: sub.endSec,
			text: sub.text,
			params
		};
	});
	setStatus("타임라인에 배치 중... (" + items.length + "개)", "info");
	const btnApply = document.getElementById("btnApply");
	btnApply.disabled = true;
	const res = await evalScriptWithPayload("applyToTimeline", {
		videoTrackIndex: trackIndex,
		subtitles: items
	});
	btnApply.disabled = false;
	if (!res) {
		setStatus("응답 없음", "err");
		return;
	}
	if (res.startsWith("SUCCESS")) {
		_saveHistoryOnAction("타임라인 적용 (" + items.length + "개)");
		setStatus(res.replace("SUCCESS:", "").trim(), "ok");
	} else setStatus(res.replace("ERROR:", "").trim(), "err");
}
document.getElementById("btnAddPreset")?.addEventListener("click", () => {
	openPresetModal(null);
});

document.getElementById("btnExportPresets")?.addEventListener("click", () => {
	const presets = state.presets;
	if (Object.keys(presets).length === 0) {
		showAlert("내보낼 프리셋이 없습니다.");
		return;
	}
	// 내보내기 모달 열기
	const listEl = document.getElementById("exportPresetList");
	listEl.innerHTML = "";
	// 전체 선택 체크박스
	const allRow = document.createElement("div");
	allRow.style.cssText = "display:flex;align-items:center;gap:6px;padding:4px 6px;border-bottom:1px solid #333;margin-bottom:4px;";
	const allChk = document.createElement("input");
	allChk.type = "checkbox";
	allChk.id = "exportChkAll";
	allChk.checked = true;
	const allLbl = document.createElement("label");
	allLbl.htmlFor = "exportChkAll";
	allLbl.textContent = "전체 선택";
	allLbl.style.cssText = "font-size:11px;color:#aaa;cursor:pointer;";
	allRow.appendChild(allChk);
	allRow.appendChild(allLbl);
	listEl.appendChild(allRow);
	// 개별 프리셋 체크박스
	Object.keys(presets).forEach((id) => {
		const row = document.createElement("div");
		row.style.cssText = "display:flex;align-items:center;gap:6px;padding:3px 6px;";
		const chk = document.createElement("input");
		chk.type = "checkbox";
		chk.className = "export-preset-chk";
		chk.dataset.id = id;
		chk.checked = true;
		const lbl = document.createElement("label");
		lbl.textContent = presets[id].name || id;
		lbl.style.cssText = "font-size:12px;color:#e0e0e0;cursor:pointer;";
		lbl.addEventListener("click", () => { chk.checked = !chk.checked; });
		row.appendChild(chk);
		row.appendChild(lbl);
		listEl.appendChild(row);
	});
	// 전체 선택 토글
	allChk.addEventListener("change", () => {
		document.querySelectorAll(".export-preset-chk").forEach((c) => { c.checked = allChk.checked; });
	});
	// 폴더 경로 초기화
	document.getElementById("exportFolderPath").value = "";
	// 모달 버튼 이벤트 등록 (매번 새로 등록하여 확실히 동작)
	const browseBtn = document.getElementById("exportBrowseBtn");
	const cancelBtn = document.getElementById("exportCancel");
	const confirmBtn = document.getElementById("exportConfirm");
	const modal = document.getElementById("exportModal");
	// 기존 이벤트 제거 후 재등록 (cloneNode로 깔끔하게)
	const newBrowse = browseBtn.cloneNode(true);
	browseBtn.parentNode.replaceChild(newBrowse, browseBtn);
	// 폴더 선택 버튼 (JSX 방식 복원, 스캔 완료 후에만 동작)
	document.getElementById("exportFolderPath").parentElement.style.display = "";
	newBrowse.style.display = "";
	newBrowse.addEventListener("click", () => {
		const _msBrowse = document.getElementById("mogrtStatus");
		const _scanDoneBrowse = !_scanInProgress || (_msBrowse && _msBrowse.className === "ok");
		if (!_scanDoneBrowse) { showAlert("MOGRT 스캔 완료 후 사용 가능합니다."); return; }
		evalScript("selectExportFolder()").then((result) => {
			if (result && result !== "CANCEL" && !result.startsWith("ERROR")) {
				document.getElementById("exportFolderPath").value = result.trim();
			}
		});
	});
	const newCancel = cancelBtn.cloneNode(true);
	cancelBtn.parentNode.replaceChild(newCancel, cancelBtn);
	newCancel.addEventListener("click", () => { modal.classList.remove("open"); });
	const newConfirm = confirmBtn.cloneNode(true);
	confirmBtn.parentNode.replaceChild(newConfirm, confirmBtn);
	newConfirm.addEventListener("click", () => {
		const selectedIds = Array.from(document.querySelectorAll(".export-preset-chk:checked")).map((c) => c.dataset.id);
		if (selectedIds.length === 0) { showAlert("내보낼 프리셋을 선택하세요."); return; }
		const folderPath = document.getElementById("exportFolderPath").value.trim();
		if (!folderPath) { showAlert("저장 폴더를 선택하세요."); return; }
		const _msConfirm = document.getElementById("mogrtStatus");
		const _scanDoneConfirm = !_scanInProgress || (_msConfirm && _msConfirm.className === "ok");
		if (!_scanDoneConfirm) { showAlert("MOGRT 스캔 완료 후 사용 가능합니다."); return; }
			const selectedPresets = {};
			selectedIds.forEach((id) => { selectedPresets[id] = state.presets[id]; });
			const exportData = { version: 1, exportedAt: new Date().toISOString(), presets: selectedPresets };
			const json = JSON.stringify(exportData, null, 2);
			const defaultFileName = "mogrt_presets_" + new Date().toLocaleDateString("ko-KR").replace(/\./g, "").replace(/ /g, "_") + ".json";
			const savePath = folderPath.replace(/[\\/]+$/, "") + "\\" + defaultFileName;
			// CEP 네이티브 파일 쓰기 (evalScript 문자열 길이 제한 우회)
			const writeResult = window.cep && window.cep.fs ? window.cep.fs.writeFile(savePath, json, cep.encoding.UTF8) : null;
			if (writeResult && writeResult.err === 0) {
				modal.classList.remove("open");
				setStatus("프리셋 내보내기 완료: " + selectedIds.length + "개 → " + savePath, "ok");
			} else {
				// fallback: evalScriptWithPayload
				evalScriptWithPayload("saveTextFile", { path: savePath, content: json }).then((r) => {
					if (r && r.startsWith("SUCCESS")) {
						modal.classList.remove("open");
						setStatus("프리셋 내보내기 완료: " + selectedIds.length + "개 → " + savePath, "ok");
					} else {
						setStatus("저장 실패: " + (r || "응답 없음"), "err");
					}
				});
			}
	});
	// 모달 열기
	modal.classList.add("open");
});
document.getElementById("btnImportPresets")?.addEventListener("click", () => {
	const input = document.createElement("input");
	input.type = "file";
	input.accept = ".json";
	input.addEventListener("change", () => {
		const file = input.files?.[0];
		if (!file) return;
		const reader = new FileReader();
		reader.onload = (ev) => {
			const text = ev.target?.result;
			try {
				const data = JSON.parse(text);
				const importedPresets = data.presets || data;
				if (typeof importedPresets !== "object") {
					showAlert("올바른 프리셋 파일이 아닙니다.");
					return;
				}
				// MOGRT 스캔 미완료 시 경고 (스캔 진행 중일 때만)
				if (_scanInProgress) {
					showAlert("MOGRT 스캔이 진행 중입니다.\n스캔 완료 후 다시 시도하세요.");
					return;
				}
				const doImport = (clearFirst) => {
					if (clearFirst) {
						// 기존 프리셋 전체 삭제
						state.presets = {};
						state.nextPresetId = 1;
					}
					let imported = 0;
					let skipped = 0;
					const skippedNames = [];
					for (const [pid, preset] of Object.entries(importedPresets)) {
						const p = preset;
						// 손상된 mogrtPath 정제: .mogrt 확장자 기준 첫 번째 파일명만 추출
						let rawPath = p.mogrtPath || "";
						const mogrtExtIdx = rawPath.indexOf(".mogrt");
						if (mogrtExtIdx !== -1) {
							// .mogrt 이후 불필요한 데이터 제거
							rawPath = rawPath.substring(0, mogrtExtIdx + 6);
						}
						if (rawPath !== p.mogrtPath) p.mogrtPath = rawPath;
						// 경로 비교: 전체 경로 일치 또는 파일명 일치 (드라이브/슬래시 차이 허용)
						const pFileName = rawPath.split(/[\\/]/).pop().toLowerCase();
						const matched = state.mogrtList.find((m) =>
							m.path === p.mogrtPath ||
							m.path.toLowerCase().split(/[\\/]/).pop() === pFileName
						);
						if (!matched) {
							skipped++;
							skippedNames.push(p.name + " (" + pFileName + ")");
							continue;
						}
						// 파일명 일치 시 실제 경로로 업데이트
						if (matched.path !== p.mogrtPath) p.mogrtPath = matched.path;
						let newId = pid;
						if (state.presets[newId]) newId = "preset_" + state.nextPresetId++;
						state.presets[newId] = {
							...p,
							id: newId,
							exposedFontFields: p.exposedFontFields || {}
						};
						imported++;
					}
					savePresetsToStorage();
					renderPresetList();
					refreshAllSelects();
					updatePresetTabCount();
					let msg = "프리셋 불러오기: " + imported + "개 " + (clearFirst ? "교체" : "추가");
					if (skipped > 0) {
						msg += ", " + skipped + "개 스킵";
						showAlert("불러오기 완료: " + imported + "개 " + (clearFirst ? "교체됨" : "추가됨") + "\n\n다음 프리셋은 MOGRT 파일을 찾을 수 없어 스킵되었습니다:\n" + skippedNames.slice(0, 5).join("\n") + (skippedNames.length > 5 ? "\n..." : ""));
					} else setStatus(msg, "ok");
				};
				const existingCount = Object.keys(state.presets).length;
				if (existingCount > 0) {
					// 기존 프리셋이 있으면 OK = 덮어쓰기, Cancel = 취소
					showConfirm(
						"기존 프리셋 " + existingCount + "개가 있습니다.\n\n[확인] 기존 프리셋을 모두 삭제하고 불러오기\n[취소] 불러오기 취소",
						() => doImport(true),   // OK: 기존 삭제 후 교체
						() => {}                // Cancel: 아무것도 안 함
					);
				} else {
					doImport(true);
				}
			} catch (_) {
				showAlert("JSON 파일 파싱 실패. 올바른 프리셋 파일인지 확인하세요.");
			}
		};
		reader.readAsText(file, "UTF-8");
	});
	input.click();
});
// ── 작업 데이터 저장 (JSON) ──
document.getElementById("btnSaveWork")?.addEventListener("click", () => {
	if (state.subtitles.length === 0) { showAlert("저장할 자막 데이터가 없습니다."); return; }
	const workData = {
		version: 2,
		savedAt: new Date().toISOString(),
		sequenceKey: state.currentSequenceKey,
		subtitles: state.subtitles,
		rowStates: state.rowStates,
		trashBin: state.trashBin,
		nextId: state.nextId,
		trackValue: document.getElementById("trackSel")?.value ?? "2"
	};
	const json = JSON.stringify(workData, null, 2);
	const seqName = (state.currentSequenceKey || "work").replace(/[^a-zA-Z0-9_\-가-힣]/g, "_");
	const dateStr = new Date().toLocaleDateString("ko-KR").replace(/\./g, "").replace(/ /g, "_");
	const defaultFileName = "mogrt_work_" + seqName + "_" + dateStr + ".json";
	// JSX 저장 다이얼로그 (폴더 직접 지정)
	evalScriptWithPayload("saveTextFileWithDialog", { defaultName: defaultFileName, content: json }).then((r) => {
		if (!r || r === "CANCEL") { setStatus("저장 취소", ""); return; }
		if (r.startsWith("SUCCESS")) setStatus("작업 저장 완료: " + r.replace("SUCCESS:", "").trim(), "ok");
		else setStatus("저장 실패: " + (r || "응답 없음"), "err");
	});
});

// ── 작업 데이터 불러오기 (JSON) ──
document.getElementById("workInput")?.addEventListener("change", (e) => {
	const input = e.target;
	const file = input.files?.[0];
	if (!file) return;
	const reader = new FileReader();
	reader.onload = (ev) => {
		try {
			const data = JSON.parse(ev.target?.result);
			if (!data.subtitles || !data.rowStates) { showAlert("올바른 작업 파일이 아닙니다."); return; }
			state.subtitles = data.subtitles;
			state.rowStates = data.rowStates;
			state.trashBin = data.trashBin || [];
			state.nextId = data.nextId || 1;
		// 트랙 복원 + localStorage에도 저장
		if (data.trackValue) {
			const trackSel = document.getElementById("trackSel");
			if (trackSel) {
				trackSel.value = data.trackValue;
				_saveTrackToStorage();
			}
		}
			// 프리셋 없는 고아 presetId 정리 + 색상 맵 재구성
			_sanitizeOrphanPresets();
			renderAll();
			renderTrash();
			updateMultiSelect();
			saveSessionToStorage();
			setStatus("작업 불러오기: " + file.name + " (" + state.subtitles.length + "개)", "ok");
		} catch (_) {
			showAlert("JSON 파일 파싱 실패. 올바른 작업 파일인지 확인하세요.");
		}
	};
	reader.readAsText(file, "UTF-8");
	input.value = "";
});

// ── 히스토리 기능 ──
// 자동저장/수동저장 각각 최대 20개, 별도 파일로 관리
const HISTORY_MAX = 20;
function _loadHistoryList(isManual) {
	try {
		const path = isManual ? _getHistoryManualPath() : _getHistoryPath();
		if (!path) return [];
		const data = _fsRead(path);
		return Array.isArray(data) ? data : [];
	} catch(_) { return []; }
}
function _saveHistoryList(list, isManual) {
	try {
		const path = isManual ? _getHistoryManualPath() : _getHistoryPath();
		if (path) _fsWrite(path, list);
	} catch(_) {}
}
function _saveHistory(label, isManual) {
	if (state.subtitles.length === 0) return;
	try {
		const list = _loadHistoryList(isManual);
		const entry = {
			ts: Date.now(),
			label: label || (isManual ? "수동저장" : "자동저장"),
			isManual: !!isManual,
			sequenceKey: state.currentSequenceKey,
			subtitles: JSON.parse(JSON.stringify(state.subtitles)),
			rowStates: JSON.parse(JSON.stringify(state.rowStates)),
			trashBin: JSON.parse(JSON.stringify(state.trashBin)),
			nextId: state.nextId,
			trackValue: document.getElementById("trackSel")?.value ?? "2"
		};
		list.unshift(entry);
		if (list.length > HISTORY_MAX) list.length = HISTORY_MAX;
		_saveHistoryList(list, isManual);
		_updateHistoryBtn();
	} catch(_) {}
}
function _updateHistoryBtn() {
	try {
		const autoList = _loadHistoryList(false);
		const manualList = _loadHistoryList(true);
		const btn = document.getElementById("btnHistory");
		if (btn) btn.classList.toggle("has-history", autoList.length > 0 || manualList.length > 0);
	} catch(_) {}
}
function _buildHistoryDropdown() {
	const dropdown = document.getElementById("historyDropdown");
	if (!dropdown) return;
	dropdown.innerHTML = "";
	try {
		const autoList = _loadHistoryList(false);
		const manualList = _loadHistoryList(true);
		// ── 수동저장 섹션 (항상 표시) ──
		const manualSection = document.createElement("div");
		manualSection.style.cssText = "border-bottom:1px solid #333;padding:5px 10px 6px;";
		// 섹션 헤더
		const manualHeader = document.createElement("div");
		manualHeader.style.cssText = "font-size:10px;color:#888;margin-bottom:4px;display:flex;align-items:center;justify-content:space-between;";
		manualHeader.innerHTML = '<span>수동저장 <span style="color:#555;">' + manualList.length + '/20</span></span>';
		manualSection.appendChild(manualHeader);
		// 이름 입력 + 저장 버튼
		const saveNowRow = document.createElement("div");
		saveNowRow.style.cssText = "display:flex;align-items:center;gap:6px;";
		const saveInput = document.createElement("input");
		saveInput.type = "text";
		saveInput.placeholder = "이름 입력 (선택)";
		saveInput.style.cssText = "flex:1;font-size:10px;padding:2px 6px;background:#1a1a1a;border:1px solid #444;color:#ccc;border-radius:3px;min-width:0;";
		saveInput.addEventListener("click", (e) => e.stopPropagation());
		const saveBtn = document.createElement("button");
		saveBtn.textContent = "저장";
		saveBtn.style.cssText = "font-size:10px;padding:2px 8px;background:#1a3a1a;border:1px solid #3a6a3a;color:#81c784;border-radius:3px;cursor:pointer;white-space:nowrap;flex-shrink:0;";
		saveBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			const label = saveInput.value.trim() || "수동저장";
			_saveHistory(label, true);
			saveInput.value = "";
			_buildHistoryDropdown();
			setStatus("수동저장됨: " + label, "ok");
		});
		saveNowRow.appendChild(saveInput);
		saveNowRow.appendChild(saveBtn);
		manualSection.appendChild(saveNowRow);
		// 수동저장 목록
		if (manualList.length > 0) {
			const manualListWrap = document.createElement("div");
			manualListWrap.style.cssText = "margin-top:4px;max-height:120px;overflow-y:auto;";
			manualList.forEach((entry, idx) => {
				manualListWrap.appendChild(_makeHistoryItem(entry, idx, true));
			});
			manualSection.appendChild(manualListWrap);
		}
		dropdown.appendChild(manualSection);
		// ── 자동저장 섹션 ──
		const autoSection = document.createElement("div");
		autoSection.style.cssText = "padding:5px 10px 6px;";
		const autoHeader = document.createElement("div");
		autoHeader.style.cssText = "font-size:10px;color:#888;margin-bottom:4px;";
		autoHeader.innerHTML = '자동저장 <span style="color:#555;">' + autoList.length + '/20</span>';
		autoSection.appendChild(autoHeader);
		if (autoList.length === 0) {
			const empty = document.createElement("div");
			empty.style.cssText = "font-size:11px;color:#555;padding:2px 0;";
			empty.textContent = "자동저장 없음";
			autoSection.appendChild(empty);
		} else {
			const autoListWrap = document.createElement("div");
			autoListWrap.style.cssText = "max-height:120px;overflow-y:auto;";
			autoList.forEach((entry, idx) => {
				autoListWrap.appendChild(_makeHistoryItem(entry, idx, false));
			});
			autoSection.appendChild(autoListWrap);
		}
		dropdown.appendChild(autoSection);
	} catch(_) {}
}
function _makeHistoryItem(entry, idx, isManual) {
	const item = document.createElement("div");
	item.className = "history-item";
	const d = new Date(entry.ts);
	const timeStr = d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
	const dateStr = d.toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" });
	const infoWrap = document.createElement("div");
	infoWrap.style.cssText = "display:flex;align-items:center;gap:6px;flex:1;min-width:0;cursor:pointer;";
	infoWrap.innerHTML =
		'<span class="hist-time">' + dateStr + ' ' + timeStr + '</span>' +
		'<span class="hist-label">' + (entry.label || (isManual ? "수동저장" : "자동저장")) + '</span>' +
		'<span class="hist-count">' + (entry.subtitles ? entry.subtitles.length : 0) + '개</span>';
	infoWrap.title = "이 시점으로 복원";
	infoWrap.addEventListener("click", (e) => {
		e.stopPropagation();
		showConfirm(
			"[" + dateStr + " " + timeStr + "] " + (entry.label || (isManual ? "수동저장" : "자동저장")) + "\n" +
			(entry.subtitles ? entry.subtitles.length : 0) + "개 자막\n\n이 시점으로 복원하시겠습니까?",
			() => {
				state.subtitles = entry.subtitles;
				state.rowStates = entry.rowStates;
				state.trashBin = entry.trashBin || [];
				state.nextId = entry.nextId || 1;
				if (entry.trackValue) {
					const trackSel = document.getElementById("trackSel");
					if (trackSel) trackSel.value = entry.trackValue;
				}
				_sanitizeOrphanPresets();
				renderAll();
				renderTrash();
				updateMultiSelect();
				saveSessionToStorage();
				const dd = document.getElementById("historyDropdown");
				if (dd) dd.classList.remove("open");
				setStatus("히스토리 복원: " + (entry.subtitles ? entry.subtitles.length : 0) + "개", "ok");
			}
		);
	});
	const delBtn = document.createElement("button");
	delBtn.textContent = "×";
	delBtn.title = "이 히스토리 삭제";
	delBtn.style.cssText = "font-size:12px;padding:0 5px;background:none;border:none;color:#666;cursor:pointer;flex-shrink:0;line-height:1;";
	delBtn.addEventListener("mouseenter", () => { delBtn.style.color = "#f44336"; });
	delBtn.addEventListener("mouseleave", () => { delBtn.style.color = "#666"; });
	delBtn.addEventListener("click", (e) => {
		e.stopPropagation();
		try {
			const list2 = _loadHistoryList(isManual);
			list2.splice(idx, 1);
			_saveHistoryList(list2, isManual);
			_updateHistoryBtn();
			_buildHistoryDropdown();
			setStatus("히스토리 삭제됨", "ok");
		} catch(_) {}
	});
	item.appendChild(infoWrap);
	item.appendChild(delBtn);
	return item;
}
const _btnHistory = document.getElementById("btnHistory");
_btnHistory?.addEventListener("click", (e) => {
	e.stopPropagation();
	_buildHistoryDropdown();
	const dropdown = document.getElementById("historyDropdown");
	if (dropdown) dropdown.classList.toggle("open");
});
document.addEventListener("click", (e) => {
	const wrap = document.getElementById("historyWrap");
	if (wrap && !wrap.contains(e.target)) {
		const dd = document.getElementById("historyDropdown");
		if (dd) dd.classList.remove("open");
	}
});
// 자동저장: 5분 무작업 시 히스토리 저장
let _lastActivityTime = Date.now();
const _activityEvents = ["click", "keydown", "input", "change"];
_activityEvents.forEach((ev) => {
	document.addEventListener(ev, () => { _lastActivityTime = Date.now(); }, { passive: true });
});
setInterval(() => {
	if (state.subtitles.length === 0) return;
	const idle = Date.now() - _lastActivityTime;
	if (idle >= 5 * 60 * 1000) { // 5분
	_saveHistory("자동저장 (5분 무작업)", false);
	_lastActivityTime = Date.now(); // 중복 저장 방지
	}
}, 60 * 1000); // 1분마다 체크
// 주요 작업 시 히스토리 저장 지점 등록 (SRT 로드, 타임라인 적용)
// 이 함수를 호출하는 코드는 아래 srtInput/btnApply 핸들러에서 호출됨
function _saveHistoryOnAction(label) { _saveHistory(label, false); }
// 히스토리 버튼 초기 상태 업데이트
_updateHistoryBtn();
