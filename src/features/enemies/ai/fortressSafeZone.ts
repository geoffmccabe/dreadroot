/**
 * Fortress Safe Zone (FSZ) - Pure utility module for fortress boundary checks.
 *
 * The FSZ is a 4x6 chunk area (64x96 blocks) containing:
 * - Fortress interior
 * - Courtyard area in front
 *
 * Within this zone:
 * - Players cannot fire weapons
 * - Enemies cannot enter
 * - Players inside are invisible to enemies
 *
 * Zero allocations in hot path - uses module-level reusable return object.
 */

// FSZ bounds: 4 chunks wide (64 blocks) x 6 chunks deep (96 blocks)
// Centered on X=0, extending from back of fortress to courtyard in front
export const FSZ_MIN_X = -32;  // 4 chunks wide centered on 0
export const FSZ_MAX_X = 32;
export const FSZ_MIN_Z = -64;  // Back of fortress area
export const FSZ_MAX_Z = 32;   // Courtyard extends in front

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
