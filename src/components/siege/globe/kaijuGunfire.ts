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
import { getAgents, ARENA_HEIGHT, arenaClock, type Agent } from './kaijuArena';
import {
  limbCapsules, torsoCapsule, shotHitsCapsule, closestOnSegment, bulletTorsoFrac, playerVisual,
  type Capsule,
} from './kaijuColliders';
import { METRES_PER_UNIT, PLANET_RADIUS } from './cubeSphere';
import { sampleGlobeSurface } from './globeGround';
import { ensureCityColliders, raycastCity } from './cityColliders';
import { beginMeshHitFrame } from './kaijuMeshHit';
import { meshRay } from './kaijuMeshSeparate';

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
/**
 * A ricochet is a deformed, tumbling lump, not a bullet, and it sheds speed enormously faster.
 *
 * 12x. Drag scales with frontal area and with the drag coefficient: a bullet flying point-first has
 * a coefficient around 0.3 and presents its 5.7 mm nose; the same bullet tumbling sideways after
 * flattening on armour presents several times the area at a coefficient near 1. An order of
 * magnitude is the physically honest figure, not a fudge for the look — and it is also what makes
 * the arc visible, because a fragment still doing 200 m/s travels in a straight line and gravity has
 * nothing to work with until it is down to a few tens of metres a second.
 */
const RICOCHET_DRAG = DRAG * 12;
/**
 * Fraction of speed kept through the bounce.
 *
 * Measured ricochet studies put the retained velocity of a rifle round off hard steel at roughly a
 * quarter to a half, depending almost entirely on how shallow the strike is. 0.28 sits in that band
 * and toward the lossy end, which is right for a round striking something close to head-on.
 */
const RESTITUTION = 0.28;

/** The muzzle flash. Short: it is a pop, not a lamp. */
export const MUZZLE_LIFE = 0.055;
/** How long a spark burns where a round struck. */
export const SPARK_LIFE = 0.38;
/**
 * Longest a round stays in the world before it is given up on.
 *
 * 9 seconds, not 3. Geoff: "the bullets appear to be straight lines that don't arc with gravity...
 * they just disappear after a certain distance."
 *
 * The physics was already right and the arc was already there — the round was simply being deleted
 * before it could happen. A rifle round starts at 800 m/s, where drag is roughly seventy times
 * stronger than gravity, so the first part of its flight IS very nearly a straight line: that is why
 * a real bullet drops about three metres over five hundred. The parabola only appears once drag has
 * bled the speed away and gravity is the bigger force, and at 3 seconds the round was still doing
 * 220 m/s with a couple of kilometres left to travel. It vanished in mid-air, at the exact moment it
 * was about to start curving.
 *
 * Now every round flies until it BURIES ITSELF IN THE GROUND — the whole arc, and a puff of dirt
 * wherever it lands. Which is also the honest answer to how far a stray round carries.
 *
 * 20 seconds is the backstop, not the expected life, and it was measured rather than picked: a round
 * aimed up at a 300 m creature and missing reaches an apex around 620 m at nine seconds and needs
 * roughly another twelve to come down, landing 2.4 km out. At 9 it was still being deleted in mid-air — at the top of the
 * arc, which is the one moment the curve is obvious. A real rifle round fired at that elevation
 * carries about three kilometres and is in the air for a comparable time, so this is not generous.
 */
const MAX_LIFE = 24.0;
/** How long a ricochet is followed after it bounces. */
const RICOCHET_LIFE = 2.6;
/**
 * Streak length, expressed as seconds of travel: the trail is (speed x this) long, so it stretches
 * when the round is fast and collapses as it slows.
 *
 * 0.20 gives about 160 m at muzzle speed — twice what it was, as asked.
 *
 * It is now derived from VELOCITY. It used to be the time constant of a lag filter chasing the
 * round, which had a fatal flaw: for the first fifth of a second after firing the trail had not
 * caught up yet, so the streak was SHORTER THAN IT WAS WIDE. Geoff: "they are now wide rectangles
 * that don't make sense." A round only flies for about half a second, so a good part of every shot
 * looked like a floating brick. Measuring back along the velocity means it is the right length on
 * the very first frame.
 */
const TRAIL_SECONDS = 0.20;

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
export interface Spark {
  pos: THREE.Vector3;
  /** Outward surface normal at the impact, so the flash can be lifted clear of the skin. */
  nrm: THREE.Vector3;
  /**
   * What was struck. A round off a Kaiju throws a bright white spark; a round into the dirt throws
   * a dull, smaller puff. Drawing both the same makes a battlefield where the ground and the monster
   * look equally worth shooting at.
   */
  kind: 'hide' | 'dirt' | 'wall';
  /**
   * Set on creation, cleared by whoever reacts to it. The renderer uses it to fire the impact sound
   * exactly once per hit.
   *
   * THE SOUND CANNOT BE PLAYED FROM HERE. This module is the simulation and is verified headless;
   * the audio reaches the browser's AudioContext and, through it, the app's environment config. One
   * import of it turned every gunfire check into a crash about a missing Supabase URL. The split is
   * the same one the rest of this folder keeps: the simulation decides WHAT happened, the renderer
   * decides what that sounds like.
   */
  fresh: boolean;
  age: number;
  live: boolean;
}

// 1024, since rounds now live three times as long: about thirty-six are fired a second and the
// longest-lived reach nine, so roughly 320 are in the air at once during sustained fire.
const MAX_BULLETS = 1024;
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
for (let i = 0; i < MAX_SPARKS; i++) {
  sparks.push({
    pos: new THREE.Vector3(), nrm: new THREE.Vector3(0, 1, 0),
    kind: 'hide', fresh: false, age: 0, live: false,
  });
}

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
const _weights: number[] = [];
const _norm2 = new THREE.Vector3();
const _wallP = new THREE.Vector3();
const _wallN = new THREE.Vector3();
const _bestCap: Capsule = { a: new THREE.Vector3(), b: new THREE.Vector3(), radius: 0, part: 'torso' };
const _meshPt = new THREE.Vector3();
const _meshNrm = new THREE.Vector3();
const _faceNormal = new THREE.Vector3();
const _broad: Capsule = { a: new THREE.Vector3(), b: new THREE.Vector3(), radius: 0, part: 'torso' };
let _haveFaceNormal = false;

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
  // WHICH CREATURE IS ACTUALLY ON SCREEN.
  //
  // For the player these are TWO DIFFERENT THINGS and I had been reading the wrong one. The agent's
  // build says which breed you were dealt; the Kaiju LAB says which model is being drawn and how
  // tall it is — and the lab is what `[` `]` and `-` `=` change. Cycle to a different Kaiju and the
  // collider stayed shaped like the one you left, sitting in mid-air in front of the one you are
  // looking at. Reading the lab for the player means the hit test and the mesh cannot disagree.
  const lab = a.isPlayer && playerVisual.type >= 0 ? playerVisual : null;
  const height = lab ? lab.height : ARENA_HEIGHT;
  const type = lab ? lab.type : a.monsterType;
  torsoCapsule(a.body.dir, a.body.radius, height, _cap, bulletTorsoFrac(type));
  out.push(_cap);
  for (const c of limbCapsules(a.id)) out.push(c);
  return out;
}

function addSpark(at: THREE.Vector3, normal: THREE.Vector3 | null, kind: Spark['kind']): void {
  const s = sparks[sCursor];
  sCursor = (sCursor + 1) % MAX_SPARKS;
  s.pos.copy(at);
  if (normal) s.nrm.copy(normal); else s.nrm.copy(at).normalize();
  s.kind = kind;
  s.fresh = true;
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
  b.alpha = 0.45 + rand() * 0.55;   // 50% brighter than before, as asked
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
/** Frame counter, so the terrain test can be spread across frames rather than run for every round. */
let groundTick = 0;

export function stepGunfire(dt: number): void {
  groundTick++;
  // Built once when the city loads; false everywhere there is no city, which is everywhere but one.
  const cityReady = ensureCityColliders();
  beginMeshHitFrame();
  let live = 0;
  const agents = getAgents();
  // One ground reference for the whole frame, from whoever is standing on it.
  let groundRef = 0;
  for (const a of agents) { if (a.alive) { groundRef = a.body.radius; break; } }

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

    // The streak is the last TRAIL_SECONDS of travel, laid back along the line of flight. Never
    // longer than the round has actually flown, so a fresh shot does not appear with a trail
    // reaching back through the rifleman who fired it.
    {
      const sp = b.vel.length();
      const back = Math.min(sp * TRAIL_SECONDS, b.pos.distanceTo(b.origin));
      if (sp > 1e-9) b.tail.copy(b.pos).addScaledVector(b.vel, -back / sp);
      else b.tail.copy(b.pos);
    }

    if (!b.ricocheted) {
      // Which Kaiju, if any, did it cross? Nearest along the path wins, so a round clipping an
      // outstretched arm sparks on the arm rather than the chest behind it.
      let bestT = Infinity;
      let hitAny = false;
      for (const a of agents) {
        if (!a.alive) continue;

        // BROAD PHASE, AND IT HAS TO BE TIGHT.
        //
        // This was a point test at 750 m, which during sustained fire from a crowd standing 350 m
        // away passes for DOZENS of rounds every frame — far more than the ray budget below allows.
        // Everything past the budget was then skipped outright, so most rounds were never tested at
        // all and simply flew through. That is Geoff's "they don't seem to hit the kaiju all the
        // time", and it is why it looked random: which rounds got tested depended on the order they
        // happened to sit in the pool.
        //
        // A SEGMENT test against a sphere that actually fits the creature (190 m for a 300 m body)
        // passes for the one or two rounds a frame that could genuinely connect, which is what makes
        // the budget irrelevant instead of load-bearing.
        _centre.copy(a.body.dir).multiplyScalar(a.body.radius + ARENA_HEIGHT * 0.5);
        _broad.a.copy(_centre); _broad.b.copy(_centre);
        _broad.radius = ARENA_HEIGHT * 0.65;
        if (shotHitsCapsule(_prev, b.pos, _broad, _hitTmp) == null) continue;

        // THE REAL MESH, when there is one. Exact triangles in the pose being drawn, and the exact
        // surface normal of the face struck — which is what makes both the spark position and the
        // ricochet direction true rather than approximated. See kaijuMeshHit.
        // THE REAL TRIANGLES, through the posed search tree that separation already maintains.
        //
        // This used to go through three.js's own skinned raycast, which walks every triangle and
        // re-skins it — about ninety thousand matrix multiplies per ray. That needed a budget of
        // eight rays a frame, and WHEN THE BUDGET RAN OUT IT FELL BACK TO THE CAPSULE. Two hundred
        // soldiers spend eight rays instantly, so nearly every round was stopped by a shape fatter
        // than the creature and sparked in open air — a shell of sparks in the shape of a cylinder,
        // which is exactly what Geoff was looking at. There is no budget now because there is no
        // longer anything to budget: a ray through the tree costs microseconds.
        const mt = meshRay(a.id, _prev, b.pos, arenaClock(), _meshPt, _meshNrm);
        if (mt !== -1) {
          if (mt != null && mt < bestT) {
            bestT = mt;
            hitAny = true;
            _nrm.copy(_meshPt);
            _faceNormal.copy(_meshNrm);
            _haveFaceNormal = true;
          }
          // A mesh that reported no hit means the round genuinely MISSED. Falling through to the
          // capsule here is what built the invisible wall in the first place.
          continue;
        }

        // No model loaded (or the frame's ray budget is spent): capsules, as before.
        for (const c of collidersFor(a, _caps)) {
          const t = shotHitsCapsule(_prev, b.pos, c, _hitTmp);
          if (t == null || t >= bestT) continue;
          bestT = t;
          hitAny = true;
          _bestCap.a.copy(c.a); _bestCap.b.copy(c.b);
          _bestCap.radius = c.radius; _bestCap.part = c.part;
          _nrm.copy(_hitTmp);
          _haveFaceNormal = false;
        }
      }

      if (hitAny) {
        gunfireDiag.hits++;
        // Surface normal at the impact: straight out from the capsule's own axis. Two separate
        // vectors, because writing the impact point into the same one used for the axis point
        // subtracts it from itself and gives a normal of exactly zero.
        let n: THREE.Vector3;
        if (_haveFaceNormal) {
          // The triangle's own normal. A round striking a sloped shoulder deflects off that slope,
          // which is the entire reason for doing this against the mesh rather than a cylinder.
          n = _norm2.copy(_faceNormal);
        } else {
          closestOnSegment(_bestCap.a, _bestCap.b, _nrm, _axisPt);
          n = _norm2.copy(_nrm).sub(_axisPt);
          if (n.lengthSq() < 1e-12) n.copy(_up); else n.normalize();
        }
        // The spark is created AFTER the normal exists, so it can be lifted off the skin at draw
        // time. Created before, it had no normal and there was nothing to lift it with.
        addSpark(_nrm, n, 'hide');
        // Reflect, keep a third of the speed, and throw it well off the mirror angle. Real ricochets
        // are chaotic; a clean reflection reads as a snooker ball rather than as a bullet coming
        // apart on armour plate.
        b.vel.addScaledVector(n, -2 * b.vel.dot(n)).multiplyScalar(RESTITUTION);
        b.vel.x += (rand() * 2 - 1) * MUZZLE_SPEED * 0.10;
        b.vel.y += (rand() * 2 - 1) * MUZZLE_SPEED * 0.10;
        b.vel.z += (rand() * 2 - 1) * MUZZLE_SPEED * 0.10;
        b.pos.copy(_nrm).addScaledVector(n, M(2));
        b.tail.copy(b.pos);
        // The trail is measured from the BOUNCE now. Without this the ricochet's streak would still
        // be anchored to the rifle and stretch back across the whole battlefield.
        b.origin.copy(b.pos);
        b.ricocheted = true;
        b.age = Math.max(0, MAX_LIFE - RICOCHET_LIFE);
        // A ricochet is a bright, tumbling fragment — visible even when the round that made it
        // was not, which is exactly how it looks in real footage.
        b.tracer = true;
        b.alpha = 0.68 + rand() * 0.32;
        live++;
        continue;
      }
    }

    // THE DIRT. Every round that comes down finds the ground, not just the ones that bounced.
    //
    // Geoff: "They should also make a small flash when they hit the terrain." This used to run only
    // AFTER a ricochet, on the reasoning that an incoming round is aimed upward at a 300 m creature
    // and would never meet the terrain on the way in — which is true of the ones that HIT. The ones
    // that miss carry on over its shoulder and land somewhere, and those are the rounds that make a
    // battlefield look like a battlefield.
    // --- CONCRETE ---------------------------------------------------------------------------
    //
    // Geoff: "their bullets hit the buildings... When bullets hit buildings, they can just make an
    // impact star-shape."
    //
    // Tested every frame rather than staggered, and after the Kaiju rather than before: a round
    // passing a tower and striking the creature behind it has hit the CREATURE, and a stagger here
    // would let rounds slip through a wall on the frames it was skipped. The city test is a grid
    // lookup and a handful of slab tests, which is cheap enough to simply always do.
    //
    // No ricochet off a building. A round that hits concrete head-on buries itself; the ones that
    // spray back off armour are the ones worth animating, and every wall in Dubai throwing sparks
    // in all directions would bury the Kaiju's own hits in noise.
    if (cityReady) {
      const t = raycastCity(_prev, b.pos, _wallP, _wallN);
      if (t != null) {
        addSpark(_wallP, _wallN, 'wall');
        b.live = false;
        continue;
      }
    }

    //
    // STAGGERED, one round in three per frame. A terrain sample walks the patch index to find which
    // piece of ground was actually drawn under a direction, and doing that for two hundred rounds
    // sixty times a second is real work for an effect nobody is grading frame by frame. Rounds are
    // spread across three frames by index, so the cost is a third and the worst error is a puff of
    // dirt landing two frames late.
    // ...and only for rounds that are plausibly NEAR the ground. Three hundred rounds are in the air
    // during sustained fire and most of them are hundreds of metres up in the middle of their arc,
    // where the terrain cannot possibly matter. The reference is a living Kaiju's own radius, with a
    // generous margin, so it is still correct over ground as broken as the Grand Canyon.
    const lowEnough = groundRef > 0 && b.pos.length() < groundRef + ARENA_HEIGHT * 2.6;
    if (lowEnough && (groundTick + b.flicker) % 6 < 1) {
      const len = b.pos.length();
      if (len > 1e-6) {
        const gm = sampleGlobeSurface(b.pos.x / len, b.pos.y / len, b.pos.z / len);
        if (gm != null && len < PLANET_RADIUS + gm / METRES_PER_UNIT) {
          _up.copy(b.pos).normalize();
          addSpark(b.pos, _up, 'dirt');
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
 * Pick which Kaiju a person is going to follow and shoot at, by how close it is.
 *
 * Geoff: "They should pick the closest Kaiju and shoot at it. If a Kaiju gets within shooting
 * distance, then there should be a reasonable chance that any soldier will start to fire at the
 * other one... the closer the kaiju, the more likely they will choose it."
 *
 * So this is a WEIGHTED draw rather than a nearest-wins rule or a coin flip. Each Kaiju's weight
 * falls off with the cube of its distance, which produces exactly the behaviour described: the one
 * standing on top of you takes nearly all the fire, a second one walking in starts pulling a trickle
 * as soon as it is in range, and that trickle becomes the majority as it closes. At equal distance
 * they split evenly, which is what stops the crowd behaving as one animal.
 *
 * The exponent is the whole design, and it was MEASURED rather than picked. At 3 the falloff is so
 * steep that a Kaiju anywhere past six body heights draws literally nothing, so there is no gradient
 * to see until it is already on top of you — check-kaiju-gunfire caught that by walking one in and
 * watching the share. At 2.5 the share runs roughly 0.5%, 1%, 3%, 15%, 50% as it closes from twelve
 * body heights to one, which is the behaviour asked for: a trickle that becomes the majority.
 */
const FALLOFF_POWER = 2.5;
/**
 * Closest a Kaiju is allowed to count as, in body heights.
 *
 * A soldier can end up standing AT a Kaiju's feet, and dividing by nearly zero there makes that one
 * creature take literally every shot on the map — the gradient collapses and the behaviour Geoff
 * asked for disappears at exactly the moment it matters most.
 *
 * 0.9 body heights is 270 m. It has to sit well inside the 2.78 body-height engagement range or
 * there is no room left for a gradient AT ALL: at 1.5 the whole usable band was 1.5 to 2.78 and
 * every target came out roughly equally likely. The crowd also now keeps a standoff of about one
 * body height, so this is close to the nearest anybody actually gets.
 */
const MIN_BODIES = 0.9;
/**
 * How far a rifleman can actually reach, DERIVED from the round he is firing.
 *
 * Geoff: "they shouldn't shoot at a kaiju that they can't hit with a bullet... we know the bullet
 * velocity and so you can estimate it and use that."
 *
 * With quadratic drag, dv/dx = -k*v, so speed decays as v = v0 * e^(-k*x) and the range at which a
 * round has fallen to any given fraction of muzzle speed is exactly ln(1/fraction)/k. At 40% — about
 * 320 m/s, below which a rifle round is no longer worth aiming at anything — that is 833 m. Which is
 * also, satisfyingly, the published maximum effective range of 5.56 NATO on an area target.
 *
 * So this is not a tuned number. Change the muzzle velocity or the drag and the soldiers' willingness
 * to open fire follows on its own.
 */
const RANGE_SPEED_FRAC = 0.4;
export const MAX_RANGE_UNITS = Math.log(1 / RANGE_SPEED_FRAC) / DRAG;

export function chooseTarget(dir: THREE.Vector3, _previous?: string | null): string | null {
  const alive = getAgents().filter((a) => a.alive);
  if (!alive.length) return null;

  let total = 0;
  _weights.length = 0;
  for (const a of alive) {
    // Great-circle distance along the surface, in body heights.
    const bodies = (dir.angleTo(a.body.dir) * a.body.radius) / ARENA_HEIGHT;
    const d = Math.max(MIN_BODIES, bodies);
    // Out of reach is out of the draw entirely. A soldier emptying a magazine at something a mile
    // and a half away is not aiming, and it is most of why the fire looked scattered.
    const distUnits = bodies * ARENA_HEIGHT;
    const w = distUnits > MAX_RANGE_UNITS ? 0 : 1 / Math.pow(d, FALLOFF_POWER);
    _weights.push(w);
    total += w;
  }
  // Nothing in range: keep shooting at the nearest anyway rather than standing there doing nothing.
  if (total <= 0) {
    let best = alive[0];
    let bestD = Infinity;
    for (const a of alive) {
      const d = dir.angleTo(a.body.dir);
      if (d < bestD) { bestD = d; best = a; }
    }
    return best.id;
  }

  let roll = rand() * total;
  for (let i = 0; i < alive.length; i++) {
    roll -= _weights[i];
    if (roll <= 0) return alive[i].id;
  }
  return alive[alive.length - 1].id;
}

/**
 * Seconds until a soldier reconsiders who to shoot at. Geoff asked for about ten.
 *
 * Jittered, because two hundred people re-evaluating on the same tick makes the whole field switch
 * targets at once — which is the flock behaviour this weighting exists to avoid, just on a ten
 * second cycle instead of every frame.
 */
export function nextRetargetDelay(): number { return 7 + rand() * 6; }

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

/** Is this Kaiju close enough that a bullet would still arrive with something left? */
export function inRange(dir: THREE.Vector3, target: Agent): boolean {
  return dir.angleTo(target.body.dir) * target.body.radius <= MAX_RANGE_UNITS;
}

/** Seconds until this person fires again. Geoff asked for one shot every 1-10 seconds. */
export function nextShotDelay(): number { return 1 + rand() * 9; }

/** A rifle muzzle sits about here on a 1.8 m person, in game units. */
export const MUZZLE_UP_UNITS = M(1.4);
export const MUZZLE_FWD_UNITS = M(0.45);
