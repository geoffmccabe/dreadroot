/**
 * bench-gunfire — how much work does a second of sustained fire actually cost?
 *
 * Written because I claimed "thirty-six raycasts a second is nothing" without doing the arithmetic,
 * and the answer turned out to be five frames a second. Counting the candidate rays is the part that
 * can be measured headlessly; the per-ray cost is then a multiplication anyone can do.
 */
import * as THREE from 'three';
import { initArenaWith, stepArena, getAgents, ARENA_HEIGHT } from '../src/components/siege/globe/kaijuArena';
import { BREEDS } from '../src/components/siege/globe/kaijuStats';
import { fireBullet, stepGunfire, getBullets, clearGunfire, aimPoint } from '../src/components/siege/globe/kaijuGunfire';
import { METRES_PER_UNIT } from '../src/components/siege/globe/cubeSphere';

initArenaWith([BREEDS[0], BREEDS[2], BREEDS[1], BREEDS[4]], 0x5EED, 6);
clearGunfire();
const agents = getAgents();
const aim = new THREE.Vector3(), from = new THREE.Vector3();
const DT = 1 / 60;
let fired = 0, peakLive = 0;
const t0 = Date.now();
// Two hundred soldiers firing every 1-10 s is ~36 rounds a second. Run ten seconds of it.
for (let f = 0; f < 600; f++) {
  for (let k = 0; k < 36 / 60 + (f % 5 === 0 ? 1 : 0); k++) {
    const t = agents[1 + (f % 3)];
    from.copy(t.body.dir).multiplyScalar(t.body.radius).addScaledVector(t.body.forward, -(350 / METRES_PER_UNIT));
    fireBullet(from, aimPoint(t, aim));
    fired++;
  }
  stepGunfire(DT);
  stepArena(DT, false);
  peakLive = Math.max(peakLive, getBullets().filter((b) => b.live).length);
}
const ms = Date.now() - t0;
console.log(`\n  ${fired} rounds over 10 s of simulation`);
console.log(`  peak rounds in the air: ${peakLive}`);
console.log(`  simulation cost: ${ms} ms for 600 frames = ${(ms / 600).toFixed(2)} ms/frame\n`);
console.log('  (headless has no models, so this is the SIMULATION only — the mesh raycast');
console.log('   is the renderer-side cost the capsule pre-filter now gates.)\n');
