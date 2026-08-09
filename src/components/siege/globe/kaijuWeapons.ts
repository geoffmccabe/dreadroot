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
import { raycastCity } from './cityColliders';
import { rand } from './kaijuRandom';
import { meshRay } from './kaijuMeshSeparate';
import { igniteMesh } from './kaijuBurn';

/**
 * Chance that a flame particle which connects sets that patch alight.
 *
 * A jet lands well over a thousand hits a second. Igniting on every one of them would fill the burn
 * pool in a frame; this makes a sustained jet light a handful of growing fires rather than a
 * thousand identical ones, and the merge in kaijuBurn takes care of the rest.
 */
const MESH_IGNITE_CHANCE = 0.02;

/** Scratch for the swept mesh test. Declared here so no per-particle allocation happens. */
const _prevPos = new THREE.Vector3();
const _hitPt = new THREE.Vector3();
const _hitNrm = new THREE.Vector3();

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
  //
  // EXTENDED to 30 bodies (9 km) because the flame was extended to 18 (5.4 km) on request, which
  // made the flamethrower the longest-reaching weapon in the game. That inverts the entire design:
  // the cannon exists to be the only thing that works at distance, and the flame to be the reward
  // for closing. With flame outranging it there was no reason to close at all, and the balance
  // simulator reported the flame-vs-cannon matchup as degenerate — one side winning regardless of
  // how it was played, which is the signature of a broken triangle rather than a tuning problem.
  //
  // The fix is to raise the cannon rather than shorten the flame, since the longer flame is what
  // was actually asked for.
  gun: {
    id: 'gun', name: 'Cannon', rangeBodies: 30, cooldown: 0.75, damage: 26,
    speed: 60, spread: 0.02, count: 1, life: 3.0, blastBodies: 0, gravityScale: 1,
    colour: [1.0, 0.95, 0.5], size: 0.10,
  },
  // LOBBED, not fired. Arcs high, falls, and detonates on whatever it touches.
  //
  // WHY ITS GRAVITY IS 12x REAL, which is a deliberate lie and the only one in this file. At true
  // gravity the distances here make a lob absurd: a 1.3 km throw needs 113 m/s and spends SIXTEEN
  // SECONDS in the air, and 2 km takes over twenty. Nobody can aim that and nothing about it reads
  // as a throw. Scaling projectile gravity is what every game does for exactly this reason.
  //
  // At 12x, a 1.3 km lob is a 4.7 second flight peaking at 325 m — just over the Kaiju's own head,
  // so the arc is legible against the creature that threw it. The trajectory is still fully
  // simulated and still curves toward the planet centre; only the constant is dramatised.
  grenade: {
    id: 'grenade', name: 'Grenade', rangeBodies: 4.5, cooldown: 2.4, damage: 90,
    speed: 4.0, spread: 0.04, count: 1, life: 8.0, blastBodies: 1.6, gravityScale: 12,
    colour: [0.55, 1.0, 0.42], size: 0.22,
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
  /** How the renderer should draw it. 'blast' is explosion debris, not a weapon. */
  visual: WeaponId | 'blast';
  /** Flame only: has this particle touched the ground and started flowing along it? */
  grounded?: boolean;
  /**
   * A stable 0..1 value, fixed at birth.
   *
   * The renderer uses it to pick which flame shape this particle is and how fast it spins. It has to
   * be STORED rather than derived from the position, which was the first attempt: a particle moves
   * every frame, so a position-derived seed changes every frame, and the particle would strobe
   * through all sixteen flipbook frames instead of drifting through them.
   */
  seed: number;
}

// --- burning terrain -----------------------------------------------------------------------------

/**
 * A patch of ground left alight where the jet washed over it.
 *
 * Geoff: "leave some flames burning on the terrain for 10-15 seconds". Rather than a second
 * renderer, each patch is an EMITTER that keeps spawning short-lived flame particles straight up,
 * so it draws through the same instanced mesh as everything else and inherits its colour ramp,
 * fade and cost model for free.
 */
interface GroundFire {
  pos: THREE.Vector3;
  /** Local up at the patch, cached — it never moves, so this is computed once. */
  up: THREE.Vector3;
  /** Seconds of burning left. */
  life: number;
  /** Seconds until the next puff. */
  nextEmit: number;
  /** Particle size, captured from whatever lit it, so the emitter needs no world scale passed in. */
  size: number;
}

const groundFires: GroundFire[] = [];
export function getGroundFires(): GroundFire[] { return groundFires; }

/**
 * How many patches may burn at once.
 *
 * A jet lays down contacts continuously, so without a cap a few seconds of sustained fire would
 * carpet the mountain and every one of them would be emitting. 48 is enough to read as a burning
 * hillside; past that the oldest patch is replaced rather than the list growing.
 */
const MAX_GROUND_FIRES = 48;
/** Seconds a patch burns. Geoff asked for 10-15. */
const FIRE_LIFE_MIN = 10;
const FIRE_LIFE_MAX = 15;
/** Chance that one contacting flame particle starts a new patch. Low: contacts are constant. */
const IGNITE_CHANCE = 0.06;
/**
 * Seconds between puffs from one patch.
 *
 * 1.6, up from 0.10, and it is not a look change — it is arithmetic forced by the two below.
 *
 * Geoff: "make the flames burn 2x as tall as they burn now, and much slower... maybe 10% of the
 * current speed." A tenth the speed over twice the distance means each puff lives TWENTY times as
 * long. Emitting at the old rate would put twenty times as many alive at once — about twenty-three
 * thousand particles against a renderer cap of three — so the jet would vanish behind the embers and
 * the cap would silently eat both. The interval scales with the lifetime so the number of flames
 * visible on a burning patch stays where it was; only their pace changes.
 */
const FIRE_EMIT_INTERVAL = 1.6;
/**
 * How fast a resting fire licks, against how fast it used to. Geoff asked for a tenth.
 *
 * A flamethrower JET is still fast — that is the weapon, and it should be violent. This is only the
 * fire left burning behind it, which was rushing upward like a gas ring and should be lazy.
 */
const FIRE_SPEED_MUL = 0.1;
/** ...and twice as tall, which at a tenth the speed means twenty times the lifetime. */
const FIRE_LIFE_MUL = 22;

/** Light a patch of ground, or refresh one that is already burning nearby. */
function igniteGround(pos: THREE.Vector3, up: THREE.Vector3, size: number): void {
  // Merge with a nearby patch instead of stacking dozens in one footprint — that both looks like
  // one bigger fire and keeps the emitter count honest.
  const mergeDist = 1.2;
  for (const f of groundFires) {
    if (f.pos.distanceTo(pos) < mergeDist) {
      f.life = Math.max(f.life, FIRE_LIFE_MIN + rand() * (FIRE_LIFE_MAX - FIRE_LIFE_MIN));
      return;
    }
  }
  const fire: GroundFire = {
    pos: pos.clone(),
    up: up.clone(),
    life: FIRE_LIFE_MIN + rand() * (FIRE_LIFE_MAX - FIRE_LIFE_MIN),
    nextEmit: 0,
    size,
  };
  if (groundFires.length >= MAX_GROUND_FIRES) groundFires.shift();
  groundFires.push(fire);
}

/** Advance the burning patches and emit their flames. Called from stepProjectiles. */
function stepGroundFires(dt: number): void {
  const spec = WEAPONS.flame;
  for (let i = groundFires.length - 1; i >= 0; i--) {
    const f = groundFires[i];
    f.life -= dt;
    if (f.life <= 0) { groundFires.splice(i, 1); continue; }

    f.nextEmit -= dt;
    if (f.nextEmit > 0) continue;
    f.nextEmit = FIRE_EMIT_INTERVAL;

    // Fade the patch out over its last couple of seconds rather than stopping dead.
    const fading = Math.min(1, f.life / 2);
    const puffs = 1 + Math.floor(rand() * 2 * fading);
    for (let k = 0; k < puffs; k++) {
      // Straight up, wandering: a resting fire is buoyancy with almost no forward momentum.
      _dir.copy(f.up).multiplyScalar(0.9 + rand() * 0.6);
      _sideA.set(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1).normalize();
      _dir.addScaledVector(_sideA, 0.25).normalize();
      const life = (0.9 + rand() * 0.7) * FIRE_LIFE_MUL;
      projectiles.push({
        pos: f.pos.clone().addScaledVector(_sideA, (rand() - 0.5) * 0.8),
        vel: _dir.clone().multiplyScalar(spec.speed * (0.06 + rand() * 0.06) * FIRE_SPEED_MUL),
        ownerId: 'ground-fire',
        weapon: 'flame',
        life,
        maxLife: life,
        // NO DAMAGE. Burning terrain is scenery for now; making it hurt would change the balance
        // of every fight without anyone asking for that. The direct jet still ignites Kaiju.
        damage: 0,
        blast: 0,
        colour: spec.colour,
        size: f.size * (0.8 + rand() * 0.8),
        dead: false,
        visual: 'flame', seed: rand(),
        grounded: true,
      });
    }
  }
}

/** Put every fire out — used when an arena is reset, so a new fight starts on cold ground. */
export function clearGroundFires(): void { groundFires.length = 0; }

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
      visual: weapon, seed: rand(),
    });
  }
}

export interface HitTarget {
  id: string;
  /** Centre of mass, roughly half body height above the feet. */
  centre: THREE.Vector3;
  /** Hit radius in units. Only used as the fallback when the model has not loaded. */
  radius: number;
  /** Body height in units, so a fire lit on this creature is sized against IT and not the spark. */
  height: number;
  alive: boolean;
}

export interface HitEvent { targetId: string; ownerId: string; weapon: WeaponId; damage: number }

/**
 * Advance every projectile and report hits.
 *
 * Gravity is applied along the projectile's OWN local up (toward the planet centre), which is what
 * makes ballistics behave correctly on a sphere over the distances a Kaiju cannon covers.
 */
/**
 * Buoyancy of burning gas, as a multiple of gravity.
 *
 * Fire rises because it is hot and therefore less dense than the air around it. That single fact is
 * what makes a jet climb a slope and roll over a ridge instead of pooling at the bottom, so it is
 * the one piece of fluid behaviour worth simulating explicitly. 1.6 means a flame particle
 * accelerates upward at 0.6 g once it is no longer being driven by the nozzle.
 */
const FLAME_BUOYANCY = 1.6;
/** How much speed a flame particle keeps when it washes along the ground, per second. */
const FLAME_GROUND_DRAG = 2.2;
/** Air drag on flame, per second — a jet slows as it entrains cold air, and then buoyancy wins. */
const FLAME_AIR_DRAG = 0.55;
/**
 * Arc distance used to measure the terrain slope, in units.
 *
 * Matches the finest render spacing (0.382 u), so the normal is the slope of the surface actually
 * drawn rather than of some smoother idea of it.
 */
const SLOPE_EPS = 0.4;

const _n = new THREE.Vector3();
const _cityHit = new THREE.Vector3();
const _cityNrm = new THREE.Vector3();
const _fireUp = new THREE.Vector3();
const _t1 = new THREE.Vector3();
const _t2 = new THREE.Vector3();
const _probe = new THREE.Vector3();
const WORLD_Y = new THREE.Vector3(0, 1, 0);

/**
 * The outward normal of the terrain under `pos`, written into `out`.
 *
 * Built from central differences of the ground height across two tangent directions. Costs four
 * extra height lookups, so it is only ever taken for a particle that has ACTUALLY hit something —
 * which is a small fraction of them.
 *
 * Without this, everything would slide along the sphere's tangent plane, which on the face of a
 * mountain is simply the wrong direction: fire would run horizontally into the rock rather than up
 * it. The normal is what turns contact into flow.
 */
function terrainNormal(
  pos: THREE.Vector3, up: THREE.Vector3, groundRadiusAt: (p: THREE.Vector3) => number | null,
  out: THREE.Vector3,
): THREE.Vector3 {
  _t1.crossVectors(up, WORLD_Y);
  if (_t1.lengthSq() < 1e-9) _t1.crossVectors(up, new THREE.Vector3(1, 0, 0));
  _t1.normalize();
  _t2.crossVectors(up, _t1).normalize();

  const sample = (t: THREE.Vector3, s: number): number | null =>
    groundRadiusAt(_probe.copy(pos).addScaledVector(t, s));

  const a1 = sample(_t1, SLOPE_EPS), b1 = sample(_t1, -SLOPE_EPS);
  const a2 = sample(_t2, SLOPE_EPS), b2 = sample(_t2, -SLOPE_EPS);
  // Any missing sample (unstreamed tile) means no usable slope: fall back to straight up, which is
  // correct on flat ground and harmless elsewhere.
  if (a1 == null || b1 == null || a2 == null || b2 == null) return out.copy(up);

  const d1 = (a1 - b1) / (2 * SLOPE_EPS);
  const d2 = (a2 - b2) / (2 * SLOPE_EPS);
  out.copy(up).addScaledVector(_t1, -d1).addScaledVector(_t2, -d2);
  return out.lengthSq() > 1e-12 ? out.normalize() : out.copy(up);
}

export function stepProjectiles(
  dt: number, targets: HitTarget[], groundRadiusAt: (p: THREE.Vector3) => number | null,
  now = 0,
): HitEvent[] {
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
      // BUOYANCY. Flame is hot gas, so it accelerates UPWARD, and that is what carries it up a
      // slope and over a ridge rather than letting it pile against the foot of the hill.
      if (p.weapon === 'flame' || p.visual === 'blast') {
        // BUOYANCY IS LEFT ALONE, and measuring is the only reason I know that.
        //
        // My first attempt cut it to a tenth for resting fires, reasoning that buoyancy is what
        // decides how fast a flame climbs. It is — but drag balances it at about 7 m/s, and the old
        // fire was reaching 118 m in a second and a quarter, which is 94 m/s average. Almost all of
        // that height was the LAUNCH burst, not the climb. Cutting buoyancy as well made the flames
        // SHORTER, 49 m against 118, which is the opposite of what was asked for.
        //
        // So the launch velocity carries the tenth, and buoyancy's own 7 m/s terminal becomes the
        // pace — which is already a fourteenth of what it was, and lazy in exactly the way wanted.
        p.vel.addScaledVector(_up, g * FLAME_BUOYANCY * dt);
        const drag = p.grounded ? FLAME_GROUND_DRAG : FLAME_AIR_DRAG;
        p.vel.multiplyScalar(Math.max(0, 1 - drag * dt));
      }
    }
    // Where it was BEFORE this step. The mesh test is swept along that segment — a point test at
    // the new position would miss a limb entirely, since a flame particle can cross several metres
    // in a frame and a Kaiju's arm is not much thicker than that at this scale.
    _prevPos.copy(p.pos);
    p.pos.addScaledVector(p.vel, dt);
    p.life -= dt;

    let detonate = false;

    // GROUND CONTACT.
    //
    // Flame used to be exempt, on the grounds that a height lookup per particle per frame was too
    // expensive. That was an estimate; scripts/bench-ground-sample measured it at 0.69 microseconds,
    // which is about 1 ms a frame at full flame — 6% of a 60 fps budget, only while firing. Geoff
    // wants the jet to treat terrain as solid, and it costs what it costs.
    // Explosion DEBRIS flows like flame rather than detonating: it is burning wreckage thrown by a
    // blast that has already gone off, so re-detonating it on the first thing it touches is both
    // wrong and, since a grenade lands ON the ground, instantly fatal to the whole effect. It cut
    // the visible explosion from 420 particles to 149, which check-kaiju-arena caught.
    const flows = p.weapon === 'flame' || p.visual === 'blast';

    // BUILDINGS ARE SOLID TO FIRE, AND FIRE STICKS TO THEM.
    //
    // Geoff: "when any kind of flame happens in the game, then buildings should have colliders and
    // the flame should stick to them and burn like it does on the kaijus that are hit by it."
    //
    // The colliders already exist — cityColliders indexes every building as the same rotated box the
    // renderer draws, and raycastCity returns the exact face and its normal. So this is not new
    // geometry, it is the flame finally asking.
    //
    // Swept along the segment the particle just crossed, not tested at its new position: a flame
    // particle covers several metres in a frame and a tower wall is a plane, so a point test would
    // put half the jet inside the building.
    if (flows && !p.grounded) {
      const t = raycastCity(_prevPos, p.pos, _cityHit, _cityNrm);
      if (t != null) {
        // Sit it just proud of the face, kill the velocity going INTO the wall, keep what runs
        // along it — the same rule the terrain uses, which is what makes a jet wash UP a face
        // instead of stopping dead against it.
        p.pos.copy(_cityHit).addScaledVector(_cityNrm, p.size * 0.35);
        const into = p.vel.dot(_cityNrm);
        if (into < 0) p.vel.addScaledVector(_cityNrm, -into * 1.05);
        p.grounded = true;
        if (rand() < IGNITE_CHANCE) {
          // The fire's UP is the planet's, not the wall's. A wall normal would fire the flames out
          // sideways like a blowtorch bolted to the brickwork; fire on a vertical surface still
          // rises, it just hugs the face on the way. The position is on the wall, the buoyancy is up.
          _fireUp.copy(p.pos).normalize();
          igniteGround(p.pos, _fireUp, p.size);
        }
      }
    }

    const gr = groundRadiusAt(p.pos);
    if (gr != null && p.pos.length() <= gr + (flows ? p.size * 0.4 : 0)) {
      if (!flows) {
        detonate = true;
      } else {
        // FLOW, DO NOT STOP. Take away only the velocity going INTO the surface and keep what runs
        // along it, which is what makes the jet wash up the slope and spill around obstacles
        // instead of stopping dead at the point of contact.
        if (len > 1e-6) {
          terrainNormal(p.pos, _up, groundRadiusAt, _n);
          const into = p.vel.dot(_n);
          if (into < 0) p.vel.addScaledVector(_n, -into * 1.05);   // slight lift out of the surface
          // Sit it exactly on the surface rather than inside it.
          p.pos.setLength(gr + p.size * 0.4);
          if (!p.grounded) {
            p.grounded = true;
            // Some of what washes over the ground stays alight behind the jet.
            if (rand() < IGNITE_CHANCE) igniteGround(p.pos, _n, p.size);
          }
        }
      }
    }

    // DIRECT HIT, AGAINST THE REAL MESH. Skip the firer so nobody shoots themselves point blank.
    //
    // This used to be a sphere: `distance to centre <= t.radius + size`, with t.radius the
    // separation capsule. On a 300 m Kaiju that is a ball 136 m across the centre line, so a flame
    // jet stopped and flared 130 m short of the creature's chest — the same invisible wall the
    // rifle rounds had, in the one weapon that was never converted. Geoff found that one too.
    //
    // Now it is the swept segment this particle travelled this frame, against the actual triangles
    // in the pose being drawn. The sphere survives ONLY as the fallback for a model that has not
    // loaded, which is also the headless case.
    if (!detonate) {
      for (const t of targets) {
        if (!t.alive || t.id === p.ownerId) continue;
        const mt = meshRay(t.id, _prevPos, p.pos, now, _hitPt, _hitNrm);
        let struck = false;
        if (mt === -1) {
          struck = p.pos.distanceTo(t.centre) <= t.radius + p.size;
          if (struck) _hitPt.copy(p.pos);
        } else if (mt != null) {
          struck = true;
        }
        if (!struck) continue;
        if (p.blast <= 0) hits.push({ targetId: t.id, ownerId: p.ownerId, weapon: p.weapon, damage: p.damage });
        // FIRE STICKS TO WHAT IT LANDS ON. Geoff: "the flame should burn for some time on the
        // kaiju's mesh... the particular body part needs to burn, and if that kaiju is moving the
        // fire needs to move with them." See kaijuBurn: the patch is nailed to the nearest bone, so
        // a burning shoulder stays a burning shoulder through a walk, a swing and a death.
        if (p.weapon === 'flame' && rand() < MESH_IGNITE_CHANCE) igniteMesh(t.id, _hitPt, t.height);
        detonate = true;
        break;
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
      // The visible blast, for anything that actually goes off. Flame particles simply expire.
      if (p.visual === 'grenade' && detonate) spawnExplosion(p.pos, Math.max(p.blast, 1.2));
      p.dead = true;
    }
  }

  // Burning ground keeps emitting after the jet has moved on. Stepped AFTER the particle loop so
  // this frame's new puffs are not immediately aged by it.
  stepGroundFires(dt);

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

/**
 * Blow a hole in the air: a few hundred particles of wildly varying size and speed.
 *
 * At this scale a "simple explosion" — one expanding sphere, or a dozen puffs — looks like a
 * firework beside something 300 m tall. What sells a blast of this size is the SPREAD OF SCALES
 * in it: a bright fast core, a mass of mid-sized fire, and slow heavy chunks that lag behind and
 * fall. So sizes and speeds are drawn from a wide range rather than jittered around one value,
 * and the slowest particles live longest, which is what leaves a rolling cloud behind.
 *
 * These carry NO damage. The blast has already been resolved by the weapon's radius; this is
 * purely what it looks like, and making the debris damaging would double-count it.
 */
export function spawnExplosion(at: THREE.Vector3, radiusUnits: number, count = 420): void {
  const up = _up.copy(at).normalize();
  for (let i = 0; i < count; i++) {
    // Uniform on a sphere, so the burst is round rather than banded at the poles.
    const z = rand() * 2 - 1;
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    _dir.set(r * Math.cos(a), r * Math.sin(a), z);

    // THE SPREAD OF SCALES. A cubed random gives many small fragments and a few big ones, which is
    // both what a real blast throws and what stops the cloud looking uniform.
    const t = rand();
    const bigness = t * t * t;
    const speed = (0.35 + rand() * 2.4) * radiusUnits * (1 - bigness * 0.65);

    projectiles.push({
      pos: at.clone().addScaledVector(_dir, radiusUnits * 0.12 * rand()),
      // A slight upward bias, so the fireball climbs the way a real one does.
      vel: _dir.clone().multiplyScalar(speed).addScaledVector(up, speed * 0.28),
      ownerId: '',
      weapon: 'grenade',
      // Heavy fragments hang around; light fast ones burn out immediately.
      life: 0.5 + bigness * 2.6 + rand() * 0.8,
      maxLife: 3.9,
      damage: 0,
      blast: 0,
      colour: [1, 0.8, 0.35],
      size: radiusUnits * (0.02 + bigness * 0.20),
      dead: false,
      visual: 'blast', seed: rand(),
    });
  }
}

export function clearProjectiles(): void { projectiles.length = 0; clearGroundFires(); }
