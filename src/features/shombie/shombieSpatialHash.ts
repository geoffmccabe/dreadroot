// Tiny per-frame spatial hash of shombie positions, used for cheap local
// separation (each shombie only checks its immediate neighbors — O(neighbors),
// not O(n²), and no per-pair pathfinding). Rebuilt once per frame by
// useShombieSystem; queried per shombie by ShombieAdapter.applyResult.

import type { ShombieInstance } from './types';

const CELL = 2; // ~ separation radius; neighbors land in adjacent cells
const grid = new Map<number, ShombieInstance[]>();

// Pack a cell coord into one integer key (coords fit well within ±32768).
const cellKey = (cx: number, cz: number): number => (cx + 32768) * 65536 + (cz + 32768);

/** Rebuild the hash from the current shombie list. Call once per frame. */
export function rebuildShombieGrid(shombies: ReadonlyArray<ShombieInstance>): void {
  grid.clear();
  for (const s of shombies) {
    if (!s.isActive) continue;
    const k = cellKey(Math.floor(s.position.x / CELL), Math.floor(s.position.z / CELL));
    let arr = grid.get(k);
    if (!arr) { arr = []; grid.set(k, arr); }
    arr.push(s);
  }
}

// Reused output buffer — the caller consumes it before the next query
// (applyResult runs one shombie at a time), so no per-query allocation.
const _out: ShombieInstance[] = [];

/** Shombies within `radius` of (x,z), excluding `excludeId`. */
export function getNearbyShombies(
  x: number, z: number, radius: number, excludeId: string,
): ShombieInstance[] {
  _out.length = 0;
  const cx = Math.floor(x / CELL);
  const cz = Math.floor(z / CELL);
  const span = Math.max(1, Math.ceil(radius / CELL));
  for (let dx = -span; dx <= span; dx++) {
    for (let dz = -span; dz <= span; dz++) {
      const arr = grid.get(cellKey(cx + dx, cz + dz));
      if (!arr) continue;
      for (const s of arr) if (s.id !== excludeId) _out.push(s);
    }
  }
  return _out;
}
