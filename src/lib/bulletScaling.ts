/**
 * Bullet Scaling System
 * 
 * Automatically scales bullet tier based on player level.
 * Supports override system for special weapons/items.
 */

/**
 * Maps player level (1-30) to bullet tier (1-10)
 * Level 1-3 → Tier 1
 * Level 4-6 → Tier 2
 * Level 7-9 → Tier 3
 * ... and so on
 * Level 28-30 → Tier 10
 */
export function getDefaultBulletTier(playerLevel: number): number {
  const clampedLevel = Math.max(1, Math.min(30, playerLevel));
  return Math.min(10, Math.floor((clampedLevel - 1) / 3) + 1);
}

/**
 * Override system for special weapons, power-ups, or items
 * Can modify tier, velocity, damage, and color
 */
export interface BulletOverride {
  tierOverride?: number;        // Force specific tier (1-10)
  velocityMultiplier?: number;  // 1.5 = 50% faster bullets
  damageMultiplier?: number;    // 2.0 = double damage
  colorOverride?: string;       // Force specific color
}

/**
 * Get the effective bullet tier considering overrides
 */
export function getEffectiveBulletTier(
  playerLevel: number, 
  override?: BulletOverride | null
): number {
  if (override?.tierOverride) {
    return Math.max(1, Math.min(10, override.tierOverride));
  }
  return getDefaultBulletTier(playerLevel);
}

/**
 * Apply velocity multiplier from override
 */
export function getEffectiveVelocity(
  baseVelocity: number,
  override?: BulletOverride | null
): number {
  if (override?.velocityMultiplier) {
    return baseVelocity * override.velocityMultiplier;
  }
  return baseVelocity;
}

/**
 * Apply damage multiplier from override
 */
export function getEffectiveDamage(
  baseDamage: number,
  override?: BulletOverride | null
): number {
  if (override?.damageMultiplier) {
    return baseDamage * override.damageMultiplier;
  }
  return baseDamage;
}

/**
 * Get color, preferring override if specified
 */
export function getEffectiveColor(
  tierColor: string,
  override?: BulletOverride | null
): string {
  return override?.colorOverride ?? tierColor;
}
