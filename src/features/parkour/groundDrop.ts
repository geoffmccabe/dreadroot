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
import { WORLD_FLOOR_Y } from './worldFloor';

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
  // Nothing in the grid — but the grid does not contain the world's own ground
  // plane, and over open terrain that is exactly what is underneath. Without
  // this the answer over ordinary ground is always "further than I looked", and
  // a one-block hop plays the free-fall pose.
  //
  // `>= 0`, NOT `> 0`. Standing on flat ground puts the feet exactly ON the
  // floor, so toFloor is 0 — and with a strict `> 0` that fell through to
  // "further than I looked", i.e. a four-metre drop. The instant a jump made
  // the body airborne while the published feet were still at floor level, the
  // animation picked a full free-fall pose and flashed it for a frame or two.
  // Geoff saw exactly that: "a falling pose for a tiny fraction of a second".
  const toFloor = footY - WORLD_FLOOR_Y;
  if (toFloor >= 0 && toFloor <= maxLook) return toFloor;
  // Below the floor should not happen, but if it does the ground is not
  // somewhere far below — it is right here.
  return toFloor < 0 ? 0 : maxLook;
}
