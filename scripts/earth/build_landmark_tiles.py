#!/usr/bin/env python3
"""Build deep cube-sphere tiles at Copernicus GLO-30 (30 m) detail around famous landmarks.

Global 30 m is not practical: 6.3 million tiles and 0.83 TB. But the places anyone actually
flies to are a short list, so this tiles only those regions deeply (levels 7-10, down to ~38 m
per sample) and leaves the rest of the planet on the coarse global set.

Reads GLO-30 with rasterio windowed reads over /vsicurl, which fetches only the COG blocks
covering each region rather than whole 40 MB tiles.

EDGE BLENDING is the subtle part: a region tiled at 30 m sits inside a planet built from 1.85 km
data, and a hard boundary would show as a step in the terrain. The outer part of every region
feathers from GLO-30 back to the ETOPO value, so the detail fades in rather than beginning at a
cliff.

    myenv/bin/python scripts/earth/build_landmark_tiles.py --out /tmp/earth-landmarks
    myenv/bin/python scripts/earth/build_landmark_tiles.py --only "Yosemite" --preview
"""
import argparse
import json
import os
import sys

os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
os.environ.setdefault("CPL_VSIL_CURL_ALLOWED_EXTENSIONS", ".tif")
os.environ.setdefault("GDAL_HTTP_MAX_RETRY", "3")
os.environ.setdefault("GDAL_HTTP_RETRY_DELAY", "2")

import numpy as np                          # noqa: E402
import rasterio                             # noqa: E402
from rasterio.windows import from_bounds    # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from build_earth_tiles import (             # noqa: E402
    FACES, TILE, load_etopo, sample_bilinear, tile_directions, directions_to_latlon,
)

GLO_BASE = "https://copernicus-dem-30m.s3.amazonaws.com"
ERRORS: list = []   # non-404 read failures, reported at the end rather than hidden
EARTH_RADIUS_KM = 6371.0
LEVELS = (7, 8, 9, 10)


def glo_tile_name(lat: int, lon: int) -> str:
    ns = f"N{lat:02d}" if lat >= 0 else f"S{abs(lat):02d}"
    ew = f"E{lon:03d}" if lon >= 0 else f"W{abs(lon):03d}"
    return f"Copernicus_DSM_COG_10_{ns}_00_{ew}_00_DEM"


def read_glo30(lat0, lat1, lon0, lon1):
    """Mosaic GLO-30 over a lat/lon box. Returns (array, lat_top, dlat, lon_left, dlon) or None."""
    res = 1.0 / 3600.0
    h = int(np.ceil((lat1 - lat0) / res))
    w = int(np.ceil((lon1 - lon0) / res))
    if h <= 0 or w <= 0 or h * w > 80_000_000:
        return None
    out = np.full((h, w), np.nan, dtype="float32")
    got = False
    for la in range(int(np.floor(lat0)), int(np.floor(lat1)) + 1):
        for lo in range(int(np.floor(lon0)), int(np.floor(lon1)) + 1):
            t = glo_tile_name(la, lo)
            url = f"/vsicurl/{GLO_BASE}/{t}/{t}.tif"
            try:
                with rasterio.open(url) as ds:
                    win = from_bounds(max(lon0, lo), max(lat0, la),
                                      min(lon1, lo + 1), min(lat1, la + 1), ds.transform)
                    a = ds.read(1, window=win, boundless=True, fill_value=np.nan).astype("float32")
                    if a.size == 0:
                        continue
                    # Where this sub-block lands in the mosaic (rows run north -> south).
                    r0 = int(round((lat1 - min(lat1, la + 1)) / res))
                    c0 = int(round((max(lon0, lo) - lon0) / res))
                    r1, c1 = min(h, r0 + a.shape[0]), min(w, c0 + a.shape[1])
                    if r1 <= r0 or c1 <= c0:
                        continue
                    out[r0:r1, c0:c1] = a[: r1 - r0, : c1 - c0]
                    got = True
            except Exception as e:
                # DO NOT swallow this silently. A first pass reported 28 landmarks as "no GLO-30
                # coverage" that the validator had already read successfully; they were failing
                # progressively (connection/handle exhaustion late in a long run), and because the
                # error was discarded it looked like missing data. Retry, then report.
                msg = str(e)
                for attempt in range(2):
                    try:
                        with rasterio.open(url) as ds:
                            win = from_bounds(max(lon0, lo), max(lat0, la),
                                              min(lon1, lo + 1), min(lat1, la + 1), ds.transform)
                            a = ds.read(1, window=win, boundless=True, fill_value=np.nan).astype("float32")
                        r0 = int(round((lat1 - min(lat1, la + 1)) / res))
                        c0 = int(round((max(lon0, lo) - lon0) / res))
                        r1, c1 = min(h, r0 + a.shape[0]), min(w, c0 + a.shape[1])
                        if r1 > r0 and c1 > c0:
                            out[r0:r1, c0:c1] = a[: r1 - r0, : c1 - c0]
                            got = True
                        msg = None
                        break
                    except Exception as e2:
                        msg = str(e2)
                if msg and "404" not in msg:
                    ERRORS.append(f"{t}: {msg[:80]}")
                continue
    if not got:
        return None
    return out, lat1, -res, lon0, res


def bilinear_nan(grid, lat_top, dlat, lon_left, dlon, lat, lon):
    """Sample the mosaic; NaN outside or where the DEM has no data."""
    rows, cols = grid.shape
    fy = (lat - lat_top) / dlat
    fx = (lon - lon_left) / dlon
    y0 = np.floor(fy).astype(np.int64)
    x0 = np.floor(fx).astype(np.int64)
    ty, tx = fy - y0, fx - x0
    ok = (y0 >= 0) & (y0 < rows - 1) & (x0 >= 0) & (x0 < cols - 1)
    y0c, x0c = np.clip(y0, 0, rows - 2), np.clip(x0, 0, cols - 2)
    h00 = grid[y0c, x0c]; h10 = grid[y0c, x0c + 1]
    h01 = grid[y0c + 1, x0c]; h11 = grid[y0c + 1, x0c + 1]
    a = h00 * (1 - tx) + h10 * tx
    b = h01 * (1 - tx) + h11 * tx
    v = a * (1 - ty) + b * ty
    return np.where(ok, v, np.nan)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="/tmp/earth-landmarks")
    ap.add_argument("--src", default=os.environ.get("EARTH_SRC_DIR", "/tmp/earth-src"))
    ap.add_argument("--only", default=None, help="substring filter on landmark name")
    ap.add_argument("--levels", default="7,8,9,10")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--skip", type=int, default=0)
    args = ap.parse_args()
    levels = [int(x) for x in args.levels.split(",")]

    lms = json.load(open(os.path.join(HERE, "landmarks.json")))["landmarks"]
    lms = [l for l in lms if l.get("glo30") is not False]
    if args.only:
        lms = [l for l in lms if args.only.lower() in l["n"].lower()]
    if args.skip:
        lms = lms[args.skip:]
    if args.limit:
        lms = lms[: args.limit]
    print(f"{len(lms)} landmark(s), levels {levels}")

    src_files = [f for f in os.listdir(args.src) if f.endswith(".nc")]
    if not src_files:
        raise SystemExit(f"no ETOPO .nc in {args.src}; needed for the fallback/blend")
    print("loading ETOPO for the edge blend...")
    egrid, elat0, edlat, elon0, edlon = load_etopo(os.path.join(args.src, sorted(src_files)[0]))

    written = 0
    failed: list = []
    for idx, lm in enumerate(lms, 1):
        name, lat, lon, rkm = lm["n"], lm["lat"], lm["lon"], lm["r"]
        # Region bounds with a margin for the feather.
        dlat = (rkm * 1.25) / 111.32
        dlon = dlat / max(0.15, np.cos(np.radians(lat)))
        glo = read_glo30(lat - dlat, lat + dlat, lon - dlon, lon + dlon)
        if glo is None:
            why = "no GLO-30 coverage (ocean or withheld tile)" if not ERRORS[-1:] else f"READ FAILED: {ERRORS[-1]}"
            print(f"[{idx}/{len(lms)}] {name}: {why}")
            failed.append(name)
            continue
        gg, glat0, gdlat, glon0, gdlon = glo

        # Angular radius of the region, for the feather weight.
        ang = rkm / EARTH_RADIUS_KM
        n_here = 0
        for L in levels:
            n = 1 << L
            # Which tiles on which face cover this point, with a margin of one tile.
            d0 = np.array([np.cos(np.radians(lat)) * np.sin(np.radians(lon)) * -1,
                           np.sin(np.radians(lat)),
                           -np.cos(np.radians(lat)) * np.cos(np.radians(lon))])
            ax, ay, az = abs(d0[0]), abs(d0[1]), abs(d0[2])
            if ax >= ay and ax >= az: face = 0 if d0[0] > 0 else 1
            elif ay >= az:            face = 2 if d0[1] > 0 else 3
            else:                     face = 4 if d0[2] > 0 else 5
            _, o, uax, vax = FACES[face]
            m = 1.0 / max(ax, ay, az)
            p = d0 * m
            cu, cv = float(np.dot(p, uax)), float(np.dot(p, vax))
            # uv half-extent of the region (uv spans [-1,1] over 90 degrees).
            half_uv = ang / (np.pi / 4) * 1.3
            for ty in range(max(0, int((cv - half_uv + 1) / 2 * n)), min(n - 1, int((cv + half_uv + 1) / 2 * n)) + 1):
                for tx in range(max(0, int((cu - half_uv + 1) / 2 * n)), min(n - 1, int((cu + half_uv + 1) / 2 * n)) + 1):
                    dirs = tile_directions(face, L, tx, ty)
                    tlat, tlon = directions_to_latlon(dirs)
                    fine = bilinear_nan(gg, glat0, gdlat, glon0, gdlon, tlat, tlon)
                    coarse = sample_bilinear(egrid, elat0, edlat, elon0, edlon, tlat, tlon)
                    # Feather: 1 in the core, falling to 0 by the region edge, so the 30 m data
                    # blends back into the global set instead of ending at a step.
                    dd = np.hypot((tlat - lat), (tlon - lon) * np.cos(np.radians(lat)))
                    t = np.clip((rkm / 111.32 - dd) / (0.30 * rkm / 111.32), 0.0, 1.0)
                    w = t * t * (3 - 2 * t)
                    w = np.where(np.isfinite(fine), w, 0.0)
                    z = np.where(np.isfinite(fine), fine, 0.0) * w + coarse * (1 - w)
                    outdir = os.path.join(args.out, "h", FACES[face][0], str(L))
                    os.makedirs(outdir, exist_ok=True)
                    np.rint(z).astype("<i2").tofile(os.path.join(outdir, f"{tx}_{ty}.bin"))
                    n_here += 1
        written += n_here
        print(f"[{idx}/{len(lms)}] {name}: {n_here} tiles")

    print(f"\nDONE {written} tiles -> {args.out}")
    if failed:
        print(f"\n{len(failed)} landmark(s) produced nothing:")
        for f in failed:
            print(f"  {f}")
        print("Re-run with --only to retry a specific one; transient read failures are common "
              "late in a long run and are NOT the same as missing coverage.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
