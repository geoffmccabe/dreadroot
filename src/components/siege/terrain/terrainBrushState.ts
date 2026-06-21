// terrainBrushState — shared state between the styled panel (outside Canvas) and the
// in-Canvas brush controller. Mirrors the activeGame/activeMap store pattern.
import { useSyncExternalStore } from 'react';
import type { BrushMode } from './heightField';
import type { BrushShape } from './brushShapes';

export interface BrushState {
  enabled: boolean;   // build mode on/off (when off, normal play is untouched)
  mode: BrushMode;    // raise | lower | smooth | flat
  shape: BrushShape;  // circle | oval | rect2 | rect10 | wedge (oriented to facing)
  radius: number;     // brush radius (meters)
  strength: number;   // meters/second at full strength
  edge: number;       // edge-blur softness 0 (hard) .. 1 (soft)
  waterOn: boolean;   // flood the map with water up to waterLevel
  waterLevel: number; // water surface height (world Y) — dig terrain below it to make lakes
}

let state: BrushState = { enabled: false, mode: 'raise', shape: 'circle', radius: 12, strength: 10, edge: 0.5, waterOn: false, waterLevel: 4 };
const subs = new Set<() => void>();

export function getBrushState(): BrushState { return state; }
export function setBrushState(patch: Partial<BrushState>): void {
  state = { ...state, ...patch };
  subs.forEach((f) => f());
}
export function useBrushState(): BrushState {
  return useSyncExternalStore(
    (cb) => { subs.add(cb); return () => { subs.delete(cb); }; },
    getBrushState, getBrushState,
  );
}
