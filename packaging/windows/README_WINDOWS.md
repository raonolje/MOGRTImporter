# Windows 설치

최신 배포의 `MOGRTImporter_v1.4.0_Windows.exe`를 실행하세요. 예전 코드 복구에 사용한 `installer_v1.1.6.exe`는 현재 저장소에서 제거했으며 Git 이력에만 남아 있습니다. 최신 기능 설치·업데이트·롤백에 사용하지 마세요.

## 설치 파일 사용

1. Adobe Premiere Pro를 완전히 종료합니다. 실행 중이면 설치가 중단됩니다.
2. `MOGRTImporter_v1.4.0_Windows.exe`를 실행합니다. 관리자 권한은 필요하지 않습니다.
3. 설치 옵션을 읽고, 필요한 경우 **Enable unsigned CEP extensions for this Windows user**를 선택합니다. 기본은 해제입니다. 이미 허용된 계정에서는 그 값을 그대로 유지합니다.
4. 설치가 끝나면 Premiere Pro를 열고 **Window → Extensions → MOGRT Subtitle Importer**를 선택합니다.

설치 위치는 현재 계정의 `%APPDATA%\Adobe\CEP\extensions\CEP_MogrtImporter`입니다. 다른 Windows 계정에서도 사용하려면 그 계정으로 로그인하여 설치합니다. 사용자별 설치이며, Program Files에 있는 다른 설치본은 변경하지 않습니다.

이 배포는 Windows Authenticode 서명 및 Adobe CEP 서명이 없습니다. Windows에서 게시자 확인 또는 SmartScreen 안내가 나타날 수 있습니다. 공식 프로젝트의 배포 파일인지와 함께 제공된 SHA-256을 확인하세요. 조직 보안 정책으로 실행이 차단되는 환경에서는 관리자에게 확인해야 합니다.

서명 없는 CEP 허용 옵션은 현재 계정의 `HKCU\Software\Adobe\CSXS.11`에 문자열 `PlayerDebugMode=1`만 설정합니다. 이 값은 이 패널뿐 아니라 해당 CEP 런타임의 다른 서명 없는 확장에도 적용됩니다. 옵션을 선택하지 않았고 기존 설정도 없다면 패널이 메뉴에 나타나지 않을 수 있습니다. 이 경우 설치 파일을 다시 실행하여 옵션을 선택할 수 있습니다. 제거할 때 이 공유 설정을 임의로 되돌리지 않습니다.

설치 파일은 포함된 PowerShell 설치 엔진을 별도 프로세스로 실행합니다. `-ExecutionPolicy Bypass`는 그 프로세스에만 적용되며 사용자·컴퓨터의 영구 실행 정책을 변경하지 않습니다. 시스템 보안 정책은 우회하지 않습니다.

## 업데이트와 데이터 보존

기존 설치가 있으면 코드와 `cache`를 `%APPDATA%\MOGRT_Importer_backup\<날짜>_install_<ID>\code` 및 `cache`에 먼저 복사하고 SHA-256을 검증합니다. 이 백업은 CEP의 `extensions` 폴더 밖에 생성됩니다. 그 후 배포 코드만 덮어쓰며 캐시는 지우지 않습니다. 설치가 끝나면 모든 배포 파일과 기존 캐시가 일치하는지 다시 확인합니다. 파일 복사나 검증이 실패하면 기존 코드로 복원하고 백업 위치를 알려 줍니다.

Windows의 앱 제거 또는 설치 폴더의 `Uninstall.exe`는 설치 기록에 있는 코드만 제거합니다. 캐시, 백업, 설치 기록에 없는 사용자 파일은 남습니다. 제거 시에도 Premiere를 종료해야 합니다. 예전 설치 폴더나 캐시를 수동으로 삭제하지 마세요.

## ZIP으로 설치

ZIP을 별도 폴더에 모두 풀고 PowerShell에서 그 폴더로 이동한 뒤 실행합니다.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Install.ps1
```

서명 없는 CEP 허용에 동의한다면 다음 옵션을 추가합니다.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Install.ps1 -EnableUnsignedCep
```

여기서도 실행 정책은 해당 프로세스에만 적용됩니다. `Install.ps1`, `installer-engine.ps1`, `extension`, `metadata.json`, `files.sha256.json`을 같은 폴더에 두어야 합니다. ZIP 방식은 같은 검증·백업·캐시 보존 엔진을 사용하지만 Windows 앱 목록 등록과 `Uninstall.exe`는 생성하지 않습니다. ZIP 설치를 제거하려면 같은 폴더에서 다음을 실행합니다. 캐시와 백업은 남습니다.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\installer-engine.ps1 -Action Uninstall
```

## AI 연결

이 설치 파일은 Premiere 패널을 설치합니다. Claude·Codex 등의 MCP 클라이언트 연결은 별도 설정이며 자동으로 켜지지 않습니다. AI 기능을 사용하려면 저장소의 MCP 설치 안내를 따라 클라이언트를 연결하고, 패널의 **AI 연결 허용**을 직접 켭니다. 일반 SRT 가져오기·프리셋 편집·타임라인 적용에는 AI 연결이 필요하지 않습니다.
