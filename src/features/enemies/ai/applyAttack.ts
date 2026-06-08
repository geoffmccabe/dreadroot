// Routes an enemy's `attack` behavior result to the right victim: a rival
// enemy (when the EnemyManager chose one as this tick's target) or the player.
// Shared by every adapter so inter-species combat needs no per-type code.
import * as THREE from 'three';
import { enemyCombatRegistry } from '@/features/enemies/combat/EnemyCombatRegistry';
import type { SharedContext } from './types';

export function applyAttackResult(
  shared: SharedContext | undefined,
  damage: number,
  knockback: number,
  dir: THREE.Vector3,
  onPlayerHit?: (damage: number, knockback: number, dir: THREE.Vector3) => void,
): void {
  if (shared?.aiTargetEnemy && shared.aiTargetEnemyType) {
    // Hitting a rival enemy — deliver melee damage through its combat adapter.
    const adapter = enemyCombatRegistry.getAdapter(shared.aiTargetEnemyType);
    adapter?.applyDamage(shared.aiTargetEnemy, {
      damage,
      bulletSpeed: 0,
      knockbackDirX: dir.x,
      knockbackDirY: 0,
      knockbackDirZ: dir.z,
      hitX: 0, hitY: 0, hitZ: 0,
      isHeadshot: false,
      source: 'melee',
    });
    return;
  }
  onPlayerHit?.(damage, knockback, dir);
}
