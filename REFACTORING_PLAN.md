# REFACTORING_PLAN

MOGRT Subtitle Importer 리팩토링 작업 지시서. Claude Code가 이 문서를 읽고 순서대로 진행한다.

- 작성 기준: 2026-08-27
- 대상 커밋: 인스톨러 v1.1.6에서 복구한 초기 소스
- 배경: 원본 TypeScript 소스가 소실되어 인스톨러에서 역추출함. 자세한 경위는 `RECOVERY_NOTES.md`

---

## 0. 작업 전 반드시 읽을 것

### 0.1 소스가 두 벌 있고, 동작하는 쪽은 하나뿐이다

| 경로 | 성격 | 수정 대상 |
|---|---|---|
| `extension/html/js/app.js` | 4,819줄 단일 번들. **Premiere가 실제로 로드하는 파일** | ✅ 여기를 고친다 |
| `src/*.js` | 위 번들을 `//#region` 경계로 잘라낸 분리본 | ❌ 참고용. 고쳐도 반영 안 됨 |

`src/`는 빌드 파이프라인이 없어 그대로는 실행되지 않는다. 원래 하나의 IIFE 스코프를 공유하던 코드라 모듈 간 import/export가 없고 서로의 최상위 변수를 직접 참조한다.

**이 계획의 모든 작업은 `extension/html/js/app.js`를 직접 수정한다.** 번들은 압축·난독화되어 있지 않아 편집에 지장이 없다. `src/`는 구조 파악용으로만 읽고, 작업 후 동기화하지 않는다(§5에서 처리).

번들 내 region 경계(줄 번호는 원본 기준, 수정하면서 밀린다):

```
state.ts        2      storage.ts     20     cep.ts        261
srtParser.ts    277    ui/tabs.ts     311    colorUtils.ts 346
ui/paramEditor  539    ui/trash.ts   1154    ui/presetList 1266
ui/modal.ts    1479    ui/subtitleList 3367  main.ts      3849
```

### 0.2 이 리팩토링의 목적은 UXP 전환 준비다

Adobe UXP는 Premiere 25.6부터 정식 지원되지만, **MOGRT 컴포넌트 파라미터(특히 텍스트)의 읽기/쓰기가 UXP API에 아직 노출되지 않았다.** 이 플러그인의 핵심 기능이 정확히 그 지점이라 현재는 이식이 불가능하다. Adobe는 작업 중이라고만 밝혔고 날짜는 없으며, ExtendScript 브리지를 제공할 계획도 없다고 명시했다. CEP 은퇴 일정도 아직 잡혀 있지 않다.

참고 스레드: https://forums.creativeclouddeveloper.com/t/mogrt-parameters-in-uxp-availabilty/11408

따라서 **지금 UXP 포팅을 시도하지 말 것.** 대신 UXP가 열렸을 때 갈아엎을 부분과 그대로 살릴 부분을 미리 갈라두는 것이 §1의 목적이다.

### 0.3 테스트 방법

자동화된 테스트가 없다. 각 작업 후 수동 확인이 필요하다.

1. `extension/` 폴더를 `CEP_MogrtImporter` 이름으로 CEP extensions 경로에 복사
2. Premiere Pro 재시작 → `Window > Extensions`
3. 디버그 콘솔은 `.debug`에 지정된 포트 7777 (`http://localhost:7777`)

**작업 단위마다 커밋할 것.** 되돌릴 수 있어야 한다.

---

## 1. 호스트 어댑터 계층 도입 (최우선)

### 배경

패널(JS) ↔ 호스트(JSX) 통신은 `cep.ts` region의 `evalScriptWithPayload()` 하나로 이미 통일되어 있다. 원저자가 잘 잡아둔 구조다. 여기에 진입점별 래퍼를 얹어 호출부가 문자열 함수명을 직접 넘기지 않게 만든다.

UXP 전환 시 이 어댑터와 `hostscript.jsx`만 다시 쓰면 되고, UI·상태·파서 코드는 손대지 않아도 된다.

### 현재 `cep.ts` region 전문

```js
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
	return evalScript(`${funcName}(decodeURIComponent("${encodeURIComponent(json)}")`);
}
```

`try` 블록이 하나도 없다. 모든 호스트 호출이 이 지점을 지나므로 에러 처리를 여기 한 곳에 넣으면 전체가 한 번에 견고해진다.

### 호스트 진입점 전체 (15개)

페이로드를 전달하는 것 (`evalScriptWithPayload`):

```
applyToTimeline        updateClipAtTime        setupPreviewSequence
applyPreviewParams     capturePreviewFrame     seekToClip
previewParamsOnFirstClip  saveTextFile         saveTextFileWithDialog
```

인자 없이 호출되는 것 (`evalScript` 직접):

```
getMogrtFolderTree     getMogrtScanDirs        getActiveSequenceInfo
getPreviewClipParams   getSystemFonts          selectExportFolder
```

### 작업 내용

1. `cep.ts` region 안에 `host` 객체를 만들고 위 15개를 메서드로 노출한다. 반환값 JSON 파싱까지 어댑터가 책임진다.

```js
var host = {
	applyToTimeline: (payload) => _callWithPayload("applyToTimeline", payload),
	getSystemFonts:  ()        => _callNoArgs("getSystemFonts"),
	// ... 15개 전부
};
```

2. `_callWithPayload` / `_callNoArgs` 내부에 `try`/`catch`와 로깅을 넣는다. 호스트가 빈 문자열이나 `EvalScript error.`를 돌려주는 경우를 명시적으로 구분해 던진다.

3. 호출부를 전부 `host.*`로 치환한다. `evalScriptWithPayload(` 와 `evalScript(` 로 검색해 남은 직접 호출이 없는지 확인한다.

4. `getCS()`, `evalScript()`, `evalScriptWithPayload()`는 어댑터 내부 전용으로 남긴다. 외부에서 부르지 않는다.

### 완료 조건

- `cep.ts` region 밖에서 `evalScript` 문자열이 검색되지 않는다
- 호스트 호출 실패 시 콘솔에 함수명과 원인이 남는다
- 패널을 열어 MOGRT 목록 로드 → 파라미터 편집 → 타임라인 적용까지 기존과 동일하게 동작한다

### 주의

`hostscript.jsx`는 이 단계에서 수정하지 않는다. 어댑터는 JS 쪽에만 만든다.

---

## 2. `ui/modal.ts` region 분해

1,886줄, 함수 43개. 번들 전체의 약 40%가 이 하나에 몰려 있다. 최소 다섯 가지 책임이 섞여 있다.

| 분리 단위 | 포함 함수 | 대략 규모 |
|---|---|---|
| `dialog` | `showConfirm`, `showAlert` | 40줄 |
| `fontModal` | `_ensureFontModal`, `_renderFontModalItems`, `_openFontModal`, `_closeFontModal`, `toggleFontField` | 130줄 |
| `mogrtPicker` | `collectMogrtsFromTree`, `getMogrtsForSelectedFolder`, `renderFolderTree`, `renderFolderNode`, `loadThumbLazy`, `renderMogrtPickerCards`, `updatePickerLabel` | 180줄 |
| `previewPanel` | `buildPreviewPanel`, `_updatePreviewWindowFile`, `extractPreviewValues`, `updatePreview` | 210줄 |
| `presetModal` (잔여) | `openPresetModal`, `patchParamsFromDefinition`, `loadMogrtForModal`, `_applyMogrtParamsToModal`, `renderModalLayout`, `renderModalParams`, `buildModalParamRow`, `buildModalTextBlock`, `bindModalEvents`, `initModal` | 나머지 |

### 순서

**`dialog`부터 시작한다.** 의존성이 거의 없고 다른 모듈에서도 즉시 재사용된다. 성공하면 같은 방식으로 `fontModal` → `mogrtPicker` → `previewPanel` 순으로 진행한다.

`presetModal` 잔여분은 상호 의존이 얽혀 있으므로 앞의 넷을 떼어낸 뒤 다시 판단한다. 무리해서 쪼개지 말 것.

### 방법

번들은 단일 IIFE라 물리적 파일 분리가 불가능하다. **새 `//#region` 블록을 만들어 함수를 옮기는 방식으로 진행한다.** 예:

```js
//#region src/ui/dialog.ts
function showConfirm(message, onYes, onNo) { ... }
function showAlert(message, onOk) { ... }
//#endregion
```

region 순서는 의존 순서를 따른다. 새 region은 `ui/modal.ts` **앞에** 배치한다.

### 완료 조건

- 각 region이 단일 책임을 갖는다
- `ui/modal.ts` region이 800줄 이하로 줄어든다
- 프리셋 모달 열기 → MOGRT 선택 → 폰트 변경 → 프리뷰 갱신 → 저장 전 과정이 동작한다

---

## 3. `innerHTML` 정리

### 정확한 현황 (초기 조사 수정됨)

전수 조사 결과 **자막 텍스트는 `innerHTML`을 거치지 않는다.** `subtitleList.ts`의 렌더링은 `textContent`를 쓰고 있어 안전하다(`textEl.textContent = sub.text`). 초기 진단에서 자막 이스케이프 문제를 지목했으나 사실이 아니었다.

`innerHTML` 사용은 총 34곳이고 대부분 `= ""` (비우기)로 무해하다. 변수를 보간하는 곳은 아래 6곳뿐이다.

| 위치 (region) | 보간 값 | 출처 | 위험도 |
|---|---|---|---|
| `ui/modal` 폴더 노드 렌더 | `node.name` | 파일시스템 폴더명 | **실질적** |
| `ui/modal` 루트 폴더 렌더 | `rootDirectCount` | 정수 | 없음 |
| `ui/modal` 파라미터 로드 실패 | `res` | 호스트 응답 문자열 | 낮음 |
| `ui/modal` 파싱 오류 | `ex.message` | 예외 메시지 | 낮음 |
| `main` 수동저장 헤더 | `manualList.length` | 정수 | 없음 |
| `main` 자동저장 헤더 | `autoList.length` | 정수 | 없음 |

### 작업 내용

우선순위는 **폴더명 하나**다. MOGRT 폴더 이름에 `&`나 `<`가 들어가면 트리 렌더가 깨진다. `A & B` 같은 폴더명은 충분히 있을 수 있다.

1. `escapeHtml` 헬퍼를 만든다. 현재 코드베이스에 존재하지 않는다. `colorUtils.ts`와 같은 층위에 유틸 region을 만들거나 기존 유틸에 추가한다.
2. 폴더명 보간 지점에 적용한다.
3. 호스트 응답·예외 메시지 두 곳에도 적용한다. 값 자체는 내부 출처지만 방어 비용이 낮다.
4. 정수 보간 세 곳은 그대로 둔다. 불필요한 변경이다.

### 완료 조건

- 이름에 `&`, `<`, `>`가 포함된 폴더를 MOGRT 스캔 경로에 만들어두고, 트리에 그대로 표시되는지 확인

---

## 4. 전역 `state` 객체 접근 정리

### 현황

`state.ts` region에 13개 필드를 가진 단일 객체가 있고, 모든 region이 직접 읽고 쓴다.

```js
var state = {
	subtitles: [], trashBin: [], mogrtList: [], presets: {},
	presetTrash: [], rowStates: {}, mogrtOriginals: {},
	nextId: 1, nextPresetId: 1, currentProjectKey: "default",
	currentSequenceKey: "default_seq", currentSequenceId: "",
	presetViewMode: "list"
};
var _cachedSystemFonts = null;
```

값이 언제 왜 바뀌었는지 추적할 수단이 없어, 버그가 나면 원인 지점을 찾기 어렵다.

### 작업 범위 — 전면 개편하지 말 것

현재 규모에서 상태 관리 라이브러리나 전면적인 옵저버 패턴 도입은 비용 대비 효과가 나쁘다. **저장 트리거가 걸린 두 필드만** setter를 경유하도록 바꾼다.

- `state.subtitles`
- `state.presets`

이 둘은 변경 시 `storage.ts` region의 파일 저장이 따라붙어야 하는 값이다. setter로 모으면 저장 누락과 중복 저장을 한 곳에서 통제할 수 있다.

나머지 11개 필드와 `_cachedSystemFonts`는 건드리지 않는다.

### 완료 조건

- 두 필드에 대한 직접 대입이 setter 외에 남아 있지 않다
- 자막 로드 → 편집 → 패널 재시작 시 복원이 기존과 동일하게 동작한다

---

## 5. 죽은 파일 제거

`extension/html/js/srtParser.js` (2,198 bytes)는 **`index.html`에서 참조되지 않는다.** 로드조차 되지 않는 사본이다. 파서 실체는 번들 안 `srtParser.ts` region에 있다.

이 파일을 고치고 "왜 반영이 안 되지" 하며 시간을 쓸 위험이 있으므로 삭제한다.

```
git rm extension/html/js/srtParser.js
```

`index.html`의 `<script>` 태그는 `jszip.min.js`만 참조하고 있으므로 HTML은 수정할 필요가 없다. 삭제 후 패널이 정상 동작하는지 한 번 확인한다.

---

## 6. 하지 않을 일

명시적으로 범위 밖이다. 착수하지 말 것.

- **TypeScript 프로젝트 복원** — `.ts` 원본이 없어 타입을 새로 작성해야 하는데, UXP 전환 시 호스트 API 타입이 통째로 바뀐다. 그때 함께 하는 편이 낫다.
- **UXP 포팅** — §0.2 참조. 핵심 API가 막혀 있다.
- **`hostscript.jsx` 리팩토링** — 2,654줄이지만 UXP 전환 시 전면 재작성 대상이다. 지금 투자할 이유가 없다. 버그 수정은 예외.
- **`src/` 동기화** — 번들을 고친 뒤 `src/`를 다시 생성하지 않는다. 구조 파악용 스냅샷으로 남긴다. 혼동을 막기 위해 작업 완료 후 `RECOVERY_NOTES.md`에 그 취지를 한 줄 추가한다.
- **번들 ID 변경** — 이미 `com.raonolje.mogrtimporter`로 완료됨.

---

## 7. 권장 진행 순서

```
1. §5 죽은 파일 제거          (5분,  위험 없음)
2. §1 호스트 어댑터           (반나절, 효과 가장 큼)
3. §3 innerHTML 폴더명        (30분, 실제 버그)
4. §2 dialog 분리             (30분, 분해 착수)
5. §2 fontModal → mogrtPicker → previewPanel
6. §4 state setter            (선택)
```

각 항목 완료 시 커밋한다. §2는 단위별로 나눠 커밋한다.

---

## 8. 이후 확인 사항

UXP의 MOGRT 파라미터 지원은 §0.2 포럼 스레드에 진행 상황이 올라온다. Adobe가 Premiere 베타에 기능이 들어가면 그곳에 공지하겠다고 밝혔다. 분기에 한 번 확인하면 시점을 놓치지 않는다.

지원이 열리면 §1에서 만든 어댑터의 구현부만 교체하는 것으로 포팅의 상당 부분이 해결되도록 설계되어 있다.
