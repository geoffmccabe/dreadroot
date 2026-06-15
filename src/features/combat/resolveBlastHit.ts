// Pure: given a blast center, radius, base damage/knockback, and a
// target hitbox sample point, decide whether the target is in range
// and compute scaled damage + a 0–45° upward-tilted knockback vector.
//
// Exponential falloff curve (matches 2026-May-27 grenade tuning):
//   center (t=0): 200% of baseDamage
//   edge   (t=1):  10% of baseDamage
//   beyond:        0 (skipped before this function via inRange)
//
// The 0–45° vertical kick is randomized per call. Pass `rng` for
// deterministic testing or DO server-side replay.

export interface BlastHitInput {
  blastX: number;
  blastY: number;
  blastZ: number;
  /** Sample point on the enemy (typically hitbox center XZ + mid Y). */
  hitX: number;
  hitY: number;
  hitZ: number;
  radius: number;
  baseDamage: number;
  baseKnockback: number;
  /** 0..1 generator. Defaults to Math.random. */
  rng?: () => number;
}

export interface BlastHitResult {
  inRange: boolean;
  damage: number;
  /** The falloff-scaled knockback magnitude — passed into adapter
   *  applyDamage as `bulletSpeed` so each enemy's damage routine can
   *  use it as the impulse magnitude. */
  bulletSpeed: number;
  /** Unit-length knockback direction with vertical tilt. */
  knockbackDirX: number;
  knockbackDirY: number;
  knockbackDirZ: number;
}

export function resolveBlastHit(input: BlastHitInput): BlastHitResult {
  const dx = input.hitX - input.blastX;
  const dy = input.hitY - input.blastY;
  const dz = input.hitZ - input.blastZ;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

  if (dist > input.radius) {
    return {
      inRange: false,
      damage: 0,
      bulletSpeed: 0,
      knockbackDirX: 0, knockbackDirY: 0, knockbackDirZ: 0,
    };
  }

  const t = dist / input.radius;
  // Damage: lethal core fading smoothly to 0 at the edge — (1 - t)^1.5. baseDamage is the
  // CENTER damage, so a direct hit deals the full amount (kills a wide area near the center).
  const dmgFalloff = Math.pow(1 - t, 1.5);
  // Knockback keeps the punchy exponential curve so close hits really fling them.
  const kbFalloff = 2.0 * Math.pow(0.05, t);
  const damage = Math.max(0, Math.round(input.baseDamage * dmgFalloff));
  const bulletSpeed = input.baseKnockback * kbFalloff;

  // Horizontal direction away from blast center; tilted up by a
  // random 0–45° angle so enemies fly outward + skyward. Unit length
  // preserved via cos/sin parameterization.
  const rng = input.rng ?? Math.random;

  // Horizontal direction away from blast center. If the target is basically AT
  // the blast's XZ (dead-center), the radial direction is undefined and it would
  // launch straight up — so pick a random horizontal direction to scatter it.
  const horizLen = Math.hypot(dx, dz);
  let horizX: number, horizZ: number;
  if (horizLen < 0.5) {
    const a = rng() * Math.PI * 2;
    horizX = Math.cos(a);
    horizZ = Math.sin(a);
  } else {
    horizX = dx / horizLen;
    horizZ = dz / horizLen;
  }
  const upAngle = rng() * (Math.PI / 4); // 0–45°
  const cosA = Math.cos(upAngle);
  const sinA = Math.sin(upAngle);

  return {
    inRange: true,
    damage,
    bulletSpeed,
    knockbackDirX: horizX * cosA,
    knockbackDirY: sinA,
    knockbackDirZ: horizZ * cosA,
  };
}
