#!/usr/bin/env bash
# DEV 사본 설치: 저장소 extension/ 을 CEP_MogrtImporter_dev 로 복사한다.
# 운영 설치본(CEP_MogrtImporter)과 절대 부딪히지 않게 신원을 모두 바꾼다.
#   - 번들 id com.raonolje.mogrtimporter.dev, 패널 id ….dev.panel
#   - 메뉴 "MOGRT Subtitle Importer (DEV)", 디버그 포트 7778
#   - hostscript.jsx·app.js의 \bMI_ → MID_ (ExtendScript 전역은 모든 확장이 같이 쓴다, spike #16).
#     식별자가 아닌 MI_test(.prproj)·MI_REAL_CACHE 같은 이름은 그대로 (tools/lib/stamp.js MI_KEEP)
#   - @@BUILD@@ → dev-<git short sha> (작업 트리가 더러우면 -d<시각>을 붙여 설치마다 다르게)
# 캐시는 <확장 폴더>/cache 라 구조상 분리된다. 이 스크립트는 DEV의 cache/ 를 지우지 않고,
# 운영 폴더에는 아무것도 쓰지 않는다(설치 전후 sha1 목록으로 확인).
#
# 사용법:
#   tools/install_dev.sh                코드 설치/갱신 (지우지 않고 덮어쓴다)
#   tools/install_dev.sh --seed-cache   + 운영 캐시를 DEV 캐시로 복사 (운영은 읽기만; 기존 DEV 캐시는 cache_prev_<ts>로 옮긴다)
#   tools/install_dev.sh --uninstall    CEP_MogrtImporter_dev 폴더만 지운다 (Premiere 종료 상태에서)
# 설치 뒤: Premiere 종료 → 실행 → Ctrl+O로 MI_test.prproj → 창 > 확장 > MOGRT Subtitle Importer (DEV)
#          → node tests/premiere/run.js --port 7778 --check-build
# 환경 변수: MI_CEP_EXT_DIR (extensions 폴더를 바꿔 모의 설치할 때만)
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$REPO/extension"
STAMP="$REPO/tools/lib/stamp.js"

to_posix() { if command -v cygpath >/dev/null 2>&1; then cygpath -u "$1"; else printf '%s' "$1"; fi; }
native() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi; }
die() { echo "!! $*" >&2; exit 1; }

if [ -n "${MI_CEP_EXT_DIR:-}" ]; then
  EXT="$(to_posix "$MI_CEP_EXT_DIR")"
elif [ -n "${APPDATA:-}" ]; then
  EXT="$(to_posix "$APPDATA")/Adobe/CEP/extensions"
else
  EXT="$HOME/AppData/Roaming/Adobe/CEP/extensions"
fi
PROD="$EXT/CEP_MogrtImporter"
DEV="$EXT/CEP_MogrtImporter_dev"

SEED=0
UNINSTALL=0
for arg in "$@"; do
  case "$arg" in
    --seed-cache) SEED=1 ;;
    --uninstall) UNINSTALL=1 ;;
    -h|--help) sed -n '2,18p' "$0"; exit 0 ;;
    *) die "모르는 인자: $arg (--seed-cache | --uninstall)" ;;
  esac
done
[ "$UNINSTALL" = 1 ] && [ "$SEED" = 1 ] && die "--uninstall 과 --seed-cache 는 같이 쓸 수 없다"

# ── 안전장치: 쓰기 대상은 언제나 DEV 폴더 안이어야 한다 ──
[ "$(basename "$DEV")" = "CEP_MogrtImporter_dev" ] || die "DEV 경로 이상: $DEV"
[ "$DEV" != "$PROD" ] || die "DEV 경로가 운영 경로와 같다"
assert_dev_path() {
  case "$1" in
    "$DEV"|"$DEV"/*) ;;
    *) die "DEV 폴더 밖에 쓰려고 했다: $1" ;;
  esac
}

premiere_running() {
  # 0 = 실행 중, 1 = 아님, 2 = 확인 불가
  command -v tasklist.exe >/dev/null 2>&1 || return 2
  local out
  out="$(tasklist.exe 2>/dev/null)" || return 2
  grep -qi "Adobe Premiere Pro.exe" <<<"$out"  # 파이프 대신 here-string (grep -q + pipefail의 SIGPIPE 회피)
}

prod_manifest() {
  # 운영 폴더 전체(코드 + cache)의 sha1 목록
  [ -d "$PROD" ] || { echo "(운영 폴더 없음)"; return 0; }
  (cd "$PROD" && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 -r sha1sum)
}

tree_stats() {
  # "<파일 수> files, <바이트> bytes"
  local n b
  n="$(find "$1" -type f | wc -l | tr -d ' ')"
  b="$(find "$1" -type f -printf '%s\n' | awk '{s+=$1} END {printf "%d", s}')"
  echo "$n files, $b bytes"
}

# ── --uninstall ──
if [ "$UNINSTALL" = 1 ]; then
  if [ ! -d "$DEV" ]; then echo "DEV 사본이 없다: $DEV"; exit 0; fi
  set +e; premiere_running; pr=$?; set -e
  [ "$pr" = 1 ] || die "Premiere가 실행 중이거나 확인할 수 없다 — Premiere를 끄고 다시 실행한다"
  if [ -f "$DEV/CSXS/manifest.xml" ] && ! grep -q 'com\.raonolje\.mogrtimporter\.dev"' "$DEV/CSXS/manifest.xml"; then
    die "$DEV/CSXS/manifest.xml 이 DEV 신원이 아니다 — 지우지 않는다"
  fi
  assert_dev_path "$DEV"
  echo "DEV 사본 삭제: $DEV ($(tree_stats "$DEV"))"
  rm -rf -- "$DEV"
  echo "완료. 운영 폴더($PROD)는 건드리지 않았다."
  exit 0
fi

# ── 설치 ──
[ -f "$SRC/CSXS/manifest.xml" ] || die "저장소 extension/ 을 찾을 수 없다: $SRC"
[ -f "$STAMP" ] || die "tools/lib/stamp.js 없음"
command -v node >/dev/null 2>&1 || die "node가 필요하다"
[ -d "$PROD" ] || echo "   (참고) 운영 폴더가 없다: $PROD — devswap.sh로 옮겨 둔 상태인지 확인"

SHA="$(git -C "$REPO" rev-parse --short=7 HEAD)"
BUILD="dev-$SHA"
if [ -n "$(git -C "$REPO" status --porcelain -- extension)" ]; then
  BUILD="$BUILD-d$(date +%Y%m%d%H%M%S)"
fi

TMPD="$(mktemp -d)"
trap 'rm -rf -- "$TMPD"' EXIT
STAGE="$TMPD/stage"
mkdir -p "$STAGE"

echo "=== 1. 운영 폴더 sha1 목록 (설치 전) ==="
prod_manifest > "$TMPD/prod_before.txt"
echo "   $(wc -l < "$TMPD/prod_before.txt" | tr -d ' ') 파일"

echo "=== 2. 임시 사본 만들기 + DEV 변환 ($BUILD) ==="
for item in CSXS html jsx README.md .debug; do
  [ -e "$SRC/$item" ] || die "extension/$item 없음"
  cp -r "$SRC/$item" "$STAGE/"
done
node "$(native "$STAMP")" dev "$(native "$STAGE")" "$BUILD"
node "$(native "$STAMP")" verify-dev "$(native "$STAGE")" "$(native "$SRC")" || die "DEV 변환 검사 실패 — 설치하지 않았다"

echo "=== 3. DEV 폴더에 복사 (지우지 않고 덮어쓰기, cache/ 는 대상 아님) ==="
assert_dev_path "$DEV"
mkdir -p "$DEV"
cp -rf "$STAGE/." "$DEV/"
printf '%s\n' "$BUILD" "installed $(date '+%Y-%m-%d %H:%M:%S') from $(native "$REPO") @ $(git -C "$REPO" rev-parse HEAD)" > "$DEV/.mi_build"
node "$(native "$STAMP")" verify-dev "$(native "$DEV")" "$(native "$SRC")" || die "설치된 DEV 사본 검사 실패"

if [ "$SEED" = 1 ]; then
  echo "=== 4. 운영 캐시 → DEV 캐시 (운영은 읽기만) ==="
  if [ ! -d "$PROD/cache" ]; then
    echo "   운영 캐시가 없다: $PROD/cache — 건너뜀"
  else
    if [ -d "$DEV/cache" ] && [ -n "$(ls -A "$DEV/cache" 2>/dev/null)" ]; then
      prev="$DEV/cache_prev_$(date +%Y%m%d_%H%M%S)"
      assert_dev_path "$prev"
      mv "$DEV/cache" "$prev"
      echo "   기존 DEV 캐시 보관: $prev"
    fi
    assert_dev_path "$DEV/cache"
    mkdir -p "$DEV/cache"
    cp -rp "$PROD/cache/." "$DEV/cache/"
    a="$(tree_stats "$PROD/cache")"; b="$(tree_stats "$DEV/cache")"
    echo "   운영: $a"
    echo "   DEV : $b"
    [ "$a" = "$b" ] || die "캐시 복사 검증 실패 (파일 수/바이트가 다르다)"
  fi
fi

echo "=== 5. 운영 폴더 sha1 목록 (설치 후) ==="
prod_manifest > "$TMPD/prod_after.txt"
if cmp -s "$TMPD/prod_before.txt" "$TMPD/prod_after.txt"; then
  echo "   OK  운영 폴더 변화 없음"
else
  echo "   !! 운영 폴더가 설치 중에 바뀌었다 (이 스크립트는 쓰지 않는다 — 운영 패널이 열려 자동저장했을 수 있다):"
  diff "$TMPD/prod_before.txt" "$TMPD/prod_after.txt" | head -20 || true
fi

cat <<EOF

DEV 설치 완료
  폴더  : $DEV
  빌드  : $BUILD
  메뉴  : 창 > 확장 > MOGRT Subtitle Importer (DEV)
  포트  : 7778 (운영 7777은 그대로)
다음: Premiere 종료 → 실행 → Ctrl+O로 MI_test.prproj → DEV 패널 열기
      → node tests/premiere/run.js --port 7778 --check-build
      (JSX가 바뀌었으면 반드시 Premiere 재시작. 운영 패널은 닫아 둔다.)
EOF
