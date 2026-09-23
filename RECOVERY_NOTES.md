# MOGRT Subtitle Importer — 소스 복구 기록

- **복구일:** 2026-08-26
- **원본:** `MOGRT_Subtitle_Importer_V1_1_6_Setup.exe` (165,827 bytes, NSIS 인스톨러)
- **버전:** 1.1.6 / `hostscript.jsx` 내부 버전 v24
- **경위:** 마누스에서 원본 소스가 삭제되어, 배포용 인스톨러에서 역추출

## 폴더 구성

```
02_MOGRT_Importer/
├── extension/          ← 설치하면 그대로 도는 CEP 확장 (인스톨러에서 나온 원본)
│   ├── .debug          디버그 포트 7777
│   ├── CSXS/manifest.xml
│   ├── html/           index.html, CSInterface.js, css/, js/
│   ├── jsx/hostscript.jsx
│   └── README.md       원 저자(마누스) 작성 설치·사용 문서
├── src/                ← app.js 번들에서 모듈 단위로 분리한 소스
├── installer_v1.1.6.exe 원본 인스톨러 보관
└── RECOVERY_NOTES.md   이 파일
```

## 복구된 것 / 안 된 것

**온전히 복구됨** — `hostscript.jsx`(2,654줄), `index.html`(1,361줄), `style.css`,
`srtParser.js`, `manifest.xml`, `README.md`. 난독화·압축이 없어 원본 그대로다.
(`html/js/srtParser.js`는 index.html이 로드하지 않는 사본이라 2026-08-27
리팩토링 §5에서 삭제했다. 파서 실체는 번들 안 `srtParser.ts` region에 있다.)

**부분 복구** — `html/js/app.js`는 TypeScript 빌드 산출물이다. 소스맵이 없어
`.ts` 원본과 타입 정의는 복구 불가. 다만 `//#region src/*.ts` 마커가 남아 있어
모듈 경계는 정확히 알 수 있고, 그 경계로 잘라낸 것이 `src/`다.

**복구 불가** — 빌드 설정(tsconfig, 번들러 설정), package.json, 커밋 이력,
타입 선언, 원본 주석 중 빌드 과정에서 제거된 것.

## `src/`를 다룰 때 주의

> **2026-08-27 추가:** REFACTORING_PLAN.md의 리팩토링은 전부 번들
> `extension/html/js/app.js`를 직접 고쳤다. `src/`는 **다시 생성하지 않았고
> 앞으로도 동기화하지 않는다.** 복구 시점의 구조 파악용 스냅샷으로만 남긴다.
> 여기를 고쳐도 Premiere에는 반영되지 않으니 주의할 것. 현재 번들의 region
> 구성은 아래 "모듈 로드 순서"가 아니라 app.js의 `//#region` 마커를 보면 된다.

`src/`의 각 파일은 **참고·수정용 분리본**이며 그대로는 빌드되지 않는다.
원래 하나의 IIFE 스코프를 공유하던 코드라 모듈 간 import/export가 없고,
서로의 최상위 변수·함수를 직접 참조한다. 되살리려면 둘 중 하나:

1. **번들 직접 수정** — `extension/html/js/app.js`를 고쳐 쓴다. 압축되어
   있지 않아 읽고 고치는 데 무리가 없다. 지금 당장 굴리기엔 이쪽이 빠르다.
2. **프로젝트 재구성** — `src/`를 기준으로 import/export를 다시 붙이고
   TypeScript 프로젝트로 복원한 뒤 번들링한다. 장기적으로는 이쪽.

모듈 로드 순서는 `state → storage → cep → srtParser → ui/tabs → colorUtils →
ui/paramEditor → ui/trash → ui/presetList → ui/modal → ui/subtitleList → main`
이었다(번들 내 배치 순서 = 의존 순서).

## 구조 메모

패널(JS) ↔ 호스트(JSX) 통신은 `src/cep.js`의 `evalScriptWithPayload()` 하나로
통일되어 있다. JSON을 `encodeURIComponent`로 감싸 넘기므로 한글 자막이
ExtendScript 인코딩에서 깨지지 않는다.

페이로드를 넘기는 호스트 진입점 9개:
`applyToTimeline`, `updateClipAtTime`, `setupPreviewSequence`, `applyPreviewParams`,
`capturePreviewFrame`, `seekToClip`, `previewParamsOnFirstClip`, `saveTextFile`,
`saveTextFileWithDialog`.

인자 없이 호출되는 것:
`getMogrtFolderTree`, `getMogrtScanDirs`, `getActiveSequenceInfo`,
`getPreviewClipParams`, `getSystemFonts`, `selectExportFolder`.

## 미처리 사항

> **2026-09-23 해결:** 번들 ID를 `com.raonolje.mogrtimporter` /
> `com.raonolje.mogrtimporter.panel`로 바꿨다(`CSXS/manifest.xml` 3곳,
> `.debug` 1곳). 아래 내용은 당시 기록으로 남긴다. REFACTORING_PLAN §6은
> 이 작업이 "이미 완료됨"이라고 적었으나 사실이 아니었다.

번들 ID가 아직 `com.manus.mogrtimporter` / `com.manus.mogrtimporter.panel`이다.
`CSXS/manifest.xml`과 `.debug` 두 파일에 들어 있고, 바꾸려면 두 곳을 함께
고쳐야 한다(Premiere가 ID로 매칭하므로 한쪽만 바꾸면 디버그 연결이 끊긴다).
기존 설치본과 ID가 갈리면 별개 확장으로 잡히니, 구버전은 지우고 올리는 게 낫다.
