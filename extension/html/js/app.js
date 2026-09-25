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
	// 여러 SRT 가져오기(다화자) 플래그. S2-4(화자별 배치)부터 true.
	// DEV·하드 테스트는 코드를 고치지 않고 window._mogrtDebug.setMiCast(false)로 레거시(SRT 한 개) 경로를 시험한다 (_miCastEnabled)
	const MI_CAST_ENABLED = true;
	// v28 호스트(hostscript.jsx MI_ 구역) 이름 접두사와 이 패널의 빌드. DEV 설치가 둘 다 바꾼다
	// (접두사 뒤에 D를 붙이고 @@BUILD@@ → dev-<sha>, tools/lib/stamp.js). 호스트 MI_ping의 prefix·build와 같아야 한다
	const MI_PREFIX = "MI_";
	const MI_BUILD_PANEL = "@@BUILD@@";
	// 레거시 적용 (src/mi/apply.ts, S1-9). renderAll이 부팅 중에 읽으므로 여기 둔다.
	//   _rowRes     줄마다 마지막 적용 결과 문구 {줄 id: "타임라인에 클립 없음" …} (.sub-res). 메모리에만, renderAll이 비운다
	//   _legacyRun  실행 중인 '안전하게 적용' {stop}. [중지]가 stop을 켜면 줄 사이에서 멈춘다
	var _rowRes = null, _legacyRun = null;
	// 화자 표 (src/ui/cast.ts, S2-3). renderAll·renderCastBar가 부팅 중에 읽으므로 여기 둔다.
	//   _speakerFilter  화자 칩에서 고른 화자 키 (비면 모두 보인다). 키가 바뀌면(시퀀스 전환) 비운다
	//   _miNumTracks    마지막으로 호스트에서 읽은 비디오 트랙 수 (모르면 null: 화자 표의 '새로 만듦' 표시)
	var _speakerFilter = new Set(), _miNumTracks = null;
	// 화자별 배치 (src/mi/apply.ts, S2-4). 폴러·30초 재스캔이 읽으므로 여기 둔다.
	//   _miBusy       적용이 도는 중 (폴러·MOGRT 재스캔·SRT 열기·▶·↑를 멈춘다)
	//   _miCancel     [중지]를 눌렀다 (청크 사이에서 멈춘다)
	//   _miRowStatus  줄마다 마지막 배치 결과 {줄 id: {st, why, detail}} (runCommand·테스트용. 줄 표시는 .sub-res)
	var _miBusy = false, _miCancel = false, _miRowStatus = {};
	// AI 명령 (src/mi/commands.ts, S3-1). 히스토리 저장(main.ts)이 읽는다.
	//   _aiLabel  승인한 agent 요청을 실행하는 동안 참: 그 사이 남는 안전 지점·히스토리 이름에 "AI: "를 붙인다
	var _aiLabel = false;
	// 표시 필터 (S3-2, src/ui/cast.ts _applyMarkFilter): "" | "warn"(포인트 경고가 있는 줄만) | "sugg"(AI 제안이 있는 줄만)
	var _markFilter = "";
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
	// last_apply.json (S2-4): 적용 실행 기록 (화자별 배치·레거시 안전 경로). 시작할 때 {complete: false}로 만들고 청크마다 다시 쓴다. 히스토리 ↶가 되돌린다 (S2-5)
	function _getLastApplyPath() {
		const root = _getCacheRoot();
		if (!root) return null;
		return root + "/" + state.currentProjectKey + "/" + state.currentSequenceKey + "/last_apply.json";
	}
	// cast_defaults.json (프로젝트 단위, S2-3): C번호별 이름·기본 프리셋·색·위치의 기본값 {v, C1: {name, presetId, color, pos}, …}
	function _getCastDefaultsPath() {
		const root = _getCacheRoot();
		if (!root) return null;
		return root + "/" + state.currentProjectKey + "/cast_defaults.json";
	}
	// 지금 프로젝트의 cast_defaults (core castDefaultsOf로 거른 {C1: {...}}). 프로젝트 키마다 한 번 읽는다
	var _castDefaultsMemo = null; // {pk, data}
	function _loadCastDefaults() {
		const pk = state.currentProjectKey;
		if (_castDefaultsMemo && _castDefaultsMemo.pk === pk) return _castDefaultsMemo.data;
		const path = _getCastDefaultsPath();
		const data = castDefaultsOf(path ? _fsRead(path) : null);
		_castDefaultsMemo = { pk, data };
		return data;
	}
	// 화자 keys의 지금 이름·기본 프리셋·색·위치를 cast_defaults.json에 적는다 (내용이 바뀌었을 때만). 키가 정해지기 전에는 쓰지 않는다
	function _saveCastDefaults(keys) {
		try {
			if (!_keysResolved || !keys || !keys.length) return false;
			const path = _getCastDefaultsPath();
			if (!path) return false;
			const cur = _loadCastDefaults();
			const next = castDefaultsMerge(cur, (state.mi && state.mi.cast) || {}, keys);
			if (stableJson(next) === stableJson(cur)) return true;
			if (!_fsWrite(path, Object.assign({ v: 1 }, next))) return false;
			_castDefaultsMemo = { pk: state.currentProjectKey, data: next };
			return true;
		} catch (_) { return false; }
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
		// 화자 칩 필터·배치 결과·트랙 수는 시퀀스마다 새로 (다른 시퀀스에서 고른 화자로 줄이 숨지 않게,
		// 화자 표의 '새로 만듦' 미리보기가 다른 시퀀스의 트랙 수로 계산되지 않게)
		_speakerFilter.clear();
		_miRowStatus = {};
		_miNumTracks = null;
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
		// 화자 표의 기본 프리셋도 같다 (S2-3): 없는 프리셋이면 비운다
		const cast = (state.mi && state.mi.cast) || {};
		Object.keys(cast).forEach((K) => {
			const c = cast[K];
			if (c && c.presetId && !state.presets[c.presetId]) {
				_notePresetRef(presetNum(c.presetId));
				c.presetId = "";
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
	// 새 id가 피해야 할 참조: 행·자막 휴지통·화자 표·프로젝트 cast_defaults가 가리키는 id + 메모리 밖에서 본 가장 큰 번호
	function _presetRefs() {
		_scanDiskPresetRefs();
		const refs = [];
		Object.values(state.rowStates || {}).forEach((rs) => { if (rs && rs.presetId) refs.push(rs.presetId); });
		(state.trashBin || []).forEach((t) => { if (t && t.state && t.state.presetId) refs.push(t.state.presetId); });
		const cast = (state.mi && state.mi.cast) || {};
		Object.keys(cast).forEach((k) => { if (cast[k] && cast[k].presetId) refs.push(cast[k].presetId); });
		const dflt = _loadCastDefaults();
		Object.keys(dflt).forEach((k) => { if (dflt[k] && dflt[k].presetId) refs.push(dflt[k].presetId); });
		const outside = _presetRefEntry().max;
		if (outside > 0) refs.push("preset_" + outside);
		return refs;
	}
	// 새 프리셋 id (단조 증가, 빈 번호를 다시 쓰지 않는다). state.nextPresetId를 함께 올린다.
	// 참조: 살아 있는 프리셋, 프리셋 휴지통, 행과 자막 휴지통·화자 표(mi.cast)·cast_defaults가 가리키는 id, 메모리 밖 참조(_presetRefs).
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

	// fn(호스트 호출)을 부르고, 그 사이 활성 시퀀스가 바뀌었으면 되돌린다. fn이 던지면 되돌린 뒤 다시 던진다.
	async function _keepActiveSequence(fn) {
		let before = null;
		try { before = await host.getActiveSequenceInfo(); } catch (_) {}
		try {
			return await fn();
		} finally {
			await _restoreActiveSequence(before);
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

	// ── v28 호스트 호출 (hostscript.jsx MI_ 구역, S2-1) ──
	// 이름은 MI_PREFIX + name (DEV 설치는 접두사 뒤에 D가 붙는다). payload에 build(MI_BUILD_PANEL)와 seqId(없으면 지금 작업 시퀀스)를
	// 붙여 JSON 하나로 보낸다. 호스트는 빌드·활성 시퀀스가 다르면 아무것도 하지 않고 build-mismatch·seq-mismatch로 답한다.
	// 호스트 JSON.parse는 eval 폴리필이라 문자열 속 날 U+2028/2029는 문법 오류다 (S0-3 h). Chromium 99의
	// JSON.stringify는 둘을 이스케이프하지 않으므로 JSON 텍스트에서 \u2028·\u2029 이스케이프로 바꾼 뒤 보낸다.
	// 응답은 늘 JSON 객체다 ({ok:false, error, detail}도 그대로 돌려준다 — 호출부가 .ok를 본다).
	// 전송 실패(빈 응답·EvalScript error.)와 JSON이 아닌 응답은 던진다.
	const MI_SEP_RE = /[\u2028\u2029]/g;
	function _miJsonText(obj) {
		return JSON.stringify(obj).replace(MI_SEP_RE, (c) => "\\u" + c.charCodeAt(0).toString(16));
	}
	async function _callMi(name, payload) {
		const fn = MI_PREFIX + name;
		let script = fn + "()";
		if (payload !== undefined) {
			const body = Object.assign({}, payload);
			body.build = MI_BUILD_PANEL;
			if (body.seqId === undefined || body.seqId === null) body.seqId = state.currentSequenceId || "";
			let json;
			try {
				json = _miJsonText(body);
			} catch (e) {
				throw _hostError(fn, "페이로드 직렬화 실패: " + ((e && e.message) || e));
			}
			script = `${fn}(decodeURIComponent("${encodeURIComponent(json)}"))`;
		}
		const res = await _invoke(fn, script);
		let out;
		try {
			out = JSON.parse(res);
		} catch (e) {
			throw _hostError(fn, "JSON 파싱 실패: " + ((e && e.message) || e), res);
		}
		if (!out || typeof out !== "object" || Array.isArray(out)) throw _hostError(fn, "응답이 객체가 아니다", res);
		return out;
	}

	// 네이티브 그래픽 클립 지우기 (S1-11, host.removeNativeClipsAt). v27 호스트 함수를 바꾸지 않으려고 ExtendScript 식으로 보낸다.
	// function(t, s, id): 활성 시퀀스 비디오 트랙 t에서 시작이 s[k]와 반 프레임 안이고, MGT 컴포넌트가 없고 Text 컴포넌트가 있는
	// 클립(Premiere 네이티브 그래픽)만 지운다. AE MOGRT·영상 클립은 건드리지 않는다 → "SUCCESS: 지운 수" | "ERROR: no-seq|seq-changed"
	//   id: 패널의 작업 시퀀스 식별자(sequenceID, 없으면 이름 = state.currentSequenceId). 활성 시퀀스가 다르면 지우지 않는다
	//   (적용 중에 사용자가 시퀀스를 바꿨다). 트랙 t가 없으면 지울 것이 없다 → "SUCCESS: 0" (v27은 그 번호로도 놓는다: §0.4 #14)
	// ES3·ASCII만 쓴다 (evalScript 인코딩. id는 decodeURIComponent로 넘긴다)
	const JSX_REMOVE_NATIVE = "function(t,s,id){var seq=app.project.activeSequence;if(!seq)return 'ERROR: no-seq';" +
		"if(id){var sid='';try{sid=String(seq.sequenceID||'')||String(seq.name||'');}catch(e){}if(sid&&sid!==id)return 'ERROR: seq-changed';}" +
		"var tr=null;try{tr=seq.videoTracks[t];}catch(e){}if(!tr)return 'SUCCESS: 0';" +
		"var fd=0;try{fd=seq.getSettings().videoFrameRate.seconds;}catch(e){}var tol=(fd>0?fd/2:0.02)+0.001;var n=0;" +
		"for(var i=tr.clips.numItems-1;i>=0;i--){var c=null;try{c=tr.clips[i];}catch(e){}if(!c)continue;" +
		"var st=0;try{st=c.start.seconds;}catch(e){continue;}var hit=false;" +
		"for(var k=0;k<s.length;k++){if(Math.abs(st-s[k])<tol){hit=true;break;}}if(!hit)continue;" +
		"var mg=null;try{mg=c.getMGTComponent();}catch(e){}if(mg)continue;" +
		"var txt=false;try{for(var ci=0;ci<c.components.numItems;ci++){if(String(c.components[ci].matchName).indexOf('Text')!==-1){txt=true;break;}}}catch(e){}" +
		"if(!txt)continue;try{c.remove(false,false);n++;}catch(e){}}return 'SUCCESS: '+n;}";

	var host = {
		// ── JSON 반환. 실패 시 throw, 성공 시 파싱된 값 ──
		getMogrtFolderTree: () => _callJson("getMogrtFolderTree", _callNoArgs("getMogrtFolderTree")),
		getMogrtScanDirs: () => _callJson("getMogrtScanDirs", _callNoArgs("getMogrtScanDirs")),
		getActiveSequenceInfo: () => _callJson("getActiveSequenceInfo", _callNoArgs("getActiveSequenceInfo")),
		// 프리뷰 시퀀스/클립이 아직 없을 때 ERROR를 돌려주는 것이 정상이다 → quiet
		getPreviewClipParams: () => _callJson("getPreviewClipParams", _callNoArgs("getPreviewClipParams"), true),
		getSystemFonts: () => _callJson("getSystemFonts", _callNoArgs("getSystemFonts")),
		getMogrtParams: (mogrtPath) => _keepActiveSequence(() => _callJson("getMogrtParams", _callWithArgs("getMogrtParams", mogrtPath))),
		scanMogrtFolder: (folderPath) => _callJson("scanMogrtFolder", _callWithArgs("scanMogrtFolder", folderPath)),
		syncAllClipsFromTimeline: (trackIndex) => _callJson("syncAllClipsFromTimeline", _callWithArgs("syncAllClipsFromTimeline", Number(trackIndex))),

		// ── 문자열 프로토콜 반환. "SUCCESS:..." / "ERROR:..." / "CANCEL" 해석은 호출부 몫 ──
		applyToTimeline: (payload) => _callWithPayload("applyToTimeline", payload),
		updateClipAtTime: (payload) => _callWithPayload("updateClipAtTime", payload),
		// 프리뷰 시퀀스를 쓰는 v27 호스트 함수들은 끝날 때 작업 시퀀스를 제대로 되돌리지 못한다
		// (저장해 둔 activeSequence가 프리뷰를 가리키게 되어 프리뷰에 머물거나 프로젝트의 첫 시퀀스로 간다. 2026-09-25 실측).
		// 호스트는 바꾸지 않고, 부르기 전 시퀀스 ID를 기억했다가 달라졌으면 되돌린다 (_keepActiveSequence).
		setupPreviewSequence: (payload) => _keepActiveSequence(() => _callWithPayload("setupPreviewSequence", payload)),
		applyPreviewParams: (payload) => _keepActiveSequence(() => _callWithPayload("applyPreviewParams", payload)),
		capturePreviewFrame: (payload) => _keepActiveSequence(() => _callWithPayload("capturePreviewFrame", payload)),
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

		// 네이티브 그래픽 클립 지우기 (JSX_REMOVE_NATIVE, S1-11). payload {t: 트랙, s: [시작 초…]} → "SUCCESS: n" | "ERROR: …".
		// payload.seqId(적용을 시작할 때의 작업 시퀀스 식별자, 없으면 지금 state.currentSequenceId)가 활성일 때만 지운다.
		// 맨 앞 주석은 이름과 인자 {t, s}를 적은 표시다 (ExtendScript는 무시한다. 테스트 하네스가 읽는다. 시퀀스 확인 인자는 적지 않는다)
		removeNativeClipsAt: (payload) => {
			const t = Math.max(0, Math.floor(Number(payload && payload.t) || 0));
			const s = ((payload && payload.s) || []).map(Number).filter((x) => isFinite(x));
			const id = payload && payload.seqId != null ? String(payload.seqId) : state.currentSequenceId || "";
			const args = JSON.stringify({ t, s });
			return _invoke("removeNativeClipsAt", "/*host:removeNativeClipsAt " + args + "*/(" + JSX_REMOVE_NATIVE + ")(" + t + "," + JSON.stringify(s) + "," + _encodeArg(id) + ")");
		},
		// 트랙의 클립 목록 (v27 getTimelineClips, 읽기만) → JSON 글자 [{startSec, endSec, name}] | "ERROR: …" (S1-11 연쇄 계획)
		getTimelineClips: (payload) => _callWithPayload("getTimelineClips", payload),

		// ── v28 호스트 (MI_ 구역). 모두 파싱한 객체를 돌려준다. 호출부는 .ok를 확인한다 (_callMi) ──
		mi: {
			// {ok, v, build, prefix, seqId, seqName, isPreview, docId, frameTicks, zeroPoint, endFrame}. 가드 없음
			ping: () => _callMi("ping"),
			// {tracks: [트랙 번호] | null(V1 뺀 전부), fromFrame, toFrame} → {ok, frameTicks, numVideoTracks, tracks: [{i, locked, clips}], ms}
			getTracks: (payload) => _callMi("getTracks", payload),
			// {items: [{track, nodeId}] (40개까지), want: {texts, lay, deco, params}} → {ok, results, ms}
			readTexts: (payload) => _callMi("readClipTexts", payload),
			// ── 쓰기 (S2-2). 배치 전에 트랙을 먼저 만든다 (importMGT는 없는 트랙 번호를 마지막 트랙에 놓는다, spike #14) ──
			// {minCount} → {ok, before, after, added} | add-failed
			ensureTracks: (payload) => _callMi("ensureVideoTracks", payload),
			// {frameTicks, budgetMs, items: [{key, op, g, track, sf, ef, keepTime, own, mogrtPath, durSec, params, name, guard, motion, removeAfter}]}
			// → {ok, done, results: [{key, status, …, before}], damaged, dur, comps, ms}. done < items.length면 예산이 다 됐다
			placeChunk: (payload) => _callMi("placeChunk", payload),
			// {items: [{key, track, nodeId, expectName}]} → {ok, results: [{key, status: removed|notFound|notOurs|locked|failed, before}]}
			removeClips: (payload) => _callMi("removeClips", payload)
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

	// 네이티브 템플릿 텍스트 필드의 기본 문구(원문). 호스트는 네이티브 Source Text를 읽지 못해(한 글자 자리표시)
	// 손대지 않은 후반 작업 필드가 빈 글자로 구워진다 → 프리셋 기본값으로 이 문구를 쓴다.
	// 고르는 규칙은 nativeTextLabels와 같다 (UI 로캘 → en_US → 첫 항목). 줄바꿈은 LF로. 개수가 다르면 null
	function nativeTextDefaults(def, count, locale) {
		const ctrls = def && Array.isArray(def.clientControls) ? def.clientControls.filter((c) => c && Number(c.type) === 6) : [];
		if (!(count > 0) || ctrls.length !== count) return null;
		const loc = String(locale == null ? "" : locale).replace("-", "_");
		return ctrls.map((c) => {
			const v = c.value;
			let str = "";
			if (typeof v === "string") str = v;
			else if (v && Array.isArray(v.strDB)) {
				const db = v.strDB.filter((e) => e && typeof e.str === "string");
				const hit = db.find((e) => loc && e.localeString === loc) || db.find((e) => e.localeString === "en_US") || db[0];
				str = hit ? hit.str : "";
			}
			return str.replace(/\r\n?/g, "\n");
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
	// cast_defaults.json(프로젝트 단위) → {C1: {name, presetId, color, pos}} (형식이 틀린 항목은 뺀다. v 등 C번호가 아닌 키도 뺀다)
	function castDefaultsOf(file) {
		const out = {};
		if (!file || typeof file !== "object" || Array.isArray(file)) return out;
		Object.keys(file).forEach((K) => {
			const d = file[K];
			if (!castKeyNum(K) || !d || typeof d !== "object" || Array.isArray(d)) return;
			out[K] = {
				name: typeof d.name === "string" ? d.name : "",
				presetId: typeof d.presetId === "string" ? d.presetId : "",
				color: typeof d.color === "number" && isFinite(d.color) ? d.color : null,
				pos: d.pos && typeof d.pos === "object" && typeof d.pos.x === "number" && typeof d.pos.y === "number" ? { x: d.pos.x, y: d.pos.y } : null
			};
		});
		return out;
	}
	// 화자 표(cast)의 keys 화자를 기본값에 적는다 → 새 기본값 (입력은 바꾸지 않는다). 이름이 키 그대로면(이름을 정하지 않았다) 이름은 두지 않는다
	function castDefaultsMerge(defaults, cast, keys) {
		const out = JSON.parse(JSON.stringify(defaults || {}));
		(keys || []).forEach((K) => {
			const c = cast && cast[K];
			if (!castKeyNum(K) || !c) return;
			const prev = out[K] || { name: "", presetId: "", color: null, pos: null };
			const nm = String(c.name == null ? "" : c.name).trim();
			out[K] = {
				name: nm && nm !== K ? nm : prev.name,
				presetId: typeof c.presetId === "string" ? c.presetId : prev.presetId,
				color: typeof c.color === "number" ? c.color : prev.color,
				pos: c.pos && typeof c.pos === "object" ? { x: c.pos.x, y: c.pos.y } : null
			};
		});
		return out;
	}
	// 화자 → 비디오 트랙 (계획서 §6.2, spec placement 2). 순수.
	//   castOrder, cast (mi.cast), base = 기본 트랙 (#trackSel, 0부터)
	//   o.spans     {K: [[시작, 끝], …]} 화자 줄의 구간 (프레임이든 초든 한 단위로)
	//   o.scan      호스트 트랙 스캔 (getTracks 결과나 그 tracks 배열). 없으면 트랙의 클립을 모른다 (화자 표 미리보기)
	//   o.salt, o.rowSpk {줄 id: 화자 키}  우리 태그 클립이 어느 화자의 것인가 (그 화자의 트랙 고르기를 막지 않는다)
	//   o.affinity  {K: 트랙} 다른 salt 태그 클립이 문장까지 맞는 트랙 (복제한 시퀀스) — 기억한 트랙이 없는 자동 화자가 먼저 쓴다
	//   o.numTracks 지금 비디오 트랙 수 (없으면 스캔의 numVideoTracks, 그것도 없으면 모른다)
	// 규칙:
	//   고정(cast[K].track) 화자 둘이 한 트랙이면 줄 구간이 겹칠 때 막는다 → blocked
	//   자동 화자는 castOrder 순서로: 첫 자동 화자는 정확히 기본 트랙(다른 화자가 고정했으면 아래로).
	//   그다음은 기억한 autoTrack(다른 화자가 쓰지 않으면), affinity, 그것도 없으면 기본 트랙보다 위에서 아무도 쓰지 않고
	//   잠기지 않았고 남의 클립이 그 화자의 [처음, 끝] 구간과 겹치지 않는 가장 낮은 트랙. 트랙 수 이상이면 새로 만든다.
	// → {tracks: {K: {track, auto, create, locked}}, blocked: [{keys: [K1, K2], track}], minCount: 필요한 트랙 수 (늘릴 필요가 없으면 0)}
	function resolveTracks(castOrder, cast, base, o) {
		const opt = o || {};
		const order = (castOrder || []).filter((K) => cast && cast[K]);
		const spans = opt.spans || {};
		const scanTracks = opt.scan ? (Array.isArray(opt.scan) ? opt.scan : Array.isArray(opt.scan.tracks) ? opt.scan.tracks : []) : null;
		let numTracks = typeof opt.numTracks === "number" ? opt.numTracks : null;
		if (numTracks === null && opt.scan && typeof opt.scan.numVideoTracks === "number") numTracks = opt.scan.numVideoTracks;
		const byTrack = {};
		(scanTracks || []).forEach((t) => { if (t && typeof t.i === "number") byTrack[t.i] = t; });
		const rowSpk = opt.rowSpk || {};
		const salt = String(opt.salt || "");
		const b = typeof base === "number" && base >= 0 ? base : 0;
		const out = { tracks: {}, blocked: [], minCount: 0 };
		const claim = {};
		const put = (K, t, auto) => {
			(claim[t] = claim[t] || []).push(K);
			const tr = byTrack[t];
			out.tracks[K] = { track: t, auto, create: numTracks !== null && t >= numTracks, locked: !!(tr && tr.locked) };
		};
		const sorted = (K) => (spans[K] || []).filter((x) => x && x[1] > x[0]).slice().sort((x, y) => x[0] - y[0]);
		const overlaps = (A, B) => {
			const a = sorted(A);
			const c = sorted(B);
			let i = 0;
			let j = 0;
			while (i < a.length && j < c.length) {
				if (a[i][0] < c[j][1] && c[j][0] < a[i][1]) return true;
				if (a[i][1] <= c[j][1]) i++;
				else j++;
			}
			return false;
		};
		const range = (K) => {
			let lo = Infinity;
			let hi = -Infinity;
			sorted(K).forEach((x) => { if (x[0] < lo) lo = x[0]; if (x[1] > hi) hi = x[1]; });
			return lo < hi ? [lo, hi] : null;
		};
		// 트랙 t의 클립이 화자 K를 막는가 (스캔을 모르면 막지 않는다)
		const blocks = (t, K) => {
			const tr = byTrack[t];
			if (!tr) return false;
			if (tr.locked) return true;
			const r = range(K);
			if (!r) return false;
			return (tr.clips || []).some((c) => {
				if (!c || !(c.sf < r[1] && c.ef > r[0])) return false;
				const tag = parseClipTag(c.name);
				if (tag && salt && tag.salt === salt) return rowSpk[tag.id] !== K;
				return true;
			});
		};
		order.forEach((K) => {
			const t = cast[K].track;
			if (typeof t === "number" && t >= 0) put(K, t, false);
		});
		Object.keys(claim).forEach((t) => {
			const ks = claim[t];
			for (let i = 0; i < ks.length; i++) {
				for (let j = i + 1; j < ks.length; j++) if (overlaps(ks[i], ks[j])) out.blocked.push({ keys: [ks[i], ks[j]], track: Number(t) });
			}
		});
		let first = true;
		order.forEach((K) => {
			if (out.tracks[K]) return;
			let t = null;
			if (first && !claim[b]) t = b;
			first = false;
			if (t === null) {
				const a = cast[K].autoTrack;
				if (typeof a === "number" && a >= 0 && !claim[a]) t = a;
			}
			if (t === null && opt.affinity && typeof opt.affinity[K] === "number" && opt.affinity[K] >= 0 && !claim[opt.affinity[K]]) t = opt.affinity[K];
			if (t === null) {
				for (let i = b + 1; t === null; i++) if (!claim[i] && !blocks(i, K)) t = i;
			}
			put(K, t, true);
		});
		let need = 0;
		Object.keys(out.tracks).forEach((K) => { if (out.tracks[K].track + 1 > need) need = out.tracks[K].track + 1; });
		if (numTracks !== null && need > numTracks) out.minCount = need;
		return out;
	}
	// SRT 열기 경로 (계획서 §3.4)
	//   o.castEnabled  여러 파일 가져오기 플래그
	//   o.files        [{key, ambiguous}] (parseCaptionKey 결과)
	//   o.castEmpty    화자 표가 비었다
	//   o.legacyLive   화자(spk) 없는 살아 있는 줄 수
	//   o.legacyPreset 그중 프리셋이 걸린 줄 수 (후반 작업이 있는 목록)
	// → "legacy"      첫 파일 하나를 v27 교체 본문으로
	//   "choice"      C번호 없는 파일 하나 + 화자 표 없음 + 프리셋이 걸린 기존 목록 → [병합] [교체] [취소].
	//                 S1-9부터 플래그와 무관하다 (운영에서도 묻는다)
	//   "modal"       'SRT 가져오기' 창 (플래그)
	//   "distribute"  C번호 파일 + 화자 없는 기존 줄 (기존 목록을 화자로 나누기, 플래그)
	function srtImportRoute(o) {
		const files = (o && o.files) || [];
		if (!o || !files.length) return "legacy";
		const f0 = files[0] || {};
		const single = files.length === 1 && !f0.key && !f0.ambiguous && !!o.castEmpty;
		if (single && o.legacyPreset > 0) return "choice";
		if (!o.castEnabled || single) return "legacy";
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
		else if (touched) pruneStaleSuggs(sub, rs, preset);
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
	//   ctx   {now, salt: mi.salt가 비었을 때 쓸 값, presets: 살아 있는 프리셋, trackValue: 분배 때 mi.legacyTrack,
	//          castDefaults: 프로젝트 cast_defaults (castDefaultsOf, 없어도 된다)}
	// 화자 만들기: 이름 = 입력 > cast_defaults > 키, 트랙 자동(null), 색 = cast_defaults(겹치지 않으면) > 비어 있는 첫 색, castOrder는 C번호 순.
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
					// 새 화자: 이름 = 입력 > 프로젝트 기본값(cast_defaults) > 키. 프리셋은 고른 값, 고르지 않았으면(undefined) 기본값.
					// 색은 기본값이 다른 화자와 겹치지 않으면 그것, 아니면 비어 있는 첫 색
					const dflt = c.castDefaults && c.castDefaults[K] ? c.castDefaults[K] : null;
					const dColor = dflt && typeof dflt.color === "number" && dflt.color >= 0 && dflt.color < CAST_COLORS &&
						!Object.keys(mi.cast).some((k) => mi.cast[k] && mi.cast[k].color === dflt.color) ? dflt.color : null;
					const pid = presetOk(f.presetId) ? f.presetId : f.presetId === undefined && dflt && presetOk(dflt.presetId) ? dflt.presetId : "";
					cast = { name: nm || (dflt && dflt.name) || K, track: null, autoTrack: null, presetId: pid, color: dColor !== null ? dColor : castColorFree(mi.cast),
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

	// ── 레거시 목록 적용 (바꾸지 않은 v27 호스트, S1-9) ──
	// 화자 표가 없는 목록은 v27 호스트로 적용한다. 병합으로 바뀐 줄(mm)이나 v27 index 쓰기가 위험한 줄
	// (isV27Unsafe)은 ▶에서 '안전하게 적용'을 고를 수 있다: 한 줄씩 updateClipAtTime(mogrtPath "")으로
	// 제자리에서 이름 확인 속성만 쓴다. 새로 놓지도, 밀지도, 옮기지도 않는다 (S2-5부터 v28 호스트).

	// updateClipAtTime은 시작 시각 ±0.5초 안의 첫 클립을 잡는다 (hostscript updateClipAtTime)
	const V27_NEAR_SEC = 0.5;
	// v27 applyToTimeline 결과가 검증된 성공인가: "SUCCESS"로 시작하고 "(실패"가 없다.
	// v27은 실패가 있어도 "SUCCESS: … (실패 n개…)"를 돌려준다
	function v27ResultOk(res) {
		const s = typeof res === "string" ? res : "";
		return s.indexOf("SUCCESS") === 0 && s.indexOf("(실패") === -1;
	}
	// v27 호출(updateClipAtTime·applyToTimeline)이 타임라인을 바꿨을 수 있는가 → 그렇다면 마지막 적용 기록을 superseded로 (S2-5).
	// res: 응답 글자, 또는 호출이 던진 오류(전송 실패). v27 함수는 바이트 그대로라 문구가 고정이다
	//   SUCCESS → 예. 바꾸기 전에 멈추는 실패(페이로드·시퀀스·트랙 확인, 제자리 갱신의 '클립 없음 + mogrtPath 미지정') → 아니오.
	//   그 밖의 ERROR(속성 쓰기·importMGT 실패는 클립을 바꾸거나 insertClip한 뒤일 수 있다) → 예.
	//   전송 실패: 빈 응답(함수 없음·무응답) → 아니오, JSX가 잡지 못한 예외(EvalScript error.)는 중간에 멈췄을 수 있다 → 예
	const V27_NOCHANGE_RE = /^ERROR:\s*(JSON 파싱 실패|활성 시퀀스 없음|트랙 접근 실패|트랙 없음|클립 없음 \+ mogrtPath 미지정)/;
	function v27MayHaveChanged(res) {
		if (res && typeof res === "object") return /ExtendScript/.test(String(res.hostReason || res.message || ""));
		const s = typeof res === "string" ? res : "";
		if (!s) return false;
		return !V27_NOCHANGE_RE.test(s);
	}
	// v27 결과의 실패 개수 ("… (실패 3개: …)" → 3). 없으면 0
	function v27FailCount(res) {
		const m = /\(실패 (\d+)개/.exec(typeof res === "string" ? res : "");
		return m ? parseInt(m[1], 10) : 0;
	}
	// 줄의 클립이 타임라인에 있을 것으로 보는 자리: 마지막 검증 적용(ap) → 병합 전 값(mmPrev) → 지금 시간
	// → {s, e, from: "ap"|"mmPrev"|"sub"}
	function applyLocate(rs, sub) {
		const ok = (x) => !!x && typeof x.s === "number" && typeof x.e === "number";
		if (rs && ok(rs.ap)) return { s: rs.ap.s, e: rs.ap.e, from: "ap" };
		if (rs && ok(rs.mmPrev)) return { s: rs.mmPrev.s, e: rs.mmPrev.e, from: "mmPrev" };
		return { s: sub ? sub.startSec : 0, e: sub ? sub.endSec : 0, from: "sub" };
	}
	// 줄 시간이 클립이 있을 자리(applyLocate)와 다른가 (시작·끝 중 하나라도 MERGE_TIME_EPS 넘게).
	// mm이 "time"이어도 적용한 시간으로 돌아왔으면 false다 (병합은 적용 상태로 돌아와도 mm을 지우지 않는다)
	function rowTimeChanged(rs, sub) {
		if (!sub) return false;
		const at = applyLocate(rs, sub);
		if (at.from === "sub") return false;
		return Math.abs(at.s - sub.startSec) > MERGE_TIME_EPS || Math.abs(at.e - sub.endSec) > MERGE_TIME_EPS;
	}
	// 줄이 보내는 속성 목록 (v27과 같은 규칙: _allParams가 있으면 그것, 없으면 노출 속성)
	function rowSendParams(rs) {
		if (!rs) return [];
		return rs._allParams && rs._allParams.length > 0 ? rs._allParams : rs.params || [];
	}
	// 적용 뒤 기록(ap)을 적을 줄인가: 병합 표시(mm)가 있거나, v27에 위험하거나, 이미 ap가 있다.
	// 그 밖의 줄(병합한 적 없는 v27 목록)은 적지 않는다 → session.json 모양이 v27 그대로.
	// 예외 (S1-11, 일부러): 네이티브 프리셋 줄은 ▶·↑로 놓을 때마다 이 함수와 상관없이 ap(nk 포함)를 적는다 — 단일 화자 목록도.
	// 교체할지(문구·자리가 마지막 적용과 같은지)와 연쇄 자리를 ap로만 알 수 있다. 키를 더할 뿐이라 v27은 읽고 무시한다
	function needsApplyBook(rs, unsafe) {
		return !!rs && (!!rs.mm || !!unsafe || !!rs.ap);
	}
	// 검증된 적용 기록 {s, e, cap, ps, t}: 시간, 캡션 필드 값(없으면 문장), 보낸 속성 목록의 paramSig, 트랙.
	// nk: 네이티브 줄이면 놓은 구운 사본의 키 (S1-11, 문구가 바뀌었는지 보는 값)
	function apRecord(sub, rs, preset, track, nk) {
		const cap = rowCaptionValue(rs, preset);
		const ap = { s: sub.startSec, e: sub.endSec, cap: cap !== null ? cap : sub.text, ps: paramSig(rowSendParams(rs)), t: track };
		if (nk) ap.nk = String(nk);
		return ap;
	}
	// 검증된 적용 뒤: ap를 적고 병합 표시(mm·mmPrev)를 지운다 (제자리)
	function markApplied(rs, sub, preset, track, nk) {
		if (!rs || !sub) return;
		rs.ap = apRecord(sub, rs, preset, track, nk);
		delete rs.mm;
		delete rs.mmPrev;
	}
	// 안전 적용으로 보낼 속성 → {params} | {skip: 까닭}
	//   v27에 위험한 줄(unsafe): 이름으로 쓸 수 있는 속성 전부 (namedParams에서 index가 -1이 된 것만.
	//     이름이 겹치거나 이름으로 쓰지 않는 종류는 index로 가서 옛 구조 클립의 다른 속성에 들어갈 수 있어 뺀다).
	//     캡션 필드가 있는데 이름으로 쓸 수 없으면 건너뛴다 (문장 변경이 빠진다)
	//   그 밖(병합으로 문장이 바뀐 줄): 캡션 속성 하나. 이름이 유일하면 index -1, 겹치면 v27과 같은 index
	//   네이티브 템플릿은 스크립트로 쓴 텍스트가 그려지지 않아(S0-3 §3-1) 제자리에서 갱신하지 않는다.
	//   전에 네이티브로 놓은 줄(ap.nk, S1-11)도: 타임라인의 클립이 네이티브라 AE 속성을 쓸 수 없다 (▶ 전체 적용·↑가 교체한다)
	function legacySafeParams(rs, preset, unsafe) {
		if (!preset) return { skip: "no-preset" };
		const all = rowSendParams(rs);
		if (!all.length) return { skip: "no-params" };
		if (isNativeList(all) || isNativeList(preset.params) || (rs && rs.ap && rs.ap.nk)) return { skip: "native" };
		const named = namedParams(all);
		const fid = captionFid(preset);
		const f = fid ? resolveFid(all, fid, preset.params) : null;
		const pos = f ? all.indexOf(f.param) : -1;
		if (unsafe) {
			if (fid && pos >= 0 && named[pos].index !== -1) return { skip: "caption-name" };
			if (fid && pos < 0) return { skip: "no-caption" };
			const list = named.filter((p) => p && p.index === -1);
			return list.length ? { params: list } : { skip: "no-named" };
		}
		if (pos < 0) return { skip: "no-caption" };
		return { params: [named[pos]] };
	}
	// '근처 줄' 검사의 거리: updateClipAtTime은 프레임에 맞춰 놓인 클립 시작과 비교하므로 줄의 SRT 시간과
	// 최대 반 프레임 다를 수 있다 → 0.5초에 반 프레임 여유(10fps 이상이면 0.05초 안)를 더한다
	const LEGACY_NEAR_SEC = V27_NEAR_SEC + 0.05;
	// 다른 줄의 클립이 있을 수 있는 자리 (안전 적용의 '근처 줄' 검사용).
	// 살아 있는 줄과 휴지통 항목 모두 (목록에서 지워도 타임라인 클립은 남는다), 자리는 ap·mmPrev·지금 시간 전부.
	// 트랙은 ap.t. 없으면 null = 어느 트랙인지 모른다 (v27이 그때의 트랙 선택에 놓았다) → [{id, track, at: [초…]}]
	function legacyNeighbors(subtitles, rowStates, trashBin) {
		const one = (sub, rs) => {
			const at = [];
			[rs && rs.ap, rs && rs.mmPrev].forEach((x) => { if (x && typeof x.s === "number") at.push(x.s); });
			if (typeof sub.startSec === "number") at.push(sub.startSec);
			return { id: sub.id, track: rs && rs.ap && typeof rs.ap.t === "number" ? rs.ap.t : null, at };
		};
		const out = [];
		(subtitles || []).forEach((s) => { if (s && !s.spk) out.push(one(s, rowStates ? rowStates[s.id] : null)); });
		(trashBin || []).forEach((t) => { if (t && t.sub && !t.sub.spk) out.push(one(t.sub, t.state)); });
		return out;
	}
	// 그 트랙에서 다른 줄의 자리가 sec ±LEGACY_NEAR_SEC 안에 있는가 (updateClipAtTime이 트랙 순서로 먼저 그 클립을 잡을 수 있다).
	// 트랙을 모르는 줄(track null)은 어느 트랙에나 있을 수 있다고 본다 (ap.t로만 다른 트랙이라고 뺀다)
	function nearOtherRow(id, track, sec, neighbors) {
		return (neighbors || []).some((o) => o && o.id !== id && (o.track === null || o.track === undefined || o.track === track) &&
			(o.at || []).some((t) => typeof t === "number" && Math.abs(t - sec) < LEGACY_NEAR_SEC));
	}
	// 레거시 안전 적용 계획. rows: [{sub, rs, preset, track}] (목록 순서), neighbors: legacyNeighbors 결과
	// → [{id, op: "update"|"skip", why, startSec, endSec, track, params}]
	//   why: new(아직 타임라인에 없음) · time(시간이 바뀜, 옮기지 못함) · near(0.5초 안에 다른 줄) · legacySafeParams의 까닭
	function legacySafePlan(rows, neighbors) {
		return (rows || []).map((r) => {
			const sub = r.sub;
			const rs = r.rs;
			const out = { id: sub.id, op: "skip", why: "", startSec: sub.startSec, endSec: sub.endSec, track: r.track, params: null };
			if (rs && rs.mm === "new" && !rs.ap) {
				out.why = "new";
				return out;
			}
			if (rowTimeChanged(rs, sub)) {
				out.why = "time";
				return out;
			}
			out.startSec = applyLocate(rs, sub).s;
			const pr = legacySafeParams(rs, r.preset, isV27Unsafe(rs, r.preset));
			if (pr.skip) {
				out.why = pr.skip;
				return out;
			}
			if (nearOtherRow(sub.id, r.track, out.startSec, neighbors)) {
				out.why = "near";
				return out;
			}
			out.op = "update";
			out.params = pr.params;
			return out;
		});
	}

	// ── 구조 맞춤 (T-ID 기준, S1-10) ──
	// 프리셋을 다시 저장하거나(MOGRT를 다시 읽어 구조가 바뀔 수 있다) 옛 구조 줄을 '현재 구조로 맞추기' 할 때
	// 줄의 속성 목록을 프리셋의 지금 구조로 옮긴다. v27은 프리셋에서 통째로 다시 채워 후반 작업을 지웠다.
	// 타임라인은 건드리지 않는다: 맞춘 줄의 클립은 옛 구조일 수 있어 psOld를 남기고 ▶·↑가 이름으로 쓴다 (S1-9).

	// 비교용 속성 종류. 숫자 계열(number·angle·dropdown)은 같은 것으로 본다 (definition 패치가 number를 dropdown으로 바꾼다)
	function _paramKind(p) {
		const t = p && p.type;
		return t === "number" || t === "angle" || t === "dropdown" ? "num" : String(t || "");
	}
	// 텍스트 필드 이름이 모두 네이티브 기본 이름('텍스트 N')인가
	function _genericTextNames(params) {
		const tf = textFields(params);
		return tf.length > 0 && tf.every((t) => /^텍스트 \d+$/.test(t.displayName));
	}
	// 값으로 옮기지 않는 종류 (구조·설명)
	const REBASE_SKIP_TYPES = { group: true, comment: true, textsetting: true };
	// 배치에서 배우는 프리셋 선택 필드 (계획서 §2.3). 프리셋을 다시 저장해도 MOGRT(경로·속성 구조)가 같으면 가져간다
	const PRESET_LEARNED_FIELDS = ["mogrtItemName", "mogrtDurSec", "mogrtLs", "mogrtBaseComps", "mogrtBaseKeyed"];
	// 줄 속성 목록 rowAll → 프리셋의 지금 구조 (순수). → {params: 새 _allParams, orphanFields: [{displayName, value}]}
	//   텍스트 필드: 프리셋의 T-ID마다 줄에서 같은 ID를 찾아(resolveFields: 서수+이름, 이름, 네이티브는 서수;
	//     한쪽이 '텍스트 N'이고 개수가 같으면 서수) 줄의 문장을 옮긴다. 스타일은 프리셋 것이다
	//     (프리셋에서 글꼴을 바꾸면 줄에도 간다). 줄에서 글꼴을 바꿀 수 있던 필드(노출 + 프리셋 exposedFontFields)는
	//     줄의 rawValue를 그대로 쓴다.
	//     캡션 필드(프리셋 'T')에는 opts.caption(지금 캡션 문장)이 있으면 그것을 쓴다 ('T'를 옮겼거나 이름이 바뀌어도).
	//     'T'를 다른 필드로 옮겼으면(opts.oldCaptionFid: 저장 전 프리셋의 캡션 ID) 옛 캡션 필드의 캡션 문장은 그 자리에
	//     남기지 않고 프리셋 값으로 둔다 (v27처럼. 캡션 문장은 'T' 필드에만 들어간다 — 결정 3)
	//   텍스트가 아닌 노출 속성: 줄에서 고칠 수 있었던(opts.rowExposed, 없으면 모두) 같은 종류·같은 이름의 속성 값.
	//     구조가 그대로면 같은 index의 것(이름이 겹쳐도), 아니면 그 이름이 줄에서 하나뿐일 때만 (겹치면 프리셋 값)
	//   노출하지 않은 속성: 프리셋 값 (프리셋에서 바꾼 값이 줄에도 간다)
	//   자리를 찾지 못한 줄 텍스트(비어 있지 않고, opts.oldParams의 같은 자리 기본값과 다른 것) → orphanFields
	function rebaseRowParams(rowAll, preset, opts) {
		const o = opts || {};
		const row = rowAll || [];
		const pp = (preset && preset.params) || [];
		const out = JSON.parse(JSON.stringify(pp));
		const exposed = preset && Array.isArray(preset.exposedIndices) ? preset.exposedIndices : [];
		const fontFields = (preset && preset.exposedFontFields) || {};
		const rowExp = Array.isArray(o.rowExposed) ? o.rowExposed : null;
		const canEdit = (p) => !rowExp || rowExp.some((x) => x && x.index === p.index && x.type === p.type && (x.displayName || "") === (p.displayName || ""));
		const caption = typeof o.caption === "string" ? o.caption : null;
		const capFid = captionFid(preset);
		// 'T'를 옮긴 저장: 줄에서 해석한 저장 전 캡션 필드 (저장 전 프리셋 구조 opts.oldParams로)
		const oldCapFid = typeof o.oldCaptionFid === "string" ? o.oldCaptionFid : null;
		const oldCap = caption !== null && oldCapFid && oldCapFid !== capFid ? resolveFid(row, oldCapFid, Array.isArray(o.oldParams) ? o.oldParams : pp) : null;
		const used = {};
		let res = resolveFields(row, pp);
		const preT = textFields(pp);
		if (Object.keys(res).length < preT.length && (_genericTextNames(row) || _genericTextNames(pp)) && textFields(row).length === preT.length) res = resolveFields(row, null);
		preT.forEach((t) => {
			const target = out[t.pos];
			const r = res[t.fid];
			const rp = r && r.param ? r.param : null;
			const isCap = t.fid === capFid && caption !== null;
			if (!rp && !isCap) return;
			// 옛 캡션 필드가 캡션 문장을 가졌으면 옮긴 것으로 치고 프리셋 값으로 둔다 (문장은 새 'T' 필드로 갔다)
			if (!isCap && oldCap && rp === oldCap.param && String(rp.value == null ? "" : rp.value) === caption) {
				used[row.indexOf(rp)] = true;
				return;
			}
			const text = isCap ? caption : String(rp.value == null ? "" : rp.value);
			if (rp && (!isCap || String(rp.value == null ? "" : rp.value) === caption)) used[row.indexOf(rp)] = true;
			if (rp && canEdit(rp) && Array.isArray(fontFields[t.index]) && fontFields[t.index].length > 0 && typeof rp.rawValue === "string") target.rawValue = rp.rawValue;
			setTextValue(target, text);
		});
		// 캡션 문장을 가진 줄 텍스트(옛 캡션 필드)는 옮긴 것으로 친다
		if (capFid && caption !== null) {
			const k = row.findIndex((p, i) => p && p.type === "text" && !used[i] && String(p.value == null ? "" : p.value) === caption);
			if (k !== -1) used[k] = true;
		}
		const sameLayout = !layoutMismatch(row, pp);
		out.forEach((q) => {
			if (!q || q.type === "text" || REBASE_SKIP_TYPES[q.type] || !q.displayName || exposed.indexOf(q.index) === -1) return;
			const like = (p) => p && p.type !== "text" && _paramKind(p) === _paramKind(q) && (p.displayName || "") === q.displayName;
			let rp = sameLayout ? row.find((p) => like(p) && p.index === q.index) || null : null;
			if (!rp) {
				const cands = row.filter(like);
				rp = cands.length === 1 ? cands[0] : null;
			}
			if (!rp || !canEdit(rp)) return;
			q.value = rp.value;
			if (rp.rawValue !== undefined) q.rawValue = rp.rawValue;
			if (rp.colorHex !== undefined) q.colorHex = rp.colorHex;
			else delete q.colorHex;
		});
		const defaults = Array.isArray(o.oldParams) ? o.oldParams : null;
		const orphanFields = [];
		row.forEach((p, i) => {
			if (!p || p.type !== "text" || used[i]) return;
			const v = String(p.value == null ? "" : p.value);
			if (!v.trim()) return;
			if (defaults && defaults.some((d) => d && d.index === p.index && (d.displayName || "") === (p.displayName || "") && String(d.value == null ? "" : d.value) === v)) return;
			orphanFields.push({ displayName: p.displayName || "", value: v });
		});
		return { params: out, orphanFields };
	}
	// 못 옮긴 텍스트 목록 합치기 (이름·값이 같으면 하나) → {list, added: 새로 더한 수}
	function mergeOrphanFields(a, b) {
		const list = (Array.isArray(a) ? a : []).slice();
		let added = 0;
		(b || []).forEach((x) => {
			if (!x || list.some((y) => y && y.displayName === x.displayName && y.value === x.value)) return;
			list.push({ displayName: x.displayName, value: x.value });
			added++;
		});
		return { list, added };
	}
	// 줄의 속성 구조가 oldSig → newSig로 바뀔 때(구조 맞춤·프리셋에서 다시 채우기) 그 줄의 클립은 옛 구조일 수 있다 → psOld.
	// 이미 있으면 가장 오래된 것을 둔다. 적용 기록(ap)이 있으면 그 서명(ap.ps)을, 없으면 oldSig를 남긴다.
	// ap가 있어도 남긴다: 제자리 갱신(안전하게 적용·↑·v27 ▶가 찾은 클립)은 클립 구조를 바꾸지 않는데
	// markApplied는 ap.ps를 줄의 지금 서명으로 적는다. ap.ps 불일치만 믿으면 맞춘 뒤 한 번 적용하고 나서
	// 위험 표시가 사라져 다음 ▶가 옛 구조 클립에 v27 index로 쓴다 (리뷰 S1-9·S1-10)
	function keepPsOld(rs, oldSig, newSig) {
		if (!rs || rs.psOld || oldSig === newSig) return;
		rs.psOld = rs.ap && rs.ap.ps && rs.ap.ps !== newSig ? rs.ap.ps : oldSig;
	}
	// 줄을 구조 맞춤 결과로 바꾼다 (제자리). exposedIndices로 노출 목록을 다시 고르고(같은 객체), 못 옮긴 텍스트를 더한다.
	// 서명이 바뀌면 psOld를 남긴다 (keepPsOld) → 새로 더한 못 옮긴 텍스트 수
	function applyRebase(rs, preset, result) {
		const oldSig = paramSig(rs._allParams || []);
		const newSig = paramSig(result.params);
		const exposed = preset && Array.isArray(preset.exposedIndices) ? preset.exposedIndices : [];
		rs._allParams = result.params;
		rs.params = result.params.filter((p) => exposed.indexOf(p.index) !== -1);
		keepPsOld(rs, oldSig, newSig);
		const m = mergeOrphanFields(rs.orphanFields, result.orphanFields);
		if (m.list.length) rs.orphanFields = m.list;
		return m.added;
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
	// 줄 uid → 줄 id. 다화자는 "salt-id"(지금 salt만), 단일 화자(salt 없음)는 id 문자열. 형식이 아니면 null
	function uidToId(uid, salt) {
		const s = String(uid == null ? "" : uid).trim();
		const m = /^([a-z0-9]{4})-(\d+)$/.exec(s);
		if (m) return salt && m[1] === salt ? parseInt(m[2], 10) : null;
		return !salt && /^\d+$/.test(s) ? parseInt(s, 10) : null;
	}

	// ── AI 제안 (S3-1·S3-2) ──
	// AI가 캡션이 아닌 텍스트 필드(T-ID)에 값을 제안한다 (사용자 결정 4·10: 켠다, 캡션이 아닌 텍스트 필드 모두).
	// 제안은 rs.sugg[fid]에만 두고 사용자가 [적용]하기 전에는 속성(_allParams·params)에도 타임라인에도 쓰지 않는다.
	// 적용 페이로드는 _allParams·params만 읽으므로 rs.sugg는 어디에도 실리지 않는다.
	//   rs.sugg = {T2: {v, by, ts, cap: 제안 때 캡션 해시, sig: 제안 때 줄 필드 서명, st: "pending", note}}
	// 캡션(해시)이나 필드 구조(서명)가 바뀐 제안은 낡은 것이다: 회색으로 보이고 적용할 수 없으며, 다음 병합이 지운다.
	const SUGG_MAX_LEN = 500;
	// 제안이 기억하는 캡션 해시 (normText의 fnv)
	function suggCapHash(caption) {
		return fnv1a32(normText(caption));
	}
	// 줄의 지금 캡션: 캡션 필드 값, 캡션 필드가 없거나 해석되지 않으면 sub.text
	function suggCaptionOf(sub, rs, preset) {
		const cap = preset ? rowCaptionValue(rs, preset) : null;
		return cap !== null ? cap : String((sub && sub.text) || "");
	}
	// 제안 하나를 확인한다 (순수). inp {sub, rs, preset, fid, value, sig, cap?: 제안이 본 캡션 해시}
	// → {ok, error, detail, warn: [], kind: "point"|"text", segs, missing, dup, max, capHash, field: 필드 이름}
	//   error (받지 않음): too-long · empty · no-preset · native-unverified(순서 미확인 네이티브) · no-fields · fields-changed(서명 다름) ·
	//     caption-field(캡션은 SRT 문장만) · unknown-field · stale(캡션이 바뀜) · missing-segment('$$' 조각이 캡션에 없음) · too-many(최대 N개 초과)
	//   warn (받되 알림): not-in-caption('$$' 없는 문구가 캡션에 없음, 제목 같은 자유 문구) · dup(조각이 캡션에 두 번 → 첫 번째만 칠해짐)
	// '$$'가 있는 값은 포인트 텍스트다: 조각마다 지금 캡션 안에 그대로 있어야 하고, 조각 수는 프리셋 설명(comment)의 '최대 N개'를 넘지 않는다.
	function validateSuggestion(inp) {
		const o = inp || {};
		const rs = o.rs || {};
		const preset = o.preset || null;
		const value = typeof o.value === "string" ? o.value : null;
		const out = { ok: false, error: "", detail: "", warn: [], kind: "text", segs: [], missing: [], dup: [], max: null, capHash: "", field: "" };
		const fail = (error, detail) => Object.assign(out, { ok: false, error, detail: detail || "" });
		if (value === null) return fail("empty", "값은 문자열");
		if (value.length > SUGG_MAX_LEN) return fail("too-long", value.length + "자 (최대 " + SUGG_MAX_LEN + "자)");
		if (!value.trim()) return fail("empty", "빈 값");
		if (!preset) return fail("no-preset", "프리셋이 없는 줄");
		if (!presetSummary(preset).orderVerified) return fail("native-unverified", "네이티브 템플릿: 필드 순서 미확인");
		const all = Array.isArray(rs._allParams) ? rs._allParams : [];
		if (!all.length) return fail("no-fields", "줄의 속성이 아직 없다");
		const sigNow = fieldSignature(all);
		if (String(o.sig == null ? "" : o.sig) !== sigNow) return fail("fields-changed", "지금 서명: " + sigNow);
		const capFid = captionFid(preset);
		if (o.fid === capFid) return fail("caption-field", o.fid + "는 캡션 필드 (SRT 문장만 들어간다)");
		const f = resolveFid(all, o.fid, preset.params);
		if (!f) return fail("unknown-field", String(o.fid) + " 필드가 이 줄에 없다");
		out.field = f.displayName || "";
		const caption = suggCaptionOf(o.sub, rs, preset);
		out.capHash = suggCapHash(caption);
		if (o.cap !== undefined && o.cap !== null && String(o.cap) !== out.capHash) return fail("stale", "캡션이 바뀌었다");
		if (value.indexOf("$$") !== -1) {
			out.kind = "point";
			out.max = ruleMaxFromComments(preset.params);
			const r = pointSegmentsOk(value, caption, out.max);
			out.segs = r.segs;
			out.missing = r.missing;
			out.dup = r.dup;
			if (!r.segs.length) return fail("empty", "'$$' 조각이 없다");
			if (r.missing.length) return fail("missing-segment", quoteIga(r.missing) + " 캡션에 없다");
			if (r.tooMany) return fail("too-many", "조각 " + r.segs.length + "개 (최대 " + out.max + "개)");
			if (r.dup.length) out.warn.push("dup");
		} else {
			const nfc = (s) => (String(s).normalize ? String(s).normalize("NFC") : String(s));
			if (nfc(caption).indexOf(nfc(value)) === -1) out.warn.push("not-in-caption");
		}
		out.ok = true;
		return out;
	}
	// 저장된 제안(rs.sugg의 항목)의 지금 상태 = 제안 때의 서명·캡션 해시로 다시 확인. stale: 캡션·필드 구조가 바뀌어 다시 확인이 필요
	// → validateSuggestion 결과 + stale
	function suggState(sub, rs, preset, fid, entry) {
		const e = entry || {};
		const r = validateSuggestion({ sub, rs, preset, fid, value: e.v, sig: e.sig, cap: e.cap });
		r.stale = r.error === "stale" || r.error === "fields-changed";
		return r;
	}
	// 낡은 제안(캡션·필드 구조가 바뀜)을 줄에서 지운다 (병합이 건드린 줄). 남은 것이 없으면 rs.sugg도 지운다 → 지운 수.
	// 서명·캡션 해시가 없는 항목은 낡았는지 알 수 없어 그대로 둔다
	function pruneStaleSuggs(sub, rs, preset) {
		if (!rs || !rs.sugg || typeof rs.sugg !== "object") return 0;
		let n = 0;
		Object.keys(rs.sugg).forEach((fid) => {
			const e = rs.sugg[fid];
			if (!e || typeof e.sig !== "string" || typeof e.cap !== "string") return;
			if (suggState(sub, rs, preset, fid, e).stale) {
				delete rs.sugg[fid];
				n++;
			}
		});
		if (!Object.keys(rs.sugg).length) delete rs.sugg;
		return n;
	}
	// 인용한 낱말 목록 뒤의 조사 '이'/'가' ("‘하늘’이", "‘날씨’가"): 마지막 낱말의 끝 글자에 받침이 있으면 '이'. 한글이 아니면 '이(가)'
	function quoteIga(words) {
		const list = (words || []).map((w) => String(w == null ? "" : w));
		const last = list.length ? list[list.length - 1] : "";
		const c = last.length ? last.charCodeAt(last.length - 1) : 0;
		const josa = c >= 0xac00 && c <= 0xd7a3 ? ((c - 0xac00) % 28 ? "이" : "가") : "이(가)";
		return list.map((w) => "‘" + w + "’").join(", ") + josa;
	}
	// 제안 하나의 확인 문구 (.sugg-box): "✓ 본문에 있음" / "! 본문에 없는 문구" / 거절 까닭
	function suggCheckText(r) {
		if (!r) return "";
		if (r.stale) return r.error === "fields-changed" ? "필드 구조가 바뀌어 다시 확인이 필요합니다" : "캡션이 바뀌어 다시 확인이 필요합니다";
		if (!r.ok) {
			if (r.error === "missing-segment") return "✕ " + quoteIga(r.missing) + " 문장에 없습니다";
			if (r.error === "too-many") return "✕ 조각 " + r.segs.length + "개 — 최대 " + r.max + "개";
			return "✕ " + (r.detail || r.error);
		}
		if (r.warn.indexOf("not-in-caption") !== -1) return "! 본문에 없는 문구";
		if (r.warn.indexOf("dup") !== -1) return "✓ 본문에 있음 · " + quoteIga(r.dup) + " 두 번 나와 첫 번째만 칠해집니다";
		return "✓ 본문에 있음";
	}

	// ── 네이티브 템플릿 굽기 (S1-11) ──
	// Premiere에서 만든(네이티브) MOGRT는 Source Text.setValue가 어떤 형식이든 빈 글자로 그려진다
	// (26.5.1, docs/spike_s0.md §3-1a). 그래서 .mogrt 사본에 문구를 구워(bake) 그 사본을 importMGT한다.
	//   definition.json: capsuleID를 문구에서 정한 UUID로, capsuleName에 " [MI]",
	//     clientControls의 TextLayer(type 6)를 순서대로 value.strDB[].str = 문구
	//   project*.prgraphic(zip) 안 .prproj(gzip XML)의 Source Text StartKeyframeValue 블롭
	//     (base64: 8바이트 LE 길이 + UTF-16LE JSON의 mTextParam.mStyleSheet.mText)을 문서 순서대로 문구로
	// capsuleID가 같으면 Premiere는 이미 가져온 템플릿을 다시 써서 기본 문구가 나온다 → 문구마다 capsuleID가 다르고
	// 같은 문구면 같다 (nativeBakeKey → uuidFromHash): 같은 문구를 다시 놓으면 프로젝트 항목을 다시 쓴다.
	// 순서: TextLayer 순서 = Source Text 블롭 순서 = 컴포넌트 순서 = 호스트 네이티브 index (2/2 템플릿 확인).
	// 여기는 글자·바이트만 다룬다. zip·gzip·파일은 패널 bakeNativeMogrt(src/mi/apply.ts)가 JSZip·Node로 한다.

	// 구운 사본의 capsuleName 꼬리 (프로젝트 빈에서 구운 항목을 알아보게)
	const NATIVE_BAKE_TAG = " [MI]";
	// 굽기 형식 판 (키에 들어간다. 굽는 방법을 바꾸면 올려서 옛 사본을 다시 쓰지 않게)
	const NATIVE_BAKE_VER = "nb1";
	// 네이티브 텍스트의 줄바꿈은 CR이다 (설치된 네이티브 템플릿의 여러 줄 기본 문구가 모두 \r)
	function nativeBakeText(text) {
		return String(text == null ? "" : text).replace(/\r\n?|\n/g, "\r");
	}
	// 네이티브 목록의 텍스트 값을 index 순으로 (= 컴포넌트 순 = definition TextLayer 순)
	function nativeTexts(params) {
		return (params || []).filter((p) => p && p.type === "text").slice().sort((a, b) => a.index - b.index).map((p) => String(p.value == null ? "" : p.value));
	}
	// 네이티브 줄이 구울 문구 (index 순, 개수는 프리셋의 텍스트 필드 수):
	// 프리셋 값 ← 캡션 필드(textParamIndex)는 caption ← 줄 목록(네이티브일 때)에 있는 필드는 그 값.
	// 줄 목록이 노출 속성만이어도(_allParams가 빈 줄) 빠진 필드는 프리셋 값으로 채운다
	function nativeRowTexts(rowList, presetParams, textParamIndex, caption) {
		const byIndex = {};
		(presetParams || []).forEach((p) => { if (p && p.type === "text") byIndex[p.index] = String(p.value == null ? "" : p.value); });
		if (typeof textParamIndex === "number" && textParamIndex >= 0 && Object.prototype.hasOwnProperty.call(byIndex, textParamIndex)) byIndex[textParamIndex] = String(caption == null ? "" : caption);
		if (isNativeList(rowList)) {
			rowList.forEach((p) => {
				if (p && p.type === "text" && Object.prototype.hasOwnProperty.call(byIndex, p.index)) byIndex[p.index] = String(p.value == null ? "" : p.value);
			});
		}
		return Object.keys(byIndex).map(Number).sort((a, b) => a - b).map((i) => byIndex[i]);
	}
	// 128비트 해시: fnv1a32를 머리 글자만 달리해 네 번 → 32자리 hex
	function hash128(str) {
		const s = String(str == null ? "" : str);
		return ["0|", "1|", "2|", "3|"].map((k) => fnv1a32(k + s)).join("");
	}
	// 굽기 키 (32자리 hex): 굽기 판·원본 경로(구분자 /)·원본 수정 시각(ms)·문구(줄바꿈 CR).
	// 같은 문구 → 같은 키 → 같은 사본 파일·같은 capsuleID. 원본을 다시 저장하면(수정 시각) 키가 바뀐다
	function nativeBakeKey(srcPath, srcMtime, texts) {
		const p = String(srcPath == null ? "" : srcPath).replace(/\\/g, "/");
		const m = Math.round(Number(srcMtime) || 0);
		return hash128(JSON.stringify([NATIVE_BAKE_VER, p, m, (texts || []).map(nativeBakeText)]));
	}
	// hex 해시 → UUID 모양 (8-4-4-4-12 소문자, 버전 4·변형 10 비트). 같은 해시 → 같은 UUID
	function uuidFromHash(hash) {
		let h = String(hash == null ? "" : hash).toLowerCase().replace(/[^0-9a-f]/g, "");
		while (h.length < 32) h += fnv1a32(h);
		const v = "89ab".charAt(parseInt(h.charAt(16), 16) & 3);
		return h.slice(0, 8) + "-" + h.slice(8, 12) + "-4" + h.slice(13, 16) + "-" + v + h.slice(17, 20) + "-" + h.slice(20, 32);
	}
	// 숫자 글자를 그대로 지키는 JSON 읽기·쓰기. definition.json에는 double로 읽으면 값이 바뀌는 int64
	// (ticksperframe 9223372036854775807 등)가 있다. 다시 쓰면 모양이 바뀌는 숫자(String(Number(글자)) !== 글자:
	// 큰 정수, "1.0", "1E5" …)는 표시 문자열로 읽었다가 쓸 때 원래 글자로 돌린다. 문자열 안은 건드리지 않는다
	const JSON_NUM_TAG = "\u0000num:";
	function jsonParseKeepNumbers(text) {
		const s = String(text == null ? "" : text).replace(/^\uFEFF/, "");
		const num = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
		let out = "";
		let last = 0;
		for (let i = 0; i < s.length;) {
			const c = s.charCodeAt(i);
			if (c === 34) {
				for (i++; i < s.length; i++) {
					const d = s.charCodeAt(i);
					if (d === 92) i++;
					else if (d === 34) break;
				}
				i++;
				continue;
			}
			if (c === 45 || (c >= 48 && c <= 57)) {
				num.lastIndex = i;
				const m = num.exec(s);
				if (m) {
					if (String(Number(m[0])) !== m[0]) {
						out += s.slice(last, i) + JSON.stringify(JSON_NUM_TAG + m[0]);
						last = i + m[0].length;
					}
					i += m[0].length;
					continue;
				}
			}
			i++;
		}
		return JSON.parse(out + s.slice(last));
	}
	function jsonStringifyKeepNumbers(value) {
		return JSON.stringify(value).replace(/"\\u0000num:(-?[0-9][0-9.eE+-]*)"/g, "$1");
	}
	// base64 ↔ 바이트 (브라우저·node vm 어디서나 같은 순수 구현)
	const B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
	const B64_INDEX = (() => {
		const t = new Int16Array(128).fill(-1);
		for (let i = 0; i < B64_ALPHABET.length; i++) t[B64_ALPHABET.charCodeAt(i)] = i;
		return t;
	})();
	// base64 → Uint8Array (공백·'=' 무시). 알파벳 밖 글자가 있으면 null
	function b64ToBytes(b64) {
		const s = String(b64 == null ? "" : b64).replace(/[\s=]+/g, "");
		const out = new Uint8Array(Math.floor(s.length * 3 / 4));
		let o = 0;
		let acc = 0;
		let bits = 0;
		for (let i = 0; i < s.length; i++) {
			const c = s.charCodeAt(i);
			const v = c < 128 ? B64_INDEX[c] : -1;
			if (v < 0) return null;
			acc = ((acc & 0xff) << 6) | v;
			bits += 6;
			if (bits >= 8) {
				bits -= 8;
				out[o++] = (acc >> bits) & 0xff;
			}
		}
		return out.subarray(0, o);
	}
	function bytesToB64(bytes) {
		const b = bytes || [];
		const A = B64_ALPHABET;
		const parts = [];
		let i = 0;
		for (; i + 2 < b.length; i += 3) {
			const n = (b[i] << 16) | (b[i + 1] << 8) | b[i + 2];
			parts.push(A.charAt((n >> 18) & 63) + A.charAt((n >> 12) & 63) + A.charAt((n >> 6) & 63) + A.charAt(n & 63));
		}
		if (b.length - i === 1) {
			const n = b[i] << 16;
			parts.push(A.charAt((n >> 18) & 63) + A.charAt((n >> 12) & 63) + "==");
		} else if (b.length - i === 2) {
			const n = (b[i] << 16) | (b[i + 1] << 8);
			parts.push(A.charAt((n >> 18) & 63) + A.charAt((n >> 12) & 63) + A.charAt((n >> 6) & 63) + "=");
		}
		return parts.join("");
	}
	// UTF-16LE ↔ 글자 (서로게이트는 코드 단위 그대로)
	function utf16leEncode(str) {
		const s = String(str == null ? "" : str);
		const out = new Uint8Array(s.length * 2);
		for (let i = 0; i < s.length; i++) {
			const c = s.charCodeAt(i);
			out[2 * i] = c & 0xff;
			out[2 * i + 1] = c >> 8;
		}
		return out;
	}
	function utf16leDecode(bytes, start, end) {
		const parts = [];
		let units = [];
		for (let i = start; i + 1 < end; i += 2) {
			units.push(bytes[i] | (bytes[i + 1] << 8));
			if (units.length === 4096) {
				parts.push(String.fromCharCode.apply(null, units));
				units = [];
			}
		}
		if (units.length) parts.push(String.fromCharCode.apply(null, units));
		return parts.join("");
	}
	// Source Text 블롭 (StartKeyframeValue base64) = [8바이트 LE 길이 n][UTF-16LE JSON n바이트][꼬리]
	// → {json, text: mText, bytes, n} | null. null = 텍스트 블롭이 아니다: 길이가 맞지 않거나, JSON이 아니거나,
	// mTextParam.mStyleSheet.mText가 없다 (다른 속성의 블롭, 새 Premiere가 저장한 템플릿(apiVersion 2.x)의 이진 형식)
	function readSourceTextBlob(b64) {
		const b = b64ToBytes(b64);
		if (!b || b.length < 10) return null;
		const lo = (b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24)) >>> 0;
		const hi = (b[4] | (b[5] << 8) | (b[6] << 16) | (b[7] << 24)) >>> 0;
		if (hi !== 0 || lo < 2 || lo % 2 !== 0 || 8 + lo > b.length) return null;
		if (b[8] !== 0x7b || b[9] !== 0) return null; // '{' (UTF-16LE)
		let json;
		try {
			json = jsonParseKeepNumbers(utf16leDecode(b, 8, 8 + lo));
		} catch (_) {
			return null;
		}
		const ss = json && json.mTextParam && json.mTextParam.mStyleSheet;
		if (!ss || typeof ss !== "object" || typeof ss.mText !== "string") return null;
		return { json, text: ss.mText, bytes: b, n: lo };
	}
	// 블롭의 mTextParam.mStyleSheet.mText를 text(줄바꿈 CR)로 바꾼 base64. 텍스트 블롭이 아니면 null.
	// 길이 머리를 새 JSON 바이트 수로 고치고, 나머지 JSON 값·꼬리 바이트는 그대로 둔다
	function patchSourceTextBlob(b64, text) {
		const r = readSourceTextBlob(b64);
		if (!r) return null;
		r.json.mTextParam.mStyleSheet.mText = nativeBakeText(text);
		const body = utf16leEncode(jsonStringifyKeepNumbers(r.json));
		const tail = r.bytes.subarray(8 + r.n);
		const n = body.length;
		const out = new Uint8Array(8 + n + tail.length);
		out[0] = n & 0xff;
		out[1] = (n >>> 8) & 0xff;
		out[2] = (n >>> 16) & 0xff;
		out[3] = (n >>> 24) & 0xff;
		out.set(body, 8);
		out.set(tail, 8 + n);
		return bytesToB64(out);
	}
	// 바꾼 블롭의 새 BinaryHash. 모양(8-4-4-4-12 hex, 끝 8자리 = 바이트 길이 + 일정한 차이)을 따르고 앞 24자리는
	// 새 내용의 해시다 (같은 내용 → 같은 값). 원래 값이 그 모양이 아니면 원래 값을 그대로 둔다
	function nativeBinaryHash(oldHash, oldLen, newB64, newLen) {
		const m = /^([0-9a-fA-F]{8})-([0-9a-fA-F]{4})-([0-9a-fA-F]{4})-([0-9a-fA-F]{4})-([0-9a-fA-F]{4})([0-9a-fA-F]{8})$/.exec(String(oldHash == null ? "" : oldHash));
		if (!m) return oldHash;
		const delta = parseInt(m[6], 16) - oldLen;
		const size = (delta >= 0 && delta < 0x10000 ? newLen + delta : newLen) >>> 0;
		const h = hash128(newB64);
		return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20, 24) + ("0000000" + size.toString(16)).slice(-8);
	}
	// prproj XML(압축 푼 글자)의 Source Text 블롭을 문서 순서대로 texts로 바꾼다. 지역화 파일(project_ko_KR.prgraphic 등)은
	// 속성 이름이 '소스 텍스트'처럼 번역되어 있어 이름이 아니라 블롭 내용(mTextParam)으로 알아본다. texts보다 많은 블롭은 그대로.
	// Premiere는 같은 내용의 블롭을 한 번만 적고 뒤에서는 빈 요소 <StartKeyframeValue … BinaryHash="h"/>로 가리킨다:
	//   바꾼 블롭에는 새 BinaryHash를 주고, 텍스트 블롭을 가리키던 빈 요소는 제 내용을 채운 요소로 바꾼다
	//   (가리키던 블롭의 해시가 바뀌어도 끊기지 않고, 같은 기본 문구를 가리키던 두 필드가 각자 제 문구를 받는다)
	// → {xml, count: 텍스트 블롭 수, patched: 바꾼 수}
	function patchPrprojTexts(xml, texts) {
		const src = String(xml == null ? "" : xml);
		const list = texts || [];
		const re = /<StartKeyframeValue\b([^>]*?)(?:\/>|>([^<]*)<\/StartKeyframeValue>)/g;
		const hashOf = (attrs) => {
			const m = /\bBinaryHash="([^"]*)"/.exec(attrs);
			return m ? m[1] : "";
		};
		const isB64 = (attrs) => /\bEncoding="base64"/.test(attrs);
		const full = {};
		let m;
		while ((m = re.exec(src))) {
			if (m[2] === undefined || !isB64(m[1])) continue;
			const h = hashOf(m[1]);
			if (h && !Object.prototype.hasOwnProperty.call(full, h)) full[h] = m[2];
		}
		let count = 0;
		let patched = 0;
		const out = src.replace(re, (all, attrs, body) => {
			if (!isB64(attrs)) return all;
			const ref = body === undefined;
			const oldHash = hashOf(attrs);
			const data = ref ? (oldHash && Object.prototype.hasOwnProperty.call(full, oldHash) ? full[oldHash] : null) : body;
			if (data === null) return all;
			const info = readSourceTextBlob(data);
			if (!info) return all;
			const k = count++;
			if (k >= list.length) return ref ? "<StartKeyframeValue" + attrs + ">" + data + "</StartKeyframeValue>" : all;
			const nb = patchSourceTextBlob(data, list[k]);
			const newAttrs = oldHash ? attrs.replace(/\bBinaryHash="[^"]*"/, "BinaryHash=\"" + nativeBinaryHash(oldHash, info.bytes.length, nb, b64ToBytes(nb).length) + "\"") : attrs;
			patched++;
			return "<StartKeyframeValue" + newAttrs + ">" + nb + "</StartKeyframeValue>";
		});
		return { xml: out, count, patched };
	}
	// definition.json 글자 → 구운 사본의 글자.
	//   capsuleID = capsuleId. capsuleName과 capsuleNameLocalized.strDB[].str 끝에 " [MI]" (이미 있으면 그대로)
	//   clientControls의 TextLayer(type 6)를 순서대로 texts[k]로: value.strDB[]의 모든 로캘 str (value가 글자면 그 글자).
	//   texts보다 많은 TextLayer는 그대로. 숫자 글자는 그대로 지킨다 (jsonParseKeepNumbers)
	// → {json, textLayers: TextLayer 수, patched: 바꾼 수, durSec: 템플릿 길이(sourceInfoLocalized duration 중 가장 긴 것, 없으면 0)}
	//   | null (JSON 객체가 아니면)
	function patchNativeDefinition(defJson, texts, capsuleId) {
		let def;
		try {
			def = typeof defJson === "string" ? jsonParseKeepNumbers(defJson) : JSON.parse(JSON.stringify(defJson));
		} catch (_) {
			return null;
		}
		if (!def || typeof def !== "object" || Array.isArray(def)) return null;
		const list = texts || [];
		const tag = (s) => {
			const t = String(s == null ? "" : s);
			return t.slice(-NATIVE_BAKE_TAG.length) === NATIVE_BAKE_TAG ? t : t + NATIVE_BAKE_TAG;
		};
		if (capsuleId) def.capsuleID = String(capsuleId);
		if (typeof def.capsuleName === "string") def.capsuleName = tag(def.capsuleName);
		const loc = def.capsuleNameLocalized;
		if (loc && Array.isArray(loc.strDB)) loc.strDB.forEach((e) => { if (e && typeof e.str === "string") e.str = tag(e.str); });
		let layers = 0;
		let patched = 0;
		(Array.isArray(def.clientControls) ? def.clientControls : []).forEach((c) => {
			if (!c || Number(c.type) !== 6) return;
			const k = layers++;
			if (k >= list.length) return;
			const t = nativeBakeText(list[k]);
			if (typeof c.value === "string") c.value = t;
			else if (c.value && Array.isArray(c.value.strDB)) c.value.strDB.forEach((e) => { if (e && typeof e === "object") e.str = t; });
			else c.value = { strDB: [{ localeString: "en_US", str: t }] };
			patched++;
		});
		return { json: jsonStringifyKeepNumbers(def), textLayers: layers, patched, durSec: mogrtDefDurSec(def) };
	}
	// definition.json(읽은 객체, jsonParseKeepNumbers의 표시 문자열 허용) → 템플릿 길이(초):
	// sourceInfoLocalized의 로캘별 duration(value/scale) 중 가장 긴 것, 없으면 0. AE·네이티브 템플릿 모두 이 자리에 있다
	function mogrtDefDurSec(def) {
		let durSec = 0;
		const info = def && typeof def === "object" ? def.sourceInfoLocalized : null;
		if (info && typeof info === "object") {
			Object.keys(info).forEach((k) => {
				const d = info[k] && info[k].duration;
				const v = d ? Number(String(d.value).replace(JSON_NUM_TAG, "")) / Number(String(d.scale).replace(JSON_NUM_TAG, "")) : 0;
				if (isFinite(v) && v > durSec) durSec = v;
			});
		}
		return durSec;
	}
	// 네이티브 적용 전에 지울 클립 자리 → [{t, s}] (같은 자리는 한 번). rows: [{sub, rs, track, nk}],
	// nk = 네이티브 줄의 굽기 키 (AE 줄은 null. 굽지 못한 네이티브 줄은 넣지 않는다).
	// v27 applyToTimeline은 같은 시작의 기존 클립이 네이티브면(MGT 컴포넌트가 없어 경로를 모른다) '같은 MOGRT'로 보고
	// 속성만 쓴다(빈 목록 → 아무것도 안 함) → 지우지 않으면 옛 문구가 남는다. 호스트는 네이티브 그래픽 클립만 지운다.
	//   네이티브 줄: 마지막 검증 적용(ap)과 문구(nk)·트랙·시작이 모두 같으면 지우지 않는다 (v27이 끝만 맞춘다).
	//     시작은 NATIVE_SAME_SEC(0.5ms) 안이어야 같다: v27은 Math.round(시작×100) 키로 기존 클립을 찾으므로 조금만 달라도
	//     새 클립을 옛 클립 위에 덮어 놓는다
	//     아니면 지금 자리(track, 시작)와, ap 자리가 다르면 그 자리도 (옛 클립이 남지 않게)
	//   AE 줄인데 ap.nk가 있다(전에 네이티브로 놓았다): ap 자리와 지금 자리 (v27이 네이티브 클립에 AE 속성을 쓰지 않게)
	// (교체 규칙의 기준. 패널 ▶·↑는 이 규칙에 연쇄를 더한 nativeApplyPlan을 쓴다)
	// 네이티브 클립이 '같은 자리'인 시작 차이 (초)
	const NATIVE_SAME_SEC = 0.0005;
	function nativeReplaceSpots(rows) {
		const out = [];
		const seen = {};
		const add = (t, s) => {
			if (typeof t !== "number" || !isFinite(t) || typeof s !== "number" || !isFinite(s)) return;
			const k = t + "@" + Math.round(s * 1000);
			if (seen[k]) return;
			seen[k] = true;
			out.push({ t, s });
		};
		(rows || []).forEach((r) => {
			if (!r || !r.sub) return;
			const ap = r.rs && r.rs.ap && typeof r.rs.ap.s === "number" ? r.rs.ap : null;
			const apT = ap && typeof ap.t === "number" ? ap.t : r.track;
			const moved = !!ap && (apT !== r.track || Math.abs(ap.s - r.sub.startSec) > NATIVE_SAME_SEC);
			if (r.nk) {
				if (ap && ap.nk === r.nk && !moved) return;
				add(r.track, r.sub.startSec);
				if (moved) add(apT, ap.s);
			} else if (ap && ap.nk) {
				add(apT, ap.s);
				add(r.track, r.sub.startSec);
			}
		});
		return out;
	}
	// 네이티브 템플릿이 처음 놓이는 길이(초)의 기본값 (definition 길이를 모를 때. 설치된 템플릿은 5.005~5.09초)과 창 여유
	const NATIVE_PLACE_SEC = 5.1;
	const NATIVE_PLACE_MARGIN = 0.5;
	// ap가 없는 줄의 클립을 트랙의 클립 시작(clipStarts)에서 찾는 허용 차이 (초). 프레임 스냅(§0.4 #11)보다 넉넉하고 줄 간격보다 작다
	const NATIVE_CLIP_MATCH_SEC = 0.05;
	// 네이티브 적용 계획 (▶·↑): nativeReplaceSpots의 교체 규칙에 연쇄를 더한다.
	// v27은 새 클립을 템플릿 길이(약 5초)로 먼저 놓고 나서 끝을 줄인다 → 그 창 안에 이미 있던 뒤 클립은 머리가 잘리거나
	// 통째로 지워진다 (§0.4 importMGT 기본 길이, S0-3 q). 그래서 새로 놓는 줄의 창 [시작, 시작 + 길이 + 여유) 안에서 시작하는
	// 네이티브 클립의 줄은 함께 지우고 다시 놓는다 (연쇄. 시작 순서로 놓으면 놓자마자 끝을 줄여 다음 클립을 건드리지 않는다).
	// 새로 놓는 줄: 바뀐(또는 처음 놓는) 네이티브 대상 줄과, 전에 네이티브로 놓았던 AE 대상 줄(ap.nk: 그 네이티브 클립을 지우면
	// v27이 AE 템플릿을 새로 놓는다 → 그 줄도 창을 차지한다)
	// rows: 목록 전체 [{sub, rs, target, native, nk, durSec}] (목록 순서)
	//   target  이번에 적용하는 줄 (▶ 대상, ↑ 한 줄)
	//   native  네이티브 프리셋 줄
	//   nk      놓을 구운 사본 키. target 줄은 이번 굽기 결과(굽지 못했으면 null), target이 아닌 줄은 ap.nk(그 사본 파일이 있을 때, 없으면 null)
	//   durSec  템플릿 길이 (모르면 0 → NATIVE_PLACE_SEC. AE 줄은 그 AE 템플릿 길이)
	// clipStarts: 적용 전에 읽은 지금 트랙(track)의 클립 시작 초 [초] (선택)
	// 클립 자리: 검증된 적용 기록(ap)이 있으면 그 자리. ap가 없는 줄은 clipStarts에 그 줄 시작(NATIVE_CLIP_MATCH_SEC 안)의 클립이
	// 있으면 {track, 그 시작} (v27이 Math.round(시작×100)으로 찾는 자리. v27이 놓은 AE 줄 대부분), 없거나 clipStarts를 모르면
	// 자리를 몰라 연쇄·위험에서 뺀다 (아직 놓지 않은 줄은 v27이 시작 순서로 새로 놓는다).
	// → {spots: [{t, s}] 먼저 지울 자리, place: {id: 놓을 시작 초} 새로 놓는 줄(네이티브 줄, 전에 네이티브로 놓았던 AE 대상 줄),
	//    extra: [id] target이 아닌데 연쇄로 다시 놓는 줄 (마지막 검증 적용 그대로: ap.nk 사본을 ap.s~ap.e에),
	//    risk: [id] 창 안에 클립이 있는데 다시 놓을 수 없는 줄 (AE 줄, 굽지 못했거나 사본이 없는 줄, 다른 트랙: 앞부분이 잘리거나
	//    통째로 지워질 수 있다. v27은 적용 전에 모은 옛 클립 참조에 써서 성공으로 센다 → 호출부는 이 줄을 검증된 적용으로 적지 않는다)}
	function nativeApplyPlan(rows, track, clipStarts) {
		const list = (rows || []).filter((r) => r && r.sub);
		const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
		const apOf = (r) => (r.rs && r.rs.ap && typeof r.rs.ap.s === "number" ? r.rs.ap : null);
		const apTrack = (ap) => (typeof ap.t === "number" ? ap.t : track);
		const starts = Array.isArray(clipStarts) ? clipStarts.filter((x) => typeof x === "number" && isFinite(x)) : null;
		const clipAt = (r) => {
			const ap = apOf(r);
			if (ap) return { t: apTrack(ap), s: ap.s };
			if (!starts) return null;
			let best = null;
			starts.forEach((x) => {
				const d = Math.abs(x - r.sub.startSec);
				if (d <= NATIVE_CLIP_MATCH_SEC && (best === null || d < Math.abs(best - r.sub.startSec))) best = x;
			});
			return best === null ? null : { t: track, s: best };
		};
		const place = {};
		const extra = [];
		const risk = {};
		const queue = [];
		const put = (r, s) => {
			place[r.sub.id] = s;
			queue.push(r);
		};
		list.forEach((r) => {
			if (!r.target) return;
			const ap = apOf(r);
			if (!r.native) {
				if (ap && ap.nk) put(r, r.sub.startSec);
				return;
			}
			if (typeof r.nk !== "string") return;
			if (ap && ap.nk === r.nk && apTrack(ap) === track && Math.abs(ap.s - r.sub.startSec) <= NATIVE_SAME_SEC) return;
			put(r, r.sub.startSec);
		});
		while (queue.length) {
			const r = queue.shift();
			const s0 = place[r.sub.id];
			const s1 = s0 + Math.max(NATIVE_PLACE_SEC, Number(r.durSec) || 0) + NATIVE_PLACE_MARGIN;
			list.forEach((q) => {
				if (q === r || has(place, q.sub.id) || risk[q.sub.id]) return;
				const c = clipAt(q);
				if (!c || c.t !== track || !(c.s > s0 + 1e-6 && c.s < s1)) return;
				const ap = apOf(q);
				if (q.native && typeof q.nk === "string" && ap && apTrack(ap) === track) {
					put(q, q.target ? q.sub.startSec : ap.s);
					if (!q.target) extra.push(q.sub.id);
				} else risk[q.sub.id] = true;
			});
		}
		const spots = [];
		const seen = {};
		const add = (t, s) => {
			if (typeof t !== "number" || !isFinite(t) || typeof s !== "number" || !isFinite(s)) return;
			const k = t + "@" + Math.round(s * 1000);
			if (seen[k]) return;
			seen[k] = true;
			spots.push({ t, s });
		};
		list.forEach((r) => {
			const ap = apOf(r);
			if (!has(place, r.sub.id)) return;
			add(track, place[r.sub.id]);
			if (ap && (apTrack(ap) !== track || Math.abs(ap.s - place[r.sub.id]) > NATIVE_SAME_SEC)) add(apTrack(ap), ap.s);
		});
		return { spots, place, extra, risk: list.filter((r) => risk[r.sub.id]).map((r) => r.sub.id) };
	}

	// ── 타임라인 클립 태그와 스캔 색인 (v28 호스트, S2-1) ──
	// 우리 클립은 이름 끝에 "[MI:<salt>-<id>.<gen>]"을 단다 (예: "철수 [MI:k7q2-57.1]"). 호스트도 같은 정규식을 쓴다.
	// uid = salt + "-" + id. 가장 높은 gen이 지금 클립이고 낮은 gen은 정리 대상이다.
	// 자르기(razor)는 두 조각에 같은 이름을 남긴다(spike #1b) → 가장 높은 gen이 둘 이상이면 dup이고 자동으로 풀지 않는다.
	const CLIP_TAG_RE = /\[MI:([a-z0-9]{4})-(\d+)\.(\d+)\]\s*$/;
	// 클립 이름 → {salt, id, g, uid} | null
	function parseClipTag(name) {
		const m = CLIP_TAG_RE.exec(String(name == null ? "" : name));
		if (!m) return null;
		const id = parseInt(m[2], 10);
		return { salt: m[1], id, g: parseInt(m[3], 10), uid: m[1] + "-" + id };
	}
	// 태그 글자 "[MI:salt-id.g]"
	function makeClipTag(salt, id, g) {
		return "[MI:" + salt + "-" + id + "." + g + "]";
	}
	// 호스트 트랙 스캔(호스트 getTracks 결과 또는 그 tracks 배열) → 태그로 나눈 색인. salt는 지금 목록의 salt.
	//   own       {uid: [clip…]}  우리 salt의 클립 전부 (gen 내림차순, 같으면 트랙·시작순)
	//   current   {uid: clip}     가장 높은 gen이 하나뿐인 클립
	//   stale     [clip]          가장 높은 gen보다 낮은 우리 클립 (중단된 적용이 남긴 옛 클립 → 정리)
	//   dup       {uid: [clip…]}  가장 높은 gen이 둘 이상 (자르기) → 건너뛰고 보고한다
	//   foreignMi [clip]          다른 salt 태그 (복제한 시퀀스 등). 그 salt는 받지 않는다 (id가 부딪힌다)
	//   untagged  [clip]          태그 없음 (v27 클립, 사용자 클립)
	//   salts     {salt: 개수}    태그의 salt별 클립 수 (salt 복구 표본)
	// clip = 호스트 클립 {sf, ef, nodeId, name}에 track과 이름에서 읽은 salt·id·g·uid를 붙인 사본.
	// 태그는 호스트가 준 값이 아니라 이름에서 다시 읽는다. salt가 비어 있으면 own은 없다.
	function scanIndex(scan, salt) {
		const tracks = Array.isArray(scan) ? scan : (scan && Array.isArray(scan.tracks) ? scan.tracks : []);
		const out = { own: {}, current: {}, stale: [], dup: {}, foreignMi: [], untagged: [], salts: {} };
		const mine = String(salt || "");
		tracks.forEach((t) => {
			(t && Array.isArray(t.clips) ? t.clips : []).forEach((c) => {
				if (!c) return;
				const clip = { track: t.i, sf: c.sf, ef: c.ef, nodeId: String(c.nodeId == null ? "" : c.nodeId), name: String(c.name == null ? "" : c.name) };
				const tag = parseClipTag(clip.name);
				if (!tag) {
					out.untagged.push(clip);
					return;
				}
				Object.assign(clip, { salt: tag.salt, id: tag.id, g: tag.g, uid: tag.uid });
				out.salts[tag.salt] = (out.salts[tag.salt] || 0) + 1;
				if (!mine || tag.salt !== mine) {
					out.foreignMi.push(clip);
					return;
				}
				(out.own[tag.uid] = out.own[tag.uid] || []).push(clip);
			});
		});
		Object.keys(out.own).forEach((uid) => {
			const list = out.own[uid].sort((a, b) => b.g - a.g || a.track - b.track || a.sf - b.sf);
			const top = list.filter((c) => c.g === list[0].g);
			if (top.length === 1) out.current[uid] = top[0];
			else out.dup[uid] = top;
			list.forEach((c) => { if (c.g < list[0].g) out.stale.push(c); });
		});
		return out;
	}
	// ── 화자별 배치 계획 (계획서 §6, spec placement 7~10, S2-4) ──
	// 패널 _miApply가 호스트 스캔(getTracks)과 되읽기(readClipTexts)를 모아 planPlacement에 넘기고, 나온 작업을 청크로 보낸다.
	// 여기는 계획만 세운다 (호스트·파일·DOM 없음). 같은 입력이면 같은 계획이다 → 중단 뒤 다시 적용해도 이어서 진행된다.

	// 청크 기본 크기 (S0-3 결정 5), 되읽기 한 번 상한 (결정 8), 스캔 창 여유 (결정 12, 초)
	const PLACE_CHUNK = 8;
	const READ_BATCH = 40;
	const SCAN_PAD_SEC = 30;
	// 템플릿 길이를 모를 때 쓰는 길이 (초. 설치된 템플릿은 5.005~5.09초)
	const PLACE_DUR_FALLBACK = 5.1;
	// 이웃이 망가진 줄을 다시 놓는 횟수 (분기 C)
	const DAMAGE_ROUNDS = 2;
	// 경로 비교용 (구분자 /, 대소문자 무시 — Windows)
	function normPath(p) {
		return String(p == null ? "" : p).replace(/\\/g, "/").toLowerCase();
	}
	// 속성 하나의 값 해시 (applied.fh). 이름·종류·값·raw 값·색 hex
	function paramHash(p) {
		const v = (x) => (x === undefined ? null : x);
		return fnv1a32(stableJson({ t: (p && p.type) || "", d: (p && p.displayName) || "", v: v(p && p.value), r: v(p && p.rawValue), c: v(p && p.colorHex) }));
	}
	// 속성 목록 → {index: 값 해시}
	function paramHashes(params) {
		const out = {};
		(params || []).forEach((p) => { if (p && typeof p.index === "number") out[p.index] = paramHash(p); });
		return out;
	}
	// 클립 텍스트 값들의 해시 (applied.rh = 우리가 쓴 직후 되읽은 값). NFC, 줄바꿈 LF. 네이티브 한 글자 이하는 호스트가 이미 ""로 준다
	function textsHash(texts) {
		return fnv1a32(JSON.stringify((texts || []).map((t) => {
			let s = String(t == null ? "" : t);
			if (s.normalize) s = s.normalize("NFC");
			return s.replace(/\r\n?/g, "\n");
		})));
	}
	// 줄이 타임라인에 원하는 모습의 해시 (applied.h): 프리셋·필드 서명·쓴 속성 값·트랙·프레임·템플릿·클립 이름·위치
	function intentHash(o) {
		return fnv1a32(stableJson({ p: o.presetId || "", s: o.sig || "", f: o.fh || {}, t: o.track, sf: o.sf, ef: o.ef, m: normPath(o.m), n: o.name || "", mo: o.motion || null }));
	}
	// 줄 → 프레임 {id: {sf, ef, clamped, zero}}: sf = frameOf(시작), ef = max(sf + 1, frameOf(끝)).
	// 같은 화자 안에서 겹치면 앞 줄의 끝을 뒤 줄 시작에 맞춘다 (시작 순, 같은 시작이면 목록 순). 길이가 0이 되면 zero
	function speakerFrames(rows, frameTicks) {
		const out = {};
		const by = {};
		(rows || []).forEach((r, i) => {
			if (!r) return;
			const sf = frameOf(r.startSec, frameTicks);
			const ef = Math.max(sf + 1, frameOf(r.endSec, frameTicks));
			out[r.id] = { sf, ef, clamped: false, zero: false };
			const K = r.spk || "";
			(by[K] = by[K] || []).push({ id: r.id, sf, i });
		});
		Object.keys(by).forEach((K) => {
			const list = by[K].sort((a, b) => a.sf - b.sf || a.i - b.i);
			for (let k = 0; k + 1 < list.length; k++) {
				const cur = out[list[k].id];
				const nx = list[k + 1].sf;
				if (cur.ef > nx) {
					cur.ef = nx;
					cur.clamped = true;
					if (cur.ef <= cur.sf) cur.zero = true;
				}
			}
		});
		return out;
	}
	// 작업 종류별 단계 (트랙마다 이 순서로): 1 제거 · 2 줄이는 갱신 · 3 이동·교체 · 4 배치 · 5 늘리는 갱신
	const OP_PHASE = { remove: 1, move: 3, moveRegen: 3, legacyMove: 3, replace: 3, place: 4 };
	// 새 클립을 만드는 작업 (결과 nodeId가 다른 작업의 이웃 목록에 들어갈 수 있다)
	function opCreates(op) {
		return !!op && (op.op === "place" || op.op === "replace" || op.op === "moveRegen" || op.op === "legacyMove");
	}
	// 작업이 차지하는 범위 [시작, 끝): 이동은 [sf, ef), 새로 놓기는 템플릿 길이까지 [sf, sf + max(ef − sf, D))
	function _opReach(op) {
		if (op.op === "move") return [op.sf, op.ef];
		return [op.sf, op.sf + Math.max(op.ef - op.sf, op.D || 0)];
	}
	// 3단계(이동·교체) 순서: 작업 X의 범위가 다른 작업 Y가 떠날 자리(Y.src)와 겹치면 X는 Y 뒤에 (같은 트랙).
	// 순환은 하나(시작이 가장 이른 것)를 '먼저 지우고 나중에 놓기'로 끊는다: 그 작업의 옛 클립은 1단계 제거, 새 클립은 4단계 배치.
	// 새 클립은 템플릿 기본값에서 시작하므로 바뀐 속성만 보내는 이동(move)은 alt(다음 gen·속성 전부·새 태그·그 의도 해시)로 바꿔 놓는다
	// → {ordered: [작업] (단계 순, 단계 안은 의존·시작 순), removals: [순환을 끊으며 생긴 제거]}
	function orderOps(ops) {
		const list = (ops || []).filter(Boolean);
		const byPhase = (p) => list.filter((x) => x.phase === p).sort((a, b) => a.sf - b.sf || a.id - b.id);
		const p3 = byPhase(3);
		const extraRemove = [];
		const after = new Map();
		p3.forEach((x) => after.set(x, []));
		p3.forEach((x) => {
			const r = _opReach(x);
			p3.forEach((y) => {
				if (x === y || !y.src || y.src.track !== x.track) return;
				if (r[0] < y.src.ef && y.src.sf < r[1]) after.get(x).push(y);
			});
		});
		const done = new Set();
		const out3 = [];
		const breakers = [];
		while (out3.length + breakers.length < p3.length) {
			const ready = p3.filter((x) => !done.has(x) && after.get(x).every((y) => done.has(y)));
			if (ready.length) {
				const x = ready[0];
				done.add(x);
				out3.push(x);
				continue;
			}
			const x = p3.find((z) => !done.has(z));
			done.add(x);
			x.cycle = true;
			x.phase = 4;
			if (x.src) extraRemove.push({ uid: x.uid, id: x.id, track: x.src.track, nodeId: x.src.nodeId, expectName: x.src.name || null, g: x.src.g, why: "cycle" });
			x.op = "place";
			if (x.alt) Object.assign(x, x.alt);
			x.own = null;
			x.removeAfter = null;
			breakers.push(x);
		}
		const p4 = byPhase(4);
		return { ordered: byPhase(2).concat(out3, p4, byPhase(5)), removals: extraRemove };
	}
	// 청크로 나눈다: size개까지, 그리고 이웃 목록이 같은 청크에서 먼저 만들 클립("new:uid")을 가리키면 그 앞에서 끊는다
	// (새 클립의 nodeId는 그 청크가 돌아와야 안다) → [[작업]]
	function chunkOps(ops, size) {
		const n = size > 0 ? size : PLACE_CHUNK;
		const chunks = [];
		let cur = [];
		let made = {};
		(ops || []).forEach((op) => {
			const dep = (op.guard || []).some((g) => String(g).indexOf("new:") === 0 && made[String(g).slice(4)]);
			if (cur.length && (cur.length >= n || dep)) {
				chunks.push(cur);
				cur = [];
				made = {};
			}
			cur.push(op);
			if (opCreates(op)) made[op.uid] = true;
		});
		if (cur.length) chunks.push(cur);
		return chunks;
	}
	// 계획 작업 → 호스트 placeChunk 항목. created: {uid: 이번 실행에서 만든 클립 nodeId} ("new:uid" 이웃을 푼다, 못 풀면 뺀다)
	function hostItemOf(op, created) {
		const made = created || {};
		const guard = [];
		(op.guard || []).forEach((g) => {
			const s = String(g);
			const id = s.indexOf("new:") === 0 ? made[s.slice(4)] : s;
			if (id && guard.indexOf(id) === -1) guard.push(id);
		});
		const item = { key: op.uid, op: op.op, g: op.g, track: op.track, sf: op.sf, ef: op.ef, keepTime: !!op.keepTime, own: op.own || null,
			mogrtPath: op.m || "", durSec: op.durSec || 0, params: op.params || [], name: op.name === undefined ? null : op.name, guard, motion: null, removeAfter: op.removeAfter || null };
		return item;
	}
	// 결과 → applied 항목 {g, m, ls, h, fh, rh, k, t, sf, ef, cef}. prev = 그 uid의 지난 applied 항목 (없으면 undefined)
	//   t·sf·ef는 줄이 원한 자리(제자리 갱신이어도), cef는 클립의 실제 끝.
	//   효과가 있어 옮기지 않은 제자리 갱신(op.stay)은 클립이 있는 자리를 적는다 → 다음 계획도 시간 변경을 보고 decorated로 둔다
	//   partial(키프레임·옛 버전이라 못 쓴 속성, r.skipped·r.keyed = 이름): 못 쓴 속성의 fh를 빼고 h를 비운다
	//     → 다음 계획이 그 속성을 다시 보내고(그대로로 보지 않는다) 줄의 병합 표시(mm)도 남는다
	//   rh(Premiere에서 고침을 보는 기준)는 텍스트를 쓴 작업(새 클립, 텍스트 속성을 보냄)일 때만 되읽은 값으로 바꾼다.
	//     텍스트를 쓰지 않은 작업(시간만 옮김·끝만·이름만·텍스트 아닌 속성)은 prev.rh를 그대로 둔다 — 고친 문장을 우리 것으로 받아들이지 않게
	function appliedEntryOf(op, r, prev) {
		const partial = !!r && r.status === "partial";
		let fh = op.fhAll || {};
		if (partial) {
			const miss = {};
			(r.skipped || []).concat(r.keyed || []).forEach((n) => { miss[String(n)] = true; });
			fh = Object.assign({}, fh);
			(op.params || []).forEach((p) => { if (p && typeof p.index === "number" && miss[String(p.displayName == null ? "" : p.displayName)]) delete fh[p.index]; });
		}
		const wroteText = opCreates(op) || (op.params || []).some((p) => p && p.type === "text");
		const at = op.intent && !op.stay ? op.intent : { t: op.track, sf: op.sf, ef: op.ef };
		return {
			g: r && typeof r.g === "number" ? r.g : op.g,
			m: op.m || "",
			ls: clipLs(r && r.lay),
			h: partial ? "" : op.h,
			fh,
			rh: !wroteText && prev && typeof prev.rh === "string" ? prev.rh : textsHash((r && r.texts) || []),
			k: (r && r.kind) || op.kind || "",
			t: at.t,
			sf: at.sf,
			ef: at.ef,
			cef: r && typeof r.ef === "number" ? r.ef : op.ef
		};
	}
	// 새로 놓는 자리 확인 (호스트의 자리 확인 occupy와 같은 규칙, 프레임 단위). list = 트랙의 클립 [{id, sf, ef, own}]
	// (own = 우리가 보호하고 되살릴 수 있는 클립: 머리를 되돌리는 이웃), [sf, ef)에 놓고 [sf, sf + max(ef − sf, D))까지 덮인다.
	// skipIds: 치울 클립 {id: true} → {conflict: null, ef(맞춘 끝), clamped, guard: [id]} | {conflict: occupied|occupied-own|tail, clip | null(길이 0)}
	function fitWindow(list, sf, ef, D, skipIds) {
		const hi = sf + Math.max(ef - sf, D || 0);
		let efC = ef;
		let clamped = false;
		const guard = [];
		const L = (list || []).slice().sort((a, b) => a.sf - b.sf);
		for (let i = 0; i < L.length; i++) {
			const c = L[i];
			if (skipIds && skipIds[c.id]) continue;
			if (c.ef <= sf || c.sf >= hi) continue;
			if (c.sf <= sf) {
				if (c.ef > sf) return { conflict: c.own ? "occupied-own" : "occupied", clip: c };
				continue;
			}
			if (c.sf < efC) {
				if (!c.own) return { conflict: "occupied", clip: c };
				efC = c.sf;
				clamped = true;
				guard.push(c.id);
				continue;
			}
			if (!c.own) return { conflict: "tail", clip: c };
			guard.push(c.id);
		}
		if (efC - sf < 1) return { conflict: "occupied", clip: null };
		return { conflict: null, ef: efC, clamped, guard };
	}
	// 작업을 단계 순서로 흉내 낸다 (작업 뒤 범위: planPlacement·buildUndoOps·legacyMiPlan·repairOps 공용, 호스트 placeChunk와 같은 규칙).
	//   st: {트랙: [{id, sf, ef, own, name}]} (바뀐다), ordered: 단계 순 작업, removals: 먼저 지울 [{track, nodeId}]
	//   update·adopt → 끝만 (keepTime이 아니면 다음 클립 시작에서 자른다), move → 시작을 덮는 클립이 있으면 충돌, 안쪽 클립에서 끝을 자른다,
	//   place·replace·moveRegen·legacyMove → fitWindow로 확인하고 옛 클립(own·removeAfter)을 치운 뒤 "new:uid"를 더한다 (op.guard를 정한다)
	// → {ok: [받은 작업], bad: [{op, why: occupied|occupied-own|tail, clip (null = 길이 0), t: 트랙}]}
	function simulateOps(st, ordered, removals) {
		const stOf = (t) => (st[t] = st[t] || []);
		const drop = (t, id) => {
			const L = stOf(t);
			const i = L.findIndex((c) => c.id === id);
			if (i !== -1) L.splice(i, 1);
		};
		(removals || []).forEach((r) => drop(r.track, String(r.nodeId)));
		const nextStart = (t, fromSf, selfId) => {
			let best = null;
			stOf(t).forEach((c) => { if (c.id !== selfId && c.sf > fromSf && (best === null || c.sf < best)) best = c.sf; });
			return best;
		};
		const ok = [];
		const bad = [];
		(ordered || []).forEach((op) => {
			if (op.op === "update" || op.op === "adopt") {
				const item = stOf(op.own.track).find((c) => c.id === String(op.own.nodeId));
				if (item && !op.keepTime) {
					const nx = nextStart(op.own.track, item.sf, item.id);
					item.ef = nx !== null && nx < op.ef ? nx : op.ef;
				}
				ok.push(op);
				return;
			}
			if (op.op === "move") {
				const item = stOf(op.own.track).find((c) => c.id === String(op.own.nodeId));
				let ef = op.ef;
				for (const c of stOf(op.track)) {
					if (c === item || c.ef <= op.sf || c.sf >= ef) continue;
					if (c.sf <= op.sf) {
						if (c.ef > op.sf) {
							bad.push({ op, why: c.own ? "occupied-own" : "occupied", clip: c, t: op.track });
							return;
						}
						continue;
					}
					ef = c.sf;
				}
				if (ef - op.sf < 1) {
					bad.push({ op, why: "occupied", clip: null, t: op.track });
					return;
				}
				if (item) {
					item.sf = op.sf;
					item.ef = ef;
				}
				ok.push(op);
				return;
			}
			// place · replace · moveRegen · legacyMove: 템플릿 길이 창을 확인하고 옛 클립을 치운 뒤 새 클립을 더한다
			const skipIds = {};
			if (op.own && op.own.track === op.track) skipIds[String(op.own.nodeId)] = true;
			if (op.removeAfter && op.removeAfter.track === op.track) skipIds[String(op.removeAfter.nodeId)] = true;
			const w = fitWindow(stOf(op.track), op.sf, op.ef, op.D, skipIds);
			if (w.conflict) {
				bad.push({ op, why: w.conflict, clip: w.clip, t: op.track });
				return;
			}
			op.guard = w.guard;
			if (op.own) drop(op.own.track, String(op.own.nodeId));
			if (op.removeAfter) drop(op.removeAfter.track, String(op.removeAfter.nodeId));
			stOf(op.track).push({ id: "new:" + op.uid, sf: op.sf, ef: w.ef, own: true, name: op.name || "" });
			ok.push(op);
		});
		return { ok, bad };
	}
	// simulateOps 충돌 하나의 설명 ("V3 12.0~14.5 이름", 뒤쪽이면 템플릿 길이, 길이 0)
	function simConflictText(b, frameTicks) {
		if (!b || !b.clip) return "길이 0";
		const ft = Number(frameTicks) || 0;
		const secOf = (f) => (ft > 0 ? (f * ft) / TICKS_PER_SEC : 0);
		const c = b.clip;
		const txt = "V" + (b.t + 1) + " " + secOf(c.sf).toFixed(1) + "~" + secOf(c.ef).toFixed(1) + (c.name ? " " + c.name : "");
		return b.why === "tail" ? txt + " (템플릿 길이 " + secOf((b.op && b.op.D) || 0).toFixed(1) + "초 안)" : txt;
	}
	// 효과·키프레임이 있는 클립인가 (되읽은 deco: 컴포넌트가 프리셋이 배운 기본 수보다 많거나, Motion·Opacity에 키).
	// 템플릿 자체에 있는 키(네이티브 템플릿의 Opacity 페이드 등, 2026-09-25 실측)는 첫 배치에서 배운 mogrtBaseKeyed로 빼고 본다.
	// 네이티브는 기본값을 아직 모르면 키를 효과로 치지 않는다 (새로 놓은 클립도 키가 있을 수 있다)
	function decoratedOf(d, preset) {
		if (!d || !d.deco) return false;
		const base = preset && typeof preset.mogrtBaseComps === "number" ? preset.mogrtBaseComps : null;
		const baseKeyed = preset && Array.isArray(preset.mogrtBaseKeyed) ? preset.mogrtBaseKeyed : null;
		let keyed = Array.isArray(d.deco.keyed) ? d.deco.keyed.filter((k) => !(baseKeyed && baseKeyed.indexOf(k) !== -1)) : [];
		if (baseKeyed === null && d.kind && d.kind !== "ae") keyed = [];
		return (base !== null && d.deco.comps > base) || keyed.length > 0;
	}
	// 배치 계획 (순수). inp:
	//   rows     대상 줄 [{sub, rs, preset, baked: {path, key, durSec} | null, bakeWhy, oldBaked: 전에 네이티브로 놓은 사본 경로 | null}]
	//   allRows  살아 있는 줄 전부 [sub] (같은 화자 겹침 맞춤·화자 구간·목록에 없는 클립)
	//   trash    {줄 id: why} 휴지통 항목 (목록에서 빠진 줄의 클립을 미리 체크할지)
	//   mi       {salt, cast, castOrder, applied, legacyTrack}
	//   base     기본 트랙 (#trackSel)
	//   scan     호스트 getTracks 결과 {frameTicks, numVideoTracks, tracks}
	//   details  {nodeId: readClipTexts 결과 {kind, pin, texts, lay, deco}}
	//   durs     {normPath(템플릿): 길이 초}
	//   opts     {adopt, adoptUncertain, adoptForeign, moveLegacy, orphans: "pre"|"all"|"none", cleanupStale, replaceMissing,
	//             overwriteEdited, restoreMoved, moveDecorated, upgradeOld, single, forceRegen: {줄 id: true}}
	// → 계획 {ops (단계 순), removals, tracks, blocked, minCount, needReads (아직 되읽지 않은 클립 — 읽고 다시 계획), 목록·수}
	function planPlacement(inp) {
		const o = Object.assign({ adopt: true, adoptUncertain: false, adoptForeign: true, moveLegacy: true, orphans: "pre", cleanupStale: true, replaceMissing: true,
			overwriteEdited: false, restoreMoved: false, moveDecorated: false, upgradeOld: false, single: false, forceRegen: {} }, (inp && inp.opts) || {});
		const mi = (inp && inp.mi) || miDefault();
		const salt = String(mi.salt || "");
		const cast = mi.cast || {};
		const applied = mi.applied || {};
		const scan = (inp && inp.scan) || { tracks: [] };
		const ft = Number(scan.frameTicks) || 0;
		const details = (inp && inp.details) || {};
		const durs = (inp && inp.durs) || {};
		const base = typeof inp.base === "number" ? inp.base : 2;
		const legacyTrack = typeof mi.legacyTrack === "number" ? mi.legacyTrack : null;
		const plan = {
			frameTicks: ft, tracks: {}, blocked: [], minCount: 0, ops: [], removals: [], rowOps: {}, needReads: [],
			conflicts: [], edited: [], missing: [], oldVersion: [], decorated: [], unknownTemplate: [], unverifiedTemplate: [],
			dup: [], noPreset: [], noCaption: [], bakeFailed: [], zeroLength: [], locked: [], none: [], userMoved: [], noSpeaker: [],
			adopt: { certain: 0, uncertain: 0 }, foreignAdopt: { certain: 0, uncertain: 0 }, legacyMove: 0, legacyKept: [], legacyDecorated: 0,
			overlaps: 0, staleLayoutRows: 0, oldVersionSkipped: 0, cleanup: [], orphans: [], perSpeaker: {},
			// 우리 클립이 있는 줄의 지금 의도 해시 {줄 id: h} (검수가 applied.h와 비교해 '미적용'을 가른다, S3-3)
			intentOf: {}
		};
		const idx = scanIndex(scan, salt);
		const all = (inp.allRows || (inp.rows || []).map((r) => r.sub)).filter(Boolean);
		const fr = speakerFrames(all, ft);
		const rowSpk = {};
		const spans = {};
		all.forEach((s) => {
			if (!s.spk) return;
			rowSpk[s.id] = s.spk;
			const f = fr[s.id];
			if (f && !f.zero) (spans[s.spk] = spans[s.spk] || []).push([f.sf, f.ef]);
		});
		// 되읽기: 읽은 값 | false (읽었는데 없다: 스캔 뒤 사라짐) | null (아직 안 읽음 → needReads에 넣는다)
		const need = {};
		const detailOf = (c) => {
			const d = details[c.nodeId];
			if (d) return d.found === false ? false : d;
			if (!need[c.nodeId]) {
				need[c.nodeId] = true;
				plan.needReads.push({ track: c.track, nodeId: c.nodeId });
			}
			return null;
		};
		const trackName = (t) => "V" + (t + 1);
		const secOf = (f) => (ft > 0 ? (f * ft) / TICKS_PER_SEC : 0);
		// 줄마다 입력 정리
		const infos = (inp.rows || []).filter((r) => r && r.sub).map((r) => {
			const sub = r.sub;
			const rs = r.rs || {};
			const preset = r.preset || null;
			const f = fr[sub.id] || { sf: frameOf(sub.startSec, ft), ef: Math.max(frameOf(sub.startSec, ft) + 1, frameOf(sub.endSec, ft)), clamped: false, zero: false };
			const loc = applyLocate(rs, sub);
			const cap = preset ? rowCaptionValue(rs, preset) : null;
			const caps = [];
			[cap, sub.text, rs.ap && rs.ap.cap, rs.mmPrev && rs.mmPrev.cap].forEach((t) => {
				const n = normText(t);
				if (n && caps.indexOf(n) === -1) caps.push(n);
			});
			const uid = salt + "-" + sub.id;
			return { r, sub, rs, preset, K: sub.spk || null, uid, sf: f.sf, ef: f.ef, zero: f.zero, clamped: f.clamped,
				native: !!(preset && isNativeList(preset.params)), locF: loc.from === "sub" ? null : frameOf(loc.s, ft),
				caps, cur: idx.current[uid] || null, dup: !!idx.dup[uid], ap: applied[uid] || null };
		});
		const wantKind = (x) => (x.native ? "native" : "ae");
		const textOk = (d, x) => (d.texts || []).some((t) => {
			const n = normText(t);
			return !!n && x.caps.some((c) => n.indexOf(c) !== -1);
		});
		// 인식 후보의 증거 세기 (문장): 3 = 텍스트 값 하나가 줄 문장과 같다, 2 = 줄 문장을 담는다, 0 = 없다.
		// (1은 문장 없이 마지막 적용 자리(ap)만 맞는 네이티브 후보 — 아래 cands)
		const textEv = (d, x) => {
			let ev = 0;
			(d.texts || []).forEach((t) => {
				const n = normText(t);
				if (!n) return;
				if (x.caps.indexOf(n) !== -1) ev = 3;
				else if (ev < 2 && x.caps.some((c) => n.indexOf(c) !== -1)) ev = 2;
			});
			return ev;
		};
		const apAt = (x, c) => !!(x.rs.ap && typeof x.rs.ap.t === "number" && x.rs.ap.t === c.track && typeof x.rs.ap.s === "number" && Math.abs(frameOf(x.rs.ap.s, ft) - c.sf) <= 1);
		const framesOf = (x) => [x.sf].concat(x.locF !== null && x.locF !== x.sf ? [x.locF] : []);
		const nearF = (c, x) => framesOf(x).some((f) => Math.abs(c.sf - f) <= 1);
		// 다른 salt 태그 클립이 문장까지 맞는 트랙 → 기억한 트랙이 없는 자동 화자가 먼저 쓴다 (복제한 시퀀스)
		const affCount = {};
		infos.forEach((x) => {
			if (x.cur || x.dup || !x.K || !x.preset) return;
			idx.foreignMi.forEach((c) => {
				if (!nearF(c, x)) return;
				const d = detailOf(c);
				if (d && d.kind === wantKind(x) && textOk(d, x)) {
					const m = (affCount[x.K] = affCount[x.K] || {});
					m[c.track] = (m[c.track] || 0) + 1;
				}
			});
		});
		const affinity = {};
		Object.keys(affCount).forEach((K) => {
			let best = null;
			Object.keys(affCount[K]).forEach((t) => { if (best === null || affCount[K][t] > affCount[K][best]) best = t; });
			if (best !== null) affinity[K] = Number(best);
		});
		const rt = resolveTracks(mi.castOrder, cast, base, { spans, scan, salt, rowSpk, affinity });
		plan.tracks = rt.tracks;
		plan.blocked = rt.blocked;
		// minCount·tracksToAdd·create는 작업을 다 정한 뒤 (아래): 이번에 쓰는 트랙까지만 만든다
		const blocked = {};
		rt.blocked.forEach((b) => b.keys.forEach((k) => { blocked[k] = b; }));
		const ownIds = {};
		Object.keys(idx.current).forEach((u) => { ownIds[idx.current[u].nodeId] = true; });
		const skip = (x, why, detail) => {
			plan.rowOps[x.sub.id] = { skip: why, detail: detail || "" };
		};
		const conflict = (x, why, detail) => {
			plan.conflicts.push({ id: x.sub.id, uid: x.uid, why, detail: detail || "" });
			plan.rowOps[x.sub.id] = { skip: "conflict", why, detail: detail || "" };
		};
		const clipText = (c) => trackName(c.track) + " " + secOf(c.sf).toFixed(1) + "~" + secOf(c.ef).toFixed(1) + (c.name ? " " + c.name : "");
		const ops = [];
		const claims = []; // 우리 클립이 없는 줄의 인식 후보 {scored, finish} (아래에서 클립마다 한 줄에 나눈다)
		infos.forEach((x) => {
			const sub = x.sub;
			const rs = x.rs;
			const preset = x.preset;
			if (!x.K || !cast[x.K]) return skip(x, "no-speaker");
			const tr = rt.tracks[x.K];
			if (!preset) {
				plan.noPreset.push(sub.id);
				return skip(x, "no-preset");
			}
			if (x.native && !(x.r.baked && x.r.baked.path)) {
				plan.bakeFailed.push({ id: sub.id, why: x.r.bakeWhy || "" });
				return skip(x, "bake-failed", x.r.bakeWhy || "");
			}
			const params = x.native ? [] : rowSendParams(rs).map((p) => Object.assign({}, p));
			if (!x.native && !params.length) return skip(x, "no-params");
			const capFid = captionFid(preset);
			if (!x.native && capFid && !resolveFid(rs._allParams && rs._allParams.length ? rs._allParams : params, capFid, preset.params)) {
				plan.noCaption.push(sub.id);
				return skip(x, "no-caption-field");
			}
			if (blocked[x.K]) {
				const b = blocked[x.K];
				return conflict(x, "pinned-overlap", b.keys.join("과 ") + "가 " + trackName(b.track) + "에서 겹칩니다");
			}
			if (tr.locked) {
				plan.locked.push(sub.id);
				return skip(x, "locked", trackName(tr.track) + " 잠김");
			}
			if (x.zero) {
				plan.zeroLength.push(sub.id);
				return skip(x, "zero-length");
			}
			if (x.dup) {
				plan.dup.push(x.uid);
				return skip(x, "dup", "같은 태그 클립 " + ((idx.dup[x.uid] || []).length) + "개");
			}
			if (x.clamped) plan.overlaps++;
			if (!x.native && rs._allParams && rs._allParams.length && layoutMismatch(rs._allParams, preset.params)) plan.staleLayoutRows++;
			const T = tr.track;
			const m = x.native ? x.r.baked.path : preset.mogrtPath;
			const durSec = x.native ? Number(x.r.baked.durSec) || Number(durs[normPath(m)]) || PLACE_DUR_FALLBACK : Number(preset.mogrtDurSec) || Number(durs[normPath(m)]) || PLACE_DUR_FALLBACK;
			const D = ft > 0 ? Math.round((durSec * TICKS_PER_SEC) / ft) : 0;
			const fhAll = paramHashes(params);
			const nameOf = (g) => (String(cast[x.K].name || "").trim() || x.K) + " " + makeClipTag(salt, sub.id, g);
			const ap = x.ap && typeof x.ap === "object" ? x.ap : null;
			const sig = fieldSignature(params);
			const baseOp = { id: sub.id, uid: x.uid, K: x.K, kind: wantKind(x), m, durSec, D, fhAll, presetId: rs.presetId || "", nk: x.native ? x.r.baked.key : null };
			const hOf = (g, t, sf, ef) => intentHash({ presetId: rs.presetId, sig, fh: fhAll, track: t, sf, ef, m, name: nameOf(g) });
			const writes = (op) => opCreates(op) || (op.params || []).some((p) => p && p.type === "text");
			const cur = x.cur;
			if (!cur) {
				// 우리 클립이 없다: 태그 없는 클립·다른 salt 태그 클립을 알아보고(같은 트랙·기본 트랙에 있던 옛 클립), 없으면 새로 놓는다.
				// 후보 클립 하나는 한 줄만 가진다 → 여기서는 후보를 모으고(claims), 모든 줄을 본 뒤 나눠 finish(pick)로 작업을 정한다
				const g = ap && typeof ap.g === "number" ? ap.g + 1 : 1;
				const cands = [];
				idx.untagged.forEach((c) => { if ((c.track === T || c.track === legacyTrack) && nearF(c, x)) cands.push({ c, foreign: false }); });
				idx.foreignMi.forEach((c) => { if ((c.track === T || c.track === legacyTrack) && nearF(c, x)) cands.push({ c, foreign: true }); });
				const scored = [];
				let pending = false;
				cands.forEach((k) => {
					const d = detailOf(k.c);
					if (d === null) {
						pending = true;
						return;
					}
					if (!d || d.kind !== wantKind(x)) return;
					// certain = 문장을 담는다 (네이티브는 문장을 읽을 수 없어 마지막 적용 자리 ap로), 아니면 uncertain (같은 자리, 문장이 다름)
					const ev = textEv(d, x) || (x.native && !k.foreign && apAt(x, k.c) ? 1 : 0);
					scored.push(Object.assign({ d, ev, certain: ev > 0, same: k.c.track === T, dsf: Math.abs(k.c.sf - x.sf) }, k));
				});
				if (pending) return skip(x, "pending");
				claims.push({ scored, finish: (pick) => {
					const place = () => {
						ops.push(Object.assign({}, baseOp, { op: "place", phase: 4, g, track: T, sf: x.sf, ef: x.ef, own: null, params, name: nameOf(g), h: hOf(g, T, x.sf, x.ef), src: null }));
					};
					if (pick && pick.c.track === T) {
						const c = pick.c;
						const bucket = pick.foreign ? plan.foreignAdopt : plan.adopt;
						if (pick.certain) bucket.certain++;
						else bucket.uncertain++;
						const allow = pick.foreign ? o.adoptForeign && pick.certain : pick.certain ? o.adopt : o.adoptUncertain;
						if (!allow) return conflict(x, "occupied", clipText(c) + (pick.certain ? "" : pick.contested ? " (다른 줄도 이 자리 — 문장으로 가릴 수 없음)" : " (문장이 다름)"));
						ownIds[c.nodeId] = true;
						const own = { track: c.track, sf: c.sf, nodeId: c.nodeId };
						if (Math.abs(c.sf - x.sf) <= 1) {
							// 제자리 인식: 이름(태그)·속성·끝
							ops.push(Object.assign({}, baseOp, { op: "adopt", phase: x.ef < c.ef ? 2 : 5, g, track: T, sf: c.sf, ef: x.ef, keepTime: false, own, params, name: nameOf(g), h: hOf(g, T, x.sf, x.ef),
								src: { track: c.track, sf: c.sf, ef: c.ef, nodeId: c.nodeId, name: c.name }, srcName: c.name, intent: { t: T, sf: x.sf, ef: x.ef } }));
						} else {
							// 옛 자리(ap·mmPrev)에 있는 클립: 인식하면서 줄 시간으로 옮긴다 (TrackItem.move: 효과·키가 남는다)
							ops.push(Object.assign({}, baseOp, { op: "move", phase: 3, g, track: T, sf: x.sf, ef: x.ef, own, params, name: nameOf(g), h: hOf(g, T, x.sf, x.ef),
								src: { track: c.track, sf: c.sf, ef: c.ef, nodeId: c.nodeId, name: c.name }, srcName: c.name, adopting: true }));
						}
						return;
					}
					if (pick && pick.certain) {
						// 기본 트랙(legacyTrack)에 있던 옛 클립 (나눈 레거시 목록): 화자 트랙에 새로 놓고 옛 클립은 nodeId로 지운다
						const c = pick.c;
						const deco = decoratedOf(pick.d, preset);
						if (o.moveLegacy && (!deco || o.moveDecorated)) {
							plan.legacyMove++;
							ownIds[c.nodeId] = true;
							ops.push(Object.assign({}, baseOp, { op: "legacyMove", phase: 3, g, track: T, sf: x.sf, ef: x.ef, own: null, removeAfter: { track: c.track, nodeId: c.nodeId },
								params, name: nameOf(g), h: hOf(g, T, x.sf, x.ef), src: { track: c.track, sf: c.sf, ef: c.ef, nodeId: c.nodeId, name: c.name }, srcName: c.name }));
							return;
						}
						if (deco) plan.legacyDecorated++;
						plan.legacyKept.push(sub.id);
						return place();
					}
					if (ap) {
						plan.missing.push(sub.id);
						if (!o.replaceMissing && !o.forceRegen[sub.id]) return skip(x, "missing");
					}
					return place();
				} });
				return;
			}
			// 우리 클립이 있다
			const same = cur.track === T && Math.abs(cur.sf - x.sf) <= 1;
			const apPos = ap && typeof ap.sf === "number" && typeof ap.t === "number";
			const moved = apPos ? ap.t !== T || Math.abs(ap.sf - x.sf) > 1 || Math.abs(ap.ef - x.ef) > 1 : rowTimeChanged(rs, sub) || rs.mm === "time" || rs.mm === "both";
			const retime = moved || o.restoreMoved || !!o.forceRegen[sub.id];
			const g0 = typeof cur.g === "number" ? cur.g : 1;
			const cef = ap && typeof ap.cef === "number" ? ap.cef : x.ef;
			const hNow = hOf(g0, T, x.sf, x.ef);
			plan.intentOf[sub.id] = hNow;
			if (!o.forceRegen[sub.id] && ap && ap.h === hNow && ((same && Math.abs(cur.ef - cef) <= 1) || (!same && !retime))) {
				plan.none.push(sub.id);
				if (!same) plan.userMoved.push(sub.id);
				plan.rowOps[sub.id] = { none: true };
				return;
			}
			const d = detailOf(cur);
			if (d === null) return skip(x, "pending");
			if (!d) return skip(x, "gone", "스캔 뒤 클립이 사라짐 — 다시 적용");
			const kindMismatch = d.kind !== wantKind(x);
			let tChanged = kindMismatch;
			if (!tChanged && ap && ap.m) tChanged = normPath(ap.m) !== normPath(m);
			else if (!tChanged && !x.native && preset.mogrtItemName && typeof d.pin === "string") tChanged = d.pin !== preset.mogrtItemName;
			else if (!tChanged && x.native) tChanged = !(x.r.oldBaked && normPath(x.r.oldBaked) === normPath(m));
			else if (!tChanged) plan.unverifiedTemplate.push(sub.id);
			const oldVer = !x.native && !tChanged && !!preset.mogrtLs && Array.isArray(d.lay) && clipLs(d.lay) !== preset.mogrtLs;
			if (oldVer) plan.oldVersion.push(sub.id);
			const edited = !!(ap && ap.rh && d.kind === "ae" && textsHash(d.texts) !== ap.rh);
			if (edited) plan.edited.push(sub.id);
			const deco = decoratedOf(d, preset);
			const ownM = (ap && ap.m) || x.r.oldBaked || (!kindMismatch ? preset.mogrtPath : null);
			const changed = !ap || !ap.fh ? params : params.filter((p) => ap.fh[p.index] !== fhAll[p.index]);
			const src = { track: cur.track, sf: cur.sf, ef: cur.ef, nodeId: cur.nodeId, name: cur.name, g: g0 };
			const regenG = Math.max(g0, ap && typeof ap.g === "number" ? ap.g : 0) + 1;
			const regenOwn = { track: cur.track, sf: cur.sf, nodeId: cur.nodeId };
			const guardEdited = (op) => {
				if (edited && writes(op) && !o.overwriteEdited) {
					skip(x, "edited", "Premiere에서 고친 클립");
					return true;
				}
				return false;
			};
			const needRegen = tChanged || (oldVer && o.upgradeOld) || !!o.forceRegen[sub.id];
			if (needRegen) {
				// 템플릿이 바뀌었다(또는 옛 버전 교체·이웃 복구): 먼저 지우고 새로 놓기 (replace). 되놓을 템플릿 경로를 모르는 네이티브는 충돌
				if (!ownM && d.kind !== "ae") {
					plan.unknownTemplate.push(sub.id);
					return conflict(x, "template-unknown", clipText(cur));
				}
				if (deco && !o.moveDecorated && !o.forceRegen[sub.id]) {
					plan.decorated.push(sub.id);
					return skip(x, "decorated", "효과·키프레임이 있는 클립 (다시 놓지 않음)");
				}
				// 사용자가 옮긴 클립(시간은 그대로인 줄)은 그 자리·길이 그대로 바꾼다
				const t = same || retime ? T : cur.track;
				const sf = same || retime ? x.sf : cur.sf;
				const ef = same || retime ? x.ef : Math.max(cur.sf + 1, cur.ef);
				const op = Object.assign({}, baseOp, { op: "replace", phase: 3, g: regenG, track: t, sf, ef, own: Object.assign({ m: ownM || null }, regenOwn), params, name: nameOf(regenG), h: hOf(regenG, T, x.sf, x.ef), src, intent: { t: T, sf: x.sf, ef: x.ef } });
				if (!o.forceRegen[sub.id] && guardEdited(op)) return;
				if (oldVer && o.upgradeOld) plan.oldVersionSkipped++;
				ops.push(op);
				return;
			}
			if (same) {
				const op = Object.assign({}, baseOp, { op: "update", phase: x.ef < cur.ef ? 2 : x.ef > cur.ef ? 5 : 2, g: g0, track: cur.track, sf: x.sf, ef: x.ef, keepTime: false, own: { track: cur.track, sf: cur.sf, nodeId: cur.nodeId },
					params: changed, name: cur.name === nameOf(g0) ? null : nameOf(g0), h: hNow, src, intent: { t: T, sf: x.sf, ef: x.ef } });
				if (guardEdited(op)) return;
				ops.push(op);
				return;
			}
			let stay = false;
			if (retime) {
				if (cur.track === T) {
					// alt: 순환을 끊을 때(orderOps '먼저 지우고 새로 놓기')의 모양 — 새 클립은 템플릿 기본값이라 속성 전부, 다음 gen 태그
					const op = Object.assign({}, baseOp, { op: "move", phase: 3, g: g0, track: T, sf: x.sf, ef: x.ef, own: { track: cur.track, sf: cur.sf, nodeId: cur.nodeId },
						params: changed, name: cur.name === nameOf(g0) ? null : nameOf(g0), h: hNow, src, alt: { g: regenG, params, name: nameOf(regenG), h: hOf(regenG, T, x.sf, x.ef) } });
					if (guardEdited(op)) return;
					ops.push(op);
					return;
				}
				if (deco && !o.moveDecorated) {
					plan.decorated.push(sub.id);
					stay = true;
				} else {
					const op = Object.assign({}, baseOp, { op: "moveRegen", phase: 3, g: regenG, track: T, sf: x.sf, ef: x.ef, own: regenOwn, params, name: nameOf(regenG), h: hOf(regenG, T, x.sf, x.ef), src });
					if (guardEdited(op)) return;
					ops.push(op);
					return;
				}
			} else {
				plan.userMoved.push(sub.id);
			}
			// 제자리 갱신 (사용자가 옮긴 클립, 또는 효과가 있어 옮기지 않는 클립): 속성·이름만, 시간은 그대로.
			// 효과가 있어 옮기지 않는 클립(stay)은 시간 변경이 아직 남은 줄이다: 결과는 검증된 적용으로 치지 않고(mm·'효과 있어 제자리' 남김,
			// applied·ap는 클립이 있는 자리) 다음 계획도 decorated로 둔다(#pfMoveDecorated). 쓸 것(바뀐 속성·이름)이 없으면 보내지 않는다
			const name = cur.name === nameOf(g0) ? null : nameOf(g0);
			if (stay && !changed.length && name === null) return skip(x, "decorated", "효과·키프레임이 있는 클립 (옮기지 않음)");
			const op = Object.assign({}, baseOp, { op: "update", phase: 2, g: g0, track: cur.track, sf: cur.sf, ef: cur.ef, keepTime: true, own: { track: cur.track, sf: cur.sf, nodeId: cur.nodeId },
				params: changed, name, h: hNow, src, intent: { t: T, sf: x.sf, ef: x.ef } }, stay ? { stay: true } : {});
			if (guardEdited(op)) return;
			ops.push(op);
		});
		// 인식 후보 나누기: 태그 없는·다른 salt 클립 하나는 한 줄만 가진다 (동시 발화 '네'·'네'가 한 클립을 두고 한 줄은 제자리 인식,
		// 다른 줄은 옮기기(옛 클립 지움)를 하면 인식한 클립이 지워진다). 순서: 확실함 → 그 줄의 트랙에 있음 → 문장이 같음 > 문장을 담음 >
		// 마지막 적용 자리만 같음(네이티브) → 시작이 가까움 → 목록 순. 진 줄은 다음 후보로, 없으면 새로 놓는다.
		// 문장으로 가릴 수 없는 네이티브 후보(ap 자리만)를 다른 줄도 원하면 제자리 인식은 '확인 필요'(uncertain)로 둔다 (클립 문구를 다시 쓰지 않는다)
		const pairs = [];
		claims.forEach((cl, i) => cl.scored.forEach((k) => pairs.push({ i, k })));
		pairs.sort((a, b) => (b.k.certain - a.k.certain) || (b.k.same - a.k.same) || (b.k.ev - a.k.ev) || (a.k.dsf - b.k.dsf) || (a.i - b.i));
		const picks = claims.map(() => null);
		const taken = {};
		pairs.forEach((p) => {
			const id = p.k.c.nodeId;
			if (picks[p.i] || taken[id]) return;
			let k = p.k;
			if (k.ev === 1 && k.same && pairs.some((q) => q.i !== p.i && !picks[q.i] && q.k.c.nodeId === id && q.k.ev === 1)) k = Object.assign({}, k, { certain: false, contested: true });
			picks[p.i] = k;
			taken[id] = true;
		});
		claims.forEach((cl, i) => cl.finish(picks[i]));
		// 목록 밖: 중단된 적용이 남긴 옛 gen, 목록에서 빠진 줄의 클립 (한 줄 적용에서는 보지 않는다)
		const removals = [];
		if (!o.single) {
			idx.stale.forEach((c) => {
				plan.cleanup.push({ uid: c.uid, track: c.track, nodeId: c.nodeId, name: c.name, g: c.g });
				if (o.cleanupStale) removals.push({ uid: c.uid, id: c.id, track: c.track, nodeId: c.nodeId, expectName: c.name, g: c.g, why: "stale" });
			});
			const live = {};
			all.forEach((s) => { live[s.id] = true; });
			const trashWhy = (inp && inp.trash) || {};
			Object.keys(idx.current).forEach((uid) => {
				const c = idx.current[uid];
				if (live[c.id]) return;
				const why = trashWhy[c.id];
				const ap = applied[uid];
				let pre = false;
				// 고치지 않았는지는 AE 클립만 알 수 있다 (네이티브 Source Text는 늘 ""로 읽힌다) → 네이티브는 미리 체크하지 않는다
				if ((why === "merge" || why === "replace") && ap && ap.rh && (ap.k || "ae") === "ae") {
					const d = detailOf(c);
					pre = !!d && d.kind === "ae" && textsHash(d.texts) === ap.rh;
				}
				plan.orphans.push({ uid, id: c.id, track: c.track, nodeId: c.nodeId, name: c.name, g: c.g, pre, why: why === undefined ? null : why });
				if (o.orphans === "all" || (o.orphans !== "none" && pre)) removals.push({ uid, id: c.id, track: c.track, nodeId: c.nodeId, expectName: c.name, g: c.g, why: "orphan" });
			});
		}
		// 순서 (3단계 의존·순환 끊기) → 트랙 점유 흉내 (작업 뒤 범위, simulateOps): 충돌은 빼고, 새로 놓는 작업의 이웃(guard)·끝 맞춤을 정한다
		const ord = orderOps(ops);
		const allRemovals = removals.concat(ord.removals);
		const st = {};
		(scan.tracks || []).forEach((t) => {
			st[t.i] = (t.clips || []).map((c) => ({ id: String(c.nodeId), sf: c.sf, ef: c.ef, own: !!ownIds[String(c.nodeId)], name: c.name || "" }));
		});
		const sim = simulateOps(st, ord.ordered, allRemovals);
		sim.bad.forEach((b) => {
			const detail = simConflictText(b, ft);
			plan.conflicts.push({ id: b.op.id, uid: b.op.uid, why: b.why, detail });
			plan.rowOps[b.op.id] = { skip: "conflict", why: b.why, detail };
		});
		const final = sim.ok;
		plan.ops = final;
		plan.removals = allRemovals;
		final.forEach((op) => { plan.rowOps[op.id] = op; });
		// 새 트랙: 이번 작업이 쓰는 트랙까지만 만든다 (↑ 한 줄이나 줄이 없는 화자의 미리보기 트랙 때문에 만들지 않는다).
		// 트랙은 뒤에 붙으므로 그 사이의 없는 트랙도 생긴다 → create = 지금 없고 minCount 안
		const nt = typeof scan.numVideoTracks === "number" ? scan.numVideoTracks : null;
		let needT = 0;
		final.forEach((op) => { if (op.track + 1 > needT) needT = op.track + 1; });
		plan.minCount = nt !== null && needT > nt ? needT : 0;
		plan.tracksToAdd = plan.minCount > 0 ? plan.minCount - nt : 0;
		Object.keys(rt.tracks).forEach((K) => { rt.tracks[K].create = nt !== null && rt.tracks[K].track >= nt && rt.tracks[K].track < plan.minCount; });
		// 화자별 요약
		(mi.castOrder || []).forEach((K) => {
			if (!rt.tracks[K]) return;
			const counts = { place: 0, update: 0, adopt: 0, move: 0, moveRegen: 0, legacyMove: 0, replace: 0, none: 0, skip: 0, rows: 0 };
			infos.forEach((x) => {
				if (x.K !== K) return;
				counts.rows++;
				const ro = plan.rowOps[x.sub.id];
				if (!ro) return;
				if (ro.none) counts.none++;
				else if (ro.skip) counts.skip++;
				else if (counts[ro.op] !== undefined) counts[ro.op]++;
			});
			plan.perSpeaker[K] = Object.assign({ key: K }, rt.tracks[K], { counts });
		});
		return plan;
	}
	// 배치 실행 결과 상태 → 검증된 적용(ap·mm 지움)인가 / 썼지만 일부 속성이 빠졌나(partial: mm 남김)
	const PLACE_OK = { placed: true, updated: true, replaced: true, moved: true, adopted: true };
	// salt 복구 (계획서 §6.7): salt가 비었을 때(v27이 mi를 버리고 저장했고 cast.json도 쓸 수 없다) 스캔의 태그 클립 중 id가 살아 있는 줄인 것을
	// salt마다 20개까지 표본으로 되읽어, 80% 이상이 그 줄의 캡션(normText)을 담으면 그 salt를 받는다 (id만으로는 받지 않는다).
	//   rowsById {id: {caps: [normText 캡션…]}}, details {nodeId: 되읽기}
	// → {salt: 받을 salt | null, need: [{track, nodeId}] 아직 되읽지 않은 표본 (읽고 다시 부른다)}
	function recoverSalt(scan, rowsById, details) {
		const idx = scanIndex(scan, "");
		const bySalt = {};
		idx.foreignMi.forEach((c) => { if (rowsById && rowsById[c.id]) (bySalt[c.salt] = bySalt[c.salt] || []).push(c); });
		const need = [];
		let best = null;
		Object.keys(bySalt).sort().forEach((s) => {
			const sample = bySalt[s].slice(0, 20);
			let ok = 0;
			let seen = 0;
			sample.forEach((c) => {
				const d = details && details[c.nodeId];
				if (!d) {
					need.push({ track: c.track, nodeId: c.nodeId });
					return;
				}
				seen++;
				const caps = rowsById[c.id].caps || [];
				if ((d.texts || []).some((t) => { const n = normText(t); return !!n && caps.some((cp) => n.indexOf(cp) !== -1); })) ok++;
			});
			if (seen > 0 && seen === sample.length && ok / seen >= 0.8 && (!best || sample.length > best.n)) best = { salt: s, n: sample.length };
		});
		return { salt: need.length ? null : best ? best.salt : null, need };
	}

	// ── 마지막 적용 되돌리기 (타임라인만, S2-5) — 계획서 §6.11, spec placement 11 ──
	// last_apply.json(적용 실행 하나의 기록)을 타임라인에서 거꾸로 돌린다. 자막 목록·후반 작업 값·히스토리는 되돌리지 않는다.
	// 기록 (spec dataModel 3 + S2-5에서 덧붙인 키): 범주 created·updated·moved·adopted·replaced·removed, 항목마다
	//   key(uid, 레거시 안전 경로는 "r<id>"·g 0), g, track, sf, nodeId, rh(우리가 쓴 직후 되읽은 텍스트 해시)
	//   + n(기록 순서), id(줄 id), op(작업), k(작업 뒤 클립 종류), m(작업 뒤 클립의 템플릿 경로), ef, dur(템플릿 길이 초)
	//   updated.before = 작업 전 속성 전부(type 있는 ParamDef), updated.from = 작업 전 {track, sf, ef, name}
	//   adopted.from = {name, params, track, sf, ef}, moved·replaced.from = 작업 전 클립 {track, sf, ef, g, name, nodeId, kind, m, pi, params}
	//   removed = 지운 클립 {track, sf, ef, g, name, kind, m, pi, params, nodeId} + why(stale|orphan|cycle|undo), pa(지우기 전 applied 항목)
	//   la.prev[key] = 실행 전 줄 기록 {id, ap, mmPrev, mm, a(applied 항목)} — 되돌린 줄의 rs.ap·mmPrev·applied를 되돌린다
	const UNDO_CATS = ["removed", "created", "updated", "moved", "adopted", "replaced"];
	// 되돌리지 않는 까닭 (패널이 문구로 바꾼다). 앞의 여섯은 '그 뒤로 바뀜'이다
	//   retimed: 적용 뒤 Premiere에서 클립을 옮기거나 길이를 바꿨다 (지금 자리가 기록한 작업 뒤 자리와 1프레임 넘게 다르다)
	const UNDO_CHANGED = { gone: true, renamed: true, edited: true, kind: true, "moved-track": true, retimed: true };
	// uid 모양 key ("salt-id") — 태그를 확인한다. 레거시 key "r<id>"는 태그가 없어야 한다
	function isUidKey(key) {
		return /^[a-z0-9]{4}-\d+$/.test(String(key == null ? "" : key));
	}
	function laKeyId(key, e) {
		if (e && typeof e.id === "number") return e.id;
		const m = /^r(\d+)$/.exec(String(key)) || /-(\d+)$/.exec(String(key));
		return m ? parseInt(m[1], 10) : null;
	}
	// 되돌릴 수 있는 기록인가: 이 시퀀스의 것이고, v27 ▶가 덮지 않았고(superseded), 다 되돌리지 않았고, 항목이 있다.
	// 실행 전 줄 기록(la.prev)이 없는 기록(S2-4 모양)은 되돌리지 않는다: 되돌린 줄의 applied·ap를 실행 전으로 돌릴 수 없어
	// 다음 ▶가 옛 문장의 클립을 '그대로'로 보고 병합 표시까지 지운다
	function laUndoable(la, seqId) {
		if (!la || typeof la !== "object" || !la.seqId || String(la.seqId) !== String(seqId || "")) return false;
		if (!la.prev || typeof la.prev !== "object") return false;
		if (la.superseded || (la.undone && la.undone.complete)) return false;
		return UNDO_CATS.some((c) => Array.isArray(la[c]) && la[c].length > 0);
	}
	// 이름의 우리 태그(key와 같은 uid)를 gen g로 바꾼다. 태그가 없거나 다른 uid면 그대로
	function undoRetag(name, key, g) {
		const s = String(name == null ? "" : name);
		const t = parseClipTag(s);
		if (!t || t.uid !== key) return s;
		return s.replace(CLIP_TAG_RE, makeClipTag(t.salt, t.id, g));
	}
	// 항목 하나의 작업 전 클립 (없었으면 null): {nodeId, track, sf, ef(null = 모름), g, name, kind, m, pi, params}
	function undoOriginOf(cat, e) {
		const num = (v) => (typeof v === "number" && isFinite(v) ? v : null);
		const str = (v) => (v === undefined || v === null ? null : String(v));
		if (!e || cat === "created") return null;
		if (cat === "updated" || cat === "adopted") {
			const f = e.from || {};
			return { nodeId: String(e.nodeId == null ? "" : e.nodeId), track: num(f.track) !== null ? f.track : e.track, sf: num(f.sf) !== null ? f.sf : e.sf, ef: num(f.ef), g: null,
				name: str(f.name), kind: e.k || "", m: str(e.m), pi: null, params: (cat === "updated" ? e.before : f.params) || [] };
		}
		const s = cat === "removed" ? e : e.from || {};
		return { nodeId: str(s.nodeId) || "", track: s.track, sf: s.sf, ef: num(s.ef), g: num(s.g), name: str(s.name), kind: s.kind || e.k || "", m: str(s.m), pi: str(s.pi), params: s.params || [] };
	}
	// 기록을 key마다 순서대로 묶는다 (한 실행에서 한 줄이 여러 번 바뀔 수 있다: 이웃이 망가져 다시 놓기, 순환을 끊은 먼저 지우기).
	// 따로 되놓는 제거(옛 gen·목록에서 빠진 줄의 클립)는 묶지 않는다 → {chains: [{key, id, cats, origin, final}], lone: [removed 항목]}
	//   origin = 실행 전 클립 (없었으면 null) = 첫 항목의 작업 전 모습
	//   final  = 실행 뒤 클립 = 마지막 (제거가 아닌) 항목 {nodeId, g, rh, k, m, track, sf, ef (null = 모름, S2-4 기록)}. 없으면 null (순환을 끊고 놓지 못했다)
	//   fix    = 첫 항목이 이웃 복구(분기 C: 다른 줄의 템플릿 길이에 덮여 사라진 클립을 줄 계획으로 다시 놓음)다 → 실행 전 클립의 모습이 기록에 없다
	// n이 없는 기록(S2-4)은 범주 순서(제거 먼저)로 본다
	function undoChains(la) {
		const all = [];
		UNDO_CATS.forEach((cat, ci) => {
			const list = la && Array.isArray(la[cat]) ? la[cat] : [];
			list.forEach((e, i) => {
				if (!e || typeof e.key !== "string" || !e.key) return;
				all.push({ cat, e, n: typeof e.n === "number" ? e.n : (ci - UNDO_CATS.length) * 1e6 + i });
			});
		});
		all.sort((a, b) => a.n - b.n);
		const groups = new Map();
		const lone = [];
		all.forEach((x) => {
			if (x.cat === "removed" && x.e.why !== "cycle") {
				lone.push(x.e);
				return;
			}
			if (!groups.has(x.e.key)) groups.set(x.e.key, []);
			groups.get(x.e.key).push(x);
		});
		const chains = [];
		groups.forEach((list, key) => {
			const mains = list.filter((x) => x.cat !== "removed");
			const last = mains.length ? mains[mains.length - 1].e : null;
			chains.push({
				key, id: laKeyId(key, list[0].e), cats: list.map((x) => x.cat), origin: undoOriginOf(list[0].cat, list[0].e), fix: list[0].e.fix === true,
				final: last ? { nodeId: String(last.nodeId == null ? "" : last.nodeId), g: typeof last.g === "number" ? last.g : 0, rh: typeof last.rh === "string" ? last.rh : null,
					k: last.k || "", m: last.m || null, track: last.track, sf: typeof last.sf === "number" ? last.sf : null, ef: typeof last.ef === "number" ? last.ef : null } : null
			});
		});
		return { chains, lone };
	}
	// 되돌리기 계획 (순수). inp:
	//   la       last_apply.json
	//   scan     호스트 getTracks 결과 (기록의 트랙들)
	//   details  {nodeId: readClipTexts 결과 {found, kind, texts}}
	//   durs     {normPath(템플릿): 길이 초} (되놓는 템플릿의 기본 길이 → 이웃 창)
	//   repairM  {nodeId: 템플릿 경로} 되놓을 때 머리를 보호하고, 통째로 덮이면 스냅숏으로 되살릴 수 있는 클립 (우리 클립·레거시 줄의 클립)
	//   skipKeys {key 또는 따로 지운 클립의 uid "key#n": true} 이미 되돌린 것 (멈춘 되돌리기를 이어서 할 때)
	// 모든 되돌리기는 확인한다 (spec: nodeId + g + 지금 텍스트 해시 == 기록한 rh): 마지막 클립(final)이 그 nodeId로 있고,
	// 이름의 태그가 key·g와 같고(레거시는 태그 없음), AE면 텍스트 해시가 rh와 같아야 한다. 아니면 '그 뒤로 바뀜'으로 건너뛴다.
	// 네이티브는 Source Text가 늘 ""로 읽혀(S0-3 w) 텍스트로 확인할 수 없다 → nodeId·gen·종류만 보고, 되놓을 때는 기록한 구운 사본 경로(m)를 쓴다.
	// 자리도 확인한다: 지금 클립의 트랙·시작·끝이 기록한 작업 뒤 자리(final)와 1프레임 넘게 다르면 적용 뒤 Premiere에서 옮기거나 길이를 바꾼 것이다.
	//   그러면 자리를 되돌리거나 클립을 지우는 되돌리기(만든 클립, 우리가 옮긴 클립, 다시 놓은 클립)는 '그 뒤로 바뀜'(retimed·moved-track)으로 건너뛰고,
	//   시작을 옮기지 않은 제자리 작업(updated·adopted)은 속성·이름만 되돌린다 (keepTime — 사용자가 바꾼 자리·끝은 그대로)
	//   origin 없음                  → 지운다 (removeClips, expectName)
	//   origin이 같은 클립(nodeId)   → 제자리 되돌리기: 우리 작업이 시작을 옮기지 않았으면 update(속성 전부 = 작업 전 ParamDef, 이름, 끝 — 끝은 지금 자리가
	//                                  작업 뒤 그대로일 때만), 옮겼으면 move (TrackItem.move)
	//   origin이 다른 클립           → 옛 템플릿(origin.m)을 옛 자리에 되놓고 지금 클립을 지운다: 같은 트랙이면 replace, 다른 트랙이면 moveRegen.
	//                                  이름은 태그 gen을 올려(g + 1) 되놓는다 — 지금 클립이 남아도 옛 gen으로 정리되게. 레거시(태그 없음)는 원래 이름
	//   따로 지운 클립(옛 gen·목록 밖) → 기록한 자리에 되놓는다 (place, 자리가 비어 있어야 한다)
	// 되놓는 템플릿 경로를 모르면 건너뛴다 (template-unknown). 자리 흉내(simulateOps)에서 막히면 건너뛴다 (occupied·tail).
	// 첫 기록이 이웃 복구(fix)인 key는 그대로 둔다 (kept: 덮여 사라진 원래 클립을 줄 계획으로 다시 놓은 것 — 지우면 클립이 없어진다).
	// → {removals, ops (단계 순, guard 포함), acts: {key: 작업 종류}, skipped: [{key, id, why, detail}], kept: [key], needReads (읽고 다시 부른다), chains}
	function buildUndoOps(inp) {
		const la = (inp && inp.la) || {};
		const scan = (inp && inp.scan) || { tracks: [] };
		const ft = Number(scan.frameTicks) || 0;
		const details = (inp && inp.details) || {};
		const durs = (inp && inp.durs) || {};
		const repairM = (inp && inp.repairM) || {};
		const out = { removals: [], ops: [], acts: {}, skipped: [], kept: [], needReads: [], chains: [] };
		const byNode = {};
		(scan.tracks || []).forEach((t) => (t.clips || []).forEach((c) => {
			byNode[String(c.nodeId)] = { track: t.i, sf: c.sf, ef: c.ef, nodeId: String(c.nodeId), name: String(c.name == null ? "" : c.name) };
		}));
		const need = {};
		let pending = false;
		const detailOf = (c) => {
			const d = details[c.nodeId];
			if (d) return d.found === false ? false : d;
			if (!need[c.nodeId]) {
				need[c.nodeId] = true;
				out.needReads.push({ track: c.track, nodeId: c.nodeId });
			}
			pending = true;
			return null;
		};
		const skip = (key, id, why, detail) => { out.skipped.push({ key, id, why, detail: detail || "" }); };
		const durOf = (m) => Number(durs[normPath(m)]) || PLACE_DUR_FALLBACK;
		const Dof = (sec) => (ft > 0 ? Math.round((sec * TICKS_PER_SEC) / ft) : 0);
		const ops = [];
		const { chains, lone } = undoChains(la);
		out.chains = chains;
		// 옛 자리에 되놓기 (place): 순환을 끊고 놓지 못한 줄, 따로 지운 클립
		const placeOp = (uid, key, id, o, name, g, kind) => {
			if (!o.m) return skip(key, id, "template-unknown");
			const dur = durOf(o.m);
			const op = { uid, key, id, op: "place", phase: 4, g: g || 0, track: o.track, sf: o.sf, ef: Math.max(o.sf + 1, typeof o.ef === "number" ? o.ef : o.sf + 1), own: null, removeAfter: null,
				m: o.m, durSec: dur, D: Dof(dur), params: o.params || [], name: name || null, src: null, undo: kind };
			ops.push(op);
			return op;
		};
		const skipKeys = (inp && inp.skipKeys) || {};
		chains.forEach((ch) => {
			if (skipKeys[ch.key]) return;
			// 덮여 사라진 클립을 다시 놓은 줄: 지우면 그 줄의 클립이 없어진다 → 그대로 둔다
			if (ch.fix) {
				out.kept.push(ch.key);
				return;
			}
			const fin = ch.final;
			const org = ch.origin;
			const uidKey = isUidKey(ch.key);
			if (!fin) {
				if (org) placeOp(ch.key, ch.key, ch.id, org, org.name, org.g, "place");
				return;
			}
			const c = byNode[fin.nodeId];
			if (!c) return skip(ch.key, ch.id, "gone");
			const tag = parseClipTag(c.name);
			if (uidKey ? !tag || tag.uid !== ch.key || tag.g !== fin.g : !!tag) return skip(ch.key, ch.id, "renamed", c.name);
			const d = detailOf(c);
			if (d === null) return;
			if (!d) return skip(ch.key, ch.id, "gone");
			if (fin.k && d.kind !== fin.k) return skip(ch.key, ch.id, "kind", d.kind);
			if (d.kind === "ae" && fin.rh !== null && textsHash(d.texts || []) !== fin.rh) return skip(ch.key, ch.id, "edited");
			const src = { track: c.track, sf: c.sf, ef: c.ef, nodeId: c.nodeId, name: c.name, g: fin.g };
			const own = { track: c.track, sf: c.sf, nodeId: c.nodeId };
			// 적용 뒤 자리가 바뀌었나 (기록한 작업 뒤 트랙·시작·끝과 비교. 끝을 모르는 S2-4 기록은 시작만)
			const trackMoved = typeof fin.track === "number" && c.track !== fin.track;
			const retimed = trackMoved || (fin.sf !== null && Math.abs(c.sf - fin.sf) > 1) || (fin.ef !== null && Math.abs(c.ef - fin.ef) > 1);
			const posText = "V" + (c.track + 1) + " " + c.sf + "~" + c.ef + "f";
			if (!org) {
				if (retimed) return skip(ch.key, ch.id, trackMoved ? "moved-track" : "retimed", posText);
				out.removals.push({ uid: ch.key, key: ch.key, id: ch.id, track: c.track, nodeId: c.nodeId, expectName: c.name, g: fin.g, why: "undo" });
				out.acts[ch.key] = "remove";
				return;
			}
			if (org.nodeId && org.nodeId === fin.nodeId) {
				// 같은 클립: 속성 전부·이름·자리를 작업 전으로 (다른 트랙으로 옮겨졌으면 TrackItem.move로 되돌릴 수 없다)
				if (org.track !== c.track || trackMoved) return skip(ch.key, ch.id, "moved-track", "V" + (c.track + 1));
				const efT = typeof org.ef === "number" ? Math.max(org.sf + 1, org.ef) : c.ef;
				const name = org.name && org.name !== c.name ? org.name : null;
				// 우리 작업이 시작을 옮겼다 (move·legacy move): 지금 자리가 작업 뒤 그대로일 때만 옛 자리로 되돌린다
				const ourMove = Math.abs(org.sf - (fin.sf !== null ? fin.sf : c.sf)) > 1;
				if (ourMove) {
					if (retimed) return skip(ch.key, ch.id, "retimed", posText);
					ops.push({ uid: ch.key, key: ch.key, id: ch.id, op: "move", phase: 3, g: fin.g, track: c.track, sf: org.sf, ef: efT, own, removeAfter: null, m: fin.m || org.m,
						durSec: durOf(fin.m || org.m), D: 0, params: org.params, name, src, alt: { name: org.name || c.name }, undo: "move" });
				} else {
					// 시작은 그대로 (spec: updated → update keepTime with before). 우리 작업이 바꾼 끝은 지금 자리가 작업 뒤 그대로일 때만 되돌린다
					const keep = retimed || Math.abs(efT - c.ef) < 1;
					ops.push({ uid: ch.key, key: ch.key, id: ch.id, op: "update", phase: !keep && efT > c.ef ? 5 : 2, g: fin.g, track: c.track, sf: c.sf, ef: keep ? c.ef : efT, keepTime: keep, own,
						removeAfter: null, m: fin.m || org.m, params: org.params, name, src, undo: "restore" });
				}
				out.acts[ch.key] = ops[ops.length - 1].undo;
				return;
			}
			// 다른 클립: 옛 템플릿을 옛 자리에 되놓고 지금 클립을 지운다 (적용 뒤 옮긴 클립은 지우지 않는다)
			if (retimed) return skip(ch.key, ch.id, trackMoved ? "moved-track" : "retimed", posText);
			if (!org.m) return skip(ch.key, ch.id, "template-unknown");
			const g2 = uidKey ? Math.max(fin.g, typeof org.g === "number" ? org.g : 0) + 1 : 0;
			const dur = durOf(org.m);
			ops.push({ uid: ch.key, key: ch.key, id: ch.id, op: org.track === c.track ? "replace" : "moveRegen", phase: 3, g: g2, track: org.track, sf: org.sf,
				ef: Math.max(org.sf + 1, typeof org.ef === "number" ? org.ef : org.sf + 1), own: Object.assign({ m: fin.m || null }, own), removeAfter: null, m: org.m, durSec: dur, D: Dof(dur),
				params: org.params, name: uidKey ? undoRetag(org.name, ch.key, g2) : org.name || null, src, undo: "replace" });
			out.acts[ch.key] = "replace";
		});
		lone.forEach((e, i) => {
			const uid = e.key + "#" + (typeof e.n === "number" ? e.n : "i" + i);
			if (skipKeys[uid]) return;
			const o = undoOriginOf("removed", e);
			const id = laKeyId(e.key, e);
			// 같은 이름의 클립이 이미 그 자리에 있다 (사용자가 되살렸다): 또 놓지 않는다
			const dupe = Object.keys(byNode).some((n) => { const c = byNode[n]; return c.track === o.track && c.name === (o.name || "") && Math.abs(c.sf - o.sf) <= 1; });
			if (dupe) return skip(e.key, id, "exists");
			const op = placeOp(uid, e.key, id, o, o.name, o.g, "unremove");
			if (op) op.entry = e;
		});
		if (pending) {
			out.removals = [];
			return out;
		}
		// 순서 (3단계 의존·순환 끊기) → 작업 뒤 범위로 자리 흉내: 막히면 건너뛴다. 되놓는 클립의 이웃(guard)을 정한다
		const ord = orderOps(ops);
		const st = {};
		(scan.tracks || []).forEach((t) => {
			st[t.i] = (t.clips || []).map((c) => ({ id: String(c.nodeId), sf: c.sf, ef: c.ef, own: !!repairM[String(c.nodeId)], name: c.name || "" }));
		});
		const sim = simulateOps(st, ord.ordered, out.removals.concat(ord.removals));
		const bad = {};
		sim.bad.forEach((b) => {
			bad[b.op.uid] = true;
			skip(b.op.key, b.op.id, b.why, simConflictText(b, ft));
			if (out.acts[b.op.key] && b.op.uid === b.op.key) delete out.acts[b.op.key];
		});
		// 순환을 끊은 작업이 막혔으면 그 '먼저 지우기'도 하지 않는다
		out.removals = out.removals.concat(ord.removals.filter((r) => !bad[r.uid]).map((r) => Object.assign({}, r, { key: r.uid })));
		out.ops = sim.ok;
		return out;
	}
	// 레거시 줄의 클립 (태그 없음): 트랙 스캔에서 줄 자리(ap·mmPrev·지금 시간, ap.t가 없으면 어느 트랙이든) ±1프레임에 시작하는 클립.
	// rows [{id, track | null, at: [초], m: 템플릿 경로 | null}] (살아 있는 줄·휴지통 항목) → {nodeId: {id, m}} (먼저 맞은 줄)
	function legacyClipOwners(scan, rows, frameTicks) {
		const ft = Number(frameTicks || (scan && scan.frameTicks)) || 0;
		const out = {};
		const list = (rows || []).map((r) => ({ id: r.id, track: typeof r.track === "number" ? r.track : null, m: r.m || null, fs: (r.at || []).filter((s) => typeof s === "number").map((s) => frameOf(s, ft)) }));
		((scan && scan.tracks) || []).forEach((t) => (t.clips || []).forEach((c) => {
			if (parseClipTag(c.name)) return;
			const hit = list.find((r) => (r.track === null || r.track === t.i) && r.fs.some((f) => Math.abs(f - c.sf) <= 1));
			if (hit) out[String(c.nodeId)] = { id: hit.id, m: hit.m };
		}));
		return out;
	}
	// 망가진 이웃 다시 놓기 (분기 C, 되돌리기·레거시 안전 경로): snaps [{nodeId, track, sf, ef, name, g, params, m, durSec}]
	// (놓기 전에 읽어 둔 스냅숏). 클립이 아직 있으면(머리를 되돌리지 못했다) replace, 없으면 place. 자리 흉내로 이웃(guard)을 정한다.
	// repairM {nodeId: 템플릿}: 보호할 수 있는 이웃 → {ops, bad: [{op, why, clip}]}
	function repairOps(snaps, scan, repairM, frameTicks) {
		const ft = Number(frameTicks || (scan && scan.frameTicks)) || 0;
		const st = {};
		const byNode = {};
		((scan && scan.tracks) || []).forEach((t) => {
			st[t.i] = (t.clips || []).map((c) => ({ id: String(c.nodeId), sf: c.sf, ef: c.ef, own: !!(repairM || {})[String(c.nodeId)], name: c.name || "" }));
			(t.clips || []).forEach((c) => { byNode[String(c.nodeId)] = { track: t.i, sf: c.sf, nodeId: String(c.nodeId) }; });
		});
		const ops = (snaps || []).filter((s) => s && s.m).slice().sort((a, b) => a.sf - b.sf).map((s) => {
			const cur = byNode[String(s.nodeId)];
			const dur = Number(s.durSec) || PLACE_DUR_FALLBACK;
			const tg = parseClipTag(s.name);
			return { uid: "fix:" + s.nodeId, key: "fix:" + s.nodeId, id: 0, op: cur ? "replace" : "place", phase: 4, g: tg ? tg.g : 0, track: s.track, sf: s.sf, ef: Math.max(s.sf + 1, s.ef),
				own: cur ? { track: cur.track, sf: cur.sf, nodeId: cur.nodeId, m: s.m } : null, removeAfter: null, m: s.m, durSec: dur, D: ft > 0 ? Math.round((dur * TICKS_PER_SEC) / ft) : 0,
				params: s.params || [], name: s.name || null, src: null, snap: s };
		});
		const sim = simulateOps(st, ops, []);
		return { ops: sim.ok, bad: sim.bad };
	}

	// ── 레거시 안전 경로 (v28 호스트, S2-5) — 계획서 §6.13, spec placement 13 ──
	// 레거시 줄이 타임라인에 놓인 적 없는 줄인가 (레거시 안전 경로가 클립을 못 찾으면 새로 놓아도 되는 줄):
	//   병합의 새 줄(mm new, ap·mmPrev 없음), 또는 마지막 적용(레거시 안전 경로 기록 la)이 그런 새 줄을 놓았다가 되돌린 줄(mm undone).
	// 그 밖의 줄(병합 전부터 있던 줄, v27에 위험한 줄, 되돌린 줄)은 클립을 못 찾으면 트랙 선택이 바뀌었거나 옮긴 것일 수 있다 → 놓지 않는다
	function legacyFresh(rs, la, id) {
		if (!rs || rs.ap || rs.mmPrev) return false;
		if (rs.mm === "new") return true;
		if (rs.mm !== "undone" || !la || !la.legacy) return false;
		const key = "r" + id;
		const p = la.prev && la.prev[key];
		return !!(la.undone && la.undone.keys && la.undone.keys[key] === "remove") && !!p && p.mm === "new" && !p.ap && !p.mmPrev;
	}
	// 화자 표가 없는 목록의 바뀐 줄을 태그 없이(name null — 단일 화자 타임라인은 v27과 같은 모습) nodeId로 적용한다:
	//   문장만 바뀜 → 제자리 갱신(update keepTime), 시간이 바뀜 → TrackItem.move (S0-3 r), 타임라인에 없는 새 줄 → 새로 놓기(place, 이웃 보호).
	// 줄의 클립 = 그 트랙에서 마지막 검증 적용(ap) → 병합 전 값(mmPrev) → 지금 시간(applyLocate)의 프레임 ±1에 시작하는 태그 없는 AE 클립 가운데
	// 줄 문장(ap.cap·mmPrev.cap·캡션·sub.text 중 하나)을 담은 것 하나. 둘 이상이면 ambiguous, 담은 것이 없고 그 자리에 클립이 하나뿐이면
	// uncertain (확인창에서 고르면 opts.uncertain으로 다시 계획), 없으면 missing:
	//   놓인 적 없는 줄(r.fresh, 없으면 legacyFresh(rs))과 ↑(opts.placeMissing — v27 ↑처럼 못 찾으면 놓는다)만 새로 놓는다.
	//   나머지는 건너뛰고 병합 표시를 남긴다 (spec placement 13은 'missing → place'지만, 트랙 선택이 바뀌었거나 옮긴 옛 클립 옆에 같은 줄이
	//   하나 더 생긴다 — 1단계 경로처럼 '클립 없음'으로 둔다)
	// 보내는 속성: v27에 위험한 줄·되돌린 줄·복구한 줄·새로 놓는 줄·↑(opts.full)은 전부 (호스트가 이름으로 확인해 쓴다),
	//   캡션이 바뀐 줄(문장 병합, 또는 찾은 클립의 문장이 줄 캡션과 다름 — 병합 뒤 패널에서 고친 캡션)은 캡션 속성 하나, 시간만 바뀐 줄은 없음.
	//   네이티브 줄(구운 사본)은 이 경로에서 다루지 않는다 (v27 ▶·↑의 굽기 경로).
	// inp {rows: [{sub, rs, preset, unsafe, track, fresh?}], scan, details, durs, owners: legacyClipOwners 결과 (다른 줄의 클립: 이웃 보호·복구 대상),
	//   opts {uncertain, full, placeMissing}}
	// → {ops (단계 순, guard 포함), removals (순환 끊기), rowOps {id: {op, …} | {skip, why, detail} | {none: true}}, uncertain: [id], needReads}
	function legacyMiPlan(inp) {
		const o = Object.assign({ uncertain: false, full: false, placeMissing: false }, (inp && inp.opts) || {});
		const scan = (inp && inp.scan) || { tracks: [] };
		const ft = Number(scan.frameTicks) || 0;
		const details = (inp && inp.details) || {};
		const durs = (inp && inp.durs) || {};
		const owners = (inp && inp.owners) || {};
		const out = { ops: [], removals: [], rowOps: {}, uncertain: [], needReads: [] };
		const byTrack = {};
		(scan.tracks || []).forEach((t) => {
			byTrack[t.i] = (t.clips || []).map((c) => ({ track: t.i, sf: c.sf, ef: c.ef, nodeId: String(c.nodeId), name: String(c.name == null ? "" : c.name) }));
		});
		const need = {};
		let pending = false;
		const detailOf = (c) => {
			const d = details[c.nodeId];
			if (d) return d.found === false ? false : d;
			if (!need[c.nodeId]) {
				need[c.nodeId] = true;
				out.needReads.push({ track: c.track, nodeId: c.nodeId });
			}
			pending = true;
			return null;
		};
		const skip = (id, why, detail) => { out.rowOps[id] = { skip: why, detail: detail || "" }; };
		const secOf = (f) => (ft > 0 ? (f * ft) / TICKS_PER_SEC : 0);
		const clipText = (c) => "V" + (c.track + 1) + " " + secOf(c.sf).toFixed(1) + "~" + secOf(c.ef).toFixed(1);
		const claimed = {};
		const ops = [];
		const FULL_MM = { undone: true, restored: true, new: true };
		const TEXT_MM = { text: true, both: true, conflict: true, check: true };
		(inp.rows || []).forEach((r) => {
			const sub = r.sub;
			const rs = r.rs || {};
			const preset = r.preset || null;
			const id = sub.id;
			if (!preset) return skip(id, "no-preset");
			const all = rowSendParams(rs).map((p) => Object.assign({}, p));
			if (!all.length) return skip(id, "no-params");
			if (isNativeList(all) || isNativeList(preset.params) || (rs.ap && rs.ap.nk)) return skip(id, "native");
			const T = r.track;
			if (!byTrack[T]) return skip(id, "no-track", "V" + (T + 1));
			const cap = rowCaptionValue(rs, preset);
			const capFid = captionFid(preset);
			const capR = capFid ? resolveFid(all, capFid, preset.params) : null;
			const caps = [];
			[rs.ap && rs.ap.cap, rs.mmPrev && rs.mmPrev.cap, cap, sub.text].forEach((t) => {
				const n = normText(t);
				if (n && caps.indexOf(n) === -1) caps.push(n);
			});
			const loc = applyLocate(rs, sub);
			const fA = frameOf(loc.s, ft);
			const sf = frameOf(sub.startSec, ft);
			const ef = Math.max(sf + 1, frameOf(sub.endSec, ft));
			const cands = byTrack[T].filter((c) => !parseClipTag(c.name) && !claimed[c.nodeId] && Math.abs(c.sf - fA) <= 1);
			let clip = null;
			if (cands.length) {
				const ds = cands.map((c) => ({ c, d: detailOf(c) }));
				if (ds.some((x) => x.d === null)) return;
				const ae = ds.filter((x) => x.d && x.d.kind === "ae");
				const hits = ae.filter((x) => (x.d.texts || []).some((t) => {
					const n = normText(t);
					return !!n && caps.some((cp) => n.indexOf(cp) !== -1);
				}));
				if (hits.length > 1) return skip(id, "ambiguous", "문장이 맞는 클립 " + hits.length + "개");
				if (hits.length === 1) clip = hits[0].c;
				else if (ae.length === 1) {
					if (!o.uncertain) {
						out.uncertain.push(id);
						return skip(id, "uncertain", clipText(ae[0].c));
					}
					clip = ae[0].c;
				} else if (ae.length > 1) return skip(id, "ambiguous", "같은 자리 클립 " + ae.length + "개");
			}
			// 못 찾았다: 놓인 적 없는 줄·↑만 새로 놓는다 (위 설명)
			const fresh = typeof r.fresh === "boolean" ? r.fresh : legacyFresh(rs, null, id);
			if (!clip && !fresh && !o.placeMissing) return skip(id, "missing", "V" + (T + 1) + " " + loc.s.toFixed(1) + "초");
			// 보낼 속성. 캡션이 바뀌었나: 타임라인에 있는 문장(ap.cap → mmPrev.cap)과 다르거나, 찾은 클립의 문장(되읽기)에 줄 캡션이 없다
			// (v27로 놓은 목록은 ap가 없고, 병합 뒤 패널에서 고친 캡션은 mm이 'time'이어도 클립에 없다)
			const unsafe = !!r.unsafe;
			const capN = cap !== null ? normText(cap) : null;
			const onTl = rs.ap && typeof rs.ap.cap === "string" ? rs.ap.cap : rs.mmPrev && typeof rs.mmPrev.cap === "string" ? rs.mmPrev.cap : null;
			const clipD = clip ? details[clip.nodeId] : null;
			const capChanged = capN !== null && ((onTl !== null && normText(onTl) !== capN) || (!!clip && !((clipD && clipD.texts) || []).some((t) => normText(t) === capN)));
			let params;
			if (!clip || o.full || unsafe || FULL_MM[rs.mm]) params = all;
			else if (TEXT_MM[rs.mm] || capChanged) {
				if (!capR || !capR.param) return skip(id, "no-caption");
				params = [capR.param];
			} else params = [];
			const uid = "r" + id;
			const durSec = Number(preset.mogrtDurSec) || Number(durs[normPath(preset.mogrtPath)]) || PLACE_DUR_FALLBACK;
			const D = ft > 0 ? Math.round((durSec * TICKS_PER_SEC) / ft) : 0;
			const base = { uid, key: uid, id, g: 0, track: T, m: preset.mogrtPath, durSec, D, name: null, removeAfter: null, presetId: rs.presetId || "", kind: "ae" };
			if (!clip) {
				ops.push(Object.assign({}, base, { op: "place", phase: 4, sf, ef, own: null, params, src: null }));
				return;
			}
			claimed[clip.nodeId] = true;
			const own = { track: clip.track, sf: clip.sf, nodeId: clip.nodeId };
			const src = { track: clip.track, sf: clip.sf, ef: clip.ef, nodeId: clip.nodeId, name: clip.name, g: 0 };
			const moved = rowTimeChanged(rs, sub) && (Math.abs(clip.sf - sf) > 1 || Math.abs(clip.ef - ef) > 1);
			if (moved) {
				ops.push(Object.assign({}, base, { op: "move", phase: 3, sf, ef, own, params, src, alt: { params: all } }));
				return;
			}
			if (!params.length) {
				out.rowOps[id] = { none: true, nodeId: clip.nodeId };
				return;
			}
			ops.push(Object.assign({}, base, { op: "update", phase: 2, sf: clip.sf, ef: clip.ef, keepTime: true, own, params, src }));
		});
		if (pending) return out;
		const ord = orderOps(ops);
		const st = {};
		(scan.tracks || []).forEach((t) => {
			st[t.i] = (t.clips || []).map((c) => {
				const w = owners[String(c.nodeId)];
				return { id: String(c.nodeId), sf: c.sf, ef: c.ef, own: !!(w && w.m) || !!claimed[String(c.nodeId)], name: c.name || "" };
			});
		});
		const sim = simulateOps(st, ord.ordered, ord.removals);
		sim.bad.forEach((b) => { out.rowOps[b.op.id] = { skip: "conflict", why: b.why, detail: simConflictText(b, ft) }; });
		const bad = {};
		sim.bad.forEach((b) => { bad[b.op.uid] = true; });
		out.removals = ord.removals.filter((x) => !bad[x.uid]);
		out.ops = sim.ok;
		out.ops.forEach((op) => { out.rowOps[op.id] = op; });
		return out;
	}

	// ── 타임라인 검수 (읽기만, S3-3) ──
	// 화자 줄마다 타임라인의 우리 클립(태그)을 마지막 적용 기록(mi.applied)·지금 줄과 비교해 분류한다. 아무것도 쓰지 않는다.
	// 패널이 getTracks(모든 비디오 트랙, V1 빼고)·readClipTexts(현재 클립, 40개씩)·planPlacement(마른 계획)를 모아 넘긴다.
	// 줄 분류 (한 줄이 여럿일 수 있다. 하나도 없으면 정상):
	//   dup        같은 태그의 현재 클립이 둘 이상 (자르기) — 나머지는 보지 않는다
	//   missing    적용했던 줄(applied)인데 클립이 없다 (Premiere에서 지움)
	//   moved      클립 자리(트랙·시작·끝)가 마지막 적용 자리와 1프레임 넘게 다르다 (Premiere에서 옮기거나 길이를 바꿈)
	//   edited     AE 클립의 텍스트가 우리가 쓴 직후(applied.rh)와 다르다 (Premiere에서 고침)
	//   oldVersion 클립의 속성 구조(clipLs)가 프리셋이 배운 구조(mogrtLs)와 다르다 (MOGRT를 다시 저장하기 전 클립)
	//   decorated  효과가 늘었거나 Motion·Opacity에 키 (템플릿 자체의 키는 뺀다, decoratedOf)
	//   unapplied  아직 적용하지 않은 변경: 클립이 없고 적용한 적도 없다, 병합 표시(mm), 템플릿 종류·경로가 다름,
	//              지금 의도 해시(plan.intentOf)가 마지막 적용(applied.h)과 다름 (속성·트랙·시간·이름), 적용 기록 없음
	// 네이티브 클립은 Source Text가 ""로 읽혀 텍스트로 확인할 수 없다: 다른 분류가 없으면 정상 대신 native(확인 불가)로 센다.
	// 클립 분류: stale(옛 gen — 중단된 적용이 남긴 클립), orphan(목록에 없는 줄의 우리 클립).
	// inp {rows: [{sub, rs, preset}] (화자 줄), allRows: 살아 있는 줄 전부, mi: {salt, applied}, scan, details, plan}
	// → {counts: {ok, missing, …, native}, items: [{cat, id, uid, label, track, sf, ef, name, detail, clips?}], text: 요약 글, frameTicks, salt}
	const VERIFY_CATS = [["ok", "정상"], ["missing", "타임라인에 없음"], ["moved", "옮겨짐"], ["dup", "같은 태그 중복"], ["stale", "옛 세대"],
		["edited", "Premiere에서 고침"], ["oldVersion", "옛 버전 템플릿"], ["decorated", "효과·키프레임"], ["unapplied", "미적용"], ["orphan", "목록에 없는 클립"]];
	const VERIFY_NATIVE_LABEL = "확인 불가(네이티브)";
	// "정상 118 · 타임라인에 없음 1 · … · 목록에 없는 클립 1" (+ 네이티브가 있으면 " · 확인 불가(네이티브) N")
	function verifySummaryText(counts) {
		const c = counts || {};
		const parts = VERIFY_CATS.map((x) => x[1] + " " + (c[x[0]] || 0));
		if (c.native) parts.push(VERIFY_NATIVE_LABEL + " " + c.native);
		return parts.join(" · ");
	}
	function verifyReport(inp) {
		const o = inp || {};
		const mi = o.mi || miDefault();
		const salt = String(mi.salt || "");
		const applied = mi.applied || {};
		const scan = o.scan || { tracks: [] };
		const ft = Number(scan.frameTicks) || 0;
		const details = o.details || {};
		const plan = o.plan || null;
		const idx = scanIndex(scan, salt);
		const counts = { native: 0 };
		VERIFY_CATS.forEach((x) => { counts[x[0]] = 0; });
		const items = [];
		const byId = {};
		(o.allRows || (o.rows || []).map((r) => r.sub)).forEach((s) => { if (s) byId[s.id] = s; });
		const secOf = (f) => (ft > 0 ? (f * ft) / TICKS_PER_SEC : 0);
		const place = (t, sf, ef) => "V" + (t + 1) + " " + secOf(sf).toFixed(2) + "~" + secOf(ef).toFixed(2);
		const where = (c) => ({ track: c.track, sf: c.sf, ef: c.ef, nodeId: c.nodeId, name: c.name });
		(o.rows || []).forEach((r) => {
			const sub = r && r.sub;
			if (!sub) return;
			const rs = r.rs || {};
			const preset = r.preset || null;
			const uid = salt ? salt + "-" + sub.id : null;
			const ap = uid && applied[uid] && typeof applied[uid] === "object" ? applied[uid] : null;
			const base = { id: sub.id, uid, label: rowLabel(sub, true) };
			const flags = [];
			const add = (cat, extra) => flags.push(Object.assign({ cat }, base, extra));
			const dups = uid ? idx.dup[uid] : null;
			const cur = uid ? idx.current[uid] || null : null;
			let kind = "";
			if (dups) add("dup", Object.assign(where(dups[0]), { clips: dups.map(where), detail: "같은 태그 클립 " + dups.length + "개 (자르기?)" }));
			else if (!cur) {
				if (ap && typeof ap.t === "number") add("missing", { track: ap.t, sf: ap.sf, ef: typeof ap.cef === "number" ? ap.cef : ap.ef, detail: place(ap.t, ap.sf, typeof ap.cef === "number" ? ap.cef : ap.ef) + "에 있던 클립이 없음" });
				else add("unapplied", { track: null, sf: ft > 0 ? frameOf(sub.startSec, ft) : null, ef: ft > 0 ? frameOf(sub.endSec, ft) : null, detail: preset ? "아직 타임라인에 없음" : "프리셋 없음" });
			} else {
				const d = details[cur.nodeId];
				if (!d || d.found === false) add("missing", Object.assign(where(cur), { detail: "스캔 뒤 클립이 사라짐" }));
				else {
					kind = String(d.kind || "");
					const at = where(cur);
					if (ap && typeof ap.t === "number" && typeof ap.sf === "number") {
						const cef = typeof ap.cef === "number" ? ap.cef : ap.ef;
						if (cur.track !== ap.t || Math.abs(cur.sf - ap.sf) > 1 || (typeof cef === "number" && Math.abs(cur.ef - cef) > 1)) {
							add("moved", Object.assign({}, at, { detail: place(ap.t, ap.sf, cef) + " → " + place(cur.track, cur.sf, cur.ef) }));
						}
					}
					if (kind === "ae" && ap && ap.rh && textsHash(d.texts) !== ap.rh) {
						const t = (d.texts || []).map((x) => String(x == null ? "" : x)).filter(Boolean).join(" / ");
						add("edited", Object.assign({}, at, { detail: "클립 문장: " + (t.length > 60 ? t.slice(0, 59) + "…" : t) }));
					}
					const want = preset ? (isNativeList(preset.params) ? "native" : "ae") : kind;
					const tChanged = !!preset && (kind !== want || (kind === "ae" && !!ap && !!ap.m && normPath(ap.m) !== normPath(preset.mogrtPath)));
					if (kind === "ae" && preset && !tChanged && preset.mogrtLs && Array.isArray(d.lay) && clipLs(d.lay) !== preset.mogrtLs) add("oldVersion", Object.assign({}, at, { detail: "MOGRT를 다시 저장하기 전 구조" }));
					if (decoratedOf(d, preset)) {
						const k = d.deco && Array.isArray(d.deco.keyed) ? d.deco.keyed : [];
						add("decorated", Object.assign({}, at, { detail: (k.length ? "키: " + k.map((x) => String(x).replace(/^AE\.ADBE /, "")).join(", ") : "효과 " + ((d.deco && d.deco.comps) || 0) + "개") }));
					}
					const hNow = plan && plan.intentOf ? plan.intentOf[sub.id] : undefined;
					let why = "";
					if (tChanged) why = "템플릿이 바뀜";
					else if (!ap) why = "마지막 적용 기록 없음";
					else if (rs.mm) why = "바뀐 줄 (변경 표시)";
					else if (hNow !== undefined && hNow !== ap.h) why = "패널에서 바뀐 값이 있음";
					if (why) add("unapplied", Object.assign({}, at, { detail: why }));
				}
			}
			if (!flags.length) {
				if (cur && ((preset && isNativeList(preset.params)) || (kind && kind !== "ae"))) counts.native++;
				else counts.ok++;
				return;
			}
			flags.forEach((f) => {
				counts[f.cat]++;
				items.push(f);
			});
		});
		// 클립 분류: 옛 gen, 목록에 없는 줄의 클립 (가장 높은 gen — 자른 조각이면 여럿)
		idx.stale.forEach((c) => {
			counts.stale++;
			items.push(Object.assign({ cat: "stale", id: c.id, uid: c.uid, label: byId[c.id] ? rowLabel(byId[c.id], true) : null, g: c.g, detail: "옛 gen " + c.g + " (" + place(c.track, c.sf, c.ef) + ")" }, where(c)));
		});
		Object.keys(idx.own).forEach((uid) => {
			const list = idx.own[uid];
			if (!list.length || byId[list[0].id]) return;
			list.filter((c) => c.g === list[0].g).forEach((c) => {
				counts.orphan++;
				items.push(Object.assign({ cat: "orphan", id: c.id, uid: c.uid, label: null, g: c.g, detail: c.name }, where(c)));
			});
		});
		return { counts, items, text: verifySummaryText(counts), frameTicks: ft, salt };
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
		_restoreTrashItem(item);
		renderAll();
		renderTrash();
		saveSessionToStorage();
		_setStatus$3("자막 " + (item.sub.spk && _castMode() ? rowLabel(item.sub, true) : item.sub.index) + "번 복구됨", "ok");
	}
	// 휴지통 항목 하나를 목록에 되넣는다.
	//   화자 줄: (시작 시각, 화자 순서) 자리에 넣고 그 화자의 번호를 다시 매긴다. 화자 표에 없는 화자면 다시 만든다 (S2-3)
	//   화자 없는 줄: v27 그대로 지웠던 자리(position, 목록 길이를 넘으면 끝)에
	function _restoreTrashItem(item) {
		const sub = item.sub;
		if (sub && sub.spk) {
			_ensureCastEntry(sub.spk);
			const order = state.mi.castOrder;
			const rank = (s) => (s && s.spk ? order.indexOf(s.spk) : -1);
			const t = sub.startSec || 0;
			let pos = state.subtitles.findIndex((s) => (s.startSec || 0) > t || ((s.startSec || 0) === t && rank(s) > rank(sub)));
			if (pos === -1) pos = state.subtitles.length;
			state.subtitles.splice(pos, 0, sub);
			state.rowStates[sub.id] = item.state;
			renumberRows(state.subtitles, sub.spk);
			return;
		}
		const pos = Math.min(item.position, state.subtitles.length);
		state.subtitles.splice(pos, 0, sub);
		state.rowStates[sub.id] = item.state;
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
			// 화자 없는 줄은 v27처럼 자리 순서로 먼저, 화자 줄은 그다음 (시작 시각, 화자 순서) 자리에 (_restoreTrashItem)
			sorted.filter((item) => !(item.sub && item.sub.spk)).forEach(_restoreTrashItem);
			sorted.filter((item) => item.sub && item.sub.spk).forEach(_restoreTrashItem);
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
		const users = state.subtitles.filter((sub) => state.rowStates[sub.id]?.presetId === pid);
		let msg = "\"" + state.presets[pid].name + "\" 프리셋을 삭제하시겠습니까?";
		// 다화자 목록은 줄 주소 "C2·12" (S2-3), 단일 화자는 v27 문구 그대로
		if (users.length > 0 && _castMode()) msg += "\n\n⚠ 이 프리셋은 자막 " + users.map((sub) => rowLabel(sub, true)).join(", ") + "에 적용되어 있습니다.\n삭제하면 해당 자막의 프리셋 설정이 초기화됩니다.";
		else if (users.length > 0) msg += "\n\n⚠ 이 프리셋은 자막 " + users.map((sub) => sub.index).join(", ") + "번에 적용되어 있습니다.\n삭제하면 해당 자막의 프리셋 설정이 초기화됩니다.";
		const castUsers = _castKeys().filter((K) => state.mi.cast[K].presetId === pid);
		if (castUsers.length > 0) msg += "\n⚠ 화자 기본 프리셋: " + castUsers.map((K) => K + " " + _castName(K)).join(", ") + " — 삭제하면 비워집니다.";
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
				// v27은 "sub-row no-mogrt"로 덮어 체크 표시·필터 클래스가 빠졌다 → _buildRowClass + 아래에서 필터를 다시 건다 (S2-3)
				if (row) row.className = _buildRowClass(sub.id, rs, sub);
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
		// 화자 표의 기본 프리셋이 이 프리셋이면 비운다 (프리셋 휴지통에서 되살려도 다시 이어지지 않는다)
		const cast = (state.mi && state.mi.cast) || {};
		Object.keys(cast).forEach((K) => { if (cast[K] && cast[K].presetId === pid) cast[K].presetId = ""; });
		_reapplyFilters();
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
			// 네이티브 템플릿: 스크립트로 쓴 텍스트는 빈 글자로 그려진다 (S1-11) → 지금 문구를 구운 사본을 놓고 속성은 쓰지 않는다.
			// 굽지 못하면 원본(템플릿 기본 문구)을 놓는다
			const native = isNativeList(list);
			let placePath = mogrtPath;
			if (native) {
				if (statusEl) statusEl.textContent = "네이티브 템플릿에 문구 굽는 중...";
				const bk = await bakeNativeMogrt(mogrtPath, nativeTexts(list));
				if (bk.ok) placePath = bk.path;
				else console.warn("[MOGRT] 네이티브 미리보기 굽기 실패 (기본 문구로 봅니다):", _bakeWhy(bk));
			}
			// 1. 프리뷰 시퀀스 생성 + mogrt 삽입
			const setupRes = await host.setupPreviewSequence({
				mogrtPath: placePath,
				durationSec: 5
			});
			if (!setupRes.startsWith("SUCCESS")) {
				if (statusEl) { statusEl.textContent = "시퀀스 생성 실패: " + setupRes; statusEl.style.color = "#f66"; }
				_previewRunning = false;
				return;
			}
			_previewSeqKnown[state.currentProjectKey] = true;
			if (statusEl) statusEl.textContent = "파라미터 적용 중...";
			// 2. 현재 파라미터 적용 (네이티브는 구운 사본에 이미 들어 있다)
			if (!native) await host.applyPreviewParams({ params: list });
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
	// 프리셋 창이 열려 있는 동안 v27 호스트(역방향 동기화 getPreviewClipParams 등)가 활성 시퀀스를
	// __MOGRT_PREVIEW__로 바꿔 둔 채 끝날 수 있다(4K 템플릿에서 실측). 창을 열 때의 작업 시퀀스를 기억했다가
	// 창을 닫을 때(저장·취소) 되돌린다. 호스트 호출은 차례대로 실행되므로 진행 중인 폴링 뒤에 되돌린다.
	var _modalSeqBefore = null;
	function _rememberModalSequence() {
		if (_modalSeqBefore) return;
		host.getActiveSequenceInfo().then((i) => {
			if (i && i.seqId && i.seqName !== "__MOGRT_PREVIEW__" && !_modalSeqBefore) _modalSeqBefore = i;
		}).catch(() => {});
	}
	function _restoreModalSequence() {
		const b = _modalSeqBefore;
		_modalSeqBefore = null;
		if (b) _restoreActiveSequence(b);
	}
	function openPresetModal(presetId) {
		_rememberModalSequence();
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
			// 값이 비었거나 자리표시 한 글자면 템플릿 기본 문구를 기본값으로 (손대지 않은 필드가 빈 글자로 구워지지 않게)
			const defaults = nativeTextDefaults(def, texts.length, _uiLocale());
			if (defaults) texts.forEach((p, k) => { if (String(p.value == null ? "" : p.value).length <= 1) p.value = defaults[k]; });
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
			_restoreModalSequence();
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
			// 1차 창(defaultModal)이 이미 닫혀 있으면 여기서 되돌린다 (편집 버튼으로 바로 연 경우)
			if (!document.getElementById("defaultModal")?.classList.contains("open")) _restoreModalSequence();
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
			// 저장 전 프리셋 (줄의 캡션 찾기·기본값 거르기, 학습 필드)
			const oldPreset = state.presets[presetId] ? JSON.parse(JSON.stringify(state.presets[presetId])) : null;
			const buildPreset = () => {
				const next = {
					id: presetId,
					name: presetName,
					mogrtPath,
					params: JSON.parse(JSON.stringify(modalState.paramList)),
					exposedIndices: [...modalState.exposedIndices],
					textParamIndex: modalState.textParamIndex,
					exposedFontFields: JSON.parse(JSON.stringify(modalState.exposedFontFields)),
					thumbnailData: _lastPreviewSrc || (state.presets[presetId]?.thumbnailData ?? null)
				};
				// 배치에서 배운 필드는 MOGRT가 그대로일 때만 가져간다 (v27은 이 필드를 모른다).
				// 경로가 같아도 속성 구조가 바뀌었으면(같은 파일을 다시 만든 MOGRT, 계획서 §0.5) 옛 버전의 값이라 버린다
				// → 다음 새 배치에서 다시 배운다 (mogrtLs가 옛 버전을 가리키면 S2의 oldVersion 판정이 뒤집힌다)
				if (oldPreset && oldPreset.mogrtPath === mogrtPath && paramSig(oldPreset.params) === paramSig(next.params)) {
					PRESET_LEARNED_FIELDS.forEach((k) => { if (oldPreset[k] !== undefined) next[k] = oldPreset[k]; });
				}
				return next;
			};
			const rowsOf = () => usedBy.map((subId) => state.subtitles.find((s) => s.id === subId)).filter(Boolean);
			const doSave = () => {
				// 이 프리셋을 쓰는 줄의 속성을 맞추기 전에 안전 지점을 남긴다
				if (usedBy.length > 0) _saveSafety("프리셋 저장 전: " + presetName);
				state.presets[presetId] = buildPreset();
				savePresetsToStorage();
				renderPresetList();
				// 줄은 T-ID 기준으로 새 구조에 맞춘다 (텍스트 필드·줄마다 바꾼 노출 속성 유지, 못 옮긴 텍스트는 줄에 남김).
				// 속성이 없던 줄은 v27처럼 프리셋에서 채운다 (S1-10)
				rowsOf().forEach((sub) => {
					if (!_rebaseRowTo(sub, state.rowStates[sub.id], state.presets[presetId], oldPreset, false)) loadParamsFromPreset(sub.id, presetId, sub.text, false);
				});
				if (usedBy.length > 0) saveSessionToStorage();
				refreshAllSelects();
				updateMultiSelect();
				closePresetEdit();
				closeModal();
				_setStatus$1("프리셋 저장: " + presetName, "ok");
			};
			if (usedBy.length > 0 && modalState.presetId) {
				const next = buildPreset();
				const orphans = rowsOf().reduce((n, sub) => {
					const r = _rebaseRowTo(sub, state.rowStates[sub.id], next, oldPreset, true);
					return n + (r ? r.added : 0);
				}, 0);
				showConfirm(`이 프리셋은 현재 ${usedBy.length}개의 자막에 사용 중입니다.\n저장하면 해당 자막의 속성이 업데이트됩니다.\n텍스트 필드와 줄마다 바꾼 노출 속성은 유지됩니다.` +
					(orphans ? `\n자리를 찾지 못한 텍스트 ${orphans}개는 줄에 따로 남깁니다.` : "") + "\n계속하시겠습니까?", doSave);
			} else doSave();
		});
	}
	//#endregion
	//#region src/ui/cast.ts
	// ─────────────────────────────────────────────────────────────
	// 화자 표 (#castBar), 화자 칩 (#speakerChips), 필터 다시 걸기 (S2-3)
	//
	// 화자 표는 state.mi.cast / castOrder (session.json의 mi, cast.json 사본). 화자가 있을 때만 보인다 → 단일 화자 화면은 v27 그대로.
	//   한 줄에 한 화자: 색 점(누르면 8색 순환) · 키(누르면 그 화자만 보기) · 이름 · 트랙("자동 (V4)" 또는 고정) · 기본 프리셋 · 줄 수 · ⋯
	//   ⋯ 메뉴: 이 화자 줄에 기본 프리셋 적용 (안전 지점 '기본 프리셋 일괄 적용 전: C2', 다른 프리셋이 걸린 줄이 있으면 묻는다),
	//          이 화자 줄 선택, 화자 삭제 (줄은 휴지통으로)
	//   고치면 session.json·cast.json(saveSessionToStorage)과 프로젝트의 cast_defaults.json을 쓰고 히스토리에 자동 항목을 남긴다.
	//   색 점은 자주 누르는 표시라 히스토리에는 남기지 않는다 (저장은 한다).
	//   트랙 표시는 core resolveTracks를 스캔 없이 돌린 미리보기다 (_castTrackPreview). 실제 배치는 타임라인 스캔으로 다시 정한다.
	// 화자 칩: 화자가 둘 이상일 때 "전체 · C1 철수 · C2 영희" (여럿 고를 수 있다). 고르지 않은 화자의 줄은 .speaker-filter-hidden.
	//   숨긴 줄은 체크를 푼다 (프리셋 필터와 같다 → '선택 삭제'가 숨은 줄을 지우지 않는다).
	// 필터 다시 걸기 (_reapplyFilters): 줄의 className을 새로 쓰면 검색·프리셋·화자 필터 클래스가 빠진다 → 새로 쓴 뒤마다 부른다.
	//   부팅 중에는 renderAll이 main.ts의 필터 선언보다 먼저 돈다 → _filtersReady가 거짓이면 바로 돌아간다 (TDZ)
	// ─────────────────────────────────────────────────────────────
	const CAST_COLOR_HEX = ["#42a5f5", "#ef5350", "#66bb6a", "#ffa726", "#ab47bc", "#26c6da", "#d4e157", "#ec407a"];
	// 트랙 선택지 V2..V10 (#trackSel과 같다)
	const CAST_TRACK_LAST = 9;
	// 화자 표 접기 상태 (localStorage, 창마다)
	const CAST_FOLD_KEY = "mogrt_castFold";
	function _castKeys() {
		const mi = state.mi || miDefault();
		return (mi.castOrder || []).filter((K) => mi.cast && mi.cast[K]);
	}
	function _castColorHex(K) {
		const c = state.mi && state.mi.cast ? state.mi.cast[K] : null;
		const n = c && typeof c.color === "number" && isFinite(c.color) ? c.color : 0;
		return CAST_COLOR_HEX[((n % CAST_COLORS) + CAST_COLORS) % CAST_COLORS];
	}
	function _castName(K) {
		const c = state.mi && state.mi.cast ? state.mi.cast[K] : null;
		return (c && String(c.name || "").trim()) || K;
	}
	function _trackName(i) {
		return "V" + (i + 1);
	}
	// 줄의 화자 줄무늬 (다화자 목록의 화자 줄만. 단일 화자 줄에는 style을 쓰지 않는다 → v27 DOM 그대로)
	function _applyRowStripe(row, sub) {
		if (!row || !sub || !sub.spk || !_castMode()) return;
		row.style.borderLeft = "3px solid " + _castColorHex(sub.spk);
	}
	function _refreshCastStripes() {
		state.subtitles.forEach((sub) => _applyRowStripe(document.getElementById("row-" + sub.id), sub));
	}
	// 화자마다 줄 구간 [[시작 초, 끝 초]] (트랙 미리보기의 고정 트랙 겹침 확인용)
	function _castSpansSec() {
		const spans = {};
		state.subtitles.forEach((s) => {
			if (s && s.spk) (spans[s.spk] = spans[s.spk] || []).push([s.startSec, s.endSec]);
		});
		return spans;
	}
	// 트랙 미리보기 (core resolveTracks, 스캔 없이): 기본 트랙은 #trackSel
	function _castTrackPreview() {
		const base = _trackValueNum();
		return resolveTracks(state.mi.castOrder, state.mi.cast, base === null ? 2 : base, { spans: _castSpansSec(), numTracks: _miNumTracks });
	}
	function _castFolded() {
		try {
			return localStorage.getItem(CAST_FOLD_KEY) === "1";
		} catch (_) {
			return false;
		}
	}
	function renderCastBar() {
		const bar = document.getElementById("castBar");
		const box = document.getElementById("castRows");
		if (!bar || !box) return;
		const order = _castKeys();
		_closeCastMenu();
		box.innerHTML = "";
		// 검수 버튼은 화자 표가 있을 때만 (S3-3). 단일 화자 적용 바는 v27 그대로
		const vb = document.getElementById("btnVerify");
		if (vb) vb.style.display = order.length ? "" : "none";
		if (!order.length) {
			bar.style.display = "none";
			_renderCastTrackSummary(null);
			if (_castToastKey) _hideCastToast(false);
			return;
		}
		bar.style.display = "";
		const folded = _castFolded();
		bar.classList.toggle("folded", folded);
		const title = document.getElementById("castTitle");
		if (title) title.textContent = "화자 " + order.length + "명";
		const fold = document.getElementById("btnCastFold");
		if (fold) fold.textContent = folded ? "펼치기" : "접기";
		const pv = _castTrackPreview();
		const counts = _castCounts();
		const choices = _impPresetChoices();
		order.forEach((K) => box.appendChild(_castRowEl(K, pv, counts[K] || 0, choices)));
		_renderCastTrackSummary(pv);
	}
	// 적용 바: 다화자면 트랙 칸 이름이 '기본 트랙'이고 옆에 "C1→V3 · C2→V4 (새)" (S2-4). 단일 화자는 v27 그대로 '트랙'
	function _renderCastTrackSummary(pv) {
		const lbl = document.getElementById("trackSelLabel");
		const sum = document.getElementById("castTrackSummary");
		const order = pv ? _castKeys().filter((K) => pv.tracks[K]) : [];
		if (lbl) lbl.textContent = order.length ? "기본 트랙" : "트랙";
		if (!sum) return;
		if (!order.length) {
			sum.style.display = "none";
			sum.textContent = "";
			return;
		}
		sum.style.display = "";
		sum.textContent = order.map((K) => K + "→" + _trackName(pv.tracks[K].track) + (pv.tracks[K].create ? " (새)" : "")).join(" · ");
		sum.title = order.map((K) => K + " " + _castName(K) + " → " + _trackName(pv.tracks[K].track) + (pv.tracks[K].auto ? " (자동)" : " (고정)")).join("\n");
	}
	function _castCounts() {
		const counts = {};
		state.subtitles.forEach((s) => { if (s && s.spk) counts[s.spk] = (counts[s.spk] || 0) + 1; });
		return counts;
	}
	// 줄 수만 다시 쓴다 (줄을 지우거나 되살린 뒤, updateMultiSelect에서. 입력 중인 이름 칸을 다시 만들지 않는다)
	function _updateCastCounts() {
		const box = document.getElementById("castRows");
		if (!box) return;
		const counts = _castCounts();
		box.querySelectorAll(".cast-row").forEach((row) => {
			const el = row.querySelector(".cast-count");
			if (el) el.textContent = (counts[row.dataset.key] || 0) + "줄";
		});
	}
	function _castRowEl(K, pv, count, choices) {
		const c = state.mi.cast[K];
		const row = document.createElement("div");
		row.className = "cast-row";
		row.dataset.key = K;
		row.style.borderLeftColor = _castColorHex(K);
		const dot = document.createElement("span");
		dot.className = "cast-dot";
		dot.style.background = _castColorHex(K);
		dot.title = "화자 색 (누르면 바뀝니다)";
		dot.addEventListener("click", (e) => {
			e.stopPropagation();
			c.color = ((typeof c.color === "number" ? c.color : 0) + 1) % CAST_COLORS;
			_castCommit(K, null);
			_refreshCastStripes();
		});
		const key = document.createElement("span");
		key.className = "cast-key" + (_speakerFilter.has(K) ? " filtered" : "");
		key.textContent = K;
		key.title = "누르면 이 화자 줄만 보기 (다시 누르면 풀림)";
		key.addEventListener("click", (e) => {
			e.stopPropagation();
			_toggleSpeakerFilter(K);
		});
		const name = document.createElement("input");
		name.type = "text";
		name.className = "cast-name";
		name.value = String(c.name || "");
		name.placeholder = K;
		name.title = "화자 이름 (클립 이름에 들어갑니다)";
		name.addEventListener("keydown", (e) => {
			if (e.key === "Enter") name.blur();
		});
		name.addEventListener("change", () => {
			const v = String(name.value || "").trim() || K;
			if (v === c.name) return;
			_castSetItems([{ key: K, name: v }], { label: "화자 이름: " + K + " " + v });
		});
		const track = document.createElement("select");
		track.className = "cast-track";
		track.title = "이 화자의 비디오 트랙 (자동: 첫 화자는 기본 트랙, 다음 화자는 그 위의 빈 트랙)";
		_fillCastTrackOptions(track, K, pv);
		track.addEventListener("change", () => {
			const v = track.value === "" ? null : parseInt(track.value, 10);
			const t = v === null || !isFinite(v) ? null : v;
			_castSetItems([{ key: K, track: t }], { label: "화자 트랙: " + K + " " + (t === null ? "자동" : _trackName(t)) });
		});
		const preset = document.createElement("select");
		preset.className = "cast-preset";
		preset.title = "기본 프리셋 (새 줄과 '이 화자 줄에 기본 프리셋 적용'에 쓴다)";
		const none = document.createElement("option");
		none.value = "";
		none.textContent = "-- 기본 프리셋 --";
		preset.appendChild(none);
		const list = choices.slice();
		if (c.presetId && state.presets[c.presetId] && !list.some((x) => x[0] === c.presetId)) list.push([c.presetId, state.presets[c.presetId].name || c.presetId]);
		list.forEach(([id, nm]) => {
			const o = document.createElement("option");
			o.value = id;
			o.textContent = nm;
			preset.appendChild(o);
		});
		preset.value = c.presetId && state.presets[c.presetId] ? c.presetId : "";
		preset.addEventListener("change", () => {
			const pid = preset.value;
			_castSetItems([{ key: K, presetId: pid }], { label: "화자 기본 프리셋: " + K + " " + (pid ? state.presets[pid].name || pid : "없음") });
		});
		const cnt = document.createElement("span");
		cnt.className = "cast-count";
		cnt.textContent = count + "줄";
		// ⟳ 다시 가져오기 (S3-3): 기억한 파일 경로에서 읽어 가져오기 창을 병합으로 연다 (경로를 모르면 파일을 고른다)
		const re = document.createElement("button");
		re.className = "cast-reimport";
		re.textContent = "⟳";
		re.title = c.path ? "다시 가져오기 (병합): " + c.path : "다시 가져오기 (병합) — 파일을 고릅니다";
		re.addEventListener("click", (e) => {
			e.stopPropagation();
			_castReimport(K);
		});
		const more = document.createElement("button");
		more.className = "cast-more";
		more.textContent = "⋯";
		more.title = "이 화자";
		more.addEventListener("click", (e) => {
			e.stopPropagation();
			_openCastMenu(row, K);
		});
		[dot, key, name, track, preset, cnt, re, more].forEach((el) => row.appendChild(el));
		return row;
	}
	// 트랙 선택지: "자동 (V4)" + V2..V10 (다른 화자가 쓰는 트랙은 "(철수)", 아직 없는 트랙은 "(새로 만듦)")
	function _fillCastTrackOptions(sel, K, pv) {
		const c = state.mi.cast[K];
		const mine = pv.tracks[K] || null;
		const pinned = typeof c.track === "number" && c.track >= 0;
		const users = {};
		Object.keys(pv.tracks).forEach((k) => {
			if (k !== K) (users[pv.tracks[k].track] = users[pv.tracks[k].track] || []).push(_castName(k));
		});
		const isNew = (i) => _miNumTracks !== null && i >= _miNumTracks;
		const auto = document.createElement("option");
		auto.value = "";
		auto.textContent = !pinned && mine ? "자동 (" + _trackName(mine.track) + (isNew(mine.track) ? ", 새로 만듦" : "") + ")" : "자동";
		sel.appendChild(auto);
		let last = CAST_TRACK_LAST;
		if (mine && mine.track > last) last = mine.track;
		if (pinned && c.track > last) last = c.track;
		for (let i = 1; i <= last; i++) {
			const o = document.createElement("option");
			o.value = String(i);
			o.textContent = _trackName(i) + (users[i] ? " (" + users[i].join(", ") + ")" : "") + (isNew(i) ? " (새로 만듦)" : "");
			sel.appendChild(o);
		}
		sel.value = pinned ? String(c.track) : "";
	}
	// 화자 표를 고친 뒤: 저장(session.json·cast.json) → cast_defaults.json → 히스토리 자동 항목(label이 있을 때) → 다시 그리기
	function _castCommit(K, label) {
		saveSessionToStorage();
		_saveCastDefaults([K]);
		if (label) _saveHistoryOnAction(label);
		renderCastBar();
		renderSpeakerChips();
	}
	// 화자 표 바꾸기 (화자 표의 이름·트랙·기본 프리셋 칸과 runCommand cast.set이 같이 쓴다, S3-1).
	// items [{key, name?, track?, presetId?, pos?}] — 모두 확인한 뒤에만 바꾼다 (하나라도 틀리면 아무것도 바꾸지 않는다):
	//   name: 앞뒤 공백을 뺀 값, 비면 키 · track: null(자동) | 1..98 (V2..V99, 0-기준 트랙 번호) ·
	//   presetId: "" | 캡션 필드가 있는 프리셋 (지금 값 그대로는 늘 된다) · pos: null | {x, y} 0~1 (4단계 화면 위치)
	// 바뀐 것이 있으면: session.json·cast.json → cast_defaults.json → 히스토리 자동 항목(opts.label, 없으면 "화자 표: C2 이름 영희 · …") → 다시 그리기.
	// 화자 표 칸(opts.label)에서 틀린 값이 오면 상태 줄에 알리고 칸을 되돌린다 → {changed: [키], label} | {error}
	const CAST_SET_FIELDS = ["key", "name", "track", "presetId", "pos"];
	function _castSetItems(items, opts) {
		const o = opts || {};
		const fail = (error) => {
			if (o.label) {
				setStatus(error, "err");
				renderCastBar();
			}
			return { error };
		};
		if (!Array.isArray(items) || !items.length) return fail("items는 [{key, name?, track?, presetId?, pos?}] 배열");
		const mi = state.mi;
		const plan = [];
		const seen = {};
		for (const it of items) {
			if (!it || typeof it !== "object" || Array.isArray(it)) return fail("items[]는 객체");
			const K = it.key;
			if (typeof K !== "string" || !mi.cast || !mi.cast[K]) return fail("화자 표에 없는 화자: " + String(K));
			if (seen[K]) return fail(K + "가 두 번 있다");
			seen[K] = true;
			const extra = Object.keys(it).filter((f) => CAST_SET_FIELDS.indexOf(f) === -1);
			if (extra.length) return fail("모르는 칸: " + extra.join(", "));
			const c = mi.cast[K];
			const ch = {};
			if (it.name !== undefined) {
				if (typeof it.name !== "string") return fail(K + " name은 문자열");
				ch.name = it.name.trim() || K;
			}
			if (it.track !== undefined) {
				if (it.track !== null && !(Number.isInteger(it.track) && it.track >= 1 && it.track < MI_SCAN_TRACK_MAX)) return fail(K + " track은 null(자동) 또는 1.." + (MI_SCAN_TRACK_MAX - 1) + " (V2..)");
				ch.track = it.track;
			}
			if (it.presetId !== undefined) {
				const p = it.presetId;
				if (typeof p !== "string") return fail(K + " presetId는 문자열");
				if (p && p !== (c.presetId || "") && (!state.presets[p] || captionFid(state.presets[p]) === null)) return fail(K + ": 캡션 필드가 있는 프리셋이 아니다: " + p);
				ch.presetId = p;
			}
			if (it.pos !== undefined) {
				const v = it.pos;
				const unit = (x) => typeof x === "number" && isFinite(x) && x >= 0 && x <= 1;
				if (v !== null && !(v && typeof v === "object" && unit(v.x) && unit(v.y))) return fail(K + " pos는 null 또는 {x, y} (0~1)");
				ch.pos = v === null ? null : { x: v.x, y: v.y };
			}
			plan.push([K, ch]);
		}
		const changed = [];
		const parts = [];
		plan.forEach(([K, ch]) => {
			const c = mi.cast[K];
			const bits = [];
			if (ch.name !== undefined && ch.name !== c.name) {
				c.name = ch.name;
				bits.push("이름 " + ch.name);
			}
			if (ch.track !== undefined && ch.track !== (typeof c.track === "number" ? c.track : null)) {
				c.track = ch.track;
				bits.push("트랙 " + (ch.track === null ? "자동" : _trackName(ch.track)));
			}
			if (ch.presetId !== undefined && ch.presetId !== (c.presetId || "")) {
				c.presetId = ch.presetId;
				bits.push("기본 프리셋 " + (ch.presetId ? state.presets[ch.presetId].name || ch.presetId : "없음"));
			}
			if (ch.pos !== undefined && stableJson(ch.pos) !== stableJson(c.pos === undefined ? null : c.pos)) {
				c.pos = ch.pos;
				bits.push("위치 " + (ch.pos ? ch.pos.x + ", " + ch.pos.y : "원래대로"));
			}
			if (bits.length) {
				changed.push(K);
				parts.push(K + " " + bits.join(", "));
			}
		});
		if (!changed.length) {
			if (o.label) renderCastBar();
			return { changed, label: "" };
		}
		const label = o.label || "화자 표: " + parts.join(" · ");
		saveSessionToStorage();
		_saveCastDefaults(changed);
		_saveHistoryOnAction(label);
		renderCastBar();
		renderSpeakerChips();
		return { changed, label };
	}
	// ⋯ 메뉴 (열려 있는 것은 하나)
	var _castMenuEl = null;
	function _closeCastMenu() {
		if (_castMenuEl && _castMenuEl.parentNode) _castMenuEl.parentNode.removeChild(_castMenuEl);
		_castMenuEl = null;
	}
	function _openCastMenu(row, K) {
		const wasOpen = !!_castMenuEl && _castMenuEl.dataset.key === K;
		_closeCastMenu();
		if (wasOpen) return;
		const menu = document.createElement("div");
		menu.className = "cast-menu open";
		menu.dataset.key = K;
		const item = (label, act, cls) => {
			const b = document.createElement("button");
			b.textContent = label;
			b.dataset.act = act;
			if (cls) b.className = cls;
			b.addEventListener("click", (e) => {
				e.stopPropagation();
				_closeCastMenu();
				if (act === "preset") _castApplyDefaultPreset(K);
				else if (act === "select") _castSelectRows(K);
				else if (act === "delete") _castDelete(K);
			});
			menu.appendChild(b);
		};
		item("이 화자 줄에 기본 프리셋 적용", "preset");
		item("이 화자 줄 선택", "select");
		item("화자 삭제 (줄은 휴지통으로)", "delete", "danger");
		row.appendChild(menu);
		_castMenuEl = menu;
	}
	document.addEventListener("click", (e) => {
		if (_castMenuEl && !(e.target && typeof e.target.closest === "function" && e.target.closest(".cast-menu"))) _closeCastMenu();
	});
	document.getElementById("btnCastFold")?.addEventListener("click", (e) => {
		e.stopPropagation();
		const next = !_castFolded();
		try { localStorage.setItem(CAST_FOLD_KEY, next ? "1" : "0"); } catch (_) {}
		renderCastBar();
	});
	// 이 화자 줄에 기본 프리셋 적용: 안전 지점을 먼저 남기고, 다른 프리셋이 걸린 줄이 있으면 [모두 적용] [빈 줄만] [취소]로 묻는다.
	// 이미 그 프리셋인 줄은 건드리지 않는다 (후반 작업 값이 그대로). 줄 값은 프리셋에서 새로 채운다 (v27 프리셋 선택과 같다)
	function _castApplyDefaultPreset(K) {
		const c = state.mi.cast[K];
		const pid = c && c.presetId;
		if (!pid || !state.presets[pid]) {
			setStatus(K + " " + _castName(K) + ": 기본 프리셋을 먼저 고르세요", "err");
			return;
		}
		const subs = state.subtitles.filter((s) => s.spk === K);
		const pidOf = (s) => (state.rowStates[s.id] && state.rowStates[s.id].presetId) || "";
		const empty = subs.filter((s) => !pidOf(s));
		const other = subs.filter((s) => pidOf(s) && pidOf(s) !== pid);
		const pname = state.presets[pid].name || pid;
		const seq = _importSeqToken();
		const run = (list) => {
			if (seq !== _importSeqToken()) {
				setStatus("시퀀스가 바뀌어 기본 프리셋 적용을 취소했습니다", "err");
				return;
			}
			if (!list.length) {
				setStatus(K + " " + _castName(K) + ": 바꿀 줄이 없습니다 (모두 '" + pname + "')", "ok");
				return;
			}
			_saveSafety("기본 프리셋 일괄 적용 전: " + K);
			const want = _idSet(list.map((s) => s.id));
			state.subtitles.forEach((sub) => {
				if (!want[sub.id]) return;
				let rs = state.rowStates[sub.id];
				if (!rs) rs = state.rowStates[sub.id] = { presetId: "", params: [], _allParams: [], open: false, checked: false };
				rs.presetId = pid;
				loadParamsFromPreset(sub.id, pid, sub.text, false);
				const row = document.getElementById("row-" + sub.id);
				if (row) row.className = _buildRowClass(sub.id, rs, sub);
				const sel = document.getElementById("sel-" + sub.id);
				if (sel) sel.value = pid;
			});
			saveSessionToStorage();
			_reapplyFilters();
			updateMultiSelect();
			_saveHistoryOnAction("기본 프리셋 일괄 적용: " + K + " (" + list.length + "줄)");
			setStatus(K + " " + _castName(K) + ": 기본 프리셋 '" + pname + "' " + list.length + "줄에 적용 (바꾸기 전 상태는 안전 지점에 있습니다)", "ok");
		};
		if (!other.length) {
			run(empty);
			return;
		}
		showChoice(K + " " + _castName(K) + " 줄 " + subs.length + "개 중 " + other.length + "개에는 이미 다른 프리셋이 걸려 있습니다.\n\n" +
			"모두 적용: 그 줄들도 기본 프리셋 '" + pname + "'으로 바꿉니다. 속성(후반 작업 값)은 새 프리셋 값으로 바뀝니다.\n" +
			"빈 줄만: 프리셋이 없는 " + empty.length + "줄에만 겁니다.\n\n바꾸기 전 상태는 안전 지점 '기본 프리셋 일괄 적용 전: " + K + "'에 남습니다.", [
			{ label: "모두 적용 (" + (empty.length + other.length) + ")", run: () => run(empty.concat(other)) },
			{ label: "빈 줄만 (" + empty.length + ")", run: () => run(empty) },
			{ label: "취소", run: () => setStatus("기본 프리셋 일괄 적용 취소", "") }
		]);
	}
	// 줄이 필터로 숨었는가
	function _rowHidden(row) {
		return !!row && (row.classList.contains("search-hidden") || row.classList.contains("preset-filter-hidden") || row.classList.contains("speaker-filter-hidden") || row.classList.contains("mark-filter-hidden"));
	}
	// 이 화자 줄 선택: 그 화자의 보이는 줄만 체크하고 나머지는 푼다 (화자 칩이 그 화자를 숨기고 있으면 그 화자만 보이게 바꾼다)
	function _castSelectRows(K) {
		if (_speakerFilter.size && !_speakerFilter.has(K)) {
			_speakerFilter.clear();
			_speakerFilter.add(K);
			renderSpeakerChips();
			renderCastBar();
			_reapplyFilters();
		}
		let n = 0;
		state.subtitles.forEach((sub) => {
			const rs = state.rowStates[sub.id];
			if (!rs) return;
			const row = document.getElementById("row-" + sub.id);
			rs.checked = sub.spk === K && !_rowHidden(row);
			if (rs.checked) n++;
			const chk = row && row.querySelector("input[type=checkbox]");
			if (chk) chk.checked = rs.checked;
			if (row) row.className = _buildRowClass(sub.id, rs, sub);
		});
		_reapplyFilters();
		updateMultiSelect();
		setStatus(K + " " + _castName(K) + " 줄 " + n + "개 선택", "ok");
	}
	// 화자 삭제: 그 화자의 줄은 휴지통으로 (사용자가 지운 것과 같다: 다시 가져오면 그 삭제를 존중한다), 화자 표에서 뺀다.
	// 타임라인 클립은 지우지 않는다. 먼저 안전 지점을 남긴다
	function _castDelete(K) {
		const n = state.subtitles.filter((s) => s.spk === K).length;
		const nm = _castName(K);
		const seq = _importSeqToken();
		showConfirm("화자 " + K + " " + nm + "을(를) 삭제합니다.\n\n이 화자의 줄 " + n + "개는 휴지통으로 갑니다 (후반 작업은 휴지통 항목에 남습니다).\n타임라인의 클립은 지우지 않습니다.", () => {
			if (seq !== _importSeqToken()) {
				setStatus("시퀀스가 바뀌어 화자 삭제를 취소했습니다", "err");
				return;
			}
			_saveSafety("화자 삭제 전: " + K);
			const data = { subtitles: state.subtitles, rowStates: state.rowStates, trashBin: state.trashBin };
			moveKeyToTrash(data, K, undefined, Date.now());
			delete state.mi.cast[K];
			state.mi.castOrder = state.mi.castOrder.filter((k) => k !== K);
			_speakerFilter.delete(K);
			renderAll();
			renderTrash();
			updateMultiSelect();
			saveSessionToStorage();
			_saveHistoryOnAction("화자 삭제: " + K + " " + nm + " (" + n + "줄 → 휴지통)");
			setStatus("화자 " + K + " " + nm + " 삭제 — 줄 " + n + "개는 휴지통에 있습니다", "ok");
		}, null, { yes: "화자 삭제" });
	}
	// ── 화자 파일 다시 가져오기(⟳)와 바뀜 알림 (S3-3) ──
	// ⟳: 화자 표에 기억한 파일 경로(cast[K].path, 가져올 때 CEP File.path·명령 {path})에서 SRT를 다시 읽어 'SRT 가져오기' 창을
	// 그 화자(키)의 병합으로 연다. 창에서 통계를 보고 [가져오기]를 눌러야 병합한다. 경로가 없거나 읽지 못하면 파일 대화상자(#srtInput)를
	// 연다 — 고른 파일 이름에 C번호가 없으면 그 화자로 본다 (2분 안, _castReimportKey).
	// 바뀜 알림: 3초마다 경로를 stat해 크기·수정 시각이 가져올 때와 다르면 #castToast "영희(C2) 파일이 바뀌었습니다 [병합 미리보기] [닫기]".
	// 적용 중·가져오기 창이 열렸을 때·패널이 숨었을 때·시퀀스 확인 전에는 쉰다. 스스로 병합하지 않고, 같은 바뀜은 한 번만 알린다.
	const CAST_WATCH_MS = 3000;
	// 수정 시각 비교 여유 (File.lastModified는 ms 정수, stat은 소수 ms)
	const CAST_MTIME_TOL = 1000;
	const CAST_REIMPORT_TTL = 120000;
	var _castReimportKey = null; // {K, at}: ⟳에서 연 파일 대화상자
	var _castToastKey = null; // 알림 중인 {K, sig}
	var _castWatchSeen = {}; // 알렸거나 닫은 바뀜 {sig: true}
	function _castReimport(K) {
		const c = state.mi && state.mi.cast ? state.mi.cast[K] : null;
		if (!c) return;
		if (!_keysResolved) {
			setStatus(GATE_NOSEQ_MSG, "err");
			return;
		}
		if (_miBusy || _legacyRun) {
			setStatus("타임라인 적용 중에는 SRT를 열 수 없습니다", "err");
			return;
		}
		if (c.path) {
			const r = _readSrtPath(c.path);
			if (!r.error) {
				_openReimport(K, r.file);
				return;
			}
			setStatus(K + " " + _castName(K) + ": " + r.error + " — 파일을 고르세요", "err");
		} else setStatus(K + " " + _castName(K) + ": 파일 위치를 모릅니다 — 파일을 고르세요", "");
		_castReimportKey = { K, at: Date.now() };
		const input = document.getElementById("srtInput");
		if (input && typeof input.click === "function") input.click();
	}
	// 파일 하나를 화자 K의 병합으로 가져오기 창에 연다 (파일 이름에 C번호가 없거나 다르면 K로 본다 — ⟳는 그 화자의 파일이다)
	function _openReimport(K, file) {
		const an = _analyzeSrt(file);
		if (an.capKey.key !== K) an.capKey = { key: K, ambiguous: false, nums: [castKeyNum(K)] };
		_hideCastToast(true);
		_openImportModal([an], false, _importSeqToken());
		return { route: "modal", key: K };
	}
	// #srtInput 처리기가 부른다: ⟳에서 연 대화상자(2분 안)에서 파일 하나를 골랐고 그 이름에 C번호가 없으면 → 그 화자의 병합으로 연다 (처리했으면 true)
	function _castReimportChosen(read) {
		const p = _castReimportKey;
		_castReimportKey = null;
		if (!p || Date.now() - p.at > CAST_REIMPORT_TTL || !read || read.length !== 1 || !state.mi.cast[p.K]) return false;
		if (parseCaptionKey(read[0].name).key) return false;
		_openReimport(p.K, read[0]);
		return true;
	}
	// 파일 경로의 {size, mtime} (Node fs). 없거나 읽지 못하면 null
	function _castStat(path) {
		const fs = _nodeRequire("fs");
		if (!fs || !path) return null;
		try {
			const st = fs.statSync(String(path));
			return { size: Number(st.size), mtime: Math.floor(Number(st.mtimeMs) || 0) };
		} catch (_) {
			return null;
		}
	}
	function _castWatchTick() {
		if (!_keysResolved || _miBusy || _legacyRun || _imp || (typeof document !== "undefined" && document.hidden)) return;
		if (_castToastKey) return;
		const seq = _importSeqToken();
		for (const K of _castKeys()) {
			const c = state.mi.cast[K];
			if (!c || !c.path) continue;
			const st = _castStat(c.path);
			if (!st) continue;
			const changed = (typeof c.size === "number" && st.size !== c.size) || (typeof c.mtime === "number" && Math.abs(st.mtime - c.mtime) > CAST_MTIME_TOL);
			if (!changed) continue;
			const sig = seq + "|" + K + "|" + st.size + "|" + st.mtime;
			if (_castWatchSeen[sig]) continue;
			_showCastToast(K, sig);
			return;
		}
	}
	setInterval(_castWatchTick, CAST_WATCH_MS);
	function _showCastToast(K, sig) {
		const el = document.getElementById("castToast");
		const txt = document.getElementById("castToastText");
		if (!el || !txt) return;
		_castToastKey = { K, sig };
		txt.textContent = _castName(K) + "(" + K + ") 파일이 바뀌었습니다";
		txt.title = (state.mi.cast[K] && state.mi.cast[K].path) || "";
		el.style.display = "";
	}
	// 알림을 닫는다. seen이면 그 바뀜은 다시 알리지 않는다
	function _hideCastToast(seen) {
		const el = document.getElementById("castToast");
		if (_castToastKey && seen) _castWatchSeen[_castToastKey.sig] = true;
		_castToastKey = null;
		if (el) el.style.display = "none";
	}
	document.getElementById("castToastMerge")?.addEventListener("click", (e) => {
		e.stopPropagation();
		const t = _castToastKey;
		_hideCastToast(true);
		if (t) _castReimport(t.K);
	});
	document.getElementById("castToastClose")?.addEventListener("click", (e) => {
		e.stopPropagation();
		_hideCastToast(true);
	});
	// 휴지통에서 되살린 화자 줄의 화자가 화자 표에 없으면 다시 만든다 (이름·프리셋·색은 cast_defaults, 없으면 키)
	function _ensureCastEntry(K) {
		const mi = state.mi;
		if (!K || mi.cast[K]) return;
		const d = _loadCastDefaults()[K] || null;
		const color = d && typeof d.color === "number" && !Object.keys(mi.cast).some((k) => mi.cast[k] && mi.cast[k].color === d.color) ? d.color : castColorFree(mi.cast);
		mi.cast[K] = { name: (d && d.name) || K, track: null, autoTrack: null, presetId: d && d.presetId && state.presets[d.presetId] ? d.presetId : "", color, file: "", path: null, size: null, mtime: null, pos: null };
		if (mi.castOrder.indexOf(K) === -1) mi.castOrder = sortCastKeys(mi.castOrder.concat([K]));
	}

	// ── 화자 칩과 필터 ──

	function renderSpeakerChips() {
		const box = document.getElementById("speakerChips");
		if (!box) return;
		const order = _castKeys();
		// 화자 표에서 사라진 키는 필터에서 뺀다
		Array.from(_speakerFilter).forEach((K) => { if (order.indexOf(K) === -1) _speakerFilter.delete(K); });
		box.innerHTML = "";
		if (order.length < 2) {
			box.style.display = "none";
			return;
		}
		box.style.display = "";
		const chip = (label, active, title, onClick) => {
			const b = document.createElement("button");
			b.className = "spk-chip" + (active ? " active" : "");
			b.textContent = label;
			b.title = title;
			b.addEventListener("click", (e) => {
				e.stopPropagation();
				onClick();
			});
			box.appendChild(b);
			return b;
		};
		chip("전체", _speakerFilter.size === 0, "모든 화자의 줄 보기", () => {
			_speakerFilter.clear();
			_onSpeakerFilterChange();
		});
		order.forEach((K) => {
			const b = chip(K + " " + _castName(K), _speakerFilter.has(K), "이 화자 줄 보기 (여럿 고를 수 있다)", () => _toggleSpeakerFilter(K));
			b.dataset.key = K;
			b.style.borderLeft = "3px solid " + _castColorHex(K);
		});
	}
	function _toggleSpeakerFilter(K) {
		if (_speakerFilter.has(K)) _speakerFilter.delete(K);
		else _speakerFilter.add(K);
		_onSpeakerFilterChange();
	}
	function _onSpeakerFilterChange() {
		renderSpeakerChips();
		renderCastBar();
		_reapplyFilters();
	}
	// 화자 필터: 고른 화자가 있으면 그 화자의 줄만 보인다 (화자 없는 줄도 숨긴다). 숨긴 줄은 체크를 푼다
	function _applySpeakerFilter() {
		const active = _speakerFilter.size > 0 && _castMode();
		state.subtitles.forEach((sub) => {
			const row = document.getElementById("row-" + sub.id);
			if (!row) return;
			if (!active || (sub.spk && _speakerFilter.has(sub.spk))) {
				row.classList.remove("speaker-filter-hidden");
				return;
			}
			row.classList.add("speaker-filter-hidden");
			const rs = state.rowStates[sub.id];
			if (rs && rs.checked) {
				rs.checked = false;
				row.classList.remove("is-checked");
				const chk = row.querySelector("input[type=checkbox]");
				if (chk) chk.checked = false;
			}
		});
	}
	// 표시 필터 (S3-2, _markFilter): "warn"이면 포인트 경고(rs.warn)가 있는 줄만, "sugg"면 AI 제안(rs.sugg)이 있는 줄만 보인다.
	// 숨긴 줄은 체크를 푼다 (다른 필터와 같다). 보일 줄이 하나도 없으면 필터를 푼다 (마지막 경고·제안을 처리한 뒤)
	function _markMatch(rs) {
		if (_markFilter === "warn") return !!rs && Array.isArray(rs.warn) && rs.warn.length > 0;
		if (_markFilter === "sugg") return !!rs && !!rs.sugg && typeof rs.sugg === "object" && Object.keys(rs.sugg).length > 0;
		return true;
	}
	function _applyMarkFilter() {
		if (_markFilter && !state.subtitles.some((sub) => _markMatch(state.rowStates[sub.id]))) _markFilter = "";
		state.subtitles.forEach((sub) => {
			const row = document.getElementById("row-" + sub.id);
			if (!row) return;
			const rs = state.rowStates[sub.id];
			if (!_markFilter || _markMatch(rs)) {
				row.classList.remove("mark-filter-hidden");
				return;
			}
			row.classList.add("mark-filter-hidden");
			if (rs && rs.checked) {
				rs.checked = false;
				row.classList.remove("is-checked");
				const chk = row.querySelector("input[type=checkbox]");
				if (chk) chk.checked = false;
			}
		});
	}
	// 검색·화자·표시·프리셋 필터를 다시 건다 (줄의 className을 새로 쓴 뒤, renderAll 뒤). 부팅 중(필터 선언 전)에는 하지 않는다
	function _reapplyFilters() {
		if (!_filtersReady) return;
		_applySubSearch();
		_applySpeakerFilter();
		_applyMarkFilter();
		_applyPresetFilter(); // updateMultiSelect까지 부른다
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
	// 줄의 className. 다화자 목록의 화자 줄은 뒤에 " spk-C2" (단일 화자 줄은 v27 그대로).
	// 필터 클래스(search-hidden 등)는 넣지 않는다 → 새로 쓴 뒤 _reapplyFilters()를 부른다 (src/ui/cast.ts)
	function _buildRowClass(subId, rs, sub) {
		const colorIdx = _getPresetColorIndex(rs.presetId);
		let cls = "sub-row";
		if (rs.presetId) cls += " has-mogrt preset-color-" + colorIdx;
		else cls += " no-mogrt";
		if (rs.checked) cls += " is-checked";
		if (_castMode()) {
			const s = sub || state.subtitles.find((x) => x.id === subId);
			if (s && s.spk) cls += " spk-" + s.spk;
		}
		return cls;
	}
	function initSubtitleList(setStatus, updateMultiSelect, renderTrash) {
		_setStatus = setStatus;
		_updateMultiSelect = updateMultiSelect;
		_renderTrash = renderTrash;
	}
	function renderAll() {
		// 줄 결과 문구(.sub-res)는 그 목록을 그린 동안만 보인다 (목록을 다시 그리면 비운다)
		_rowRes = null;
		const listWrap = document.getElementById("listWrap");
		const emptyMsg = document.getElementById("emptyMsg");
		emptyMsg.style.display = state.subtitles.length === 0 ? "flex" : "none";
		listWrap.querySelectorAll(".sub-row").forEach((el) => el.parentNode?.removeChild(el));
		state.subtitles.forEach((sub) => {
			listWrap.appendChild(makeRow(sub));
			// DOM 삽입 후 params 복원/렌더링
			_ensureRowParams(sub, state.rowStates[sub.id]);
		});
		// 새로 그린 줄에 검색·화자·프리셋 필터를 다시 건다 (부팅 중에는 하지 않는다), 화자 표·칩도 목록에 맞춘다 (S2-3)
		_reapplyFilters();
		renderCastBar();
		renderSpeakerChips();
	}
	// 줄의 속성 목록을 준비하고 속성창을 그린다 (renderAll에서 줄마다).
	//   프리셋이 있고 _allParams·params가 모두 비었다 → 처음 건 줄: v27처럼 프리셋 값으로 채운다
	//   그 밖에는 값을 다시 읽지 않는다. 노출 속성(params)만 비었고 구조가 프리셋과 같으면
	//   _allParams에서 exposedIndices로 다시 고른다.
	// v27은 'params가 비었으면 다시 읽기'라서 노출 속성이 없는 프리셋의 줄은 renderAll마다
	// _allParams가 프리셋 기본값으로 돌아가 후반 작업 값이 사라졌다.
	// 예외: 노출 속성(params)이 빈 줄의 _allParams 구조가 프리셋과 다르면(그 사이 프리셋을 다른 구조의
	// MOGRT로 다시 저장했다) v27처럼 프리셋에서 다시 채운다. 속성창이 없는 줄이라 잃을 패널 편집도 없다.
	// 다만 그 줄의 클립은 옛 구조일 수 있으므로 psOld를 남긴다(keepPsOld: ap가 있으면 ap.ps, 없으면 다시 채우기 전 서명).
	// psOld가 있는 줄은 v27에 위험한 줄(isV27Unsafe)이 되어 ▶·↑가 이름으로 쓴다 (S1-9)
	function _ensureRowParams(sub, rs) {
		if (!rs) return;
		const tBtn = document.getElementById("toggle-" + sub.id);
		const hasAll = !!(rs._allParams && rs._allParams.length);
		const noExposed = !rs.params || rs.params.length === 0;
		const preset = rs.presetId ? state.presets[rs.presetId] : null;
		const stale = !!(preset && hasAll && noExposed && layoutMismatch(rs._allParams, preset.params));
		if (rs.presetId && noExposed && (!hasAll || stale)) {
			if (stale) keepPsOld(rs, paramSig(rs._allParams), paramSig(preset.params));
			loadParamsFromPreset(sub.id, rs.presetId, sub.text, rs.open !== false);
			if (stale) _refreshRowMarks(sub); // makeRow가 단 '구조' 표시를 뗀다
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
		row.className = _buildRowClass(sub.id, rowState, sub);
		row.id = "row-" + sub.id;
		_applyRowStripe(row, sub);
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
			row.className = _buildRowClass(sub.id, rowState, sub);
			_reapplyFilters();
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
					if (trow) trow.className = _buildRowClass(tid, tstate, tsub);
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
				_reapplyFilters();
			} else {
				rowState.presetId = newPid;
				row.className = _buildRowClass(sub.id, rowState, sub);
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
				_reapplyFilters();
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
		// 병합·적용·구조 표시 (있을 때만 → 병합한 적 없는 목록의 행 DOM은 v27 그대로)
		_rowMarkEls(sub, rowState).forEach((el) => hdr.appendChild(el));
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
	// 행 머리의 표시 (번호 뒤, 순서대로): 병합 점 · 포인트 경고 · AI 제안 · 적용 결과 · 옛 구조 · 못 옮긴 텍스트
	function _rowMarkEls(sub, rs) {
		return [_mmBadge(sub, rs), _warnBadge(rs), _suggBadge(sub, rs), _resBadge(sub.id), _structBadge(sub, rs), _orphBadge(sub, rs)].filter(Boolean);
	}

	// ── AI 제안 (S3-2) ──
	// 제안(rs.sugg)은 행 머리 'AI'와 속성창 필드 아래 .sugg-box로 보인다. [적용]·[무시]만 값을 바꾸거나 지운다 (src/mi/commands.ts _suggApprove·_suggReject).
	// 캡션·필드 구조가 바뀐 제안은 회색(stale)이고 [적용]이 꺼진다. 속성창에 없는 필드(노출하지 않은 T-ID)의 제안은 속성창 맨 위에 모은다.
	const SUGG_BY_LABEL = { codex: "Codex", claude: "Claude", ai: "AI", test: "시험", ui: "패널" };
	function _suggByLabel(by) {
		const k = String(by || "").toLowerCase();
		return SUGG_BY_LABEL[k] || String(by || "AI");
	}
	// 줄의 제안 [{fid, entry, r: suggState}] (필드 번호 순)
	function _rowSuggs(sub, rs) {
		if (!rs || !rs.sugg || typeof rs.sugg !== "object") return [];
		const preset = rs.presetId ? state.presets[rs.presetId] || null : null;
		return Object.keys(rs.sugg).filter((fid) => rs.sugg[fid] && typeof rs.sugg[fid] === "object")
			.sort((a, b) => parseInt(a.slice(1), 10) - parseInt(b.slice(1), 10))
			.map((fid) => ({ fid, entry: rs.sugg[fid], r: suggState(sub, rs, preset, fid, rs.sugg[fid]) }));
	}
	// 행 머리 'AI' (제안이 있는 줄). 모두 낡았으면 회색. 누르면 속성창을 연다 (속성창이 없는 줄은 확인창에서 적용·무시)
	function _suggBadge(sub, rs) {
		const list = _rowSuggs(sub, rs);
		if (!list.length) return null;
		const el = document.createElement("span");
		el.className = "sub-sugg" + (list.every((x) => x.r.stale) ? " stale" : "");
		el.textContent = "AI";
		el.title = "AI 제안 " + list.length + "개 — [적용]하기 전에는 바뀌지 않습니다\n" + list.map((x) => x.fid + (x.r.field ? " " + x.r.field : "") + ": " + x.entry.v + " — " + suggCheckText(x.r)).join("\n");
		el.addEventListener("click", (e) => {
			e.stopPropagation();
			_openRowSuggs(sub);
		});
		return el;
	}
	function _openRowSuggs(sub) {
		const rs = state.rowStates[sub.id];
		if (!rs) return;
		const panel = document.getElementById("params-" + sub.id);
		if (panel && rs.params && rs.params.length) {
			if (!rs.open) {
				rs.open = true;
				panel.className = "sub-params open";
				saveSessionToStorage();
				updateMultiSelect();
			}
			const box = panel.querySelector(".sugg-box");
			if (box && typeof box.scrollIntoView === "function") box.scrollIntoView({ block: "nearest" });
			return;
		}
		// 속성창이 없는 줄 (노출 속성이 없는 프리셋): 확인창에서
		const list = _rowSuggs(sub, rs);
		if (!list.length) return;
		const lines = list.map((x) => x.fid + (x.r.field ? " " + x.r.field : "") + ": " + x.entry.v + "\n   " + suggCheckText(x.r));
		const targets = list.map((x) => ({ sub, fid: x.fid }));
		showChoice(rowLabel(sub, _castMode()) + " 줄의 AI 제안 " + list.length + "개:\n\n" + lines.join("\n") + "\n\n확인을 통과한 제안만 적용합니다 (바꾸기 전 상태는 안전 지점에 남습니다).", [
			{ label: "검증 통과만 적용", run: () => _suggApprove(targets) },
			{ label: "모두 무시", run: () => _suggReject(targets) },
			{ label: "닫기", run: () => {} }
		]);
	}
	// 속성창의 제안 칸·필드 경고를 다시 그린다 (필드는 다시 그리지 않는다: 입력 중인 칸이 그대로)
	//   .sugg-box "AI 제안 (Codex): 날씨$$하늘 — ✓ 본문에 있음" [적용] [무시] — 그 필드 블록의 입력 칸 아래
	//   .field-warn "‘하늘’이 문장에 없습니다" / "‘날씨’가 두 번 나와 첫 번째만 칠해집니다" (rs.warn, 병합의 포인트 확인)
	function _renderSuggBoxes(subId) {
		const panel = document.getElementById("params-" + subId);
		const rs = state.rowStates[subId];
		const sub = state.subtitles.find((s) => s.id === subId);
		if (!panel || !rs || !sub) return;
		panel.querySelectorAll(".sugg-box, .sugg-extra, .field-warn").forEach((el) => el.parentNode && el.parentNode.removeChild(el));
		const blockOf = (fid) => {
			const b = Array.from(panel.querySelectorAll(".fid-badge")).find((x) => x.textContent === fid);
			const block = b && typeof b.closest === "function" ? b.closest(".mogrt-text-block") : null;
			return block ? { block, ta: block.querySelector("textarea") } : null;
		};
		const after = (at, el) => {
			const ref = at.ta ? at.ta.nextSibling : null;
			at.block.insertBefore(el, ref);
			at.ta = el;
		};
		(Array.isArray(rs.warn) ? rs.warn : []).forEach((w) => {
			const at = blockOf(w.fid);
			if (!at) return;
			(w.missing || []).forEach((m) => { const el = document.createElement("div"); el.className = "field-warn"; el.textContent = quoteIga([m]) + " 문장에 없습니다"; after(at, el); });
			(w.dup || []).forEach((m) => { const el = document.createElement("div"); el.className = "field-warn"; el.textContent = quoteIga([m]) + " 두 번 나와 첫 번째만 칠해집니다"; after(at, el); });
		});
		let extra = null;
		_rowSuggs(sub, rs).forEach((x) => {
			const box = document.createElement("div");
			const warn = x.r.ok && x.r.warn.length > 0;
			box.className = "sugg-box" + (x.r.stale ? " stale" : !x.r.ok ? " bad" : warn ? " warn" : "");
			box.dataset.fid = x.fid;
			const txt = document.createElement("span");
			txt.className = "sugg-text";
			txt.textContent = "AI 제안 (" + _suggByLabel(x.entry.by) + "): " + x.entry.v + " — " + suggCheckText(x.r);
			if (x.entry.note) box.title = x.entry.note;
			const ok = document.createElement("button");
			ok.className = "sugg-ok";
			ok.textContent = "적용";
			ok.disabled = !x.r.ok;
			ok.addEventListener("click", (e) => {
				e.stopPropagation();
				_suggApprove([{ sub, fid: x.fid }]);
			});
			const no = document.createElement("button");
			no.className = "sugg-no";
			no.textContent = "무시";
			no.addEventListener("click", (e) => {
				e.stopPropagation();
				_suggReject([{ sub, fid: x.fid }]);
			});
			box.appendChild(txt);
			box.appendChild(ok);
			box.appendChild(no);
			const at = blockOf(x.fid);
			if (at) {
				after(at, box);
				return;
			}
			// 속성창에 없는 필드: 맨 위에 모은다 ("T3 서브 포인트 텍스트")
			if (!extra) {
				extra = document.createElement("div");
				extra.className = "sugg-extra";
				panel.insertBefore(extra, panel.firstChild);
			}
			const lbl = document.createElement("div");
			lbl.className = "sugg-extra-label";
			lbl.textContent = x.fid + (x.r.field ? " " + x.r.field : "") + " (속성창에 없는 필드)";
			extra.appendChild(lbl);
			extra.appendChild(box);
		});
	}

	// ── 구조 맞춤 (S1-10) ──
	// 프리셋 저장(btnSaveDefault)은 그 프리셋을 쓰는 줄을, '현재 구조로 맞추기'는 옛 구조 줄을 core rebaseRowParams로
	// 옮긴다 (텍스트는 T-ID로, 노출 속성은 줄 값, 나머지는 프리셋 값, 못 옮긴 텍스트는 rs.orphanFields).
	// 사용자가 누를 때만 하고, 적용(▶·↑)은 부르지 않는다. 맞춘 줄의 클립은 옛 구조일 수 있어 psOld가 남고
	// ▶·↑는 그 줄을 이름으로 쓴다 (S1-9).

	// 줄 하나를 preset 구조로 맞춘다. oldPreset은 저장 전 프리셋(캡션 찾기·'T'를 옮겼는지·기본값 거르기, 없으면 preset).
	// _allParams가 없는 줄은 맞출 것이 없다 → null (호출부가 v27처럼 프리셋에서 채운다).
	// dry면 바꾸지 않고 {added: 새로 생길 못 옮긴 텍스트 수}만 → 아니면 {added}
	function _rebaseRowTo(sub, rs, preset, oldPreset, dry) {
		if (!rs || !preset || !rs._allParams || !rs._allParams.length) return null;
		const cap = rowCaptionValue(rs, oldPreset || preset);
		const result = rebaseRowParams(rs._allParams, preset, { rowExposed: rs.params || [], caption: cap !== null ? cap : sub.text, oldParams: oldPreset ? oldPreset.params : null, oldCaptionFid: captionFid(oldPreset || preset) });
		if (dry) return { added: mergeOrphanFields(rs.orphanFields, result.orphanFields).added };
		const added = applyRebase(rs, preset, result);
		if (!rs.params.length) rs.open = false;
		const tBtn = document.getElementById("toggle-" + sub.id);
		if (tBtn) {
			tBtn.style.display = rs.params.length > 0 ? "" : "none";
			tBtn.textContent = rs.open ? "▲" : "▼";
		}
		const panel = document.getElementById("params-" + sub.id);
		if (panel) panel.className = "sub-params" + (rs.open && rs.params.length ? " open" : "");
		renderParamsPanel(sub.id);
		_refreshRowMarks(sub);
		return { added };
	}
	// 옛 구조 줄: 프리셋이 있고 _allParams의 구조가 프리셋과 다르다 (옛 버전 MOGRT로 만든 줄) → 줄 id
	function _staleRowIds() {
		return state.subtitles.filter((sub) => {
			const rs = state.rowStates[sub.id];
			const preset = rs && rs.presetId ? state.presets[rs.presetId] : null;
			return !!preset && !!rs._allParams && rs._allParams.length > 0 && layoutMismatch(rs._allParams, preset.params);
		}).map((sub) => sub.id);
	}
	const REBASE_CONFIRM_MSG = "속성을 지금 프리셋 구조로 맞춥니다.\n\n텍스트 필드는 T1·T2… 번호로 옮기고, 줄마다 바꾼 노출 속성은 유지합니다. 자리를 찾지 못한 텍스트는 줄에 따로 남깁니다.\n타임라인의 클립은 바꾸지 않습니다 (옛 구조 클립은 ▶·↑가 속성 이름으로 씁니다).";
	// 옛 구조 줄 ids를 맞춘다: 안전 지점 '구조 맞춤 전' → 줄마다 맞춤 → 저장 → 몇 줄
	function _rebaseStale(ids) {
		const want = {};
		(ids || []).forEach((id) => { want[id] = true; });
		const subs = state.subtitles.filter((sub) => want[sub.id]);
		if (!subs.length) return 0;
		_saveSafety("구조 맞춤 전");
		let n = 0;
		let orphans = 0;
		subs.forEach((sub) => {
			const rs = state.rowStates[sub.id];
			const r = _rebaseRowTo(sub, rs, rs && rs.presetId ? state.presets[rs.presetId] : null, null, false);
			if (!r) return;
			n++;
			orphans += r.added;
		});
		saveSessionToStorage();
		_updateMultiSelect();
		_setStatus("구조 맞춤: " + n + "줄" + (orphans ? " · 자리를 찾지 못한 텍스트 " + orphans + "개는 줄에 남겼습니다" : ""), "ok");
		return n;
	}
	// '구조' 표시: 옛 구조 줄. 누르면 이 줄만 맞춘다 (확인 후)
	function _structBadge(sub, rs) {
		const preset = rs && rs.presetId ? state.presets[rs.presetId] : null;
		if (!preset || !rs._allParams || !rs._allParams.length || !layoutMismatch(rs._allParams, preset.params)) return null;
		const el = document.createElement("span");
		el.className = "sub-struct";
		el.textContent = "구조";
		el.title = "속성 구조가 프리셋과 다릅니다 (옛 버전 MOGRT로 만든 줄). 누르면 현재 구조로 맞춥니다 — 타임라인 클립은 바꾸지 않습니다";
		el.addEventListener("click", (e) => {
			e.stopPropagation();
			showConfirm(rowLabel(sub, _castMode()) + " 줄의 " + REBASE_CONFIRM_MSG, () => _rebaseStale([sub.id]), null, { yes: "현재 구조로 맞추기" });
		});
		return el;
	}
	// 못 옮긴 텍스트 (rs.orphanFields): 구조를 맞출 때 자리를 찾지 못한 텍스트. 누르면 보여 주고 지울 수 있다
	function _orphBadge(sub, rs) {
		const list = rs && Array.isArray(rs.orphanFields) ? rs.orphanFields : [];
		if (!list.length) return null;
		const lines = list.map((x) => (x.displayName || "(이름 없음)") + ": " + x.value);
		const el = document.createElement("span");
		el.className = "sub-orph";
		el.textContent = "못 옮김 " + list.length;
		el.title = "구조를 맞출 때 자리를 찾지 못한 텍스트\n" + lines.join("\n");
		el.addEventListener("click", (e) => {
			e.stopPropagation();
			showConfirm("구조를 맞출 때 자리를 찾지 못한 텍스트 " + list.length + "개:\n\n" + lines.join("\n") + "\n\n필요하면 속성창에 옮겨 적은 뒤 목록에서 지우세요.", () => {
				delete rs.orphanFields;
				_refreshRowMarks(sub);
				saveSessionToStorage();
			}, null, { yes: "목록에서 지우기", no: "그대로 두기" });
		});
		return el;
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
				// 캡션을 고치면 그 줄의 AI 제안이 낡는다 → 제안 칸·행 머리 'AI'를 다시 그린다 (S3-2)
				if (rs.sugg && changedParam && changedParam.type === "text") {
					_renderSuggBoxes(subId);
					const sub = state.subtitles.find((s) => s.id === subId);
					if (sub) _refreshRowMarks(sub);
				}
			}, exposedFontFields ?? void 0, _rowFidMap(subId, rs));
			_renderSuggBoxes(subId);
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
		// 화자 표의 기본 프리셋 선택지도 프리셋 저장·삭제·복구·가져오기를 따라간다 (S2-3)
		renderCastBar();
	}
	async function updateSingleClip(sub) {
		const rs = state.rowStates[sub.id];
		// 화자 줄: 한 줄 계획으로 화자 트랙에 (src/mi/apply.ts _miApply, 점검 창은 충돌·고침·옛 버전·새 트랙일 때만)
		if (sub.spk) {
			await _miApply([sub], { single: true });
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
		// 네이티브 템플릿: 스크립트로 쓴 텍스트는 빈 글자로 그려진다 → 문구를 구운 사본으로 교체해 놓는다 (S1-11, src/mi/apply.ts)
		if (isNativeList(preset.params)) return _nativeUpdateSingle(sub, rs, preset);
		// v27에 위험한 줄(옛 구조 등)과 시간이 바뀐 줄은 이름으로 쓴다 (index -1 → 찾은 클립이 옛 구조여도 맞는 속성에).
		// 나머지 줄은 v27과 같은 페이로드다. 클립을 못 찾으면 v27처럼 새로 놓는다 (S1-9)
		const unsafe = isV27Unsafe(rs, preset);
		const timeChanged = rowTimeChanged(rs, sub);
		const params = unsafe || timeChanged ? namedParams(rowSendParams(rs)) : rs._allParams.length > 0 ? rs._allParams : rs.params;
		// 전에 네이티브로 놓은 줄(ap.nk)을 AE 프리셋으로 바꿨다: 그 네이티브 클립을 지우고 AE 템플릿을 새로 놓는 교체다.
		// 남겨 두면 updateClipAtTime이 그 클립을 찾아 AE 속성을 쓰려 하고(네이티브 분기, 아무것도 안 됨) 성공으로 끝난다.
		// 새 클립은 템플릿 길이 창을 차지하므로 네이티브 줄과 같은 계획(연쇄·위험 표시)으로 놓는다 (S1-11, src/mi/apply.ts)
		if (rs.ap && rs.ap.nk) return _nativeUpdateAe(sub, rs, preset, params);
		// v27에 위험하거나 시간이 바뀐 줄: v28 호스트가 답하면 레거시 안전 경로 (nodeId로 찾아 제자리 갱신·이동·새로 놓기, 태그 없음, S2-5)
		if ((unsafe || timeChanged) && (await _legacyV28Ok())) {
			await _legacySafeApply([sub.id], { single: true, full: true });
			return;
		}
		const trackSel = document.getElementById("trackSel");
		const trackIndex = parseInt(trackSel.value, 10);
		_setStatus("클립 업데이트 중...", "info");
		const seq = _importSeqToken();
		// v27 호스트로 쓴다: 타임라인을 바꿨으면(바꿨을 수 있으면) 마지막 적용 기록(last_apply)은 더 이상 되돌리지 않는다
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
			if (v27MayHaveChanged(err)) _supersedeLastApply();
			_setStatus("클립 업데이트 실패: " + (err.hostReason || err.message), "err");
			return;
		}
		if (v27MayHaveChanged(res)) _supersedeLastApply();
		if (res.startsWith("SUCCESS")) {
			// 시간이 바뀐 줄에서 찾은 클립은 옛 자리 그대로다 → 새로 놓았을 때만 검증된 적용으로 본다
			const placed = res.indexOf("새 클립") !== -1;
			if (needsApplyBook(rs, unsafe) && (!timeChanged || placed) && seq === _importSeqToken()) {
				markApplied(rs, sub, preset, trackIndex);
				_setRowRes(sub.id, null);
				_refreshRowMarks(sub);
				saveSessionToStorage();
				_updateMultiSelect();
			}
			_setStatus("[" + sub.index + "] " + res.replace("SUCCESS:", "").trim() + (timeChanged && !placed ? " — 시간은 옮기지 않았습니다 (이 버전에서 자동으로 옮길 수 없습니다)" : ""), "ok");
		} else _setStatus(res.replace("ERROR:", "").trim(), "err");
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
		// "옛 구조 줄 N개 맞추기": 속성 구조가 프리셋과 다른 줄이 있을 때만 보인다 (S1-10)
		const staleBtn = document.getElementById("btnRebaseStale");
		if (staleBtn) {
			const n = _staleRowIds().length;
			staleBtn.textContent = "옛 구조 줄 " + n + "개 맞추기";
			staleBtn.style.display = n > 0 ? "" : "none";
		}
		// "경고 (N)": 포인트 텍스트 경고가 있는 줄 수, "AI 제안 (N)": 대기 중인 제안 수 (있을 때만, S3-2)
		const warnBtn = document.getElementById("btnWarnFilter");
		if (warnBtn) {
			const n = state.subtitles.filter((s) => { const rs = state.rowStates[s.id]; return !!rs && Array.isArray(rs.warn) && rs.warn.length > 0; }).length;
			warnBtn.textContent = "경고 (" + n + ")";
			warnBtn.style.display = n > 0 || _markFilter === "warn" ? "" : "none";
			warnBtn.classList.toggle("active", _markFilter === "warn");
		}
		const suggWrap = document.getElementById("suggWrap");
		if (suggWrap) {
			let n = 0;
			state.subtitles.forEach((s) => { const rs = state.rowStates[s.id]; if (rs && rs.sugg && typeof rs.sugg === "object") n += Object.keys(rs.sugg).length; });
			const btn = document.getElementById("btnSuggestions");
			if (btn) {
				btn.textContent = "AI 제안 (" + n + ")";
				btn.classList.toggle("active", _markFilter === "sugg");
			}
			const f = document.getElementById("btnSuggFilter");
			if (f) {
				f.textContent = _markFilter === "sugg" ? "모든 줄 보기" : "제안 줄만 보기";
				f.classList.toggle("active", _markFilter === "sugg");
			}
			suggWrap.style.display = n > 0 || _markFilter === "sugg" ? "" : "none";
			if (!n) document.getElementById("suggDropdown")?.classList.remove("open");
		}
		// 화자 표의 줄 수 (줄을 지우거나 되살린 뒤)
		_updateCastCounts();
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
	//   legacy      C번호 없는 파일 하나 + 화자 표 없음 + 프리셋이 걸린 줄 없음, 또는 플래그 꺼짐(운영)의 나머지 경우.
	//               첫 파일 하나를 v27 교체 본문(_legacyReplace, parseSRT opts 없음)으로 읽는다.
	//               UTF-8이 아니거나 깨진 글자가 있으면 목록을 바꾸기 전에 첫 자막 미리보기와 함께 묻는다
	//   choice      C번호 없는 파일 하나 + 화자 표 없음 + 프리셋이 걸린 줄이 있다 → [병합 (후반 작업 유지)] [교체 (지금까지 방식)] [취소].
	//               병합은 _applyMerge(화자 없는 목록에 병합). S1-9부터 플래그와 무관하다 (운영에서도 묻는다)
	//   modal       2개 이상 | C번호 | 화자 표 있음 → 'SRT 가져오기' 창 → _importIntoCast (새 화자·병합·교체)
	//   distribute  C번호 파일 + 화자 없는 기존 줄 → 같은 창의 분배 모드 (기존 목록을 화자로 나누기)
	// 병합 규칙(짝 맞추기·3-way·휴지통 2차·분배)은 모두 core(importIntoData, buildMergePlan, distributeLegacy)에 있다.
	// 창은 바꾸기 전 상태의 사본으로 미리 계산해 통계를 보이고, [가져오기]에서 같은 계산을 한 번 더 해 넣는다.
	// 여러 파일 가져오기는 플래그(MI_CAST_ENABLED, S2-4부터 true) 뒤에 있다. DEV·하드 테스트는
	// 코드를 고치지 않고 window._mogrtDebug.setMiCast(false)로 끈다 (true는 강제로 켬).
	// 화자 이름은 파일 이름에서 가져오지 않는다 (입력 > 키).
	// ─────────────────────────────────────────────────────────────
	function _miCastEnabled() {
		const d = window._mogrtDebug ? window._mogrtDebug.miCast : undefined;
		if (d === false) return false; // setMiCast(false): 레거시 경로 시험 (플래그를 켠 뒤에도)
		return MI_CAST_ENABLED || d === true;
	}
	// #srtInput의 multiple을 플래그에 맞춘다 (플래그가 꺼져 있으면 속성 없음 = v27)
	function _syncSrtInputMultiple() {
		const input = document.getElementById("srtInput");
		if (input) input.multiple = _miCastEnabled();
	}
	window._mogrtDebug.setMiCast = (on) => {
		window._mogrtDebug.miCast = on === true ? true : on === false ? false : undefined;
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
	// 디스크의 SRT 경로 → {file: {name, path, size, mtime, bytes}} | {error}. CEP의 Node fs로 읽는다.
	// 명령 importSrt·merge*의 {path}(5단계 import_srt)와 화자 표 ⟳(다시 가져오기, S3-3)가 쓴다. mtime은 ms 정수 (File.lastModified와 같은 단위)
	function _readSrtPath(p) {
		const fs = _nodeRequire("fs");
		const path = String(p == null ? "" : p).replace(/\\/g, "/");
		if (!fs) return { error: "파일을 읽을 수 없다 (Node 없음): " + path };
		try {
			const st = fs.statSync(path);
			const bytes = new Uint8Array(fs.readFileSync(path));
			return { file: { name: path.split("/").pop(), path, size: bytes.length, mtime: Math.floor(Number(st.mtimeMs) || 0), bytes } };
		} catch (e) {
			return { error: "파일을 읽지 못했다: " + path + " (" + _errText(e) + ")" };
		}
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
		if (_miBusy) {
			setStatus("타임라인 적용 중에는 SRT를 열 수 없습니다", "err");
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
		// 화자 표 ⟳에서 연 대화상자면 그 화자의 병합으로 (S3-3)
		if (_castReimportChosen(read)) return { route: "modal", files: read.map((f) => ({ name: f.name })) };
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
	// 키를 고를 때마다: 이미 있는 화자면 그 이름·기본 프리셋이 기본값이고 처리는 병합(후반 작업 유지).
	// 새 화자는 프로젝트 cast_defaults.json의 그 C번호 이름·기본 프리셋 (S2-3)
	function _impDefaults(en) {
		const cast = en.key ? state.mi.cast[en.key] : null;
		const dflt = !cast && en.key ? _loadCastDefaults()[en.key] || null : null;
		const dPreset = dflt && dflt.presetId && state.presets[dflt.presetId] && captionFid(state.presets[dflt.presetId]) !== null ? dflt.presetId : "";
		if (!en.nameTouched) en.name = cast ? String(cast.name || "") : dflt ? String(dflt.name || "") : "";
		if (!en.presetTouched) en.presetId = cast ? String(cast.presetId || "") : dPreset;
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
			_imp.report = importIntoData(_sessionClone(), _impJob(), { now: Date.now(), salt: state.mi.salt || "prev", presets: state.presets, trackValue: _trackValueNum(), castDefaults: _loadCastDefaults() });
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
		const report = importIntoData(data, job, { now: Date.now(), salt: keyed ? state.mi.salt || _saltForImport() : "", presets: state.presets, trackValue: _trackValueNum(), castDefaults: _loadCastDefaults() });
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
		// 가져온 화자의 이름·기본 프리셋·색을 프로젝트 기본값으로 (다음 시퀀스에서 같은 C번호를 가져올 때 쓴다)
		_saveCastDefaults(report.files.map((r) => r.key).filter(Boolean));
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
	// 읽기: status, rows, resolve, presets, cast.get, session.snapshot, mergePreview, plan(→ planToken), verify, sugg.list, approvals.list
	// 바꾸기: importSrt, mergeCommit, apply {planToken | ids | uids | spk}, undo, cast.set,
	//         suggest (제안 대기열에만 넣는다 — 속성·타임라인은 그대로), sugg.approve·sugg.reject (ui·test만), approvals.approve·approvals.reject (ui·test만)
	// agent가 바꾸는 명령(CMD_MUTATING)을 보내면 실행하지 않고 승인 대기열에 넣고 needs-approval(rid)을 돌려준다 (M5.4 승인 카드 전까지는
	// approvals.approve로 승인한다). 승인하면 안전 지점 'AI: <명령> 전'을 먼저 남기고 실행하며, 그동안 남는 히스토리 이름은 'AI: …'다.
	// suggest는 agent도 바로 된다: 제안 대기열 자체가 승인 단계다 (사용자가 [적용]하기 전에는 아무것도 쓰지 않는다, 결정 4).
	// 모든 명령: ctx.seqId·ctx.build가 있으면 지금 시퀀스·패널 빌드와 같아야 하고(seq-mismatch·build-mismatch), 바꾸는 명령은
	// 적용이 도는 동안(_miBusy) busy이고 무작업 자동저장 시계를 되돌린다(_lastActivityTime).
	// 줄 주소 "#12" / "C2·12"는 사람이 읽는 이름일 뿐이다(파싱할 때마다 바뀐다). 쓰기 주소는 uid다.
	// ─────────────────────────────────────────────────────────────
	const CMD_SOURCES = { ui: true, test: true, agent: true };
	const CMD_ROWS_MAX = 200;
	// 바꾸는 명령 → 승인 대기열·안전 지점 이름에 쓰는 말
	const CMD_MUTATING = { importSrt: "SRT 가져오기", mergeCommit: "SRT 병합", apply: "타임라인 적용", undo: "마지막 적용 되돌리기", "cast.set": "화자 표 바꾸기" };
	// agent가 부를 수 없는 명령 (사용자의 승인 그 자체)
	const CMD_UI_ONLY = { "sugg.approve": true, "sugg.reject": true, "approvals.approve": true, "approvals.reject": true };
	// 적용이 도는 동안 막는 명령 (CMD_MUTATING + 제안·승인)
	const CMD_BUSY_BLOCKED = { suggest: true, "sugg.approve": true, "sugg.reject": true, "approvals.approve": true };
	// agent 요청 대기열: 최대 개수, 낡는 시간 (패널 메모리에만 둔다 — 다시 열면 빈다)
	const AGENT_QUEUE_MAX = 20;
	const AGENT_QUEUE_TTL = 10 * 60000;
	// plan이 돌려준 계획 토큰: 최대 개수, 낡는 시간
	const PLAN_TOKEN_MAX = 20;
	const PLAN_TOKEN_TTL = 30 * 60000;
	// suggest 한 번에 받는 제안 수
	const SUGG_BATCH_MAX = 200;
	var _agentQueue = [];
	var _agentSeq = 0;
	var _planTokens = {};
	var _planSeq = 0;
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
		// 패널·시퀀스·목록 요약. panel.build는 이 패널의 빌드 스탬프, host는 v28 호스트 ping 결과
		// (MI_ 호스트가 없거나 응답이 없으면 null — v27 호스트가 캐시된 채인 Premiere)
		status: async () => {
			const mi = state.mi || miDefault();
			const speakers = (mi.castOrder || []).map((k) => {
				const c = (mi.cast && mi.cast[k]) || {};
				return { key: k, name: c.name || k, track: typeof c.track === "number" ? c.track : null, presetId: c.presetId || "", count: state.subtitles.filter((s) => s.spk === k).length };
			});
			let hostPing = null;
			try {
				hostPing = await host.mi.ping();
			} catch (_) {
				hostPing = null;
			}
			return _cmdOk({
				panel: { v: 28, build: MI_BUILD_PANEL },
				host: hostPing,
				seq: { id: state.currentSequenceId || "", name: (_seqLabelInfo && _seqLabelInfo.seqName) || "" },
				projKey: state.currentProjectKey,
				seqKey: state.currentSequenceKey,
				keysResolved: _keysResolved,
				sessionReadFailed: _sessionReadFailed,
				rows: state.subtitles.length,
				castMode: _castMode(),
				speakers,
				busy: _miBusy,
				suggestions: _suggAll().length,
				approvals: _agentPrune().length,
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
		// 플래그가 꺼져 있으면 첫 파일 하나만 본다. files[]는 {name, b64} 또는 {path} (디스크에서 읽는다, 5단계 import_srt)
		importSrt: (args) => {
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
			const rep = importIntoData(data, r.job, { now: Date.now(), salt: state.mi.salt || "prev", presets: state.presets, trackValue: _trackValueNum(), castDefaults: _loadCastDefaults() });
			return _cmdOk(_cmdClone(_cmdImportSummary(r.job, rep, _sessionDataSig(data) !== before)));
		},
		// 화자별 배치 계획 (타임라인을 읽기만 한다. 바꾸지 않는다).
		// args {ids?: [줄 id] | uids?: [uid] | spk?: "C2" (셋 중 하나, 없으면 화자 줄 전부), single?, opts?: 점검 선택지}
		// → {planToken, plan: {ops: {종류: 수}, removals, none, minCount, tracks, conflicts, edited, missing, …}, lines: [점검 요약 줄]}
		// planToken은 같은 줄·선택지를 기억한다 (apply {planToken}). 계획은 적용할 때 타임라인에서 다시 세운다
		plan: async (args) => {
			const r = _cmdTargets(args);
			if (r.error) return _cmdErr("bad-args", r.error);
			const res = await _miApply(r.subs, { dryRun: true, auto: true, single: args.single === true, pf: r.pf });
			if (!res || res.ok !== true) return _cmdErr(res && res.error === "busy" ? "busy" : (res && res.error) || "exception", (res && res.detail) || "");
			const planToken = _planTokenNew(r.subs, args.single === true, r.pf);
			return _cmdOk(_cmdClone({ planToken, plan: res.plan, lines: res.lines }));
		},
		// 화자별 배치 실행 = ▶(화자 줄)와 같다. 점검 창 없이 opts(없으면 기본 선택지)로.
		// args {planToken} (plan이 준 것: 그 줄·선택지) 또는 plan과 같은 인자.
		// → {created, updated, moved, adopted, replaced, removed, partial, conflict, failed, none, skipped, stopped, runId}
		apply: async (args) => {
			let r;
			if (args.planToken !== undefined) {
				if (Object.keys(args).some((k) => k !== "planToken")) return _cmdErr("bad-args", "planToken과 다른 인자를 같이 주지 않는다");
				r = _planTokenTargets(args.planToken);
				if (r.error) return _cmdErr(r.code || "bad-args", r.error);
			} else {
				r = _cmdTargets(args);
				if (r.error) return _cmdErr("bad-args", r.error);
				r.single = args.single === true;
			}
			const res = await _miApply(r.subs, { auto: true, single: r.single, pf: r.pf });
			if (!res || (res.ok !== true && !res.runId && res.error)) return _cmdErr(res && res.error === "busy" ? "busy" : (res && res.error) || "exception", (res && res.detail) || "");
			return _cmdOk(_cmdClone(res));
		},
		// 마지막 적용 되돌리기 (타임라인만) = 히스토리 맨 위 '↶ 마지막 적용 되돌리기'와 같다 (확인창 없이). args {runId?: 그 기록일 때만}.
		// → {removed, restored, moved, replaced, placed, partial, changed, skipped, failed, repaired, lost, runId}
		undo: async (args) => {
			if (args.runId !== undefined && typeof args.runId !== "string") return _cmdErr("bad-args", "runId는 문자열");
			const res = await _miUndo({ runId: args.runId });
			if (!res || (res.ok !== true && !res.runId && res.error)) return _cmdErr(res && res.error === "busy" ? "busy" : (res && res.error) || "exception", (res && res.detail) || "");
			return _cmdOk(_cmdClone(res));
		},
		// 병합(가져오기)을 넣는다: 가져오기 창의 [가져오기]와 같다 (안전 지점 하나 → 적용 → 자동 항목 하나, 변화가 없으면 아무것도 쓰지 않는다).
		// args는 mergePreview와 같다
		mergeCommit: (args) => {
			const r = _cmdImportJob(args);
			if (r.error) return _cmdErr(r.code || "bad-args", r.error);
			const before = _sessionDataSig(_sessionClone());
			const rep = _importIntoCast(r.job);
			return _cmdOk(_cmdClone(_cmdImportSummary(r.job, rep, _sessionDataSig(_sessionClone()) !== before)));
		},
		// 타임라인 검수 (읽기만, _miVerify) → {counts, items, text, frameTicks, salt, legacyRows, seqId}
		verify: async () => {
			const res = await _miVerify();
			if (!res || res.ok !== true) return _cmdErr((res && res.error) || "exception", (res && res.detail) || "");
			return _cmdOk(_cmdClone(res.report));
		},
		// 화자 표 바꾸기 = 화자 표의 이름·트랙·기본 프리셋 칸과 같다 (_castSetItems). args {items: [{key, name?, track?, presetId?, pos?}]}
		//   track: null(자동) | 1..98 (V2..V99), presetId: "" | 캡션 필드가 있는 프리셋, pos: null | {x, y} (0~1, 4단계에서 쓴다)
		// 하나라도 틀리면 아무것도 바꾸지 않는다 → {changed: [키], label}
		"cast.set": (args) => {
			const r = _castSetItems(args.items);
			if (r.error) return _cmdErr("bad-args", r.error);
			return _cmdOk(_cmdClone(r));
		},
		// AI 제안 넣기: args {items: [{uid, fid, value, sig, by?, note?, cap?}]} (sig = rows가 준 줄 필드 서명, cap = 본 캡션 해시 — 선택)
		// 모두 확인한 뒤(validateSuggestion) 모두 통과할 때만 rs.sugg[fid]에 넣는다 (한 필드에 하나: 새 제안이 옛 제안을 바꾼다).
		// 속성·타임라인은 그대로다 — 사용자가 [적용]해야 쓴다. 서명이 다르면 fields-changed, 없는 줄이면 not-found
		// → {queued, results: [{uid, fid, ok, error, detail, warn}]} (실패: {ok: false, error, detail, results})
		suggest: (args, ctx) => {
			const r = _suggPut(args.items, ctx.source);
			if (r.error) return Object.assign(_cmdErr(r.error, r.detail), r.results ? { results: _cmdClone(r.results) } : {});
			return _cmdOk(_cmdClone({ queued: r.queued, results: r.results }));
		},
		// 제안 목록: args {uid?} → [{uid, id, label, fid, field, v, by, ts, note, ok, stale, error, warn, check: 확인 문구}]
		"sugg.list": (args) => {
			let list = _suggAll();
			if (args.uid !== undefined) {
				const id = uidToId(args.uid, (state.mi && state.mi.salt) || "");
				if (id === null) return _cmdErr("bad-args", "uid 형식이 아니다: " + String(args.uid));
				list = list.filter((x) => x.sub.id === id);
			}
			return _cmdOk(_cmdClone(list.map(_suggView)));
		},
		// 제안 적용 (ui·test만) = .sugg-box [적용] / [검증 통과만 적용]. args {items: [{uid, fid}]} | {all: true}
		// 지금 다시 확인해 통과한 것만: 안전 지점 'AI 제안 적용 전' → _setRowFieldValue → 제안 지움 → {applied, skipped: [{uid, fid, why}]}
		"sugg.approve": (args) => {
			const t = _suggTargets(args);
			if (t.error) return _cmdErr("bad-args", t.error);
			return _cmdOk(_cmdClone(_suggApprove(t.list)));
		},
		// 제안 무시 (ui·test만) = [무시] / [모두 무시]. args는 sugg.approve와 같다 → {removed}
		"sugg.reject": (args) => {
			const t = _suggTargets(args);
			if (t.error) return _cmdErr("bad-args", t.error);
			return _cmdOk(_cmdClone(_suggReject(t.list)));
		},
		// agent 요청 대기열 → [{rid, op, what, by, at, args}]
		"approvals.list": () => _cmdOk(_cmdClone(_agentPrune().map((q) => ({ rid: q.rid, op: q.op, what: CMD_MUTATING[q.op], by: q.by, at: q.at, args: q.args })))),
		// agent 요청 승인 (ui·test만): 안전 지점 'AI: <명령> 전' → 그 명령을 실행 (그동안 남는 히스토리 이름은 'AI: …') → 그 명령의 결과
		"approvals.approve": async (args) => {
			const q = _agentTake(args.rid);
			if (q.error) return _cmdErr(q.code, q.error);
			_saveSafety("AI: " + CMD_MUTATING[q.item.op] + " 전");
			_aiLabel = true;
			try {
				return await _COMMANDS[q.item.op](_cmdClone(q.item.args), { source: "agent", approved: true, by: q.item.by });
			} finally {
				_aiLabel = false;
			}
		},
		// agent 요청 버리기 (ui·test만) → {rid}
		"approvals.reject": (args) => {
			const q = _agentTake(args.rid);
			if (q.error) return _cmdErr(q.code, q.error);
			setStatus("AI 요청을 버렸습니다: " + CMD_MUTATING[q.item.op], "");
			return _cmdOk({ rid: q.item.rid });
		}
	};
	// ── agent 요청 대기열 ──
	// 낡은 요청(AGENT_QUEUE_TTL)과 다른 시퀀스에서 온 요청을 버린다 → 남은 대기열
	function _agentPrune() {
		const now = Date.now();
		const seq = _importSeqToken();
		_agentQueue = _agentQueue.filter((q) => now - q.at < AGENT_QUEUE_TTL && q.seq === seq);
		return _agentQueue;
	}
	// agent가 보낸 바꾸는 명령을 대기열에 넣는다 → needs-approval + rid
	function _agentEnqueue(op, args, ctx) {
		_agentPrune();
		const rid = "a" + Date.now().toString(36) + "-" + ++_agentSeq;
		const by = ctx && typeof ctx.by === "string" && ctx.by ? ctx.by.slice(0, 40) : "ai";
		_agentQueue.push({ rid, op, args: _cmdClone(args || {}), by, at: Date.now(), seq: _importSeqToken() });
		if (_agentQueue.length > AGENT_QUEUE_MAX) _agentQueue.shift();
		setStatus("AI 요청 대기: " + CMD_MUTATING[op] + " — 패널에서 승인해야 실행됩니다", "");
		return Object.assign(_cmdErr("needs-approval", CMD_MUTATING[op] + "은(는) 패널에서 승인해야 합니다"), { rid });
	}
	// 대기열에서 요청 하나를 꺼낸다 → {item} | {error, code}
	function _agentTake(rid) {
		if (typeof rid !== "string" || !rid) return { error: "rid는 문자열", code: "bad-args" };
		_agentPrune();
		const i = _agentQueue.findIndex((q) => q.rid === rid);
		if (i === -1) return { error: "대기 중인 요청이 없다 (낡았거나 시퀀스가 바뀜): " + rid, code: "not-found" };
		return { item: _agentQueue.splice(i, 1)[0] };
	}
	// ── 계획 토큰 ──
	function _planTokenNew(subs, single, pf) {
		const now = Date.now();
		Object.keys(_planTokens).forEach((k) => { if (now - _planTokens[k].at >= PLAN_TOKEN_TTL) delete _planTokens[k]; });
		const keys = Object.keys(_planTokens).sort((a, b) => _planTokens[a].at - _planTokens[b].at);
		while (keys.length >= PLAN_TOKEN_MAX) delete _planTokens[keys.shift()];
		const token = "p" + now.toString(36) + "-" + ++_planSeq;
		_planTokens[token] = { at: now, seq: _importSeqToken(), ids: subs.map((s) => s.id), single: !!single, pf: Object.assign({}, pf || {}) };
		return token;
	}
	// → {subs, single, pf} | {error, code}
	function _planTokenTargets(token) {
		const t = typeof token === "string" ? _planTokens[token] : null;
		if (!t || Date.now() - t.at >= PLAN_TOKEN_TTL) return { error: "계획 토큰이 없거나 낡았다 — plan을 다시 부르세요", code: "not-found" };
		if (t.seq !== _importSeqToken()) return { error: "계획한 뒤 시퀀스가 바뀌었다", code: "seq-mismatch" };
		const want = _idSet(t.ids);
		const subs = state.subtitles.filter((s) => want[s.id]);
		if (!subs.length) return { error: "계획한 줄이 목록에 없다", code: "not-found" };
		return { subs, single: t.single, pf: Object.assign({}, t.pf) };
	}
	// ── AI 제안 (rs.sugg) — 명령과 행 편집기의 .sugg-box가 같이 쓴다 ──
	// 줄 uid → 줄 (없으면 null)
	function _subByUid(uid) {
		const id = uidToId(uid, (state.mi && state.mi.salt) || "");
		return id === null ? null : state.subtitles.find((s) => s.id === id) || null;
	}
	function _uidOf(sub) {
		const salt = (state.mi && state.mi.salt) || "";
		return salt ? salt + "-" + sub.id : String(sub.id);
	}
	// 대기 중인 제안 전부 (목록 순, 필드 번호 순) → [{sub, rs, preset, fid, entry}]
	function _suggAll() {
		const out = [];
		state.subtitles.forEach((sub) => {
			const rs = state.rowStates[sub.id];
			if (!rs || !rs.sugg || typeof rs.sugg !== "object") return;
			const preset = rs.presetId ? state.presets[rs.presetId] || null : null;
			Object.keys(rs.sugg).sort((a, b) => parseInt(a.slice(1), 10) - parseInt(b.slice(1), 10)).forEach((fid) => {
				const entry = rs.sugg[fid];
				if (entry && typeof entry === "object") out.push({ sub, rs, preset, fid, entry });
			});
		});
		return out;
	}
	// 제안 하나의 보기 (명령 결과·.sugg-box)
	function _suggView(x) {
		const r = suggState(x.sub, x.rs, x.preset, x.fid, x.entry);
		const e = x.entry;
		return { uid: _uidOf(x.sub), id: x.sub.id, label: rowLabel(x.sub, _castMode()), fid: x.fid, field: r.field, v: e.v, by: e.by || "", ts: e.ts || 0, note: e.note || "",
			ok: r.ok, stale: r.stale, error: r.error, warn: r.warn, check: suggCheckText(r) };
	}
	// 제안을 넣는다 (모두 통과할 때만) → {queued, results} | {error, detail, results}
	function _suggPut(items, source) {
		if (!Array.isArray(items) || !items.length) return { error: "bad-args", detail: "items는 [{uid, fid, value, sig}] 배열" };
		if (items.length > SUGG_BATCH_MAX) return { error: "bad-args", detail: "한 번에 " + SUGG_BATCH_MAX + "개까지" };
		const results = [];
		const put = [];
		const seen = {};
		items.forEach((it) => {
			const o = it && typeof it === "object" && !Array.isArray(it) ? it : {};
			const res = { uid: o.uid === undefined ? null : o.uid, fid: o.fid === undefined ? null : o.fid, ok: false, error: "", detail: "", warn: [] };
			results.push(res);
			const sub = _subByUid(o.uid);
			if (!sub) return Object.assign(res, { error: "not-found", detail: "그런 줄이 없다: " + String(o.uid) });
			if (typeof o.fid !== "string" || !/^T[1-9][0-9]*$/.test(o.fid)) return Object.assign(res, { error: "unknown-field", detail: "fid는 T1, T2 …" });
			const k = sub.id + "|" + o.fid;
			if (seen[k]) return Object.assign(res, { error: "bad-args", detail: "같은 필드가 두 번" });
			seen[k] = true;
			const rs = state.rowStates[sub.id] || {};
			const preset = rs.presetId ? state.presets[rs.presetId] || null : null;
			const v = validateSuggestion({ sub, rs, preset, fid: o.fid, value: o.value, sig: o.sig, cap: o.cap });
			Object.assign(res, { ok: v.ok, error: v.error, detail: v.detail, warn: v.warn });
			if (!v.ok) return;
			const by = typeof o.by === "string" && o.by.trim() ? o.by.trim().slice(0, 40) : source === "agent" ? "ai" : String(source || "ai");
			put.push({ sub, rs, fid: o.fid, entry: { v: o.value, by, ts: Date.now(), cap: v.capHash, sig: String(o.sig), st: "pending", note: typeof o.note === "string" ? o.note.slice(0, 200) : "" } });
		});
		const bad = results.filter((x) => !x.ok);
		if (bad.length) {
			const code = bad.some((x) => x.error === "fields-changed") ? "fields-changed" : bad.every((x) => x.error === "not-found") ? "not-found" : "bad-args";
			return { error: code, detail: bad.map((x) => String(x.uid) + " " + String(x.fid) + ": " + x.error + (x.detail ? " (" + x.detail + ")" : "")).join(" · "), results };
		}
		put.forEach((p) => {
			if (!p.rs.sugg || typeof p.rs.sugg !== "object") p.rs.sugg = {};
			p.rs.sugg[p.fid] = p.entry;
		});
		saveSessionToStorage();
		_suggRefresh(put.map((p) => p.sub));
		setStatus("AI 제안 " + put.length + "개가 왔습니다 — 줄에서 확인하고 [적용]해야 바뀝니다", "ok");
		return { queued: put.length, results };
	}
	// 명령 인자 → 대상 [{sub, fid}] | {error}. {all: true} = 대기 중인 제안 전부, {items: [{uid, fid}]}
	function _suggTargets(args) {
		if (args.all === true) return { list: _suggAll().map((x) => ({ sub: x.sub, fid: x.fid })) };
		if (!Array.isArray(args.items) || !args.items.length) return { error: "items는 [{uid, fid}] 배열 (또는 all: true)" };
		const list = [];
		for (const it of args.items) {
			const sub = it && typeof it === "object" ? _subByUid(it.uid) : null;
			if (!sub) return { error: "그런 줄이 없다: " + String(it && it.uid) };
			if (typeof it.fid !== "string") return { error: "fid는 T1, T2 …" };
			list.push({ sub, fid: it.fid });
		}
		return { list };
	}
	// 제안 적용: 지금 다시 확인해 통과한 것만 쓴다. 쓸 것이 있으면 먼저 안전 지점 'AI 제안 적용 전'.
	// 쓰기는 _setRowFieldValue(해석한 _allParams 항목과 같은 필드의 노출 속성)로만. 다화자 줄은 병합 표시(mm "text")를 단다.
	// 레거시(화자 없는) 줄은 mm을 달지 않는다: '안전하게 적용'이 문장만 바뀐 줄(mm text)로 보고 캡션 속성 하나만 보내
	// 승인한 값이 타임라인에 가지 않는다 — 패널에서 직접 고친 것과 같게 두고 ▶·↑가 속성 전부를 보낸다
	// → {applied, ids: [줄 id], skipped: [{uid, fid, why, detail}]}
	function _suggApprove(targets) {
		const ok = [];
		const skipped = [];
		(targets || []).forEach((t) => {
			const rs = state.rowStates[t.sub.id];
			const entry = rs && rs.sugg ? rs.sugg[t.fid] : null;
			if (!entry) {
				skipped.push({ uid: _uidOf(t.sub), fid: t.fid, why: "not-found", detail: "대기 중인 제안이 없다" });
				return;
			}
			const preset = rs.presetId ? state.presets[rs.presetId] || null : null;
			const r = suggState(t.sub, rs, preset, t.fid, entry);
			if (!r.ok) {
				skipped.push({ uid: _uidOf(t.sub), fid: t.fid, why: r.error, detail: r.detail });
				return;
			}
			ok.push({ sub: t.sub, rs, fid: t.fid, v: entry.v });
		});
		if (!ok.length) return { applied: 0, ids: [], skipped };
		_saveSafety("AI 제안 적용 전");
		const ids = [];
		let n = 0;
		ok.forEach((x) => {
			if (!_setRowFieldValue(x.sub.id, x.fid, x.v)) {
				skipped.push({ uid: _uidOf(x.sub), fid: x.fid, why: "unknown-field", detail: "필드를 찾지 못함" });
				return;
			}
			n++;
			delete x.rs.sugg[x.fid];
			if (!Object.keys(x.rs.sugg).length) delete x.rs.sugg;
			if (x.sub.spk && _castMode()) x.rs.mm = !x.rs.mm ? "text" : x.rs.mm === "time" ? "both" : x.rs.mm;
			if (ids.indexOf(x.sub.id) === -1) ids.push(x.sub.id);
		});
		ids.forEach((id) => {
			const rs = state.rowStates[id];
			if (rs && rs.params && rs.params.length) renderParamsPanel(id);
		});
		saveSessionToStorage();
		_suggRefresh(ok.map((x) => x.sub));
		if (n) _saveHistoryOnAction("AI 제안 적용 (" + n + "개)");
		setStatus("AI 제안 " + n + "개 적용" + (skipped.length ? " · 건너뜀 " + skipped.length : "") + " — 타임라인에는 ▶·↑로 반영하세요 (바꾸기 전 상태는 안전 지점에 있습니다)", skipped.length ? "err" : "ok");
		return { applied: n, ids, skipped };
	}
	// 제안 무시: 대기열에서 지운다 (속성은 그대로) → {removed}
	function _suggReject(targets) {
		let n = 0;
		const subs = [];
		(targets || []).forEach((t) => {
			const rs = state.rowStates[t.sub.id];
			if (!rs || !rs.sugg || !rs.sugg[t.fid]) return;
			delete rs.sugg[t.fid];
			if (!Object.keys(rs.sugg).length) delete rs.sugg;
			n++;
			subs.push(t.sub);
		});
		if (n) {
			saveSessionToStorage();
			_suggRefresh(subs);
			setStatus("AI 제안 " + n + "개 무시", "ok");
		}
		return { removed: n };
	}
	// 제안이 바뀐 줄을 다시 그린다 (행 머리 표시·속성창의 제안 칸·선택 바 버튼·제안 줄만 보기 필터)
	function _suggRefresh(subs) {
		const done = {};
		(subs || []).forEach((sub) => {
			if (!sub || done[sub.id]) return;
			done[sub.id] = true;
			_refreshRowMarks(sub);
			_renderSuggBoxes(sub.id);
		});
		if (_markFilter) _reapplyFilters();
		else updateMultiSelect();
	}
	// plan·apply 인자 → {subs, pf} | {error}. 줄: ids(줄 id 배열) | uids(uid 배열) | spk(화자 키) 중 하나, 없으면 화자 줄 전부.
	// opts: 점검 선택지 (MI_PF_DEFAULTS의 키만)
	function _cmdTargets(args) {
		let subs = state.subtitles.filter((s) => s.spk);
		if (["ids", "uids", "spk"].filter((k) => args[k] !== undefined).length > 1) return { error: "ids·uids·spk 중 하나만" };
		if (args.ids !== undefined) {
			if (!Array.isArray(args.ids) || !args.ids.every((x) => Number.isInteger(x))) return { error: "ids는 줄 id(정수) 배열" };
			const want = _idSet(args.ids);
			subs = state.subtitles.filter((s) => want[s.id]);
			if (subs.length !== args.ids.length) return { error: "없는 줄 id가 있다" };
		} else if (args.uids !== undefined) {
			if (!Array.isArray(args.uids) || !args.uids.length) return { error: "uids는 줄 uid 배열" };
			const ids = args.uids.map((u) => uidToId(u, (state.mi && state.mi.salt) || ""));
			const badAt = ids.indexOf(null);
			if (badAt !== -1) return { error: "이 목록의 uid가 아니다: " + String(args.uids[badAt]) };
			const want = _idSet(ids);
			subs = state.subtitles.filter((s) => want[s.id]);
			if (subs.length !== Object.keys(want).length) return { error: "없는 줄 uid가 있다" };
		} else if (args.spk !== undefined) {
			if (typeof args.spk !== "string" || !state.mi.cast[args.spk]) return { error: "화자 표에 없는 화자: " + String(args.spk) };
			subs = state.subtitles.filter((s) => s.spk === args.spk);
		}
		const pf = {};
		if (args.opts !== undefined) {
			if (!args.opts || typeof args.opts !== "object" || Array.isArray(args.opts)) return { error: "opts는 객체" };
			for (const k of Object.keys(args.opts)) {
				if (!Object.prototype.hasOwnProperty.call(MI_PF_DEFAULTS, k)) return { error: "모르는 선택지: " + k };
				pf[k] = args.opts[k];
			}
		}
		return { subs, pf };
	}
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
			// 고르지 않았으면 undefined: 있는 화자는 그대로, 새 화자는 cast_defaults의 기본 프리셋 (없으면 없음)
			const presetId = a.presetId !== undefined ? String(a.presetId || "") : undefined;
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
	// 명령 인자 files: [{name, b64} | {path}] → {files: [{name, path, size, mtime, bytes}]} | {error}
	// {path}는 디스크에서 읽는다 (Node fs, _readSrtPath). 경로가 화자 표에 남아 ⟳·바뀜 알림에 쓰인다
	function _cmdReadFiles(files) {
		if (!Array.isArray(files) || !files.length) return { error: "files는 [{name, b64}] 또는 [{path}] 배열" };
		const out = [];
		for (const f of files) {
			if (f && typeof f.path === "string" && f.path && f.b64 === undefined) {
				const r = _readSrtPath(f.path);
				if (r.error) return { error: r.error };
				if (typeof f.name === "string" && f.name) r.file.name = f.name;
				out.push(r.file);
				continue;
			}
			if (!f || typeof f.name !== "string" || !f.name || typeof f.b64 !== "string") return { error: "files[]는 {name, b64} 또는 {path}" };
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
		// 부른 쪽이 알고 있는 시퀀스·빌드 (5단계 인박스가 싣는다): 다르면 거절한다
		if (ctx && ctx.seqId !== undefined && String(ctx.seqId) !== String(state.currentSequenceId || "")) return _cmdErr("seq-mismatch", "지금 시퀀스: " + String(state.currentSequenceId || ""));
		if (ctx && ctx.build !== undefined && String(ctx.build) !== MI_BUILD_PANEL) return _cmdErr("build-mismatch", "패널 빌드: " + MI_BUILD_PANEL);
		const mutating = Object.prototype.hasOwnProperty.call(CMD_MUTATING, op);
		if (source === "agent") {
			if (CMD_UI_ONLY[op]) return _cmdErr("needs-approval", "승인은 패널에서만 합니다");
			if (mutating) return _agentEnqueue(op, args || {}, ctx);
		}
		if ((mutating || CMD_BUSY_BLOCKED[op]) && (_miBusy || _legacyRun)) return _cmdErr("busy", "타임라인 적용이 실행 중");
		if (mutating || CMD_BUSY_BLOCKED[op]) _bumpActivity();
		try {
			return await _COMMANDS[op](args || {}, { source, by: ctx && typeof ctx.by === "string" ? ctx.by : undefined });
		} catch (e) {
			console.error("[MOGRT] runCommand 예외:", op, e);
			return _cmdErr("exception", (e && e.message) || String(e));
		}
	}
	// 무작업 자동저장 시계를 되돌린다 (명령도 사용자 작업이다). 시계(main.ts)는 부팅 끝에 선언된다 → 그 전이면 넘어간다
	function _bumpActivity() {
		try {
			_lastActivityTime = Date.now();
		} catch (_) {}
	}
	window._mogrtDebug.cmd = (op, args) => runCommand(op, args, { source: "test" });
	// 다른 출처로 부른다 (agent가 needs-approval을 받는지 시험할 때). extra: {seqId, build, by}
	window._mogrtDebug.cmdAs = (source, op, args, extra) => runCommand(op, args, Object.assign({}, extra || {}, { source }));
	//#endregion
	//#region src/mi/apply.ts
	// ─────────────────────────────────────────────────────────────
	// 레거시 목록(화자 표 없음)의 타임라인 적용 — 바꾸지 않은 v27 호스트 (S1-9)
	//
	// ▶ → doApplyToTimeline(main.ts):
	//   대상 줄에 병합 표시(mm)도 v27에 위험한 줄(isV27Unsafe)도 없으면 → _legacyApply = v27 본문 그대로
	//     (같은 페이로드, 같은 기록·상태 줄. session.json에 새 키를 쓰지 않는다)
	//   있으면 → 확인창 [안전하게 적용 (N)] [지금 방식으로 전체 적용] [취소]
	//     안전하게 적용 = _legacySafeUpdateV27: 한 줄씩 updateClipAtTime(mogrtPath "")으로 제자리 갱신.
	//       mogrtPath가 비면 v27 호스트는 클립을 새로 놓지도 밀지도 않는다 (못 찾으면 "ERROR: 클립 없음 …").
	//       보내는 속성은 이름 확인 쓰기(index -1 → applyParamsToItem이 displayName으로 찾는다):
	//       문장만 바뀐 줄은 캡션 하나, 구조가 다른 줄은 이름으로 쓸 수 있는 속성 전부 (core legacySafeParams).
	//       시간이 바뀐 줄·새 줄·0.5초 안에 다른 줄이 있는 줄은 건너뛰고 까닭을 줄에 적는다(.sub-res).
	//     지금 방식으로 전체 적용 = _legacyApply: 위험한 줄만 namedParams, 나머지는 v27 바이트.
	// v27 결과는 실패가 있어도 SUCCESS다 → "(실패"가 없을 때만 검증된 적용으로 보고 ap를 적고 mm을 지운다.
	// ↑(updateSingleClip)는 위험하거나 시간이 바뀐 줄만 이름으로 쓴다 (subtitleList).
	// S2-5: v28 호스트가 답하면(같은 빌드, 이 시퀀스) [안전하게 적용]과 ↑(위험하거나 시간이 바뀐 줄)는 nodeId 기준 레거시 안전 경로
	// _legacySafeApply(아래 '레거시 안전 경로')를 쓴다 — 시간 변경은 옮기고 새 줄은 놓는다. _legacySafeUpdateV27은 v28 호스트가 답하지 않을 때만.
	// v27 호스트로 타임라인을 바꾸면(▶ 지금 방식·↑·1단계 안전 적용·네이티브 교체) 마지막 적용 기록은 되돌리지 않는다 (_supersedeLastApply).
	// ─────────────────────────────────────────────────────────────
	// 건너뛴 까닭 (줄 표시 .sub-res와 상태 줄)
	const LEGACY_WHY = {
		new: "새 줄: 타임라인에 아직 없음",
		time: "시간이 바뀜: 이 버전에서 자동으로 옮길 수 없음",
		near: "근처에 다른 줄이 있어 건너뜀",
		"no-preset": "프리셋 없음",
		"no-params": "속성 없음",
		native: "네이티브 템플릿: 제자리 갱신 불가 (지금 방식으로 전체 적용·↑가 교체한다)",
		"caption-name": "캡션 필드 이름이 겹쳐 이름으로 쓸 수 없음",
		"no-caption": "캡션 필드를 찾지 못함",
		"no-named": "이름으로 쓸 속성이 없음"
	};
	const LEGACY_MISSING = "타임라인에 클립 없음";
	// 줄 결과 문구 (.sub-res). renderAll이 모두 비운다
	function _setRowRes(id, text) {
		if (!_rowRes) _rowRes = {};
		if (text) _rowRes[id] = text;
		else delete _rowRes[id];
	}
	function _resBadge(id) {
		const text = _rowRes && _rowRes[id];
		if (!text) return null;
		const el = document.createElement("span");
		el.className = "sub-res";
		el.textContent = text;
		el.title = text;
		return el;
	}
	// 행 머리의 표시(병합 점·포인트 경고·결과 문구)만 다시 그린다 (속성창은 그대로)
	function _refreshRowMarks(sub) {
		const row = document.getElementById("row-" + sub.id);
		const hdr = row && row.querySelector(".sub-header");
		const num = hdr && hdr.querySelector(".sub-num");
		if (!num) return;
		hdr.querySelectorAll(".sub-mm, .sub-warn, .sub-sugg, .sub-res, .sub-struct, .sub-orph").forEach((el) => el.parentNode && el.parentNode.removeChild(el));
		let after = num;
		_rowMarkEls(sub, state.rowStates[sub.id]).forEach((el) => {
			hdr.insertBefore(el, after.nextSibling);
			after = el;
		});
	}
	// 대상 줄 → [{sub, rs, preset, unsafe, track, fresh}]. track은 마지막 검증 적용의 트랙(ap.t), 없으면 지금 트랙 선택.
	// fresh: 타임라인에 놓인 적 없는 줄 (core legacyFresh — 되돌린 줄은 마지막 적용 기록을 본다. 레거시 안전 경로가 못 찾으면 새로 놓는 줄)
	function _legacyTargets(subs) {
		const trackIndex = _trackValueNum();
		let la;
		const laOf = () => {
			if (la === undefined) {
				try { la = _readLastApply(); } catch (_) { la = null; }
			}
			return la;
		};
		return subs.map((sub) => {
			const rs = state.rowStates[sub.id];
			const preset = rs && rs.presetId ? state.presets[rs.presetId] || null : null;
			const fresh = legacyFresh(rs, rs && rs.mm === "undone" && !rs.ap && !rs.mmPrev ? laOf() : null, sub.id);
			return { sub, rs, preset, unsafe: isV27Unsafe(rs, preset), track: rs && rs.ap && typeof rs.ap.t === "number" ? rs.ap.t : trackIndex, fresh };
		});
	}
	// 대상 중 확인이 필요한 줄 (병합 표시가 있거나 v27에 위험)
	function _legacyFlagged(subs) {
		return _legacyTargets(subs).filter((t) => t.rs && (t.rs.mm || t.unsafe));
	}
	// v27 ▶ 본문 (doApplyToTimeline v27). 달라진 것은 셋이다:
	//   v27에 위험한 줄은 namedParams를 보낸다 (나머지 줄은 v27과 같은 바이트)
	//   결과에 "(실패"가 없을 때만 mm·위험·ap가 있는 줄에 ap를 적고 병합 표시를 지운다
	//   네이티브 프리셋 줄은 구운 사본을 텍스트 params 없이 보낸다 (_nativePrepare, S1-11. 네이티브 줄이 없으면 하지 않는다).
	//   새로 놓는 네이티브 클립 창 안의 위험한 줄(nat.risk)은 ap를 적지 않고 줄에 표시한다
	async function _legacyApply(targetSubs) {
		const trackSel = document.getElementById("trackSel");
		const trackIndex = parseInt(trackSel.value, 10);
		const seq = _importSeqToken();
		// v27 ▶는 마지막 적용 기록(last_apply)의 클립을 다시 놓거나 바꿀 수 있다 → 그 기록은 되돌리지 않는다 (S2-5).
		// 타임라인을 바꾼 뒤에 적는다: 네이티브 클립을 지웠을 때(_removeNativeSpots), applyToTimeline이 바꿨을(수 있을) 때 (v27MayHaveChanged)
		// 네이티브 줄이 없는 목록은 기다리지 않고 v27 그대로 (굽기·지우기 없음)
		const nat = _hasNativeWork(targetSubs) ? await _nativePrepare(targetSubs, trackIndex, seq) : null;
		if (nat === false) return;
		// 새로 놓는 네이티브 클립 창 안에 클립이 있어 앞부분이 잘리거나 지워질 수 있는 줄: v27은 적용 전에 모은 옛 클립 참조에 써서
		// 성공으로 센다 → 검증된 적용(ap)을 적지 않고 병합 표시도 남긴다. 놓은 뒤 줄에 위험을 표시한다
		const risky = nat ? _idSet(nat.risk) : {};
		const books = [];
		const items = [];
		(nat ? _nativeOrder(targetSubs, nat) : targetSubs).forEach((sub) => {
			const rs = state.rowStates[sub.id];
			const preset = rs.presetId ? state.presets[rs.presetId] : null;
			const bk = nat ? nat.baked[sub.id] : null;
			if (nat && nat.extra[sub.id]) {
				// 연쇄로 다시 놓는 줄 (대상이 아니다): 마지막 검증 적용 그대로. ap는 바꾸지 않는다
				items.push(_nativeExtraItem(sub, rs));
				return;
			}
			if (bk) {
				// 굽지 못한 네이티브 줄은 놓지 않는다 (기본 문구·빈 글자로 놓이지 않게. 줄에 까닭이 적혀 있다)
				if (!bk.ok) return;
				if (!risky[sub.id]) books.push({ sub, rs, preset, nk: bk.key });
				items.push({ mogrtPath: bk.path, startSec: sub.startSec, endSec: sub.endSec, text: sub.text, params: [] });
				return;
			}
			const unsafe = isV27Unsafe(rs, preset);
			const params = unsafe ? namedParams(rowSendParams(rs)) : rs._allParams.length > 0 ? rs._allParams : rs.params;
			if (needsApplyBook(rs, unsafe) && !risky[sub.id]) books.push({ sub, rs, preset });
			items.push({
				mogrtPath: preset ? preset.mogrtPath : "",
				startSec: sub.startSec,
				endSec: sub.endSec,
				text: sub.text,
				params
			});
		});
		// 네이티브 일이 있으면 놓는 시작 순서로 보낸다 (먼저 놓은 클립의 끝을 줄인 뒤에 다음 클립을 놓게)
		if (nat) items.sort((a, b) => a.startSec - b.startSec);
		const note = nat ? _nativeNote(nat) : { text: "", err: false };
		if (!items.length) {
			setStatus("타임라인에 놓을 줄이 없습니다" + note.text, "err");
			return;
		}
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
			if (v27MayHaveChanged(err)) _supersedeLastApply();
			btnApply.disabled = false;
			setStatus("타임라인 적용 실패: " + (err.hostReason || err.message), "err");
			return;
		}
		if (v27MayHaveChanged(res)) _supersedeLastApply();
		btnApply.disabled = false;
		if (nat && seq === _importSeqToken()) _markNativeRisk(nat.risk);
		if (res.startsWith("SUCCESS")) {
			const ok = v27ResultOk(res);
			// 그 사이 시퀀스가 바뀌었으면(폴러가 목록을 바꿨다) 적지 않는다
			if (ok && books.length && seq === _importSeqToken()) {
				books.forEach((b) => {
					markApplied(b.rs, b.sub, b.preset, trackIndex, b.nk);
					_setRowRes(b.sub.id, null);
					_refreshRowMarks(b.sub);
				});
				saveSessionToStorage();
				updateMultiSelect();
			}
			_saveHistoryOnAction("타임라인 적용 (" + items.length + "개)");
			const kept = ok ? 0 : books.filter((b) => b.rs.mm).length;
			if (kept) setStatus(res.replace("SUCCESS:", "").trim() + " — 실패 " + v27FailCount(res) + "개가 있어 바뀐 줄 " + kept + "개의 표시를 남겼습니다" + note.text, "err");
			else setStatus(res.replace("SUCCESS:", "").trim() + note.text, note.err ? "err" : "ok");
		} else setStatus(res.replace("ERROR:", "").trim() + note.text, "err");
	}
	// ▶ 확인창: 바뀐 줄·구조가 바뀐 줄이 있을 때 (flagged = _legacyFlagged(targetSubs)).
	// v28 호스트가 답하면(같은 빌드, 이 시퀀스) [안전하게 적용]은 레거시 안전 경로 _legacySafeApply (nodeId로 찾아 갱신·이동·새로 놓기, S2-5),
	// 아니면 1단계 경로 _legacySafeUpdateV27 (updateClipAtTime 제자리 갱신만)
	async function _legacyApplyChoice(targetSubs, flagged) {
		const seq = _importSeqToken();
		const v28 = await _legacyV28Ok();
		if (seq !== _importSeqToken()) {
			setStatus("시퀀스가 바뀌어 적용을 취소했습니다", "err");
			return;
		}
		const changed = flagged.filter((t) => t.rs.mm);
		const timeN = changed.filter((t) => rowTimeChanged(t.rs, t.sub)).length;
		const unsafeN = flagged.filter((t) => t.unsafe).length;
		const parts = [];
		if (changed.length) parts.push("바뀐 줄 " + changed.length + "개" + (timeN ? "(시간 변경 " + timeN + "개 포함)" : ""));
		if (unsafeN) parts.push("구조가 바뀐 줄 " + unsafeN + "개");
		const lines = [parts.join("와 ") + "가 있습니다.", ""];
		let sendN = 0;
		let safeRun = null;
		const ids = flagged.map((t) => t.sub.id);
		if (v28) {
			const isNat = (t) => !t.preset || _isNativePreset(t.preset) || !!(t.rs.ap && t.rs.ap.nk);
			const nat = flagged.filter(isNat).length;
			// 새로 놓을 수 있는 줄 = 타임라인에 놓인 적 없는 줄(fresh)뿐이다 (legacyMiPlan: 나머지는 못 찾으면 건너뛴다)
			const newN = flagged.filter((t) => t.fresh && !isNat(t)).length;
			sendN = flagged.length - nat;
			lines.push("안전하게 적용: 이 줄들의 클립만 타임라인에서 찾아(nodeId) 제자리 갱신·시간 이동·새로 놓기를 합니다. 다른 줄의 클립은 건드리지 않고, 클립 이름에 태그를 붙이지 않습니다.");
			if (timeN) lines.push("  · 시간이 바뀐 줄 " + timeN + "개는 클립을 새 시간으로 옮깁니다.");
			if (newN) lines.push("  · 새 줄 " + newN + "개는 새로 놓습니다 (뒤 클립의 앞부분을 보호합니다).");
			if (sendN > newN) lines.push("  · 그 밖의 줄은 클립을 찾지 못하면 새로 놓지 않고 건너뜁니다 (줄에 까닭이 표시됩니다).");
			if (nat) lines.push("  · 네이티브·프리셋 없는 줄 " + nat + "개는 건너뜁니다 (지금 방식으로 전체 적용·↑가 교체합니다).");
			safeRun = () => _legacySafeApply(ids);
		} else {
			const plan = legacySafePlan(flagged, legacyNeighbors(state.subtitles, state.rowStates, state.trashBin));
			const count = (why) => plan.filter((p) => p.why === why).length;
			sendN = plan.filter((p) => p.op === "update").length;
			lines.push("안전하게 적용: 이 줄들만 제자리에서 속성 이름으로 갱신합니다. 클립을 새로 놓거나 밀거나 옮기지 않습니다.");
			if (count("time")) lines.push("  · 시간이 바뀐 줄 " + count("time") + "개는 이 버전에서 자동으로 옮길 수 없습니다.");
			if (count("new")) lines.push("  · 새 줄 " + count("new") + "개는 아직 타임라인에 없습니다 (↑로 한 줄씩 놓을 수 있습니다).");
			if (count("near")) lines.push("  · 0.5초 안에 다른 줄이 있는 " + count("near") + "개는 건너뜁니다.");
			const other = plan.filter((p) => p.op === "skip" && ["time", "new", "near"].indexOf(p.why) === -1).length;
			if (other) lines.push("  · 그 밖에 " + other + "개는 건너뜁니다 (줄에 까닭이 표시됩니다).");
			safeRun = () => _legacySafeUpdateV27(ids);
		}
		lines.push("", "지금 방식으로 전체 적용: 대상 " + targetSubs.length + "줄을 지금까지처럼 다시 적용합니다. 기존 클립을 찾지 못한 줄은 새로 놓여 다음 자막의 앞부분을 자를 수 있습니다.");
		const guard = (fn) => () => {
			if (seq !== _importSeqToken()) {
				setStatus("시퀀스가 바뀌어 적용을 취소했습니다", "err");
				return;
			}
			fn();
		};
		showChoice(lines.join("\n"), [
			{ label: "안전하게 적용 (" + sendN + ")", run: guard(safeRun) },
			{ label: "지금 방식으로 전체 적용", run: guard(() => _legacyApply(targetSubs)) },
			{ label: "취소", run: () => setStatus("타임라인 적용 취소", "") }
		]);
	}
	// 안전하게 적용: ids(목록 줄 id)를 한 줄씩 updateClipAtTime(mogrtPath "")으로 제자리 갱신한다.
	// 줄 사이마다 [중지]와 시퀀스 전환을 확인한다. → {updated, missing, failed, skipped: {까닭: n}, stopped, aborted}
	async function _legacySafeUpdateV27(ids) {
		if (_legacyRun) {
			setStatus("안전하게 적용이 이미 실행 중입니다", "err");
			return null;
		}
		const want = {};
		(ids || []).forEach((id) => { want[id] = true; });
		const targets = _legacyTargets(state.subtitles.filter((s) => want[s.id] && !s.spk));
		const plan = legacySafePlan(targets, legacyNeighbors(state.subtitles, state.rowStates, state.trashBin));
		const byId = {};
		targets.forEach((t) => { byId[t.sub.id] = t; });
		const report = { updated: 0, missing: 0, failed: 0, skipped: {}, stopped: false, aborted: false };
		plan.forEach((p) => {
			if (p.op === "skip") report.skipped[p.why] = (report.skipped[p.why] || 0) + 1;
			_setRowRes(p.id, p.op === "skip" ? LEGACY_WHY[p.why] || p.why : null);
			_refreshRowMarks(byId[p.id].sub);
		});
		const todo = plan.filter((p) => p.op === "update");
		const seq = _importSeqToken();
		// v27 호스트로 쓴 줄이 타임라인을 바꿨으면(바꿨을 수 있으면) 마지막 적용 기록은 되돌리지 않는다 (줄마다 결과를 보고 적는다)
		const run = { stop: false };
		_legacyRun = run;
		const btnApply = document.getElementById("btnApply");
		const btnStop = document.getElementById("btnApplyStop");
		if (btnApply) btnApply.disabled = true;
		if (btnStop) btnStop.style.display = "";
		try {
			for (let k = 0; k < todo.length; k++) {
				if (run.stop) {
					report.stopped = true;
					break;
				}
				if (seq !== _importSeqToken()) {
					report.aborted = true;
					break;
				}
				const p = todo[k];
				const t = byId[p.id];
				setStatus("안전하게 적용 중… " + (k + 1) + "/" + todo.length, "info");
				let res;
				let got;
				try {
					got = res = await host.updateClipAtTime({ videoTrackIndex: p.track, startSec: p.startSec, endSec: p.endSec, mogrtPath: "", params: p.params });
				} catch (err) {
					got = err;
					res = "ERROR: " + (err.hostReason || err.message);
				}
				if (v27MayHaveChanged(got)) _supersedeLastApply();
				if (seq !== _importSeqToken()) {
					report.aborted = true;
					break;
				}
				if (res.indexOf("SUCCESS") === 0) {
					markApplied(t.rs, t.sub, t.preset, p.track);
					_setRowRes(p.id, null);
					report.updated++;
				} else if (res.indexOf("클립 없음") !== -1) {
					_setRowRes(p.id, LEGACY_MISSING);
					report.missing++;
				} else {
					_setRowRes(p.id, "적용 실패: " + res.replace(/^ERROR:\s*/, ""));
					report.failed++;
				}
				_refreshRowMarks(t.sub);
			}
		} finally {
			_legacyRun = null;
			if (btnApply) btnApply.disabled = false;
			if (btnStop) btnStop.style.display = "none";
		}
		if (report.aborted) {
			setStatus("시퀀스가 바뀌어 안전하게 적용을 멈췄습니다 (" + report.updated + "개 적용)", "err");
			return report;
		}
		if (report.updated) {
			saveSessionToStorage();
			_saveHistoryOnAction("안전하게 적용 (" + report.updated + "개)");
		}
		updateMultiSelect();
		const SHORT = { time: "시간 변경", new: "새 줄", near: "근처 줄" };
		const parts = ["갱신 " + report.updated];
		if (report.missing) parts.push("클립 없음 " + report.missing);
		if (report.failed) parts.push("실패 " + report.failed);
		let other = 0;
		Object.keys(report.skipped).forEach((why) => { if (!SHORT[why]) other += report.skipped[why]; });
		Object.keys(SHORT).forEach((why) => { if (report.skipped[why]) parts.push(SHORT[why] + " " + report.skipped[why]); });
		if (other) parts.push("건너뜀 " + other);
		let msg = (report.stopped ? "중지함 — " : "") + "안전하게 적용: " + parts.join(" · ");
		if (report.skipped.time) msg += " — 시간이 바뀐 줄 " + report.skipped.time + "개는 이 버전에서 자동으로 옮길 수 없습니다";
		setStatus(msg, report.missing || report.failed || report.stopped ? "err" : "ok");
		return report;
	}
	document.getElementById("btnApplyStop")?.addEventListener("click", () => {
		if (_legacyRun) _legacyRun.stop = true;
	});

	// ─────────────────────────────────────────────────────────────
	// 네이티브 템플릿 적용 — 굽기 (S1-11)
	//
	// Premiere에서 만든(네이티브) MOGRT의 Source Text.setValue는 빈 글자로 그려진다. v27 applyParamsToItem의 네이티브
	// 분기는 '성공'을 알리며 문구를 지운다 (docs/spike_s0.md §3-1a). 그래서 문구를 .mogrt 사본에 구워 놓는다 (core S1-11).
	//   ▶(_legacyApply)·↑(_nativeUpdateSingle)·프리셋 창 미리보기(runPreviewCapture) 모두
	//   mogrtPath = 구운 사본, 텍스트 params는 보내지 않는다 → v27 호스트가 Source Text에 쓰지 않는다 (호스트는 그대로).
	//   v27 applyToTimeline은 같은 시작(10ms 키)의 기존 클립이 네이티브면 MOGRT 경로를 몰라 '같은 MOGRT'로 보고 속성만
	//   쓴다(빈 목록 → 아무것도 안 함, 끝만 맞춘다) → 문구·자리가 바뀐 줄은 먼저 그 네이티브 클립을 지우고 v27이 새로 놓게 한다
	//   (교체. 제자리 갱신은 할 수 없다). 문구·트랙·시작이 마지막 검증 적용(ap.nk·ap.t·ap.s)과 같은 줄은 지우지 않는다.
	// 구운 사본: cache/{projKey}/baked/<키>.mogrt. 같은 키가 있으면 다시 만들지 않는다 (수정 시각만 새로: 정리 기준).
	// zip은 이미 로드된 JSZip, prgraphic 안 .prproj(gzip)는 Node zlib, 파일은 Node fs (CEP --enable-nodejs).
	// 사본에는 썸네일 동영상·지역화 썸네일을 넣지 않는다 (thumb.png는 둔다. 템플릿 하나가 1MB를 넘어 줄마다 쌓이지 않게.
	// thumb.png만 있는 네이티브 템플릿도 그대로 가져와진다). 어떤 줄도 가리키지 않고 30일 쓰지 않은 사본은 지운다
	// (프로젝트 빈 'Motion Graphics Template Media'의 항목은 사용자가 정리한다).
	// 새 Premiere가 저장한 템플릿(apiVersion 2.x)은 Source Text가 이진 형식이라 굽지 못한다 → 그 줄은 놓지 않고 까닭을 적는다.
	// ─────────────────────────────────────────────────────────────
	const BAKED_DIR = "baked";
	const BAKED_PRUNE_MS = 30 * 24 * 3600 * 1000;
	const BAKED_TMP_PRUNE_MS = 24 * 3600 * 1000;
	// 굽지 못한 까닭 (상태 줄·줄 표시)
	const BAKE_WHY = {
		"no-node": "Node 모듈을 쓸 수 없음",
		"no-zip": "JSZip이 없음",
		"no-cache": "캐시 폴더를 모름",
		source: "원본 MOGRT를 읽지 못함",
		definition: "definition.json을 읽지 못함",
		fields: "텍스트 필드 수가 템플릿과 다름",
		format: "이 템플릿의 텍스트 형식을 모름 (새 형식)",
		write: "사본을 쓰지 못함"
	};
	var _bakedPruned = {}; // projKey → 이번 세션에 구운 사본을 정리했는가
	var _bakeDurMemo = {}; // 템플릿 경로|수정 시각 → 템플릿 길이(초, definition). 연쇄 창에 쓴다 (_templateDurSec)
	// Node 모듈 (CEP --enable-nodejs --mixed-context). 못 쓰면 null
	function _nodeRequire(name) {
		try {
			const req = window.cep_node && typeof window.cep_node.require === "function" ? window.cep_node.require : typeof require === "function" ? require : null;
			return req ? req(name) : null;
		} catch (_) {
			return null;
		}
	}
	function _errText(e) {
		return String((e && e.message) || e);
	}
	function _bakedDir() {
		const root = _getCacheRoot();
		return root ? root + "/" + state.currentProjectKey + "/" + BAKED_DIR : null;
	}
	// 구운 사본에 넣지 않는 항목: 썸네일 동영상과 지역화 썸네일 (thumb.png는 둔다)
	function _bakeDropEntry(name) {
		return /^thumb[^/]*\.(mp4|mov|m4v)$/i.test(name) || /^thumb_[A-Za-z]{2}_[A-Za-z]{2}\.(png|jpe?g)$/i.test(name);
	}
	// MOGRT 파일(원본 템플릿, AE·네이티브)의 길이(초): definition.json의 sourceInfoLocalized duration (mogrtDefDurSec).
	// 경로|수정 시각마다 한 번 읽는다 (zip 목록과 definition.json만 푼다). 못 읽으면 0 (→ 연쇄 창은 NATIVE_PLACE_SEC).
	// mtime: 호출부가 이미 읽은 수정 시각 (없으면 여기서 읽는다)
	async function _templateDurSec(path, mtime) {
		const fs = _nodeRequire("fs");
		if (!fs || typeof JSZip === "undefined" || !path) return 0;
		let m = mtime;
		if (typeof m !== "number") {
			try {
				m = fs.statSync(path).mtimeMs;
			} catch (_) {
				return 0;
			}
		}
		const memoKey = String(path) + "|" + m;
		if (Object.prototype.hasOwnProperty.call(_bakeDurMemo, memoKey)) return _bakeDurMemo[memoKey];
		let dur = 0;
		try {
			const zip = await JSZip.loadAsync(new Uint8Array(fs.readFileSync(path)));
			const f = zip.file("definition.json");
			if (f) dur = mogrtDefDurSec(jsonParseKeepNumbers(await f.async("string")));
		} catch (_) {}
		_bakeDurMemo[memoKey] = dur;
		return dur;
	}
	// 네이티브 MOGRT srcPath에 texts(index 순)를 구운 사본 → {ok: true, path, key, reused, durSec} | {ok: false, why, detail}
	//   definition.json의 TextLayer 수와 모든 project*.prgraphic의 Source Text 블롭 수가 texts 수와 같아야 한다
	//   (다르면 순서를 믿을 수 없어 굽지 않는다: fields·format)
	async function bakeNativeMogrt(srcPath, texts) {
		const fs = _nodeRequire("fs");
		const zlib = _nodeRequire("zlib");
		if (!fs || !zlib) return { ok: false, why: "no-node" };
		if (typeof JSZip === "undefined") return { ok: false, why: "no-zip" };
		const dir = _bakedDir();
		if (!dir) return { ok: false, why: "no-cache" };
		const list = (texts || []).map((t) => String(t == null ? "" : t));
		let mtime;
		try {
			mtime = fs.statSync(srcPath).mtimeMs;
		} catch (e) {
			return { ok: false, why: "source", detail: _errText(e) };
		}
		const key = nativeBakeKey(srcPath, mtime, list);
		const out = dir + "/" + key + ".mogrt";
		const durKey = String(srcPath) + "|" + mtime;
		let reuse = false;
		try {
			if (fs.existsSync(out)) {
				try {
					const now = new Date();
					fs.utimesSync(out, now, now);
				} catch (_) {}
				reuse = true;
			}
		} catch (_) {}
		// 다시 쓰는 사본의 길이: 이번 세션에 구웠으면 그 값, 아니면(패널을 다시 연 뒤) 원본 definition을 한 번 읽는다
		if (reuse) return { ok: true, path: out, key, reused: true, durSec: await _templateDurSec(srcPath, mtime) };
		let zip;
		try {
			zip = await JSZip.loadAsync(new Uint8Array(fs.readFileSync(srcPath)));
		} catch (e) {
			return { ok: false, why: "source", detail: _errText(e) };
		}
		const defFile = zip.file("definition.json");
		let def = null;
		try {
			if (defFile) def = patchNativeDefinition(await defFile.async("string"), list, uuidFromHash(key));
		} catch (_) {}
		if (!def) return { ok: false, why: "definition" };
		_bakeDurMemo[durKey] = def.durSec || 0;
		if (def.textLayers !== list.length) return { ok: false, why: "fields", detail: "TextLayer " + def.textLayers + " · 필드 " + list.length };
		const graphics = Object.keys(zip.files).filter((n) => !zip.files[n].dir && /(^|\/)project[^/]*\.prgraphic$/i.test(n));
		if (!graphics.length) return { ok: false, why: "format", detail: "prgraphic 없음" };
		try {
			for (const name of graphics) {
				const inner = await JSZip.loadAsync(await zip.file(name).async("uint8array"));
				let found = 0;
				for (const pn of Object.keys(inner.files)) {
					const f = inner.files[pn];
					if (f.dir || !/\.prproj$/i.test(pn)) continue;
					const raw = await f.async("uint8array");
					const gz = raw[0] === 0x1f && raw[1] === 0x8b;
					const r = patchPrprojTexts(gz ? zlib.gunzipSync(raw).toString("utf8") : new TextDecoder("utf-8").decode(raw), list);
					found += r.count;
					if (!r.patched) continue;
					const enc = new TextEncoder().encode(r.xml);
					inner.file(pn, new Uint8Array(gz ? zlib.gzipSync(enc) : enc), { date: f.date });
				}
				if (found !== list.length) return { ok: false, why: "format", detail: name + ": Source Text " + found + " · 필드 " + list.length };
				zip.file(name, await inner.generateAsync({ type: "uint8array", compression: "DEFLATE" }), { date: zip.files[name].date });
			}
		} catch (e) {
			return { ok: false, why: "format", detail: _errText(e) };
		}
		zip.file("definition.json", def.json, { date: defFile.date });
		Object.keys(zip.files).forEach((n) => {
			if (_bakeDropEntry(n)) zip.remove(n);
		});
		try {
			const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
			fs.mkdirSync(dir, { recursive: true });
			const tmp = out + "." + Date.now().toString(36) + Math.random().toString(36).slice(2, 8) + ".tmp";
			fs.writeFileSync(tmp, bytes);
			fs.renameSync(tmp, out);
		} catch (e) {
			return { ok: false, why: "write", detail: _errText(e) };
		}
		_pruneBakedCopies();
		return { ok: true, path: out, key, reused: false, durSec: def.durSec || 0 };
	}
	// 구운 사본 정리 (프로젝트 키마다 세션에 한 번, 새로 구운 뒤): 어떤 줄도 가리키지 않고(ap.nk) 30일 넘게 쓰지 않은 사본과
	// 하루 넘은 쓰다 만 파일(.tmp)을 지운다. 지운 사본이 다시 필요하면 같은 키로 다시 굽는다
	function _pruneBakedCopies() {
		const pk = state.currentProjectKey;
		if (_bakedPruned[pk]) return;
		_bakedPruned[pk] = true;
		const fs = _nodeRequire("fs");
		const dir = _bakedDir();
		if (!fs || !dir) return;
		let names = [];
		try {
			names = fs.readdirSync(dir);
		} catch (_) {
			return;
		}
		const refs = _bakedRefs();
		const now = Date.now();
		names.forEach((n) => {
			const m = /^([0-9a-f]{32})\.mogrt(\.[0-9a-z]+\.tmp)?$/.exec(n);
			if (!m) return;
			const p = dir + "/" + n;
			try {
				const age = now - fs.statSync(p).mtimeMs;
				if (m[2] ? age > BAKED_TMP_PRUNE_MS : !refs[m[1]] && age > BAKED_PRUNE_MS) fs.unlinkSync(p);
			} catch (_) {}
		});
	}
	// 구운 사본을 가리키는 키 {키: true}: 지금 목록·휴지통의 ap.nk와, 이 프로젝트 시퀀스 폴더들의 세션·히스토리·화자 표 파일 속 "nk"
	function _bakedRefs() {
		const refs = {};
		const note = (rs) => {
			if (rs && rs.ap && typeof rs.ap.nk === "string") refs[rs.ap.nk] = true;
		};
		Object.values(state.rowStates || {}).forEach(note);
		(state.trashBin || []).forEach((t) => note(t && t.state));
		const root = _getCacheRoot();
		const fsx = window.cep && window.cep.fs;
		if (!root || !fsx || typeof fsx.readdir !== "function") return refs;
		try {
			const dir = root + "/" + state.currentProjectKey;
			const ls = fsx.readdir(dir);
			if (!ls || ls.err !== 0 || !Array.isArray(ls.data)) return refs;
			const re = /"nk"\s*:\s*"([0-9a-f]{32})"/g;
			ls.data.forEach((name) => {
				if (name === BAKED_DIR) return;
				PRESET_REF_FILES.forEach((f) => {
					const r = fsx.readFile(dir + "/" + name + "/" + f);
					if (!r || r.err !== 0 || !r.data) return;
					let m;
					re.lastIndex = 0;
					while ((m = re.exec(r.data))) refs[m[1]] = true;
				});
			});
		} catch (_) {}
		return refs;
	}
	// 줄의 프리셋 (없으면 null)
	function _rowPreset(sub) {
		const rs = sub ? state.rowStates[sub.id] : null;
		return rs && rs.presetId ? state.presets[rs.presetId] || null : null;
	}
	// 네이티브 프리셋인가 (프리셋 목록이 네이티브 = 그 MOGRT가 네이티브 템플릿)
	function _isNativePreset(preset) {
		return !!preset && isNativeList(preset.params);
	}
	function _bakeWhy(r) {
		return (BAKE_WHY[r && r.why] || (r && r.why) || "알 수 없음") + (r && r.detail ? " (" + r.detail + ")" : "");
	}
	// 줄 하나를 굽는다 (프리셋 MOGRT, 문구 = nativeRowTexts: 줄 값·캡션·프리셋 값)
	function _bakeRow(sub, rs, preset) {
		return bakeNativeMogrt(preset.mogrtPath, nativeRowTexts(rowSendParams(rs), preset.params, preset.textParamIndex, sub.text));
	}
	// ▶ 대상에 네이티브 일이 있는가: 네이티브 프리셋 줄, 또는 전에 네이티브로 놓았던 줄(ap.nk)
	function _hasNativeWork(targetSubs) {
		return (targetSubs || []).some((sub) => {
			const rs = state.rowStates[sub.id];
			return _isNativePreset(_rowPreset(sub)) || !!(rs && rs.ap && rs.ap.nk);
		});
	}
	// 자리 [{t, s}]의 네이티브 클립을 지운다 (트랙마다 한 번) → {ok, removed, error}. seqId: 작업 시퀀스 식별자 (활성이 다르면 지우지 않는다).
	// 지운 클립이 있으면 마지막 적용 기록(last_apply)은 되돌리지 않는다 (v27 ▶·↑의 네이티브 교체, S2-5 superseded)
	async function _removeNativeSpots(spots, seqId) {
		const byTrack = {};
		(spots || []).forEach((p) => {
			(byTrack[p.t] = byTrack[p.t] || []).push(p.s);
		});
		let removed = 0;
		for (const t of Object.keys(byTrack)) {
			let res;
			try {
				res = await host.removeNativeClipsAt({ t: Number(t), s: byTrack[t], seqId });
			} catch (err) {
				return { ok: false, removed, error: err.hostReason || err.message };
			}
			const m = /^SUCCESS:\s*(\d+)/.exec(String(res));
			if (!m) return { ok: false, removed, error: String(res).replace(/^ERROR:\s*/, "") };
			const n = parseInt(m[1], 10);
			if (n > 0 && removed === 0) _supersedeLastApply();
			removed += n;
		}
		return { ok: true, removed };
	}
	// 구운 사본 경로 (키 → cache/{projKey}/baked/<키>.mogrt)
	function _bakedPath(key) {
		const dir = _bakedDir();
		return dir ? dir + "/" + key + ".mogrt" : "";
	}
	// 구운 사본 파일이 있는가 (연쇄로 마지막 적용 그대로 다시 놓을 수 있는가)
	function _bakedExists(key) {
		const fs = _nodeRequire("fs");
		const p = _bakedPath(key);
		try {
			return !!fs && !!p && fs.existsSync(p);
		} catch (_) {
			return false;
		}
	}
	// nativeApplyPlan 입력: 목록 전체(화자 줄 제외)와 휴지통의 적용한 줄(타임라인에 클립이 남는다. 다시 놓지는 않고 위험만 본다).
	// targetIds의 줄은 baked[id] 결과, 그 밖의 네이티브 줄은 ap.nk 사본 파일이 있을 때만 다시 놓을 수 있다.
	// durSec(연쇄 창): 대상 네이티브 줄은 굽기 결과, 대상 밖 네이티브 줄은 지금 프리셋 템플릿 길이(ap.nk 사본도 그 원본에서
	// 구웠다), 전에 네이티브로 놓았던 AE 대상 줄은 그 AE 템플릿 길이 (_templateDurSec: 템플릿마다 한 번 읽는다)
	async function _nativePlanRows(targetIds, baked) {
		const subs = state.subtitles;
		const rowStates = state.rowStates;
		const durs = {};
		const durOf = async (preset) => {
			const p = preset && preset.mogrtPath;
			if (!p) return 0;
			if (!Object.prototype.hasOwnProperty.call(durs, p)) durs[p] = await _templateDurSec(p);
			return durs[p];
		};
		const rows = [];
		for (const sub of subs) {
			if (sub.spk) continue;
			const rs = rowStates[sub.id];
			const preset = rs && rs.presetId ? state.presets[rs.presetId] || null : null;
			const native = _isNativePreset(preset);
			const target = !!targetIds[sub.id];
			const bk = target ? baked[sub.id] : null;
			const apNk = rs && rs.ap && typeof rs.ap.nk === "string" ? rs.ap.nk : null;
			let nk = null;
			let durSec = 0;
			if (bk) {
				nk = bk.ok ? bk.key : null;
				durSec = bk.durSec || 0;
			} else if (!target && native && apNk && _bakedExists(apNk)) {
				nk = apNk;
				durSec = await durOf(preset);
			} else if (target && !native && apNk) durSec = await durOf(preset);
			rows.push({ sub, rs, target, native, nk, durSec });
		}
		(state.trashBin || []).forEach((t) => {
			if (t && t.sub && !t.sub.spk && t.state && t.state.ap) rows.push({ sub: t.sub, rs: t.state, target: false, native: false, nk: null, durSec: 0 });
		});
		return rows;
	}
	// 트랙의 클립 시작 초 (v27 getTimelineClips, 읽기만) → [초] | null (읽지 못함: ap가 없는 줄은 자리를 모르는 채로 계획). 트랙이 없으면 []
	async function _trackClipStarts(trackIndex) {
		let res;
		try {
			res = String(await host.getTimelineClips({ videoTrackIndex: trackIndex }));
		} catch (err) {
			console.warn("[MOGRT] 트랙 클립 읽기 실패 (ap가 없는 줄은 연쇄·위험에서 뺍니다):", err.hostReason || err.message);
			return null;
		}
		if (/^ERROR:\s*트랙 없음/.test(res)) return [];
		if (res.indexOf("ERROR") === 0) return null;
		try {
			const list = JSON.parse(res);
			return Array.isArray(list) ? list.map((c) => Number(c && c.startSec)).filter((x) => isFinite(x)) : null;
		} catch (_) {
			return null;
		}
	}
	// 계획 (nativeApplyPlan). 새로 놓는 줄이 있으면 지금 트랙의 클립 시작을 읽어(ap가 없는 줄의 클립 자리) 다시 세운다
	// (새로 놓는 줄이 없으면 창도 없다 → 읽지 않는다)
	async function _nativePlan(rows, trackIndex) {
		const plan = nativeApplyPlan(rows, trackIndex);
		if (!Object.keys(plan.place).length) return plan;
		return nativeApplyPlan(rows, trackIndex, await _trackClipStarts(trackIndex));
	}
	const NATIVE_RISK_RES = "앞부분이 잘렸을 수 있음 (앞 줄 네이티브 교체)";
	const NATIVE_SEQ_CHANGED_MSG = "시퀀스가 바뀌어 적용을 취소했습니다";
	// 계획의 자리를 지운다 → {ok, removed, error}. seqId: 적용을 시작할 때의 작업 시퀀스 식별자 (state.currentSequenceId).
	// error "seq-changed": 활성 시퀀스가 그 시퀀스가 아니라 지우지 않았다 (적용 중에 사용자가 시퀀스를 바꿨다)
	async function _nativeRemoveFor(plan, seqId) {
		if (!plan.spots.length) return { ok: true, removed: 0 };
		setStatus("네이티브 클립 지우는 중... (" + plan.spots.length + "곳)", "info");
		return _removeNativeSpots(plan.spots, seqId);
	}
	// 그 사이 시퀀스가 바뀌었는가 (폴러가 목록을 바꿨거나, 활성 시퀀스가 작업 시퀀스가 아니라 지우지 않았다) → 상태 줄에 알리고 true.
	// 이미 지운 클립이 있으면 알린다 (그 줄들의 ap는 그대로라 그 시퀀스에서 ▶를 다시 누르면 v27이 빈 자리에 새로 놓는다)
	function _nativeSeqChanged(seq, rm) {
		if (seq === _importSeqToken() && !(rm && !rm.ok && rm.error === "seq-changed")) return false;
		const n = rm && rm.removed ? rm.removed : 0;
		setStatus(NATIVE_SEQ_CHANGED_MSG + (n ? " (이미 지운 네이티브 클립 " + n + "개는 그 시퀀스에서 ▶로 다시 놓을 수 있습니다)" : ""), "err");
		return true;
	}
	// 위험한 줄(nativeApplyPlan risk)을 줄에 표시한다. v27이 놓은 뒤에 부른다 (검증된 적용으로 적지 않은 줄이다)
	function _markNativeRisk(ids) {
		(ids || []).forEach((id) => {
			_setRowRes(id, NATIVE_RISK_RES);
			const sub = state.subtitles.find((s) => s.id === id);
			if (sub) _refreshRowMarks(sub);
		});
	}
	function _idSet(ids) {
		const o = {};
		(ids || []).forEach((id) => { o[id] = true; });
		return o;
	}
	// ▶ 앞 단계 (_legacyApply): 네이티브 프리셋 줄을 굽고(baked[줄 id] = bakeNativeMogrt 결과), 계획(nativeApplyPlan)대로
	// 문구·자리가 바뀐 줄과 전에 네이티브로 놓았던 AE 줄(ap.nk), 연쇄로 다시 놓을 줄의 네이티브 클립을 지운다.
	// 굽지 못한 줄은 줄에 까닭을 적고 지우지도 놓지도 않는다
	// → {baked, failed, extra: {id: true} 연쇄로 다시 놓는 대상 밖 줄, risk: [id]} | false (중단: 시퀀스가 바뀌었거나 지우지 못했다)
	async function _nativePrepare(targetSubs, trackIndex, seq) {
		const seqId = state.currentSequenceId; // seq와 같은 틱에 읽는다 (_legacyApply가 기다리지 않고 부른다)
		const baked = {};
		let failed = 0;
		const natives = targetSubs.filter((sub) => _isNativePreset(_rowPreset(sub)));
		const btnApply = document.getElementById("btnApply");
		if (btnApply) btnApply.disabled = true;
		try {
			for (let k = 0; k < natives.length; k++) {
				const sub = natives[k];
				setStatus("네이티브 템플릿에 문구 굽는 중... " + (k + 1) + "/" + natives.length, "info");
				const r = await _bakeRow(sub, state.rowStates[sub.id], _rowPreset(sub));
				if (_nativeSeqChanged(seq)) return false;
				baked[sub.id] = r;
				if (!r.ok) {
					failed++;
					_setRowRes(sub.id, "네이티브 굽기 실패: " + _bakeWhy(r));
					_refreshRowMarks(sub);
				}
			}
			const plan = await _nativePlan(await _nativePlanRows(_idSet(targetSubs.map((s) => s.id)), baked), trackIndex);
			if (_nativeSeqChanged(seq)) return false;
			const rm = await _nativeRemoveFor(plan, seqId);
			if (_nativeSeqChanged(seq, rm)) return false;
			if (!rm.ok) {
				setStatus("네이티브 클립을 지우지 못해 적용을 멈췄습니다: " + rm.error, "err");
				return false;
			}
			return { baked, failed, extra: _idSet(plan.extra), risk: plan.risk };
		} finally {
			if (btnApply) btnApply.disabled = false;
		}
	}
	// ▶ 페이로드 줄 순서: 연쇄로 다시 놓는 대상 밖 줄이 있으면 목록 순서로 끼워 넣는다
	function _nativeOrder(targetSubs, nat) {
		if (!Object.keys(nat.extra).length) return targetSubs;
		const t = _idSet(targetSubs.map((s) => s.id));
		return state.subtitles.filter((s) => t[s.id] || nat.extra[s.id]);
	}
	// 연쇄로 다시 놓는 대상 밖 줄: 마지막 검증 적용 그대로 (ap.nk 사본을 ap.s~ap.e에)
	function _nativeExtraItem(sub, rs) {
		return { mogrtPath: _bakedPath(rs.ap.nk), startSec: rs.ap.s, endSec: rs.ap.e, text: sub.text, params: [] };
	}
	// 상태 줄 꼬리 → {text, err}
	function _nativeNote(nat) {
		const parts = [];
		if (nat.failed) parts.push("네이티브 " + nat.failed + "줄은 문구를 굽지 못해 놓지 않았습니다 (줄에 까닭 표시)");
		const extra = Object.keys(nat.extra || {}).length;
		if (extra) parts.push("바로 뒤 네이티브 줄 " + extra + "개도 그대로 다시 놓았습니다");
		if (nat.risk && nat.risk.length) parts.push("뒤 줄 " + nat.risk.length + "개는 새로 놓은 클립(약 5초)에 앞부분이 잘렸을 수 있습니다 (줄에 표시)");
		return { text: parts.length ? " — " + parts.join(" · ") : "", err: !!(nat.failed || (nat.risk && nat.risk.length)) };
	}
	// ↑ 한 줄 교체 (_nativeUpdateSingle·_nativeUpdateAe): 계획대로 지우고(그 줄, 새 클립 창 안의 뒤 네이티브 줄) → v27 applyToTimeline으로
	// item과 연쇄 줄(마지막 적용 그대로)을 시작 순서로 놓는다 → 결과에 실패가 없으면 book()으로 검증된 적용을 적는다.
	// updateClipAtTime은 쓰지 않는다: 시작 ±0.5초 안의 다른 줄 클립을 잡아 속성만 쓰거나(네이티브 사본은 빈 목록 → 아무것도 안 함),
	// 클립을 못 찾으면 insertClip(뒤 클립을 민다)·importMGT로 놓는다. applyToTimeline은 같은 시작(10ms 키)만 보고, 없으면 덮어 놓는다
	async function _nativeReplaceOne(sub, item, plan, trackIndex, seq, seqId, book, doneText) {
		// 마지막 적용 기록(last_apply)은 타임라인을 바꾼 뒤에 superseded로 적는다 (_removeNativeSpots·v27MayHaveChanged)
		const rm = await _nativeRemoveFor(plan, seqId);
		if (_nativeSeqChanged(seq, rm)) return;
		if (!rm.ok) {
			setStatus("[" + sub.index + "] 네이티브 클립을 지우지 못했습니다: " + rm.error, "err");
			return;
		}
		const extra = _idSet(plan.extra);
		const items = [item]
			.concat(state.subtitles.filter((s) => extra[s.id]).map((s) => _nativeExtraItem(s, state.rowStates[s.id])))
			.sort((a, b) => a.startSec - b.startSec);
		let res;
		try {
			res = await host.applyToTimeline({ videoTrackIndex: trackIndex, subtitles: items });
		} catch (err) {
			if (v27MayHaveChanged(err)) _supersedeLastApply();
			setStatus("클립 업데이트 실패: " + (err.hostReason || err.message), "err");
			return;
		}
		if (v27MayHaveChanged(res)) _supersedeLastApply();
		const same = seq === _importSeqToken();
		const note = _nativeNote({ failed: 0, extra, risk: plan.risk });
		if (v27ResultOk(res)) {
			if (same) {
				book();
				_setRowRes(sub.id, null);
				_refreshRowMarks(sub);
				saveSessionToStorage();
				updateMultiSelect();
			}
			setStatus("[" + sub.index + "] " + doneText + note.text, note.err ? "err" : "ok");
		} else setStatus("[" + sub.index + "] " + String(res).replace(/^(SUCCESS|ERROR):\s*/, "") + note.text, "err");
		if (same) _markNativeRisk(plan.risk);
	}
	// ↑ 네이티브 줄 (updateSingleClip): 굽고 → 계획대로 교체 (_nativeReplaceOne)
	async function _nativeUpdateSingle(sub, rs, preset) {
		const trackIndex = parseInt(document.getElementById("trackSel").value, 10);
		const seq = _importSeqToken();
		const seqId = state.currentSequenceId;
		setStatus("[" + sub.index + "] 네이티브 템플릿에 문구 굽는 중...", "info");
		const bk = await _bakeRow(sub, rs, preset);
		if (_nativeSeqChanged(seq)) return;
		if (!bk.ok) {
			_setRowRes(sub.id, "네이티브 굽기 실패: " + _bakeWhy(bk));
			_refreshRowMarks(sub);
			setStatus("[" + sub.index + "] 네이티브 템플릿에 문구를 굽지 못했습니다: " + _bakeWhy(bk), "err");
			return;
		}
		const plan = await _nativePlan(await _nativePlanRows(_idSet([sub.id]), { [sub.id]: bk }), trackIndex);
		if (_nativeSeqChanged(seq)) return;
		const item = { mogrtPath: bk.path, startSec: sub.startSec, endSec: sub.endSec, text: sub.text, params: [] };
		const done = "네이티브 클립 " + (Object.prototype.hasOwnProperty.call(plan.place, sub.id) ? "교체" : "적용") + " 완료";
		await _nativeReplaceOne(sub, item, plan, trackIndex, seq, seqId, () => markApplied(rs, sub, preset, trackIndex, bk.key), done);
	}
	// ↑ 전에 네이티브로 놓았던 줄(ap.nk)을 AE 프리셋으로 (updateSingleClip): 그 네이티브 클립을 지우면 v27이 AE 템플릿을 새로 놓는다
	// (템플릿 길이 창을 차지한다) → 네이티브 줄과 같은 계획으로 교체한다 (창 안의 뒤 네이티브 줄은 연쇄, 그 밖은 위험 표시)
	async function _nativeUpdateAe(sub, rs, preset, params) {
		const trackIndex = parseInt(document.getElementById("trackSel").value, 10);
		const seq = _importSeqToken();
		const seqId = state.currentSequenceId;
		setStatus("[" + sub.index + "] 네이티브 클립을 AE 템플릿으로 바꾸는 중...", "info");
		const plan = await _nativePlan(await _nativePlanRows(_idSet([sub.id]), {}), trackIndex);
		if (_nativeSeqChanged(seq)) return;
		const item = { mogrtPath: preset.mogrtPath, startSec: sub.startSec, endSec: sub.endSec, text: sub.text, params };
		await _nativeReplaceOne(sub, item, plan, trackIndex, seq, seqId, () => markApplied(rs, sub, preset, trackIndex), "네이티브 클립을 AE 템플릿으로 교체 완료");
	}
	// DEV·하드 테스트 훅: 굽기와 네이티브 클립 지우기를 직접 부른다 (코드를 고치지 않고 확인할 때)
	window._mogrtDebug.bakeNative = (srcPath, texts) => bakeNativeMogrt(srcPath, texts);
	window._mogrtDebug.removeNativeClipsAt = (payload) => host.removeNativeClipsAt(payload);

	// ── v28 호스트 확인 (S2-1) ──
	// 화자별 배치(MI_ 호출) 실행마다 먼저 ping한다. 실행 사이에 결과를 캐시하지 않는다: hostscript.jsx는 Premiere를
	// 다시 시작할 때까지 캐시되고, 모든 CEP 확장이 전역 범위를 같이 써 마지막에 로드된 것이 이긴다 (spike #16).
	// v 28이고 빌드가 이 패널(MI_BUILD_PANEL)과 같아야 한다. 아니면 화자 모드 동작에서만 MI_HOST_STALE_MSG를 보이고
	// 아무것도 보내지 않는다. 레거시(v27) 경로는 이 확인과 상관없이 그대로 동작한다.
	// → {ok: true, ping} | {ok: false, msg, why: "no-host"|"version"|"build", ping}
	const MI_HOST_STALE_MSG = "다른 버전의 호스트 스크립트가 로드됨 — Premiere를 다시 시작하세요";
	async function _miHostOk() {
		let ping = null;
		try {
			ping = await host.mi.ping();
		} catch (_) {
			return { ok: false, msg: MI_HOST_STALE_MSG, why: "no-host", ping: null };
		}
		if (!ping || ping.ok !== true || ping.v !== 28) return { ok: false, msg: MI_HOST_STALE_MSG, why: "version", ping };
		if (ping.build !== MI_BUILD_PANEL) return { ok: false, msg: MI_HOST_STALE_MSG, why: "build", ping };
		return { ok: true, ping };
	}
	// DEV·하드 테스트 훅: 호스트 확인과 v28 호출을 패널 어댑터 그대로 부른다 (build·seqId·U+2028 이스케이프 포함).
	// hostMi는 host.mi 그 자체 (ping·getTracks·readTexts·ensureTracks·placeChunk·removeClips)
	window._mogrtDebug.miHostOk = () => _miHostOk();
	window._mogrtDebug.callMi = (name, payload) => _callMi(name, payload);
	window._mogrtDebug.hostMi = host.mi;

	// ─────────────────────────────────────────────────────────────
	// 화자별 배치 (다화자 ▶·↑, S2-4) — 계획서 §6, spec placement
	//
	// _miApply(대상 줄, opts):
	//   1) 호스트 확인 (_miHostOk: 실행마다 ping, v28·같은 빌드), 활성 시퀀스 = 패널 시퀀스. seqId를 한 번 잡아 모든 호출에 싣는다
	//   2) 네이티브 줄 굽기(문구를 .mogrt 사본에, S1-11), AE 템플릿 길이(preset.mogrtDurSec, 없으면 definition.json)
	//   3) getTracks: 기본 트랙부터 위·화자 트랙·legacyTrack·줄이 마지막으로 놓인 트랙 (_miScanTracks), 대상 줄 자리 ±30초
	//      (+ 템플릿 길이). 시작·끝·nodeId·이름만 (S0-3 결정 12). 우리 클립을 못 찾은 줄이 있으면 나머지 트랙도 한 번 더 읽는다
	//   4) salt가 비었으면 복구 (태그 클립 표본의 80%가 줄 문장을 담을 때만, remapped면 하지 않는다), 못 하면 새로
	//   5) core planPlacement → 되읽기가 필요한 클립(readClipTexts, 40개씩)을 읽고 다시 계획 (최대 4번)
	//   6) 적용 전 점검 (#preflightModal): 볼 것이 있을 때만. 한 줄(↑)은 충돌·Premiere에서 고침·옛 버전·새 트랙일 때만.
	//      고른 선택지가 기본값과 다르면 다시 계획한다
	//   7) ensureVideoTracks (새 트랙은 배치 전에) → last_apply.json {complete: false}
	//   8) 제거(removeClips: 옛 gen·목록에서 빠진 줄의 클립) → 청크(placeChunk, 8개, 예산 7초: done이 보낸 수보다 적으면 나머지는 다음 청크로)
	//      청크마다 last_apply를 다시 쓰고, 진행률·[중지](청크 사이)·20초 워치독. 이웃이 망가진 줄(damaged)은 다시 스캔해
	//      줄 자리에 다시 놓는다 (분기 C, 최대 2번)
	//   9) 결과 → mi.applied(clipLs·텍스트 해시), rs.ap (검증된 줄은 mm을 지운다. partial·효과 있어 제자리는 남긴다), 자동 화자 autoTrack, 프리셋 학습 필드,
	//      줄 표시(.sub-res), last_apply complete, 히스토리 '타임라인 적용 (n개)'
	// 실행 중에는 _miBusy: 폴러·30초 MOGRT 재스캔·SRT 열기·▶·↑를 멈추고 #miBusy가 패널을 덮는다.
	// 빈 응답·EvalScript error.·예외·seq-mismatch 같은 호스트 실패는 그 자리에서 멈춘다 ("중단됨 — 다시 적용하면 이어서 진행").
	// 계획은 타임라인에서 다시 세우므로 같은 결과가 나온다 (이미 놓은 줄은 그대로 = 보내지 않음).
	// ─────────────────────────────────────────────────────────────
	const MI_WATCHDOG_MS = 20000;
	const MI_WATCHDOG_MSG = "Premiere에 대화상자가 떠 있을 수 있습니다 — Premiere 창을 확인하세요";
	const MI_BUDGET_MS = 7000;
	const MI_STOPPED_MSG = "중단됨 — 다시 적용하면 이어서 진행";
	// 적용 전 점검 선택지 기본값 (계획서 §8 #preflightModal. 사용자 결정: 지운 클립은 다시 놓기, 고친 클립은 건너뛰기,
	// 나눈 레거시 목록의 옛 클립은 화자 트랙으로 옮기되 효과가 있는 클립은 빼기, 옛 버전 MOGRT 클립은 속성 이름으로 갱신)
	const MI_PF_DEFAULTS = { adopt: true, adoptUncertain: false, adoptForeign: true, moveLegacy: true, orphans: "pre", cleanupStale: true, replaceMissing: true,
		overwriteEdited: false, restoreMoved: false, moveDecorated: false, upgradeOld: false };
	const MI_SKIP_TEXT = {
		"no-speaker": "화자 없음", "no-preset": "프리셋 없음", "bake-failed": "네이티브 굽기 실패", "no-params": "속성 없음", "no-caption-field": "캡션 필드를 찾지 못함",
		locked: "잠김", "zero-length": "길이 0 (같은 화자 다음 줄과 시작이 같음)", dup: "중복", missing: "타임라인에 클립 없음 (다시 놓기 끔)",
		edited: "Premiere에서 고침", decorated: "효과 있어 제자리", pending: "클립을 읽지 못함", gone: "클립이 사라짐"
	};
	var _miPfClose = null; // 열린 적용 전 점검을 닫는 함수 (시퀀스 전환 등)
	function _miShowBusy(text) {
		const el = document.getElementById("miBusy");
		if (el) el.style.display = "";
		const t = document.getElementById("miBusyText");
		if (t) t.textContent = text;
	}
	function _miHideBusy() {
		const el = document.getElementById("miBusy");
		if (el) el.style.display = "none";
		const w = document.getElementById("miBusyWatch");
		if (w) { w.style.display = "none"; w.textContent = ""; }
	}
	document.getElementById("miBusyStop")?.addEventListener("click", () => {
		if (!_miBusy) return;
		_miCancel = true;
		const t = document.getElementById("miBusyText");
		if (t) t.textContent += " — 지금 청크가 끝나면 멈춥니다";
	});
	// 호스트 호출 하나를 20초 워치독과 함께 (대화상자가 Premiere를 막으면 evalScript가 돌아오지 않는다, S0-3 v)
	async function _miCallWatch(fn) {
		const w = document.getElementById("miBusyWatch");
		const timer = setTimeout(() => {
			if (w) { w.textContent = MI_WATCHDOG_MSG; w.style.display = ""; }
		}, MI_WATCHDOG_MS);
		try {
			return await fn();
		} finally {
			clearTimeout(timer);
			if (w) { w.style.display = "none"; w.textContent = ""; }
		}
	}
	function _miHostFail(name, r) {
		const e = new Error(name + ": " + ((r && r.error) || "응답 없음") + (r && r.detail ? " (" + r.detail + ")" : ""));
		e.miHost = r || null;
		return e;
	}
	// 화자(spk) 줄이 있는데 화자 표에 없는 키 (v27이 mi를 버리고 저장하고 cast.json도 없을 때): 화자 표에 다시 만든다
	function _miEnsureCast() {
		let n = 0;
		state.subtitles.forEach((s) => {
			if (s && s.spk && !state.mi.cast[s.spk]) {
				_ensureCastEntry(s.spk);
				n++;
			}
		});
		return n;
	}
	// 클립 되읽기 (40개씩) → details[nodeId] = 결과 (찾지 못하면 {found: false})
	async function _miReadDetails(list, details, seqId) {
		for (let i = 0; i < list.length; i += READ_BATCH) {
			const part = list.slice(i, i + READ_BATCH);
			const r = await _miCallWatch(() => host.mi.readTexts({ seqId, items: part.map((x) => ({ track: x.track, nodeId: x.nodeId })), want: { texts: true, lay: true, deco: true, params: false } }));
			if (!r || r.ok !== true) throw _miHostFail("readClipTexts", r);
			(r.results || []).forEach((x) => { if (x && x.nodeId !== undefined) details[String(x.nodeId)] = x.found ? x : { found: false }; });
			part.forEach((x) => { if (!details[x.nodeId]) details[x.nodeId] = { found: false }; });
		}
	}
	function _writeLastApply(la) {
		try {
			if (!_keysResolved || !la) return false;
			const path = _getLastApplyPath();
			return path ? _fsWrite(path, la) : false;
		} catch (_) { return false; }
	}
	function _readLastApply() {
		const path = _getLastApplyPath();
		const d = path ? _fsRead(path) : null;
		return d && typeof d === "object" && !Array.isArray(d) ? d : null;
	}
	// 새 실행 기록 (실행을 시작할 때 complete false로 쓴다). legacy: 레거시 안전 경로 (태그 없는 작업, key "r<id>", g 0)
	function _laNew(seqId, salt, rows, legacy) {
		const la = { v: 1, runId: "r" + Date.now(), ts: Date.now(), seqId, salt: salt || "", complete: false, chunksDone: 0, rows, superseded: false,
			created: [], updated: [], moved: [], adopted: [], replaced: [], removed: [], prev: {} };
		if (legacy) la.legacy = true;
		return la;
	}
	// v27 호스트로 타임라인을 바꿨다 (▶ 지금 방식·↑·안전하게 적용 v27): 마지막 기록은 더 이상 되돌릴 수 없다 (superseded: true).
	// 기록이 없으면 아무것도 쓰지 않는다 (단일 화자 목록은 파일이 생기지 않는다)
	function _supersedeLastApply() {
		const la = _readLastApply();
		if (!la || la.superseded) return;
		la.superseded = true;
		_writeLastApply(la);
	}
	// salt가 비었을 때 (화자 줄은 있다): 스캔의 태그 클립으로 문장까지 확인해 받거나(remapped가 아닐 때만), 새로 만든다
	async function _miEnsureSalt(scan, all, ctx) {
		let salt = null;
		if (!state.mi.remapped) {
			const rowsById = {};
			all.forEach((s) => {
				const rs = state.rowStates[s.id];
				const preset = rs && rs.presetId ? state.presets[rs.presetId] : null;
				const cap = preset ? rowCaptionValue(rs, preset) : null;
				rowsById[s.id] = { caps: [cap, s.text].map((t) => normText(t)).filter(Boolean) };
			});
			const dets = {};
			for (let it = 0; it < 3; it++) {
				const r = recoverSalt(scan, rowsById, dets);
				if (!r.need.length) {
					salt = r.salt;
					break;
				}
				await _miReadDetails(r.need, dets, ctx.seqId);
			}
		}
		state.mi.salt = salt || _mintSalt();
		ctx.saltRecovered = !!salt;
		saveSessionToStorage();
	}
	// 스캔할 비디오 트랙 번호 (계획서 §6.7, S0-3 결정 12: 화자 트랙·기본 트랙·legacyTrack만):
	//   기본 트랙부터 위 전부 (자동 화자가 비어 있는 트랙을 찾는다. 없는 번호는 호스트가 건너뛴다), 고정·기억한 화자 트랙,
	//   legacyTrack, 대상 줄이 마지막으로 놓인 트랙(applied.t·ap.t). 기본 트랙 아래의 다른 트랙(V1 영상, B-roll)은 읽지 않는다
	const MI_SCAN_TRACK_MAX = 99;
	function _miScanTracks(subs, base) {
		const want = {};
		const add = (t) => { if (typeof t === "number" && t >= 0 && t < MI_SCAN_TRACK_MAX && t === Math.floor(t)) want[t] = true; };
		for (let t = base; t < MI_SCAN_TRACK_MAX; t++) add(t);
		(state.mi.castOrder || []).forEach((K) => {
			const c = state.mi.cast[K];
			if (c) { add(c.track); add(c.autoTrack); }
		});
		add(state.mi.legacyTrack);
		(subs || []).forEach((s) => {
			const ap = state.mi.salt ? state.mi.applied[state.mi.salt + "-" + s.id] : null;
			if (ap) add(ap.t);
			const rs = state.rowStates[s.id];
			if (rs && rs.ap) add(rs.ap.t);
		});
		return Object.keys(want).map(Number).sort((a, b) => a - b);
	}
	// 줄들의 계획: 줄 입력(굽기·템플릿 길이, 줄마다 한 번) → 스캔 → (salt) → planPlacement ↔ 되읽기
	async function _miPlanFor(subs, pf, ctx) {
		const rowsIn = [];
		for (const sub of subs) {
			if (!ctx.rowIn[sub.id]) {
				const rs = state.rowStates[sub.id] || {};
				const preset = rs.presetId ? state.presets[rs.presetId] || null : null;
				const row = { sub, rs, preset, baked: null, bakeWhy: null, oldBaked: null };
				if (preset && _isNativePreset(preset)) {
					_miShowBusy("네이티브 템플릿에 문구 굽는 중… " + rowLabel(sub, true));
					const bk = await _bakeRow(sub, rs, preset);
					if (bk.ok) row.baked = { path: bk.path, key: bk.key, durSec: bk.durSec };
					else row.bakeWhy = _bakeWhy(bk);
					if (rs.ap && rs.ap.nk && _bakedExists(rs.ap.nk)) row.oldBaked = _bakedPath(rs.ap.nk);
				} else if (preset && preset.mogrtPath && !(Number(preset.mogrtDurSec) > 0)) {
					const k = normPath(preset.mogrtPath);
					if (ctx.durs[k] === undefined) ctx.durs[k] = await _templateDurSec(preset.mogrtPath);
				}
				ctx.rowIn[sub.id] = row;
			}
			rowsIn.push(ctx.rowIn[sub.id]);
		}
		const all = state.subtitles.filter((s) => s && s.spk);
		const fr = speakerFrames(all, ctx.ft);
		let lo = Infinity;
		let hi = -Infinity;
		const see = (a, b) => {
			if (isFinite(a) && a < lo) lo = a;
			if (isFinite(b) && b > hi) hi = b;
		};
		subs.forEach((s) => {
			const f = fr[s.id];
			if (f) see(f.sf, f.ef);
			const ap = state.mi.salt ? state.mi.applied[state.mi.salt + "-" + s.id] : null;
			if (ap && typeof ap.sf === "number") see(ap.sf, typeof ap.cef === "number" ? ap.cef : ap.ef);
			const rs = state.rowStates[s.id];
			const loc = rs ? applyLocate(rs, s) : null;
			if (loc && loc.from !== "sub") see(frameOf(loc.s, ctx.ft), frameOf(loc.e, ctx.ft));
		});
		const pad = frameOf(SCAN_PAD_SEC + PLACE_DUR_FALLBACK * 2, ctx.ft);
		const win = { fromFrame: Math.max(0, lo - pad), toFrame: hi + pad };
		_miShowBusy("타임라인 읽는 중…");
		const scan = await _miCallWatch(() => host.mi.getTracks(Object.assign({ seqId: ctx.seqId, tracks: _miScanTracks(subs, ctx.base) }, win)));
		if (!scan || scan.ok !== true) throw _miHostFail("getTracks", scan);
		_miNumTracks = scan.numVideoTracks;
		if (!state.mi.salt) await _miEnsureSalt(scan, all, ctx);
		// 마지막 적용(applied)이 있는데 읽은 트랙에 우리 클립이 없는 줄: 사용자가 기본 트랙 아래로 옮겼을 수 있다 → 나머지 트랙(V1 빼고)도 읽는다.
		// 드물다 (지운 클립·다른 트랙으로 옮긴 클립). 못 찾으면 그 줄은 지운 클립(missing)으로 다시 놓는다
		const idx0 = scanIndex(scan, state.mi.salt);
		if (subs.some((s) => { const u = state.mi.salt + "-" + s.id; return !!state.mi.applied[u] && !idx0.own[u]; })) {
			const seen = {};
			(scan.tracks || []).forEach((t) => { seen[t.i] = true; });
			const rest = [];
			for (let t = 1; t < scan.numVideoTracks; t++) if (!seen[t]) rest.push(t);
			if (rest.length) {
				const more = await _miCallWatch(() => host.mi.getTracks(Object.assign({ seqId: ctx.seqId, tracks: rest }, win)));
				if (!more || more.ok !== true) throw _miHostFail("getTracks", more);
				scan.tracks = (scan.tracks || []).concat(more.tracks || []).sort((a, b) => a.i - b.i);
			}
		}
		const trash = {};
		(state.trashBin || []).forEach((t) => { if (t && t.sub) trash[t.sub.id] = t.why || ""; });
		let plan = null;
		for (let it = 0; it < 4; it++) {
			plan = planPlacement({ rows: rowsIn, allRows: all, trash, mi: state.mi, base: ctx.base, scan, details: ctx.details, durs: ctx.durs, opts: pf });
			const reads = plan.needReads.filter((r) => !ctx.details[r.nodeId]);
			if (!reads.length) break;
			_miShowBusy("클립 읽는 중… (" + reads.length + "개)");
			await _miReadDetails(reads, ctx.details, ctx.seqId);
		}
		// nodeId → uid (이웃이 망가진 클립의 줄 찾기): 우리 태그 클립, 인식·옮길 클립
		const idx = scanIndex(scan, state.mi.salt);
		Object.keys(idx.own).forEach((uid) => idx.own[uid].forEach((c) => { ctx.nodeToUid[c.nodeId] = uid; }));
		plan.ops.forEach((op) => {
			if (op.own) ctx.nodeToUid[String(op.own.nodeId)] = op.uid;
			if (op.removeAfter) ctx.nodeToUid[String(op.removeAfter.nodeId)] = op.uid;
		});
		plan.scanTracks = scan.numVideoTracks;
		return plan;
	}
	// 적용 전 점검이 필요한가 (한 줄 ↑은 충돌·Premiere에서 고침·옛 버전·새 트랙일 때만)
	function _miNeedsPreflight(plan, single, legacyN) {
		if (single) return plan.conflicts.length > 0 || plan.edited.length > 0 || plan.oldVersion.length > 0 || plan.minCount > 0;
		return plan.minCount > 0 || plan.conflicts.length > 0 || plan.edited.length > 0 || plan.missing.length > 0 ||
			plan.adopt.certain + plan.adopt.uncertain + plan.foreignAdopt.certain + plan.foreignAdopt.uncertain > 0 ||
			plan.legacyMove > 0 || plan.legacyKept.length > 0 || plan.orphans.length > 0 || plan.cleanup.length > 0 || plan.decorated.length > 0 ||
			plan.legacyDecorated > 0 || plan.oldVersion.length > 0 || plan.unknownTemplate.length > 0 || plan.dup.length > 0 || plan.locked.length > 0 ||
			plan.bakeFailed.length > 0 || plan.noCaption.length > 0 || plan.blocked.length > 0 || plan.userMoved.length > 0 || legacyN > 0;
	}
	// 적용 전 점검 요약 줄 [[문구, "" | "warn" | "err"]]
	function _miSummaryLines(plan, ctx) {
		const lines = [];
		const tn = (t) => "V" + (t + 1);
		const parts = [];
		let target = 0;
		Object.keys(plan.perSpeaker).forEach((K) => {
			const p = plan.perSpeaker[K];
			const n = p.counts.rows - p.counts.none - p.counts.skip;
			target += p.counts.rows;
			parts.push(K + " " + _castName(K) + " " + tn(p.track) + " " + n);
		});
		lines.push(["배치 " + target + "줄: " + parts.join(" · ") + (plan.none.length ? " (변경 없음 " + plan.none.length + "줄은 보내지 않음)" : ""), ""]);
		if (plan.minCount > 0) {
			const made = Object.keys(plan.tracks).filter((K) => plan.tracks[K].create).map((K) => tn(plan.tracks[K].track));
			const n = Math.max(plan.tracksToAdd, made.length);
			lines.push(["새 비디오 트랙 " + n + "개" + (made.length ? " (" + made.join(", ") + ")" : "") + (n > 4 ? " — 4개가 넘습니다. 기본 트랙과 화자 트랙을 확인하세요" : ""), n > 4 ? "warn" : ""]);
		}
		if (plan.overlaps) lines.push(["같은 화자 겹침 " + plan.overlaps + "곳 → 앞 자막 끝 맞춤", ""]);
		plan.blocked.forEach((b) => lines.push([b.keys.join("과 ") + "가 " + tn(b.track) + "에서 겹칩니다 — 트랙을 바꾸세요", "err"]));
		const conflictN = plan.conflicts.filter((c) => c.why !== "pinned-overlap").length;
		if (conflictN) lines.push(["다른 클립과 겹쳐 건너뜀 " + conflictN + "줄", "err"]);
		const lockedK = Object.keys(plan.tracks).filter((K) => plan.tracks[K].locked);
		lockedK.forEach((K) => lines.push(["잠긴 트랙 " + tn(plan.tracks[K].track) + " → " + K + " 건너뜀", "warn"]));
		if (plan.dup.length) lines.push(["같은 태그 클립 (자르기?) " + plan.dup.length + "개 건너뜀 — 하나를 지우고 다시 적용", "warn"]);
		if (plan.noPreset.length) lines.push(["프리셋 없는 줄 " + plan.noPreset.length + "개 건너뜀", ""]);
		if (plan.unverifiedTemplate.length) lines.push(["템플릿 확인 안 됨 " + plan.unverifiedTemplate.length + "개 — 같은 MOGRT로 보고 갱신", ""]);
		if (plan.staleLayoutRows) lines.push(["옛 구조 줄 " + plan.staleLayoutRows + "개 — 속성 이름으로 맞춰 적용", ""]);
		if (plan.oldVersion.length) lines.push(["옛 버전 MOGRT로 놓인 클립 " + plan.oldVersion.length + "개 — 속성 이름으로 갱신 (새 버전 전용 속성은 적용 안 됨)", "warn"]);
		if (plan.decorated.length + plan.legacyDecorated) lines.push(["효과·키프레임이 있는 클립 " + (plan.decorated.length + plan.legacyDecorated) + "개는 자리를 옮기지 않음", "warn"]);
		if (plan.legacyKept.length) lines.push(["기본 트랙의 옛 클립을 남긴 줄 " + plan.legacyKept.length + "개 — 화면에 두 번 나옵니다", "warn"]);
		if (plan.unknownTemplate.length) lines.push(["템플릿을 알 수 없는 네이티브 클립 " + plan.unknownTemplate.length + "개 건너뜀", "warn"]);
		if (plan.bakeFailed.length) lines.push(["네이티브 문구를 굽지 못한 줄 " + plan.bakeFailed.length + "개 건너뜀", "err"]);
		if (plan.noCaption.length) lines.push(["캡션 필드를 찾지 못한 줄 " + plan.noCaption.length + "개 건너뜀", "warn"]);
		if (plan.zeroLength.length) lines.push(["길이가 0인 줄 " + plan.zeroLength.length + "개 건너뜀 (같은 화자 다음 줄과 시작이 같다)", "warn"]);
		if (ctx && ctx.legacyN) lines.push(["화자 없는 줄 " + ctx.legacyN + "개는 건너뜀", "warn"]);
		return lines;
	}
	// #preflightModal → 고른 선택지(MI_PF_DEFAULTS 모양) | null (취소)
	function _miPreflight(plan, ctx) {
		return new Promise((resolve) => {
			const modal = document.getElementById("preflightModal");
			const okBtn = document.getElementById("pfOk");
			const noBtn = document.getElementById("pfCancel");
			if (!modal || !okBtn || !noBtn) {
				resolve(Object.assign({}, MI_PF_DEFAULTS));
				return;
			}
			const box = document.getElementById("pfSummary");
			if (box) {
				box.innerHTML = "";
				_miSummaryLines(plan, ctx).forEach(([text, cls]) => {
					const el = document.createElement("div");
					el.className = "pf-line" + (cls ? " " + cls : "");
					el.textContent = text;
					box.appendChild(el);
				});
			}
			const tn = (t) => "V" + (t + 1);
			const opt = (id, count, label, def) => {
				const cb = document.getElementById(id);
				if (!cb) return;
				const row = cb.closest("label");
				if (row) row.style.display = count > 0 ? "" : "none";
				const sp = row && row.querySelector("span");
				if (sp) sp.textContent = label;
				cb.checked = def;
			};
			const pre = plan.orphans.filter((x) => x.pre).length;
			const decoN = plan.decorated.length + plan.legacyDecorated;
			opt("pfAdopt", plan.adopt.certain, "태그 없는 기존 클립 " + plan.adopt.certain + "개를 이 목록 클립으로 인식", MI_PF_DEFAULTS.adopt);
			opt("pfAdoptUncertain", plan.adopt.uncertain, "같은 자리에 있지만 문장이 다른 태그 없는 클립 " + plan.adopt.uncertain + "개도 인식 (그 클립의 문장을 덮어씁니다)", MI_PF_DEFAULTS.adoptUncertain);
			opt("pfAdoptForeign", plan.foreignAdopt.certain, "다른 시퀀스에서 온 태그 클립 " + plan.foreignAdopt.certain + "개를 이 목록 클립으로 인식", MI_PF_DEFAULTS.adoptForeign);
			opt("pfMoveLegacy", plan.legacyMove + plan.legacyKept.length, "기본 트랙(" + tn(typeof state.mi.legacyTrack === "number" ? state.mi.legacyTrack : ctx.base) + ")에 있던 옛 클립 " + (plan.legacyMove + plan.legacyKept.length - plan.legacyDecorated) + "개를 화자 트랙으로 옮기기" + (plan.legacyDecorated ? " (효과가 있는 " + plan.legacyDecorated + "개는 빼고)" : ""), MI_PF_DEFAULTS.moveLegacy);
			opt("pfOrphans", pre, "목록에서 빠진 줄의 클립 " + pre + "개 지우기 (병합·교체로 빠졌고 Premiere에서 고치지 않은 것)", true);
			opt("pfOrphansAll", plan.orphans.length - pre, "목록에 없는 다른 클립 " + (plan.orphans.length - pre) + "개도 지우기 (Premiere에서 고쳤거나 사용자가 지운 줄)", false);
			opt("pfCleanupStale", plan.cleanup.length, "중단된 적용이 남긴 옛 클립 " + plan.cleanup.length + "개 지우기", MI_PF_DEFAULTS.cleanupStale);
			opt("pfReplaceMissing", plan.missing.length, "Premiere에서 지운 클립 " + plan.missing.length + "개 다시 놓기", MI_PF_DEFAULTS.replaceMissing);
			opt("pfOverwriteEdited", plan.edited.length, "Premiere에서 고친 클립 " + plan.edited.length + "개 덮어쓰기", MI_PF_DEFAULTS.overwriteEdited);
			opt("pfRestoreMoved", plan.userMoved.length, "Premiere에서 옮긴 클립 " + plan.userMoved.length + "개를 자막 시간으로 되돌리기", MI_PF_DEFAULTS.restoreMoved);
			opt("pfMoveDecorated", decoN, "효과·키프레임이 있는 클립 " + decoN + "개도 다시 놓기 (효과가 사라짐)", MI_PF_DEFAULTS.moveDecorated);
			opt("pfUpgradeOld", plan.oldVersion.length, "옛 버전 MOGRT 클립 " + plan.oldVersion.length + "개를 새 버전으로 교체 (Premiere에서 고친 값 사라짐)", MI_PF_DEFAULTS.upgradeOld);
			const chk = (id) => { const cb = document.getElementById(id); return !!(cb && cb.checked); };
			const done = (v) => {
				modal.classList.remove("open");
				okBtn.onclick = null;
				noBtn.onclick = null;
				_miPfClose = null;
				resolve(v);
			};
			okBtn.onclick = () => done({
				adopt: chk("pfAdopt"), adoptUncertain: chk("pfAdoptUncertain"), adoptForeign: chk("pfAdoptForeign"), moveLegacy: chk("pfMoveLegacy"),
				orphans: chk("pfOrphansAll") ? "all" : chk("pfOrphans") ? "pre" : "none", cleanupStale: chk("pfCleanupStale"), replaceMissing: chk("pfReplaceMissing"),
				overwriteEdited: chk("pfOverwriteEdited"), restoreMoved: chk("pfRestoreMoved"), moveDecorated: chk("pfMoveDecorated"), upgradeOld: chk("pfUpgradeOld")
			});
			noBtn.onclick = () => done(null);
			_miPfClose = () => done(null);
			modal.classList.add("open");
		});
	}
	function _miSkipText(ro) {
		if (ro.skip === "conflict") return "충돌: " + (ro.detail || ro.why || "");
		const t = MI_SKIP_TEXT[ro.skip] || ro.skip;
		return ro.detail && ro.skip !== "edited" && ro.skip !== "decorated" ? t + ": " + ro.detail : t;
	}
	function _miResultText(st, r) {
		if (st === "conflict") return "충돌: " + (r.reason === "tail" ? "뒤 클립 " : "") + (r.detail || r.reason || "");
		if (st === "locked") return "잠김";
		if (st === "ambiguous") return "중복 (" + (r.detail || "같은 태그 클립") + ")";
		if (st === "stale-plan") return "계획 뒤 타임라인이 바뀜 — 다시 적용";
		if (st === "misplaced") return "다른 트랙에 놓여 지움";
		return "실패: " + (r.reason || st || "응답 없음") + (r.detail ? " " + r.detail : "");
	}
	// 계획에서 건너뛴 줄에 까닭을 적고, 보낼 줄·그대로인 줄의 지난 표시는 지운다
	function _miMarkRows(plan) {
		Object.keys(plan.rowOps).forEach((k) => {
			const id = Number(k);
			const ro = plan.rowOps[k];
			if (ro && ro.skip) {
				_setRowRes(id, _miSkipText(ro));
				_miRowStatus[id] = { st: ro.skip, why: ro.why || "", detail: ro.detail || "" };
			} else {
				_setRowRes(id, null);
				if (ro && ro.none) _miRowStatus[id] = { st: "none", why: "", detail: "" };
			}
			const sub = state.subtitles.find((s) => s.id === id);
			// 그대로인 줄(applied의 의도 해시가 같고 클립이 그 자리)은 타임라인이 이미 이 줄과 같다 → 병합 표시(mm)를 지운다
			if (sub && ro && ro.none) {
				const rs = state.rowStates[id];
				const t = sub.spk && plan.tracks[sub.spk] ? plan.tracks[sub.spk].track : null;
				if (rs && rs.mm && t !== null) markApplied(rs, sub, rs.presetId ? state.presets[rs.presetId] || null : null, t, rs.ap && rs.ap.nk ? rs.ap.nk : null);
			}
			if (sub) _refreshRowMarks(sub);
		});
	}
	// 첫 새 배치에서 프리셋 학습 필드 (AE만): mogrtItemName(= capsule 이름), mogrtDurSec(D), mogrtLs(지금 버전), mogrtBaseComps
	function _miLearn(preset, op, r, res, ctx) {
		if (ctx.learned[op.presetId]) return;
		const upd = {};
		if (typeof r.pin === "string" && r.pin) upd.mogrtItemName = r.pin;
		const dur = res.dur && res.dur[op.m];
		if (typeof dur === "number" && dur > 0) upd.mogrtDurSec = dur;
		const ls = clipLs(r.lay);
		if (ls) upd.mogrtLs = ls;
		const comps = res.comps && typeof res.comps[op.m] === "number" ? res.comps[op.m] : r.deco && typeof r.deco.comps === "number" ? r.deco.comps : null;
		if (comps !== null) upd.mogrtBaseComps = comps;
		if (r.deco && Array.isArray(r.deco.keyed)) upd.mogrtBaseKeyed = r.deco.keyed.slice();
		Object.keys(upd).forEach((k) => {
			if (preset[k] !== upd[k]) {
				preset[k] = upd[k];
				ctx.presetsDirty = true;
			}
		});
		if (upd.mogrtLs && upd.mogrtDurSec) ctx.learned[op.presetId] = true;
	}
	// 청크 결과 하나 → applied·ap·줄 표시·last_apply·학습 필드
	function _miOnResult(op, r, res, ctx) {
		const st = String((r && r.status) || "");
		const ok = !!PLACE_OK[st];
		const partial = st === "partial";
		// 효과가 있어 제자리에서 속성만 바꾼 줄 (op.stay): 시간 변경은 아직이다 → 검증된 적용으로 치지 않는다
		const stay = !!op.stay;
		const sub = ctx.byId[op.id] || null;
		const rs = sub ? state.rowStates[sub.id] : null;
		const preset = rs && rs.presetId ? state.presets[rs.presetId] || null : null;
		ctx.spkDone[op.K] = (ctx.spkDone[op.K] || 0) + 1;
		ctx.doneOps++;
		_miRowStatus[op.id] = { st: stay && ok ? "decorated" : st, why: (r && r.reason) || "", detail: (r && r.detail) || "" };
		if (!ok && !partial) {
			if (st === "conflict" || st === "locked" || st === "ambiguous") ctx.stats.conflict++;
			else ctx.stats.failed++;
			_setRowRes(op.id, _miResultText(st, r || {}));
			if (sub) _refreshRowMarks(sub);
			return;
		}
		if (r.nodeId) {
			if (opCreates(op)) ctx.created[op.uid] = String(r.nodeId);
			ctx.nodeToUid[String(r.nodeId)] = op.uid;
		}
		_laTouch(ctx.la, op.uid, op.id);
		state.mi.applied[op.uid] = appliedEntryOf(op, r, state.mi.applied[op.uid]);
		const T = op.intent ? op.intent.t : op.track;
		if (sub && rs) {
			if (ok && !stay) markApplied(rs, sub, preset, T, op.nk);
			else if (stay) {
				// ap는 클립이 있는 자리 (applyLocate·시간 변경 판단이 그 자리를 본다), 병합 표시(mm)는 남긴다
				const secOf = (f) => (f * ctx.ft) / TICKS_PER_SEC;
				rs.ap = Object.assign(apRecord(sub, rs, preset, op.track, op.nk), { s: secOf(op.sf), e: secOf(op.ef) });
			} else rs.ap = apRecord(sub, rs, preset, T, op.nk);
			_setRowRes(op.id, partial ? "속성 " + ((r.skipped || []).length + (r.keyed || []).length) + "개 적용 안 됨" + ((r.keyed || []).length ? " (키프레임)" : " (옛 버전)") : stay ? MI_SKIP_TEXT.decorated : null);
			_refreshRowMarks(sub);
		}
		if (opCreates(op) && preset && !isNativeList(preset.params)) _miLearn(preset, op, r, res, ctx);
		else if (opCreates(op) && preset && isNativeList(preset.params) && r.deco && !ctx.learned["deco:" + op.presetId]) {
			// 네이티브(구운 사본)는 효과 판정의 기본값(컴포넌트 수·템플릿 키)만 배운다 (mogrtLs·D는 AE 전용)
			ctx.learned["deco:" + op.presetId] = true;
			const upd = { mogrtBaseKeyed: Array.isArray(r.deco.keyed) ? r.deco.keyed.slice() : [] };
			if (typeof r.deco.comps === "number") upd.mogrtBaseComps = r.deco.comps;
			Object.keys(upd).forEach((k) => {
				if (JSON.stringify(preset[k]) !== JSON.stringify(upd[k])) { preset[k] = upd[k]; ctx.presetsDirty = true; }
			});
		}
		ctx.spkOk[op.K] = true;
		_laRecord(ctx, op, r);
		const cat = _laCat(op);
		ctx.stats[cat]++;
		if (partial) ctx.stats.partial++;
	}
	// last_apply 범주 (작업 → created·updated·adopted·replaced·moved)
	function _laCat(op) {
		return op.op === "place" ? "created" : op.op === "update" ? "updated" : op.op === "adopt" ? "adopted" : op.op === "replace" ? "replaced" : "moved";
	}
	// 실행 전 줄 기록을 처음 건드릴 때 한 번 남긴다 (la.prev[key] = {id, ap, mmPrev, mm, a}): 되돌리기가 줄의 rs.ap·mmPrev와 applied를 되돌린다
	function _laTouch(la, key, id) {
		if (!la || !key) return;
		if (!la.prev) la.prev = {};
		if (la.prev[key]) return;
		const rs = typeof id === "number" ? state.rowStates[id] : null;
		const a = state.mi && state.mi.applied ? state.mi.applied[key] : null;
		const cl = (v) => (v ? JSON.parse(JSON.stringify(v)) : null);
		la.prev[key] = { id: typeof id === "number" ? id : null, ap: cl(rs && rs.ap), mmPrev: cl(rs && rs.mmPrev), mm: (rs && rs.mm) || null, a: cl(a) };
	}
	// 작업 결과 하나를 last_apply에 적는다 (spec dataModel 3 + S2-5 덧붙임: n·id·op·k·m·ef·dur, updated·adopted의 작업 전 자리·이름).
	// 되돌리기(buildUndoOps)는 key마다 첫 항목의 작업 전 모습(origin)과 마지막 항목의 클립(final)을 본다
	function _laRecord(ctx, op, r) {
		const la = ctx.la;
		const base = { key: op.uid, g: typeof r.g === "number" ? r.g : op.g, track: r.track, sf: r.sf, nodeId: String(r.nodeId || ""), rh: textsHash(r.texts || []),
			n: ctx.laN++, id: op.id, op: op.op, k: r.kind || op.kind || "", m: op.m || "", ef: r.ef, dur: op.durSec || 0 };
		if (ctx.repairing) base.fix = true;
		const srcPos = op.src ? { track: op.src.track, sf: op.src.sf, ef: op.src.ef, name: op.src.name || "" } : null;
		const cat = _laCat(op);
		if (cat === "created") la.created.push(base);
		else if (cat === "updated") la.updated.push(Object.assign(base, { before: r.before || null, from: srcPos }));
		else if (cat === "adopted") la.adopted.push(Object.assign(base, { from: Object.assign({}, srcPos || {}, { name: op.srcName || (srcPos && srcPos.name) || "", params: r.before || [] }) }));
		else {
			const from = Object.assign({ nodeId: op.own ? String(op.own.nodeId) : op.removeAfter ? String(op.removeAfter.nodeId) : "" }, r.before || {});
			// 되놓을 템플릿: 호스트가 모르면(own.m 없음) 이동·다시 놓기는 같은 템플릿, 나눈 레거시 목록의 옛 클립은 줄의 프리셋 템플릿으로 본다
			if (!from.m && cat === "moved") from.m = op.m || null;
			la[cat].push(Object.assign(base, { from }));
		}
	}
	// 적용 기록의 nodeId를 바꾼다 (망가진 이웃을 스냅숏으로 다시 놓아 nodeId가 바뀌었다 → 되돌리기가 그 클립을 찾게)
	function _laRemap(la, oldId, newId) {
		if (!la) return;
		UNDO_CATS.forEach((c) => (Array.isArray(la[c]) ? la[c] : []).forEach((e) => { if (e && String(e.nodeId) === String(oldId)) e.nodeId = String(newId); }));
	}
	function _miProgress(op, ctx) {
		const K = op && op.K;
		const spk = K ? K + " " + _castName(K) + " " + (ctx.spkDone[K] || 0) + "/" + (ctx.spkTotal[K] || 0) + " · " : "";
		_miShowBusy("배치 중… " + spk + "전체 " + ctx.doneOps + "/" + ctx.totalOps);
	}
	// 계획 실행: 제거(removeClips) → 청크(placeChunk). ctx.stopped([중지])·ctx.aborted(시퀀스 바뀜)면 청크 사이에서 멈춘다
	async function _miExecute(plan, ctx) {
		for (let i = 0; i < plan.removals.length; i += 200) {
			if (_miCancel) { ctx.stopped = true; return; }
			const part = plan.removals.slice(i, i + 200);
			_miShowBusy("옛 클립 지우는 중… (" + part.length + "개)");
			const res = await _miCallWatch(() => host.mi.removeClips({ seqId: ctx.seqId, items: part.map((x) => ({ key: x.uid, track: x.track, nodeId: x.nodeId, expectName: x.expectName || null })) }));
			if (!res || res.ok !== true) throw _miHostFail("removeClips", res);
			(res.results || []).forEach((r, k) => {
				const rm = part[k];
				if (!rm) return;
				if (r && r.status === "removed") {
					ctx.stats.removed++;
					// 되놓을 템플릿(호스트 removeClips는 경로를 모른다) = 그 uid의 applied.m. 목록에서 빠진 줄은 지우기 전 applied 항목(pa)도 둔다
					const a = state.mi.applied[rm.uid] || null;
					_laTouch(ctx.la, rm.uid, rm.id);
					const e = Object.assign({ key: rm.uid, g: rm.g }, r.before || {}, { nodeId: String(rm.nodeId), why: rm.why, n: ctx.laN++, id: rm.id });
					if (!e.m && a && a.m) e.m = a.m;
					if (rm.why === "orphan" && a) e.pa = JSON.parse(JSON.stringify(a));
					ctx.la.removed.push(e);
					if (rm.why === "orphan") delete state.mi.applied[rm.uid];
				} else ctx.stats.removeFailed++;
			});
			ctx.la.chunksDone++;
			_writeLastApply(ctx.la);
		}
		let queue = plan.ops.slice();
		while (queue.length) {
			if (_miCancel) { ctx.stopped = true; return; }
			if (ctx.seqTok !== _importSeqToken()) { ctx.aborted = true; return; }
			const chunk = chunkOps(queue, PLACE_CHUNK)[0];
			queue = queue.slice(chunk.length);
			const items = chunk.map((op) => hostItemOf(op, ctx.created));
			_miProgress(chunk[0], ctx);
			const res = await _miCallWatch(() => host.mi.placeChunk({ seqId: ctx.seqId, frameTicks: ctx.ft, budgetMs: MI_BUDGET_MS, items }));
			if (!res || res.ok !== true) throw _miHostFail("placeChunk", res);
			const done = Math.max(0, Math.min(chunk.length, parseInt(res.done, 10) || 0));
			if (!done) throw _miHostFail("placeChunk", { error: "done 0", detail: "호스트가 작업을 하나도 하지 않았다" });
			for (let k = 0; k < done; k++) _miOnResult(chunk[k], (res.results || [])[k] || {}, res, ctx);
			// 예산(7초)이 다 됐다: 나머지는 다음 청크로 (첫 importMGT는 ≈9초라 혼자 끝날 수 있다)
			if (done < chunk.length) queue = chunk.slice(done).concat(queue);
			(res.damaged || []).forEach((id) => { if (ctx.damaged.indexOf(String(id)) === -1) ctx.damaged.push(String(id)); });
			ctx.la.chunksDone++;
			_writeLastApply(ctx.la);
		}
	}
	// 적용 결과 요약 (상태 줄·명령)
	function _miReport(ctx, plan) {
		const s = ctx.stats;
		return { ok: !ctx.error && !ctx.aborted, stopped: !!ctx.stopped, error: ctx.error || null, created: s.created, updated: s.updated, moved: s.moved, adopted: s.adopted,
			replaced: s.replaced, removed: s.removed, partial: s.partial, conflict: s.conflict, failed: s.failed, none: plan ? plan.none.length : 0,
			skipped: plan ? Object.keys(plan.rowOps).filter((k) => plan.rowOps[k] && plan.rowOps[k].skip).length : 0,
			ops: plan ? plan.ops.length + plan.removals.length : 0, tracksAdded: ctx.tracksAdded || 0, runId: ctx.la ? ctx.la.runId : null, saltRecovered: !!ctx.saltRecovered };
	}
	function _miStatusText(rep) {
		const parts = [];
		[["created", "놓음"], ["updated", "갱신"], ["moved", "옮김"], ["adopted", "인식"], ["replaced", "교체"], ["removed", "지움"]].forEach(([k, t]) => { if (rep[k]) parts.push(t + " " + rep[k]); });
		if (rep.none) parts.push("그대로 " + rep.none);
		if (rep.partial) parts.push("일부 속성 빠짐 " + rep.partial);
		if (rep.conflict) parts.push("충돌 " + rep.conflict);
		if (rep.failed) parts.push("실패 " + rep.failed);
		if (rep.skipped) parts.push("건너뜀 " + rep.skipped);
		if (rep.tracksAdded) parts.push("새 트랙 " + rep.tracksAdded);
		return "화자별 배치: " + (parts.join(" · ") || "보낸 줄 없음");
	}
	// 화자별 배치. opts:
	//   single  한 줄 (↑): 옛 gen·목록 밖 클립은 보지 않고, 점검 창은 충돌·고침·옛 버전·새 트랙일 때만
	//   auto    점검 창 없이 pf(선택지, 없으면 기본값)로 (명령 apply)
	//   pf      선택지 (MI_PF_DEFAULTS 모양)
	//   dryRun  계획만 세우고 요약을 돌려준다 (명령 plan)
	// → 결과 요약 {ok, stopped, error, created, updated, …} (_miReport) | {ok: false, error}
	async function _miApply(targetSubs, opts) {
		const o = opts || {};
		if (_miBusy || _legacyRun) {
			setStatus("타임라인 적용이 이미 실행 중입니다", "err");
			return { ok: false, error: "busy" };
		}
		if (!_keysResolved) {
			setStatus("시퀀스를 열면 적용할 수 있습니다", "err");
			return { ok: false, error: "no-sequence" };
		}
		_miBusy = true;
		_miCancel = false;
		let ctx = null;
		let plan = null;
		// ▶를 누른 때의 시퀀스: ping을 기다리는 동안 이미 떠난 폴러 호출이 패널을 다른 시퀀스로 옮겼으면 그 목록을 적용하지 않는다
		const seqTok0 = _importSeqToken();
		try {
			const hk = await _miHostOk();
			if (!hk.ok) {
				setStatus(hk.msg, "err");
				return { ok: false, error: hk.why === "build" ? "build-mismatch" : "no-host", detail: hk.msg };
			}
			const ping = hk.ping;
			if (ping.isPreview) {
				setStatus("프리뷰 시퀀스가 활성입니다 — 작업 시퀀스를 연 뒤 다시 적용하세요", "err");
				return { ok: false, error: "preview-active" };
			}
			if (!ping.seqId || String(ping.seqId) !== String(state.currentSequenceId) || seqTok0 !== _importSeqToken()) {
				setStatus("Premiere의 활성 시퀀스가 패널의 시퀀스와 다릅니다 — 패널이 따라간 뒤 다시 적용하세요", "err");
				return { ok: false, error: "seq-mismatch" };
			}
			const ft = Number(ping.frameTicks);
			if (!(ft > 0)) {
				setStatus("시퀀스 프레임 정보를 읽지 못했습니다", "err");
				return { ok: false, error: "exception", detail: "frameTicks" };
			}
			_miEnsureCast();
			const live = _idSet(state.subtitles.map((s) => s.id));
			const subs = (targetSubs || []).filter((s) => s && s.spk && live[s.id]);
			const legacyN = (targetSubs || []).filter((s) => s && !s.spk).length;
			if (!subs.length) {
				setStatus("적용할 화자 줄이 없습니다", "err");
				return { ok: false, error: "no-rows" };
			}
			const base = _trackValueNum();
			ctx = {
				seqId: String(ping.seqId), ft, seqTok: _importSeqToken(), base: base === null ? 2 : base, legacyN, rowIn: {}, durs: {}, details: {}, created: {}, nodeToUid: {},
				damaged: [], byId: {}, stats: { created: 0, updated: 0, moved: 0, adopted: 0, replaced: 0, removed: 0, removeFailed: 0, partial: 0, conflict: 0, failed: 0 },
				spkDone: {}, spkTotal: {}, spkOk: {}, doneOps: 0, totalOps: 0, learned: {}, presetsDirty: false, la: null, stopped: false, aborted: false, error: null
			};
			state.subtitles.forEach((s) => { ctx.byId[s.id] = s; });
			_miShowBusy("타임라인 읽는 중…");
			const pfBase = Object.assign({}, MI_PF_DEFAULTS, o.single ? { single: true } : {});
			plan = await _miPlanFor(subs, o.auto ? Object.assign({}, pfBase, o.pf || {}) : pfBase, ctx);
			if (o.dryRun) return { ok: true, plan: _miPlanSummary(plan), lines: _miSummaryLines(plan, ctx).map((l) => l[0]) };
			if (!o.auto && _miNeedsPreflight(plan, !!o.single, legacyN)) {
				_miHideBusy();
				const chosen = await _miPreflight(plan, ctx);
				if (!chosen) {
					setStatus("타임라인 적용 취소", "");
					return { ok: false, error: "cancelled" };
				}
				if (ctx.seqTok !== _importSeqToken()) {
					setStatus("시퀀스가 바뀌어 적용을 취소했습니다", "err");
					return { ok: false, error: "seq-mismatch" };
				}
				if (stableJson(chosen) !== stableJson(MI_PF_DEFAULTS)) {
					_miShowBusy("다시 계획하는 중…");
					plan = await _miPlanFor(subs, Object.assign({}, chosen, o.single ? { single: true } : {}), ctx);
				}
			}
			_miMarkRows(plan);
			if (!plan.ops.length && !plan.removals.length && !(plan.minCount > 0)) {
				// 그대로인 줄의 병합 표시를 지웠을 수 있다 (_miMarkRows) → 저장
				saveSessionToStorage();
				updateMultiSelect();
				const rep = _miReport(ctx, plan);
				setStatus("변경 없음 — 보낼 줄이 없습니다 (" + plan.none.length + "줄 그대로" + (rep.skipped ? " · 건너뜀 " + rep.skipped : "") + ")", rep.skipped ? "err" : "ok");
				return rep;
			}
			if (plan.minCount > 0) {
				_miShowBusy("비디오 트랙 만드는 중…");
				const r = await _miCallWatch(() => host.mi.ensureTracks({ seqId: ctx.seqId, minCount: plan.minCount }));
				if (!r || r.ok !== true) throw _miHostFail("ensureVideoTracks", r);
				ctx.tracksAdded = r.added || 0;
				_miNumTracks = r.after;
			}
			ctx.la = _laNew(ctx.seqId, state.mi.salt, subs.length, false);
			ctx.laN = 0;
			_writeLastApply(ctx.la);
			ctx.totalOps = plan.ops.length;
			plan.ops.forEach((op) => { ctx.spkTotal[op.K] = (ctx.spkTotal[op.K] || 0) + 1; });
			await _miExecute(plan, ctx);
			// 이웃이 통째로 덮였거나 머리를 되돌리지 못한 줄: 다시 스캔해 줄 자리에 다시 놓는다 (최대 2번)
			for (let round = 0; round < DAMAGE_ROUNDS && ctx.damaged.length && !ctx.stopped && !ctx.aborted; round++) {
				const uids = {};
				ctx.damaged.splice(0).forEach((n) => { if (ctx.nodeToUid[n]) uids[ctx.nodeToUid[n]] = true; });
				const again = state.subtitles.filter((s) => s.spk && uids[state.mi.salt + "-" + s.id]);
				if (!again.length) break;
				ctx.details = {};
				const force = _idSet(again.map((s) => s.id));
				const p2 = await _miPlanFor(again, Object.assign({}, MI_PF_DEFAULTS, { single: true, forceRegen: force }), ctx);
				ctx.totalOps += p2.ops.length;
				p2.ops.forEach((op) => { ctx.spkTotal[op.K] = (ctx.spkTotal[op.K] || 0) + 1; });
				_miMarkRows(p2);
				// 이 기록(fix)은 되돌리기가 지우지 않는다: 덮여 사라진 원래 클립을 되살린 것이다 (실행 전 모습은 기록에 없다)
				ctx.repairing = true;
				try {
					await _miExecute(p2, ctx);
				} finally {
					ctx.repairing = false;
				}
				ctx.repaired = (ctx.repaired || 0) + p2.ops.length;
			}
		} catch (e) {
			if (ctx) ctx.error = (e && e.message) || String(e);
			console.error("[MOGRT] 화자별 배치 멈춤:", e);
			setStatus(MI_STOPPED_MSG + ": " + ((e && e.message) || e), "err");
			if (!ctx || !ctx.la) return { ok: false, error: "exception", detail: (e && e.message) || String(e) };
		} finally {
			try {
				if (ctx && ctx.la) _miFinish(ctx, plan);
			} finally {
				_miBusy = false;
				_miCancel = false;
				_miHideBusy();
			}
		}
		return ctx && plan ? _miReport(ctx, plan) : { ok: false, error: "exception" };
	}
	// 실행 뒤 정리: 자동 화자 트랙 기억, last_apply complete, session.json·presets.json 저장, 히스토리, 상태 줄
	function _miFinish(ctx, plan) {
		if (plan) {
			Object.keys(plan.tracks).forEach((K) => {
				const t = plan.tracks[K];
				const hadNone = plan.none.some((id) => ctx.byId[id] && ctx.byId[id].spk === K);
				if (t.auto && state.mi.cast[K] && (ctx.spkOk[K] || hadNone)) state.mi.cast[K].autoTrack = t.track;
			});
		}
		ctx.la.complete = !ctx.stopped && !ctx.error && !ctx.aborted;
		_writeLastApply(ctx.la);
		if (ctx.seqTok === _importSeqToken()) {
			saveSessionToStorage();
			if (ctx.presetsDirty) savePresetsToStorage();
			const n = ctx.stats.created + ctx.stats.updated + ctx.stats.moved + ctx.stats.adopted + ctx.stats.replaced + ctx.stats.removed;
			if (n) _saveHistoryOnAction("타임라인 적용 (" + n + "개)");
			renderCastBar();
			updateMultiSelect();
		}
		const rep = _miReport(ctx, plan);
		const text = _miStatusText(rep);
		if (ctx.error) setStatus(MI_STOPPED_MSG + ": " + ctx.error + " — " + text, "err");
		else if (ctx.aborted) setStatus("시퀀스가 바뀌어 멈췄습니다 — " + text, "err");
		else if (ctx.stopped) setStatus("중지함 — 다시 적용하면 이어서 진행 · " + text, "err");
		else setStatus(text, rep.conflict || rep.failed || rep.skipped || rep.partial ? "err" : "ok");
	}
	// ─────────────────────────────────────────────────────────────
	// 타임라인 검수 (읽기만, S3-3) — 계획서 §8 #verifyModal, spec S3-3
	//   ping(v28·같은 빌드·이 시퀀스) → getTracks(V1 뺀 모든 비디오 트랙, 시간 제한 없음: 옮긴 클립·목록에 없는 클립도 찾는다)
	//   → readClipTexts(화자 줄의 현재 클립, 40개씩: 텍스트·레이아웃·효과) → planPlacement 마른 계획(지금 의도 해시) → core verifyReport.
	// 호스트에 쓰는 호출은 없다. 굽지도 않는다 (네이티브 줄은 구운 사본의 키·경로만 계산한다: _bakeKeyOnly).
	// salt가 비었으면 태그 표본으로 찾아보되 저장하지 않는다. 실행 중에는 _miBusy (폴러·재스캔·적용이 호스트 대기열에 끼지 않게)
	// → {ok: true, report} | {ok: false, error, detail}
	// ─────────────────────────────────────────────────────────────
	async function _miVerify() {
		if (_miBusy || _legacyRun) return { ok: false, error: "busy", detail: "타임라인 적용이 실행 중" };
		if (!_keysResolved) return { ok: false, error: "no-sequence", detail: "시퀀스를 열면 검수할 수 있습니다" };
		const subs = state.subtitles.filter((s) => s && s.spk);
		if (!subs.length || !_castMode()) return { ok: false, error: "no-rows", detail: "검수는 화자 줄이 있는 목록에서만 합니다" };
		_miBusy = true;
		const seqTok = _importSeqToken();
		try {
			const hk = await _miHostOk();
			if (!hk.ok) return { ok: false, error: hk.why === "build" ? "build-mismatch" : "no-host", detail: hk.msg };
			const ping = hk.ping;
			if (ping.isPreview) return { ok: false, error: "preview-active", detail: "프리뷰 시퀀스가 활성입니다" };
			if (!ping.seqId || String(ping.seqId) !== String(state.currentSequenceId) || seqTok !== _importSeqToken()) return { ok: false, error: "seq-mismatch", detail: "Premiere의 활성 시퀀스가 패널의 시퀀스와 다릅니다" };
			const seqId = String(ping.seqId);
			_miShowBusy("검수: 타임라인 읽는 중…");
			const scan = await _miCallWatch(() => host.mi.getTracks({ seqId, tracks: null }));
			if (!scan || scan.ok !== true) throw _miHostFail("getTracks", scan);
			_miNumTracks = scan.numVideoTracks;
			const details = {};
			let salt = state.mi.salt || "";
			if (!salt && !state.mi.remapped) {
				const rowsById = {};
				subs.forEach((s) => {
					const rs = state.rowStates[s.id];
					const preset = rs && rs.presetId ? state.presets[rs.presetId] : null;
					rowsById[s.id] = { caps: [preset ? rowCaptionValue(rs, preset) : null, s.text].map((t) => normText(t)).filter(Boolean) };
				});
				for (let it = 0; it < 3; it++) {
					const r = recoverSalt(scan, rowsById, details);
					if (!r.need.length) {
						salt = r.salt || "";
						break;
					}
					await _miReadDetails(r.need, details, seqId);
				}
			}
			const idx = scanIndex(scan, salt);
			const reads = [];
			subs.forEach((s) => {
				const c = salt ? idx.current[salt + "-" + s.id] : null;
				if (c && !details[c.nodeId]) reads.push({ track: c.track, nodeId: c.nodeId });
			});
			if (reads.length) {
				_miShowBusy("검수: 클립 읽는 중… (" + reads.length + "개)");
				await _miReadDetails(reads, details, seqId);
			}
			if (seqTok !== _importSeqToken()) return { ok: false, error: "seq-mismatch", detail: "검수 중에 시퀀스가 바뀌었습니다" };
			const rowsIn = subs.map((sub) => {
				const rs = state.rowStates[sub.id] || {};
				const preset = rs.presetId ? state.presets[rs.presetId] || null : null;
				const row = { sub, rs, preset, baked: null, bakeWhy: null, oldBaked: null };
				if (preset && _isNativePreset(preset)) {
					row.baked = _bakeKeyOnly(sub, rs, preset);
					if (!row.baked) row.bakeWhy = "원본을 읽지 못함";
					if (rs.ap && rs.ap.nk && _bakedExists(rs.ap.nk)) row.oldBaked = _bakedPath(rs.ap.nk);
				}
				return row;
			});
			const trash = {};
			(state.trashBin || []).forEach((t) => { if (t && t.sub) trash[t.sub.id] = t.why || ""; });
			const mi = Object.assign({}, state.mi, { salt });
			const base = _trackValueNum();
			const plan = planPlacement({ rows: rowsIn, allRows: subs, trash, mi, base: base === null ? 2 : base, scan, details, durs: {}, opts: MI_PF_DEFAULTS });
			const report = verifyReport({ rows: rowsIn, allRows: state.subtitles, mi, scan, details, plan });
			report.legacyRows = state.subtitles.length - subs.length;
			report.seqId = seqId;
			return { ok: true, report };
		} catch (e) {
			console.error("[MOGRT] 검수 멈춤:", e);
			return { ok: false, error: "exception", detail: (e && e.message) || String(e) };
		} finally {
			_miBusy = false;
			_miHideBusy();
		}
	}
	// 네이티브 줄의 구운 사본 {path, key, durSec}를 굽지 않고 계산한다 (검수의 마른 계획: bakeNativeMogrt와 같은 키). 원본을 읽지 못하면 null
	function _bakeKeyOnly(sub, rs, preset) {
		const fs = _nodeRequire("fs");
		if (!fs || !preset || !preset.mogrtPath) return null;
		let mtime;
		try {
			mtime = fs.statSync(preset.mogrtPath).mtimeMs;
		} catch (_) {
			return null;
		}
		const key = nativeBakeKey(preset.mogrtPath, mtime, nativeRowTexts(rowSendParams(rs), preset.params, preset.textParamIndex, sub.text));
		return { path: _bakedPath(key), key, durSec: 0 };
	}
	// ── #verifyModal '타임라인 검수' (S3-3) ──
	// #btnVerify(다화자 적용 바) → _miVerify → 요약 "정상 118 · 타임라인에 없음 1 · …"과 분류별 목록. 줄을 누르면 목록의 그 줄로 가고
	// (필터를 풀지는 않는다) Premiere 재생 헤드를 그 클립(없으면 줄) 시작으로 옮긴다 (v27 seekToClip — 타임라인은 바꾸지 않는다).
	var _vfReport = null;
	function _verifySecOf(item, report) {
		const ft = Number(report && report.frameTicks) || 0;
		if (typeof item.sf === "number" && ft > 0) return (item.sf * ft) / TICKS_PER_SEC;
		const sub = state.subtitles.find((s) => s.id === item.id);
		return sub ? sub.startSec : null;
	}
	function _openVerifyModal(report) {
		const modal = document.getElementById("verifyModal");
		const list = document.getElementById("vfList");
		if (!modal || !list) return;
		_vfReport = report;
		document.getElementById("vfSummary").textContent = report.text;
		const notes = ["읽기만 했습니다 — 타임라인은 바뀌지 않았습니다."];
		if (report.legacyRows) notes.push("화자 없는 줄 " + report.legacyRows + "개는 검수하지 않았습니다.");
		if (report.counts && report.counts.native) notes.push("네이티브 템플릿 클립은 문장을 읽을 수 없어 자리·효과만 봅니다.");
		document.getElementById("vfNote").textContent = notes.join(" ");
		list.innerHTML = "";
		const byCat = {};
		(report.items || []).forEach((it) => { (byCat[it.cat] = byCat[it.cat] || []).push(it); });
		VERIFY_CATS.forEach(([cat, label]) => {
			const items = byCat[cat];
			if (!items || !items.length) return;
			const head = document.createElement("div");
			head.className = "vf-cat";
			head.dataset.cat = cat;
			head.textContent = label + " " + items.length;
			list.appendChild(head);
			items.forEach((it) => {
				const row = document.createElement("div");
				row.className = "vf-item";
				row.dataset.cat = cat;
				if (typeof it.id === "number") row.dataset.id = String(it.id);
				const lab = document.createElement("span");
				lab.className = "vf-label";
				lab.textContent = it.label || (it.uid ? "(목록에 없음)" : "");
				const det = document.createElement("span");
				det.className = "vf-detail";
				det.textContent = it.detail || "";
				det.title = (it.name ? it.name + "\n" : "") + (it.detail || "");
				row.appendChild(lab);
				row.appendChild(det);
				row.addEventListener("click", (e) => {
					e.stopPropagation();
					_verifyGo(it);
				});
				list.appendChild(row);
			});
		});
		if (!list.childNodes.length) {
			const ok = document.createElement("div");
			ok.className = "vf-note";
			ok.textContent = "문제 없음";
			list.appendChild(ok);
		}
		modal.classList.add("open");
	}
	function _closeVerifyModal() {
		const modal = document.getElementById("verifyModal");
		if (modal) modal.classList.remove("open");
		_vfReport = null;
	}
	// 검수 목록의 한 줄로: 목록의 그 줄을 보이게 하고 재생 헤드를 옮긴다 → seekToClip 결과 | null
	async function _verifyGo(item) {
		const sub = typeof item.id === "number" ? state.subtitles.find((s) => s.id === item.id) : null;
		if (sub) {
			document.querySelectorAll(".sub-row.vf-hit").forEach((el) => el.classList.remove("vf-hit"));
			const row = document.getElementById("row-" + sub.id);
			if (row) {
				row.classList.add("vf-hit");
				if (typeof row.scrollIntoView === "function") row.scrollIntoView({ block: "center" });
			}
		}
		const sec = _verifySecOf(item, _vfReport);
		if (sec === null) return null;
		let res;
		try {
			res = await host.seekToClip({ startSec: sec });
		} catch (err) {
			setStatus("이동 실패: " + (err.hostReason || err.message), "err");
			return null;
		}
		if (String(res).indexOf("SUCCESS") === 0) setStatus("검수: " + (item.label || item.name || "") + " — " + sec.toFixed(2) + "초로 이동", "ok");
		else setStatus(res || "이동 실패", "err");
		return res;
	}
	async function _runVerifyUi() {
		if (_miBusy || _legacyRun) {
			setStatus("타임라인 적용이 실행 중입니다", "err");
			return null;
		}
		setStatus("검수: 타임라인 읽는 중…", "info");
		const r = await _miVerify();
		if (!r || r.ok !== true) {
			const why = { "no-host": MI_HOST_STALE_MSG, "build-mismatch": MI_HOST_STALE_MSG, "no-rows": "검수는 화자 줄이 있는 목록에서만 합니다", "preview-active": "프리뷰 시퀀스가 활성입니다 — 작업 시퀀스를 연 뒤 다시 검수하세요",
				"seq-mismatch": "Premiere의 활성 시퀀스가 패널의 시퀀스와 다릅니다", busy: "타임라인 적용이 실행 중입니다" };
			setStatus("검수 못 함: " + (why[r && r.error] || (r && (r.detail || r.error)) || "알 수 없음"), "err");
			return r;
		}
		_openVerifyModal(r.report);
		setStatus("검수: " + r.report.text, "ok");
		return r;
	}
	document.getElementById("btnVerify")?.addEventListener("click", (e) => {
		e.stopPropagation();
		_runVerifyUi();
	});
	document.getElementById("vfRerun")?.addEventListener("click", (e) => {
		e.stopPropagation();
		_closeVerifyModal();
		_runVerifyUi();
	});
	document.getElementById("vfClose")?.addEventListener("click", (e) => {
		e.stopPropagation();
		_closeVerifyModal();
	});
	// 계획 요약 (명령 plan·테스트)
	function _miPlanSummary(plan) {
		const count = {};
		plan.ops.forEach((op) => { count[op.op] = (count[op.op] || 0) + 1; });
		return {
			ops: count, removals: plan.removals.length, none: plan.none.length, minCount: plan.minCount, tracks: plan.tracks, blocked: plan.blocked,
			conflicts: plan.conflicts, edited: plan.edited, missing: plan.missing, oldVersion: plan.oldVersion, decorated: plan.decorated, userMoved: plan.userMoved,
			adopt: plan.adopt, foreignAdopt: plan.foreignAdopt, legacyMove: plan.legacyMove, legacyKept: plan.legacyKept, cleanup: plan.cleanup.length,
			orphans: plan.orphans.map((x) => ({ uid: x.uid, id: x.id, pre: x.pre })), dup: plan.dup, noPreset: plan.noPreset, perSpeaker: plan.perSpeaker,
			skipped: Object.keys(plan.rowOps).filter((k) => plan.rowOps[k] && plan.rowOps[k].skip).map((k) => ({ id: Number(k), why: plan.rowOps[k].skip, detail: plan.rowOps[k].detail || "" }))
		};
	}
	// ─────────────────────────────────────────────────────────────
	// 호스트 작업 실행 공용 (마지막 적용 되돌리기·레거시 안전 경로, S2-5)
	//   _miRunOps  제거(removeClips) → 청크(placeChunk). 청크를 보내기 전에 그 청크가 보호할 이웃(guard)의 스냅숏(속성 전부·이름·자리)을
	//              읽어 둔다 (_miSnapRead, 템플릿은 ctx.repairM). 새로 놓은 클립은 보낸 속성으로 스냅숏을 만들고, 제자리에서 바꾼 클립은
	//              스냅숏을 버린다 (다음에 필요하면 다시 읽는다)
	//   _miRepair  통째로 덮였거나 머리를 되돌리지 못한 이웃(damaged)을 그 스냅숏으로 다시 놓는다 (분기 C, 최대 DAMAGE_ROUNDS번).
	//              화자별 배치(_miApply)는 줄 계획으로 다시 놓는다 (S2-4) — 이 경로는 줄 의도가 아니라 원래 모습 그대로 되살린다
	// ctx (_miRunCtx): {seqId, ft, seqTok, details, created, snaps, repairM, nodeTrack, durs, damaged, lost, byId, stats, la, laN, …}
	// ─────────────────────────────────────────────────────────────
	function _miRunCtx(seqId, ft) {
		const ctx = { seqId, ft, seqTok: _importSeqToken(), details: {}, created: {}, snaps: {}, repairM: {}, nodeTrack: {}, durs: {}, damaged: [], lost: [], byId: {},
			stats: { created: 0, updated: 0, moved: 0, removed: 0, restored: 0, replaced: 0, placed: 0, partial: 0, conflict: 0, failed: 0, repaired: 0, skipped: 0, changed: 0 },
			doneOps: 0, totalOps: 0, la: null, laN: 0, stopped: false, aborted: false, error: null };
		state.subtitles.forEach((s) => { ctx.byId[s.id] = s; });
		return ctx;
	}
	// 스캔한 클립의 트랙 (스냅숏 되읽기에 쓴다)
	function _miNoteScan(ctx, scan) {
		((scan && scan.tracks) || []).forEach((t) => (t.clips || []).forEach((c) => { ctx.nodeTrack[String(c.nodeId)] = t.i; }));
	}
	function _miDurOf(ctx, m) {
		return (m && Number(ctx.durs[normPath(m)])) || PLACE_DUR_FALLBACK;
	}
	// 템플릿 경로들의 기본 길이 {normPath: 초}: 그 템플릿을 쓰는 프리셋의 mogrtDurSec, 없으면 definition.json (_templateDurSec, 못 읽으면 0)
	async function _miDursFor(paths) {
		const out = {};
		for (const p of paths || []) {
			if (!p) continue;
			const k = normPath(p);
			if (out[k] !== undefined) continue;
			const pr = Object.values(state.presets || {}).find((x) => x && normPath(x.mogrtPath) === k && Number(x.mogrtDurSec) > 0);
			out[k] = pr ? Number(pr.mogrtDurSec) : (await _templateDurSec(p)) || 0;
		}
		return out;
	}
	// 이웃 스냅숏 읽기: 보호할 수 있는(repairM) 클립 가운데 아직 없는 것만, 40개씩 (속성 전부 = MI__readParams)
	async function _miSnapRead(ids, ctx) {
		const want = [];
		const seen = {};
		(ids || []).forEach((x) => {
			const id = String(x);
			if (!id || id.indexOf("new:") === 0 || seen[id] || ctx.snaps[id] || !ctx.repairM[id] || typeof ctx.nodeTrack[id] !== "number") return;
			seen[id] = true;
			want.push({ track: ctx.nodeTrack[id], nodeId: id });
		});
		for (let i = 0; i < want.length; i += READ_BATCH) {
			const part = want.slice(i, i + READ_BATCH);
			const r = await _miCallWatch(() => host.mi.readTexts({ seqId: ctx.seqId, items: part, want: { texts: false, lay: false, deco: false, params: true } }));
			if (!r || r.ok !== true) throw _miHostFail("readClipTexts", r);
			(r.results || []).forEach((x) => {
				if (!x || !x.found) return;
				const id = String(x.nodeId);
				const m = ctx.repairM[id];
				ctx.snaps[id] = { nodeId: id, track: x.track, sf: x.sf, ef: x.ef, name: x.name || "", kind: x.kind || "", params: x.params || [], m, durSec: _miDurOf(ctx, m) };
			});
		}
	}
	// 청크 하나를 떼어 낸다 (chunkOps). 같은 청크 안에서 제자리로 바꾼 클립을 뒤 작업이 이웃으로 보호하면 그 앞에서 끊는다
	// (보호할 스냅숏은 청크를 보내기 전에 읽으므로, 바뀐 뒤의 모습을 읽게)
	function _miChunk(queue) {
		const first = chunkOps(queue, PLACE_CHUNK)[0] || [];
		const touched = {};
		for (let k = 0; k < first.length; k++) {
			const op = first[k];
			if (k > 0 && (op.guard || []).some((g) => touched[String(g)])) return first.slice(0, k);
			if (op.own && !opCreates(op)) touched[String(op.own.nodeId)] = true;
		}
		return first;
	}
	// h: {busy(kind, a, b) → 진행 문구, removed(항목, 결과), result(작업, 결과), chunk()}
	async function _miRunOps(ctx, removals, ops, h) {
		const list = removals || [];
		for (let i = 0; i < list.length; i += 200) {
			if (_miCancel) { ctx.stopped = true; return; }
			if (ctx.seqTok !== _importSeqToken()) { ctx.aborted = true; return; }
			const part = list.slice(i, i + 200);
			_miShowBusy(h.busy("remove", part.length));
			const res = await _miCallWatch(() => host.mi.removeClips({ seqId: ctx.seqId, items: part.map((x) => ({ key: x.uid, track: x.track, nodeId: x.nodeId, expectName: x.expectName || null })) }));
			if (!res || res.ok !== true) throw _miHostFail("removeClips", res);
			(res.results || []).forEach((r, k) => { if (part[k]) h.removed(part[k], r || {}); });
			if (h.chunk) h.chunk();
		}
		let queue = (ops || []).slice();
		while (queue.length) {
			if (_miCancel) { ctx.stopped = true; return; }
			if (ctx.seqTok !== _importSeqToken()) { ctx.aborted = true; return; }
			const chunk = _miChunk(queue);
			queue = queue.slice(chunk.length);
			const items = chunk.map((op) => hostItemOf(op, ctx.created));
			await _miSnapRead(items.reduce((a, it) => a.concat(it.guard || []), []), ctx);
			_miShowBusy(h.busy("ops", ctx.doneOps, ctx.totalOps));
			const res = await _miCallWatch(() => host.mi.placeChunk({ seqId: ctx.seqId, frameTicks: ctx.ft, budgetMs: MI_BUDGET_MS, items }));
			if (!res || res.ok !== true) throw _miHostFail("placeChunk", res);
			const done = Math.max(0, Math.min(chunk.length, parseInt(res.done, 10) || 0));
			if (!done) throw _miHostFail("placeChunk", { error: "done 0", detail: "호스트가 작업을 하나도 하지 않았다" });
			for (let k = 0; k < done; k++) {
				const op = chunk[k];
				const r = (res.results || [])[k] || {};
				const st = String(r.status || "");
				if ((PLACE_OK[st] || st === "partial") && r.nodeId) {
					const nid = String(r.nodeId);
					ctx.nodeTrack[nid] = r.track;
					if (opCreates(op)) {
						ctx.created[op.uid] = nid;
						// 새로 놓은 클립의 스냅숏 = 보낸 속성·이름 (뒤 작업이 덮으면 이것으로 다시 놓는다)
						if (op.m) {
							ctx.repairM[nid] = op.m;
							ctx.snaps[nid] = { nodeId: nid, track: r.track, sf: r.sf, ef: r.ef, name: op.name !== null && op.name !== undefined ? op.name : r.name || "", kind: r.kind || "",
								params: op.params || [], m: op.m, durSec: op.durSec || _miDurOf(ctx, op.m) };
						}
					} else delete ctx.snaps[nid];
				}
				ctx.doneOps++;
				h.result(op, r, res);
			}
			if (done < chunk.length) queue = chunk.slice(done).concat(queue);
			(res.damaged || []).forEach((id) => { if (ctx.damaged.indexOf(String(id)) === -1) ctx.damaged.push(String(id)); });
			if (h.chunk) h.chunk();
		}
	}
	// 망가진 이웃을 스냅숏으로 다시 놓는다. h.remap(옛 nodeId, 새 nodeId): 다시 놓은 클립을 기록에서 따라가게
	async function _miRepair(ctx, h) {
		for (let round = 0; round < DAMAGE_ROUNDS && ctx.damaged.length && !ctx.stopped && !ctx.aborted; round++) {
			const ids = ctx.damaged.splice(0);
			const snaps = [];
			ids.forEach((id) => {
				const s = ctx.snaps[id];
				if (s && s.m) snaps.push(s);
				else ctx.lost.push(id);
			});
			if (!snaps.length) break;
			const tracks = [];
			let lo = Infinity;
			let hi = -Infinity;
			snaps.forEach((s) => {
				if (tracks.indexOf(s.track) === -1) tracks.push(s.track);
				lo = Math.min(lo, s.sf);
				hi = Math.max(hi, s.ef, s.sf + frameOf(s.durSec || PLACE_DUR_FALLBACK, ctx.ft));
			});
			const pad = frameOf(SCAN_PAD_SEC, ctx.ft);
			_miShowBusy("덮인 이웃 클립 다시 놓는 중… (" + snaps.length + "개)");
			const scan = await _miCallWatch(() => host.mi.getTracks({ seqId: ctx.seqId, tracks: tracks.sort((a, b) => a - b), fromFrame: Math.max(0, lo - pad), toFrame: hi + pad }));
			if (!scan || scan.ok !== true) throw _miHostFail("getTracks", scan);
			_miNoteScan(ctx, scan);
			const rp = repairOps(snaps, scan, ctx.repairM, ctx.ft);
			rp.bad.forEach((b) => ctx.lost.push(b.op.snap.nodeId));
			ctx.totalOps += rp.ops.length;
			await _miRunOps(ctx, [], rp.ops, {
				busy: (k, a, b) => "덮인 이웃 클립 다시 놓는 중… " + a + "/" + b,
				removed: () => {},
				result: (op, r) => {
					const st = String(r.status || "");
					if ((PLACE_OK[st] || st === "partial") && r.nodeId) {
						ctx.stats.repaired++;
						if (h && h.remap) h.remap(op.snap.nodeId, String(r.nodeId));
					} else ctx.lost.push(op.snap.nodeId);
				},
				chunk: h && h.chunk
			});
		}
		if (ctx.damaged.length) ctx.lost = ctx.lost.concat(ctx.damaged.splice(0));
	}
	// DEV·하드 테스트: false면 레거시 안전 경로를 1단계 경로(v27 호스트, _legacySafeUpdateV27·↑ 이름 쓰기)로 고정한다.
	// null(기본)이면 v28 호스트가 답할 때 v28 경로 (window._mogrtDebug.setLegacyV28, s1_9·s1_10 하드 케이스가 1단계 경로를 시험한다)
	var _legacyV28Force = null;
	// v28 호스트 경로를 쓸 수 있는가: 같은 빌드의 v28 호스트가 답하고, 활성 시퀀스가 패널 시퀀스이며 프리뷰가 아니다
	async function _legacyV28Ok() {
		if (!_keysResolved || _legacyV28Force === false) return false;
		const hk = await _miHostOk();
		return !!(hk.ok && hk.ping && !hk.ping.isPreview && hk.ping.seqId && String(hk.ping.seqId) === String(state.currentSequenceId) && Number(hk.ping.frameTicks) > 0);
	}
	// 실행 시작: 호스트 확인(ping) → {ok, ping} | {ok: false, error}. 실패하면 상태 줄에 알린다 (_miApply와 같은 확인)
	async function _miStartCheck(seqTok0) {
		const hk = await _miHostOk();
		if (!hk.ok) {
			setStatus(hk.msg, "err");
			return { ok: false, error: hk.why === "build" ? "build-mismatch" : "no-host", detail: hk.msg };
		}
		const ping = hk.ping;
		if (ping.isPreview) {
			setStatus("프리뷰 시퀀스가 활성입니다 — 작업 시퀀스를 연 뒤 다시 적용하세요", "err");
			return { ok: false, error: "preview-active" };
		}
		if (!ping.seqId || String(ping.seqId) !== String(state.currentSequenceId) || seqTok0 !== _importSeqToken()) {
			setStatus("Premiere의 활성 시퀀스가 패널의 시퀀스와 다릅니다 — 패널이 따라간 뒤 다시 적용하세요", "err");
			return { ok: false, error: "seq-mismatch" };
		}
		if (!(Number(ping.frameTicks) > 0)) {
			setStatus("시퀀스 프레임 정보를 읽지 못했습니다", "err");
			return { ok: false, error: "exception", detail: "frameTicks" };
		}
		return { ok: true, ping };
	}

	// ─────────────────────────────────────────────────────────────
	// 레거시 안전 경로 (v28 호스트, S2-5) — 계획서 §6.13, spec placement 13
	// 화자 표가 없는 목록의 ▶ [안전하게 적용]과 ↑(v27에 위험하거나 시간이 바뀐 줄)는 v28 호스트가 답하면 이 경로를 쓴다
	// (답하지 않으면 1단계 경로 _legacySafeUpdateV27). 태그를 쓰지 않는다(name null) → 단일 화자 타임라인은 v27과 같은 모습이다.
	//   1) 줄 트랙(ap.t, 없으면 #trackSel)을 줄 자리 ±30초로 스캔 (MI_getTracks)
	//   2) 줄 자리(ap → mmPrev → 지금 시간) ±1프레임의 태그 없는 클립을 되읽어 core legacyMiPlan: 문장만 바뀜 → update(nodeId),
	//      시간이 바뀜 → move (TrackItem.move), 없음 → 놓인 적 없는 줄(_legacyTargets fresh)과 ↑만 place (뒤 클립 머리 보호),
	//      나머지는 '타임라인에서 클립을 찾지 못함'으로 건너뛴다. 문장이 다른 한 클립(uncertain)은 확인창에서 고른다
	//   3) last_apply.json {legacy: true, key "r<id>", g 0}을 쓰고 청크로 보낸다. 덮인 이웃 클립은 스냅숏으로 다시 놓는다
	//   4) 검증된 줄은 ap를 적고 mm을 지운다 (markApplied). 일부 속성만 쓴 줄은 자리(ap)만 적고 mm을 남긴다
	// ─────────────────────────────────────────────────────────────
	const LEGACY_MI_WHY = Object.assign({}, LEGACY_WHY, {
		ambiguous: "같은 자리에 문장이 맞는 클립이 여럿 — 건너뜀",
		uncertain: "같은 자리 클립의 문장이 다름 (확인 필요)",
		"no-track": "트랙 없음",
		// 타임라인에 놓였던 줄인데 그 자리(줄 트랙 ±1프레임)에 클립이 없다: 새로 놓지 않는다 (트랙 선택이 바뀌었거나 옮긴 옛 클립 옆에 중복이 생긴다)
		missing: "타임라인에서 클립을 찾지 못함 (새로 놓지 않음)"
	});
	// 레거시 줄의 클립 주인 (core legacyClipOwners 입력): 살아 있는 줄과 휴지통 항목의 자리·트랙·템플릿(AE 프리셋)
	function _legacyOwnerRows() {
		const one = (sub, rs) => {
			const preset = rs && rs.presetId ? state.presets[rs.presetId] || null : null;
			const ok = !!(preset && preset.mogrtPath && !_isNativePreset(preset) && !(rs && rs.ap && rs.ap.nk));
			const at = [];
			[rs && rs.ap, rs && rs.mmPrev].forEach((x) => { if (x && typeof x.s === "number") at.push(x.s); });
			if (typeof sub.startSec === "number") at.push(sub.startSec);
			return { id: sub.id, track: rs && rs.ap && typeof rs.ap.t === "number" ? rs.ap.t : null, at, m: ok ? preset.mogrtPath : null };
		};
		const out = [];
		state.subtitles.forEach((s) => { if (s && !s.spk) out.push(one(s, state.rowStates[s.id])); });
		(state.trashBin || []).forEach((t) => { if (t && t.sub && !t.sub.spk) out.push(one(t.sub, t.state)); });
		return out;
	}
	// 문장이 다른 한 클립이 있는 줄 → "include" | "skip" | null (취소)
	function _legacyUncertainChoice(ids) {
		return new Promise((resolve) => {
			const labels = ids.slice(0, 8).map((id) => rowLabel(state.subtitles.find((s) => s.id === id), false)).join(", ");
			showChoice("같은 자리에 클립이 있지만 문장이 다른 줄 " + ids.length + "개가 있습니다 (" + labels + (ids.length > 8 ? " …" : "") + ").\n\n" +
				"포함해서 적용: 그 클립을 이 줄의 클립으로 보고 갱신합니다 (클립의 문장을 덮어씁니다).\n빼고 적용: 이 줄들은 건너뜁니다.", [
				{ label: "포함해서 적용", run: () => resolve("include") },
				{ label: "빼고 적용", run: () => resolve("skip") },
				{ label: "취소", run: () => resolve(null) }
			]);
		});
	}
	// 계획의 줄 표시: 건너뛴 줄은 까닭, 보낼 줄은 지난 표시를 지운다, 그대로인 줄(클립을 찾았고 보낼 것이 없다)은 검증된 적용으로 본다
	function _legacyMarkPlan(plan, targets) {
		targets.forEach((t) => {
			const ro = plan.rowOps[t.sub.id];
			if (!ro) return;
			if (ro.skip) _setRowRes(t.sub.id, (LEGACY_MI_WHY[ro.skip] || ro.skip) + (ro.detail && ro.skip !== "ambiguous" ? ": " + ro.detail : ""));
			else {
				_setRowRes(t.sub.id, null);
				if (ro.none && t.rs) markApplied(t.rs, t.sub, t.preset, t.track);
			}
			_refreshRowMarks(t.sub);
		});
	}
	// 레거시 안전 경로 실행. ids: 목록 줄 id (화자 줄은 뺀다), opts {single (↑), full (속성 전부)}
	// → {ok, stopped, error, created, updated, moved, partial, conflict, failed, skipped, repaired, lost, runId} | {ok: false, error}
	async function _legacySafeApply(ids, opts) {
		const o = opts || {};
		if (_miBusy || _legacyRun) {
			setStatus("타임라인 적용이 이미 실행 중입니다", "err");
			return { ok: false, error: "busy" };
		}
		if (!_keysResolved) {
			setStatus("시퀀스를 열면 적용할 수 있습니다", "err");
			return { ok: false, error: "no-sequence" };
		}
		_miBusy = true;
		_miCancel = false;
		const seqTok0 = _importSeqToken();
		let ctx = null;
		let plan = null;
		try {
			const chk = await _miStartCheck(seqTok0);
			if (!chk.ok) return chk;
			const ft = Number(chk.ping.frameTicks);
			const want = _idSet(ids);
			const targets = _legacyTargets(state.subtitles.filter((s) => want[s.id] && !s.spk));
			if (!targets.length) {
				setStatus("적용할 줄이 없습니다", "err");
				return { ok: false, error: "no-rows" };
			}
			ctx = _miRunCtx(String(chk.ping.seqId), ft);
			_miShowBusy("타임라인 읽는 중…");
			const tracks = [];
			let lo = Infinity;
			let hi = -Infinity;
			targets.forEach((t) => {
				if (tracks.indexOf(t.track) === -1) tracks.push(t.track);
				const loc = applyLocate(t.rs, t.sub);
				[loc.s, loc.e, t.sub.startSec, t.sub.endSec].forEach((x) => {
					const f = frameOf(x, ft);
					if (isFinite(f)) {
						lo = Math.min(lo, f);
						hi = Math.max(hi, f);
					}
				});
			});
			const pad = frameOf(SCAN_PAD_SEC + PLACE_DUR_FALLBACK * 2, ft);
			const scan = await _miCallWatch(() => host.mi.getTracks({ seqId: ctx.seqId, tracks: tracks.sort((a, b) => a - b), fromFrame: Math.max(0, lo - pad), toFrame: hi + pad }));
			if (!scan || scan.ok !== true) throw _miHostFail("getTracks", scan);
			_miNumTracks = scan.numVideoTracks;
			_miNoteScan(ctx, scan);
			const owners = legacyClipOwners(scan, _legacyOwnerRows(), ft);
			ctx.durs = await _miDursFor(targets.map((t) => t.preset && t.preset.mogrtPath));
			const planFor = async (uncertain) => {
				let p = null;
				for (let it = 0; it < 4; it++) {
					p = legacyMiPlan({ rows: targets, scan, details: ctx.details, durs: ctx.durs, owners, opts: { uncertain, full: !!o.full, placeMissing: !!o.single } });
					const reads = p.needReads.filter((r) => !ctx.details[r.nodeId]);
					if (!reads.length) break;
					_miShowBusy("클립 읽는 중… (" + reads.length + "개)");
					await _miReadDetails(reads, ctx.details, ctx.seqId);
				}
				return p;
			};
			plan = await planFor(false);
			if (plan.uncertain.length) {
				_miHideBusy();
				const pick = await _legacyUncertainChoice(plan.uncertain);
				if (pick === null) {
					setStatus("타임라인 적용 취소", "");
					return { ok: false, error: "cancelled" };
				}
				if (ctx.seqTok !== _importSeqToken()) {
					setStatus("시퀀스가 바뀌어 적용을 취소했습니다", "err");
					return { ok: false, error: "seq-mismatch" };
				}
				if (pick === "include") plan = await planFor(true);
			}
			// 보호·복구할 수 있는 클립: 다른 줄의 클립(주인 줄의 프리셋 템플릿), 이 실행이 찾은 줄 클립(그 줄의 프리셋 템플릿)
			Object.keys(owners).forEach((n) => { if (owners[n].m) ctx.repairM[n] = owners[n].m; });
			plan.ops.forEach((op) => { if (op.own && op.m) ctx.repairM[String(op.own.nodeId)] = op.m; });
			_legacyMarkPlan(plan, targets);
			if (!plan.ops.length && !plan.removals.length) {
				saveSessionToStorage();
				updateMultiSelect();
				const sk = Object.keys(plan.rowOps).filter((k) => plan.rowOps[k] && plan.rowOps[k].skip).length;
				setStatus("안전하게 적용: 보낼 줄이 없습니다" + (sk ? " (건너뜀 " + sk + ")" : ""), sk ? "err" : "ok");
				return { ok: true, created: 0, updated: 0, moved: 0, skipped: sk };
			}
			ctx.la = _laNew(ctx.seqId, "", targets.length, true);
			ctx.laN = 0;
			_writeLastApply(ctx.la);
			ctx.totalOps = plan.ops.length;
			const h = {
				busy: (k, a, b) => (k === "remove" ? "옛 클립 지우는 중… (" + a + "개)" : "안전하게 적용 중… " + a + "/" + b),
				removed: (x, r) => {
					if (r.status !== "removed") return;
					_laTouch(ctx.la, x.uid, x.id);
					const tgt = targets.find((t) => t.sub.id === x.id);
					const e = Object.assign({ key: x.uid, g: 0 }, r.before || {}, { nodeId: String(x.nodeId), why: x.why, n: ctx.laN++, id: x.id });
					if (!e.m && tgt && tgt.preset) e.m = tgt.preset.mogrtPath;
					ctx.la.removed.push(e);
				},
				result: (op, r) => _legacyOnResult(ctx, op, r),
				chunk: () => {
					ctx.la.chunksDone++;
					_writeLastApply(ctx.la);
				},
				remap: (a, b) => _laRemap(ctx.la, a, b)
			};
			await _miRunOps(ctx, plan.removals, plan.ops, h);
			await _miRepair(ctx, h);
		} catch (e) {
			if (ctx) ctx.error = (e && e.message) || String(e);
			console.error("[MOGRT] 레거시 안전 경로 멈춤:", e);
			setStatus(MI_STOPPED_MSG + ": " + ((e && e.message) || e), "err");
			if (!ctx || !ctx.la) return { ok: false, error: "exception", detail: (e && e.message) || String(e) };
		} finally {
			try {
				if (ctx && ctx.la) _legacyFinish(ctx, plan);
			} finally {
				_miBusy = false;
				_miCancel = false;
				_miHideBusy();
			}
		}
		return _legacyReport(ctx, plan);
	}
	// 작업 결과 하나 → 줄 기록(ap·mm)·줄 표시·last_apply
	function _legacyOnResult(ctx, op, r) {
		const st = String((r && r.status) || "");
		const sub = ctx.byId[op.id] || null;
		const rs = sub ? state.rowStates[sub.id] : null;
		const preset = rs && rs.presetId ? state.presets[rs.presetId] || null : null;
		if (!PLACE_OK[st] && st !== "partial") {
			if (st === "conflict" || st === "locked" || st === "ambiguous") ctx.stats.conflict++;
			else ctx.stats.failed++;
			_setRowRes(op.id, _miResultText(st, r || {}));
			if (sub) _refreshRowMarks(sub);
			return;
		}
		_laTouch(ctx.la, op.uid, op.id);
		_laRecord(ctx, op, r);
		ctx.stats[op.op === "place" ? "created" : op.op === "move" ? "moved" : "updated"]++;
		if (sub && rs) {
			if (st === "partial") {
				// 일부 속성을 쓰지 못했다 (옛 버전 클립·키프레임): 클립이 있는 자리는 적고 병합 표시는 남긴다
				ctx.stats.partial++;
				rs.ap = apRecord(sub, rs, preset, op.track);
				_setRowRes(op.id, "속성 " + ((r.skipped || []).length + (r.keyed || []).length) + "개 적용 안 됨" + ((r.keyed || []).length ? " (키프레임)" : " (옛 버전)"));
			} else {
				markApplied(rs, sub, preset, op.track);
				_setRowRes(op.id, null);
			}
			_refreshRowMarks(sub);
		}
	}
	function _legacyReport(ctx, plan) {
		if (!ctx) return { ok: false, error: "exception" };
		const s = ctx.stats;
		const skipped = plan ? Object.keys(plan.rowOps).filter((k) => plan.rowOps[k] && plan.rowOps[k].skip).length : 0;
		return { ok: !ctx.error && !ctx.aborted, stopped: !!ctx.stopped, error: ctx.error || null, created: s.created, updated: s.updated, moved: s.moved, partial: s.partial,
			conflict: s.conflict, failed: s.failed, skipped, repaired: s.repaired, lost: ctx.lost.length, runId: ctx.la ? ctx.la.runId : null };
	}
	function _legacyFinish(ctx, plan) {
		ctx.la.complete = !ctx.stopped && !ctx.error && !ctx.aborted;
		_writeLastApply(ctx.la);
		const s = ctx.stats;
		const n = s.created + s.updated + s.moved;
		if (ctx.seqTok === _importSeqToken()) {
			saveSessionToStorage();
			if (n) _saveHistoryOnAction("안전하게 적용 (" + n + "개)");
			updateMultiSelect();
		}
		const rep = _legacyReport(ctx, plan);
		const parts = [];
		[["updated", "갱신"], ["moved", "옮김"], ["created", "놓음"]].forEach(([k, t]) => { if (rep[k]) parts.push(t + " " + rep[k]); });
		if (rep.partial) parts.push("일부 속성 빠짐 " + rep.partial);
		if (rep.conflict) parts.push("충돌 " + rep.conflict);
		if (rep.failed) parts.push("실패 " + rep.failed);
		if (rep.skipped) parts.push("건너뜀 " + rep.skipped);
		if (rep.repaired) parts.push("덮인 이웃 다시 놓음 " + rep.repaired);
		if (rep.lost) parts.push("덮인 이웃 " + rep.lost + "개 되살리지 못함");
		const text = "안전하게 적용: " + (parts.join(" · ") || "보낸 줄 없음");
		if (ctx.error) setStatus(MI_STOPPED_MSG + ": " + ctx.error + " — " + text, "err");
		else if (ctx.aborted) setStatus("시퀀스가 바뀌어 멈췄습니다 — " + text, "err");
		else if (ctx.stopped) setStatus("중지함 — " + text, "err");
		else setStatus(text, rep.conflict || rep.failed || rep.skipped || rep.partial || rep.lost ? "err" : "ok");
	}

	// ─────────────────────────────────────────────────────────────
	// 마지막 적용 되돌리기 (타임라인만, S2-5) — 계획서 §6.11, spec placement 11
	// 히스토리 맨 위 '↶ 마지막 적용 되돌리기'(확인창)와 명령 undo. last_apply.json을 core buildUndoOps로 거꾸로 돌린다:
	//   만든 클립 → 지운다, 제자리 작업(update·adopt·move) → 작업 전 속성 전부·이름·자리로, 다시 놓은 클립(moveRegen·legacyMove·replace) →
	//   옛 템플릿(기록한 경로 m)을 옛 자리에 되놓고 지금 클립을 지운다, 지운 클립(옛 gen·목록에서 빠진 줄) → 기록한 자리에 되놓는다.
	// 모든 작업은 nodeId + gen + 지금 텍스트 해시 == 기록한 rh로 확인하고, 다르면 '그 뒤로 바뀜'으로 건너뛴다
	// (네이티브는 Source Text가 늘 ""로 읽혀 텍스트로 확인할 수 없다 → nodeId·gen·종류만 보고, 되놓을 때는 기록한 구운 사본 경로를 쓴다).
	// 자막 목록·후반 작업 값·히스토리는 되돌리지 않는다. 되돌린 줄은 mm "undone"(변경 줄)이 되고 줄의 ap·mmPrev와 applied는
	// 실행 전 기록(la.prev)으로 돌아간다. 중단된 적용은 기록된 청크만 되돌린다. 끝나면 기록에 undone {ts, complete, keys}를 적는다.
	// 새로 만든 비디오 트랙은 지우지 않는다.
	// ─────────────────────────────────────────────────────────────
	const UNDO_CONFIRM_MSG = "타임라인만 되돌립니다. 자막 목록과 후반 작업 값은 그대로이며, 되돌린 줄은 '변경 줄'로 표시됩니다.";
	const UNDO_WHY_TEXT = {
		gone: "클립이 없음", renamed: "클립 이름(태그)이 바뀜", edited: "Premiere에서 문장을 고침", kind: "템플릿 종류가 바뀜", "moved-track": "다른 트랙으로 옮겨짐",
		retimed: "Premiere에서 옮기거나 길이를 바꿈",
		"template-unknown": "되놓을 템플릿을 모름", exists: "그 자리에 같은 클립이 있음", occupied: "되놓을 자리가 막힘", "occupied-own": "되놓을 자리가 막힘", tail: "되놓을 자리 뒤가 막힘",
		locked: "잠긴 트랙", ambiguous: "같은 태그 클립이 여럿", "stale-plan": "계획 뒤 타임라인이 바뀜", misplaced: "다른 트랙에 놓여 지움", failed: "실패"
	};
	// 실패로 세는 까닭 (나머지는 건너뜀)
	const UNDO_FAILS = { failed: true, "stale-plan": true, misplaced: true, exception: true };
	function _undoWhyText(why, detail) {
		const t = UNDO_WHY_TEXT[why] || why;
		return "되돌리지 않음 — " + (UNDO_CHANGED[why] ? "그 뒤로 바뀜 (" + t + ")" : t) + (detail && !UNDO_CHANGED[why] ? ": " + detail : "");
	}
	// 히스토리 항목 문구 "↶ 마지막 적용 되돌리기 (12:03 · 120줄)" + 중단된 적용
	function _undoLabel(la) {
		const d = new Date(la.ts || 0);
		const hm = d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
		return "↶ 마지막 적용 되돌리기 (" + hm + " · " + (la.rows || 0) + "줄)" + (la.complete ? "" : " (중단된 적용)");
	}
	// 보호·복구할 수 있는 클립 {nodeId: 템플릿}: 우리 salt 태그 클립(applied.m), 기록의 마지막 클립(작업 뒤 m), 레거시 줄 자리의 태그 없는 클립(줄 프리셋)
	function _undoRepairM(scan, la, ft) {
		const out = {};
		const salt = String(la.salt || state.mi.salt || "");
		((scan && scan.tracks) || []).forEach((t) => (t.clips || []).forEach((c) => {
			const tg = parseClipTag(c.name);
			if (!tg || !salt || tg.salt !== salt) return;
			const a = state.mi.applied[tg.uid];
			if (a && a.m) out[String(c.nodeId)] = a.m;
		}));
		undoChains(la).chains.forEach((ch) => {
			if (ch.final && ch.final.m && ch.final.nodeId && !out[ch.final.nodeId]) out[ch.final.nodeId] = ch.final.m;
		});
		const owners = legacyClipOwners(scan, _legacyOwnerRows(), ft);
		Object.keys(owners).forEach((n) => { if (owners[n].m && !out[n]) out[n] = owners[n].m; });
		return out;
	}
	// 되돌린 key 하나 → applied·줄 기록(ap·mmPrev)을 실행 전으로, 줄은 mm "undone"
	function _undoDone(ctx, key, act, r, partial) {
		ctx.undo.done[key] = act;
		ctx.stats[act === "remove" ? "removed" : act === "replace" || act === "place" ? "replaced" : act === "move" ? "moved" : "restored"]++;
		if (partial) ctx.stats.partial++;
		const p = ctx.la.prev ? ctx.la.prev[key] : null;
		if (isUidKey(key) && p) {
			const a = p.a ? JSON.parse(JSON.stringify(p.a)) : null;
			// 되놓은 클립은 태그 gen을 올렸다 (지금 클립이 남아도 옛 gen으로 정리되게)
			if (a && (act === "replace" || act === "place") && r && typeof r.g === "number") a.g = r.g;
			if (a) state.mi.applied[key] = a;
			else delete state.mi.applied[key];
		}
		const id = p && typeof p.id === "number" ? p.id : laKeyId(key);
		const sub = ctx.byId[id] || null;
		const rs = sub ? state.rowStates[sub.id] : null;
		if (!sub || !rs) return;
		if (p) {
			if (p.ap) rs.ap = JSON.parse(JSON.stringify(p.ap));
			else delete rs.ap;
			if (p.mmPrev) rs.mmPrev = JSON.parse(JSON.stringify(p.mmPrev));
			else delete rs.mmPrev;
		}
		rs.mm = "undone";
		_setRowRes(sub.id, partial ? "되돌림: 일부 속성을 되돌리지 못함" : null);
		_miRowStatus[sub.id] = { st: "undone", why: act, detail: "" };
		_refreshRowMarks(sub);
	}
	// 되돌리지 않은 key → 줄 표시
	function _undoSkip(ctx, key, why, detail) {
		ctx.undo.why[key] = { why, detail: detail || "" };
		if (UNDO_CHANGED[why]) ctx.stats.changed++;
		else if (UNDO_FAILS[why]) ctx.stats.failed++;
		else ctx.stats.skipped++;
		const p = ctx.la.prev ? ctx.la.prev[key] : null;
		const id = p && typeof p.id === "number" ? p.id : laKeyId(key);
		const sub = ctx.byId[id] || null;
		if (!sub) return;
		_setRowRes(sub.id, _undoWhyText(why, detail));
		_miRowStatus[sub.id] = { st: "undo-skipped", why, detail: detail || "" };
		_refreshRowMarks(sub);
	}
	// 마지막 적용 되돌리기. opts {runId: 확인창을 연 기록 (그 사이 다른 적용이 기록을 바꿨으면 하지 않는다)}
	// → {ok, stopped, error, removed, restored, moved, replaced, placed, partial, changed, skipped, failed, repaired, lost} | {ok: false, error}
	async function _miUndo(opts) {
		const o = opts || {};
		if (_miBusy || _legacyRun) {
			setStatus("타임라인 적용이 이미 실행 중입니다", "err");
			return { ok: false, error: "busy" };
		}
		if (!_keysResolved) {
			setStatus("시퀀스를 열면 되돌릴 수 있습니다", "err");
			return { ok: false, error: "no-sequence" };
		}
		const la = _readLastApply();
		if (!laUndoable(la, state.currentSequenceId) || (o.runId && la.runId !== o.runId)) {
			setStatus("되돌릴 마지막 적용이 없습니다", "err");
			return { ok: false, error: "not-found" };
		}
		if (!la.legacy && la.salt && state.mi.salt && la.salt !== state.mi.salt) {
			setStatus("마지막 적용 기록이 지금 목록의 것이 아닙니다 (salt가 다름) — 되돌리지 않습니다", "err");
			return { ok: false, error: "salt-mismatch" };
		}
		_miBusy = true;
		_miCancel = false;
		const seqTok0 = _importSeqToken();
		let ctx = null;
		try {
			const chk = await _miStartCheck(seqTok0);
			if (!chk.ok) return chk;
			const ft = Number(chk.ping.frameTicks);
			ctx = _miRunCtx(String(chk.ping.seqId), ft);
			ctx.la = la;
			ctx.undo = { done: Object.assign({}, (la.undone && la.undone.keys) || {}), why: {} };
			const already = Object.assign({}, ctx.undo.done);
			// 스캔: 기록의 트랙들, 작업 뒤 자리와 작업 전 자리 ±30초 (+ 템플릿 길이)
			const tracks = [];
			let lo = Infinity;
			let hi = -Infinity;
			const paths = [];
			UNDO_CATS.forEach((c) => (Array.isArray(la[c]) ? la[c] : []).forEach((e) => {
				if (!e) return;
				[e, e.from].forEach((x) => {
					if (!x || typeof x.track !== "number") return;
					if (tracks.indexOf(x.track) === -1) tracks.push(x.track);
					if (typeof x.sf === "number") {
						lo = Math.min(lo, x.sf);
						hi = Math.max(hi, typeof x.ef === "number" ? x.ef : x.sf);
					}
					if (x.m) paths.push(x.m);
				});
			}));
			if (!tracks.length) throw new Error("기록에 트랙이 없다");
			const pad = frameOf(SCAN_PAD_SEC + PLACE_DUR_FALLBACK * 2, ft);
			_miShowBusy("타임라인 읽는 중…");
			const scan = await _miCallWatch(() => host.mi.getTracks({ seqId: ctx.seqId, tracks: tracks.sort((a, b) => a - b), fromFrame: Math.max(0, lo - pad), toFrame: hi + pad }));
			if (!scan || scan.ok !== true) throw _miHostFail("getTracks", scan);
			_miNoteScan(ctx, scan);
			ctx.durs = await _miDursFor(paths);
			UNDO_CATS.forEach((c) => (Array.isArray(la[c]) ? la[c] : []).forEach((e) => {
				if (e && e.m && Number(e.dur) > 0 && !(Number(ctx.durs[normPath(e.m)]) > 0)) ctx.durs[normPath(e.m)] = Number(e.dur);
			}));
			ctx.repairM = _undoRepairM(scan, la, ft);
			let plan = null;
			for (let it = 0; it < 4; it++) {
				plan = buildUndoOps({ la, scan, details: ctx.details, durs: ctx.durs, repairM: ctx.repairM, skipKeys: already });
				const reads = plan.needReads.filter((r) => !ctx.details[r.nodeId]);
				if (!reads.length) break;
				_miShowBusy("클립 확인 중… (" + reads.length + "개)");
				await _miReadDetails(reads, ctx.details, ctx.seqId);
			}
			plan.skipped.forEach((s) => _undoSkip(ctx, s.key, s.why, s.detail));
			ctx.stats.kept = plan.kept.length;
			ctx.totalOps = plan.ops.length;
			const opsByKey = {};
			plan.ops.forEach((op) => { opsByKey[op.uid] = op; });
			await _miRunOps(ctx, plan.removals, plan.ops, {
				busy: (k, a, b) => (k === "remove" ? "되돌리는 중… 만든 클립 지우기 (" + a + "개)" : "되돌리는 중… " + a + "/" + b),
				removed: (x, r) => {
					// 순환을 끊는 '먼저 지우기'는 그 작업(놓기)이 끝나야 되돌린 것이다
					if (x.why !== "undo") return;
					if (r.status === "removed") _undoDone(ctx, x.key || x.uid, "remove", r, false);
					else if (r.status === "notOurs") _undoSkip(ctx, x.key || x.uid, "renamed", r.name || "");
					else if (r.status === "notFound") _undoSkip(ctx, x.key || x.uid, "gone");
					else _undoSkip(ctx, x.key || x.uid, r.status === "locked" ? "locked" : "failed", r.status + (r.reason ? " " + r.reason : ""));
				},
				result: (op, r) => {
					const st = String((r && r.status) || "");
					if (PLACE_OK[st] || st === "partial") {
						if (op.undo === "unremove") {
							ctx.stats.placed++;
							ctx.undo.done[op.uid] = "unremove";
							const e = op.entry || {};
							// 목록에서 빠진 줄의 클립을 되놓았다: 그 uid의 applied도 지우기 전으로
							if (e.why === "orphan" && e.pa && isUidKey(e.key) && !state.mi.applied[e.key]) state.mi.applied[e.key] = JSON.parse(JSON.stringify(e.pa));
						} else _undoDone(ctx, op.key, op.undo, r, st === "partial");
						return;
					}
					_undoSkip(ctx, op.key, st === "conflict" ? r.reason || "occupied" : UNDO_WHY_TEXT[st] ? st : "failed", _miResultText(st, r || {}));
				},
				chunk: () => {
					la.undone = { ts: Date.now(), complete: false, keys: ctx.undo.done };
					_writeLastApply(la);
				}
			});
			await _miRepair(ctx, {});
		} catch (e) {
			if (ctx) ctx.error = (e && e.message) || String(e);
			console.error("[MOGRT] 되돌리기 멈춤:", e);
			setStatus(MI_STOPPED_MSG + ": " + ((e && e.message) || e), "err");
			if (!ctx) return { ok: false, error: "exception", detail: (e && e.message) || String(e) };
		} finally {
			try {
				if (ctx) _undoFinish(ctx);
			} finally {
				_miBusy = false;
				_miCancel = false;
				_miHideBusy();
			}
		}
		return _undoReport(ctx);
	}
	function _undoReport(ctx) {
		if (!ctx) return { ok: false, error: "exception" };
		const s = ctx.stats;
		return { ok: !ctx.error && !ctx.aborted, stopped: !!ctx.stopped, error: ctx.error || null, removed: s.removed, restored: s.restored, moved: s.moved, replaced: s.replaced,
			placed: s.placed, partial: s.partial, changed: s.changed, skipped: s.skipped, kept: s.kept || 0, failed: s.failed, repaired: s.repaired, lost: ctx.lost.length, runId: ctx.la ? ctx.la.runId : null };
	}
	function _undoFinish(ctx) {
		const la = ctx.la;
		la.undone = { ts: Date.now(), complete: !ctx.stopped && !ctx.error && !ctx.aborted, keys: ctx.undo.done };
		_writeLastApply(la);
		const rep = _undoReport(ctx);
		const n = rep.removed + rep.restored + rep.moved + rep.replaced + rep.placed;
		if (ctx.seqTok === _importSeqToken()) {
			saveSessionToStorage();
			if (n) _saveHistoryOnAction("마지막 적용 되돌리기 (" + n + "개)");
			updateMultiSelect();
		}
		const parts = [];
		[["removed", "지움"], ["restored", "되돌림"], ["moved", "옮김"], ["replaced", "다시 놓음"], ["placed", "되놓음"]].forEach(([k, t]) => { if (rep[k]) parts.push(t + " " + rep[k]); });
		if (rep.partial) parts.push("일부 속성 못 되돌림 " + rep.partial);
		if (rep.changed) parts.push("그 뒤로 바뀜 " + rep.changed + " (건너뜀)");
		if (rep.skipped) parts.push("건너뜀 " + rep.skipped);
		if (rep.kept) parts.push("덮여서 다시 놓은 이웃 " + rep.kept + "개는 그대로");
		if (rep.failed) parts.push("실패 " + rep.failed);
		if (rep.repaired) parts.push("덮인 이웃 다시 놓음 " + rep.repaired);
		if (rep.lost) parts.push("덮인 이웃 " + rep.lost + "개 되살리지 못함");
		const text = "마지막 적용 되돌리기: " + (parts.join(" · ") || "되돌린 것 없음");
		if (ctx.error) setStatus(MI_STOPPED_MSG + ": " + ctx.error + " — " + text, "err");
		else if (ctx.aborted) setStatus("시퀀스가 바뀌어 멈췄습니다 — " + text, "err");
		else if (ctx.stopped) setStatus("중지함 — " + text, "err");
		else setStatus(text, rep.changed || rep.skipped || rep.failed || rep.partial || rep.lost ? "err" : "ok");
	}
	// 히스토리 항목을 눌렀다: 확인창 → 되돌리기 (확인창을 연 시퀀스·기록이 그대로일 때만)
	function _confirmUndoApply(la) {
		const seq = _importSeqToken();
		const runId = la.runId;
		showConfirm(UNDO_CONFIRM_MSG + (la.complete ? "" : "\n\n중단된 적용입니다: 기록된 청크만 되돌립니다."), () => {
			if (seq !== _importSeqToken()) {
				setStatus("시퀀스가 바뀌어 되돌리기를 취소했습니다", "err");
				return;
			}
			_miUndo({ runId });
		}, null, { yes: "되돌리기" });
	}
	// DEV·하드 테스트 훅: 되돌리기(확인창 없이)·레거시 안전 경로·마지막 적용 기록
	window._mogrtDebug.undoApply = (opts) => _miUndo(opts || {});
	window._mogrtDebug.legacySafeApply = (ids, opts) => _legacySafeApply(ids, opts || {});
	window._mogrtDebug.lastApply = () => _readLastApply();
	window._mogrtDebug.setLegacyV28 = (v) => {
		_legacyV28Force = v === false ? false : null;
		return _legacyV28Force;
	};
	// DEV·하드 테스트 훅: [중지]와 같다
	window._mogrtDebug.miStop = () => { if (_miBusy) _miCancel = true; return _miBusy; };
	window._mogrtDebug.miBusy = () => _miBusy;
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
		if (_miBusy) return; // 화자별 배치 중에는 30초 재스캔을 쉰다 (호스트 호출이 끼어들지 않게, S2-4)
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
			// 화자별 배치 중에는 시퀀스 전환을 따라가지 않는다 (목록·키가 바뀌면 결과를 다른 시퀀스에 적는다, S2-4)
			if (_miBusy) return;
			let info;
			try {
				info = await host.getActiveSequenceInfo();
			} catch (_) {
				return;
			}
			// 기다리는 동안 적용이 시작됐을 수 있다 (▶가 이 호출 뒤에 줄을 섰다) → 이 결과로 시퀀스를 옮기지 않는다
			if (_miBusy) return;
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
				// 검수 창·화자 파일 바뀜 알림도 이전 시퀀스의 것이다 (S3-3)
				_closeVerifyModal();
				_hideCastToast(false);
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
		_reapplyFilters();
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
			renderCastBar(); // 화자 표의 트랙 미리보기는 기본 트랙(#trackSel)에서 시작한다
		}
		document.getElementById("trackSel")?.addEventListener("change", _saveTrackToStorage);
		document.getElementById("trackSel")?.addEventListener("change", () => renderCastBar());
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
			// 전체 선택: 보이는 줄만 (검색·프리셋·화자 필터로 숨은 줄은 고르지 않는다. 필터가 없으면 v27과 같다)
			state.subtitles.forEach((sub) => {
				const rs = state.rowStates[sub.id];
				const rowEl = document.getElementById("row-" + sub.id);
				if (_rowHidden(rowEl)) return;
				rs.checked = true;
				const chk = document.querySelector("#row-" + sub.id + " input[type=checkbox]");
				if (chk) chk.checked = true;
				if (rowEl) rowEl.className = _buildRowClass(sub.id, rs); // 노란색 is-checked 적용
			});
		}
		_reapplyFilters();
		updateMultiSelect();
	});
	// ── 변경 줄 선택: 병합으로 mm이 붙은 줄만 체크한다 (나머지는 체크를 푼다). 필터로 숨은 줄은 고르지 않는다 ──
	document.getElementById("btnSelectChanged")?.addEventListener("click", () => {
		let n = 0;
		state.subtitles.forEach((sub) => {
			const rs = state.rowStates[sub.id];
			if (!rs) return;
			const rowEl = document.getElementById("row-" + sub.id);
			rs.checked = !!rs.mm && !_rowHidden(rowEl);
			if (rs.checked) n++;
			const chk = document.querySelector("#row-" + sub.id + " input[type=checkbox]");
			if (chk) chk.checked = rs.checked;
			if (rowEl) rowEl.className = _buildRowClass(sub.id, rs);
		});
		_reapplyFilters();
		updateMultiSelect();
		setStatus("변경 줄 " + n + "개 선택", "ok");
	});
	// ── 경고 (N): 포인트 텍스트 경고(!)가 있는 줄만 보기 / 다시 누르면 모두 (S3-2) ──
	document.getElementById("btnWarnFilter")?.addEventListener("click", (e) => {
		e.stopPropagation();
		_markFilter = _markFilter === "warn" ? "" : "warn";
		_reapplyFilters();
		setStatus(_markFilter === "warn" ? "경고가 있는 줄만 보기" : "모든 줄 보기", "ok");
	});
	// ── AI 제안 (N) 드롭다운: 제안 줄만 보기 · 검증 통과만 적용(안전 지점 'AI 제안 적용 전') · 모두 무시 (S3-2) ──
	document.getElementById("btnSuggestions")?.addEventListener("click", (e) => {
		e.stopPropagation();
		document.getElementById("suggDropdown")?.classList.toggle("open");
	});
	document.getElementById("suggDropdown")?.addEventListener("click", (e) => {
		e.stopPropagation();
		const b = e.target && typeof e.target.closest === "function" ? e.target.closest("button") : null;
		const act = b && b.dataset ? b.dataset.act : "";
		if (!act) return;
		document.getElementById("suggDropdown")?.classList.remove("open");
		if (act === "filter") {
			_markFilter = _markFilter === "sugg" ? "" : "sugg";
			_reapplyFilters();
			setStatus(_markFilter === "sugg" ? "AI 제안이 있는 줄만 보기" : "모든 줄 보기", "ok");
			return;
		}
		const all = _suggAll().map((x) => ({ sub: x.sub, fid: x.fid }));
		if (!all.length) return;
		if (act === "apply") {
			_suggApprove(all);
			return;
		}
		if (act === "reject") {
			showConfirm("AI 제안 " + all.length + "개를 모두 버립니다.\n속성·타임라인은 그대로입니다.", () => _suggReject(all), null, { yes: "모두 무시" });
		}
	});
	document.addEventListener("click", (e) => {
		const wrap = document.getElementById("suggWrap");
		if (wrap && !wrap.contains(e.target)) document.getElementById("suggDropdown")?.classList.remove("open");
	});
	// ── 옛 구조 줄 맞추기: 사용자가 누를 때만 (안전 지점 '구조 맞춤 전'), 적용은 부르지 않는다 (S1-10) ──
	document.getElementById("btnRebaseStale")?.addEventListener("click", () => {
		const ids = _staleRowIds();
		if (!ids.length) return;
		showConfirm("옛 구조 줄 " + ids.length + "개의 " + REBASE_CONFIRM_MSG, () => _rebaseStale(ids), null, { yes: "현재 구조로 맞추기" });
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
		if (_miBusy) {
			setStatus("타임라인 적용이 이미 실행 중입니다", "err");
			return;
		}
		const checkedIds = Object.entries(state.rowStates).filter(([, rs]) => rs.checked).map(([id]) => parseInt(id, 10));
		if (checkedIds.length > 0) showConfirm(checkedIds.length + "개 자막이 선택되어 있습니다.\n\n확인: 선택된 " + checkedIds.length + "개만 적용\n취소: 전체 " + state.subtitles.length + "개 적용", () => doApplyToTimeline(state.subtitles.filter((sub) => checkedIds.includes(sub.id))), () => doApplyToTimeline(state.subtitles));
		else doApplyToTimeline(state.subtitles);
	});
	// ▶ 적용. 화자 줄이 있는 목록(다화자) → 화자별 배치 _miApply (화자마다 전용 트랙, S2-4).
	// 화자 표 없는 레거시 목록: 병합으로 바뀐 줄이나 v27 index 쓰기가 위험한 줄이 있으면 [안전하게 적용] 확인창을 먼저 띄우고,
	// 없으면 v27 본문 그대로 (src/mi/apply.ts) — 단일 화자 ▶는 바꾸지 않은 v27 applyToTimeline을 부른다
	async function doApplyToTimeline(targetSubs) {
		if (_castMode() || state.subtitles.some((s) => s.spk)) return _miApply(targetSubs);
		const flagged = _legacyFlagged(targetSubs);
		if (!flagged.length) return _legacyApply(targetSubs);
		return _legacyApplyChoice(targetSubs, flagged);
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
			const entry = _makeHistoryEntry(_aiLabelOf(label || "안전 지점"), false);
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
			// ── 마지막 적용 되돌리기 (last_apply.json, S2-5): 맨 위. 이 시퀀스의 기록이고 v27 ▶가 덮지 않았고 아직 되돌리지 않았을 때.
			// 누르면 확인창 → 타임라인만 되돌린다 (src/mi/apply.ts _miUndo). 히스토리 항목 복원과 달리 목록은 그대로다 ──
			const la = _readLastApply();
			if (laUndoable(la, state.currentSequenceId)) {
				const item = document.createElement("div");
				item.id = "btnUndoApply";
				item.className = "history-item last-apply" + (la.complete ? "" : " partial");
				item.title = "마지막 적용을 타임라인에서만 되돌립니다 (자막 목록·후반 작업 값은 그대로, 되돌린 줄은 '변경 줄'로 표시)";
				item.innerHTML = '<span class="hist-label">' + escapeHtml(_undoLabel(la)) + '</span>';
				item.addEventListener("click", (e) => {
					e.stopPropagation();
					dropdown.classList.remove("open");
					if (_miBusy || _legacyRun) {
						setStatus("타임라인 적용이 이미 실행 중입니다", "err");
						return;
					}
					_confirmUndoApply(la);
				});
				dropdown.appendChild(item);
			}
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
	function _saveHistoryOnAction(label) { _saveHistory(_aiLabelOf(label), false); }
	// 승인한 AI 요청을 실행하는 동안(_aiLabel) 남는 안전 지점·히스토리 이름은 "AI: …" (S3-1)
	function _aiLabelOf(label) {
		const s = String(label == null ? "" : label);
		return _aiLabel && s.indexOf("AI: ") !== 0 ? "AI: " + s : s;
	}
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
