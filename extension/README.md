# MOGRT Subtitle Importer (통합 패널 버전)

Premiere Pro 내부에서 직접 **SRT 자막 파일**을 불러오고, 각 자막에 **MOGRT**를 적용하여 **타임라인에 자동 배치**해 주는 통합 확장 패널입니다.

## 🛠 1. 설치 방법

1. `CEP_MogrtImporter` 폴더(이 폴더 전체)를 복사합니다.
2. 아래의 경로로 이동하여 붙여넣기 합니다.
   * **Windows:** `C:\Program Files (x86)\Common Files\Adobe\CEP\extensions\`
   * **Mac:** `/Library/Application Support/Adobe/CEP/extensions/`
3. (필수) 서명되지 않은 확장을 허용하기 위해 **디버그 모드**를 활성화해야 합니다.
   * **Windows:** 레지스트리 편집기(`regedit`)를 열고 `HKEY_CURRENT_USER\Software\Adobe\CSXS.11` (또는 CSXS.10, CSXS.12 등 사용 중인 버전)으로 이동하여, `PlayerDebugMode` (문자열 값)을 생성하고 값을 `1`로 설정합니다.
   * **Mac:** 터미널에서 `defaults write com.adobe.CSXS.11 PlayerDebugMode 1` 입력 (버전 숫자는 맞춰서 변경)

## 🚀 2. 사용 방법

1. Premiere Pro를 재시작합니다.
2. 상단 메뉴에서 **Window -> Extensions -> MOGRT Subtitle Importer** 를 클릭하여 패널을 엽니다.
3. 상단 툴바에서 **[📂 SRT 열기]** 버튼을 눌러 Premiere Pro에서 추출한 `.srt` 파일을 엽니다.
4. **[🎬 MOGRT 스캔]** 버튼을 누르면 내 컴퓨터에 설치된 기본 MOGRT 목록을 불러옵니다.
5. 리스트에 나타난 각 자막의 우측 드롭다운에서 적용할 MOGRT를 선택합니다.
   * MOGRT를 선택하면 아래에 세부 파라미터(MainText, 폰트 크기, 색상 등)를 조절할 수 있는 창이 열립니다.
   * `MainText` 속성이 있는 경우, 자막 텍스트가 자동으로 입력됩니다.
6. 우측 상단 툴바에서 자막을 배치할 트랙(예: V3, V4)을 선택합니다.
7. **[▶ 타임라인에 적용]** 버튼을 누르면 선택한 MOGRT들이 타임라인에 자동으로 배치되고, 자막 텍스트와 파라미터가 적용됩니다.

## ⚠️ 주의사항
* MOGRT의 텍스트 속성을 스크립트로 제어하려면, 해당 MOGRT가 **After Effects**에서 제작된 것이어야 합니다.
* 타임라인에 MOGRT를 자동 배치하는 과정은 다소 시간이 걸릴 수 있습니다. 진행되는 동안 Premiere Pro를 조작하지 마세요.
