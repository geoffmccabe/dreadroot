#!/usr/bin/env bash
# Download the ETOPO 2022 global relief grid (land topography + ocean bathymetry in one file)
# used to build the Mini Earth globe map. See docs/MINI_EARTH_P1_BUILD.md step A1.
#
# 60 arc-second version: 478 MB, one file, whole planet, 1.85 km per sample at the equator.
# Free for private, academic and commercial use (NOAA NCEI, public domain).
#
# Downloads to /tmp, NEVER into the repo. Nothing here is committed.
set -euo pipefail

SRC_DIR="${EARTH_SRC_DIR:-/tmp/earth-src}"
BASE="https://www.ngdc.noaa.gov/thredds/fileServer/global/ETOPO2022"

# Resolution: 60 (default, 478 MB) or 30 (1.64 GB, if the flythrough looks too soft).
RES="${1:-60}"
case "$RES" in
  60) FILE="ETOPO_2022_v1_60s_N90W180_surface.nc"; URL="$BASE/60s/60s_surface_elev_netcdf/$FILE" ;;
  30) FILE="ETOPO_2022_v1_30s_N90W180_surface.nc"; URL="$BASE/30s/30s_surface_elev_netcdf/$FILE" ;;
  *) echo "usage: $0 [60|30]" >&2; exit 1 ;;
esac

mkdir -p "$SRC_DIR"

# VERIFY THE FILE, do not trust curl's exit code. This bit us: curl returned 0 having written
# 8 MB of a 478 MB file, the script printed "Done", and the tiler would have happily built a
# planet out of a fragment. NOAA serves this chunked with no Content-Length, so a byte-count
# check is not available; instead we open the result and require the real grid shape.
PY_BIN="${PY_BIN:-/Users/geoffreymccabe/myenv/bin/python}"
validate() {
  "$PY_BIN" - "$SRC_DIR/$FILE" <<'PYEOF' 2>/dev/null
import sys
from netCDF4 import Dataset
ds = Dataset(sys.argv[1], "r")
z = ds.variables["z"] if "z" in ds.variables else None
if z is None or z.shape != (10800, 21600):
    raise SystemExit(1)
PYEOF
}

echo "Downloading ETOPO ${RES}s -> $SRC_DIR/$FILE"
for attempt in 1 2 3 4 5 6; do
  # -C - resumes, so each attempt continues where the last one stopped rather than restarting.
  curl -fL -C - --retry 5 --retry-delay 3 --speed-time 60 --speed-limit 20000 \
       -o "$SRC_DIR/$FILE" "$URL" || true
  SZ=$(stat -f%z "$SRC_DIR/$FILE" 2>/dev/null || stat -c%s "$SRC_DIR/$FILE" 2>/dev/null || echo 0)
  if validate; then
    echo
    ls -lh "$SRC_DIR/$FILE"
    echo "Verified: opens as a 10800x21600 grid. Next: scripts/earth/build_earth_tiles.py"
    exit 0
  fi
  echo "  attempt $attempt: $((SZ/1000000)) MB so far, file not yet a complete grid; resuming..."
  sleep 3
done

echo "FAILED: $SRC_DIR/$FILE never became a complete 10800x21600 grid. Re-run to resume." >&2
exit 1
