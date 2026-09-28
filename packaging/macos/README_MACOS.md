# macOS 설치 — 실험 배포

이 ZIP은 macOS용 사용자 설치 스크립트입니다. 서명·공증된 PKG/DMG가 아닙니다. **실제 Mac/Premiere에서 설치와 기능 실행을 아직 검증하지 않았습니다.** Windows에서 스크립트 구문과 배포물 구조만 검사했습니다.

## 설치

1. Premiere 프로젝트를 저장하고 Premiere Pro를 완전히 종료합니다.
2. ZIP 전체를 한 폴더에 압축 해제합니다. `Installer.command`, `extension`, `release.json`, `SHA256SUMS`를 함께 둡니다.
3. `Installer.command`를 엽니다. Terminal 창에서 설치 위치와 Adobe 설정 변경 내용을 읽습니다.
4. 동의할 때만 `INSTALL`을 입력합니다. 설치 후 Premiere를 실행하고 **창 → 확장(레거시) → MOGRT Subtitle Importer**를 엽니다. 메뉴 명칭은 버전에 따라 다를 수 있습니다.

실행 권한이 보존되지 않은 압축 해제 도구를 사용했다면 Terminal에서 `/bin/bash `를 입력하고 `Installer.command`를 창에 끌어 놓은 뒤 Enter를 누르면 됩니다. 관리자 권한이나 `sudo`는 사용하지 않습니다.

macOS가 출처 확인 메시지로 실행을 막는 경우, 파일 출처를 확인하고 [Apple의 앱 열기 안내](https://support.apple.com/en-us/102445)를 따르세요. 이 설치기는 Gatekeeper를 끄거나 quarantine 속성을 제거하지 않습니다.

## 설치 위치와 백업

- 설치: `~/Library/Application Support/Adobe/CEP/extensions/CEP_MogrtImporter`
- 전체 기존 설치본과 cache 백업: `~/Library/Application Support/MogrtImporter/installer-backups/<날짜-시각-PID>/code`
- Adobe 설정 이전 값: 같은 백업 폴더의 `PlayerDebugMode.before.txt`

설치 전에 배포물 SHA-256을 확인하고, 기존 설치본을 검증 백업한 뒤 코드만 덮어씁니다. `cache`를 포함한 배포물은 거절합니다. 설치 후 코드 SHA-256과 기존 cache 내용이 그대로인지 다시 확인합니다. 백업은 CEP 확장 폴더 밖에 있어 중복 패널로 로드되지 않습니다. 기존 코드의 추가 파일은 삭제하지 않습니다.

시스템 위치 `/Library/Application Support/Adobe/CEP/extensions`에 같은 확장이 있거나 다른 사용자 확장 폴더에 같은 ID가 있으면 중단합니다. 기존 설치 관리자에게 캐시를 보존한 정리를 요청하세요. 설치기는 시스템 설치본을 지우거나 관리자 권한을 요구하지 않습니다. 대상 경로나 기존 설치본에 심볼릭 링크가 있어도 자동 설치를 중단합니다.

## 미서명 CEP 설정

이 ZIP의 패널은 Adobe CEP 서명이 없습니다. 배포 manifest의 CSXS 11 요구 사항에 맞춰 사용자 기본 설정 `com.adobe.CSXS.11`의 `PlayerDebugMode`만 문자열 `1`로 설정할 수 있습니다. **같은 CEP 버전의 다른 미서명 패널에도 영향을 주는 Adobe 설정**이므로 설치기가 변경할 항목을 보여 주고 동의를 받습니다. 이미 `1`이면 바꾸지 않습니다. 동의하지 않으면 아무것도 설치하지 않습니다. 다른 CEP 런타임의 설정은 자동으로 바꾸지 않으며, 최신 Premiere의 실제 메뉴 노출은 Mac에서 추가 확인해야 합니다.

이 설정을 되돌리려면 Premiere를 종료하고 `PlayerDebugMode.before.txt`를 확인하세요. 이전 값이 `<absent>`였던 도메인은 Terminal에서 `defaults delete com.adobe.CSXS.11 PlayerDebugMode`처럼 해당 키만 삭제합니다. 이전 값이 있었다면 같은 도메인의 키를 그 값으로 복원합니다. 다른 도메인에는 적용하지 마세요. 미서명 패널은 이 설정을 되돌리면 로드되지 않을 수 있습니다.

CEP 경로와 미서명 확장 설정은 [Adobe CEP 문서](https://github.com/Adobe-CEP/CEP-Resources/blob/master/CEP_11.x/Documentation/CEP%2011.1%20HTML%20Extension%20Cookbook.md)에 근거합니다.

## 실패와 복구

체크섬이나 백업 검증이 실패하면 설치를 중단합니다. 코드 복사 이후 실패하면 완료 메시지를 표시하지 않습니다. Premiere를 열지 말고 터미널에 표시된 백업 위치를 먼저 확인하세요.

기존 설치가 있었다면 Finder에서 `code` 백업 폴더의 내용과 `cache`가 있는지 확인한 뒤, Premiere를 종료한 상태로 원래 설치 위치에 복사해 복구할 수 있습니다. 실패한 설치 폴더도 필요하면 별도로 보존하세요. 처음 설치해 이전 `code` 백업이 없다면 검증된 ZIP으로 설치를 다시 시도합니다. cache와 프로젝트를 삭제할 필요는 없습니다.

## 범위

CEP 패널 설치에 별도 Node.js는 필요하지 않습니다. Premiere와 CEP의 지원 여부는 Adobe 버전에 따릅니다. Intel/Apple Silicon에서의 실제 구동, CEP 메뉴 노출, 한글 경로, MOGRT 가져오기·프리뷰·저장·AI 연결은 Mac에서 별도로 확인해야 합니다.

Codex/Claude에서 AI 도구를 사용할 MCP 서버는 별도 Node.js 설치와 클라이언트 등록이 필요하며 이 설치기가 자동 등록하지 않습니다. Mac의 기본 MCP 다리 경로는 `~/Library/Application Support/MogrtImporter/bridge`입니다. CEP가 실제로 보고한 사용자 데이터 경로와 일치하는지도 Mac 검증 항목입니다.
