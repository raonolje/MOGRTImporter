# MULTISPEAKER_PLAN

MOGRT Subtitle Importer 다화자 자막(v28) 작업 지시서다. Claude Code는 이 문서를 읽고 **적힌 순서대로** 진행한다.

- 작성 기준: 2026-09-25 (검증 라운드 반영본)
- 브랜치: `feat/multispeaker`. 기준 커밋: `0aa8b82` (v27). 롤백 기준 태그: `v27`
- 범위:
  - 0단계: 남은 실측, 테스트 하네스
  - 1단계: 캡션 가져오기·병합·필드 ID·데이터 안전
  - 2단계: 화자별 트랙 배치
  - 3단계: 후반 작업 UI·검수·배포
  - 4단계: 화자별 화면 위치
  - 5단계: 전용 MCP (개요)
- 예상 공수: 0~4단계 약 36일, 5단계 약 10일

---

## 0. 작업 전 반드시 읽을 것

### 0.1 고치는 파일

| 경로 | 성격 | 수정 |
|---|---|---|
| `extension/html/js/app.js` | 4,837줄짜리 단일 IIFE. 패널이 실제로 로드하는 유일한 소스 | ✅ 직접 수정한다. 빌드는 없고, Chromium 99라 최신 JS를 써도 된다 |
| `extension/jsx/hostscript.jsx` | ES3 ExtendScript (v27) | ✅ 새 코드는 `/* MI:BEGIN v28 */`~`/* MI:END */` 구역에만 넣는다. v27 함수는 한 바이트도 바꾸지 않는다 |
| `extension/html/index.html` | 살아 있는 CSS는 모두 인라인 `<style>`(7-1084)에 있다 | ✅ |
| `src/*`, `css/style.css` | 죽은 코드 | ❌ 참고용 |

app.js의 region 경계(줄 번호는 v27 기준이며, 수정하면 밀린다):

```
state.ts 2 · storage.ts 20 · cep.ts 292 · srtParser.ts 431 · ui/tabs 465 · htmlUtils 500
colorUtils 514 · ui/dialog 707 · ui/paramEditor 752 · ui/trash 1367 · ui/presetList 1479
ui/mogrtPicker 1692 · ui/previewPanel 1846 · ui/modalParams 2006 · ui/modal 2710
ui/subtitleList 3375 · main.ts 3862
```

새로 만드는 region:

| region | 위치 | 내용 |
|---|---|---|
| `src/mi/core.ts` | srtParser 바로 뒤 | 순수 함수만. DOM·state 참조 금지 |
| `src/ui/importDialog.ts` | main.ts 앞 | |
| `src/ui/cast.ts` | subtitleList 앞 | |
| `src/mi/apply.ts` | main.ts 앞 | |
| `src/mi/commands.ts` | main.ts 앞 | |
| `src/mi/inbox.ts` | commands.ts 바로 뒤 | 5단계 (M5.1 인박스·heartbeat) |

### 0.2 사용자 결정 (2026-09-24, 구속력 있음)

1. **화자 분리**: "트랙별로 나누기". Premiere에서 화자마다 캡션 트랙을 하나씩 만들고, 캡션 트랙마다 SRT를 하나씩 내보낸다. 한 파일에 "철수:"를 붙이는 방식은 보조 선택지이며, 1~4단계에서는 만들지 않는다.
2. **SRT 이름**: "캡션 트랙 번호". 파일 이름의 `C1`, `C2` 토큰으로 화자를 구분한다(예: `C1.srt`, `인터뷰_C2.srt`). 화자 이름은 패널의 화자 표에서 정한다.
3. **텍스트 필드**: "지금 구조 그대로 유지하면돼 t버튼 체크된 텍스트 필드에만 캡션 텍스트가 들어오면 돼 나머지는 후반작업으로 입력하되 LLM에 요청할 수 있게 텍스트 필드를 위에서부터 차례대로 Id 발급하는 형태로 해서 LLM이 구분하게 만들어야겠지"
   - 역할(role) 시스템은 만들지 않는다.
   - 'T' 버튼(`preset.textParamIndex`)이 가리키는 필드만 캡션을 받는다.
   - 나머지 텍스트 필드는 모두 후반 작업 필드이며, 위에서부터 T1, T2… 번호를 붙인다.
   - "결국 포인트는 하나야": 포인트 텍스트도 후반 작업 텍스트일 뿐이다.
4. **AI 포인트 텍스트 제안**: "켜야지". 켠다. 다만 사용자가 승인하기 전에는 목록에도 타임라인에도 아무것도 쓰지 않는다.
5. **캡션 역방향 쓰기·납품용 자막 파일**: "필요없음". 범위 밖이다.
6. **AI 클라이언트**: "코덱스 우선". Codex를 먼저 붙이고, Claude도 지원한다.
7. "순서대로 모든 단계 진행해": 실측 → 캡션 가져오기·병합·필드 ID → 화자별 트랙 배치·안전장치 → 후반 작업 UI·검수·배포 → 화자별 화면 위치 → AI(전용 MCP) 순서로 진행한다.

### 0.3 절대 규칙

- **단일 화자는 오늘과 똑같다.** C번호 없는 SRT 한 개로 작업하면 화면·동작·저장 형식이 v27과 같다. 기존 프리셋·세션·히스토리는 그대로 읽혀야 한다. 마이그레이션은 추가만 하고, 여러 번 돌려도 결과가 같아야 한다.
- **캐시는 설치 폴더 안에 있다** (`CEP_MogrtImporter/cache`). 배포할 때는 반드시 extensions/ **밖**으로 백업하고, 지우지 않고 덮어쓴다. `installer_v1.1.6.exe`로 업그레이드하거나 롤백하는 것은 금지다.
- **ExtendScript 전역은 모든 CEP 확장이 함께 쓴다** (MCPBridgeCEP도 설치되어 있다). 새 진입점은 `MI_`, 헬퍼는 `MI__` 접두사를 쓴다. DEV 사본은 `MID_`로 바꿔 설치한다.
- JSX를 바꾸면 Premiere를 재시작해야 테스트된다. 패널만 바꾼 경우에는 CDP로 새로고침하면 된다.
- **커밋 하나하나가 동작하는 상태여야 한다.** 여러 파일을 한 번에 가져오는 기능은 S2-4까지 플래그 뒤에 둔다.
- 순수 로직은 node로 테스트한다(§13).

### 0.4 실측 사실 (Premiere 26.5.1)

| 항목 | 결과 | 설계에 주는 영향 |
|---|---|---|
| 같은 트랙에서 시간이 겹치면 (Q4) | 앞 클립이 잘린다(덮어쓰기). 트랙이 다르면 공존한다 (Q3) | 화자마다 전용 트랙을 쓴다 |
| importMGT 기본 길이 | 5초. 배치할 때 [S, S+5s)를 먼저 차지한다 | 이웃 보호(guard)와 꼬리 충돌 검사가 필요하다 |
| importMGT의 트랙 번호 ≥ 트랙 수 (#14) | 오류 없이 **마지막 트랙**에 놓인다 | 트랙을 먼저 만들고, 놓인 트랙을 확인한다 |
| `qe addTracks` (#3) | 기존 번호는 그대로 두고 뒤에 추가한다. 활성 시퀀스에만 동작한다 | 활성 시퀀스를 확인한 뒤 호출한다 |
| TrackItem.name (#1) | AE·네이티브 모두 저장·재시작 후에도 유지된다. projectItem 이름은 바뀌지 않는다 | 클립 이름을 태그로 쓴다 |
| 자르기(razor) (#1b) | 두 조각이 **같은 이름**을 가진다. nodeId는 새 조각만 바뀐다 | 같은 태그가 둘이면 보고만 하고 자동으로 해결하지 않는다 |
| nodeId (#2) | 저장·재시작 후에도 같다 | 클립을 다시 찾을 때 쓰는 보조 식별자 |
| end 연장 (#5) | 같은 트랙에서 겹쳐진다 | 끝을 다음 클립 시작에서 자른다(clamp) |
| remove(false,false) (#6) | true. 두 번째는 false이며 예외는 없다 | |
| 키프레임 있는 Position (#8) | setValue가 true를 돌려주지만 **무시된다**. setTimeVarying(false)는 키를 지운다 | isTimeVarying이면 쓰지 않는다 |
| 프레임 (#11) | importMGT 시작이 프레임에 맞춰진다(30s → 29.988s). 버림인지 반올림인지는 미확정 | 비교는 프레임 단위, ±1 |
| 속도 (#19) | 클립 하나에 약 760ms | 청크, 진행률, 중지 |
| rawValue (#20) | AE는 두 번 읽어도 같다 | 편집 감지에 쓸 수 있다 |
| 네이티브 (#23) | Source Text를 순서대로 읽고 쓸 수 있다. 초깃값은 이상한 한 글자다 | 한 글자 이하는 빈 값으로 본다 |
| JSX 캐시 (#16) | Premiere를 재시작할 때까지 유지된다. 전역 범위를 공유하고 마지막에 로드된 것이 이긴다 | 접두사, 빌드 스탬프 |
| Motion Position (Q5/Q7) | 0~1 정규화 값이며 MOGRT 자체 레이아웃 기준이다 | 화면 절대 좌표가 아니다 |
| 캡션 API (Q9) | 캡션을 읽을 방법이 없다. createCaptionTrack만 있다 | SRT를 사람이 내보내야 한다 |
| closeDocument | 패널이 내려간다 | 테스트에서 사용 금지 |

### 0.5 검증 라운드(2026-09-25)에서 확인한 사실

- **옛 구조 클립이 실제로 있다.**
  - `[라온올제] 자동 줄바꿈 박스 자막.mogrt`는 2026-06-26 16:07에 다시 저장되어 지금은 15개 속성이다.
  - 옛 구조(8개 속성, 텍스트가 0/2/4) 줄 94개가 있는 세션 3개는 모두 그 전(06-25 01:13 / 15:20 / 21:41)에 타임라인에 적용되었다.
  - 따라서 그 클립들은 **8개 속성 구조**다. 지금 구조로 index를 기준으로 쓰면 캡션이 '서브 포인트 텍스트'에 들어간다.
- **v27 재적용 키**: `Math.round(start*100)` 키는 프레임에 맞춰진 클립을 놓친다. node로 5,000개를 모의해 보면 반올림으로 스냅될 때 5.0%, 버림일 때 50.5%(23.976)를 놓친다. 놓치면 5초 길이로 다시 놓아 뒤 자막 머리를 자른다.
- **프레임 계산**: `Math.floor`는 ms로 반올림된 SRT 시간을 23.976에서 5,000개 중 2,293개나 한 프레임 앞에 둔다. `Math.round`는 0개다.
- **인코딩**: fatal UTF-8이 실패하면 euc-kr로 넘어가는 규칙은 깨진 바이트 하나로 파일 전체를 망가뜨린다. U+FFFD 개수를 비교하면 된다(정상 UTF-8을 euc-kr로 읽으면 16개, 바이트 하나가 깨진 UTF-8은 3 대 17, CP949는 6 대 0).
- **히스토리**: seq_e2517bb7의 15개 중 12개가 내용이 같은 '자동저장 (5분 무작업)'이다. 최대 20개라 안전 지점이 밀려난다.
- **프리셋 가져오기**가 모든 프리셋을 지우고 파일의 id를 그대로 넣는다. 다른 세션의 'preset_3'이 조용히 다른 MOGRT를 가리키게 된다.
- **프로젝트 전환 누수**: `loadAllFromStorage`에는 세션 파일이 없을 때의 분기가 없다(262-290). 이전 프로젝트의 목록이 새 시퀀스에 저장된다.
- **부팅 TDZ**: `renderAll()`(3966)이 필터 바인딩(`const _subSearchInput` 4075, `let _presetFilterSelected` 4088)보다 먼저 실행된다. renderAll에서 필터를 건드리면 IIFE 전체가 멈춘다.
- **getMogrtParams**는 프리뷰 시퀀스가 없으면 작업 시퀀스 V1 0초에 넣었다가 지운다(552-590). 이때 V1 0~5초 영상이 잘린다.
- `node --test tests/unit`처럼 폴더를 인자로 주면 Node 24.14에서 실패한다. 글롭으로 넘겨야 한다.

---

## 1. 핵심 설계

1. **화자 = 캡션 트랙.**
   - `parseCaptionKey`가 파일 이름에서 C번호를 읽는다.
   - 화자 이름, 기본 프리셋, 트랙, (4단계) 위치는 화자 표(cast)에 둔다. 화자 표는 session.json의 선택 키 `mi`에 저장하고 cast.json에도 복제한다.
2. **단일 화자는 v27 경로를 그대로 쓴다.** 새로 보이는 것은 T1..Tn 배지, 프리셋이 있는 목록에서만 나오는 병합/교체 선택, 병합 뒤 ▶에 추가되는 '안전하게 적용' 선택지뿐이다.
3. **역할 시스템은 없다.**
   - T-ID는 줄마다 자기 `_allParams`에서 텍스트 필드가 몇 번째인지로 정하고, displayName으로 확인한다.
   - 포인트 텍스트는 값의 규칙('$$'로 나눈 조각이 모두 본문에 그대로 있음)으로만 알아본다.
4. **다시 가져오기는 화자별 병합이다.**
   - 매칭: 시간 겹침과 한글 자모 유사도를 쓰고, 순서를 보존한다.
   - 캡션: 3-way 규칙.
   - 병합 전에 안전 지점을 먼저 남긴다.
   - 기존 단일 목록을 화자로 나눌 때도 같은 매처로 **모든 파일에 나눠 배정**한다. 후반 작업은 잃지 않는다.
5. **index로 쓰기가 핵심 위험이다.** 기존 클립에 쓰는 모든 새 쓰기는 **이름을 확인하고** 쓴다.
   - 1단계: 바꾸지 않은 v27 호스트에 `index: -1`을 보낸다. applyParamsToItem(928-941)은 이때 displayName으로 속성을 찾는다.
   - 2단계부터: `MI__applyParamsSafe`로 쓴다.
6. **병합했거나 구조가 바뀐 레거시 줄은 기본으로 v27 applyToTimeline에 보내지 않는다.**
   - 1단계: 한 줄씩 v27 `updateClipAtTime`(mogrtPath ""; 새로 놓지도 밀지도 않는다)에 이름 확인 params를 보낸다.
   - S2-5부터: 태그 없는 MI_ 작업을 nodeId 기준으로 보낸다.
7. **화자마다 전용 비디오 트랙을 쓴다.**
   - 트랙은 먼저 만든다.
   - 프레임은 정확한 ticks에서 Math.round로 구한다.
   - 끝은 다음 클립 시작에서 자른다.
   - 잠긴 트랙은 건너뛴다.
8. **타임라인이 원장이다.**
   - 클립 이름은 `이름 [MI:salt-id.gen]` 형식이다.
   - 가장 높은 gen이 현재 클립이고, 낮은 gen은 정리 대상이다.
   - 가장 높은 gen이 둘이면(자르기) 보고만 한다.
9. **mi.applied(참고용)**에는 gen, 템플릿, 클립 레이아웃 해시, 속성별 해시, 쓴 직후의 텍스트 해시를 둔다. 이것으로 다음을 한다.
   - 바뀌지 않은 줄은 보내지 않는다.
   - 바뀐 속성만 쓴다.
   - 옛 버전 클립을 알아본다.
   - Premiere에서 고친 클립을 감지한다.
   - 없으면 전체 갱신으로 돌아가고, 이것만 보고 지우는 일은 없다.
10. **작업 순서**: 트랙마다 제거 → 줄이는 갱신 → 이동 → 배치 → 늘리는 갱신 순으로 돌린다. 점유 검사는 작업 **뒤**의 범위로 한다. 그래서 줄을 나누거나 합쳐도 한 번에 적용된다.
11. **효과·키프레임이 있는 클립**은 조용히 다시 놓지 않는다. TrackItem.move가 클립을 유지하면(S0-3 r) move로 옮기고, 아니면 속성만 갱신한다.
12. **마지막 적용 되돌리기**는 타임라인만 되돌린다.
    - last_apply.json은 실행을 시작할 때 만들고 청크마다 덧붙인다.
    - 되돌리는 작업마다 '우리가 쓴 뒤의 텍스트 해시'로 확인한다.
13. **호스트 코드**는 ES3 MI_ 구역에 둔다.
    - JSON으로 받고 JSON으로 돌려준다.
    - U+2028/2029를 이스케이프한다.
    - 활성 시퀀스와 빌드를 확인한다.
    - DEV는 MID_로 설치하고, 빌드 스탬프를 매번 확인한다.
14. **안전 지점**(가져오기·병합·복원·작업 불러오기·프리셋 저장·일괄 프리셋 적용 직전)은 따로 `history_safety.json`에 둔다. 5분 자동저장이 밀어낼 수 없고, 같은 내용의 자동저장은 건너뛴다.
15. **데이터 안전 수정을 먼저 한다.**
    - 프리셋 id를 단조 증가로 발급한다.
    - 프리셋 가져오기가 id를 보존한다.
    - 세션 파일이 없는 키로 바뀌면 세션을 초기화한다.
    - 실제 시퀀스가 확인될 때까지 기다리는 부팅 게이트를 둔다.
    - V1 영상이 잘리지 않게 막는다.
16. **공유 코드**: 순수 로직은 모두 `//#region src/mi/core.ts`에 둔다. node 테스트가 읽고, 나중에 MCP 서버도 **설치된** 패널에서 해시를 확인하고 읽는다. 헤드리스 `runCommand`(ui|test|agent)를 S1-5부터 둔다.
17. **출시**:
    - v1.1.7(선택): 1단계만
    - v1.2.0: 다화자 + 검수
    - v1.3.0: 위치
    - 그다음 Codex 우선 MCP

---

## 2. 데이터 모델

새 키는 모두 **선택 키**다. 없으면 v27처럼 동작한다.

### 2.1 `cache/{projKey}/{seqKey}/session.json`

```jsonc
{
  "subtitles": [
    { "index": 12, "startTime": "00:00:12.345", "endTime": "00:00:14.800", "startSec": 12.345, "endSec": 14.8,
      "text": "오늘 날씨 좋다",   // 마지막으로 가져온 캡션 = 병합 기준. 패널은 이 값을 고치지 않는다
      "id": 57,                   // S1-3부터 초기화하지 않는다. uid = mi.salt + "-" + id
      "spk": "C2",                // 신규: 캡션 트랙 키. 없으면 단일 화자
      "srtNo": 12 }               // 신규: 파일의 원래 번호 (표시·동률 판정용)
  ],
  "rowStates": {
    "57": { "presetId": "preset_3", "params": [], "_allParams": [], "open": false, "checked": false,
      "mm": "time",               // 신규: text|time|both|new|conflict|check|restored|undone
      "mmPrev": { "s": 12.1, "e": 14.8, "cap": "오늘 날씨 좋네" },   // 신규: 없을 때만 설정
      "ap": { "s": 12.1, "e": 14.8, "cap": "오늘 날씨 좋네", "ps": "3e0c19aa", "t": 2 }, // 신규: 마지막으로 확인된 적용
      "psOld": "77aa01bc",        // 신규: ap 없이 구조를 맞췄을 때의 이전 paramSig
      "orphanFields": [ { "displayName": "자막 2 텍스트", "value": "…" } ], // 신규: 구조를 맞출 때 자리를 못 찾은 텍스트
      "warn": [ { "fid": "T2", "missing": ["하늘"], "dup": [] } ],
      "sugg": { "T2": { "v": "날씨$$하늘", "by": "codex", "ts": 0, "cap": "a1b2c3d4", "sig": "…", "st": "pending", "note": "" } } }
  },
  "trashBin": [ { "sub": {}, "state": {}, "position": 11, "why": "merge", "at": 1790000000000 } ], // why: merge|replace|없음(사용자 삭제). merge/replace는 최대 300개
  "nextId": 65,
  "mi": {                     // miHasData일 때만 쓴다 → 단일 화자 파일은 키 4개 그대로
    "v": 1, "salt": "k7q2", "hwm": 64, "legacyTrack": 2, "remapped": false,
    "castOrder": ["C1", "C2"],
    "cast": { "C1": { "name": "철수", "track": null, "autoTrack": 2, "presetId": "preset_3", "color": 0,
                      "file": "인터뷰_C1.srt", "path": null, "size": 5120, "mtime": null, "pos": null } },
    "stack": false, "stackDy": 0.12,
    "applied": { "k7q2-57": { "g": 1, "m": "C:/…/x.mogrt", "ls": "5b1f0e2d", "h": "a91f03c2",
                              "fh": { "0": "1c2d99e0" }, "rh": "5d20e7aa", "k": "ae" } }
  }
}
```

- `ap`는 검증된 적용 결과로만 쓴다. 옛 클립을 찾을 때 가장 먼저 본다.
- `ap.nk`(S1-11): 네이티브 줄을 놓은 구운 사본의 키. **의도된 예외**: 네이티브 프리셋 줄은 단일 화자 목록에서도 ▶·↑ 뒤 늘 `ap`(nk 포함)를 적는다. 교체할지(문구·트랙·시작이 마지막 적용과 같은지)와 연쇄 자리를 `ap`로만 알 수 있기 때문이다. 키를 더할 뿐이라 v27은 읽고 무시한다. AE 줄은 v27 규칙 그대로다(병합·위험·이미 ap가 있는 줄만).
- `applied.ls`는 호스트가 읽은 **클립 자체의 속성 레이아웃 해시**다. 템플릿 버전 식별에 쓴다.
- `rh`는 쓴 직후 텍스트 값들의 해시다. 정규화 규칙: NFC, 줄바꿈은 LF, 네이티브 값이 한 글자 이하면 빈 값.

### 2.2 새 파일

- **`cast.json`**: `{v, savedAt, salt, hwm, legacyTrack, castOrder, cast, stack, stackDy}`.
  - 다음을 모두 만족할 때만 쓴다: session에 spk 줄이 있다, mi가 없다(v27이 저장한 뒤), 모든 spk 줄 id ≤ hwm.
  - 그 밖에는 낡은 파일로 보고 무시한다(v27이 SRT를 다시 열어 id를 초기화한 경우 등).
- **`last_apply.json`**: 실행을 시작할 때 `{runId, complete:false}`로 만들고, 청크마다 다시 쓰고, 끝나면 `complete:true`로 바꾼다.
  - 범주: `created / updated / moved / adopted / replaced / removed`.
  - 항목마다 `nodeId`, `g`, `rh`를 둔다.
  - `before`/`from`은 **type이 있는** 완전한 ParamDef다. colorHex는 넣지 않는다. rawValue로 정확히 복원하기 위해서다.
  - replaced/moved/removed에는 템플릿 식별자 `m`(경로)과 `pi`(projectItem nodeId)를 둔다.
  - v27 ▶가 실행되면 `superseded:true`가 된다.
- **`history_safety.json`**: 최대 10개. 자동저장은 여기에 쓰지 않는다. 가장 최근 것과 내용 해시가 같으면 건너뛴다.
- **`cast_defaults.json`** (프로젝트 단위): C번호별 이름, 프리셋, 색, 위치의 기본값.

### 2.3 기존 파일 변경

- **히스토리 항목**: 선택 키 `mi`(salt, hwm, applied는 빼고)와 `hash`를 추가한다.
- **안전 지점 이름**: "SRT 가져오기 전: …", "히스토리 복원 전", "작업 불러오기 전", "구조 맞춤 전", "프리셋 저장 전: 이름", "프리셋 가져오기 전", "프리셋 삭제 전: 이름", "프리셋 일괄 적용 전"(체크한 여러 줄), "휴지통 비우기 전", "기본 프리셋 일괄 적용 전: C2", "AI 제안 적용 전".
  - 안전 지점을 복원하면 줄이 가리키는데 살아 있지 않은 프리셋을 프리셋 휴지통에서 되살린다(프리셋 가져오기·삭제가 끊은 연결). 자동·수동 항목 복원은 v27처럼 연결만 끊는다.
- **자동 항목 이름**: v27의 "SRT 로드: 파일", "타임라인 적용 (n개)"는 유지한다. 새로 "SRT 가져오기: …", "SRT 병합: …"을 쓴다. "SRT 적용 전"은 두지 않는다.
- **작업 파일**: version 2에 `mi`(salt 포함)를 추가한다. 불러오기 전에 '작업 불러오기 전' 안전 지점을 남긴다.
  - sequenceKey의 **GUID 부분이 같으면**(Premiere 'Save As'로 projKey만 바뀐 경우 포함) id를 유지한다. 현재 salt가 비어 있으면 파일의 salt를 받는다.
  - GUID가 다르면 safeNextId부터 id를 다시 매기고 `mi.remapped = true`로 둔다. 이때 salt는 받지 않는다.
- **presets.json**: 형태는 그대로다.
  - id는 단조 증가로 발급한다. 실제 데이터에서 다음 id는 `preset_9`이다.
  - 선택 학습 필드: `mogrtItemName`, `mogrtDurSec`, `mogrtLs`, `mogrtBaseComps`. v27은 이 필드들을 무시한다.
- **settings.json**: 그대로다. 다화자 모드에서는 '기본 트랙'이다.

### 2.4 메모리·파생 값

- **state 영역에 둘 것**(부팅 TDZ 방지): `state.mi = miDefault()`, `_keysResolved`, `_filtersReady`, `_sessionReadFailed`, `_speakerFilter`.
- **상수**: `MI_CAST_ENABLED`(S2-4까지 false), `MI_PREFIX = "MI_"`(DEV 설치 때 "MID_"로 바뀐다), `MI_BUILD_PANEL = "@@BUILD@@"`.
- **파생 값**:
  - `paramSig(params)`: 목록끼리 비교하는 해시. `index:t|o:displayName`을 이어서 만든다. 네이티브는 `n:개수`.
  - `clipLs(lay)`: 호스트가 읽은 클립 레이아웃의 해시.
  - `namedParams(params)`: AE의 text/color/number/angle/point/dropdown/boolean 가운데 이름이 목록 안에서 유일한 것만 index를 -1로 바꾼다.
  - `isV27Unsafe(rs, preset)`: 다음 중 하나라도 참이면 참이다.
    - layoutMismatch
    - ap.ps가 현재 paramSig와 다름
    - psOld가 있음
  - `rowLabel`: "#12" 또는 "C2·12".

---

## 3. SRT 가져오기

1. **파일 선택**: `#srtInput`의 마크업은 그대로 둔다. 핸들러(3876-3914)를 라우터 `_onSrtFilesChosen`으로 바꾼다.
   - 처리 순서: `readAsArrayBuffer` → `decodeSrtBytes` → `parseSRT(text,{keepNo,stripTags})` → `parseCaptionKey`.
   - `multiple`은 `_miCastEnabled()`일 때만 켠다.
   - **부팅 게이트**: 실제(프리뷰가 아닌) 시퀀스가 확인될 때까지 SRT 열기와 적용을 막는다. 2초마다 다시 확인하고, 타이머로 열어 주지 않는다. 시퀀스가 없으면 "시퀀스를 열면 SRT를 열 수 있습니다"를 보여 준다.
2. **디코딩**:
   1. BOM이 있으면 BOM을 따른다.
   2. 앞 200바이트의 홀수 위치 가운데 30% 이상이 0x00이면 UTF-16LE로 본다.
   3. 그 밖에는 **non-fatal UTF-8**로 읽고 U+FFFD 개수 u를 센다. u가 0이면 UTF-8이다.
   4. u가 0보다 크면 euc-kr로도 읽어 k를 센다. **k < u일 때만** euc-kr을 쓴다.
   - 레거시 경로에서 인코딩이 UTF-8이 아니거나 깨진 글자가 있으면, 목록을 바꾸기 전에 첫 줄 미리보기와 함께 확인을 받는다.
3. **C번호 규칙**:
   - 파일 이름에서 확장자를 뺀 이름을 NFC로 정규화한다.
   - 정규식: `/(^|[^A-Za-z0-9])[Cc]0*([1-9][0-9]?)(?![0-9A-Za-z])/g`.
   - 예:
     - `C1.srt` → C1
     - `인터뷰_C2.srt` → C2
     - `EP12_C02.srt` → C2
     - `c3 인터뷰.srt` → C3
     - `인터뷰C2.srt` → C2
     - `C12.srt` → C12
     - `Cam1`, `CC1`, `C1a`, `C0`, `narration`, 실제 파일 `Share_MOGRT_001`·`MOGRT_009`·`MOGRT_010` → 없음
     - `C1_C2.srt` → 모호
   - 화자 이름은 파일 이름에서 가져오지 않는다.
4. **라우팅**:

   | 경우 | 처리 |
   |---|---|
   | 플래그가 꺼져 있음 | 레거시. 한 파일만 |
   | 1파일 · 키 없음 · 화자 표 없음 · 프리셋 있는 줄 없음 | v27 교체 본문(3884-3909). 목록이 비어 있지 않으면 안전 지점을 먼저 남기고, nextId는 초기화하지 않는다 |
   | 1파일 · 키 없음 · 프리셋 있는 줄 있음 | "이미 후반 작업(프리셋)이 있는 자막 목록입니다." [병합 (후반 작업 유지)] [교체 (지금까지 방식)] [취소]. S1-9까지는 플래그 뒤에 둔다 |
   | 플래그 켜짐 + (2파일 이상, 키 있음, 또는 화자 표 있음) | `#importModal` |
   | 키 있는 파일 + 화자 없는 기존 줄 | 분배 모드 (아래 7) |

5. **파싱 차이**: `parseSRT`는 opts가 없으면 v27과 바이트 단위로 같다.
   - `keepNo`: 원래 번호를 `srtNo`로 남긴다.
   - `stripTags`: `<i> <b> <u> <font>`와 `{\an8}`을 지운다.
   - opts가 있으면 U+2028/2029를 LF로 바꾼다.
6. **화자 만들기**:
   - 이름: 입력값 > cast_defaults > 키
   - 프리셋: T 필드가 있는 것만 고를 수 있다. preset_4와 preset_8은 제외된다
   - 트랙: 자동
   - 색: 비어 있는 첫 번째 색
   - salt가 비어 있으면 **유효한 cast.json**에서 복원하고, 아니면 새로 4자를 만든다.
7. **분배 모드**(기존 단일 목록 + C파일):
   - `#impLegacyMode`: "파일에 맞춰 나누기 (후반 작업 유지)"(기본) | "모두 한 화자로" | "휴지통으로 보내고 새로 시작".
   - `distributeLegacy`:
     1. 기존 줄과 **휴지통 항목(사용자 삭제)**을 파일마다 matchCues로 맞춘다.
     2. 최고 점수가 0.5 이상이고 2위보다 0.15 이상 높으면 그 화자에 배정한다.
     3. 최고 점수가 0.35 이상이면 '확인 필요'로 두고 줄마다 선택하게 한다.
     4. 그보다 낮으면 '짝 없음'으로 휴지통에 보낸다.
     5. 배정이 끝나면 화자마다 일반 병합을 돌린다.
   - '의심 파일' 경고는 이 모드에서 끈다.
   - `mi.legacyTrack`에 현재 `#trackSel`을 기록한다.
8. **중복·오류**:
   - 같은 키가 두 파일에 있으면 가져오기 버튼이 꺼진다.
   - 자막이 0개인 파일은 건너뛴다.
   - 의심 파일이면 '그래도 가져오기'로 한 번 더 누르게 한다.
   - 같은 파일을 다시 가져오면 '변경 없음'이다.
9. **시작 타임코드**: 모든 줄이 zeroPoint 이후에 있고 시퀀스 끝을 넘으면 경고하고 [시작 타임코드만큼 당기기]를 제안한다. 근거는 S0-3 u.
10. **히스토리**: 가져오기마다 안전 지점을 **하나** 남기고, 끝난 뒤 자동 항목을 하나 남긴다.

---

## 4. 다시 가져오기 병합

- **범위**: 화자 K의 살아 있는 줄과 K의 휴지통 항목만 다룬다. 휴지통과 nextId는 초기화하지 않는다.
- **매칭** `matchCues`:
  1. 텍스트가 같고 시작·끝 차이가 각각 0.05초 이하면 고정(anchor)한다.
  2. 나머지는 순서를 보존하는 DP로 맞춘다.
     - 대역: 시간상 가장 가까운 줄 기준 ±40
     - 점수: 0.6×겹침 + 0.4×자모 유사도
     - 후보 조건: 시간이 겹치거나 유사도 ≥ 0.9
     - 채택: 점수 ≥ 0.35. 동률이면 srtNo로 가른다
- **분류**:

  | 분류 | 뜻 |
  |---|---|
  | same | 같음 |
  | text | 문장만 바뀜 |
  | time | 시간만 바뀜 |
  | both | 둘 다 바뀜 |
  | check | 유사도 < 0.5. 나누기·합치기로 의심 |
  | new | 새 줄 |
  | removed | 빠진 줄 |

- **휴지통 2차 매칭**(검증 반영): 짝이 없는 새 줄을 K의 휴지통 항목과 맞춘다.
  - 사용자 삭제(why 없음)와 짝이 되면 **trashKept**. 삭제를 존중하고 휴지통 항목의 시간과 문장만 갱신한다.
  - merge·replace 항목과 짝이 되면 **restored**. id, 프리셋, 후반 작업을 그대로 살려 목록으로 돌려놓고, `mm = "restored"`로 둔다.
- **바꾸는 것**:
  - 시간, srtNo, index
  - `sub.text` (항상 새 문장)
  - 캡션 필드: `resolveFid`로 찾아서 `_setRowFieldValue`로 쓴다
- **보존하는 것**:
  - id, 프리셋, 열림·체크 상태
  - 다른 모든 속성(포인트 텍스트 포함)
  - 캡션이 그대로면 제안(sugg)도 유지한다
- **3-way 규칙**: base는 이전 sub.text, ours는 현재 캡션 필드, theirs는 새 문장이다.

  | 경우 | 결과 |
  |---|---|
  | theirs == base | 아무것도 바꾸지 않는다 |
  | ours == base | theirs를 쓴다 |
  | ours == theirs | sub.text만 바꾼다 |
  | 그 밖 | 충돌. 기본은 theirs이고, `#impKeepPanelEdits`면 ours를 둔다 |

- **포인트 검사**: 이전 캡션의 부분 문자열로만 이루어진 '$$' 필드를 새 캡션으로 다시 검사한다. 없어진 조각은 missing, 두 번 나오는 조각은 dup("첫 번째만 칠해집니다")로 남긴다. 값은 자동으로 고치지 않는다.
- **mm·mmPrev·ap**:
  - `mmPrev`는 **없을 때만** 채운다.
  - 적용이 **검증된 줄**만 mm을 지운다.
  - v27 결과에 "(실패"가 들어 있으면 지우지 않는다. hostscript 1250-1251은 실패가 있어도 SUCCESS를 돌려준다.
- **통계**: "같음 47 · 문장 2 · 시간 3 · 새 줄 1 · 빠짐 1 · 충돌 1 · 포인트 확인 1 · 휴지통에 있어 제외 1 · 휴지통에서 복구 2"
- **같은 파일 재병합**: 변화도 히스토리도 없어야 한다.
- **레거시 목록 적용**(검증 반영):
  - 1단계(S1-9): ▶ 확인창에 [안전하게 적용 (N)]를 둔다.
    - 문장만 바뀐 줄은 한 줄씩 `host.updateClipAtTime({…, mogrtPath: "", params: [이름 확인 캡션 속성]})`으로 보낸다.
    - 0.5초 안에 다른 줄이 있으면 건너뛴다. updateClipAtTime은 0.5초 안의 첫 클립을 잡기 때문이다.
    - 시간이 바뀐 줄은 "이 버전에서 자동으로 옮길 수 없습니다"로 남긴다.
  - S2-5부터: MI_ 호스트로 nodeId 기준 갱신, 이동, 배치를 한다. 이웃 보호가 있고 태그는 쓰지 않는다.

---

## 5. 텍스트 필드 ID (T1..Tn)

- **규칙**:
  - 전체 param 목록에서 type이 "text"인 것만 배열 순서대로 1부터 번호를 매긴다.
  - 저장하지 않는다.
  - rs.params로 계산하지 않는다. index+1로 계산하지도 않는다.
  - `captionFid(preset)`는 textParamIndex를 가리키는 필드의 번호다.
- **실제 프리셋**:

  | 프리셋 | 텍스트 필드 |
  |---|---|
  | preset_1 | T1 전체 텍스트(캡션, idx4) · T2 포인트 텍스트(idx6) · T3 서브 포인트 텍스트(idx8) |
  | preset_2 | T1(캡션, idx0) · T2(idx2) · T3 Text_02 · T4 PointText_02 |
  | preset_3 | T1 텍스트(캡션) · T2 포인트 텍스트 |
  | preset_6 | T1..T4 (T1 캡션) |
  | preset_8 | T1..T5, 캡션 없음 |
  | preset_4 | 텍스트 필드 없음 |

- **줄별 해석** `resolveFid`: 서수와 이름이 같으면 서수로, 아니면 같은 이름으로 찾고, 그래도 없으면 null이다(쓰지 않는다). 옛 구조 줄 94개에서는 T1이 idx0 '전체 텍스트'로 해석된다.
- **ID만으로는 안전하지 않다**: ID는 패널 데이터를 안정시킬 뿐이다. 호스트는 index로 쓰므로 타임라인에 쓸 때는 반드시 이름을 확인한다(§0.5, §6.14).
- **안정성**:
  - 텍스트가 아닌 속성이 늘거나 줄면 ID는 그대로다.
  - 텍스트 속성이 바뀌면 이름으로 해석하거나 해석하지 못한다. 틀린 곳에 쓰지는 않는다.
  - 외부에서 쓸 때는 fieldSignature가 일치해야 한다. 다르면 `fields-changed`로 거부한다.
  - 같은 프리셋을 다시 저장하면 `rebaseRowParams`가 fid를 기준으로 값을 옮긴다. 옮기지 못한 값은 `orphanFields`에 남긴다.
- **네이티브**:
  - (2026-09-25) 네이티브는 스크립트로 텍스트를 쓸 수 없어 **굽기**로 적용한다(S1-11). T-ID 규칙은 같다.
  - S0-3 f가 순서를 확인해야 definition.json의 이름을 쓴다.
  - **패치를 적용한 뒤에** 캐시한다(지금은 2948에서 캐시하고 3007에서 패치해서 캐시를 쓸 때 패치가 빠진다).
  - 기존 프리셋을 덧씌울 때 네이티브 목록은 displayName도 가져간다.
- **표시**:
  - 행 편집기와 프리셋 모달에 `.fid-badge`를 붙인다. 캡션은 초록 `.cap`이다.
  - 배지를 클릭하면 "#12 T2" 또는 "C2·12 T2"를 복사한다.
  - 안내 문구: "T1·T2…: 위에서부터 매긴 텍스트 필드 번호 (후반 작업·AI 지정용)".
- **LLM 주소**(검증 반영):
  - "#12"는 화면 번호(sub.index)라 파싱할 때마다 바뀐다.
  - `rows`는 `index`, `label`을 함께 돌려준다.
  - `resolve {label}` / MCP `find_row`가 label을 uid와 문장으로 바꿔 준다.
  - **쓰기는 uid로만** 한다.

---

## 6. 타임라인 배치

1. **라우팅**:
   - 화자 표가 비어 있으면 `_legacyApply`(v27 본문)를 쓴다.
     - isV27Unsafe인 줄만 namedParams를 보내고, 나머지는 v27과 같은 바이트를 보낸다.
     - 결과에 "(실패"가 있는지 확인한다.
   - 화자 표가 있으면 `_miApply`를 쓴다.
   - ↑ 버튼:
     - 화자 줄 → 한 줄 계획
     - 안전한 레거시 줄 → v27 그대로
     - 나머지 레거시 줄 → namedParams(1단계), 레거시 안전 경로(S2-5)
2. **트랙** `resolveTracks`:
   - 고정한 트랙끼리 범위가 겹치면 막는다.
   - 첫 번째 자동 화자는 **정확히 기본 트랙**을 쓴다.
   - 그다음 화자는 기억해 둔 autoTrack을 다시 쓴다.
   - 그것도 없으면 기본 트랙보다 위에서 비어 있는 가장 낮은 트랙을 쓰고, 필요하면 새로 만든다.
3. **트랙 생성**: 배치하기 **전에** `MI_ensureVideoTracks`를 부른다. 활성 시퀀스를 다시 읽어 트랙 수를 센다. 4개가 넘으면 한 번 더 확인한다.
4. **프레임**:
   - `frameOf(sec) = Math.round(sec*TPS/frameTicks)`. `sf = frameOf(start)`, `ef = max(sf+1, frameOf(end))`.
   - 호스트는 `Time.ticks = sf*frameTicks`로 정확히 놓는다(약 9.8시간까지).
   - 비교 오차는 ±1프레임이다. zeroPoint 기준은 S0-3 o/u로 확정한다.
5. **같은 화자 안의 겹침**: 앞 자막의 끝을 뒤 자막 시작에서 자른다. 호스트에서도 한 번 더 자른다.
6. **식별자**:
   - 태그 정규식: `/\[MI:([a-z0-9]{4})-(\d+)\.(\d+)\]\s*$/`
   - `scanIndex`로 나눈다: 우리 것(현재 / 옛 gen / 중복), 다른 salt, 태그 없음.
7. **스캔과 계획** `planPlacement`:
   - **스캔 범위**(검증 반영): MI_getTracks는 화자 트랙, 기본 트랙, legacyTrack만 대상 줄 범위 ±30초 안에서 본다. 시작, 끝, nodeId, 이름만 읽는다. 무거운 읽기(texts, lay, deco)는 후보 클립만 40개 이하씩 한다.
     - (S2-4 리뷰 반영) 트랙 목록 = 기본 트랙부터 위 전부(자동 화자가 빈 트랙을 찾는다) + 고정·기억한 화자 트랙 + legacyTrack + 대상 줄이 마지막으로 놓인 트랙(applied.t·ap.t). applied가 있는데 우리 클립을 못 찾은 줄이 있으면(사용자가 기본 트랙 아래로 옮김) 나머지 트랙(V1 제외)을 한 번 더 읽는다.
     - 태그 없는·다른 salt 후보 클립 하나는 한 줄만 가진다(동시 발화). 순서: 확실함 → 그 줄의 트랙 → 문장이 같음 > 담음 > 네이티브 ap 자리 → 시작이 가까움 → 목록 순.
   - **우리 클립이 없는 줄**:
     - applied에 있던 줄 → `missing`. 기본으로 다시 놓는다.
     - 태그 없는 클립이 ±1프레임에 있고 종류가 같고 캡션 문장을 포함하면 → 채택(certain). 문장이 다르면 uncertain(선택 안 된 상태)으로 둔다.
     - **다른 salt 태그**(복제한 시퀀스)가 문장까지 맞으면 → 문장 기준으로 채택한다. salt는 받지 않는다(id가 충돌하기 때문).
     - **legacyTrack에 있는 옛 클립**(나눈 레거시 목록) → `legacyMove`: 화자 트랙에 새로 놓고 옛 클립은 nodeId로 지운다. 기본으로 켜 두고, 효과가 있는 클립은 뺀다.
     - 그 밖에는 배치한다. `[sf, max(ef, sf+D))`를 **작업 뒤 범위**로 검사한다.
   - **같은 자리에 우리 클립이 있는 줄**:
     - 템플릿이 다르면 → replace. 판정 순서: applied.m, 학습한 mogrtItemName, 종류와 텍스트 개수.
     - `clipLs`가 preset.mogrtLs와 다르면 → **oldVersion**. 기본은 속성 이름으로 갱신한다(새 버전에만 있는 속성은 적용하지 않음). `#pfUpgradeOld`를 켜면 교체한다.
     - 의도 해시가 같으면 → none(보내지 않음).
     - 그 밖에는 → update. 바뀐 속성만 보낸다. rh가 다르면 'Premiere에서 고침'으로 보고 기본은 건너뛴다.
   - **다른 자리에 우리 클립이 있는 줄**:
     - 시간이 바뀐 줄이면 → retime. 같은 트랙이고 S0-3 r을 통과했으면 `move`, 아니면 `moveRegen`이다.
     - **효과가 있는 클립**(컴포넌트가 늘었거나 Motion·Opacity에 키프레임)은 기본적으로 제자리에서 속성만 갱신한다. 다시 놓으려면 `#pfMoveDecorated`를 켠다.
       - 이 갱신은 검증된 적용이 아니다: mm과 '효과 있어 제자리'를 남기고 applied·ap에는 클립이 있는 자리를 적는다(다음 계획도 시간 변경을 본다). 쓸 속성이 없으면 보내지 않는다.
     - 시간이 바뀌지 않았으면 → 제자리에서 갱신(userMoved).
   - **네이티브 클립**: 템플릿 경로를 모르면 교체·재배치하지 않고 충돌 `template-unknown`으로 둔다.
   - **정리**:
     - 옛 gen은 정리한다(기본 켬).
     - 목록에 없는 클립(orphan)은 merge/replace 휴지통에 있고 고치지 않은 것만 미리 체크한다.
   - **salt 복구**: salt가 비어 있고, spk 줄이 있고, cast.json이 무효이고, remapped가 아닐 때만 한다. 표본의 80% 이상에서 **문장이 일치해야** 받는다.
8. **작업 순서**(검증 반영): 트랙마다 다음 순서로 돌린다.
   1. 제거
   2. 줄이는 갱신
   3. 이동과 교체 (의존 순서대로. 순환은 '먼저 지우는 교체' 하나로 끊는다)
   4. 배치
   5. 늘리는 갱신
   - 청크마다 모든 `before`를 먼저 읽는다.
9. **기본 길이와 이웃**:
   - 분기 C는 항상 만든다: guard nodeId → damaged → 해당 줄을 다시 넣는다(최대 2회).
   - 분기 P(S0-3 a를 통과하면): 배치 전에 setOutPoint를 하고, 청크가 끝나면 finally에서 in/out을 원래대로 돌린다.
   - D(기본 길이)는 `preset.mogrtDurSec`에 저장하거나 getOutPoint로 읽는다.
10. **청크 실행**:
    - 실행할 때마다 ping으로 v28과 **빌드가 같은지** 확인한다.
    - 호스트 예산은 7000ms이고, 청크 크기는 실측으로 정한다(기본 8).
    - 실행 중에는 `_miBusy`로 폴러, 30초 재스캔, 프리뷰를 멈춘다.
    - 진행률: "배치 중… C2 영희 16/52 · 전체 40/120". [중지]를 누르면 청크 사이에서 멈춘다.
    - **20초 워치독**: "Premiere에 대화상자가 떠 있을 수 있습니다 — Premiere 창을 확인하세요".
    - 오류가 나면 멈추고 다시 스캔한다. 다시 계획해도 결과는 같다.
    - 결과로 갱신하는 것: applied(ls, rh), ap, autoTrack, 프리셋 학습 필드.
    - 'partial'(키프레임이 있거나 옛 버전이라 못 쓴 속성이 있음)은 mm을 남긴다. applied의 fh에서 못 쓴 속성을 빼고 h를 비워 다음 적용이 다시 보낸다.
    - applied.rh는 텍스트를 쓴 작업 뒤에만 되읽은 값으로 바꾼다(시간만 옮김·끝만·이름만은 그대로 — Premiere에서 고친 문장을 받아들이지 않는다).
11. **되돌리기**(타임라인만):
    - `buildUndoOps`는 모든 작업을 **nodeId + g + 현재 텍스트 해시 == 기록된 rh**로 확인하고, 다르면 "그 뒤로 바뀜"으로 건너뛴다.
    - 범주는 6개이며 replaced를 포함한다. replaced는 pi나 m으로 옛 템플릿을 다시 놓는다.
    - 중단된 실행은 "(중단된 적용)"으로 표시한다.
    - 되돌린 줄은 mm "undone"이 된다.
    - (S2-5 구현) 기록은 key마다 순서대로 묶어 본다: 첫 항목의 작업 전 모습(origin)과 마지막 클립(final). 한 실행에서 한 줄이 여러 번 바뀌어도(이웃 복구, 순환 끊기) 실행 전으로 돌아간다. 그래서 기록에 `n`(순서)·`id`·`k`·`m`·`dur`, updated·adopted의 작업 전 자리·이름(`from`), 지운 클립의 템플릿 `m`(applied.m)·`pa`, 줄마다 실행 전 기록 `la.prev[key]`(ap·mmPrev·applied)를 덧붙인다 (spec 모양에 키만 더함).
    - (S2-5 구현) 같은 클립이면 update(작업 전 ParamDef 전부·이름·끝) 또는 TrackItem.move, 다른 클립이면 같은 트랙은 replace·다른 트랙은 moveRegen으로 옛 템플릿을 되놓는다 (태그 gen + 1 — 지금 클립이 남아도 옛 gen으로 정리되게). **호스트는 바꾸지 않았다**: placeChunk 항목에 projectItem(pi)을 넘길 길이 없어 옛 템플릿은 기록한 경로 `m`(importMGT)으로만 되놓는다 (같은 capsule이면 Premiere가 같은 프로젝트 항목을 다시 쓴다). m을 모르면 건너뛴다. pi는 기록만 한다.
    - (S2-5 구현) 되놓는 클립의 템플릿 길이가 덮는 이웃은 보호(guard)하고, 통째로 덮였거나 머리를 되돌리지 못하면 놓기 전에 읽어 둔 스냅숏(속성 전부·이름·자리)으로 다시 놓는다 (분기 C). 보호할 수 없는 남의 클립이 창 안에 있으면 그 되돌리기는 건너뛴다.
    - (S2-5 구현) 적용 중 덮여 사라진 이웃을 다시 놓은 기록(`fix`)으로 시작한 key는 되돌리지 않는다 (실행 전 클립의 모습이 기록에 없다 — 지우면 그 줄의 클립이 없어진다).
    - (S2-5 구현) 새로 만든 비디오 트랙은 지우지 않는다. 되돌린 뒤 기록에 `undone {ts, complete, keys}`를 적고, 다 되돌린 기록은 히스토리에 나오지 않는다.
    - (S2-5 리뷰) 자리도 확인한다: 지금 클립의 트랙·시작·끝이 기록한 작업 뒤 자리(마지막 항목의 track·sf·ef)와 1프레임 넘게 다르면 적용 뒤 Premiere에서 옮기거나 길이를 바꾼 것이다. 그러면 만든 클립 지우기·우리가 옮긴 클립 되돌리기·다시 놓은 클립 되놓기는 '그 뒤로 바뀜'(`retimed`, 다른 트랙이면 `moved-track`)으로 건너뛰고, 시작을 옮기지 않은 제자리 작업(updated·adopted)은 속성·이름만 되돌린다 (keepTime — spec 'updated → update keepTime'. 끝은 지금 자리가 작업 뒤 그대로일 때만 작업 전으로). 네이티브 클립에는 이것이 텍스트 밖의 유일한 가드다.
    - (S2-5 리뷰) 실행 전 줄 기록 `la.prev`가 없는 기록(S2-4 모양)은 되돌리지 않는다 (laUndoable): 되돌린 줄의 applied·ap를 실행 전으로 돌릴 수 없어 다음 ▶가 옛 문장의 클립을 '그대로'로 보고 병합 표시까지 지운다.
    - (S2-5 리뷰) 하드 테스트 s2_5 (1)의 '모든 raw param getValue가 같다'는 색 속성만 getColorValue ARGB 8비트로 비교한다 (되돌리기는 setColorValue 8비트로 되쓰므로 64비트 raw는 달라질 수 있다 — spec과 다른 점). projectItem은 단언하지 않고 다른 클립 수만 로그에 남긴다 (옛 템플릿은 pi가 아니라 경로 m으로 되놓는다).
12. **잠긴 트랙**: 해당 화자를 건너뛰고, 잠금을 풀지 않는다.
13. **레거시 안전 경로**(S2-5) `_legacySafeApply`:
    1. trackSel을 스캔한다.
    2. ap, mmPrev, 옛 시간 순서로 프레임을 정하고, ±1 안에서 캡션 문장이 맞는 클립을 **하나만** 찾는다.
    3. 태그 없이(`name:null`) 작업을 보낸다: 문장만 바뀜 → update, 시간 바뀜 → move/moveRegen(이웃 보호), 없음 → place.
    4. last_apply와 ap를 기록한다.
    - (S2-5 구현) 스캔은 줄 트랙들(ap.t, 없으면 trackSel)이다. 시간 변경은 TrackItem.move만 쓴다 (S0-3 r 통과). 문장만 바뀐 줄은 캡션 속성 하나, v27에 위험한 줄·되돌린 줄·복구한 줄·새로 놓는 줄·↑는 속성 전부를 보낸다 (호스트가 이름으로 확인해 쓴다). 네이티브 줄은 이 경로에서 다루지 않는다 (v27 ▶·↑의 굽기 경로). 새로 놓는 줄의 이웃(다른 레거시 줄의 태그 없는 클립)은 보호하고, 덮이면 스냅숏으로 다시 놓는다.
    - (S2-5 구현) v28 호스트가 답하지 않으면(캐시된 옛 호스트) 1단계 경로(`_legacySafeUpdateV27`)가 그대로 쓰인다. v27 호스트로 타임라인을 바꾸는 동작(▶ 지금 방식, ↑ v27, 1단계 안전 적용, 네이티브 교체)은 last_apply를 superseded로 만든다.
    - (S2-5 리뷰) 'missing → place'는 타임라인에 놓인 적 없는 줄(병합의 새 줄 mm new이고 ap·mmPrev 없음, 또는 마지막 레거시 적용이 그런 줄을 놓았다가 되돌린 줄 — core `legacyFresh`)과 ↑(v27 ↑처럼 못 찾으면 놓는다)에만 쓴다. 병합 전부터 있던 줄·v27에 위험한 줄은 줄 트랙에서 클립을 못 찾으면 '타임라인에서 클립을 찾지 못함'으로 건너뛰고 병합 표시를 남긴다 (트랙 선택이 바뀌었거나 옮긴 옛 클립 옆에 같은 줄이 하나 더 생기지 않게 — 1단계 경로와 같다, spec과 다른 점). ▶ 확인창의 '새로 놓습니다' 수도 이 줄만 센다.
    - (S2-5 리뷰) 캡션을 보낼지는 찾은 클립의 문장(되읽기)으로도 본다: 타임라인에 있는 문장(ap.cap → mmPrev.cap)과 다르거나 클립 문장에 줄 캡션이 없으면 캡션 속성을 보낸다 (v27로 놓은 목록은 ap가 없어 병합 뒤 패널에서 고친 캡션을 ap.cap으로 알 수 없다).
    - (S2-5 리뷰) superseded는 v27 호출이 타임라인을 바꾼(바꿨을 수 있는) 뒤에 적는다: SUCCESS, 바꾼 뒤일 수 있는 ERROR(속성 쓰기·importMGT 실패), JSX가 잡지 못한 예외, 네이티브 클립을 하나라도 지웠을 때. 바꾸기 전에 멈추는 실패(시퀀스·트랙·페이로드 확인, '클립 없음 + mogrtPath 미지정')와 빈 응답은 적지 않는다.
14. **호스트 계약** (§7)

---

## 7. 호스트 계약 (hostscript.jsx v28)

- **위치**: selectExportFolder(2757-2765) 뒤의 `/* MI:BEGIN v28 */` ~ `/* MI:END */`. 순수 헬퍼는 `/* MI_PURE_BEGIN */` ~ `/* MI_PURE_END */`로 한 번 더 감싼다. ES3만 쓴다.
- **공통**:
  - 입력은 JSON 문자열 하나다. 패널이 U+2028/2029를 이스케이프해서 보낸다.
  - 출력은 항상 비어 있지 않은 `MI__json`이다. "ERROR"로 시작하지 않는다.
  - 모든 진입점은 `MI__guard`로 시작한다.
    - `app.project.activeSequence.sequenceID === seqId`가 아니면 `seq-mismatch`
    - 프리뷰 시퀀스면 `preview-active`
    - `payload.build !== MI_BUILD`면 `build-mismatch`
  - 실패 형태: `{"ok":false,"error":"bad-payload|no-sequence|preview-active|seq-mismatch|build-mismatch|no-track|add-failed|exception","detail":"…"}`
- **헬퍼**: `MI__ft`, `MI__at`, `MI__frameOf`(round), `MI__parseTag`, `MI__makeTag`, `MI__kind`, `MI__texts`, `MI__lay`, `MI__deco`, `MI__readParams`, `MI__applyParamsSafe`, `MI__findByNode`, `MI__item`.
  - `MI__texts`: 네이티브 값이 한 글자 이하면 빈 값으로 둔다.
  - `MI__lay`: AE는 `[[이름,"t"|"o"]…]`, 네이티브는 `{n}`.
  - `MI__deco`: `{comps, keyed}`.
  - `MI__readParams`: AE는 `detectParamType`으로 type을 채우고 colorHex는 넣지 않는다. 네이티브는 collectNativeTextProps 분기를 쓴다.
  - `MI__applyParamsSafe`:
    - `props[p.index]`가 **이름과 텍스트 여부까지 같을 때만** 그 자리에 쓴다.
    - 아니면 같은 이름을 가진 k번째 속성에 쓰고, 그것도 없으면 skipped로 둔다.
    - `isTimeVarying`이면 keyed로 두고 쓰지 않는다.
    - 확인된 목록을 v27 applyParamsToItem에 한 번에 넘긴다.
  - `MI__item`: documentID+경로를 키로 쓰는 projectItem 캐시다. 예외가 나면 버린다.
- **진입점**:

```
MI_ping() → {ok, v:28, build, prefix, seqId, seqName, isPreview, docId, frameTicks, zeroPoint, endFrame}
MI_getTracks({seqId, build, tracks|null, fromFrame, toFrame})
  → {ok, frameTicks, numVideoTracks, tracks:[{i, locked, clips:[{sf, ef, nodeId, name, salt?, id?, g?}]}], ms}
MI_readClipTexts({seqId, build, items:[{track, nodeId}] (≤40), want:{texts, lay, deco, params}})
  → {ok, results:[{nodeId, found, kind, pin, texts, lay, deco, params?}], ms}
MI_ensureVideoTracks({seqId, build, minCount}) → {ok, before, after, added}
MI_placeChunk({seqId, build, frameTicks, budgetMs:7000, items:[{key, op:place|update|replace|move|moveRegen|adopt|legacyMove,
   g, track, sf, ef, keepTime, own:{track, sf, nodeId}|null, mogrtPath, durSec, params:[ParamDef], name|null,
   guard:[nodeId], motion|null, removeAfter|null}]})
  → {ok, done, results:[{key, status:placed|updated|replaced|moved|adopted|partial|conflict|ambiguous|locked|stale-plan|misplaced|failed,
      track, sf, ef, g, nodeId, clamped, reason, texts, lay, pin, skipped, keyed, before, motion, deco}], damaged:[nodeId], dur, comps, ms}
MI_removeClips({seqId, build, items:[{key, track, nodeId, expectName|null}]})
  → {ok, results:[{key, status:removed|notFound|notOurs, before:{track, sf, ef, name, kind, m, pi, params}}]}
MI_setMotion({seqId, build, items:[{key, g, track, nodeId, x, y}]}) → {ok, results:[{key, status:applied|keyframed|notFound|ambiguous|failed, x, y}]}
```

- **MI_placeChunk 처리 순서**:
  - 1차 루프: 모든 before를 읽는다.
  - 2차 루프: 항목마다 따로 try/catch로 실행한다.
    - 트랙과 잠금을 확인한다.
    - update/adopt → 안전하게 쓰고, 끝을 자르고, 이름을 쓴 뒤 다시 읽어 확인한다.
    - place/moveRegen/legacyMove/replace → 범위를 다시 확인하고, guard를 스냅샷하고, P/R/C 분기로 놓는다. importMGT가 돌려준 TrackItem을 쓰거나 nodeId 차집합으로 찾는다. 다른 트랙에 놓였으면(#14) 지운다. 그 뒤 속성, 이름, readback, guard 재확인을 한다.
    - move → TrackItem.move.
  - 예산 7000ms를 넘으면 새 항목을 시작하지 않는다.
- **텍스트 비교**: NFC 비교는 **패널**에서 한다. ES3에는 normalize가 없다. 호스트는 nodeId로만 지운다.
- **패널 어댑터**: `host.mi.*`는 `_callMi(MI_PREFIX + name, payload)`를 부르고, build와 seqId를 자동으로 붙인다.

---

## 8. UI

- **공통**: 화자 표가 없으면 v27과 같다. 추가되는 것은 배지, 병합 선택, 병합 후 배지와 '안전하게 적용', 안전 지점 섹션, 부팅 안내뿐이다.
- **상단**: `#srtInput`은 플래그가 켜졌을 때만 multiple이다. 부팅 게이트 안내 문구를 보여 준다.
- **`#importModal` "SRT 가져오기"**:
  - 열: 파일 | 캡션 트랙 | 화자 | 기본 프리셋 | 줄 | 처리
  - `.imp-stats`, `.imp-info`
  - 분배 모드: 첫 행 "기존 목록 (화자 없음, 64줄) → C1 30 · C2 28 · 확인 필요 2 · 짝 없음 4"와 `#impLegacyMode`
  - `#impKeepPanelEdits`, `#impError`, `#impOk`("가져오기"/"그래도 가져오기"), `#impCancel`
- **showChoice** (`#confirmAlt`를 추가한다):
  - 병합/교체
  - ▶ 확인: "바뀐 줄 N개(시간 변경 M개 포함)와 구조가 바뀐 줄 K개가 있습니다. …" [안전하게 적용 (N)] [지금 방식으로 전체 적용] [취소]
  - 인코딩 확인
  - 프리뷰 시퀀스 경고: "…V1의 0~5초 영상이 잘릴 수 있습니다." [취소] [그래도 읽기]
- **`#castBar`**: 화자 한 명에 한 줄로 보여 준다.
  - 항목: 색 점, 키, 이름, 트랙("자동 (V4)"), 기본 프리셋, 줄 수, ⟳, 위치(4단계), ⋯
  - ⋯ 메뉴: 기본 프리셋 일괄 적용(안전 지점 + 확인), 이 화자 줄 선택, 위치만 다시 적용, 화자 삭제
  - 색은 왼쪽 3px 줄로 표시한다.
  - `refreshAllSelects`가 renderCastBar를 부른다.
  - `#castToast`
- **`#speakerChips`**:
  - `_reapplyFilters()`는 `_filtersReady`가 false면 바로 돌아간다(부팅 TDZ).
  - renderAll 뒤와 className을 다시 쓰는 모든 곳(3437, 3449, 3488, 3507, 4215, 4293, 4303, **1651**)에서 부른다.
  - '전체 선택'은 보이는 줄만 고른다.
- **행**:
  - `.sub-num` "C2·12"
  - `.sub-mm` 색: text 파랑, time 주황, new 초록, conflict 빨강, check 회색, restored 청록, undone 보라
  - `.sub-warn`
  - `.sub-res`: 충돌 / 잠김 / 중복 / Premiere에서 고침 / 속성 N개 적용 안 됨 / 옛 버전 템플릿 / 효과 있어 제자리
  - `.sub-struct` "구조", `.sub-orph`, `.sub-sugg`
- **`#selectAllBar`**: `#btnSelectChanged` "변경 줄 (N)", `#btnWarnFilter`, `#btnSuggestions`/`#suggDropdown`.
- **적용 바**: `#trackSelLabel`(트랙/기본 트랙), `#castTrackSummary`, `#btnVerify` "검수", `#btnApply`.
- **`#preflightModal` "적용 전 점검"**:
  - 요약 줄은 §6에 나온 문구 전부다.
  - 체크박스:

    | id | 문구 | 기본 |
    |---|---|---|
    | `#pfAdopt` | 태그 없는 기존 클립 N개를 이 목록 클립으로 인식 | certain만 켬 |
    | `#pfAdoptForeign` | 다른 시퀀스에서 온 태그 클립 N개를 이 목록 클립으로 인식 | certain만 켬 |
    | `#pfMoveLegacy` | 기본 트랙(V3)에 있던 옛 클립 N개를 화자 트랙으로 옮기기 | 켬 |
    | `#pfOrphans` | 목록에서 빠진 줄의 클립 지우기 | 고치지 않은 것만 켬 |
    | `#pfCleanupStale` | 중단된 적용이 남긴 옛 클립 지우기 | 켬 |
    | `#pfReplaceMissing` | Premiere에서 지운 클립 다시 놓기 | 켬 |
    | `#pfOverwriteEdited` | Premiere에서 고친 클립 덮어쓰기 | 끔 |
    | `#pfRestoreMoved` | 옮긴 클립을 자막 시간으로 되돌리기 | 끔 |
    | `#pfMoveDecorated` | 효과·키프레임이 있는 클립도 다시 놓기 (효과가 사라짐) | 끔 |
    | `#pfUpgradeOld` | 옛 버전 MOGRT 클립을 새 버전으로 교체 | 끔 |

  - 버튼: `#pfOk`, `#pfCancel`
- **`#miBusy`**: 진행률, 워치독 문구, [중지].
- **히스토리 드롭다운**: `#btnUndoApply` "↶ 마지막 적용 되돌리기 (12:03 · 120줄)", `#historySafety` "안전 지점" 섹션. 복원하기 전에 "히스토리 복원 전"을 남긴다.
- **후반 작업**:
  - `.fid-badge` / `.cap`, 클릭하면 주소를 복사한다.
  - `.sugg-box` "AI 제안 (Codex): 날씨$$하늘 — ✓ 본문에 있음" [적용] [무시]
  - `.field-warn`
- **`#verifyModal` "타임라인 검수"**: 정상 · 타임라인에 없음 · 옮겨짐 · 같은 태그 중복 · 옛 세대 · Premiere에서 고침 · 옛 버전 템플릿 · 효과·키프레임 · 미적용 · 목록에 없는 클립. 읽기만 한다.
- **휴지통**: "C2·12 (병합)". 복원하면 (startSec, castOrder) 순서에 넣는다.

---

## 9. 호환성, 마이그레이션, 롤백

- **로드**:
  - 두 로더 모두 mi를 **항상** 넣는다.
    - 파일에 mi가 있으면 `miFromFile`(salt, hwm, applied 유지)
    - spk 줄이 있고 유효한 cast.json이 있으면 거기서
    - 둘 다 아니면 `miDefault()`
  - `miRestoreFrom`은 히스토리·작업 파일 복원에만 쓴다.
  - 단일 화자 세션은 키 4개 그대로 왕복한다.
- **세션 생명주기**(S1-3):
  - 키가 바뀌었는데 session.json이 **없으면** 세션을 초기화한다. 같은 프로젝트든 다른 프로젝트든 같다.
  - 파일이 **있는데 읽지 못하면** 메모리를 유지하고 그 키로는 저장하지 않는다.
  - presets.json이 없으면 v27처럼 프리셋을 그대로 가져간다. proj_8oybc8만 파일이 있다.
- **실제 캐시 사실**(읽기 전용):
  - 프로젝트 4개, 시퀀스 폴더 144개, default_seq에 세션이 있다.
  - 비어 있지 않은 세션 4개: 21 / 61 / 33 / 14줄.
  - 옛 구조 94줄. 패널에서 캡션을 고친 줄 5개. 여러 줄 자막 0개.
  - 프리셋: preset_1, 2, 3, 4, 6, 8이 있고 nextPresetId는 2다. 휴지통에는 다른 preset_2가 있다.
- **realcache 테스트**가 확인하는 것:
  - 왕복하면 JSON이 같다.
  - T1 해석이 129줄에서 맞다.
  - namedParams와 isV27Unsafe가 정확히 94줄에서 참이다.
  - 다음 프리셋 id는 preset_9, 그다음은 preset_10이다.
  - 내보낸 프리셋을 다시 가져오면 id가 유지된다.
- **길에서 고치는 버그**:
  - 프리셋 id 재사용
  - 프리셋 가져오기
  - SRT 로드 히스토리가 로드 뒤 상태를 저장함
  - 복원·불러오기에 스냅샷이 없음
  - 같은 내용의 자동저장
  - index로 쓰기
  - v27 재적용 키 (코드는 두고 안전 경로로 우회)
  - getMogrtParams가 V1을 자름
  - 정의 패치 캐시
  - 빈 세션 파일
  - 3515 TypeError
  - renderAll 초기화
  - 프리셋 저장이 후반 작업을 지움
  - trackValue 저장
  - 부팅 경쟁
  - 프로젝트 누수
  - 필터 재적용과 1651
  - 휴지통 위치 복원
  - 번호 충돌
  - 배포 백업 위치
- **바꾸지 않는 것**:
  - v27 호스트 함수 (updateClipAtTime이 못 찾으면 insertClip으로 미는 동작 포함)
  - 단일 화자 ▶가 Essential Graphics 수정을 덮어쓰는 동작
- **롤백**:
  - `tools/deploy_prod.sh --rollback v27`. Premiere를 닫은 상태에서만 돌린다.
  - 설치 프로그램은 쓰지 않는다.
  - v27은 새 키를 무시하고, 다음 저장 때 mi를 버린다. v28로 돌아오면 유효한 cast.json에서 복원하고, 안 되면 문장 기준으로 채택한다.
  - DEV는 MID_라 서로 영향이 없다.

---

## 10. 화자별 화면 위치 (4단계)

- **범위**: MOGRT에는 위치 파라미터가 없다(Q6). Motion Position은 MOGRT 기준 0~1이고 (0.5, 0.5)가 원래 자리다.
- **`cast[K].pos`**:
  - null(기본)이면 Motion을 건드리지 않는다.
  - 원래 자리 (0.5, 0.5) / 왼쪽 (0.35, 0.5) / 오른쪽 (0.65, 0.5) / 위 (0.5, 0.35) / 직접 입력.
  - ±0.15는 S4-3에서 검증한다.
- **호스트**: `MI__motionPos`
  1. matchName "AE.ADBE Motion"의 첫 속성을 찾는다.
  2. isTimeVarying이면 keyframed를 돌려주고 쓰지 않는다.
  3. 아니면 setValue 후 다시 읽어 ±0.001 안인지 확인한다.
  - setTimeVarying(false)는 절대 부르지 않는다.
  - (S4-1 구현) Position 속성 하나의 키만 본다: 템플릿의 Opacity 페이드 같은 다른 키는 막지 않는다. isTimeVarying이 예외를 던지면(키 여부를 모름) 쓰지 않고 failed.
    받는 값은 유한한 숫자이고 ±10 안이어야 한다 (쌓기는 0 밑으로 갈 수 있지만, 그 밖은 픽셀 좌표를 잘못 보낸 것으로 보고 bad-item).
  - (S4-1 구현) `MI_placeChunk`는 작업이 끝나 클립이 남은 결과(placed·updated·replaced·moved·adopted·partial)에만 motion을 쓰고, 결과에 `motion`(none|applied|keyframed|failed)·
    `pos`(쓴 뒤 값)·`pos0`(기존 클립 update·adopt·move의 쓰기 전 값 — 되돌리기용)를 둔다. 위치를 쓰지 못해도 작업 상태는 바꾸지 않는다.
    'before' 스냅숏(`MI__snapOf`: move·replace·moveRegen·legacyMove·removeClips)에 `pos`·`posKeyed`를 더했다 (옛 클립을 되놓을 때 위치도 되돌린다).
    replace가 실패해 호스트가 옛 템플릿을 되놓을 때(`MI__restoreOld`, restored-old)도 스냅숏 위치를 되쓴다 (키가 있던 Position은 되살리지 못해 detail로 알린다).
    `MI_readClipTexts`는 `want.pos`면 `pos`·`posKeyed`를 준다.
  - (S4-1 구현) `MI_setMotion`은 spec 상태에 `locked`(잠긴 트랙, 풀지 않는다)를 더하고, key가 uid면 이름의 태그(uid·g)를 확인한다(다르면 notFound reason tag).
    같은 태그 클립이 둘이면(자르기) ambiguous. 결과에 쓰기 전 값 `x0`·`y0`, 예산 7초와 `done`(placeChunk와 같다), 200개 상한.
- **재배치 클립**(moveRegen, legacyMove, replace)에는 pos를 다시 적용한다. 효과가 있는 클립은 기본적으로 다시 놓지 않는다.
- **동시 발화 쌓기**(기본 끔): `stackLevels`로 동시에 보이는 묶음 안에서 castOrder 순서로 층을 매긴다. y = y0 − 층 × stackDy × 줄 수.
  - (S4-2 리뷰) 층은 줄마다 매긴다: 그 줄과 실제로 겹치는 castOrder가 앞선 화자 줄들의 가장 높은 층 + 1 (없으면 0). 동시에 보이는 줄끼리는 늘 castOrder 순서로
    서로 다른 층이고, 겹침이 사슬처럼 이어진 묶음(A-B, B-C)에서도 겹치지 않는 화자 때문에 더 올라가지 않는다. 줄 수(lineFactor)는 묶음 전체의 최댓값 그대로다.
  - (S4-2 리뷰) 위치가 '변경 안 함'인 화자의 쌓은 줄은 (0.5, 0.5)가 아니라 그 줄 클립의 지난 자리(applied: 쌓았던 줄은 mb, 아니면 mo)에서 쌓는다 — null은 클립을 되돌리지 않는다.
- (S4-2 구현) **의도 해시**: 위치는 기본 해시 위에 얹는다 (`intentBase` + `motionHash`). 위치가 없으면 v1.2의 해시와 바이트까지 같아 올리기만 해서는 아무 줄도 다시 보내지 않는다.
  applied 항목에 `mo`(클립에 있다고 보는 위치)·`hb`(위치를 뺀 기본 해시, mo가 있을 때만)·`mb`(쌓기 전 자리, 쌓았을 때만)를 더했다 — 위치가 없던 줄의 항목 모양은 그대로다.
  기본 해시가 지금과 같고 위치만 다르면 계획은 되읽기 없이 **위치만 보내는 update**(속성 0·이름 null·keepTime)를 만든다 (`plan.motionOnly`, 점검 창·검수 '위치가 바뀜').
- (S4-2 구현) **null = 건드리지 않음**의 뜻: 같은 클립 작업(update·move)은 위치를 보내지 않고 해시에는 지난 위치(applied.mo)를 이어 받는다. 새 클립이 생기는 작업
  (place·replace·moveRegen·legacyMove·순환을 끊은 놓기)과 인식(adopt)은 지난 위치를 다시 보낸다 — 다시 놓은 클립은 템플릿 기본 위치에서 시작해 위치를 잃기 때문이다.
  쌓았던 줄(applied.mb)이 이제 쌓이지 않으면(쌓기 끔·동시 발화가 사라짐) 쌓기 전 자리로 되돌린다. lineFactor는 묶음에서 가장 줄이 많은 자막의 줄 수다.
- (S4-2 구현) 위치를 쓰지 못한 줄(키가 있는 Position·되읽기 실패)은 applied.h를 비우고 mo는 지난 값으로 둔다 → 다음 ▶가 그 줄에 위치만 다시 보내고 또 알린다
  ('키프레임이 있어 위치를 바꾸지 않음', 상태 줄 '위치 키프레임 N'). 사용자의 애니메이션은 늘 그대로다.
- (S4-2 구현) **위치만 다시 적용**(⋯)은 `MI_setMotion`만 부른다 (40개씩). 쓴 줄은 applied의 mo·mb와 h(= hb + 새 위치)를 고쳐 다음 ▶가 그대로로 본다.
  last_apply에 새 기록(updated, 속성 없음, 쓰기 전 위치 `pos0`)을 남기므로 '↶ 마지막 적용 되돌리기'는 이 위치 변경을 되돌린다 (그 전 ▶ 기록 대신).
  기록은 위치를 하나라도 쓴 때만 바꾼다 — 모두 키프레임·실패이거나, 첫 호출이 실패하거나, 쓰기 전에 중지하면 그 전 ▶ 기록이 그대로 남는다.
- (S4-2 구현) **되돌리기**: 같은 클립의 위치를 바꾼 기록은 `pos0`(호스트 결과)로 update에 위치를 싣고, 다시 놓는 옛 클립은 'before' 스냅숏의 위치(키가 없고 원래 자리가
  아닐 때)로 놓는다. 덮인 이웃을 스냅숏으로 다시 놓을 때(`repairOps`)도 스냅숏 위치를 쓴다 (`_miSnapRead`가 want.pos로 읽는다).
- (S4-2 구현) 새 화자는 프로젝트 `cast_defaults.json`의 위치를 기본값으로 받는다 (이름·프리셋·색과 같다. 없으면 null = 건드리지 않음). 화자 표 머리의
  `#castStackChk`·`#castStackDy`는 화자가 둘 이상일 때만 보인다.
- **테스트**: 읽기 확인, 키프레임 보존, 40개 10초 이내, 재배치 뒤 pos 재적용, 사용자 눈으로 확인.

---

## 11. AI 준비와 5단계 MCP

- **주소**: uid, T-ID + fieldSignature, 라벨 → `resolve`.
- **`runCommand`**:

  | 커밋 | 명령 |
  |---|---|
  | S1-5 | status(coreHash), rows(index, label), resolve, presets, cast.get, session.snapshot |
  | S1-7/S1-8 | importSrt, mergePreview, mergeCommit |
  | S2-4 | plan, apply |
  | S3-1 | cast.set, suggest, sugg.*, verify |

  - agent가 보내는 변경 명령은 M5.4 전까지 needs-approval이다.
- **드리프트 방지**(검증 반영): heartbeat에 `extPath`, `build`, `coreHash`를 싣는다. 서버는 **설치된** app.js의 core region을 읽고, 해시가 다르면 쓰기 도구를 거부한다.
- **서버**: stdio, 상태 없음, 파일 인박스(`%APPDATA%/MogrtImporter/bridge`).
  - 스키마는 평평하게 쓴다.
  - 결과는 content[0].text에 JSON으로 넣는다.
  - 호출은 20초 안에 끝낸다. 길면 job으로 돌린다.
- **도구**:
  - 읽기: get_status, list_presets, get_cast, get_rows, **find_row**, get_suggestions, plan_apply, verify_timeline
  - 쓰기: set_cast_proposal, suggest_fields, request_apply, wait_job, import_srt
- **Codex 설정**: `[mcp_servers.mogrt_importer] command="node" args=[".../mcp/server.mjs"] startup_timeout_sec=20 tool_timeout_sec=60`
- **Claude 설정**: `claude mcp add mogrt_importer -- node .../mcp/server.mjs`
- **단계**: M5.0 스파이크 → M5.1 인박스 → M5.2 읽기 → M5.3 제안 → M5.4 승인 카드 → M5.5 Claude.

---

## 12. 단계별 커밋

각 커밋이 끝나면 다음을 지킨다: `npm test`, JSX를 바꿨으면 `npm run lint:jsx` + Premiere 재시작 + 단일 화자 골든 케이스, 해당 커밋의 하드 테스트를 통과한 뒤 커밋한다.

### 0단계 (3.5일)

#### S0-1 test: node 하네스, ES3 린트, v27 골든, 롤백 태그

- **파일**: package.json, tests/lib/loadRegions.js, tests/lib/es3lint.js, tests/unit/legacy_parseSRT.test.js, tests/fixtures/srt/*
- **변경**:
  - test 스크립트: `node --test "tests/unit/**/*.test.js" "tests/compat/**/*.test.js"` (글롭 필수)
  - `loadRegions`, `loadHostPure`, `regionHash`
  - es3lint 금지 목록: let, const, =>, 템플릿 문자열, 배열 고차 함수, 배열 indexOf, trim, Object.keys, Object.create, bind, Date.now, normalize, get/set, 예약어 속성, JSON.*
  - `git tag v27 0aa8b82`
- **테스트**: CR/LF/CRLF, 번호 재매김, 빈 줄 제거, BOM 첫 줄 유지, U+2028 통과. 린트 자체 테스트.
- **완료**: 2초 안에 초록. extension 변경 없음.

#### S0-2 tools: DEV 설치(MID_), 캐시 안전 배포, CDP 러너

- **install_dev.sh**:
  - 번들·패널 id에 .dev를 붙이고, 메뉴 이름에 (DEV)를 붙이고, 포트 7778을 쓴다.
  - `\bMI_ → MID_`로 바꾼다.
  - dev-sha 빌드 스탬프를 찍는다.
  - `--seed-cache`
- **deploy_prod.sh**:
  - Premiere가 실행 중이면 거부한다.
  - extensions/ 밖으로 백업하고 검증한다.
  - prod-sha 스탬프를 찍는다.
  - 지우지 않고 복사한다.
  - `--dry-run`, `--rollback`
- **guard.js**: MI_test.prproj와 T_ 시퀀스에서만 돌아간다.
- **완료**: DEV가 별도 메뉴로 뜨고, 운영 폴더·포트·캐시는 그대로다.

#### S0-3 spike: 남은 실측 (배포하지 않음)

- **기존 항목**: a~p
  - a 분기 P + in/out 복원
  - b 머리 복원
  - c 기본 길이
  - d 줄바꿈 (사용자가 눈으로 확인, 불확실은 통과가 아님)
  - e 격리
  - f 네이티브 순서 (수동)
  - g isTimeVarying
  - h 페이로드
  - i 캡션 내보내기 (사용자)
  - j 실행 취소 단계 수 (수동)
  - k 이름
  - l 경로
  - m 읽기 비용
  - n utf-16be
  - o ticks와 zeroPoint
  - p 끝 스냅
- **새 항목**:
  - q v27 재적용 miss율과 스냅 규칙(719.6프레임)
  - r TrackItem.move
  - s 600+150 클립 스캔 비용
  - t 프로젝트 두 개와 projectItem
  - u 시작 타임코드 오프셋
  - v 없는 폰트 모달
  - w 네이티브 읽기 안정성
  - x MOGRT 재저장 뒤 importMGT 버전과 namedParams 검증
  - y getOutPoint로 D 읽기
- **완료**: docs/spike_s0.md에 18개 결정을 적는다.

### 1단계 (11일)

#### S1-1 feat(core): src/mi/core.ts

- **변경**:
  - `parseSRT(text, opts)`
  - core 함수 전부: parseCaptionKey, decodeSrtBytes(U+FFFD 비교), normText, jamo, textSim, fnv1a32, contentHash, textFields, captionFid, fieldIdMap, resolveFid, fieldSignature, layoutMismatch, paramSig, clipLs, namedParams, isV27Unsafe, setTextValue, pointSegmentsOk, ruleMaxFromComments, nextFreePresetId, remapIds, seqGuidOf, miDefault, miHasData, miFromFile, miSnapshotOf, miRestoreFrom, safeNextId, rowLabel, frameOf
  - 호출부는 바꾸지 않는다.
- **테스트**: 파일 이름 표, 디코딩 5종 + 깨진 바이트, 프리셋 모양 픽스처, namedParams, 할당기(preset_9), fnv 벡터, frameOf 5,000개 × 4개 프레임레이트에서 오류 0, miFromFile.
- **완료**: DEV가 v27과 똑같이 동작한다.

#### S1-2 fix: 프리셋 id 안전

- **변경**:
  - `_allocPresetId`(3346, 3823, 가져오기)
  - 휴지통 복원 때 id가 살아 있으면 새 id를 준다.
  - 가져오기:
    - 카운터를 초기화하지 않는다.
    - 이름과 MOGRT가 같으면 id를 유지하고, 아니면 새 id를 준다.
    - '교체'로 빠지는 프리셋은 휴지통으로 보낸다(why import).
    - migratePreset, sanitize, renderAll, refreshAllSelects를 돌린다.
- **테스트**: preset_9, preset_10. 같은 파일을 다시 가져오면 id가 그대로다. 다른 MOGRT가 들어오면 조용히 바뀌지 않는다.

#### S1-3 fix: 세션 생명주기, 렌더, 게이트, V1 보호

- **변경**:
  - state에 플래그를 추가한다.
  - `_fsReadEx`
  - 파일이 없는 키에서 초기화한다(모든 키 전환).
  - 읽기 실패면 저장을 막는다.
  - 프리셋은 v27처럼 가져간다.
  - 부팅할 때 프리셋만 읽는다.
  - 게이트: 타이머 없이 2초마다 다시 확인한다.
  - 빈 파일은 쓰지 않는다.
  - `_ensureRowParams`
  - 3515
  - trackValue 저장
  - `_filtersReady`와 bootDone
  - nextId를 초기화하지 않는다.
  - 프리뷰 시퀀스를 먼저 확인하고, 실패하면 V1 경고를 띄운다.
  - 패치 뒤에 캐시한다.
- **테스트**: 시퀀스 3개를 돌아도 파일 수가 그대로. 프로젝트 전환 네 가지 조합. 읽기 실패. 게이트. bootDone. V1 클립 그대로. 두 번째 모달에서도 패치 유지.

#### S1-4 feat: 안전 지점

- **변경**:
  - `history_safety.json`(10개, 해시 중복 제거)
  - 호출 위치: SRT, 히스토리 복원, 작업 불러오기, 프리셋 저장, 프리셋 가져오기 (리뷰 반영: 프리셋 삭제, 체크한 줄 프리셋 일괄 적용, 휴지통 비우기)
  - 자동저장은 해시가 같으면 건너뛴다.
  - 드롭다운에 '안전 지점' 섹션을 넣는다.
- **테스트**: 30분 동안 변화가 없으면 자동저장 1개. 복원한 뒤 다시 복원이 되는지. 25번 자동저장 뒤에도 안전 지점이 남는지.

#### S1-5 feat: mi, cast.json, id·salt 안전, runCommand

- **변경**:
  - `state.mi`
  - mi는 조건부로 저장한다.
  - 로더는 **항상** mi를 넣는다(miFromFile / cast.json / 기본값).
  - 사이드카
  - 작업 파일: GUID 규칙과 remapped
  - 히스토리에 mi 스냅샷
  - hwm
  - 할당기 참조에 cast 추가
  - runCommand(status, rows+label, resolve, presets, cast.get, session.snapshot)
- **테스트**: mi 누수 없음. 실제 캐시 왕복. 다른 GUID의 작업 파일은 id를 다시 매김. 같은 GUID면 id 유지. v27 저장을 흉내 낸 뒤 복원. resolve('#12').

#### S1-6 feat: T1..Tn 배지

- **변경**:
  - 행 편집기와 모달에 배지를 단다.
  - T 버튼을 누르면 캡션 표시가 옮겨간다.
  - 클릭하면 복사한다.
  - 안내 문구
  - 네이티브 이름은 S0-3 f 결과를 따르고, 덧씌울 때 displayName을 가져간다.
- **테스트**: preset_6, T 이동, 옛 구조 줄의 T1, 클립보드, 네이티브 두 번 열기.

#### S1-7 feat: 여러 SRT 가져오기 (플래그)

- **변경**:
  - 라우터
  - 플래그가 꺼져 있으면 v27과 인코딩 확인
  - 켜져 있으면 모달, `_importIntoCast`, showChoice
  - 기존 목록 위에 키 있는 파일을 가져오는 것은 S1-8까지 거부한다
  - importSrt 명령
- **테스트**: 플래그를 끈 골든, CP949 확인, 깨진 바이트, C1+C2, 같은 키 두 파일.

#### S1-8 feat: 병합, 휴지통 규칙, 레거시 분배

- **변경**: §4 전체, `distributeLegacy`, 레거시 병합 선택(S1-9까지 플래그), mm 배지, "변경 줄".
- **테스트**:
  - 병합 표 전체(trashKept/restored 포함)
  - 분배(60줄 중 58줄 이상 정확)
  - 속성 기반 테스트 1,000회
  - 1,500줄 1초
  - 복원 시험: subtitles, rowStates, trashBin이 같고, nextId ≥ 이전 값, hwm 그대로

#### S1-9 feat: 레거시 안전 적용 (v27 호스트 그대로)

- **변경**:
  - `_legacyApply`: unsafe 줄은 namedParams, "(실패"를 확인하고, ap를 기록한다.
  - ▶ 확인창에 [안전하게 적용] 선택지
  - `_legacySafeUpdateV27`: updateClipAtTime에 mogrtPath ""를 보낸다. 0.5초 안에 다른 줄이 있으면 건너뛴다.
  - ↑ unsafe 경로
  - 레거시 병합 선택의 플래그를 해제한다.
- **테스트**:
  - 20개 중 3개만 바뀌고 머리 잘림이 없다.
  - **8속성 클립 + 15속성 행 → '전체 텍스트'에 들어가고 '박스 색상'은 그대로**
  - 실패가 있으면 mm이 남는다.
  - 근처 줄은 건너뛴다.
  - 보통의 ▶는 v27과 같은 페이로드를 보낸다.

#### S1-10 feat: fid 기준 구조 맞춤, orphanFields, (선택) v1.1.7

- **변경**:
  - `rebaseRowParams`
  - 프리셋을 저장하기 전에 안전 지점을 남기고 구조를 맞춘다(psOld, orphanFields).
  - '현재 구조로 맞추기'는 사용자가 누를 때만 하고, 적용을 자동으로 부르지 않는다.
  - 선택: v1.1.7 배포.
- **테스트**: 옛 구조 픽스처, 이름이 바뀐 필드가 orphan으로 가는지, 프리셋 저장 뒤에도 T2가 유지되는지, 구조를 맞춘 뒤 안전 적용.

#### S1-11 feat: 네이티브 MOGRT 굽기(bake) 적용 — v27 네이티브 쓰기 버그 수정 (2026-09-25 추가)

- **배경**: `docs/spike_s0.md` §3-1a. Premiere에서 만든(네이티브) MOGRT의 `Source Text.setValue`는 어떤 형식이든 **빈 글자로 렌더**된다. v27 운영본의 네이티브 지원은 "성공"을 보고하며 텍스트를 지운다. `.mogrt` 사본에 문구를 구우면 정확히 렌더된다.
- **변경**:
  - core(순수): `nativeBakeKey(srcPath, srcMtime, texts)`(fnv 해시), `uuidFromHash(hash)`(같은 문구 → 같은 capsuleID → Premiere가 프로젝트 항목을 재사용), `patchNativeDefinition(defJson, texts, capsuleId)`, `patchSourceTextBlob(b64, text)`(8바이트 LE 길이 + UTF-16LE JSON의 `mTextParam.mStyleSheet.mText`).
  - 패널(Node + 이미 로드된 JSZip): `bakeNativeMogrt(srcPath, texts)` → `cache/{projKey}/baked/<key>.mogrt`. definition.json(capsuleID, capsuleName에 " [MI]", TextLayer `value.strDB[].str`)과 모든 `project*.prgraphic`(zip → gzip XML의 `<Name>Source Text</Name>` StartKeyframeValue)를 바꾼다. 같은 키가 있으면 다시 만들지 않는다.
  - 적용 경로: 네이티브 프리셋 줄은 `mogrtPath = 구운 사본`, 텍스트 params는 보내지 않는다(v27 호스트의 네이티브 분기가 다시 비우지 않도록). v27 호스트 코드는 바꾸지 않는다. 텍스트가 바뀐 네이티브 줄의 갱신은 **교체**(제자리 갱신 불가).
  - ↑(한 줄 갱신)과 프리셋 모달 미리보기도 같은 굽기 경로를 쓴다.
  - 정리: 어떤 줄도 참조하지 않는 구운 사본은 30일 뒤 지운다(프로젝트 빈의 항목은 사용자가 정리).
  - 저장: 네이티브 프리셋 줄은 단일 화자 목록에서도 `ap.nk`를 적는다 (§0.3 '저장 형식이 v27과 같다'의 의도된 예외, 키 추가만. §2.1).
  - 교체·연쇄 (리뷰 반영): v27은 새로 놓는 클립을 템플릿 길이로 먼저 놓아 창 안의 뒤 클립 머리를 자른다. 새로 놓는 줄은 문구·자리가 바뀐 네이티브 줄과 전에 네이티브로 놓았던 AE 줄(`ap.nk`, 그 AE 템플릿 길이). 창 안의 네이티브 줄은 함께 지우고 다시 놓고, 다시 놓을 수 없는 줄(AE 줄, 사본 없는 줄)은 줄에 위험을 표시하고 `ap`를 적지 않는다. `ap`가 없는 줄의 클립 자리는 v27 `getTimelineClips`(읽기만)로 확인한다. 템플릿 길이는 definition.json `sourceInfoLocalized` duration. 네이티브 클립 지우기는 적용을 시작한 작업 시퀀스가 활성일 때만 하고, 없는 트랙은 지울 것이 없는 것으로 본다.
  - 2단계 호스트(`MI_placeChunk`)의 네이티브 항목은 `bakedPath`를 받고, 텍스트 변경은 `replace`로 계획한다.
- **테스트**: 단위(블롭 왕복, 한글, 여러 TextLayer 순서, 같은 문구 → 같은 키·UUID), 하드(구운 사본 배치 후 exportFramePNG에 문구가 보임 — 사람이 확인, 두 번째 적용은 같은 프로젝트 항목 재사용, 텍스트 변경 시 교체).
- **완료**: 네이티브 프리셋으로 적용한 자막이 화면에 보인다. v1.1.7에 포함한다.

### 2단계 (13일)

#### S2-1 feat(jsx): 읽기 전용 MI_ + 어댑터

- **변경**:
  - MI_PURE
  - `MI__guard`와 헬퍼
  - `MI_ping`, `MI_getTracks`(트랙·범위 필터, 최소 읽기), `MI_readClipTexts`
  - `_callMi`: 접두사, 빌드, 이스케이프
  - 매 실행 전에 ping
  - `scanIndex`
- **테스트**: 순수 부분, 스캔, 자르기 중복, 레이아웃, 프리뷰, seq·빌드 불일치, 운영과 DEV를 동시에 로드.

#### S2-2 feat(jsx): 쓰기 호스트

- **변경**: `MI_ensureVideoTracks`, `MI__applyParamsSafe`, `MI__item`, `MI_placeChunk`(before 먼저, 작업 7종, name:null, P/R/C, 예산), `MI_removeClips`(nodeId).
- **테스트**: T1~T17. 프레임 정확도, before로 정확히 복원(AE·네이티브), 겹침 자르기, 충돌, 잠김, no-track, 이동, 중단, 자르기, 제거, 이웃, 옛 템플릿 복원, 불일치, 예산, 키프레임이 있으면 partial, **옛 버전 클립에 이름으로 쓰기**, move.

#### S2-3 feat: 화자 UI

- **변경**: castBar, 칩, 필터(`_filtersReady`, 1651), 전체 선택, 행 표시, 휴지통 라벨, usedBy, sanitize, refreshAllSelects → renderCastBar, 기본 프리셋 일괄 적용(안전 지점).
- **테스트**: 3명, 필터, 삭제, 이름이 파일 3개에 저장되는지, 프리셋 삭제, 새 프리셋 반영, 단일 화자 DOM이 v27과 같은지, bootDone.

#### S2-4 feat: 다화자 적용 (플래그 켜기)

- **변경**: `_miApply` 11단계(§6), `orderOps`, 미리 점검, 청크, 워치독, 청크마다 last_apply, applied와 학습 필드, ↑ 한 줄, `MI_CAST_ENABLED = true`.
- **테스트**:
  - 단위 계획 전부(나누기·합치기, 순환, 다른 salt 채택, legacyMove, oldVersion, decorated)
  - E2E a~h: 2화자, 재적용 0개, 중단 뒤 '(중단된 적용)', 편집 감지, ↑, 레거시 분배, 시퀀스 복제, 긴 타임라인

#### S2-5 feat: 정리, 되돌리기, MI_ 레거시 안전 경로

- **변경**: 1단계 제거, 되돌리기 가드 6범주, `_legacySafeApply`, ↑ 경로, v27 ▶는 superseded로 표시.
- **테스트**: 되돌린 뒤 속성이 정확히 같은지(AE·네이티브), 그 뒤로 바뀐 클립은 건너뛰는지, 병합으로 빠진 줄, 레거시 +0.4초, 부분 실행 되돌리기.

### 3단계 (5.5일)

#### S3-1 runCommand 전체

- cast.set, suggest, sugg.list, plan, apply, verify, resolve.
- agent는 needs-approval, 안전 지점, "AI: …" 라벨.
- (S3-1 구현) 명령: cast.set {items}, suggest {items: [{uid, fid, value, sig, by?, note?, cap?}]}, sugg.list {uid?}, sugg.approve·sugg.reject {items | all} (ui·test만),
  plan {ids | uids | spk} → planToken, apply {planToken}(또는 plan과 같은 인자), verify(읽기만), approvals.list·approve·reject (ui·test만). importSrt·merge*의 files는 {path}도 받는다 (5단계 import_srt).
- (S3-1 구현) agent의 바꾸는 명령(importSrt·mergeCommit·apply·undo·cast.set)은 실행하지 않고 **승인 대기열**(메모리, 10분, 시퀀스가 바뀌면 버림)에 넣고
  needs-approval + rid를 돌려준다. approvals.approve {rid}가 승인 단계다: 안전 지점 'AI: <명령> 전' → 실행 → 그동안 남는 히스토리·안전 지점 이름은 'AI: …'.
  M5.4 승인 카드는 이 대기열을 보여 주기만 하면 된다. suggest는 agent도 바로 된다 — 제안 대기열 자체가 승인 단계이고 속성·타임라인에 쓰지 않으므로
  안전 지점을 남기지 않는다(안전 지점 10개를 제안이 밀어내지 않게, spec과 다른 점). sugg.approve·sugg.reject·approvals.*는 agent가 부르면 needs-approval(대기열에 넣지 않음).
- (S3-1 구현) ctx.seqId·ctx.build가 있으면 지금 시퀀스·패널 빌드와 비교한다(seq-mismatch·build-mismatch). 바꾸는 명령은 적용 중(_miBusy) busy이고 무작업 자동저장 시계를 되돌린다.
  ui·test의 cast.set은 화자 표 칸과 같은 함수(_castSetItems)라 안전 지점을 남기지 않는다(칸을 고칠 때마다 안전 지점이 쌓이지 않게) — 히스토리 자동 항목만.
- (S3-1 구현) validateSuggestion(core)과 verifyReport(core)·_miVerify는 S3-2·S3-3 몫이지만 suggest·verify 명령이 쓰므로 여기서 넣었다 (UI는 S3-2·S3-3).

#### S3-2 AI 제안 대기열

- validateSuggestion, `.sugg-box`, 일괄 적용 전 안전 지점, 경고 필터.
- (S3-2 구현) 행 머리 `.sub-sugg` "AI"(모두 낡았으면 회색, 누르면 속성창을 연다 — 속성창이 없는 줄은 확인창 [검증 통과만 적용] [모두 무시] [닫기]),
  속성창의 그 필드 블록 입력 칸 아래 `.sugg-box` "AI 제안 (Codex): 날씨$$하늘 — ✓ 본문에 있음" [적용] [무시] (자유 문구 "! 본문에 없는 문구",
  낡은 제안은 회색·[적용] 꺼짐 "캡션이 바뀌어 다시 확인이 필요합니다"), 속성창에 없는 필드의 제안은 속성창 맨 위 `.sugg-extra`,
  병합 포인트 확인(rs.warn)은 필드 아래 `.field-warn`. 캡션을 고치면 제안 칸이 바로 낡은 것으로 바뀐다.
- (S3-2 구현) 선택 바 `#btnWarnFilter` "경고 (N)"(누르면 경고 줄만, 다시 누르면 모두)와 `#btnSuggestions` "AI 제안 (N)" + `#suggDropdown`
  [제안 줄만 보기] [검증 통과만 적용](안전 지점 'AI 제안 적용 전' 하나) [모두 무시](확인창). 두 필터는 `_markFilter` 하나(`.mark-filter-hidden`)이고
  숨긴 줄은 체크를 푼다. 보일 줄이 없어지면 필터를 푼다.
- (S3-2 구현) 병합: 캡션이 바뀐 줄은 제안을 모두 지우고(S1-8 그대로), 병합이 건드린 다른 줄은 낡은 제안만 지운다. 건드리지 않은 줄의 낡은 제안은 회색으로 남는다
  (같은 파일 재병합이 '변경 없음'이어야 해서). 레거시(화자 없는) 줄은 제안을 승인해도 mm을 달지 않는다 (S3-1 기록).

#### S3-3 검수와 ⟳

- 읽기 전용 보고서(옛 버전·효과 포함), 클릭하면 해당 위치로 이동, ⟳와 토스트.
- (S3-3 구현) `#btnVerify` "검수"(다화자 적용 바) → `_miVerify`(S3-1): ping → getTracks(V1 뺀 모든 트랙, 시간 제한 없음) → readClipTexts(화자 줄의
  현재 클립, 40개씩) → planPlacement 마른 계획(`plan.intentOf`: 지금 의도 해시) → core `verifyReport`. 호스트 쓰기 없음, 굽기 없음(네이티브는 키만 계산),
  salt가 비었으면 표본으로 찾되 저장하지 않는다. `#verifyModal` "타임라인 검수": 요약 "정상 · 타임라인에 없음 · 옮겨짐 · 같은 태그 중복 · 옛 세대 ·
  Premiere에서 고침 · 옛 버전 템플릿 · 효과·키프레임 · 미적용 · 목록에 없는 클립"(0 포함), 분류별 목록, 줄을 누르면 목록의 그 줄을 표시하고 재생 헤드를
  그 클립 시작(지운 클립은 마지막 적용 자리)으로 옮긴다(v27 seekToClip). 분류 규칙은 core `verifyReport` 주석: 옮겨짐 = 클립 자리가 마지막 적용
  (applied.t·sf·cef)과 1프레임 넘게 다름, 미적용 = 놓인 적 없음·변경 표시(mm)·템플릿 바뀜·의도 해시가 applied.h와 다름·적용 기록 없음.
  네이티브 클립은 문장을 읽을 수 없어 다른 분류가 없으면 정상 대신 "확인 불가(네이티브)"로 센다 (요약 끝에 붙는다, spec에 없는 분류).
- (S3-3 구현) 화자 표 `.cast-reimport` ⟳: cast[K].path를 Node fs로 읽어 가져오기 창을 그 화자의 병합으로 연다 (파일 이름에 C번호가 없어도 그 화자).
  경로가 없거나 읽지 못하면 `#srtInput` 파일 대화상자 — 2분 안에 고른 파일 하나에 C번호가 없으면 그 화자로. 가져오기 명령의 {path}도 경로를 남긴다.
- (S3-3 구현) `#castToast`: 3초마다 경로를 stat(`cep.fs.stat`에는 수정 시각이 없어 Node fs `statSync`)해 크기가 다르거나 수정 시각이 1초 넘게 다르면
  "영희(C2) 파일이 바뀌었습니다 [병합 미리보기] [닫기]". 적용·검수 중(_miBusy), 가져오기 창이 열렸을 때, 패널이 숨었을 때, 시퀀스 확인 전에는 쉰다.
  스스로 병합하지 않는다. 같은 바뀜은 한 번만 알린다([닫기]도). 시퀀스를 바꾸면 알림·검수 창을 닫는다.
- (S3-3 리뷰) ⟳가 연 대화상자를 취소하면 change가 오지 않는다: ⟳ 키는 ⟳를 누른 시퀀스(_importSeqToken)에서만 쓰고, 📂 SRT 열기가 `#srtInput`을
  열거나(input click) 시퀀스가 바뀌면 잊는다 (전에는 2분 동안 보통 SRT 열기의 C번호 없는 파일 하나가 그 화자의 병합으로 갔다).
  다른 화자의 ⟳는 보이는 알림을 '본 것'으로 만들지 않는다 (창을 닫으면 다시 알린다).
- (S3-3 리뷰) 내용이 같은 파일을 다시 가져오면 여전히 '변경 없음'(목록·휴지통·히스토리·안전 지점 그대로)이지만, 경로를 아는 파일이면 화자 표의
  파일 정보(file·path·size·mtime)만 새 파일로 적고 저장한다 — 바뀜 알림의 기준이 '가져온 파일'이라, 그러지 않으면 한 화자만 바뀐 다시 내보내기에서
  나머지 화자의 알림이 패널을 열 때마다 돌아왔다. S1-7·S1-8 리뷰의 '파일 정보도 그대로'를 바꾼 것이다 (경로 없는 명령 b64는 그대로 둔다).
- (S3-1 리뷰) approvals.approve의 안전 지점 'AI: <명령> 전'은 그 명령이 인자를 모두 확인한 뒤 바꾸기 바로 앞에서 남긴다 (`_aiSafetyFlush`):
  틀린 요청(bad-args·not-found)은 안전 지점을 남기지 않는다.
- (S3-2 리뷰) 제안을 승인하면 그 줄의 포인트 경고(rs.warn)를 새 값·지금 캡션으로 다시 본다 (core `recheckPointWarn` — 풀린 경고는 빼고 새 경고는
  만들지 않는다) → '!'·`.field-warn`·'경고 (N)'에서 빠지고, 마지막 경고였으면 경고 필터가 풀린다. 패널에서 손으로 고친 값은 전처럼 다음 병합이 다시 본다.
  validateSuggestion은 공백뿐인 '$$' 조각을 empty로 거절한다.

#### S3-4 E2E 모음

- 단일 골든, 3화자, 레거시 안전, 옛 구조, 분배, 복제, 나누기·합치기, 실제 세션, 성능.
- (S3-4 구현) 테스트만 더했다 (제품 코드 변경 없음). spec 항목과 케이스:
  (1) 단일 골든 = 하드 s1_1(가져오기·프리셋·▶·↑, S3-4 리뷰로 ↑ 추가) + node panel_golden(▶는 v27 app.js와 같은 페이로드, ↑는 v27 app.js와 나란히 돌려
  updateClipAtTime 글자·상태·session.json이 같음), (2) 3화자 가져오기·병합·적용·다시 적용 0개·되돌리기 = 하드 **s3_4_e2e** (A)(B)
  (2화자는 s2_4·s2_5), (3) 레거시 병합 + 안전하게 적용 = s2_5 (4)(MI_)와 s1_9·s1_10(v27 대체 경로), (4) 옛 구조 줄 = s1_9·s1_10, (5) 레거시 → 화자 나누기 =
  s2_4 (f) + realcache (S3-4, 실제 세션을 번갈아 C1·C2 합성 파일로 분배 — 메모리에서만), (6) 복제 시퀀스 = s2_4 (g), (7) 나누기·합치기 = **s3_4_e2e** (B)
  + node panel_e2e, (8) 실제 세션 열기·합성 다시 내보내기 병합·T_ 시퀀스에 적용 = 하드 **s3_4_real**(DEV 캐시 사본, `install_dev.sh --seed-cache`)
  + realcache (S1-8·S3-4, 읽기 전용: 같은 세션·같은 C1·C2 SRT로 분배까지 패널 하네스, 적용까지 premiereSim). 성능 = s3_4_e2e (C) (3화자 × 40줄)
  + (D) T_BIG 스캔 + s2_4 (h).
- (S3-4 구현) s3_4_e2e: (A) V4~마지막 트랙마다 남의 클립을 깔아 C2·C3가 새 트랙을 쓰게 해 점검 창 줄(계획한 트랙·새 트랙 2개)을 늘 본다. 줄마다
  클립 시작·끝 = 자막 ±1프레임. (B) 나누기·합치기는 문장도 다듬어(유사도 0.5 밑) 가져오기 창이 '나눔·합침 확인 2 · 새 줄 1 · 빠짐 1'을 보인다 —
  문장을 이어 붙이기만 한 나누기·합치기는 긴 쪽 유사도가 0.5 이상이라 '문장·시간'으로 분류된다. 뒤 조각의 템플릿 길이가 다음 줄 머리를 덮게 두어
  guard(머리 되돌리기)를 지나게 하고, 보낸 작업 순서(줄이기 → 놓기 → 늘리기)를 `hostMi.placeChunk`를 감싸 본다.
- (S3-4, spec과 다른 점) '120줄 ≤ ~100초'는 로그만 (실측 한 클립 ≈ 760 ms).
- (S3-4 리뷰) 처음 판은 'evalScript 한 번 > 8초 없음'을 10초로 늦추고 (A) 적용·검수 호출만 쟀다(다시 적용·다시 계획 호출은 버퍼를 비워 버렸고
  (B) 적용·되돌리기 전에 훅을 풀었다). 이제 (A) 적용부터 (B) 되돌리기까지 버퍼 하나로 MI 호출을 모두 재고 spec대로 8초를 단언한다 (청크 8개 ×
  ≤ 460 ms ≈ 4초라 청크 예산 7초에 닿지 않는다. 템플릿의 첫 importMGT ≈ 8.9초는 재기 전에 남의 클립·V2 예열 클립으로 치른다).
- (S3-4 리뷰) '실제 세션을 T_ 시퀀스에 적용'을 뺀 까닭(하드 케이스는 운영 캐시를 읽지 않는다)은 맞지 않았다: `install_dev.sh --seed-cache`가
  운영 캐시를 DEV 캐시로 복사하고(운영은 읽기만) 하드 케이스는 DEV 캐시를 읽는다. 하드 s3_4_real을 더했다 — 세션 고르기·작업 파일·번갈아 나누기는
  `tests/premiere/lib/realSessions.js`로 node realcache와 같은 함수를 쓰고, 프로젝트 프리셋은 스크래치 A(빈 목록)에서만 MI_test 자리에 두고 새로 고친 뒤
  시작 전 바이트로 되돌린다. 시드가 없으면 건너뛴다.
- (S3-4 리뷰) T_BIG 스캔 예산을 S0 스파이크 몫으로 남긴 것도 되돌렸다: s3_4_e2e (D)가 T_BIG(V1 600·V3 150)을 잠깐 활성으로 두고 지금의
  `MI_getTracks {tracks: null}` 한 번의 호스트 ms < 3초(S0-3 결정 12)를 단언한다 (읽기만, V1까지 읽는 스캔은 로그만).
- (S3-4 리뷰) 하드 ▶ 도우미(`hard.js` `miApplyButton`)는 시간이 넘으면 '시간 초과(…ms): …' + 마지막 진행·워치독 문구로 실패해 스위트의 모달 안내가
  붙는다. s3_4_e2e의 정리는 cast_defaults.json을 먼저(try) 되돌리고 페이지 훅·플래그를 하나씩 푼다.

#### S3-5 v1.2.0 배포

- README(한국어): 설치 프로그램 금지, 텍스트 편집만 감지, 옛 버전은 이름으로 갱신.
- 백업하며 배포한 뒤 7777 스모크.

### 4단계 (3일)

- **S4-1**: `MI__motionPos`, `MI_setMotion`, placeChunk의 motion, 재배치 때 pos 재적용.
- **S4-2**: `.cast-pos`, `stackLevels`, 의도 해시, 위치만 다시 적용.
- **S4-3**: 사용자 눈으로 확인한 뒤 v1.3.0.

### 5단계 (10일, 개요)

- M5.0 클라이언트 스파이크
- M5.1 인박스와 heartbeat(extPath, coreHash)
  - (M5.1 구현) region `src/mi/inbox.ts`(commands.ts 뒤). 다리 폴더 `%APPDATA%/MogrtImporter/bridge` (APPDATA가 없으면 CEP `SystemPath.USER_DATA`).
    **DEV 빌드(dev-…)는 `bridge_dev`** — 같은 Premiere에 운영 패널이 떠 있어도 하드 테스트 명령이 운영 세션에 가지 않게 (spec에 없는 점). MCP 서버는 `MI_BRIDGE_DIR`로 고른다.
    `inbox/<id>.json`(서버, tmp → rename) → 300 ms 폴링 → 처리한 id를 `processed.json`에 먼저 적고 파일을 지운 뒤 `runCommand(op, args, {source: "agent", seqId, build, by})`
    → `outbox/<id>.json`(tmp → rename). 명령은 하나씩 차례로, 2분 지난 명령은 `expired`, 같은 id는 한 번만(다시 받으면 기억한 응답에 `dup: true`,
    패널을 다시 열어 응답을 모르면 `duplicate`). `heartbeat.json` 2초마다: `{v, at, state: "on", panel, host(30초마다 ping, 적용 중에는 묻지 않음), build, extPath,
    coreHash(= status와 같은 _coreHash: 설치된 app.js core region의 fnv1a32), seqId, seqName, projKey, seqKey, keysResolved, busy, processing, pendingApproval(승인 대기 수),
    suggestions, rows, pollMs, beatMs}`. 상단 `#aiLinkChk` 'AI 연결 허용'은 기본 꺼짐이고 꺼져 있으면 폴더를 읽지도 쓰지도 않는다.
    끌 때 한 번 `{state: "off"}`, 켠 채 패널을 닫으면(unload) `{state: "closed"}`를 쓴다 — 서버가 '꺼짐'과 '닫힘'을 가려 알리게 (spec의 'heartbeat 없음'을 이렇게 읽었다).
    켠 상태는 패널 localStorage(`MI_aiLink`, DEV는 접두사가 바뀐다)에 남아 다시 열면 켜진다. 오래된 응답(5분)·쓰다 만 tmp(2분)는 heartbeat가 지운다.
    node 쪽 클라이언트는 의존성 없는 `mcp/lib/bridge.js`(checkPanel: off·closed·낡음·없음, call: 시간 초과면 가져가지 않은 명령을 거둔다) — 서버·테스트·하드 케이스가 같이 쓴다.
    테스트: `tests/unit/panel_inbox.test.js`(하네스, 메모리 fs), `tests/unit/mcp_bridge.test.js`(진짜 임시 폴더로 하네스 패널과 왕복), 하드 `s5_inbox`.
- M5.2 읽기 도구 + find_row, 설치본 core 로드, 해시 확인
- M5.3 제안
- M5.4 승인 카드
- M5.5 Claude

---

## 13. 테스트 하네스

- **`npm test`**: 글롭. `tests/unit`, `tests/compat`(MI_REAL_CACHE, 읽기 전용, 실제 텍스트를 저장소에 넣지 않음).
- **`loadRegions`**: vm 컨텍스트, 순수성 가드, `regionHash`. `loadHostPure`.
- **픽스처**:
  - SRT(합성)
  - `tests/fixtures/mogrt/` 옛 8속성 버전 MOGRT. 사용자의 이전 파일이나 S0-3 x에서 만든다.
- **하드 테스트**:
  - DEV 7778, `MID_*`
  - MI_test.prproj: T_23976, T_2997, T_25, T_5994, T_TC1h, T_BIG(600+150)
  - closeDocument 금지
- **JSX 변경 절차**: install_dev → Premiere 종료 → 실행 후 Ctrl+O로 MI_test → DEV 패널 → `run.js --check-build` → `npm run hard`.
- **배포**: deploy_prod.sh(Premiere 종료 상태, 외부 백업, 삭제 없음, 검증, `--rollback`).

---

## 14. 위험

- index로 쓰기가 옛 버전 클립을 망가뜨린다 → 이름 확인 쓰기, oldVersion 감지, 자동으로 구조를 맞추지 않음.
- v27 재적용 키가 5~50%를 놓친다 → 안전 경로로 안내하고, README에 설명한다.
- 태그 이름을 사용자가 바꿀 수 있다 → 문장으로 채택하고, 모호하면 건너뛴다.
- 다시 놓으면 효과와 키프레임이 사라진다 → move를 실측하고, 효과가 있는 클립은 제자리에 둔다.
- 기본 5초 길이가 이웃을 덮는다 → guard, 꼬리 충돌 검사, D 저장.
- 병합이나 분배가 잘못 짝지을 수 있다 → 보수적인 임계값, 확인 필요 목록, 안전 지점, 속성 기반 테스트.
- applied가 빠지거나 낡을 수 있다 → 전체 갱신으로 돌아가고, 이것만 보고 지우지 않는다.
- 긴 타임라인에서 스캔이 느리다 → 필터를 걸고 최소한만 읽는다.
- 전역 범위를 공유한다 → MI_/MID_, 빌드 확인.
- JSX 캐시가 남는다 → ping 게이트.
- 차단과 모달 → 7초 예산, 워치독.
- SRT 이름 실수, 시작 타임코드 → 확인 절차와 경고.
- 설치 폴더 안의 캐시 → 외부 백업, 설치 프로그램 금지.
- 부팅 게이트와 프로젝트 초기화가 v27 습관과 다르다 → 안내 문구, 미결 질문.
- 위치가 상대 좌표다 → 기본은 건드리지 않고, 사용자가 확인한다.
- 네이티브 순서를 모른다 → 일반 라벨, AI 끔.
- 줄바꿈 → S0-3 d.
- Premiere Ctrl+Z → 패널의 되돌리기를 권장하고, 가드를 둔다.
- MCP 클라이언트마다 다르다 → 스파이크, 해시.

---

## 15. 미결 질문 (사용자에게 확인)

1. 패널에서 고친 문장과 다시 내보낸 SRT의 문장이 다르면 SRT를 기본으로 따를까요? (가져오기 창에 '패널 문장 유지' 체크가 있습니다)
2. 다화자 클립 이름을 '<화자 이름> [MI:k7q2-57.1]'로 해도 될까요? MOGRT 이름 뒤에 태그만 붙이는 편이 나을까요?
3. 첫 화자는 지금 고르는 기본 트랙(V3), 다음 화자는 V4, V5 순서로 괜찮을까요?
4. Premiere에서 지운 클립은 ▶를 누를 때 기본으로 다시 놓을까요?
5. Premiere에서 문장을 고친 클립은 기본으로 건너뛰고 '덮어쓰기'를 따로 둘까요?
6. 한국어 Premiere 26.5.1 캡션 내보내기에서 '인터뷰_C2.srt'처럼 이름을 정할 수 있나요? BOM, 스타일 태그, 01:00:00:00 오프셋이 붙나요? (약 5분)
7. 왼쪽/오른쪽/위 시작값(±0.15, 쌓기 0.12)을 확인해 주세요. 절대 움직이면 안 되는 MOGRT가 있나요?
8. '철수:' 라벨 한 파일 방식은 버릴까요, 4단계 뒤로 미룰까요?
9. 옛 구조 줄(6월 세션 94줄)은 이름 확인 쓰기로 그대로 안전하게 적용됩니다. 편집 화면을 위해 '현재 구조로 맞추기'를 (누를 때만) 둘까요?
10. AI 제안을 캡션이 아닌 모든 텍스트 필드(자막 2 텍스트, Title 등)에 허용할까요?
11. 1단계만 v1.1.7로 먼저 낼까요?
12. 평소 쓰는 Premiere 네이티브 MOGRT는 무엇인가요?
13. Codex는 CLI와 IDE 중 무엇을 쓰고, config.toml은 어떻게 되어 있나요?
14. 시퀀스를 열기 전에는 SRT를 열 수 없게 하고, 저장된 데이터가 없는 시퀀스로 바꾸면 빈 목록을 보여 줘도 될까요? (v27은 기본 키에 조용히 저장하고, 이전 목록을 끌고 왔습니다)
15. 기존 단일 목록을 화자로 나눌 때, 기본 트랙에 있던 C2/C3 줄의 옛 클립을 기본으로 화자 트랙으로 옮길까요? (다시 놓기 때문에 Premiere에서 넣은 효과는 사라집니다. 효과가 있는 클립은 체크할 때만 옮깁니다)
16. 지금도 ▶로 목록 전체를 다시 적용하시나요? v27의 재적용 매칭은 5~50%를 놓쳐 자막을 자를 수 있습니다. 병합 뒤에는 '안전하게 적용'을 권하고 기존 전체 적용도 남겨 두어도 될까요?
17. MOGRT 파일을 다시 저장하면 타임라인의 기존 클립은 옛 버전으로 남습니다. 기본으로 속성 이름으로 갱신할까요(새 버전에만 있는 속성은 기본값), 새 버전으로 교체할까요(Premiere에서 고친 값은 사라짐)?
18. 프리셋 가져오기를 '이름과 MOGRT가 같으면 id 유지, 나머지는 삭제 대신 프리셋 휴지통으로'로 바꿔도 될까요?

---

## 16. 검증 라운드 반영 기록

- **반영**:
  - 부팅 TDZ
  - 로드할 때 mi 처리(miFromFile, 누수 없음)
  - 프로젝트 전환 초기화 (프리셋을 비우는 부분은 거부)
  - LLM 주소 라벨 해석
  - node --test 글롭
  - S1-2와 S1-3의 순서 의존
  - v27의 '실패 포함 SUCCESS' 파싱
  - 1651 className
  - 네이티브 readParams와 before의 type
  - 정의 패치 캐시
  - 인코딩 비교 규칙
  - 복원 테스트 기대값
  - castBar 갱신
  - MCP 드리프트
  - **옛 구조 클립 (치명)**
  - **레거시 분배**
  - 휴지통 why 규칙
  - salt 복구·작업 파일 GUID·다른 salt 채택
  - 안전 지점과 자동저장 중복
  - 복원 전 스냅샷과 orphanFields
  - 프리셋 가져오기
  - last_apply 생명주기와 가드
  - 나누기·합치기 순서
  - mmPrev와 ap
  - 부팅 게이트 타이머 제거
  - **v27 재적용 키 (치명)**
  - Math.round 프레임
  - MI_/MID_ 충돌
  - projectItem 캐시
  - 스캔 비용
  - 효과가 있는 클립 재배치
  - 복제 시퀀스
  - ES3 NFC
  - es3lint
  - D 저장
  - zeroPoint
  - 활성 시퀀스 확인
  - 예산 통일(7초)
  - 모달 워치독
  - 수동 실측 규칙
  - 분기 P 복원
  - before를 먼저 읽기
  - 네이티브 rh
  - 키프레임 속성 partial
  - V1 잘림
- **일부 거부**:
  - 프리셋이 없는 프로젝트로 전환할 때 프리셋을 비우는 것. v27의 가져가기가 사용자 흐름이고, 파일이 있는 프로젝트는 하나뿐이다.
  - 복제된 시퀀스에서 다른 salt를 자동으로 받는 것. id 충돌 위험이 있어 문장 기준 채택으로 대신한다.
  - 쓰기 뒤 숫자·색 속성까지 모두 다시 읽는 것. 클립마다 비용이 두 배가 되고, 키프레임이 아닌 속성에서 조용한 실패는 관찰되지 않았다. 대신 isTimeVarying으로 미리 검사한다.
  - 게이트를 연 뒤 파일을 실제 키로 옮기는 것. 대신 가져오기를 막는다.
  - 프리셋 id를 대화상자로 다시 매기는 것. 이름과 MOGRT로 자동 매핑하는 것으로 대신한다.