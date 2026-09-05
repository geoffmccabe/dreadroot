// terrainParams — every dial the terrain generator exposes, plus the store the tuning panel edits
// and the named presets it saves.
//
// The whole landscape is a function of THIS object. Two people with the same params see the same
// world, so a preset is a complete, portable description of a planet in a few hundred bytes.
//
// ⚠ Once land is sold the live params must be frozen: changing them moves the ground under people.

import { useSyncExternalStore } from 'react';

export interface TerrainParams {
  seed: number;
  /** Ceiling for peaks (m). The top of the range is compressed towards this, never sliced flat. */
  maxHeight: number;
  /** Everything sits on this, so land rises away from the Fortress rather than falling away. */
  baseElevation: number;

  /** Wavelengths (m): bigger is broader and smoother. */
  wlContinent: number;
  wlMountain: number;
  wlHill: number;
  wlDetail: number;

  /** Amplitudes (m). */
  ampContinent: number;
  ampMountain: number;
  ampHill: number;
  ampDetail: number;

  /** Only the part of the ridged field above this becomes mountain. Higher = rarer, sharper ranges. */
  ridgeFloor: number;

  /** Domain warp: how far and how coarsely the world is stirred before sampling. 0 = no warp. */
  warpAmount: number;
  warpWavelength: number;

  /** Gorges. Depth in metres, width as a fraction (smaller = narrower and sharper). */
  canyonDepth: number;
  canyonWidth: number;
  canyonWavelength: number;

  /** Scooped basins, which is where water will sit. */
  lakeDepth: number;
  lakeWavelength: number;

  /** Flat-topped benches: buttes, mesas and cliff faces. Step height in metres. */
  terraceStep: number;
  /** How hard the bench edges are, 0 = none, 1 = sheer. */
  terraceSharpness: number;

  /** Fortress stays flat: fully flat to the first radius, fully normal by the second. */
  flatRadius: number;
  flatBlend: number;
}

export const DEFAULT_TERRAIN: TerrainParams = {
  seed: 20260904,
  maxHeight: 400,
  baseElevation: 40,
  wlContinent: 8000,
  wlMountain: 2100,
  wlHill: 900,
  wlDetail: 60,
  ampContinent: 150,
  ampMountain: 340,
  ampHill: 55,
  ampDetail: 14,
  ridgeFloor: 0.52,
  warpAmount: 260,
  warpWavelength: 900,
  canyonDepth: 95,
  canyonWidth: 0.22,
  canyonWavelength: 1400,
  lakeDepth: 70,
  lakeWavelength: 2600,
  terraceStep: 26,
  terraceSharpness: 0.75,
  flatRadius: 160,
  flatBlend: 520,
};

let params: TerrainParams = { ...DEFAULT_TERRAIN };
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export const getTerrainParams = (): TerrainParams => params;
export function setTerrainParams(patch: Partial<TerrainParams>): void {
  params = { ...params, ...patch };
  emit();
}
export function useTerrainParams(): TerrainParams {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => { subs.delete(cb); }; }, getTerrainParams, getTerrainParams);
}

/** A fresh random seed, for the Generate button. */
export const rollSeed = (): number => Math.floor(Math.random() * 1e9);

// ---- named presets, so a world you like can be got back ----

const STORE_KEY = 'starblink.terrainPresets';

export interface TerrainPreset { name: string; savedAt: number; params: TerrainParams }

export function listPresets(): TerrainPreset[] {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || '[]') as TerrainPreset[]; }
  catch { return []; }
}

export function savePreset(name: string): void {
  const all = listPresets().filter((p) => p.name !== name);
  all.unshift({ name, savedAt: Date.now(), params: { ...params } });
  try { localStorage.setItem(STORE_KEY, JSON.stringify(all.slice(0, 40))); } catch { /* quota */ }
}

export function loadPreset(name: string): boolean {
  const p = listPresets().find((x) => x.name === name);
  if (!p) return false;
  // Spread over the defaults so a preset saved before a dial existed still loads.
  params = { ...DEFAULT_TERRAIN, ...p.params };
  emit();
  return true;
}

export function deletePreset(name: string): void {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(listPresets().filter((p) => p.name !== name))); }
  catch { /* quota */ }
}
