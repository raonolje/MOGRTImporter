# Mac 실기 검증 기록

2026-09-28, Intel x86_64 / macOS 15.7.7 (24G720), Premiere Pro 2026 26.3.0.
실제 CEP 로그와 앱 내부 CEPHtmlEngine Info.plist의 버전은 12.0.1.2다.
Node.js 24.15.0과 Codex 번들 Git을 사용했다. 시스템 Git은 Command Line Tools가 없어
실행되지 않아 번들 Git을 PATH 앞에 두었다.

## 판정과 범위

Intel Mac에서 설치, 실제 Premiere 패널 로딩, 한글 경로 파일 처리, MOGRT 적용,
프리뷰, 세션 복원, MCP SDK 왕복과 좁은 화면 검사를 통과했다.
Apple Silicon, 다른 Premiere 버전, 전체 하드 테스트 모음, 실제 AI 모델 클라이언트는
이번 검증 범위에 포함하지 않았다. MCP SDK 결과를 실제 Codex/Claude 모델 검증으로 세지 않는다.
배포물은 서명·공증된 PKG가 아닌 실험용 ZIP이다.

기능 실측 빌드는 운영 `prod-20f9e5e`, DEV `dev-20f9e5e-mac`이다.
소스는 `20f9e5e320b589e80893c7fad769bb0aaff04fdd`이며 이후 변경은 맥 설치기와 문서,
배포 메타데이터에 한정된다. 최종 ZIP 안의 `release.json`이 배포 소스·빌드의 기준이다.

## 실제 설치와 구형 설치 처리

- 최초 상태: 시스템 CEP 폴더의 구형 1.0.0과 사용자 CEP 폴더의 1.1.6이 중복 설치됨.
  두 설치본은 `com.manus.mogrtimporter` ID를 사용했다.
- 최초 설치기는 시스템 설치본을 감지하고 변경 전에 안전하게 중단했다.
- 관리자 인증 후 시스템 설치본을 삭제 없이
  `/Library/Application Support/MogrtImporter/legacy-backups-20260928/CEP_MogrtImporter`
  로 옮겼다. 설치기는 시스템 설치본을 자동 이동하지 않는다.
- 구형 ID를 사용자 업그레이드 및 중복 감지 대상으로 추가했다.
  배포물 자체는 현재 `com.raonolje.mogrtimporter` ID만 허용한다.
- `prod-20f9e5e`의 배포물 체크섬 12개와 설치 후 코드 SHA-256 검사가 통과했다.
  사용자 기존 설치본 백업은
  `~/Library/Application Support/MogrtImporter/installer-backups/20260928-162227-4679/code`다.
  이 최초 설치 전에는 cache가 없었으므로 최초 실행을 실데이터 cache 보존 검사로 세지 않는다.
- CSXS.11/12 PlayerDebugMode가 이미 1이어서 최초 설치는 설정을 바꾸지 않았다.
  설치기를 실제 앱의 CEP 11/12를 감지하고 선택한 런타임만 설명·백업·설정하도록 보완했다.
  manifest의 CSXS 11은 최소 요구 버전이며 실제 Premiere 26.3 런타임은 CEP 12다.
- Gatekeeper, quarantine, 전역 AI 클라이언트 설정은 바꾸지 않았다.

## 실제 Premiere·CEP 결과

별도 `MI_test.prproj`와 빈 `T_23976`(1920×1080, 23.976fps)을 생성했다.
쓰기는 DEV 패널과 `T_scratch_` 사본에서만 수행했고 각 테스트 종료 후 사본을 정리했다.
운영 runner의 파일 제한이나 프로젝트 가드를 완화하지 않았다.

| 항목 | 실측 결과 |
|---|---|
| 메뉴·화면 | 운영 및 DEV 메뉴 노출과 실제 패널 로딩 확인, MOGRT 78개 탐색 |
| 빌드 검사 | 운영 설치·JSX·패널 모두 `prod-20f9e5e`, DEV 모두 `dev-20f9e5e-mac` 일치 |
| 운영 스모크 | 디버그 훅 및 실제 활성 시퀀스 읽기 2개 통과 |
| 한글·공백 MOGRT | Mac의 분해형 한글 파일명과 공백 경로에서 AE MOGRT 속성 읽기·프리셋 저장 통과 |
| SRT·한 줄 적용 | 한글 폴더·파일명에서 SRT를 읽고 한 줄 적용, 실제 호스트 텍스트·트랙·시간 검수 |
| 프리셋 JSON | 실제 CEP 파일 쓰기로 선택한 한글 폴더 안에 저장됨, 저장 JSON 재읽기 확인 |
| 세션 | 실제 CEP 새로고침 후 자막과 적용 기록이 저장 전과 동일 |
| 프리뷰 | 1920×1080 캡처, Mac 임시 폴더 사용, 모달 종료 뒤 원래 시퀀스 복원 |
| 화면 | 실제 DEV 초기 viewport 760×720. CEF viewport 480×520·760×720에서 두 화자·두 줄, 상단·적용·상태 바와 히스토리/필터 팝업의 잘림·가로 넘침 없음 |

화면 크기 변경 검사는 실제 Mac CEP의 CEF viewport를 조절한 결과다.
네이티브 창 크기와 viewport를 혼동하지 않으며 검사 뒤 viewport override를 해제했다.

## 실제 MCP 서버와 패널 왕복

`s5_mcp.case.js`와 `s5_jobs.case.js`를 실제 DEV 패널에 실행했다.

- `get_status`의 설치 core 해시 `cca6bb21` 일치. 실제 bridge_dev를 통해
  프리셋·26행 조회, 행 검색, 적용 계획·검수 읽기, 제안 20개와 낡은 서명 거부,
  화자 표 제안 승인/거절이 통과했다.
- 가져오기 요청 거절·창 취소·확정, 적용 거절·점검 취소·확정이 각각 기대 상태로 종료됐다.
- 실제 MOGRT 4개가 V3/V4에 배치되고, 누락·중복 없이 시작·종료가 ±1프레임 이내였다.
  `wait_job` 성공 후 재조회는 호스트에 쓰지 않았다.
- 두 케이스는 각각 약 8.9초, 10.5초에 통과했다. 스크래치와 임시 SRT를 정리하고
  원래 시퀀스와 AI 연결 off를 복원했다. DEV 완료 작업 기록은 유지했다.

## 자동 검사와 근거

- 전체 단위/호환 검사: 668개 중 **650 통과, 18 건너뜀, 0 실패**.
  운영 캐시가 지정되지 않은 호환 검사와 Windows 전용 검사는 통과로 세지 않는다.
- MCP 자동 검사: **14 통과, 0 실패**. 위 실제 Premiere 왕복과 별도다.
- JSX ES3 lint: **위반 0건**.
- Mac 추가 회귀 검사 2개: 구형/현재/다른 확장 ID 구분과 CEP 엔진 버전 판별.

로컬 근거는 `work/mac-validation/`의 `unit-final.log`, `mcp.log`, `lint.log`,
`preset.log`, `live-mcp.log`, `mac-flow.log`, `layout.log`, `layout-metrics.json`이다.
사용자 MOGRT, 프리셋 원문, 프로젝트, 화면 캡처는 공개 저장소에 넣지 않는다.

초기 System Events 시간 초과 및 접근성/화면 권한 문제는 사용자 허용 후 해결했다.
System Events 좌표 클릭은 계속 거부되어 권한 검사를 통과한 macOS 직접 API로 조작했다.
이 환경 문제를 패널 기능 실패로 분류하지 않는다.

Windows PC의 실제 D 드라이브 checkout에는 접근하지 않았다. 원격 동기화와 별도로
Windows 로컬 갱신은 해당 PC에서 정상 fetch/pull이 필요하다.
