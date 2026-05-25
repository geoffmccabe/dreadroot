// Grenade tuning. One place to tweak the whole feel.

/** How long after throw before the boom. */
export const GRENADE_FUSE_SEC = 3.0;

/** Throw forward speed (m/s along camera look-direction projected to ground). */
export const GRENADE_THROW_SPEED = 18;

/** Upward kick added on throw — produces the arc. */
export const GRENADE_THROW_UP = 7;

/** World gravity for the grenade physics. Matches BULLET_GRAVITY so
 *  arcs look consistent with the rest of the projectile system. */
export const GRENADE_GRAVITY = 18;

/** Per-bounce energy retention. 0.4 = loses 60% on each impact. */
export const GRENADE_BOUNCE_DAMP = 0.4;

/** Friction multiplier per second while rolling on a surface. */
export const GRENADE_ROLL_FRICTION_PER_SEC = 0.6;

/** Velocity magnitude below which a grounded grenade switches from
 *  bouncing to rolling. */
export const GRENADE_ROLL_THRESHOLD = 1.5;

/** Visual radius of the grenade in world units. */
export const GRENADE_VISUAL_RADIUS = 0.18;

/** Maximum grenades in flight at once. Caps the instanced-mesh count. */
export const MAX_LIVE_GRENADES = 24;

// ── Damage / radius scale with tier ──────────────────────────────────
/** Damage at tier 1, before tier scaling. */
export const GRENADE_BASE_DAMAGE = 40;

/** Each tier adds this much damage on top of base. */
export const GRENADE_DAMAGE_PER_TIER = 35;

/** Explosion radius (m) at T1. */
export const GRENADE_BASE_RADIUS = 4;

/** Each tier extends the explosion radius by this much (m). */
export const GRENADE_RADIUS_PER_TIER = 0.5;

/** Knockback strength applied to nearby enemies (m/s) at T1. */
export const GRENADE_BASE_KNOCKBACK = 8;
export const GRENADE_KNOCKBACK_PER_TIER = 2;

/** Total damage = BASE_DAMAGE + (tier - 1) × DAMAGE_PER_TIER. */
export function grenadeDamage(tier: number): number {
  const t = Math.max(1, Math.min(10, tier));
  return GRENADE_BASE_DAMAGE + (t - 1) * GRENADE_DAMAGE_PER_TIER;
}

/** AoE radius for the explosion (m). Falls off linearly toward edge. */
export function grenadeRadius(tier: number): number {
  const t = Math.max(1, Math.min(10, tier));
  return GRENADE_BASE_RADIUS + (t - 1) * GRENADE_RADIUS_PER_TIER;
}

export function grenadeKnockback(tier: number): number {
  const t = Math.max(1, Math.min(10, tier));
  return GRENADE_BASE_KNOCKBACK + (t - 1) * GRENADE_KNOCKBACK_PER_TIER;
}

/**
 * Per-tier color. Live grenade body uses this for its emissive tint;
 * the explosion VFX uses it for the flame plume colors so the boom
 * visibly matches the tier you threw. Roughly classic rainbow with
 * a metallic finisher tier.
 */
export const GRENADE_TIER_COLORS: Record<number, [string, string, string]> = {
  1:  ['#3a4a1c', '#5b7028', '#7c9436'], // olive (classic)
  2:  ['#660000', '#aa1010', '#ff3030'], // red
  3:  ['#7a3000', '#c45000', '#ff7a1a'], // orange
  4:  ['#7a7a00', '#cccc00', '#ffff33'], // yellow
  5:  ['#114411', '#22aa22', '#33ff66'], // green
  6:  ['#005566', '#00aaaa', '#33ffff'], // cyan
  7:  ['#001a66', '#1133cc', '#3366ff'], // blue
  8:  ['#330066', '#7733cc', '#cc66ff'], // purple
  9:  ['#660033', '#cc3366', '#ff77aa'], // pink
  10: ['#888888', '#cccccc', '#ffffff'], // metallic/white
};

export function grenadeColors(tier: number): [string, string, string] {
  return GRENADE_TIER_COLORS[Math.max(1, Math.min(10, tier))] ?? GRENADE_TIER_COLORS[1];
}
