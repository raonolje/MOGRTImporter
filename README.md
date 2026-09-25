# MOGRT_Importer

Premiere Pro에서 SRT 자막을 불러와 각 자막에 MOGRT를 적용하고 타임라인에 자동 배치하는 CEP 확장 패널.

- **버전** 1.1.7 (`hostscript.jsx` 내부 v27)
- **대상** Premiere Pro 14.0 ~ (실측 26.5.1) / CEP 11.0
- **번들 ID** `com.raonolje.mogrtimporter`

## 구성

| 경로 | 내용 |
|---|---|
| `extension/` | 설치하면 그대로 동작하는 CEP 확장 본체 (`html/js/app.js`가 패널의 유일한 소스) |
| `docs/` | 작업 지시서(`MULTISPEAKER_PLAN.md`), Premiere 실측(`spike_s0*.md`), 테스트 절차(`TESTING.md`) |
| `tests/` | node 단위 테스트(`npm test`)와 Premiere 하드 테스트(`npm run hard`, DEV 패널) |
| `tools/` | DEV 설치(`install_dev.sh`), 캐시를 지키는 운영 배포(`deploy_prod.sh`) |
| `src/` | `app.js` 번들을 region 단위로 잘라낸 옛 분리본 (**동기화하지 않음, 참고용**) |
| `installer_v1.1.6.exe` | 소스 복구의 출처가 된 원본 NSIS 인스톨러 (**업그레이드·롤백에 쓰지 않는다**) |
| `RECOVERY_NOTES.md` | 복구 경위, 복구된 범위, 구조 메모 |

## 변경 내역

### 1.1.7 (2026-09)

다화자 작업(`docs/MULTISPEAKER_PLAN.md`) 1단계. 여러 SRT 가져오기·화자 표는 들어 있지만 2단계(화자별 트랙 배치)가 끝날 때까지 꺼져 있다.

- **안전하게 적용**: SRT를 다시 가져와 병합한 뒤 ▶를 누르면 바뀐 줄만 한 줄씩 고친다. 전체 재적용은 줄 1~3%를 놓치고 다음 자막 머리를 잘랐다(실측).
- **다시 가져오기 병합**: 캡션을 고친 SRT를 다시 열면 [병합]으로 문장·시간만 바꾸고 포인트 텍스트 등 후반 작업은 지킨다. 포인트 단어가 새 문장에 없으면 경고.
- **필드 번호 T1·T2…**: 프리셋 창과 줄 속성창에 텍스트 필드 번호. 누르면 `#12 T2` 주소를 복사한다(AI 요청용).
- **안전 지점**: SRT 가져오기·히스토리 복원·작업 불러오기·프리셋 저장·프리셋 가져오기 직전 상태를 따로 보관(자동저장이 밀어내지 않음).
- **Premiere에서 만든 MOGRT**: 텍스트가 빈 글자로 나오던 문제 수정(템플릿 사본에 문구를 구워 배치). 손대지 않은 필드는 템플릿 기본 문구 유지.
- **옛 구조 클립**: MOGRT를 다시 저장해 속성 구조가 바뀐 경우, 기존 클립에는 속성 이름으로 써서 캡션이 엉뚱한 필드에 들어가지 않는다.
- **프리셋**: 프리셋을 다시 저장해도 줄마다 넣은 후반 작업 값이 남는다. 프리셋 id 재사용·가져오기 때 다른 MOGRT를 가리키던 문제 수정.
- **시퀀스**: 시퀀스마다 목록이 따로 저장된다(다른 시퀀스·프로젝트 목록이 따라오던 문제 수정). 시퀀스를 열기 전에는 SRT를 열 수 없다.
- **프리셋 창**: 프리셋을 만들거나 고칠 때 Premiere의 작업 시퀀스가 프리뷰나 첫 시퀀스로 바뀌던 문제 수정. 프리뷰 시퀀스가 없을 때 V1 0~5초 영상이 잘리던 문제 수정.

## 설치

1. `extension/` 폴더를 `CEP_MogrtImporter` 이름으로 복사해 아래 경로에 배치
   - Windows: `%APPDATA%\Adobe\CEP\extensions\` (현재 운영 위치) 또는 `C:\Program Files (x86)\Common Files\Adobe\CEP\extensions\`
   - macOS: `/Library/Application Support/Adobe/CEP/extensions/`
2. 서명되지 않은 확장 허용 (디버그 모드)
   - Windows: `HKEY_CURRENT_USER\Software\Adobe\CSXS.11` 에 문자열 값 `PlayerDebugMode` = `1`
   - macOS: `defaults write com.adobe.CSXS.11 PlayerDebugMode 1`
3. Premiere Pro 재시작 → `Window > Extensions > MOGRT Subtitle Importer`

**주의**: 사용자 프리셋·세션 캐시는 설치 폴더 안(`CEP_MogrtImporter/cache`)에 있다. 폴더를 지우고 새로 깔면 캐시가 사라진다. 업데이트는 `tools/deploy_prod.sh`(Premiere 종료 상태, 캐시를 extensions 밖에 백업, 지우지 않고 덮어쓰기, `--rollback <ref>`)로 한다.

사용 절차는 `extension/README.md` 참고.

## 개발

- `extension/html/js/app.js`를 직접 편집한다(빌드 없음). `hostscript.jsx`는 ES3이며, 새 호스트 코드는 `MI_` 접두사 구역에만 넣는다.
- `npm test` — node 단위 테스트(순수 로직 region을 잘라 vm에서 실행). `npm run lint:jsx` — MI 구역 ES3 검사.
- `tools/install_dev.sh` — 운영본과 함께 뜨는 DEV 사본(메뉴 '(DEV)', 포트 7778, `MID_` 접두사). JSX를 바꾸면 Premiere 재시작.
- `npm run hard` — DEV 패널에 CDP로 붙어 Premiere 하드 테스트(`MI_test.prproj`의 `T_` 시퀀스에서만). 자세한 절차는 `docs/TESTING.md`.

## 아키텍처 요약

패널(JS) ↔ 호스트(JSX) 통신은 `app.js`의 `host` 어댑터(`src/cep.ts` region)로 통일.
JSON을 `encodeURIComponent`로 감싸 전달하므로 한글 자막이 ExtendScript 인코딩에서 깨지지 않는다.
패널 순수 로직(SRT 해석·병합·필드 ID·굽기 패치)은 `src/mi/core.ts` region에 있고 DOM·상태를 참조하지 않는다.
