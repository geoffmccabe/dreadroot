/**
 * check-player-collision — you must not be able to WALK THROUGH another Kaiju.
 *
 * Geoff: "my Kaiju can walk through the other kaiju, so the colliders don't work."
 *
 * The separation pass exists and the headless arena check passes, but that check drives every body
 * through the arena's own integration. The PLAYER's body is different: it is moved by the walk
 * controller, in a SEPARATE frame callback, at a LATER priority than the arena's. So this
 * reproduces the real frame order — arena first, then the player's own step — which is the only
 * order in which the reported bug can appear.
 *
 * Run: npm run check:player-collision
 */

import * as THREE from 'three';
import {
  initArenaWith, stepArena, getAgents, ARENA_HEIGHT,
} from '../src/components/siege/globe/kaijuArena';
import { BREEDS } from '../src/components/siege/globe/kaijuStats';
import { body as playerBody, stepBodyOf, reTangentOf } from '../src/components/siege/globe/kaijuBody';
import {
  torsoCapsule, capsuleOverlap, torsoRadiusFrac, TORSO_FRAC_CEILING, MELEE_GATE_BODIES,
} from '../src/components/siege/globe/kaijuColliders';
import { WEAPONS } from '../src/components/siege/globe/kaijuWeapons';
import { METRES_PER_UNIT } from '../src/components/siege/globe/cubeSphere';

/**
 * Torso half-widths measured off the model files by scripts/measure-glb-width.mjs, in the walk
 * clip each one is actually drawn in. The collider has to cover these or two Kaiju are held apart
 * at a distance where their chests still intersect — which is exactly what "the red demon walks
 * right through me" was, with the separation maths working perfectly the whole time.
 */
const MEASURED_TORSO: [string, number][] = [
  ['red demon', 0.313],
  ['fort golem', 0.444],
  ['elemental golem', 0.453],
];

/**
 * Full bone reach — arms included — from the same measurement. This is what a viewer sees
 * overlapping, and what the torso capsule cannot fully prevent without stopping combat.
 */
const MEASURED_REACH: [string, number][] = [
  ['red demon', 0.548],
  ['fort golem', 0.686],
  ['elemental golem', 0.672],
];

let failures = 0;
function ok(cond: boolean, label: string, detail = ''): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!cond) failures++;
}

const DT = 1 / 60;
const capA = torsoCapsule(new THREE.Vector3(0, 0, 1), 1, ARENA_HEIGHT);
const capB = torsoCapsule(new THREE.Vector3(0, 0, 1), 1, ARENA_HEIGHT);
const axis = new THREE.Vector3();

/** Deepest interpenetration between the player and any other Kaiju, in metres. */
function worstOverlapMetres(): number {
  const agents = getAgents();
  const me = agents.find((a) => a.isPlayer);
  if (!me) return 0;
  torsoCapsule(me.body.dir, me.body.radius, ARENA_HEIGHT, capA);
  let worst = 0;
  for (const other of agents) {
    if (other === me || !other.alive) continue;
    torsoCapsule(other.body.dir, other.body.radius, ARENA_HEIGHT, capB);
    worst = Math.max(worst, capsuleOverlap(capA, capB, axis));
  }
  return worst * METRES_PER_UNIT;
}

console.log('\n== You cannot walk through another Kaiju ==\n');

// FIRST: is the collider even the right SHAPE? No amount of correct separation maths helps if it
// is separating a body narrower than the one on screen.
// The collider must cover each creature's BODY. The figures below are the walk-clip spread, which
// includes the arms swinging; the separation radius is now the idle spread, which is the core. So
// the test is that it covers the core, not the reach — see the long note in kaijuColliders.
for (const [name, halfWidth] of MEASURED_TORSO) {
  ok(torsoRadiusFrac >= halfWidth * 0.6,
     `the collider covers the ${name}'s body core`,
     `collider ${torsoRadiusFrac.toFixed(3)} vs walk-spread ${halfWidth.toFixed(3)} x height`);
}
// ...and two of them at contact must be CLOSE ENOUGH TO FIGHT. This is the check that would have
// stopped the 0.70 disaster: it passed every gate and still put a body height of air between them.
ok(torsoRadiusFrac * 2 < 0.75, 'two Kaiju at contact are close enough to brawl',
   `${(torsoRadiusFrac * 2 * 300).toFixed(0)} m apart, ${(torsoRadiusFrac * 2).toFixed(2)} body heights`);
// ...and it must not be so wide that nothing can ever reach anything. TWO separate gates, and the
// tighter one is not the obvious one.
ok(torsoRadiusFrac * 2 < WEAPONS.melee.rangeBodies + torsoRadiusFrac,
   'two Kaiju at contact are still within melee HIT range',
   `${(torsoRadiusFrac * 2).toFixed(2)} apart vs `
   + `${(WEAPONS.melee.rangeBodies + torsoRadiusFrac).toFixed(2)} reach`);
// THE DECISION GATE. The behaviour tree only swings when the target is inside it, so a gate tighter
// than contact means an AI can never decide to attack and combat stops with no error anywhere.
// It is now derived from the collider so it cannot drift, and this asserts that it worked.
ok(torsoRadiusFrac * 2 < MELEE_GATE_BODIES(WEAPONS.melee.rangeBodies),
   'an AI can still get close enough to DECIDE to attack',
   `contact at ${(torsoRadiusFrac * 2).toFixed(2)} vs InMeleeRange gate at `
   + `${MELEE_GATE_BODIES(WEAPONS.melee.rangeBodies).toFixed(2)}`);
ok(torsoRadiusFrac <= TORSO_FRAC_CEILING, 'the collider is within its documented ceiling',
   `${torsoRadiusFrac} vs ${TORSO_FRAC_CEILING}`);

// THE ARMS. Reported, not asserted, and this is a deliberate reversal.
//
// For one build this WAS an assertion: the collider was widened to 0.70 so that no limb of one Kaiju
// could reach inside another. It passed, and it was a bad idea. Geoff: "there's a big red cylinder
// around each kaiju and when another kaiju approaches me our oversized huge red colliders collide
// and it blocks its ability to get near me, so we can't fight." Two creatures held 420 m apart in a
// fighting game — a body height of clear air between them — is worse than any amount of arm overlap.
//
// Separation keeps BODIES out of each other. Arms passing through during a swing is what fighting
// looks like. So the number below is expected to be positive now, and printing it keeps it honest.
{
  const worstPair = MEASURED_REACH.reduce((m, r) => Math.max(m, r[1]), 0) * 2;
  const gap = worstPair - torsoRadiusFrac * 2;
  console.log(`  NOTE  arm reach overlaps by ${(gap * 300).toFixed(0)} m at contact, by design. `
    + `Bodies are held ${(torsoRadiusFrac * 2 * 300).toFixed(0)} m apart, which is close enough to fight.`);
}


// Two Kaiju, close together, and the player walks straight at the other one for thirty seconds.
{
  initArenaWith([BREEDS[0], BREEDS[2]], 0x5EED, 1);
  const agents = getAgents();
  const me = agents.find((a) => a.isPlayer)!;
  const them = agents.find((a) => !a.isPlayer)!;

  // Aim the player straight at the other Kaiju along the surface.
  const toThem = them.body.dir.clone().sub(me.body.dir);
  reTangentOf(me.body, toThem);
  me.body.forward.copy(toThem);

  let worst = 0;
  let worstAt = 0;
  let closedIn = false;
  for (let step = 0; step < 1800; step++) {
    // THE REAL FRAME ORDER. KaijuArenaScene runs at the default priority, KaijuWalkController at
    // priority 1, and react-three-fiber runs callbacks in ascending priority — so the arena
    // resolves separation using LAST frame's player position, and only then does the player move.
    stepArena(DT, true);
    // Then the walk controller drives the player's body: hold W, keep steering at them.
    const steer = them.body.dir.clone().sub(me.body.dir);
    reTangentOf(playerBody, steer);
    stepBodyOf(playerBody, DT, 1, 0, false, false, ARENA_HEIGHT, steer);

    const gapM = playerBody.dir.angleTo(them.body.dir) * playerBody.radius * METRES_PER_UNIT;
    if (gapM < ARENA_HEIGHT * (torsoRadiusFrac * 2 + 0.15) * METRES_PER_UNIT) closedIn = true;
    const o = worstOverlapMetres();
    if (o > worst) { worst = o; worstAt = step; }
  }

  ok(closedIn, 'the player actually reaches the other Kaiju', 'otherwise this proves nothing');
  // The capsule radius is 75 m for a 300 m Kaiju, so 150 m of overlap is standing dead centre
  // inside them. Anything past a few metres is visible interpenetration at this scale.
  ok(worst < 5, 'the player never ends a frame inside another Kaiju',
     `worst ${worst.toFixed(1)} m at step ${worstAt}`);
}

// And the reverse: an AI walking into a STATIONARY player must not push it around.
{
  initArenaWith([BREEDS[0], BREEDS[2]], 0x5EED, 1);
  const agents = getAgents();
  const me = agents.find((a) => a.isPlayer)!;
  const start = me.body.dir.clone();

  let worst = 0;
  for (let step = 0; step < 1800; step++) {
    stepArena(DT, true);
    stepBodyOf(playerBody, DT, 0, 0, false, false, ARENA_HEIGHT, null);   // standing still
    worst = Math.max(worst, worstOverlapMetres());
  }
  const driftM = start.angleTo(me.body.dir) * me.body.radius * METRES_PER_UNIT;

  ok(worst < 5, 'a standing player is not walked through either', `worst ${worst.toFixed(1)} m`);
  // Being leaned on may nudge you; being bulldozed across the map is the "sliding on its own"
  // complaint. One body height over thirty seconds is the line between the two.
  ok(driftM < ARENA_HEIGHT * METRES_PER_UNIT,
     'a standing player is not shoved across the map', `drifted ${driftM.toFixed(0)} m in 30 s`);
}

console.log(`\n${failures === 0 ? 'PLAYER COLLISION CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
