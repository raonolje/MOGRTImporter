(function() {
	//#region src/state.ts
	var state = {
		subtitles: [],
		trashBin: [],
		mogrtList: [],
		presets: {},
		presetTrash: [],
		rowStates: {},
		mogrtOriginals: {},
		nextId: 1,
		nextPresetId: 1,
		currentProjectKey: "default",
		currentSequenceKey: "default_seq",
		currentSequenceId: "",
		presetViewMode: "list"
	};
	var _cachedSystemFonts = null; // 시스템 폰트 캐시 (전역)
	//#endregion
//#region src/storage.ts
	// ── cep.fs 기반 파일 저장소 ──
	// 저장 경로: {userData}/CEP_MogrtImporter/cache/{projKey}/{seqKey}/
	// UI 설정(모달 크기/위치, picker 보기 모드)은 localStorage 유지
	var _cacheRoot = null;
	function _getCacheRoot() {
		if (_cacheRoot) return _cacheRoot;
		try {
			// CSInterface 직접 생성 (getCS() 의존 제거 - 초기화 순서 문제 방지)
			const cs = window.CSInterface ? new window.CSInterface() : null;
			if (!cs) return null; // 실패 시 null 캐싱하지 않음
			const extPath = cs.getSystemPath(SystemPath.EXTENSION);
			if (!extPath) return null;
			_cacheRoot = extPath.replace(/\\/g, "/").replace(/\/$/, "") + "/cache";
		} catch(_) {
			return null; // 실패 시 null 캐싱하지 않음 (다음 호출에서 재시도)
		}
		return _cacheRoot;
	}
	function _ensureDir(path) {
		if (!window.cep || !window.cep.fs) return false;
		const normalized = path.replace(/\\/g, "/");
		// Windows 경로 처리: "C:/foo/bar" → prefix="C:", parts=["foo","bar"]
		const driveMatch = normalized.match(/^([A-Za-z]:)(\/.*)?$/);
		let prefix = "";
		let rest = normalized;
		if (driveMatch) {
			prefix = driveMatch[1]; // "C:"
			rest = driveMatch[2] || "/"; // "/foo/bar"
		}
		const parts = rest.split("/").filter((p) => p !== "");
		let cur = prefix;
		for (const p of parts) {
			cur += "/" + p;
			const stat = window.cep.fs.stat(cur);
			if (stat.err !== 0) {
				const mkRes = window.cep.fs.makedir(cur);
				console.log("[MOGRT] makedir:", cur, "err:", mkRes.err);
			}
		}
		return true;
	}
	function _fsWrite(filePath, data) {
		try {
			if (!window.cep || !window.cep.fs) { console.warn("[MOGRT] _fsWrite: cep.fs 없음"); return false; }
			const dir = filePath.replace(/\\/g, "/").replace(/\/[^\/]+$/, "");
			_ensureDir(dir);
			const res = window.cep.fs.writeFile(filePath, JSON.stringify(data));
			console.log("[MOGRT] _fsWrite:", filePath, "err:", res.err);
			return res.err === 0;
		} catch(e) { console.error("[MOGRT] _fsWrite 예외:", filePath, e); return false; }
	}
	window._mogrtDebug = { _fsWrite, _fsRead: (p) => _fsRead(p), getCacheRoot: () => _getCacheRoot(), getSessionPath: () => _getSessionPath(), saveSession: () => saveSessionToStorage() };
	function _fsRead(filePath) {
		try {
			if (!window.cep || !window.cep.fs) return null;
			const res = window.cep.fs.readFile(filePath);
			if (res.err !== 0 || !res.data) return null;
			return JSON.parse(res.data);
		} catch(_) { return null; }
	}
	function _getPresetsPath() {
		const root = _getCacheRoot();
		if (!root) return null;
		return root + "/" + state.currentProjectKey + "/presets.json";
	}
	function _getSessionPath() {
		const root = _getCacheRoot();
		if (!root) return null;
		return root + "/" + state.currentProjectKey + "/" + state.currentSequenceKey + "/session.json";
	}
	function _getHistoryPath() {
		const root = _getCacheRoot();
		if (!root) return null;
		return root + "/" + state.currentProjectKey + "/" + state.currentSequenceKey + "/history_auto.json";
	}
	function _getHistoryManualPath() {
		const root = _getCacheRoot();
		if (!root) return null;
		return root + "/" + state.currentProjectKey + "/" + state.currentSequenceKey + "/history_manual.json";
	}
	function _getTrackPath() {
		const root = _getCacheRoot();
		if (!root) return null;
		return root + "/" + state.currentProjectKey + "/" + state.currentSequenceKey + "/settings.json";
	}
	// ── localStorage → 파일 마이그레이션 (최초 1회) ──
	function _migrateFromLocalStorage() {
		try {
			// 프리셋 마이그레이션
			const presetsPath = _getPresetsPath();
			if (presetsPath) {
				const existingFile = _fsRead(presetsPath);
				if (!existingFile) {
					let raw = localStorage.getItem("mogrt_presets_" + state.currentProjectKey);
					if (!raw) raw = localStorage.getItem("mogrtImporter_" + state.currentProjectKey);
					if (!raw) raw = localStorage.getItem("mogrtImporter_default");
					if (raw) {
						try {
							const data = JSON.parse(raw);
							_fsWrite(presetsPath, data);
							console.log("[MOGRT] 프리셋 마이그레이션 완료:", presetsPath);
						} catch(_) {}
					}
				}
			}
			// 세션 마이그레이션
			const sessionPath = _getSessionPath();
			if (sessionPath) {
				const existingSession = _fsRead(sessionPath);
				if (!existingSession) {
					const sraw = localStorage.getItem("mogrt_session_" + state.currentSequenceKey);
					if (sraw) {
						try {
							const sdata = JSON.parse(sraw);
							_fsWrite(sessionPath, sdata);
							console.log("[MOGRT] 세션 마이그레이션 완료:", sessionPath);
						} catch(_) {}
					}
				}
			}
			// 히스토리 마이그레이션
			const histPath = _getHistoryPath();
			if (histPath) {
				const existingHist = _fsRead(histPath);
				if (!existingHist) {
					const hraw = localStorage.getItem("mogrt_history");
					if (hraw) {
						try {
							const hdata = JSON.parse(hraw);
							_fsWrite(histPath, hdata);
							console.log("[MOGRT] 히스토리 마이그레이션 완료:", histPath);
						} catch(_) {}
					}
				}
			}
			// 트랙 마이그레이션
			const trackPath = _getTrackPath();
			if (trackPath) {
				const existingTrack = _fsRead(trackPath);
				if (!existingTrack) {
					const traw = localStorage.getItem("mogrt_track_" + state.currentSequenceKey);
					if (traw !== null) {
						_fsWrite(trackPath, { trackValue: traw });
						console.log("[MOGRT] 트랙 마이그레이션 완료:", trackPath);
					}
				}
			}
		} catch(_) {}
	}
	function savePresetsToStorage() {
		try {
			const data = {
				presets: state.presets,
				presetTrash: state.presetTrash,
				nextPresetId: state.nextPresetId
			};
			const path = _getPresetsPath();
			if (path) _fsWrite(path, data);
		} catch (_) {}
	}
	function saveSessionToStorage() {
		try {
			const data = {
				subtitles: state.subtitles,
				rowStates: state.rowStates,
				trashBin: state.trashBin,
				nextId: state.nextId
			};
			const path = _getSessionPath();
			if (path) _fsWrite(path, data);
		} catch (_) {}
	}
	function loadSessionFromStorage() {
		try {
			const path = _getSessionPath();
			const sdata = path ? _fsRead(path) : null;
			if (sdata) {
				if (sdata.subtitles) state.subtitles = sdata.subtitles;
				if (sdata.rowStates) state.rowStates = sdata.rowStates;
				if (sdata.trashBin) state.trashBin = sdata.trashBin;
				if (sdata.nextId) state.nextId = sdata.nextId;
				// 프리셋 없는 고아 presetId 정리
				_sanitizeOrphanPresets();
			} else {
				// 저장된 데이터가 없을 때 기존 state를 유지 (자막 소실 방지)
				// 새 시쿀스로 전환 시에만 초기화 (명시적 플래그로 제어)
				if (loadSessionFromStorage._clearOnEmpty) {
					state.subtitles = [];
					state.rowStates = {};
					state.trashBin = [];
					state.nextId = 1;
				}
			}
		} catch (_) {}
	}
	function migratePreset(p) {
		if (!p.exposedIndices || !Array.isArray(p.exposedIndices)) p.exposedIndices = (p.params || []).map((param) => param.index);
		if (!p.exposedFontFields) p.exposedFontFields = {};
		if (typeof p.textParamIndex !== "number") p.textParamIndex = -1;
		return p;
	}
	function _sanitizeOrphanPresets() {
		// state.presets에 없는 presetId를 rowStates에서 제거 + 색상 맵 재구성
		Object.values(state.rowStates).forEach((rs) => {
			if (rs.presetId && !state.presets[rs.presetId]) rs.presetId = "";
		});
		// 유효한 presetId만 색상 맵에 등록
		const usedPresets = new Set(Object.values(state.rowStates).map((rs) => rs.presetId).filter(Boolean));
		usedPresets.forEach((pid) => _getPresetColorIndex(pid));
	}
	function loadAllFromStorage() {
		// 마이그레이션 먼저 시도 (최초 1회, 파일 없을 때만 localStorage에서 복사)
		_migrateFromLocalStorage();
		try {
			const path = _getPresetsPath();
			const data = path ? _fsRead(path) : null;
			if (data) {
				if (data.presets) {
					const migrated = {};
					for (const [id, preset] of Object.entries(data.presets)) migrated[id] = migratePreset(preset);
					state.presets = migrated;
				}
				if (data.presetTrash) state.presetTrash = data.presetTrash;
				if (data.nextPresetId) state.nextPresetId = data.nextPresetId;
			}
		} catch (_) {}
		try {
			const spath = _getSessionPath();
			const sdata = spath ? _fsRead(spath) : null;
			if (sdata) {
				if (sdata.subtitles) state.subtitles = sdata.subtitles;
				if (sdata.rowStates) state.rowStates = sdata.rowStates;
				if (sdata.trashBin) state.trashBin = sdata.trashBin;
				if (sdata.nextId) state.nextId = sdata.nextId;
			}
		} catch (_) {}
		// 프리셋 없는 고아 presetId 정리
		_sanitizeOrphanPresets();
	}
	//#endregion
	//#region src/cep.ts
	var _cs = null;
	function getCS() {
		if (!_cs) _cs = new window.CSInterface();
		return _cs;
	}
	function evalScript(script) {
		return new Promise((resolve) => {
			getCS().evalScript(script, (res) => resolve(res || ""));
		});
	}
	function evalScriptWithPayload(funcName, payload) {
		const json = JSON.stringify(payload);
		return evalScript(`${funcName}(decodeURIComponent("${encodeURIComponent(json)}"))`);
	}

	// ─────────────────────────────────────────────────────────────
	// 호스트 어댑터
	//
	// 패널(JS) → 호스트(JSX) 진입점을 이 객체 하나에 모은다. 호출부는
	// 함수명 문자열을 직접 다루지 않는다. UXP 전환 시 아래 구현부와
	// hostscript.jsx만 교체하면 UI·상태·파서 코드는 그대로 쓴다.
	//
	// getCS / evalScript / evalScriptWithPayload 는 이 region 전용이다.
	// 바깥에서 부르지 말 것.
	//
	// 호스트 응답 계약 (hostscript.jsx 확인 결과):
	//   정상     JSON 문자열 · "SUCCESS..." · 경로 문자열 · "CANCEL"
	//   실패     "ERROR: ..."
	//   전송실패 ""              호스트 함수 미정의 또는 무응답
	//            "EvalScript error."  JSX가 잡지 못한 예외
	//
	// 패널이 쓰는 진입점 중 정상 경로에서 빈 문자열을 돌려주는 것은
	// 하나도 없다. 따라서 ""는 전송 실패로 단정해도 안전하다.
	// ─────────────────────────────────────────────────────────────

	// 에러 객체를 만들면서 콘솔에도 남긴다. 던지는 쪽은 로깅을 신경쓰지 않는다.
	function _hostError(funcName, reason, raw) {
		const err = new Error(`[host] ${funcName}: ${reason}`);
		err.name = "HostError";
		err.hostFunc = funcName;
		err.hostReason = reason;
		err.hostRaw = raw == null ? "" : String(raw);
		console.error(err.message, err.hostRaw ? { 응답: err.hostRaw } : "");
		return err;
	}

	// 인자 직렬화. 문자열은 encodeURIComponent로 감싸 ExtendScript 인코딩과
	// 따옴표·역슬래시 이스케이프 문제를 한 번에 피한다(한글 경로 포함).
	function _encodeArg(v) {
		if (typeof v === "number") return String(v);
		return `decodeURIComponent("${encodeURIComponent(String(v))}")`;
	}

	// 전송 계층만 판별한다. SUCCESS/ERROR/CANCEL 같은 프로토콜 해석은 상위 몫.
	async function _invoke(funcName, script) {
		let res;
		try {
			res = await evalScript(script);
		} catch (e) {
			throw _hostError(funcName, "evalScript 예외: " + ((e && e.message) || e));
		}
		if (!res) throw _hostError(funcName, "빈 응답 (호스트 함수 미정의 또는 무응답)");
		if (res === "EvalScript error.") throw _hostError(funcName, "ExtendScript 실행 오류");
		return res;
	}

	function _callNoArgs(funcName) {
		return _invoke(funcName, `${funcName}()`);
	}
	function _callWithArgs(funcName, ...args) {
		return _invoke(funcName, `${funcName}(${args.map(_encodeArg).join(",")})`);
	}
	function _callWithPayload(funcName, payload) {
		let json;
		try {
			json = JSON.stringify(payload);
		} catch (e) {
			throw _hostError(funcName, "페이로드 직렬화 실패: " + ((e && e.message) || e));
		}
		return _invoke(funcName, `${funcName}(decodeURIComponent("${encodeURIComponent(json)}"))`);
	}

	// JSON을 돌려주는 진입점용. ERROR 응답과 파싱 실패를 모두 던진다.
	// quietError: 호스트의 "ERROR:..." 응답이 정상 흐름의 일부인 진입점용.
	//   로그도 예외도 없이 null을 돌려준다. 폴링처럼 초당 여러 번 도는 호출에서
	//   "아직 대상이 없음"이 콘솔을 뒤덮는 것을 막는다.
	//   전송 실패(빈 응답 / EvalScript error.)는 이 경우에도 그대로 던진다.
	async function _callJson(funcName, resPromise, quietError) {
		const res = await resPromise;
		if (res.indexOf("ERROR") === 0) {
			if (quietError) return null;
			throw _hostError(funcName, "호스트 오류 응답", res);
		}
		try {
			return JSON.parse(res);
		} catch (e) {
			throw _hostError(funcName, "JSON 파싱 실패: " + ((e && e.message) || e), res);
		}
	}

	var host = {
		// ── JSON 반환. 실패 시 throw, 성공 시 파싱된 값 ──
		getMogrtFolderTree: () => _callJson("getMogrtFolderTree", _callNoArgs("getMogrtFolderTree")),
		getMogrtScanDirs: () => _callJson("getMogrtScanDirs", _callNoArgs("getMogrtScanDirs")),
		getActiveSequenceInfo: () => _callJson("getActiveSequenceInfo", _callNoArgs("getActiveSequenceInfo")),
		// 프리뷰 시퀀스/클립이 아직 없을 때 ERROR를 돌려주는 것이 정상이다 → quiet
		getPreviewClipParams: () => _callJson("getPreviewClipParams", _callNoArgs("getPreviewClipParams"), true),
		getSystemFonts: () => _callJson("getSystemFonts", _callNoArgs("getSystemFonts")),
		getMogrtParams: (mogrtPath) => _callJson("getMogrtParams", _callWithArgs("getMogrtParams", mogrtPath)),
		scanMogrtFolder: (folderPath) => _callJson("scanMogrtFolder", _callWithArgs("scanMogrtFolder", folderPath)),
		syncAllClipsFromTimeline: (trackIndex) => _callJson("syncAllClipsFromTimeline", _callWithArgs("syncAllClipsFromTimeline", Number(trackIndex))),

		// ── 문자열 프로토콜 반환. "SUCCESS:..." / "ERROR:..." / "CANCEL" 해석은 호출부 몫 ──
		applyToTimeline: (payload) => _callWithPayload("applyToTimeline", payload),
		updateClipAtTime: (payload) => _callWithPayload("updateClipAtTime", payload),
		setupPreviewSequence: (payload) => _callWithPayload("setupPreviewSequence", payload),
		applyPreviewParams: (payload) => _callWithPayload("applyPreviewParams", payload),
		capturePreviewFrame: (payload) => _callWithPayload("capturePreviewFrame", payload),
		seekToClip: (payload) => _callWithPayload("seekToClip", payload),
		previewParamsOnFirstClip: (payload) => _callWithPayload("previewParamsOnFirstClip", payload),
		saveTextFile: (payload) => _callWithPayload("saveTextFile", payload),
		saveTextFileWithDialog: (payload) => _callWithPayload("saveTextFileWithDialog", payload),

		// ── 경로 문자열 반환 ──
		selectExportFolder: () => _callNoArgs("selectExportFolder"),

		// 호스트 함수가 아니라 ExtendScript 식이다. 프리뷰 캡처 임시 경로용으로,
		// 실패해도 진행에 지장이 없어 여기서만 예외를 삼키고 기본값을 준다.
		getTempDir: async () => {
			try {
				const res = await _invoke("getTempDir", '$.getenv("TEMP") || $.getenv("TMP") || "C:/Temp"');
				return res.length > 2 ? res.replace(/\\/g, "/") : "C:/Temp";
			} catch (_) {
				return "C:/Temp";
			}
		}
	};
	//#endregion
	//#region src/srtParser.ts
	function timeToSec(t) {
		const parts = t.replace(",", ".").split(":");
		const h = parseInt(parts[0], 10) || 0;
		const m = parseInt(parts[1], 10) || 0;
		const s = parseFloat(parts[2]) || 0;
		return h * 3600 + m * 60 + s;
	}
	function parseSRT(text) {
		const results = [];
		const blocks = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split(/\n\n+/);
		let idx = 1;
		for (const block of blocks) {
			const lines = block.trim().split("\n");
			if (lines.length < 2) continue;
			const firstLine = lines[0].trim();
			let lineOffset = 0;
			if (/^\d+$/.test(firstLine)) lineOffset = 1;
			const timeMatch = (lines[lineOffset]?.trim() ?? "").match(/(\d{2}:\d{2}:\d{2}[,\.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,\.]\d{3})/);
			if (!timeMatch) continue;
			const textLines = lines.slice(lineOffset + 1).join("\n").trim();
			if (!textLines) continue;
			results.push({
				index: idx++,
				startTime: timeMatch[1].replace(",", "."),
				endTime: timeMatch[2].replace(",", "."),
				startSec: timeToSec(timeMatch[1]),
				endSec: timeToSec(timeMatch[2]),
				text: textLines
			});
		}
		return results;
	}
	//#endregion
	//#region src/ui/tabs.ts
	var TAB_MAP = {
		"tabBtnList": "tab-list",
		"tabBtnPresets": "tab-presets",
		"tabBtnTrash": "tab-trash"
	};
	function initTabs() {
		for (const [btnId, contentId] of Object.entries(TAB_MAP)) {
			const btn = document.getElementById(btnId);
			if (!btn) {
				console.warn("[tabs] 버튼 없음:", btnId);
				continue;
			}
			btn.addEventListener("click", () => {
				activateTab(contentId);
			});
		}
	}
	function activateTab(contentId) {
		for (const btnId of Object.keys(TAB_MAP)) {
			const btn = document.getElementById(btnId);
			if (btn) btn.classList.remove("active");
		}
		for (const cid of Object.values(TAB_MAP)) {
			const el = document.getElementById(cid);
			if (el) el.classList.remove("active");
		}
		const contentEl = document.getElementById(contentId);
		if (contentEl) contentEl.classList.add("active");
		for (const [btnId, cid] of Object.entries(TAB_MAP)) if (cid === contentId) {
			const btn = document.getElementById(btnId);
			if (btn) btn.classList.add("active");
		}
	}
	//#endregion
	//#region src/htmlUtils.ts
	// innerHTML 템플릿에 외부 문자열을 끼워 넣을 때 쓴다. 대상은 이 코드가
	// 만들지 않은 값이다 — 파일시스템 폴더명, 사용자가 입력한 저장 라벨,
	// 호스트 응답과 예외 메시지.
	// 코드가 만든 정수(개수 등) 보간에는 쓰지 않는다. 불필요하다.
	function escapeHtml(value) {
		return String(value == null ? "" : value)
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;")
			.replace(/'/g, "&#39;");
	}
	//#endregion
	//#region src/colorUtils.ts
	function h2(v) {
		const s = Math.floor(v).toString(16);
		return s.length < 2 ? "0" + s : s;
	}
	function parsePackedColor(rawVal) {
		return parseFloat(rawVal ?? "0") || 0;
	}
	function packedToHex(packed) {
		if (packed <= 0) return "#000000";
		if (packed < 4294967296) {
			const r = Math.floor(packed / 65536) % 256;
			const g = Math.floor(packed / 256) % 256;
			const b = packed % 256;
			return "#" + h2(r) + h2(g) + h2(b);
		} else {
			const rem0 = packed - 72057594037927940;
			if (rem0 < 0) return "#000000";
			const r = Math.floor(rem0 / 1099511627776) % 256;
			const rem1 = rem0 - r * 1099511627776;
			const g = Math.floor(rem1 / 16777216) % 256;
			const rem2 = rem1 - g * 16777216;
			const b = Math.floor(rem2 / 256) % 256;
			return "#" + h2(r) + h2(g) + h2(b);
		}
	}
	function hexToRgb(hex) {
		const m = /^#?([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(hex);
		if (!m) return null;
		return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
	}
	function rgbToHex(r, g, b) {
		return "#" + h2(Math.max(0, Math.min(255, r))) + h2(Math.max(0, Math.min(255, g))) + h2(Math.max(0, Math.min(255, b)));
	}
	// HSV <-> RGB 변환
	function hsvToRgb(h, s, v) {
		s /= 100; v /= 100;
		const i = Math.floor(h / 60) % 6;
		const f = h / 60 - Math.floor(h / 60);
		const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
		const [r, g, b] = [[v,t,p],[q,v,p],[p,v,t],[p,q,v],[t,p,v],[v,p,q]][i];
		return { r: Math.round(r*255), g: Math.round(g*255), b: Math.round(b*255) };
	}
	function rgbToHsv(r, g, b) {
		r /= 255; g /= 255; b /= 255;
		const max = Math.max(r,g,b), min = Math.min(r,g,b), d = max - min;
		let h = 0;
		if (d !== 0) {
			if (max === r) h = ((g - b) / d + 6) % 6;
			else if (max === g) h = (b - r) / d + 2;
			else h = (r - g) / d + 4;
			h *= 60;
		}
		return { h, s: max === 0 ? 0 : d / max * 100, v: max * 100 };
	}
	// ── 전역 커스텀 컬러피커 ──
	const CP = (() => {
		let _popup, _canvas, _cursor, _hueBar, _hueThumb, _hexInp, _rInp, _gInp, _bInp, _preview;
		let _hue = 0, _sat = 100, _val = 100;
		let _onChange = null;
		let _draggingCanvas = false, _draggingHue = false;
		function _drawCanvas() {
			const ctx = _canvas.getContext('2d');
			const w = _canvas.width, h = _canvas.height;
			const base = hsvToRgb(_hue, 100, 100);
			const grad1 = ctx.createLinearGradient(0, 0, w, 0);
			grad1.addColorStop(0, '#fff');
			grad1.addColorStop(1, `rgb(${base.r},${base.g},${base.b})`);
			ctx.fillStyle = grad1; ctx.fillRect(0, 0, w, h);
			const grad2 = ctx.createLinearGradient(0, 0, 0, h);
			grad2.addColorStop(0, 'transparent');
			grad2.addColorStop(1, '#000');
			ctx.fillStyle = grad2; ctx.fillRect(0, 0, w, h);
		}
		function _drawHueBar() {
			const ctx = _hueBar.getContext('2d');
			const w = _hueBar.width, h = _hueBar.height;
			const grad = ctx.createLinearGradient(0, 0, w, 0);
			[0,60,120,180,240,300,360].forEach((deg, i) => {
				const c = hsvToRgb(deg, 100, 100);
				grad.addColorStop(i/6, `rgb(${c.r},${c.g},${c.b})`);
			});
			ctx.fillStyle = grad; ctx.fillRect(0, 0, w, h);
		}
		function _updateCursor() {
			const w = _canvas.width, h = _canvas.height;
			const x = _sat / 100 * w, y = (1 - _val / 100) * h;
			_cursor.style.left = x + 'px'; _cursor.style.top = y + 'px';
		}
		function _updateHueThumb() {
			_hueThumb.style.left = (_hue / 360 * _hueBar.width) + 'px';
		}
		function _syncUI(hex) {
			const rgb = hexToRgb(hex);
			if (!rgb) return;
			_preview.style.background = hex;
			_hexInp.value = hex;
			_rInp.value = rgb.r; _gInp.value = rgb.g; _bInp.value = rgb.b;
		}
		function _emitColor() {
			const rgb = hsvToRgb(_hue, _sat, _val);
			const hex = rgbToHex(rgb.r, rgb.g, rgb.b);
			_syncUI(hex);
			if (_onChange) _onChange(hex);
		}
		function _setFromHex(hex) {
			const rgb = hexToRgb(hex);
			if (!rgb) return;
			const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
			_hue = hsv.h; _sat = hsv.s; _val = hsv.v;
			_drawCanvas(); _updateCursor(); _updateHueThumb();
			_syncUI(hex);
			if (_onChange) _onChange(hex);
		}
		function _onCanvasPointer(e) {
			const rect = _canvas.getBoundingClientRect();
			const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
			const y = Math.max(0, Math.min(e.clientY - rect.top, rect.height));
			_sat = x / rect.width * 100;
			_val = (1 - y / rect.height) * 100;
			_updateCursor(); _emitColor();
		}
		function _onHuePointer(e) {
			const rect = _hueBar.getBoundingClientRect();
			const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
			_hue = x / rect.width * 360;
			_drawCanvas(); _updateHueThumb(); _emitColor();
		}
		function _init() {
			_popup = document.getElementById('customColorPicker');
			_canvas = document.getElementById('cpCanvas');
			_cursor = document.getElementById('cpCursor');
			_hueBar = document.getElementById('cpHueBar');
			_hueThumb = document.getElementById('cpHueThumb');
			_hexInp = document.getElementById('cpHexInput');
			_rInp = document.getElementById('cpR');
			_gInp = document.getElementById('cpG');
			_bInp = document.getElementById('cpB');
			_preview = document.getElementById('cpPreviewSwatch');
			_drawHueBar();
			// 캔버스 드래그
			_canvas.addEventListener('mousedown', e => { _draggingCanvas = true; _onCanvasPointer(e); });
			document.addEventListener('mousemove', e => { if (_draggingCanvas) _onCanvasPointer(e); });
			document.addEventListener('mouseup', () => { _draggingCanvas = false; });
			// Hue 슬라이더 드래그
			_hueBar.addEventListener('mousedown', e => { _draggingHue = true; _onHuePointer(e); });
			document.addEventListener('mousemove', e => { if (_draggingHue) _onHuePointer(e); });
			document.addEventListener('mouseup', () => { _draggingHue = false; });
			// HEX 입력
			_hexInp.addEventListener('change', () => {
				let v = _hexInp.value.trim();
				if (!v.startsWith('#')) v = '#' + v;
				if (/^#[0-9a-fA-F]{6}$/.test(v)) _setFromHex(v.toLowerCase());
				else _hexInp.value = rgbToHex(hsvToRgb(_hue,_sat,_val).r, hsvToRgb(_hue,_sat,_val).g, hsvToRgb(_hue,_sat,_val).b);
			});
			_hexInp.addEventListener('keydown', e => { if (e.key === 'Enter') _hexInp.blur(); });
			// RGB 입력
			const onRgb = () => {
				const r = Math.max(0,Math.min(255,parseInt(_rInp.value)||0));
				const g = Math.max(0,Math.min(255,parseInt(_gInp.value)||0));
				const b = Math.max(0,Math.min(255,parseInt(_bInp.value)||0));
				_setFromHex(rgbToHex(r,g,b));
			};
			[_rInp,_gInp,_bInp].forEach(inp => {
				inp.addEventListener('change', onRgb);
				inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); });
			});
			// 외부 클릭 시 닫기
			document.addEventListener('mousedown', e => {
				if (_popup.classList.contains('open') && !_popup.contains(e.target) && !e.target.closest('.mogrt-color-swatch-wrap')) {
					_popup.classList.remove('open');
				}
			});
		}
		function open(anchorEl, hexColor, onChangeCb) {
			if (!_popup) _init();
			_onChange = onChangeCb;
			const rgb = hexToRgb(hexColor) || { r: 255, g: 255, b: 255 };
			const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
			_hue = hsv.h; _sat = hsv.s; _val = hsv.v;
			_drawCanvas(); _updateCursor(); _updateHueThumb(); _syncUI(hexColor);
			// 팝업 위치 계산
			const rect = anchorEl.getBoundingClientRect();
			const popW = 220, popH = 290;
			let top = rect.bottom + 4, left = rect.left;
			if (top + popH > window.innerHeight) top = rect.top - popH - 4;
			if (left + popW > window.innerWidth) left = window.innerWidth - popW - 4;
			_popup.style.top = top + 'px'; _popup.style.left = left + 'px';
			_popup.classList.add('open');
		}
		return { open };
	})();
	//#endregion
	//#region src/ui/dialog.ts
	// 패널 공용 확인/알림 다이얼로그. index.html의 #confirmModal / #alertModal을
	// 쓰고, 없으면 브라우저 기본 confirm/alert로 폴백한다.
	// 의존성이 없어 어느 region에서든 부를 수 있다.
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
	//#endregion
	//#region src/ui/paramEditor.ts
	function renderParams(panel, list, onChange, exposedFontFields) {
		panel.innerHTML = "";
		if (!list || list.length === 0) {
			const p = document.createElement("p");
			p.style.cssText = "color:#555;font-size:11px;padding:6px 0;";
			p.textContent = "노출된 파라미터가 없습니다.";
			panel.appendChild(p);
			return;
		}
		renderParamList(panel, list, onChange, exposedFontFields);
	}
	function renderParamList(container, list, onChange, exposedFontFields) {
		const groupStates = {};
		let currentGroupEl = container;
		let currentGroupKey = "";
		for (const param of list) {
			if (param.type === "textsetting") {
				currentGroupKey = param.displayName + "_" + param.index;
				groupStates[currentGroupKey] = true;
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
				const key = currentGroupKey;
				grpHdr.addEventListener("click", () => {
					groupStates[key] = !groupStates[key];
					grpBody.style.display = groupStates[key] ? "" : "none";
					arrow.textContent = groupStates[key] ? "▾" : "▸";
					arrow.className = "mogrt-group-arrow" + (groupStates[key] ? " open" : "");
				});
				container.appendChild(grpHdr);
				container.appendChild(grpBody);
				currentGroupEl = grpBody;
				continue;
			}
			if (param.type === "group") {
				currentGroupKey = param.displayName + "_" + param.index;
				groupStates[currentGroupKey] = true;
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
				const key = currentGroupKey;
				grpHdr.addEventListener("click", () => {
					groupStates[key] = !groupStates[key];
					grpBody.style.display = groupStates[key] ? "" : "none";
					arrow.textContent = groupStates[key] ? "▾" : "▸";
					arrow.className = "mogrt-group-arrow" + (groupStates[key] ? " open" : "");
				});
				container.appendChild(grpHdr);
				container.appendChild(grpBody);
				currentGroupEl = grpBody;
				continue;
			}
			if (param.type === "comment") {
				const cmtEl = document.createElement("div");
				cmtEl.className = "mogrt-comment";
				cmtEl.textContent = param.displayName || param.value || "";
				currentGroupEl.appendChild(cmtEl);
				continue;
			}
			currentGroupEl.appendChild(buildParamControl(param, onChange, exposedFontFields));
		}
	}
	function buildParamControl(param, onChange, exposedFontFields) {
		const t = param.type;
		if (t === "text") {
			// exposedFontFields가 있으면 해당 인덱스 값 사용
			// 없으면 undefined 전달 → buildMogrtTextBlock에서 fontExposed 기반으로 결정
			const ef = exposedFontFields
				? (exposedFontFields[param.index] !== undefined ? exposedFontFields[param.index] : undefined)
				: undefined;
			return buildMogrtTextBlock(param, onChange, ef);
		}
		const rowEl = document.createElement("div");
		rowEl.className = "mogrt-prop-row";
		if (t === "color") buildColorControl(rowEl, param, onChange);
		else if (t === "number") buildNumberControl(rowEl, param, onChange);
		else if (t === "dropdown") buildDropdownControl(rowEl, param, onChange);
		else if (t === "boolean") buildBooleanControl(rowEl, param, onChange);
		else if (t === "point") buildPointControl(rowEl, param, onChange);
		else if (t === "angle") buildAngleControl(rowEl, param, onChange);
		else {
			const lbl = document.createElement("span");
			lbl.className = "mogrt-prop-label";
			lbl.textContent = param.displayName;
			const val = document.createElement("span");
			val.className = "mogrt-prop-value-text";
			val.textContent = param.value || "";
			rowEl.appendChild(lbl);
			rowEl.appendChild(val);
		}
		return rowEl;
	}
	function buildColorControl(rowEl, param, onChange) {
		const hexColor = param.colorHex || packedToHex(parsePackedColor(param.rawValue));
		const lbl = document.createElement("span");
		lbl.className = "mogrt-prop-label";
		lbl.textContent = param.displayName;
		const ctrl = document.createElement("div");
		ctrl.className = "mogrt-prop-ctrl";
		const swatchWrap = document.createElement("div");
		swatchWrap.className = "mogrt-color-swatch-wrap";
		swatchWrap.style.cursor = "pointer";
		const swatch = document.createElement("div");
		swatch.className = "mogrt-color-swatch";
		swatch.style.background = hexColor;
		swatchWrap.appendChild(swatch);
		swatchWrap.addEventListener("click", () => {
			CP.open(swatchWrap, param.colorHex || hexColor, (newHex) => {
				swatch.style.background = newHex;
				param.colorHex = newHex;
				param.value = newHex;
				onChange(param);
			});
		});
		ctrl.appendChild(swatchWrap);
		rowEl.appendChild(lbl);
		rowEl.appendChild(ctrl);
	}
	function buildNumberControl(rowEl, param, onChange) {
		const numVal = parseFloat(param.value) || 0;
		const minV = param.minValue ?? (numVal < 0 ? Math.min(-100, Math.floor(numVal * 2)) : 0);
		const maxV = param.maxValue ?? (numVal > 100 ? Math.max(Math.ceil(numVal * 2), 200) : 100);
		const range = maxV - minV;
		const step = range > 100 ? "0.1" : range > 10 ? "0.1" : "0.01";
		rowEl.className = "mogrt-prop-row mogrt-prop-row--slider";
		const topRow = document.createElement("div");
		topRow.className = "mogrt-slider-toprow";
		const lbl = document.createElement("span");
		lbl.className = "mogrt-prop-label";
		lbl.textContent = param.displayName;
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
		// 값 클릭 시 인라인 입력 전환
		valLbl.addEventListener("click", () => {
			const inpEdit = document.createElement("input");
			inpEdit.type = "number";
			inpEdit.className = "mogrt-num-inline-input";
			inpEdit.value = param.value;
			inpEdit.step = step;
			valLbl.replaceWith(inpEdit);
			inpEdit.focus(); inpEdit.select();
			const commit = () => {
				const v = parseFloat(inpEdit.value);
				if (!isNaN(v)) {
					param.value = String(v);
					sliderEl.value = String(Math.min(maxV, Math.max(minV, v)));
					valLbl.textContent = v % 1 === 0 ? String(v) : v.toFixed(1);
					onChange(param);
				}
				inpEdit.replaceWith(valLbl);
			};
			inpEdit.addEventListener("blur", commit);
			inpEdit.addEventListener("keydown", (e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") inpEdit.replaceWith(valLbl); });
		});
		sliderEl.addEventListener("input", () => {
			const v = parseFloat(sliderEl.value);
			valLbl.textContent = v % 1 === 0 ? String(v) : v.toFixed(1);
			param.value = sliderEl.value;
			onChange(param);
		});
		topRow.appendChild(lbl);
		topRow.appendChild(valLbl);
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
		rowEl.appendChild(topRow);
		rowEl.appendChild(sliderRow);
	}
	function buildDropdownControl(rowEl, param, onChange) {
		const lbl = document.createElement("span");
		lbl.className = "mogrt-prop-label";
		lbl.textContent = param.displayName;
		const ctrl = document.createElement("div");
		ctrl.className = "mogrt-prop-ctrl";
		const sel = document.createElement("select");
		sel.className = "mogrt-dropdown";
		const opts = param.dropdownOptions || [];
		const curV = Math.round(parseFloat(param.value) || 0);
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
			param.value = sel.value;
			onChange(param);
		});
		ctrl.appendChild(sel);
		rowEl.appendChild(lbl);
		rowEl.appendChild(ctrl);
	}
	function buildBooleanControl(rowEl, param, onChange) {
		const lbl = document.createElement("span");
		lbl.className = "mogrt-prop-label";
		lbl.textContent = param.displayName;
		const ctrl = document.createElement("div");
		ctrl.className = "mogrt-prop-ctrl";
		const toggle = document.createElement("label");
		toggle.className = "mogrt-toggle";
		const inpB = document.createElement("input");
		inpB.type = "checkbox";
		inpB.checked = param.value === "true" || param.value === "1";
		const slider = document.createElement("span");
		slider.className = "mogrt-toggle-slider";
		inpB.addEventListener("change", () => {
			param.value = inpB.checked ? "true" : "false";
			onChange(param);
		});
		toggle.appendChild(inpB);
		toggle.appendChild(slider);
		ctrl.appendChild(toggle);
		rowEl.appendChild(lbl);
		rowEl.appendChild(ctrl);
	}
	function buildPointControl(rowEl, param, onChange) {
		rowEl.className = "mogrt-prop-row mogrt-prop-row--point";
		const parts = (param.value || "0,0").split(",");
		let xVal = parseFloat(parts[0]) || 0;
		let yVal = parseFloat(parts[1]) || 0;
		const titleRow = document.createElement("div");
		titleRow.className = "mogrt-prop-row-title";
		const titleLbl = document.createElement("span");
		titleLbl.className = "mogrt-prop-label";
		titleLbl.textContent = param.displayName;
		titleRow.appendChild(titleLbl);
		rowEl.appendChild(titleRow);
		const pointWrap = document.createElement("div");
		pointWrap.className = "mogrt-point-wrap mogrt-point-drag-wrap";
		// 드래그 입력 헬퍼
		function makeDragValue(axisLabel, initVal, onAxisChange) {
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
					const delta = (ev.clientX - dragStartX) * 1.0;
					curVal = Math.round((dragStartVal + delta) * 10) / 10;
					valSpan.textContent = curVal % 1 === 0 ? String(curVal) : curVal.toFixed(1);
					onAxisChange(curVal);
				};
				const onUp = () => {
					isDragging = false;
					document.removeEventListener("mousemove", onMove);
					document.removeEventListener("mouseup", onUp);
					onChange(param);
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
					if (!isNaN(v)) { curVal = v; valSpan.textContent = v % 1 === 0 ? String(v) : v.toFixed(1); onAxisChange(v); onChange(param); }
					inp.replaceWith(valSpan);
				};
				inp.addEventListener("blur", commit);
				inp.addEventListener("keydown", (e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") inp.replaceWith(valSpan); });
			});
			wrap.appendChild(lbl);
			wrap.appendChild(valSpan);
			return wrap;
		}
		const xWrap = makeDragValue("X", xVal, (v) => { xVal = v; param.value = xVal + "," + yVal; });
		const yWrap = makeDragValue("Y", yVal, (v) => { yVal = v; param.value = xVal + "," + yVal; });
		pointWrap.appendChild(xWrap);
		pointWrap.appendChild(yWrap);
		rowEl.appendChild(pointWrap);
	}
	function buildAngleControl(rowEl, param, onChange) {
		let angleVal = parseFloat(param.value) || 0;
		rowEl.className = "mogrt-prop-row mogrt-prop-row--point";
		const titleRow = document.createElement("div");
		titleRow.className = "mogrt-prop-row-title";
		const titleLbl = document.createElement("span");
		titleLbl.className = "mogrt-prop-label";
		titleLbl.textContent = param.displayName;
		titleRow.appendChild(titleLbl);
		rowEl.appendChild(titleRow);
		// 드래그 입력 방식 (PP 프로퍼티스와 동일)
		const angleWrap = document.createElement("div");
		angleWrap.className = "mogrt-point-wrap mogrt-point-drag-wrap";
		const axisWrap = document.createElement("div");
		axisWrap.className = "mogrt-drag-axis";
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
				const delta = (ev.clientX - dragStartX2) * 0.5;
				angleVal = Math.round((dragStartVal2 + delta) * 10) / 10;
				angleValSpan.textContent = angleVal % 1 === 0 ? String(angleVal) : angleVal.toFixed(1);
				param.value = String(angleVal);
			};
			const onUp2 = () => {
				isDragging2 = false;
				document.removeEventListener("mousemove", onMove2);
				document.removeEventListener("mouseup", onUp2);
				onChange(param);
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
				if (!isNaN(v)) { angleVal = v; angleValSpan.textContent = v % 1 === 0 ? String(v) : v.toFixed(1); param.value = String(v); onChange(param); }
				inp.replaceWith(angleValSpan);
			};
			inp.addEventListener("blur", commit);
			inp.addEventListener("keydown", (e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") inp.replaceWith(angleValSpan); });
		});
		axisWrap.appendChild(angleLbl);
		axisWrap.appendChild(angleValSpan);
		axisWrap.appendChild(degSuffix);
		angleWrap.appendChild(axisWrap);
		rowEl.appendChild(angleWrap);
	}
	function buildMogrtTextBlock(param, onChange, exposedFields = null) {
		// exposedFields가 undefined인 경우: param.fontExposed 기반으로 결정
		// fontExposed === true → null (전체 표시)
		// fontExposed === false → [] (텍스트만)
		// fontExposed === undefined → null (하위 호환: 전체 표시)
		if (exposedFields === undefined) {
			exposedFields = (param.fontExposed === false) ? [] : null;
		}
		const block = document.createElement("div");
		block.className = "mogrt-text-block";
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
		const showFont = exposedFields === null || exposedFields.includes("font");
		const showSize = exposedFields === null || exposedFields.includes("size");
		const showBold = exposedFields === null || exposedFields.includes("bold");
		const showItalic = exposedFields === null || exposedFields.includes("italic");
		const showAllCaps = exposedFields === null || exposedFields.includes("allcaps");
		const showSmallCaps = exposedFields === null || exposedFields.includes("smallcaps");
		const showAnyStyle = showBold || showItalic || showAllCaps || showSmallCaps;
		const lbl = document.createElement("div");
		lbl.className = "mogrt-text-block-label";
		lbl.textContent = param.displayName;
		block.appendChild(lbl);
		const textarea = document.createElement("textarea");
		textarea.className = "mogrt-text-area";
		textarea.value = textVal;
		textarea.rows = 2;
		block.appendChild(textarea);
		let fontSel = null;
		if (showFont) {
			const fontRow = document.createElement("div");
			fontRow.className = "mogrt-font-row";
			// 시스템 폰트 풀 (프리셋 편집과 동일)
			const baseFontsInline = [
				{ display: "나눔고딕", postscript: "NanumGothic" },
				{ display: "나눔명조", postscript: "NanumMyeongjo" },
				{ display: "맑은 고딕", postscript: "MalgunGothic" },
				{ display: "Arial", postscript: "ArialMT" },
				{ display: "Helvetica", postscript: "Helvetica" },
				{ display: "Times New Roman", postscript: "TimesNewRomanPSMT" }
			];
			const fontPoolInline = _cachedSystemFonts && _cachedSystemFonts.length > 0 ? _cachedSystemFonts : baseFontsInline;
			const fontInPoolInline = fontPoolInline.find(f => f.postscript === fontFamily || f.display === fontFamily);
			const fontListInline = fontFamily && !fontInPoolInline
				? [{ display: fontFamily, postscript: fontFamily }, ...fontPoolInline]
				: fontPoolInline;
				const sortedFontListInline = fontListInline.slice().sort(function(a, b) {
					var aK = /[\uAC00-\uD7A3\u1100-\u11FF\u3130-\u318F]/.test(a.display);
					var bK = /[\uAC00-\uD7A3\u1100-\u11FF\u3130-\u318F]/.test(b.display);
					if (aK && !bK) return -1;
					if (!aK && bK) return 1;
					var cmp = a.display.localeCompare(b.display);
					if (cmp !== 0) return cmp;
					if (a.subfamily && !b.subfamily) return 1;
					if (!a.subfamily && b.subfamily) return -1;
					if (a.subfamily && b.subfamily) return a.subfamily.localeCompare(b.subfamily);
					return 0;
				});
				fontSel = document.createElement("select");
				fontSel.className = "mogrt-font-select";
				sortedFontListInline.forEach(function(f) {
					const opt = document.createElement("option");
					opt.value = f.postscript;
					// 서브패밀리가 있으면 "패밀리 서브패밀리" 형태로 표시
					opt.textContent = f.subfamily ? (f.display + " " + f.subfamily) : f.display;
					if (f.postscript === fontFamily || f.display === fontFamily) opt.selected = true;
					fontSel.appendChild(opt);
				});
				fontSel.addEventListener("change", () => { updateRawValue(); }); // fontSel.value = postscript 이름
			fontRow.appendChild(fontSel);
			block.appendChild(fontRow);
		}
		let boldBtn = null;
		let italicBtn = null;
		let allCapsBtn = null;
		let smallCapsBtn = null;
		if (showAnyStyle) {
			const styleRow = document.createElement("div");
			styleRow.className = "mogrt-style-row";
			function makeStyleBtn(label, title, active, extraStyle) {
				const btn = document.createElement("button");
				btn.className = "mogrt-style-btn" + (active ? " active" : "");
				btn.textContent = label;
				btn.title = title;
				btn.type = "button";
				if (extraStyle) btn.style.cssText = extraStyle;
				return btn;
			}
			if (showBold) {
				boldBtn = makeStyleBtn("B", "Bold", isBold, "font-weight:bold;");
				boldBtn.addEventListener("click", () => {
					boldBtn.classList.toggle("active");
					updateRawValue();
				});
				styleRow.appendChild(boldBtn);
			}
			if (showItalic) {
				italicBtn = makeStyleBtn("I", "Italic", isItalic, "font-style:italic;");
				italicBtn.addEventListener("click", () => {
					italicBtn.classList.toggle("active");
					updateRawValue();
				});
				styleRow.appendChild(italicBtn);
			}
			if (showAllCaps) {
				allCapsBtn = makeStyleBtn("TT", "All Caps", isAllCaps);
				allCapsBtn.addEventListener("click", () => {
					allCapsBtn.classList.toggle("active");
					updateRawValue();
				});
				styleRow.appendChild(allCapsBtn);
			}
			if (showSmallCaps) {
				smallCapsBtn = makeStyleBtn("Tt", "Small Caps", isSmallCaps);
				smallCapsBtn.addEventListener("click", () => {
					smallCapsBtn.classList.toggle("active");
					updateRawValue();
				});
				styleRow.appendChild(smallCapsBtn);
			}
			block.appendChild(styleRow);
		}
		let sizeSlider = null;
		let sizeValLbl = null;
		if (showSize) {
			const sizeRow = document.createElement("div");
			sizeRow.className = "mogrt-size-row";
			const sizeTopRow = document.createElement("div");
			sizeTopRow.className = "mogrt-slider-toprow";
			const sizeLbl = document.createElement("span");
			sizeLbl.className = "mogrt-prop-label";
			sizeLbl.textContent = "Font Size";
			sizeValLbl = document.createElement("span");
			sizeValLbl.className = "mogrt-num-value";
			sizeValLbl.textContent = String(fontSize);
			sizeValLbl.title = "클릭하여 직접 입력";
			sizeValLbl.style.cursor = "text";
			sizeSlider = document.createElement("input");
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
			// 값 클릭 시 인라인 입력 전환
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
			sizeTopRow.appendChild(sizeLbl);
			sizeTopRow.appendChild(sizeValLbl);
			sizeRow.appendChild(sizeTopRow);
			sizeRow.appendChild(sizeSlider);
				if (exposedFields === null || exposedFields.length > 0) block.appendChild(sizeRow);
			}
			textarea.addEventListener("input", () => {
				param.value = textarea.value;
				if (typeof parsed.textEditValue !== "undefined") {
				parsed.textEditValue = textarea.value;
				if (Array.isArray(parsed.fontTextRunLength)) parsed.fontTextRunLength[0] = textarea.value.length;
				param.rawValue = JSON.stringify(parsed);
			}
			onChange(param);
		});
		function updateRawValue() {
			const currentFont = fontSel ? fontSel.value : fontFamily;
			const currentSize = sizeSlider ? parseFloat(sizeSlider.value) || fontSize : fontSize;
			if (showFont) parsed.fontEditValue = [currentFont];
			if (showSize) parsed.fontSizeEditValue = [currentSize];
			if (showBold) parsed.fontFSBoldValue = [boldBtn?.classList.contains("active") ?? isBold];
			if (showItalic) parsed.fontFSItalicValue = [italicBtn?.classList.contains("active") ?? isItalic];
			if (showAllCaps) parsed.fontFSAllCapsValue = [allCapsBtn?.classList.contains("active") ?? isAllCaps];
			if (showSmallCaps) parsed.fontFSSmallCapsValue = [smallCapsBtn?.classList.contains("active") ?? isSmallCaps];
			if (typeof parsed.textEditValue === "undefined") parsed.textEditValue = textarea.value;
			param.rawValue = JSON.stringify(parsed);
			onChange(param);
		}
		return block;
	}
	//#endregion
	//#region src/ui/trash.ts
	var _setStatus$3 = () => {};
	function initTrash(setStatus) {
		_setStatus$3 = setStatus;
	}
	function renderTrash() {
		const trashWrap = document.getElementById("trashWrap");
		const trashCount = document.getElementById("trashCount");
		const emptyEl = document.getElementById("trashEmpty");
		if (trashCount) trashCount.textContent = state.trashBin.length > 0 ? "(" + state.trashBin.length + ")" : "";
		trashWrap.querySelectorAll(".trash-row").forEach((el) => el.parentNode?.removeChild(el));
		if (emptyEl) emptyEl.style.display = state.trashBin.length === 0 ? "flex" : "none";
		state.trashBin.forEach((item, ti) => {
			const row = document.createElement("div");
			row.className = "trash-row";
			const numEl = document.createElement("span");
			numEl.className = "trash-num";
			numEl.textContent = String(item.sub.index);
			const timeEl = document.createElement("span");
			timeEl.className = "trash-time";
			timeEl.textContent = item.sub.startTime;
			const textEl = document.createElement("span");
			textEl.className = "trash-text";
			textEl.textContent = item.sub.text;
			const restoreBtn = document.createElement("button");
			restoreBtn.className = "btn-restore";
			restoreBtn.textContent = "복구";
			restoreBtn.addEventListener("click", () => restoreSubtitle(ti));
			row.appendChild(numEl);
			row.appendChild(timeEl);
			row.appendChild(textEl);
			row.appendChild(restoreBtn);
			trashWrap.appendChild(row);
		});
	}
	function restoreSubtitle(trashIdx) {
		const item = state.trashBin.splice(trashIdx, 1)[0];
		const pos = Math.min(item.position, state.subtitles.length);
		state.subtitles.splice(pos, 0, item.sub);
		state.rowStates[item.sub.id] = item.state;
		renderAll();
		renderTrash();
		saveSessionToStorage();
		_setStatus$3("자막 " + item.sub.index + "번 복구됨", "ok");
	}
	function renderPresetTrash() {
		const presetTrashWrap = document.getElementById("presetTrashWrap");
		if (!presetTrashWrap) return;
		presetTrashWrap.innerHTML = "";
		const emptyEl = document.getElementById("presetTrashEmpty");
		if (state.presetTrash.length === 0) {
			if (emptyEl) emptyEl.style.display = "flex";
			return;
		}
		if (emptyEl) emptyEl.style.display = "none";
		state.presetTrash.forEach((item, ti) => {
			const row = document.createElement("div");
			row.className = "trash-row";
			const nameEl = document.createElement("span");
			nameEl.className = "trash-text";
			nameEl.textContent = item.preset.name;
			const mogrtEl = document.createElement("span");
			mogrtEl.className = "trash-time";
			mogrtEl.textContent = item.preset.mogrtPath.split(/[\\/]/).pop()?.replace(/\.mogrt$/i, "") ?? "";
			const restoreBtn = document.createElement("button");
			restoreBtn.className = "btn-restore";
			restoreBtn.textContent = "복구";
			restoreBtn.addEventListener("click", () => {
				const restored = state.presetTrash.splice(ti, 1)[0];
				state.presets[restored.preset.id] = restored.preset;
				savePresetsToStorage();
				renderPresetList();
				renderPresetTrash();
				refreshAllSelects();
				_setStatus$3("프리셋 \"" + restored.preset.name + "\" 복구됨", "ok");
			});
			row.appendChild(nameEl);
			row.appendChild(mogrtEl);
			row.appendChild(restoreBtn);
			presetTrashWrap.appendChild(row);
		});
	}
	function bindTrashEvents() {
		document.getElementById("btnEmptyTrash")?.addEventListener("click", () => {
			state.trashBin = [];
			renderTrash();
			saveSessionToStorage();
			_setStatus$3("휴지통 비움", "ok");
		});
		document.getElementById("btnRestoreAll")?.addEventListener("click", () => {
			const count = state.trashBin.length;
			if (count === 0) return;
			const sorted = [...state.trashBin].sort((a, b) => a.position - b.position);
			state.trashBin = [];
			sorted.forEach((item) => {
				const pos = Math.min(item.position, state.subtitles.length);
				state.subtitles.splice(pos, 0, item.sub);
				state.rowStates[item.sub.id] = item.state;
			});
			renderAll();
			renderTrash();
			saveSessionToStorage();
			_setStatus$3(count + "개 자막 전체 복구됨", "ok");
		});
		document.getElementById("btnEmptyPresetTrash")?.addEventListener("click", () => {
			state.presetTrash = [];
			renderPresetTrash();
			savePresetsToStorage();
			_setStatus$3("프리셋 휴지통 비움", "ok");
		});
	}
	//#endregion
	//#region src/ui/presetList.ts
	var _setStatus$2 = () => {};
	var _openPresetModal = () => {};
	function initPresetList(setStatus, openPresetModal) {
		_setStatus$2 = setStatus;
		_openPresetModal = openPresetModal;
	}
	function updatePresetTabCount() {
		const cnt = Object.keys(state.presets).length;
		const el = document.getElementById("presetCount");
		if (el) el.textContent = cnt > 0 ? "(" + cnt + ")" : "";
	}
	function renderPresetList() {
		const presetList = document.getElementById("presetList");
		if (!presetList) return;
		presetList.innerHTML = "";
		const ids = Object.keys(state.presets);
		if (ids.length === 0) {
			const empty = document.createElement("p");
			empty.className = "empty-hint";
			empty.textContent = "저장된 프리셋이 없습니다. + 프리셋 추가 버튼으로 추가하세요.";
			presetList.appendChild(empty);
			updatePresetTabCount();
			return;
		}
		if (state.presetViewMode === "card") {
			presetList.className = "preset-grid";
			ids.forEach((pid) => presetList.appendChild(makePresetCard(pid)));
		} else {
			presetList.className = "";
			ids.forEach((pid) => presetList.appendChild(makePresetRow(pid)));
		}
		updatePresetTabCount();
	}
	function makePresetRow(pid) {
		const preset = state.presets[pid];
		const row = document.createElement("div");
		row.className = "preset-row";
		const nameEl = document.createElement("span");
		nameEl.className = "preset-name";
		nameEl.textContent = preset.name;
		const mogrtEl = document.createElement("span");
		mogrtEl.className = "preset-mogrt";
		mogrtEl.textContent = preset.mogrtPath.split(/[\\/]/).pop()?.replace(/\.mogrt$/i, "") ?? "";
		const editBtn = document.createElement("button");
		editBtn.className = "btn";
		editBtn.textContent = "편집";
		editBtn.style.cssText = "font-size:10px;padding:2px 8px;";
		editBtn.addEventListener("click", () => _openPresetModal(pid));
		const delBtn = document.createElement("button");
		delBtn.className = "btn danger";
		delBtn.textContent = "삭제";
		delBtn.style.cssText = "font-size:10px;padding:2px 8px;";
		delBtn.addEventListener("click", () => deletePreset(pid));
		row.appendChild(nameEl);
		row.appendChild(mogrtEl);
		row.appendChild(editBtn);
		row.appendChild(delBtn);
		return row;
	}
	function makePresetCard(pid) {
		const preset = state.presets[pid];
		const card = document.createElement("div");
		card.className = "preset-card";
		const thumb = document.createElement("div");
		thumb.className = "preset-thumb";
		if (preset.thumbnailData) {
			// 실제 스크린샷 주도 표시
			const thumbImg = document.createElement("img");
			thumbImg.src = preset.thumbnailData;
			thumbImg.style.cssText = "position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;border-radius:4px 4px 0 0;";
			thumb.appendChild(thumbImg);
		} else {
			// 쓰네일 없으면 기존 텍스트 합성 폴백
			const thumbInner = document.createElement("div");
			thumbInner.className = "preset-thumb-inner";
			let sampleStr = preset.name || "샘플 자막";
			let fontFamily = "";
			let fontSize = 60;
			let isBold = false;
			let isItalic = false;
			let mainColor = "#ffffff";
			if (preset.params) {
				const textParam = preset.params.find((p) => p.type === "text");
				if (textParam?.rawValue) try {
					const parsed = JSON.parse(textParam.rawValue);
					sampleStr = parsed.textEditValue || textParam.value || sampleStr;
					fontFamily = parsed.fontEditValue?.[0] || "";
					fontSize = parsed.fontSizeEditValue?.[0] || 60;
					isBold = parsed.fontFSBoldValue?.[0] || false;
					isItalic = parsed.fontFSItalicValue?.[0] || false;
				} catch (_) {}
				for (const p of preset.params) if (p.type === "color") {
					mainColor = p.colorHex || packedToHex(parsePackedColor(p.rawValue)) || "#ffffff";
					break;
				}
			}
			const scaleInner = document.createElement("div");
			scaleInner.className = "preset-thumb-scale-inner";
			const sampleText = document.createElement("div");
			sampleText.className = "preset-thumb-text";
			sampleText.style.color = mainColor;
			sampleText.style.fontFamily = fontFamily || "inherit";
			sampleText.style.fontSize = fontSize + "px";
			sampleText.style.fontWeight = isBold ? "bold" : "normal";
			sampleText.style.fontStyle = isItalic ? "italic" : "normal";
			sampleText.style.textShadow = "0 1px 4px rgba(0,0,0,0.9)";
			sampleText.style.whiteSpace = "nowrap";
			sampleText.style.position = "absolute";
			sampleText.style.bottom = "60px";
			sampleText.style.left = "50%";
			sampleText.style.transform = "translateX(-50%)";
			sampleText.style.textAlign = "center";
			sampleText.textContent = sampleStr;
			scaleInner.appendChild(sampleText);
			thumbInner.appendChild(scaleInner);
			thumb.appendChild(thumbInner);
			requestAnimationFrame(() => {
				const thumbW = thumb.offsetWidth || 200;
				const thumbH = thumb.offsetHeight || thumbW * .5625;
				const scaleX = thumbW / 1920;
				const scaleY = thumbH / 540;
				const scale = Math.min(scaleX, scaleY);
				scaleInner.style.transform = `scale(${scale})`;
			});
		}
		const nameEl = document.createElement("div");
		nameEl.className = "preset-card-name";
		nameEl.textContent = preset.name;
		const mogrtEl = document.createElement("div");
		mogrtEl.className = "preset-card-mogrt";
		mogrtEl.textContent = preset.mogrtPath.split(/[\\/]/).pop()?.replace(/\.mogrt$/i, "") ?? "";
		const btnWrap = document.createElement("div");
		btnWrap.className = "preset-card-btns";
		const editBtn = document.createElement("button");
		editBtn.className = "btn";
		editBtn.textContent = "편집";
		editBtn.style.cssText = "font-size:10px;padding:2px 8px;flex:1;";
		editBtn.addEventListener("click", () => _openPresetModal(pid));
		const delBtn = document.createElement("button");
		delBtn.className = "btn danger";
		delBtn.textContent = "삭제";
		delBtn.style.cssText = "font-size:10px;padding:2px 8px;flex:1;";
		delBtn.addEventListener("click", () => deletePreset(pid));
		btnWrap.appendChild(editBtn);
		btnWrap.appendChild(delBtn);
		card.appendChild(thumb);
		card.appendChild(nameEl);
		card.appendChild(mogrtEl);
		card.appendChild(btnWrap);
		return card;
	}
	function deletePreset(pid) {
		if (!state.presets[pid]) return;
		const usedBy = state.subtitles.filter((sub) => state.rowStates[sub.id]?.presetId === pid).map((sub) => sub.index);
		let msg = "\"" + state.presets[pid].name + "\" 프리셋을 삭제하시겠습니까?";
		if (usedBy.length > 0) msg += "\n\n⚠ 이 프리셋은 자막 " + usedBy.join(", ") + "번에 적용되어 있습니다.\n삭제하면 해당 자막의 프리셋 설정이 초기화됩니다.";
		showConfirm(msg, () => doDeletePreset(pid));
	}
	function doDeletePreset(pid) {
		state.presetTrash.push({
			preset: JSON.parse(JSON.stringify(state.presets[pid])),
			deletedAt: (/* @__PURE__ */ new Date()).toISOString()
		});
		delete state.presets[pid];
		state.subtitles.forEach((sub) => {
			const rs = state.rowStates[sub.id];
			if (rs?.presetId === pid) {
				rs.presetId = "";
				rs.params = [];
				rs._allParams = [];
				const row = document.getElementById("row-" + sub.id);
				if (row) row.className = "sub-row no-mogrt";
				const sel = document.getElementById("sel-" + sub.id);
				if (sel) {
					sel.innerHTML = "";
					const none = document.createElement("option");
					none.value = "";
					none.textContent = "-- 프리셋 선택 --";
					sel.appendChild(none);
				}
				const panel = document.getElementById("params-" + sub.id);
				if (panel) {
					panel.innerHTML = "";
					panel.className = "sub-params";
				}
			}
		});
		savePresetsToStorage();
		saveSessionToStorage();
		renderPresetList();
		renderPresetTrash();
		refreshAllSelects();
		const deletedName = state.presetTrash[state.presetTrash.length - 1]?.preset.name ?? "";
		_setStatus$2("프리셋 \"" + deletedName + "\" 휴지통으로 이동", "ok");
	}
	function bindPresetViewToggle() {
		const btnViewList = document.getElementById("btnViewList");
		const btnViewCard = document.getElementById("btnViewCard");
		btnViewList?.addEventListener("click", () => {
			state.presetViewMode = "list";
			btnViewList.classList.add("active");
			btnViewCard?.classList.remove("active");
			renderPresetList();
		});
		btnViewCard?.addEventListener("click", () => {
			state.presetViewMode = "card";
			btnViewCard.classList.add("active");
			btnViewList?.classList.remove("active");
			renderPresetList();
		});
	}
	//#endregion
	//#region src/ui/modal.ts
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
			host.getMogrtFolderTree().then((tree) => {
				window._cachedFolderTree = tree; // 캐시 저장
				_applyFolderTree(tree);
			}).catch(() => {
				const statusEl2 = document.getElementById("mogrtPickerStatus");
				if (statusEl2) statusEl2.textContent = "폴더 로드 실패";
			});
		}
		modal.classList.add("open");
		// 시스템 폰트 캐시 로드 (최초 1회)
		if (!_cachedSystemFonts) {
			host.getSystemFonts().then((fonts) => {
				_cachedSystemFonts = fonts;
			}).catch(() => {});
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

		// 캐시된 파라미터가 있으면 즉시 사용 (호스트 호출 생략)
		if (state.mogrtOriginals[mogrtPath]) {
			_applyMogrtParamsToModal(state.mogrtOriginals[mogrtPath], mogrtPath, presetId);
			return;
		}

		modalBody.innerHTML = "<p style=\"color:#64b5f6;font-size:11px;padding:10px 0;text-align:center;\">파라미터 로드 중... (최대 90초)</p><p style=\"color:#aaa;font-size:10px;padding:0;text-align:center;\">첫 번째 로드는 Premiere가 MOGRT를 초기화하는 시간이 필요합니다.<br>두 번째부터는 즉시 로드됩니다.</p>";
		let timedOut = false;
		const timeoutId = setTimeout(() => {
			timedOut = true;
			modalBody.innerHTML = "<p style=\"color:#f44336;font-size:11px;padding:10px 0;\">파라미터 로드 타임아웃 (90초 초과). MOGRT 파일이 유효한지 확인하거나 Premiere Pro를 재시작하세요.</p>";
		}, 9e4);
		host.getMogrtParams(mogrtPath).then((parsed) => {
			if (timedOut) return;
			clearTimeout(timeoutId);
			try {
				// getMogrtParams는 {params, mogrtPath} 객체 또는 기존 배열 형태 모두 지원
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
				modalBody.innerHTML = `<p style="color:#f44336;font-size:11px;padding:10px 0;">파싱 오류: ${escapeHtml(ex.message)}</p>`;
			}
		}).catch((err) => {
			if (timedOut) return;
			clearTimeout(timeoutId);
			modalBody.innerHTML = `<p style="color:#f44336;font-size:11px;padding:10px 0;">파라미터 로드 실패: ${escapeHtml(err.hostRaw || err.message || "")}</p>`;
		});
	}
	// 캐시 히트 시 또는 호스트 응답 도착 후 공통으로 모달에 파라미터 적용
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
			const setupRes = await host.setupPreviewSequence({
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
			const applyRes = await host.applyPreviewParams({ params: list });
			// 적용 실패해도 캡처 시도
			if (statusEl) statusEl.textContent = "프레임 캡처 중...";
			// 3. 프레임 캡처
			const tmpDir = await host.getTempDir();
			const tmpPath = tmpDir + "/mogrt_preview_" + Date.now() + ".jpg";
			const captureRes = await host.capturePreviewFrame({ outputPath: tmpPath });
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
		let res;
		try {
			res = await host.previewParamsOnFirstClip({
				videoTrackIndex: trackIndex,
				startSec: -1,
				endSec: 0,
				params: paramList
			});
		} catch (err) {
			_setStatus$1("프리뷰 적용 실패: " + (err.hostReason || err.message), "err");
			return;
		}
		if (res.startsWith("SUCCESS")) _setStatus$1("프리뷰 적용됨", "ok");
		else _setStatus$1(res.replace("ERROR:", "").trim(), "err");
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
			item.innerHTML = `<span class='folder-icon'>📂</span><span class='folder-name'>${escapeHtml(node.name)}</span><span class='folder-count'>${directCount > 0 ? directCount : ""}</span>`;
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
					const freshParams = await host.getPreviewClipParams();
					if (!Array.isArray(freshParams)) return;
					// 변경 없으면 무시
					const freshHash = JSON.stringify(freshParams);
					if (freshHash === _reverseSyncLastHash) return;
					_reverseSyncLastHash = freshHash;
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
	//#endregion
	//#region src/ui/subtitleList.ts
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
			let res;
			try {
				res = await host.seekToClip({ startSec: sub.startSec });
			} catch (err) {
				_setStatus("이동 실패: " + (err.hostReason || err.message), "err");
				return;
			}
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
			host.getSystemFonts().then((fonts) => {
				_cachedSystemFonts = fonts;
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
		let res;
		try {
			res = await host.updateClipAtTime({
				videoTrackIndex: trackIndex,
				startSec: sub.startSec,
				endSec: sub.endSec,
				mogrtPath: preset.mogrtPath,
				params
			});
		} catch (err) {
			_setStatus("클립 업데이트 실패: " + (err.hostReason || err.message), "err");
			return;
		}
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
		let syncData;
		try {
			syncData = await host.syncAllClipsFromTimeline(trackIndex);
		} catch (err) {
			_setStatus("동기화 실패: " + (err.hostRaw || err.hostReason || err.message), "err");
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
	//#endregion
	//#region src/main.ts
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
		host.getMogrtScanDirs().catch(() => []).then((dirs) => {
			if (!Array.isArray(dirs) || dirs.length === 0) {
				if (!silent) mogrtStatus.textContent = "MOGRT 없음";
				_scanInProgress = false;
				return;
			}
			// 2단계: 폴더별로 순차 스캔 (각 호출 사이에 다른 호스트 호출 끼어들기 가능)
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
				host.scanMogrtFolder(folderPath).then((list) => {
					if (Array.isArray(list)) list.forEach((item) => {
						if (!state.mogrtList.some((m) => m.path === item.path)) {
							state.mogrtList.push(item);
							totalAdded++;
						}
					});
				}).catch(() => {}).then(() => {
					// 한 폴더가 실패해도 스캔 전체가 멈추지 않도록 진행은 항상 보장한다.
					// (여기서 멈추면 _scanInProgress가 true로 고착된다)
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
			host.getMogrtFolderTree().then((tree) => {
				window._cachedFolderTree = tree;
			}).catch(() => {});
		}
	}, 1000);
	// MOGRT 스캔: JSX 응답을 기다리지 않고 독립적으로 시작 (스캔이 시퀀스 정보에 의존하지 않음)
	setTimeout(() => doScanMogrt(false), 0);
	setInterval(() => doScanMogrt(true), 3e4);
	// 시퀀스 정보는 백그라운드로 비동기 로드 (스캔을 블로킹하지 않음)
	host.getActiveSequenceInfo().then((info) => {
		try {
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
	}).catch(() => {});
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
			let info;
			try {
				info = await host.getActiveSequenceInfo();
			} catch (_) {
				return;
			}
			try {
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
		let res;
		try {
			res = await host.applyToTimeline({
				videoTrackIndex: trackIndex,
				subtitles: items
			});
		} catch (err) {
			btnApply.disabled = false;
			setStatus("타임라인 적용 실패: " + (err.hostReason || err.message), "err");
			return;
		}
		btnApply.disabled = false;
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
			host.selectExportFolder().then((result) => {
				if (result !== "CANCEL" && !result.startsWith("ERROR")) {
					document.getElementById("exportFolderPath").value = result.trim();
				}
			}).catch(() => {});
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
				// CEP 네이티브 파일 쓰기 (호스트 호출 문자열 길이 제한 우회)
				const writeResult = window.cep && window.cep.fs ? window.cep.fs.writeFile(savePath, json, cep.encoding.UTF8) : null;
				if (writeResult && writeResult.err === 0) {
					modal.classList.remove("open");
					setStatus("프리셋 내보내기 완료: " + selectedIds.length + "개 → " + savePath, "ok");
				} else {
					// fallback: 호스트 어댑터를 통한 저장
					host.saveTextFile({ path: savePath, content: json }).then((r) => {
						if (r.startsWith("SUCCESS")) {
							modal.classList.remove("open");
							setStatus("프리셋 내보내기 완료: " + selectedIds.length + "개 → " + savePath, "ok");
						} else {
							setStatus("저장 실패: " + r, "err");
						}
					}).catch((err) => {
						setStatus("저장 실패: " + (err.hostReason || err.message), "err");
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
		host.saveTextFileWithDialog({ defaultName: defaultFileName, content: json }).then((r) => {
			if (r === "CANCEL") { setStatus("저장 취소", ""); return; }
			if (r.startsWith("SUCCESS")) setStatus("작업 저장 완료: " + r.replace("SUCCESS:", "").trim(), "ok");
			else setStatus("저장 실패: " + r, "err");
		}).catch((err) => {
			setStatus("저장 실패: " + (err.hostReason || err.message), "err");
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
			'<span class="hist-label">' + escapeHtml(entry.label || (isManual ? "수동저장" : "자동저장")) + '</span>' +
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

	//#endregion
})();
