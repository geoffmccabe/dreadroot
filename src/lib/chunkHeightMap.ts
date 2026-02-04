/**
 * chunkHeightMap — 2D max-height lookup for O(1) walkability checks.
 *
 * Each loaded chunk gets a Uint16Array(256) storing the highest occupied Y
 * at every (localX, localZ) cell within the 16×16 chunk.
 *
 * Used by the pathfinding Web Worker to determine walkability without
 * querying the spatial hash grid (which can't be transferred to a worker).
 */

import { CHUNK_SIZE } from '@/lib/chunkManager';

// ---- Internal storage ----

/** chunkKey → Uint16Array(256) mapping localIndex → maxY */
const heightMaps = new Map<string, Uint16Array>();

// ---- Public API ----

/**
 * Rebuild the height map for a single chunk from its block array.
 * Called whenever a chunk is loaded, refetched, or blocks are added/removed.
 */
export function updateChunkHeightMap(
  chunkKey: string,
  blocks: Array<{ position_x: number; position_y: number; position_z: number }>
): void {
  let hm = heightMaps.get(chunkKey);
  if (!hm) {
    hm = new Uint16Array(CHUNK_SIZE * CHUNK_SIZE);
    heightMaps.set(chunkKey, hm);
  } else {
    hm.fill(0);
  }

  // Extract chunk origin from key: "chunk_X_Z"
  const parts = chunkKey.split('_');
  const originX = parseInt(parts[1], 10) * CHUNK_SIZE;
  const originZ = parseInt(parts[2], 10) * CHUNK_SIZE;

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const lx = b.position_x - originX;
    const lz = b.position_z - originZ;

    // Skip out-of-chunk blocks (shouldn't happen, but safe)
    if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) continue;

    const idx = lz * CHUNK_SIZE + lx;
    // Store the top of the block (position_y + 1) so height represents clearance
    const topY = b.position_y + 1;
    if (topY > hm[idx]) {
      hm[idx] = topY;
    }
  }
}

/**
 * Remove height map data when a chunk is unloaded.
 */
export function removeChunkHeightMap(chunkKey: string): void {
  heightMaps.delete(chunkKey);
}

/**
 * Clear all height map data (world change).
 */
export function clearAllHeightMaps(): void {
  heightMaps.clear();
}

/**
 * Look up the highest occupied Y (block top) at a world XZ position.
 * Returns 0 if the chunk isn't loaded or the cell is empty.
 */
export function getMaxHeightAt(worldX: number, worldZ: number): number {
  const cx = Math.floor(worldX / CHUNK_SIZE);
  const cz = Math.floor(worldZ / CHUNK_SIZE);
  const hm = heightMaps.get(`chunk_${cx}_${cz}`);
  if (!hm) return 0;

  const lx = Math.floor(worldX) - cx * CHUNK_SIZE;
  const lz = Math.floor(worldZ) - cz * CHUNK_SIZE;
  if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) return 0;

  return hm[lz * CHUNK_SIZE + lx];
}

/**
 * Check if an entity can stand at (worldX, worldZ) given its feet Y and height.
 * Walkable if the highest block at that cell doesn't intersect the entity's vertical span.
 *
 * For ground-level pathfinding (feetY = 0): walkable when maxHeight ≤ feetY,
 * meaning there are no blocks above the entity's feet.
 *
 * For entities that need vertical clearance: walkable when the highest block
 * is below the entity's feet OR above the entity's head (no overlap).
 */
export function isWalkableAt(
  worldX: number,
  worldZ: number,
  feetY: number,
  entityHeight: number
): boolean {
  const maxH = getMaxHeightAt(worldX, worldZ);
  if (maxH === 0) return true; // Empty cell or unloaded chunk

  // Entity occupies vertical range [feetY, feetY + entityHeight]
  // Block column occupies [0, maxH]
  // Blocked if maxH > feetY (blocks extend above entity's feet)
  // and feetY < maxH (entity's feet are below the top of blocks)
  return maxH <= feetY;
}

/**
 * Extract a rectangular region of height data as a flat Uint16Array.
 * Used to send height map snapshots to the pathfinding Web Worker.
 *
 * The output covers chunk coordinates [minCX..maxCX] × [minCZ..maxCZ] inclusive.
 * Each chunk contributes a 16×16 tile. Total size = (width * CHUNK_SIZE) × (depth * CHUNK_SIZE).
 *
 * Returns the typed array and its world-space origin so the worker can
 * convert world coordinates to array indices.
 */
export function getHeightMapSnapshot(
  minCX: number,
  maxCX: number,
  minCZ: number,
  maxCZ: number
): {
  data: Uint16Array;
  originX: number;
  originZ: number;
  width: number;  // cells in X
  depth: number;  // cells in Z
} {
  const chunksX = maxCX - minCX + 1;
  const chunksZ = maxCZ - minCZ + 1;
  const width = chunksX * CHUNK_SIZE;
  const depth = chunksZ * CHUNK_SIZE;
  const data = new Uint16Array(width * depth);

  for (let cx = minCX; cx <= maxCX; cx++) {
    for (let cz = minCZ; cz <= maxCZ; cz++) {
      const hm = heightMaps.get(`chunk_${cx}_${cz}`);
      if (!hm) continue; // Unloaded chunks stay 0 (treated as walkable)

      const tileOffsetX = (cx - minCX) * CHUNK_SIZE;
      const tileOffsetZ = (cz - minCZ) * CHUNK_SIZE;

      for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        const srcRow = lz * CHUNK_SIZE;
        const dstRow = (tileOffsetZ + lz) * width + tileOffsetX;
        // Copy one row of 16 values
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
          data[dstRow + lx] = hm[srcRow + lx];
        }
      }
    }
  }

  return {
    data,
    originX: minCX * CHUNK_SIZE,
    originZ: minCZ * CHUNK_SIZE,
    width,
    depth,
  };
}
