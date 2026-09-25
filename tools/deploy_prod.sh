#!/usr/bin/env bash
# 운영 배포: 커밋된 extension/ 을 CEP_MogrtImporter 에 반영한다 (캐시 안전).
#   0. Premiere가 실행 중이면 거부한다 (tasklist에 Adobe Premiere Pro.exe).
#   1. 운영 캐시와 코드를 extensions/ 밖 %APPDATA%/MOGRT_Importer_backup/<ts>/{cache,code} 로 백업하고
#      파일 수·바이트(캐시는 sha1까지)를 검증한다. 검증이 실패하면 아무것도 복사하지 않는다.
#   2. git archive로 만든 임시 사본에 @@BUILD@@ = prod-<sha> 를 찍고, CSXS·html·jsx·README.md·.debug 를
#      지우지 않고 덮어쓴다. cache/ 는 대상이 아니다.
#   3. 복사한 파일을 하나씩 비교하고, 캐시 sha1 목록이 배포 전과 같은지 다시 확인한다.
# installer_v1.1.6.exe 로 업그레이드·롤백하지 않는다 (캐시가 설치 폴더 안에 있다).
#
# 사용법:
#   tools/deploy_prod.sh                    HEAD 배포 (extension/ 에 커밋 안 된 변경이 있으면 거부)
#   tools/deploy_prod.sh --dry-run          무엇이 바뀔지만 보여 준다 (운영·백업 폴더에 쓰지 않음)
#   tools/deploy_prod.sh --rollback <ref>   <ref>(예: v27)의 extension/ 을 같은 절차로 배포
# 배포 뒤 읽기 전용 스모크: node tests/premiere/run.js --prod --port 7777 tests/premiere/smoke.expr.txt
# 환경 변수: MI_CEP_EXT_DIR, MI_BACKUP_ROOT (모의 배포할 때만)
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAMP="$REPO/tools/lib/stamp.js"

to_posix() { if command -v cygpath >/dev/null 2>&1; then cygpath -u "$1"; else printf '%s' "$1"; fi; }
native() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi; }
die() { echo "!! $*" >&2; exit "${2:-1}"; }

if [ -n "${APPDATA:-}" ]; then ROAMING="$(to_posix "$APPDATA")"; else ROAMING="$HOME/AppData/Roaming"; fi
EXT="$ROAMING/Adobe/CEP/extensions"
[ -n "${MI_CEP_EXT_DIR:-}" ] && EXT="$(to_posix "$MI_CEP_EXT_DIR")"
PROD="$EXT/CEP_MogrtImporter"
BACKUP_ROOT="$ROAMING/MOGRT_Importer_backup"
[ -n "${MI_BACKUP_ROOT:-}" ] && BACKUP_ROOT="$(to_posix "$MI_BACKUP_ROOT")"
ITEMS="CSXS html jsx README.md .debug"

DRY=0
REF="HEAD"
ROLLBACK=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1 ;;
    --rollback) [ $# -ge 2 ] || die "--rollback <gitref>"; REF="$2"; ROLLBACK=1; shift ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    *) die "모르는 인자: $1 (--dry-run | --rollback <gitref>)" ;;
  esac
  shift
done

# 백업은 반드시 extensions/ 밖 (CEP는 extensions/ 의 모든 하위 폴더를 확장으로 읽는다)
case "$BACKUP_ROOT/" in
  "$EXT"/*) die "백업 위치가 extensions/ 안이다: $BACKUP_ROOT" ;;
esac

premiere_running() {
  # 0 = 실행 중, 1 = 아님, 2 = 확인 불가
  command -v tasklist.exe >/dev/null 2>&1 || return 2
  local out
  out="$(tasklist.exe 2>/dev/null)" || return 2
  grep -qi "Adobe Premiere Pro.exe" <<<"$out"  # 파이프 대신 here-string (grep -q + pipefail의 SIGPIPE 회피)
}
tree_stats() {
  local n b
  n="$(find "$1" -type f | wc -l | tr -d ' ')"
  b="$(find "$1" -type f -printf '%s\n' | awk '{s+=$1} END {printf "%d", s}')"
  echo "$n files, $b bytes"
}
newest_mtime() { find "$1" -type f -printf '%T@ %P\n' | sort -n | tail -1; }
sha1_list() { (cd "$1" && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 -r sha1sum); }

echo "=== 0. 사전 확인 ==="
set +e; premiere_running; pr=$?; set -e
if [ "$pr" != 1 ]; then
  why="Premiere Pro가 실행 중이다"; [ "$pr" = 2 ] && why="Premiere 실행 여부를 확인할 수 없다 (tasklist)"
  if [ "$DRY" = 1 ]; then
    echo "   !! $why — 실제 배포라면 여기서 거부한다 (dry-run은 계속)"
  else
    die "$why — Premiere를 끄고 다시 실행한다. 아무것도 복사하지 않았다." 3
  fi
fi
[ -f "$PROD/CSXS/manifest.xml" ] || die "운영 설치본이 없다: $PROD"
grep -q 'ExtensionBundleId="com\.raonolje\.mogrtimporter"' "$PROD/CSXS/manifest.xml" || die "운영 manifest 신원이 이상하다: $PROD/CSXS/manifest.xml"
command -v node >/dev/null 2>&1 || die "node가 필요하다"
git -C "$REPO" rev-parse --verify --quiet "$REF^{commit}" >/dev/null || die "git ref 없음: $REF"
SHA="$(git -C "$REPO" rev-parse --short=7 "$REF^{commit}")"
BUILD="prod-$SHA"
if [ "$ROLLBACK" = 0 ] && [ -n "$(git -C "$REPO" status --porcelain -- extension)" ]; then
  if [ "$DRY" = 1 ]; then
    echo "   !! extension/ 에 커밋 안 된 변경이 있다 — 배포되는 것은 HEAD다 (실제 배포는 거부)"
  else
    die "extension/ 에 커밋 안 된 변경이 있다 — 커밋한 뒤 배포한다 (배포는 git archive HEAD)"
  fi
fi
echo "   ref=$REF ($SHA) build=$BUILD$([ "$ROLLBACK" = 1 ] && echo ' [롤백]')"
echo "   운영: $PROD"

TMPD="$(mktemp -d)"
trap 'rm -rf -- "$TMPD"' EXIT

echo "=== 1. 운영 캐시 현황 (배포 전) ==="
HAS_CACHE=0
if [ -d "$PROD/cache" ]; then
  HAS_CACHE=1
  CACHE_STATS_BEFORE="$(tree_stats "$PROD/cache")"
  CACHE_NEWEST_BEFORE="$(newest_mtime "$PROD/cache")"
  sha1_list "$PROD/cache" > "$TMPD/cache_before.txt"
  echo "   $CACHE_STATS_BEFORE, 최신 $CACHE_NEWEST_BEFORE"
else
  echo "   (cache 폴더 없음)"
fi

echo "=== 2. 임시 사본 (git archive $REF) + 스탬프 ==="
git -C "$REPO" archive --format=tar "$REF" extension | tar -x -C "$TMPD"
STAGE="$TMPD/extension"
for item in $ITEMS; do [ -e "$STAGE/$item" ] || die "$REF 에 extension/$item 이 없다"; done
node "$(native "$STAMP")" prod "$(native "$STAGE")" "$BUILD"
node "$(native "$STAMP")" verify-prod "$(native "$STAGE")" || die "운영 사본 검사 실패 — 배포하지 않았다"

echo "=== 3. 바뀔 파일 ==="
# git archive는 LF로 만든다. 운영에 CRLF 사본(지금의 html/index.html)이 있으면 내용은 같고
# 줄바꿈만 다르다 — 이것은 '줄바꿈만'으로 따로 세어 진짜 바뀜(~)이 묻히지 않게 한다.
changed=0; eolonly=0; added=0; same=0
while IFS= read -r -d '' f; do
  rel="${f#"$STAGE"/}"
  if [ ! -e "$PROD/$rel" ]; then echo "   + $rel"; added=$((added+1))
  elif cmp -s "$f" "$PROD/$rel"; then same=$((same+1))
  elif cmp -s <(tr -d '\r' < "$f") <(tr -d '\r' < "$PROD/$rel"); then echo "   = $rel (줄바꿈만 다름, 내용 같음)"; eolonly=$((eolonly+1))
  else echo "   ~ $rel"; changed=$((changed+1)); fi
done < <(for item in $ITEMS; do find "$STAGE/$item" -type f -print0; done)
echo "   바뀜 $changed, 줄바꿈만 $eolonly, 새 파일 $added, 같음 $same (운영에만 있는 파일은 지우지 않는다)"

recheck_cache() {
  [ "$HAS_CACHE" = 1 ] || return 0
  local now newest
  now="$(tree_stats "$PROD/cache")"; newest="$(newest_mtime "$PROD/cache")"
  sha1_list "$PROD/cache" > "$TMPD/cache_after.txt"
  if [ "$now" = "$CACHE_STATS_BEFORE" ] && [ "$newest" = "$CACHE_NEWEST_BEFORE" ] && cmp -s "$TMPD/cache_before.txt" "$TMPD/cache_after.txt"; then
    echo "   OK  캐시 그대로: $now, 최신 $newest"
    return 0
  fi
  echo "   !! 캐시가 달라졌다: 전 [$CACHE_STATS_BEFORE / $CACHE_NEWEST_BEFORE] 후 [$now / $newest]"
  diff "$TMPD/cache_before.txt" "$TMPD/cache_after.txt" | head -20 || true
  return 1
}

if [ "$DRY" = 1 ]; then
  echo "=== dry-run: 운영·백업 폴더에 쓰지 않았다 ==="
  recheck_cache || die "dry-run 중 캐시가 바뀌었다 (운영 패널이 열려 있나?)"
  exit 0
fi

echo "=== 4. 백업 (extensions/ 밖) ==="
TS="$(date +%Y%m%d_%H%M%S)"
B="$BACKUP_ROOT/$TS"
[ -e "$B" ] && die "백업 폴더가 이미 있다: $B"
mkdir -p "$B/code" "$B/cache"
for e in "$PROD"/* "$PROD"/.[!.]*; do
  [ -e "$e" ] || continue
  [ "$(basename "$e")" = "cache" ] && continue
  cp -rp "$e" "$B/code/"
done
if [ "$HAS_CACHE" = 1 ]; then cp -rp "$PROD/cache/." "$B/cache/"; fi
# 검증: 코드(캐시 제외) 파일 수·바이트, 캐시 파일 수·바이트·sha1
code_src="$(cd "$PROD" && find . -path ./cache -prune -o -type f -printf '%s\n' | awk '{n++; s+=$1} END {printf "%d files, %d bytes", n, s}')"
code_bak="$(tree_stats "$B/code")"
echo "   코드: 운영 $code_src / 백업 $code_bak"
[ "$code_src" = "$code_bak" ] || die "코드 백업 검증 실패 — 아무것도 복사하지 않았다 ($B)"
if [ "$HAS_CACHE" = 1 ]; then
  cache_bak="$(tree_stats "$B/cache")"
  sha1_list "$B/cache" > "$TMPD/cache_backup.txt"
  echo "   캐시: 운영 $CACHE_STATS_BEFORE / 백업 $cache_bak"
  [ "$cache_bak" = "$CACHE_STATS_BEFORE" ] && cmp -s "$TMPD/cache_before.txt" "$TMPD/cache_backup.txt" \
    || die "캐시 백업 검증 실패 — 아무것도 복사하지 않았다 ($B)"
fi
{
  echo "ref=$REF sha=$(git -C "$REPO" rev-parse "$REF^{commit}") build=$BUILD rollback=$ROLLBACK"
  echo "time=$(date '+%Y-%m-%d %H:%M:%S') prod=$(native "$PROD")"
} > "$B/DEPLOY_INFO.txt"
echo "   백업: $B"

echo "=== 5. 복사 (지우지 않고 덮어쓰기) ==="
for item in $ITEMS; do
  cp -rf "$STAGE/$item" "$PROD/"
done

echo "=== 6. 검증 ==="
bad=0
while IFS= read -r -d '' f; do
  rel="${f#"$STAGE"/}"
  cmp -s "$f" "$PROD/$rel" || { echo "   !! 다르다: $rel"; bad=$((bad+1)); }
done < <(for item in $ITEMS; do find "$STAGE/$item" -type f -print0; done)
[ "$bad" = 0 ] || die "복사 검증 실패 ${bad}건 — 백업: $B" 4
echo "   OK  복사한 파일이 모두 같다"
recheck_cache || die "배포 뒤 캐시가 달라졌다 — 백업에서 복구: $B/cache" 5
grep -nE 'ExtensionBundleId|<Extension Id' "$PROD/CSXS/manifest.xml" | sed 's/^/   /'
grep -oE 'Port="[0-9]+"' "$PROD/.debug" | sed 's/^/   /'

cat <<EOF

배포 완료: $BUILD ($REF)
  백업: $B
  롤백: tools/deploy_prod.sh --rollback <이전 ref>   (예: v27)
다음: Premiere 실행 → 운영 패널 → node tests/premiere/run.js --prod --port 7777 tests/premiere/smoke.expr.txt
EOF
