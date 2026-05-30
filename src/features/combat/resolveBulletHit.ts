// Pure: given the geometry of a bullet hit on an enemy hitbox,
// compute damage, headshot, and unit-length knockback direction.
//
// No THREE objects in the signature — just numbers in, numbers out.
// Same function runs client-side (for prediction / VFX) and on the
// L2 Durable Object (for authoritative resolution).

export interface BulletHitInput {
  /** Where on the enemy the bullet landed (world coords). */
  hitX: number;
  hitY: number;
  hitZ: number;
  /** Vertical extent of the enemy's cylinder hitbox. */
  hitboxBottomY: number;
  hitboxTopY: number;
  /** Fraction of total hitbox height (0–1) that counts as head zone.
   *  0.25 = top quarter is head (legacy shombie rule). */
  headFrac: number;
  /** Direction the bullet was traveling. Doesn't need to be unit;
   *  we normalize the horizontal component for knockback. */
  bulletDirX: number;
  bulletDirY: number;
  bulletDirZ: number;
  /** Current bullet speed and the tier's max speed. The damage scales
   *  by (current / max) so a bullet near end-of-life hits softer. */
  bulletSpeed: number;
  tierMaxSpeed: number;
  /** Base bullet damage before velocity scaling. Currently 25 in
   *  useFortressFrameLoop.ts. */
  baseDamage: number;
}

export interface BulletHitResult {
  damage: number;
  isHeadshot: boolean;
  /** Unit-length horizontal knockback direction. Y always 0 for
   *  bullets (blasts handle vertical kick, not bullets). */
  knockbackDirX: number;
  knockbackDirY: number;
  knockbackDirZ: number;
}

export function resolveBulletHit(input: BulletHitInput): BulletHitResult {
  // Headshot: hit point in the top `headFrac` of the hitbox height.
  const span = input.hitboxTopY - input.hitboxBottomY;
  const localY = input.hitY - input.hitboxBottomY;
  const isHeadshot = span > 0 && localY > span * (1 - input.headFrac);

  // Damage with velocity ratio. Headshot doubles.
  const velocityRatio = input.bulletSpeed / Math.max(1, input.tierMaxSpeed);
  const scaled = Math.round(input.baseDamage * velocityRatio);
  const damage = isHeadshot ? scaled * 2 : scaled;

  // Knockback = the X/Z components of the FULL-3D unit-length bullet
  // direction. Matches legacy behavior: a 45° upward shot imparts
  // ~0.71 horizontal kb, not the 1.0 a horizontal-only normalize
  // would give. Vertical kick is reserved for blasts, so Y stays 0.
  const mag3 = Math.hypot(input.bulletDirX, input.bulletDirY, input.bulletDirZ);
  const inv = mag3 > 0 ? 1 / mag3 : 0;
  const kbX = input.bulletDirX * inv;
  const kbZ = input.bulletDirZ * inv;

  return {
    damage,
    isHeadshot,
    knockbackDirX: kbX,
    knockbackDirY: 0,
    knockbackDirZ: kbZ,
  };
}

/** Convenience constant — the BASE_BULLET_DAMAGE value used in
 *  useFortressFrameLoop.ts. Pulled out so callers reference one place. */
export const BASE_BULLET_DAMAGE = 25;
