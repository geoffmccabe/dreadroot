// earthTiles — fetching, decoding and caching the Mini Earth height tiles.
//
// Tiles live on R2 (assets.dreadroot.com), NOT in the Pages deploy: there are 2,046 of them
// and Pages caps a deployment at 20,000 files. See docs/MINI_EARTH_P1_BUILD.md step A4.
//
// Wire format, produced by scripts/earth/build_earth_tiles.py:
//   257 x 257 signed 16-bit little-endian samples, row-major, raw ELEVATION IN METRES.
//   Metres (not game units) so the scale convention can change without rebuilding tiles.
//
// Design notes:
//  • Requests are deduplicated: many quadtree nodes ask for the same tile in one frame.
//  • The cache is a plain LRU over decoded Int16Arrays. One tile is 132 KB, so the default
//    budget of 512 tiles is ~68 MB, which comfortably covers a full view at every level.
//  • `getTile` is SYNCHRONOUS and returns null on a miss, kicking off a fetch. Callers must
//    cope with "not here yet" by falling back to a coarser ancestor tile, which is exactly
//    what the quadtree wants to do anyway.

import { TILE, FACE_NAMES, tileKey } from './cubeSphere';
import { ASSET_BASE } from '@/config/assetBase';

const BASE = `${ASSET_BASE}/siege/earth`;

/**
 * Cache-busting epoch for the tile set. BUMP THIS WHENEVER THE TILES ARE REGENERATED.
 *
 * R2 is fronted by the Cloudflare CDN with max-age=14400 (4 hours), and browsers cache on top of
 * that. When the mirrored-longitude bug was fixed, every tile changed, but any tile a player had
 * already flown past would have kept serving the OLD mirrored data from cache for hours, so the
 * fix would have looked like it had not worked. Same pattern the monster loader already uses
 * (`${c.url}?v=${APP_VERSION}`).
 *
 * epoch 2 = the un-mirrored rebuild (2026-Jul-26).
 * epoch 3 = adds levels 5-10 over 225 landmark regions at Copernicus GLO-30 (30 m), and raises
 *           the advertised maxLevel to 10 so those levels are requested at all.
 */
const TILE_EPOCH = 3;
const SAMPLES = TILE * TILE;
const BYTES = SAMPLES * 2;

export interface EarthManifest {
  version: number;
  tileSize: number;
  maxLevel: number;
  faces: string[];
  scaleMetresPerUnit: number;
  planetRadiusUnits: number;
  minMetres: number;
  maxMetres: number;
  source: string;
}

let manifest: EarthManifest | null = null;
let manifestPromise: Promise<EarthManifest> | null = null;

/** Load (once) the tile-set manifest. Everything else waits on this for maxLevel. */
export function loadManifest(): Promise<EarthManifest> {
  if (manifest) return Promise.resolve(manifest);
  if (!manifestPromise) {
    manifestPromise = fetch(`${BASE}/manifest.json?v=${TILE_EPOCH}`)
      .then((r) => {
        if (!r.ok) throw new Error(`earth manifest ${r.status}`);
        return r.json();
      })
      .then((m: EarthManifest) => {
        if (m.tileSize !== TILE) {
          // A silent mismatch here would misplace every sample on the planet.
          throw new Error(`earth manifest tileSize ${m.tileSize} != client TILE ${TILE}`);
        }
        manifest = m;
        return m;
      })
      .catch((e) => { manifestPromise = null; throw e; });
  }
  return manifestPromise;
}

export function getManifest(): EarthManifest | null { return manifest; }

// --- cache ---------------------------------------------------------------------------------

/**
 * How many decoded tiles to keep. MEASURED off a real session, not chosen.
 *
 * This was 512, and it was SMALLER THAN THE WORKING SET, which is the one thing an LRU must never
 * be. Geoff's trace, over about a third of a session at one site, asked for 1,109 DISTINCT tiles and
 * issued 8,836 requests for them — every tile fetched eight times over, evicted and re-fetched in a
 * permanent loop that never converges.
 *
 * Everything he reported falls out of that one number:
 *
 *   THE SLOWDOWN     Eight thousand fetches, each decoding a fresh 132 KB Int16Array, is about a
 *                    gigabyte of short-lived allocation. The trace shows scavenger GC up twentyfold
 *                    and the animation frame climbing from 32 ms to 102 ms as it went.
 *   THE MISSING      "There's a whole square missing of terrain underneath my kaiju." A patch asks
 *   TERRAIN          for its tile, gets null because it was evicted between the request and the
 *                    build, and draws nothing. With the cache thrashing, some patch is always in
 *                    that state.
 *   IT GOT WORSE     The longer you stay, the more of the pyramid the LOD tree wants, so the working
 *                    set grows away from the cap and the thrash accelerates.
 *
 * 1600 covers the observed set with room to spare. It costs about 210 MB resident — which sounds
 * worse than it is, because the thrash it replaces was CHURNING more than that every few seconds and
 * making the collector chase it.
 */
const MAX_CACHED = 1600;
/**
 * Below this level, tiles are never evicted at all.
 *
 * The coarse pyramid is small — a few hundred tiles across all six faces — and EVERYTHING depends on
 * it: every deep patch falls back to it while its own level loads, and the ground sampler reads it
 * constantly. Letting the LRU throw those out to make room for one more deep tile is how a cache
 * spends its capacity on exactly the wrong things.
 */
const PIN_LEVEL = 6;
const cache = new Map<string, Int16Array>();        // Map preserves insertion order = LRU
const inFlight = new Map<string, Promise<Int16Array | null>>();
const failed = new Map<string, number>();           // key -> retry-after timestamp
const RETRY_MS = 10_000;

/** Evictions since load. Thrash is invisible without it, which is how this went unnoticed. */
let evictions = 0;

/** A key is `face/level/x_y`; the level is what decides whether it can be thrown away. */
function levelOf(key: string): number {
  const a = key.indexOf('/');
  const b = key.indexOf('/', a + 1);
  return a < 0 || b < 0 ? 99 : Number(key.slice(a + 1, b));
}

function touch(key: string, data: Int16Array): void {
  cache.delete(key);
  cache.set(key, data);
  if (cache.size <= MAX_CACHED) return;
  // Walk from the oldest, skipping anything pinned. Bounded by the cache size, and only runs on the
  // frames that actually overflow.
  for (const k of cache.keys()) {
    if (cache.size <= MAX_CACHED) break;
    if (levelOf(k) <= PIN_LEVEL) continue;
    cache.delete(k);
    evictions++;
  }
}

/**
 * Put a tile straight into the cache. FOR TESTS ONLY.
 *
 * check-tile-cache drives the eviction policy directly, because the alternative is testing it
 * through `fetch` — and the bug being guarded against here is a cache that is smaller than its
 * working set, which is a property of the policy and nothing to do with the network.
 */
export function __putTileForTest(key: string, data: Int16Array): void { touch(key, data); }

/**
 * Decoded tile if it is already in memory, else null (and a fetch is started).
 * Never throws, never blocks.
 */
export function getTile(face: number, level: number, x: number, y: number): Int16Array | null {
  const key = tileKey(face, level, x, y);
  const hit = cache.get(key);
  if (hit) { touch(key, hit); return hit; }
  void requestTile(face, level, x, y);
  return null;
}

/** True if the tile is resident, without triggering a fetch. */
export function hasTile(face: number, level: number, x: number, y: number): boolean {
  return cache.has(tileKey(face, level, x, y));
}

/** Fetch + decode a tile, deduplicated. Resolves null if the tile could not be loaded. */
export function requestTile(
  face: number, level: number, x: number, y: number,
): Promise<Int16Array | null> {
  const key = tileKey(face, level, x, y);

  const cached = cache.get(key);
  if (cached) return Promise.resolve(cached);

  const existing = inFlight.get(key);
  if (existing) return existing;

  // Back off on a tile that already failed, so a missing level does not spam the network
  // once per frame per node.
  const retryAt = failed.get(key);
  if (retryAt !== undefined && Date.now() < retryAt) return Promise.resolve(null);

  const url = `${BASE}/h/${FACE_NAMES[face]}/${level}/${x}_${y}.bin?v=${TILE_EPOCH}`;
  const p = fetch(url)
    .then(async (r) => {
      if (!r.ok) throw new Error(`${r.status}`);
      const buf = await r.arrayBuffer();
      if (buf.byteLength !== BYTES) {
        throw new Error(`expected ${BYTES} bytes, got ${buf.byteLength}`);
      }
      // Int16Array over the buffer is a view, not a copy. The tiles are little-endian and
      // every platform we ship to is little-endian, so no byte swapping is needed.
      const data = new Int16Array(buf);
      touch(key, data);
      failed.delete(key);
      return data;
    })
    .catch((e) => {
      failed.set(key, Date.now() + RETRY_MS);
      // `import.meta.env` is injected by Vite and is undefined outside it, so reaching straight
      // into it threw here whenever a tile 404'd under the headless terrain checks — turning a
      // handled miss into a crash, in the one code path whose whole job is handling misses.
      if ((import.meta as { env?: { DEV?: boolean } }).env?.DEV) {
        console.warn(`[earth] tile ${key} failed: ${e.message}`);
      }
      return null;
    })
    .finally(() => { inFlight.delete(key); });

  inFlight.set(key, p);
  return p;
}

/** Elevation in METRES at sample (col, row) of a tile. */
export function sampleTile(tile: Int16Array, col: number, row: number): number {
  const c = col < 0 ? 0 : col > TILE - 1 ? TILE - 1 : col;
  const r = row < 0 ? 0 : row > TILE - 1 ? TILE - 1 : row;
  return tile[r * TILE + c];
}

/** Bilinear elevation in METRES at fractional tile coordinates (both in [0, TILE-1]). */
export function sampleTileBilinear(tile: Int16Array, fx: number, fy: number): number {
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  const h00 = sampleTile(tile, x0, y0), h10 = sampleTile(tile, x0 + 1, y0);
  const h01 = sampleTile(tile, x0, y0 + 1), h11 = sampleTile(tile, x0 + 1, y0 + 1);
  const a = h00 * (1 - tx) + h10 * tx;
  const b = h01 * (1 - tx) + h11 * tx;
  return a * (1 - ty) + b * ty;
}

/** Diagnostics for the debug overlay. */
export function earthTileStats(): {
  cached: number; inFlight: number; failed: number; evicted: number; cap: number;
} {
  return {
    cached: cache.size, inFlight: inFlight.size, failed: failed.size,
    evicted: evictions, cap: MAX_CACHED,
  };
}

/** Drop everything. Called when leaving the map so the memory does not linger. */
export function clearEarthTiles(): void {
  cache.clear();
  evictions = 0;
  failed.clear();
}
