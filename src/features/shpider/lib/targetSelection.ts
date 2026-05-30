// Shpider target-selection — picks where a shpider should aim its
// next hop. Two strategies:
//
//   - "wild": chase the local player snapshot every tick. Cheap.
//   - "pet (owner)": chase the nearest huntable enemy in range; if no
//     huntable enemy is in range, fall back to the owner's position so
//     the pet idles near them. Skips shnakes/shtickmen (petAttackable=
//     false), other pet shpiders (no friendly fire), and itself.
//
// Each shpider stores a target-provider callback at spawn time so the
// renderer's per-frame loop doesn't have to branch on instance type.
// Same shape will run on the L2 DO with its own enemy-list access.

import { enemyCombatRegistry } from '@/features/enemies/combat/EnemyCombatRegistry';
import { getLocalPlayerSnapshot } from '@/hooks/usePlayerSnapshot';
import type { ShpiderInstance } from '../types';

export interface TargetPoint {
  x: number;
  y: number;
  z: number;
}

/** Provider signature: given a shpider, return where its AI should
 *  aim this tick. Re-evaluated every frame so a pet's target updates
 *  as enemies move. */
export type TargetProvider = (s: ShpiderInstance) => TargetPoint;

/** Wild shpiders: chase the local player snapshot. */
export const chaseLocalPlayer: TargetProvider = () => {
  const p = getLocalPlayerSnapshot();
  return { x: p.x, y: p.y, z: p.z };
};

/** Pet shpiders: nearest huntable enemy. Falls back to the owner
 *  (= local player) if nothing huntable is in range. */
export const petTargetNearestHostile: TargetProvider = (s) => {
  const p = getLocalPlayerSnapshot();
  let bestDistSq = Infinity;
  let tgtX = p.x, tgtY = p.y, tgtZ = p.z;
  for (const adapter of enemyCombatRegistry.getAdapters()) {
    if (adapter.petAttackable === false) continue;
    const aType = adapter.type;
    const enemies = adapter.getActiveEnemies();
    for (const enemy of enemies) {
      // No friendly fire against other pet shpiders, and don't
      // target self.
      if (aType === 'shpider' && (enemy as any).petOwnerUserId) continue;
      if ((enemy as any).id === s.id) continue;
      const hb = adapter.getHitbox(enemy);
      if (!hb) continue;
      const ddx = hb.centerX - s.position.x;
      const ddz = hb.centerZ - s.position.z;
      const dsq = ddx * ddx + ddz * ddz;
      if (dsq < bestDistSq) {
        bestDistSq = dsq;
        tgtX = hb.centerX;
        tgtY = (hb.bottomY + hb.topY) * 0.5;
        tgtZ = hb.centerZ;
      }
    }
  }
  return { x: tgtX, y: tgtY, z: tgtZ };
};
