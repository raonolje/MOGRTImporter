# MOGRT Subtitle Importer MCP 서버

Premiere Pro의 **MOGRT Subtitle Importer** 패널을 Codex·Claude에서 읽고, 후반 작업 텍스트 필드(포인트 텍스트 등)를 **제안**하는 전용 MCP 서버입니다.
Codex를 먼저 맞췄고 Claude(Code·Desktop)도 같은 서버를 씁니다.

- **stdio, 상태 없음.** 클라이언트 세션마다 프로세스 하나가 뜹니다. 상태는 패널과 디스크에만 있습니다.
- **패널과는 파일 다리로만** 이야기합니다: `%APPDATA%\MogrtImporter\bridge` (패널 `src/mi/inbox.ts`, 서버 `lib/bridge.js`).
  서버는 패널의 세션 파일(session.json)이나 Premiere에 직접 닿지 않습니다. `session.json`은 언제나 패널만 씁니다.
- **타임라인은 바꾸지 않습니다.** 제안은 패널의 제안 대기열에만 들어가고, 사용자가 패널에서 [적용]해야 속성이 바뀝니다.
  화자 표를 바꾸는 요청도 패널의 승인 카드에서 사용자가 승인해야 실행됩니다.
- **설치된 패널의 core로 확인합니다.** heartbeat의 `extPath`(설치 폴더)의 `html/js/app.js`에서 `src/mi/core.ts` region을 읽어
  (저장소 사본이 아니라) 패널이 알린 `coreHash`와 맞춥니다. 다르면 쓰기 도구는 `panel-version-mismatch`로 거절합니다.

## 설치

```
cd <repo>/mcp
npm install
```

- Node 20 이상. 의존성은 `@modelcontextprotocol/sdk` 하나(버전 고정, `package-lock.json`)입니다. `node_modules`는 커밋하지 않습니다.
- `<repo>`는 이 저장소 폴더입니다. 이 PC에서는 `C:/Users/RAONOLJE/Documents/00_Claude_Project/02_MOGRT_Importer`.

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

이 PC의 예: `args = ["C:/Users/RAONOLJE/Documents/00_Claude_Project/02_MOGRT_Importer/mcp/server.mjs"]`

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

(Claude Desktop에서 같은 도구·결과가 나오는지는 M5.5에서 확인합니다.)

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
| `panel-version-mismatch` | 패널 core와 설치본 core가 다르다 | 패널 새로 고침·Premiere 재시작 (쓰기 도구는 막힘) |
| `core-unavailable` | 설치본 app.js를 읽지 못했다 | 패널 설치 확인 |
| `timeout` | 패널이 제시간에 답하지 않았다 | 잠시 뒤 다시 |
| `busy` · `seq-mismatch` · `bad-args` · `not-found` · `fields-changed` · `needs-approval` | 패널의 runCommand 결과 | message·hint대로 |

## 테스트

- `npm test` (저장소 루트, SDK 없이): `tests/unit/mcp_tools.test.js`(도구 정의·안내문·복사한 region 로더가 `tests/lib`와 같은지·설치본 core 싣기),
  `tests/unit/mcp_bridge.test.js`(다리 클라이언트, 진짜 임시 폴더로 패널 하네스와 왕복), `tests/unit/panel_inbox.test.js`(패널 인박스).
- `npm run test:mcp` (루트, `mcp/`에서 `npm install` 뒤): 진짜 서버를 SDK Client(stdio)로 띄우고 가짜 패널 프로세스(`tests/mcp/fake_panel.js`:
  fixture 답·꺼짐·닫힘·낡음·무응답, 그리고 진짜 app.js를 vm으로 띄운 패널)와 이야기한다.
- 하드 (Premiere, DEV 패널): `npm run hard -- s5_inbox`, `npm run hard -- s5_mcp`.

`lib/loadRegions.js`·`lib/jsmask.js`는 `tests/lib`의 복사본입니다 (바이트까지 같아야 한다 — `mcp_tools.test.js`). 고치면 둘 다 고칩니다.
