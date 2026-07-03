// Shore-seeking flood fill for water. Given a seed point and a water LEVEL, it spreads
// horizontally across a fine grid, filling every cell whose top SOLID surface (terrain OR an
// object collider — same walls the player hits) sits below the level, and stopping wherever
// solid rises to/through the waterline. So it hugs the real shoreline of a complex pool with no
// hand-fitted rectangles. A low gap in the rim lets water "escape" and spread — capped at a cell
// budget so it never fills the world or hangs (the user sees the leak and plugs it with a rock,
// then re-floods). The result is a compact RLE footprint (floodMesh.ts turns it into geometry).
//
// The heavy part — probing the solid surface — is injected by the caller (meshGroundHeight), and
// the fill is stepped over frames (see stepFlood budget) so a big flood never hitches.

export interface FloodData {
  level: number;              // water surface Y (world)
  minX: number; minZ: number; // grid origin (world, cell 0,0 lower corner)
  cell: number;               // cell size (m)
  cols: number; rows: number; // grid dimensions
  runs: number[];             // RLE of filled cells: repeating [row, startCol, length]
  capped: boolean;            // true ⇒ hit the escape-safety cap (a leak isn't sealed)
}

export interface FloodJob {
  objId: string;
  level: number;
  minX: number; minZ: number; cell: number; cols: number; rows: number;
  fill: Uint8Array;      // 1 = confirmed water cell
  visited: Uint8Array;   // 1 = already enqueued (dedup)
  queue: number[];       // frontier of cell indices to test
  head: number;          // read cursor into queue (avoids array shift)
  filled: number;
  capped: boolean;
  done: boolean;
}

// Tunables. 0.5 m cells give clean shorelines; a 120 m radius covers any single pool; the cell cap
// bounds an escaped flood to ~a 90 m blob (obvious leak, ~0.3 s to compute) instead of the whole map.
export const FLOOD_CELL = 0.5;
export const FLOOD_RADIUS = 120;
export const FLOOD_CELL_CAP = 30000;

/** Set up a flood centred on (seedX, seedZ) at `level`. Cheap — the actual probing happens in
 *  stepFlood. Returns a job the frame loop advances. */
export function beginFlood(seedX: number, seedZ: number, level: number, objId: string): FloodJob {
  const cell = FLOOD_CELL;
  const side = Math.ceil((FLOOD_RADIUS * 2) / cell);
  const cols = side, rows = side;
  // Align the grid so the seed sits near the centre.
  const minX = seedX - (cols / 2) * cell;
  const minZ = seedZ - (rows / 2) * cell;
  const seedCol = Math.floor((seedX - minX) / cell);
  const seedRow = Math.floor((seedZ - minZ) / cell);
  const seedIdx = seedRow * cols + seedCol;
  const visited = new Uint8Array(cols * rows);
  visited[seedIdx] = 1;
  return {
    objId, level, minX, minZ, cell, cols, rows,
    fill: new Uint8Array(cols * rows), visited,
    queue: [seedIdx], head: 0, filled: 0, capped: false, done: false,
  };
}

/** Advance the flood by up to `budget` cell tests. `topSolid(x,z)` returns the highest solid
 *  surface Y at a world point (or null for void). Returns true once the flood is complete. */
export function stepFlood(job: FloodJob, topSolid: (x: number, z: number) => number | null, budget: number): boolean {
  const { cols, rows, cell, minX, minZ, level, fill, visited, queue } = job;
  for (let n = 0; n < budget; n++) {
    if (job.filled >= FLOOD_CELL_CAP) { job.capped = true; break; }
    if (job.head >= queue.length) break;
    const idx = queue[job.head++];
    const col = idx % cols, row = (idx / cols) | 0;
    const x = minX + (col + 0.5) * cell, z = minZ + (row + 0.5) * cell;
    const h = topSolid(x, z);
    if (h == null || h >= level) continue;   // a wall (shore / rock / tree at the waterline) — don't spread
    fill[idx] = 1; job.filled++;
    // Spread to the 4 orthogonal neighbours (water only flows out of a water cell).
    if (col > 0) { const j = idx - 1; if (!visited[j]) { visited[j] = 1; queue.push(j); } }
    if (col < cols - 1) { const j = idx + 1; if (!visited[j]) { visited[j] = 1; queue.push(j); } }
    if (row > 0) { const j = idx - cols; if (!visited[j]) { visited[j] = 1; queue.push(j); } }
    if (row < rows - 1) { const j = idx + cols; if (!visited[j]) { visited[j] = 1; queue.push(j); } }
  }
  job.done = job.capped || job.head >= queue.length;
  return job.done;
}

/** Compact the filled grid into an RLE footprint. Returns null if nothing filled (seed was on/above
 *  the ground — raise the water above the surface before flooding). */
export function finishFlood(job: FloodJob): FloodData | null {
  const { cols, rows, fill } = job;
  const runs: number[] = [];
  for (let r = 0; r < rows; r++) {
    let c = 0;
    while (c < cols) {
      if (fill[r * cols + c]) {
        const start = c;
        while (c < cols && fill[r * cols + c]) c++;
        runs.push(r, start, c - start);
      } else c++;
    }
  }
  if (!runs.length) return null;
  return {
    level: job.level, minX: job.minX, minZ: job.minZ, cell: job.cell,
    cols, rows, runs, capped: job.capped,
  };
}
