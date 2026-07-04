// pgState — Procedural Generator state + scatter algorithm. Each CHOSEN species carries its own
// rarity WEIGHT, min/max size, and altitude band (seeded from the global defaults when first chosen,
// then independently editable). Generate does weighted species picks, per-species size + altitude.
import { useSyncExternalStore } from 'react';
import { getHeight } from '../terrain/heightField';
import { getBrushState } from '../terrain/terrainBrushState';
import { MUSHROOM_TREES } from './mushroomCatalog';

export interface SpeciesCfg {
  file: string;
  weight: number;              // relative rarity within the chosen group (higher = more common)
  minH: number; maxH: number;  // this species' size range (m)
  altMin: number; altMax: number;   // this species' altitude band (world Y)
  slopeMax: number;            // this species' own max ground slope (°); a HIGHER value than the global lets
                               // just this species climb steeper ground — effective = max(global, this).
}

export interface PgInstance {
  file: string; x: number; y: number; z: number;
  yaw: number; tiltX: number; tiltZ: number; height: number;
  stretchX: number; stretchY: number; stretchZ: number;
}

export interface PgParams {
  chosen: SpeciesCfg[];
  // GLOBAL DEFAULTS — used to seed a species when it's first chosen. Editing these only affects
  // species chosen AFTERWARDS, never ones already in the group.
  defMinH: number; defMaxH: number; defAltMin: number; defAltMax: number;
  // Global scatter params.
  count: number; sizeBias: number; yawRandom: boolean; tiltMax: number; stretchVar: number; slopeMax: number;
  regionMinX: number; regionMaxX: number; regionMinZ: number; regionMaxZ: number;
  seed: number;
}

const DEF = { minH: 10, maxH: 200, altMin: 22, altMax: 400, slope: 38 };
const mkCfg = (file: string, d = DEF): SpeciesCfg => ({ file, weight: 1, minH: d.minH, maxH: d.maxH, altMin: d.altMin, altMax: d.altMax, slopeMax: d.slope });

let params: PgParams = {
  chosen: MUSHROOM_TREES.map((f) => mkCfg(f)),   // start with all chosen at defaults
  defMinH: DEF.minH, defMaxH: DEF.maxH, defAltMin: DEF.altMin, defAltMax: DEF.altMax,
  count: 400, sizeBias: 3, yawRandom: true, tiltMax: 8, stretchVar: 0.15, slopeMax: 38,
  regionMinX: -1300, regionMaxX: -300, regionMinZ: 1400, regionMaxZ: 2520,
  seed: 1,
};
let instances: PgInstance[] = [];
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export const getPgParams = () => params;
export const getPgInstances = () => instances;
export function setPgParams(patch: Partial<PgParams>): void { params = { ...params, ...patch }; emit(); }

export function isChosen(file: string): boolean { return params.chosen.some((c) => c.file === file); }
export function addSpecies(file: string): void {   // seeds from the CURRENT global defaults
  if (isChosen(file)) return;
  params = { ...params, chosen: [...params.chosen, mkCfg(file, { minH: params.defMinH, maxH: params.defMaxH, altMin: params.defAltMin, altMax: params.defAltMax, slope: params.slopeMax })] };
  emit();
}
export function removeSpecies(file: string): void {
  params = { ...params, chosen: params.chosen.filter((c) => c.file !== file) }; emit();
}
export function updateSpecies(file: string, patch: Partial<SpeciesCfg>): void {
  params = { ...params, chosen: params.chosen.map((c) => (c.file === file ? { ...c, ...patch } : c)) }; emit();
}
export function clearInstances(): void { instances = []; emit(); }

function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function generate(): void {
  const p = params;
  const pool = p.chosen.filter((c) => c.weight > 0);
  if (!pool.length) { instances = []; emit(); return; }
  const totalW = pool.reduce((s, c) => s + c.weight, 0);
  const rand = rng(p.seed || 1);
  const waterLevel = getBrushState().waterLevel;
  const out: PgInstance[] = [];
  const e = 2;
  for (let i = 0; i < p.count; i++) {
    const x = p.regionMinX + rand() * (p.regionMaxX - p.regionMinX);
    const z = p.regionMinZ + rand() * (p.regionMaxZ - p.regionMinZ);
    const y = getHeight(x, z);
    if (y <= waterLevel) continue;
    const gx = (getHeight(x + e, z) - getHeight(x - e, z)) / (2 * e);
    const gz = (getHeight(x, z + e) - getHeight(x, z - e)) / (2 * e);
    const slopeDeg = Math.atan(Math.hypot(gx, gz)) * 180 / Math.PI;
    // weighted species pick (before the slope test, so each species' own slope cap can apply)
    let r = rand() * totalW, s = pool[0];
    for (const c of pool) { r -= c.weight; if (r <= 0) { s = c; break; } }
    // Global slope is the baseline for everyone; a species with a HIGHER own cap may climb steeper.
    const effSlope = Math.max(p.slopeMax, s.slopeMax ?? p.slopeMax);
    if (slopeDeg > effSlope) continue;
    if (y < s.altMin || y > s.altMax) continue;   // this species' altitude band
    const height = s.minH * Math.pow(s.maxH / s.minH, Math.pow(rand(), p.sizeBias));
    const yaw = p.yawRandom ? rand() * Math.PI * 2 : 0;
    const tiltX = (rand() * 2 - 1) * p.tiltMax * Math.PI / 180;
    const tiltZ = (rand() * 2 - 1) * p.tiltMax * Math.PI / 180;
    const sv = p.stretchVar;
    out.push({ file: s.file, x, y, z, yaw, tiltX, tiltZ, height, stretchX: 1 + (rand() * 2 - 1) * sv, stretchY: 1 + (rand() * 2 - 1) * sv, stretchZ: 1 + (rand() * 2 - 1) * sv });
  }
  instances = out;
  emit();
}

// Hover-preview (a URL) + the PLACE item behind it, so clicking the big preview can GRAB (arm) it.
let previewFile: string | null = null;
export const getPgPreview = () => previewFile;
export function setPgPreview(f: string | null): void { if (previewFile !== f) { previewFile = f; emit(); } }
let grabItem: { set: string; file: string; name: string } | null = null;
export const getPgGrab = () => grabItem;
export function setPgGrab(i: { set: string; file: string; name: string } | null): void { grabItem = i; }

const sub = (cb: () => void) => { subs.add(cb); return () => subs.delete(cb); };
export const usePgParams = (): PgParams => useSyncExternalStore(sub, getPgParams, getPgParams);
export const usePgInstances = (): PgInstance[] => useSyncExternalStore(sub, getPgInstances, getPgInstances);
export const usePgPreview = (): string | null => useSyncExternalStore(sub, getPgPreview, getPgPreview);
