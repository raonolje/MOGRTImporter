# MCP 검증 기록

2026-09-28 기준. 대상은 확장 v1.4.0 / MCP 서버 v0.2.0 개발 작업 트리다. **M5.4 구현·자동 검사·실제 Premiere 하드 테스트와 실제 Codex 모델의 읽기→제안→패널 승인→적용→검수 흐름이 통과했다. 원래 M5.5의 Claude 검증은 부분 완료 상태다. Desktop은 패널 조회에서 막혔고 Code는 조직 정책으로 모델 호출이 차단됐다. 패널 창 크기와 좁은 폭의 도구 배치도 수정·검증했다. 운영 배포와 릴리스는 하지 않았다.**

## 실행한 검사

| 검사 | 결과 | 확인한 범위 |
|---|---|---|
| `npm test` | 654개 중 644 통과, 10 건너뜀, 실패 0 | 순수 로직, 패널 VM, Premiere 시뮬레이터, 기본 호환 검사. 최종 보완 후 D드라이브 복원본에서 재실행 |
| `MI_REAL_CACHE`를 지정한 캐시 호환 검사 | 12/12 통과 | 운영 캐시를 읽고 메모리 하네스에서 확인. 앞 실행과 겹치는 검사 2개 포함 |
| `npm run test:mcp` | 14/14 통과 | 실제 MCP 서버·SDK stdio 클라이언트·파일 다리·패널 VM 통합 |
| `npm run lint:jsx` | MI 구역 1,940줄, 오류 0 | ExtendScript ES3 정적 검사 |
| 실제 Claude Code 2.1.276 | 초기 연결 통과, 모델 검증 차단 | 격리된 `mcp get/list` 및 실제 모델 요청의 MCP 초기 연결 성공. 모델 요청 2회 모두 도구 호출 전 중단, 진단에서 `oauth_org_not_allowed` 확인 |
| 실제 Premiere Pro 2026 | DEV 빌드 확인 및 `s5_inbox`·`s5_mcp`·`s5_jobs` 통과 | 각 실행 2/2: 공통 스모크와 해당 케이스. 고유 케이스는 본 검사 3개와 스모크 1개 |
| 실제 Claude Desktop 2.9939.2.0 | 실행·MCP 초기 연결·도구 목록·모델 `get_guide` 호출 통과 | 설치된 앱에서 서버 안내문 응답 확인. 패널이 필요한 `get_status`는 `ai-link-off`·`no-heartbeat`로 실패 |
| 실제 Codex CLI 0.155.0-alpha.16 / `gpt-6-astra` | 읽기·제안·승인 적용·검수 통과 | 최종 3단계의 MCP 호출 14회, 서로 다른 도구 10개. 실제 패널 승인과 Premiere MOGRT 속성 확인 |
| 패널 UI | 기존 패널 검사 29개 재실행 통과, 실제 CEF 3개 폭 확인 | 480·520·760px에서 검사 대상 잘림과 가로 넘침 0. 기본 창 760×720, 최소 480×520 |

중복을 제외하면 **고유 자동 검사 668개가 통과**했다: `644 + (12 - 2) + 14`. 기본 실행에서 건너뛴 실제 캐시 검사 10개는 별도 실행으로 확인했다. Premiere 하드 테스트와 모델이 수행하는 도구 호출은 이 수에 포함하지 않는다.

`tests/unit/panel_jobs.test.js`의 11개 검사는 승인·거절·비동기 실행, 점검/가져오기 입력 대기, 시퀀스 변경, 요청 후 데이터 변경, 재시작, 요청/완료 기록 저장 실패, 지원하지 않는 화자 없는 목록, 만료된 확인창, 다른 작업의 만료 영향, 삭제 실패 보고와 재시도를 확인한다.

최종 코드 검토에서 삭제 실패가 성공으로 표시되는 문제와 MCP 코어의 해시 검사/실행 사이 파일 교체 경합을 보완했다. 삭제 실패·재시도 1개와 코어 스냅샷 2개의 회귀 검사를 추가했고, 전체 자동 검사·MCP·운영 캐시 호환·ES3 린트를 재실행했다. 아래 실앱 기록은 이 두 추가 보완 전의 결과다. 추가 보완은 시뮬레이터와 로더 검사로 확인했으며 실제 Premiere에서 새로 재현했다고 주장하지 않는다. 구조 개선 우선순위는 [REFACTORING_REVIEW.md](REFACTORING_REVIEW.md)에 기록했다.

`tests/mcp/server_jobs.test.js`는 요청과 조회를 서로 다른 SDK 연결 및 재연결에서 수행한다. 테스트의 클라이언트 이름 `codex-mcp-client`와 `Claude Desktop`은 프로토콜의 식별 문자열이다. 이 테스트 결과는 설치된 Codex 또는 Claude Desktop 앱의 실행 결과를 의미하지 않는다.

## 실제 Codex 모델 전체 흐름

Codex CLI 0.155.0-alpha.16과 `gpt-6-astra`를 실제로 실행해 DEV 패널의 합성 26행 시퀀스 `T_scratch_codex_live`를 검증했다. SDK에 붙인 이름이 아니라 실제 모델이 MCP 도구를 선택하고 결과를 읽은 실행이다.

| 단계 | MCP 호출 | 확인한 결과 |
|---|---|---|
| 읽기 | 5회: `get_guide`, `get_status`, `get_rows`, `list_presets`, `plan_apply` | 활성 시퀀스와 26행, 프리셋, 적용 계획 확인 |
| 제안 | 4회: `get_status`, `get_rows`, `suggest_fields`, `get_suggestions` | C1 첫 행의 T2에 정확히 `날씨$$하늘` 제안. 실제 패널에서 제안을 승인하고 값 재확인. 이때 타임라인 클립 0개 |
| 적용·검수 | 5회: `get_status`, `get_rows`, `request_apply`, `wait_job`, `verify_timeline` | 첫 행만 적용 요청, 실제 패널 승인 후 `succeeded`. 클립 1개 생성, 검수 정상 1개·미적용 25개·이상 항목 0 |

최종 통과한 세 단계는 총 14회 호출, 서로 다른 도구 10개다. MCP 전체 14개 도구를 모두 실모델로 검증했다는 뜻은 아니다. 별도 Premiere 조회로 V3 클립의 1~2.5초 구간을 ±1프레임 이내로 확인했고, 실제 MOGRT의 '자막 1 포인트 텍스트' 속성도 `T:날씨$$하늘`과 같았다.

처음 제안 시도에서는 검증 스크립트의 `String.replace` 치환 문자열이 `$$`를 `$`로 줄였다. 패널 승인 전에 발견해 함수 치환으로 고친 뒤 다시 실행했다. 이 시도의 4회 호출은 최종 14회에 포함하지 않으며 앱 결함으로 기록하지 않는다.

Codex 사용자 설정은 바뀌지 않았다. 읽기 전용 샌드박스에서 제안·적용 두 MCP 도구에만 필요한 승인을 사용했으며 Claude 인증이나 조직 정책을 우회하지 않았다. 검증 종료 후 스크래치 정리 결과는 `true`, 원래 시퀀스와 AI 연결 `off` 상태도 복원했다.

근거는 검증 작업 폴더의 `work/codex-retry/codex-live-summary.json`, 단계별 `*-evidence.json`·`*-events.jsonl`, `proposal-approved.json`, `apply-approved.json`, `codex-final-scan.json`, `codex-live.txt`다. **이 Codex 성공과 아래 Claude M5.5의 미완료 상태는 별개다.**

## 실제 Claude Code

- 설치 버전: 2.1.276.
- 먼저 `CLAUDE_CONFIG_DIR`를 별도 임시 작업 폴더로 지정한 뒤 그 폴더에만 서버를 등록했다. `claude mcp get mogrt_importer`, `claude mcp list` 모두 연결 성공을 반환했다. 이때는 모델을 호출하지 않았고 원래 사용자 `.claude.json`의 SHA256도 동일했다.
- 이후 기존 인증을 유지한 실제 모델 요청을 두 번 실행했다. 첫 요청은 `get_guide`·`get_status`·`get_rows`·`plan_apply`만, 진단 요청은 `get_guide`만 허용했다. 두 번 모두 MCP 서버가 `connected`였지만 도구 호출 0회, 기록된 비용 0달러로 중단됐다.
- 진단 오류는 `oauth_org_not_allowed`이며 메시지는 "Your organization has disabled Claude subscription access for Claude Code"였다. 모델 접근이 도구 호출 전에 거절됐으므로 읽기·제안·승인 전체 흐름은 검증하지 못했다. 사용량 소진이 실제 실패 원인이라고 단정하지 않는다.
- 실제 모델 요청 과정에서 `.claude.json`의 자동 캐시 메타데이터만 갱신됐다. 기능 설정 파일 `settings.json`은 보존됐지만 `.claude.json` 전체 해시가 이전과 같다는 초기 격리 검사의 결론을 이번 실행에 적용하지 않는다.

이 결과는 Claude Code가 로컬 서버를 시작하고 MCP 초기 연결을 맺는다는 근거다. 인증·구독 상태 표시와 실제 사용 가능 여부는 별개다. 설정 격리 방법은 [Claude Code 공식 환경 변수 문서](https://code.claude.com/docs/en/env-vars)의 `CLAUDE_CONFIG_DIR`를 따른다. 실행 근거는 `work/app-retry/claude-code-live-readonly-evidence.json`과 `claude-code-guide-diagnostic-evidence.json`에 기록했다.

## 실제 Claude Desktop

설치된 Store 앱 2.9939.2.0이 DEV 서버를 시작하고 `initialize`·`tools/list`를 수행했다. 모델의 `get_guide` 호출과 안내문 응답도 확인했다. 이 도구는 패널 다리를 거치지 않는 서버 내 안내문 조회이므로, 이 성공만으로 Premiere와의 통신을 확인한 것은 아니다.

패널 상태를 읽는 `get_status` 두 번은 `ai-link-off`로 실패했다. 같은 시각 일반 `%APPDATA%/MogrtImporter/bridge_dev`에는 최신 `on` heartbeat와 합성 26행 시퀀스가 있었지만, Store 앱의 `%LOCALAPPDATA%/Packages/Claude_pzs8sxrjxfjjc/LocalCache/Roaming/MogrtImporter/bridge_dev`에는 9월 26일의 오래된 `off` heartbeat가 있었다.

Store 쪽 폴더를 백업하고 일반 다리 폴더로 임시 junction을 연결하자 오류는 약 5.1초 뒤 `no-heartbeat`로 바뀌었다. 이 관찰은 Store 앱의 경로 가상화에 따른 불일치를 강하게 시사하지만, 실제 파일 열기 경로를 추적하거나 정상 왕복 통신을 확인한 것은 아니다. `suggest_fields`와 `request_apply`는 실행하지 못했다.

추가로 DEV 다리를 공유 폴더로 옮겨 시험하는 작업은 자동 승인 검토에서 `blocked by policy`로 거절되어 실행하지 않았다. 이 실험 결과를 추정하지 않는다. 다음 검증은 Desktop 서버와 CEP 패널이 같은 다리 폴더를 읽고 쓰는지부터 확인해야 한다.

## 실제 Premiere 하드 테스트

DEV 설치본 `dev-0537703-m54`의 설치 JSX와 호스트 빌드가 일치했다. `MI_test.prproj`의 `T_23976`을 기준으로 다음을 실행했다.

| 명령 | 결과 | 본 케이스 시간 | 확인한 범위 |
|---|---|---|---|
| `npm run hard -- s5_inbox` | 2/2 통과 | 11.9초 | heartbeat, 상태 왕복, 시퀀스 불일치, 만료, 중복 요청, 연결 끄기 |
| `npm run hard -- s5_mcp` | 2/2 통과 | 10.9초 | 읽기 도구, 20개 제안, 낡은 필드 서명 거절, 화자 변경 제안의 거절·승인 |
| `npm run hard -- s5_jobs` | 2/2 통과 | 20.4초 | SRT 가져오기 거절·취소·승인, 적용 거절·점검 취소·승인, 완료 작업 조회 |

각 명령의 2개는 공통 `smoke.expr.txt`와 해당 본 케이스다. 중복 없이 본 케이스 3개와 스모크 1개가 통과했으며, 고유 테스트 6개로 합산하지 않는다.

`s5_jobs`는 합성 자막 네 줄을 V3/V8에 배치하고 중복 없이 시작·종료 시간 ±1프레임을 확인했다. V8은 해당 시퀀스에서 새로 만들어야 하는 첫 트랙이었다. 완료 작업의 재조회는 타임라인을 쓰지 않았고 스크래치 시퀀스 정리 결과는 `true`였다.

검증 세션의 원본 로그는 작업 폴더 `work/app-retry/`의 `check-build-after-dialog.txt`, `s5-inbox.txt`, `s5-mcp.txt`, `s5-jobs-fixed.txt`, `unit.txt`에 남겼다. 이 경로는 저장소 내부 경로가 아니라 검증을 수행한 Codex 작업 폴더 기준이다.

## 패널 창 크기와 좁은 폭 검증

`extension/CSXS/manifest.xml`의 기본 창 크기를 520×700에서 760×720으로, 최소 크기를 400×500에서 480×520으로 바꿨다. `extension/html/index.html`은 상단·선택·화자·적용 도구가 폭에 따라 줄바꿈하고, 히스토리·필터·검색을 함께 배치하도록 수정했다.

DEV에는 HTML과 manifest의 Geometry만 반영해 `dev-0537703-m54` 식별과 기존 DEV 설정을 유지했다. 실제 Premiere CEF에서 760×720, 520×720, 480×720을 각각 검사했고 상단·선택 바·화자 표·적용 바의 가로 넘침과 검사 대상 잘림은 모두 0이었다. 관련 기존 패널 테스트 29개도 재실행해 통과했다. 기존 검사 재실행이므로 위 고유 자동 검사 668개에 더하지 않는다.

추가로 480×520·760×520·760×720에서 적용 바·상태 바와 히스토리/필터 팝업이 화면 안에 있는지 확인했다. 최소 480×520에서 적용 바는 y=456~499.67, 상태 바는 약 499.67~520이었다. 이 최소 높이 검사는 복원된 단일 화자 3행(화자 표 숨김) 상태이며, 앞의 26행·두 화자 폭 검사는 높이 720px에서 수행했다. 추가 측정값은 `work/codex-retry/layout-popup-metrics.json`에 있으며 종료 후 팝업을 닫고 520×700 뷰포트와 자막·화자 상태를 복원했다.

기존에 열린 네이티브 창은 Premiere가 저장한 520×700을 유지했다. 새 기본 크기 760×720은 manifest 설정이며, 실제 CEF의 세 폭 검증과 구별해 기록한다. 측정값은 `work/codex-retry/layout-metrics.json`, 화면은 작업 폴더 `outputs/MOGRTImporter_UI_480.png`와 `MOGRTImporter_UI_760.png`에 남겼다.

## M5.5 최종 상태와 남은 확인

| 항목 | 현재 결과 | 완료에 필요한 확인 |
|---|---|---|
| 별도 Codex 실모델 검증 | 읽기→제안→실제 패널 승인→적용→검수 완료 | 검증한 합성 1행 시나리오 통과. Claude M5.5 완료 판정에는 합산하지 않음 |
| Claude Desktop 2.9939.2.0 | 서버 안내문 호출 통과, 패널 상태 조회 실패 | Store 경로 불일치 확인·해결 후 읽기→제안→사용자 승인→작업 결과 조회 |
| Claude Code 2.1.276 | MCP 초기 연결 통과, 조직의 구독 접근 정책으로 모델 호출 차단 | 사용 가능한 인증/조직 설정에서 실제 모델의 읽기·제안·승인 작업 검증 |
| 임시 설정 정리 | 완료. Desktop 설정 원본 바이트/SHA256 일치, 임시 서버 항목 없음, junction 제거 및 Store 원래 디렉터리 복원 | 추가 정리 없음. Code의 자동 캐시 갱신은 위 별도 기록 참조 |

Desktop용 합성 스크래치 시퀀스도 정리 결과가 `true`였고 AI 연결 상태는 원래 `off`로 되돌렸다. `desktop-live.txt`의 `PASS`는 검증용 시퀀스 준비·최종 조회·정리 스크립트의 종료를 뜻한다. Desktop의 읽기·제안·승인 전체 흐름 통과를 뜻하지 않는다. 실제 `%APPDATA%` 다리 디렉터리는 그대로이며, 임시 설정 백업 두 파일도 삭제했다. 복원 근거는 `work/app-retry/restore-evidence.json`에 기록했다.

## 이전 시도와 재검증

앞선 Premiere 실행에서는 기존 프로젝트 두 번과 새 빈 프로젝트 한 번이 응답하지 않아 CDP 연결/평가 단계에서 멈췄다. 빈 프로젝트에는 `T_` 시퀀스도 준비하지 못했다. 재검증 시작 시 화면의 메모리 경고를 닫은 뒤에는 빌드 확인과 세 하드 케이스가 정상 실행됐다. 이전 멈춤의 원인을 이 관찰만으로 확정하지 않는다.

첫 `s5_jobs` 실행은 기존 빈 트랙으로 배치가 가능해 점검창 없이 정상 완료됐는데, 테스트가 항상 점검창이 열린다고 가정해 실패했다. C2를 첫 미존재 트랙에 고정하여 점검 취소·승인 경로가 확실히 생기도록 테스트 픽스처만 수정한 뒤 통과했다. 이 하드 테스트 수정에서는 앱 업무 로직을 바꾸지 않았다.

Desktop도 앞선 세 번은 MCP 초기화 전 종료됐으나 재시도에서 실제 연결·도구 목록·안내문 모델 호출을 확인했다. 이후 패널 통신 검증에서 위 경로 불일치를 발견했고, 모든 임시 설정과 연결은 검증 종료 후 복원했다.

DEV 설치 전후 운영 확장 전체 파일의 SHA256이 같았고 운영 캐시도 보존했다. 운영 배포와 릴리스는 수행하지 않았다.

이 PC의 최신 Desktop 설정은 Store 앱 경로 `%LOCALAPPDATA%/Packages/Claude_pzs8sxrjxfjjc/LocalCache/Roaming/Claude/claude_desktop_config.json`이다. 현재 로그는 `%LOCALAPPDATA%/Claude/logs/mcp.log`에서 확인한다. `%APPDATA%/Claude/claude_desktop_config.json`에는 오래된 사본도 있으므로 파일 존재만으로 활성 설정을 판단하지 않는다.

## 지원 범위와 다음 검증

- `request_apply`는 화자 키(C1, C2 등)가 있는 줄을 지원한다. 화자 없는 기존 목록은 `unsupported-rows`로 거절하고 패널의 ▶ 또는 화자 지정 가져오기를 안내한다.
- 요청 접수는 `pending_approval`이며, 타임라인 적용과 SRT 가져오기는 사용자의 승인·점검을 기다린다. 도구 호출 성공과 작업의 `succeeded` 상태를 따로 확인한다.
- 작업은 패널이 보관한다. 서버 재연결 후 같은 `job_id`로 조회하며, 패널을 다시 열면 미완료 작업을 취소하고 자동으로 재실행하지 않는다.
- 완료 기록을 디스크에 저장하지 못하면 현재 패널에서는 최종 상태를 조회할 수 있지만 재시작 후에는 이전 진행 기록이 `panel-reloaded` 취소로 보일 수 있다. 자동 재실행은 하지 않는다.
- 하드 케이스 준비·실행 방법은 [TESTING.md](TESTING.md#7-m54-승인-작업과-m55-클라이언트-검증), 사용법과 오류 처리는 [MCP README](../mcp/README.md)를 따른다.

M5.5 완료 표시는 실제 Claude Code와 Desktop에서 필요한 시나리오를 실행한 뒤에만 한다. SDK 통합 테스트나 연결 성공만으로 완료 처리하지 않는다.
