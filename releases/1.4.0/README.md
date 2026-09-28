# MOGRT Subtitle Importer 1.4.0

| 운영체제 | 설치 파일 | 상태 |
|---|---|---|
| Windows | [설치 EXE](MOGRTImporter_v1.4.0_Windows.exe) | 현재 사용자 계정에 설치, 기존 캐시 보존 |
| Windows | [ZIP](MOGRTImporter_v1.4.0_Windows.zip) | 압축 해제 후 `README_WINDOWS.md` 참고 |
| macOS | [실험용 ZIP](MOGRTImporter_v1.4.0_macOS_experimental.zip) | **Intel Mac / Premiere 26.3.0 핵심 기능 검증**, 서명·공증 PKG 아님 |

Windows 소스: `b3444dd3b0895e537a6c3cf73095a363aa3371a4`, 빌드: `prod-b3444dd` (기존 배포물 유지).
Mac 소스: `8f0dd132f79d59cbefb0ca8077a31f217f3e2c5f`, 빌드: `prod-8f0dd13`.
Apple Silicon과 다른 Premiere 버전은 미검증이다. [Mac 실측 기록](../../docs/MAC_VALIDATION.md)을 확인한다.
운영체제별 메타데이터를 담은 [release.json](release.json)과 [SHA256SUMS](SHA256SUMS)로 파일과 소스 식별을 확인할 수 있다. 배포물을 추가한 커밋은 소스 커밋보다 뒤이므로 저장소 최신 HEAD와 위 값이 다른 것은 정상이다.

Premiere 프로젝트를 저장하고 앱을 완전히 종료한 뒤 설치한다. 설치기는 기존 코드와 `cache`를 확장 폴더 밖에 백업하고, 설치 파일 해시 및 기존 캐시 보존을 검증한다. Windows 설치에는 관리자 권한이 필요 없다. 구버전 `installer_v1.1.6.exe`는 최신 설치본이 아니다.

Windows와 macOS 패키지는 서명되지 않았다. 필요한 미서명 CEP 설정은 설치 화면에서 설명하고 동의를 받는다. MOGRT 파일·폰트·개인 프리셋은 포함되지 않으며, AI/MCP 연결은 별도 설정이다.

[Windows 상세 안내](../../packaging/windows/README_WINDOWS.md) · [Mac 상세 안내](../../packaging/macos/README_MACOS.md) · [Mac에서 개발·실기 검증 이어가기](../../docs/MAC_HANDOFF.md) · [검증 범위](../../docs/MCP_VALIDATION.md)
