# MOGRT_Importer

Premiere Pro에서 SRT 자막을 불러와 각 자막에 MOGRT를 적용하고 타임라인에 자동 배치하는 CEP 확장 패널.

- **패키지 버전** 1.4.0 (`hostscript.jsx` 내부 v27 + v28 `MI_` 구역). Windows 설치본과 macOS 실험용 ZIP을 제공한다. 실제 검증 범위는 [MCP_VALIDATION.md](docs/MCP_VALIDATION.md)를 참고한다. Intel Mac 실측과 남은 범위는 [MAC_VALIDATION.md](docs/MAC_VALIDATION.md)에 있다.
- **대상** Premiere Pro 14.0 ~ (실측 26.5.1) / CEP 11.0
- **번들 ID** `com.raonolje.mogrtimporter`

현재 Windows 작업 저장소는 `D:\01_ClaudeAI\02_MOGRT_Importer`이며, 설치 파일은 그 아래 `releases\1.4.0`에 있다. 구버전 1.1.6 설치 파일은 현재 트리에서 제거했고 필요한 과거 자료는 Git 이력으로 확인한다.

## 구성

| 경로 | 내용 |
|---|---|
| `extension/` | 설치하면 그대로 동작하는 CEP 확장 본체 (`html/js/app.js`가 패널의 유일한 소스) |
| `docs/` | 작업 지시서(`MULTISPEAKER_PLAN.md`), Premiere 실측(`spike_s0*.md`), 테스트 절차(`TESTING.md`) |
| `tests/` | node 단위 테스트(`npm test`)와 Premiere 하드 테스트(`npm run hard`, DEV 패널) |
| `tools/` | DEV 설치(`install_dev.sh`), 캐시를 지키는 운영 배포(`deploy_prod.sh`) |
| `packaging/` | 캐시를 보존하는 Windows/macOS 설치기 소스 |
| `releases/1.4.0/` | 최신 설치 EXE, ZIP, SHA-256 및 소스 커밋 기록 |
| `src/` | `app.js` 번들을 region 단위로 잘라낸 옛 분리본 (**동기화하지 않음, 참고용**) |
| `RECOVERY_NOTES.md` | 복구 경위, 복구된 범위, 구조 메모 |

## 변경 내역

### 1.4.0 (2026-09) — AI 적용 요청 · SRT 가져오기 · 작업 상태

- **AI 타임라인 적용 요청**: `request_apply`로 화자가 지정된 목록의 변경분 또는 지정한 줄을 요청하면 패널에 승인 카드가 뜬다. 승인 후 필요한 적용 전 점검을 거치며, 기존 충돌·수동 수정 보호와 [중지]를 그대로 사용한다. 화자 없는 기존 목록은 패널의 일반 ▶를 사용하거나 가져오기 창에서 C1 등 화자를 지정한다.
- **AI SRT 가져오기**: `import_srt`에 로컬 SRT 경로를 보내면 승인 카드와 가져오기 창으로 이어진다. 파일을 받았다는 이유만으로 기존 목록을 교체하지 않는다.
- **작업 상태**: `wait_job`으로 승인 대기·입력 대기·실행·완료·실패·거절·취소·만료를 확인한다. MCP 연결이 다시 열려도 같은 작업 ID로 조회한다.
- **연결 안내**: MCP 서버 0.2.0, 도구 14개. 설정과 검증 범위는 `mcp/README.md`, `docs/MCP_VALIDATION.md`를 참고한다.

### 1.3.0 (2026-09) — 화자별 화면 위치 · AI 연결 준비

- **화자별 위치**: 화자 표의 위치 칸에서 변경 안 함(기본) · 원래 자리 · 왼쪽 · 오른쪽 · 위 · 직접 입력(0~1). MOGRT 자기 배치 기준의 Motion Position이다. 위치에 키프레임이 있는 클립은 바꾸지 않고 알려 준다.
- **동시 발화 쌓기(기본 켬)**: 여러 화자가 동시에 보이면 화자 순서대로 한 줄씩 위로 쌓는다. 화자 표 위 체크로 끌 수 있다.
- **위치만 다시 적용**: 화자 ⋯ 메뉴. 속성·텍스트는 건드리지 않고 위치만 보낸다. 마지막 적용 되돌리기로 이전 위치로 돌아간다.
- **AI 연결 허용(기본 꺼짐)**: 켜면 전용 MCP 서버(`mcp/`, Codex·Claude)가 패널을 읽고 제안을 넣을 수 있다. 제안·화자 표 변경은 승인하기 전에는 반영되지 않는다.

### 1.2.0 (2026-09) — 여러 화자

다화자 작업 2·3단계. 사용법은 `extension/README.md` '3. 여러 화자 자막'.

- **여러 SRT 가져오기**: 캡션 트랙마다 내보낸 `C1.srt`, `인터뷰_C2.srt`를 한 번에 열면 캡션 트랙 번호로 화자를 나눈다. 'SRT 가져오기' 창에서 화자 이름·기본 프리셋을 정한다. 단일 화자(C번호 없는 파일 하나)는 예전과 같다.
- **화자별 트랙 배치**: 첫 화자는 기본 트랙, 다음 화자는 그 위 빈 트랙(없으면 새로 만듦). 동시에 말해도 자막이 잘리지 않는다. 적용 전 점검 창, 진행률·[중지], 20초 경고.
- **우리 클립 알아보기**: 클립 이름 끝의 태그 `[MI:…]`로 우리 클립을 찾아 다시 적용해도 중복·밀림이 없다. 바뀐 속성만 보낸다.
- **Premiere에서 고친 클립**은 기본으로 건너뛴다. 지운 클립은 다시 놓는다. 효과·키프레임이 있는 클립은 다시 놓지 않는다.
- **마지막 적용 되돌리기**: 히스토리 맨 위 항목으로 타임라인만 되돌린다. 적용 뒤에 고친 클립은 건드리지 않는다.
- **검수**: 타임라인을 읽기만 해서 빠진·옮겨진·중복·고친 클립을 보여 준다.
- **화자 표**: 화자별 이름·트랙·기본 프리셋, 화자 칩 필터, SRT가 바뀌면 알림과 ⟳ 다시 가져오기.
- **AI 준비**: 명령 인터페이스(runCommand), AI 제안 대기열(승인 전에는 쓰지 않음). MCP 서버는 다음 단계.
- 색상 속성을 정확히 되돌리도록(getColorValue/setColorValue) 호스트 읽기·쓰기 보완.

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

다른 사용자에게는 [최신 설치 파일](releases/1.4.0/)을 전달한다. **`installer_v1.1.6.exe`로 최신 기능을 설치할 수 없다.**

1. Premiere 프로젝트를 저장하고 Premiere를 완전히 종료한다.
2. Windows: `MOGRTImporter_v1.4.0_Windows.exe`를 본인 계정에서 실행한다. ZIP 수동 설치 방법은 ZIP 안의 `README_WINDOWS.md`에 있다.
3. macOS: `MOGRTImporter_v1.4.0_macOS_experimental.zip` 전체를 압축 해제하고 `README_MACOS.md`를 읽은 뒤 `Installer.command`를 실행한다. **Intel Mac / Premiere 26.3.0에서 설치와 핵심 기능을 검증했다. 서명·공증된 `.pkg`가 아니며 Apple Silicon은 미검증이다.** [Mac 검증 기록](docs/MAC_VALIDATION.md)에서 빌드별 범위를 확인한다.
4. Premiere를 다시 실행하고 `Window > Extensions (Legacy) > MOGRT Subtitle Importer`를 연다. 메뉴 명칭은 버전에 따라 다를 수 있다.

설치본은 현재 사용자 CEP 폴더에 설치되며, 기존 코드와 `cache`를 확장 폴더 밖에 백업한다. 설치 후 파일 해시와 캐시 보존 여부를 확인한다. 미서명 CEP 허용 설정이 필요한 경우 설치 화면에서 설명하고 선택을 받는다. 설치 폴더 전체를 삭제하지 않는다.

MOGRT 파일·폰트·개인 프리셋은 포함하지 않는다. CEP 패널 설치에는 Node.js가 필요 없지만, AI 연결은 [MCP 설정](mcp/README.md)을 별도로 해야 한다. Mac에서 개발·검증을 이어가는 방법은 [MAC_HANDOFF.md](docs/MAC_HANDOFF.md)를 참고한다.

사용 절차는 `extension/README.md` 참고.

## 개발

- `extension/html/js/app.js`를 직접 편집한다(빌드 없음). `hostscript.jsx`는 ES3이며, 새 호스트 코드는 `MI_` 접두사 구역에만 넣는다.
- `npm test` — node 단위 테스트(순수 로직 region을 잘라 vm에서 실행). `npm run lint:jsx` — MI 구역 ES3 검사.
- `tools/install_dev.sh` — 운영본과 함께 뜨는 DEV 사본(메뉴 '(DEV)', 포트 7778, `MID_` 접두사). JSX를 바꾸면 Premiere 재시작.
- `npm run hard` — DEV 패널에 CDP로 붙어 Premiere 하드 테스트(`MI_test.prproj`의 `T_` 시퀀스에서만). 자세한 절차는 `docs/TESTING.md`.
- 배포물 생성: 소스 변경을 커밋한 뒤 `node tools/build_release.js --out dist/release-1.4.0`. Windows EXE 빌드에는 NSIS가 필요하다. Mac 등에서는 `--zip-only`로 ZIP을 생성한다. 빌드에는 커밋된 파일만 들어가고 `release.json`에 소스 커밋이 기록된다. 생성된 설치 파일을 커밋한 저장소 HEAD와 이 소스 커밋은 다를 수 있다.

## 아키텍처 요약

패널(JS) ↔ 호스트(JSX) 통신은 `app.js`의 `host` 어댑터(`src/cep.ts` region)로 통일.
JSON을 `encodeURIComponent`로 감싸 전달하므로 한글 자막이 ExtendScript 인코딩에서 깨지지 않는다.
패널 순수 로직(SRT 해석·병합·필드 ID·굽기 패치)은 `src/mi/core.ts` region에 있고 DOM·상태를 참조하지 않는다.
