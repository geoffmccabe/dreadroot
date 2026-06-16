// explosionBurn — shared "set an enemy on fire from a blast" helper for ANY
// area-of-effect weapon: grenades, rocket launchers, bombs, etc. Not tied to
// grenades. Call it once per enemy the blast damaged.
//
// The burn it creates:
//   • FULL-BODY but biased onto the side of the body that FACED the blast
//     (sided engulf), so the fire wraps the scorched side, not the whole drum.
//   • lasts LONGER the closer the enemy was to the blast center (proximity).
//   • follows the body automatically through the knockback flight + landing +
//     stand-up (engulf burns track the live body via the combat registry),
//     then burns out when its timer ends.

import * as THREE from 'three';
import type { EnemyHitbox } from './EnemyCombatRegistry';
import type { FlameColorMode } from '@/components/fortress/UniversalFlameRenderer';

export type ApplyBurnFn = (
  entityType: string,
  entityId: string,
  blockId: string | undefined,
  tier: number,
  colors: [string, string, string],
  colorMode: FlameColorMode,
  baseDamage: number,
  armor: number,
  hitPosition?: THREE.Vector3,
  burnSeconds?: number,
  opts?: { engulf?: boolean; size?: number; height?: number; sided?: boolean },
) => void;

const _anchor = new THREE.Vector3();

export interface ExplosionBurnParams {
  applyBurn: ApplyBurnFn;
  type: string;               // adapter type
  entityId: string;
  blockId?: string;
  hitbox: EnemyHitbox;        // the enemy's current cylinder hitbox
  blastX: number; blastY: number; blastZ: number;
  blastRadius: number;
  tier: number;
  colors: [string, string, string];
  impactDamage: number;       // damage this enemy took from the blast (DOT scales off it)
  /** Base burn seconds at the blast center (scaled down by distance). Default 3 + tier·0.5. */
  baseSeconds?: number;
}

/** Ignite a directional, proximity-scaled explosion burn on one enemy. */
export function igniteExplosionBurn(p: ExplosionBurnParams): void {
  const hb = p.hitbox;
  // Surface point on the side facing the blast: walk from the hitbox center
  // horizontally TOWARD the blast by the body radius; Y clamped to blast level
  // so the fire sits on whichever body part the blast hit (legs vs head).
  const dx = p.blastX - hb.centerX;
  const dz = p.blastZ - hb.centerZ;
  const radial = Math.hypot(dx, dz) || 0.001;
  const burnX = hb.centerX + (dx / radial) * hb.radius;
  const burnZ = hb.centerZ + (dz / radial) * hb.radius;
  const burnY = Math.max(hb.bottomY, Math.min(hb.topY, p.blastY));
  _anchor.set(burnX, burnY, burnZ);

  // Proximity: 1 at the blast center → 0 at the edge. Closer burns longer.
  const dist = Math.hypot(hb.centerX - p.blastX, hb.centerZ - p.blastZ);
  const proximity = Math.max(0, 1 - dist / Math.max(0.001, p.blastRadius));
  const base = p.baseSeconds ?? (3 + p.tier * 0.5);
  const burnSeconds = base * (0.35 + 0.65 * proximity);

  const burnDps = Math.max(1, Math.round(p.impactDamage * 0.25));
  // Render via the PROVEN tracked 7-fire impact (engulf:false) at the blast-facing
  // body point — bone-attached so it rides the body through the knockback flight,
  // landing and stand-up. Bigger than a bullet hit (it's a blast). The blast-facing
  // surface point already puts it on the side that saw the explosion.
  const size = 0.9 + p.tier * 0.10;
  const height = 1.8 + p.tier * 0.15;
  p.applyBurn(
    p.type, p.entityId, p.blockId,
    p.tier, p.colors, 'static',
    burnDps, 0,
    _anchor, burnSeconds,
    { engulf: false, size, height },
  );
}
