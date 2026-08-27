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
