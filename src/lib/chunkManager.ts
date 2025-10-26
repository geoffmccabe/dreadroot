import { PlacedBlock } from '@/types/blocks';

// Minecraft-style chunk size: 16x16 blocks
export const CHUNK_SIZE = 16;

/**
 * Convert world coordinates to chunk coordinates
 * @param x World X position
 * @param z World Z position
 * @returns Chunk key in format "chunk_X_Z"
 */
export function getChunkKey(x: number, z: number): string {
  const chunkX = Math.floor(x / CHUNK_SIZE);
  const chunkZ = Math.floor(z / CHUNK_SIZE);
  return `chunk_${chunkX}_${chunkZ}`;
}

/**
 * Get chunk key from a block's position
 * @param block Block with position_x and position_z
 * @returns Chunk key
 */
export function blockToChunkKey(block: PlacedBlock): string {
  return getChunkKey(block.position_x, block.position_z);
}

/**
 * Organize blocks into chunks for efficient rendering
 * @param blocks Array of placed blocks
 * @returns Map of chunk keys to arrays of blocks
 */
export function organizeBlocksByChunk(blocks: PlacedBlock[]): Map<string, PlacedBlock[]> {
  const chunkMap = new Map<string, PlacedBlock[]>();
  
  for (const block of blocks) {
    const chunkKey = blockToChunkKey(block);
    const existingBlocks = chunkMap.get(chunkKey) || [];
    existingBlocks.push(block);
    chunkMap.set(chunkKey, existingBlocks);
  }
  
  console.log(`📦 Organized ${blocks.length} blocks into ${chunkMap.size} chunks`);
  
  // Log chunk distribution
  const distribution = Array.from(chunkMap.entries())
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 5)
    .map(([key, blocks]) => `${key}: ${blocks.length} blocks`)
    .join(', ');
  console.log(`📊 Top chunks: ${distribution}`);
  
  return chunkMap;
}

/**
 * Get all chunk keys within render distance of camera
 * @param cameraX Camera world X position
 * @param cameraZ Camera world Z position
 * @param renderDistance Number of chunks to render in each direction
 * @returns Array of chunk keys within render distance
 */
export function getVisibleChunkKeys(cameraX: number, cameraZ: number, renderDistance: number): string[] {
  const cameraChunkX = Math.floor(cameraX / CHUNK_SIZE);
  const cameraChunkZ = Math.floor(cameraZ / CHUNK_SIZE);
  
  const visibleChunks: string[] = [];
  
  // Generate chunk keys in a square around the camera
  for (let dx = -renderDistance; dx <= renderDistance; dx++) {
    for (let dz = -renderDistance; dz <= renderDistance; dz++) {
      const chunkX = cameraChunkX + dx;
      const chunkZ = cameraChunkZ + dz;
      visibleChunks.push(`chunk_${chunkX}_${chunkZ}`);
    }
  }
  
  return visibleChunks;
}

/**
 * Parse chunk key to get chunk coordinates
 * @param chunkKey Chunk key in format "chunk_X_Z"
 * @returns Object with chunkX and chunkZ
 */
export function parseChunkKey(chunkKey: string): { chunkX: number; chunkZ: number } | null {
  const match = chunkKey.match(/^chunk_(-?\d+)_(-?\d+)$/);
  if (!match) return null;
  return {
    chunkX: parseInt(match[1], 10),
    chunkZ: parseInt(match[2], 10)
  };
}
