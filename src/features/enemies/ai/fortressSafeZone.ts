/**
 * Fortress Safe Zone (FSZ) - Pure utility module for fortress boundary checks.
 *
 * The FSZ includes:
 * - Fortress interior: X = -20..20, Z = -38..-8
 * - Front safe area: X = -20..20, Z = -8..+8 (16 blocks forward, full width)
 *
 * Zero allocations in hot path - uses module-level reusable return object.
 */

import { cliffW, frontZ, courtyardDepth } from '@/components/fortress/FortressCollision';

// FSZ bounds derived from fortress geometry
const FSZ_MIN_X = -(cliffW / 2);
const FSZ_MAX_X = cliffW / 2;
const FSZ_MIN_Z = frontZ - courtyardDepth;
const FSZ_MAX_Z = -frontZ;  // 16 blocks forward from front wall

// Reusable return object for clampPositionOutsideFSZ (zero allocation)
const _clampResult = { x: 0, z: 0 };

/**
 * Check if a point is inside the Fortress Safe Zone.
 * Enemies cannot enter this zone; players inside are invisible to enemies;
 * weapons cannot be fired from inside this zone.
 */
export function isPointInFSZ(x: number, _y: number, z: number): boolean {
  return x >= FSZ_MIN_X && x <= FSZ_MAX_X &&
         z >= FSZ_MIN_Z && z <= FSZ_MAX_Z;
}

/**
 * Push a position to the nearest FSZ boundary edge if it is inside the zone.
 * Returns a reusable object (do NOT store the reference across frames).
 */
export function clampPositionOutsideFSZ(x: number, z: number): { x: number; z: number } {
  _clampResult.x = x;
  _clampResult.z = z;

  // Not inside FSZ — return as-is
  if (x < FSZ_MIN_X || x > FSZ_MAX_X || z < FSZ_MIN_Z || z > FSZ_MAX_Z) {
    return _clampResult;
  }

  // Inside FSZ — find nearest edge and push out
  const distToLeft = x - FSZ_MIN_X;
  const distToRight = FSZ_MAX_X - x;
  const distToBack = z - FSZ_MIN_Z;
  const distToFront = FSZ_MAX_Z - z;

  const minDist = Math.min(distToLeft, distToRight, distToBack, distToFront);

  if (minDist === distToLeft) {
    _clampResult.x = FSZ_MIN_X - 0.1;
  } else if (minDist === distToRight) {
    _clampResult.x = FSZ_MAX_X + 0.1;
  } else if (minDist === distToBack) {
    _clampResult.z = FSZ_MIN_Z - 0.1;
  } else {
    _clampResult.z = FSZ_MAX_Z + 0.1;
  }

  return _clampResult;
}
