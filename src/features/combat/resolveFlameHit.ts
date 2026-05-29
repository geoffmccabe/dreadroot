// Pure: cone-hit test for the flamethrower. Given a cone (origin,
// forward direction, max distance, half-angle) and a sample point on
// the enemy, return whether the sample lies inside the cone.
//
// The flame tick TIMING (every 100ms) and the per-tier damage scaling
// (10 × tier per second) stay in the caller — they're game-loop
// concerns. This file is only the geometry.
//
// No THREE objects in the signature. Same function will run on the
// L2 DO to authoritatively validate "yes this enemy was in your
// cone" before applying damage.

export interface FlameCone {
  originX: number;
  originY: number;
  originZ: number;
  /** Forward direction, unit length. */
  dirX: number;
  dirY: number;
  dirZ: number;
  /** Max distance the flame reaches (m). */
  maxDistance: number;
  /** Cone half-angle in radians. Default is PI/9 (~20°) to match
   *  the visual flame spread in FortressScene.tsx. */
  halfAngle: number;
}

export function isPointInFlameCone(
  cone: FlameCone,
  px: number, py: number, pz: number,
): boolean {
  const dx = px - cone.originX;
  const dy = py - cone.originY;
  const dz = pz - cone.originZ;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (dist > cone.maxDistance || dist < 0.5) return false;
  const inv = 1 / dist;
  const nx = dx * inv, ny = dy * inv, nz = dz * inv;
  const dot = Math.min(1, cone.dirX * nx + cone.dirY * ny + cone.dirZ * nz);
  const angle = Math.acos(dot);
  return angle <= cone.halfAngle;
}

/** Cone half-angle the legacy code uses (~20°). */
export const FLAME_HALF_ANGLE = Math.PI / 9;

/** Damage-per-second per tier. T1 = 10 dps, T10 = 100 dps. */
export function flameDpsForTier(tier: number): number {
  return 10 * tier;
}

/** Burn duration in seconds, tier-scaled. T1 = 5s, T10 = 14s. */
export function flameBurnSecondsForTier(tier: number): number {
  return 5 + (tier - 1);
}
