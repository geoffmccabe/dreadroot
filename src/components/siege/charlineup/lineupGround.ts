/**
 * Where the lineup's feet go.
 *
 * The lineup was written for Siege Worlds, where `sampleHeight` reads a
 * heightfield and always has an answer. DreadRoot has no heightfield — it is a
 * voxel world — so that sampler returns null and the old code fell back to the
 * CAMERA's Y. Standing on the ground that is only eye-height wrong; flying in
 * god mode it put the whole row up in the sky, which is exactly what happened.
 *
 * So: ask the heightfield first (Siege), and when it has nothing, walk DOWN the
 * voxel column from the start height until we hit a solid cube and stand on top
 * of it. That reads the same collision grid the player's own movement uses, so
 * the characters stand on precisely the surface the player would.
 */
import { worldCollisionGrid } from '@/lib/spatialHashGrid';
import { sampleHeight } from '../terrainHeight';

/** How far down to look before giving up. Deeper than any tree/fortress drop. */
const MAX_SCAN = 256;

/** True if the cube containing this point is solid, per the movement grid. */
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

/**
 * Ground height at (x, z), searching downward from `startY`.
 * Falls back to `startY - 1.7` (roughly the player's feet) if nothing is found,
 * so an unloaded chunk still puts the row somewhere sane rather than in orbit.
 */
export function lineupGroundY(x: number, z: number, startY: number): number {
  const h = sampleHeight(x, z);
  if (h !== null && h !== undefined) return h;
  // Sample cube CENTRES — a point exactly on a boundary belongs to both
  // neighbours and reads inconsistently.
  for (let d = 0; d <= MAX_SCAN; d += 1) {
    const y = Math.floor(startY - d) + 0.5;
    if (solidAt(x, y, z)) return Math.floor(y) + 1;
  }
  return startY - 1.7;
}
