# Mac에서 이어서 작업하기

2026-09-28 기준으로 Mac ZIP은 **실험 배포이며 실제 Mac/Premiere 설치·실행은 미검증**이다. Windows에서 통과한 Premiere·Codex 실측과 자동 검사는 [MCP_VALIDATION.md](MCP_VALIDATION.md)에 있다. 이를 Mac 통과로 옮겨 적지 않는다. 패널 버전은 1.4.0, MCP 서버는 0.2.0이며, 같은 버전 안의 변경은 배포물 `release.json`의 `sourceCommit`과 `build`로 구별한다.

## 작업 저장소와 동기화

Mac에서는 사용자가 선택한 로컬 checkout을 Codex 작업 폴더로 연다. Windows 작업 경로 `D:/01/_ClaudeAI/02_MOGRT_Importer`를 Mac에 만들거나 그 경로에 의존하지 않는다. 처음 내려받을 때의 예시는 다음과 같다. 기존 checkout이 있으면 새로 복제하지 말고 그 저장소의 상태·remote부터 확인한다.

```sh
git clone https://github.com/raonolje/MOGRTImporter.git "$HOME/Projects/MOGRTImporter"
cd "$HOME/Projects/MOGRTImporter"
git remote add gitlab https://code.raonolje.synology.me/raonolje/mogrt_importer.git
git fetch origin
git fetch gitlab
git status --short
git rev-parse HEAD origin/main gitlab/main
```

`AGENTS.md`를 먼저 읽는다. 작업 완료 시 필요한 검사를 실행하고 커밋한 뒤 GitHub `origin/main`과 GitLab `gitlab/main`을 같은 최종 커밋으로 맞춘다. 이 동기화는 기존 사용자 승인 범위다. 분기가 갈라졌으면 변경과 이력을 보존해 조정하고 강제 push하지 않는다. 마지막에는 실제 remote 값을 확인한다.

```sh
git ls-remote origin refs/heads/main
git ls-remote gitlab refs/heads/main
```

Windows PC에도 접근할 수 있을 때 그 PC의 실제 D 드라이브 checkout에서 변경 상태를 확인하고 fetch/pull한다. 접근할 수 없으면 **두 remote 완료 / Windows 로컬 반영 대기**로 보고한다. Mac checkout이나 remote를 갱신한 것만으로 Windows도 갱신됐다고 말하지 않는다.

현재 패널 소스는 `extension/html/js/app.js`이며 `src/`는 빌드 입력이 아니다. `hostscript.jsx`의 ES3 호환과 region/core 해시 계약을 보존한다. Node.js 24.14 이상을 사용하면 저장소 테스트 요구 버전과 MCP 서버 요구 버전을 함께 충족한다.

```sh
node --version
npm ci --prefix mcp
npm test
npm run test:mcp
npm run lint:jsx
```

운영 캐시를 지정하지 않아 호환 검사가 건너뛰어졌다면 통과 수와 별도로 기록한다. Windows용 `tools/deploy_prod.sh`와 `tools/install_dev.sh`는 Windows 경로·프로세스 확인을 포함하므로 Mac 설치 명령으로 그대로 사용하지 않는다.

## ZIP과 설치본 확인

설치 안내는 [README_MACOS.md](../packaging/macos/README_MACOS.md)를 따른다. ZIP 전체를 풀고 `Installer.command`, `extension/`, `release.json`, `SHA256SUMS`를 함께 둔다. 먼저 압축을 푼 폴더에서 다음을 확인한다.

```sh
shasum -a 256 -c SHA256SUMS
cat release.json
```

`version`, `build`, `sourceCommit`을 기록하고, 검증에 사용하는 checkout의 `git rev-parse HEAD`와 비교한다. 다른 커밋이면 어느 소스로 만든 설치본인지부터 정리한다. 커밋 ID가 아직 확정되지 않은 배포물이나 체크섬이 맞지 않는 ZIP을 최신 설치본으로 간주하지 않는다.

Premiere 프로젝트를 저장하고 앱을 완전히 종료한 뒤 `Installer.command`를 실행한다. 실행 비트가 없는 경우 압축을 푼 폴더에서 `/bin/bash ./Installer.command`로 실행할 수 있다. 설치기가 표시하는 변경 내용을 확인하고 진행한다. 이 설치는 사용자 계정에서 수행하며 `sudo`가 필요하지 않다.

- 설치 위치: `~/Library/Application Support/Adobe/CEP/extensions/CEP_MogrtImporter`
- 백업·배포 메타데이터·설정 이전 값: `~/Library/Application Support/MogrtImporter/installer-backups/<날짜-시각-PID>/`
- 사용자 캐시: 설치 폴더 안의 `cache/`. 기존 캐시는 보존해야 한다.

설치기의 배포물/설치 파일 SHA-256 검사와 기존 cache 보존 검사가 완료됐는지 확인한다. 이 보존 검사는 Premiere를 다시 열기 전에 판정한다. 패널 부팅은 정상적으로 작업 기록이나 캐시를 갱신할 수 있다. Adobe `PlayerDebugMode` 변경 내용과 복구 방법은 설치 안내를 따른다. Gatekeeper 해제나 quarantine 일괄 제거를 설치 절차에 추가하지 않는다.

## 실제 Mac Premiere·CEP 검증

먼저 macOS 버전, Intel/Apple Silicon, Premiere 버전, 설치 `version`·`build`·`sourceCommit`을 기록한다. Premiere를 다시 시작해 패널 메뉴 노출과 화면을 확인한다. JSX 교체 뒤에는 패널 새로고침만으로 새 호스트가 로드됐다고 판단하지 않는다.

저장소의 빌드 검사 runner는 기본 경로가 Windows 기준이므로 **Mac에서는 `MI_CEP_EXT_DIR`를 명시**한다. 기존 시퀀스를 활성화한 상태에서 아래 운영 스모크는 타임라인을 수정하지 않는다.

```sh
MI_CEP_EXT_DIR="$HOME/Library/Application Support/Adobe/CEP/extensions" \
  node tests/premiere/run.js --prod --port 7777 --check-build tests/premiere/smoke.expr.txt
```

설치·호스트·패널 빌드가 `release.json`의 `build`와 같은지 실제 출력으로 확인한다. `ping 없음`이나 `비교 건너뜀`은 최신 호스트 확인 완료가 아니다. 연결되지 않으면 CEP 메뉴·디버그 포트·Premiere 모달부터 확인하고, 검사를 통과시키려고 운영 runner의 파일 제한을 풀지 않는다.

그다음 버릴 수 있는 테스트 프로젝트와 Mac에 존재하는 MOGRT/SRT로 아래를 확인한다. Windows 캐시 안의 `C:`/`D:` 파일 경로가 Mac에서도 유효하다고 가정하지 않는다.

1. 한글·공백 경로의 MOGRT 탐색과 프리셋 읽기, SRT 가져오기, 세션 저장·재열기.
2. 프리셋 JSON 내보내기가 선택한 Mac 폴더 안에 저장되는지 확인. `/` 경로 수정은 패널 하네스에서 검증했지만 실제 Mac의 CEP 저장도 확인해야 한다.
3. 프리뷰 캡처와 복구, 한 줄 적용 및 텍스트·트랙·시작/종료 시간 검수. 프리뷰 임시 파일은 호스트의 `Folder.temp`를 사용한다.
4. 기본 760×720·최소 480×520에서 상단 도구와 팝업 확인. Premiere가 기억한 기존 창 크기와 manifest 기본값을 따로 기록한다.
5. AI/MCP 연결을 시험한다면 먼저 읽기 도구, 그다음 제안·패널 승인·적용·`wait_job`·검수 순서로 확인한다. 원래 프로젝트의 타임라인으로 실험하지 않는다.

전체 하드 테스트는 DEV 설치와 `MI_test.prproj`의 `T_` 시퀀스 준비 후 [TESTING.md](TESTING.md)를 따른다. Windows의 이전 테스트 프로젝트 경로는 Mac에서 그대로 사용할 수 없다. 검증 후 스크래치·임시 파일을 정리하고 원래 시퀀스와 AI 연결 상태를 복원한다.

## Mac의 MCP 연결

패널은 `APPDATA`가 없으면 CEP의 `SystemPath.USER_DATA`를 바탕으로 다리 경로를 정한다. 서버의 macOS 기본값은 `~/Library/Application Support/MogrtImporter/bridge`다. 실제 `heartbeat.json`의 위치·최신 시각·`state: on`·`extPath`가 같은 설치본을 가리키는지 확인한다. DEV의 다리는 `bridge_dev`이며 서버의 `MI_BRIDGE_DIR`도 그 실제 절대 경로와 맞아야 한다.

연결 안내는 [MCP README](../mcp/README.md)를 참고하되 서버 경로는 **Mac checkout의 절대 경로**로 바꾼다. 패널 설치에는 별도 Node가 필요하지 않지만 외부 MCP 서버에는 Node가 필요하다. 기존 Windows 실험은 임시 연결이었으며 전역 Codex/Claude 등록이 완료된 상태가 아니다. 이 인수인계나 설치 자체만으로 전역 클라이언트 설정을 변경하지 않는다.

Windows에서 실제 Codex 모델의 승인 적용 흐름은 통과했다. Claude Code의 조직 정책 오류와 Store Desktop의 다리 경로 문제는 당시 Windows 결과이며, Mac에서 같은 오류가 날 것이라 단정하지 않는다. 각 클라이언트의 실제 결과를 따로 기록한다. `get_guide`는 서버 안내문만 읽으므로 Mac 패널과의 통신 확인에는 `get_status`도 필요하다.

## 선택 사항: 서명된 PKG

현재 Mac ZIP은 서명·공증된 PKG가 아니다. Mac 실기 검증 뒤 PKG 배포가 필요하면 별도 패키징 작업으로 진행한다. 외부 배포용 PKG 서명에는 **Developer ID Installer 인증서와 해당 개인 키**가 필요하다. 패키지를 `pkgbuild`/`productbuild`로 만들고 올바른 인증서로 서명한 뒤 검증한다. [Apple의 패키징 안내](https://developer.apple.com/documentation/xcode/packaging-mac-software-for-distribution), [Developer ID 인증서 안내](https://developer.apple.com/help/account/certificates/create-developer-id-certificates)

공증은 Apple의 `notarytool` 절차를 따르고, 승인 뒤 `stapler`로 티켓을 붙여 검증한다. 서명용 자격 증명이나 개인 키를 저장소·배포 ZIP에 넣지 않는다. [Apple Developer ID 배포 안내](https://developer.apple.com/developer-id/)

```sh
pkgutil --check-signature MOGRTImporter.pkg
xcrun stapler validate MOGRTImporter.pkg
```

PKG로 바꿀 때도 사용자별 설치 위치, cache 보존, 검증 백업, 기존 설치 중복 확인을 유지해야 한다. Apple PKG 서명·공증과 Adobe CEP 확장 서명/로딩 설정은 별개이므로 둘을 각각 검증한다. 인증서가 없으면 서명된 것처럼 표시하지 않고 실험 ZIP 배포를 유지한다.

## Mac Codex에 전달할 작업

> 이 저장소의 AGENTS.md와 docs/MAC_HANDOFF.md를 읽고 Mac 실기 검증부터 이어서 진행해 줘. release.json의 version/build/sourceCommit과 checkout을 맞추고, 설치·캐시 보존·Premiere/CEP·MCP 결과를 각각 기록해 줘. Mac에서 확인하지 못한 항목은 미검증으로 남겨 줘. 완료한 소스는 GitHub와 GitLab main을 같은 커밋으로 동기화하고, Windows D 드라이브 checkout은 해당 PC에 접근할 수 있을 때만 정상 pull로 갱신해 줘. 전역 AI 클라이언트 설정은 별도 요청 없이 바꾸지 마.
