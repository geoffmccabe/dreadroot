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
  type BurnFollower,
} from '@/features/enemies/combat/EnemyCombatRegistry';
import { spawnDamageNumber, DN_RED, DN_WHITE } from './damageNumbers';
import { rayHitsBox, type MonsterHitbox } from './hitboxConfig';

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
  kvy: number;          // vertical launch impulse (m/s) — consumed once by the mover (blast)
  stunUntil: number;    // performance.now() ms — frozen until then
  hitAt: number;        // last flinch trigger (performance.now())
  headshotAt?: number;  // last headshot (performance.now()) — drives the quick recoil-lean
  headFrac: number;     // top fraction of the hitbox that counts as a headshot (head zone)
  noStun?: boolean;     // test/boss flag: bullets don't stun-freeze it (keeps walking when shot)
  yaw: number;          // current facing (radians) — lets attached fire rotate WITH the body
  // Damage resistance 0..1 (default 1 = full damage). The teleporting Dark Lord sets this to
  // its current opacity, so a near-invisible boss (opacity 0.2) takes only 20% damage.
  opacity?: number;
  // If set, a bullet knockback uses (1-3)·kbScale velocity instead of the fixed 4.5 (the bloody
  // skeleton horde sets kbScale = 6/size so small skeletons fly far, big ones barely budge).
  kbScale?: number;
  noKnockback?: boolean;   // bullets/hits deal HP only — no shove (the Spintroll drives its own motion)
  // Mushroom grunt: a BULLET flings it 1-10m away + launches it so MonsterEnemy tumbles it
  // end-over-end (set on the instance at creation). bulletTumbleAt/Rev are the per-hit handoff.
  tumbleOnBullet?: boolean;
  bulletTumbleAt?: number;
  bulletTumbleRev?: number;
  // Set by MonsterEnemy: attach a world hit point to the nearest skeleton bone so
  // an ongoing burn rides the animation (gait bob + turn). Undefined until ready.
  attach?: (x: number, y: number, z: number) => BurnFollower | null;
  // Per-monster BOX hitboxes (LOCAL space) + a precomputed broad-phase cylinder
  // that encloses them. Written by MonsterEnemy each time the boxes change; read
  // by getHitbox (broad-phase) + refineBulletHit (exact box test). Undefined →
  // fall back to the legacy radius/height cylinder.
  hitboxes?: MonsterHitbox;
  bpRadius?: number; bpTop?: number; bpBottom?: number;
}

// Live array (not a Set) so getActiveEnemies returns it with zero per-query allocation —
// raycastBullet calls it once per bullet per frame.
export const siegeDemons: DemonInstance[] = [];

export function addDemon(d: DemonInstance): void { siegeDemons.push(d); }

// Challenge scoring: every bit of damage dealt to a siege monster is reported here (the runner
// registers a hook that adds it to the live score; headshots are flagged for the 3× bonus).
type ScoreHook = (damage: number, headshot: boolean) => void;
let scoreHook: ScoreHook | null = null;
export function setSiegeScoreHook(fn: ScoreHook | null) { scoreHook = fn; }

// Direct (non-knockback) damage — used for blast-impact hits (slamming a wall / the ground).
// Returns true if this killed it.
export function hurtDemon(d: DemonInstance, amount: number): boolean {
  if (d.dead || amount <= 0) return false;
  const dealt = amount * (d.opacity ?? 1);
  d.hp -= dealt;
  scoreHook?.(dealt, false);
  if (d.hp <= 0) { d.dead = true; d.deadAt = performance.now(); return true; }
  return false;
}
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
  // Broad-phase cylinder for the bullet raycast. When per-monster boxes are set,
  // use the precomputed enclosing cylinder (bp*) so no box hit is ever missed;
  // refineBulletHit then narrows the actual hit to the box. Else legacy cylinder.
  getHitbox: (d): EnemyHitbox | null => d.dead ? null : {
    centerX: d.x, centerZ: d.z,
    bottomY: d.y + (d.bpBottom ?? 0),
    topY: d.y + (d.bpTop ?? d.height),
    radius: d.bpRadius ?? d.radius,
  },
  // Narrow a broad-phase cylinder hit to the actual boxes: head box → headshot,
  // body box → body hit, neither → miss (the cylinder was a false positive).
  // ox..oz = ray origin (prev bullet pos), dx..dz = segment vector for this step.
  refineBulletHit: (d, ox, oy, oz, dx, dy, dz) => {
    const hb = d.hitboxes;
    if (!hb || d.dead) return null;   // no boxes → keep the legacy cylinder/headFrac path
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) return null;
    const ux = dx / len, uy = dy / len, uz = dz / len;
    if (rayHitsBox(hb.head, d.x, d.y, d.z, d.yaw, ox, oy, oz, ux, uy, uz, len)) return { hit: true, isHeadshot: true };
    if (rayHitsBox(hb.body, d.x, d.y, d.z, d.yaw, ox, oy, oz, ux, uy, uz, len)) return { hit: true, isHeadshot: false };
    return { hit: false, isHeadshot: false };
  },
  // Fire keeps burning on the body through the death animation (getHitbox goes
  // null at death so weapons stop hitting it, but the corpse is still on screen
  // for ~2.6s). Returns the live feet position whether alive or dead; the burn
  // system stops following once the demon despawns (leaves the active list).
  getBurnAnchor: (d) => ({ x: d.x, y: d.y, z: d.z, radius: d.radius, yaw: d.yaw }),
  // Lock the fire to the nearest animated bone so it rides the gait + turn.
  createBurnFollower: (d, x, y, z) => d.attach?.(x, y, z) ?? null,
  applyDamage: (d, info) => {
    if (d.dead) return false;
    const dealt = info.damage * (d.opacity ?? 1);   // opacity = damage resistance (fading boss is tankier)
    d.hp -= dealt;
    scoreHook?.(dealt, info.isHeadshot);
    // Floating damage number (Unity port): white normal / red headshot, on discrete hits only
    // (skip flame DoT ticks so they don't flood). Spawns near the hit zone on the body.
    if (info.source !== 'flame' && dealt > 0) {
      spawnDamageNumber(d.x, d.y + d.height * (info.isHeadshot ? 0.92 : 0.6), d.z,
        String(Math.round(dealt)), info.isHeadshot ? DN_RED : DN_WHITE);
    }
    const now = performance.now();
    if (info.isHeadshot) d.headshotAt = now;   // triggers the quick body recoil-lean in MonsterEnemy
    if (info.source === 'explosion') {
      // Real falloff-scaled blast impulse (info.bulletSpeed = baseKnockback·falloff, like
      // shombies). SET velocity on ALL axes — knockbackDir carries a 0-45° upward tilt, so this
      // LAUNCHES them into an arc + tumble instead of a 1m slide. Capped to a sane on-screen arc.
      const mag = Math.min(40, info.bulletSpeed);
      d.kvx = info.knockbackDirX * mag;
      d.kvz = info.knockbackDirZ * mag;
      d.kvy = info.knockbackDirY * mag;
      d.stunUntil = now + 1300;
      d.hitAt = now;
    } else if (info.source !== 'flame') {
      // Burn DoT (flame) only chips HP — no re-stun (else the horde perma-freezes).
      const bulletTumble = d.tumbleOnBullet && info.source === 'bullet';
      const kb = info.source === 'melee' ? (info.knockbackImpulse ?? 8)
        : bulletTumble ? (5 + Math.random() * 8)                    // big 5-13 stagger → flies ~1-10m
        : (d.kbScale ? (1 + Math.random() * 2) * d.kbScale : 4.5);  // bullet: fixed stagger, or 1-3·kbScale
      if (!d.noKnockback) {
        d.kvx += info.knockbackDirX * kb;
        d.kvz += info.knockbackDirZ * kb;
      }
      if (bulletTumble) {
        d.kvy = 5 + Math.random() * 3;             // launch up so it arcs while tumbling
        d.bulletTumbleAt = now;
        d.bulletTumbleRev = 1 + Math.random() * 4; // 1-5 revolutions / second (random each hit)
      }
      if (!d.noStun) d.stunUntil = now + 1000 + Math.random() * 2000; // 1–3s stun (skipped for noStun boss/test demon)
      d.hitAt = now;
    }
    if (d.hp <= 0) { d.dead = true; d.deadAt = now; return true; }
    return false;
  },
  // Head hitbox: a hit in the top headFrac of the cylinder is a 2x-damage headshot, aligned
  // with the visible head collider.
  getHeadshotZoneFraction: (d) => d.headFrac,
  // Flamethrower wraps the body in fire (torso + head), tracking the live center.
  getFlameAttachPoints: (d): FlameAttachPoint[] => {
    const k = d.height / 1.8;
    // Dense, body-hugging plumes up the torso so the burn reads as SOLID fire
    // engulfing the demon — not a few sparse sparks at the top. Short overlapping
    // columns (low height, many particles) keep the flame concentrated ON the
    // body instead of a thin tall column where only the risen tips show.
    return [
      { yOffset: d.height * 0.10, size: 0.62 * k, height: d.height * 0.42, particles: 38 },
      { yOffset: d.height * 0.38, size: 0.54 * k, height: d.height * 0.38, particles: 32 },
      { yOffset: d.height * 0.62, size: 0.42 * k, height: d.height * 0.32, particles: 24 },
    ];
  },
});
