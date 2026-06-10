/**
 * voxelPathGrid — bridges the abstract PathGrid to the real world-collision grid.
 * A cell (x,z) counts as BLOCKED when a solid block sits in the creature's body
 * band there — i.e. ABOVE a single-block step (so steppable terrain stays
 * walkable) and up to roughly its head (so walls block it).
 *
 * One shared instance, mutated per creature via setBand() to avoid per-tick
 * allocation. Safe because the AI ticks one creature at a time (the band is set
 * and used synchronously within a single creature's chase tick).
 */
import { worldCollisionGrid } from '@/lib/spatialHashGrid';
import type { PathGrid } from './planners';

class VoxelPathGrid implements PathGrid {
  private bandMin = 0;
  private bandMax = 0;

  /** Configure the body band for the creature about to pathfind. */
  setBand(footY: number, bodyHeight: number): void {
    this.bandMin = footY + 1.1;                        // just above a 1-block step
    this.bandMax = footY + Math.max(bodyHeight, 1.3);  // up to its head
  }

  isBlocked(cellX: number, cellZ: number): boolean {
    const count = worldCollisionGrid.getNearby(cellX + 0.5, cellZ + 0.5, 1);
    const res = worldCollisionGrid.nearbyResult;
    for (let i = 0; i < count; i++) {
      const b = res[i];
      if (!b || !b.max) continue;
      // Does this block overlap the cell column AND the body band?
      if (
        b.max.x > cellX && b.min.x < cellX + 1 &&
        b.max.z > cellZ && b.min.z < cellZ + 1 &&
        b.max.y > this.bandMin && b.min.y < this.bandMax
      ) {
        return true;
      }
    }
    return false;
  }
}

export const voxelPathGrid = new VoxelPathGrid();
