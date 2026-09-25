# S0-3 실측 결과 — Premiere 26.5.1, 2026-09-25 (MI_test.prproj, DEV 패널 7778)

- 실행: `node tests/premiere/run.js --port 7778 <s03/spikes/파일>` (가드: MI_test.prproj + 활성 시퀀스 `T_…`). 원시 출력은 `s03/out/<파일>.txt`, 프레임 캡처는 `s03/out/*.png`.
- 헬퍼: `spikes/lib_s03.jsx`(전역 `S03_` 접두사, ES3, ASCII). 프리셋 데이터 `spikes/presets_data.jsx`는 운영 `presets.json`을 **읽기만** 해서 만든 사본(썸네일 제외).
- 만든 시퀀스: `T_2997`, `T_25`, `T_5994`, `T_TC1h`(시작 TC 01:00:00:00 = zeroPoint 915372057600000), `T_BIG`(V1 스틸 600개 + V2 네이티브 20개 + V3 AE MOGRT 150개). 모두 `qe.project.newSequence` + `HD 1080p … .sqpreset`로 대화상자 없이 만들었다. 끝에서 `T_23976`을 활성으로 두고 저장했다.
- 이미 측정한 항목(`docs/spike_s0_premiere2651.md` #1~#23)은 반복하지 않았다.
- 상태: ✅ 완료 · ◐ 부분 · ✋ 수동(사용자 확인 필요) · ⛔ 실행 안 함

## 1. 항목별 결과

| # | 항목 | 실행 파일 | 원시 결과 | 결론 | 상태 | 결정 |
|---|---|---|---|---|---|---|
| a | 분기 P: `projectItem.setOutPoint(len)` 후 `overwriteClip` | `a_branchP.jsx`, 대조 `w_final.jsx` | AE MOGRT 항목(in 3600 s, out 3605.005 s)에 ticks 문자열·초·Time 세 형식 모두 `setOutPoint`가 **무시됨**(getOutPoint 그대로). 30f를 원했는데 B가 [30,150) = 120f로 놓였고 이웃 N[72,192)의 머리를 잘라 [150,192)로 만듦. importMGT도 마찬가지(120f). `clearOutPoint`도 3605.005 그대로. 복원 뒤 이미 놓인 클립은 영향 없음. 대조: 스틸(bg_gray.png)에서는 `setOutPoint`가 동작(4.97 → 2.002 s) | **분기 P 불가**. MOGRT 항목의 in/out은 스크립트로 바뀌지 않는다 | ✅ | 1 |
| b | 분기 R: 잘린 이웃 머리 복원 | `b_head.jsx` | 덮어쓰기로 이웃 머리가 잘리면 start +60f, **inPoint도 +60f**, nodeId·이름·텍스트는 유지. `start`만 되돌리면 start는 복원되지만 inPoint는 잘린 채(애니메이션 앞부분 손실). **`inPoint -= Δ` 다음 `start -= Δ`** 순서로 하면 start/in/end가 원래와 정확히 같음 | 분기 R 가능(순서: inPoint → start). 단 이웃이 **통째로 덮이면 삭제**되어 복원 불가(q에서 관찰) | ✅ | 1 |
| c | 실제 프리셋 6개의 기본 길이 D | `c_len_a.jsx`, `c_len_b.jsx` | preset_1·2·3·4·6·8 모두 **120f = 5.005 s**(23.976). 다른 프레임레이트: 29.97 → 150f, 25 → 125f, 59.94 → 300f(`o1_ticks`). 네이티브(Classic Lower Third)도 120f. 첫 importMGT 270~440 ms | D는 "5 s를 프레임으로 반올림"한 값, 모든 프리셋이 같다 | ✅ | 17 |
| d | 줄바꿈: AE LF/CR, 네이티브 LF | `d_f_prep.jsx`, `d_f_export.jsx`, `d_bg.jsx`, `d_native_render.jsx`, `d_native_formats.jsx` | exportFramePNG로 본 결과: AE(preset_1) **LF·CR 모두 두 줄로 렌더**(`d1_AE_LF.png`, `d2_AE_CR.png`, 한글 `d5_AE_KO_LF.png`). 네이티브는 LF·CR·한글 **모두 글자가 안 보임**. 원인 조사: 기본값 클립(n0)은 "Insert Name Here / ADD TITLE HERE"가 보이는데, `Source Text.setValue(문자열)`를 한 필드는 **어떤 형식으로 써도 빈 글자로 렌더**(평문, JSON만, 8바이트 헤더+JSON, 4바이트 헤더+JSON: `nf_v1~v4.png`). getValue는 쓴 평문을 그대로 돌려준다 | AE: 줄바꿈 변환 불필요(LF 그대로). **네이티브: ExtendScript로 쓴 텍스트가 렌더되지 않는다(아래 §3-1)**. 사용자가 프로그램 모니터로 확인해야 확정 | ✋ | 2 |
| e | 격리: clone → 활성화 → deleteSequence | `e_isolation.jsx` | `Sequence.clone()` = true(392 ms), "T_23976 Copy" 생성 **그리고 그 사본이 활성 시퀀스가 됨**. 이름 변경 가능, importMGT 가능(원본 무변화). 원본 재활성 401 ms, `app.project.deleteSequence(seq)` = true(14 ms). 대화상자 없음. `qe.project.newSequence`도 대화상자 없이 새 시퀀스를 **활성화**함 | 격리 방법으로 사용 가능. clone 직후 활성 시퀀스가 바뀌므로 반드시 되돌린다 | ✅ | 3 |
| f | 네이티브 필드 순서 | `d_f_prep.jsx`, `f_blank_map.jsx` | 쓴 필드가 빈 글자로 렌더되는 성질을 이용해 "하나만 써서 사라지는 줄"로 대응을 확인. Classic Lower Third Two Lines: 컴포넌트 0 = "Insert Name Here"(clientControls[0]). **Basic Lower Third: 컴포넌트 0 = "Second Line is Smaller"(clientControls[0], 화면에서는 아래 줄)**, 컴포넌트 1 = "Your Name Here"(clientControls[1], 위 줄) | 컴포넌트 순서 == definition.json clientControls의 TextLayer 순서(2/2). 화면 위아래 순서와는 다를 수 있다. 필수 그래픽 패널 순서는 사용자 확인 필요 | ✋(자동 부분 ✅) | 4 |
| g | isTimeVarying: 키 있는 Motion Position, 키 있는 MOGRT 색상 | `g_timevarying.jsx` | Position: false → 키 2개 후 true. 키 시간은 **클립 inPoint 기준**(12, 72f로 되읽힘). 키 있는 Position에 setValue = true 반환, 값 무시(#8 재확인). MGT 속성 15개 모두 `areKeyframesSupported()` = true(텍스트 포함). 색상 속성 키 2개 → isTimeVarying true, v27 applyParamsToItem의 setColorValue는 **키 값 불변**(조용히 무시). 숫자 속성도 키 10/90 불변 | isTimeVarying으로 키 있는 속성을 정확히 감지. v27 쓰기는 키 있는 속성에서 조용히 실패 | ✅ | (MI__applyParamsSafe keyed) |
| h | 페이로드: preset_6 8개 항목, 한글 | `h_payload.expr.txt` | 8항목(속성 15개씩): JSON 32,859자(UTF-8 36.8 KB), v27 URI 인코딩 65,839자, ASCII 리터럴 47,387자, 왕복 **5~11 ms**, 호스트 파싱 1 ms. 40항목: 164K자 / URI 329K / ASCII 237K, 왕복 13~26 ms. 호스트 `JSON.parse`는 eval 폴리필. **날 U+2028 → "Unterminated string constant"**(URI·ASCII 둘 다), JSON 이스케이프한 ` `은 정상. Chromium 99의 JSON.stringify는 U+2028을 이스케이프하지 않음 | 전송 비용은 무시할 수준. U+2028/2029 이스케이프 필수(계획대로) | ✅ | 5 |
| i | Premiere 캡션 내보내기(한글 UI) | 준비 `iu_prep.jsx` | `s03/srt/s03_caption_src.srt`(한 줄, 두 줄, `<i>`, `<b>`, 프레임 경계가 아닌 ms)를 가져와 `createCaptionTrack(item, 0, CAPTION_FORMAT_SUBTITLE)`로 **T_TC1h와 T_23976**에 캡션 트랙 생성(대화상자 없음, 47/69 ms) | 내보내기는 사용자 | ✋ | 18 |
| j | 청크당 실행 취소 단계 | `j_undo.jsx` | `qe.project.undoStackIndex()`: importMGT +1, remove +1, **overwriteClip +1, 이름 쓰기 +1, 속성 setValue·end 변경은 0**. 8항목 청크(배치+캡션+end+이름) = **16단계** | 속성 쓰기가 실행 취소 스택에 따로 남지 않는다 → Ctrl+Z로 텍스트 변경을 되돌릴 수 없을 수 있음. History 패널 수는 사용자 확인 | ✋(QE 수치 ✅) | (§6.11) |
| k | projectItem.name / .mogrt 이름 / getMediaPath / treePath | `c_len_*.jsx`, `x_step1.jsx` | 6개 모두 `projectItem.name == .mogrt 파일 이름`, treePath `\MI_test.prproj\Motion Graphics Template Media\<이름>`, mediaPath `<프로젝트 폴더>\Motion Graphics Template Media\<capsuleID>\<이름>.aegraphic`, `getMGTComponent().mogrtPath` = undefined. **그러나 x에서 `x_same_path.mogrt`를 가져오면 항목 이름은 "기본 자막"** — 이름은 파일명이 아니라 MOGRT 안의 capsule 이름. 같은 capsule은 경로가 달라도 같은 항목을 재사용. 다른 폴더에서 복사된 프로젝트에서는 같은 이름의 항목이 **하나 더** 생김(다이어리 000f4243 / 000f4281) | 6개 프리셋은 우연히 파일명 = capsule 이름. 클립에서 .mogrt 경로는 복원 불가 | ✅ | 6 |
| l | 한글 경로: showOpenDialogEx, File.path, cep.fs.stat | `n_l_panel.expr.txt`, 수동 `l_check.expr.txt` | `"path" in File.prototype` = true(합성 File은 ""), `cep.fs.showOpenDialogEx` 존재(패널을 막으므로 호출 안 함). 한글 경로 `cep.fs.stat` err 0, mtime(Date) 읽힘, `cep.fs.readFile`·node fs 정상. v27은 `<input type=file id=srtInput>`로 SRT를 연다 | 실제로 고른 파일의 File.path 값은 사용자 확인 필요 | ◐✋ | 7 |
| m | 읽기 비용 texts/lay/deco, AE 20·네이티브 20 | `m_read.jsx` (T_BIG) | 클립당 AE: texts 13.5 · lay 25.2 · deco 22.3 = **61 ms**. 네이티브: 17.5 · 16.5 · 20.1 = **54 ms**. 쓰기 직후 texts는 약 95 ms(`s_big2`) | 40개 호출 ≈ 2.4~4 s | ✅ | 8 |
| n | TextDecoder utf-16be | `n_l_panel.expr.txt` | utf-16be·utf-16le 정상(BOM 제거, fatal 가능), 홀수 바이트 끝은 U+FFFD. `euc-kr` 가능, `cp949` 레이블은 **예외** | utf-16be 지원. CP949는 'euc-kr' 레이블로 | ✅ | — |
| o | videoFrameRate.ticks, sf×frameTicks 정확성, zeroPoint 기준 | `o0_mkseq.jsx`, `o1_ticks.jsx` | frameTicks: 23.976 = 10594584000, 29.97 = 8475667200, 25 = 10160640000, 59.94 = 4237833600. `Time.ticks = sf×frameTicks`로 놓으면 **정확히 sf**(24, 719, 700000f(≈8.1 h)도 ticks 일치). T_TC1h: importMGT(24f) → 클립 start 24f(0 기준), `setPlayerPosition(24f)`도 0 기준. **importMGT(zeroPoint+48f)는 1시간 뒤(86448f)에 놓임**. qe CTI.timecode는 zeroPoint를 반영하지 않음(24f → "00:00:01:00") | 모든 스크립트 시간(start/end/importMGT/overwriteClip/재생 위치)은 **시퀀스 0 기준**, zeroPoint와 무관 | ✅ | 9 |
| p | 끝 스냅 | `o1_ticks.jsx` | `end`에 60.4f, 70.6f, 80.5f(초)를 넣으면 **그대로 저장**(스냅 안 됨). v27 적용 결과 끝이 프레임 경계가 아닌 클립 47/60(A), 57/60(B) | 끝은 스냅되지 않는다 → 호스트가 `ef×frameTicks`로 써야 한다 | ✅ | 9 |
| q | v27 재적용 miss율, 719.6f 스냅 | `gen_q.py`, `q_apply_*.jsx`, `q_check.jsx`, `q_detail.jsx` | 스냅: importMGT·overwriteClip(ticks)·overwriteClip(초) 모두 **가장 가까운 프레임**(719.6→720, 1200.4→1200, 2200.5→2201). 23.976 합성 SRT 60큐(프레임 정렬, A=ms 반올림, B=ms 버림, 연속 큐 다수, preset_6 전체 속성)를 **바꾸지 않은 v27 applyToTimeline**으로 적용: 첫 적용 60/60 정확(30큐당 7.3~8.6 s). 같은 내용 재적용: 키 miss **A 2/60, B 1/60**. miss 하나마다 5초로 다시 놓여 **다음 큐가 손상**: A 26번 머리 32f 잘림, **A 54번 클립 삭제**(60→59개), B 27번 머리 50f 잘림. v27은 모두 "SUCCESS 30개"로 보고 | 재적용 miss 약 2~3%/회, 손상은 조용히 일어난다 | ✅(합성 SRT) | 10 |
| r | TrackItem.move(Time) | `r_move.jsx` | `move(Δ)`는 **상대 이동**, 반환값 null, 3 ms. AE·네이티브 모두 nodeId·이름·텍스트·효과(Tint/Crop)·Motion 키(클립 기준 시간 12/72f) 유지. **겹치는 곳으로 옮겨도 거부·자르기 없이 같은 트랙에 겹친 클립을 만든다**(M1 648~768 vs O 700~820). 옮긴 뒤 `track.clips` 순서가 시작 시간순이 아님 | move는 클립을 온전히 유지하지만 겹침 검사가 없다 | ✅ | 11 |
| s | 600+150 클립 스캔 비용 | `s_big1.jsx`, `s_big2.jsx`, `s_scan.jsx` | 최소 정보(start, end, nodeId, name) 읽기: V1 스틸 600개 1.6~2.4 ms/클립(총 0.96~1.45 s), V3 MOGRT 150개 1.38 ms/클립(0.21 s). start만 읽는 창 필터: V1 600개 0.40 s, V3 150개(창 안 15개 상세) 76 ms. nodeId 맵 150개 42 ms, 조회 10회 1 ms. 배치 순서대로면 `track.clips`는 시작순. overwriteClip 비용은 시퀀스가 클수록 증가(빈 시퀀스 20 ms → 600클립 67~136 ms) | 스캔은 트랙 필터가 핵심(V1 제외) | ✅ | 12 |
| t | 프로젝트 두 개와 projectItem | — | 프로젝트 열기/닫기 금지 규칙 때문에 **실행 안 함** | — | ⛔ | 13(추론) |
| u | 시작 TC 오프셋(T_TC1h) | `iu_prep.jsx`, `w_final.jsx` | T_TC1h 캡션 트랙: 시퀀스 3.5 s(0 기준) 프레임에 2번 큐(3.000~5.123)가 보임(`u_TC1h_3500ms.png`) → 캡션 트랙 시간도 0 기준. 내보낸 SRT의 시간(00:00:01 vs 01:00:01)은 사용자 확인 | 수동 | ✋ | 9 |
| v | 설치 안 된 글꼴 MOGRT의 모달 | 준비만 `mk_missing_font.py`, `v_missing_font.jsx` | 모달이 뜨면 Premiere가 막힌 채 남을 수 있어 **실행 안 함**. 글꼴 이름만 같은 길이로 바꾼 네이티브 MOGRT(`s03/mogrt/v_missing_font.mogrt`)와 30 s 제한 실행 파일을 준비함 | — | ⛔ | 14 |
| w | 네이티브 읽기 안정성 | `m_read.jsx`, `w_final.jsx`, 수동 `w_reopen.jsx` | 기본값 필드: 두 번 읽어도, 저장 뒤에도 `U+0188`, `U+018C` 한 글자(값 앞 8바이트 길이 헤더의 첫 UTF-16 단위, 다음 NUL에서 잘림). 쓴 필드: 쓴 평문 그대로(저장 뒤 동일). 다시 열기는 금지 규칙으로 안 함(기준값 `out/w_reopen_baseline.txt`) | 한 글자 이하 → 빈 값 정규화는 유효. 다시 열기 후 확인은 수동 | ◐ | 15 |
| x | MOGRT 재저장(같은 경로) | `mk_mogrt.py`, `x_step1~3.jsx` | ① 같은 경로, 다른 capsule(기본 자막 8속성 → 자동 줄바꿈 15속성): 새 importMGT는 **새 구조**로 놓임(기존 capsule 항목 000f427d 재사용, 새 항목 없음). ② 같은 경로, **같은 capsuleID**, 컨트롤 이름만 변경: importMGT는 **같은 projectItem(000f4291)을 재사용하면서 새 이름**("텍스트 V2")으로 놓음, 옛 클립은 옛 구조 유지. ③ **그 projectItem으로 overwriteClip하면 옛 구조**("텍스트")가 놓임. namedParams(index -1, displayName)를 v27 updateClipAtTime으로 보내면 옛 클립(0/2/5/6)·새 클립(4/6/10/12) 모두 **올바른 속성**에 들어감. index 4를 옛 클립에 쓰면 '서브 포인트 텍스트'에 들어감(위험 재현). v27 getMogrtParams는 0..n-1 **모든 index**를 돌려줌(8/8, 프리셋 6개도 전부 일치) | 같은 이름·같은 projectItem 아래 구조가 다른 클립이 공존한다. 한 번의 v27 실행 안에서도 첫 클립(importMGT)과 나머지(overwriteClip)의 버전이 달라질 수 있다 | ✅(시뮬레이션) | 16, 13 |
| y | getOutPoint로 D | `c_len_*.jsx`, `s02_bin.jsx`, `w_final.jsx` | AE 항목: in = **3600 s**, out = 3605.005 s → `getOutPoint()`만으로는 D가 아니고 **out − in = 5.005 s = D**. "반응형 박스 자막"은 in 0/out 5.005. 네이티브는 projectItem 없음(D는 배치로만: 120f) | D = getOutPoint − getInPoint(AE), 네이티브는 첫 배치 | ✅ | 17 |

## 2. 결정 (spec acceptance 18개 — 요청서의 "16개"보다 2개 많아 모두 적는다)

1. **배치 길이 분기**: P는 불가(MOGRT 항목 setOutPoint 무시). **R + C**를 쓴다. R = 스냅샷한 이웃의 `inPoint -= Δ` → `start -= Δ` 순서로 복원하고 start/in/end를 다시 읽어 확인. 이웃이 통째로 덮여 사라진 경우(`guard` nodeId가 없어짐)는 C(해당 줄 다시 넣기, 최대 2회). R은 nodeId·이름·효과·키를 유지하므로 C보다 먼저.
2. **setTextValue 줄바꿈 규칙**: AE는 LF·CR 모두 줄바꿈으로 렌더 → **변환하지 않는다(LF 유지)**, `opts.aeNewline`은 만들지 않는다. 네이티브는 쓴 텍스트가 렌더되지 않아 판단 불가(§3-1). 사용자 눈 확인 전까지는 "잠정".
3. **격리 방법**: `Sequence.clone()` + 이름 `T_…` + 테스트 + `app.project.deleteSequence()`. clone과 `qe.project.newSequence`는 **새 시퀀스를 활성화**하므로 끝나면 원래 시퀀스를 다시 활성화한다. 대화상자 없음.
4. **네이티브 라벨 출처**: definition.json `clientControls` 중 type 6(TextLayer)의 **순서 == 컴포넌트 순서**(2/2 템플릿 확인). uiName은 모두 "TextLayer"라 쓸모없으니 라벨은 각 컨트롤의 `value`(기본 문구, 로캘 en_US 또는 UI 로캘)로, 개수가 다르면 "텍스트 N". 화면 위아래 순서와 다를 수 있음(Basic Lower Third). 필수 그래픽 패널 순서는 수동 확인 대기.
5. **ms/op와 청크 크기(budgetMs 7000)**: 전송은 무시 가능(8항목 5~11 ms). 배치 한 건(배치+캡션 1개+end+이름+되읽기)은 작은 시퀀스 ≈ 150~250 ms, T_BIG ≈ 320 ms(캡션만)~460 ms(속성 15개 전부). 속성만 갱신 ≈ 65 ms. importMGT 270~440 ms(T_BIG 네이티브 600 ms), **Premiere 시작 후 첫 AE importMGT ≈ 8.9 s**. → **기본 청크 8 유지**(최악 ≈ 4 s), 측정 ms/op < 400이면 12까지 올림. 템플릿의 첫 importMGT는 단독 청크로.
6. **mogrtItemName은 학습한다**: projectItem.name은 .mogrt 파일명이 아니라 **capsule 이름**(x에서 `x_same_path.mogrt` → "기본 자막"). 첫 배치의 `clip.projectItem.name`을 저장. 같은 이름 항목이 여럿일 수 있으니(프로젝트 복사) 비교는 이름으로만, 항목 nodeId로 하지 않는다.
7. **경로 수집**: `showOpenDialogEx`는 쓰지 않는다(동기 대화상자가 패널을 막음). 기존 `#srtInput`의 `File.path`를 쓰고, 없으면 경로 없음으로 둔다(재가져오기 시 사용자가 다시 고름). mtime은 `cep.fs.stat`(한글 경로 OK). 실제 File.path 값은 `l_check.expr.txt`로 확인 대기.
8. **호출당 되읽기 개수**: 클립당 54~61 ms(쓰기 직후 ~95 ms) → **40 유지**(≈ 2.4~4 s). 60을 넘기지 않는다.
9. **프레임·스냅·zeroPoint**: `Time.ticks = sf×frameTicks`는 정확(700,000f까지 확인). 시작 스냅은 **가장 가까운 프레임**(반 프레임은 올림) → 기존 클립 비교는 `Math.round(ticks/frameTicks)`, ±1. **끝은 스냅되지 않으므로 호스트가 항상 `ef×frameTicks`로 쓴다**(v27 클립은 끝이 소수 프레임). 모든 스크립트 시간은 **0 기준**(zeroPoint 무관). SRT가 zeroPoint 기준으로 나오는지는 u(수동)로 확정 — 계획의 "[시작 타임코드만큼 당기기]" 경고는 유지.
10. **v27 재적용 miss율**: 합성 23.976 SRT 60큐에서 재적용 1회당 **1~2개(1.7~3.3%)** miss, miss마다 다음 큐의 머리 잘림(32f, 50f) 또는 **삭제**, v27은 성공으로 보고. 실제 데이터(사용자 SRT)에서 §0.5의 5% 추정과 같은 규모 → S1-9 "레거시 안전 적용"(프레임 ±1 매칭, 재배치 금지)을 계획대로 한다.
11. **move 사용 여부**: move는 클립(nodeId·이름·속성·효과·키)을 온전히 유지 → **retime은 move를 쓴다**. 단 move는 겹침을 막지 않으므로 호스트가 목적 범위 `[sf+Δ, ef+Δ)`가 (작업 순서상 앞선 제거·단축 뒤) 비어 있는지 먼저 확인하고, 비어 있지 않으면 `conflict`/`moveRegen`. 옮긴 뒤 트랙을 다시 읽고 시작순으로 정렬해 다룬다.
12. **스캔 예산·트랙 필터**: 최소 정보 1.4~2.4 ms/클립. MI_getTracks는 **화자 트랙·기본 트랙·legacyTrack만**(V1 영상 트랙 제외), start만 먼저 읽어 ±30 s 창 밖은 건너뛴다(0.66 ms/클립). 호출 하나 예산 3 s(≈ 1,500클립); 넘으면 트랙별로 나눈다. nodeId 맵은 호출마다 새로 만든다(150개 42 ms).
13. **itemCache 정책**: 키는 경로가 아니라 importMGT가 돌려준 클립의 `projectItem`(같은 capsule이면 경로가 달라도 같은 항목). **한 청크 안에서만** 쓰고 청크·실행·세션을 넘기지 않는다. 캐시로 overwriteClip한 첫 클립의 lay를 importMGT 클립의 lay와 비교해 **다르면(재저장된 MOGRT) 그 템플릿은 캐시를 끄고 매번 importMGT**. 예외·트랙 불일치(#14)가 나면 버린다. (t는 실행 안 함: 다른 프로젝트의 항목은 documentID를 키에 넣어 막는다.)
14. **모달 대화상자·워치독**: v는 실행 안 함. 첫 AE importMGT가 대화상자 없이 ≈ 9 s 걸리므로 워치독은 **20 s 유지**(10 s 이하로 줄이지 않는다). 청크 예산 7 s는 한 작업 안에서는 끊을 수 없다.
15. **네이티브 rh 범위**: **쓴 index만**. 안 쓴 필드는 헤더 한 글자(U+0188 등)가 읽혀 정규화하면 "" — 전체를 넣어도 같겠지만, 쓴 필드는 평문이 그대로 읽혀 쓴 index만으로 충분하다. 단 §3-1 때문에 네이티브 쓰기 자체를 재검토해야 한다.
16. **재저장 MOGRT 동작**: importMGT는 항상 **파일의 현재 버전**을 놓지만 projectItem은 capsule 단위로 공유되고, 그 항목으로 overwriteClip하면 **옛 버전**이 놓인다. 옛/새 구조 클립이 같은 이름·같은 projectItem으로 공존한다. index 쓰기는 틀린 속성에 들어가고 이름 쓰기(index -1)는 둘 다 맞게 들어간다 → **이름 확인 쓰기(namedParams, MI__applyParamsSafe) 설계가 맞다**. 배치 뒤 lay 확인도 필요.
17. **D 출처**: **첫 배치의 `end − start`**(프레임)을 `mogrtDurSec`로 저장. AE는 `getOutPoint − getInPoint`로 교차 확인 가능(`getOutPoint`만 쓰면 3605 s가 된다). 네이티브는 projectItem이 없어 배치로만. 6개 프리셋 모두 5.005 s.
18. **실제 Premiere SRT 픽스처(텍스트 교체)**: 아직 없음 — i/u 수동 내보내기 뒤 `tests/fixtures/srt/premiere_export_*.srt`로 만든다(텍스트는 합성으로 교체). 그때까지 `s03/srt/q_A.srt`, `q_B.srt`(합성, ms 반올림/버림 두 가정)를 임시로 쓴다.

## 3. 놀라운 점과 위험

1. **네이티브(Premiere에서 만든) 템플릿의 텍스트 쓰기가 렌더되지 않는다(→ 3-1a에서 확정, 굽기로 해결 가능).** `Source Text.setValue(…)`는 true를 돌려주고 getValue도 쓴 문자열을 돌려주지만, exportFramePNG에는 그 필드가 **빈 글자**로 나온다(평문·JSON·헤더+JSON 모두). 실제 값 형식은 `[8바이트 길이][UTF-16LE JSON {"mTextParam":{…"mStyleSheet":{…"mText":"…"}}}]`이고, ExtendScript 다리는 NUL에서 문자열을 잘라 이 형식을 읽지도 쓰지도 못한다. spike #23("쓰기·읽기 동작")은 되읽기만 본 결론이었다. v27의 네이티브 지원(applyParamsToItem 네이티브 분기)도 같은 방식이다. → **사용자가 프로그램 모니터로 확인**하고, 맞다면 네이티브 템플릿은 "텍스트 쓰기 불가"로 표시하거나 1~2단계 범위에서 뺀다.
2. **overwriteClip(캐시 항목)과 importMGT가 다른 버전을 놓을 수 있다**(x ③). 같은 capsuleID로 재저장된 MOGRT에서 v27 한 번 실행이 첫 클립은 새 구조, 나머지는 옛 구조로 섞는다. 실제 AE 재내보내기가 capsuleID를 유지하는지는 모름(시뮬레이션은 definition.json만 고침).
3. **TrackItem.move는 겹침을 만든다**(거부도 자르기도 없음). 호스트 사전 검사 필수.
4. **클립 끝은 프레임에 스냅되지 않는다.** v27 적용 클립 대부분이 소수 프레임 끝을 가진다.
5. **v27 재적용은 조용히 큐를 지운다**(성공 보고, 클립 수 감소).
6. `Sequence.clone()`·`qe.project.newSequence`가 활성 시퀀스를 바꾼다.
7. **nodeId는 처음 읽을 때 발급**된다(프로젝트 항목과 같은 카운터, 읽는 순서대로). 발급 뒤 저장해야 파일에 남는다 → 배치 직후 nodeId를 읽고 저장 전 상태에 의존하지 않는다.
8. overwriteClip 비용은 시퀀스 크기에 비례해 커진다(20 → 136 ms).
9. 속성 setValue·end 변경은 QE 실행 취소 인덱스를 올리지 않는다 → Ctrl+Z로 텍스트 변경이 되돌려지지 않을 수 있다(마지막 적용 되돌리기를 자체 구현하는 근거).
10. `exportFramePNG`는 슬래시 경로에서 "Unknown error exception" — 역슬래시, 확장자 없이(자동으로 .png).
11. qe `CTI.timecode`는 zeroPoint를 반영하지 않는다.
12. AE MOGRT 항목의 inPoint는 3600 s(1시간), 네이티브 클립 inPoint도 3600 s — 키프레임 시간은 이 inPoint 기준.

### 3-1a. 네이티브 텍스트: 메인 세션 추가 실측 (2026-09-25)

- **렌더 확인**: 기본값 클립은 "Insert Name Here / ADD TITLE HERE"가 보이고(`n0_default_60.png`), `Source Text.setValue`로 쓴 필드는 빈 글자다(`n1_written_60.png`). 사용자 눈 확인 없이도 확정.
- **추가로 시도한 쓰기 형식 4가지** (`native/native_write*.jsx`): ① 헤더 4 UTF-16 단위(`String.fromCharCode(len&0xFFFF, len>>>16, 0, 0)`) + JSON 문자열, ② JSON만, ③ 바이트 단위 문자열(8바이트 헤더 + UTF-16LE 바이트), ④ 바이트 단위 문자열(8바이트 헤더 + UTF-8 바이트). 모두 setValue=true인데 **렌더는 빈 글자**. ①은 되읽기가 기본값과 같은 "헤더 한 글자"(1798)로 바뀌어 저장 형식 자체는 들어간 것으로 보이지만 그려지지 않는다. → **ExtendScript로 네이티브 텍스트를 쓸 방법은 없다(26.5.1).**
- **v27 영향**: v27의 네이티브 지원(applyParamsToItem 네이티브 분기, 운영 배포됨)은 "성공"을 보고하면서 텍스트를 **빈 글자로 만든다**. 실제 운영 캐시에는 네이티브 프리셋이 없어 아직 피해는 없다.
- **해결책 — 굽기(bake)**: `.mogrt` 사본을 만들어 ① `definition.json`의 `capsuleID`를 새 UUID로, `clientControls` 중 type 6(TextLayer)의 `value.strDB[].str`을 새 문구로 바꾸고, ② `project*.prgraphic`(zip) 안 `.prproj`(gzip XML)의 `<Name>Source Text</Name>` `StartKeyframeValue`(base64: 8바이트 LE 길이 + UTF-16LE JSON `mTextParam.mStyleSheet.mText`)를 새 문구로 바꾼 뒤 `importMGT` → **정확히 렌더된다(한글 포함, `mi_baked2.png`)**. capsuleID를 그대로 두면 이미 가져온 템플릿이 재사용되어 기본 문구가 나온다(`mi_baked.png`).
  - 순서: TextLayer 컨트롤 순서 = Source Text 블롭 순서 = 컴포넌트 순서(2/2 템플릿).
  - 비용: 줄마다 `.mogrt` 사본 1개 + 프로젝트 항목 1개("Motion Graphics Template Media" 빈). 텍스트를 바꾸려면 클립을 **교체**해야 한다(제자리 갱신 불가).
  - 남은 확인: ①과 ② 중 무엇이 필수인지, 굽기 사본의 정리 정책, 한 프로젝트 항목 수백 개일 때 성능.
  - 스크립트: `tests/premiere/spikes/native_bake.py`(굽기), `native_bake_probe.jsx`.

## 4. 사용자가 할 일 (수동)

테스트 프로젝트 MI_test.prproj가 열려 있고 T_23976이 활성인 상태 그대로 한다. 결과는 이 문서의 해당 행에 적는다.

1. **d 줄바꿈** — T_23976 프로그램 모니터에서 다음 위치를 본다(V1 회색 배경 위):
   - 00:00:02:12 AE LF, 00:00:12:12 AE CR, 00:00:42:12 AE 한글 LF → 두 줄로 보이는지.
   - 00:00:22:12 네이티브 LF, 00:00:32:12 네이티브 CR, 00:00:52:12 네이티브 한글 → **글자가 보이는지**(에이전트 캡처에서는 파란 띠만 보였다). 필수 그래픽 패널에 그 텍스트가 보이는지도 적는다.
   - "보이지 않음"은 통과가 아니다.
2. **f 네이티브 순서** — V3 00:01:02:12(Classic Lower Third Two Lines, `f1_ClassicTwoLines`), 00:01:12:12(Basic Lower Third, `f2_BasicLowerThird`), 00:01:22:12(MOGRT샘플) 클립을 선택하고 필수 그래픽 패널 편집 탭에서 **위에서부터 몇 번째 행이 FIELD_ZERO / FIELD_ONE인지**(또는 비어 있는지). V4 00:01:34:04(기본값), 00:01:39:04(컴포넌트 0만 씀), 00:01:44:04(컴포넌트 1만 씀)도 같은 패널에서 어느 행이 바뀌었는지 본다.
3. **i/u 캡션 내보내기** — 캡션 트랙 `s03_caption_src`(T_23976, T_TC1h 각각)를 선택하고 **파일 > 내보내기 > 캡션…**에서 SRT로 `인터뷰_C2.srt`(T_TC1h는 `인터뷰_C2_TC1h.srt`)로 `…/scratchpad/s03/srt/`에 저장. 확인할 것: 인코딩/BOM, 줄끝, 두 줄 큐 유지, `<i>`/`<b>` 태그 처리, 번호, 5,123/7,777/8,040/10,010 ms가 몇으로 나오는지(프레임 스냅), **T_TC1h에서 1번 큐가 00:00:01,000인지 01:00:01,000인지**. T_TC1h 타임라인 눈금이 01:00:00:00에서 시작하는지도.
4. **j History 패널** — 창 > 작업 내역을 열고 `node tests/premiere/run.js --port 7778 <s03>/spikes/j_undo.jsx` 한 번 실행 뒤 새로 생긴 항목 수를 센다(QE 인덱스 기준 예상: 8항목 청크 = 16 + importMGT/remove 2). 실행하면 T_23976 V5(3000f~)가 다시 만들어진다.
5. **l 경로** — DEV 패널의 SRT 열기로 **한글 폴더/파일 이름**인 SRT를 고른 뒤 `node tests/premiere/run.js --port 7778 <s03>/spikes/l_check.expr.txt`.
6. **w 다시 열기** — Ctrl+O로 MI_test.prproj를 다시 열거나 Premiere를 재시작한 뒤 `node tests/premiere/run.js --port 7778 <s03>/spikes/w_reopen.jsx` → `out/w_reopen_baseline.txt`와 비교(네이티브 값, q 클립 nodeId 000f4583~7).
7. **(선택) v 없는 글꼴** — Premiere 화면을 보면서 `node tests/premiere/run.js --port 7778 --timeout 30000 <s03>/spikes/v_missing_font.jsx`. 대화상자가 뜨면 제목·문구·닫을 때까지 걸린 시간을 적는다(evalScript는 닫을 때까지 돌아오지 않는다).
8. **(선택) t 두 프로젝트** — 다른 프로젝트를 하나 더 연 상태에서만 가능. 에이전트는 규칙상 하지 않았다.

## 5. 남겨 둔 상태 (MI_test.prproj, 저장됨)

- T_23976: V1 bg_gray(0~2700f), V2 d1~d6, V3 f1~f3, V4 fb_basic_*(2200/2320/2440f), V5 undo 클립 8개(3000f~), V6 q_A 60개, V7 q_B 60개, 캡션 트랙(speakerA/B + s03_caption_src).
- T_TC1h: 캡션 트랙 s03_caption_src. T_2997/T_25/T_5994: 비어 있음. T_BIG: V1 600, V2 네이티브 20, V3 AE 150.
- 프로젝트 항목: 테스트용 MOGRT 항목(기본 자막, 질문박스MOGRT 등), bg_gray.png, s03_caption_src.srt.
- 스크래치 MOGRT(`s03/mogrt/x_*.mogrt`, `v_missing_font.mogrt`)는 사용자 MOGRT 폴더 밖에 있다. 운영 폴더·포트 7777·저장소는 건드리지 않았다.
