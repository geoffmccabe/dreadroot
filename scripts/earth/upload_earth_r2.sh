#!/usr/bin/env bash
# Upload the Mini Earth height tile pyramid to Cloudflare R2 (step A4 of
# docs/MINI_EARTH_P1_BUILD.md). Tiles are served from https://assets.dreadroot.com/siege/earth/.
#
# WHY R2 AND NOT THE REPO: Cloudflare Pages has a hard 20,000-files-per-deployment cap and a
# 25 MiB per-file limit, and public/ is already ~15.8k files. Height tiles never go in git.
#
# WHY PARALLEL: `wrangler r2 object put` costs ~4.4 s of process startup per file, so 2,046
# tiles run 2.5 hours serially. Eight at a time brings it under 20 minutes. Wrangler has no
# bulk/recursive upload, and rclone would need R2 S3 API keys which are not configured here
# (the old /tmp/rclone-r2.conf was temp-dir and is long gone), so this is the available path.
#
#   scripts/earth/upload_earth_r2.sh [tile-dir] [parallelism]
set -euo pipefail

DIR="${1:-/tmp/earth-tiles}"
JOBS="${2:-8}"
BUCKET="dreadroot-assets"
PREFIX="siege/earth"

[ -d "$DIR" ] || { echo "no tile dir at $DIR; run build_earth_tiles.py first" >&2; exit 1; }

cd "$DIR"
# NOTE: macOS ships bash 3.2, which has no `mapfile`/`readarray`. Keep this list in a file
# and stream it, rather than in a shell array.
LIST="$(mktemp)"
# -path exclusions matter: wrangler writes a .wrangler/cache/wrangler-account.json into the
# CWD as it runs, and an unfiltered find swept that into the bucket on the first run, publishing
# the Cloudflare account id and name at a public URL. Only ever upload tiles we generated.
find . -type f \( -name '*.bin' -o -name 'manifest.json' \) -not -path './.wrangler/*' \
  | sed 's|^\./||' | sort > "$LIST"
TOTAL=$(wc -l < "$LIST" | tr -d ' ')
echo "Uploading $TOTAL files to r2://$BUCKET/$PREFIX/ with $JOBS parallel workers"
echo "(about 4.4 s per file serially, so expect roughly $(( TOTAL * 5 / JOBS / 60 )) minutes)"

STATE="$(mktemp -d)"
: > "$STATE/ok"; : > "$STATE/fail"
trap 'rm -rf "$STATE" "$LIST"' EXIT

upload_one() {
  local rel="$1" bucket="$2" prefix="$3" state="$4"
  local ct="application/octet-stream"
  [[ "$rel" == *.json ]] && ct="application/json"
  # Retry twice: a transient 5xx on one tile should not fail a 2,046-file run.
  for attempt in 1 2 3; do
    if wrangler r2 object put "$bucket/$prefix/$rel" --file "$rel" \
         --content-type "$ct" --remote >/dev/null 2>&1; then
      echo "$rel" >> "$state/ok"
      return 0
    fi
    sleep $(( attempt * 2 ))
  done
  echo "$rel" >> "$state/fail"
  return 0   # keep going; failures are reported at the end
}
export -f upload_one

xargs -P "$JOBS" -I{} bash -c 'upload_one "$@"' _ {} "$BUCKET" "$PREFIX" "$STATE" < "$LIST" &
XPID=$!

# Progress line, so a 20-minute run is not a silent one.
while kill -0 $XPID 2>/dev/null; do
  done_n=$(wc -l < "$STATE/ok" | tr -d ' ')
  fail_n=$(wc -l < "$STATE/fail" | tr -d ' ')
  printf '\r  %s/%s uploaded, %s failed   ' "$done_n" "$TOTAL" "$fail_n"
  sleep 5
done
wait $XPID || true

OK=$(wc -l < "$STATE/ok" | tr -d ' ')
FAIL=$(wc -l < "$STATE/fail" | tr -d ' ')
printf '\r  %s/%s uploaded, %s failed   \n' "$OK" "$TOTAL" "$FAIL"

if [ "$FAIL" -gt 0 ]; then
  echo "FAILED FILES:"; cat "$STATE/fail"; exit 1
fi

# VERIFY EVERY FILE, not a sample. The first run reported success while 33 tiles were missing:
# they had exhausted their retries, and spot-checking the diagonal tile indices happened to miss
# all of them. A partial planet renders as holes in the terrain, so this check is not optional.
echo "Verifying all $TOTAL objects are actually readable..."
BADF="$(mktemp)"
xargs -P 24 -I{} sh -c \
  'c=$(curl -s -o /dev/null -w "%{http_code}" "https://assets.dreadroot.com/'"$PREFIX"'/{}"); [ "$c" = 200 ] || echo "{} $c"' \
  < "$LIST" > "$BADF" 2>&1
BAD=$(wc -l < "$BADF" | tr -d ' ')
if [ "$BAD" -gt 0 ]; then
  echo "$BAD object(s) NOT readable after upload:"; cat "$BADF"
  echo "Re-run this script; it is idempotent and will re-put them."
  rm -f "$BADF"; exit 1
fi
rm -f "$BADF"
echo "All $TOTAL objects verified readable at https://assets.dreadroot.com/$PREFIX/"

