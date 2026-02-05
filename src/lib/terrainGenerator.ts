import { CHUNK_SIZE } from '@/lib/chunkManager';

export const TERRAIN_CONFIG = {
  SURFACE_Y: -1,  // Ground block top is at y=0 (block centered at y=-0.5)

  // LAND: Where procedural ground (grass) renders
  // 100×100 chunks = 1600×1600 blocks (-800 to 799)
  // 50 chunks in each direction from center
  LAND_HALF_SIZE: 800,

  // WORLD: Maximum extent where blocks can be placed
  // Players can build bridges/extensions beyond the land into this area
  // 1000 chunks = 16000 blocks in each direction from center
  // Total potential world: 2000×2000 chunks = 32000×32000 blocks
  MAX_WORLD_HALF_SIZE: 16000,

  // Legacy alias (deprecated - use LAND_HALF_SIZE)
  WORLD_HALF_SIZE: 800,
} as const;

/**
 * Check if a world coordinate is within the LAND bounds (where ground renders)
 * Valid range: -800 to 799 (100 full chunks, 50 each direction from center)
 */
export function isInLandBounds(x: number, z: number): boolean {
  const { LAND_HALF_SIZE } = TERRAIN_CONFIG;
  return x >= -LAND_HALF_SIZE && x < LAND_HALF_SIZE &&
         z >= -LAND_HALF_SIZE && z < LAND_HALF_SIZE;
}

/**
 * Check if a world coordinate is within the maximum WORLD bounds (where blocks can exist)
 * Valid range: -16000 to 15999
 */
export function isInWorldBounds(x: number, z: number): boolean {
  const { MAX_WORLD_HALF_SIZE } = TERRAIN_CONFIG;
  return x >= -MAX_WORLD_HALF_SIZE && x < MAX_WORLD_HALF_SIZE &&
         z >= -MAX_WORLD_HALF_SIZE && z < MAX_WORLD_HALF_SIZE;
}

/**
 * Check if a chunk has any part within LAND bounds (where ground renders)
 * Valid chunks: -50 to 49 in each axis (100 total)
 */
export function isChunkInLandBounds(chunkX: number, chunkZ: number): boolean {
  const { LAND_HALF_SIZE } = TERRAIN_CONFIG;
  const chunkMinX = chunkX * CHUNK_SIZE;
  const chunkMaxX = chunkMinX + CHUNK_SIZE - 1;
  const chunkMinZ = chunkZ * CHUNK_SIZE;
  const chunkMaxZ = chunkMinZ + CHUNK_SIZE - 1;

  return !(chunkMaxX < -LAND_HALF_SIZE || chunkMinX >= LAND_HALF_SIZE ||
           chunkMaxZ < -LAND_HALF_SIZE || chunkMinZ >= LAND_HALF_SIZE);
}

/**
 * Check if a chunk is within maximum WORLD bounds
 * Valid chunks: -1000 to 999 in each axis
 */
export function isChunkInBounds(chunkX: number, chunkZ: number): boolean {
  const { MAX_WORLD_HALF_SIZE } = TERRAIN_CONFIG;
  const chunkMinX = chunkX * CHUNK_SIZE;
  const chunkMinZ = chunkZ * CHUNK_SIZE;

  return chunkMinX >= -MAX_WORLD_HALF_SIZE && chunkMinX < MAX_WORLD_HALF_SIZE &&
         chunkMinZ >= -MAX_WORLD_HALF_SIZE && chunkMinZ < MAX_WORLD_HALF_SIZE;
}
