// kaijuWeapons — flame, gun, grenade and melee for Kaiju-scale combat, with real ballistics.
//
// WHY NOT REUSE THE SPRAY SYSTEM DIRECTLY. src/components/siege/spray is exactly the right shape
// (a parameterised breath weapon: cone, muzzle speed, gravity, per-particle damage) but its hit
// test is hard-wired to the PLAYER. Kaiju need to hit each other, so the projectile model here is
// modelled on it and the hit test is against agents. Same physics, different target set.
//
// SCALE. 1 game unit = 100 real metres and a Kaiju is 3 units (300 m), so nothing here uses
// human-weapon numbers. Ranges are expressed in BODY HEIGHTS and converted, which keeps them
// sensible if the Kaiju size changes:
//   melee    0.9 bodies   contact
//   flame    2.2 bodies   short, wide, continuous, high total damage
//   gun      14  bodies   long, accurate, low damage per shot
//   grenade  7   bodies   arcing, area damage, slow
//
// BALANCE, as damage per second at a range where the weapon can actually reach:
//   flame   ~67   the reward for closing to two body-lengths
//   grenade ~38   plus area damage, so better against a group
//   gun     ~35   the only one that works at all beyond seven bodies
//   melee   ~37   available to everyone, so nobody is ever harmless
// These were set by running scripts/check-kaiju-arena.ts, not by guessing: the first pass had
// flame at 175 dps, which made every other Kaiju flee on sight and ended the fight instantly.
//
// Projectiles integrate under the map's real gravity (9.81 m/s^2 = 0.0981 units/s^2), so a
// grenade genuinely arcs and a gun round genuinely drops over distance.

import * as THREE from 'three';
import { gravityUnits } from './kaijuBody';
import { rand } from './kaijuRandom';

export type WeaponId = 'flame' | 'gun' | 'grenade' | 'melee';

export interface WeaponSpec {
  id: WeaponId;
  name: string;
  /** Effective range, in body heights. */
  rangeBodies: number;
  /** Seconds between uses. */
  cooldown: number;
  /** Damage per hit (per particle for flame). */
  damage: number;
  /** Muzzle speed in units/sec, 0 for hitscan-like melee. */
  speed: number;
  /** Half-angle of the firing cone, radians. */
  spread: number;
  /** Projectiles per use. */
  count: number;
  /** Seconds a projectile lives. */
  life: number;
  /** Blast radius in body heights (0 = point hit). */
  blastBodies: number;
  /** How strongly gravity acts on it, as a fraction of real gravity. */
  gravityScale: number;
  colour: [number, number, number];
  size: number;
  /**
   * Split the output into this many parallel STREAMS arranged in a hexagon around the aim axis.
   *
   * One wide cone reads as a cloud however many particles are in it. A bundle of narrow jets reads
   * as pressure — you can see the individual streams and follow them — which is what a flamethrower
   * actually looks like and what Geoff asked for.
   */
  streams?: number;
  /** How far off-axis each stream sits, in radians. The radius of the honeycomb. */
  streamSpread?: number;
}

export const WEAPONS: Record<WeaponId, WeaponSpec> = {
  // Continuous, close, and the highest damage per second if you can stay in range.
  // A JET, NOT A PUFF.
  //
  // The previous pass was wrong in every way Geoff described: six enormous particles moving so
  // slowly they never left the Kaiju, so it read as one white ball sitting on its own chest.
  //
  // What makes a flamethrower look like a flamethrower is the SHAPE — a narrow, fast jet that
  // starts tight at the mouth and widens as it burns out. So:
  //   spread 0.09 rad (5 degrees), not 0.34 (20) — a jet, not a spray
  //   speed 11.5 u/s, enough to actually cross its own range within its lifetime
  //   count 48 per burst, which at a 0.15 s cooldown and 3.2 s life keeps ~1000 alive
  //   size small at the mouth; the renderer grows each particle over its life, and THAT is what
  //     forms the cone — a fixed size cannot make a cone however you aim it
  //   range 12 bodies = 3.6 km, about 5.5x the old reach, as asked
  //
  // Damage per particle drops in step with the count, so the weapon's damage per second is
  // unchanged and the balance work still holds.
  flame: {
    id: 'flame', name: 'Flamethrower', rangeBodies: 18, cooldown: 0.15, damage: 0.19,
    speed: 17, spread: 0.022, count: 72, life: 3.2, blastBodies: 0, gravityScale: 0.05,
    colour: [1.0, 0.55, 0.12], size: 0.05,
    streams: 6, streamSpread: 0.030,
  },
  // Long reach, flat trajectory, modest damage. The ranged-attacker's weapon.
  gun: {
    id: 'gun', name: 'Cannon', rangeBodies: 14, cooldown: 0.75, damage: 26,
    speed: 60, spread: 0.02, count: 1, life: 3.0, blastBodies: 0, gravityScale: 1,
    colour: [1.0, 0.95, 0.5], size: 0.10,
  },
  // Arcs, lands, explodes. Good against a group or someone in cover, bad at close range.
  grenade: {
    id: 'grenade', name: 'Grenade', rangeBodies: 7, cooldown: 2.4, damage: 90,
    speed: 22, spread: 0.05, count: 1, life: 4.0, blastBodies: 1.6, gravityScale: 1,
    colour: [0.5, 1.0, 0.4], size: 0.22,
  },
  melee: {
    id: 'melee', name: 'Melee', rangeBodies: 0.9, cooldown: 1.5, damage: 55,
    speed: 0, spread: 0.6, count: 1, life: 0, blastBodies: 0, gravityScale: 0,
    colour: [1, 1, 1], size: 0,
  },
};

export interface Projectile {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  /** Lifetime it started with, so the renderer can grow and fade it over its life. */
  maxLife: number;
  /** Local up at launch, so gravity pulls toward the planet centre rather than world -Y. */
  ownerId: string;
  weapon: WeaponId;
  life: number;
  damage: number;
  blast: number;
  colour: [number, number, number];
  size: number;
  dead: boolean;
}

const projectiles: Projectile[] = [];
export function getProjectiles(): Projectile[] { return projectiles; }

const _dir = new THREE.Vector3();
const _up = new THREE.Vector3();
const _side = new THREE.Vector3();
const _axisDir = new THREE.Vector3();
const _refUp = new THREE.Vector3();
const _sideA = new THREE.Vector3();
const _sideB = new THREE.Vector3();

/**
 * Fire a weapon from `origin` toward `aim`.
 *
 * Gravity on this map points at the planet centre, so a projectile's "down" is its own position
 * direction rather than world -Y. Firing sideways across a curved surface therefore drops the
 * round toward the ground under it, not toward the south pole.
 */
export function fireWeapon(
  ownerId: string, weapon: WeaponId, origin: THREE.Vector3, aim: THREE.Vector3, heightUnits: number,
): void {
  const w = WEAPONS[weapon];
  if (w.speed <= 0) return;                     // melee is resolved directly, not as a projectile

  // Build a stable frame around the aim axis ONCE, so all six streams share it and the honeycomb
  // holds its shape instead of each particle picking its own basis.
  _axisDir.copy(aim).normalize();
  _refUp.set(0, 1, 0);
  if (Math.abs(_axisDir.y) > 0.9) _refUp.set(1, 0, 0);
  _sideA.crossVectors(_axisDir, _refUp).normalize();
  _sideB.crossVectors(_axisDir, _sideA).normalize();

  for (let i = 0; i < w.count; i++) {
    _dir.copy(_axisDir);

    // THE HONEYCOMB. Six streams evenly around the axis, each particle assigned to one by index so
    // every stream gets an equal share. Their tight individual spread keeps each one a distinct
    // thread rather than letting them blur into a single cone.
    if (w.streams && w.streams > 1) {
      const stream = i % w.streams;
      const a = (stream / w.streams) * Math.PI * 2;
      const r = w.streamSpread ?? 0.03;
      _dir.addScaledVector(_sideA, Math.cos(a) * r).addScaledVector(_sideB, Math.sin(a) * r).normalize();
    }
    if (w.spread > 0) {
      // Random direction inside the cone: pick two perpendicular axes and tilt.
      _side.copy(_sideA);
      _up.copy(_sideB);
      const a = rand() * Math.PI * 2;
      const r = rand() * w.spread;
      _dir.addScaledVector(_side, Math.cos(a) * r).addScaledVector(_up, Math.sin(a) * r).normalize();
    }
    const speed = w.speed * (0.9 + rand() * 0.2);
    projectiles.push({
      pos: origin.clone(),
      vel: _dir.clone().multiplyScalar(speed),
      ownerId,
      weapon,
      // Vary the lifetime a little so a burst does not wink out as one solid block.
      life: w.life * (0.8 + rand() * 0.4),
      maxLife: w.life,
      damage: w.damage,
      blast: w.blastBodies * heightUnits,
      colour: w.colour,
      size: w.size * heightUnits,
      dead: false,
    });
  }
}

export interface HitTarget {
  id: string;
  /** Centre of mass, roughly half body height above the feet. */
  centre: THREE.Vector3;
  /** Hit radius in units. */
  radius: number;
  alive: boolean;
}

export interface HitEvent { targetId: string; ownerId: string; weapon: WeaponId; damage: number }

/**
 * Advance every projectile and report hits.
 *
 * Gravity is applied along the projectile's OWN local up (toward the planet centre), which is what
 * makes ballistics behave correctly on a sphere over the distances a Kaiju cannon covers.
 */
export function stepProjectiles(dt: number, targets: HitTarget[], groundRadiusAt: (p: THREE.Vector3) => number | null): HitEvent[] {
  const hits: HitEvent[] = [];
  const g = gravityUnits();

  for (const p of projectiles) {
    if (p.dead) continue;
    const spec = WEAPONS[p.weapon];

    // Gravity toward the planet centre.
    const len = p.pos.length();
    if (len > 1e-6) {
      _up.copy(p.pos).multiplyScalar(1 / len);
      p.vel.addScaledVector(_up, -g * spec.gravityScale * dt);
    }
    p.pos.addScaledVector(p.vel, dt);
    p.life -= dt;

    let detonate = false;

    // Ground contact.
    //
    // SKIPPED FOR FLAME. It is life-limited, barely affected by gravity, and there are about a
    // thousand of them: sampling the terrain per particle per frame would be 60,000 height
    // lookups a second to decide something invisible. The ballistic weapons, which genuinely arc
    // into the ground, still test it.
    if (p.weapon !== 'flame') {
      const gr = groundRadiusAt(p.pos);
      if (gr != null && p.pos.length() <= gr) detonate = true;
    }

    // Direct hit. Skip the firer so nobody shoots themselves point blank.
    if (!detonate) {
      for (const t of targets) {
        if (!t.alive || t.id === p.ownerId) continue;
        if (p.pos.distanceTo(t.centre) <= t.radius + p.size) {
          if (p.blast <= 0) hits.push({ targetId: t.id, ownerId: p.ownerId, weapon: p.weapon, damage: p.damage });
          detonate = true;
          break;
        }
      }
    }

    if (detonate || p.life <= 0) {
      // Area damage falls off linearly to the blast edge.
      if (p.blast > 0 && (detonate || p.life <= 0)) {
        for (const t of targets) {
          if (!t.alive || t.id === p.ownerId) continue;
          const d = p.pos.distanceTo(t.centre);
          if (d <= p.blast + t.radius) {
            const falloff = 1 - Math.min(1, d / (p.blast + t.radius));
            hits.push({ targetId: t.id, ownerId: p.ownerId, weapon: p.weapon, damage: p.damage * falloff });
          }
        }
      }
      p.dead = true;
    }
  }

  // Compact the list rather than splicing inside the loop.
  for (let i = projectiles.length - 1; i >= 0; i--) if (projectiles[i].dead) projectiles.splice(i, 1);
  return hits;
}

/** Melee is resolved immediately: a cone in front, within reach. */
export function resolveMelee(
  ownerId: string, origin: THREE.Vector3, facing: THREE.Vector3, heightUnits: number, targets: HitTarget[],
): HitEvent[] {
  const w = WEAPONS.melee;
  const reach = w.rangeBodies * heightUnits;
  const out: HitEvent[] = [];
  for (const t of targets) {
    if (!t.alive || t.id === ownerId) continue;
    _dir.copy(t.centre).sub(origin);
    const d = _dir.length();
    if (d > reach + t.radius) continue;
    _dir.multiplyScalar(1 / Math.max(1e-6, d));
    if (_dir.dot(facing) < Math.cos(w.spread)) continue;    // must be in front
    out.push({ targetId: t.id, ownerId, weapon: 'melee', damage: w.damage });
  }
  return out;
}

export function clearProjectiles(): void { projectiles.length = 0; }
