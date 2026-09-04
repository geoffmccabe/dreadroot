// heightField — the CANONICAL terrain for editable maps (Builder Sandbox + player maps).
// A sparse height value on a 1 m world lattice (only edited points are stored; the
// rest read the map baseline). This is the source of truth that:
//   • sampleHeight() reads for player ground-follow / coins / boulders (via the
//     dynamic-provider hook in terrainHeight.ts),
//   • HeightmapTerrain renders (one displaced mesh per 128 m cell),
//   • the brush edits,
//   • save/load (1E) serializes.
// Cells are 128 m = exactly 8×8 Dreadroot 16 m chunks, origin-aligned, so the map
// grid nests perfectly inside the voxel chunk grid (and doubles as the network AoI
// zone). Detail (1 m samples) is independent of cell size — see docs.

export const CELL_M = 128;            // streaming cell + network zone size (meters)
export const SAMPLE_M = 1;            // height-sample spacing (meters) = terrain detail
export const SAMPLES = CELL_M / SAMPLE_M + 1; // 129 verts per cell side (shared edges)

import { shapeT, shapeExtent, type BrushShape } from './brushShapes';

export type BrushMode = 'raise' | 'lower' | 'smooth' | 'flat';

const OFF = 32768;                    // ±32768 lattice range, packed to one int32 key
const sKey = (sx: number, sz: number) => (sx + OFF) * 65536 + (sz + OFF);
export const cellKey = (cx: number, cz: number) => (cx + OFF) * 65536 + (cz + OFF);
export const cellOf = (w: number) => Math.floor(w / CELL_M);

let baseY = 0;
const samples = new Map<number, number>(); // sample key → height (absent = baseY)
const dirty = new Set<number>();           // cell keys whose mesh needs a rebuild

export function setBaseline(y: number) { baseY = y; }
export function getBaseline() { return baseY; }
export function clearField() { samples.clear(); dirty.clear(); }
export function editedSampleCount() { return samples.size; }

/** Raw stored sample (or baseline). Used by the mesh builder per vertex. */
export function getSampleAt(sx: number, sz: number): number {
  const v = samples.get(sKey(sx, sz));
  return v === undefined ? baseY : v;
}

/** Authoritative ground height at world (x,z) — bilinear over the 1 m lattice. */
export function getHeight(x: number, z: number): number {
  const sx = Math.floor(x), sz = Math.floor(z);
  const tx = x - sx, tz = z - sz;
  const h00 = getSampleAt(sx, sz), h10 = getSampleAt(sx + 1, sz);
  const h01 = getSampleAt(sx, sz + 1), h11 = getSampleAt(sx + 1, sz + 1);
  const a = h00 * (1 - tx) + h10 * tx;
  const b = h01 * (1 - tx) + h11 * tx;
  return a * (1 - tz) + b * tz;
}

export function consumeDirtyCells(): number[] {
  if (!dirty.size) return [];
  const out = Array.from(dirty);
  dirty.clear();
  return out;
}

function markBox(minX: number, minZ: number, maxX: number, maxZ: number) {
  for (let cx = cellOf(minX); cx <= cellOf(maxX); cx++)
    for (let cz = cellOf(minZ); cz <= cellOf(maxZ); cz++)
      dirty.add(cellKey(cx, cz));
}

// Smooth edge falloff: 1 at brush center → 0 at the rim (cosine ease = soft blur).
function falloff(t: number, edge: number): number {
  if (t >= 1) return 0;
  // edge in [0,1]: 0 = hard rim, 1 = very soft. Blend a flat core with a cosine skirt.
  const core = 1 - edge;                 // fraction of radius at full strength
  if (t <= core) return 1;
  const u = (t - core) / Math.max(1e-3, 1 - core);
  return 0.5 + 0.5 * Math.cos(u * Math.PI);
}

function neighborAvg(sx: number, sz: number): number {
  return (getSampleAt(sx - 1, sz) + getSampleAt(sx + 1, sz)
        + getSampleAt(sx, sz - 1) + getSampleAt(sx, sz + 1)) * 0.25;
}

/**
 * Stamp the brush at world (x,z). `strength` is meters/second (scaled by dt so it's
 * frame-rate independent). `edge` (0..1) is the edge-blur softness. `flatTarget` is
 * the height the 'flat' mode pulls toward (else baseline). `shape` + `yaw` orient a
 * non-circular dig footprint (rect/oval/wedge) to the player's facing.
 */
export function applyBrush(
  x: number, z: number, radius: number, strength: number, mode: BrushMode,
  dt: number, edge = 0.5, flatTarget?: number, shape: BrushShape = 'circle', yaw = 0,
) {
  const r = Math.max(1, radius);
  const amp = strength * dt;
  const e = shapeExtent(shape);
  const reach = r * Math.max(e.x, e.z) + 1;   // rotation-safe iteration bounds
  const cos = Math.cos(-yaw), sin = Math.sin(-yaw);
  const sx0 = Math.floor(x - reach), sx1 = Math.ceil(x + reach);
  const sz0 = Math.floor(z - reach), sz1 = Math.ceil(z + reach);
  for (let sz = sz0; sz <= sz1; sz++) {
    for (let sx = sx0; sx <= sx1; sx++) {
      // rotate the world offset into brush-local space (x = across facing, z = along)
      const ox = sx - x, oz = sz - z;
      const lx = ox * cos - oz * sin, lz = ox * sin + oz * cos;
      const d = shapeT(shape, lx, lz, r);
      if (d > 1) continue;
      const w = falloff(d, edge);
      if (w <= 0) continue;
      const k = sKey(sx, sz);
      const cur = samples.get(k) ?? baseY;
      let next = cur;
      if (mode === 'raise') next = cur + amp * w;
      else if (mode === 'lower') next = cur - amp * w;
      else if (mode === 'smooth') next = cur + (neighborAvg(sx, sz) - cur) * Math.min(1, amp * 0.12 * w);
      else if (mode === 'flat') next = cur + ((flatTarget ?? baseY) - cur) * Math.min(1, amp * 0.06 * w);
      samples.set(k, next);
    }
  }
  markBox(sx0, sz0, sx1, sz1);
}

/** Serialize edited samples for save (1E). Flat array [key,height, key,height, …]. */
export function serializeField(): { baseY: number; samples: number[] } {
  const arr: number[] = [];
  for (const [k, v] of samples) { arr.push(k, v); }
  return { baseY, samples: arr };
}

export function loadField(data: { baseY?: number; samples: number[] }) {
  clearField();
  baseY = data.baseY ?? 0;
  for (let i = 0; i < data.samples.length; i += 2) samples.set(data.samples[i], data.samples[i + 1]);
}
