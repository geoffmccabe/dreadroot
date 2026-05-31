// shpiderSpatialGrid — O(1) average lookup for "shpiders near a point."
//
// Before: every shpider's hop AI called isTooCrowded / analyzeStack
// which walked the entire shpider list. With N nearby shpiders this
// was N² distance comparisons per frame.
//
// After: shpiders register their cell on spawn / move / death; queries
// touch at most a 2×2 cell window. Each cell is CELL_SIZE blocks wide
// (chosen ≥ SHPIDER_MIN_TARGET_SPACING so any radius ≤ SPACING is
// guaranteed to be contained in the 1- or 4-cell query window).
//
// Module-level singleton. Caller is responsible for keeping it in
// sync — insert on spawn, remove on death, move on every position
// integration step. The grid does not attempt to detect stale entries.

const CELL_SIZE = 2; // blocks — > SHPIDER_MIN_TARGET_SPACING (1.2)

function cellKey(cx: number, cz: number): string {
  return `${cx}|${cz}`;
}

interface Entry {
  id: string;
  x: number;
  z: number;
  /** Y kept for vertical-stack queries; not used by horizontal lookups. */
  y: number;
}

class ShpiderSpatialGrid {
  /** cellKey → set of shpider entries in that cell. */
  private cells: Map<string, Set<Entry>> = new Map();
  /** id → entry, for O(1) remove + cell-lookup before move. */
  private byId: Map<string, Entry> = new Map();

  insert(id: string, x: number, y: number, z: number): void {
    // Defensive: if a duplicate insert lands (shouldn't happen, but a
    // double-spawn could), remove the stale entry first so we don't
    // leak it.
    if (this.byId.has(id)) this.remove(id);
    const entry: Entry = { id, x, y, z };
    this.byId.set(id, entry);
    const key = cellKey(Math.floor(x / CELL_SIZE), Math.floor(z / CELL_SIZE));
    let bucket = this.cells.get(key);
    if (!bucket) { bucket = new Set(); this.cells.set(key, bucket); }
    bucket.add(entry);
  }

  remove(id: string): void {
    const entry = this.byId.get(id);
    if (!entry) return;
    this.byId.delete(id);
    const key = cellKey(Math.floor(entry.x / CELL_SIZE), Math.floor(entry.z / CELL_SIZE));
    const bucket = this.cells.get(key);
    if (bucket) {
      bucket.delete(entry);
      if (bucket.size === 0) this.cells.delete(key);
    }
  }

  /** Update position. If the new cell differs from the old, re-bucket;
   *  otherwise just update the stored coordinates. */
  move(id: string, x: number, y: number, z: number): void {
    const entry = this.byId.get(id);
    if (!entry) {
      // Not present — treat as insert.
      this.insert(id, x, y, z);
      return;
    }
    const oldKey = cellKey(Math.floor(entry.x / CELL_SIZE), Math.floor(entry.z / CELL_SIZE));
    const newKey = cellKey(Math.floor(x / CELL_SIZE), Math.floor(z / CELL_SIZE));
    entry.x = x; entry.y = y; entry.z = z;
    if (oldKey === newKey) return;
    const oldBucket = this.cells.get(oldKey);
    if (oldBucket) {
      oldBucket.delete(entry);
      if (oldBucket.size === 0) this.cells.delete(oldKey);
    }
    let newBucket = this.cells.get(newKey);
    if (!newBucket) { newBucket = new Set(); this.cells.set(newKey, newBucket); }
    newBucket.add(entry);
  }

  /** Invoke callback for every shpider whose XZ distance from (x, z)
   *  is ≤ radius. Excludes `excludeId` (the caller — usually self). */
  queryNearby(
    x: number, z: number,
    radius: number,
    callback: (id: string, ex: number, ey: number, ez: number) => void,
    excludeId?: string,
  ): void {
    const r2 = radius * radius;
    const minCx = Math.floor((x - radius) / CELL_SIZE);
    const maxCx = Math.floor((x + radius) / CELL_SIZE);
    const minCz = Math.floor((z - radius) / CELL_SIZE);
    const maxCz = Math.floor((z + radius) / CELL_SIZE);
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        const bucket = this.cells.get(cellKey(cx, cz));
        if (!bucket) continue;
        for (const e of bucket) {
          if (e.id === excludeId) continue;
          const dx = e.x - x;
          const dz = e.z - z;
          if (dx * dx + dz * dz <= r2) {
            callback(e.id, e.x, e.y, e.z);
          }
        }
      }
    }
  }

  /** True if at least one other shpider's XZ is within radius of (x, z). */
  hasNearby(x: number, z: number, radius: number, excludeId?: string): boolean {
    const r2 = radius * radius;
    const minCx = Math.floor((x - radius) / CELL_SIZE);
    const maxCx = Math.floor((x + radius) / CELL_SIZE);
    const minCz = Math.floor((z - radius) / CELL_SIZE);
    const maxCz = Math.floor((z + radius) / CELL_SIZE);
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        const bucket = this.cells.get(cellKey(cx, cz));
        if (!bucket) continue;
        for (const e of bucket) {
          if (e.id === excludeId) continue;
          const dx = e.x - x;
          const dz = e.z - z;
          if (dx * dx + dz * dz <= r2) return true;
        }
      }
    }
    return false;
  }

  size(): number {
    return this.byId.size;
  }

  /** Diagnostic: how many cells have entries. */
  cellCount(): number {
    return this.cells.size;
  }
}

export const shpiderSpatialGrid = new ShpiderSpatialGrid();
