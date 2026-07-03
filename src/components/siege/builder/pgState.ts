// pgState — Procedural Generator state + the scatter algorithm. Shared store (like builderObjectsState)
// between the PG panel (params) and the instanced render layer (generated instances). One "Generate"
// pass fills `instances` synchronously (fast — it's just math + terrain samples), and the render layer
// rebuilds its InstancedMeshes from it. Seeded RNG → the same seed reproduces the same forest.
import { useSyncExternalStore } from 'react';
import { getHeight } from '../terrain/heightField';
import { getBrushState } from '../terrain/terrainBrushState';
import { MUSHROOM_TREES } from './mushroomCatalog';

export interface PgInstance {
  file: string;
  x: number; y: number; z: number;      // base position (engine space)
  yaw: number;                          // random spin
  tiltX: number; tiltZ: number;         // lean off vertical (radians)
  height: number;                       // target height in metres (render layer converts to scale)
  stretchX: number; stretchY: number; stretchZ: number;  // non-uniform jitter
}

export interface PgParams {
  species: string[];        // enabled model files
  count: number;            // scatter attempts (rejected points don't place)
  minH: number; maxH: number; sizeBias: number;   // height range (m) + big-is-rare exponent
  yawRandom: boolean;
  tiltMax: number;          // max lean from vertical (deg)
  stretchVar: number;       // non-uniform scale jitter (0..1)
  altMin: number; altMax: number;   // only place where terrain Y is in this band
  slopeMax: number;         // skip terrain steeper than this (deg)
  regionMinX: number; regionMaxX: number; regionMinZ: number; regionMaxZ: number;
  seed: number;
}

// Defaults tuned for the NEW (northern) island the user built: land ≈ X[-1300,-300] Z[1400,2520].
const DEFAULTS: PgParams = {
  species: [...MUSHROOM_TREES],
  count: 400,
  minH: 10, maxH: 200, sizeBias: 3,     // bias 3 → most near 10 m, a few giants
  yawRandom: true,
  tiltMax: 8,
  stretchVar: 0.15,
  altMin: 22, altMax: 400,
  slopeMax: 38,
  regionMinX: -1300, regionMaxX: -300, regionMinZ: 1400, regionMaxZ: 2520,
  seed: 1,
};

let params: PgParams = { ...DEFAULTS };
let instances: PgInstance[] = [];
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export const getPgParams = () => params;
export const getPgInstances = () => instances;
export function setPgParams(patch: Partial<PgParams>): void { params = { ...params, ...patch }; emit(); }
export function toggleSpecies(file: string): void {
  params = { ...params, species: params.species.includes(file) ? params.species.filter((f) => f !== file) : [...params.species, file] };
  emit();
}
export function clearInstances(): void { instances = []; emit(); }

// Hover-preview: which species model to float+spin beside the panel (null = none).
let previewFile: string | null = null;
export const getPgPreview = () => previewFile;
export function setPgPreview(f: string | null): void { if (previewFile !== f) { previewFile = f; emit(); } }
export function usePgPreview(): string | null {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, getPgPreview, getPgPreview);
}

// Small fast seeded PRNG (mulberry32) so a seed reproduces the forest.
function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function generate(): void {
  const p = params;
  if (!p.species.length) { instances = []; emit(); return; }
  const rand = rng(p.seed || 1);
  const waterLevel = getBrushState().waterLevel;
  const out: PgInstance[] = [];
  const e = 2;
  for (let i = 0; i < p.count; i++) {
    const x = p.regionMinX + rand() * (p.regionMaxX - p.regionMinX);
    const z = p.regionMinZ + rand() * (p.regionMaxZ - p.regionMinZ);
    const y = getHeight(x, z);
    if (y <= waterLevel || y < p.altMin || y > p.altMax) continue;   // above water + altitude band
    const gx = (getHeight(x + e, z) - getHeight(x - e, z)) / (2 * e);
    const gz = (getHeight(x, z + e) - getHeight(x, z - e)) / (2 * e);
    if (Math.atan(Math.hypot(gx, gz)) * 180 / Math.PI > p.slopeMax) continue;   // not on cliffs
    const file = p.species[Math.floor(rand() * p.species.length)];
    const height = p.minH * Math.pow(p.maxH / p.minH, Math.pow(rand(), p.sizeBias));  // exponential: small common, giant rare
    const yaw = p.yawRandom ? rand() * Math.PI * 2 : 0;
    const tiltX = (rand() * 2 - 1) * p.tiltMax * Math.PI / 180;
    const tiltZ = (rand() * 2 - 1) * p.tiltMax * Math.PI / 180;
    const s = p.stretchVar;
    out.push({
      file, x, y, z, yaw, tiltX, tiltZ, height,
      stretchX: 1 + (rand() * 2 - 1) * s, stretchY: 1 + (rand() * 2 - 1) * s, stretchZ: 1 + (rand() * 2 - 1) * s,
    });
  }
  instances = out;
  emit();
}

export function usePgParams(): PgParams {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, getPgParams, getPgParams);
}
export function usePgInstances(): PgInstance[] {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, getPgInstances, getPgInstances);
}
