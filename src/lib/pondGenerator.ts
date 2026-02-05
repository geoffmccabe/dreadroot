/**
 * Pond Generator
 *
 * Generates water and lava ponds for a world using per-block chance algorithm.
 * Ponds are rectangular with random dimensions within configured min/max ranges.
 * Ponds can overlap for natural-looking terrain.
 */

import { supabase } from '@/integrations/supabase/client';

// ============================================
// Types
// ============================================

export type WaterType = 'water' | 'lava';

export interface PondSettings {
  chance: number;        // 0-1 probability per block
  minWidth: number;
  maxWidth: number;
  minHeight: number;
  maxHeight: number;
  minDepth: number;
  maxDepth: number;
}

export interface WorldPondSettings {
  water: PondSettings;
  lava: PondSettings;
  seed: number;
}

export interface WorldPond {
  id: string;
  world_id: string;
  min_x: number;
  min_z: number;
  width: number;
  height: number;
  depth: number;
  water_type: WaterType;
}

// ============================================
// Seeded RNG (deterministic)
// ============================================

class SeededRNG {
  private seed: number;

  constructor(seed: number) {
    this.seed = seed;
  }

  // Returns 0-1 (similar to Math.random())
  next(): number {
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
    return this.seed / 0x7fffffff;
  }

  // Returns integer in [min, max] inclusive
  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }
}

// ============================================
// Pond Generation
// ============================================

import { TERRAIN_CONFIG } from './terrainGenerator';

// Ponds only generate within the land area (not the extended buildable world)
const LAND_MIN = -TERRAIN_CONFIG.LAND_HALF_SIZE;  // -800
const LAND_MAX = TERRAIN_CONFIG.LAND_HALF_SIZE;   // 800 (exclusive, so -800 to 799)

/**
 * Generate pond definitions for a world.
 * Uses per-block chance algorithm - each block position has a % chance
 * to become the bottom-left corner of a new pond.
 */
export function generatePondDefinitions(settings: WorldPondSettings): Omit<WorldPond, 'id' | 'world_id'>[] {
  const rng = new SeededRNG(settings.seed);
  const ponds: Omit<WorldPond, 'id' | 'world_id'>[] = [];

  // Only generate if there's a chance for at least one type
  if (settings.water.chance <= 0 && settings.lava.chance <= 0) {
    return ponds;
  }

  // Iterate through land bounds (ponds only on natural terrain)
  for (let x = LAND_MIN; x < LAND_MAX; x++) {
    for (let z = LAND_MIN; z < LAND_MAX; z++) {
      // Check water pond spawn
      if (settings.water.chance > 0 && rng.next() < settings.water.chance) {
        const width = rng.nextInt(settings.water.minWidth, settings.water.maxWidth);
        const height = rng.nextInt(settings.water.minHeight, settings.water.maxHeight);
        const depth = rng.nextInt(settings.water.minDepth, settings.water.maxDepth);

        ponds.push({
          min_x: x,
          min_z: z,
          width,
          height,
          depth,
          water_type: 'water',
        });
      }

      // Check lava pond spawn (independent roll)
      if (settings.lava.chance > 0 && rng.next() < settings.lava.chance) {
        const width = rng.nextInt(settings.lava.minWidth, settings.lava.maxWidth);
        const height = rng.nextInt(settings.lava.minHeight, settings.lava.maxHeight);
        const depth = rng.nextInt(settings.lava.minDepth, settings.lava.maxDepth);

        ponds.push({
          min_x: x,
          min_z: z,
          width,
          height,
          depth,
          water_type: 'lava',
        });
      }
    }
  }

  console.log(`[PondGenerator] Generated ${ponds.length} ponds (water: ${ponds.filter(p => p.water_type === 'water').length}, lava: ${ponds.filter(p => p.water_type === 'lava').length})`);
  return ponds;
}

/**
 * Generate and save ponds for a newly created world.
 */
export async function generatePondsForWorld(
  worldId: string,
  settings: WorldPondSettings
): Promise<WorldPond[]> {
  const pondDefinitions = generatePondDefinitions(settings);

  if (pondDefinitions.length === 0) {
    console.log(`[PondGenerator] No ponds to generate for world ${worldId}`);
    return [];
  }

  // Batch insert ponds
  const pondsWithWorldId = pondDefinitions.map(pond => ({
    ...pond,
    world_id: worldId,
  }));

  // Insert in batches of 1000 to avoid hitting limits
  const BATCH_SIZE = 1000;
  const allPonds: WorldPond[] = [];

  for (let i = 0; i < pondsWithWorldId.length; i += BATCH_SIZE) {
    const batch = pondsWithWorldId.slice(i, i + BATCH_SIZE);

    const { data, error } = await (supabase
      .from('world_ponds' as any)
      .insert(batch as any)
      .select() as any);

    if (error) {
      console.error(`[PondGenerator] Failed to insert ponds batch ${i / BATCH_SIZE}:`, error);
      throw error;
    }

    allPonds.push(...(data || []));
  }

  console.log(`[PondGenerator] Saved ${allPonds.length} ponds for world ${worldId}`);
  return allPonds;
}

// ============================================
// Pond Queries
// ============================================

/**
 * Fetch all ponds for a world.
 */
export async function fetchWorldPonds(worldId: string): Promise<WorldPond[]> {
  const { data, error } = await (supabase
    .from('world_ponds' as any)
    .select('*')
    .eq('world_id', worldId) as any);

  if (error) {
    console.error(`[PondGenerator] Failed to fetch ponds:`, error);
    return [];
  }

  return data || [];
}

/**
 * Fetch ponds that overlap with a specific chunk.
 */
export async function fetchPondsInChunk(
  worldId: string,
  chunkX: number,
  chunkZ: number,
  chunkSize: number = 16
): Promise<WorldPond[]> {
  const chunkMinX = chunkX * chunkSize;
  const chunkMaxX = chunkMinX + chunkSize;
  const chunkMinZ = chunkZ * chunkSize;
  const chunkMaxZ = chunkMinZ + chunkSize;

  // Query ponds where the pond's bounding box overlaps with the chunk
  // Pond extends from (min_x, min_z) to (min_x + width, min_z + height)
  const { data, error } = await (supabase
    .from('world_ponds' as any)
    .select('*')
    .eq('world_id', worldId) as any);

  if (error) {
    console.error(`[PondGenerator] Failed to fetch ponds for chunk:`, error);
    return [];
  }

  // Filter to ponds overlapping chunk (Supabase doesn't support computed column filters)
  return (data || []).filter((pond: WorldPond) => {
    const pondMaxX = pond.min_x + pond.width;
    const pondMaxZ = pond.min_z + pond.height;

    // Check for overlap
    return !(pondMaxX < chunkMinX || pond.min_x >= chunkMaxX ||
             pondMaxZ < chunkMinZ || pond.min_z >= chunkMaxZ);
  });
}

// ============================================
// Position Checks
// ============================================

/**
 * Check if a position (x, z) is inside any pond.
 */
export function isPondPosition(ponds: WorldPond[], x: number, z: number): boolean {
  for (const pond of ponds) {
    if (x >= pond.min_x && x < pond.min_x + pond.width &&
        z >= pond.min_z && z < pond.min_z + pond.height) {
      return true;
    }
  }
  return false;
}

/**
 * Get the pond at a specific position, or null if none.
 */
export function getPondAtPosition(ponds: WorldPond[], x: number, z: number): WorldPond | null {
  for (const pond of ponds) {
    if (x >= pond.min_x && x < pond.min_x + pond.width &&
        z >= pond.min_z && z < pond.min_z + pond.height) {
      return pond;
    }
  }
  return null;
}

/**
 * Get all ponds overlapping a rectangular area.
 */
export function getPondsInArea(
  ponds: WorldPond[],
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number
): WorldPond[] {
  return ponds.filter(pond => {
    const pondMaxX = pond.min_x + pond.width;
    const pondMaxZ = pond.min_z + pond.height;

    return !(pondMaxX < minX || pond.min_x >= maxX ||
             pondMaxZ < minZ || pond.min_z >= maxZ);
  });
}

/**
 * Get the deepest pond at a position (for overlapping ponds).
 */
export function getDeepestPondAtPosition(ponds: WorldPond[], x: number, z: number): WorldPond | null {
  let deepest: WorldPond | null = null;

  for (const pond of ponds) {
    if (x >= pond.min_x && x < pond.min_x + pond.width &&
        z >= pond.min_z && z < pond.min_z + pond.height) {
      if (!deepest || pond.depth > deepest.depth) {
        deepest = pond;
      }
    }
  }

  return deepest;
}

/**
 * Check if a position is in water (any pond) at a specific Y level.
 */
export function isInWater(ponds: WorldPond[], x: number, y: number, z: number): boolean {
  for (const pond of ponds) {
    if (x >= pond.min_x && x < pond.min_x + pond.width &&
        z >= pond.min_z && z < pond.min_z + pond.height) {
      // Water goes from Y=-1 down to Y=-depth
      if (y <= -1 && y >= -pond.depth) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Get water type at a position, or null if not in water.
 */
export function getWaterTypeAt(ponds: WorldPond[], x: number, y: number, z: number): WaterType | null {
  for (const pond of ponds) {
    if (x >= pond.min_x && x < pond.min_x + pond.width &&
        z >= pond.min_z && z < pond.min_z + pond.height) {
      if (y <= -1 && y >= -pond.depth) {
        return pond.water_type;
      }
    }
  }
  return null;
}
