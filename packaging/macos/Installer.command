#!/bin/bash
# macOS / Bash 3.2. ZIP root: this script, extension/, release.json, SHA256SUMS.
# Bash 3.2 treats some empty-array expansions as unbound under set -u.
# Required paths are checked explicitly below.
set -eo pipefail
export PATH=/usr/bin:/bin:/usr/sbin:/sbin

BACKUP=""
INSTALL_STARTED=0
fail() { printf '\n설치 중단: %s\n' "$*" >&2; exit 1; }
finish() {
  status=$?
  if [ "$status" -ne 0 ] && [ -n "$BACKUP" ]; then
    printf '\n백업/설치 기록: %s\n' "$BACKUP" >&2
    if [ "$INSTALL_STARTED" -eq 1 ]; then
      printf '설치가 완료되지 않았습니다. Premiere를 열지 말고 아래 README의 복구 절차를 확인하세요.\n' >&2
    fi
  fi
  if [ -t 0 ]; then
    printf '\n이 창을 닫으려면 Enter를 누르세요.'
    IFS= read -r answer || true
  fi
  return "$status"
}
trap finish EXIT

[ "$(uname -s)" = "Darwin" ] || fail "이 설치 파일은 macOS에서만 실행할 수 있습니다."
[ "$(id -u)" -ne 0 ] || fail "sudo/관리자 계정으로 실행하지 말고, Premiere를 사용하는 본인 계정에서 여세요."
[ -t 0 ] || fail "Finder에서 Installer.command를 열거나 Terminal에서 대화식으로 실행하세요."
for tool in shasum ditto defaults pgrep find diff; do
  command -v "$tool" >/dev/null 2>&1 || fail "macOS 기본 도구가 없습니다: $tool"
done
PACKAGE=$(cd -P "$(dirname "$0")" && pwd)
[ -n "${HOME:-}" ] && [ -d "$HOME" ] || fail "사용자 홈 폴더를 확인할 수 없습니다."
USER_HOME=$(cd -P "$HOME" && pwd)
EXTENSIONS="$USER_HOME/Library/Application Support/Adobe/CEP/extensions"
TARGET="$EXTENSIONS/CEP_MogrtImporter"
BACKUP_ROOT="$USER_HOME/Library/Application Support/MogrtImporter/installer-backups"
SYSTEM_EXTENSIONS="/Library/Application Support/Adobe/CEP/extensions"

premiere_stopped() {
  local status=0
  pgrep -f '/Adobe Premiere Pro[^/]*[.]app/Contents/MacOS/' >/dev/null 2>&1 || status=$?
  case "$status" in
    0) fail "Adobe Premiere Pro를 완전히 종료한 다음 설치 파일을 다시 실행하세요. 프로젝트는 먼저 저장하세요." ;;
    1) ;;
    *) fail "Premiere 실행 여부를 확인하지 못했습니다. 설치하지 않습니다." ;;
  esac
}
# Refuse links in destination ancestors; never copy through a redirected code folder.
safe_directory_path() {
  local path="$1" current="" component
  local old_ifs="$IFS"
  local -a components
  IFS='/' read -r -a components <<< "$path"
  IFS="$old_ifs"
  for component in "${components[@]}"; do
    [ -n "$component" ] || continue
    current="$current/$component"
    [ ! -L "$current" ] || fail "심볼릭 링크 경로에는 자동 설치하지 않습니다: $current"
    if [ -e "$current" ] && [ ! -d "$current" ]; then fail "폴더가 아닌 경로가 있습니다: $current"; fi
  done
}
same_extension() {
  grep -Eq '(ExtensionBundleId|Id)[[:space:]]*=[[:space:]]*"com[.]raonolje[.]mogrtimporter([.]panel)?"' "$1"
}
installed_extension() {
  # Released 1.0.0/1.1.6 used the original com.manus bundle ID.
  grep -Eq '(ExtensionBundleId|Id)[[:space:]]*=[[:space:]]*"com[.](raonolje|manus)[.]mogrtimporter([.]panel)?"' "$1"
}
check_duplicates() {
  local manifest folder
  if [ -e "$SYSTEM_EXTENSIONS/CEP_MogrtImporter" ] || [ -L "$SYSTEM_EXTENSIONS/CEP_MogrtImporter" ]; then
    fail "시스템 전체 설치본이 있습니다: $SYSTEM_EXTENSIONS/CEP_MogrtImporter. 설치한 관리자에게 캐시를 백업하고 기존 설치를 정리해 달라고 요청하세요. 사용자 설치본을 중복 생성하지 않습니다."
  fi
  for manifest in "$SYSTEM_EXTENSIONS"/*/CSXS/manifest.xml "$EXTENSIONS"/*/CSXS/manifest.xml; do
    [ -f "$manifest" ] || continue
    folder=${manifest%/CSXS/manifest.xml}
    if [ "$folder" != "$TARGET" ] && installed_extension "$manifest"; then
      fail "다른 위치에 같은 확장 ID가 있습니다: $folder. 그 설치본과 cache를 먼저 확인해 중복을 정리하세요."
    fi
  done
  if [ -f "$TARGET/CSXS/manifest.xml" ] && ! installed_extension "$TARGET/CSXS/manifest.xml"; then
    fail "대상 폴더의 확장 ID가 다릅니다: $TARGET. 다른 확장을 덮어쓰지 않습니다."
  fi
}

premiere_stopped
safe_directory_path "$TARGET"
safe_directory_path "$BACKUP_ROOT"
check_duplicates
[ -f "$PACKAGE/SHA256SUMS" ] && [ -f "$PACKAGE/release.json" ] || fail "ZIP 전체를 압축 해제하세요. SHA256SUMS 또는 release.json이 없습니다."
[ -f "$PACKAGE/extension/CSXS/manifest.xml" ] || fail "extension/CSXS/manifest.xml이 없습니다."
[ ! -e "$PACKAGE/extension/cache" ] && [ ! -L "$PACKAGE/extension/cache" ] || fail "배포물에 사용자 cache가 들어 있습니다. 올바른 릴리스 ZIP을 받으세요."
[ -z "$(find "$PACKAGE/extension" -type l -print)" ] || fail "배포물에 심볼릭 링크가 있습니다. 설치하지 않습니다."
same_extension "$PACKAGE/extension/CSXS/manifest.xml" || fail "배포물의 확장 ID가 올바르지 않습니다."

HASHES=()
FILES=()
hex_re='^[[:xdigit:]]{64}$'
while IFS= read -r line || [ -n "$line" ]; do
  [ -n "$line" ] || fail "SHA256SUMS에 빈 줄이 있습니다."
  digest=${line:0:64}
  separator=${line:64:2}
  relative=${line:66}
  [[ "$digest" =~ $hex_re ]] || fail "잘못된 SHA256SUMS 해시입니다."
  [ "$separator" = '  ' ] || [ "$separator" = ' *' ] || fail "잘못된 SHA256SUMS 구분자입니다."
  case "$relative" in
    extension/*|Installer.command|release.json|README_MACOS.md) ;;
    *) fail "허용하지 않은 체크섬 경로: $relative" ;;
  esac
  case "/$relative/" in *'/../'*|*'/./'*|*'//'*) fail "안전하지 않은 체크섬 경로: $relative" ;; esac
  case "$relative" in *\\*|*$'\r'*|*$'\t'*) fail "안전하지 않은 체크섬 파일명입니다." ;; esac
  for existing in "${FILES[@]}"; do [ "$existing" != "$relative" ] || fail "중복 체크섬 경로: $relative"; done
  [ -f "$PACKAGE/$relative" ] && [ ! -L "$PACKAGE/$relative" ] || fail "배포 파일이 없거나 링크입니다: $relative"
  HASHES+=("$digest")
  FILES+=("$relative")
done < "$PACKAGE/SHA256SUMS"
[ "${#FILES[@]}" -gt 0 ] || fail "SHA256SUMS가 비었습니다."
listed() {
  local wanted="$1" entry
  for entry in "${FILES[@]}"; do [ "$entry" != "$wanted" ] || return 0; done
  return 1
}
for required in Installer.command release.json extension/CSXS/manifest.xml extension/html/index.html extension/html/js/app.js extension/jsx/hostscript.jsx; do
  listed "$required" || fail "필수 파일의 체크섬이 없습니다: $required"
done
while IFS= read -r -d '' payload_file; do
  relative=${payload_file#"$PACKAGE/"}
  listed "$relative" || fail "체크섬에 없는 배포 파일: $relative"
done < <(find "$PACKAGE/extension" -type f -print0)
printf '배포 파일 SHA-256 확인 중…\n'
(cd "$PACKAGE" && shasum -a 256 -c SHA256SUMS) || fail "배포 파일 검증 실패. 공식 릴리스를 다시 내려받으세요."

if [ -d "$TARGET" ] && [ -n "$(find "$TARGET" -type l -print)" ]; then
  fail "기존 설치본에 심볼릭 링크가 있습니다. cache를 보존한 수동 설치가 필요합니다: $TARGET"
fi
runtime_major() {
  case "$1" in
    11|11.*) printf '11' ;;
    12|12.*) printf '12' ;;
    *) return 1 ;;
  esac
}
# Manifest RequiredRuntime is a minimum, not the host's installed CEP version.
DETECTED_RUNTIME=""
for app in /Applications/Adobe\ Premiere\ Pro*/*.app /Applications/Adobe\ Premiere\ Pro*.app "$USER_HOME"/Applications/Adobe\ Premiere\ Pro*/*.app "$USER_HOME"/Applications/Adobe\ Premiere\ Pro*.app; do
  engine="$app/Contents/MacOS/CEPHtmlEngine.app/Contents/Info.plist"
  [ -f "$engine" ] || continue
  engine_version=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$engine" 2>/dev/null || true)
  major=$(runtime_major "$engine_version" || true)
  [ -n "$major" ] || continue
  printf '발견한 Premiere CEP %s: %s\n' "$engine_version" "$app"
  if [ -z "$DETECTED_RUNTIME" ] || [ "$major" -gt "$DETECTED_RUNTIME" ]; then DETECTED_RUNTIME="$major"; fi
done
[ -n "$DETECTED_RUNTIME" ] || fail "지원하는 Premiere CEP 11/12를 찾지 못했습니다. Premiere를 Applications 폴더에 설치한 뒤 다시 실행하세요."
printf '\n사용할 Premiere의 CEP 버전 [기본 %s, 11 또는 12]: ' "$DETECTED_RUNTIME"
IFS= read -r selected_runtime
RUNTIME=${selected_runtime:-$DETECTED_RUNTIME}
case "$RUNTIME" in 11|12) ;; *) fail "CEP 버전은 11 또는 12여야 합니다." ;; esac
NEEDS_DEBUG=()
for runtime in "$RUNTIME"; do
  value=$(defaults read "com.adobe.CSXS.$runtime" PlayerDebugMode 2>/dev/null || true)
  [ "$value" = 1 ] || NEEDS_DEBUG+=("$runtime")
done
printf '\nMOGRT Subtitle Importer — macOS 실험 배포\n'
printf '실제 검증 범위와 남은 항목은 README_MACOS.md 및 docs/MAC_VALIDATION.md를 확인하세요.\n'
printf '설치 위치: %s\n기존 코드와 cache 백업: %s\n' "$TARGET" "$BACKUP_ROOT"
printf 'Node.js 없이 CEP 패널을 설치합니다. AI/MCP 서버 연결은 별도 설정입니다.\n'
if [ "${#NEEDS_DEBUG[@]}" -gt 0 ]; then
  printf '\n이 ZIP의 CEP 패널은 Adobe 서명이 없습니다. 로드하려면 다음 사용자 설정을 1로 변경해야 합니다:\n'
  for runtime in "${NEEDS_DEBUG[@]}"; do printf '  com.adobe.CSXS.%s / PlayerDebugMode\n' "$runtime"; done
  printf '이 Adobe 설정은 해당 CEP 버전의 다른 미서명 패널도 허용합니다. macOS Gatekeeper/격리 속성은 변경하지 않습니다.\n'
else
  printf '\nCSXS.%s의 PlayerDebugMode가 이미 1입니다. 이 설정은 바꾸지 않습니다.\n' "$RUNTIME"
fi
printf '\n위 설치와 명시된 Adobe 설정 변경에 동의하면 INSTALL을 입력하세요. 그 외 입력은 취소합니다: '
IFS= read -r consent
[ "$consent" = INSTALL ] || { printf '설치를 취소했습니다.\n'; exit 0; }
premiere_stopped
check_duplicates
safe_directory_path "$TARGET"
safe_directory_path "$BACKUP_ROOT"
mkdir -p "$EXTENSIONS" "$BACKUP_ROOT"
BACKUP="$BACKUP_ROOT/$(date +%Y%m%d-%H%M%S)-$$"
mkdir "$BACKUP"
cp "$PACKAGE/release.json" "$PACKAGE/SHA256SUMS" "$BACKUP/"
for runtime in "$RUNTIME"; do
  value=$(defaults read "com.adobe.CSXS.$runtime" PlayerDebugMode 2>/dev/null || printf '<absent>')
  printf 'com.adobe.CSXS.%s PlayerDebugMode=%s\n' "$runtime" "$value" >> "$BACKUP/PlayerDebugMode.before.txt"
done
if [ -d "$TARGET" ]; then
  printf '기존 설치본과 cache 백업 중…\n'
  ditto "$TARGET" "$BACKUP/code"
  diff -qr "$TARGET" "$BACKUP/code" >/dev/null || fail "백업 내용이 원본과 다릅니다. 설치본은 바꾸지 않았습니다."
fi
premiere_stopped
printf '패널 코드를 설치합니다. 기존 cache는 덮어쓰지 않습니다.\n'
INSTALL_STARTED=1
ditto "$PACKAGE/extension" "$TARGET"
for ((i=0; i<${#FILES[@]}; i++)); do
  relative=${FILES[$i]}
  case "$relative" in
    extension/*)
      installed="$TARGET/${relative#extension/}"
      [ -f "$installed" ] && [ ! -L "$installed" ] || fail "설치 파일을 읽을 수 없습니다: $installed"
      actual=$(shasum -a 256 "$installed")
      [ "${actual%% *}" = "${HASHES[$i]}" ] || fail "설치 후 SHA-256이 다릅니다: $installed"
      ;;
  esac
done
if [ -d "$BACKUP/code/cache" ]; then
  diff -qr "$BACKUP/code/cache" "$TARGET/cache" >/dev/null || fail "기존 cache 보존 검증 실패. 백업은 유지됩니다."
fi
for runtime in "${NEEDS_DEBUG[@]}"; do
  defaults write "com.adobe.CSXS.$runtime" PlayerDebugMode -string 1
  [ "$(defaults read "com.adobe.CSXS.$runtime" PlayerDebugMode)" = 1 ] || fail "Adobe PlayerDebugMode 설정을 확인하지 못했습니다."
done
printf '\n설치 및 SHA-256/cache 보존 검증을 완료했습니다.\n'
printf 'Premiere를 실행해 창 > 확장(레거시) > MOGRT Subtitle Importer를 여세요. 메뉴 명칭은 Premiere 버전에 따라 다를 수 있습니다.\n'
printf '백업/기록: %s\n' "$BACKUP"
