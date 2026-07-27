#!/usr/bin/env bash
# Upload Mini Earth height tiles to Cloudflare R2, served from https://assets.dreadroot.com.
#
# WHY R2 AND NOT THE REPO: Cloudflare Pages caps a deployment at 20,000 files and 25 MiB per
# file, and public/ is already ~15.8k files. Height tiles never go in git.
#
# USES RCLONE. Measured 200 tiles in 9.2 s (about 1,300/min) against wrangler's ~14/min, because
# wrangler launches a whole node process per file. That is the difference between a 13-minute
# upload and a 20-hour one for the landmark set. Wrangler stays as the fallback when no rclone
# remote is configured.
#
# CREDENTIALS live in ~/.config/rclone/rclone.conf as remote [r2] (chmod 600). NOT in /tmp: the
# previous R2 token was stored at /tmp/rclone-r2.conf, macOS cleared it, and it was unrecoverable
# because Cloudflare shows R2 secret keys exactly once.
# The token is scoped to Object Read & Write on the dreadroot-assets bucket only, so it cannot
# list or create buckets. A 403 on ListBuckets or GetBucketVersioning is EXPECTED, not a fault.
#
#   scripts/earth/upload_earth_r2.sh [tile-dir] [prefix]
set -euo pipefail

DIR="${1:-/tmp/earth-tiles}"
PREFIX="${2:-siege/earth}"
BUCKET="dreadroot-assets"
BASE_URL="https://assets.dreadroot.com"

[ -d "$DIR" ] || { echo "no tile dir at $DIR" >&2; exit 1; }

COUNT=$(find "$DIR" -type f \( -name '*.bin' -o -name 'manifest.json' \) -not -path '*/.wrangler/*' | wc -l | tr -d ' ')
echo "Uploading $COUNT file(s) from $DIR -> r2://$BUCKET/$PREFIX/"

HAVE_RCLONE=0
rclone listremotes 2>/dev/null | grep -q '^r2:' && HAVE_RCLONE=1

if [ "$HAVE_RCLONE" = 1 ]; then
  # --checksum compares MD5 rather than mtime, so a re-run only sends what actually changed.
  # The include/exclude list is not optional: wrangler drops a .wrangler/cache/wrangler-account.json
  # into the working directory, and an earlier unfiltered upload published the Cloudflare account
  # id and name at a public URL.
  rclone copy "$DIR" "r2:$BUCKET/$PREFIX" \
    --include '*.bin' --include 'manifest.json' \
    --exclude '.wrangler/**' \
    --transfers 32 --checkers 32 --checksum --stats-one-line --stats 10s
else
  echo "No rclone [r2] remote; falling back to wrangler (SLOW, ~14 files/min)." >&2
  find "$DIR" -type f \( -name '*.bin' -o -name 'manifest.json' \) -not -path '*/.wrangler/*' \
    | sed "s|^$DIR/||" > /tmp/_earth_upload_list
  while read -r rel; do
    ct="application/octet-stream"; [[ "$rel" == *.json ]] && ct="application/json"
    ( cd "$DIR" && wrangler r2 object put "$BUCKET/$PREFIX/$rel" --file "$rel" \
        --content-type "$ct" --remote >/dev/null 2>&1 ) || echo "FAILED $rel"
  done < /tmp/_earth_upload_list
  rm -f /tmp/_earth_upload_list
fi

# VERIFY BY CONTENT, not just readability. One earlier run reported success while 33 tiles were
# missing, because the check only asked for HTTP 200 and happened to sample the diagonal tile
# indices. `rclone check` compares every local MD5 against the stored ETag in one pass.
if [ "$HAVE_RCLONE" = 1 ]; then
  echo
  echo "Verifying $COUNT object(s) by checksum..."
  if rclone check "$DIR" "r2:$BUCKET/$PREFIX" \
       --include '*.bin' --include 'manifest.json' --exclude '.wrangler/**' \
       --checkers 32 --one-way 2>&1 | tail -4; then
    echo "All objects verified against local checksums."
  else
    echo "Checksum verification reported differences (above). Re-run to fix." >&2
    exit 1
  fi
fi

echo
echo "Done. Served from $BASE_URL/$PREFIX/"
echo "NOTE: the CDN caches for 4 hours. When tile CONTENT changes, bump TILE_EPOCH in"
echo "src/components/siege/globe/earthTiles.ts or clients keep serving the old bytes."
