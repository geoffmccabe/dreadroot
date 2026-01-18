import { CHUNK_SIZE } from '@/lib/chunkManager';

export const TERRAIN_CONFIG = {
  SURFACE_Y: 0,
  WORLD_HALF_SIZE: 640,  // World extends from -640 to +640 (1280 total)
} as const;

/**
 * Check if a world coordinate is within the terrain bounds
 */
export function isInWorldBounds(x: number, z: number): boolean {
  const { WORLD_HALF_SIZE } = TERRAIN_CONFIG;
  return Math.abs(x) <= WORLD_HALF_SIZE && Math.abs(z) <= WORLD_HALF_SIZE;
}

/**
 * Check if a chunk is within world bounds (any part of it)
 */
export function isChunkInBounds(chunkX: number, chunkZ: number): boolean {
  const { WORLD_HALF_SIZE } = TERRAIN_CONFIG;
  const chunkMinX = chunkX * CHUNK_SIZE;
  const chunkMaxX = chunkMinX + CHUNK_SIZE - 1;
  const chunkMinZ = chunkZ * CHUNK_SIZE;
  const chunkMaxZ = chunkMinZ + CHUNK_SIZE - 1;
  
  return !(chunkMaxX < -WORLD_HALF_SIZE || chunkMinX > WORLD_HALF_SIZE ||
           chunkMaxZ < -WORLD_HALF_SIZE || chunkMinZ > WORLD_HALF_SIZE);
}
