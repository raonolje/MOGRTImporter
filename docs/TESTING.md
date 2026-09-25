# TESTING

MOGRT Subtitle Importer의 테스트·DEV 설치·배포 절차. 작업 지시서는 `docs/MULTISPEAKER_PLAN.md` §13이다.

## 1. 한눈에

| 층 | 명령 | 무엇을 | 언제 |
|---|---|---|---|
| 단위 | `npm test` | 패널 순수 로직(app.js region), 호스트 순수 블록, 도구 | 커밋마다. 2초 안 |
| 린트 | `npm run lint:jsx` | hostscript.jsx의 `MI:BEGIN`~`MI:END` 구역이 ES3인지 | JSX를 바꾼 커밋마다 |
| 하드 | `npm run hard` / `node tests/premiere/run.js …` | DEV 패널(7778)을 CDP로 몰아 Premiere에서 확인 | 커밋의 하드 케이스, JSX 변경 뒤 |

커밋 관문: `npm test` 초록 → (JSX면) `npm run lint:jsx` 초록 → 그 커밋의 하드 케이스와 스모크가 DEV에서 초록 → (JSX면) Premiere 재시작 뒤 단일 화자 골든 케이스.

## 2. 단위 테스트 (node)

- Node 24.14, 의존성 없음. `npm test` = `node --test "tests/unit/**/*.test.js" "tests/compat/**/*.test.js"`.
- **글롭 인자가 필수다.** `node --test tests/unit`처럼 폴더를 넘기면 Node 24.14는 폴더를 테스트 파일로 실행하다 실패한다.
- `tests/lib/loadRegions.js`
  - `loadRegions(["src/srtParser.ts"])`: app.js의 `//#region <이름>` ~ `//#endregion` 블록을 잘라 `node:vm`에서 실행하고 최상위 함수·상수를 돌려준다. 빌드가 없으니 패널이 로드하는 바로 그 파일이다.
    - 최상위 이름: `function`(`function*`, `async function` 포함), `class`, `var/let/const` 선언 목록 전체(`const A = 1, B = 2`, `const { C, D: E, ...R } = o`, `const [F, , G = 1] = xs`). 블록 안 `var`는 세지 않는다.
  - vm에는 `console`, `TextDecoder`, `TextEncoder`만 있다.
  - 순수성 가드: 불러오는 region이 `document`, `window`, `state.`, `host.`, `localStorage`, `cep`, `CSInterface`를 쓰면 예외. 주석·문자열·템플릿의 글자 부분은 보지 않지만 템플릿 `${ … }` 안의 코드는 본다. 새 순수 로직은 `//#region src/mi/core.ts`에 둔다.
  - `loadHostPure()`: hostscript.jsx의 `/* MI_PURE_BEGIN */`~`/* MI_PURE_END */`(ES3)를 그대로 node에서 실행한다 (S2-1부터 `MI__json`, `MI__parseTag` 등). 블록이 없는 파일은 `{}`.
  - `regionHash(name)`: region 본문의 fnv1a32(8자리 hex). 5단계 MCP 드리프트 검사에 쓴다.
  - vm 객체는 프로토타입이 달라 `assert.deepStrictEqual`이 실패한다. 비교 전에 `plain(v)`를 쓴다.
- `tests/unit/legacy_parseSRT.test.js`는 v27 골든이다. 깨지면 단일 화자 가져오기가 v27과 달라진 것이다.
- `tests/lib/panelHarness.js` (S1-3): **app.js 전체**(IIFE)를 node:vm에서 부팅한다. 브라우저가 아니라 app.js가 지나가는 만큼만 흉내 낸다.
  - DOM: `index.html`을 작은 파서로 읽은 트리(id·class·label 부모·select 옵션, innerHTML 마크업도 파싱). 선택자는 `tag#id.class[attr=v]:checked`, 자손, 쉼표만.
  - 호스트: `CSInterface.evalScript`의 함수 이름으로 `h.host.handlers[이름](...인자)`를 부르고 `h.host.calls`에 남긴다. 처리기가 없으면 빈 응답(전송 실패). 패널이 보내는 ExtendScript 식은 맨 앞 주석 `/*host:이름 인자JSON*/`의 이름으로 부른다(S1-11 `removeNativeClipsAt`, 기본 처리기 `"SUCCESS: 0"`). v27 `getTimelineClips`의 기본 처리기는 빈 트랙(`"[]"`)이다(S1-11 연쇄 계획이 ap 없는 줄의 클립 자리를 읽는다).
  - Node (S1-11): `bootPanel({node: {files: {경로: 바이트|{data, mtimeMs}}}})`이면 `require("fs"|"zlib"|"path")`와 `jszip.min.js`를 넣는다. fs는 메모리(`h.nodeFs.files`, 쓰기 `h.nodeFs.writes`, 지우기 `h.nodeFs.unlinks`), zlib는 진짜다. JSZip은 진짜 `setImmediate`로 돌아 `h.flush()`를 여러 번 불러야 끝난다. 없으면 require·JSZip이 없다(굽기는 `no-node`로 실패).
  - `cep.fs`: 메모리(`h.fs.files`, 쓰기 기록 `h.fs.writes`, 읽기 실패 흉내 `h.fs.unreadable`, 옮기기 실패 흉내 `h.fs.renameFails`). `readdir`·`rename`도 있다. 캐시 경로는 `cachePaths`로 만든다.
  - 시계: 타이머는 `await h.advance(ms)`로만 돈다(부팅 2초 재확인, 100 ms 폴러, 30초 재스캔). `Date`는 진짜라 5분 무작업 자동저장은 저절로 돌지 않는다. 자동저장을 시험할 때는 `h.win.Date.now`를 멈춘 시계로 바꾸고 `window._mogrtDebug.idleAutosaveTick()`(1분 타이머가 부르는 무작업 확인, S1-4)을 부른다. 하드 케이스도 같은 방법을 쓴다(`s1_4_safety.case.js`).
  - 클립보드: `window.navigator.clipboard.writeText`가 쓴 글자는 `h.clipboard`에 남는다(S1-6 배지 복사). `delete h.win.navigator.clipboard` 뒤 `h.doc.execCommand`를 두면 대체 경로를 시험한다. 설치 폴더의 `html/…`(예: `html/js/app.js`)는 저장소 파일을 읽는다(S1-5 coreHash).
  - 상태는 `h.snapshot()`(= `window._mogrtDebug.snapshot()`, 읽기 전용 사본)으로 본다. `h.errors()`는 부팅·타이머·콘솔의 TypeError/ReferenceError.
  - `panel_golden.test.js`(단일 화자 SRT → 프리셋 → ▶ 페이로드·session.json)는 v27 app.js에서도 통과한다. 단일 화자 경로가 바뀌면 여기서 깨진다.
- **픽스처는 합성 텍스트만** 넣는다(`tests/fixtures/`). 저장소에 GitHub 원격이 있다. `tests/fixtures/**`는 `-text`라 CRLF·CR·BOM 바이트가 그대로 커밋된다.
- `tests/fixtures/mogrt/make_old_mogrt.js` (S1-9): '옛 버전 MOGRT' 하드 픽스처. 사용자 템플릿이 들어 있어 **커밋하지 않고** 테스트할 때마다 설치된 MOGRT에서 저장소 밖 임시 폴더(`<os.tmpdir()>/mi_mogrt_fixtures`)로 만든다(저장소 안 폴더는 거부, `*.mogrt`는 `.gitignore`).
  - `makeOldLayoutMogrt({newName})`: 새 버전(기본 '자동 줄바꿈 박스')과 텍스트 컨트롤 이름이 순서대로 같고 구조가 다른 옛 버전(이 PC에서는 `Project_MOGRT/기본 자막.mogrt`, 8속성)을 찾아 바이트 그대로 복사한다. `MI_OLD_MOGRT`로 원본을 직접 지정할 수 있다.
  - `makeRenamedMogrt(src, {옛: 새}, out)`: 같은 capsuleID로 컨트롤 이름만 바꾼 사본(S0-3 x ②). zip 읽기·쓰기는 의존성 없이 이 파일에 있다(`tests/unit/fixtures_mogrt.test.js`는 합성 템플릿으로만 본다).
- `tests/fixtures/mogrt/make_native_mogrt.js` (S1-11): 합성 네이티브 MOGRT(definition.json, gzip .prproj를 담은 project.prgraphic·project_ko_KR.prgraphic, 썸네일)와 구운 사본 읽기(`readNativeMogrt`). 설치된 Premiere 템플릿(2018 형식)의 모양을 따른다: Source Text 블롭 = 8바이트 LE 길이 + UTF-16LE JSON, 지역화 파일은 속성 이름이 '소스 텍스트', 같은 블롭은 빈 요소 `<… BinaryHash="h"/>`로 가리킨다. `format: "binary"`는 새 Premiere(apiVersion 2.x)의 이진 Source Text(굽지 못함). `durationSec`는 definition의 템플릿 길이(`sourceInfoLocalized` duration, 연쇄 창).
- `tests/lib/premiereSim.js` (S2-1): **hostscript.jsx 전체**를 가짜 Premiere(ExtendScript DOM) 위에서 node:vm으로 돌린다. v28 MI_ 호스트의 단위 테스트용이다 (`host_read.test.js`, S2-2부터 `host_place.test.js`).
  - 흉내 내는 실측: importMGT·overwriteClip의 [S, S+D) 덮어쓰기(앞 클립 끝 자름·통째로 덮인 클립 지움·뒤 클립 머리와 inPoint 밀기·가운데는 둘로), 시작은 가장 가까운 프레임, 끝은 스냅 안 함, 트랙 번호 ≥ 트랙 수면 마지막 트랙, nodeId는 처음 읽을 때 발급, razor(`sim.razor`), start·inPoint·end 대입은 그 값만, move는 겹침 검사 없음, remove 두 번째는 false, 키 있는 속성 setValue 무시, 네이티브(getMGTComponent·projectItem null, Source Text 한 글자 초깃값), 공유 projectItem과 overwriteClip의 옛 구조(`oldParams`), QE addTracks.
  - vm의 JSON을 지워 hostscript의 ES3 JSON 폴리필(eval)을 쓴다. V8 eval은 문자열 속 날 U+2028/2029를 받아 주므로 폴리필 `JSON.parse`를 감싸 ExtendScript처럼 거부한다 (S0-3 h). 호스트에 넘기는 래퍼는 접근할 때마다 새로 만든다 (같은 클립도 `===`가 아니다).
  - 실패 주입: `sim.S.misplaceNext`(importMGT를 다른 트랙에), `sim.S.overwriteFails`, `sim.S.moveFails`(TrackItem.move 예외), `sim.S.moveSkewNext`(다음 move 한 번이 ticks만큼 더 간다).
  - `sim.call(fn, payload)`는 패널 `_callMi`처럼 JSON(U+2028/2029 이스케이프) 문자열 하나로 부르고 결과를 파싱한다. 네이티브 Source Text 쓰기 횟수는 `sim.S.counts.nativeTextWrites`.
  - 실제 Premiere 동작은 하드 케이스(`s2_1_tracks`, `s2_2_place`)가 확인한다. 시뮬레이터가 통과해도 하드 케이스를 건너뛰지 않는다.
- `tests/unit/host_pure.test.js` (S2-1): MI_PURE 블록(MI__json 이스케이프·NaN, 태그 왕복, 프레임 계산)과 **v27 부분의 바이트 고정**(머리 주석 뒤 ~ `/* MI:BEGIN v28 */` 앞 본문의 fnv = v27 태그에서 잰 값).
- `tests/unit/host_place.test.js` (S2-2): 쓰기 호스트를 시뮬레이터에서 — 순수 규칙(`MI__occupy` 자리 확인·끝 맞춤, `MI__checkItem`), 하드 T1~T17과 같은 상황(ensure, 정확한 시작·끝 ticks, before로 정확히 복원, 끝 맞춤, occupied/tail, locked, no-track, moveRegen, 중단 뒤 stale, 자르기 ambiguous, removeClips, 이웃 머리 되돌리기(R)·damaged(C), replace 실패 → restored-old, 예산, keyed, 옛 구조 클립에 이름으로 쓰기, move), itemCache 구조 확인, misplaced, adopt·legacyMove, 네이티브 Source Text 쓰기 0번. 리뷰 반영(하드 R1~R3와 같은 상황): replace 되놓기는 남의 클립을 이웃으로 보지 않는다(lost-old, 같은 salt 태그 클립은 이웃), 같은 트랙 moveRegen·legacyMove에서 옛 클립 조각이 남지 않는다, move 실패는 원래 자리로 되돌린다, 같은 이름 속성이 여럿인 옛 구조는 순서로 맞춘다, 구운 네이티브를 새로 놓을 때 문구 param은 skipped가 아니다.
- 하드 케이스 `s2_1_tracks`·`s2_2_place`는 스크래치 시퀀스 안의 단계를 `steps(env)`로 따로 내보낸다. env의 `host`·`mi`를 시뮬레이터(DEV 이름으로 바꾼 hostscript를 `createSim({hostFile})`로)에 이으면 Premiere 없이 케이스 로직을 미리 돌려 볼 수 있다 (vm 객체 비교는 `Array.from`으로).
- `tests/unit/panel_host_mi.test.js` (S2-1): 패널 어댑터 `host.mi`(`_callMi`: 접두사, build·seqId 붙이기, U+2028/2029 이스케이프)와 `_miHostOk`(실행마다 ping, v 28·빌드 확인), `status.panel.build`·`status.host`.
- `tests/unit/core_plan.test.js` (S2-4): core 배치 계획 `planPlacement`(첫 자동 화자 = 기본 트랙, 남의 클립 트랙 건너뛰기, autoTrack, 고정 겹침, 트랙 늘리기, 같은 화자 겹침 맞춤, 잠김, occupied·occupied-own·tail, 태그 없는 클립 인식 certain/uncertain, 다른 salt 태그는 문장으로만, 나눈 레거시 목록의 legacyMove와 효과 있는 클립 빼기, 의도 해시가 같으면 none, 바뀐 속성만, Premiere에서 고침, 지운 클립 다시 놓기, 옛 gen 제거, applied.m으로 템플릿 확인, mogrtLs 옛 버전, 네이티브 템플릿 모름, 나누기·합치기를 한 번에), `orderOps`(의존·순환 끊기 — 끊은 배치는 속성 전부·다음 gen), `chunkOps`·`hostItemOf`(새 클립 이웃 "new:uid"), `recoverSalt`, `appliedEntryOf`(partial은 못 쓴 속성 fh 빼고 h 비움, 텍스트를 쓰지 않은 작업은 rh 유지)·`intentHash`·`textsHash`, 인식 후보는 한 클립에 한 줄(동시 발화, 네이티브 ap 다툼), 새 트랙은 작업이 쓰는 트랙까지만, 네이티브 고아는 미리 체크하지 않음, 효과 있어 제자리(stay).
- `tests/unit/panel_mi_apply.test.js` (S2-4): **패널 전체(panelHarness) + 호스트 전체(premiereSim)** 를 이어 화자별 배치를 끝에서 끝까지 — 호스트 처리기 `MI_*`를 `sim.callRaw`로 넘긴다. 2화자(새 트랙 점검), 다시 적용 0개, 첫 청크 뒤 중지와 '(중단된 적용)', Premiere에서 고친 클립, ↑ 한 줄, 레거시 나누기, 복제한 시퀀스, 워치독(느린 처리기: 하네스 처리기는 약속을 돌려줘도 된다), 분기 C 다시 놓기, 시간 이동·나누기, 점검 창 취소, 호스트 실패로 멈춤, plan·apply 명령. 리뷰 반영: 자리 바꾸기(순환), partial은 다시 보냄, 고친 클립을 시간만 옮겨도 rh 유지, 효과 있어 제자리(mm·#pfMoveDecorated 남음), 동시 발화 한 클립, 스캔 트랙 목록과 못 찾은 클립의 두 번째 스캔, 폴러와 ▶의 경합(처리기를 차례대로 잇는다), 시퀀스를 바꾸면 트랙 수를 잊음.
- `tests/unit/core_undo.test.js` (S2-5): core 되돌리기·레거시 안전 경로 — `undoChains`(key마다 기록 순서: 첫 항목의 작업 전 origin, 마지막 클립 final, 순환 먼저 지우기는 묶고 옛 gen·목록 밖 제거는 따로), `buildUndoOps`(created → 지움, updated·adopted → 작업 전 속성 전부·이름·끝, 같은 트랙 move → TrackItem.move, moveRegen·replace → 옛 템플릿(m)을 옛 자리에 gen+1로 되놓고 지금 클립 지움, 지운 클립 → 되놓기, 가드: 클립 없음·태그 gen·텍스트 해시 → '그 뒤로 바뀜', 네이티브는 텍스트를 보지 않고 종류만, 템플릿 모름, 이미 되돌린 key, 자리 흉내의 guard·tail, 이웃 복구(fix)로 시작한 key는 그대로), `legacyMiPlan`(문장만 → 캡션 하나로 update, 시간 → move, 없음 → place와 이웃 보호, 위험한·되돌린 줄·↑은 속성 전부, uncertain·ambiguous·네이티브·한 클립 한 줄), `legacyClipOwners`·`repairOps`·`fitWindow`·`undoRetag`·`laUndoable`. 리뷰 반영: 적용 뒤 옮기거나 길이를 바꾼 클립(제자리 갱신은 keepTime으로 속성만, 만든·옮긴·다시 놓은 클립은 retimed·moved-track), prev 없는 기록(S2-4 모양)은 되돌리지 않음, 못 찾은 레거시 줄은 놓인 적 없는 줄(`legacyFresh`)·↑(placeMissing)만 놓고 나머지는 missing, 캡션 비교는 찾은 클립의 문장으로.
- `tests/unit/panel_undo.test.js` (S2-5): 패널 전체 + 호스트 전체(premiereSim)로 되돌리기·레거시 안전 경로 끝에서 끝까지 — (1) 놓기·갱신·다른 트랙 다시 놓기·템플릿 교체·목록에서 빠진 줄 지우기를 히스토리 항목(확인창)으로 되돌리면 모든 클립(uid·트랙·시작·끝·템플릿·속성)이 적용 전과 같고, 줄은 mm undone, applied·ap는 실행 전(다시 놓은 줄은 gen만 올림), 다시 ▶하면 같은 결과, (2) Premiere에서 고친 클립은 '그 뒤로 바뀜'으로 건너뜀·agent는 needs-approval, (3) 중지한 적용은 기록된 청크만, (4) 레거시 +0.4초·문장 → [안전하게 적용](v28): 같은 nodeId로 옮김·이웃 그대로·태그 없음·v27 호스트 안 부름 → 되돌리기 → 다시 안전하게 적용, (5) 레거시 새 줄의 템플릿 길이가 덮은 이웃은 스냅숏으로 다시 놓음, (6) ↑ 시간이 바뀐 레거시 줄은 v28 move, v27 ▶는 기록을 superseded로, (7) 네이티브(구운 사본, 하네스 `node` + 시뮬레이터 `S.templates` Proxy로 `/baked/` 경로를 네이티브 템플릿으로): 문구 교체·이동을 되돌리면 옛 구운 사본이 옛 자리에, Source Text 쓰기 0, (8) 적용 중 덮여 다시 놓은 이웃(fix)은 되돌리기가 지우지 않고, 되놓은 옛 템플릿이 다시 덮으면 스냅숏으로 되살린다. 리뷰 반영: (9)(10) 적용 뒤 Premiere에서 옮긴 클립(갱신한 줄은 문장만 되돌리고 자리 그대로, 만든·옮긴 클립은 '그 뒤로 바뀜'), (11) v27 목록에서 시간만 바뀐 줄의 고친 캡션도 쓴다, (12) 트랙 선택이 바뀌어 못 찾은 줄은 새로 놓지 않는다(중복 없음), (13) 놓았다가 되돌린 새 줄은 다시 놓는다, (14) prev 없는 기록은 히스토리 항목·명령 undo 없음, (15) v27 호출이 바꾸기 전에 실패하면 superseded를 적지 않는다.
- `tests/unit/panel_cast.test.js` (S2-3): 화자 표·화자 칩·필터 다시 걸기·⋯ 메뉴(기본 프리셋 일괄 적용·줄 선택·화자 삭제)·휴지통 라벨과 되살리기·cast_defaults.json, core `resolveTracks`·`castDefaultsOf/Merge`. 단일 화자 줄 DOM과 휴지통 되살리기 자리는 `bootPanel({appSrc})`로 **git tag v27의 app.js**를 같은 하네스에서 돌려 비교한다 (`git show v27:…`, 태그가 없으면 실패).
- `tests/compat/native_bake_real.test.js` (S1-11): 설치된 MOGRT 폴더(`MI_MOGRT_ROOT`, 기본 `%APPDATA%/Adobe/Common/Motion Graphics Templates`)가 있으면 돈다. 읽기 전용(메모리에서만 굽는다). Classic Lower Third Two Lines를 굽고, 모든 네이티브 템플릿의 prgraphic마다 Source Text 수가 TextLayer 수와 같거나 0(새 형식)인지 본다.
- `tests/compat/` (S1-5부터, `preset_refs.test.js`는 S1-2 리뷰 반영): `MI_REAL_CACHE`가 운영 캐시(`%APPDATA%/Adobe/CEP/extensions/CEP_MogrtImporter/cache`)를 가리킬 때만 돈다. **읽기 전용**이고, 실제 자막 텍스트를 저장소에 복사하지 않는다(스냅샷·픽스처·로그 파일 금지). 출력은 숫자·id만.
  - `realcache.test.js` (S1-5): 비어 있지 않은 session.json을 하네스(메모리 cep.fs)에 넣고 불러와 다시 저장해도 JSON이 같고 키 4개(mi 없음)인지, 히스토리 항목을 드롭다운으로 복원해도 목록·rowStates·휴지통이 같은지, 캡션 T-ID가 모든 줄에서 캡션 필드로 해석되고 isV27Unsafe가 옛 구조 줄과 정확히 같은지 본다. 실행: `MI_REAL_CACHE="$APPDATA/Adobe/CEP/extensions/CEP_MogrtImporter/cache" node --test tests/compat/realcache.test.js`
- `runCommand` (S1-5, `//#region src/mi/commands.ts`): 하드 케이스는 `await window._mogrtDebug.cmd(op, args)`(약속)로 부른다 (`hard.js`의 `pageCmd`). 읽기 명령 status·rows·resolve·presets·cast.get·session.snapshot.

## 3. ES3 린트

- `npm run lint:jsx` = `node tests/lib/es3lint.js extension/jsx/hostscript.jsx`. v27 코드는 보지 않고 `/* MI:BEGIN v28 */`~`/* MI:END */`만 본다. 구역이 없으면 통과.
- 금지: `let`, `const`, `=>`, `class`, 템플릿 문자열(`${ … }` 안도 검사), `.forEach/.map/.filter/.some/.every/.reduce(`, `Array.isArray`, 배열 `indexOf`, `.trim(`, `Object.keys/create`(와 ES5+ Object.*: `getOwnPropertyDescriptor`, `is`, `fromEntries`, `isFrozen`, `setPrototypeOf` …), `.bind(`, `Date.now`, `.normalize(`, get/set 리터럴, 예약어 속성 이름(`x.default`, `{new: …}`), `JSON.*`(→ `MI__json`, `parsePayload`), ES2015+ 문자열 메서드(`.includes/.padStart/.matchAll/.replaceAll(` …), 배열 메서드(`.find/.findIndex/.fill/.flat/.flatMap/.entries/.keys/.values/.at(` …), `.toISOString/.toJSON(`, 정적 메서드·상수(`Array.from`, `Number.isSafeInteger`, `Number.MAX_SAFE_INTEGER`, `Math.trunc/imul` …), ES2015 전역(`Promise`, `Map` …), 전개, `for…of`, 기본 매개변수, 객체·배열 리터럴의 끝 쉼표(`{a: 1,}`, `[1,]`, S2-1).
- 목록에 없는 ES5+ 내장은 통과하므로 새 호스트 코드에서 낯선 메서드를 쓰면 ES3에 있는지 먼저 확인하고, 없으면 규칙과 실패 픽스처(`tests/unit/es3lint.test.js`)를 같이 늘린다.
- `indexOf`는 정적으로 배열/문자열을 구분할 수 없다. 수신자가 문자열 리터럴, `String(…)`, `(x + "")`, 문자열 메서드 결과(`.toLowerCase()`, `.join(…)` 등)일 때만 통과한다. 문자열이면 `String(name).indexOf("[MI:")`처럼 감싸고, 배열 멤버십은 `MI__idx(arr, x)`를 쓴다.

## 4. DEV 사본 (운영과 부딪히지 않게)

| | 운영 | DEV |
|---|---|---|
| 폴더 | `%APPDATA%/Adobe/CEP/extensions/CEP_MogrtImporter` | `…/CEP_MogrtImporter_dev` |
| 번들 id / 패널 id | `com.raonolje.mogrtimporter` / `….panel` | `com.raonolje.mogrtimporter.dev` / `….dev.panel` |
| 메뉴 | MOGRT Subtitle Importer | MOGRT Subtitle Importer (DEV) |
| 디버그 포트 | 7777 | 7778 |
| 호스트 전역 접두사 | `MI_`, `MI__` | `MID_`, `MID__` (`\bMI_` → `MID_`) |
| 빌드 스탬프 `@@BUILD@@` | `prod-<sha>` | `dev-<sha>` (작업 트리가 더러우면 `dev-<sha>-d<시각>`) |
| 캐시 | `<운영 폴더>/cache` | `<DEV 폴더>/cache` (구조상 분리) |

- `tools/install_dev.sh`: 저장소 `extension/`(작업 트리)을 임시 사본으로 만들어 위 변환을 하고(`tools/lib/stamp.js`), 검사한 뒤 DEV 폴더에 **지우지 않고 덮어쓴다**. DEV의 `cache/`는 건드리지 않는다. 설치 전후 운영 폴더의 sha1 목록을 비교해 운영이 그대로인지 알려 준다. 설치한 빌드는 `CEP_MogrtImporter_dev/.mi_build`에 적는다.
  - `--seed-cache`: 운영 캐시를 DEV 캐시로 복사한다. 운영은 읽기만 하고, 기존 DEV 캐시는 `cache_prev_<시각>`으로 옮겨 둔다.
  - `--uninstall`: `CEP_MogrtImporter_dev`만 지운다. Premiere가 꺼져 있어야 하고, 폴더의 manifest가 DEV 신원일 때만 지운다.
  - `MI_CEP_EXT_DIR`: extensions 폴더를 바꿔 모의 설치할 때만 쓴다.
- 클립 태그 `[MI:`에는 밑줄이 없어서 이름 바꾸기에 걸리지 않는다. 태그 정규식은 DEV에서도 그대로다.
- 식별자가 아닌 `MI_` 이름은 바꾸지 않는다: `MI_test`(`MI_test.prproj`, `MI_test/` 폴더)와 환경 변수 `MI_REAL_CACHE`, `MI_CEP_EXT_DIR`, `MI_BACKUP_ROOT` (`tools/lib/stamp.js`의 `MI_KEEP`). `run.js`가 DEV용 `.jsx`를 바꿀 때도 같은 규칙을 쓰므로, 스파이크·하드 `.jsx`가 `MI_test.prproj`인지 확인하는 코드는 DEV에서도 그대로 동작한다. 새 v28 식별자 이름을 `MI_test…`로 시작하지 않는다(`MI_tests`처럼 뒤에 글자가 더 붙으면 바뀐다).
- 예전 스크래치 도구 `devswap.sh`(운영을 extensions 밖으로 치우고 7788로 설치)는 쓰지 않는다. 운영을 치워 둔 상태라면 먼저 `devswap.sh off`로 되돌린다.

### 규칙

- **DEV로 테스트하는 동안 운영 패널은 닫아 둔다.** 두 패널의 100 ms 폴러가 서로 경쟁한다.
- **JSX를 바꿨으면 반드시 Premiere를 다시 시작한다.** hostscript.jsx는 재시작 전까지 캐시되고, 모든 CEP 확장이 전역 범위를 같이 쓴다(마지막에 로드된 것이 이긴다, spike #16).
- app.js·index.html만 바꿨으면 재시작 없이 `node tests/premiere/cdp.js --port 7778 --reload`로 패널만 새로 고친다.
- 테스트에서 `app.project.closeDocument`를 쓰지 않는다(패널이 내려가 재시작 전까지 돌아오지 않는다).

### JSX 변경 절차

1. `tools/install_dev.sh`
2. Premiere 종료
3. Premiere 실행 → **Ctrl+O**로 `C:/Users/RAONOLJE/Documents/MI_test/MI_test.prproj` (명령줄로 여는 것은 한글 경로에서 실패했다)
4. 창 > 확장 > MOGRT Subtitle Importer (DEV)
5. `node tests/premiere/run.js --port 7778 --check-build`
6. `npm run hard`

## 5. 하드 테스트 (CDP)

- `tests/premiere/cdp.js`: CDP 클라이언트. 기본 7778이고 대상 페이지 URL이 `CEP_MogrtImporter_dev`여야 붙는다. 7777은 `--prod`일 때만.
- `tests/premiere/run.js [--port 7778] [--timeout ms] [--no-guard] [--check-build] [--reload] <file>…`
  - `.expr.txt`: `---` 줄로 나눈 페이지 표현식. top-level `await` 가능. 예외가 나면 실패.
  - `.jsx`: 패널의 `CSInterface`로 `$.evalFile`. DEV에서는 `\bMI_`를 `MID_`로 바꾸고 한글은 `\uXXXX`로 바꾼 임시 사본을 쓴다(상대 `#include`는 안 된다). `EvalScript error.`면 실패.
  - `.case.js`: `module.exports = { run: async ({ panel, host, mi, assert, log, reload, info }) => … }`
    - `panel(expr)` 페이지에서 평가, `host(jsx)` 호스트에서 평가(문자열), `mi(name, payload)` `MID_<name>("<JSON>")` 호출 후 JSON 파싱. 패널 `_callMi`와 같은 계약으로 JSON 텍스트의 U+2028/2029를 JSON 이스케이프로 바꾼 뒤(호스트 `JSON.parse` 폴리필은 ES3 `eval`이라 날 문자는 문법 오류) ASCII 리터럴로 넘긴다. 한글도 안전하다.
  - `--check-build`: 설치된 빌드(DEV hostscript의 `MID_BUILD` 또는 `.mi_build`)와 `MID_ping().build`, 패널 `status.build`(있으면)를 비교한다. 호스트에 `MID_ping`이 없으면(S2-1 전) 건너뛴다. 다르면 Premiere를 다시 시작한다.
  - 종료 코드: 0 통과, 1 실패, 2 연결 실패, 3 가드 거부, 64 사용법.
- **가드**(`tests/premiere/lib/guard.js`): 열린 프로젝트가 `MI_test.prproj`이고 활성 시퀀스 이름이 `T_`로 시작할 때만 `.jsx`·`.case.js`(와 기본으로 `.expr.txt`)를 실행한다. 확인은 v27 `getActiveSequenceInfo()`로 한다. `--no-guard`는 DEV의 `.expr.txt`에만 쓰고, 실행 전에 열린 프로젝트·시퀀스를 찍는다.
- **운영(`--prod`, 7777)**: 저장소의 `tests/premiere/smoke.expr.txt`(`cdp.js`의 `PROD_SMOKE_FILES`)와 `--check-build`만 받는다. 다른 파일, `--reload`, `cdp.js --prod --expr-file <다른 파일>`은 거부한다. 운영 페이지는 `window._mogrtDebug._fsWrite`·`saveSession()`과 `evalScript`를 드러내므로 아무 표현식이나 돌리면 운영 캐시나 실제 프로젝트가 바뀔 수 있다. 운영 스모크 표현식을 늘릴 때는 읽기 전용인지 확인하고 `smoke.expr.txt`에 넣는다.
- `npm run hard` (`tests/premiere/suite.js`): 가드 → `smoke.expr.txt` → `cases/*.case.js`(이름순). `npm run hard -- s1_9`처럼 이름 일부로 거른다.
- 스모크(`tests/premiere/smoke.expr.txt`, 읽기 전용): `window._mogrtDebug`가 object, `getActiveSequenceInfo()`가 seqId를 돌려준다.
- 케이스 공용 도우미 `tests/premiere/lib/hard.js`: `waitFor`(페이지 표현식이 참이 될 때까지), 트랙 읽기·비우기 JSX(`jsxReadVideoTrack`, `jsxClearVideoTrack` — 스크래치 사본의 V2 이상만), 스크래치 시퀀스(`withScratchSequence` — 활성 T_ 시퀀스를 `Sequence.clone()`해 `T_scratch_<tag>`로 돌리고 끝나면 `deleteSequence`·DEV 세션 폴더 정리. 원본 T_23976에는 S0-3 수동 확인용 클립이 있어 타임라인을 바꾸는 케이스는 반드시 여기서 돈다), `#srtInput`에 파일 넣기(`pageDropSrt`), 행 요약(`PAGE_ROWS`), 새로 고침 예외 검사(`reloadClean`), 프리셋이 없을 때 모달로 만들기(`ensurePreset` — 먼저 `setupPreviewSequence`로 프리뷰 시퀀스를 만들어 V1을 지킨다).
  - `s2_5_undo` (S2-5): (1)(2) 2화자(C1 AE, C2 네이티브 구운 사본) 적용 → 다시 가져오기·프리셋 교체·트랙 고정으로 6범주 적용 → JSX로 새 클립을 고친 뒤 히스토리 '↶ 마지막 적용 되돌리기'(확인창) → 고친 클립은 '그 뒤로 바뀜'으로 남고 나머지 S0 클립은 (uid·트랙·시작·끝)과 MGT 속성 raw가 S0과 같다(색은 getColorValue ARGB). 네이티브는 문구를 읽을 수 없어 되돌리기의 placeChunk 항목(`hostMi.placeChunk`를 감싸 기록)이 S0의 구운 사본(ap.nk)인지와 줄 ap.nk로 본다, (3) 되돌린 뒤 ▶에서 '목록에서 빠진 줄의 클립 지우기'를 끄면 남음, (4) 레거시 +0.4초 → v28 [안전하게 적용 (2)] → 되돌리기(명령), (5) 중지한 적용의 되돌리기는 기록된 줄만. 줄 간격은 템플릿 기본 길이보다 넓다(덮인 이웃 복구는 단위 테스트가 본다). 호스트는 바뀌지 않아 Premiere를 다시 시작하지 않아도 된다(패널만 새로 고침).
  - `s1_9`·`s1_10`은 S2-5부터 `window._mogrtDebug.setLegacyV28(false)`(`hard.js` `pageSetLegacyV28`)로 1단계 경로(v27 호스트 `updateClipAtTime`)를 고정해 시험하고 끝나면 기본값(null: v28 호스트가 답하면 레거시 안전 경로)으로 돌린다.
  - `s2_4_e2e` (S2-4): 화자별 배치 E2E (a)~(h). 스크래치 사본마다 V2 이상을 비운 뒤 돈다. (c)는 페이지에서 `window._mogrtDebug.hostMi.placeChunk`를 한 번 감싸 첫 청크 뒤 `miStop()`을 부른다. (g)는 적용한 스크래치를 다시 `Sequence.clone`하고 끝나면 지운다. (h)는 메모리 경고 모달을 피하려고 120줄. `cast_defaults.json`은 시작 전 내용으로 되돌린다.
  - `s2_3_cast` (S2-3): 세 화자 가져오기 → 화자 표·칩·필터·선택 삭제·이름 파일 셋·새 프리셋 선택지·프리셋 삭제·새로 고침 bootDone, 단일 화자 줄 모양·되살리기 자리. 프로젝트 단위 `cast_defaults.json`(DEV 캐시)은 끝나면 시작 전 내용으로 되돌린다.
  - 적용·구조 맞춤 케이스용(S1-9, S1-10): 클립 속성 되읽기(`jsxTrackProps` — 클립마다 시작·끝·nodeId와 [이름, 값], 텍스트는 `T:`+textEditValue, `propValue`), MOGRT 직접 놓기(`jsxPlaceMogrt`, 스크래치 사본만), 확인창 기다리기(`waitConfirm`), `PAGE_CLEAR_STATUS`, `pageSelectTrack`, `pageCheckRow`, `pageTypeField`, 합성 SRT(`srtOf`), MOGRT로 프리셋 찾기·만들기(`pickPresetForMogrt`), 빈 목록에 SRT + 프리셋(`loadRowsWithPreset`), ▶ → [안전하게 적용 (N)](`safeApplyClick`).

### 테스트 프로젝트

- `C:/Users/RAONOLJE/Documents/MI_test/MI_test.prproj` (MOGRT_probe.prproj 사본)
- 시퀀스: `T_23976`(1920x1080), `T_2997`, `T_25`, `T_5994`, `T_TC1h`(시작 TC 01:00:00:00), `T_BIG`(V1 600클립 + V3 MOGRT 150클립)
- 각 시퀀스: V1 영상, 빈 V2+, V4에 외부 PNG 하나. 케이스는 템플릿 시퀀스를 복제하거나 V2+를 스스로 비운다.

## 6. 운영 배포

- `tools/deploy_prod.sh` — Premiere가 **꺼진** 상태에서만.
  1. 운영 캐시와 코드를 `%APPDATA%/MOGRT_Importer_backup/<시각>/{cache,code}`(extensions/ 밖)로 백업하고 파일 수·바이트(캐시는 sha1까지)를 검증한다.
  2. `git archive HEAD`로 만든 임시 사본에 `prod-<sha>`를 찍어 CSXS·html·jsx·README.md·.debug를 **지우지 않고 덮어쓴다**. cache/는 대상이 아니다. extension/에 커밋 안 된 변경이 있으면 거부한다.
  3. 복사한 파일을 하나씩 비교하고 캐시 sha1 목록이 배포 전과 같은지 확인한다.
- `--dry-run`: 바뀔 파일만 보여 주고, 운영 캐시의 파일 수·바이트·최신 mtime·sha1이 그대로인지 확인한다. 운영·백업 폴더에 쓰지 않는다.
  - 파일 목록: `~` 내용이 바뀜, `=` 줄바꿈만 다름(CR만 빼면 같음), `+` 새 파일. `git archive`는 LF(`.gitattributes` `eol=lf`)로 만들고, 지금 운영 `html/index.html`은 저장소 작업 트리(`git ls-files --eol`에서 `w/mixed`)와 같은 CRLF 사본이라 코드가 같아도 첫 배포와 `--rollback v27`에서 `=`로 나온다. 동작은 같고, 한 번 배포하면 LF로 맞춰진다. 그래서 v27 롤백은 지금 설치본과 줄바꿈 바이트까지 같지는 않다.
- `--rollback <ref>`: 같은 절차로 `<ref>`의 extension/을 배포한다. 롤백 기준 태그는 `v27`(0aa8b82, 로컬 태그).
- `installer_v1.1.6.exe`로 업그레이드·롤백하지 않는다(캐시가 설치 폴더 안에 있다).
- 배포 뒤 Premiere를 열고 읽기 전용 스모크: `node tests/premiere/run.js --prod --port 7777 tests/premiere/smoke.expr.txt` (`--prod`는 이 파일과 `--check-build`만 받는다).
