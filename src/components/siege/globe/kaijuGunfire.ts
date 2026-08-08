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
// WHAT A BULLET IS HERE. Not a projectile. A projectile would need to be stepped, stored and
// collided every frame, 36 times a second, for as long as the crowd exists. A rifle bullet crosses
// 500 m in under a second and is invisible for all of it, so it is resolved INSTANTLY — one
// segment-vs-capsule test at the moment of firing — and what is kept is the visible aftermath: a
// muzzle flash, a tracer that fades in a tenth of a second, and a spark where it landed.
//
// WHERE IT LANDS is the whole reason this file needed the collider work first. The spark has to sit
// on the arm, the leg or the head that was actually in the way at that instant, which means the hit
// test has to run against the CURRENT ANIMATED POSE. See the note in kaijuColliders.ts on why that
// is bone capsules and not a mesh.

import * as THREE from 'three';
import { getAgents, ARENA_HEIGHT, type Agent } from './kaijuArena';
import { limbCapsules, torsoCapsule, shotHitsCapsule, type Capsule } from './kaijuColliders';
import { METRES_PER_UNIT } from './cubeSphere';
// The COSMETIC stream, never the simulation's. See the long note on fxRand: drawing scatter and
// reload times from the shared seeded source silently changed who won the fight.
import { fxRand as rand } from './kaijuRandom';

/** How long a tracer streak is visible. Real tracers read as a line because the eye smears them. */
export const TRACER_LIFE = 0.11;
/** The muzzle flash. Shorter than the tracer: it is a pop, not a glow. */
export const MUZZLE_LIFE = 0.055;
/** How long a spark burns on the Kaiju's hide. Long enough to see, short enough to stay a spark. */
export const SPARK_LIFE = 0.38;

/**
 * One shot, from the trigger to the last ember. Everything about it is decided when it is fired.
 *
 * Pooled and reused: at 200 shooters this allocates about 36 of these a second, and a scene that
 * quietly generates a thousand short-lived vectors a second is a scene with a stutter in it.
 */
export interface Shot {
  from: THREE.Vector3;
  to: THREE.Vector3;
  /** Where it struck a Kaiju. Only meaningful when `part` is set — a miss leaves it stale. */
  hit: THREE.Vector3;
  /**
   * Which body part took it, or null for a miss. THIS is the "did it connect" flag, not `hit`:
   * the vector is pooled and never cleared, so reading it as an optional would resurrect the
   * previous shot's impact point every time somebody missed.
   */
  part: Capsule['part'] | null;
  age: number;
  live: boolean;
}

/**
 * Ceiling on shots in flight at once.
 *
 * 200 people firing every 1-10 seconds average about 36 a second; nothing lives past SPARK_LIFE, so
 * roughly 14 are alive at any moment. 256 is eight times headroom and costs one small array.
 */
const MAX_SHOTS = 256;

const pool: Shot[] = [];
for (let i = 0; i < MAX_SHOTS; i++) {
  pool.push({
    from: new THREE.Vector3(), to: new THREE.Vector3(), hit: new THREE.Vector3(),
    part: null, age: 0, live: false,
  });
}
let cursor = 0;

/** Live counters, so "are they even shooting?" is answered by looking rather than guessing. */
export const gunfireDiag = { fired: 0, hits: 0, live: 0, limbRigs: 0 };

export function getShots(): Shot[] { return pool; }
export function clearGunfire(): void {
  for (const s of pool) s.live = false;
  gunfireDiag.fired = 0; gunfireDiag.hits = 0; gunfireDiag.live = 0;
}

// A PLAIN LITERAL, not `torsoCapsule(...)`. Calling an imported function at module-evaluation time
// means depending on another module having finished evaluating, and when the bundler orders things
// differently from the source it throws before React ever mounts — a white screen that tsc cannot
// see. It gets overwritten on first use anyway, so the initial contents are irrelevant.
const _cap: Capsule = {
  a: new THREE.Vector3(), b: new THREE.Vector3(), radius: 0, part: 'torso',
};
const _pt = new THREE.Vector3();

/**
 * The collider for one Kaiju, as good as is available right now.
 *
 * Limb capsules when the model has loaded and its rig was found — a head, two arms, two legs, each
 * following the real bones. The torso capsule otherwise, which is always available and is what the
 * simulation itself separates on. A bullet fired one frame before a model finishes loading still
 * hits something sensible instead of sailing through.
 */
function collidersFor(a: Agent, out: Capsule[]): Capsule[] {
  out.length = 0;
  const limbs = limbCapsules(a.id);
  // The torso is ALWAYS in the list, even when limbs exist: the bone capsules cover arms, legs and
  // head but there is no chest bone pair in the table, so without this the middle of the creature
  // would be a hole every bullet passed straight through.
  torsoCapsule(a.body.dir, a.body.radius, ARENA_HEIGHT, _cap);
  out.push(_cap);
  for (const c of limbs) out.push(c);
  return out;
}

const _caps: Capsule[] = [];
// Declared BEFORE the function that uses it. A `const` further down the file is in its temporal
// dead zone until the module finishes evaluating, and this project has already lost an afternoon to
// a white screen from exactly that — tsc passes, the bundle throws. See the TDZ note in the docs.
const _hitTmp = new THREE.Vector3();

/**
 * Fire one bullet. Resolves the hit immediately and records what should be drawn.
 *
 * `aimAt` is where the shooter THINKS it is aiming; scatter is the caller's business, because how
 * badly a panicking rifleman shoots is a crowd question, not a ballistics one.
 */
export function fireBullet(from: THREE.Vector3, aimAt: THREE.Vector3): void {
  const s = pool[cursor];
  cursor = (cursor + 1) % MAX_SHOTS;
  s.from.copy(from);
  s.to.copy(aimAt);
  s.age = 0;
  s.live = true;
  s.part = null;

  // Nearest hit along the shot wins, so a bullet that clips an outstretched arm sparks on the arm
  // rather than on the chest behind it.
  let bestT = Infinity;
  let bestPart: Capsule['part'] | null = null;
  const best = _pt.set(0, 0, 0);
  for (const a of getAgents()) {
    if (!a.alive) continue;
    const caps = collidersFor(a, _caps);
    for (const c of caps) {
      const t = shotHitsCapsule(s.from, s.to, c, _hitTmp);
      if (t == null || t >= bestT) continue;
      bestT = t;
      bestPart = c.part;
      best.copy(_hitTmp);
    }
  }

  if (bestPart) {
    s.hit.copy(best);
    s.part = bestPart;
    // Stop the tracer AT the impact. A streak that carries on past the body it just hit is the
    // single most obvious tell that nothing was really tested.
    s.to.copy(best);
    gunfireDiag.hits++;
  } else {
    s.part = null;
  }
  gunfireDiag.fired++;
}

/** Age everything and retire what has burnt out. One owner, called once a frame. */
export function stepGunfire(dt: number): void {
  let live = 0;
  for (const s of pool) {
    if (!s.live) continue;
    s.age += dt;
    if (s.age > SPARK_LIFE) { s.live = false; continue; }
    live++;
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
  // Stay with a target that is still standing most of the time. Constant re-targeting is what makes
  // AI crowds look like they are being remote-controlled.
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
 * Where on a Kaiju a rifleman aims, with the miss already baked in.
 *
 * They aim centre-mass and mostly connect, but the scatter is deliberately generous — a bit over a
 * third of a body height — for two reasons. Some shots have to MISS, or the effect is a laser show
 * rather than gunfire. And spreading the hits over the whole creature is what puts sparks on an arm,
 * a leg and the head instead of all of them on one spot in the middle of the chest.
 */
export function aimPoint(target: Agent, out: THREE.Vector3): THREE.Vector3 {
  // 0.9 of a body height, not 0.38. At 0.38 the aim point could never leave the torso capsule, so
  // every single round connected — measured, 200 out of 200 — and an army that never misses reads
  // as a laser show. Widened until roughly a third of the rounds streak past, which is what makes
  // the ones that DO land feel like hits.
  const SCATTER = ARENA_HEIGHT * 0.9;
  out.copy(target.body.dir).multiplyScalar(target.body.radius + ARENA_HEIGHT * 0.55);
  out.x += (rand() * 2 - 1) * SCATTER;
  out.y += (rand() * 2 - 1) * SCATTER;
  out.z += (rand() * 2 - 1) * SCATTER;
  return out;
}

/** Seconds until this person fires again. Geoff asked for one shot every 1-10 seconds. */
export function nextShotDelay(): number { return 1 + rand() * 9; }

/** A rifle muzzle sits about here on a 1.8 m person, in game units. */
export const MUZZLE_UP_UNITS = 1.4 / METRES_PER_UNIT;
export const MUZZLE_FWD_UNITS = 0.45 / METRES_PER_UNIT;
