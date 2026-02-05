/**
 * Pond Block Generator
 *
 * Generates water/lava blocks for chunks on demand based on pond definitions.
 * Blocks are NOT stored in placed_blocks - they are generated dynamically.
 */

import { type WorldPond, type WaterType } from './pondGenerator';

// ============================================
// Types
// ============================================

export interface WaterBlock {
  x: number;
  y: number;
  z: number;
  waterType: WaterType;
  isTopSurface: boolean;  // True if this is the top water block (for shimmer effect)
}

export interface WaterBlocksForChunk {
  blocks: WaterBlock[];
  waterCount: number;
  lavaCount: number;
}

// ============================================
// Block Generation
// ============================================

/**
 * Generate water blocks for a chunk based on pond definitions.
 * Returns blocks for rendering (not for storage in DB).
 */
export function generatePondBlocksForChunk(
  ponds: WorldPond[],
  chunkX: number,
  chunkZ: number,
  chunkSize: number = 16
): WaterBlocksForChunk {
  const blocks: WaterBlock[] = [];
  let waterCount = 0;
  let lavaCount = 0;

  // Chunk bounds
  const chunkMinX = chunkX * chunkSize;
  const chunkMaxX = chunkMinX + chunkSize;
  const chunkMinZ = chunkZ * chunkSize;
  const chunkMaxZ = chunkMinZ + chunkSize;

  // Track which positions are water (for overlapping ponds - use deepest)
  // Key: "x,z" -> { depth, waterType }
  const waterColumns = new Map<string, { depth: number; waterType: WaterType }>();

  for (const pond of ponds) {
    // Pond bounds
    const pondMaxX = pond.min_x + pond.width;
    const pondMaxZ = pond.min_z + pond.height;

    // Skip if no overlap with chunk
    if (pondMaxX <= chunkMinX || pond.min_x >= chunkMaxX) continue;
    if (pondMaxZ <= chunkMinZ || pond.min_z >= chunkMaxZ) continue;

    // Calculate overlapping region
    const startX = Math.max(pond.min_x, chunkMinX);
    const endX = Math.min(pondMaxX, chunkMaxX);
    const startZ = Math.max(pond.min_z, chunkMinZ);
    const endZ = Math.min(pondMaxZ, chunkMaxZ);

    // Update water columns for this pond
    for (let x = startX; x < endX; x++) {
      for (let z = startZ; z < endZ; z++) {
        const key = `${x},${z}`;
        const existing = waterColumns.get(key);

        // Use the deepest pond at each position
        if (!existing || pond.depth > existing.depth) {
          waterColumns.set(key, { depth: pond.depth, waterType: pond.water_type });
        }
      }
    }
  }

  // Generate blocks from water columns
  for (const [key, { depth, waterType }] of waterColumns) {
    const [xStr, zStr] = key.split(',');
    const x = parseInt(xStr, 10);
    const z = parseInt(zStr, 10);

    // Water goes from Y = -1 (surface) down to Y = -depth
    for (let y = -1; y >= -depth; y--) {
      const isTopSurface = y === -1;

      blocks.push({
        x,
        y,
        z,
        waterType,
        isTopSurface,
      });

      if (waterType === 'water') waterCount++;
      else lavaCount++;
    }
  }

  return { blocks, waterCount, lavaCount };
}

/**
 * Check if a position is inside water in any pond.
 */
export function isPositionInWater(
  ponds: WorldPond[],
  x: number,
  y: number,
  z: number
): boolean {
  for (const pond of ponds) {
    // Check horizontal bounds
    if (x < pond.min_x || x >= pond.min_x + pond.width) continue;
    if (z < pond.min_z || z >= pond.min_z + pond.height) continue;

    // Check vertical bounds (water from Y=-1 down to Y=-depth)
    if (y <= -1 && y >= -pond.depth) {
      return true;
    }
  }
  return false;
}

/**
 * Get the water type at a position, considering overlapping ponds.
 * Returns the type of the deepest pond at that position.
 */
export function getWaterTypeAtPosition(
  ponds: WorldPond[],
  x: number,
  y: number,
  z: number
): WaterType | null {
  let deepestPond: WorldPond | null = null;

  for (const pond of ponds) {
    // Check horizontal bounds
    if (x < pond.min_x || x >= pond.min_x + pond.width) continue;
    if (z < pond.min_z || z >= pond.min_z + pond.height) continue;

    // Check vertical bounds
    if (y <= -1 && y >= -pond.depth) {
      if (!deepestPond || pond.depth > deepestPond.depth) {
        deepestPond = pond;
      }
    }
  }

  return deepestPond?.water_type ?? null;
}

/**
 * Get the depth of water at a position (how deep below surface).
 */
export function getWaterDepthAtPosition(
  ponds: WorldPond[],
  x: number,
  z: number
): number {
  let maxDepth = 0;

  for (const pond of ponds) {
    if (x < pond.min_x || x >= pond.min_x + pond.width) continue;
    if (z < pond.min_z || z >= pond.min_z + pond.height) continue;

    if (pond.depth > maxDepth) {
      maxDepth = pond.depth;
    }
  }

  return maxDepth;
}

/**
 * Get the surface Y level at a position (top of water or ground).
 * Ground is at Y = -1, water surfaces are also at Y = -1.
 * Returns -1 for both ground and water surface.
 */
export function getSurfaceYAtPosition(
  ponds: WorldPond[],
  x: number,
  z: number
): number {
  // Surface is always at Y = -1 (ground level)
  // Water fills from surface down, so surface Y doesn't change
  return -1;
}

/**
 * Check if a position is at the water surface (Y = -1 and in a pond).
 */
export function isAtWaterSurface(
  ponds: WorldPond[],
  x: number,
  y: number,
  z: number
): boolean {
  if (y !== -1) return false;

  for (const pond of ponds) {
    if (x < pond.min_x || x >= pond.min_x + pond.width) continue;
    if (z < pond.min_z || z >= pond.min_z + pond.height) continue;
    return true;
  }

  return false;
}

/**
 * Get ponds that overlap with a bounding box.
 */
export function getPondsInBounds(
  ponds: WorldPond[],
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number
): WorldPond[] {
  return ponds.filter(pond => {
    const pondMaxX = pond.min_x + pond.width;
    const pondMaxZ = pond.min_z + pond.height;

    return !(pondMaxX <= minX || pond.min_x >= maxX ||
             pondMaxZ <= minZ || pond.min_z >= maxZ);
  });
}
