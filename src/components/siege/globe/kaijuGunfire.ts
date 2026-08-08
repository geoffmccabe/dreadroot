// kaijuGunfire — the army shooting at the monster, and it doing absolutely nothing.
//
// Geoff: "add the humans the ability to shoot bullets at the Kaiju... they do no damage... but I
// want to be able to see the muzzle flashes... If another Kaiju is nearby then they shoot at that
// one too and chase it around also. Each human should decide which Kaiju to follow and shoot at."
//
// This is a MOOD system, not a combat system, and it is written that way on purpose. Nothing here
// touches health, damage, aggro or the behaviour tree. The Kaiju does not know it is being shot at.
// That is the point: an army emptying itself into something that does not notice is the oldest and
// best shot in the genre, and it only works if the creature genuinely does not react.
//
// THE BULLETS ARE REAL PROJECTILES. The first version resolved each shot instantly and drew a line
// from the muzzle to the impact, which is what Geoff meant by "too heavy and don't look realistic" —
// a full 400 m line appearing all at once every time anyone fires. Real rounds are simulated:
//
//   * 800 m/s at the muzzle, the ordinary figure for a service rifle.
//   * Quadratic air drag, tuned so a round retains about 60% of its speed at 500 m. That works out
//     to roughly 700 m/s^2 of deceleration at the muzzle — which DWARFS gravity, and is why a rifle
//     bullet drops only about 3 m over that distance.
//   * Gravity toward the planet centre, not toward world -Y, because this is a sphere.
//   * A RICOCHET off the Kaiju: the round reflects off the surface it struck, keeps about a third of
//     its speed, tumbles (so it is thrown well off a mirror bounce), and picks up several times the
//     drag because it is no longer a bullet shape. It arcs, slows and falls, which is what a
//     ricochet actually does.
//
// WHERE IT LANDS is the whole reason this file needed the collider work first. The spark has to sit
// on the arm, the leg or the head that was actually in the way at that instant, which means the hit
// test has to run against the CURRENT ANIMATED POSE. See the note in kaijuColliders.ts on why that
// is bone capsules and not a mesh.

import * as THREE from 'three';
import { getAgents, ARENA_HEIGHT, type Agent } from './kaijuArena';
import {
  limbCapsules, torsoCapsule, shotHitsCapsule, closestOnSegment, type Capsule,
} from './kaijuColliders';
import { METRES_PER_UNIT, PLANET_RADIUS } from './cubeSphere';
import { sampleGlobeSurface } from './globeGround';
// The COSMETIC stream, never the simulation's. See the long note on fxRand: drawing scatter and
// reload times from the shared seeded source silently changed who won the fight.
import { fxRand as rand } from './kaijuRandom';

const M = (metres: number) => metres / METRES_PER_UNIT;

/** Muzzle velocity, 800 m/s. */
const MUZZLE_SPEED = M(800);
/** Gravity, real, toward the planet centre. */
const GRAVITY = M(9.81);
/**
 * Quadratic drag, in inverse game units.
 *
 * Solves to 1/v = 1/v0 + k*t, so this value is set by "how fast is it still going at 500 m": 0.11
 * gives about 480 m/s there, which matches a real 5.56 round closely enough that the drop and the
 * time of flight both come out right without tuning either separately.
 */
const DRAG = 0.11;
/** A deformed, tumbling ricochet is not a bullet shape any more and sheds speed far faster. */
const RICOCHET_DRAG = DRAG * 5;
/** Fraction of speed kept through the bounce. */
const RESTITUTION = 0.34;

/** The muzzle flash. Short: it is a pop, not a lamp. */
export const MUZZLE_LIFE = 0.055;
/** How long a spark burns where a round struck. */
export const SPARK_LIFE = 0.38;
/** Longest a round stays in the world before it is given up on. */
const MAX_LIFE = 3.0;
/** How long a ricochet is followed after it bounces. */
const RICOCHET_LIFE = 1.9;
/**
 * Streak time constant. The visible trail is roughly speed x this, so it is LONG while the round is
 * fast and shortens as it slows — which is what makes a ricochet read as losing energy.
 */
const TRAIL_TAU = 0.10;

/**
 * One round in flight.
 *
 * Pooled and reused: at 200 shooters this is about 36 new rounds a second, each alive for up to
 * three, and a scene that quietly allocates a hundred short-lived vectors a second is a scene with
 * a stutter in it.
 */
export interface Bullet {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  /** The trailing end of the visible streak. Chases `pos`, so the streak stretches with speed. */
  tail: THREE.Vector3;
  /** Where it was fired from, for the muzzle flash. */
  origin: THREE.Vector3;
  age: number;
  live: boolean;
  ricocheted: boolean;
  /**
   * Whether this round leaves a visible streak at all.
   *
   * Only about one round in four. Real belts are loaded roughly one tracer in five for exactly this
   * reason: every round leaving a line turns gunfire into a solid sheet. This is most of the fix for
   * "the bullet lines are too heavy".
   */
  tracer: boolean;
  /** Per-round brightness. Varies per round, which is what stops the volley looking printed on. */
  alpha: number;
  /** Random phase, so the stutter is per-round rather than the whole volley blinking together. */
  flicker: number;
}

/** A hit mark: brief, and left behind wherever a round struck. */
export interface Spark { pos: THREE.Vector3; age: number; live: boolean }

const MAX_BULLETS = 512;
const MAX_SPARKS = 256;

const bullets: Bullet[] = [];
for (let i = 0; i < MAX_BULLETS; i++) {
  bullets.push({
    pos: new THREE.Vector3(), vel: new THREE.Vector3(), tail: new THREE.Vector3(),
    origin: new THREE.Vector3(), age: 0, live: false, ricocheted: false,
    tracer: false, alpha: 0.25, flicker: 0,
  });
}
const sparks: Spark[] = [];
for (let i = 0; i < MAX_SPARKS; i++) sparks.push({ pos: new THREE.Vector3(), age: 0, live: false });

let bCursor = 0;
let sCursor = 0;

/** Live counters, so "are they even shooting?" is answered by looking rather than guessing. */
export const gunfireDiag = { fired: 0, hits: 0, live: 0 };

export function getBullets(): Bullet[] { return bullets; }
export function getSparks(): Spark[] { return sparks; }
export function clearGunfire(): void {
  for (const b of bullets) b.live = false;
  for (const s of sparks) s.live = false;
  gunfireDiag.fired = 0; gunfireDiag.hits = 0; gunfireDiag.live = 0;
}

// Scratch. All of it declared before anything that uses it: a `const` further down the file sits in
// its temporal dead zone until the module finishes evaluating, and this project has already lost an
// afternoon to a white screen from exactly that — tsc passes, the bundle throws.
const _cap: Capsule = { a: new THREE.Vector3(), b: new THREE.Vector3(), radius: 0, part: 'torso' };
const _caps: Capsule[] = [];
const _hitTmp = new THREE.Vector3();
const _prev = new THREE.Vector3();
const _up = new THREE.Vector3();
const _nrm = new THREE.Vector3();
const _axisPt = new THREE.Vector3();
const _centre = new THREE.Vector3();
const _norm2 = new THREE.Vector3();
const _bestCap: Capsule = { a: new THREE.Vector3(), b: new THREE.Vector3(), radius: 0, part: 'torso' };

/**
 * The collider for one Kaiju, as good as is available right now.
 *
 * Limb capsules when the model has loaded and its rig was found — a head, two arms, two legs, each
 * following the real bones. The torso is ALWAYS in the list as well, even when limbs exist: the bone
 * table has no chest pair, so without it the middle of the creature would be a hole every round
 * passed straight through.
 */
function collidersFor(a: Agent, out: Capsule[]): Capsule[] {
  out.length = 0;
  torsoCapsule(a.body.dir, a.body.radius, ARENA_HEIGHT, _cap);
  out.push(_cap);
  for (const c of limbCapsules(a.id)) out.push(c);
  return out;
}

function addSpark(at: THREE.Vector3): void {
  const s = sparks[sCursor];
  sCursor = (sCursor + 1) % MAX_SPARKS;
  s.pos.copy(at);
  s.age = 0;
  s.live = true;
}

/**
 * Fire one round.
 *
 * `aimAt` is where the shooter THINKS it is aiming; how badly a rifleman shoots is the caller's
 * business, because that is a crowd question rather than a ballistics one.
 */
export function fireBullet(from: THREE.Vector3, aimAt: THREE.Vector3): void {
  const b = bullets[bCursor];
  bCursor = (bCursor + 1) % MAX_BULLETS;
  b.pos.copy(from);
  b.origin.copy(from);
  b.tail.copy(from);
  b.vel.copy(aimAt).sub(from);
  if (b.vel.lengthSq() < 1e-12) b.vel.set(0, 1, 0);
  b.vel.normalize().multiplyScalar(MUZZLE_SPEED);
  b.age = 0;
  b.live = true;
  b.ricocheted = false;
  // Half the rounds, not a quarter. Geoff: "now I don't see the lines at all... The effect now is
  // very subtle." Between one-in-four tracers, a 10% floor on opacity and a streak drawn as a
  // one-pixel GL line, the trails had been tuned into invisibility.
  b.tracer = rand() < 0.5;
  b.alpha = 0.30 + rand() * 0.45;
  b.flicker = rand() * 100;
  gunfireDiag.fired++;
}

/**
 * Advance every round. One owner, called once a frame.
 *
 * The hit test is SWEPT — the segment from where the round was to where it now is — rather than a
 * point test at the new position. At 800 m/s a round covers 13 m in a frame, so a point test would
 * miss a thin limb entirely most of the time and hits would look random.
 */
export function stepGunfire(dt: number): void {
  let live = 0;
  const agents = getAgents();

  for (const b of bullets) {
    if (!b.live) continue;
    b.age += dt;
    if (b.age > MAX_LIFE) { b.live = false; continue; }

    _prev.copy(b.pos);

    // Drag first, then gravity, then move. Drag is quadratic, so it is applied against the current
    // speed rather than as a flat fraction.
    const speed = b.vel.length();
    if (speed > 1e-9) {
      const k = b.ricocheted ? RICOCHET_DRAG : DRAG;
      b.vel.multiplyScalar(Math.max(0, 1 - k * speed * dt));
    }
    // Gravity points at the planet centre. On a sphere, using world -Y would send rounds sideways
    // everywhere except one spot on the globe.
    _up.copy(b.pos).normalize();
    b.vel.addScaledVector(_up, -GRAVITY * dt);
    b.pos.addScaledVector(b.vel, dt);

    // The streak's trailing end chases the round, so it stretches when fast and collapses when slow.
    b.tail.lerp(b.pos, 1 - Math.exp(-dt / TRAIL_TAU));

    if (!b.ricocheted) {
      // Which Kaiju, if any, did it cross? Nearest along the path wins, so a round clipping an
      // outstretched arm sparks on the arm rather than the chest behind it.
      let bestT = Infinity;
      let hitAny = false;
      for (const a of agents) {
        if (!a.alive) continue;
        // Cheap reject: a round nowhere near this creature cannot have hit any part of it.
        _centre.copy(a.body.dir).multiplyScalar(a.body.radius + ARENA_HEIGHT * 0.5);
        if (_prev.distanceTo(_centre) > ARENA_HEIGHT * 2.5 + speed * dt) continue;
        for (const c of collidersFor(a, _caps)) {
          const t = shotHitsCapsule(_prev, b.pos, c, _hitTmp);
          if (t == null || t >= bestT) continue;
          bestT = t;
          hitAny = true;
          // COPY the winning capsule. `_cap` is scratch shared by every agent, so holding a
          // reference would mean computing the bounce off whichever creature happened to be checked
          // last rather than off the one that was actually struck.
          _bestCap.a.copy(c.a); _bestCap.b.copy(c.b);
          _bestCap.radius = c.radius; _bestCap.part = c.part;
          _nrm.copy(_hitTmp);
        }
      }

      if (hitAny) {
        addSpark(_nrm);
        gunfireDiag.hits++;
        // Surface normal at the impact: straight out from the capsule's own axis. Two separate
        // vectors, because writing the impact point into the same one used for the axis point
        // subtracts it from itself and gives a normal of exactly zero.
        closestOnSegment(_bestCap.a, _bestCap.b, _nrm, _axisPt);
        const n = _norm2.copy(_nrm).sub(_axisPt);
        if (n.lengthSq() < 1e-12) n.copy(_up); else n.normalize();
        // Reflect, keep a third of the speed, and throw it well off the mirror angle. Real ricochets
        // are chaotic; a clean reflection reads as a snooker ball rather than as a bullet coming
        // apart on armour plate.
        b.vel.addScaledVector(n, -2 * b.vel.dot(n)).multiplyScalar(RESTITUTION);
        b.vel.x += (rand() * 2 - 1) * MUZZLE_SPEED * 0.10;
        b.vel.y += (rand() * 2 - 1) * MUZZLE_SPEED * 0.10;
        b.vel.z += (rand() * 2 - 1) * MUZZLE_SPEED * 0.10;
        b.pos.copy(_nrm).addScaledVector(n, M(2));
        b.tail.copy(b.pos);
        b.ricocheted = true;
        b.age = Math.max(0, MAX_LIFE - RICOCHET_LIFE);
        // A ricochet is a bright, tumbling fragment — visible even when the round that made it
        // was not, which is exactly how it looks in real footage.
        b.tracer = true;
        b.alpha = 0.45 + rand() * 0.35;
        live++;
        continue;
      }
    } else {
      // Ricochets bury themselves in the ground. Only checked after the bounce: an incoming round is
      // aimed upward at a 300 m creature and would never meet the terrain on the way in.
      const len = b.pos.length();
      if (len > 1e-6) {
        const gm = sampleGlobeSurface(b.pos.x / len, b.pos.y / len, b.pos.z / len);
        if (gm != null && len < PLANET_RADIUS + gm / METRES_PER_UNIT) {
          addSpark(b.pos);
          b.live = false;
          continue;
        }
      }
    }
    live++;
  }

  for (const s of sparks) {
    if (!s.live) continue;
    s.age += dt;
    if (s.age > SPARK_LIFE) s.live = false;
  }
  gunfireDiag.live = live;
}

/**
 * Pick which Kaiju a person is going to follow and shoot at.
 *
 * Not simply "the nearest": two hundred people all choosing the nearest target is two hundred people
 * standing in one clump, and the moment a second Kaiju walks past they all switch at once, which
 * reads as a flock rather than as a crowd. So it is mostly-nearest with a real chance of picking
 * someone else — a soldier who has committed to a target and is not re-evaluating it.
 */
export function chooseTarget(dir: THREE.Vector3, previous: string | null): string | null {
  const alive = getAgents().filter((a) => a.alive);
  if (!alive.length) return null;
  if (previous && alive.some((a) => a.id === previous) && rand() < 0.75) return previous;
  if (rand() < 0.65) {
    let best = alive[0];
    let bestD = Infinity;
    for (const a of alive) {
      const d = dir.angleTo(a.body.dir);
      if (d < bestD) { bestD = d; best = a; }
    }
    return best.id;
  }
  return alive[Math.floor(rand() * alive.length)].id;
}

/**
 * Where on a Kaiju a rifleman aims.
 *
 * 0.22 of a body height, which is 66 m of scatter on a creature 300 m tall and about 200 m wide.
 * It was 0.9 — 270 m — and Geoff was right that it did not look like aiming: at that spread the
 * rounds went anywhere in a box three times the width of the target. The point of the scatter is to
 * spread hits over the arms, legs and head rather than stacking them all on one spot in the chest,
 * and it only takes a fraction of the body to do that.
 */
export function aimPoint(target: Agent, out: THREE.Vector3): THREE.Vector3 {
  const SCATTER = ARENA_HEIGHT * 0.22;
  out.copy(target.body.dir).multiplyScalar(target.body.radius + ARENA_HEIGHT * 0.55);
  out.x += (rand() * 2 - 1) * SCATTER;
  out.y += (rand() * 2 - 1) * SCATTER;
  out.z += (rand() * 2 - 1) * SCATTER;
  return out;
}

/** Seconds until this person fires again. Geoff asked for one shot every 1-10 seconds. */
export function nextShotDelay(): number { return 1 + rand() * 9; }

/** A rifle muzzle sits about here on a 1.8 m person, in game units. */
export const MUZZLE_UP_UNITS = M(1.4);
export const MUZZLE_FWD_UNITS = M(0.45);
