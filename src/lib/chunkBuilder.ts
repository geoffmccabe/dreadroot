// Pure chunk → collision-grid builder (Track 3, phase 3B).
//
// NO React, NO Three.js, NO Supabase — so the future Cloudflare Durable
// Object (and Node test harness, 3F) can import this directly to answer
// `hasVoxel(x,y,z)` for bullet/grenade/enemy collision, exactly like the
// client's worldCollisionGrid does, from the same packed-coord encoding.
//
// This is the build/query core only. Fetching blocks (which needs a
// Supabase client) is intentionally kept out so this stays environment-
// agnostic; a caller passes already-fetched blocks in.

import type { PlacedBlock } from '@/types/blocks';
import type { VoxelCollider } from '@/features/combat/grenadePhysics';
import { numPosKey } from './voxelKey';

/** A voxel collision grid that satisfies VoxelCollider.hasVoxel and can be
 *  mutated as the world changes. Backed by a Set of packed coords. */
export interface MutableVoxelGrid extends VoxelCollider {
  addVoxel(x: number, y: number, z: number): void;
  removeVoxel(x: number, y: number, z: number): void;
  /** Number of solid voxels (for diagnostics/tests). */
  readonly size: number;
}

/** Create an empty grid. */
export function createVoxelGrid(): MutableVoxelGrid {
  const solid = new Set<number>();
  return {
    hasVoxel: (x, y, z) => solid.has(numPosKey(x, y, z)),
    addVoxel: (x, y, z) => { solid.add(numPosKey(x, y, z)); },
    removeVoxel: (x, y, z) => { solid.delete(numPosKey(x, y, z)); },
    get size() { return solid.size; },
  };
}

/** Build a collision grid from a set of blocks. Every block is one solid
 *  1×1×1 voxel (matches the client's ensureBlockCollider — all blocks
 *  collide; surface culling only affects rendering, not collision). */
export function buildVoxelGrid(blocks: ReadonlyArray<PlacedBlock>): MutableVoxelGrid {
  const grid = createVoxelGrid();
  for (const b of blocks) {
    grid.addVoxel(b.position_x, b.position_y, b.position_z);
  }
  return grid;
}

/** Apply an incremental world delta to an existing grid. Removals first,
 *  then additions (so a same-cell remove+add nets to present). */
export function applyDeltaToGrid(
  grid: MutableVoxelGrid,
  added: ReadonlyArray<PlacedBlock>,
  removed: ReadonlyArray<PlacedBlock>,
): void {
  for (const b of removed) {
    grid.removeVoxel(b.position_x, b.position_y, b.position_z);
  }
  for (const b of added) {
    grid.addVoxel(b.position_x, b.position_y, b.position_z);
  }
}
