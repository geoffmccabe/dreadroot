#!/usr/bin/env python3
"""Build the Divi node -> portal registry for the Mini Earth.

Every Divi node on the network becomes a portal at its real geographic location. This turns the
node map into the game board: where portals exist is decided by where people actually run nodes.

SOURCE. DD69 already maintains exactly this dataset. `ui/src/wallet/knownPeers.ts` keeps a rolling
30-day record of every peer the wallet has seen, each geolocated to lat/lon, and it lives in the
app's WebKit localStorage. That is a far better source than the DNS seeder, which hands out only
the four seeder hosts rather than the network.

This is a SNAPSHOT step, deliberately. The real system needs a service that polls a live node and
publishes the registry continuously (plan P10); until that exists, a snapshot lets the portals,
territory and spawning all be built and played against real geography.

PRIVACY. Node operators' IP addresses are not shipped. The public registry carries a stable opaque
id, the coarse location, and the city/country label the map already shows. The id is a hash of the
IP so the same node keeps the same portal across rebuilds without the address leaving this machine.

    myenv/bin/python scripts/earth/build_node_portals.py --out /tmp/earth-portals/portals.json
"""
import argparse
import hashlib
import json
import os
import sqlite3
import sys
from glob import glob

WEBKIT = os.path.expanduser("~/Library/WebKit")


def find_localstorage() -> list:
    pats = [
        f"{WEBKIT}/divi-desktop-69/WebsiteData/Default/*/*/LocalStorage/localstorage.sqlite3",
        f"{WEBKIT}/io.diviproject.desktop69/WebsiteData/Default/*/*/LocalStorage/localstorage.sqlite3",
    ]
    out = []
    for p in pats:
        out.extend(glob(p))
    return out


def read_known_peers(path: str) -> dict:
    """DD69 stores localStorage values as UTF-16LE blobs; a plain text cast stops at the first null."""
    con = sqlite3.connect(f"file:{path}?immutable=1", uri=True)
    try:
        row = con.execute("select value from ItemTable where key='dd69.knownPeers'").fetchone()
    finally:
        con.close()
    if not row or not row[0]:
        return {}
    raw = row[0]
    if isinstance(raw, (bytes, bytearray)):
        for enc in ("utf-16-le", "utf-8"):
            try:
                return json.loads(raw.decode(enc))
            except Exception:
                continue
        return {}
    return json.loads(raw)


def node_id(ip: str) -> str:
    """Stable opaque id. The IP itself never leaves this machine."""
    return hashlib.sha256(("divi-node:" + ip).encode()).hexdigest()[:16]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="/tmp/earth-portals/portals.json")
    args = ap.parse_args()

    merged = {}
    for db in find_localstorage():
        try:
            for ip, v in read_known_peers(db).items():
                prev = merged.get(ip)
                if not prev or (v.get("lastSeen", 0) > prev.get("lastSeen", 0)):
                    merged[ip] = v
        except Exception as e:
            print(f"  skip {db}: {e}", file=sys.stderr)

    if not merged:
        raise SystemExit("no DD69 known-peers found; open Divi Desktop 6.9 at least once")

    portals = []
    for ip, v in merged.items():
        lat, lon = v.get("lat"), v.get("lon")
        if lat is None or lon is None:
            continue
        # Round to ~1 km. Enough to place a portal on the right city, coarse enough that the
        # registry is not a precise map of where individuals live.
        portals.append({
            "id": node_id(ip),
            "lat": round(float(lat), 2),
            "lon": round(float(lon), 2),
            "city": v.get("city") or None,
            "cc": v.get("cc") or None,
            "lastSeen": v.get("lastSeen"),
        })

    # Deduplicate portals that land on the same spot: several nodes commonly share one datacentre,
    # and a stack of coincident portals would render as one flickering artefact. Keep a count so
    # the game can show a busier portal instead.
    by_spot = {}
    for p in portals:
        key = (p["lat"], p["lon"])
        if key in by_spot:
            by_spot[key]["nodes"] += 1
        else:
            p["nodes"] = 1
            by_spot[key] = p
    out_list = sorted(by_spot.values(), key=lambda p: (-p["nodes"], p["id"]))

    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    json.dump({
        "version": 1,
        "source": "DD69 knownPeers snapshot (30-day rolling); replace with a live registry service (plan P10)",
        "nodeCount": len(portals),
        "portalCount": len(out_list),
        "portals": out_list,
    }, open(args.out, "w"), indent=1)

    cc = {}
    for p in out_list:
        cc[p["cc"] or "?"] = cc.get(p["cc"] or "?", 0) + p["nodes"]
    print(f"{len(portals)} nodes -> {len(out_list)} distinct portals -> {args.out}")
    print("by country:", ", ".join(f"{k} {v}" for k, v in sorted(cc.items(), key=lambda x: -x[1])[:10]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
