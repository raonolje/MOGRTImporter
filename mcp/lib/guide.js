"use strict";
/**
 * MCP 서버 안내문 (한국어).
 *   INSTRUCTIONS  initialize의 instructions — 2048자 이하, 앞 512자만 보여도 규칙이 서게 (Codex는 MCP prompts를 쓰지 않는다)
 *   GUIDE         get_guide 도구가 돌려주는 자세한 운영 규칙
 * 도구가 바뀌면 여기도 바꾼다 (tests/unit/mcp_tools.test.js가 길이·도구 이름을 본다).
 */

// 앞 512자: 이것만으로 지켜야 할 규칙
const HEAD = [
	"MOGRT Subtitle Importer(Premiere Pro 자막 패널) 전용 도구다. 규칙:",
	"① 먼저 get_status를 부른다. 오류 code가 ai-link-off·panel-closed·no-heartbeat·panel-not-responding이면 사용자에게 Premiere에서 패널을 열고 'AI 연결 허용'을 켜 달라고 한다.",
	"② 줄은 uid로, 필드는 T-ID(T1, T2…)와 그 줄의 field_sig(get_rows·find_row의 sig)로 가리킨다. 사용자가 '#12 T2'·'C2·12'처럼 말하면 find_row로 그 줄의 문장을 확인한 뒤 쓴다.",
	"③ 캡션 필드(captionFid)와 시간은 절대 쓰지 않는다.",
	"④ 이 도구는 타임라인을 바꾸지 않는다. 바꾸는 요청은 패널에서 사용자가 승인한다."
].join("\n");

const TAIL = [
	"포인트 텍스트: 캡션 문장 안에 그대로 있는 조각을 '$$'로 이은 값(예: 날씨$$하늘). 조각 수는 list_presets notes의 '최대 N개'를 넘지 않는다. 같은 조각이 캡션에 두 번 나오면 첫 번째만 칠해지니 더 긴 조각을 고른다.",
	"순서: get_status → list_presets(필드·규칙) → get_rows(쪽 나누기, filter warn·sugg) 또는 find_row → get_suggestions. plan_apply·verify_timeline은 읽기만 한다.",
	"오류는 {ok:false, code, message, hint} JSON이다. seq-mismatch면 get_status로 지금 시퀀스를 확인하고, busy면 적용이 끝난 뒤, timeout이면 잠시 뒤 다시 부른다. panel-version-mismatch면 쓰기를 멈추고 패널을 새로 고쳐 달라고 한다.",
	"자세한 규칙은 get_guide."
].join("\n");

const INSTRUCTIONS = HEAD + "\n" + TAIL;

const GUIDE = [
	"# MOGRT Subtitle Importer MCP 운영 규칙",
	"",
	"## 무엇을 하는 도구인가",
	"- Premiere Pro의 MOGRT Subtitle Importer 패널(자막 목록 → MOGRT 클립)을 읽고, 후반 작업 텍스트 필드에 값을 '제안'한다.",
	"- 서버는 상태가 없다. 패널과는 파일 다리(%APPDATA%/MogrtImporter/bridge)로만 이야기하고, 세션 파일과 Premiere에는 직접 닿지 않는다.",
	"- 패널의 'AI 연결 허용'이 꺼져 있으면 아무 도구도 동작하지 않는다 (ai-link-off). 사용자에게 켜 달라고 한다.",
	"",
	"## 주소",
	"- 줄: uid (다화자 'salt-id' 예: k7q2-57, 화자 없는 목록은 id 숫자). '#12'·'C2·12'는 사람이 읽는 라벨이라 바뀔 수 있다 — 쓰기에는 uid만 쓴다.",
	"- 필드: T-ID. 프리셋의 텍스트 필드를 위에서부터 T1, T2… 로 센다. captionFid(초록 T 배지)는 SRT 캡션이 들어가는 필드라 쓰지 않는다.",
	"- field_sig: 줄의 필드 구조 서명(get_rows·find_row의 sig). 제안할 때 함께 보내면 구조가 바뀐 줄에 잘못 쓰는 일을 막는다.",
	"- 사용자가 '#12 T2'처럼 말하면 find_row {label: '#12 T2'}로 줄과 필드를 확인하고, 그 줄의 문장(text)을 사용자에게 보여 준 뒤 진행한다. 두 화자에 같은 번호가 있으면 'C2·12'처럼 화자를 붙여 달라고 한다.",
	"",
	"## 포인트 텍스트",
	"- 캡션(문장) 안에 글자 그대로 있는 조각을 '$$'로 이은 값: '오늘 날씨가 맑아요' → '날씨$$맑아요'.",
	"- 조각 수는 list_presets의 notes(프리셋 설명)에 적힌 '최대 N개'까지. 공백뿐인 조각은 안 된다.",
	"- 같은 조각이 캡션에 두 번 나오면 첫 번째만 칠해진다. 겹치지 않게 조금 더 긴 조각을 고른다.",
	"- '$$'가 없는 값은 제목 같은 자유 문구다. 캡션에 없는 문구면 패널이 '본문에 없는 문구'로 표시한다.",
	"- 시간·캡션 문장·프리셋 구조는 만들거나 고치지 않는다.",
	"",
	"## 도구",
	"- get_status: 패널·시퀀스·화자·줄 수·승인 대기 수, core 버전이 맞는지(core.match). 모든 작업의 처음.",
	"- list_presets: 프리셋마다 fields(fid, label, caption), captionFid, notes(포인트 규칙), native·orderVerified(순서 미확인 네이티브는 제안 불가).",
	"- get_cast: 화자 표 (C1, C2 … 이름·트랙·기본 프리셋·위치).",
	"- get_rows {speaker?, from?, count?(최대 200, 기본 50), filter?: all|changed|warn|sugg}: 줄 목록 (uid, label, text, fields, sig, warn, sugg). 긴 목록은 from으로 쪽을 넘긴다.",
	"- find_row {label}: '#12', 'C2·12', '#12 T2' → 그 줄 (uid, text, fields, sig, field).",
	"- get_suggestions {uid?}: 패널 제안 대기열 (ok·stale·check 문구).",
	"- plan_apply {uids? | speaker?}: 화자별 배치 계획(추가할 트랙·충돌·작업 수). 타임라인은 바꾸지 않는다.",
	"- verify_timeline: 타임라인 검수 보고서 (정상·없음·옮겨짐·Premiere에서 고침 …). 읽기만 한다.",
	"",
	"## 승인",
	"- 타임라인·화자 표·목록을 바꾸는 일은 패널에서 사용자가 한다. 요청 결과가 needs-approval이면 '패널에서 승인해 주세요'라고 알린다.",
	"- get_status의 panel.approvals가 0보다 크면 승인을 기다리는 요청이 있다.",
	"",
	"## 오류 {ok:false, code, message, hint}",
	"- ai-link-off / panel-closed / no-heartbeat / panel-not-responding: 패널을 열고 'AI 연결 허용'을 켜 달라고 한다 (Premiere가 모달 창으로 멈췄을 수도 있다).",
	"- panel-version-mismatch: 패널 코드와 서버가 읽은 설치본이 다르다. 쓰기를 멈추고 패널 새로 고침(또는 Premiere 재시작)을 부탁한다.",
	"- seq-mismatch: 그 사이 시퀀스가 바뀌었다. get_status부터 다시.",
	"- busy: 패널이 타임라인에 적용하는 중이다. 끝난 뒤 다시.",
	"- timeout: 패널이 제시간에 답하지 않았다. 잠시 뒤 다시 (검수·계획은 오래 걸릴 수 있다).",
	"- bad-args / not-found: 인자를 확인한다 (message에 까닭이 있다)."
].join("\n");

module.exports = { INSTRUCTIONS, INSTRUCTIONS_HEAD: HEAD, GUIDE };
