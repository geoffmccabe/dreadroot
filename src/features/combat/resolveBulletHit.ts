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

  // Knockback = horizontal component of bullet direction, unit-length.
  // Vertical kick is reserved for blasts.
  const hMag = Math.hypot(input.bulletDirX, input.bulletDirZ);
  const kbX = hMag > 0 ? input.bulletDirX / hMag : 0;
  const kbZ = hMag > 0 ? input.bulletDirZ / hMag : 0;

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
