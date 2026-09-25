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
		presetViewMode: "list",
		// 다화자(v28) 블록: salt·hwm·화자 표·applied. 로더가 키마다 항상 새로 넣는다 (다른 시퀀스의 mi가 새지 않게).
		// miHasData일 때만 session.json에 쓴다 → 단일 화자 파일은 v27과 같은 키 4개
		mi: miDefault()
	};
	var _cachedSystemFonts = null; // 시스템 폰트 캐시 (전역)
	// 부팅·세션 플래그. 부팅 중 TDZ를 피하려고 맨 앞 state region에 둔다.
	//   _keysResolved      실제(프리뷰가 아닌) 시퀀스로 프로젝트·시퀀스 키가 정해졌다. 그 전에는
	//                      SRT 열기·적용·작업 불러오기를 막고 세션 파일에 쓰지 않는다 (부팅 게이트)
	//   _filtersReady      main.ts의 검색·프리셋 필터 선언이 끝났다 (renderAll에서 필터를 부르기 전 확인)
	//   _sessionReadFailed 지금 키의 session.json이 있는데 읽지 못했다. 그 파일을 덮지 않는다
	//                      (새 작업을 저장할 때 그 파일을 옆 이름으로 옮겨 보관한 뒤 풀린다)
	var _keysResolved = false, _filtersReady = false, _sessionReadFailed = false;
	// 활성 시퀀스 표시(#activeSeqLabel)의 마지막 정보. 세션 읽기 실패 경고를 다시 그릴 때 쓴다
	var _seqLabelInfo = null;
	// 여러 SRT 가져오기(다화자) 플래그. S2-4(화자별 배치)까지 false: 운영은 v27처럼 SRT 한 개만 연다.
	// DEV·하드 테스트는 코드를 고치지 않고 window._mogrtDebug.setMiCast(true)로 켠다 (_miCastEnabled)
	const MI_CAST_ENABLED = false;
	// 화자 줄의 ▶·↑ 안내 (화자별 트랙 배치는 S2-4. 그 전에는 v27 한 트랙 경로로 보내지 않는다)
	const CAST_APPLY_PENDING_MSG = "화자별 배치는 개발 중입니다";
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
	// 파일이 있는가 (cep.fs.stat). cep.fs가 없으면 false
	function _fsExists(filePath) {
		try {
			return !!(window.cep && window.cep.fs && window.cep.fs.stat(filePath).err === 0);
		} catch (_) { return false; }
	}
	// _fsRead와 달리 '없음'과 '있는데 못 읽음'을 가른다 → {exists, data, error}
	//   없음(ERR_NOT_FOUND)        {exists: false, data: null, error: null}
	//   읽기·파싱 실패, 객체가 아님  {exists: true,  data: null, error: "…"}
	function _fsReadEx(filePath) {
		try {
			if (!window.cep || !window.cep.fs) return { exists: false, data: null, error: null };
			const st = window.cep.fs.stat(filePath);
			if (st.err !== 0) {
				const notFound = st.err === (window.cep.fs.ERR_NOT_FOUND || 3);
				return notFound ? { exists: false, data: null, error: null } : { exists: true, data: null, error: "stat 오류 " + st.err };
			}
			const res = window.cep.fs.readFile(filePath);
			if (res.err !== 0) return { exists: true, data: null, error: "읽기 오류 " + res.err };
			if (!res.data) return { exists: true, data: null, error: "빈 파일" };
			const data = JSON.parse(res.data);
			if (!data || typeof data !== "object" || Array.isArray(data)) return { exists: true, data: null, error: "형식 오류" };
			return { exists: true, data, error: null };
		} catch (e) {
			return { exists: true, data: null, error: "파싱 실패: " + ((e && e.message) || e) };
		}
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
	// 안전 지점: 목록을 바꾸는 동작 직전의 상태 (자동저장과 따로 둔다)
	function _getHistorySafetyPath() {
		const root = _getCacheRoot();
		if (!root) return null;
		return root + "/" + state.currentProjectKey + "/" + state.currentSequenceKey + "/history_safety.json";
	}
	// cast.json: 화자 표 사본 (v27이 저장하며 session.json의 mi를 버려도 되살린다)
	function _getCastPath() {
		const root = _getCacheRoot();
		if (!root) return null;
		return root + "/" + state.currentProjectKey + "/" + state.currentSequenceKey + "/cast.json";
	}
	function _getTrackPath() {
		const root = _getCacheRoot();
		if (!root) return null;
		return root + "/" + state.currentProjectKey + "/" + state.currentSequenceKey + "/settings.json";
	}
	// ── localStorage → 파일 마이그레이션 (최초 1회) ──
	// 파일이 '있는가'는 _fsExists로 본다. _fsRead는 있는데 읽지 못한 파일에도 null을 돌려주므로
	// 그것으로 판단하면 깨진 session.json 등을 localStorage의 옛 값으로 덮어 버린다.
	function _migrateFromLocalStorage() {
		try {
			// 프리셋 마이그레이션
			const presetsPath = _getPresetsPath();
			if (presetsPath) {
				if (!_fsExists(presetsPath)) {
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
				if (!_fsExists(sessionPath)) {
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
				if (!_fsExists(histPath)) {
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
				if (!_fsExists(trackPath)) {
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
	// 세션 저장. 다음 경우에는 쓰지 않는다.
	//   - 키가 정해지기 전 (부팅 게이트): 기본 키(default_seq)의 기존 목록을 빈 목록으로 덮지 않게
	//   - 지금 키의 session.json을 읽지 못했을 때: 읽지 못한 파일을 메모리 값으로 덮지 않는다.
	//     읽기 실패 때 목록을 비웠으므로, 목록이나 휴지통이 다시 찼다면 이 시퀀스에서 새로 한 작업이다.
	//     그때 읽지 못한 파일을 session.json.unreadable-<시각>으로 옮겨 보관하고 저장을 이어 간다
	//     (옮기지 못하면 쓰지 않고 오류를 보인다). 비어 있으면 아무것도 하지 않는다 (전환 직전 저장 등).
	//   - 자막과 휴지통이 모두 비었고 파일도 없을 때: 들르기만 한 시퀀스마다 빈 파일이 생기지 않게
	function saveSessionToStorage() {
		try {
			if (!_keysResolved) return;
			const path = _getSessionPath();
			if (!path) return;
			if (_sessionReadFailed) {
				if (state.subtitles.length === 0 && state.trashBin.length === 0) return;
				const kept = _setAsideUnreadable(path);
				if (kept === null) {
					setStatus("세션 파일을 읽지 못했고 옮기지도 못해 이 시퀀스에는 저장하지 않습니다 (파일을 확인하세요)", "err");
					return;
				}
				_sessionReadFailed = false;
				_renderSeqLabel();
				if (kept) showAlert("이 시퀀스의 세션 파일을 읽지 못해 목록을 비웠었습니다.\n읽지 못한 파일은 다음 이름으로 옮겨 보관하고, 지금 작업을 새로 저장합니다.\n\n" + kept);
			}
			if (state.subtitles.length === 0 && state.trashBin.length === 0 && !miHasData(state.mi) && !_fsExists(path)) return;
			const data = {
				subtitles: state.subtitles,
				rowStates: state.rowStates,
				trashBin: state.trashBin,
				nextId: state.nextId
			};
			// mi는 salt나 화자가 있을 때만 싣는다 (단일 화자 파일은 키 4개 그대로)
			if (miHasData(state.mi)) data.mi = state.mi;
			if (_fsWrite(path, data)) _saveCastSidecar();
		} catch (_) {}
	}
	// cast.json을 mi의 화자 표·salt·hwm과 맞춘다 (내용이 바뀌었을 때만 쓴다).
	// session.json을 쓸 때마다 부르므로 화자·salt가 바뀌면 곧바로 따라간다. mi에 쓸 것이 없으면 쓰지 않는다.
	var _castSidecarSig = "";
	function _saveCastSidecar() {
		try {
			if (!_keysResolved || _sessionReadFailed || !miHasData(state.mi)) return false;
			const path = _getCastPath();
			if (!path) return false;
			const body = castSidecarOf(state.mi);
			const sig = path + "|" + stableJson(body);
			if (sig === _castSidecarSig && _fsExists(path)) return true;
			const data = Object.assign({ v: body.v, savedAt: new Date().toISOString() }, body);
			if (!_fsWrite(path, data)) return false;
			_castSidecarSig = sig;
			return true;
		} catch (_) { return false; }
	}
	// 불러온 session.json(없으면 null)에 맞는 mi. 로더는 이 값을 항상 넣는다.
	//   파일에 mi가 있다            → miFromFile (salt·hwm·applied 그대로)
	//   mi는 없고 spk 줄 + 쓸 만한 cast.json → cast.json에서 (applied는 빈 값)
	//   그 밖                         → miDefault()
	function _miForLoadedSession(sdata) {
		if (sdata && sdata.mi && typeof sdata.mi === "object" && !Array.isArray(sdata.mi)) return miFromFile(sdata.mi);
		if (sdata && Array.isArray(sdata.subtitles) && sdata.subtitles.some((s) => s && s.spk)) {
			const path = _getCastPath();
			const side = path ? _fsRead(path) : null;
			if (castSidecarUsable(sdata, side)) {
				console.warn("[MOGRT] session.json에 mi가 없어 cast.json에서 화자 표를 되살림:", path);
				return miFromCast(side);
			}
		}
		return miDefault();
	}
	// 발급한 가장 큰 id를 mi.hwm에 올린다 (내리지 않는다). id를 새로 주거나 복원한 뒤 부른다
	function _raiseHwm() {
		const top = state.nextId - 1;
		if (top > (state.mi.hwm || 0)) state.mi.hwm = top;
	}
	// 히스토리·작업 파일 복원: 화자 표는 스냅숏에서, salt·hwm·applied는 지금 값.
	// 스냅숏이 없으면(단일 화자 항목·v27 파일) 화자 표가 빈 상태로 돌아간다.
	function _miRestore(snap) {
		state.mi = miRestoreFrom(state.mi, snap && typeof snap === "object" && !Array.isArray(snap) ? snap : miSnapshotOf(miDefault()));
	}
	// 읽지 못한 세션 파일을 같은 폴더의 path.unreadable-<YYYYMMDD-HHMMSS>로 옮긴다 (지우지 않는다).
	//   → 옮긴 경로 / "" (그 사이 파일이 없어져 옮길 것이 없다) / null (옮기지 못했다: 쓰면 안 된다)
	function _setAsideUnreadable(path) {
		try {
			if (!_fsExists(path)) return "";
			if (!window.cep || !window.cep.fs || typeof window.cep.fs.rename !== "function") return null;
			const d = new Date();
			const p2 = (n) => String(n).padStart(2, "0");
			const ts = d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + "-" + p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds());
			let dest = path + ".unreadable-" + ts;
			for (let i = 2; _fsExists(dest); i++) dest = path + ".unreadable-" + ts + "-" + i;
			const r = window.cep.fs.rename(path, dest);
			if (!r || r.err !== 0 || _fsExists(path)) {
				console.error("[MOGRT] 읽지 못한 세션 파일을 옮기지 못함:", path, r && r.err);
				return null;
			}
			console.warn("[MOGRT] 읽지 못한 세션 파일을 옮겨 보관:", dest);
			return dest;
		} catch (e) {
			console.error("[MOGRT] 읽지 못한 세션 파일 옮기기 예외:", e);
			return null;
		}
	}
	// ── state.subtitles / state.presets 대입 창구 ──
	//
	// 이 둘만 setter를 둔다. 변경 시 파일 저장이 따라붙어야 하는 값이라
	// 대입 지점을 모아두면 저장 누락과 중복 저장을 한 곳에서 통제할 수 있다.
	// 나머지 state 필드는 그대로 직접 대입한다(계획서 §4 범위).
	//
	// opts.persist  기본 true. 대입 직후 저장한다. 새로 추가되는 대입이
	//               저장을 잊어도 기본값이 받아준다.
	//               false로 넘기는 경우는 둘 중 하나다.
	//                 - 저장소에서 막 읽어온 값을 넣을 때. 되쓰면 의미 없는
	//                   쓰기이고, 초기화 중이라 저장 경로 키가 아직 확정되지
	//                   않았을 수도 있다.
	//                 - 뒤이어 다른 필드까지 고친 뒤 명시적으로 저장하는 흐름.
	//                   여기서 저장하면 같은 동작에 쓰기가 두 번 생긴다.
	// opts.reason   추적용 라벨. window._mogrtDebug.traceState = true 일 때만
	//               콘솔에 남는다. 평소에는 비용이 없다.
	function _traceState(field, next, reason) {
		if (!window._mogrtDebug || !window._mogrtDebug.traceState) return;
		const size = Array.isArray(next) ? next.length + "개" : Object.keys(next || {}).length + "개";
		console.log("[state] " + field + " \u2190 " + size + (reason ? " (" + reason + ")" : ""));
	}
	function setSubtitles(next, opts) {
		_traceState("subtitles", next, opts && opts.reason);
		state.subtitles = next;
		if (!opts || opts.persist !== false) saveSessionToStorage();
	}
	function setPresets(next, opts) {
		_traceState("presets", next, opts && opts.reason);
		state.presets = next;
		if (!opts || opts.persist !== false) savePresetsToStorage();
	}
	// 지금 키의 session.json을 메모리에 넣는다 (키가 바뀔 때마다: 같은 프로젝트든 다른 프로젝트든).
	//   파일 있음        그 내용으로 바꾼다 (빠진 키는 빈 값)
	//   파일 없음        세션 상태를 비운다 (이전 시퀀스·프로젝트의 목록이 새 키로 새지 않게)
	//   있는데 못 읽음   세션 상태를 비우고 _sessionReadFailed → 그 파일은 덮지 않는다.
	//                    메모리의 목록은 이전 키(다른 시퀀스)의 것이라 남겨 두면 ▶로 이 시퀀스에 적용되거나
	//                    이 키에 저장될 수 있다. 목록을 다시 채우는 새 작업이 저장될 때 saveSessionToStorage가
	//                    읽지 못한 파일을 옆 이름으로 옮겨 보관한다.
	function _loadSessionForKey(reason) {
		const path = _getSessionPath();
		const r = path ? _fsReadEx(path) : { exists: false, data: null, error: null };
		const failed = r.exists && !r.data;
		_sessionReadFailed = failed;
		if (failed) {
			console.error("[MOGRT] 세션 파일 읽기 실패:", path, r.error);
			setStatus("세션 파일을 읽지 못했습니다 (" + r.error + ") — 파일은 그대로 두고 목록을 비웠습니다. 새로 작업하면 그 파일은 옆 이름으로 옮겨 보관합니다", "err");
		}
		_renderSeqLabel();
		const sdata = r.data || {};
		setSubtitles(Array.isArray(sdata.subtitles) ? sdata.subtitles : [], { reason: failed ? reason + " (읽기 실패)" : r.exists ? reason : reason + " (파일 없음)", persist: false });
		state.rowStates = sdata.rowStates && typeof sdata.rowStates === "object" ? sdata.rowStates : {};
		state.trashBin = Array.isArray(sdata.trashBin) ? sdata.trashBin : [];
		// mi를 먼저 넣는다: 아래에서 예외가 나도 이전 시퀀스의 salt·화자 표가 이 키에 남지 않는다.
		// nextId는 hwm 위로 (cast.json에서 되살린 hwm이 파일의 nextId보다 클 수 있다: v27 복원·작업 불러오기가
		// nextId를 내리고 mi 없이 저장한 경우). 줄·휴지통은 위에서 거른 배열로 본다 (파일의 타입이 틀려도 던지지 않게)
		state.mi = _miForLoadedSession(r.data || null);
		state.nextId = r.exists ? safeNextId({ nextId: sdata.nextId, subtitles: state.subtitles, trashBin: state.trashBin }, state.mi.hwm) : 1;
	}
	function loadSessionFromStorage() {
		try {
			_loadSessionForKey("세션 로드");
			// 프리셋 없는 고아 presetId 정리
			_sanitizeOrphanPresets();
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
			if (rs.presetId && !state.presets[rs.presetId]) {
				// 끊은 id도 새 프리셋에 다시 주지 않는다 (작업 파일·다른 시퀀스가 아직 그 id를 가리킬 수 있다)
				_notePresetRef(presetNum(rs.presetId));
				rs.presetId = "";
			}
		});
		// 유효한 presetId만 색상 맵에 등록
		const usedPresets = new Set(Object.values(state.rowStates).map((rs) => rs.presetId).filter(Boolean));
		usedPresets.forEach((pid) => _getPresetColorIndex(pid));
	}
	// 안전 지점 복원용: 복원한 줄(rowStates)이 가리키는데 살아 있지 않은 프리셋을 프리셋 휴지통에서 되살린다.
	// 프리셋 가져오기(교체)·프리셋 삭제가 줄의 연결을 끊으며 휴지통에 보낸 프리셋이다. 프리셋 id는 다시 주지 않으므로
	// 휴지통의 같은 id가 바로 그 프리셋이다 (같은 id가 여럿이면 가장 나중에 버린 것).
	// 휴지통에도 없으면(비웠다) 그대로 둔다 → 뒤따르는 _sanitizeOrphanPresets()가 연결을 끊는다.
	// → 되살린 프리셋 수. 호출한 쪽이 savePresetsToStorage()와 프리셋 목록·휴지통 다시 그리기를 한다
	function _revivePresetsForRows(rowStates) {
		const want = {};
		Object.values(rowStates || {}).forEach((rs) => {
			if (rs && rs.presetId && !state.presets[rs.presetId]) want[rs.presetId] = true;
		});
		let n = 0;
		Object.keys(want).forEach((id) => {
			for (let i = state.presetTrash.length - 1; i >= 0; i--) {
				const t = state.presetTrash[i];
				if (t && t.preset && t.preset.id === id) {
					state.presetTrash.splice(i, 1);
					state.presets[id] = migratePreset(t.preset);
					n++;
					return;
				}
			}
		});
		return n;
	}
	// ── 프리셋 id 참조 (메모리 밖) ──
	// 메모리(프리셋·휴지통·지금 시퀀스의 행)에 없는데 id를 가리키는 곳: 이 프로젝트의 다른 시퀀스
	// session.json과 히스토리, 불러온 작업 파일. v27 가져오기가 카운터를 1로 되돌리고 프리셋을
	// 지웠으므로 그런 id가 저장된 nextPresetId보다 클 수 있다. 그 id를 새 프리셋에 주면 그 시퀀스를
	// 열 때 행이 조용히 다른 MOGRT를 가리킨다. 프로젝트 키마다 가장 큰 번호만 기억한다 (메모리).
	var _presetRefMax = {};   // projKey → {disk: 디스크를 훑었는가, max: 본 가장 큰 번호}
	function _presetRefEntry() {
		const pk = state.currentProjectKey;
		if (!_presetRefMax[pk]) _presetRefMax[pk] = { disk: false, max: 0 };
		return _presetRefMax[pk];
	}
	function _notePresetRef(n) {
		const e = _presetRefEntry();
		if (n > e.max) e.max = n;
	}
	// cache/<projKey>/*/PRESET_REF_FILES({session,history_auto,history_manual,history_safety,cast}.json)의 "presetId":"preset_N" 중 가장 큰 N.
	// 파싱하지 않고 글자로만 찾는다 (깨진 파일도 본다). 프로젝트 키마다 한 번 (처음 id를 줄 때).
	// 그 뒤로 디스크에 새로 생기는 참조는 살아 있거나 휴지통에 있던 프리셋의 것이라 카운터가 덮는다.
	function _scanDiskPresetRefs() {
		const e = _presetRefEntry();
		if (e.disk) return;
		const root = _getCacheRoot();
		const fsx = window.cep && window.cep.fs;
		if (!root || !fsx || typeof fsx.readdir !== "function") return;
		e.disk = true;
		try {
			const dir = root + "/" + state.currentProjectKey;
			const ls = fsx.readdir(dir);
			if (!ls || ls.err !== 0 || !Array.isArray(ls.data)) return;
			const re = /"presetId"\s*:\s*"preset_(\d+)"/g;
			ls.data.forEach((name) => {
				PRESET_REF_FILES.forEach((f) => {
					const r = fsx.readFile(dir + "/" + name + "/" + f);
					if (!r || r.err !== 0 || !r.data) return;
					let m;
					re.lastIndex = 0;
					while ((m = re.exec(r.data))) _notePresetRef(parseInt(m[1], 10));
				});
			});
		} catch (err) {
			console.warn("[MOGRT] 프리셋 참조 훑기 실패:", err);
		}
	}
	// 새 id가 피해야 할 참조: 행·자막 휴지통·화자 표가 가리키는 id + 메모리 밖에서 본 가장 큰 번호
	function _presetRefs() {
		_scanDiskPresetRefs();
		const refs = [];
		Object.values(state.rowStates || {}).forEach((rs) => { if (rs && rs.presetId) refs.push(rs.presetId); });
		(state.trashBin || []).forEach((t) => { if (t && t.state && t.state.presetId) refs.push(t.state.presetId); });
		const cast = (state.mi && state.mi.cast) || {};
		Object.keys(cast).forEach((k) => { if (cast[k] && cast[k].presetId) refs.push(cast[k].presetId); });
		const outside = _presetRefEntry().max;
		if (outside > 0) refs.push("preset_" + outside);
		return refs;
	}
	// 새 프리셋 id (단조 증가, 빈 번호를 다시 쓰지 않는다). state.nextPresetId를 함께 올린다.
	// 참조: 살아 있는 프리셋, 프리셋 휴지통, 행과 자막 휴지통·화자 표(mi.cast)가 가리키는 id, 메모리 밖 참조(_presetRefs).
	// (S2-3에서 cast_defaults가 참조에 더해진다)
	// 호출한 쪽이 savePresetsToStorage()로 저장한다.
	function _allocPresetId() {
		const r = nextFreePresetId(state.presets, state.presetTrash, _presetRefs(), state.nextPresetId);
		state.nextPresetId = r.next;
		return r.id;
	}
	// 카운터를 알려진 모든 id 위로 올린다 (id를 주지는 않는다, 내리지 않는다).
	// 프리셋 휴지통을 비우기 전에 부른다: 휴지통이 그 id의 마지막 기록일 수 있고, 저장된 카운터는 낡았을 수 있다.
	// 호출한 쪽이 savePresetsToStorage()로 저장한다.
	function _raisePresetCounter() {
		const r = nextFreePresetId(state.presets, state.presetTrash, _presetRefs(), state.nextPresetId);
		if (r.next - 1 > state.nextPresetId) state.nextPresetId = r.next - 1;
	}
	// opts.presetsOnly: 부팅 때. 키가 정해지기 전이라 세션(목록)은 읽지 않는다.
	// 프리셋은 v27처럼 파일이 없으면 메모리의 것을 그대로 가져간다.
	function loadAllFromStorage(opts) {
		// 마이그레이션 먼저 시도 (최초 1회, 파일 없을 때만 localStorage에서 복사)
		_migrateFromLocalStorage();
		try {
			const path = _getPresetsPath();
			const data = path ? _fsRead(path) : null;
			if (data) {
				if (data.presets) {
					const migrated = {};
					for (const [id, preset] of Object.entries(data.presets)) migrated[id] = migratePreset(preset);
					setPresets(migrated, { reason: "프리셋 로드", persist: false });
				}
				if (data.presetTrash) state.presetTrash = data.presetTrash;
				if (data.nextPresetId) state.nextPresetId = data.nextPresetId;
			}
		} catch (_) {}
		if (!(opts && opts.presetsOnly)) {
			try {
				_loadSessionForKey("전체 로드");
			} catch (_) {}
		}
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

	// 호스트 호출 뒤 활성 시퀀스가 바뀌었으면 before(getActiveSequenceInfo 결과)의 시퀀스로 되돌린다.
	// 프리뷰 시퀀스가 활성이던 경우와 정보를 못 읽은 경우는 건드리지 않는다. 실패해도 조용히 넘어간다.
	async function _restoreActiveSequence(before) {
		if (!before || !before.seqId || before.seqName === "__MOGRT_PREVIEW__") return;
		try {
			const now = await host.getActiveSequenceInfo();
			if (now && now.seqId === before.seqId) return;
			const script = `(function(id){ var p = app.project; for (var i = 0; i < p.sequences.numSequences; i++) { var s = p.sequences[i]; if (String(s.sequenceID) === id) { app.project.activeSequence = s; return "RESTORED"; } } return "NOTFOUND"; })(${_encodeArg(before.seqId)})`;
			const r = await _invoke("restoreActiveSequence", script);
			console.warn("[MOGRT] 활성 시퀀스 되돌림:", (now && now.seqName) || "?", "→", before.seqName, r);
		} catch (e) {
			console.warn("[MOGRT] 활성 시퀀스 되돌리기 실패:", (e && e.message) || e);
		}
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
		// 프리뷰 시퀀스를 새로 만들 때 v27 호스트가 작업 시퀀스 대신 프로젝트의 첫 시퀀스를 활성으로 되돌린다
		// (qe.newSequence 뒤에 저장해 둔 activeSequence가 프리뷰를 가리키게 되기 때문. 2026-09-25 실측).
		// 호스트는 바꾸지 않고, 부르기 전 시퀀스 ID를 기억했다가 달라졌으면 되돌린다.
		setupPreviewSequence: async (payload) => {
			let before = null;
			try { before = await host.getActiveSequenceInfo(); } catch (_) {}
			const r = await _callWithPayload("setupPreviewSequence", payload);
			await _restoreActiveSequence(before);
			return r;
		},
		applyPreviewParams: (payload) => _callWithPayload("applyPreviewParams", payload),
		capturePreviewFrame: (payload) => _callWithPayload("capturePreviewFrame", payload),
		seekToClip: (payload) => _callWithPayload("seekToClip", payload),
		previewParamsOnFirstClip: (payload) => _callWithPayload("previewParamsOnFirstClip", payload),
		saveTextFile: (payload) => _callWithPayload("saveTextFile", payload),
		saveTextFileWithDialog: (payload) => _callWithPayload("saveTextFileWithDialog", payload),

		// ── 경로 문자열 반환 ──
		selectExportFolder: () => _callNoArgs("selectExportFolder"),

		// 프리뷰 시퀀스(__MOGRT_PREVIEW__)가 지금 프로젝트에 있는가. v27 호스트 함수 findPreviewSequence를
		// 부르는 ExtendScript 식이다. 모르면 false (그러면 패널이 setupPreviewSequence로 만든다).
		hasPreviewSequence: async () => {
			try {
				return (await _invoke("findPreviewSequence", "findPreviewSequence() ? \"yes\" : \"no\"")) === "yes";
			} catch (_) {
				return false;
			}
		},

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
	// opts (다화자 가져오기용). 없으면 v27과 결과가 한 바이트도 다르지 않다 (골든 테스트).
	//   keepNo     파일의 원래 자막 번호를 srtNo로 남긴다 (번호 줄이 없으면 null)
	//   stripTags  <i> <b> <u> <font…>와 닫는 태그, {\an8} 같은 ASS 지시를 지운다 (안의 글자는 둔다)
	//   opts가 있으면 U+2028/2029를 LF로 바꾼다
	// stripSrtTags는 src/mi/core.ts에 있다 (opts 경로에서만 부른다).
	function parseSRT(text, opts) {
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
			let textLines = lines.slice(lineOffset + 1).join("\n").trim();
			if (opts) {
				textLines = textLines.replace(/[\u2028\u2029]/g, "\n");
				if (opts.stripTags) textLines = stripSrtTags(textLines);
				textLines = textLines.trim();
			}
			if (!textLines) continue;
			const cue = {
				index: idx++,
				startTime: timeMatch[1].replace(",", "."),
				endTime: timeMatch[2].replace(",", "."),
				startSec: timeToSec(timeMatch[1]),
				endSec: timeToSec(timeMatch[2]),
				text: textLines
			};
			if (opts && opts.keepNo) cue.srtNo = lineOffset ? parseInt(firstLine, 10) : null;
			results.push(cue);
		}
		return results;
	}
	//#endregion
	//#region src/mi/core.ts
	// ─────────────────────────────────────────────────────────────
	// 다화자(v28) 순수 로직. 함수 선언과 상수만 둔다.
	//
	// DOM, 전역 상태 객체, 호스트 어댑터, 파일 저장소를 참조하지 않는다.
	// node 테스트(tests/lib/loadRegions.js)가 이 region만 잘라 vm에서 돌리고,
	// 5단계 MCP 서버도 설치된 app.js에서 이 region을 읽어 해시를 확인한다.
	// 그래서 이 region은 다른 region의 함수를 부르지 않는다 (자기 완결).
	// 거꾸로 parseSRT(opts)는 여기의 stripSrtTags를 쓴다.
	//
	// 이름 규칙: 여기에는 MI 대문자 접두사 이름을 쓰지 않는다. DEV 설치가
	// 그 접두사를 MID로 바꾸므로 설치본과 저장소의 region 해시가 달라진다.
	// ─────────────────────────────────────────────────────────────

	// Premiere Time.ticks의 1초
	const TICKS_PER_SEC = 254016000000;
	// AE 텍스트 줄바꿈 규칙 (S0-3 d 결정 전 기본값: LF 그대로).
	// 실측이 CR을 요구하면 "\r"로 바꾼다. setTextValue만 이 값을 읽는다.
	const AE_NEWLINE = "\n";
	// namedParams가 이름으로 바꾸는 AE 속성 종류 (comment·textsetting·group은 그대로)
	const NAMED_PARAM_TYPES = { text: true, color: true, number: true, angle: true, point: true, dropdown: true, boolean: true };

	// ── 문자열·해시 ──

	// FNV-1a 32비트, UTF-8 바이트 기준 → 8자리 hex. 짝 없는 서로게이트는 U+FFFD로 센다
	// (TextEncoder·Buffer와 같은 바이트). fnv1a32("") = "811c9dc5"
	function fnv1a32(str) {
		const s = String(str == null ? "" : str);
		let h = 0x811c9dc5;
		const step = (b) => { h = Math.imul(h ^ b, 0x01000193) >>> 0; };
		for (let i = 0; i < s.length; i++) {
			let c = s.charCodeAt(i);
			if (c >= 0xd800 && c <= 0xdbff) {
				const d = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
				if (d >= 0xdc00 && d <= 0xdfff) { c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00); i++; }
				else c = 0xfffd;
			} else if (c >= 0xdc00 && c <= 0xdfff) c = 0xfffd;
			if (c < 0x80) step(c);
			else if (c < 0x800) { step(0xc0 | (c >> 6)); step(0x80 | (c & 63)); }
			else if (c < 0x10000) { step(0xe0 | (c >> 12)); step(0x80 | ((c >> 6) & 63)); step(0x80 | (c & 63)); }
			else { step(0xf0 | (c >> 18)); step(0x80 | ((c >> 12) & 63)); step(0x80 | ((c >> 6) & 63)); step(0x80 | (c & 63)); }
		}
		return ("0000000" + h.toString(16)).slice(-8);
	}
	// 키를 정렬한 JSON (같은 내용이면 필드 순서와 상관없이 같은 문자열). undefined·함수는 뺀다
	function stableJson(v) {
		if (v === null || v === undefined || typeof v === "function") return "null";
		if (typeof v !== "object") return JSON.stringify(v);
		if (Array.isArray(v)) return "[" + v.map((x) => stableJson(x)).join(",") + "]";
		const keys = Object.keys(v).filter((k) => v[k] !== undefined && typeof v[k] !== "function").sort();
		return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableJson(v[k])).join(",") + "}";
	}
	// 세션 내용 해시 (히스토리 중복 판정용). 필드 순서가 달라도 내용이 같으면 같다
	function contentHash(subtitles, rowStates, trashBin) {
		return fnv1a32(stableJson({ s: subtitles || [], r: rowStates || {}, t: trashBin || [] }));
	}

	// ── SRT 파일 ──

	// 자막 스타일 태그를 지운다: <i> <b> <u> <font …>와 닫는 태그, {\an8} 같은 ASS 지시
	function stripSrtTags(s) {
		return String(s == null ? "" : s)
			.replace(/<\/?(?:i|b|u|font)(?:\s[^>]*)?>/gi, "")
			.replace(/\{\\[^}]*\}/g, "");
	}
	// SRT 바이트 → {text, encoding, replaced}. replaced = 결과의 U+FFFD 개수
	//   1) BOM이 있으면 BOM을 따른다 (EF BB BF / FF FE / FE FF)
	//   2) 앞 200바이트의 홀수 위치 중 30% 이상이 0x00이면 UTF-16LE
	//   3) 아니면 non-fatal UTF-8로 읽어 U+FFFD를 센다(u). 0이면 UTF-8
	//   4) u > 0이면 euc-kr(CP949)로도 읽어 센다(k). k < u일 때만 euc-kr
	// fatal UTF-8이 실패하면 euc-kr로 넘어가는 방식은 깨진 바이트 하나로 파일 전체를 망가뜨린다.
	function decodeSrtBytes(input) {
		const b = ArrayBuffer.isView(input)
			? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
			: new Uint8Array(input || 0);
		const dec = (enc, from) => new TextDecoder(enc).decode(b.subarray(from || 0));
		const countBad = (s) => {
			let n = 0;
			for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 0xfffd) n++;
			return n;
		};
		const done = (text, encoding) => {
			if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // 남은 BOM 방어
			return { text, encoding, replaced: countBad(text) };
		};
		if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return done(dec("utf-8", 3), "utf-8");
		if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) return done(dec("utf-16le", 2), "utf-16le");
		if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) return done(dec("utf-16be", 2), "utf-16be");
		const head = Math.min(b.length, 200);
		let odd = 0;
		let zero = 0;
		for (let i = 1; i < head; i += 2) {
			odd++;
			if (b[i] === 0) zero++;
		}
		if (odd > 0 && zero / odd >= 0.3) return done(dec("utf-16le"), "utf-16le");
		const u8 = dec("utf-8");
		const u = countBad(u8);
		if (u === 0) return done(u8, "utf-8");
		let kr = null;
		try { kr = dec("euc-kr"); } catch (_) { kr = null; }
		if (kr !== null && countBad(kr) < u) return done(kr, "euc-kr");
		return done(u8, "utf-8");
	}
	// 파일 이름의 캡션 트랙 번호 → {key: "C2"|null, ambiguous, nums}
	// 확장자를 뺀 이름(NFC)에서 앞이 영숫자가 아니고 뒤도 영숫자가 아닌 C<1~99>를 찾는다.
	// 한글, _, -, 공백, .은 경계다. 서로 다른 번호가 둘 이상이면 모호(ambiguous)다.
	// 화자 이름은 파일 이름에서 가져오지 않는다.
	function parseCaptionKey(fileName) {
		let base = String(fileName == null ? "" : fileName).split(/[\\/]/).pop();
		base = base.replace(/\.[^.]*$/, "");
		if (base.normalize) base = base.normalize("NFC");
		const re = /(^|[^A-Za-z0-9])[Cc]0*([1-9][0-9]?)(?![0-9A-Za-z])/g;
		const nums = [];
		let m;
		while ((m = re.exec(base))) {
			const n = parseInt(m[2], 10);
			if (nums.indexOf(n) === -1) nums.push(n);
		}
		return { key: nums.length === 1 ? "C" + nums[0] : null, ambiguous: nums.length > 1, nums };
	}

	// ── 문장 비교 ──

	// 비교용 정규화: NFC, CR·CRLF·U+2028/2029 → LF, 태그 제거, 공백 접기, 빈 줄 제거
	function normText(s) {
		let t = String(s == null ? "" : s);
		if (t.normalize) t = t.normalize("NFC");
		t = stripSrtTags(t.replace(/\r\n?|[\u2028\u2029]/g, "\n"));
		t = t.replace(/[ \t\f\v\u00a0\u3000]+/g, " ");
		return t.split("\n").map((ln) => ln.trim()).filter((ln) => ln !== "").join("\n");
	}
	// 한글 음절을 초성·중성·종성 자모로 푼다 (U+1100대). 다른 글자는 그대로
	function jamo(s) {
		const str = String(s == null ? "" : s);
		let out = "";
		for (let i = 0; i < str.length; i++) {
			const c = str.charCodeAt(i);
			if (c >= 0xac00 && c <= 0xd7a3) {
				const k = c - 0xac00;
				out += String.fromCharCode(0x1100 + Math.floor(k / 588), 0x1161 + Math.floor((k % 588) / 28));
				if (k % 28) out += String.fromCharCode(0x11a7 + (k % 28));
			} else out += str[i];
		}
		return out;
	}
	// 편집 거리 (두 줄 DP)
	function levenshtein(a, b) {
		if (a === b) return 0;
		if (!a.length) return b.length;
		if (!b.length) return a.length;
		let prev = new Array(b.length + 1);
		let cur = new Array(b.length + 1);
		for (let j = 0; j <= b.length; j++) prev[j] = j;
		for (let i = 1; i <= a.length; i++) {
			cur[0] = i;
			const ca = a.charCodeAt(i - 1);
			for (let j = 1; j <= b.length; j++) {
				const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
				cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
			}
			const t = prev; prev = cur; cur = t;
		}
		return prev[b.length];
	}
	// 문장 유사도 0~1: 1 − (자모 편집 거리 / 긴 쪽 길이). 정규화 후 공백은 무시한다
	function textSim(a, b) {
		const x = jamo(normText(a)).replace(/\s+/g, "");
		const y = jamo(normText(b)).replace(/\s+/g, "");
		const n = Math.max(x.length, y.length);
		if (n === 0) return 1;
		return 1 - levenshtein(x, y) / n;
	}

	// ── 텍스트 필드 ID (T1..Tn) ──

	// 네이티브 템플릿 목록인가 (getMogrtParams 네이티브 분기의 nativeText 표시)
	function isNativeList(params) {
		return (params || []).some((p) => p && p.nativeText === true);
	}
	// type이 "text"인 param을 배열 순서대로 T1..Tn. pos = 배열 위치
	// ID는 저장하지 않고 항상 이렇게 계산한다 (rs.params로도, index+1로도 계산하지 않는다)
	function textFields(params) {
		const out = [];
		(params || []).forEach((p, pos) => {
			if (p && p.type === "text") out.push({ fid: "T" + (out.length + 1), index: p.index, displayName: p.displayName || "", pos });
		});
		return out;
	}
	// 프리셋의 캡션 필드 ID ('T' 버튼 = textParamIndex). -1이거나 텍스트가 아니면 null
	function captionFid(preset) {
		if (!preset || typeof preset.textParamIndex !== "number" || preset.textParamIndex < 0) return null;
		const f = textFields(preset.params).find((t) => t.index === preset.textParamIndex);
		return f ? f.fid : null;
	}
	// [{fid, index, displayName, caption?}] — caption은 캡션 필드에만 true로 붙는다
	function fieldIdMap(params, textParamIndex) {
		return textFields(params).map((t) => {
			const e = { fid: t.fid, index: t.index, displayName: t.displayName };
			if (typeof textParamIndex === "number" && textParamIndex >= 0 && t.index === textParamIndex) e.caption = true;
			return e;
		});
	}
	// "T1=전체 텍스트|T2=포인트 텍스트|…" (외부 쓰기의 필드 구조 확인용)
	function fieldSignature(params) {
		return textFields(params).map((t) => t.fid + "=" + t.displayName).join("|");
	}
	// 줄의 텍스트 필드를 프리셋의 T-ID로 모두 해석한다 → {T1: {fid, index, displayName, how, param}, …}
	//   1) 줄의 k번째 텍스트 필드 이름이 프리셋의 k번째와 같으면 "ordinal"
	//   2) 아니면 아직 쓰이지 않은 줄 텍스트 필드 중 같은 이름의 첫 번째 → "name"
	//   3) 그래도 없으면 빠진다 (그 ID로는 쓰지 않는다)
	// presetParams가 없으면 줄 자신의 서수로만 매긴다.
	// 둘 다 네이티브 목록이면 이름을 보지 않고 서수로만 짝짓는다 (이름은 표시용이고 호스트는 서수로 쓴다:
	// '텍스트 N'으로 저장된 줄과 definition 문구로 이름이 붙은 프리셋도 같은 필드다).
	function resolveFields(rowParams, presetParams) {
		const rowT = textFields(rowParams);
		const out = {};
		const mk = (rt, fid, how) => ({ fid, index: rt.index, displayName: rt.displayName, how, param: rowParams[rt.pos] });
		if (!presetParams) {
			rowT.forEach((rt) => { out[rt.fid] = mk(rt, rt.fid, "ordinal"); });
			return out;
		}
		const preT = textFields(presetParams);
		if (isNativeList(rowParams) && isNativeList(presetParams)) {
			preT.forEach((pt, k) => { if (rowT[k]) out[pt.fid] = mk(rowT[k], pt.fid, "ordinal"); });
			return out;
		}
		const used = {};
		preT.forEach((pt, k) => {
			const rt = rowT[k];
			if (rt && rt.displayName === pt.displayName) {
				out[pt.fid] = mk(rt, pt.fid, "ordinal");
				used[k] = true;
			}
		});
		preT.forEach((pt) => {
			if (out[pt.fid] || !pt.displayName) return;
			for (let j = 0; j < rowT.length; j++) {
				if (!used[j] && rowT[j].displayName === pt.displayName) {
					out[pt.fid] = mk(rowT[j], pt.fid, "name");
					used[j] = true;
					return;
				}
			}
		});
		return out;
	}
	// 줄에서 T-ID 하나를 해석한다. 못 찾으면 null (쓰지 않는다)
	function resolveFid(rowParams, fid, presetParams) {
		return resolveFields(rowParams, presetParams)[fid] || null;
	}
	// 네이티브 템플릿의 텍스트 필드 이름 (S0-3 결정 4). 호스트는 '텍스트 N'으로만 알려 준다.
	// definition.json clientControls 중 type 6(TextLayer)을 순서대로 쓰고(= Source Text·컴포넌트 순서,
	// 화면 위아래 순서와는 다를 수 있다), 이름은 각 컨트롤의 기본 문구(value.strDB에서 UI 로캘, 없으면 en_US,
	// 없으면 첫 항목)다. TextLayer 개수가 count와 다르면 null → 일반 이름을 그대로 둔다.
	// 줄바꿈은 " / "로 잇고 40자에서 자른다. 빈 문구는 '텍스트 k', 같은 이름이 또 나오면 " (2)"를 붙인다.
	function nativeTextLabels(def, count, locale) {
		const ctrls = def && Array.isArray(def.clientControls) ? def.clientControls.filter((c) => c && Number(c.type) === 6) : [];
		if (!(count > 0) || ctrls.length !== count) return null;
		const loc = String(locale == null ? "" : locale).replace("-", "_");
		const seen = {};
		return ctrls.map((c, k) => {
			const v = c.value;
			let str = "";
			if (typeof v === "string") str = v;
			else if (v && Array.isArray(v.strDB)) {
				const db = v.strDB.filter((e) => e && typeof e.str === "string");
				const hit = db.find((e) => loc && e.localeString === loc) || db.find((e) => e.localeString === "en_US") || db[0];
				str = hit ? hit.str : "";
			}
			let name = str.replace(/\r\n?|\n|[\u2028\u2029]/g, " / ").replace(/\s+/g, " ").trim();
			if (!name) name = "텍스트 " + (k + 1);
			if (name.length > 40) name = name.slice(0, 39) + "…";
			seen[name] = (seen[name] || 0) + 1;
			return seen[name] > 1 ? name + " (" + seen[name] + ")" : name;
		});
	}

	// ── 속성 구조 서명 ──

	// 목록 비교 해시: index 순으로 "index:t|o:displayName"을 이은 fnv. 네이티브는 "n:텍스트 개수"
	function paramSig(params) {
		const list = (params || []).filter(Boolean);
		if (isNativeList(list)) return fnv1a32("n:" + list.filter((p) => p.type === "text").length);
		return fnv1a32(list.slice().sort((a, b) => a.index - b.index)
			.map((p) => p.index + ":" + (p.type === "text" ? "t" : "o") + ":" + (p.displayName || "")).join("|"));
	}
	// 호스트가 읽은 클립 자체의 속성 레이아웃 해시. AE lay = [[이름, "t"|"o"], …], 네이티브 = {n}
	function clipLs(lay) {
		if (Array.isArray(lay)) return fnv1a32(lay.map((d, i) => i + ":" + d[1] + ":" + d[0]).join("|"));
		if (lay && typeof lay.n === "number") return fnv1a32("n:" + lay.n);
		return "";
	}
	// 줄의 속성 목록이 프리셋과 구조가 다른가: 배열 순서대로 (index, 텍스트 여부, displayName)를 비교한다.
	// type은 텍스트 여부로만 본다 (definition 패치의 number→dropdown 차이는 같은 속성이다).
	// 한쪽이 비어 있으면 비교할 것이 없어 false. 네이티브는 텍스트 개수만 본다(호스트가 서수로 쓴다).
	function layoutMismatch(rowParams, presetParams) {
		const a = rowParams || [];
		const b = presetParams || [];
		if (!a.length || !b.length) return false;
		if (isNativeList(a) || isNativeList(b)) return paramSig(a) !== paramSig(b);
		if (a.length !== b.length) return true;
		for (let i = 0; i < a.length; i++) {
			const x = a[i];
			const y = b[i];
			if (!x || !y) return true;
			if (x.index !== y.index || (x.type === "text") !== (y.type === "text") || (x.displayName || "") !== (y.displayName || "")) return true;
		}
		return false;
	}
	// 이름으로 쓰기: 이름이 목록 안에서 유일한 AE 쓰기 속성(text·color·number·angle·point·dropdown·boolean)의
	// index를 -1로 바꾼 사본. v27 applyParamsToItem은 index가 -1이면 displayName으로 속성을 찾는다.
	// 네이티브 목록(서수로만 쓴다)과 이름이 겹치는 속성은 그대로 둔다.
	function namedParams(params) {
		const list = (params || []).map((p) => (p && typeof p === "object" ? Object.assign({}, p) : p));
		if (isNativeList(list)) return list;
		const count = {};
		list.forEach((p) => { if (p && p.displayName) count[p.displayName] = (count[p.displayName] || 0) + 1; });
		list.forEach((p) => { if (p && p.displayName && count[p.displayName] === 1 && NAMED_PARAM_TYPES[p.type]) p.index = -1; });
		return list;
	}
	// v27 index 쓰기로 보내면 위험한 줄인가 (하나라도 참이면 참)
	//   - 줄의 속성 구조가 프리셋과 다름 (옛 버전 MOGRT로 만든 줄)
	//   - 마지막 검증 적용(ap)의 paramSig가 지금과 다름
	//   - 구조를 맞추기 전 서명(psOld)이 남아 있음
	// 프리셋이 없으면 v27도 MOGRT를 쓰지 않으므로 false.
	function isV27Unsafe(rs, preset) {
		if (!rs || !preset) return false;
		const all = rs._allParams || [];
		if (all.length) {
			if (layoutMismatch(all, preset.params)) return true;
		} else if ((rs.params || []).length) {
			// v27은 _allParams가 비면 노출 속성(rs.params)만 보낸다: 그 index들이 프리셋과 같은 속성인지 본다
			const pre = preset.params || [];
			const bad = rs.params.some((p) => {
				const q = pre.find((x) => x && p && x.index === p.index);
				return !q || (q.type === "text") !== (p.type === "text") || (q.displayName || "") !== (p.displayName || "");
			});
			if (bad) return true;
		}
		const sent = all.length ? all : rs.params || [];
		if (rs.ap && rs.ap.ps && rs.ap.ps !== paramSig(sent)) return true;
		if (rs.psOld) return true;
		return false;
	}

	// ── 텍스트 값 ──

	// 텍스트 param에 문장을 쓴다: value, rawValue.textEditValue, fontTextRunLength = [길이].
	// 행 편집기·프리셋 모달·loadParamsFromPreset에 흩어진 같은 로직의 공용 사본이다.
	// opts.aeNewline: AE 텍스트의 줄바꿈 (기본 AE_NEWLINE). 네이티브 텍스트는 LF 그대로 둔다.
	function setTextValue(param, text, opts) {
		if (!param) return param;
		let t = String(text == null ? "" : text);
		const nl = opts && typeof opts.aeNewline === "string" ? opts.aeNewline : AE_NEWLINE;
		if (!param.nativeText && nl !== "\n") t = t.replace(/\r\n?|\n/g, nl);
		param.value = t;
		if (typeof param.rawValue === "string" && param.rawValue.indexOf("\"textEditValue\"") !== -1) {
			try {
				const parsed = JSON.parse(param.rawValue);
				if (parsed && typeof parsed.textEditValue !== "undefined") {
					parsed.textEditValue = t;
					if (parsed.fontTextRunLength) parsed.fontTextRunLength = [t.length];
					param.rawValue = JSON.stringify(parsed);
				}
			} catch (_) { /* rawValue가 JSON이 아니면 value만 쓴다 */ }
		}
		return param;
	}
	// 포인트 텍스트 검사: '$$'로 나눈 조각이 모두 캡션 안에 그대로 있는가.
	// → {ok, segs, missing: 없는 조각, dup: 캡션에 두 번 이상 나오는 조각(첫 번째만 칠해짐), tooMany}
	// 빈 값은 포인트 텍스트가 아니다(ok false). max가 있으면 조각 수 상한도 본다.
	function pointSegmentsOk(value, caption, max) {
		const nfc = (s) => { const x = String(s == null ? "" : s); return x.normalize ? x.normalize("NFC") : x; };
		const cap = nfc(caption);
		const segs = nfc(value).split("$$").filter((s) => s !== "");
		const missing = [];
		const dup = [];
		segs.forEach((s) => {
			const i = cap.indexOf(s);
			if (i === -1) missing.push(s);
			else if (cap.indexOf(s, i + 1) !== -1) dup.push(s);
		});
		const tooMany = typeof max === "number" && max > 0 && segs.length > max;
		return { ok: segs.length > 0 && missing.length === 0 && !tooMany, segs, missing, dup, tooMany };
	}
	// comment 속성의 "최대 N개" 규칙 → N (여럿이면 가장 작은 값), 없으면 null
	// 예: "포인트 텍스트는 $$로 구분하며 최대 3개까지 입력 가능합니다." → 3
	function ruleMaxFromComments(params) {
		let best = null;
		(params || []).forEach((p) => {
			if (!p || p.type !== "comment") return;
			const s = String(p.displayName || "") + " " + String(p.value || "");
			const re = /최대\s*(\d+)\s*개/g;
			let m;
			while ((m = re.exec(s))) {
				const n = parseInt(m[1], 10);
				if (n > 0 && (best === null || n < best)) best = n;
			}
		});
		return best;
	}

	// ── id ──

	// 시퀀스 폴더에서 "presetId":"preset_N" 참조를 글자로 훑는 파일 (_scanDiskPresetRefs와 운영 캐시 호환 테스트가 함께 쓴다)
	const PRESET_REF_FILES = ["session.json", "history_auto.json", "history_manual.json", "history_safety.json", "cast.json"];
	// "preset_12" → 12, 형식이 아니면 0
	function presetNum(id) {
		const m = /^preset_(\d+)$/.exec(String(id == null ? "" : id));
		return m ? parseInt(m[1], 10) : 0;
	}
	// 단조 증가 프리셋 id: 1 + max(저장된 nextPresetId − 1, 알려진 모든 숫자 접미사).
	// 빈 번호를 메우지 않는다. presets는 {id: preset} 맵(또는 id·프리셋 배열),
	// presetTrash는 [{preset}], refs는 행·휴지통·cast가 가리키는 id들(배열·Set).
	// → {id: "preset_9", next: 10}  (next는 state.nextPresetId에 넣는다)
	function nextFreePresetId(presets, presetTrash, refs, storedNext) {
		let max = Math.max(0, (parseInt(storedNext, 10) || 1) - 1);
		const see = (id) => { const n = presetNum(id); if (n > max) max = n; };
		const seeItem = (x) => { if (x && typeof x === "object") see(x.preset ? x.preset.id : x.id); else see(x); };
		if (Array.isArray(presets)) presets.forEach(seeItem);
		else if (presets && typeof presets === "object") Object.keys(presets).forEach((k) => { see(k); seeItem(presets[k]); });
		(presetTrash || []).forEach(seeItem);
		if (refs) Array.from(refs).forEach(see);
		const n = max + 1;
		return { id: "preset_" + n, next: n + 1 };
	}
	// 프리셋 가져오기의 id 대응: 가져온 항목마다 이름이 같고 MOGRT 파일 이름(대소문자 무시)이 같은
	// 살아 있는 프리셋이 있으면 그 id를 다시 쓴다(파일의 id와 같은 후보를 먼저). 한 id는 한 번만 쓴다.
	// items: [{id: 파일의 id, name, mogrtPath}], live: {id: preset}
	// → {ids: [다시 쓸 id | null(새 id 필요)], dropped: [다시 쓰이지 않은 live id]}
	function matchImportedPresets(items, live) {
		const base = (p) => String((p && p.mogrtPath) || "").split(/[\\/]/).pop().toLowerCase();
		const liveIds = live && typeof live === "object" ? Object.keys(live) : [];
		const taken = {};
		const ids = (items || []).map((it) => {
			const cands = liveIds.filter((id) => !taken[id] && live[id] && it && live[id].name === it.name && base(live[id]) === base(it));
			if (!cands.length) return null;
			const id = cands.indexOf(it.id) !== -1 ? it.id : cands[0];
			taken[id] = true;
			return id;
		});
		return { ids, dropped: liveIds.filter((id) => !taken[id]) };
	}
	// 줄 id 다시 매기기 (다른 시퀀스의 작업 파일): startId부터 줄 → 휴지통 순으로.
	// rowStates 키와 줄 id가 함께 바뀌고, 휴지통 항목은 제 상태를 품고 새 id를 받는다.
	// 입력은 바꾸지 않는다. → {subtitles, rowStates, trashBin, nextId, map: {옛 id: 새 id}}
	function remapIds(data, startId) {
		const src = JSON.parse(JSON.stringify(data || {}));
		let next = Math.max(1, parseInt(startId, 10) || 1);
		const map = {};
		const rsIn = src.rowStates && typeof src.rowStates === "object" ? src.rowStates : {};
		const rsOut = {};
		const taken = {};
		const subtitles = (Array.isArray(src.subtitles) ? src.subtitles : []).filter(Boolean);
		subtitles.forEach((s) => {
			const old = s.id;
			const nid = next++;
			if (map[old] === undefined) map[old] = nid;
			s.id = nid;
			if (rsIn[old] !== undefined) {
				rsOut[nid] = taken[old] ? JSON.parse(JSON.stringify(rsIn[old])) : rsIn[old];
				taken[old] = true;
			}
		});
		const trashBin = (Array.isArray(src.trashBin) ? src.trashBin : []).filter(Boolean);
		trashBin.forEach((t) => {
			if (!t.sub) return;
			const old = t.sub.id;
			const nid = next++;
			if (map[old] === undefined) map[old] = nid;
			t.sub.id = nid;
		});
		return { subtitles, rowStates: rsOut, trashBin, nextId: next, map };
	}
	// 복원 뒤의 nextId: max(복원한 nextId, hwm + 1, 현재 nextId, 복원한 줄·휴지통의 최대 id + 1)
	// 배열이 아닌 subtitles·trashBin은 비어 있는 것으로 본다 (타입이 틀린 파일에서 던지지 않는다)
	function safeNextId(data, hwm, curNext) {
		let n = Math.max(1, parseInt(data && data.nextId, 10) || 1);
		const h = parseInt(hwm, 10);
		if (h >= 0 && h + 1 > n) n = h + 1;
		const c = parseInt(curNext, 10);
		if (c > n) n = c;
		const see = (id) => { const v = parseInt(id, 10); if (v >= n) n = v + 1; };
		const arr = (x) => (Array.isArray(x) ? x : []);
		arr(data && data.subtitles).forEach((s) => { if (s) see(s.id); });
		arr(data && data.trashBin).forEach((t) => { if (t && t.sub) see(t.sub.id); });
		return n;
	}
	// sequenceKey의 GUID 부분 ("proj_x_seq_<GUID>" → GUID). 이름 기반 키·기본 키는 null
	function seqGuidOf(seqKey) {
		const s = String(seqKey == null ? "" : seqKey);
		const i = s.indexOf("_seq_");
		if (i === -1) return null;
		const g = s.slice(i + 5);
		if (!g || g.indexOf("name_") === 0) return null;
		return g;
	}

	// ── mi 블록 (session.json의 선택 키) ──

	function miDefault() {
		return { v: 1, salt: "", hwm: 0, legacyTrack: null, remapped: false, castOrder: [], cast: {}, stack: false, stackDy: 0.12, applied: {} };
	}
	// 저장할 내용이 있는가 (salt가 있거나 화자가 있다). 없으면 session.json에 mi를 쓰지 않는다
	function miHasData(mi) {
		return !!(mi && ((typeof mi.salt === "string" && mi.salt) || (mi.cast && typeof mi.cast === "object" && Object.keys(mi.cast).length)));
	}
	// 파일의 mi → 메모리 mi. 모든 필드(salt, hwm, applied, 모르는 키)를 그대로 두고 빠진 기본값만 채운다
	function miFromFile(src) {
		const mi = miDefault();
		if (!src || typeof src !== "object" || Array.isArray(src)) return mi;
		const c = JSON.parse(JSON.stringify(src));
		Object.keys(c).forEach((k) => { mi[k] = c[k]; });
		const isObj = (o) => !!o && typeof o === "object" && !Array.isArray(o);
		if (typeof mi.v !== "number") mi.v = 1;
		if (typeof mi.salt !== "string") mi.salt = "";
		if (typeof mi.hwm !== "number" || !isFinite(mi.hwm) || mi.hwm < 0) mi.hwm = 0;
		if (mi.legacyTrack !== null && typeof mi.legacyTrack !== "number") mi.legacyTrack = null;
		mi.remapped = mi.remapped === true;
		if (!Array.isArray(mi.castOrder)) mi.castOrder = [];
		if (!isObj(mi.cast)) mi.cast = {};
		if (typeof mi.stack !== "boolean") mi.stack = false;
		if (typeof mi.stackDy !== "number" || !isFinite(mi.stackDy)) mi.stackDy = 0.12;
		if (!isObj(mi.applied)) mi.applied = {};
		return mi;
	}
	// 히스토리·작업 파일에 싣는 부분 (salt, hwm, applied는 뺀다)
	function miSnapshotOf(mi) {
		const m = miFromFile(mi);
		return JSON.parse(JSON.stringify({ cast: m.cast, castOrder: m.castOrder, stack: m.stack, stackDy: m.stackDy, legacyTrack: m.legacyTrack }));
	}
	// 히스토리·작업 파일 복원: 화자 표는 스냅숏에서, salt·hwm·applied·remapped는 현재 값을 유지한다
	function miRestoreFrom(cur, snap) {
		const mi = miFromFile(cur);
		if (!snap || typeof snap !== "object") return mi;
		const s = miFromFile(snap);
		mi.cast = s.cast;
		mi.castOrder = s.castOrder;
		mi.stack = s.stack;
		mi.stackDy = s.stackDy;
		mi.legacyTrack = s.legacyTrack;
		return mi;
	}

	// ── cast.json 사이드카 ──

	// cast.json에 싣는 부분 (applied는 싣지 않는다). savedAt은 쓰는 쪽이 붙인다
	function castSidecarOf(mi) {
		const m = miFromFile(mi);
		return JSON.parse(JSON.stringify({ v: 1, salt: m.salt, hwm: m.hwm, legacyTrack: m.legacyTrack, castOrder: m.castOrder, cast: m.cast, stack: m.stack, stackDy: m.stackDy }));
	}
	// 세션에 mi가 없을 때(v27이 저장하며 mi를 버렸다) cast.json을 믿어도 되는가.
	//   화자(spk)가 있는 줄이 있고, 모든 spk 줄의 id ≤ 사이드카 hwm일 때만.
	// 그 밖에는 낡은 사이드카다 (v27이 SRT를 다시 열어 id를 새로 매긴 경우 등).
	function castSidecarUsable(session, side) {
		if (!session || typeof session !== "object" || (session.mi && typeof session.mi === "object")) return false;
		if (!side || typeof side !== "object" || Array.isArray(side)) return false;
		const hwm = Number(side.hwm);
		if (!isFinite(hwm) || hwm < 0) return false;
		const spk = (Array.isArray(session.subtitles) ? session.subtitles : []).filter((s) => s && typeof s.spk === "string" && s.spk !== "");
		if (!spk.length) return false;
		return spk.every((s) => Number(s.id) <= hwm);
	}
	// cast.json → 메모리 mi (applied는 비우고 remapped는 false)
	function miFromCast(side) {
		const mi = miFromFile(side);
		delete mi.savedAt;
		mi.applied = {};
		mi.remapped = false;
		return mi;
	}

	// ── SRT 가져오기 (여러 파일, 캡션 트랙 번호 → 화자) ──

	// 자동으로 휴지통에 들어간 항목(why "merge"|"replace")의 세션당 상한. 오래된(at) 것부터 버린다.
	// 사용자가 지운 항목(why 없음)은 v27처럼 제한이 없다
	const TRASH_AUTO_MAX = 300;
	// 화자 색 개수 (0..7)
	const CAST_COLORS = 8;

	// 디코딩 결과 인코딩의 표시 이름 (확인창·가져오기 창)
	function encodingLabel(enc) {
		const e = String(enc == null ? "" : enc).toLowerCase();
		if (e === "euc-kr") return "CP949";
		if (e === "utf-16le") return "UTF-16 LE";
		if (e === "utf-16be") return "UTF-16 BE";
		if (e === "utf-8") return "UTF-8";
		return String(enc == null ? "" : enc);
	}
	// 레거시 경로에서 목록을 바꾸기 전에 확인을 받아야 하는가 (UTF-8이 아니거나 깨진 글자가 있다)
	function needsEncodingConfirm(dec) {
		return !!dec && (dec.encoding !== "utf-8" || dec.replaced > 0);
	}
	// "C12" → 12, 형식이 아니면 0
	function castKeyNum(k) {
		const m = /^C(\d+)$/.exec(String(k == null ? "" : k));
		return m ? parseInt(m[1], 10) : 0;
	}
	// 화자 키를 C번호 순으로 (새 배열)
	function sortCastKeys(keys) {
		return (keys || []).slice().sort((a, b) => (castKeyNum(a) - castKeyNum(b)) || (a < b ? -1 : a > b ? 1 : 0));
	}
	// 아직 아무 화자도 쓰지 않은 첫 색 (0..7). 모두 쓰였으면 화자 수 % 8
	function castColorFree(cast) {
		const used = {};
		const keys = cast && typeof cast === "object" ? Object.keys(cast) : [];
		keys.forEach((k) => { if (cast[k] && typeof cast[k].color === "number") used[cast[k].color] = true; });
		for (let c = 0; c < CAST_COLORS; c++) if (!used[c]) return c;
		return keys.length % CAST_COLORS;
	}
	// SRT 열기 경로 (계획서 §3.4)
	//   o.castEnabled  여러 파일 가져오기 플래그
	//   o.files        [{key, ambiguous}] (parseCaptionKey 결과)
	//   o.castEmpty    화자 표가 비었다
	//   o.legacyLive   화자(spk) 없는 살아 있는 줄 수
	//   o.legacyPreset 그중 프리셋이 걸린 줄 수 (후반 작업이 있는 목록)
	// → "legacy"      첫 파일 하나를 v27 교체 본문으로
	//   "choice"      C번호 없는 파일 하나 + 프리셋이 걸린 기존 목록 → [병합] [교체] [취소]
	//   "modal"       'SRT 가져오기' 창
	//   "distribute"  C번호 파일 + 화자 없는 기존 줄 (기존 목록을 화자로 나누기)
	function srtImportRoute(o) {
		const files = (o && o.files) || [];
		if (!o || !o.castEnabled || !files.length) return "legacy";
		const f0 = files[0] || {};
		if (files.length === 1 && !f0.key && !f0.ambiguous && o.castEmpty) return o.legacyPreset > 0 ? "choice" : "legacy";
		if (o.legacyLive > 0) return "distribute";
		return "modal";
	}
	// 줄 목록을 (시작 시각, 화자 순서)로 안정 정렬한다 (제자리). 화자 없는 줄은 화자 줄보다 앞
	function sortRowsByTime(subtitles, castOrder) {
		const order = castOrder || [];
		const rank = (s) => (s && s.spk ? order.indexOf(s.spk) : -1);
		return subtitles.sort((a, b) => ((a.startSec || 0) - (b.startSec || 0)) || (rank(a) - rank(b)));
	}
	// 화자 K(없으면 null = 화자 없는 줄)의 줄 번호(index)를 목록 순서대로 1..n으로 다시 매긴다 (제자리)
	function renumberRows(subtitles, key) {
		let n = 0;
		subtitles.forEach((s) => { if (s && (key ? s.spk === key : !s.spk)) s.index = ++n; });
	}
	// 자동 휴지통 항목(why merge|replace)이 max를 넘으면 오래된(at) 것부터 버린다 (제자리). → 버린 수
	function trimAutoTrash(trashBin, max) {
		const lim = typeof max === "number" ? max : TRASH_AUTO_MAX;
		const auto = trashBin.filter((t) => t && (t.why === "merge" || t.why === "replace"));
		if (auto.length <= lim) return 0;
		const drop = auto.slice().sort((a, b) => (a.at || 0) - (b.at || 0)).slice(0, auto.length - lim);
		for (let i = trashBin.length - 1; i >= 0; i--) if (drop.indexOf(trashBin[i]) !== -1) trashBin.splice(i, 1);
		return drop.length;
	}
	// 화자 K의 살아 있는 줄을 모두 휴지통으로 (why, at). position은 옮기기 전 자리 → 옮긴 줄 수
	function moveKeyToTrash(data, key, why, now) {
		const hit = [];
		data.subtitles.forEach((s, i) => { if (s && (key ? s.spk === key : !s.spk)) hit.push(i); });
		hit.forEach((i) => {
			const s = data.subtitles[i];
			const st = data.rowStates[s.id] || { presetId: "", params: [], _allParams: [], open: false, checked: false };
			data.trashBin.push({ sub: s, state: st, position: i, why, at: now });
		});
		for (let k = hit.length - 1; k >= 0; k--) {
			const s = data.subtitles[hit[k]];
			data.subtitles.splice(hit[k], 1);
			delete data.rowStates[s.id];
		}
		return hit.length;
	}
	// 파싱한 자막(parseSRT opts 결과)을 화자 K의 새 줄로 넣는다. id = nextId++. → 새 id 배열
	// 줄 모양은 v27 {index…text, id} 뒤에 spk, srtNo (index는 호출한 쪽이 다시 매긴다)
	function addCueRows(data, key, cues, presetId, extra) {
		const ids = [];
		(cues || []).forEach((c) => {
			const id = data.nextId++;
			const sub = { index: c.index, startTime: c.startTime, endTime: c.endTime, startSec: c.startSec, endSec: c.endSec, text: c.text, id };
			if (key) sub.spk = key;
			if (c.srtNo !== undefined && c.srtNo !== null) sub.srtNo = c.srtNo;
			data.subtitles.push(sub);
			data.rowStates[id] = Object.assign({ presetId: presetId || "", params: [], _allParams: [], open: false, checked: false }, extra || {});
			ids.push(id);
		});
		return ids;
	}
	// ── 다시 가져오기 병합 (계획서 §4) ──
	//
	// 화자 K(없으면 null = 화자 없는 레거시 목록)의 살아 있는 줄과 K의 휴지통 항목만 다룬다.
	// 휴지통과 nextId는 초기화하지 않는다. 순수: buildMergePlan이 계획을 세우고 applyMergePlan이 사본에 적용한다.

	// 시작·끝 차이가 이 안이면 같은 시간 (초)
	const MERGE_TIME_EPS = 0.05;
	// matchCues 후보: 시간상 가장 가까운 새 자막 기준 ±40개
	const MATCH_BAND = 40;
	// 짝으로 받는 점수(0.6 × 겹침 + 0.4 × 유사도), 겹치지 않는 짝이 되려면 필요한 유사도
	const MATCH_ACCEPT = 0.35;
	const MATCH_SIM_ALLOW = 0.9;
	// 문장이 바뀐 짝의 유사도가 이 밑이면 나누기·합치기로 의심 (check)
	const MERGE_CHECK_SIM = 0.5;
	// 짝 고르기(DP) 가중치. 점수(채택·분류)는 그대로 두고 고르는 순서만 정한다: 고정 짝은 사실상 반드시.
	// 이동 가설로만 고정되는 짝은 실제 시간 고정보다 조금 뒤 (같은 문장이 둘일 때 실제 시간 쪽)
	const MATCH_ANCHOR_W = 10000;
	const MATCH_SHIFT_ANCHOR_LESS = 0.01;
	// 시간 이동 가설: 문장이 같은 짝 3개 이상이 같은 값(±1프레임)만큼 밀렸으면 그 값. 많이 모인 순서로 최대 3개
	// (중간에 끼워 넣은 편집으로 뒤쪽만 밀린 경우. 촘촘한 대화에서 밀린 줄이 옆 문장과 짝지어 후반 작업이 다른 문장에 붙지 않게)
	const MATCH_SHIFT_MIN = 3;
	const MATCH_SHIFTS_MAX = 3;
	// 전체 시간 이동 판정의 1프레임 (23.976 기준, 초)
	const SHIFT_FRAME_SEC = 1001 / 24000;
	// 분배(distributeLegacy): 배정 점수, 2위와의 차이, '확인 필요' 하한
	const DIST_ASSIGN = 0.5;
	const DIST_MARGIN = 0.15;
	const DIST_AMBIG = 0.35;

	// levenshteinWithin의 작업 버퍼 (호출마다 새로 만들지 않는다. 결과에는 영향이 없다)
	var _levBufA = new Int32Array(64);
	var _levBufB = new Int32Array(64);
	// 편집 거리가 k 이하면 그 값, 넘으면 k + 1 (대각선 띠 ±k만 계산)
	function levenshteinWithin(a, b, k) {
		const la = a.length;
		const lb = b.length;
		if (Math.abs(la - lb) > k) return k + 1;
		if (!la || !lb) return Math.max(la, lb);
		const BIG = k + 1;
		if (_levBufA.length < lb + 1) {
			_levBufA = new Int32Array(lb + 64);
			_levBufB = new Int32Array(lb + 64);
		}
		let prev = _levBufA;
		let cur = _levBufB;
		for (let j = 0; j <= lb; j++) prev[j] = j <= k ? j : BIG;
		for (let i = 1; i <= la; i++) {
			const lo = Math.max(1, i - k);
			const hi = Math.min(lb, i + k);
			cur[lo - 1] = lo === 1 ? Math.min(i, BIG) : BIG;
			let rowMin = cur[lo - 1];
			const ca = a.charCodeAt(i - 1);
			for (let j = lo; j <= hi; j++) {
				let v = prev[j - 1] + (ca === b.charCodeAt(j - 1) ? 0 : 1);
				if (prev[j] + 1 < v) v = prev[j] + 1;
				if (cur[j - 1] + 1 < v) v = cur[j - 1] + 1;
				if (v > BIG) v = BIG;
				cur[j] = v;
				if (v < rowMin) rowMin = v;
			}
			if (hi < lb) cur[hi + 1] = BIG;
			if (rowMin > k) return BIG;
			const t = prev; prev = cur; cur = t;
		}
		return prev[lb] > k ? BIG : prev[lb];
	}
	// 짝 맞추기 입력 하나: {s, e, text, srtNo} 또는 parseSRT 자막 {startSec, endSec, text, srtNo}
	function _matchItem(x) {
		const s = Number(x && x.s !== undefined ? x.s : x && x.startSec) || 0;
		const e0 = Number(x && x.e !== undefined ? x.e : x && x.endSec);
		const no = x && x.srtNo !== undefined && x.srtNo !== null ? Number(x.srtNo) : NaN;
		const t = normText(x && x.text);
		return { s, e: isFinite(e0) ? e0 : s, t, k: jamo(t).replace(/\s+/g, ""), no: isFinite(no) ? no : null };
	}
	// 겹친 길이 / 짧은 쪽 길이 (0~1)
	function _overlapFrac(as, ae, bs, be) {
		const ov = Math.min(ae, be) - Math.max(as, bs);
		if (!(ov > 0)) return 0;
		const d = Math.min(ae - as, be - bs);
		return d > 0 ? Math.min(1, ov / d) : 1;
	}
	// 오름차순 배열에서 v에 가장 가까운 값의 자리
	function _nearestIndex(sorted, v) {
		let lo = 0;
		let hi = sorted.length - 1;
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			if (sorted[mid] < v) lo = mid + 1;
			else hi = mid;
		}
		if (lo > 0 && Math.abs(sorted[lo - 1] - v) <= Math.abs(sorted[lo] - v)) return lo - 1;
		return lo;
	}
	// 문장이 같은 새 자막(시작이 가장 가까운 것)과의 시작 차이 (옛 줄마다 하나, 오름차순)
	function _matchDeltas(A, B, byText, bi) {
		const d = [];
		A.forEach((a) => {
			const list = byText[a.t];
			if (!list) return;
			let best = null;
			list.forEach((q) => {
				const x = B[bi[q]].s - a.s;
				if (best === null || Math.abs(x) < Math.abs(best)) best = x;
			});
			d.push(best);
		});
		return d.sort((x, y) => x - y);
	}
	// 오름차순 d에서 ±1프레임 안에 가장 많이 모인 구간 → {lo, n, mid: 가운데 값}
	function _deltaCluster(d) {
		let n = 0;
		let lo = 0;
		let j = 0;
		for (let i = 0; i < d.length; i++) {
			while (d[i] - d[j] > 2 * SHIFT_FRAME_SEC + 1e-9) j++;
			if (i - j + 1 > n) {
				n = i - j + 1;
				lo = j;
			}
		}
		return { lo, n, mid: n ? d[lo + (n >> 1)] : 0 };
	}
	// 전체 시간 이동 (안내 줄): 시작 차이 d 중 60% 이상이 같은 값(±1프레임)이고 그 값이 2프레임 이상이면 그 값(초), 아니면 0.
	// 문장이 같은 짝이 3개 미만이거나 옛 줄(nOld)의 30% 미만이면 0
	function _matchShift(d, nOld) {
		if (d.length < 3 || d.length < 0.3 * nOld) return 0;
		const c = _deltaCluster(d);
		if (c.n < 0.6 * d.length) return 0;
		return Math.abs(c.mid) >= 2 * SHIFT_FRAME_SEC ? Math.round(c.mid * 1000) / 1000 : 0;
	}
	// 시간 이동 가설 (일부만 밀린 것 포함): 시작 차이 d에서 MATCH_SHIFT_MIN개 이상 모인 값(±1프레임, 2프레임 이상)을
	// 많이 모인 순서로 최대 MATCH_SHIFTS_MAX개 (0 근처 무리는 세지 않고 건너뛴다)
	function _matchShifts(d) {
		const out = [];
		const rest = d.slice();
		while (out.length < MATCH_SHIFTS_MAX && rest.length >= MATCH_SHIFT_MIN) {
			const c = _deltaCluster(rest);
			if (c.n < MATCH_SHIFT_MIN) break;
			if (Math.abs(c.mid) >= 2 * SHIFT_FRAME_SEC) out.push(Math.round(c.mid * 1000) / 1000);
			rest.splice(c.lo, c.n);
		}
		return out;
	}
	// 옛 줄과 새 자막의 짝 (순서 보존, 한 줄에 하나).
	//   시간 가설: 실제 시간, 그리고 문장이 같은 짝들이 같은 값만큼 밀린 이동(_matchShifts, 중간 삽입으로 뒤쪽만 밀린 것 포함)
	//   1) 고정(anchor): 정규화 문장이 같고, 실제 시간이나 이동 가설 하나로 시작·끝 차이가 각각 0.05초 이하
	//   2) 나머지: 순서를 지키는 DP (간격 비용 0). 후보는 가설마다 시간상 가장 가까운 새 자막 ±40개,
	//      점수 = 0.6 × 겹침/짧은 쪽 길이 + 0.4 × 자모 유사도, 겹치거나 유사도 ≥ 0.9일 때만, 점수 ≥ 0.35만 받는다.
	//      겹침은 가설 중 가장 큰 값이다 (실제 시간 겹침은 이동 가설이 있어도 그대로 센다: 일부만 밀렸을 때 앞쪽 줄).
	//      동률은 원래 번호(srtNo)가 가까운 쪽으로 가른다. 짝은 서로 엇갈리지 않는다 (엇갈리는 고정은 DP가 많은 쪽을 고른다).
	//   분류는 실제 시간으로 한다. shift는 전체 시간 이동(_matchShift, 안내 줄)
	// → {pairs: [{o, n, score, sim, ov, anchor}] (입력 자리, 시간순), oldPair: [n|-1], newPair: [o|-1], shift: 초}
	function matchCues(oldRows, newCues, opts) {
		const A = (oldRows || []).map(_matchItem);
		const B = (newCues || []).map(_matchItem);
		const oldPair = A.map(() => -1);
		const newPair = B.map(() => -1);
		const res = { pairs: [], oldPair, newPair, shift: 0 };
		if (!A.length || !B.length) return res;
		const order = (X) => X.map((_, i) => i).sort((x, y) => (X[x].s - X[y].s) || (X[x].e - X[y].e) || (x - y));
		const ai = order(A);
		const bi = order(B);
		const bStart = bi.map((j) => B[j].s);
		const byText = {};
		bi.forEach((j, q) => { (byText[B[j].t] = byText[B[j].t] || []).push(q); });
		const noShift = !!(opts && opts.noShift);
		const deltas = noShift ? [] : _matchDeltas(A, B, byText, bi);
		const shift = noShift ? 0 : _matchShift(deltas, A.length);
		const shifts = noShift ? [] : _matchShifts(deltas);
		if (shift && shifts.indexOf(shift) === -1) shifts.unshift(shift);
		res.shift = shift;
		const offs = [0].concat(shifts);
		const near = (a, b, off) => Math.abs(b.s - (a.s + off)) <= MERGE_TIME_EPS && Math.abs(b.e - (a.e + off)) <= MERGE_TIME_EPS;
		// 후보 (옛 줄 시간순 p, 새 자막 시간순 q). mark: 이 p에서 이미 본 q
		const cand = [];
		const mark = new Int32Array(bi.length).fill(-1);
		ai.forEach((i, p) => {
			const a = A[i];
			// 1) 고정 후보: 실제 시간이면 MATCH_ANCHOR_W, 이동 가설로만 맞으면 조금 적게
			const anchorW = {};
			(byText[a.t] || []).forEach((q) => {
				const b = B[bi[q]];
				if (near(a, b, 0)) anchorW[q] = MATCH_ANCHOR_W;
				else if (shifts.some((off) => near(a, b, off))) anchorW[q] = MATCH_ANCHOR_W - MATCH_SHIFT_ANCHOR_LESS;
			});
			const add = (q) => {
				if (mark[q] === p) return;
				mark[q] = p;
				const b = B[bi[q]];
				const aw = anchorW[q] || 0;
				const anchor = aw > 0;
				let ov = 0;
				offs.forEach((off) => { ov = Math.max(ov, _overlapFrac(a.s + off, a.e + off, b.s, b.e)); });
				let sim;
				if (a.t === b.t) sim = 1;
				else if (ov > 0) {
					const n = Math.max(a.k.length, b.k.length);
					sim = n ? 1 - levenshtein(a.k, b.k) / n : 1;
				} else {
					const n = Math.max(a.k.length, b.k.length);
					const lim = Math.floor(n * (1 - MATCH_SIM_ALLOW) + 1e-9);
					const dist = levenshteinWithin(a.k, b.k, lim);
					if (dist > lim) return;
					sim = n ? 1 - dist / n : 1;
				}
				const score = 0.6 * ov + 0.4 * sim;
				if (!anchor && score < MATCH_ACCEPT) return;
				let w = score + aw;
				if (a.no !== null && b.no !== null) w += 1e-6 / (1 + Math.abs(a.no - b.no));
				cand.push({ p, q, w, score, sim, ov, anchor });
			};
			// 2) 가설마다 가까운 새 자막 ±40개, 그 밖의 고정 후보
			offs.forEach((off) => {
				const q0 = _nearestIndex(bStart, a.s + off);
				const hi = Math.min(bi.length - 1, q0 + MATCH_BAND);
				for (let q = Math.max(0, q0 - MATCH_BAND); q <= hi; q++) add(q);
			});
			Object.keys(anchorW).forEach((q) => add(Number(q)));
		});
		// 3) 가중치 합이 가장 큰 엇갈리지 않는 짝 모음 (p·q 모두 증가). q에 대한 접두 최댓값 펜윅 트리
		const m = bi.length;
		const tv = new Float64Array(m + 1);
		const ti = new Int32Array(m + 1).fill(-1);
		const best = new Float64Array(cand.length);
		const prevOf = new Int32Array(cand.length).fill(-1);
		let k = 0;
		while (k < cand.length) {
			let e = k;
			while (e < cand.length && cand[e].p === cand[k].p) e++;
			for (let x = k; x < e; x++) {
				let v = 0;
				let from = -1;
				for (let j = cand[x].q; j > 0; j -= j & -j) if (tv[j] > v) { v = tv[j]; from = ti[j]; }
				best[x] = cand[x].w + v;
				prevOf[x] = from;
			}
			for (let x = k; x < e; x++) {
				for (let j = cand[x].q + 1; j <= m; j += j & -j) if (best[x] > tv[j]) { tv[j] = best[x]; ti[j] = x; }
			}
			k = e;
		}
		let top = -1;
		for (let x = 0; x < cand.length; x++) if (top < 0 || best[x] > best[top]) top = x;
		const chain = [];
		for (let x = top; x >= 0; x = prevOf[x]) chain.push(cand[x]);
		chain.reverse().forEach((c) => {
			const o = ai[c.p];
			const n = bi[c.q];
			oldPair[o] = n;
			newPair[n] = o;
			res.pairs.push({ o, n, score: c.score, sim: c.sim, ov: c.ov, anchor: c.anchor });
		});
		return res;
	}

	// 줄의 캡션 필드 값 (프리셋 'T' 필드를 줄 자신의 _allParams에서 해석). 캡션 필드가 없거나 해석되지 않으면 null
	function rowCaptionValue(rs, preset) {
		const fid = preset ? captionFid(preset) : null;
		if (!fid || !rs) return null;
		const f = resolveFid(rs._allParams || [], fid, preset.params);
		return f && f.param ? String(f.param.value == null ? "" : f.param.value) : null;
	}
	// 줄의 T-ID 필드에 문장을 쓴다: 해석한 _allParams 항목과, 같은 index·이름의 노출 속성(params) 항목.
	// 해석되지 않으면 쓰지 않는다 (false). 행 편집기의 syncToAllParams와 같은 두 곳을 맞춘다
	function setRowFieldValue(rs, preset, fid, text) {
		if (!rs || !fid) return false;
		const f = resolveFid(rs._allParams || [], fid, preset ? preset.params : null);
		if (!f || !f.param) return false;
		setTextValue(f.param, text);
		(rs.params || []).forEach((p) => {
			if (p && p !== f.param && p.type === "text" && p.index === f.index && (p.displayName || "") === (f.displayName || "")) setTextValue(p, text);
		});
		return true;
	}
	// 병합 입력 한 줄: {id, s, e, text, srtNo, cap: 캡션 필드 값|null, others: [{fid, value}] (캡션이 아닌 텍스트 필드)}
	function mergeRowInput(sub, rs, preset) {
		const capFid = preset ? captionFid(preset) : null;
		const res = resolveFields((rs && rs._allParams) || [], preset ? preset.params : null);
		const others = [];
		Object.keys(res).forEach((fid) => {
			if (fid === capFid) return;
			const p = res[fid].param;
			others.push({ fid, value: p && p.value != null ? String(p.value) : "" });
		});
		return {
			id: sub.id, s: sub.startSec, e: sub.endSec, text: sub.text,
			srtNo: sub.srtNo !== undefined && sub.srtNo !== null ? sub.srtNo : sub.index,
			cap: rowCaptionValue(rs, preset), others
		};
	}
	// 화자 K(null = 화자 없는 줄)의 병합 입력 → {rows, trash: [{…, ref: 휴지통 항목 sub.id, why}]}
	function mergeInputs(data, key, presets) {
		const inKey = (s) => !!s && (key ? s.spk === key : !s.spk);
		const pre = (rs) => (rs && rs.presetId && presets ? presets[rs.presetId] || null : null);
		const rows = data.subtitles.filter(inKey).map((s) => mergeRowInput(s, data.rowStates[s.id], pre(data.rowStates[s.id])));
		const trash = [];
		data.trashBin.forEach((t) => {
			if (t && t.sub && inKey(t.sub)) trash.push(Object.assign(mergeRowInput(t.sub, t.state, pre(t.state)), { ref: t.sub.id, why: t.why || "" }));
		});
		return { rows, trash };
	}
	// 포인트 텍스트 확인: 이전 캡션의 '$$' 조각으로만 된 다른 텍스트 필드를 새 캡션으로 다시 본다 (값은 고치지 않는다)
	// → [{fid, missing, dup}] (문제 있는 필드만)
	function pointWarnings(others, oldCap, newCap) {
		const out = [];
		(others || []).forEach((f) => {
			const v = f && f.value != null ? String(f.value) : "";
			if (!v || !pointSegmentsOk(v, oldCap).ok) return;
			const r = pointSegmentsOk(v, newCap);
			if (r.missing.length || r.dup.length) out.push({ fid: f.fid, missing: r.missing, dup: r.dup });
		});
		return out;
	}
	// 짝지은 한 줄의 결과 (3-way: base = 옛 sub.text, ours = 캡션 필드, theirs = 새 문장)
	//   theirs == base → 아무것도 바꾸지 않는다 (패널 편집 유지)
	//   ours == base   → theirs를 쓴다
	//   ours == theirs → sub.text만
	//   그 밖          → 충돌: 기본은 theirs, keepPanelEdits면 ours를 둔다 (sub.text는 어느 쪽이든 theirs)
	// 비교는 정규화 문장(normText)으로 한다. 캡션 필드가 없으면(프리셋 없음) sub.text만 바뀐다
	function _mergeRowResult(r, c, sim, keep) {
		const textChanged = normText(r.text) !== normText(c.text);
		const timeChanged = Math.abs(r.s - c.startSec) > MERGE_TIME_EPS || Math.abs(r.e - c.endSec) > MERGE_TIME_EPS;
		let cls = textChanged ? (timeChanged ? "both" : "text") : (timeChanged ? "time" : "same");
		if (textChanged && sim < MERGE_CHECK_SIM) cls = "check";
		const ours = r.cap;
		let capWrite = null;
		let conflict = false;
		if (textChanged && ours !== null) {
			if (normText(ours) === normText(r.text)) capWrite = c.text;
			else if (normText(ours) !== normText(c.text)) {
				conflict = true;
				capWrite = keep ? null : c.text;
			}
		}
		const oldCap = ours !== null ? ours : r.text;
		const newCap = capWrite !== null ? capWrite : ours !== null ? ours : c.text;
		const capChanged = normText(oldCap) !== normText(newCap);
		return { cls, textChanged, timeChanged, sim, capWrite, conflict, oldCap, newCap, capChanged, warn: capChanged ? pointWarnings(r.others, oldCap, newCap) : null };
	}
	// 병합 계획 (순수). oldRows·trashItems는 mergeInputs 결과, cues는 parseSRT(opts) 결과.
	// → {key, rows: [{id, cue, …결과}], removed: [id], added: [cue 자리], trashKept: [{ref, cue}], restored: [{ref, id, cue, …결과}],
	//    stats: {same, text, time, both, check, new, removed, conflict, point, trashKept, restored}, shift}
	// 휴지통 2차 매칭: 짝 없는 새 자막을 K의 휴지통 항목과 맞춘다.
	//   사용자가 지운 항목(why 없음)과 짝 → trashKept (지운 것을 존중하고 휴지통 항목의 시간·문장만 새로)
	//   merge·replace 항목과 짝 → restored (id·프리셋·후반 작업 그대로 목록으로, mm "restored")
	function buildMergePlan(key, oldRows, trashItems, cues, opts) {
		const keep = !!(opts && opts.keepPanelEdits);
		const rowsIn = oldRows || [];
		const trashIn = trashItems || [];
		const list = cues || [];
		const stats = { same: 0, text: 0, time: 0, both: 0, check: 0, new: 0, removed: 0, conflict: 0, point: 0, trashKept: 0, restored: 0 };
		const plan = { key: key || null, rows: [], removed: [], added: [], trashKept: [], restored: [], stats, shift: 0 };
		const m = matchCues(rowsIn, list);
		plan.shift = m.shift;
		const simOf = {};
		m.pairs.forEach((p) => { simOf[p.o] = p.sim; });
		const note = (res) => {
			if (res.conflict) stats.conflict++;
			if (res.warn && res.warn.length) stats.point++;
		};
		rowsIn.forEach((r, i) => {
			const j = m.oldPair[i];
			if (j < 0) {
				plan.removed.push(r.id);
				stats.removed++;
				return;
			}
			const res = _mergeRowResult(r, list[j], simOf[i] !== undefined ? simOf[i] : 1, keep);
			plan.rows.push(Object.assign({ id: r.id, cue: j }, res));
			stats[res.cls]++;
			note(res);
		});
		const free = [];
		list.forEach((_, j) => { if (m.newPair[j] < 0) free.push(j); });
		if (free.length && trashIn.length) {
			const m2 = matchCues(trashIn, free.map((j) => list[j]));
			m2.pairs.forEach((p) => {
				const t = trashIn[p.o];
				const j = free[p.n];
				if (t.why === "merge" || t.why === "replace") {
					const res = _mergeRowResult(t, list[j], p.sim, keep);
					plan.restored.push(Object.assign({ ref: t.ref, id: t.id, cue: j }, res));
					stats.restored++;
					note(res);
				} else {
					plan.trashKept.push({ ref: t.ref, id: t.id, cue: j });
					stats.trashKept++;
				}
			});
			const taken = {};
			m2.pairs.forEach((p) => { taken[free[p.n]] = true; });
			plan.added = free.filter((j) => !taken[j]);
		} else plan.added = free;
		stats.new = plan.added.length;
		return plan;
	}
	// 병합 뒤 mm (타임라인에 다시 적용해야 하는 이유). 앞선 것이 이긴다:
	//   이번 충돌 > 이번 나누기·합치기 의심 > 아직 적용 안 한 새 줄("new") > 휴지통에서 복구 >
	//   마지막 적용 상태(mmPrev)와 비교한 문장·시간 변경. 적용 상태로 돌아왔어도 지우지 않는다 (검증된 적용만 지운다)
	function _mergeMm(rs, res, sub, capNow, restored) {
		if (res.conflict) return "conflict";
		if (res.cls === "check") return "check";
		if (rs.mm === "new") return "new";
		if (restored) return "restored";
		const p = rs.mmPrev;
		if (!p) return rs.mm || (res.textChanged && res.timeChanged ? "both" : res.textChanged ? "text" : res.timeChanged ? "time" : undefined);
		const t = Math.abs(sub.startSec - p.s) > MERGE_TIME_EPS || Math.abs(sub.endSec - p.e) > MERGE_TIME_EPS;
		const x = normText(capNow) !== normText(p.cap);
		if (t && x) return "both";
		if (t) return "time";
		if (x) return "text";
		return rs.mm;
	}
	// 자막 시간·번호를 새 자막에서
	function _setCueTimes(sub, c) {
		sub.startTime = c.startTime;
		sub.endTime = c.endTime;
		sub.startSec = c.startSec;
		sub.endSec = c.endSec;
	}
	// 짝지은 줄(또는 복구한 줄)에 결과를 적는다. mmPrev는 없을 때만 (바꾸기 전 값으로)
	function _applyMergeRow(sub, rs, preset, res, c, restored) {
		const touched = res.cls !== "same" || restored;
		if (touched && !rs.mmPrev && rs.mm !== "new") rs.mmPrev = { s: sub.startSec, e: sub.endSec, cap: res.oldCap };
		if (res.timeChanged) _setCueTimes(sub, c);
		if (res.textChanged) sub.text = c.text;
		if (c.srtNo !== undefined && c.srtNo !== null && sub.srtNo !== c.srtNo && (touched || Object.prototype.hasOwnProperty.call(sub, "srtNo"))) sub.srtNo = c.srtNo;
		if (res.capWrite !== null) setRowFieldValue(rs, preset, captionFid(preset), res.capWrite);
		if (res.warn !== null) {
			if (res.warn.length) rs.warn = res.warn;
			else delete rs.warn;
		}
		if (res.capChanged) delete rs.sugg;
		if (touched) {
			const mm = _mergeMm(rs, res, sub, res.newCap, restored);
			if (mm) rs.mm = mm;
			else delete rs.mm;
		}
	}
	// 병합 계획을 data에 적용한다 (제자리). ctx {presets, now, newPresetId: 새 줄의 프리셋}
	// → {changedOrder: 줄의 모임·시간이 바뀌었다 (번호를 다시 매기고 정렬해야 한다), newIds}
	function applyMergePlan(data, plan, cues, ctx) {
		const c = ctx || {};
		const presets = c.presets || {};
		const now = typeof c.now === "number" ? c.now : 0;
		const key = plan.key;
		const pre = (rs) => (rs && rs.presetId ? presets[rs.presetId] || null : null);
		const byId = {};
		data.subtitles.forEach((s) => { if (s) byId[s.id] = s; });
		let changedOrder = false;
		plan.rows.forEach((r) => {
			const sub = byId[r.id];
			if (!sub) return;
			const rs = data.rowStates[r.id] || (data.rowStates[r.id] = { presetId: "", params: [], _allParams: [], open: false, checked: false });
			if (r.timeChanged) changedOrder = true;
			_applyMergeRow(sub, rs, pre(rs), r, cues[r.cue], false);
		});
		// 빠진 줄 → 휴지통 (why "merge"). position은 옮기기 전 자리
		if (plan.removed.length) {
			const gone = {};
			plan.removed.forEach((id) => { gone[id] = true; });
			const hit = [];
			data.subtitles.forEach((s, i) => { if (s && gone[s.id]) hit.push(i); });
			hit.forEach((i) => {
				const s = data.subtitles[i];
				data.trashBin.push({ sub: s, state: data.rowStates[s.id] || { presetId: "", params: [], _allParams: [], open: false, checked: false }, position: i, why: "merge", at: now });
			});
			for (let k = hit.length - 1; k >= 0; k--) {
				const s = data.subtitles[hit[k]];
				data.subtitles.splice(hit[k], 1);
				delete data.rowStates[s.id];
			}
			changedOrder = true;
		}
		// 휴지통 2차: 사용자가 지운 항목은 시간·문장만 새로, merge·replace 항목은 목록으로 되돌린다
		const trashAt = (ref) => data.trashBin.findIndex((t) => t && t.sub && t.sub.id === ref);
		plan.trashKept.forEach((t) => {
			const at = trashAt(t.ref);
			if (at < 0) return;
			const sub = data.trashBin[at].sub;
			const cue = cues[t.cue];
			if (Math.abs(sub.startSec - cue.startSec) > MERGE_TIME_EPS || Math.abs(sub.endSec - cue.endSec) > MERGE_TIME_EPS) _setCueTimes(sub, cue);
			if (normText(sub.text) !== normText(cue.text)) sub.text = cue.text;
			if (cue.srtNo !== undefined && cue.srtNo !== null && Object.prototype.hasOwnProperty.call(sub, "srtNo") && sub.srtNo !== cue.srtNo) sub.srtNo = cue.srtNo;
		});
		plan.restored.forEach((t) => {
			const at = trashAt(t.ref);
			if (at < 0) return;
			const item = data.trashBin.splice(at, 1)[0];
			const sub = item.sub;
			const rs = item.state || { presetId: "", params: [], _allParams: [], open: false, checked: false };
			_applyMergeRow(sub, rs, pre(rs), t, cues[t.cue], true);
			if (key) sub.spk = key;
			data.subtitles.push(sub);
			data.rowStates[sub.id] = rs;
			changedOrder = true;
		});
		// 새 줄 (mm "new")
		const newIds = plan.added.length ? addCueRows(data, key, plan.added.map((j) => cues[j]), c.newPresetId || "", { mm: "new" }) : [];
		if (newIds.length) changedOrder = true;
		return { changedOrder, newIds };
	}
	// 병합 통계 글 (가져오기 창·상태 줄): "같음 47 · 문장 2 · 시간 3 · 새 줄 1 · 빠짐 1 · 충돌 1 · 포인트 확인 1 · 휴지통에 있어 제외 1 · 휴지통에서 복구 2"
	// 0인 항목은 빼고(같음은 늘), 바뀐 것이 하나도 없으면 "변경 없음"
	function mergeStatsText(st) {
		const s = st || {};
		const parts = [["문장", s.text], ["시간", s.time], ["문장·시간", s.both], ["나눔·합침 확인", s.check], ["새 줄", s.new], ["빠짐", s.removed],
			["충돌", s.conflict], ["포인트 확인", s.point], ["휴지통에 있어 제외", s.trashKept], ["휴지통에서 복구", s.restored]].filter((x) => x[1] > 0);
		if (!parts.length && !s.trashKept) return "변경 없음 (같음 " + (s.same || 0) + ")";
		return ["같음 " + (s.same || 0)].concat(parts.map((x) => x[0] + " " + x[1])).join(" · ");
	}
	// 히스토리 자동 항목용 짧은 통계: "문장 2 · 시간 3 · 새 1 · 빠짐 1 · 충돌 0 · 복구 2"
	function mergeStatsShort(st) {
		const s = st || {};
		const n = (v) => v || 0;
		return "문장 " + (n(s.text) + n(s.both) + n(s.check)) + " · 시간 " + (n(s.time) + n(s.both)) + " · 새 " + n(s.new) + " · 빠짐 " + n(s.removed) + " · 충돌 " + n(s.conflict) + " · 복구 " + n(s.restored);
	}

	// ── 기존 목록 나누기 (분배) ──

	// 화자 없는 기존 줄·휴지통 항목을 파일(화자)마다 맞춰 본다.
	//   items [{id, s, e, text, srtNo, trash}], files [{key, cues}]
	//   파일마다 matchCues로 짝 점수를 얻는다 (살아 있는 줄과 휴지통 항목은 따로 맞춘다: 서로 짝을 빼앗지 않게)
	//   최고 ≥ 0.5이고 다른 파일의 최고보다 0.15 이상 높으면 그 화자(assigned), 최고 ≥ 0.35면 확인 필요(ambiguous, 기본은 최고 화자),
	//   그 밖에는 짝 없음(unmatched)
	// → {items: [{id, trash, status, key, best, second, scores}], counts: {byKey: {K: n}, ambiguous, unmatched}}
	function distributeLegacy(items, files) {
		const list = items || [];
		const fl = (files || []).filter((f) => f && f.key);
		const score = {};
		const groups = [list.filter((x) => !x.trash), list.filter((x) => x.trash)];
		fl.forEach((f) => {
			groups.forEach((g) => {
				if (!g.length) return;
				matchCues(g, f.cues || []).pairs.forEach((p) => {
					const id = g[p.o].id;
					(score[id] = score[id] || {})[f.key] = Math.max((score[id] || {})[f.key] || 0, p.score);
				});
			});
		});
		const counts = { byKey: {}, ambiguous: 0, unmatched: 0 };
		fl.forEach((f) => { counts.byKey[f.key] = 0; });
		const out = list.map((it) => {
			const sc = score[it.id] || {};
			const ks = Object.keys(sc).sort((a, b) => (sc[b] - sc[a]) || (castKeyNum(a) - castKeyNum(b)));
			const best = ks.length ? sc[ks[0]] : 0;
			const second = ks.length > 1 ? sc[ks[1]] : 0;
			let status = "unmatched";
			let key = null;
			if (best >= DIST_ASSIGN && best - second >= DIST_MARGIN) {
				status = "assigned";
				key = ks[0];
			} else if (best >= DIST_AMBIG) {
				status = "ambiguous";
				key = ks[0];
			}
			if (!it.trash) {
				if (status === "assigned") counts.byKey[key]++;
				else if (status === "ambiguous") counts.ambiguous++;
				else counts.unmatched++;
			}
			return { id: it.id, trash: !!it.trash, status, key, best, second, scores: sc };
		});
		return { items: out, counts };
	}
	// 분배를 data에 적용한다 (제자리). legacy {mode: "split"|"one"|"trash", oneKey, assign: {id: "C1"|""(휴지통)}}
	//   split  distributeLegacy대로: 배정·확인 필요(고른 화자, 기본은 최고 화자) → spk, 짝 없음·휴지통 → 휴지통(why "merge")
	//          휴지통 항목(사용자가 지운 줄)은 배정된 화자의 것이 된다 (그 화자의 사용자 삭제로 남는다)
	//   one    화자 없는 줄·휴지통 항목을 모두 oneKey로
	//   trash  화자 없는 줄을 모두 휴지통으로 (why "replace")
	// 화자는 가져올 파일(files)의 키만 받는다: oneKey·assign 값이 그 밖이면(창에서 파일 키를 바꾼 뒤 남은 값 등) 기본값
	// (one은 첫 파일, 확인 필요 줄은 최고 화자). 모르는 mode는 split. 화자 표에 없는 spk가 생기지 않게 한다.
	// mi.legacyTrack = ctx.trackValue (v27 클립이 있는 트랙).
	// → {total, mode, counts: {K: n (확인 필요 줄 포함)}, ambiguous: [{id, s, text, key: 최고 화자, to: 넣은 화자|null, scores}], unmatched, trashAssigned}
	function applyLegacySplit(data, legacy, files, ctx) {
		const c = ctx || {};
		const now = typeof c.now === "number" ? c.now : 0;
		const live = data.subtitles.filter((s) => s && !s.spk);
		const mode = ["split", "one", "trash"].indexOf(legacy && legacy.mode) !== -1 ? legacy.mode : "split";
		const info = { total: live.length, mode, counts: {}, ambiguous: [], unmatched: 0, trashAssigned: 0 };
		if (!live.length) return info;
		if (typeof c.trackValue === "number" && isFinite(c.trackValue)) data.mi.legacyTrack = c.trackValue;
		if (mode === "trash") {
			info.unmatched = moveKeyToTrash(data, null, "replace", now);
			return info;
		}
		const fl = (files || []).filter((f) => f && f.key);
		const isKey = (k) => typeof k === "string" && fl.some((f) => f.key === k);
		const assign = {};
		const legacyTrash = data.trashBin.filter((t) => t && t.sub && !t.sub.spk);
		if (mode === "one") {
			const K = isKey(legacy && legacy.oneKey) ? legacy.oneKey : (fl[0] && fl[0].key) || null;
			live.forEach((s) => { assign[s.id] = K; });
			legacyTrash.forEach((t) => { assign[t.sub.id] = K; });
		} else {
			const items = live.map((s) => ({ id: s.id, s: s.startSec, e: s.endSec, text: s.text, srtNo: s.srtNo !== undefined ? s.srtNo : s.index, trash: false }))
				.concat(legacyTrash.map((t) => ({ id: t.sub.id, s: t.sub.startSec, e: t.sub.endSec, text: t.sub.text, srtNo: t.sub.srtNo !== undefined ? t.sub.srtNo : t.sub.index, trash: true })));
			const dist = distributeLegacy(items, fl);
			const over = (legacy && legacy.assign) || {};
			dist.items.forEach((d) => {
				let K = d.status === "unmatched" ? null : d.key;
				if (d.status === "ambiguous") {
					if (Object.prototype.hasOwnProperty.call(over, d.id)) {
						const v = over[d.id];
						if (v === "" || v === null || v === undefined) K = null;
						else if (isKey(v)) K = v;
					}
					if (!d.trash) {
						const s = live.find((x) => x.id === d.id);
						info.ambiguous.push({ id: d.id, s: s.startSec, text: s.text, key: d.key, to: K, scores: d.scores });
					}
				}
				assign[d.id] = K;
			});
		}
		live.forEach((s) => {
			const K = assign[s.id];
			if (K) {
				s.spk = K;
				info.counts[K] = (info.counts[K] || 0) + 1;
			}
		});
		// 짝 없는 줄(과 휴지통을 고른 줄) → 휴지통 (why "merge")
		const hit = [];
		data.subtitles.forEach((s, i) => { if (s && !s.spk) hit.push(i); });
		hit.forEach((i) => {
			const s = data.subtitles[i];
			data.trashBin.push({ sub: s, state: data.rowStates[s.id] || { presetId: "", params: [], _allParams: [], open: false, checked: false }, position: i, why: "merge", at: now });
		});
		for (let k = hit.length - 1; k >= 0; k--) {
			const s = data.subtitles[hit[k]];
			data.subtitles.splice(hit[k], 1);
			delete data.rowStates[s.id];
		}
		info.unmatched = hit.length;
		legacyTrash.forEach((t) => {
			const K = assign[t.sub.id];
			if (K) {
				t.sub.spk = K;
				info.trashAssigned++;
			}
		});
		return info;
	}
	// 의심 파일 (분배 모드가 아닐 때): 이 파일 문장의 60% 이상이 다른 화자(J)의 줄·다른 파일과 같다 → {why: "same", other: J}
	function suspectSameAs(data, f, files) {
		const mine = (f.cues || []).map((c) => normText(c.text)).filter((t) => t !== "");
		if (!mine.length) return null;
		const other = {};
		const see = (K, text) => { if (K && K !== f.key) (other[K] = other[K] || new Set()).add(normText(text)); };
		data.subtitles.forEach((s) => { if (s && s.spk) see(s.spk, s.text); });
		(files || []).forEach((g) => { if (g && g !== f && g.key) (g.cues || []).forEach((c) => see(g.key, c.text)); });
		let hit = null;
		sortCastKeys(Object.keys(other)).forEach((J) => {
			if (hit) return;
			const n = mine.filter((t) => other[J].has(t)).length;
			if (n / mine.length >= 0.6) hit = { why: "same", other: J };
		});
		return hit;
	}

	// 가져오기 작업을 세션 데이터에 적용한다. data를 바꾼다 (호출한 쪽이 사본을 넘기고, 바뀌었으면 상태에 넣는다).
	//   data  {subtitles, rowStates, trashBin, nextId, mi}
	//   job   {files: [{key, name, presetId, action: "new"|"merge"|"replace", file: {name, path, size, mtime}, cues, idx}],
	//          keepPanelEdits, legacy: null | {mode, oneKey, assign} (화자 없는 기존 줄을 나눈다)}
	//         cues = parseSRT(text, {keepNo, stripTags}). 자막이 0개인 파일은 건너뛴다.
	//         key가 null인 파일은 화자 없는 레거시 목록에 병합한다 (C번호 없는 한 파일 + 프리셋이 있는 목록)
	//   ctx   {now, salt: mi.salt가 비었을 때 쓸 값, presets: 살아 있는 프리셋, trackValue: 분배 때 mi.legacyTrack}
	// 화자 만들기: 이름 = 입력 > 키, 트랙 자동(null), 색 = 비어 있는 첫 색, castOrder는 C번호 순.
	// 화자 K에 살아 있는 줄이나 휴지통 항목이 있으면(분배로 넘어온 기존 줄 포함) 병합, 없으면 새 줄로 넣는다.
	// "replace"는 K의 살아 있는 줄을 휴지통(why "replace")으로 보내고 새로 넣는다.
	// → {files: [{idx, key, action, count, name, stats?, shift?, suspect?}], legacy: 분배 결과 | null}
	function importIntoData(data, job, ctx) {
		const c = ctx || {};
		const now = typeof c.now === "number" ? c.now : 0;
		const mi = data.mi;
		const presets = c.presets || null;
		const presetOk = (pid) => !!pid && (!presets || !!presets[pid]);
		const keep = !!(job && job.keepPanelEdits);
		const report = { files: [], legacy: null };
		const files = ((job && job.files) || []).filter((f) => f && Array.isArray(f.cues) && f.cues.length > 0);
		if (!files.length) return report;
		const keyed = files.filter((f) => f.key);
		const legacyMode = !!(job && job.legacy);
		// 의심 파일은 바꾸기 전 상태로 본다 (분배 모드에서는 끈다)
		const suspects = files.map((f) => (!legacyMode && f.key ? suspectSameAs(data, f, keyed) : null));
		if (keyed.length && !mi.salt) mi.salt = c.salt || "";
		if (legacyMode) report.legacy = applyLegacySplit(data, job.legacy, keyed, c);
		const touched = {};
		let needSort = false;
		const hasRows = (K) => data.subtitles.some((s) => s && (K ? s.spk === K : !s.spk)) || data.trashBin.some((t) => t && t.sub && (K ? t.sub.spk === K : !t.sub.spk));
		files.forEach((f, fi) => {
			const K = f.key || null;
			const out = { idx: f.idx, key: K, action: "", count: f.cues.length, name: "" };
			let cast = null;
			let newPreset = "";
			if (K) {
				const nm = String(f.name == null ? "" : f.name).trim();
				const info = f.file || {};
				cast = mi.cast[K];
				if (!cast) {
					cast = { name: nm || K, track: null, autoTrack: null, presetId: presetOk(f.presetId) ? f.presetId : "", color: castColorFree(mi.cast),
						file: info.name || "", path: info.path || null, size: typeof info.size === "number" ? info.size : null, mtime: typeof info.mtime === "number" ? info.mtime : null, pos: null };
					mi.cast[K] = cast;
				} else {
					if (nm) cast.name = nm;
					if (f.presetId !== undefined) cast.presetId = presetOk(f.presetId) ? f.presetId : "";
					cast.file = info.name || cast.file || "";
					cast.path = info.path || null;
					cast.size = typeof info.size === "number" ? info.size : null;
					cast.mtime = typeof info.mtime === "number" ? info.mtime : null;
				}
				if (mi.castOrder.indexOf(K) === -1) mi.castOrder.push(K);
				out.name = cast.name;
				newPreset = cast.presetId;
			}
			if (K && f.action === "replace") {
				moveKeyToTrash(data, K, "replace", now);
				addCueRows(data, K, f.cues, newPreset);
				out.action = "replace";
				needSort = true;
				touched[K || ""] = true;
			} else if (hasRows(K)) {
				const inp = mergeInputs(data, K, presets || {});
				const plan = buildMergePlan(K, inp.rows, inp.trash, f.cues, { keepPanelEdits: keep });
				const done = applyMergePlan(data, plan, f.cues, { presets: presets || {}, now, newPresetId: newPreset });
				out.action = "merge";
				out.stats = plan.stats;
				out.shift = plan.shift;
				out.old = inp.rows.length;
				if (!legacyMode && inp.rows.length >= 10 && (plan.stats.removed + plan.stats.new) / inp.rows.length > 0.5) suspects[fi] = suspects[fi] || { why: "changed" };
				if (done.changedOrder) {
					needSort = true;
					touched[K || ""] = true;
				}
			} else if (K) {
				addCueRows(data, K, f.cues, newPreset);
				out.action = "new";
				needSort = true;
				touched[K] = true;
			} else return;
			if (suspects[fi]) out.suspect = suspects[fi];
			report.files.push(out);
		});
		// 분배로 화자가 바뀐 줄은 그 화자 안에서 번호를 다시 매긴다
		if (report.legacy && report.legacy.total) {
			needSort = true;
			Object.keys(report.legacy.counts).forEach((K) => { touched[K] = true; });
		}
		mi.castOrder = sortCastKeys(mi.castOrder);
		if (needSort) sortRowsByTime(data.subtitles, mi.castOrder);
		Object.keys(touched).forEach((K) => renumberRows(data.subtitles, K || null));
		trimAutoTrash(data.trashBin, TRASH_AUTO_MAX);
		return report;
	}

	// ── 표시·시간 ──

	// 사람이 읽는 줄 주소: 단일 화자 "#12", 다화자 "C2·12". 파싱할 때마다 바뀌므로 쓰기 주소로 쓰지 않는다
	function rowLabel(sub, castMode) {
		if (!sub) return "";
		return castMode && sub.spk ? sub.spk + "·" + sub.index : "#" + sub.index;
	}
	// 초 → 프레임 번호. 정확한 ticks로 계산하고 반올림한다 (Math.floor는 ms 반올림 시간을 한 프레임 앞에 둔다).
	// sec × TICKS_PER_SEC가 2^53을 넘지 않는 약 9.8시간까지 정확하다. frameTicks는 문자열이어도 된다
	function frameOf(sec, frameTicks) {
		const ft = Number(frameTicks);
		if (!(ft > 0)) return NaN;
		return Math.round((Number(sec) * TICKS_PER_SEC) / ft);
	}

	// ── 명령(runCommand)용 주소·요약 ──

	// 사람이 쓴 줄 주소 → {spk: "C2"|null, index: 12, fid: "T2"|null}. 형식이 아니면 null
	//   "#12", "12", "#12 T2", "C2·12", "C2-12", "c2 · 12 t2"
	function parseRowLabel(label) {
		let s = String(label == null ? "" : label);
		if (s.normalize) s = s.normalize("NFC");
		const m = /^\s*(?:#?\s*(\d+)|[Cc]0*([1-9][0-9]?)\s*[·・.\-]\s*(\d+))(?:\s+[Tt](\d+))?\s*$/.exec(s);
		if (!m) return null;
		const fid = m[4] !== undefined ? "T" + parseInt(m[4], 10) : null;
		if (m[1] !== undefined) return { spk: null, index: parseInt(m[1], 10), fid };
		return { spk: "C" + parseInt(m[2], 10), index: parseInt(m[3], 10), fid };
	}
	// 주소에 맞는 줄들. 화자가 있으면 그 화자의 index, 없으면 index만 본다 (다화자에서는 여럿일 수 있다)
	function findRowsByLabel(subtitles, parsed) {
		if (!parsed) return [];
		return (subtitles || []).filter((s) => s && s.index === parsed.index && (!parsed.spk || s.spk === parsed.spk));
	}
	// 줄 요약 (rows·resolve 명령). 텍스트 필드 값은 줄 자신의 _allParams를 프리셋의 T-ID로 해석한다.
	// rs.params(노출 속성)로는 ID를 매기지 않는다 → _allParams가 없으면 fields는 비고 sig는 "".
	// uid는 salt가 있으면 "salt-id", 없으면(단일 화자) id 문자열이다. 쓰기 주소는 uid뿐이다.
	function rowSummary(sub, rs, preset, salt, castMode) {
		const all = rs && Array.isArray(rs._allParams) ? rs._allParams : [];
		const res = resolveFields(all, preset ? preset.params : null);
		const fields = {};
		Object.keys(res).sort((a, b) => parseInt(a.slice(1), 10) - parseInt(b.slice(1), 10)).forEach((fid) => {
			const p = res[fid].param;
			fields[fid] = p && p.value != null ? String(p.value) : "";
		});
		return {
			uid: salt ? salt + "-" + sub.id : String(sub.id),
			id: sub.id,
			index: sub.index,
			label: rowLabel(sub, castMode),
			spk: sub.spk || null,
			s: sub.startSec,
			e: sub.endSec,
			text: sub.text,
			presetId: (rs && rs.presetId) || "",
			sig: fieldSignature(all),
			captionFid: preset ? captionFid(preset) : null,
			fields,
			warn: (rs && Array.isArray(rs.warn)) ? rs.warn : [],
			sugg: (rs && rs.sugg && typeof rs.sugg === "object") ? rs.sugg : {}
		};
	}
	// 프리셋 요약 (presets 명령, 5단계 list_presets): T-ID 목록, 캡션, 필드 서명, comment 규칙 문구.
	// 네이티브는 필드 이름이 definition.json에서 오지 못해 '텍스트 N'이면 순서 미확인(orderVerified false)이다.
	function presetSummary(preset) {
		const params = (preset && preset.params) || [];
		const native = isNativeList(params);
		const fields = fieldIdMap(params, preset && preset.textParamIndex).map((f) => ({ fid: f.fid, label: f.displayName, index: f.index, caption: !!f.caption }));
		const notes = params.filter((p) => p && p.type === "comment").map((p) => String(p.value || p.displayName || "")).filter((x) => x !== "");
		const generic = native && fields.length > 0 && fields.every((f) => /^텍스트 \d+$/.test(f.label));
		return { id: (preset && preset.id) || "", name: (preset && preset.name) || "", captionFid: captionFid(preset), sig: fieldSignature(params), fields, notes, native, orderVerified: !native || !generic };
	}
	// app.js 원문에서 //#region <name> 본문을 잘라낸다 (표식 줄 제외, 줄바꿈 LF). 없으면 null.
	// tests/lib/loadRegions.js의 sliceRegion과 같은 규칙: coreHash = fnv1a32(이 region 본문)
	function regionTextOf(src, name) {
		const lines = String(src == null ? "" : src).replace(/\r\n/g, "\n").split("\n");
		const open = lines.findIndex((ln) => { const m = /^\s*\/\/#region\s+(.+?)\s*$/.exec(ln); return !!m && m[1] === name; });
		if (open < 0) return null;
		let depth = 0;
		for (let i = open + 1; i < lines.length; i++) {
			if (/^\s*\/\/#region\b/.test(lines[i])) depth++;
			else if (/^\s*\/\/#endregion\b/.test(lines[i])) {
				if (depth === 0) return lines.slice(open + 1, i).join("\n");
				depth--;
			}
		}
		return null;
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
	// opts.yes / opts.no: 버튼 문구 (없으면 "확인" / "취소"). 닫을 때 원래 문구로 돌린다.
	function showConfirm(message, onYes, onNo, opts) {
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
		btnYes.textContent = (opts && opts.yes) || "확인";
		btnNo.textContent = (opts && opts.no) || "취소";
		// 세 번째 버튼(#confirmAlt)은 showChoice만 쓴다 (창을 넘겨받으면 closeChoice가 이 확인창을 닫지 않게)
		const btnAlt = document.getElementById("confirmAlt");
		if (btnAlt) { btnAlt.style.display = "none"; btnAlt.onclick = null; }
		_choiceClose = null;
		overlay.classList.add("open");
		const cleanup = () => {
			overlay.classList.remove("open");
			btnYes.textContent = "확인";
			btnNo.textContent = "취소";
		};
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
	// 선택지가 둘이나 셋인 확인창. buttons: [{label, run}] 앞에서부터
	//   첫째 → #confirmYes (주 버튼), (셋이면) 둘째 → #confirmAlt, 마지막 → #confirmNo (취소 자리)
	// 예: showChoice("이미 후반 작업(프리셋)이 있는 자막 목록입니다.", [{label: "병합 (후반 작업 유지)", run: a}, {label: "교체 (지금까지 방식)", run: b}, {label: "취소", run: c}])
	// 창이 없으면(테스트 DOM 등) 브라우저 confirm으로 첫째/마지막만 고른다.
	// 열려 있는 동안 _choiceClose가 버튼을 누르지 않고 닫는 함수다 (closeChoice)
	var _choiceClose = null;
	function showChoice(message, buttons) {
		const list = (buttons || []).filter(Boolean).slice(0, 3);
		const run = (b) => { if (b && typeof b.run === "function") b.run(); };
		const overlay = document.getElementById("confirmModal");
		const msgEl = document.getElementById("confirmMessage");
		const btnYes = document.getElementById("confirmYes");
		const btnNo = document.getElementById("confirmNo");
		const btnAlt = document.getElementById("confirmAlt");
		if (!overlay || !msgEl || !btnYes || !btnNo || !btnAlt || list.length < 2) {
			if (confirm(message)) run(list[0]);
			else run(list[list.length - 1]);
			return;
		}
		const first = list[0];
		const last = list[list.length - 1];
		const mid = list.length === 3 ? list[1] : null;
		msgEl.textContent = message;
		btnYes.textContent = first.label;
		btnNo.textContent = last.label;
		btnAlt.textContent = mid ? mid.label : "";
		btnAlt.style.display = mid ? "" : "none";
		overlay.classList.add("open");
		const close = () => {
			_choiceClose = null;
			overlay.classList.remove("open");
			btnYes.textContent = "확인";
			btnNo.textContent = "취소";
			btnAlt.style.display = "none";
			btnAlt.onclick = null;
			btnYes.onclick = null;
			btnNo.onclick = null;
		};
		const done = (b) => () => {
			close();
			run(b);
		};
		_choiceClose = close;
		btnYes.onclick = done(first);
		btnNo.onclick = done(last);
		btnAlt.onclick = mid ? done(mid) : null;
	}
	// 열려 있는 showChoice를 아무 버튼도 누르지 않고 닫는다 → 닫았으면 true
	function closeChoice() {
		if (!_choiceClose) return false;
		_choiceClose();
		return true;
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
	// fids (선택): {param.index: {fid, caption, title, onClick}} — 텍스트 필드 라벨 앞에 T-ID 배지를 단다 (S1-6)
	function renderParams(panel, list, onChange, exposedFontFields, fids) {
		panel.innerHTML = "";
		if (!list || list.length === 0) {
			const p = document.createElement("p");
			p.style.cssText = "color:#555;font-size:11px;padding:6px 0;";
			p.textContent = "노출된 파라미터가 없습니다.";
			panel.appendChild(p);
			return;
		}
		renderParamList(panel, list, onChange, exposedFontFields, fids);
	}
	function renderParamList(container, list, onChange, exposedFontFields, fids) {
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
			currentGroupEl.appendChild(buildParamControl(param, onChange, exposedFontFields, fids));
		}
	}
	function buildParamControl(param, onChange, exposedFontFields, fids) {
		const t = param.type;
		if (t === "text") {
			// exposedFontFields가 있으면 해당 인덱스 값 사용
			// 없으면 undefined 전달 → buildMogrtTextBlock에서 fontExposed 기반으로 결정
			const ef = exposedFontFields
				? (exposedFontFields[param.index] !== undefined ? exposedFontFields[param.index] : undefined)
				: undefined;
			return buildMogrtTextBlock(param, onChange, ef, fids ? fids[param.index] : null);
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
	// T-ID 배지 (S1-6): <span class="fid-badge[ cap]">T2</span>. onClick이 있으면 누를 수 있다 (주소 복사)
	function makeFidBadge(info) {
		const badge = document.createElement("span");
		badge.className = "fid-badge" + (info.caption ? " cap" : "");
		badge.textContent = info.fid;
		if (info.title) badge.title = info.title;
		if (typeof info.onClick === "function") {
			badge.addEventListener("click", (e) => {
				e.stopPropagation();
				info.onClick();
			});
		}
		return badge;
	}
	// fidInfo (선택): {fid, caption, title, onClick} → 라벨 앞 배지
	function buildMogrtTextBlock(param, onChange, exposedFields = null, fidInfo = null) {
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
		if (fidInfo && fidInfo.fid) {
			lbl.appendChild(makeFidBadge(fidInfo));
			lbl.appendChild(document.createTextNode(param.displayName == null ? "" : String(param.displayName)));
		} else lbl.textContent = param.displayName;
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
			// 화자 줄은 "C2·12", 병합·교체로 들어온 항목은 뒤에 "(병합)" / "(교체)" (사용자가 지운 줄은 v27 그대로)
			numEl.textContent = (item.sub.spk && _castMode() ? rowLabel(item.sub, true) : String(item.sub.index)) +
				(item.why === "merge" ? " (병합)" : item.why === "replace" ? " (교체)" : "");
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
			nameEl.textContent = item.preset.name + (item.why === "import" ? " (가져오기로 교체됨)" : "");
			const mogrtEl = document.createElement("span");
			mogrtEl.className = "trash-time";
			mogrtEl.textContent = String(item.preset.mogrtPath || "").split(/[\\/]/).pop()?.replace(/\.mogrt$/i, "") ?? "";
			const restoreBtn = document.createElement("button");
			restoreBtn.className = "btn-restore";
			restoreBtn.textContent = "복구";
			restoreBtn.addEventListener("click", () => {
				const restored = state.presetTrash.splice(ti, 1)[0];
				// 같은 id가 이미 살아 있으면(다른 프리셋이 그 id를 쓰는 중) 덮어쓰지 않고 새 id로 복구한다
				let rid = restored.preset.id;
				const reissued = !rid || !!state.presets[rid];
				if (reissued) {
					rid = _allocPresetId();
					restored.preset.id = rid;
				}
				state.presets[rid] = restored.preset;
				savePresetsToStorage();
				renderPresetList();
				renderPresetTrash();
				refreshAllSelects();
				if (reissued) _setStatus$3("프리셋 \"" + restored.preset.name + "\" 새 ID로 복구 (" + rid + ")", "ok");
				else _setStatus$3("프리셋 \"" + restored.preset.name + "\" 복구됨", "ok");
			});
			row.appendChild(nameEl);
			row.appendChild(mogrtEl);
			row.appendChild(restoreBtn);
			presetTrashWrap.appendChild(row);
		});
	}
	function bindTrashEvents() {
		document.getElementById("btnEmptyTrash")?.addEventListener("click", () => {
			// 휴지통의 줄은 비우면 되돌릴 수 없다 → 먼저 안전 지점을 남긴다
			if (state.trashBin.length > 0) _saveSafety("휴지통 비우기 전");
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
			// 휴지통의 id를 잊기 전에 카운터를 그 위로 올린다 (비운 뒤 새 프리셋이 그 id를 다시 받지 않게)
			_raisePresetCounter();
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
		// 줄의 프리셋 설정(후반 작업 값 포함)을 비우기 전에 안전 지점을 남긴다.
		// 그 안전 지점을 복원하면 프리셋도 휴지통에서 함께 되살아난다 (_revivePresetsForRows)
		if (state.subtitles.some((sub) => state.rowStates[sub.id]?.presetId === pid)) _saveSafety("프리셋 삭제 전: " + (state.presets[pid].name || pid));
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
	//#region src/ui/mogrtPicker.ts
	// MOGRT 선택기 — 프리셋 모달 좌측 폴더 트리와 우측 카드 그리드.
	// 폴더 트리 순회, 썸네일 지연 로딩, 선택 라벨 갱신까지 담당한다.
	//
	// modalState(folderTree / selectedFolderPath)를 읽고 쓴다. 그 선언은
	// 뒤따르는 ui/modal region에 있다. 모달이 선택기를 부르고 선택기가
	// 모달의 상태를 만지는 양방향 결합이라 어느 쪽에 두어도 역참조가 남는다.
	// 모달을 조율자로 보고 부품을 앞세우는 배치를 골랐다.
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
	//#endregion
	//#region src/ui/previewPanel.ts
	// 프리셋 모달 우측 프리뷰 패널 — 프리뷰 시퀀스 생성, 파라미터 적용,
	// 프레임 캡처, 디바운스 갱신까지의 파이프라인.
	//
	// 외부 의존은 host 어댑터뿐이라 ui/modal보다 앞에 둘 수 있다.
	// 호출 방향은 modal → preview 한쪽이다.
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
	// 프리뷰 시퀀스가 이 프로젝트에 있다고 확인된 적이 있는가 (projKey별).
	// setupPreviewSequence가 성공할 때마다 켠다.
	var _previewSeqKnown = {};
	// getMogrtParams 전에 프리뷰 시퀀스를 확보한다 → true: 있다(안전), false: 만들지 못했다.
	// 있다고 알려진 프로젝트도 한 번 더 확인한다 (사용자가 지웠을 수 있다).
	async function _ensurePreviewSequence(mogrtPath) {
		const pk = state.currentProjectKey;
		if (_previewSeqKnown[pk]) {
			if (await host.hasPreviewSequence()) return true;
			_previewSeqKnown[pk] = false;
		}
		try {
			const r = await host.setupPreviewSequence({ mogrtPath, durationSec: 5 });
			if (String(r).indexOf("SUCCESS") === 0) {
				_previewSeqKnown[pk] = true;
				return true;
			}
			console.warn("[MOGRT] setupPreviewSequence 실패:", r);
		} catch (e) {
			console.warn("[MOGRT] setupPreviewSequence 예외:", (e && e.message) || e);
		}
		return false;
	}
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
			_previewSeqKnown[state.currentProjectKey] = true;
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
	//#endregion
	//#region src/ui/modalParams.ts
	// 프리셋 모달의 파라미터 폼 렌더 트리.
	// renderModalLayout → renderModalParams → buildModalParamRow /
	// buildModalTextBlock 한 갈래로 이어지고, toggleFontField는 텍스트
	// 블록의 폰트 필드 체크박스 헬퍼다. 진입점은 renderModalLayout 하나.
	//
	// mogrtPicker와 마찬가지로 modalState(exposedIndices, textParamIndex,
	// exposedFontFields)를 읽고 쓴다. 그 선언은 뒤따르는 ui/modal에 있다.
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
		guide.innerHTML = "<b>☑ 노출</b>: SRT 편집 시 이 속성을 표시합니다. &nbsp; <b style=\"color:#4caf50\">T</b>: SRT 자막 텍스트가 자동 입력됩니다." +
			"<br><b>T1·T2…</b>: 위에서부터 매긴 텍스트 필드 번호 (후반 작업·AI 지정용)";
		container.appendChild(guide);
		renderModalParams(container, list, mogrtPath);
	}
	function renderModalParams(container, list, mogrtPath) {
		const groupBodies = {};
		let currentGroupEl = container;
		// T-ID (위에서부터 매긴 텍스트 필드 번호). 캡션 표시(초록)는 T 버튼(modalState.textParamIndex)을 따른다
		const fids = {};
		const generic = isNativeList(list) && textFields(list).every((t) => /^텍스트 \d+$/.test(t.displayName));
		fieldIdMap(list, -1).forEach((f) => { fids[f.index] = { fid: f.fid, generic }; });
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
			const rowEl = buildModalParamRow(param, pi, list, mogrtPath, container, fids[param.index] || null);
			targetEl.appendChild(rowEl);
		}
	}
	function buildModalParamRow(param, pi, list, mogrtPath, container, fidInfo) {
		const t = param.type;
		const val = param.value ?? "";
		const isExposed = modalState.exposedIndices.includes(param.index);
		if (t === "text") return buildModalTextBlock(param, pi, list, mogrtPath, container, fidInfo);
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
	// 모달 T-ID 배지 제목 (캡션 여부는 T 버튼을 따라 바뀐다)
	function _modalFidTitle(fid, caption, generic) {
		return (generic ? "네이티브 템플릿: 순서 미확인 · " : "") + (caption ? "캡션 필드 (SRT 문장) " + fid : "텍스트 필드 " + fid + " (위에서부터 매긴 번호, 후반 작업·AI 지정용)");
	}
	function buildModalTextBlock(param, pi, list, mogrtPath, container, fidInfo) {
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
			// 캡션 배지(초록)도 T 버튼을 따라 옮긴다
			container.querySelectorAll(".fid-badge").forEach((b) => {
				const cap = Number(b.dataset.idx) === modalState.textParamIndex;
				b.classList.toggle("cap", cap);
				b.title = _modalFidTitle(b.textContent, cap, b.dataset.generic === "1");
			});
		});
		let fidBadge = null;
		if (fidInfo && fidInfo.fid) {
			fidBadge = makeFidBadge({ fid: fidInfo.fid, caption: isTextTarget, title: _modalFidTitle(fidInfo.fid, isTextTarget, fidInfo.generic) });
			fidBadge.dataset.idx = String(param.index);
			if (fidInfo.generic) fidBadge.dataset.generic = "1";
		}
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
		if (fidBadge) headerRow.appendChild(fidBadge);
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
	//#endregion
	//#region src/ui/modal.ts
var _setStatus$1 = () => {};

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

		// 네이티브 템플릿: 호스트의 일반 이름('텍스트 N')을 definition.json TextLayer 기본 문구로 바꾼다
		// (S0-3 결정 4: TextLayer 순서 = Source Text 순서). 개수가 다르면 일반 이름을 그대로 둔다.
		if (isNativeList(params)) {
			const texts = params.filter((p) => p && p.type === "text");
			const labels = nativeTextLabels(def, texts.length, _uiLocale());
			if (labels) texts.forEach((p, k) => { p.displayName = labels[k]; });
		}
	}
	// Premiere UI 로캘 ("ko_KR" 등, CSInterface hostEnvironment). 모르면 ""
	function _uiLocale() {
		try {
			const cs = window.CSInterface ? new window.CSInterface() : null;
			const env = cs && cs.hostEnvironment;
			if (env && env.appUILocale) return String(env.appUILocale);
		} catch (_) {}
		return "";
	}

	// 네이티브 목록의 필드 이름은 기존 프리셋 것이 이긴다. 캐시가 없을 때(definition 패치 뒤)와 캐시가 있을 때
	// 같은 규칙이라 두 번 열어도 이름이 같다. v27에서 '텍스트 N'으로 저장한 프리셋도 그 이름을 지킨다
	// (저장하며 이름이 바뀌면 다른 시퀀스·히스토리의 줄에 남은 옛 이름과 어긋난다). 이름은 표시용이다 (호스트는 서수로 쓴다).
	// 프리셋이 같은 MOGRT의 네이티브 목록일 때만 (모달에서 다른 MOGRT를 고르면 그 템플릿의 이름을 쓴다)
	function _carryNativeNames(list, preset, mogrtPath) {
		if (!preset || !isNativeList(list) || !isNativeList(preset.params)) return;
		if (String(preset.mogrtPath || "") !== String(mogrtPath || "")) return;
		list.forEach((p) => {
			const ep = p ? preset.params.find((x) => x && x.index === p.index) : null;
			if (ep && ep.displayName) p.displayName = ep.displayName;
		});
	}
	// 모달 파라미터 읽기 요청 번호 (프리뷰 시퀀스를 준비하는 사이 다른 MOGRT를 고르면 이전 요청은 버린다)
	let _modalLoadSeq = 0;
	function loadMogrtForModal(mogrtPath, presetId) {
		const modalBody = document.getElementById("defaultModalBody");
		const reqNo = ++_modalLoadSeq;

		// 캐시된 파라미터가 있으면 즉시 사용 (호스트 호출 생략)
		if (state.mogrtOriginals[mogrtPath]) {
			_applyMogrtParamsToModal(state.mogrtOriginals[mogrtPath], mogrtPath, presetId);
			return;
		}

		// getMogrtParams는 프리뷰 시퀀스가 없으면 작업 시퀀스 V1 0초에 MOGRT를 넣었다 지운다
		// (hostscript 552-590) → V1 0~5초 영상이 잘린다. 먼저 프리뷰 시퀀스를 확보한다.
		modalBody.innerHTML = "<p style=\"color:#64b5f6;font-size:11px;padding:10px 0;text-align:center;\">프리뷰 시퀀스 준비 중...</p>";
		_ensurePreviewSequence(mogrtPath).then((ok) => {
			if (reqNo !== _modalLoadSeq) return;
			if (ok) {
				_fetchMogrtParamsForModal(mogrtPath, presetId);
				return;
			}
			showConfirm(
				"프리뷰 시퀀스를 만들 수 없습니다. 이대로 읽으면 현재 시퀀스 V1의 0~5초 영상이 잘릴 수 있습니다.",
				() => { if (reqNo === _modalLoadSeq) _fetchMogrtParamsForModal(mogrtPath, presetId); },
				() => {
					if (reqNo !== _modalLoadSeq) return;
					modalBody.innerHTML = "<p style=\"color:#f44336;font-size:11px;padding:10px 0;\">프리뷰 시퀀스를 만들 수 없어 파라미터를 읽지 않았습니다. Premiere에서 시퀀스를 확인한 뒤 MOGRT를 다시 고르세요.</p>";
				},
				{ yes: "그래도 읽기", no: "취소" }
			);
		});
	}
	// 캐시가 없을 때 호스트에서 파라미터를 읽어 모달에 그린다 (프리뷰 시퀀스 확인 뒤)
	function _fetchMogrtParamsForModal(mogrtPath, presetId) {
		const modalBody = document.getElementById("defaultModalBody");
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
				// 원본(프리셋 값을 덮기 전) 사본. definition 패치를 받은 뒤에 캐시한다
				// (v27은 패치 전에 캐시해서 두 번째로 열 때 드롭다운 이름 등 패치가 빠졌다)
				const pristine = JSON.parse(JSON.stringify(freshList));
				const cacheOriginals = () => {
					if (!state.mogrtOriginals[mogrtPath]) state.mogrtOriginals[mogrtPath] = pristine;
				};
				const existingPreset = presetId ? state.presets[presetId] : null;
				if (existingPreset) freshList.forEach((p) => {
					const ep = existingPreset.params.find((ep2) => ep2.index === p.index);
					if (ep) {
						p.value = ep.value;
						if (ep.rawValue !== void 0) p.rawValue = ep.rawValue;
						if (ep.colorHex !== void 0) p.colorHex = ep.colorHex;
					}
				});
				_carryNativeNames(freshList, existingPreset, mogrtPath);
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
								if (!defEntry) { cacheOriginals(); renderModalLayout(modalBody, freshList, mogrtPath); return; }
								return defEntry.async("string").then((defStr) => {
								try {
									const def = JSON.parse(defStr);
									patchParamsFromDefinition(freshList, def);
									patchParamsFromDefinition(pristine, def);
									// 패치가 네이티브 이름을 definition 문구로 바꿨다 → 기존 프리셋의 이름을 다시 얹는다 (캐시 히트와 같은 규칙)
									_carryNativeNames(freshList, existingPreset, mogrtPath);
								} catch(_) {}
								cacheOriginals();
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
							}).catch(() => { cacheOriginals(); renderModalLayout(modalBody, freshList, mogrtPath); });
							return; // renderModalLayout은 Promise 내부에서 호출
						}
					} catch(_) {}
				}
				cacheOriginals();
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
		_carryNativeNames(freshList, existingPreset, mogrtPath);
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
			if (!presetId) presetId = _allocPresetId();
			const usedBy = Object.entries(state.rowStates).filter(([, rs]) => rs.presetId === presetId).map(([id]) => parseInt(id, 10));
			const doSave = () => {
				// 이 프리셋을 쓰는 줄의 속성을 다시 채우기 전에 안전 지점을 남긴다
				if (usedBy.length > 0) _saveSafety("프리셋 저장 전: " + presetName);
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
			_ensureRowParams(sub, state.rowStates[sub.id]);
		});
	}
	// 줄의 속성 목록을 준비하고 속성창을 그린다 (renderAll에서 줄마다).
	//   프리셋이 있고 _allParams·params가 모두 비었다 → 처음 건 줄: v27처럼 프리셋 값으로 채운다
	//   그 밖에는 값을 다시 읽지 않는다. 노출 속성(params)만 비었고 구조가 프리셋과 같으면
	//   _allParams에서 exposedIndices로 다시 고른다.
	// v27은 'params가 비었으면 다시 읽기'라서 노출 속성이 없는 프리셋의 줄은 renderAll마다
	// _allParams가 프리셋 기본값으로 돌아가 후반 작업 값이 사라졌다.
	// 예외: 노출 속성(params)이 빈 줄의 _allParams 구조가 프리셋과 다르면(그 사이 프리셋을 다른 구조의
	// MOGRT로 다시 저장했다) v27처럼 프리셋에서 다시 채운다. ▶·↑는 index로 쓰므로 옛 구조를 그대로 보내면
	// 캡션이 다른 필드에 들어가고 진짜 캡션 필드가 비워진다. 속성창이 없는 줄이라 잃을 패널 편집도 없다.
	// (S1-9 이름 쓰기·S1-10 구조 맞춤이 들어오면 이 예외를 다시 본다)
	function _ensureRowParams(sub, rs) {
		if (!rs) return;
		const tBtn = document.getElementById("toggle-" + sub.id);
		const hasAll = !!(rs._allParams && rs._allParams.length);
		const noExposed = !rs.params || rs.params.length === 0;
		const preset = rs.presetId ? state.presets[rs.presetId] : null;
		const stale = !!(preset && hasAll && noExposed && layoutMismatch(rs._allParams, preset.params));
		if (rs.presetId && noExposed && (!hasAll || stale)) {
			loadParamsFromPreset(sub.id, rs.presetId, sub.text, rs.open !== false);
			if (tBtn) { tBtn.style.display = ""; tBtn.textContent = rs.open ? "▲" : "▼"; }
			return;
		}
		if (preset && hasAll && noExposed) {
			const exposed = Array.isArray(preset.exposedIndices) ? preset.exposedIndices : [];
			if (exposed.length > 0) rs.params = rs._allParams.filter((p) => exposed.includes(p.index));
		}
		if (rs.params && rs.params.length > 0) {
			const panel = document.getElementById("params-" + sub.id);
			if (panel) panel.className = "sub-params" + (rs.open ? " open" : "");
			if (tBtn) { tBtn.style.display = ""; tBtn.textContent = rs.open ? "▲" : "▼"; }
			renderParamsPanel(sub.id);
		}
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
		// 화자 줄은 "C2·12" (번호는 화자 안에서 매긴다). 화자 없는 줄은 v27 그대로 "12"
		numEl.textContent = sub.spk && _castMode() ? rowLabel(sub, true) : String(sub.index);
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
				// 여러 줄의 속성(후반 작업 값 포함)을 한꺼번에 새로 채우거나 비운다 → 잃을 값이 있으면 먼저 안전 지점
				const losesValues = checkedIds.length > 1 && checkedIds.some((tid) => {
					const trs = state.rowStates[tid];
					return !!trs && ((trs._allParams || []).length > 0 || (trs.params || []).length > 0);
				});
				if (losesValues) _saveSafety("프리셋 일괄 적용 전");
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
					if (toggleBtn) toggleBtn.style.display = "none"; // toggleBtn은 null이다 (v27 TypeError로 저장이 빠졌다)
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
		// 병합 표시 (있을 때만 → 병합한 적 없는 목록의 행 DOM은 v27 그대로)
		const mmEl = _mmBadge(sub, rowState);
		if (mmEl) hdr.appendChild(mmEl);
		const warnEl = _warnBadge(rowState);
		if (warnEl) hdr.appendChild(warnEl);
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
	// 병합 뒤 '타임라인에 다시 적용해야 하는 이유' 점 (rs.mm). 색: 문장 파랑, 시간 주황, 새 줄 초록, 충돌 빨강,
	// 나누기·합치기 의심 회색, 휴지통에서 복구 청록, 되돌림 보라. 검증된 적용만 지운다 (S1-9)
	const MM_TITLE = {
		text: "문장이 바뀐 줄",
		time: "시간이 바뀐 줄",
		both: "문장과 시간이 바뀐 줄",
		new: "새 줄 (병합으로 더해짐, 타임라인에 아직 없음)",
		conflict: "충돌: 패널에서 고친 문장과 새 SRT 문장이 달랐습니다",
		check: "나누기·합치기로 의심되는 줄 — 문장과 후반 작업을 확인하세요",
		restored: "휴지통에서 복구된 줄 (프리셋·후반 작업 그대로)",
		undone: "되돌린 줄"
	};
	function _mmBadge(sub, rs) {
		if (!rs || !rs.mm) return null;
		const el = document.createElement("span");
		el.className = "sub-mm mm-" + rs.mm;
		let title = MM_TITLE[rs.mm] || rs.mm;
		const p = rs.mmPrev;
		if (p && typeof p.s === "number" && (rs.mm === "time" || rs.mm === "both") && Math.abs(p.s - sub.startSec) > 0.0005) title += " (시간 변경 " + p.s.toFixed(2) + "→" + sub.startSec.toFixed(2) + ")";
		el.title = title;
		return el;
	}
	// 포인트 텍스트 경고 (rs.warn): "T2 포인트 텍스트 ‘하늘’이 문장에 없음" / "… ‘날씨’가 두 번 나와 첫 번째만 칠해집니다"
	function _warnBadge(rs) {
		const list = rs && Array.isArray(rs.warn) ? rs.warn : [];
		if (!list.length) return null;
		const preset = rs.presetId ? state.presets[rs.presetId] : null;
		const names = {};
		if (preset) fieldIdMap(preset.params).forEach((f) => { names[f.fid] = f.displayName; });
		const lines = [];
		list.forEach((w) => {
			const nm = w.fid + (names[w.fid] ? " " + names[w.fid] : "");
			(w.missing || []).forEach((m) => lines.push(nm + " ‘" + m + "’이 문장에 없음"));
			(w.dup || []).forEach((m) => lines.push(nm + " ‘" + m + "’이 두 번 나와 첫 번째만 칠해집니다"));
		});
		const el = document.createElement("span");
		el.className = "sub-warn";
		el.textContent = "!";
		el.title = lines.join("\n");
		return el;
	}
	// 줄의 T-ID 필드에 문장을 쓴다 (_allParams와 같은 index·이름의 노출 속성). 해석되지 않으면 false
	function _setRowFieldValue(subId, fid, text) {
		const rs = state.rowStates[subId];
		if (!rs) return false;
		return setRowFieldValue(rs, rs.presetId ? state.presets[rs.presetId] : null, fid, text);
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
			}, exposedFontFields ?? void 0, _rowFidMap(subId, rs));
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
	// 줄 속성창의 T-ID 배지: 줄 자신의 _allParams를 프리셋의 T-ID로 해석한다 (resolveFields).
	// 해석되지 않은 필드에는 배지를 달지 않는다 (그 ID로는 쓰지 않는다). → {param.index: {fid, caption, title, onClick}}
	function _rowFidMap(subId, rs) {
		const all = rs && Array.isArray(rs._allParams) ? rs._allParams : [];
		if (!all.length) return null;
		const sub = state.subtitles.find((s) => s.id === subId);
		if (!sub) return null;
		const preset = rs.presetId ? state.presets[rs.presetId] : null;
		const res = resolveFields(all, preset ? preset.params : null);
		const capFid = preset ? captionFid(preset) : null;
		const generic = isNativeList(all) && textFields(all).every((t) => /^텍스트 \d+$/.test(t.displayName));
		const map = {};
		Object.keys(res).forEach((fid) => {
			const f = res[fid];
			const addr = rowLabel(sub, _castMode()) + " " + fid;
			const caption = fid === capFid;
			const what = caption ? "캡션 필드 (SRT 문장)" : "텍스트 필드 " + fid + " (위에서부터 매긴 번호)";
			map[f.index] = {
				fid,
				caption,
				title: (generic ? "네이티브 템플릿: 순서 미확인 · " : "") + what + " — 누르면 '" + addr + "' 복사",
				onClick: () => _copyFieldAddress(addr, f.displayName)
			};
		});
		return map;
	}
	// 필드 주소("#12 T2" / "C2·12 T2")를 클립보드에 넣고 상태 줄에 알린다.
	// navigator.clipboard가 없거나 거부되면 숨긴 textarea + execCommand("copy")로 한 번 더 시도한다.
	function _copyFieldAddress(addr, displayName) {
		const ok = () => _setStatus("복사됨: " + addr + (displayName ? " (" + displayName + ")" : "") + " — AI에게 붙여 넣으면 됩니다", "ok");
		const fallback = () => {
			let copied = false;
			try {
				const ta = document.createElement("textarea");
				ta.value = addr;
				ta.style.cssText = "position:fixed;left:-1000px;top:0;opacity:0;";
				document.body.appendChild(ta);
				ta.select();
				copied = typeof document.execCommand === "function" && document.execCommand("copy") === true;
				document.body.removeChild(ta);
			} catch (_) { copied = false; }
			if (copied) ok();
			else _setStatus("클립보드에 넣지 못했습니다: " + addr, "err");
		};
		try {
			if (window.navigator && window.navigator.clipboard && typeof window.navigator.clipboard.writeText === "function") {
				window.navigator.clipboard.writeText(addr).then(ok, fallback);
				return;
			}
		} catch (_) {}
		fallback();
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
		// 화자 줄은 v27 한 트랙 경로로 보내지 않는다 (화자별 트랙 배치는 S2-4)
		if (sub.spk) {
			_setStatus(CAST_APPLY_PENDING_MSG, "err");
			return;
		}
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
		// "변경 줄 (N)": 병합으로 mm이 붙은 줄이 있을 때만 보인다
		const changedBtn = document.getElementById("btnSelectChanged");
		if (changedBtn) {
			const n = state.subtitles.filter((s) => state.rowStates[s.id] && state.rowStates[s.id].mm).length;
			changedBtn.textContent = "변경 줄 (" + n + ")";
			changedBtn.style.display = n > 0 ? "" : "none";
		}
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
			const newId = _allocPresetId();
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
	//#region src/ui/importDialog.ts
	// ─────────────────────────────────────────────────────────────
	// SRT 열기 라우터와 'SRT 가져오기' 창 (#importModal)
	//
	// #srtInput에서 고른 파일은 모두 _onSrtFilesChosen을 지난다:
	//   readAsArrayBuffer → decodeSrtBytes → parseSRT(text, {keepNo, stripTags}) → parseCaptionKey
	// 경로는 core srtImportRoute (계획서 §3.4):
	//   legacy      플래그 꺼짐(운영), 또는 C번호 없는 파일 하나 + 화자 표 없음 + 프리셋이 걸린 줄 없음.
	//               첫 파일 하나를 v27 교체 본문(_legacyReplace, parseSRT opts 없음)으로 읽는다.
	//               UTF-8이 아니거나 깨진 글자가 있으면 목록을 바꾸기 전에 첫 자막 미리보기와 함께 묻는다
	//   choice      위와 같은데 프리셋이 걸린 줄이 있다 → [병합 (후반 작업 유지)] [교체 (지금까지 방식)] [취소].
	//               병합은 _applyMerge(화자 없는 목록에 병합). S1-9까지 플래그 뒤에 있다
	//   modal       2개 이상 | C번호 | 화자 표 있음 → 'SRT 가져오기' 창 → _importIntoCast (새 화자·병합·교체)
	//   distribute  C번호 파일 + 화자 없는 기존 줄 → 같은 창의 분배 모드 (기존 목록을 화자로 나누기)
	// 병합 규칙(짝 맞추기·3-way·휴지통 2차·분배)은 모두 core(importIntoData, buildMergePlan, distributeLegacy)에 있다.
	// 창은 바꾸기 전 상태의 사본으로 미리 계산해 통계를 보이고, [가져오기]에서 같은 계산을 한 번 더 해 넣는다.
	// 여러 파일 가져오기는 S2-4까지 플래그(MI_CAST_ENABLED) 뒤에 있다. DEV·하드 테스트는
	// 코드를 고치지 않고 window._mogrtDebug.setMiCast(true)로 켠다.
	// 화자 이름은 파일 이름에서 가져오지 않는다 (입력 > 키).
	// ─────────────────────────────────────────────────────────────
	function _miCastEnabled() {
		return MI_CAST_ENABLED || !!(window._mogrtDebug && window._mogrtDebug.miCast === true);
	}
	// #srtInput의 multiple을 플래그에 맞춘다 (플래그가 꺼져 있으면 속성 없음 = v27)
	function _syncSrtInputMultiple() {
		const input = document.getElementById("srtInput");
		if (input) input.multiple = _miCastEnabled();
	}
	window._mogrtDebug.setMiCast = (on) => {
		window._mogrtDebug.miCast = on === true;
		_syncSrtInputMultiple();
		return _miCastEnabled();
	};
	// File → {name, path, size, mtime, bytes}. path는 CEP의 File.path(없으면 null, 슬래시로), mtime은 lastModified(ms)
	function _readSrtFile(file) {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = (ev) => {
				const p = typeof file.path === "string" && file.path ? file.path.replace(/\\/g, "/") : null;
				const bytes = new Uint8Array(ev.target.result);
				resolve({ name: String(file.name || ""), path: p, size: typeof file.size === "number" ? file.size : bytes.length, mtime: typeof file.lastModified === "number" ? file.lastModified : null, bytes });
			};
			reader.onerror = () => reject(new Error("SRT 읽기 실패: " + file.name));
			reader.readAsArrayBuffer(file);
		});
	}
	// 읽은 파일 하나 → {file: {name, path, size, mtime}, dec: {encoding, replaced}, text, cues, capKey}
	function _analyzeSrt(f) {
		const d = decodeSrtBytes(f.bytes);
		return {
			file: { name: f.name, path: f.path || null, size: typeof f.size === "number" ? f.size : f.bytes.length, mtime: typeof f.mtime === "number" ? f.mtime : null },
			dec: { encoding: d.encoding, replaced: d.replaced },
			text: d.text,
			cues: parseSRT(d.text, { keepNo: true, stripTags: true }),
			capKey: parseCaptionKey(f.name)
		};
	}
	// #srtInput 처리기: 파일을 읽어 경로대로 보낸다. 플래그가 꺼져 있으면 첫 파일 하나만 읽는다
	async function _onSrtFilesChosen(files) {
		// 부팅 게이트: 시퀀스 키가 정해지기 전에는 열지 않는다 (label은 disabled지만 이중으로 막는다)
		if (!_keysResolved) {
			setStatus("시퀀스를 열면 SRT를 열 수 있습니다", "err");
			return null;
		}
		const list = Array.from(files || []).filter(Boolean);
		if (!list.length) return null;
		let read;
		try {
			read = await Promise.all((_miCastEnabled() ? list : list.slice(0, 1)).map(_readSrtFile));
		} catch (e) {
			setStatus("SRT 읽기 실패", "err");
			return null;
		}
		return _routeSrtImport(read);
	}
	// 읽은 파일들 → 경로를 정해 처리를 시작한다 (확인창·가져오기 창은 열기만 하고 돌아온다)
	// → {route, files: [{name, key, ambiguous, encoding, replaced, cues}]}
	function _routeSrtImport(read) {
		const ans = read.map(_analyzeSrt);
		const route = _srtRouteOf(ans);
		const summary = {
			route,
			files: ans.map((a) => ({ name: a.file.name, key: a.capKey.key, ambiguous: a.capKey.ambiguous, encoding: a.dec.encoding, replaced: a.dec.replaced, cues: a.cues.length }))
		};
		const seq = _importSeqToken();
		if (route === "legacy") _legacyImport(ans[0], seq);
		else if (route === "choice") _legacyChoice(ans[0], seq);
		else _openImportModal(ans, route === "distribute", seq);
		return summary;
	}
	// 확인창·가져오기 창은 누를 때까지 기다린다. 그 사이 Premiere에서 시퀀스를 바꾸면 폴러가 목록·휴지통·화자 표를
	// 그 시퀀스 것으로 바꾸므로, 창을 연 시퀀스를 기억해 두고 누를 때 다르면 아무것도 하지 않는다
	// (폴러는 전환할 때 창을 닫는다: _closeImportUi)
	const IMPORT_SEQ_CHANGED_MSG = "시퀀스가 바뀌어 SRT 가져오기를 취소했습니다";
	function _importSeqToken() {
		return state.currentProjectKey + "\n" + state.currentSequenceKey;
	}
	// 창을 연 뒤 시퀀스가 바뀌었으면 상태 줄에 알리고 true
	function _importSeqChanged(seq) {
		if (seq === undefined || seq === _importSeqToken()) return false;
		setStatus(IMPORT_SEQ_CHANGED_MSG, "err");
		return true;
	}
	// 시퀀스 전환 때 폴러가 부른다: 열려 있는 가져오기 창·가져오기 확인창을 닫는다 → 닫은 것이 있으면 true
	function _closeImportUi() {
		let closed = false;
		if (_imp) {
			_closeImportModal();
			closed = true;
		}
		if (closeChoice()) closed = true;
		return closed;
	}
	// 지금 목록에 대한 경로 (core srtImportRoute)
	function _srtRouteOf(ans) {
		const legacy = state.subtitles.filter((s) => !s.spk);
		return srtImportRoute({
			castEnabled: _miCastEnabled(),
			files: ans.map((a) => a.capKey),
			castEmpty: !_castMode(),
			legacyLive: legacy.length,
			legacyPreset: legacy.filter((s) => state.rowStates[s.id] && state.rowStates[s.id].presetId).length
		});
	}

	// ── 레거시 경로 (v27) ──

	// 한 줄 미리보기 (확인창)
	function _cuePreview(text, max) {
		const t = String(text == null ? "" : text).replace(/\r\n?|\n|[\u2028\u2029]/g, " / ");
		const n = max || 60;
		return t.length > n ? t.slice(0, n - 1) + "…" : t;
	}
	// 인코딩 확인 문구: "‘인터뷰.srt’를 CP949로 읽었습니다." / "‘인터뷰.srt’에 깨진 글자 3개가 있습니다 (UTF-8로 읽음)." + 첫 자막
	function _encodingMessage(an) {
		const q = "‘" + an.file.name + "’";
		const lines = [];
		if (an.dec.encoding !== "utf-8") {
			lines.push(q + "를 " + encodingLabel(an.dec.encoding) + "로 읽었습니다.");
			if (an.dec.replaced > 0) lines.push("깨진 글자 " + an.dec.replaced + "개가 있습니다.");
		} else lines.push(q + "에 깨진 글자 " + an.dec.replaced + "개가 있습니다 (UTF-8로 읽음).");
		const first = parseSRT(an.text)[0];
		lines.push("", "첫 자막: " + (first ? first.startTime + "  " + _cuePreview(first.text) : "(자막 없음)"), "", "이대로 가져올까요? (지금 목록은 바뀝니다)");
		return lines.join("\n");
	}
	// 레거시 가져오기: UTF-8이 아니거나 깨진 글자가 있으면 목록을 바꾸기 전에 묻는다 (seq: 연 시퀀스, _importSeqToken)
	function _legacyImport(an, seq) {
		const go = () => {
			if (!_importSeqChanged(seq)) _legacyReplace(an.file.name, an.text);
		};
		if (!needsEncodingConfirm(an.dec)) {
			go();
			return;
		}
		showChoice(_encodingMessage(an), [
			{ label: "가져오기", run: go },
			{ label: "취소", run: () => setStatus("SRT 가져오기 취소: " + an.file.name, "") }
		]);
	}
	// 프리셋(후반 작업)이 걸린 레거시 목록 + C번호 없는 파일 하나: 병합 / 교체 / 취소 (인코딩이 이상하면 그것부터 묻는다)
	function _legacyChoice(an, seq) {
		const guard = (fn) => () => {
			if (!_importSeqChanged(seq)) fn();
		};
		const ask = () => showChoice("이미 후반 작업(프리셋)이 있는 자막 목록입니다.\n\n" +
			"병합: 줄마다 시간·문장만 새 파일에 맞추고 프리셋과 후반 작업은 그대로 둡니다. 바뀐 줄에는 점이 붙고, 빠진 줄은 휴지통으로 갑니다.\n" +
			"교체: 지금까지처럼 목록을 새 파일로 바꿉니다 (지금 목록은 안전 지점에 남습니다).", [
			{ label: "병합 (후반 작업 유지)", run: guard(() => _applyMerge(an)) },
			{ label: "교체 (지금까지 방식)", run: guard(() => _legacyReplace(an.file.name, an.text)) },
			{ label: "취소", run: () => setStatus("SRT 가져오기 취소: " + an.file.name, "") }
		]);
		if (!needsEncodingConfirm(an.dec)) {
			ask();
			return;
		}
		showChoice(_encodingMessage(an), [
			{ label: "가져오기", run: guard(ask) },
			{ label: "취소", run: () => setStatus("SRT 가져오기 취소: " + an.file.name, "") }
		]);
	}
	// 화자 없는 레거시 목록에 병합한다 (충돌은 SRT 문장을 따른다)
	function _applyMerge(an) {
		return _importIntoCast({ files: [{ key: null, name: "", action: "merge", file: an.file, cues: an.cues, idx: 0 }], keepPanelEdits: false });
	}
	// v27 교체 본문: 목록·휴지통을 새 파일로 바꾼다 (parseSRT opts 없음 → v27과 같은 줄).
	// 바꾸기 전에 안전 지점을 남기고(빈 목록이면 남기지 않는다), nextId는 되돌리지 않는다
	function _legacyReplace(fileName, text) {
		const parsed = parseSRT(text);
		// 지금 목록(과 휴지통)을 비우기 전에 안전 지점을 남긴다 (히스토리 드롭다운 '안전 지점'에서 되돌린다)
		_saveSafety("SRT 가져오기 전: " + fileName);
		// 아래 push 루프와 rowStates 구성이 끝난 뒤 saveSessionToStorage()가
		// 한 번 돈다. 여기서 저장하면 빈 배열이 먼저 쓰인다.
		// nextId는 되돌리지 않는다: 같은 시퀀스에서 id(→ 클립 태그·applied)가 다시 쓰이지 않게
		setSubtitles([], { reason: "SRT 로드", persist: false });
		state.rowStates = {};
		state.trashBin = [];
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
		_raiseHwm();
		renderAll();
		renderTrash();
		updateMultiSelect();
		saveSessionToStorage();
		_saveHistoryOnAction("SRT 로드: " + fileName);
		setStatus("SRT 로드: " + fileName + " (" + state.subtitles.length + "개)", "ok");
	}

	// ── 'SRT 가져오기' 창 ──

	// 창 상태 | null:
	//   entries  [{an, key, name, presetId, action: ""|"new"|"merge"|"replace"|"skip", nameTouched, presetTouched}]
	//   legacy   분배 모드면 {mode: "split"|"one"|"trash", oneKey, assign: {줄 id: "C1"|""(휴지통)}}, 아니면 null
	//   keepEdits  #impKeepPanelEdits (충돌 시 패널에서 고친 문장 유지)
	//   suspectAck 의심 파일이 있을 때 [가져오기]를 한 번 눌렀다 (다음 누름은 '그래도 가져오기')
	//   report   마지막 미리 계산 (importIntoData를 사본에)
	//   seq      창을 연 시퀀스 (_importSeqToken). [가져오기] 때 다르면 취소한다
	var _imp = null;
	// 캡션 트랙 선택지는 적어도 C1..C12 (화자 표·파일 이름에 더 큰 번호가 있으면 거기까지)
	const IMP_KEYS_MIN = 12;
	const IMP_ACTION_LABEL = { new: "새 화자", merge: "병합", replace: "교체", skip: "건너뜀" };
	const IMP_LEGACY_MODES = [["split", "파일에 맞춰 나누기 (후반 작업 유지)"], ["one", "모두 한 화자로"], ["trash", "휴지통으로 보내고 새로 시작"]];
	function _openImportModal(ans, distribute, seq) {
		const modal = document.getElementById("importModal");
		if (!modal) {
			setStatus("가져오기 창이 없습니다", "err");
			return;
		}
		_imp = {
			entries: ans.map((an) => {
				const en = { an, key: an.capKey.key || "", name: "", presetId: "", action: "", nameTouched: false, presetTouched: false };
				_impDefaults(en);
				return en;
			}),
			legacy: distribute ? { mode: "split", oneKey: "", assign: {} } : null,
			keepEdits: false,
			suspectAck: false,
			report: null,
			seq: seq === undefined ? _importSeqToken() : seq
		};
		const keep = document.getElementById("impKeepPanelEdits");
		if (keep) keep.checked = false;
		_renderImportModal();
		modal.classList.add("open");
	}
	function _closeImportModal() {
		const modal = document.getElementById("importModal");
		if (modal) modal.classList.remove("open");
		_imp = null;
	}
	// 키를 고를 때마다: 이미 있는 화자면 그 이름·기본 프리셋이 기본값이고 처리는 병합(후반 작업 유지)
	function _impDefaults(en) {
		const cast = en.key ? state.mi.cast[en.key] : null;
		if (!en.nameTouched) en.name = cast ? String(cast.name || "") : "";
		if (!en.presetTouched) en.presetId = cast ? String(cast.presetId || "") : "";
		en.action = !en.an.cues.length ? "skip" : !en.key ? "" : cast ? "merge" : "new";
	}
	// 기본 프리셋 선택지: 캡션 필드('T' 버튼)가 있는 프리셋만 → [[id, 이름]]
	function _impPresetChoices() {
		return Object.keys(state.presets).filter((id) => captionFid(state.presets[id]) !== null).map((id) => [id, state.presets[id].name || id]);
	}
	function _impKeyChoices() {
		let max = IMP_KEYS_MIN;
		const see = (k) => { const n = castKeyNum(k); if (n > max) max = n; };
		Object.keys(state.mi.cast || {}).forEach(see);
		_imp.entries.forEach((en) => {
			see(en.key);
			(en.an.capKey.nums || []).forEach((n) => see("C" + n));
		});
		const out = [];
		for (let i = 1; i <= max; i++) out.push("C" + i);
		return out;
	}
	// 파일 칸의 인코딩 표시 ("CP949로 읽음" / "깨진 글자 N개")
	function _impEncodingHint(dec) {
		const parts = [];
		if (dec.encoding !== "utf-8") parts.push(encodingLabel(dec.encoding) + "로 읽음");
		if (dec.replaced > 0) parts.push("깨진 글자 " + dec.replaced + "개");
		return parts.join(" · ");
	}
	// 가져올 파일(자막이 있고 키가 정해진 것)로 만든 작업
	function _impJob() {
		const files = [];
		_imp.entries.forEach((en, i) => {
			if (!en.an.cues.length || !en.key) return;
			files.push({ key: en.key, name: en.name, presetId: en.presetId, action: en.action, file: en.an.file, cues: en.an.cues, idx: i });
		});
		let legacy = null;
		if (_imp.legacy) {
			legacy = { mode: _imp.legacy.mode, oneKey: _impOneKey(), assign: Object.assign({}, _imp.legacy.assign) };
		}
		return { files, keepPanelEdits: _imp.keepEdits, legacy };
	}
	// 파일 키가 바뀌면 가져올 키가 아닌 '확인 필요' 선택을 지운다 (그 줄은 기본값 = 최고 화자로 돌아간다)
	function _impPruneLegacy() {
		if (!_imp || !_imp.legacy) return;
		const keys = _imp.entries.filter((en) => en.an.cues.length && en.key).map((en) => en.key);
		const as = _imp.legacy.assign;
		Object.keys(as).forEach((id) => { if (as[id] && keys.indexOf(as[id]) === -1) delete as[id]; });
	}
	// '모두 한 화자로'의 화자: 고른 값이 가져올 키 중에 있으면 그것, 아니면 첫 키
	function _impOneKey() {
		const keys = _imp.entries.filter((en) => en.an.cues.length && en.key).map((en) => en.key);
		const k = _imp.legacy && _imp.legacy.oneKey;
		return keys.indexOf(k) !== -1 ? k : keys[0] || "";
	}
	// 바꾸기 전 상태의 사본으로 미리 계산 (통계·분배·의심 파일). salt는 결과에 영향이 없어 임시 값
	function _impPreview() {
		const v = _validateImport();
		if (!v.ok) {
			_imp.report = null;
			return null;
		}
		try {
			_imp.report = importIntoData(_sessionClone(), _impJob(), { now: Date.now(), salt: state.mi.salt || "prev", presets: state.presets, trackValue: _trackValueNum() });
		} catch (e) {
			console.error("[MOGRT] 가져오기 미리 계산 실패:", e);
			_imp.report = null;
		}
		return _imp.report;
	}
	function _impReportOf(i) {
		const rep = _imp && _imp.report;
		return rep ? rep.files.find((f) => f.idx === i) || null : null;
	}
	// 파일 아래 줄: 병합 통계와 안내 (키 없음·모호, 교체될 줄 수, 전체 시간 이동, 의심 파일)
	function _impDetail(en, i) {
		const out = { stats: "", info: [] };
		if (!en.an.cues.length) return out;
		if (!en.key) {
			out.info.push(en.an.capKey.ambiguous
				? "파일 이름에 캡션 트랙 번호가 여럿입니다 (" + en.an.capKey.nums.map((n) => "C" + n).join("·") + ") — 하나를 고르세요"
				: "파일 이름에 캡션 트랙 번호(C1, C2…)가 없습니다 — 고르세요");
			return out;
		}
		const r = _impReportOf(i);
		if (en.action === "replace") {
			const n = state.subtitles.filter((s) => s.spk === en.key).length;
			out.info.push("지금 " + en.key + " 줄 " + n + "개는 휴지통으로 갑니다 (후반 작업은 휴지통 항목에 남습니다)");
		}
		if (r && r.action === "merge" && r.stats) out.stats = mergeStatsText(r.stats);
		if (r && r.shift) out.info.push("전체 시간이 " + (r.shift > 0 ? "+" : "") + r.shift.toFixed(2) + "초 이동했습니다 (시퀀스 시작 타임코드 확인)");
		if (r && r.suspect) {
			out.info.push(r.suspect.why === "same"
				? "이 파일이 " + en.key + " 캡션이 맞는지 확인하세요 (" + r.suspect.other + "과 같아 보임)"
				: "이 파일이 " + en.key + " 캡션이 맞는지 확인하세요 (지금 줄과 절반 넘게 다름)");
		}
		return out;
	}
	// → {ok, error, dup: {키: true}}
	function _validateImport() {
		const out = { ok: false, error: "", dup: {} };
		if (!_imp) return out;
		const live = _imp.entries.filter((en) => en.an.cues.length > 0);
		const count = {};
		live.forEach((en) => { if (en.key) count[en.key] = (count[en.key] || 0) + 1; });
		const dupKeys = sortCastKeys(Object.keys(count).filter((k) => count[k] > 1));
		dupKeys.forEach((k) => { out.dup[k] = true; });
		const missing = live.filter((en) => !en.key);
		if (!live.length) out.error = "가져올 자막이 없습니다 (자막 없는 파일은 건너뜁니다)";
		else if (dupKeys.length) out.error = dupKeys.join(", ") + "가 " + (dupKeys.some((k) => count[k] > 2) ? "여러" : "두") + " 파일에 지정되었습니다";
		else if (missing.length) out.error = "캡션 트랙을 고르세요: " + missing.map((en) => en.an.file.name).join(", ");
		out.ok = !out.error;
		return out;
	}
	// 분배 모드 머리 줄: "기존 목록 (화자 없음, 64줄) → C1 30 · C2 28 · 확인 필요 2 · 짝 없음 4" + 방식 + 확인 필요 목록
	function _renderImportLegacy() {
		const box = document.getElementById("impLegacy");
		if (!box) return;
		if (!_imp.legacy) {
			box.style.display = "none";
			return;
		}
		box.style.display = "";
		const lg = _imp.legacy;
		const total = state.subtitles.filter((s) => !s.spk).length;
		const rep = _imp.report && _imp.report.legacy;
		let tail = "";
		if (lg.mode === "trash") tail = "모두 휴지통";
		else if (lg.mode === "one") tail = "모두 " + (_impOneKey() || "?");
		else if (rep) {
			// 줄을 한 번씩만 센다: 확인 필요 줄은 화자별 수·짝 없음(휴지통을 고른 줄)에서 빼고 '확인 필요'로
			const amb = rep.ambiguous;
			const parts = [];
			sortCastKeys(Object.keys(rep.counts)).forEach((k) => {
				const n = rep.counts[k] - amb.filter((a) => a.to === k).length;
				if (n > 0) parts.push(k + " " + n);
			});
			if (amb.length) parts.push("확인 필요 " + amb.length);
			const unmatched = rep.unmatched - amb.filter((a) => !a.to).length;
			if (unmatched > 0) parts.push("짝 없음 " + unmatched);
			tail = parts.join(" · ") || "짝 없음 " + total;
		} else tail = "캡션 트랙을 고르면 나눕니다";
		const info = document.getElementById("impLegacyInfo");
		if (info) info.textContent = "기존 목록 (화자 없음, " + total + "줄) → " + tail;
		const mode = document.getElementById("impLegacyMode");
		if (mode) {
			if (!mode.options.length) IMP_LEGACY_MODES.forEach(([v, t]) => {
				const o = document.createElement("option");
				o.value = v;
				o.textContent = t;
				mode.appendChild(o);
			});
			mode.value = lg.mode;
		}
		const keySel = document.getElementById("impLegacyKey");
		if (keySel) {
			keySel.innerHTML = "";
			_imp.entries.filter((en) => en.an.cues.length && en.key).forEach((en) => {
				const o = document.createElement("option");
				o.value = en.key;
				o.textContent = en.key + (en.name ? " " + en.name : "");
				keySel.appendChild(o);
			});
			keySel.value = _impOneKey();
			keySel.style.display = lg.mode === "one" ? "" : "none";
		}
		// 확인 필요 줄: 줄마다 [C1|C2|…|휴지통] (기본은 점수가 가장 높은 화자)
		const amb = document.getElementById("impAmbList");
		if (amb) {
			amb.innerHTML = "";
			const list = lg.mode === "split" && rep ? rep.ambiguous : [];
			const keys = _imp.entries.filter((en) => en.an.cues.length && en.key).map((en) => en.key);
			list.forEach((a) => {
				const row = document.createElement("div");
				row.className = "imp-amb";
				const t = document.createElement("span");
				t.className = "imp-amb-text";
				t.textContent = a.s.toFixed(1) + "초 ‘" + _cuePreview(a.text, 40) + "’";
				const sel = document.createElement("select");
				sel.className = "imp-amb-key";
				sel.dataset.id = String(a.id);
				keys.concat([""]).forEach((k) => {
					const o = document.createElement("option");
					o.value = k;
					o.textContent = k || "휴지통";
					sel.appendChild(o);
				});
				sel.value = Object.prototype.hasOwnProperty.call(lg.assign, a.id) ? lg.assign[a.id] : a.key || "";
				sel.addEventListener("change", () => {
					lg.assign[a.id] = sel.value;
					_renderImportModal();
				});
				row.appendChild(t);
				row.appendChild(sel);
				amb.appendChild(row);
			});
		}
	}
	function _renderImportModal() {
		const body = document.getElementById("impBody");
		if (!body || !_imp) return;
		const v = _validateImport();
		_impPreview();
		_renderImportLegacy();
		body.innerHTML = "";
		const keys = _impKeyChoices();
		const presets = _impPresetChoices();
		const cell = (cls) => {
			const td = document.createElement("td");
			if (cls) td.className = cls;
			return td;
		};
		const option = (sel, value, text) => {
			const o = document.createElement("option");
			o.value = value;
			o.textContent = text;
			sel.appendChild(o);
		};
		_imp.entries.forEach((en, i) => {
			const empty = !en.an.cues.length;
			const tr = document.createElement("tr");
			tr.className = "imp-row" + (!empty && v.dup[en.key] ? " imp-dup" : "") + (empty ? " imp-empty" : "");
			tr.dataset.idx = String(i);
			// 파일
			const tdF = cell("imp-file");
			tdF.title = en.an.file.path || en.an.file.name;
			const fname = document.createElement("span");
			fname.textContent = en.an.file.name;
			tdF.appendChild(fname);
			const hint = _impEncodingHint(en.an.dec);
			if (hint) {
				const h = document.createElement("span");
				h.className = "imp-hint";
				h.textContent = hint;
				tdF.appendChild(h);
			}
			// 캡션 트랙
			const tdK = cell();
			const selK = document.createElement("select");
			selK.className = "imp-key";
			option(selK, "", "-- 선택 --");
			keys.forEach((k) => option(selK, k, k));
			selK.value = en.key;
			selK.disabled = empty;
			selK.addEventListener("change", () => {
				en.key = selK.value;
				_impDefaults(en);
				_impPruneLegacy();
				_imp.suspectAck = false;
				_renderImportModal();
			});
			tdK.appendChild(selK);
			// 화자 이름 (비우면 키)
			const tdN = cell();
			const inp = document.createElement("input");
			inp.type = "text";
			inp.className = "imp-name";
			inp.placeholder = "화자 이름";
			inp.value = en.name;
			inp.disabled = empty;
			inp.addEventListener("input", () => {
				en.name = inp.value;
				en.nameTouched = true;
			});
			tdN.appendChild(inp);
			// 기본 프리셋 (캡션 필드가 있는 프리셋만. 새 줄에만 쓰고, 병합한 줄의 프리셋은 그대로)
			const tdP = cell();
			const selP = document.createElement("select");
			selP.className = "imp-preset";
			option(selP, "", "-- 없음 --");
			presets.forEach(([id, name]) => option(selP, id, name));
			if (!presets.some((p) => p[0] === en.presetId)) en.presetId = "";
			selP.value = en.presetId;
			selP.disabled = empty;
			selP.addEventListener("change", () => {
				en.presetId = selP.value;
				en.presetTouched = true;
			});
			tdP.appendChild(selP);
			// 줄 수
			const tdC = cell("imp-count");
			tdC.textContent = empty ? "자막 없음" : en.an.cues.length + "줄";
			// 처리: 이미 있는 화자는 [병합 | 교체], 그 밖에는 미리 계산한 결과 (분배된 줄이 있으면 병합)
			const tdA = cell("imp-action");
			if (!empty && en.key && state.mi.cast[en.key]) {
				const selA = document.createElement("select");
				selA.className = "imp-act";
				selA.title = "병합: 시간·문장만 새 파일에 맞추고 프리셋·후반 작업은 그대로 / 교체: 지금 줄은 휴지통으로 보내고 새로 넣는다";
				option(selA, "merge", "병합");
				option(selA, "replace", "교체");
				selA.value = en.action === "replace" ? "replace" : "merge";
				selA.addEventListener("change", () => {
					en.action = selA.value;
					_imp.suspectAck = false;
					_renderImportModal();
				});
				tdA.appendChild(selA);
			} else {
				const r = _impReportOf(i);
				tdA.textContent = IMP_ACTION_LABEL[r ? r.action : en.action] || "";
			}
			[tdF, tdK, tdN, tdP, tdC, tdA].forEach((td) => tr.appendChild(td));
			body.appendChild(tr);
			const det = _impDetail(en, i);
			if (det.stats || det.info.length) {
				const tr2 = document.createElement("tr");
				tr2.className = "imp-detail";
				const td = cell();
				td.colSpan = 6;
				if (det.stats) {
					const st = document.createElement("span");
					st.className = "imp-stats";
					st.textContent = det.stats;
					td.appendChild(st);
				}
				if (det.info.length) {
					const sp = document.createElement("span");
					sp.className = "imp-info";
					sp.textContent = det.info.join(" · ");
					td.appendChild(sp);
				}
				tr2.appendChild(td);
				body.appendChild(tr2);
			}
		});
		const err = document.getElementById("impError");
		if (err) err.textContent = v.error;
		const ok = document.getElementById("impOk");
		if (ok) {
			ok.disabled = !v.ok;
			ok.textContent = _imp.suspectAck ? "그래도 가져오기" : "가져오기";
		}
	}
	function _onImportOk() {
		if (!_imp) return;
		// 창을 연 뒤 시퀀스가 바뀌었다: 미리 계산·분배 선택은 이전 시퀀스의 줄 것이다
		if (_imp.seq !== _importSeqToken()) {
			_closeImportModal();
			setStatus(IMPORT_SEQ_CHANGED_MSG, "err");
			return;
		}
		const v = _validateImport();
		if (!v.ok) {
			_renderImportModal();
			return;
		}
		// 의심 파일이 있으면 한 번 더 누르게 한다 (분배 모드에서는 core가 의심하지 않는다)
		const rep = _imp.report || _impPreview();
		if (rep && rep.files.some((f) => f.suspect) && !_imp.suspectAck) {
			_imp.suspectAck = true;
			const ok = document.getElementById("impOk");
			if (ok) ok.textContent = "그래도 가져오기";
			const err = document.getElementById("impError");
			if (err) err.textContent = "캡션 트랙 번호가 맞는지 확인하세요 — 맞으면 '그래도 가져오기'를 누릅니다";
			return;
		}
		const job = _impJob();
		_closeImportModal();
		_importIntoCast(job);
	}
	document.getElementById("impOk")?.addEventListener("click", _onImportOk);
	document.getElementById("impCancel")?.addEventListener("click", () => {
		_closeImportModal();
		setStatus("SRT 가져오기 취소", "");
	});
	document.getElementById("impKeepPanelEdits")?.addEventListener("change", (e) => {
		if (!_imp) return;
		_imp.keepEdits = !!e.target.checked;
		_renderImportModal();
	});
	document.getElementById("impLegacyMode")?.addEventListener("change", (e) => {
		if (!_imp || !_imp.legacy) return;
		_imp.legacy.mode = e.target.value;
		_renderImportModal();
	});
	document.getElementById("impLegacyKey")?.addEventListener("change", (e) => {
		if (!_imp || !_imp.legacy) return;
		_imp.legacy.oneKey = e.target.value;
		_renderImportModal();
	});

	// ── 적용 ──

	// 세션 데이터 사본 (가져오기 계산은 사본에서 하고, 바뀌었을 때만 상태에 넣는다)
	function _sessionClone() {
		return JSON.parse(JSON.stringify({ subtitles: state.subtitles, rowStates: state.rowStates, trashBin: state.trashBin, nextId: state.nextId, mi: state.mi }));
	}
	// 바뀌었는가를 가르는 서명. salt만 새로 만든 것, 화자의 파일 정보(file·path·size·mtime)만 바뀐 것은 바뀐 것이 아니다:
	// 내용이 같은 파일을 다시 내보냈거나(mtime) 명령으로 넣은 것(path 없음)도 '변경 없음' (그때 파일 정보도 그대로 둔다)
	function _sessionDataSig(d) {
		const mi = d.mi || {};
		const cast = {};
		Object.keys(mi.cast || {}).forEach((k) => {
			const c = Object.assign({}, mi.cast[k]);
			["file", "path", "size", "mtime"].forEach((f) => { delete c[f]; });
			cast[k] = c;
		});
		return stableJson({ s: d.subtitles, r: d.rowStates, t: d.trashBin, c: cast, o: mi.castOrder, l: mi.legacyTrack });
	}
	// 사본을 상태에 넣고 그리고 저장한다 (session.json + cast.json)
	function _commitSessionData(data, reason) {
		setSubtitles(data.subtitles, { reason, persist: false });
		state.rowStates = data.rowStates;
		state.trashBin = data.trashBin;
		state.nextId = data.nextId;
		state.mi = data.mi;
		_raiseHwm();
		renderAll();
		renderTrash();
		updateMultiSelect();
		saveSessionToStorage();
	}
	// #trackSel 값 (분배 때 mi.legacyTrack)
	function _trackValueNum() {
		const el = document.getElementById("trackSel");
		const n = el ? parseInt(el.value, 10) : NaN;
		return isFinite(n) ? n : null;
	}
	// 4자 [a-z0-9] salt (uid = salt-id, 클립 태그의 앞부분)
	function _mintSalt() {
		const abc = "abcdefghijklmnopqrstuvwxyz0123456789";
		const buf = new Uint8Array(4);
		try {
			window.crypto.getRandomValues(buf);
		} catch (_) {
			for (let i = 0; i < 4; i++) buf[i] = Math.floor(Math.random() * 256);
		}
		let s = "";
		for (let i = 0; i < 4; i++) s += abc[buf[i] % 36];
		return s;
	}
	// salt가 비었을 때 쓸 값: 쓸 만한 cast.json의 salt(v27이 mi를 버리고 저장한 뒤 등), 없으면 새로 만든다
	function _saltForImport() {
		try {
			const path = _getCastPath();
			const side = path ? _fsRead(path) : null;
			if (side && /^[a-z0-9]{4}$/.test(String(side.salt || "")) && castSidecarUsable({ subtitles: state.subtitles }, side)) return side.salt;
		} catch (_) {}
		return _mintSalt();
	}
	// 가져오기 작업을 목록·화자 표에 넣는다 (새 화자 / 병합 / 교체 / 분배, 화자 없는 목록 병합).
	// 사본에 core importIntoData → 바뀌었을 때만: 안전 지점 하나("SRT 가져오기 전: C1 a.srt · C2 b.srt") →
	// 상태·session.json·cast.json → 자동 항목 하나("SRT 가져오기: C1 철수(7)" / "SRT 병합: C2 (문장 2 · …)").
	// 같은 파일을 다시 가져오면 '변경 없음' (상태·히스토리 그대로)
	function _importIntoCast(job) {
		const data = _sessionClone();
		const before = _sessionDataSig(data);
		const keyed = job.files.some((f) => f.key);
		const report = importIntoData(data, job, { now: Date.now(), salt: keyed ? state.mi.salt || _saltForImport() : "", presets: state.presets, trackValue: _trackValueNum() });
		const byKey = (a, b) => castKeyNum(a.key) - castKeyNum(b.key);
		const fileOf = (f) => (f.key ? f.key + " " : "") + f.file.name;
		const nameOf = (r) => {
			const f = job.files.find((x) => x.idx === r.idx);
			return r.key || (f ? f.file.name : "");
		};
		if (_sessionDataSig(data) === before) {
			setStatus("변경 없음: " + job.files.map(fileOf).join(" · "), "ok");
			return report;
		}
		_saveSafety("SRT 가져오기 전: " + job.files.slice().sort(byKey).map(fileOf).join(" · "));
		_commitSessionData(data, "SRT 가져오기");
		const files = report.files.slice().sort(byKey);
		const added = files.filter((r) => r.action === "new" || r.action === "replace");
		const merged = files.filter((r) => r.action === "merge");
		const parts = [];
		if (added.length) parts.push("SRT 가져오기: " + added.map((r) => r.key + " " + r.name + "(" + r.count + ")").join(" · "));
		if (merged.length) parts.push("SRT 병합: " + merged.map((r) => nameOf(r) + " (" + mergeStatsShort(r.stats) + ")").join(" · "));
		if (report.legacy && report.legacy.total) parts.unshift("기존 목록 " + report.legacy.total + "줄 나눔");
		const label = parts.join(" / ");
		_saveHistoryOnAction(label);
		setStatus(label, "ok");
		return report;
	}
	//#endregion
	//#region src/mi/commands.ts
	// ─────────────────────────────────────────────────────────────
	// 헤드리스 명령: runCommand(op, args, ctx) → Promise<{ok:true, data} | {ok:false, error, detail}>
	//
	// UI 처리기, CDP 하드 테스트(window._mogrtDebug.cmd), 5단계 인박스가 같은 함수를 쓴다.
	// ctx.source: "ui" | "test" | "agent".
	// 오류 코드: needs-approval | fields-changed | busy | seq-mismatch | build-mismatch | bad-args | not-found
	//   (예상하지 못한 예외는 exception)
	//
	// S1-5에는 읽기 명령만 있다: status, rows, resolve, presets, cast.get, session.snapshot.
	// 바꾸는 명령(importSrt, merge*, plan/apply, cast.set, suggest …)은 뒤 커밋에서 더하고,
	// agent가 보내면 M5.4(승인 카드) 전까지 needs-approval이다.
	// 줄 주소 "#12" / "C2·12"는 사람이 읽는 이름일 뿐이다(파싱할 때마다 바뀐다). 쓰기 주소는 uid다.
	// ─────────────────────────────────────────────────────────────
	const CMD_SOURCES = { ui: true, test: true, agent: true };
	const CMD_ROWS_MAX = 200;
	function _cmdOk(data) {
		return { ok: true, data };
	}
	function _cmdErr(error, detail) {
		return { ok: false, error, detail: detail || "" };
	}
	// 화자 표가 있으면 다화자 표시("C2·12")
	function _castMode() {
		return Object.keys((state.mi && state.mi.cast) || {}).length > 0;
	}
	function _cmdClone(v) {
		return JSON.parse(JSON.stringify(v === undefined ? null : v));
	}
	// 설치된 app.js의 src/mi/core.ts 본문 해시 (5단계 MCP 서버가 같은 core를 쓰는지 확인하는 값).
	// 패널이 실제로 로드한 파일을 읽는다. 읽지 못하면 null (한 번만 시도한다).
	var _coreHashMemo;
	function _coreHash() {
		if (_coreHashMemo !== undefined) return _coreHashMemo;
		_coreHashMemo = null;
		try {
			const cacheRoot = _getCacheRoot();
			if (!cacheRoot || !window.cep || !window.cep.fs) return null;
			const r = window.cep.fs.readFile(cacheRoot.replace(/\/cache$/, "") + "/html/js/app.js");
			if (r && r.err === 0 && r.data) {
				const body = regionTextOf(r.data, "src/mi/core.ts");
				if (body !== null) _coreHashMemo = fnv1a32(body);
			}
		} catch (_) {}
		return _coreHashMemo;
	}
	function _rowSummaryOf(sub) {
		const rs = state.rowStates[sub.id];
		const preset = rs && rs.presetId ? state.presets[rs.presetId] : null;
		return rowSummary(sub, rs, preset, (state.mi && state.mi.salt) || "", _castMode());
	}
	const _COMMANDS = {
		// 패널·시퀀스·목록 요약. host는 v28 호스트 ping이 생기면 채운다 (S2-1)
		status: () => {
			const mi = state.mi || miDefault();
			const speakers = (mi.castOrder || []).map((k) => {
				const c = (mi.cast && mi.cast[k]) || {};
				return { key: k, name: c.name || k, track: typeof c.track === "number" ? c.track : null, presetId: c.presetId || "", count: state.subtitles.filter((s) => s.spk === k).length };
			});
			return _cmdOk({
				panel: { v: 28, build: null },
				host: null,
				seq: { id: state.currentSequenceId || "", name: (_seqLabelInfo && _seqLabelInfo.seqName) || "" },
				projKey: state.currentProjectKey,
				seqKey: state.currentSequenceKey,
				keysResolved: _keysResolved,
				sessionReadFailed: _sessionReadFailed,
				rows: state.subtitles.length,
				castMode: _castMode(),
				speakers,
				busy: false,
				coreHash: _coreHash()
			});
		},
		// 줄 목록 (쪽 단위). args {spk?, from = 0, count ≤ 200, filter: all|changed|warn|sugg}
		// → {total: 거른 뒤 줄 수, from, rows: [{uid, id, index, label, spk, s, e, text, presetId, sig, captionFid, fields, warn, sugg}]}
		rows: (args) => {
			const filter = args.filter === undefined ? "all" : args.filter;
			if (["all", "changed", "warn", "sugg"].indexOf(filter) === -1) return _cmdErr("bad-args", "filter는 all|changed|warn|sugg");
			const from = args.from === undefined ? 0 : Number(args.from);
			const count = args.count === undefined ? CMD_ROWS_MAX : Number(args.count);
			if (!Number.isInteger(from) || from < 0) return _cmdErr("bad-args", "from은 0 이상의 정수");
			if (!Number.isInteger(count) || count < 1 || count > CMD_ROWS_MAX) return _cmdErr("bad-args", "count는 1~" + CMD_ROWS_MAX);
			if (args.spk !== undefined && typeof args.spk !== "string") return _cmdErr("bad-args", "spk는 문자열 (예: C2)");
			const keep = (sub) => {
				if (args.spk !== undefined && (sub.spk || "") !== args.spk) return false;
				const rs = state.rowStates[sub.id] || {};
				if (filter === "changed") return !!rs.mm;
				if (filter === "warn") return Array.isArray(rs.warn) && rs.warn.length > 0;
				if (filter === "sugg") return !!rs.sugg && typeof rs.sugg === "object" && Object.keys(rs.sugg).length > 0;
				return true;
			};
			const all = state.subtitles.filter(keep);
			return _cmdOk({ total: all.length, from, rows: _cmdClone(all.slice(from, from + count).map(_rowSummaryOf)) });
		},
		// 사람이 쓴 주소("#12", "C2·12", "#12 T2") → 지금 목록의 줄 {uid, id, index, label, spk, text, captionFid, fields, sig}
		// 주소에 필드가 있으면 fid와 field {fid, index, displayName, value, caption}(못 찾으면 null)도 준다
		resolve: (args) => {
			const parsed = parseRowLabel(args.label);
			if (!parsed) return _cmdErr("bad-args", "주소 형식이 아니다: " + String(args.label) + " (예: #12, C2·12, #12 T2)");
			const hits = findRowsByLabel(state.subtitles, parsed);
			if (!hits.length) return _cmdErr("not-found", "그런 줄이 없다: " + String(args.label));
			if (hits.length > 1) return _cmdErr("bad-args", "여러 줄이 맞는다: " + hits.map((s) => rowLabel(s, true)).join(", ") + " — 화자를 붙여 주세요");
			const r = _rowSummaryOf(hits[0]);
			const out = { uid: r.uid, id: r.id, index: r.index, label: r.label, spk: r.spk, text: r.text, presetId: r.presetId, captionFid: r.captionFid, fields: r.fields, sig: r.sig };
			if (parsed.fid) {
				const rs = state.rowStates[hits[0].id];
				const preset = rs && rs.presetId ? state.presets[rs.presetId] : null;
				const f = resolveFid((rs && rs._allParams) || [], parsed.fid, preset ? preset.params : null);
				out.fid = parsed.fid;
				out.field = f ? { fid: f.fid, index: f.index, displayName: f.displayName, value: f.param && f.param.value != null ? String(f.param.value) : "", caption: out.captionFid === f.fid } : null;
			}
			return _cmdOk(_cmdClone(out));
		},
		// 프리셋마다 [{id, name, captionFid, sig, fields:[{fid, label, index, caption}], notes, native, orderVerified}]
		presets: () => {
			const ids = Object.keys(state.presets).sort((a, b) => (presetNum(a) - presetNum(b)) || (a < b ? -1 : a > b ? 1 : 0));
			return _cmdOk(_cmdClone(ids.map((id) => presetSummary(Object.assign({}, state.presets[id], { id })))));
		},
		// 화자 표 (salt 포함, applied·hwm 제외)
		"cast.get": () => {
			const mi = miFromFile(state.mi);
			return _cmdOk(_cmdClone({ salt: mi.salt, castOrder: mi.castOrder, cast: mi.cast, legacyTrack: mi.legacyTrack, stack: mi.stack, stackDy: mi.stackDy, remapped: mi.remapped }));
		},
		// 세션 전체 사본 (읽기 전용)
		"session.snapshot": () => _cmdOk(_cmdClone({ projKey: state.currentProjectKey, seqKey: state.currentSequenceKey, subtitles: state.subtitles, rowStates: state.rowStates, trashBin: state.trashBin, nextId: state.nextId, mi: state.mi })),
		// SRT 가져오기 = #srtInput에서 그 파일들을 고른 것과 같다 (경로에 따라 v27 교체·인코딩 확인창·가져오기 창).
		// args {files: [{name, b64}]} → {route: legacy|modal|distribute, files: [{name, key, ambiguous, encoding, replaced, cues}]}
		// 플래그가 꺼져 있으면 첫 파일 하나만 본다. agent는 승인 카드(M5.4) 전까지 needs-approval
		importSrt: (args, ctx) => {
			if (ctx.source === "agent") return _cmdErr("needs-approval", "SRT 가져오기는 패널에서 승인해야 합니다");
			const read = _cmdReadFiles(args.files);
			if (read.error) return _cmdErr("bad-args", read.error);
			if (!_keysResolved) return _cmdErr("no-sequence", "시퀀스를 열면 SRT를 열 수 있습니다");
			return _cmdOk(_cmdClone(_routeSrtImport(_miCastEnabled() ? read.files : read.files.slice(0, 1))));
		},
		// 병합 미리 보기 (아무것도 바꾸지 않는다) = 가져오기 창이 보여 주는 통계.
		// args {files: [{name, b64, key?, speaker?, presetId?, action?: new|merge|replace}], keepPanelEdits?, legacy?: {mode, oneKey, assign}}
		//   key를 빼면 파일 이름의 C번호. C번호 없는 파일 하나 + 화자 표 없음이면 화자 없는 목록에 병합한다
		// → {changed, files: [{name, key, action, count, stats, statsText, shift, suspect}], legacy}
		mergePreview: (args) => {
			const r = _cmdImportJob(args);
			if (r.error) return _cmdErr(r.code || "bad-args", r.error);
			const data = _sessionClone();
			const before = _sessionDataSig(data);
			const rep = importIntoData(data, r.job, { now: Date.now(), salt: state.mi.salt || "prev", presets: state.presets, trackValue: _trackValueNum() });
			return _cmdOk(_cmdClone(_cmdImportSummary(r.job, rep, _sessionDataSig(data) !== before)));
		},
		// 병합(가져오기)을 넣는다: 가져오기 창의 [가져오기]와 같다 (안전 지점 하나 → 적용 → 자동 항목 하나, 변화가 없으면 아무것도 쓰지 않는다).
		// args는 mergePreview와 같다. agent는 승인 카드(M5.4) 전까지 needs-approval
		mergeCommit: (args, ctx) => {
			if (ctx.source === "agent") return _cmdErr("needs-approval", "병합은 패널에서 승인해야 합니다");
			const r = _cmdImportJob(args);
			if (r.error) return _cmdErr(r.code || "bad-args", r.error);
			const before = _sessionDataSig(_sessionClone());
			const rep = _importIntoCast(r.job);
			return _cmdOk(_cmdClone(_cmdImportSummary(r.job, rep, _sessionDataSig(_sessionClone()) !== before)));
		}
	};
	// mergePreview·mergeCommit 인자 → {job} | {error, code}
	function _cmdImportJob(args) {
		if (!_keysResolved) return { error: "시퀀스를 열면 SRT를 열 수 있습니다", code: "no-sequence" };
		if (!_miCastEnabled()) return { error: "여러 SRT 가져오기·병합은 아직 꺼져 있다 (MI_CAST_ENABLED, DEV는 setMiCast)" };
		const read = _cmdReadFiles(args.files);
		if (read.error) return { error: read.error };
		const ans = read.files.map(_analyzeSrt);
		const castEmpty = !_castMode();
		const legacyLive = state.subtitles.filter((s) => !s.spk).length;
		const files = [];
		const seen = {};
		for (let i = 0; i < ans.length; i++) {
			const a = args.files[i];
			const an = ans[i];
			if (!an.cues.length) continue;
			let key = a.key !== undefined ? a.key : an.capKey.key;
			key = key ? String(key) : null;
			if (key && !/^C[1-9][0-9]?$/.test(key)) return { error: "key는 C1..C99: " + key };
			if (!key && !(ans.length === 1 && castEmpty)) return { error: "캡션 트랙 번호(key)가 필요하다: " + an.file.name };
			if (key && seen[key]) return { error: key + "가 두 파일에 지정되었다" };
			if (key) seen[key] = true;
			const cast = key ? state.mi.cast[key] : null;
			const action = a.action !== undefined ? String(a.action) : key && !cast ? "new" : "merge";
			if (["new", "merge", "replace"].indexOf(action) === -1) return { error: "action은 new|merge|replace" };
			const presetId = a.presetId !== undefined ? String(a.presetId || "") : cast ? undefined : "";
			if (presetId && (!state.presets[presetId] || captionFid(state.presets[presetId]) === null)) return { error: "캡션 필드가 있는 프리셋이 아니다: " + presetId };
			files.push({ key, name: typeof a.speaker === "string" ? a.speaker : "", presetId, action, file: an.file, cues: an.cues, idx: i });
		}
		if (!files.length) return { error: "가져올 자막이 없다" };
		let legacy = null;
		if (legacyLive > 0 && files.some((f) => f.key)) {
			const lg = _cmdLegacyArgs(args.legacy, files.filter((f) => f.key).map((f) => f.key));
			if (lg.error) return { error: lg.error };
			legacy = lg.legacy;
		}
		return { job: { files, keepPanelEdits: args.keepPanelEdits === true, legacy } };
	}
	// args.legacy {mode?: split|one|trash, oneKey?: 가져올 키 | "", assign?: {줄 id: 가져올 키 | ""(휴지통)}} → {legacy} | {error}
	// 가져올 파일의 키가 아닌 화자는 받지 않는다 (화자 표에 없는 spk가 생기지 않게)
	function _cmdLegacyArgs(v, keys) {
		if (v === undefined || v === null) return { legacy: { mode: "split", oneKey: "", assign: {} } };
		if (typeof v !== "object" || Array.isArray(v)) return { error: "legacy는 {mode, oneKey, assign}" };
		const mode = v.mode === undefined ? "split" : v.mode;
		if (["split", "one", "trash"].indexOf(mode) === -1) return { error: "legacy.mode는 split|one|trash" };
		const oneKey = v.oneKey === undefined || v.oneKey === null ? "" : v.oneKey;
		if (oneKey !== "" && keys.indexOf(oneKey) === -1) return { error: "legacy.oneKey는 가져올 파일의 키(" + keys.join(", ") + ") 중 하나: " + String(oneKey) };
		const assign = v.assign === undefined || v.assign === null ? {} : v.assign;
		if (typeof assign !== "object" || Array.isArray(assign)) return { error: "legacy.assign은 {줄 id: 키 | \"\"}" };
		for (const id of Object.keys(assign)) {
			if (assign[id] !== "" && keys.indexOf(assign[id]) === -1) return { error: "legacy.assign 값은 가져올 파일의 키(" + keys.join(", ") + ")나 \"\"(휴지통): " + id + " → " + String(assign[id]) };
		}
		return { legacy: { mode, oneKey, assign: Object.assign({}, assign) } };
	}
	function _cmdImportSummary(job, rep, changed) {
		return {
			changed,
			files: rep.files.map((f) => {
				const src = job.files.find((x) => x.idx === f.idx);
				return { name: src ? src.file.name : "", key: f.key, action: f.action, count: f.count, stats: f.stats || null, statsText: f.stats ? mergeStatsText(f.stats) : "", shift: f.shift || 0, suspect: f.suspect || null };
			}),
			legacy: rep.legacy
		};
	}
	// base64 → Uint8Array
	function _b64ToBytes(b64) {
		const bin = atob(String(b64).replace(/\s+/g, ""));
		const out = new Uint8Array(bin.length);
		for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
		return out;
	}
	// 명령 인자 files: [{name, b64}] → {files: [{name, path, size, mtime, bytes}]} | {error}
	function _cmdReadFiles(files) {
		if (!Array.isArray(files) || !files.length) return { error: "files는 [{name, b64}] 배열" };
		const out = [];
		for (const f of files) {
			if (!f || typeof f.name !== "string" || !f.name || typeof f.b64 !== "string") return { error: "files[]는 {name, b64}" };
			let bytes;
			try {
				bytes = _b64ToBytes(f.b64);
			} catch (_) {
				return { error: "b64를 풀지 못했다: " + f.name };
			}
			out.push({ name: f.name, path: null, size: bytes.length, mtime: null, bytes });
		}
		return { files: out };
	}
	async function runCommand(op, args, ctx) {
		const source = ctx && ctx.source !== undefined ? ctx.source : "ui";
		if (!CMD_SOURCES[source]) return _cmdErr("bad-args", "ctx.source는 ui|test|agent");
		if (typeof op !== "string" || !Object.prototype.hasOwnProperty.call(_COMMANDS, op)) return _cmdErr("bad-args", "모르는 명령: " + String(op));
		if (args !== undefined && args !== null && (typeof args !== "object" || Array.isArray(args))) return _cmdErr("bad-args", "args는 객체");
		try {
			return await _COMMANDS[op](args || {}, { source });
		} catch (e) {
			console.error("[MOGRT] runCommand 예외:", op, e);
			return _cmdErr("exception", (e && e.message) || String(e));
		}
	}
	window._mogrtDebug.cmd = (op, args) => runCommand(op, args, { source: "test" });
	// 다른 출처로 부른다 (agent가 needs-approval을 받는지 시험할 때)
	window._mogrtDebug.cmdAs = (source, op, args) => runCommand(op, args, { source });
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
	// SRT 열기 → 라우터 (src/ui/importDialog.ts). 파일 목록을 먼저 받아 두고 입력을 비운다 (같은 파일을 다시 고를 수 있게)
	document.getElementById("srtInput")?.addEventListener("change", (e) => {
		const input = e.target;
		const files = input.files ? Array.from(input.files) : [];
		input.value = "";
		if (!files.length) return;
		_onSrtFilesChosen(files);
	});
	_syncSrtInputMultiple();
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
	// 키가 정해지기 전이라 프리셋만 읽는다. 목록은 실제 시퀀스 키가 정해진 뒤에 읽는다
	// (기본 키 default_seq의 옛 목록이 보였다가 사라지거나 새 시퀀스로 새지 않게).
	loadAllFromStorage({ presetsOnly: true });
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
	// ── 부팅 게이트 ──
	// 실제(프리뷰가 아닌) 시퀀스로 키가 정해질 때까지 SRT 열기·▶ 적용·작업 불러오기를 막는다.
	// 2초마다 다시 확인하고(폴러도 확인한다), 타이머가 게이트를 여는 일은 없다.
	const GATE_WAIT_MSG = "시퀀스 확인 중…";
	const GATE_NOSEQ_MSG = "시퀀스를 열면 SRT를 열 수 있습니다";
	function _updateBootGate(noSeq) {
		const open = _keysResolved;
		const srtInput = document.getElementById("srtInput");
		const workInput = document.getElementById("workInput");
		[srtInput, workInput].forEach((inp) => {
			if (!inp) return;
			inp.disabled = !open;
			const lbl = inp.closest("label");
			if (lbl) {
				lbl.classList.toggle("gated", !open);
				if (!open) {
					if (lbl.dataset.titleOrig === undefined) lbl.dataset.titleOrig = lbl.title || "";
					lbl.title = noSeq ? GATE_NOSEQ_MSG : GATE_WAIT_MSG;
				} else if (lbl.dataset.titleOrig !== undefined) {
					lbl.title = lbl.dataset.titleOrig;
					delete lbl.dataset.titleOrig;
				}
			}
		});
		const btnApply = document.getElementById("btnApply");
		if (btnApply) btnApply.disabled = !open;
		const bar = document.getElementById("statusBar");
		if (!open) setStatus(noSeq ? GATE_NOSEQ_MSG : GATE_WAIT_MSG, "info");
		else if (bar && (bar.textContent === GATE_WAIT_MSG || bar.textContent === GATE_NOSEQ_MSG)) setStatus("준비", "");
	}
	// getActiveSequenceInfo → 키. v27과 같은 규칙 (projPath가 없으면 지금 프로젝트 키를 유지)
	function _keysFromInfo(info) {
		const seqId = info.seqId || "";
		const seqName = info.seqName || "";
		const projKey = info.projPath ? "proj_" + simpleHash(info.projPath) : state.currentProjectKey;
		const seqPart = seqId ? seqId.replace(/[^a-zA-Z0-9\-]/g, "_") : "name_" + simpleHash(seqName);
		return { projKey, seqKey: projKey + "_seq_" + seqPart, seqId: seqId || seqName };
	}
	// 실제 작업 시퀀스인가 (없음·프리뷰 시퀀스는 아니다)
	function _isRealSeqInfo(info) {
		return !!(info && (info.seqId || info.seqName) && info.seqName !== "__MOGRT_PREVIEW__");
	}
	function _setSeqLabel(info) {
		_seqLabelInfo = info;
		_renderSeqLabel();
	}
	// 활성 시퀀스 표시. 세션 파일을 읽지 못한 키면 앞에 경고를 붙인다 (상태 줄 오류는 다음 문구에 덮이므로)
	function _renderSeqLabel() {
		const el = document.getElementById("activeSeqLabel");
		const info = _seqLabelInfo;
		if (!el || !info) return;
		const name = info.seqName || info.seqId;
		const warn = name && _keysResolved && _sessionReadFailed ? "⚠ 세션 파일 읽기 실패 · " : "";
		el.textContent = name ? warn + "활성 시퀀스 : " + name : "";
		el.title = warn ? "이 시퀀스의 session.json을 읽지 못했습니다. 파일은 덮지 않으며, 새로 작업하면 옆 이름으로 옮겨 보관합니다." : "현재 활성 시퀀스";
	}
	// 처음 키를 정한다: 프리셋+세션을 그 키로 읽고 게이트를 연다
	// 그리기 하나가 예외를 던져도 게이트는 연다 (v27은 같은 예외를 삼키고 SRT 열기를 막지 않았다)
	function _resolveKeys(info) {
		if (_keysResolved || !_isRealSeqInfo(info)) return;
		const k = _keysFromInfo(info);
		state.currentProjectKey = k.projKey;
		state.currentSequenceKey = k.seqKey;
		state.currentSequenceId = k.seqId;
		_setSeqLabel(info);
		// 프로젝트/시퀀스 키 확정 후 프리셋+자막 모두 올바른 키로 재로드
		loadAllFromStorage();
		_keysResolved = true;
		[renderAll, renderTrash, renderPresetList, renderPresetTrash, refreshAllSelects, updateMultiSelect, updatePresetTabCount, _loadTrackFromStorage, _renderSeqLabel].forEach((fn) => {
			try { fn(); } catch (e) { console.error("[MOGRT] 키 확정 뒤 그리기 실패:", fn.name, e); }
		});
		_updateBootGate(false);
	}
	function _tryResolveKeys() {
		if (_keysResolved) return;
		host.getActiveSequenceInfo().then((info) => {
			if (_keysResolved) return;
			if (_isRealSeqInfo(info)) {
				try { _resolveKeys(info); } catch (e) { console.error("[MOGRT] 키 확정 실패:", e); }
				if (_keysResolved) return;
			} else _updateBootGate(!(info && (info.seqId || info.seqName)));
			setTimeout(_tryResolveKeys, 2000);
		}).catch(() => {
			setTimeout(_tryResolveKeys, 2000);
		});
	}
	// 시퀀스 정보는 백그라운드로 비동기 로드 (스캔을 블로킹하지 않음)
	// (게이트 상수가 위에서 선언된 뒤에 부른다: 앞에서 부르면 TDZ)
	_updateBootGate(false);
	_tryResolveKeys();
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
				const seqIdentifier = newSeqId || newSeqName;
				if (!seqIdentifier) return;
				// 프리뷰 시퀀스는 폴링에서 완전히 무시 (활성 시퀀스 전환 방지)
				if (newSeqName === "__MOGRT_PREVIEW__") return;
				// 아직 키가 정해지지 않았으면 여기서 처음 정한다 (전환이 아니다)
				if (!_keysResolved) {
					_resolveKeys(info);
					return;
				}
				const k = _keysFromInfo(info);
				const newProjKey = k.projKey;
				const newSeqKey = k.seqKey;
				_setSeqLabel(info);
				if (newSeqKey === state.currentSequenceKey) return;
				const isSameProject = newProjKey === state.currentProjectKey;
				// 이전 시퀀스의 목록으로 연 SRT 가져오기 창·확인창은 닫는다 (바뀐 시퀀스에 넣지 않게)
				const importClosed = _closeImportUi();
				saveSessionToStorage();
				state.currentProjectKey = newProjKey;
				state.currentSequenceKey = newSeqKey;
				state.currentSequenceId = seqIdentifier;
				// 세션 파일이 없는 키면 목록을 비운다 (같은 프로젝트든 다른 프로젝트든).
				// 다른 프로젝트는 프리셋도 다시 읽는다 (프리셋 파일이 없으면 v27처럼 그대로 가져간다)
				if (!isSameProject) loadAllFromStorage();
				else loadSessionFromStorage();
				renderAll();
				renderTrash();
				renderPresetList();
				renderPresetTrash();
				refreshAllSelects();
				updateMultiSelect();
				updatePresetTabCount();
				// 시쿼스 전환 후 트랙 복원
				_loadTrackFromStorage();
				// 세션 파일을 읽지 못했으면 그 오류 문구를 덮지 않는다
				if (!_sessionReadFailed) setStatus((isSameProject ? "시쿼스 전환: " : "프로젝트 변경: ") + (info.seqName || newSeqId) + (importClosed ? " — SRT 가져오기를 취소했습니다" : ""), "ok");
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
	// 여기까지 오면 검색·프리셋 필터 선언(_subSearchInput, _presetFilterSelected)이 끝났다.
	// 그 전에 renderAll 쪽에서 필터를 부르면 TDZ로 IIFE 전체가 멈춘다 → 부르는 쪽이 이 플래그를 본다
	_filtersReady = true;

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
	// ── 변경 줄 선택: 병합으로 mm이 붙은 줄만 체크한다 (나머지는 체크를 푼다) ──
	document.getElementById("btnSelectChanged")?.addEventListener("click", () => {
		let n = 0;
		state.subtitles.forEach((sub) => {
			const rs = state.rowStates[sub.id];
			if (!rs) return;
			rs.checked = !!rs.mm;
			if (rs.checked) n++;
			const chk = document.querySelector("#row-" + sub.id + " input[type=checkbox]");
			if (chk) chk.checked = rs.checked;
			const rowEl = document.getElementById("row-" + sub.id);
			if (rowEl) rowEl.className = _buildRowClass(sub.id, rs);
		});
		updateMultiSelect();
		setStatus("변경 줄 " + n + "개 선택", "ok");
	});
	document.getElementById("btnMultiDel")?.addEventListener("click", () => {
		Object.entries(state.rowStates).filter(([, rs]) => rs.checked).map(([id]) => parseInt(id, 10)).forEach((id) => deleteSubtitle(id));
	});
	document.getElementById("btnApply")?.addEventListener("click", async () => {
		if (!_keysResolved) {
			setStatus(GATE_NOSEQ_MSG, "err");
			return;
		}
		if (state.subtitles.length === 0) {
			setStatus("먼저 SRT 파일을 열어주세요.", "err");
			return;
		}
		// 화자 줄이 있으면 v27 한 트랙 경로로 보내지 않는다 (화자마다 전용 트랙에 놓는 것은 S2-4)
		if (state.subtitles.some((s) => s.spk)) {
			setStatus(CAST_APPLY_PENDING_MSG, "err");
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
					// clearFirst(교체): 가져온 프리셋과 이름·MOGRT가 같은 기존 프리셋은 그 id를 그대로 쓰고,
					// 다시 쓰이지 않은 기존 프리셋은 지우지 않고 프리셋 휴지통으로 보낸다(why "import").
					// 새 id는 항상 _allocPresetId()로 받는다. 카운터를 되돌리지 않으므로 다른 세션·휴지통의
					// 'preset_3'이 조용히 다른 MOGRT를 가리키는 일이 없다.
					const doImport = (clearFirst) => {
						const live = Object.assign({}, state.presets);
						const accepted = [];
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
							// 경로 비교: 전체 경로 일치를 먼저, 없으면 파일명 일치 (드라이브/슬래시 차이 허용).
							// 한 번에 찾으면 스캔 목록에서 앞에 있는 같은 이름의 다른 폴더 파일(예: 옛 버전 사본)이 이긴다.
							const pFileName = rawPath.split(/[\\/]/).pop().toLowerCase();
							const exact = state.mogrtList.find((m) => m.path === p.mogrtPath);
							const matched = exact || state.mogrtList.find((m) => m.path.toLowerCase().split(/[\\/]/).pop() === pFileName);
							if (!matched) {
								skipped++;
								skippedNames.push(p.name + " (" + pFileName + ")");
								continue;
							}
							// 파일명 일치 시 실제 경로로 업데이트
							if (matched.path !== p.mogrtPath) p.mogrtPath = matched.path;
							accepted.push({ pid, p, byName: !exact });
						}
						const plan = matchImportedPresets(accepted.map((a) => ({ id: a.pid, name: a.p.name, mogrtPath: a.p.mogrtPath })), live);
						let lostRows = 0;
						let safeSaved = false;
						if (clearFirst) {
							lostRows = Object.values(state.rowStates).filter((rs) => rs && rs.presetId && plan.dropped.indexOf(rs.presetId) !== -1).length;
							// 줄의 프리셋 연결이 끊기기 전에 안전 지점을 남긴다 (프리셋은 프리셋 휴지통에 남고,
							// 그 안전 지점을 복원하면 휴지통에서 함께 되살아난다: _revivePresetsForRows)
							if (lostRows > 0) safeSaved = _saveSafety("프리셋 가져오기 전");
							const deletedAt = new Date().toISOString();
							plan.dropped.forEach((id) => {
								state.presetTrash.push({ preset: JSON.parse(JSON.stringify(live[id])), deletedAt, why: "import" });
								delete state.presets[id];
							});
						}
						let kept = 0;
						let moved = 0;
						accepted.forEach((a, i) => {
							const reuse = plan.ids[i];
							const newId = reuse || _allocPresetId();
							if (reuse) {
								kept++;
								// id를 다시 쓰는데 파일의 경로가 파일명으로만 찾아졌으면(다른 PC 경로 등) 같은 이름의 여러 파일 중
								// 아무것이나 고른 셈이다. 지금 프리셋의 MOGRT가 아직 스캔 목록에 있으면 그 경로를 지킨다.
								const livePath = live[reuse] && live[reuse].mogrtPath;
								if (a.byName && livePath && livePath !== a.p.mogrtPath && state.mogrtList.some((m) => m.path === livePath)) a.p.mogrtPath = livePath;
								if (livePath && livePath !== a.p.mogrtPath) moved++;
							}
							state.presets[newId] = migratePreset({
								...a.p,
								id: newId,
								exposedFontFields: a.p.exposedFontFields || {}
							});
							imported++;
						});
						// 휴지통으로 간 프리셋을 가리키던 행은 '프리셋 없음'이 된다 (다른 MOGRT로 바뀌지 않는다)
						_sanitizeOrphanPresets();
						savePresetsToStorage();
						saveSessionToStorage();
						renderAll();
						renderPresetList();
						renderPresetTrash();
						refreshAllSelects();
						updatePresetTabCount();
						let msg = "프리셋 불러오기: " + imported + "개 " + (clearFirst ? "교체" : "추가");
						if (kept > 0) msg += " (ID 유지 " + kept + "개" + (moved > 0 ? ", 그중 MOGRT 경로가 바뀐 프리셋 " + moved + "개" : "") + ")";
						// 끊긴 줄은 '프리셋 없음'으로 저장된다. 프리셋을 휴지통에서 복구해도 줄은 다시 이어지지 않는다.
						// 안전 지점을 복원하면 줄의 연결과 프리셋이 함께 돌아온다
						const lostMsg = lostRows > 0 ? lostRows + "개 줄의 프리셋 연결이 끊어졌습니다 (이전 프리셋은 프리셋 휴지통에 있습니다. " +
							(safeSaved ? "히스토리의 안전 지점 '프리셋 가져오기 전'을 복원하면 줄과 프리셋이 함께 돌아옵니다" : "줄에는 다시 지정해야 합니다") + ")" : "";
						if (lostMsg) msg += " · " + lostMsg;
						if (skipped > 0) {
							msg += ", " + skipped + "개 스킵";
							showAlert("불러오기 완료: " + imported + "개 " + (clearFirst ? "교체됨" : "추가됨") + (lostMsg ? "\n" + lostMsg : "") + "\n\n다음 프리셋은 MOGRT 파일을 찾을 수 없어 스킵되었습니다:\n" + skippedNames.slice(0, 5).join("\n") + (skippedNames.length > 5 ? "\n..." : ""));
							setStatus(msg, "ok");
						} else setStatus(msg, "ok");
					};
					const existingCount = Object.keys(state.presets).length;
					if (existingCount > 0) {
						// 기존 프리셋이 있으면 OK = 교체, Cancel = 취소
						showConfirm(
							"기존 프리셋 " + existingCount + "개가 있습니다.\n\n[확인] 가져온 프리셋으로 교체 (이름과 MOGRT가 같은 프리셋은 ID 유지, 나머지는 프리셋 휴지통으로)\n[취소] 불러오기 취소",
							() => doImport(true),   // OK: 교체 (다시 쓰이지 않은 기존 프리셋은 프리셋 휴지통으로)
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
		// 화자 표·salt가 있으면 싣는다 (hwm·applied는 이 시퀀스의 것이라 싣지 않는다)
		if (miHasData(state.mi)) workData.mi = Object.assign(miSnapshotOf(state.mi), { salt: state.mi.salt });
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
		// 부팅 게이트: 키가 정해지기 전에 불러오면 키가 정해질 때 목록이 바뀌어 사라진다
		if (!_keysResolved) {
			input.value = "";
			setStatus(GATE_NOSEQ_MSG, "err");
			return;
		}
		const reader = new FileReader();
		reader.onload = (ev) => {
			try {
				const data = JSON.parse(ev.target?.result);
				if (!data.subtitles || !data.rowStates) { showAlert("올바른 작업 파일이 아닙니다."); return; }
				// 지금 목록을 바꾸기 전에 안전 지점을 남긴다
				_saveSafety("작업 불러오기 전");
				// id 규칙 (다른 시퀀스의 id가 이 시퀀스의 id·클립 태그와 겹치지 않게):
				//   같은 시퀀스(GUID가 같다. Premiere '다른 이름으로 저장'으로 projKey만 바뀐 경우 포함)
				//     → id 유지, nextId = safeNextId, 화자 표는 파일에서. 지금 salt가 비었으면 파일의 salt를 받는다
				//   다른 시퀀스 → 지금 쓴 적 있는 id 다음부터 다시 매기고 mi.remapped = true. salt는 받지 않는다
				const curGuid = seqGuidOf(state.currentSequenceKey);
				const sameSeq = data.sequenceKey === state.currentSequenceKey || (!!curGuid && seqGuidOf(data.sequenceKey) === curGuid);
				const fileMi = data.mi && typeof data.mi === "object" && !Array.isArray(data.mi) ? data.mi : null;
				let loaded;
				if (sameSeq) {
					loaded = { subtitles: data.subtitles, rowStates: data.rowStates, trashBin: data.trashBin || [], nextId: safeNextId(data, state.mi.hwm, state.nextId) };
					_miRestore(fileMi);
					if (!state.mi.salt && fileMi && typeof fileMi.salt === "string" && /^[a-z0-9]{4}$/.test(fileMi.salt)) state.mi.salt = fileMi.salt;
				} else {
					const start = safeNextId({ nextId: state.nextId, subtitles: state.subtitles, trashBin: state.trashBin }, state.mi.hwm, state.nextId);
					loaded = remapIds({ subtitles: data.subtitles, rowStates: data.rowStates, trashBin: data.trashBin || [] }, start);
					_miRestore(fileMi);
					state.mi.remapped = true;
				}
				// _sanitizeOrphanPresets()로 rowStates까지 정리한 뒤
				// saveSessionToStorage()가 돈다.
				setSubtitles(loaded.subtitles, { reason: "작업 파일 불러오기", persist: false });
				state.rowStates = loaded.rowStates;
				state.trashBin = loaded.trashBin;
				state.nextId = loaded.nextId;
				_raiseHwm();
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
				setStatus("작업 불러오기: " + file.name + " (" + state.subtitles.length + "개)" + (sameSeq ? "" : " · 다른 시퀀스의 작업이라 내부 id를 새로 매겼습니다"), "ok");
			} catch (_) {
				showAlert("JSON 파일 파싱 실패. 올바른 작업 파일인지 확인하세요.");
			}
		};
		reader.readAsText(file, "UTF-8");
		input.value = "";
	});

	// ── 히스토리 기능 ──
	// 자동저장/수동저장 각각 최대 20개, 별도 파일로 관리
	// 안전 지점(history_safety.json)은 최대 10개: 목록을 바꾸는 동작 직전의 상태만 둔다.
	// 5분 무작업 자동저장은 안전 지점에 쓰지 않으므로 자동저장이 안전 지점을 밀어내지 못한다.
	const HISTORY_MAX = 20;
	const SAFETY_MAX = 10;
	// kind: "auto" | "manual" | "safety" → 파일 경로
	function _historyPathOf(kind) {
		return kind === "safety" ? _getHistorySafetyPath() : kind === "manual" ? _getHistoryManualPath() : _getHistoryPath();
	}
	// isManual: true/false (v27 호출) 또는 kind 문자열
	function _histKind(isManual) {
		return typeof isManual === "string" ? isManual : isManual ? "manual" : "auto";
	}
	function _loadHistoryList(isManual) {
		try {
			const path = _historyPathOf(_histKind(isManual));
			if (!path) return [];
			const data = _fsRead(path);
			return Array.isArray(data) ? data : [];
		} catch(_) { return []; }
	}
	function _saveHistoryList(list, isManual) {
		try {
			const path = _historyPathOf(_histKind(isManual));
			if (path) return _fsWrite(path, list);
		} catch(_) {}
		return false;
	}
	// 항목의 내용 해시. hash가 없는 옛 항목은 그 자리에서 계산한다
	function _entryHash(entry) {
		if (!entry) return "";
		return typeof entry.hash === "string" && entry.hash ? entry.hash : contentHash(entry.subtitles, entry.rowStates, entry.trashBin);
	}
	// 지금 상태로 히스토리 항목을 만든다 (v27 모양 + hash)
	function _makeHistoryEntry(label, isManual) {
		const entry = {
			ts: Date.now(),
			label,
			isManual: !!isManual,
			sequenceKey: state.currentSequenceKey,
			subtitles: JSON.parse(JSON.stringify(state.subtitles)),
			rowStates: JSON.parse(JSON.stringify(state.rowStates)),
			trashBin: JSON.parse(JSON.stringify(state.trashBin)),
			nextId: state.nextId,
			trackValue: document.getElementById("trackSel")?.value ?? "2"
		};
		// 화자 표(salt·hwm·applied 제외)는 있을 때만 싣는다 → 단일 화자 항목은 v27 모양 + hash
		if (miHasData(state.mi)) entry.mi = miSnapshotOf(state.mi);
		entry.hash = contentHash(entry.subtitles, entry.rowStates, entry.trashBin);
		return entry;
	}
	// → 히스토리 파일에 썼는가 (빈 목록·키 미확정·세션 읽기 실패면 false)
	// opts.skipSame: 가장 최근 항목과 내용이 같으면 쓰지 않는다 (false) — 5분 무작업 자동저장용
	function _saveHistory(label, isManual, opts) {
		if (state.subtitles.length === 0) return false;
		// 키가 정해지기 전이거나 세션 파일을 읽지 못한 키면, 메모리 목록이 이 키의 것이 아니다
		if (!_keysResolved || _sessionReadFailed) return false;
		try {
			const list = _loadHistoryList(isManual);
			const entry = _makeHistoryEntry(label || (isManual ? "수동저장" : "자동저장"), isManual);
			if (opts && opts.skipSame && list.length && _entryHash(list[0]) === entry.hash) return false;
			list.unshift(entry);
			if (list.length > HISTORY_MAX) list.length = HISTORY_MAX;
			_saveHistoryList(list, isManual);
			_updateHistoryBtn();
			return true;
		} catch(_) { return false; }
	}
	// 안전 지점을 남긴다 → 새로 남겼는가.
	// 남기지 않는 경우: 목록과 휴지통이 모두 비었다(잃을 것이 없다), 키가 정해지기 전·세션 읽기 실패
	// (메모리 목록이 이 키의 것이 아니다), 가장 최근 안전 지점과 내용 해시가 같다.
	function _saveSafety(label) {
		if (state.subtitles.length === 0 && state.trashBin.length === 0) return false;
		if (!_keysResolved || _sessionReadFailed) return false;
		try {
			const list = _loadHistoryList("safety");
			const entry = _makeHistoryEntry(label || "안전 지점", false);
			entry.kind = "safety";
			if (list.length && _entryHash(list[0]) === entry.hash) return false;
			list.unshift(entry);
			if (list.length > SAFETY_MAX) list.length = SAFETY_MAX;
			if (!_saveHistoryList(list, "safety")) return false;
			_updateHistoryBtn();
			return true;
		} catch(_) { return false; }
	}
	function _updateHistoryBtn() {
		try {
			const autoList = _loadHistoryList(false);
			const manualList = _loadHistoryList(true);
			const safetyList = _loadHistoryList("safety");
			const btn = document.getElementById("btnHistory");
			if (btn) btn.classList.toggle("has-history", autoList.length > 0 || manualList.length > 0 || safetyList.length > 0);
		} catch(_) {}
	}
	function _buildHistoryDropdown() {
		const dropdown = document.getElementById("historyDropdown");
		if (!dropdown) return;
		dropdown.innerHTML = "";
		try {
			const autoList = _loadHistoryList(false);
			const manualList = _loadHistoryList(true);
			const safetyList = _loadHistoryList("safety");
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
				const saved = _saveHistory(label, true);
				// 목록이 있는데 쓰지 못했으면(세션 파일 읽기 실패 등) 성공이라고 하지 않는다. 빈 목록은 v27 문구 그대로
				if (!saved && state.subtitles.length > 0) {
					setStatus("수동저장하지 못했습니다: " + (_sessionReadFailed ? "이 시퀀스의 세션 파일을 읽지 못했습니다" : "기록을 쓰지 못했습니다"), "err");
					return;
				}
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
					manualListWrap.appendChild(_makeHistoryItem(entry, idx, "manual"));
				});
				manualSection.appendChild(manualListWrap);
			}
			dropdown.appendChild(manualSection);
			// ── 안전 지점 섹션 (자동저장 위) ──
			const safetySection = document.createElement("div");
			safetySection.id = "historySafety";
			safetySection.style.cssText = "border-bottom:1px solid #333;padding:5px 10px 6px;";
			const safetyHeader = document.createElement("div");
			safetyHeader.style.cssText = "font-size:10px;color:#888;margin-bottom:4px;";
			safetyHeader.title = "SRT 가져오기·히스토리 복원·작업 불러오기·프리셋 저장·프리셋 가져오기·프리셋 삭제·프리셋 일괄 적용·휴지통 비우기 직전의 상태 (자동저장이 밀어내지 않습니다)";
			safetyHeader.innerHTML = '안전 지점 <span style="color:#555;">' + safetyList.length + '/' + SAFETY_MAX + '</span>';
			safetySection.appendChild(safetyHeader);
			if (safetyList.length === 0) {
				const emptyS = document.createElement("div");
				emptyS.style.cssText = "font-size:11px;color:#555;padding:2px 0;";
				emptyS.textContent = "안전 지점 없음";
				safetySection.appendChild(emptyS);
			} else {
				const safetyListWrap = document.createElement("div");
				safetyListWrap.style.cssText = "max-height:120px;overflow-y:auto;";
				safetyList.forEach((entry, idx) => {
					safetyListWrap.appendChild(_makeHistoryItem(entry, idx, "safety"));
				});
				safetySection.appendChild(safetyListWrap);
			}
			dropdown.appendChild(safetySection);
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
					autoListWrap.appendChild(_makeHistoryItem(entry, idx, "auto"));
				});
				autoSection.appendChild(autoListWrap);
			}
			dropdown.appendChild(autoSection);
		} catch(_) {}
	}
	// kind: "auto" | "manual" | "safety" (복원 흐름은 셋 다 같다)
	function _makeHistoryItem(entry, idx, kind) {
		const isManual = kind === "manual";
		const defLabel = kind === "safety" ? "안전 지점" : isManual ? "수동저장" : "자동저장";
		const item = document.createElement("div");
		item.className = "history-item";
		const d = new Date(entry.ts);
		const timeStr = d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
		const dateStr = d.toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" });
		const infoWrap = document.createElement("div");
		infoWrap.style.cssText = "display:flex;align-items:center;gap:6px;flex:1;min-width:0;cursor:pointer;";
		infoWrap.innerHTML =
			'<span class="hist-time">' + dateStr + ' ' + timeStr + '</span>' +
			'<span class="hist-label">' + escapeHtml(entry.label || defLabel) + '</span>' +
			'<span class="hist-count">' + (entry.subtitles ? entry.subtitles.length : 0) + '개</span>';
		infoWrap.title = "이 시점으로 복원";
		infoWrap.addEventListener("click", (e) => {
			e.stopPropagation();
			showConfirm(
				"[" + dateStr + " " + timeStr + "] " + (entry.label || defLabel) + "\n" +
				(entry.subtitles ? entry.subtitles.length : 0) + "개 자막\n\n이 시점으로 복원하시겠습니까?",
				() => {
					// 복원하기 전 상태를 안전 지점으로 남긴다 (복원을 되돌릴 수 있게)
					_saveSafety("히스토리 복원 전");
					// 아래에서 _sanitizeOrphanPresets() 후 saveSessionToStorage()가 돈다.
					setSubtitles(entry.subtitles, { reason: "히스토리 복원", persist: false });
					state.rowStates = entry.rowStates;
					state.trashBin = entry.trashBin || [];
					// 화자 표는 항목에서, salt·hwm·applied는 지금 값. nextId는 되돌리지 않는다 (쓴 적 있는 id를 다시 주지 않게)
					_miRestore(entry.mi);
					state.nextId = safeNextId(entry, state.mi.hwm, state.nextId);
					_raiseHwm();
					if (entry.trackValue) {
						const trackSel = document.getElementById("trackSel");
						if (trackSel) {
							trackSel.value = entry.trackValue;
							_saveTrackToStorage(); // 복원한 트랙도 settings.json에 (다시 열어도 그대로)
						}
					}
					// 안전 지점: 줄이 가리키던 프리셋이 그 뒤 프리셋 휴지통으로 갔으면(프리셋 가져오기·삭제) 함께 되살린다.
					// 되살리지 못한 연결은 아래 정리가 끊는다. 자동·수동 항목은 v27처럼 연결만 끊는다
					let note = "";
					if (kind === "safety") {
						const revived = _revivePresetsForRows(state.rowStates);
						if (revived > 0) {
							savePresetsToStorage();
							renderPresetList();
							renderPresetTrash();
							updatePresetTabCount();
							note += " · 프리셋 " + revived + "개를 프리셋 휴지통에서 되살렸습니다";
						}
						const lost = Object.values(state.rowStates || {}).filter((rs) => rs && rs.presetId && !state.presets[rs.presetId]).length;
						if (lost > 0) note += " · 프리셋이 없어 " + lost + "개 줄의 연결을 끊었습니다";
					}
					_sanitizeOrphanPresets();
					renderAll();
					renderTrash();
					updateMultiSelect();
					saveSessionToStorage();
					const dd = document.getElementById("historyDropdown");
					if (dd) dd.classList.remove("open");
					setStatus("히스토리 복원: " + (entry.subtitles ? entry.subtitles.length : 0) + "개" + note, "ok");
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
				const list2 = _loadHistoryList(kind);
				// 드롭다운을 연 뒤 목록이 바뀌었을 수 있다(자동저장·안전 지점) → 시각·이름이 같은 항목을 지운다.
				// 그 사이 밀려나 이미 없으면 아무것도 지우지 않는다 (그 자리의 다른 항목을 지우지 않게)
				const at = list2.findIndex((x) => x && x.ts === entry.ts && x.label === entry.label);
				if (at === -1) {
					_buildHistoryDropdown();
					setStatus("이미 없는 항목입니다 (목록을 새로 그렸습니다)", "err");
					return;
				}
				list2.splice(at, 1);
				_saveHistoryList(list2, kind);
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
		// 키가 정해지기 전에는 기본 키(default_seq)의 히스토리가 보이므로 열지 않는다
		if (!_keysResolved) {
			setStatus(GATE_NOSEQ_MSG, "err");
			return;
		}
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
	// 가장 최근 자동 항목과 내용이 같으면 건너뛴다 (변화 없이 30분이 지나도 '자동저장'은 하나)
	let _lastActivityTime = Date.now();
	const _activityEvents = ["click", "keydown", "input", "change"];
	_activityEvents.forEach((ev) => {
		document.addEventListener(ev, () => { _lastActivityTime = Date.now(); }, { passive: true });
	});
	function _idleAutosaveTick() {
		if (state.subtitles.length === 0) return;
		const idle = Date.now() - _lastActivityTime;
		if (idle >= 5 * 60 * 1000) { // 5분
			_saveHistory("자동저장 (5분 무작업)", false, { skipSame: true });
			_lastActivityTime = Date.now(); // 중복 저장 방지
		}
	}
	setInterval(_idleAutosaveTick, 60 * 1000); // 1분마다 체크
	// 하드 테스트용: 1분 타이머를 기다리지 않고 무작업 확인을 한 번 돌린다 (Date.now를 앞당긴 뒤 부른다)
	window._mogrtDebug.idleAutosaveTick = _idleAutosaveTick;
	// 주요 작업 시 히스토리 저장 지점 등록 (SRT 로드, 타임라인 적용)
	// 이 함수를 호출하는 코드는 아래 srtInput/btnApply 핸들러에서 호출됨
	function _saveHistoryOnAction(label) { _saveHistory(label, false); }
	// 히스토리 버튼 초기 상태 업데이트
	_updateHistoryBtn();

	// ── 하드 테스트용 읽기 전용 스냅숏 (CDP) ──
	// 상태의 깊은 사본만 돌려주고 아무것도 바꾸지 않는다. 프리셋 썸네일은 길이만 남긴다.
	function _debugSnapshot() {
		const slim = (p) => {
			const c = JSON.parse(JSON.stringify(p || {}));
			if (typeof c.thumbnailData === "string") c.thumbnailData = c.thumbnailData.length;
			return c;
		};
		const presets = {};
		Object.keys(state.presets).forEach((id) => { presets[id] = slim(state.presets[id]); });
		return JSON.parse(JSON.stringify({
			keys: { proj: state.currentProjectKey, seq: state.currentSequenceKey, seqId: state.currentSequenceId },
			flags: { keysResolved: _keysResolved, filtersReady: _filtersReady, sessionReadFailed: _sessionReadFailed },
			subtitles: state.subtitles,
			rowStates: state.rowStates,
			trashBin: state.trashBin,
			nextId: state.nextId,
			presets,
			presetTrash: state.presetTrash.map((t) => Object.assign({}, t, { preset: slim(t.preset) })),
			nextPresetId: state.nextPresetId,
			mogrtCount: state.mogrtList.length,
			mogrtOriginals: state.mogrtOriginals,
			mi: state.mi
		}));
	}
	window._mogrtDebug.snapshot = _debugSnapshot;
	// main.ts 끝까지 예외 없이 왔다 (모든 핸들러가 붙었다)
	window._mogrtDebug.bootDone = true;

	//#endregion
})();
