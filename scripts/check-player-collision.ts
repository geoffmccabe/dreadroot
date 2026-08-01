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
  torsoCapsule, capsuleOverlap, torsoRadiusFrac, TORSO_FRAC_CEILING,
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
for (const [name, halfWidth] of MEASURED_TORSO) {
  ok(torsoRadiusFrac >= halfWidth,
     `the collider covers the ${name}'s torso`,
     `collider ${torsoRadiusFrac.toFixed(3)} vs measured ${halfWidth.toFixed(3)} x height`);
}
// ...and it must not be so wide that nothing can ever reach anything. TWO separate gates, and the
// tighter one is not the obvious one.
ok(torsoRadiusFrac * 2 < WEAPONS.melee.rangeBodies + torsoRadiusFrac,
   'two Kaiju at contact are still within melee HIT range',
   `${(torsoRadiusFrac * 2).toFixed(2)} apart vs `
   + `${(WEAPONS.melee.rangeBodies + torsoRadiusFrac).toFixed(2)} reach`);
// THE REAL CEILING. The behaviour tree only swings when the target is inside melee range + 0.4.
// Push the collider past half of that and the AI can never decide to attack — combat stops with
// no error anywhere. This is the check that stops a future widening from silently killing the fight.
ok(torsoRadiusFrac * 2 < WEAPONS.melee.rangeBodies + 0.4,
   'an AI can still get close enough to DECIDE to attack',
   `contact at ${(torsoRadiusFrac * 2).toFixed(2)} vs InMeleeRange gate at `
   + `${(WEAPONS.melee.rangeBodies + 0.4).toFixed(2)}`);
ok(torsoRadiusFrac <= TORSO_FRAC_CEILING, 'the collider is within its documented ceiling',
   `${torsoRadiusFrac} vs ${TORSO_FRAC_CEILING}`);

// How much limb still passes through the other creature. Reported, not asserted: the torso capsule
// cannot fix this, and pretending a number here is a pass/fail would hide that.
{
  const worstPair = MEASURED_REACH.reduce((m, r) => Math.max(m, r[1]), 0) * 2;
  const gap = worstPair - torsoRadiusFrac * 2;
  console.log(`  NOTE  widest limb overlap still possible: ${(gap * 100).toFixed(0)}% of a body `
    + `height (~${(gap * 300).toFixed(0)} m). Torso capsules cannot remove this; per-limb `
    + `capsules are the real fix and are not wired into separation yet.`);
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
