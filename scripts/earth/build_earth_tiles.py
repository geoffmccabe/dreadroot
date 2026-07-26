#!/usr/bin/env python3
"""Build the Mini Earth cube-sphere height tile pyramid from ETOPO 2022.

See docs/MINI_EARTH_P1_BUILD.md steps A2/A3.

What this produces
------------------
Six cube faces, each a quadtree. One tile = TILE x TILE samples (256 quads plus a shared
edge row/column, so neighbouring tiles share their border samples exactly and no seam
appears from rounding).

Elevation is written as RAW METRES, signed 16-bit, little-endian, row-major. NOT game
units. The client divides by the scale factor at load time, which keeps that factor a
runtime constant: changing 1 unit = 100 m to some other value later needs zero regenerated
tiles.

Output layout (mirrored onto R2 under /siege/earth/):
    manifest.json
    h/<face>/<level>/<x>_<y>.bin

Faces are indexed 0..5 as +X, -X, +Y, -Y, +Z, -Z in three.js coordinates (Y up).

Usage
-----
    myenv/bin/python scripts/earth/build_earth_tiles.py --max-level 4
    myenv/bin/python scripts/earth/build_earth_tiles.py --max-level 0 --preview
"""

import argparse
import json
import os
import sys

import numpy as np

# --- Constants shared with the client (src/components/siege/globe/cubeSphere.ts) ---------

TILE = 257                 # samples per tile side (256 quads + shared edge)
EARTH_RADIUS_M = 6371000.0 # mean Earth radius, metres
SCALE = 100.0              # 1 game unit = 100 real metres (informational; tiles stay in metres)

# Face basis vectors: for face f, direction = origin + u * uAxis + v * vAxis, where u and v
# run over [-1, 1]. Then normalised onto the sphere.
FACES = [
    # name,  origin,            uAxis,             vAxis
    ("px", ( 1,  0,  0), ( 0,  0, -1), ( 0, -1,  0)),
    ("nx", (-1,  0,  0), ( 0,  0,  1), ( 0, -1,  0)),
    ("py", ( 0,  1,  0), ( 1,  0,  0), ( 0,  0,  1)),
    ("ny", ( 0, -1,  0), ( 1,  0,  0), ( 0,  0, -1)),
    ("pz", ( 0,  0,  1), ( 1,  0,  0), ( 0, -1,  0)),
    ("nz", ( 0,  0, -1), (-1,  0,  0), ( 0, -1,  0)),
]


def load_etopo(path):
    """Return (grid, lat0, dlat, lon0, dlon) with grid[row, col], row = latitude index."""
    from netCDF4 import Dataset  # imported here so --help works without the dep

    ds = Dataset(path, "r")
    # ETOPO 2022 names the elevation variable 'z'; be tolerant of alternatives.
    varname = next((n for n in ("z", "elevation", "Band1") if n in ds.variables), None)
    if varname is None:
        raise SystemExit(f"no elevation variable found; have {list(ds.variables)}")
    latname = "lat" if "lat" in ds.variables else "latitude"
    lonname = "lon" if "lon" in ds.variables else "longitude"

    lat = np.asarray(ds.variables[latname][:], dtype=np.float64)
    lon = np.asarray(ds.variables[lonname][:], dtype=np.float64)
    grid = np.asarray(ds.variables[varname][:], dtype=np.float32)

    print(f"  source grid {grid.shape}, lat {lat[0]:.3f}..{lat[-1]:.3f}, "
          f"lon {lon[0]:.3f}..{lon[-1]:.3f}")
    return grid, float(lat[0]), float(lat[1] - lat[0]), float(lon[0]), float(lon[1] - lon[0])


def sample_bilinear(grid, lat0, dlat, lon0, dlon, lat_deg, lon_deg):
    """Bilinearly sample the lat/lon grid. Longitude wraps; latitude clamps at the poles."""
    rows, cols = grid.shape

    fx = (lon_deg - lon0) / dlon
    fy = (lat_deg - lat0) / dlat

    x0 = np.floor(fx).astype(np.int64)
    y0 = np.floor(fy).astype(np.int64)
    tx = fx - x0
    ty = fy - y0

    # Longitude is cyclic: wrap both the sample and its right neighbour.
    x0w = np.mod(x0, cols)
    x1w = np.mod(x0 + 1, cols)
    # Latitude is not cyclic: clamp so the poles do not read off the end of the array.
    y0c = np.clip(y0, 0, rows - 1)
    y1c = np.clip(y0 + 1, 0, rows - 1)

    h00 = grid[y0c, x0w]
    h10 = grid[y0c, x1w]
    h01 = grid[y1c, x0w]
    h11 = grid[y1c, x1w]

    a = h00 * (1.0 - tx) + h10 * tx
    b = h01 * (1.0 - tx) + h11 * tx
    return a * (1.0 - ty) + b * ty


def tile_directions(face_idx, level, tx, ty):
    """Unit sphere directions for every sample of one tile. Returns (TILE, TILE, 3)."""
    _, origin, uax, vax = FACES[face_idx]
    n = 1 << level                      # tiles per face side at this level

    # This tile covers [tx/n, (tx+1)/n] of the face in u, same in v, mapped to [-1, 1].
    u = np.linspace(-1.0 + 2.0 * tx / n, -1.0 + 2.0 * (tx + 1) / n, TILE)
    v = np.linspace(-1.0 + 2.0 * ty / n, -1.0 + 2.0 * (ty + 1) / n, TILE)
    uu, vv = np.meshgrid(u, v)          # vv varies down rows, uu across columns

    o = np.array(origin, dtype=np.float64)
    a = np.array(uax, dtype=np.float64)
    b = np.array(vax, dtype=np.float64)

    d = (o[None, None, :]
         + uu[..., None] * a[None, None, :]
         + vv[..., None] * b[None, None, :])
    d /= np.linalg.norm(d, axis=2, keepdims=True)
    return d


def directions_to_latlon(d):
    """three.js Y-up direction -> (latitude, longitude) in degrees.

    NOTE THE MINUS ON X. Without it the mapping is LEFT-handed and the entire planet renders
    as its mirror image: every continent backwards. It is a nasty bug because it is
    self-consistent, so spot-checking "does Everest come out 8,848 m" passes happily. The real
    test is that the (East, North, Up) triad must be right-handed, E x N = U, as it is on Earth.
    See check_cubesphere.mjs, which now asserts exactly that.
    """
    lat = np.degrees(np.arcsin(np.clip(d[..., 1], -1.0, 1.0)))
    lon = np.degrees(np.arctan2(-d[..., 0], -d[..., 2]))
    return lat, lon


def write_preview(path, heights):
    """Greyscale PNG of one tile, for the A2 eyeball check."""
    from PIL import Image
    h = heights.astype(np.float32)
    lo, hi = float(h.min()), float(h.max())
    norm = (h - lo) / (hi - lo) if hi > lo else np.zeros_like(h)
    Image.fromarray((norm * 255).astype(np.uint8), mode="L").save(path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=os.environ.get("EARTH_SRC_DIR", "/tmp/earth-src"))
    ap.add_argument("--out", default=os.environ.get("EARTH_OUT_DIR", "/tmp/earth-tiles"))
    ap.add_argument("--max-level", type=int, default=4)
    ap.add_argument("--preview", action="store_true",
                    help="also write a greyscale PNG per tile (use with --max-level 0)")
    args = ap.parse_args()

    src_files = [f for f in os.listdir(args.src) if f.endswith(".nc")] if os.path.isdir(args.src) else []
    if not src_files:
        raise SystemExit(f"no .nc file in {args.src}; run scripts/earth/fetch_etopo.sh first")
    src = os.path.join(args.src, sorted(src_files)[0])

    print(f"Reading {src}")
    grid, lat0, dlat, lon0, dlon = load_etopo(src)

    os.makedirs(args.out, exist_ok=True)
    total = 0
    lo_all, hi_all = 1e9, -1e9

    for level in range(args.max_level + 1):
        n = 1 << level
        for fi, (fname, _, _, _) in enumerate(FACES):
            for ty in range(n):
                for tx in range(n):
                    d = tile_directions(fi, level, tx, ty)
                    lat, lon = directions_to_latlon(d)
                    h = sample_bilinear(grid, lat0, dlat, lon0, dlon, lat, lon)

                    lo_all = min(lo_all, float(h.min()))
                    hi_all = max(hi_all, float(h.max()))

                    out_dir = os.path.join(args.out, "h", fname, str(level))
                    os.makedirs(out_dir, exist_ok=True)
                    stem = os.path.join(out_dir, f"{tx}_{ty}")
                    np.rint(h).astype("<i2").tofile(stem + ".bin")
                    if args.preview:
                        write_preview(stem + ".png", h)
                    total += 1
        print(f"  level {level}: {6 * n * n} tiles")

    manifest = {
        "version": 1,
        "tileSize": TILE,
        "maxLevel": args.max_level,
        "faces": [f[0] for f in FACES],
        "heightUnits": "metres",
        "heightFormat": "int16le",
        "scaleMetresPerUnit": SCALE,
        "planetRadiusUnits": EARTH_RADIUS_M / SCALE,
        "seaLevelMetres": 0,
        "minMetres": round(lo_all),
        "maxMetres": round(hi_all),
        "source": "ETOPO 2022 (NOAA NCEI), ice surface, 60 arc-second",
    }
    with open(os.path.join(args.out, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2)

    size = sum(os.path.getsize(os.path.join(dp, f))
               for dp, _, fs in os.walk(args.out) for f in fs)
    print(f"\nDONE {total} tiles, {size / 1e6:.1f} MB -> {args.out}")
    print(f"elevation range {round(lo_all)} .. {round(hi_all)} m")
    return 0


if __name__ == "__main__":
    sys.exit(main())
