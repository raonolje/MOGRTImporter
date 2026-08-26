var _setStatus$1 = () => {};

// ─── 싱글톤 폰트 모달 (전역 1개) ───────────────────────────────
var _fontModalEl = null;
var _fontModalCallback = null;
var _fontModalCurrentFont = "";
var _fontModalList = [];

function _ensureFontModal() {
if (_fontModalEl) return _fontModalEl;
var overlay = document.createElement("div");
overlay.className = "mogrt-font-modal-overlay";
overlay.style.display = "none";
// #presetEditBox에 position:absolute; inset:0으로 붙임 → #presetEditBox 전체를 덮음
overlay.style.position = "absolute";
overlay.style.top = "0";
overlay.style.left = "0";
overlay.style.right = "0";
overlay.style.bottom = "0";
overlay.style.zIndex = "9999";
var box = document.createElement("div");
box.className = "mogrt-font-modal-box";
var header = document.createElement("div");
header.className = "mogrt-font-modal-header";
var titleSpan = document.createElement("span");
titleSpan.textContent = "폰트 선택";
var closeBtn = document.createElement("button");
closeBtn.type = "button";
closeBtn.className = "mogrt-font-modal-close";
closeBtn.textContent = "✕";
closeBtn.addEventListener("click", function() { _closeFontModal(); });
header.appendChild(titleSpan);
header.appendChild(closeBtn);
var searchInp = document.createElement("input");
searchInp.type = "text";
searchInp.className = "mogrt-font-search";
searchInp.placeholder = "폰트 검색...";
searchInp.id = "_gFontSearch";
var listEl = document.createElement("ul");
listEl.className = "mogrt-font-list";
listEl.id = "_gFontList";
box.appendChild(header);
box.appendChild(searchInp);
box.appendChild(listEl);
overlay.appendChild(box);
overlay.addEventListener("click", function(e) { if (e.target === overlay) _closeFontModal(); });
document.addEventListener("keydown", function(e) { if (e.key === "Escape" && overlay.style.display !== "none") _closeFontModal(); });
searchInp.addEventListener("input", function() { _renderFontModalItems(searchInp.value); });
// #presetEditModal에 붙임 (position:fixed; inset:0; overflow:hidden → 스크롤 없음 → absolute 자식이 모달 전체를 덮음)
var editModal = document.getElementById("presetEditModal");
if (editModal) {
	editModal.appendChild(overlay);
} else {
	document.body.appendChild(overlay);
}
_fontModalEl = overlay;
return overlay;
}

function _renderFontModalItems(filter) {
var listEl = document.getElementById("_gFontList");
if (!listEl) return;
listEl.innerHTML = "";
var q = (filter || "").toLowerCase();
var filtered = q
	? _fontModalList.filter(function(f) { return f.display.toLowerCase().indexOf(q) !== -1 || f.postscript.toLowerCase().indexOf(q) !== -1; })
	: _fontModalList;
filtered.forEach(function(f) {
	var li = document.createElement("li");
	li.className = "mogrt-font-list-item" + (f.postscript === _fontModalCurrentFont ? " selected" : "");
	li.textContent = f.display;
	li.title = f.postscript;
	(function(fCopy) {
		li.addEventListener("click", function() {
			_fontModalCurrentFont = fCopy.postscript;
			_closeFontModal();
			if (_fontModalCallback) _fontModalCallback(fCopy.postscript, fCopy.display);
		});
	})(f);
	listEl.appendChild(li);
});
}

function _openFontModal(fontList, currentFont, callback) {
_ensureFontModal();
_fontModalList = fontList;
_fontModalCurrentFont = currentFont;
_fontModalCallback = callback;
var searchInp = document.getElementById("_gFontSearch");
if (searchInp) searchInp.value = "";
_renderFontModalItems("");
_fontModalEl.style.display = "flex";
if (searchInp) searchInp.focus();
setTimeout(function() {
	var sel = document.querySelector("#_gFontList .selected");
	if (sel) sel.scrollIntoView({ block: "center" });
}, 50);
}

function _closeFontModal() {
if (_fontModalEl) _fontModalEl.style.display = "none";
var searchInp = document.getElementById("_gFontSearch");
if (searchInp) searchInp.value = "";
}
// ────────────────────────────────────────────────────────────────

var modalState = {
	paramList: null,
	mogrtPath: "",
	presetId: null,
	exposedIndices: [],
	textParamIndex: -1,
	exposedFontFields: {},
	folderTree: null,
	selectedFolderPath: "__all__"
};
function initModal(setStatus) {
	_setStatus$1 = setStatus;
}
function openPresetModal(presetId) {
	const modal = document.getElementById("defaultModal");
	const modalBody = document.getElementById("defaultModalBody");
	const mogrtSel = document.getElementById("defaultMogrtSel");
	const nameInput = document.getElementById("presetNameInput");
	modalState.presetId = presetId;
	modalState.paramList = null;
	modalState.exposedIndices = [];
	modalState.textParamIndex = -1;
	modalState.exposedFontFields = {};
	_lastPreviewSrc = null;   // 모달 열릴 때마다 쓰네일 초기화
	modalBody.innerHTML = "<p style=\"color:#64b5f6;font-size:11px;padding:20px 0;text-align:center;\">MOGRT를 선택하면 파라미터를 설정할 수 있습니다.</p>";
	const previewArea = document.getElementById("modalPreviewArea");
	if (previewArea) previewArea.innerHTML = "";
	if (nameInput) nameInput.value = presetId && state.presets[presetId] ? state.presets[presetId].name : "";
	mogrtSel.innerHTML = "";
	const none = document.createElement("option");
	none.value = "";
	none.textContent = "-- MOGRT 선택 --";
	mogrtSel.appendChild(none);
	state.mogrtList.forEach((m) => {
		const opt = document.createElement("option");
		opt.value = m.path;
		opt.textContent = m.name;
		if (presetId && state.presets[presetId]?.mogrtPath === m.path) opt.selected = true;
		mogrtSel.appendChild(opt);
	});
	const currentPath = presetId ? state.presets[presetId]?.mogrtPath ?? "" : "";
	// 저장된 보기 상태 적용
	const gridEl = document.getElementById("mogrtPickerGrid");
	const savedView = localStorage.getItem("mogrtPickerView") || "card";
	if (gridEl) { gridEl.classList.toggle("list-view", savedView === "list"); }
	document.getElementById("btnMogrtViewCard")?.classList.toggle("active", savedView === "card");
	document.getElementById("btnMogrtViewList")?.classList.toggle("active", savedView === "list");
	// 폴더 트리 로드 (캐시 우선 사용)
	modalState.selectedFolderPath = "__all__";
	const statusEl = document.getElementById("mogrtPickerStatus");
	function _applyFolderTree(tree) {
		modalState.folderTree = tree;
		// mogrtList 동기화 (트리에서 수집)
		const collected = [];
		collectMogrtsFromTree(tree, collected);
		collected.forEach((item) => {
			if (!state.mogrtList.some((m) => m.path === item.path)) {
				state.mogrtList.push(item);
				const opt = document.createElement("option");
				opt.value = item.path;
				opt.textContent = item.name;
				mogrtSel.appendChild(opt);
			}
		});
		// 루트 폴더를 기본 선택으로 설정 (신규 프리셋 추가 시)
		if (!currentPath && tree) {
			modalState.selectedFolderPath = tree.path;
		}
		// 폴더 트리 패널 렌더링 (선택 상태 포함)
		renderFolderTree();
		// 카드 렌더링 (전체 or 선택 폴더)
		renderMogrtPickerCards(currentPath);
		updatePickerLabel(currentPath);
		const statusEl2 = document.getElementById("mogrtPickerStatus");
		if (statusEl2) statusEl2.textContent = "";
	}
	if (window._cachedFolderTree) {
		// 캐시 있으면 즉시 렌더링
		_applyFolderTree(window._cachedFolderTree);
	} else {
		// 최초 1회만 JSX 호출
		if (statusEl) statusEl.textContent = "폴더 구조 로드 중...";
		evalScript("getMogrtFolderTree()").then((treeRes) => {
			if (treeRes && !treeRes.startsWith("ERROR")) {
				try {
					const tree = JSON.parse(treeRes);
					window._cachedFolderTree = tree; // 캐시 저장
					_applyFolderTree(tree);
				} catch (_) {}
			} else {
				const statusEl2 = document.getElementById("mogrtPickerStatus");
				if (statusEl2) statusEl2.textContent = "폴더 로드 실패";
			}
		});
	}
	modal.classList.add("open");
	// 시스템 폰트 캐시 로드 (최초 1회)
	if (!_cachedSystemFonts) {
		evalScript("getSystemFonts()").then((fontRes) => {
			if (fontRes && !fontRes.startsWith("ERROR")) {
				try { _cachedSystemFonts = JSON.parse(fontRes); } catch(_) {}
			}
		});
	}
	// 기존 프리셋 편집 시 2차 모달도 바로 열기
	if (presetId && state.presets[presetId]) {
		const editModal = document.getElementById("presetEditModal");
		const titleEl = document.getElementById("presetEditTitle");
		const found = state.mogrtList.find((m) => m.path === state.presets[presetId].mogrtPath);
		if (titleEl) titleEl.textContent = "⚙ " + (found ? found.name : state.presets[presetId].mogrtPath.split(/[\\/]/).pop()?.replace(/\.mogrt$/i, "") ?? "");
		if (editModal) editModal.classList.add("open");
		loadMogrtForModal(state.presets[presetId].mogrtPath, presetId);
		// 역방향 동기화 시작
		setTimeout(() => { if (typeof _startReverseSync === "function" && !_reverseSyncActive) _startReverseSync(); }, 3000);
	}
}
// definition.json 데이터로 params 배열의 드롭다운 옵션명, 슬라이더 min/max, 폰트명 보강
function patchParamsFromDefinition(params, def) {
	if (!def) return;

	// uiName 중첩 객체 파싱 헬퍼
	function getUIName(c) {
		if (!c) return "";
		const n = c.capPropUIName || c.uiName || c.displayName || "";
		if (typeof n === "string") return n;
		// {strDB:[{localeString:"en_US",str:"..."}]} 형태
		try { return n.strDB?.[0]?.str || ""; } catch(_) { return ""; }
	}

	// menucontent 에서 옵션 문자열 추출 헬퍼
	function extractMenuOptions(opts) {
		if (!Array.isArray(opts)) return [];
		return opts.map((o) => {
			if (typeof o === "string") return o;
			// {strDB:[{str:"..."}]} 형태
			if (o && o.strDB) try { return o.strDB[0]?.str || ""; } catch(_) {}
			return o.label || o.name || o.str || String(o);
		});
	}

	// capParams 우선 (평문 필드), 없으면 clientControls 사용
	const capParams = def.sourceInfoLocalized?.en_US?.capsuleparams?.capParams || null;
	const clientControls = def.clientControls || null;

	// displayName 기준 매핑 테이블 구성
	const capMap = {};
	if (Array.isArray(capParams)) {
		capParams.forEach((c) => {
			const name = getUIName(c);
			if (name) capMap[name] = c;
		});
	}
	const ctrlMap = {};
	if (Array.isArray(clientControls)) {
		clientControls.forEach((c) => {
			const name = getUIName(c);
			if (name) ctrlMap[name] = c;
		});
	}

	params.forEach((p) => {
		const cap = capMap[p.displayName];
		const ctrl = ctrlMap[p.displayName];

		// 드롭다운 옵션명 보강 (number로 잘못 감지된 경우도 포함)
		if (p.type === "dropdown" || p.type === "number") {
			// capParams의 menuContent (평문 배열) 우선
			const rawMenuOpts = cap?.menuContent || cap?.menucontent || null;
			const ctrlMenuOpts = ctrl?.menucontent || ctrl?.menuContent || null;
			const opts = rawMenuOpts
				? (Array.isArray(rawMenuOpts) ? rawMenuOpts : extractMenuOptions(rawMenuOpts))
				: extractMenuOptions(ctrlMenuOpts);
			if (Array.isArray(opts) && opts.length > 0) {
				p.dropdownOptions = opts.map((o) => (typeof o === "string" ? o : String(o)));
				// number로 잘못 감지된 경우 dropdown으로 강제 변환
				if (p.type === "number") p.type = "dropdown";
			}
		}

		// 슬라이더 min/max 보강
		if (p.type === "number") {
			// capParams의 capPropMin/Max 우선
			const defMin = cap?.capPropMin ?? ctrl?.min ?? null;
			const defMax = cap?.capPropMax ?? ctrl?.max ?? null;
			if (defMin !== null && defMin !== undefined) p.minValue = Number(defMin);
			if (defMax !== null && defMax !== undefined) p.maxValue = Number(defMax);
		}

		// 텍스트 폰트명 보강 (rawValue가 없거나 fontEditValue가 비어있을 때)
		if (p.type === "text") {
			// capParams에서 fontEditValue 배열 직접 추출
			const fontArr = cap?.fontEditValue || (ctrl?.fonteditinfo?.fontEditValue ? [ctrl.fonteditinfo.fontEditValue] : null);
			if (fontArr && fontArr.length > 0) {
				p.fontEditValue = fontArr; // 미리보기에서 직접 사용
				if (p.rawValue) {
					try {
						const rv = JSON.parse(p.rawValue);
						if (!rv.fontEditValue || rv.fontEditValue.length === 0) {
							rv.fontEditValue = fontArr;
							p.rawValue = JSON.stringify(rv);
						}
					} catch(_) {}
				}
			}

			// ★ capPropFontEdit 기반 fontExposed 보강
			// definition.json의 capPropFontEdit: true → 폰트 편집 가능
			// capPropFontEdit: false 또는 없음 → 텍스트 내용만 편집 가능
			const capFontEdit = cap?.capPropFontEdit ?? ctrl?.fonteditinfo?.capPropFontEdit ?? null;
			if (capFontEdit === true) {
				// 폰트 편집 가능: fontExposed를 true로 설정
				p.fontExposed = true;
			} else if (capFontEdit === false) {
				// 폰트 편집 불가: fontExposed를 false로 명시
				p.fontExposed = false;
			}
			// capFontEdit === null: hostscript.jsx의 fontExposed 값 유지
		}
	});
}

function loadMogrtForModal(mogrtPath, presetId) {
	const modalBody = document.getElementById("defaultModalBody");

	// 캐시된 파라미터가 있으면 즉시 사용 (evalScript 호출 생략)
	if (state.mogrtOriginals[mogrtPath]) {
		_applyMogrtParamsToModal(state.mogrtOriginals[mogrtPath], mogrtPath, presetId);
		return;
	}

	modalBody.innerHTML = "<p style=\"color:#64b5f6;font-size:11px;padding:10px 0;text-align:center;\">파라미터 로드 중... (최대 90초)</p><p style=\"color:#aaa;font-size:10px;padding:0;text-align:center;\">첫 번째 로드는 Premiere가 MOGRT를 초기화하는 시간이 필요합니다.<br>두 번째부터는 즉시 로드됩니다.</p>";
	const esc = mogrtPath.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
	let timedOut = false;
	const timeoutId = setTimeout(() => {
		timedOut = true;
		modalBody.innerHTML = "<p style=\"color:#f44336;font-size:11px;padding:10px 0;\">파라미터 로드 타임아웃 (90초 초과). MOGRT 파일이 유효한지 확인하거나 Premiere Pro를 재시작하세요.</p>";
	}, 9e4);
	evalScript(`getMogrtParams("${esc}")`).then((res) => {
		if (timedOut) return;
		clearTimeout(timeoutId);
		if (!res || res.startsWith("ERROR")) {
			modalBody.innerHTML = `<p style="color:#f44336;font-size:11px;padding:10px 0;">파라미터 로드 실패: ${res || ""}</p>`;
			return;
		}
		try {
			// getMogrtParams는 {params, mogrtPath} 객체 또는 기존 배열 형태 모두 지원
			const parsed = JSON.parse(res);
			const freshList = Array.isArray(parsed) ? parsed : (parsed.params || []);
			if (!state.mogrtOriginals[mogrtPath]) state.mogrtOriginals[mogrtPath] = JSON.parse(JSON.stringify(freshList));
			const existingPreset = presetId ? state.presets[presetId] : null;
			if (existingPreset) freshList.forEach((p) => {
				const ep = existingPreset.params.find((ep2) => ep2.index === p.index);
				if (ep) {
					p.value = ep.value;
					if (ep.rawValue !== void 0) p.rawValue = ep.rawValue;
					if (ep.colorHex !== void 0) p.colorHex = ep.colorHex;
				}
			});
			modalState.paramList = freshList;
			modalState.mogrtPath = mogrtPath;
			modalState.presetId = presetId;
			if (existingPreset) {
				modalState.exposedIndices = [...existingPreset.exposedIndices];
				modalState.textParamIndex = existingPreset.textParamIndex ?? -1;
				modalState.exposedFontFields = existingPreset.exposedFontFields ? JSON.parse(JSON.stringify(existingPreset.exposedFontFields)) : {};
			} else {
				const defaultExposed = [];
				let defaultTextIdx = -1;
				freshList.forEach((p) => {
					if (p.type === "text") {
						defaultExposed.push(p.index);
						if (defaultTextIdx === -1) defaultTextIdx = p.index;
					}
				});
				modalState.exposedIndices = defaultExposed;
				modalState.textParamIndex = defaultTextIdx;
				// ★ hostscript.jsx의 p.numItems 기반 exposedFontFields를 그대로 사용
				// entry.exposedFontFields: 실제 MOGRT Properties 패널에 노출된 폰트 필드 목록
				// - 빈 배열 [] → 텍스트만 표시
				// - ["font","size",...] → 해당 필드만 표시
				const initFontFields = {};
				freshList.forEach((p) => {
					if (p.type === "text") {
						if (Array.isArray(p.exposedFontFields)) {
							// hostscript에서 계산된 값 직접 사용
							initFontFields[p.index] = p.exposedFontFields;
						} else if (p.fontExposed === true) {
							// exposedFontFields 없으면 fontExposed 기반 폴백
							initFontFields[p.index] = ["font", "size", "bold", "italic", "allcaps", "smallcaps"];
						} else {
							initFontFields[p.index] = [];
						}
					}
				});
				modalState.exposedFontFields = initFontFields;
			}
			// definition.json 파싱으로 드롭다운 옵션명, 슬라이더 min/max, 폰트명 보강
			if (typeof JSZip !== "undefined" && window.cep && window.cep.fs) {
				try {
					const readResult = window.cep.fs.readFile(mogrtPath, window.cep.encoding.Base64);
					if (readResult.err === 0 && readResult.data) {
						JSZip.loadAsync(readResult.data, {base64: true}).then((zip) => {
							const defEntry = zip.file("definition.json");
							if (!defEntry) { renderModalLayout(modalBody, freshList, mogrtPath); return; }
							return defEntry.async("string").then((defStr) => {
							try {
								const def = JSON.parse(defStr);
								patchParamsFromDefinition(freshList, def);
							} catch(_) {}
							// patchParamsFromDefinition 이후 신규 프리셋이면 fontExposed 기반으로 exposedFontFields 재계산
							if (!presetId) {
								const recomputed = {};
								freshList.forEach((p) => {
									if (p.type === "text") {
										if (p.fontExposed === true) {
											// hostscript에서 계산된 exposedFontFields가 있으면 그대로 사용
											// 없을 때만 전체 배열로 폴백 (하위 호환)
											recomputed[p.index] = Array.isArray(p.exposedFontFields) && p.exposedFontFields.length > 0
												? p.exposedFontFields
												: ["font", "size", "bold", "italic", "allcaps", "smallcaps"];
										} else {
											recomputed[p.index] = [];
										}
									}
								});
								modalState.exposedFontFields = recomputed;
							}
							renderModalLayout(modalBody, freshList, mogrtPath);
							});
						}).catch(() => renderModalLayout(modalBody, freshList, mogrtPath));
						return; // renderModalLayout은 Promise 내부에서 호출
					}
				} catch(_) {}
			}
			renderModalLayout(modalBody, freshList, mogrtPath);
		} catch (ex) {
			clearTimeout(timeoutId);
			modalBody.innerHTML = `<p style="color:#f44336;font-size:11px;padding:10px 0;">파싱 오류: ${ex.message}</p>`;
		}
	});
}
// 캐시 히트 시 또는 evalScript 완료 후 공통으로 모달에 파라미터 적용
function _applyMogrtParamsToModal(cachedList, mogrtPath, presetId) {
	const modalBody = document.getElementById("defaultModalBody");
	// 깊은 복사로 원본 캐시 보호
	const freshList = JSON.parse(JSON.stringify(cachedList));
	const existingPreset = presetId ? state.presets[presetId] : null;
	if (existingPreset) freshList.forEach((p) => {
		const ep = existingPreset.params.find((ep2) => ep2.index === p.index);
		if (ep) {
			p.value = ep.value;
			if (ep.rawValue !== void 0) p.rawValue = ep.rawValue;
			if (ep.colorHex !== void 0) p.colorHex = ep.colorHex;
		}
	});
	modalState.paramList = freshList;
	modalState.mogrtPath = mogrtPath;
	modalState.presetId = presetId;
	if (existingPreset) {
		modalState.exposedIndices = [...existingPreset.exposedIndices];
		modalState.textParamIndex = existingPreset.textParamIndex ?? -1;
		modalState.exposedFontFields = existingPreset.exposedFontFields ? JSON.parse(JSON.stringify(existingPreset.exposedFontFields)) : {};
	} else {
		const defaultExposed = [];
		let defaultTextIdx = -1;
		freshList.forEach((p) => {
			if (p.type === "text") {
				defaultExposed.push(p.index);
				if (defaultTextIdx === -1) defaultTextIdx = p.index;
			}
		});
		modalState.exposedIndices = defaultExposed;
		modalState.textParamIndex = defaultTextIdx;
		const initFontFields = {};
		freshList.forEach((p) => {
			if (p.type === "text") {
				if (Array.isArray(p.exposedFontFields)) {
					initFontFields[p.index] = p.exposedFontFields;
				} else if (p.fontExposed === true) {
					initFontFields[p.index] = ["font", "size", "bold", "italic", "allcaps", "smallcaps"];
				} else {
					initFontFields[p.index] = [];
				}
			}
		});
		modalState.exposedFontFields = initFontFields;
	}
	renderModalLayout(modalBody, freshList, mogrtPath);
}

function renderModalLayout(container, list, mogrtPath) {
	container.innerHTML = "";
	const previewArea = document.getElementById("modalPreviewArea");
	if (previewArea) {
		previewArea.innerHTML = "";
		const previewPanel = buildPreviewPanel(list, mogrtPath);
		previewArea.appendChild(previewPanel);
		// 프리뷰 시퀀스 자동 초기화 제거 (PP 26.2.2 호환성 문제로 비활성화)
	}
	const guide = document.createElement("p");
	guide.className = "modal-guide";
	guide.innerHTML = "<b>☑ 노출</b>: SRT 편집 시 이 속성을 표시합니다. &nbsp; <b style=\"color:#4caf50\">T</b>: SRT 자막 텍스트가 자동 입력됩니다.";
	container.appendChild(guide);
	renderModalParams(container, list, mogrtPath);
}
function buildPreviewPanel(list, mogrtPath) {
	const panel = document.createElement("div");
	panel.className = "modal-preview-panel";

	// --- 이미지 표시 영역 (항상 표시) ---
	const imgArea = document.createElement("div");
	imgArea.id = "modalPreviewImgArea";
	imgArea.className = "modal-preview-img-area";

	const img = document.createElement("img");
	img.id = "modalPreviewImg";
	img.className = "modal-preview-img";

	const statusEl = document.createElement("div");
	statusEl.id = "modalPreviewStatus";
	statusEl.className = "modal-preview-status";
	statusEl.textContent = "프리뷰 준비 중...";
	statusEl.style.color = "#aaa";

	imgArea.appendChild(img);
	imgArea.appendChild(statusEl);
	panel.appendChild(imgArea);

	// 모달 열릴 때 자동 캐처 - 중복 예약 방지 (definition.json 파싱 후 renderModalLayout 재호출 시 중복 실행됨)
	_previewMogrtPath = mogrtPath;
	_previewParamList = list;
	if (_previewAutoTimer) { clearTimeout(_previewAutoTimer); _previewAutoTimer = null; }
	_previewAutoTimer = setTimeout(() => {
		_previewAutoTimer = null;
		runPreviewCapture(mogrtPath, list);
	}, 1200);
	return panel;
}

// 프리뷰 별도 창 기능 제거 (팝업 차단 문제로 삭제)
function _updatePreviewWindowFile(src) {
	// 프리뷰 별도 창 기능 제거됨 - 아무 동작 안 함
}
// 프리뷰 캡처 실행 (버튼 클릭 시)
let _previewRunning = false;
let _previewDebounceTimer = null;
let _previewAutoTimer = null;   // buildPreviewPanel 자동 캡처 중복 방지용
let _previewMogrtPath = null;
let _previewParamList = null;
let _lastPreviewSrc = null;   // 마지막 캡처된 프리뷰 data URL (프리셋 저장 시 썸네일로 사용)
async function runPreviewCapture(mogrtPath, list) {
	if (_previewRunning) return;
	_previewRunning = true;
	const statusEl = document.getElementById("modalPreviewStatus");
	const imgArea = document.getElementById("modalPreviewImgArea");
	const img = document.getElementById("modalPreviewImg");
	if (statusEl) { statusEl.textContent = "시퀀스 생성 중..."; statusEl.style.color = "#aaa"; }
	try {
		// 1. 프리뷰 시퀀스 생성 + mogrt 삽입
		const setupRes = await evalScriptWithPayload("setupPreviewSequence", {
			mogrtPath: mogrtPath,
			durationSec: 5
		});
		if (!setupRes.startsWith("SUCCESS")) {
			if (statusEl) { statusEl.textContent = "시퀀스 생성 실패: " + setupRes; statusEl.style.color = "#f66"; }
			_previewRunning = false;
			return;
		}
		if (statusEl) statusEl.textContent = "파라미터 적용 중...";
		// 2. 현재 파라미터 적용
		const applyRes = await evalScriptWithPayload("applyPreviewParams", { params: list });
		// 적용 실패해도 캡처 시도
		if (statusEl) statusEl.textContent = "프레임 캡처 중...";
		// 3. 프레임 캡처
		let tmpDir = "C:/Temp";
		try {
			const tmpDirRes = await evalScript('$.getenv("TEMP") || $.getenv("TMP") || "C:/Temp"');
			if (tmpDirRes && tmpDirRes.length > 2) tmpDir = tmpDirRes.replace(/\\/g, "/");
		} catch(_) {}
		const tmpPath = tmpDir + "/mogrt_preview_" + Date.now() + ".jpg";
		const captureRes = await evalScriptWithPayload("capturePreviewFrame", { outputPath: tmpPath });
		let savedPath = "";
		if (captureRes.startsWith("SUCCESS:")) {
			savedPath = captureRes.replace("SUCCESS:", "").trim();
		} else if (captureRes.startsWith("PENDING:")) {
			// exportFrameJPEG가 비동기로 동작 → JS에서 폴링
			const pendingPath = captureRes.replace("PENDING:", "").trim();
			if (statusEl) statusEl.textContent = "PP 익스포트 대기 중...";
			let found = false;
			for (let pi = 0; pi < 120; pi++) {
				await new Promise(r => setTimeout(r, 500));
				if (statusEl) statusEl.textContent = `PP 익스포트 대기 중... (${Math.round((pi+1)*0.5)}s)`;
			if (window.cep && window.cep.fs) {
				// readFile로 직접 읽기 시도 (슬래시/백슬래시 두 버전)
				const pathFwd = pendingPath.replace(/\\/g, "/");
				const pathBack = pendingPath.replace(/\//g, "\\");
				const r1 = window.cep.fs.readFile(pathFwd, window.cep.encoding.Base64);
				if (r1.err === 0 && r1.data && r1.data.length > 100) {
					const src1 = `data:image/jpeg;base64,${r1.data}`;
				_lastPreviewSrc = src1;
				if (img) img.src = src1;
				_updatePreviewWindowFile(src1);
				if (statusEl) { statusEl.textContent = "✓ 프리뷰 캐처 완료"; statusEl.style.color = "#4caf50"; }
						try { window.cep.fs.deleteFile(pathFwd); } catch(_) {}
						_previewRunning = false;
						return;
					}
					const r2 = window.cep.fs.readFile(pathBack, window.cep.encoding.Base64);
					if (r2.err === 0 && r2.data && r2.data.length > 100) {
					const src2 = `data:image/jpeg;base64,${r2.data}`;
				_lastPreviewSrc = src2;
				if (img) img.src = src2;
				_updatePreviewWindowFile(src2);
				if (statusEl) { statusEl.textContent = "✓ 프리뷰 캐처 완료"; statusEl.style.color = "#4caf50"; }
						try { window.cep.fs.deleteFile(pathBack); } catch(_) {}
						_previewRunning = false;
						return;
					}
			}
			}
			if (!found) {
				if (statusEl) { statusEl.textContent = "익스포트 시간 초과 (60초)"; statusEl.style.color = "#f66"; }
				_previewRunning = false;
				return;
			}
		} else {
			if (statusEl) { statusEl.textContent = "캡처 실패: " + captureRes; statusEl.style.color = "#f66"; }
			_previewRunning = false;
			return;
		}
		// 4. 이미지 표시
		if (img && window.cep && window.cep.fs) {
			const readRes = window.cep.fs.readFile(savedPath, window.cep.encoding.Base64);
			if (readRes.err === 0 && readRes.data) {
				const ext = savedPath.endsWith(".png") ? "png" : "jpeg";
					const finalSrc = `data:image/${ext};base64,${readRes.data}`;
					_lastPreviewSrc = finalSrc;
					img.src = finalSrc;
					_updatePreviewWindowFile(finalSrc);
					if (statusEl) { statusEl.textContent = "✓ 프리뷰 캐처 완료"; statusEl.style.color = "#4caf50"; }
					try { window.cep.fs.deleteFile(savedPath); } catch(_) {}
			} else {
				if (statusEl) { statusEl.textContent = "이미지 읽기 실패 (err: " + readRes.err + ")"; statusEl.style.color = "#f66"; }
			}
		} else {
			if (statusEl) { statusEl.textContent = "캡처 완료: " + savedPath; statusEl.style.color = "#4caf50"; }
		}
	} catch(err) {
		if (statusEl) { statusEl.textContent = "오류: " + err.message; statusEl.style.color = "#f66"; }
	}
	_previewRunning = false;
}
function extractPreviewValues(list) {
	// 첫 번째 text 타입 파라미터 (전체 텍스트)
	const textParam = list.find((p) => p.type === "text");
	let text = "샘플 자막 텍스트";
	let fontFamily = "";
	let fontSize = 60;
	let isBold = false;
	let isItalic = false;
	if (textParam?.rawValue) try {
		const parsed = JSON.parse(textParam.rawValue);
		text = parsed.textEditValue || textParam.value || text;
		// PostScript 폰트명 → CSS font-family 변환 (rawValue 또는 patchParamsFromDefinition이 주입한 fontEditValue)
		const rawFont = parsed.fontEditValue?.[0] || textParam.fontEditValue?.[0] || "";
		function toCSS(f) { return f.replace(/TTF-/gi, " ").replace(/OTF-/gi, " ").replace(/-/g, " ").trim() || f; }
		fontFamily = toCSS(rawFont);
		fontSize = parsed.fontSizeEditValue?.[0] || 60;
		isBold = parsed.fontFSBoldValue?.[0] || false;
		isItalic = parsed.fontFSItalicValue?.[0] || false;
	} catch (_) {}
	else if (textParam) {
		text = textParam.value || text;
		// patchParamsFromDefinition이 주입한 fontEditValue 사용
		const rawFont = textParam.fontEditValue?.[0] || "";
		if (rawFont) fontFamily = rawFont.replace(/TTF-/gi, " ").replace(/OTF-/gi, " ").replace(/-/g, " ").trim() || rawFont;
	}

	// 색상: 전체 텍스트 그룹 내 첫 번째 color 타입 우선
	let color = "#ffffff";
	const textGroupName = textParam?.group || "";
	const colorParam = textGroupName
		? list.find((p) => p.type === "color" && p.group === textGroupName)
		: list.find((p) => p.type === "color");
	if (colorParam) color = colorParam.colorHex || packedToHex(parsePackedColor(colorParam.rawValue));

	// 자간 (letter-spacing): 전체 텍스트 그룹 내 자간 파라미터
	let letterSpacing = 0;
	const spacingParam = list.find((p) => p.type === "number" &&
		(p.displayName === "자간" || p.displayName === "Tracking" || p.displayName === "Letter Spacing") &&
		(!textGroupName || p.group === textGroupName));
	if (spacingParam) letterSpacing = parseFloat(spacingParam.value) || 0;

	// 장평 (scaleX): 전체 텍스트 그룹 내 장평 파라미터
	let scaleX = 100;
	const scaleParam = list.find((p) => p.type === "number" &&
		(p.displayName === "장평" || p.displayName === "Horizontal Scale" || p.displayName === "Scale") &&
		(!textGroupName || p.group === textGroupName));
	if (scaleParam) scaleX = parseFloat(scaleParam.value) || 100;

	return {
		text,
		color,
		fontFamily,
		fontSize,
		isBold,
		isItalic,
		letterSpacing,
		scaleX
	};
}
// 파라미터 변경 시 디바운스 기반 실시간 갱신 트리거 (1초 후 자동 캡처)
function updatePreview(list) {
	if (_previewDebounceTimer) clearTimeout(_previewDebounceTimer);
	const mogrtPath = _previewMogrtPath;
	if (!mogrtPath) return;
	_previewDebounceTimer = setTimeout(() => {
		_previewDebounceTimer = null;
		runPreviewCapture(mogrtPath, list);
	}, 1000);
}
function renderModalParams(container, list, mogrtPath) {
	const groupBodies = {};
	let currentGroupEl = container;
	for (let pi = 0; pi < list.length; pi++) {
		const param = list[pi];
		const t = param.type;
		if (t === "group" || t === "textsetting") {
			const groupKey = param.displayName;
			const grpHdr = document.createElement("div");
			grpHdr.className = "mogrt-group-header";
			const arrow = document.createElement("span");
			arrow.className = "mogrt-group-arrow open";
			arrow.textContent = "▾";
			grpHdr.appendChild(arrow);
			const title = document.createElement("span");
			title.textContent = param.displayName;
			grpHdr.appendChild(title);
			const grpBody = document.createElement("div");
			grpBody.className = "mogrt-group-body";
			let open = true;
			grpHdr.addEventListener("click", () => {
				open = !open;
				grpBody.style.display = open ? "" : "none";
				arrow.textContent = open ? "▾" : "▸";
				arrow.className = "mogrt-group-arrow" + (open ? " open" : "");
			});
			container.appendChild(grpHdr);
			container.appendChild(grpBody);
			groupBodies[groupKey] = grpBody;
			currentGroupEl = grpBody;
			continue;
		}
		if (t === "comment") {
			const cmtEl = document.createElement("div");
			cmtEl.className = "mogrt-comment";
			cmtEl.textContent = param.displayName || param.value || "";
			(param.group ? groupBodies[param.group] || container : container).appendChild(cmtEl);
			continue;
		}
		const targetEl = param.group ? groupBodies[param.group] || currentGroupEl : currentGroupEl;
		const rowEl = buildModalParamRow(param, pi, list, mogrtPath, container);
		targetEl.appendChild(rowEl);
	}
}
function buildModalParamRow(param, pi, list, mogrtPath, container) {
	const t = param.type;
	const val = param.value ?? "";
	const isExposed = modalState.exposedIndices.includes(param.index);
	if (t === "text") return buildModalTextBlock(param, pi, list, mogrtPath, container);
	const rowEl = document.createElement("div");
	rowEl.className = "modal-mogrt-row";
	const chkExpose = document.createElement("input");
	chkExpose.type = "checkbox";
	chkExpose.className = "modal-expose-chk";
	chkExpose.checked = isExposed;
	chkExpose.title = "SRT 편집 시 노출";
	chkExpose.addEventListener("change", () => {
		const arr = modalState.exposedIndices;
		const pos = arr.indexOf(param.index);
		if (chkExpose.checked && pos === -1) arr.push(param.index);
		else if (!chkExpose.checked && pos !== -1) arr.splice(pos, 1);
	});
	rowEl.appendChild(chkExpose);
	const lbl = document.createElement("span");
	lbl.className = "modal-mogrt-label";
	lbl.textContent = param.displayName;
	rowEl.appendChild(lbl);
	const ctrl = document.createElement("div");
	ctrl.className = "modal-mogrt-ctrl";
	const resetBtn = document.createElement("button");
	resetBtn.textContent = "↺";
	resetBtn.title = "MOGRT 원본값으로 초기화";
	resetBtn.className = "modal-reset-btn";
					if (t === "color") {
			const hexColor = param.colorHex || packedToHex(parsePackedColor(param.rawValue));
			const swatchWrap = document.createElement("div");
			swatchWrap.className = "mogrt-color-swatch-wrap";
			swatchWrap.style.cursor = "pointer";
			const swatch = document.createElement("div");
			swatch.className = "mogrt-color-swatch";
			swatch.style.background = hexColor;
			swatchWrap.appendChild(swatch);
			swatchWrap.addEventListener("click", () => {
				CP.open(swatchWrap, list[pi].colorHex || hexColor, (newHex) => {
					swatch.style.background = newHex;
					list[pi].colorHex = newHex;
					list[pi].value = newHex;
					updatePreview(list);
				});
			});
			resetBtn.addEventListener("click", () => {
				const orig = (state.mogrtOriginals[mogrtPath] || []).find((o) => o.index === list[pi].index);
				if (orig) {
					list[pi].value = orig.value;
					list[pi].rawValue = orig.rawValue;
					delete list[pi].colorHex;
					const oh = orig.colorHex || packedToHex(parsePackedColor(orig.rawValue));
					swatch.style.background = oh;
					updatePreview(list);
				}
			});
			ctrl.appendChild(swatchWrap);
			ctrl.appendChild(resetBtn);
		} else if (t === "boolean") {
		const toggle = document.createElement("label");
		toggle.className = "mogrt-toggle";
		const inp = document.createElement("input");
		inp.type = "checkbox";
		inp.checked = val === "true";
		const slider = document.createElement("span");
		slider.className = "mogrt-toggle-slider";
		toggle.appendChild(inp);
		toggle.appendChild(slider);
		inp.addEventListener("change", () => {
			list[pi].value = String(inp.checked);
		});
		resetBtn.addEventListener("click", () => {
			const orig = (state.mogrtOriginals[mogrtPath] || []).find((o) => o.index === list[pi].index);
			if (orig) {
				list[pi].value = orig.value;
				inp.checked = orig.value === "true";
			}
		});
		ctrl.appendChild(toggle);
		ctrl.appendChild(resetBtn);
	} else if (t === "dropdown") {
		const sel = document.createElement("select");
		sel.className = "mogrt-dropdown";
		const opts = param.dropdownOptions || [];
		const curV = parseInt(val, 10) || 0;
		if (opts.length > 0) opts.forEach((opt, i) => {
			const o = document.createElement("option");
			o.value = String(i);
			o.textContent = opt;
			if (i === curV) o.selected = true;
			sel.appendChild(o);
		});
		else {
			const minV = Math.round(param.minValue ?? 0);
			const maxV = Math.round(param.maxValue ?? 10);
			for (let i = minV; i <= maxV; i++) {
				const o = document.createElement("option");
				o.value = String(i);
				o.textContent = String(i);
				if (i === curV) o.selected = true;
				sel.appendChild(o);
			}
		}
		sel.addEventListener("change", () => {
			list[pi].value = sel.value;
		});
		resetBtn.addEventListener("click", () => {
			const orig = (state.mogrtOriginals[mogrtPath] || []).find((o) => o.index === list[pi].index);
			if (orig) {
				list[pi].value = orig.value;
				sel.value = orig.value;
			}
		});
		ctrl.appendChild(sel);
		ctrl.appendChild(resetBtn);
	} else if (t === "number") {
		const numVal = parseFloat(val) || 0;
		const minV = param.minValue ?? (numVal < 0 ? Math.min(-100, Math.floor(numVal * 2)) : 0);
		const maxV = param.maxValue ?? (numVal > 100 ? Math.max(Math.ceil(numVal * 2), 200) : 100);
		const range = maxV - minV;
		const step = range > 100 ? "0.1" : range > 10 ? "0.1" : "0.01";
		const valLbl = document.createElement("span");
		valLbl.className = "mogrt-num-value mogrt-num-editable";
		valLbl.title = "클릭하여 직접 입력";
		valLbl.textContent = numVal % 1 === 0 ? String(numVal) : numVal.toFixed(1);
		const sliderEl = document.createElement("input");
		sliderEl.type = "range";
		sliderEl.className = "mogrt-slider";
		sliderEl.min = String(minV);
		sliderEl.max = String(maxV);
		sliderEl.step = step;
		sliderEl.value = String(numVal);
		// 값 레이블 클릭 시 인라인 입력 전환
		valLbl.addEventListener("click", () => {
			const inpEdit = document.createElement("input");
			inpEdit.type = "number";
			inpEdit.className = "mogrt-num-inline-input";
			inpEdit.value = list[pi].value;
			inpEdit.step = step;
			valLbl.replaceWith(inpEdit);
			inpEdit.focus();
			inpEdit.select();
			const commit = () => {
				const v = parseFloat(inpEdit.value);
				if (!isNaN(v)) {
					list[pi].value = String(v);
					sliderEl.value = String(Math.min(maxV, Math.max(minV, v)));
					valLbl.textContent = v % 1 === 0 ? String(v) : v.toFixed(1);
					updatePreview(list);
				}
				inpEdit.replaceWith(valLbl);
			};
			inpEdit.addEventListener("blur", commit);
			inpEdit.addEventListener("keydown", (e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") inpEdit.replaceWith(valLbl); });
		});
		sliderEl.addEventListener("input", () => {
			const v = parseFloat(sliderEl.value);
			valLbl.textContent = v % 1 === 0 ? String(v) : v.toFixed(1);
			list[pi].value = sliderEl.value;
			updatePreview(list);
		});
		resetBtn.addEventListener("click", () => {
			const orig = (state.mogrtOriginals[mogrtPath] || []).find((o) => o.index === list[pi].index);
			if (orig) {
				const v = parseFloat(orig.value) || 0;
				list[pi].value = orig.value;
				sliderEl.value = String(v);
				valLbl.textContent = v % 1 === 0 ? String(v) : v.toFixed(1);
				updatePreview(list);
			}
		});
		rowEl.className = "modal-mogrt-row modal-mogrt-row--slider";
		const topRow = document.createElement("div");
		topRow.className = "modal-mogrt-slider-top";
		topRow.appendChild(chkExpose);
		topRow.appendChild(lbl);
		topRow.appendChild(valLbl);
		topRow.appendChild(resetBtn);
		const sliderRow = document.createElement("div");
		sliderRow.className = "mogrt-slider-row";
		const minLbl = document.createElement("span");
		minLbl.className = "mogrt-range-lbl";
		minLbl.textContent = String(minV);
		const maxLbl = document.createElement("span");
		maxLbl.className = "mogrt-range-lbl";
		maxLbl.textContent = String(maxV);
		sliderRow.appendChild(minLbl);
		sliderRow.appendChild(sliderEl);
		sliderRow.appendChild(maxLbl);
		rowEl.innerHTML = "";
		rowEl.appendChild(topRow);
		rowEl.appendChild(sliderRow);
		return rowEl;
	} else if (t === "point") {
		const parts = val.split(",");
		let xVal = parseFloat(parts[0]) || 0;
		let yVal = parseFloat(parts[1]) || 0;
		const pointWrap = document.createElement("div");
		pointWrap.className = "mogrt-point-wrap mogrt-point-drag-wrap";
		// 드래그 입력 헬퍼: 값 레이블에 마우스 드래그로 증감
		function makeDragValue(axisLabel, initVal, onChange) {
			const wrap = document.createElement("div");
			wrap.className = "mogrt-drag-axis";
			const lbl = document.createElement("span");
			lbl.className = "mogrt-drag-axis-lbl";
			lbl.textContent = axisLabel;
			const valSpan = document.createElement("span");
			valSpan.className = "mogrt-drag-value";
			valSpan.title = "드래그하여 조절 / 더블클릭하여 직접 입력";
			valSpan.textContent = initVal % 1 === 0 ? String(initVal) : initVal.toFixed(1);
			let curVal = initVal;
			let dragStartX = 0, dragStartVal = 0, isDragging = false;
			valSpan.style.cursor = "ew-resize";
			valSpan.addEventListener("mousedown", (e) => {
				isDragging = true;
				dragStartX = e.clientX;
				dragStartVal = curVal;
				e.preventDefault();
				const onMove = (ev) => {
					if (!isDragging) return;
					const delta = (ev.clientX - dragStartX) * 1.0; // 1px = 1단위
					curVal = Math.round((dragStartVal + delta) * 10) / 10;
					valSpan.textContent = curVal % 1 === 0 ? String(curVal) : curVal.toFixed(1);
					onChange(curVal);
				};
				const onUp = () => {
					isDragging = false;
					document.removeEventListener("mousemove", onMove);
					document.removeEventListener("mouseup", onUp);
					updatePreview(list);
				};
				document.addEventListener("mousemove", onMove);
				document.addEventListener("mouseup", onUp);
			});
			// 더블클릭 시 인라인 입력 전환
			valSpan.addEventListener("dblclick", () => {
				const inp = document.createElement("input");
				inp.type = "number";
				inp.className = "mogrt-num-inline-input";
				inp.value = String(curVal);
				valSpan.replaceWith(inp);
				inp.focus(); inp.select();
				const commit = () => {
					const v = parseFloat(inp.value);
					if (!isNaN(v)) { curVal = v; valSpan.textContent = v % 1 === 0 ? String(v) : v.toFixed(1); onChange(v); updatePreview(list); }
					inp.replaceWith(valSpan);
				};
				inp.addEventListener("blur", commit);
				inp.addEventListener("keydown", (e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") inp.replaceWith(valSpan); });
			});
			wrap.appendChild(lbl);
			wrap.appendChild(valSpan);
			return wrap;
		}
		const xWrap = makeDragValue("X", xVal, (v) => { xVal = v; list[pi].value = xVal + "," + yVal; });
		const yWrap = makeDragValue("Y", yVal, (v) => { yVal = v; list[pi].value = xVal + "," + yVal; });
		pointWrap.appendChild(xWrap);
		pointWrap.appendChild(yWrap);
		resetBtn.addEventListener("click", () => {
			const orig = (state.mogrtOriginals[mogrtPath] || []).find((o) => o.index === list[pi].index);
			if (orig) { list[pi].value = orig.value; }
		});
		ctrl.appendChild(pointWrap);
		ctrl.appendChild(resetBtn);
	} else if (t === "angle") {
		let angleVal = parseFloat(val) || 0;
		// 드래그 입력 방식 (PP 프로퍼티스와 동일)
		const angleWrap = document.createElement("div");
		angleWrap.className = "mogrt-drag-axis";
		const angleLbl = document.createElement("span");
		angleLbl.className = "mogrt-drag-axis-lbl";
		angleLbl.textContent = "";
		const angleValSpan = document.createElement("span");
		angleValSpan.className = "mogrt-drag-value";
		angleValSpan.title = "드래그하여 조절 / 더블클릭하여 직접 입력";
		angleValSpan.style.cursor = "ew-resize";
		const degSuffix = document.createElement("span");
		degSuffix.className = "mogrt-angle-deg";
		degSuffix.textContent = " °";
		angleValSpan.textContent = angleVal % 1 === 0 ? String(angleVal) : angleVal.toFixed(1);
		let dragStartX2 = 0, dragStartVal2 = 0, isDragging2 = false;
		angleValSpan.addEventListener("mousedown", (e) => {
			isDragging2 = true;
			dragStartX2 = e.clientX;
			dragStartVal2 = angleVal;
			e.preventDefault();
			const onMove2 = (ev) => {
				if (!isDragging2) return;
				const delta = (ev.clientX - dragStartX2) * 0.5; // 2px = 1도
				angleVal = Math.round((dragStartVal2 + delta) * 10) / 10;
				angleValSpan.textContent = angleVal % 1 === 0 ? String(angleVal) : angleVal.toFixed(1);
				list[pi].value = String(angleVal);
			};
			const onUp2 = () => {
				isDragging2 = false;
				document.removeEventListener("mousemove", onMove2);
				document.removeEventListener("mouseup", onUp2);
				updatePreview(list);
			};
			document.addEventListener("mousemove", onMove2);
			document.addEventListener("mouseup", onUp2);
		});
		angleValSpan.addEventListener("dblclick", () => {
			const inp = document.createElement("input");
			inp.type = "number";
			inp.className = "mogrt-num-inline-input";
			inp.value = String(angleVal);
			angleValSpan.replaceWith(inp);
			inp.focus(); inp.select();
			const commit = () => {
				const v = parseFloat(inp.value);
				if (!isNaN(v)) { angleVal = v; angleValSpan.textContent = v % 1 === 0 ? String(v) : v.toFixed(1); list[pi].value = String(v); updatePreview(list); }
				inp.replaceWith(angleValSpan);
			};
			inp.addEventListener("blur", commit);
			inp.addEventListener("keydown", (e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") inp.replaceWith(angleValSpan); });
		});
		resetBtn.addEventListener("click", () => {
			const orig = (state.mogrtOriginals[mogrtPath] || []).find((o) => o.index === list[pi].index);
			if (orig) {
				angleVal = parseFloat(orig.value) || 0;
				list[pi].value = orig.value;
				angleValSpan.textContent = angleVal % 1 === 0 ? String(angleVal) : angleVal.toFixed(1);
				updatePreview(list);
			}
		});
		angleWrap.appendChild(angleLbl);
		angleWrap.appendChild(angleValSpan);
		angleWrap.appendChild(degSuffix);
		ctrl.appendChild(angleWrap);
		ctrl.appendChild(resetBtn);
	} else {
		const inpT = document.createElement("input");
		inpT.type = "text";
		inpT.className = "mogrt-text-input";
		inpT.value = val || "";
		inpT.addEventListener("input", () => {
			list[pi].value = inpT.value;
		});
		ctrl.appendChild(inpT);
		ctrl.appendChild(resetBtn);
	}
	rowEl.appendChild(ctrl);
	return rowEl;
}
function buildModalTextBlock(param, pi, list, mogrtPath, container) {
	const block = document.createElement("div");
	block.className = "mogrt-text-block modal-text-block";
	let parsed = {};
	try {
		if (param.rawValue) parsed = JSON.parse(param.rawValue);
	} catch (_) {}
	const textVal = parsed.textEditValue || param.value || "";
	const fontFamily = (parsed.fontEditValue || [])[0] || "";
	const fontSize = (parsed.fontSizeEditValue || [])[0] || 60;
	const isBold = (parsed.fontFSBoldValue || [])[0] || false;
	const isItalic = (parsed.fontFSItalicValue || [])[0] || false;
	const isAllCaps = (parsed.fontFSAllCapsValue || [])[0] || false;
	const isSmallCaps = (parsed.fontFSSmallCapsValue || [])[0] || false;
	const isTextTarget = param.index === modalState.textParamIndex;
	const exposedFields = modalState.exposedFontFields[param.index] || [];
	const headerRow = document.createElement("div");
	headerRow.className = "modal-text-block-header";
	const chkExpose = document.createElement("input");
	chkExpose.type = "checkbox";
	chkExpose.className = "modal-expose-chk";
	chkExpose.checked = modalState.exposedIndices.includes(param.index);
	chkExpose.title = "SRT 편집 시 텍스트 노출";
	chkExpose.addEventListener("change", () => {
		const arr = modalState.exposedIndices;
		const pos = arr.indexOf(param.index);
		if (chkExpose.checked && pos === -1) arr.push(param.index);
		else if (!chkExpose.checked && pos !== -1) arr.splice(pos, 1);
	});
	const textBtn = document.createElement("button");
	textBtn.className = "modal-text-target-btn" + (isTextTarget ? " active" : "");
	textBtn.textContent = "T";
	textBtn.title = "SRT 자막 텍스트가 이 필드에 입력됩니다";
	textBtn.type = "button";
	textBtn.addEventListener("click", () => {
		if (modalState.textParamIndex === param.index) {
			modalState.textParamIndex = -1;
			textBtn.classList.remove("active");
		} else {
			container.querySelectorAll(".modal-text-target-btn").forEach((b) => b.classList.remove("active"));
			modalState.textParamIndex = param.index;
			textBtn.classList.add("active");
		}
	});
	const lbl = document.createElement("span");
	lbl.className = "modal-mogrt-label";
	lbl.textContent = param.displayName;
	const resetBtn = document.createElement("button");
	resetBtn.textContent = "↺";
	resetBtn.title = "MOGRT 원본값으로 초기화";
	resetBtn.className = "modal-reset-btn";
	resetBtn.style.marginLeft = "auto";
	headerRow.appendChild(chkExpose);
	headerRow.appendChild(textBtn);
	headerRow.appendChild(lbl);
	headerRow.appendChild(resetBtn);
	block.appendChild(headerRow);
	const textarea = document.createElement("textarea");
	textarea.className = "mogrt-text-area";
	textarea.value = textVal;
	textarea.rows = 2;
	if (isTextTarget) textarea.style.borderColor = "#4caf50";
	block.appendChild(textarea);
	const fontRow = document.createElement("div");
	fontRow.className = "mogrt-font-row";
	const chkFont = document.createElement("input");
	chkFont.type = "checkbox";
	chkFont.className = "modal-expose-chk";
	chkFont.checked = exposedFields.includes("font");
	chkFont.title = "폰트 노출";
	chkFont.addEventListener("change", () => toggleFontField(param.index, "font", chkFont.checked));
	fontRow.appendChild(chkFont);
	// ── 폰트 피커 (싱글톤 전역 모달 방식) ──────────────────────────────
	const baseFonts = [
		{ display: "나눔고딕", postscript: "NanumGothic" },
		{ display: "나눔명조", postscript: "NanumMyeongjo" },
		{ display: "맑은 고딕", postscript: "MalgunGothic" },
		{ display: "Arial", postscript: "ArialMT" },
		{ display: "Helvetica", postscript: "Helvetica" },
		{ display: "Times New Roman", postscript: "TimesNewRomanPSMT" }
	];
	const fontPool = _cachedSystemFonts && _cachedSystemFonts.length > 0 ? _cachedSystemFonts : baseFonts;
	const fontInPool = fontPool.find(f => f.postscript === fontFamily || f.display === fontFamily);
	const fontList = fontFamily && !fontInPool
		? [{ display: fontFamily, postscript: fontFamily }, ...fontPool]
		: fontPool;
	const initEntry = fontInPool || (fontFamily ? { display: fontFamily, postscript: fontFamily } : fontList[0]);
	let currentFont = initEntry ? initEntry.postscript : "";
	let currentFontDisplay = initEntry ? initEntry.display : "";

		// ── 폰트 select 드롭다운 (이름순 정렬, 서브패밀리 포함) ─────────────
			const sortedFontList = fontList.slice().sort(function(a, b) {
				var aKorean = /[\uAC00-\uD7A3\u1100-\u11FF\u3130-\u318F]/.test(a.display);
				var bKorean = /[\uAC00-\uD7A3\u1100-\u11FF\u3130-\u318F]/.test(b.display);
				if (aKorean && !bKorean) return -1;
				if (!aKorean && bKorean) return 1;
				var cmp = a.display.localeCompare(b.display);
				if (cmp !== 0) return cmp;
				// 같은 패밀리 내 서브패밀리 정렬
				if (a.subfamily && !b.subfamily) return 1;
				if (!a.subfamily && b.subfamily) return -1;
				if (a.subfamily && b.subfamily) return a.subfamily.localeCompare(b.subfamily);
				return 0;
			});

			const fontSelect = document.createElement("select");
			fontSelect.className = "mogrt-font-select";

			sortedFontList.forEach(function(f) {
				var opt = document.createElement("option");
				opt.value = f.postscript;
				// 서브패밀리가 있으면 "패밀리 서브패밀리" 형태로 표시
				opt.textContent = f.subfamily ? (f.display + " " + f.subfamily) : f.display;
				if (f.postscript === currentFont || f.display === currentFont) opt.selected = true;
				fontSelect.appendChild(opt);
			});

			// select 변경 시 값 업데이트 (postscript 이름으로 저장)
			fontSelect.addEventListener("change", function() {
				var sel = sortedFontList.find(function(f) { return f.postscript === fontSelect.value; });
				currentFont = fontSelect.value; // postscript 이름
				currentFontDisplay = sel ? (sel.subfamily ? sel.display + " " + sel.subfamily : sel.display) : fontSelect.value;
				updateRawValue();
			});

			fontRow.appendChild(fontSelect);
			if (exposedFields.length > 0) block.appendChild(fontRow);

			// currentFont는 클로저 변수로 직접 관리됨 (updateRawValue에서 직접 참조)
		const styleRow = document.createElement("div");
		styleRow.className = "mogrt-style-row";
		const chkStyle = document.createElement("input");
		chkStyle.type = "checkbox";
		chkStyle.className = "modal-expose-chk";
		chkStyle.checked = [
			"bold",
			"italic",
			"allcaps",
			"smallcaps"
		].some((f) => exposedFields.includes(f));
		chkStyle.title = "스타일(Bold/Italic/AllCaps/SmallCaps) 노출";
		chkStyle.addEventListener("change", () => {
			[
				"bold",
				"italic",
				"allcaps",
				"smallcaps"
			].forEach((f) => toggleFontField(param.index, f, chkStyle.checked));
		});
		styleRow.appendChild(chkStyle);
	function makeStyleBtn(label, title, active, extraStyle) {
		const btn = document.createElement("button");
		btn.className = "mogrt-style-btn" + (active ? " active" : "");
		btn.textContent = label;
		btn.title = title;
		btn.type = "button";
		if (extraStyle) btn.style.cssText = extraStyle;
		btn.addEventListener("click", () => {
			btn.classList.toggle("active");
			updateRawValue();
		});
		return btn;
	}
	const boldBtn = makeStyleBtn("B", "Bold", isBold, "font-weight:bold;");
	const italicBtn = makeStyleBtn("I", "Italic", isItalic, "font-style:italic;");
	const allCapsBtn = makeStyleBtn("TT", "All Caps", isAllCaps);
	const smallCapsBtn = makeStyleBtn("Tt", "Small Caps", isSmallCaps);
		styleRow.appendChild(boldBtn);
		styleRow.appendChild(italicBtn);
		styleRow.appendChild(allCapsBtn);
		styleRow.appendChild(smallCapsBtn);
			if (["bold","italic","allcaps","smallcaps"].some(f => exposedFields.includes(f))) block.appendChild(styleRow);
	const sizeRow = document.createElement("div");
	sizeRow.className = "mogrt-size-row";
	const chkSize = document.createElement("input");
	chkSize.type = "checkbox";
	chkSize.className = "modal-expose-chk";
	chkSize.checked = exposedFields.includes("size");
	chkSize.title = "Font Size 노출";
	chkSize.addEventListener("change", () => toggleFontField(param.index, "size", chkSize.checked));
	const sizeTopRow = document.createElement("div");
	sizeTopRow.className = "mogrt-slider-toprow";
	const sizeLbl = document.createElement("span");
	sizeLbl.className = "mogrt-prop-label";
	sizeLbl.textContent = "Font Size";
	const sizeValLbl = document.createElement("span");
	sizeValLbl.className = "mogrt-num-value";
	sizeValLbl.textContent = String(fontSize);
	sizeValLbl.title = "클릭하여 직접 입력";
	sizeValLbl.style.cursor = "text";
	const sizeSlider = document.createElement("input");
	sizeSlider.type = "range";
	sizeSlider.className = "mogrt-slider";
	sizeSlider.min = String(param.minValue ?? 1);
	sizeSlider.max = String(param.maxValue ?? 400);
	sizeSlider.step = "0.1";
	sizeSlider.value = String(fontSize);
	sizeSlider.addEventListener("input", () => {
		const v = parseFloat(sizeSlider.value);
		sizeValLbl.textContent = v % 1 === 0 ? String(v) : v.toFixed(1);
		updateRawValue();
	});
	// Font Size 값 클릭 시 인라인 입력 전환
	sizeValLbl.addEventListener("click", () => {
		const inp = document.createElement("input");
		inp.type = "number";
		inp.className = "mogrt-num-inline-input";
		inp.value = sizeSlider.value;
		inp.style.cssText = "width:52px;background:#1a1a1a;border:1px solid #64b5f6;color:#64b5f6;font-size:11px;text-align:right;padding:1px 3px;border-radius:2px;";
		sizeValLbl.replaceWith(inp);
		inp.focus(); inp.select();
		const commit = () => {
			const v = parseFloat(inp.value);
			if (!isNaN(v)) {
				sizeSlider.value = String(v);
				sizeValLbl.textContent = v % 1 === 0 ? String(v) : v.toFixed(1);
				updateRawValue();
			}
			inp.replaceWith(sizeValLbl);
		};
		inp.addEventListener("keydown", (e) => { if (e.key === "Enter") commit(); else if (e.key === "Escape") inp.replaceWith(sizeValLbl); });
		inp.addEventListener("blur", commit);
	});
		sizeTopRow.appendChild(chkSize);
		sizeTopRow.appendChild(sizeLbl);
		sizeTopRow.appendChild(sizeValLbl);
		sizeRow.appendChild(sizeTopRow);
		sizeRow.appendChild(sizeSlider);
		if (exposedFields.length > 0) block.appendChild(sizeRow);
		textarea.addEventListener("input", () => {
			list[pi].value = textarea.value;
		if (typeof parsed.textEditValue !== "undefined") {
			parsed.textEditValue = textarea.value;
			if (Array.isArray(parsed.fontTextRunLength)) parsed.fontTextRunLength[0] = textarea.value.length;
			list[pi].rawValue = JSON.stringify(parsed);
		}
		updatePreview(list);
	});
	resetBtn.addEventListener("click", () => {
		const orig = (state.mogrtOriginals[mogrtPath] || []).find((o) => o.index === list[pi].index);
		if (orig) {
			list[pi].value = orig.value;
			list[pi].rawValue = orig.rawValue;
			textarea.value = orig.value;
			try {
				const op = JSON.parse(orig.rawValue || "{}");
				parsed = op;
				const ff = op.fontEditValue?.[0] || "";
				const fs2 = op.fontSizeEditValue?.[0] || 60;
				if (ff) {
					// PostScript 이름으로 풀에서 표시명 찾기
					const resetEntry = fontPool.find(f => f.postscript === ff || f.display === ff);
					currentFont = ff;
					currentFontDisplay = resetEntry ? (resetEntry.subfamily ? resetEntry.display + " " + resetEntry.subfamily : resetEntry.display) : ff;
					// select 드롭다운 선택 동기화
					if (fontSelect) fontSelect.value = ff;
				}
				sizeSlider.value = String(fs2);
				sizeValLbl.textContent = String(fs2);
				boldBtn.classList.toggle("active", op.fontFSBoldValue?.[0] || false);
				italicBtn.classList.toggle("active", op.fontFSItalicValue?.[0] || false);
				allCapsBtn.classList.toggle("active", op.fontFSAllCapsValue?.[0] || false);
				smallCapsBtn.classList.toggle("active", op.fontFSSmallCapsValue?.[0] || false);
			} catch (_) {}
			updatePreview(list);
		}
	});
	function updateRawValue() {
		// currentFont는 클로저 변수 (fontPickerWrap 내부에서 관리)
		const currentSize = parseFloat(sizeSlider.value) || fontSize;
		parsed.fontEditValue = [currentFont];
		parsed.fontSizeEditValue = [currentSize];
		parsed.fontFSBoldValue = [boldBtn.classList.contains("active")];
		parsed.fontFSItalicValue = [italicBtn.classList.contains("active")];
		parsed.fontFSAllCapsValue = [allCapsBtn.classList.contains("active")];
		parsed.fontFSSmallCapsValue = [smallCapsBtn.classList.contains("active")];
		if (typeof parsed.textEditValue === "undefined") parsed.textEditValue = textarea.value;
		list[pi].rawValue = JSON.stringify(parsed);
		list[pi].value = textarea.value;
		updatePreview(list);
	}
	return block;
}
function toggleFontField(paramIndex, field, on) {
	if (!modalState.exposedFontFields[paramIndex]) modalState.exposedFontFields[paramIndex] = [];
	const arr = modalState.exposedFontFields[paramIndex];
	const pos = arr.indexOf(field);
	if (on && pos === -1) arr.push(field);
	else if (!on && pos !== -1) arr.splice(pos, 1);
}
async function applyPreviewToTimeline(paramList) {
	const trackSel = document.getElementById("trackSel");
	const trackIndex = parseInt(trackSel.value, 10);
	_setStatus$1("프리뷰 적용 중...", "info");
	const res = await evalScriptWithPayload("previewParamsOnFirstClip", {
		videoTrackIndex: trackIndex,
		startSec: -1,
		endSec: 0,
		params: paramList
	});
	if (res.startsWith("SUCCESS")) _setStatus$1("프리뷰 적용됨", "ok");
	else _setStatus$1(res.replace("ERROR:", "").trim(), "err");
}
function showConfirm(message, onYes, onNo) {
	const overlay = document.getElementById("confirmModal");
	const msgEl = document.getElementById("confirmMessage");
	const btnYes = document.getElementById("confirmYes");
	const btnNo = document.getElementById("confirmNo");
	if (!overlay || !msgEl || !btnYes || !btnNo) {
		if (confirm(message)) onYes();
		else onNo?.();
		return;
	}
	msgEl.textContent = message;
	overlay.classList.add("open");
	const cleanup = () => overlay.classList.remove("open");
	const yesHandler = () => {
		cleanup();
		onYes();
	};
	const noHandler = () => {
		cleanup();
		onNo?.();
	};
	btnYes.onclick = yesHandler;
	btnNo.onclick = noHandler;
}
function showAlert(message, onOk) {
	const overlay = document.getElementById("alertModal");
	const msgEl = document.getElementById("alertMessage");
	const btnOk = document.getElementById("alertOk");
	if (!overlay || !msgEl || !btnOk) {
		alert(message);
		onOk?.();
		return;
	}
	msgEl.textContent = message;
	overlay.classList.add("open");
	btnOk.onclick = () => {
		overlay.classList.remove("open");
		onOk?.();
	};
}
// ─── 폴더 트리 유틸 ─────────────────────────────
function collectMogrtsFromTree(node, out) {
	if (!node) return;
	if (node.mogrts) node.mogrts.forEach((m) => out.push(m));
	if (node.children) node.children.forEach((c) => collectMogrtsFromTree(c, out));
}
function getMogrtsForSelectedFolder() {
	const sel = modalState.selectedFolderPath;
	if (!modalState.folderTree) return state.mogrtList;
	// 선택된 폴더 노드 찾기
	function findNode(node, path) {
		if (!node) return null;
		if (node.path === path) return node;
		for (const c of (node.children || [])) {
			const found = findNode(c, path);
			if (found) return found;
		}
		return null;
	}
	const node = findNode(modalState.folderTree, sel);
	if (!node) return [];
	// 해당 폴더의 직접 mogrt만 반환 (하위 폴더 포함 안 함)
	return node.mogrts || [];
}
function renderFolderTree() {
	const panel = document.getElementById("mogrtFolderPanel");
	if (!panel) return;
	panel.innerHTML = "";
	// 루트 폴더 직접 파일 보기 항목 ("Motion Graphics Templates" 루트)
	const rootPath = modalState.folderTree ? modalState.folderTree.path : "__all__";
	const rootDirectCount = modalState.folderTree && modalState.folderTree.mogrts ? modalState.folderTree.mogrts.length : 0;
	const allItem = document.createElement("div");
	allItem.className = "folder-tree-item folder-tree-root" + (modalState.selectedFolderPath === rootPath ? " selected" : "");
	allItem.dataset.path = rootPath;
	allItem.innerHTML = `<span class='folder-icon folder-icon-root'>\uD83D\uDDC2</span><span class='folder-name'>\ub8e8\ud2b8 \ud3f4\ub354</span><span class='folder-count'>${rootDirectCount > 0 ? rootDirectCount : ""}</span>`;
	allItem.addEventListener("click", () => {
		modalState.selectedFolderPath = rootPath;
		panel.querySelectorAll(".folder-tree-item").forEach((el) => el.classList.remove("selected"));
		allItem.classList.add("selected");
		renderMogrtPickerCards("");
	});
	panel.appendChild(allItem);
	if (modalState.folderTree) {
		// 루트 폴더의 직접 자식들만 렌더링 (재귀)
		renderFolderNode(panel, modalState.folderTree, 0);
	}
}
function renderFolderNode(panel, node, depth) {
	if (!node) return;
	// depth 0은 루트(Motion Graphics Templates) 자체 - 표시 안 함, 자식만 표시
	if (depth > 0) {
		const item = document.createElement("div");
		item.className = "folder-tree-item" + (node.path === modalState.selectedFolderPath ? " selected" : "");
		item.dataset.path = node.path;
		item.style.paddingLeft = (8 + (depth - 1) * 14) + "px";
		const directCount = node.mogrts ? node.mogrts.length : 0;
		item.innerHTML = `<span class='folder-icon'>📂</span><span class='folder-name'>${node.name}</span><span class='folder-count'>${directCount > 0 ? directCount : ""}</span>`;
		item.addEventListener("click", () => {
			modalState.selectedFolderPath = node.path;
			panel.querySelectorAll(".folder-tree-item").forEach((el) => el.classList.remove("selected"));
			item.classList.add("selected");
			renderMogrtPickerCards("");
		});
		panel.appendChild(item);
	}
	if (node.children) node.children.forEach((c) => renderFolderNode(panel, c, depth + 1));
}
// 쓸네일 캐시 (path → base64 data URL)
const _thumbCache = new Map();
function loadThumbLazy(img, path) {
	if (_thumbCache.has(path)) {
		img.src = _thumbCache.get(path);
		return;
	}
	if (typeof JSZip === "undefined" || !window.cep || !window.cep.fs) return;
	const readResult = window.cep.fs.readFile(path, window.cep.encoding.Base64);
	if (readResult.err !== 0 || !readResult.data) return;
	JSZip.loadAsync(readResult.data, {base64: true}).then((zip) => {
		const thumbFile = zip.file("thumb.png") || zip.file("thumbnail.png") || zip.file("preview.png");
		if (!thumbFile) return;
		return thumbFile.async("base64").then((b64) => {
			const dataUrl = "data:image/png;base64," + b64;
			_thumbCache.set(path, dataUrl);
			img.src = dataUrl;
		});
	}).catch(() => {});
}
function renderMogrtPickerCards(selectedPath) {
	const grid = document.getElementById("mogrtPickerGrid");
	const statusEl = document.getElementById("mogrtPickerStatus");
	if (!grid) return;
	grid.innerHTML = "";
	const displayList = getMogrtsForSelectedFolder();
	if (displayList.length === 0) {
		if (statusEl) statusEl.textContent = "MOGRT 파일이 없습니다.";
		return;
	}
	if (statusEl) statusEl.textContent = "";
	// IntersectionObserver로 레이지 로딩
	const scrollRoot = document.getElementById("mogrtPickerRight");
	const io = window.IntersectionObserver ? new IntersectionObserver((entries, obs) => {
		entries.forEach((entry) => {
			if (!entry.isIntersecting) return;
			const img = entry.target.querySelector(".mogrt-picker-thumb-img");
			const path = entry.target.dataset.path;
			if (img && path) loadThumbLazy(img, path);
			obs.unobserve(entry.target);
		});
	}, { root: scrollRoot, rootMargin: "100px" }) : null;
	displayList.forEach((m) => {
		const card = document.createElement("div");
		card.className = "mogrt-picker-card" + (m.path === selectedPath ? " selected" : "");
		card.dataset.path = m.path;
		const thumb = document.createElement("div");
		thumb.className = "mogrt-picker-thumb";
		const img = document.createElement("img");
		img.className = "mogrt-picker-thumb-img";
		img.alt = m.name;
		thumb.appendChild(img);
		const nameEl = document.createElement("div");
		nameEl.className = "mogrt-picker-name";
		nameEl.textContent = m.name;
		card.appendChild(thumb);
		card.appendChild(nameEl);
		grid.appendChild(card);
		// 캐시 있으면 즉시, 없으면 IntersectionObserver로 레이지 로딩
		if (_thumbCache.has(m.path)) {
			img.src = _thumbCache.get(m.path);
		} else if (io) {
			io.observe(card);
		} else {
			loadThumbLazy(img, m.path);
		}
	});
}
function updatePickerLabel(path) {
	const label = document.getElementById("mogrtSelectedLabel");
	if (!label) return;
	if (!path) {
		label.textContent = "-- MOGRT 미선택 --";
		return;
	}
	const found = state.mogrtList.find((m) => m.path === path);
	label.textContent = found ? found.name : path.split(/[\\/]/).pop()?.replace(/\.mogrt$/i, "") ?? path;
}
function bindModalEvents() {
	const modal = document.getElementById("defaultModal");
	const mogrtSel = document.getElementById("defaultMogrtSel");
	const modalBox = document.getElementById("modalBox");

	// ── 크기 복원 ──
	const savedW = localStorage.getItem("presetModalW");
	const savedH = localStorage.getItem("presetModalH");
	const savedX = localStorage.getItem("presetModalX");
	const savedY = localStorage.getItem("presetModalY");
	if (savedW && savedH) {
		modalBox.style.width  = savedW;
		modalBox.style.height = savedH;
		modalBox.style.maxWidth  = "none";
		modalBox.style.maxHeight = "none";
	}
	if (savedX && savedY) {
		modal.style.alignItems  = "flex-start";
		modal.style.justifyContent = "flex-start";
		modalBox.style.position = "absolute";
		modalBox.style.left = savedX;
		modalBox.style.top  = savedY;
	}

	// ── 크기 변경 감지 (ResizeObserver) ──
	if (window.ResizeObserver) {
		const ro = new ResizeObserver(() => {
			if (!modal.classList.contains("open")) return;
			localStorage.setItem("presetModalW", modalBox.offsetWidth  + "px");
			localStorage.setItem("presetModalH", modalBox.offsetHeight + "px");
		});
		ro.observe(modalBox);
	}

	// ── 헤더 드래그로 이동 ──
	const header = document.getElementById("modalHeader");
	let dragStartX = 0, dragStartY = 0, boxStartX = 0, boxStartY = 0;
	header?.addEventListener("mousedown", (e) => {
		if (e.target.closest("#btnCloseModal")) return;
		e.preventDefault();
		const rect = modalBox.getBoundingClientRect();
		boxStartX = rect.left;
		boxStartY = rect.top;
		dragStartX = e.clientX;
		dragStartY = e.clientY;
		modalBox.classList.add("dragging");
		modal.style.alignItems  = "flex-start";
		modal.style.justifyContent = "flex-start";
		modalBox.style.position = "absolute";
		modalBox.style.left = boxStartX + "px";
		modalBox.style.top  = boxStartY + "px";
		const onMove = (me) => {
			const dx = me.clientX - dragStartX;
			const dy = me.clientY - dragStartY;
			const newX = Math.max(0, Math.min(window.innerWidth  - modalBox.offsetWidth,  boxStartX + dx));
			const newY = Math.max(0, Math.min(window.innerHeight - modalBox.offsetHeight, boxStartY + dy));
			modalBox.style.left = newX + "px";
			modalBox.style.top  = newY + "px";
		};
		const onUp = () => {
			modalBox.classList.remove("dragging");
			localStorage.setItem("presetModalX", modalBox.style.left);
			localStorage.setItem("presetModalY", modalBox.style.top);
			document.removeEventListener("mousemove", onMove);
			document.removeEventListener("mouseup",   onUp);
		};
		document.addEventListener("mousemove", onMove);
		document.addEventListener("mouseup",   onUp);
	});

	function closeModal() {
		modal.classList.remove("open");
	}
	// ─── 역방향 동기화: PP 프로퍼티스 → 프리셋 편집 UI ────────────────────────────────
	var _reverseSyncTimer = null;
	var _reverseSyncLastHash = "";
	var _reverseSyncActive = false;
	var _reverseSyncStartTimer = null; // openPresetEdit의 setTimeout 취소용

	function _startReverseSync() {
		if (_reverseSyncTimer) return;
		_reverseSyncActive = true;
		_reverseSyncLastHash = "";
		_reverseSyncTimer = setInterval(async () => {
			if (!_reverseSyncActive) return;
			if (!modalState.paramList || !modalState.mogrtPath) return;
			try {
				const res = await evalScript("getPreviewClipParams()");
				if (!res || res.startsWith("ERROR")) return;
				// 변경 없으면 무시
				if (res === _reverseSyncLastHash) return;
				_reverseSyncLastHash = res;
				const freshParams = JSON.parse(res);
				if (!Array.isArray(freshParams)) return;
				let changed = false;
				freshParams.forEach(fp => {
					const mp = modalState.paramList.find(p => p.index === fp.index);
					if (!mp) return;
					// 값이 다를 때만 업데이트
					if (mp.rawValue !== fp.rawValue || mp.value !== fp.value) {
						mp.rawValue = fp.rawValue;
						mp.value = fp.value;
						changed = true;
					}
				});
			if (changed) {
				// UI 입력값만 업데이트 (전체 재렌더링 금지 → buildPreviewPanel 재호출 방지)
				freshParams.forEach(fp => {
					const mp = modalState.paramList.find(p => p.index === fp.index);
					if (!mp) return;
					// 텍스트 파라미터: textarea 업데이트
					if (mp.type === "text") {
						const ta = document.querySelector(`[data-param-index="${mp.index}"] textarea`);
						if (ta && ta.value !== (fp.value || "")) ta.value = fp.value || "";
					}
					// 슬라이더 파라미터: range + 숫자 표시 업데이트
					if (mp.type === "slider" || mp.type === "number") {
						const inp = document.querySelector(`[data-param-index="${mp.index}"] input[type=range]`);
						const numEl = document.querySelector(`[data-param-index="${mp.index}"] .param-value-display`);
						const v = parseFloat(fp.value) || 0;
						if (inp) inp.value = v;
						if (numEl) numEl.textContent = v;
					}
					// 색상 파라미터: 색상 스와치 업데이트
					if (mp.type === "color") {
						const sw = document.querySelector(`[data-param-index="${mp.index}"] .color-swatch`);
						const hexEl = document.querySelector(`[data-param-index="${mp.index}"] .color-hex`);
						if (sw && mp.colorHex) sw.style.background = mp.colorHex;
						if (hexEl && mp.colorHex) hexEl.textContent = mp.colorHex;
					}
				});
				// 상태바 표시
				_setStatus$1("↺ PP 프로퍼티스에서 업데이트됨", "ok");
			}
			} catch(e) {}
		}, 2000);
	}

	function _stopReverseSync() {
		_reverseSyncActive = false;
		if (_reverseSyncTimer) { clearInterval(_reverseSyncTimer); _reverseSyncTimer = null; }
		_reverseSyncLastHash = "";
	}
	// ────────────────────────────────────────────────────────────────

	function closePresetEdit() {
		_stopReverseSync();
		// 역방향 동기화 지연 시작 타이머도 취소 (모달 닫힌 후 시작되는 것 방지)
		if (_reverseSyncStartTimer) { clearTimeout(_reverseSyncStartTimer); _reverseSyncStartTimer = null; }
		// 프리뷰 타이머 정리 (취소 시 진행 중인 캐처 중단)
		if (_previewAutoTimer) { clearTimeout(_previewAutoTimer); _previewAutoTimer = null; }
		if (_previewDebounceTimer) { clearTimeout(_previewDebounceTimer); _previewDebounceTimer = null; }
		_previewRunning = false;
		const editModal = document.getElementById("presetEditModal");
		if (editModal) editModal.classList.remove("open");
		const previewArea = document.getElementById("modalPreviewArea");
		if (previewArea) previewArea.innerHTML = "";
	}
	function openPresetEdit(path) {
		const editModal = document.getElementById("presetEditModal");
		if (!editModal) return;
		const titleEl = document.getElementById("presetEditTitle");
		const found = state.mogrtList.find((m) => m.path === path);
		if (titleEl) titleEl.textContent = "⚙ " + (found ? found.name : path.split(/[\\/]/).pop()?.replace(/\.mogrt$/i, "") ?? path);
		const nameInput = document.getElementById("presetNameInput");
		if (nameInput) nameInput.value = modalState.presetId && state.presets[modalState.presetId] ? state.presets[modalState.presetId].name : "";
		editModal.classList.add("open");
		_stopReverseSync(); // 기존 폴링 정지 후 재시작
		if (_reverseSyncStartTimer) { clearTimeout(_reverseSyncStartTimer); _reverseSyncStartTimer = null; }
		loadMogrtForModal(path, modalState.presetId);
		// 파라미터 로드 완료 후 역방향 동기화 시작 (3초 들여서 시작) - 핸들 저장하여 취소 가능하게
		_reverseSyncStartTimer = setTimeout(() => { _reverseSyncStartTimer = null; if (_reverseSyncActive === false) _startReverseSync(); }, 3000);
	}
	document.getElementById("btnCloseModal")?.addEventListener("click", closeModal);
	document.getElementById("btnCancelDefault")?.addEventListener("click", closeModal);
	document.getElementById("btnClosePresetEdit")?.addEventListener("click", closePresetEdit);
	document.getElementById("btnCancelPresetEdit")?.addEventListener("click", closePresetEdit);

	// ── 인라인 카드 클릭 → 2차 모달 열기 ──
	document.getElementById("mogrtPickerGrid")?.addEventListener("click", (e) => {
		const card = e.target.closest(".mogrt-picker-card");
		if (!card) return;
		const path = card.dataset.path ?? "";
		if (!path) return;
		document.querySelectorAll(".mogrt-picker-card").forEach((c) => c.classList.remove("selected"));
		card.classList.add("selected");
		mogrtSel.value = path;
		updatePickerLabel(path);
		openPresetEdit(path);
	});

	// ── 보기 전환 버튼 ──
	const btnCard = document.getElementById("btnMogrtViewCard");
	const btnList = document.getElementById("btnMogrtViewList");
	const grid = document.getElementById("mogrtPickerGrid");
	btnCard?.addEventListener("click", () => {
		grid?.classList.remove("list-view");
		btnCard.classList.add("active");
		btnList?.classList.remove("active");
		localStorage.setItem("mogrtPickerView", "card");
	});
	btnList?.addEventListener("click", () => {
		grid?.classList.add("list-view");
		btnList.classList.add("active");
		btnCard?.classList.remove("active");
		localStorage.setItem("mogrtPickerView", "list");
	});

	// ── 2차 모달 드래그 ──
	const editBox = document.getElementById("presetEditBox");
	const editHeader = document.getElementById("presetEditHeader");
	const editModal2 = document.getElementById("presetEditModal");
	let edx = 0, edy = 0, ebx = 0, eby = 0;
	editHeader?.addEventListener("mousedown", (e) => {
		if (e.target.closest("#btnClosePresetEdit")) return;
		e.preventDefault();
		const rect = editBox.getBoundingClientRect();
		ebx = rect.left; eby = rect.top;
		edx = e.clientX; edy = e.clientY;
		editModal2.style.alignItems = "flex-start";
		editModal2.style.justifyContent = "flex-start";
		editBox.style.position = "absolute";
		editBox.style.left = ebx + "px";
		editBox.style.top  = eby + "px";
		const onMove = (me) => {
			const nx = Math.max(0, Math.min(window.innerWidth - editBox.offsetWidth, ebx + me.clientX - edx));
			const ny = Math.max(0, Math.min(window.innerHeight - editBox.offsetHeight, eby + me.clientY - edy));
			editBox.style.left = nx + "px";
			editBox.style.top  = ny + "px";
		};
		const onUp = () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
		document.addEventListener("mousemove", onMove);
		document.addEventListener("mouseup", onUp);
	});

	mogrtSel?.addEventListener("change", () => {
		const path = mogrtSel.value;
		if (!path) return;
		openPresetEdit(path);
	});
	document.getElementById("btnSaveDefault")?.addEventListener("click", () => {
		const mogrtPath = mogrtSel.value;
		if (!mogrtPath) {
			_setStatus$1("MOGRT를 선택하세요.", "err");
			return;
		}
		if (!modalState.paramList) {
			_setStatus$1("파라미터가 없습니다.", "err");
			return;
		}
		let presetName = document.getElementById("presetNameInput")?.value.trim() ?? "";
		if (!presetName) presetName = mogrtPath.split(/[\\/]/).pop()?.replace(/\.mogrt$/i, "") ?? "Preset";
		let presetId = modalState.presetId;
		if (!presetId) presetId = "preset_" + state.nextPresetId++;
		const usedBy = Object.entries(state.rowStates).filter(([, rs]) => rs.presetId === presetId).map(([id]) => parseInt(id, 10));
		const doSave = () => {
			state.presets[presetId] = {
				id: presetId,
				name: presetName,
				mogrtPath,
				params: JSON.parse(JSON.stringify(modalState.paramList)),
				exposedIndices: [...modalState.exposedIndices],
				textParamIndex: modalState.textParamIndex,
				exposedFontFields: JSON.parse(JSON.stringify(modalState.exposedFontFields)),
				thumbnailData: _lastPreviewSrc || (state.presets[presetId]?.thumbnailData ?? null)
			};
			savePresetsToStorage();
			renderPresetList();
			if (usedBy.length > 0) usedBy.forEach((subId) => {
				const sub = state.subtitles.find((s) => s.id === subId);
				if (sub) loadParamsFromPreset(subId, presetId, sub.text, false);
			});
			refreshAllSelects();
			closePresetEdit();
			closeModal();
			_setStatus$1("프리셋 저장: " + presetName, "ok");
		};
		if (usedBy.length > 0 && modalState.presetId) showConfirm(`이 프리셋은 현재 ${usedBy.length}개의 자막에 사용 중입니다.\n저장하면 해당 자막의 속성이 업데이트됩니다.\n계속하시겠습니까?`, doSave);
		else doSave();
	});
}
