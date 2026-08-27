# MOGRT_Importer

Premiere Pro에서 SRT 자막을 불러와 각 자막에 MOGRT를 적용하고 타임라인에 자동 배치하는 CEP 확장 패널.

- **버전** 1.1.6 (`hostscript.jsx` 내부 v24)
- **대상** Premiere Pro 14.0 ~ / CEP 11.0
- **번들 ID** `com.manus.mogrtimporter`

## 구성

| 경로 | 내용 |
|---|---|
| `extension/` | 설치하면 그대로 동작하는 CEP 확장 본체 |
| `src/` | `app.js` 번들에서 모듈 단위로 분리한 소스 (참고·수정용) |
| `installer_v1.1.6.exe` | 소스 복구의 출처가 된 원본 NSIS 인스톨러 |
| `RECOVERY_NOTES.md` | 복구 경위, 복구된 범위, 구조 메모 |

## 설치

1. `extension/` 폴더를 `CEP_MogrtImporter` 이름으로 복사해 아래 경로에 배치
   - Windows: `C:\Program Files (x86)\Common Files\Adobe\CEP\extensions\`
   - macOS: `/Library/Application Support/Adobe/CEP/extensions/`
2. 서명되지 않은 확장 허용 (디버그 모드)
   - Windows: `HKEY_CURRENT_USER\Software\Adobe\CSXS.11` 에 문자열 값 `PlayerDebugMode` = `1`
   - macOS: `defaults write com.adobe.CSXS.11 PlayerDebugMode 1`
3. Premiere Pro 재시작 → `Window > Extensions > MOGRT Subtitle Importer`

사용 절차는 `extension/README.md` 참고.

## 개발 시 주의

`extension/html/js/app.js`는 TypeScript 빌드 산출물이며 소스맵이 없다.
`src/`는 번들의 `//#region src/*.ts` 경계로 잘라낸 분리본이라 **그대로는 빌드되지 않는다**
(원래 하나의 IIFE 스코프를 공유하던 코드라 import/export가 없음).

- 즉시 수정이 필요하면 → `extension/html/js/app.js`를 직접 편집 (압축·난독화 없음)
- 제대로 복원하려면 → `src/`에 의존관계를 다시 붙여 TS 프로젝트로 재구성 후 번들링

자세한 내용과 모듈 로드 순서는 `RECOVERY_NOTES.md`.

## 아키텍처 요약

패널(JS) ↔ 호스트(JSX) 통신은 `src/cep.js`의 `evalScriptWithPayload()` 하나로 통일.
JSON을 `encodeURIComponent`로 감싸 전달하므로 한글 자막이 ExtendScript 인코딩에서 깨지지 않는다.

호스트 진입점(페이로드 전달): `applyToTimeline`, `updateClipAtTime`, `setupPreviewSequence`,
`applyPreviewParams`, `capturePreviewFrame`, `seekToClip`, `previewParamsOnFirstClip`,
`saveTextFile`, `saveTextFileWithDialog`

호스트 진입점(인자 없음): `getMogrtFolderTree`, `getMogrtScanDirs`, `getActiveSequenceInfo`,
`getPreviewClipParams`, `getSystemFonts`, `selectExportFolder`
