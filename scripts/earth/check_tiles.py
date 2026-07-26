#!/usr/bin/env python3
"""Spot-check built Earth tiles against known real-world elevations.

Step A2/A3 verification from docs/MINI_EARTH_P1_BUILD.md. Reads tiles back off disk and
samples them through the same direction -> face -> uv path the client uses, so it catches
axis errors, face-order mistakes and lat/lon sign flips that a greyscale eyeball misses.

    myenv/bin/python scripts/earth/check_tiles.py --dir /tmp/earth-tiles --level 4
"""
import argparse
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_earth_tiles import FACES, TILE  # noqa: E402

# name, lat, lon, (min metres, max metres).
#
# Ranges, not point values, and each range must hold at EVERY level. That is the whole
# subtlety here: coarse levels smooth peaks and troughs toward the surrounding average
# (level 0 reads the Himalaya as ~5,500 m), while fine levels resolve the real extreme
# (level 4 reads 8,056 m, essentially Everest). A single expected value with a tight
# tolerance passes at one level and fails at another, which says nothing about the data.
#
# Places are also chosen to be WIDE features. Narrow ones like the floor of Death Valley
# are only a few km across, so whether a sample lands on the valley or the ridge beside it
# is a coin toss at 2.4 km spacing. That makes them useless as a check at any coarse level.
PLACES = [
    ("Himalaya",            27.99,   86.93, (4000, 9000)),
    ("Tibet plateau",       33.0,    88.0,  (3500, 6000)),
    ("Sahara",              23.0,    13.0,  (200, 1500)),
    ("Amazon basin",        -3.0,   -60.0,  (0, 400)),
    ("Antarctica interior", -82.0,    0.0,  (1000, 4000)),
    ("Qattara Depression",  30.0,    27.0,  (-150, 200)),   # wide, partly below sea level
    ("Caspian seabed",      42.0,    50.0,  (-1100, -100)),
    ("Mid Pacific",          0.0,  -160.0,  (-6000, -3500)),
    ("Mariana region",      11.35,  142.2,  (-11000, -5000)),
    ("Mid Atlantic",         0.0,   -25.0,  (-5000, -2000)),
]


def direction(lat, lon):
    la, lo = np.radians(lat), np.radians(lon)
    c = np.cos(la)
    return np.array([c * np.sin(lo), np.sin(la), -c * np.cos(lo)])


def face_uv(d):
    ax, ay, az = abs(d[0]), abs(d[1]), abs(d[2])
    if ax >= ay and ax >= az:
        f, m = (0 if d[0] > 0 else 1), ax
    elif ay >= az:
        f, m = (2 if d[1] > 0 else 3), ay
    else:
        f, m = (4 if d[2] > 0 else 5), az
    _, _, uax, vax = FACES[f]
    p = d / m
    return f, float(np.dot(p, uax)), float(np.dot(p, vax))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default="/tmp/earth-tiles")
    ap.add_argument("--level", type=int, default=0)
    args = ap.parse_args()

    n = 1 << args.level
    cache = {}

    def sample(lat, lon):
        f, u, v = face_uv(direction(lat, lon))
        # Which tile on this face, then which sample inside it.
        tx = min(n - 1, max(0, int((u + 1) / 2 * n)))
        ty = min(n - 1, max(0, int((v + 1) / 2 * n)))
        key = (f, tx, ty)
        if key not in cache:
            path = os.path.join(args.dir, "h", FACES[f][0], str(args.level), f"{tx}_{ty}.bin")
            cache[key] = np.fromfile(path, dtype="<i2").reshape(TILE, TILE)
        lo_u, lo_v = -1 + 2 * tx / n, -1 + 2 * ty / n
        col = int(round((u - lo_u) / (2 / n) * (TILE - 1)))
        row = int(round((v - lo_v) / (2 / n) * (TILE - 1)))
        col = min(TILE - 1, max(0, col))
        row = min(TILE - 1, max(0, row))
        return FACES[f][0], int(cache[key][row, col])

    print(f"level {args.level}  ({6 * n * n} tiles on disk)\n")
    print(f"{'place':22} {'face':5} {'metres':>8} {'valid range':>16}   result")
    failures = 0
    for name, lat, lon, (lo, hi) in PLACES:
        face, h = sample(lat, lon)
        ok = lo <= h <= hi
        why = "ok" if ok else f"OUTSIDE RANGE by {(h - hi) if h > hi else (h - lo):+d} m"
        print(f"{name:22} {face:5} {h:8} {f'{lo} .. {hi}':>16}   {why}")
        if not ok:
            failures += 1

    print("\n" + ("ALL SPOT CHECKS PASSED" if failures == 0 else f"{failures} SPOT CHECK(S) FAILED"))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
