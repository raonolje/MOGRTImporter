# MCP 검증 기록

2026-09-28 기준. 대상은 확장 v1.4.0 / MCP 서버 v0.2.0 개발 작업 트리다. **M5.4 구현과 자동 테스트는 완료됐고, 실제 Premiere 하드 테스트와 M5.5의 클라이언트 전체 흐름 검증은 환경 문제로 보류 중이다. 운영 배포와 릴리스는 하지 않았다.**

## 실행한 검사

| 검사 | 결과 | 확인한 범위 |
|---|---|---|
| `npm test` | 650개 중 640 통과, 10 건너뜀, 실패 0 | 순수 로직, 패널 VM, Premiere 시뮬레이터, 기본 호환 검사 |
| `MI_REAL_CACHE`를 지정한 캐시 호환 검사 | 12/12 통과 | 운영 캐시를 읽고 메모리 하네스에서 확인. 앞 실행과 겹치는 검사 2개 포함 |
| `npm run test:mcp` | 14/14 통과 | 실제 MCP 서버·SDK stdio 클라이언트·파일 다리·패널 VM 통합 |
| `npm run lint:jsx` | MI 구역 1,940줄, 오류 0 | ExtendScript ES3 정적 검사 |
| 실제 Claude Code 2.1.276 | 초기 연결 통과 | 격리된 설정에서 `claude mcp get mogrt_importer`와 `claude mcp list`가 `Connected` 반환 |

중복을 제외하면 **고유 자동 검사 664개가 통과**했다: `640 + (12 - 2) + 14`. 기본 실행에서 건너뛴 실제 캐시 검사 10개는 별도 실행으로 확인했다. Premiere 하드 테스트와 모델이 수행하는 도구 호출은 이 수에 포함하지 않는다.

`tests/unit/panel_jobs.test.js`에 추가한 9개 검사는 승인·거절·비동기 실행, 점검/가져오기 입력 대기, 시퀀스 변경, 요청 후 데이터 변경, 재시작, 저장 실패, 지원하지 않는 화자 없는 목록, 만료된 확인창, 다른 작업의 만료 영향을 확인한다.

`tests/mcp/server_jobs.test.js`는 요청과 조회를 서로 다른 SDK 연결 및 재연결에서 수행한다. 테스트의 클라이언트 이름 `codex-mcp-client`와 `Claude Desktop`은 프로토콜의 식별 문자열이다. 이 테스트 결과는 설치된 Codex 또는 Claude Desktop 앱의 실행 결과를 의미하지 않는다.

## 실제 Claude Code

- 설치 버전: 2.1.276.
- `CLAUDE_CONFIG_DIR`를 별도 임시 작업 폴더로 지정한 뒤 그 폴더에만 서버를 등록했다.
- `claude mcp get mogrt_importer`, `claude mcp list` 모두 실제 CLI에서 연결 성공을 반환했다.
- 원래 사용자 `.claude.json`의 SHA256은 실행 전후 동일했다.
- 모델에 프롬프트를 보내지 않았다. 인증·구독 상태 표시와 실제 남은 사용량은 별개이며, 이 검사로 남은 사용량을 확인한 것은 아니다.

이 결과는 Claude Code가 로컬 서버를 시작하고 MCP 초기 연결을 맺는다는 근거다. 실제 모델이 14개 도구를 찾아 호출하고, 사용자의 패널 승인 후 결과를 해석하는 전체 흐름은 아직 확인하지 않았다. 설정 격리 방법은 [Claude Code 공식 환경 변수 문서](https://code.claude.com/docs/en/env-vars)의 `CLAUDE_CONFIG_DIR`를 따른다.

## 보류 중인 실제 실행

| 항목 | 현재 결과 | 완료에 필요한 확인 |
|---|---|---|
| Premiere DEV 하드 `s5_jobs` | 미실행. 기존 `MI_test.prproj`로 두 번 시도했으나 응답 없음과 CDP `Runtime.enable` 120초 초과로 중단. 새 빈 프로젝트도 응답 없음: `Runtime.enable`은 통과했지만 `--check-build`의 `Runtime.evaluate`가 15초 초과. 모두 케이스 시작 전 중단 | Premiere가 정상 응답하는 환경에서 DEV 설치본 빌드 확인 후 스크래치 시퀀스의 승인·취소·네 클립 배치 ±1프레임 검사 |
| Claude Desktop 2.9939.2.0 | 미확인. 실제 Store 앱 설정에 DEV 서버를 임시 등록하고 세 번 실행했으나 MCP 초기화 전에 앱이 정상 종료한 로그만 남음. MCP 세션 없음 | 앱의 MCP 연결·도구 목록 확인, DEV 패널 대상으로 읽기·제안·승인 작업 실행 |
| 모델을 통한 Claude Code/Desktop 전체 흐름 | 미실행. 사용량 소진 상황을 고려해 모델 요청을 보내지 않음 | 모델 호출이 가능한 상태에서 읽기→제안→사용자 승인→작업 결과 조회 |

Premiere 연결 단계의 실패로 배치 기능의 성공·실패를 판정할 수 없다. 새 빈 프로젝트에는 `T_` 테스트 시퀀스도 만들지 못해 하드 테스트의 준비 조건을 충족하지 않았다. Desktop의 종료 로그 역시 서버의 MCP 호환 실패를 확인한 결과가 아니다. 응답이 없던 빈 프로젝트의 Premiere 프로세스는 종료했다. 새 실행 결과가 나오면 이 표를 갱신한다.

DEV 설치본은 `dev-0537703-m54`다. 설치 전후 운영 확장 전체 파일의 SHA256이 같았고 운영 캐시도 보존했다. Desktop의 임시 설정은 원본 바이트로 복원했으며 백업과 SHA256이 같음을 확인했다.

이 PC의 최신 Desktop 설정은 Store 앱 경로 `%LOCALAPPDATA%/Packages/Claude_pzs8sxrjxfjjc/LocalCache/Roaming/Claude/claude_desktop_config.json`이다. 현재 로그는 `%LOCALAPPDATA%/Claude/logs/mcp.log`에서 확인한다. `%APPDATA%/Claude/claude_desktop_config.json`에는 오래된 사본도 있으므로 파일 존재만으로 활성 설정을 판단하지 않는다.

## 지원 범위와 다음 검증

- `request_apply`는 화자 키(C1, C2 등)가 있는 줄을 지원한다. 화자 없는 기존 목록은 `unsupported-rows`로 거절하고 패널의 ▶ 또는 화자 지정 가져오기를 안내한다.
- 요청 접수는 `pending_approval`이며, 타임라인 적용과 SRT 가져오기는 사용자의 승인·점검을 기다린다. 도구 호출 성공과 작업의 `succeeded` 상태를 따로 확인한다.
- 작업은 패널이 보관한다. 서버 재연결 후 같은 `job_id`로 조회하며, 패널을 다시 열면 미완료 작업을 취소하고 자동으로 재실행하지 않는다.
- 완료 기록을 디스크에 저장하지 못하면 현재 패널에서는 최종 상태를 조회할 수 있지만 재시작 후에는 이전 진행 기록이 `panel-reloaded` 취소로 보일 수 있다. 자동 재실행은 하지 않는다.
- 하드 케이스 준비·실행 방법은 [TESTING.md](TESTING.md#7-m54-승인-작업과-m55-클라이언트-검증), 사용법과 오류 처리는 [MCP README](../mcp/README.md)를 따른다.

M5.5 완료 표시는 실제 Claude Code와 Desktop에서 필요한 시나리오를 실행한 뒤에만 한다. SDK 통합 테스트나 연결 성공만으로 완료 처리하지 않는다.
