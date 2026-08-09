/**
 * check-city-arrival — pressing B3 must leave you standing on dry land, able to walk.
 *
 * Geoff, three times now: "I'm doing B3 and then don't see any buildings and I can't move. Even the
 * camera doesn't move." Each time I have reasoned about it from the code and been wrong. This does
 * not reason: it runs the ACTUAL arrival — the same initArena the number key calls, at the same
 * coordinates — and then steps the body exactly as the walk controller does, and measures whether it
 * moved.
 *
 * The specific traps this is here to catch, all of which have happened:
 *   - the ground reads as sea, so the Kaiju spawns submerged and swims instead of walking
 *   - the three elevation samplers disagree, so the ground is not where it is drawn
 *   - the body simply does not move when told to
 *
 * Run: npm run check:city-arrival
 */

import * as THREE from 'three';
import { initArenaWith, getAgents, ARENA_HEIGHT } from '../src/components/siege/globe/kaijuArena';
import { BREEDS } from '../src/components/siege/globe/kaijuStats';
import { body as playerBody, stepBodyOf, reTangentOf } from '../src/components/siege/globe/kaijuBody';
import { sampleGlobeSurface } from '../src/components/siege/globe/globeGround';
import { cityBaseMetres } from '../src/components/siege/globe/cityGround';
import { latLonToDirection, PLANET_RADIUS, METRES_PER_UNIT } from '../src/components/siege/globe/cubeSphere';

let failures = 0;
function ok(cond: boolean, label: string, detail = ''): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!cond) failures++;
}

/** Exactly what ARENA_SITES has for Digit3. */
const DUBAI_LAT = 25.0805;
const DUBAI_LON = 55.1403;
const DT = 1 / 60;

console.log('\n== B3: arrive in Dubai and walk ==\n');

// --- the ground, before anything else ------------------------------------------------------------
{
  const d = new Float64Array(3);
  latLonToDirection(DUBAI_LAT, DUBAI_LON, d);
  const ground = sampleGlobeSurface(d[0], d[1], d[2]);
  ok(ground != null, 'the ground under Dubai Marina is knowable');
  ok(ground != null && ground > 0, 'and it is ABOVE sea level — not the seabed',
     `${ground?.toFixed(1)} m`);

  // The override must be identical whichever sampler asks, because the mesh, the walk collision and
  // the patch index each call it separately. When they last drifted apart the ground was 93 m from
  // where it was drawn, and the symptom was "I can't move".
  const viaOverride = cityBaseMetres(d[0], d[1], d[2], -87);
  ok(viaOverride != null && Math.abs(viaOverride - 6) < 0.001,
     'the raw override agrees with the city ground', `${viaOverride} m`);
}

// --- the arrival ---------------------------------------------------------------------------------
{
  initArenaWith([BREEDS[0], BREEDS[2], BREEDS[1], BREEDS[4]], 0x5EED, 6, DUBAI_LAT, DUBAI_LON);
  const agents = getAgents();
  ok(agents.length === 4, 'four Kaiju are placed', `${agents.length}`);

  const me = agents.find((a) => a.isPlayer)!;
  ok(me != null, 'one of them is the player');
  ok(me.alive && me.health > 0, 'and the player arrives alive',
     `${Math.round(me.health)} hp — dead on arrival is indistinguishable from broken controls`);

  const altM = (me.body.radius - PLANET_RADIUS) * METRES_PER_UNIT;
  ok(altM > 0, 'the player stands above sea level', `${altM.toFixed(1)} m`);
  // Submerged means swimming, and swimming is not walking. This is exactly what "I can't move" was
  // the first time: the Kaiju was 87 m under the Persian Gulf.
  ok(!me.body.submerged, 'and is NOT submerged — submerged means swimming, which reads as broken');
  ok(me.body.onGround, 'and is on the ground');
}

// --- and now walk, the way the walk controller does ----------------------------------------------
{
  const me = getAgents().find((a) => a.isPlayer)!;
  const start = playerBody.dir.clone();

  // Steer along the surface, hold W, and run the same integration the controller runs.
  const steer = new THREE.Vector3(0, 1, 0).cross(playerBody.dir).normalize();
  reTangentOf(playerBody, steer);
  playerBody.forward.copy(steer);

  for (let i = 0; i < 300; i++) {
    stepBodyOf(playerBody, DT, 1, 0, false, false, ARENA_HEIGHT, steer);
  }
  const movedM = start.angleTo(playerBody.dir) * playerBody.radius * METRES_PER_UNIT;

  // Five seconds of walking at roughly 38 m/s should cover well over a hundred metres.
  ok(movedM > 100, 'holding W for five seconds actually moves the Kaiju',
     `${movedM.toFixed(0)} m`);
  ok(!playerBody.submerged, 'and it is still walking, not swimming, at the end');

  const endAltM = (playerBody.radius - PLANET_RADIUS) * METRES_PER_UNIT;
  ok(endAltM > 0, 'and still above water after walking', `${endAltM.toFixed(1)} m`);
  ok(Number.isFinite(playerBody.dir.x + playerBody.dir.y + playerBody.dir.z),
     'the body position is a real number, not NaN');
  void me;
}

console.log(`\n${failures === 0 ? 'CITY ARRIVAL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
