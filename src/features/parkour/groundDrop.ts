/**
 * How far is it DOWN from here?
 *
 * The falling animation was playing on every hop — step off a single block, or
 * jump up onto one, and the character spent the descent in a full free-fall
 * pose. It reads as panic over a 30cm drop.
 *
 * The fix needs one number the movement code never had: the distance from the
 * feet to whatever is underneath. Vertical speed cannot stand in for it —
 * hopping off a kerb and falling off a tower look identical for the first
 * fraction of a second, because gravity does not know how far there is to go.
 *
 * Lives here rather than in the animation code because it reads the collision
 * grid exactly the way the parkour scanner does, and two different opinions
 * about what counts as solid ground is how a character ends up in an animation
 * that disagrees with the physics.
 */
import { worldCollisionGrid } from '@/lib/spatialHashGrid';

/** Sampling finer than this cannot reveal anything in a world of 1m cubes. */
const STEP = 0.25;

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
 * Distance from the feet to the first solid surface below, in metres.
 *
 * @param maxLook stop looking past this — a long drop and a bottomless one are
 *                the same answer as far as the animation is concerned, and
 *                scanning to the world floor every frame is wasted work.
 * @returns the drop, or `maxLook` when nothing was found within it.
 */
export function dropToGround(x: number, footY: number, z: number, maxLook = 4): number {
  for (let d = STEP; d <= maxLook; d += STEP) {
    if (solidAt(x, footY - d, z)) return d;
  }
  return maxLook;
}
