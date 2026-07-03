// pgState — shared state for the Terrain panel's Procedural Generation (PG) mode.
// Mirrors the terrainBrushState store pattern (useSyncExternalStore). For now only
// Layer 0 (terrain SURFACE textures) is functional; the object layers are declared
// so the panel can show the full roadmap the user can grow into.
import { useSyncExternalStore } from 'react';

/** Which way the Terrain panel builds: hand-sculpt brush, or procedural generation. */
export type TerrainBuildMode = 'manual' | 'pg';

/** One terrain surface (ground) texture in the Layer-0 palette. */
export interface SurfaceTexture {
  id: string;
  name: string;
  url: string;        // '/path.webp' for built-ins, or a session object-URL for freshly-added
  builtin?: boolean;  // the 3 textures the live terrain already blends (sand/grass/rock)
}

/** A PG layer. `ready:false` layers are shown as roadmap slots, not yet functional. */
export interface PGLayer {
  id: string;
  label: string;
  kind: 'surface' | 'rocks' | 'plants' | 'groundcover' | 'windgrass';
  ready: boolean;
}

// Layer 0 first, then the object layers stacked on top (his 3-plant-sets + ground cover),
// then the 2D wind-grass visual layer. Only Layer 0 is wired up in this slice.
export const PG_LAYERS: PGLayer[] = [
  { id: 'surface',   label: 'Layer 0 · Surface',        kind: 'surface',     ready: true },
  { id: 'rocks',     label: 'Rocks & boulders',         kind: 'rocks',       ready: false },
  { id: 'plantsA',   label: 'Trees',                    kind: 'plants',      ready: false },
  { id: 'plantsB',   label: 'Plants',                   kind: 'plants',      ready: false },
  { id: 'plantsC',   label: 'Mushrooms',                kind: 'plants',      ready: false },
  { id: 'ground',    label: 'Ground cover (small)',     kind: 'groundcover', ready: false },
  { id: 'windgrass', label: 'Wind grass (2D billboards)', kind: 'windgrass', ready: false },
];

// The 3 textures the live terrain shader already blends today (terrainBlend.ts).
const BUILTIN_SURFACES: SurfaceTexture[] = [
  { id: 'sand',  name: 'Sand',  url: '/sww_terrain_sand.webp',  builtin: true },
  { id: 'grass', name: 'Grass', url: '/sww_terrain_grass.webp', builtin: true },
  { id: 'rock',  name: 'Rock',  url: '/sww_terrain_rock.webp',  builtin: true },
];

export interface PGState {
  mode: TerrainBuildMode;
  openLayer: string | null;   // which layer's sub-panel is expanded
  surfaces: SurfaceTexture[]; // Layer-0 palette
}

let state: PGState = { mode: 'manual', openLayer: 'surface', surfaces: [...BUILTIN_SURFACES] };
const subs = new Set<() => void>();

export function getPGState(): PGState { return state; }
export function setPGState(patch: Partial<PGState>): void {
  state = { ...state, ...patch };
  subs.forEach((f) => f());
}
export function usePGState(): PGState {
  return useSyncExternalStore(
    (cb) => { subs.add(cb); return () => { subs.delete(cb); }; },
    getPGState, getPGState,
  );
}

/** Add a surface texture from a picked file (preview via object-URL; not yet uploaded/persisted). */
export function addSurfaceFromFile(file: File): void {
  const name = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
  const tex: SurfaceTexture = { id: crypto.randomUUID(), name, url: URL.createObjectURL(file) };
  setPGState({ surfaces: [...state.surfaces, tex] });
}

export function removeSurface(id: string): void {
  setPGState({ surfaces: state.surfaces.filter((s) => s.id !== id) });
}

export function renameSurface(id: string, name: string): void {
  setPGState({ surfaces: state.surfaces.map((s) => (s.id === id ? { ...s, name } : s)) });
}
