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

  // Exponential falloff: 2 · 0.05^t. Calibrated to design feedback.
  const t = dist / input.radius;
  const falloff = 2.0 * Math.pow(0.05, t);
  const damage = Math.max(1, Math.round(input.baseDamage * falloff));
  const bulletSpeed = input.baseKnockback * falloff;

  // Horizontal direction away from blast center; tilted up by a
  // random 0–45° angle so enemies fly outward + skyward. Unit length
  // preserved via cos/sin parameterization.
  const dHoriz = Math.max(0.01, Math.hypot(dx, dz));
  const horizX = dx / dHoriz;
  const horizZ = dz / dHoriz;

  const rng = input.rng ?? Math.random;
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
