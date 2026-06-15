// siegeHorde — shared combat state for every Siege Worlds MonsterEnemy (the red-demon horde
// + the named beach monsters). ONE EnemyCombatAdapter is registered here so the existing
// Dreadroot weapons (bullets, flamethrower, explosions) damage these monsters with zero
// per-monster weapon code: bullets auto-spawn impact fire + score, the flamethrower ignites
// them via getFlameAttachPoints, knockback/stun/death are applied in applyDamage.
//
// MonsterEnemy owns the RENDER + AI (reads this state each frame to flinch/freeze/die);
// this module owns the COMBAT DATA (the adapter mutates it on hit). Clean split.

import {
  enemyCombatRegistry,
  type EnemyHitbox,
  type FlameAttachPoint,
} from '@/features/enemies/combat/EnemyCombatRegistry';

export interface DemonInstance {
  id: string;
  // Feet position in world space — MonsterEnemy writes this every frame.
  x: number; y: number; z: number;
  height: number;   // standing height (m)
  radius: number;   // hitbox radius (m)
  hp: number;
  maxHp: number;
  // Combat-driven state MonsterEnemy reads each frame:
  dead: boolean;
  deadAt: number;       // performance.now() when killed
  despawned: boolean;   // guard so onDespawn fires once
  kvx: number; kvz: number;  // horizontal knockback velocity (m/s), decays
  stunUntil: number;    // performance.now() ms — frozen until then
  hitAt: number;        // last flinch trigger (performance.now())
}

// Live array (not a Set) so getActiveEnemies returns it with zero per-query allocation —
// raycastBullet calls it once per bullet per frame.
export const siegeDemons: DemonInstance[] = [];

export function addDemon(d: DemonInstance): void { siegeDemons.push(d); }
export function removeDemon(d: DemonInstance): void {
  const i = siegeDemons.indexOf(d);
  if (i >= 0) siegeDemons.splice(i, 1);
}

// Register the adapter once (module load). register() is keyed by type, so a hot-reload
// double-register simply replaces — harmless. Empty array in non-siege modes = zero cost.
enemyCombatRegistry.register<DemonInstance>({
  type: 'reddemon',
  getActiveEnemies: () => siegeDemons,
  getId: (d) => d.id,
  getHitbox: (d): EnemyHitbox | null => d.dead ? null : {
    centerX: d.x, centerZ: d.z,
    bottomY: d.y, topY: d.y + d.height,
    radius: d.radius,
  },
  applyDamage: (d, info) => {
    if (d.dead) return false;
    d.hp -= info.damage;
    // Burn DoT (source 'flame') only chips HP — no re-stun/knockback each tick (else the
    // horde perma-freezes). Bullets/melee/explosions stagger + stun.
    if (info.source !== 'flame') {
      const now = performance.now();
      const kb = info.source === 'explosion' ? 9
        : info.source === 'melee' ? (info.knockbackImpulse ?? 8)
        : 4.5; // bullet: a visible stagger, not a launch
      d.kvx += info.knockbackDirX * kb;
      d.kvz += info.knockbackDirZ * kb;
      d.stunUntil = now + 1000 + Math.random() * 2000; // 1–3s stun, as requested
      d.hitAt = now;
    }
    if (d.hp <= 0) { d.dead = true; d.deadAt = performance.now(); return true; }
    return false;
  },
  // Flamethrower wraps the body in fire (torso + head), tracking the live center.
  getFlameAttachPoints: (d): FlameAttachPoint[] => {
    const k = d.height / 1.8;
    return [
      { yOffset: d.height * 0.35, size: 0.45 * k, height: d.height * 0.6, particles: 14 },
      { yOffset: d.height * 0.70, size: 0.35 * k, height: d.height * 0.5, particles: 10 },
    ];
  },
});
