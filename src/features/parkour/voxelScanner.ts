/**
 * The voxel answer to "what is in front of me".
 *
 * In a block world this is not a physics question. Everything is a
 * one-metre cube on a lattice, so the whole probe is: walk forward a step at a
 * time, and at each step read the column — how high is the stack, and how much
 * clear space sits above it. No raycasts, no surface normals, no tolerance for
 * sloped or rotated ledges, because none of those exist here.
 *
 * It reads the SAME collision grid the player's own movement uses. That matters
 * more than the small speed win: a probe with its own idea of what is solid
 * would eventually let you climb onto something you then fall through, and that
 * class of bug is miserable to chase. One source of truth for "solid".
 *
 * The mesh version for Siege Worlds is the hard one and is still to come — see
 * surroundings.ts for why the seam is here.
 */
import { worldCollisionGrid } from '@/lib/spatialHashGrid';
import { UNMEASURED, type Scanner, type Surroundings } from './surroundings';

/** Blocks are 1m. Sampling finer than half a block cannot reveal anything. */
const STEP = 0.5;
/** How far above the sampled foot level to look for a ceiling. */
const CEILING_SCAN = 4;
/** How far below the player to look for far-side ground before giving up. A
 *  vault into an unmeasured drop is how a character ends up in a pit. */
const MAX_DROP = 4;

/** Is the cube containing this point solid? Asked of the movement grid itself. */
function solidAt(x: number, y: number, z: number): boolean {
  const n = worldCollisionGrid.getNearbyFiltered(x, z, 1.0, y, y + 0.01);
  if (n === 0) return false;
  const boxes = worldCollisionGrid.nearbyResult;
  for (let i = 0; i < n; i++) {
    const b = boxes[i];
    if (x >= b.min.x && x <= b.max.x &&
        y >= b.min.y && y <= b.max.y &&
        z >= b.min.z && z <= b.max.z) return true;
  }
  return false;
}

/** Height of the top solid surface in this column, searching up from the feet.
 *  Returns null when the column is clear at every level checked. */
function columnTop(x: number, z: number, footY: number, maxRise: number): number | null {
  // Sample cube CENTRES: a point exactly on a block boundary belongs to both
  // neighbours and reads inconsistently.
  //
  // THE FIRST STANDABLE SURFACE, not the highest block. The previous version
  // kept overwriting as it scanned upward and returned the TOP of the whole
  // stack within reach, so climbing a wall of blocks targeted a point two or
  // three blocks above the ledge you were standing at — the player rose far
  // too high, and the climb took correspondingly too long. A surface only
  // counts if the space directly above it is clear, or the "ledge" is just a
  // block with more wall on top of it.
  for (let h = 0.5; h <= maxRise + 0.5; h += 1) {
    if (!solidAt(x, footY + h, z)) continue;
    const surface = Math.floor(footY + h) + 1;
    if (!solidAt(x, surface + 0.5, z)) return surface;
  }
  return null;
}

export class VoxelScanner implements Scanner {
  readonly kind = 'voxel' as const;

  scan(
    x: number, y: number, z: number,
    fx: number, fz: number,
    reach: number, maxRise: number,
  ): Surroundings | null {
    for (let d = STEP; d <= reach; d += STEP) {
      const px = x + fx * d;
      const pz = z + fz * d;
      const top = columnTop(px, pz, y, maxRise);
      if (top === null) continue;               // clear here, keep looking

      const height = top - y;
      if (height <= 0.01) continue;             // level ground, not an obstacle

      // Headroom above the obstacle's top — what decides climb-onto versus
      // duck-under.
      let headroom = CEILING_SCAN;
      for (let h = 0.5; h <= CEILING_SCAN; h += 1) {
        if (solidAt(px, top + h, pz)) { headroom = h - 0.5; break; }
      }

      // How deep it is along the direction of travel: keep stepping while the
      // top stays at least this high. Bounded, so a wall reports Infinity
      // rather than being walked to the horizon.
      let depth = STEP;
      let far = d + STEP;
      const DEPTH_LIMIT = 3;
      while (depth <= DEPTH_LIMIT) {
        const t = columnTop(x + fx * far, z + fz * far, y, maxRise);
        if (t === null || t - y < height - 0.01) break;
        depth += STEP;
        far += STEP;
      }

      // Ground on the far side, for vaults. Looked up only when the obstacle
      // is thin enough to clear — a wall has no far side worth knowing.
      let farSideY: number | null = null;
      if (depth <= DEPTH_LIMIT) {
        const bx = x + fx * (d + depth + 0.5);
        const bz = z + fz * (d + depth + 0.5);
        // Search DOWN from the obstacle's top for the first solid surface, so a
        // vault onto lower ground lands on the ground rather than in mid-air.
        for (let yy = top; yy >= y - MAX_DROP; yy -= 1) {
          if (solidAt(bx, yy - 0.5, bz)) { farSideY = yy; break; }
        }
      }

      return {
        height,
        headroom,
        depth: depth > DEPTH_LIMIT ? Infinity : depth,
        topY: top,
        distance: d,
        // Standable when a body could actually fit above the surface.
        standable: headroom >= 1.5,
        farSideY,
        ...UNMEASURED,
      };
    }
    return null;
  }
}
