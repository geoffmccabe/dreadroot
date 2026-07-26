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
echo "Downloading ETOPO ${RES}s -> $SRC_DIR/$FILE"
# -C - resumes a partial download so an interrupted run costs nothing.
curl -fL -C - -o "$SRC_DIR/$FILE" "$URL"

echo
ls -lh "$SRC_DIR/$FILE"
echo "Done. Next: scripts/earth/build_earth_tiles.py"
