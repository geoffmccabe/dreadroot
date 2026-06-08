// Routes an enemy's `attack` behavior result to the right victim: a rival
// enemy (when the EnemyManager chose one as this tick's target) or the player.
// Shared by every adapter so inter-species combat needs no per-type code.
import * as THREE from 'three';
import { enemyCombatRegistry } from '@/features/enemies/combat/EnemyCombatRegistry';
import type { SharedContext } from './types';

// Knockback tuning: distance = (1m + 1m per tier the attacker outranks the
// victim) × damage factor. MELEE_DAMAGE_REF is the damage at which the factor is
// 1.0 (tiny strikes barely budge; big ones go up to 2×). MELEE_DECAY converts
// the target distance to the launch impulse the victim's velocity-decay needs.
const MELEE_DAMAGE_REF = 10;
const MELEE_DECAY = 8;

export function applyAttackResult(
  shared: SharedContext | undefined,
  damage: number,
  knockback: number,
  dir: THREE.Vector3,
  onPlayerHit?: (damage: number, knockback: number, dir: THREE.Vector3) => void,
): void {
  applyAttackResultTo(
    shared?.aiTargetEnemy ?? null,
    shared?.aiTargetEnemyType ?? null,
    damage,
    knockback,
    dir,
    onPlayerHit,
  );
}

/**
 * Explicit-victim variant: deliver the hit to a CAPTURED victim (a rival enemy
 * ref + its combat type, or null=player) rather than reading the per-tick
 * shared target. The strike animation captures the victim at trigger so the
 * apex hit lands on the right target even though shared.aiTargetEnemy changes
 * each tick.
 *
 * For a rival victim, if it's no longer active/targetable (it died or despawned
 * during the wind-up), the hit is skipped (the strike animation still plays
 * out).
 */
export function applyAttackResultTo(
  victim: unknown | null,
  victimType: string | null,
  damage: number,
  knockback: number,
  dir: THREE.Vector3,
  onPlayerHit?: (damage: number, knockback: number, dir: THREE.Vector3) => void,
  attackerTier?: number,
): void {
  if (victim && victimType) {
    // Hitting a rival enemy — deliver melee damage through its combat adapter.
    const adapter = enemyCombatRegistry.getAdapter(victimType);
    if (!adapter) return;
    // Skip if the captured rival is no longer active/targetable (died mid-strike).
    if (adapter.getHitbox(victim) === null) return;
    // Knockback ∝ tier advantage × hit strength.
    const victimTier = (victim as { definition?: { tier?: number } })?.definition?.tier ?? attackerTier ?? 1;
    const tierDiff = (attackerTier ?? victimTier) - victimTier;
    const damageFactor = Math.min(2, damage / MELEE_DAMAGE_REF);
    const dist = Math.max(0.5, 1 + tierDiff) * damageFactor;
    adapter.applyDamage(victim, {
      damage,
      bulletSpeed: 0,
      knockbackDirX: dir.x,
      knockbackDirY: 0,
      knockbackDirZ: dir.z,
      hitX: 0, hitY: 0, hitZ: 0,
      isHeadshot: false,
      source: 'melee',
      knockbackImpulse: dist * MELEE_DECAY,
    });
    return;
  }
  onPlayerHit?.(damage, knockback, dir);
}
