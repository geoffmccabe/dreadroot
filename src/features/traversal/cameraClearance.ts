/**
 * How far the third-person camera can actually pull back before it is inside
 * something.
 *
 * Siege Worlds never needed this: its world is open terrain, so the camera can
 * always slide back. DreadRoot is dense blocks, and pulling straight back puts
 * the camera inside a tree — where the player sees the inside of a block and
 * concludes third person is broken, rather than that the camera is in a wall.
 *
 * Walks backwards in small steps and returns the last clear distance. Stepping
 * rather than one long ray because a voxel world's occupancy lookup is cheap
 * and a stepped walk cannot tunnel through a one-block-thick wall the way a
 * single sample at the end point can.
 */
import * as THREE from 'three';

/** Keep this much air between the camera and whatever it stopped at, or the
 *  near plane clips into the surface it is resting against. */
const SKIN = 0.25;
const STEP = 0.2;

interface Grid {
  getNearbyFiltered(x: number, z: number, radius: number, minY: number, maxY: number): number;
  nearbyResult: THREE.Box3[];
}

function occupied(grid: Grid, x: number, y: number, z: number): boolean {
  const n = grid.getNearbyFiltered(x, z, 1.0, y, y + 0.01);
  if (n === 0) return false;
  for (let i = 0; i < n; i++) {
    const b = grid.nearbyResult[i];
    if (x >= b.min.x && x <= b.max.x &&
        y >= b.min.y && y <= b.max.y &&
        z >= b.min.z && z <= b.max.z) return true;
  }
  return false;
}

/**
 * @param eye     the true player eye.
 * @param forward the look direction; the camera moves along its NEGATIVE.
 * @param wanted  the distance the player asked for.
 * @returns how far it may actually go, never more than `wanted`.
 */
export function clearBehind(
  eye: THREE.Vector3, forward: THREE.Vector3, wanted: number, grid: Grid,
): number {
  let last = 0;
  for (let d = STEP; d <= wanted; d += STEP) {
    // Match the pull-back's own rise, or the check tests a different point
    // from the one the camera lands on.
    const x = eye.x - forward.x * d;
    const y = eye.y - forward.y * d + 0.45 * d;
    const z = eye.z - forward.z * d;
    if (occupied(grid, x, y, z)) return Math.max(0, last - SKIN);
    last = d;
  }
  return wanted;
}
