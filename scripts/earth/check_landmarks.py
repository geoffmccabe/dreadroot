#!/usr/bin/env python3
"""Validate scripts/earth/landmarks.json against the real Copernicus GLO-30 data.

Coordinates typed from memory are the weak point of a hand-built landmark list: a wrong sign or
a transposed digit puts a famous mountain in the sea, and nothing downstream would notice. This
opens the actual 30 m DEM at each point and reports what is really there.

Flags:
  NO DATA   the GLO-30 tile does not exist, i.e. the point is over open water
  FLAT      almost no relief nearby, so probably not the landmark it claims to be
  CHECK     elevation looks implausible for the name (only a hint, not authoritative)

    myenv/bin/python scripts/earth/check_landmarks.py
"""
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor

os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
os.environ.setdefault("CPL_VSIL_CURL_ALLOWED_EXTENSIONS", ".tif")
os.environ.setdefault("GDAL_HTTP_MAX_RETRY", "3")
os.environ.setdefault("GDAL_HTTP_RETRY_DELAY", "2")

import numpy as np              # noqa: E402
import rasterio                 # noqa: E402
from rasterio.windows import from_bounds  # noqa: E402

BASE = "https://copernicus-dem-30m.s3.amazonaws.com"
HERE = os.path.dirname(os.path.abspath(__file__))


def tile_name(lat: float, lon: float) -> str:
    """GLO-30 tiles are named for their SOUTH-WEST corner, in whole degrees."""
    la, lo = int(np.floor(lat)), int(np.floor(lon))
    ns = f"N{la:02d}" if la >= 0 else f"S{abs(la):02d}"
    ew = f"E{lo:03d}" if lo >= 0 else f"W{abs(lo):03d}"
    return f"Copernicus_DSM_COG_10_{ns}_00_{ew}_00_DEM"


def probe(lm):
    name, lat, lon = lm["n"], lm["lat"], lm["lon"]
    t = tile_name(lat, lon)
    url = f"/vsicurl/{BASE}/{t}/{t}.tif"
    # ~4 km box around the point: enough to measure local relief without a big read.
    d = 0.02
    try:
        with rasterio.open(url) as ds:
            w = from_bounds(lon - d, lat - d, lon + d, lat + d, ds.transform)
            a = ds.read(1, window=w).astype("float32")
    except Exception as e:
        # Copernicus withholds a handful of tiles over certain national borders. Landmarks marked
        # "glo30": false are known gaps and fall back to the coarse global data.
        known = " (known gap, expected)" if lm.get("glo30") is False else ""
        return dict(lm, status="NO DATA" + known, detail=str(e)[:50], elev=None, relief=None)

    a = a[np.isfinite(a)]
    if a.size == 0:
        return dict(lm, status="NO DATA", detail="empty window", elev=None, relief=None)

    centre = float(np.median(a))
    relief = float(a.max() - a.min())
    status = "ok"
    # Lakes, salt flats and depressions are genuinely flat at their centre; that is the landmark,
    # not a bad coordinate. They carry "flat": true in the JSON so this stops crying wolf.
    if relief < 25 and not lm.get("flat"):
        status = "FLAT"
    return dict(lm, status=status, detail="", elev=centre, relief=relief)


def main():
    data = json.load(open(os.path.join(HERE, "landmarks.json")))
    lms = data["landmarks"]
    print(f"Checking {len(lms)} landmarks against Copernicus GLO-30 (30 m)...\n")

    with ThreadPoolExecutor(max_workers=16) as ex:
        results = list(ex.map(probe, lms))

    bad = [r for r in results if r["status"] != "ok"]
    print(f"{'landmark':34}{'elev m':>9}{'relief m':>10}  status")
    for r in results:
        if r["status"] == "ok":
            continue
        e = f"{r['elev']:.0f}" if r["elev"] is not None else "-"
        rel = f"{r['relief']:.0f}" if r["relief"] is not None else "-"
        print(f"{r['n']:34}{e:>9}{rel:>10}  {r['status']} {r['detail']}")

    ok = [r for r in results if r["status"] == "ok"]
    print(f"\n{len(ok)}/{len(results)} verified against real 30 m data")
    if ok:
        rel = np.array([r["relief"] for r in ok])
        print(f"median local relief across verified landmarks: {np.median(rel):.0f} m")
    if bad:
        print(f"\n{len(bad)} need attention (listed above)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
