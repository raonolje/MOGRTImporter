# MOGRT Subtitle Importer MCP 서버

Premiere Pro의 **MOGRT Subtitle Importer** 패널을 Codex·Claude에서 읽고, 후반 작업 텍스트 필드를 제안하며, **패널 승인 후 SRT 가져오기·타임라인 적용을 요청**하는 전용 MCP 서버입니다.
Codex를 먼저 맞췄고 Claude(Code·Desktop)도 같은 서버를 씁니다.

- **stdio, 상태 없음.** 클라이언트 세션마다 프로세스 하나가 뜹니다. 상태는 패널과 디스크에만 있습니다.
- **패널과는 파일 다리로만** 이야기합니다: `%APPDATA%\MogrtImporter\bridge` (패널 `src/mi/inbox.ts`, 서버 `lib/bridge.js`).
  서버는 패널의 세션 파일(session.json)이나 Premiere에 직접 닿지 않습니다. `session.json`은 언제나 패널만 씁니다.
- **변경은 패널에서 승인합니다.** 텍스트 제안은 제안 대기열에 들어가고, 사용자가 [적용]해야 속성이 바뀝니다.
  화자 표·타임라인 적용·SRT 가져오기 요청은 승인 카드에 표시됩니다. 타임라인 적용은 기존 점검 창에서, SRT는 가져오기 창에서 다시 확인합니다.
- **설치된 패널의 core로 확인합니다.** heartbeat의 `extPath`(설치 폴더)의 `html/js/app.js`에서 `src/mi/core.ts` region을 읽어
  (저장소 사본이 아니라) 패널이 알린 `coreHash`와 맞춥니다. 다르면 쓰기 도구는 `panel-version-mismatch`로 거절합니다.

## 설치

```
cd <repo>/mcp
npm install
```

- Node 20 이상. 의존성은 `@modelcontextprotocol/sdk` 하나(버전 고정, `package-lock.json`)입니다. `node_modules`는 커밋하지 않습니다.
- `<repo>`는 이 저장소 폴더입니다. 이 PC에서는 `D:/01/_ClaudeAI/02_MOGRT_Importer`.

## 패널 쪽 준비

1. Premiere Pro에서 창 > 확장 > **MOGRT Subtitle Importer**를 엽니다.
2. 패널 위쪽 오른편의 **AI 연결 허용**을 켭니다 (기본은 꺼짐). 켜 두면 패널을 다시 열어도 켜진 채입니다.
   - 꺼져 있으면 패널은 다리 폴더를 읽지도 쓰지도 않고, 서버는 `ai-link-off`로 알립니다.
   - 켜져 있는 동안 패널은 2초마다 `heartbeat.json`을 쓰고 0.3초마다 `inbox`를 봅니다.

## 클라이언트 등록 (설정 파일은 사용자가 직접 넣습니다)

이 저장소의 어떤 스크립트도 `~/.codex/config.toml`이나 Claude 설정을 고치지 않습니다. 아래를 직접 넣어 주세요.

### Codex (`~/.codex/config.toml`)

```toml
[mcp_servers.mogrt_importer]
command = "node"
args = ["<repo>/mcp/server.mjs"]
startup_timeout_sec = 20
tool_timeout_sec = 60
```

이 PC의 예: `args = ["D:/01/_ClaudeAI/02_MOGRT_Importer/mcp/server.mjs"]`

DEV 패널(`CEP_MogrtImporter_dev`, 하드 테스트용)에 붙일 때만 다리 폴더를 바꿉니다:

```toml
env = { MI_BRIDGE_DIR = "C:/Users/<사용자>/AppData/Roaming/MogrtImporter/bridge_dev" }
```

### Claude Code

```
claude mcp add mogrt_importer -- node <repo>/mcp/server.mjs
```

### Claude Desktop (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "mogrt_importer": { "command": "node", "args": ["<repo>/mcp/server.mjs"] }
  }
}
```

실제 클라이언트 연결 검증과 SDK 통합 테스트의 범위는 [`docs/MCP_VALIDATION.md`](../docs/MCP_VALIDATION.md)에 구분해서 기록합니다.

## 도구

모든 결과는 `content[0].text`의 JSON 하나입니다 (`structuredContent`는 싣지 않습니다 — Codex는 그것이 있으면 글자를 버립니다).
오류는 `isError: true`와 `{ok: false, code, message, hint}`입니다. 호출은 약 19초 안에 끝납니다 (Codex·Claude Desktop은 60초 부근에서 끊습니다).

| 도구 | 읽기 | 하는 일 |
|---|---|---|
| `get_status` | ✓ | 패널·시퀀스·화자·줄 수·제안 수·승인 대기 수, `core.match`(설치본 core = 패널 core). 모든 작업의 처음 |
| `list_presets` | ✓ | 프리셋마다 텍스트 필드 T-ID(`fid`·`label`·`caption`), `captionFid`, `sig`, `notes`(포인트 텍스트 '최대 N개' 규칙) |
| `get_cast` | ✓ | 화자 표 (C1, C2 … 이름·트랙·기본 프리셋·위치) |
| `get_rows` | ✓ | 줄 목록 `{speaker?, from?, count?(≤200, 기본 50), filter?: all\|changed\|warn\|sugg}` → uid·label·text·fields·sig·warn·sugg |
| `find_row` | ✓ | `'#12'`, `'C2·12'`, `'#12 T2'` → 그 줄 (uid, text, fields, sig, field) |
| `get_suggestions` | ✓ | 패널의 AI 제안 대기열 (ok·stale·확인 문구) |
| `plan_apply` | ✓ | 화자별 배치 계획 (트랙·충돌·작업 수). 타임라인은 바꾸지 않습니다 |
| `verify_timeline` | ✓ | 타임라인 검수 보고서 (읽기만) |
| `get_guide` | ✓ | 자세한 운영 규칙 (패널에 닿지 않음) |
| `suggest_fields` | | `{seq_id, items: [{uid, field_id, field_sig, value, note?}]}` (200개까지) — 캡션이 아닌 필드에 값 제안. 서버가 **설치본 core의 `validateSuggestion`**으로 먼저 확인하고 하나라도 틀리면 아무것도 넣지 않는다(`rejected`·`fields-changed`·`not-found` + results). 통과하면 패널의 제안 대기열에만 (`field_sig`는 결과에 그대로 되돌아온다) |
| `set_cast_proposal` | | `{seq_id, items: [{key, name?, track?('V3'\|'auto'), preset_id?, pos_x?, pos_y?}], note?}` — 화자 표 변경 제안. 패널 위쪽 **승인 카드**에 올라가고(`pending: true`, `rid`) 사용자가 [승인]해야 바뀐다 |
| `request_apply` | | `{seq_id, scope: changed\|rows, uids?}` — 변경분 또는 지정 줄의 적용 승인 요청. 즉시 `job_id`를 반환한다. `rows`에는 중복 없는 uid를 최대 200개 보낸다 |
| `import_srt` | | `{seq_id, paths}` — 절대 경로의 로컬 `.srt` 파일(최대 20개) 가져오기 요청. 승인 후 가져오기 창을 열며 완료까지 `job_id`로 조회한다 |
| `wait_job` | ✓ | `{job_id, wait_sec?}` — 작업 상태·결과·오류 조회. `wait_sec`는 0~25초이며 실제 대기는 도구의 남은 시간 한도 안에서 끝난다. 기다리는 시간이 끝나도 작업은 계속된다 |

- `suggest_fields`·`set_cast_proposal`은 `readOnlyHint: false`, `destructiveHint: false`입니다. `request_apply`·`import_srt`는 승인 후 기존 내용을 바꿀 수 있어 `destructiveHint: true`입니다.
  포인트 텍스트 제안은 자동으로 승인되지 않습니다 (사용자 결정 4).
- `seq_id`는 `get_status`·`get_rows`·`find_row`가 준 값을 그대로 보냅니다. 그 사이 Premiere에서 시퀀스가 바뀌면 패널이 `seq-mismatch`로 거절합니다
  (화자 없는 목록의 uid는 줄 번호라 다른 시퀀스에도 같은 uid가 있을 수 있습니다).
- 쓰기 도구는 설치본 core 해시가 패널과 다르면 패널에 아무것도 보내지 않고 `panel-version-mismatch`로 거절합니다.

서버 안내문(initialize의 `instructions`, 한국어 2048자 이하)은 `lib/guide.js`에 있습니다. Codex는 MCP prompts를 쓰지 않으므로
규칙은 안내문과 `get_guide`에 둡니다.

## 다리 폴더 약속

```
%APPDATA%/MogrtImporter/bridge/          (DEV 패널은 bridge_dev)
  inbox/<id>.json     서버가 쓴다 (<id>.json.tmp → rename)  {v: 1, id, op, args, at, seqId?, build?, by?}
  outbox/<id>.json    패널이 쓴다 (tmp → rename), 서버가 읽고 지운다  {v: 1, id, op, at, ok, data | error, detail, rid?, results?, dup?}
  heartbeat.json      패널이 2초마다 {state: "on", build, extPath, coreHash, seqId, busy, pendingApproval, …}
                      끄면 {state: "off"}, 켠 채 닫으면 {state: "closed"}
  processed.json      패널이 처리한 명령 id (2분) — 같은 id는 한 번만 돈다
```

- 패널은 명령을 하나씩 차례로 `runCommand(op, args, {source: "agent"})`로 돌립니다. 바꾸는 명령은 승인 대기열(`needs-approval`)로 갑니다.
- 2분이 지난 명령은 돌리지 않습니다 (`expired`). 서버는 시간 안에 답이 없으면 패널이 아직 가져가지 않은 명령을 거둡니다.

## 환경 변수

| 이름 | 기본 | 뜻 |
|---|---|---|
| `MI_BRIDGE_DIR` | `%APPDATA%/MogrtImporter/bridge` | 다리 폴더 (DEV 패널은 `…/bridge_dev`) |
| `MI_TOOL_BUDGET_MS` | 19000 | 도구 호출 하나의 시간 한도 |
| `MI_HB_WAIT_MS` | 5000 | 패널 신호가 없을 때 기다리는 시간 |

## 오류 코드

| code | 뜻 | 할 일 |
|---|---|---|
| `ai-link-off` | 패널의 'AI 연결 허용'이 꺼져 있다 | 패널에서 켠다 |
| `panel-closed` | 패널이 닫혔다 | 패널을 열고 켠다 |
| `no-heartbeat` | 5초 기다려도 패널 신호가 없다 | 패널을 열고 켠다 |
| `panel-not-responding` | 신호가 끊겼다 (Premiere 모달·긴 작업) | Premiere 화면 확인 |
| `panel-version-mismatch` | 패널 core와 설치본 core가 다르다, 또는 설치된 패널이 서버보다 옛 버전이라 명령을 모른다 | 패널 새로 고침·새 버전 설치·Premiere 재시작 (쓰기 도구는 막힘) |
| `core-unavailable` | 설치본 app.js를 읽지 못했다 | 패널 설치 확인 |
| `unsupported-rows` | 적용 대상에 화자 키가 없는 기존 목록의 줄이 있다 | 패널의 ▶로 적용하거나 SRT 가져오기 창에서 화자를 지정한 뒤 다시 요청 |
| `storage-failed` | 패널이 작업 기록을 저장하지 못했다 | 캐시 경로·쓰기 권한을 확인한 뒤 다시 요청 |
| `timeout` | 패널이 제시간에 답하지 않았다 | 잠시 뒤 다시 |
| `rejected` | suggest_fields의 제안 중 확인을 통과하지 못한 것이 있다 (아무것도 넣지 않았다) | results[].error를 보고 고쳐 모두 다시 |
| `busy` · `seq-mismatch` · `bad-args` · `not-found` · `fields-changed` · `needs-approval` | 패널의 runCommand 결과 | message·hint대로 |

`request_apply`의 지원 범위는 화자 키(C1, C2 등)가 지정된 줄입니다. 화자가 한 명이어도 키가 있으면 지원합니다. `scope: changed`는 목록 전체를 검사해 실제 변경분을 계획하고, `rows`는 지정한 uid만 대상으로 삼습니다. 화자 없는 기존 목록은 작업을 만들기 전에 `unsupported-rows`로 거절합니다.

`wait_job` 호출이 정상 반환해도 작업이 성공했다는 뜻은 아닙니다. 결과의 `state`와 `result`·`error`를 확인합니다:

- `pending_approval`: 패널 위쪽 카드의 승인 대기.
- `waiting_input`: 적용 전 점검 또는 SRT 가져오기 창의 입력 대기.
- `running`: 실행 중. 같은 `job_id`로 조회합니다.
- `succeeded`: 완료. 안전 설정으로 건너뛴 항목이 있는지는 `result`도 확인합니다.
- `failed`, `rejected`, `cancelled`, `expired`: 미완료 종료. `error.code`의 `rows-changed`는 요청 뒤 데이터 변경, `read-failed`·`bad-srt`는 파일 읽기/내용 오류, `apply-incomplete`는 적용 실패·충돌·일부 적용, `panel-reloaded`는 패널 재시작을 뜻합니다.

작업 오류는 `wait_job` 결과 안의 `error`에 있습니다. MCP 호출 자체의 오류(`isError: true`)와 구별합니다. 승인·입력 대기는 10분 뒤 만료하며, 종료 기록은 패널의 `cache/ai_jobs.json`에 최대 100개/24시간 보관합니다. 서버를 다시 연결해도 같은 작업을 조회할 수 있습니다. 패널 재시작은 미완료 작업을 취소하며 자동 재실행하지 않습니다.

## 테스트

- `npm test` (저장소 루트, SDK 없이): `tests/unit/mcp_tools.test.js`(도구 정의·안내문·복사한 region 로더가 `tests/lib`와 같은지·설치본 core 싣기),
  `tests/unit/mcp_bridge.test.js`(다리 클라이언트, 진짜 임시 폴더로 패널 하네스와 왕복), `tests/unit/panel_inbox.test.js`(패널 인박스),
  `tests/unit/panel_jobs.test.js`(승인·비동기 작업·입력 대기·시퀀스/데이터 변경·만료·재시작·저장 실패·지원 범위).
- `npm run test:mcp` (루트, `mcp/`에서 `npm install` 뒤): 진짜 서버를 SDK Client(stdio)로 띄우고 가짜 패널 프로세스(`tests/mcp/fake_panel.js`:
  fixture 답·꺼짐·닫힘·낡음·무응답, 그리고 진짜 app.js를 vm으로 띄운 패널)와 이야기한다. `server_read.test.js`(읽기 도구),
  `server_write.test.js`(20줄 포인트 텍스트 제안·거절 경우·승인 카드·해시 불일치), `server_jobs.test.js`(작업 승인·거절·재연결 조회·가져오기·지원 범위).
  테스트에서 클라이언트 이름을 `Claude Desktop`으로 지정해도 실제 Desktop 앱을 실행하는 것은 아닙니다.
- 하드 (Premiere, DEV 패널): `npm run hard -- s5_inbox`, `npm run hard -- s5_mcp`, `npm run hard -- s5_jobs`.
  `s5_jobs`는 스크래치 시퀀스에서 실제 SRT 가져오기·타임라인 적용의 거절/취소/승인과 네 클립 배치를 확인합니다.
- 실제 Codex CLI 0.155.0-alpha.16 / `gpt-6-astra`에서 읽기→제안→실제 패널 승인→적용→검수까지 통과했습니다. 최종 MCP 호출 14회(서로 다른 도구 10개)로 합성 첫 행을 V3에 배치하고 실제 MOGRT 포인트 텍스트와 시간도 확인했습니다. 사용자 설정은 바꾸지 않았습니다.
- 실제 클라이언트별 근거는 [MCP_VALIDATION.md](../docs/MCP_VALIDATION.md)에 기록합니다. M5.4 자동 검사와 Premiere 하드 세 케이스는 통과했습니다. 원래 M5.5의 Claude 검증은 Desktop 패널 통신 실패와 Code 조직 정책 차단으로 미완료이며, 위 Codex 성공과 구분합니다.

`lib/loadRegions.js`·`lib/jsmask.js`는 `tests/lib`의 복사본입니다 (바이트까지 같아야 한다 — `mcp_tools.test.js`). 고치면 둘 다 고칩니다.
