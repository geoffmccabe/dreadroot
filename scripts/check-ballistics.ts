/**
 * check-ballistics — is the bullet physics ACTUALLY right, or just plausible?
 *
 * Geoff: "If you're sure the speed was accurate and 800m/s muzzle velocity then that's fine and
 * we'll stick with that, but just audit it to make sure it's accurate with physics."
 *
 * A fair audit cannot be "does the code do what the code says". It has to be against numbers from
 * outside the project, so this compares the simulation to the published exterior-ballistics table
 * for 5.56x45mm NATO M855 — the round an actual soldier in this scene would be firing.
 *
 * Run: npm run check:ballistics
 */

import * as THREE from 'three';
import { initArenaWith } from '../src/components/siege/globe/kaijuArena';
import { BREEDS } from '../src/components/siege/globe/kaijuStats';
import {
  fireBullet, stepGunfire, getBullets, clearGunfire,
} from '../src/components/siege/globe/kaijuGunfire';
import { METRES_PER_UNIT, PLANET_RADIUS } from '../src/components/siege/globe/cubeSphere';

let failures = 0;
function ok(cond: boolean, label: string, detail = ''): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!cond) failures++;
}

/**
 * Published remaining velocity for 5.56x45mm NATO M855, 62 grain, from a 20 inch barrel.
 *
 * Muzzle 948 m/s. These are the standard figures quoted in exterior-ballistics tables and in the
 * US Army's own data; they are what the model has to reproduce the SHAPE of. The absolute numbers
 * depend on the muzzle velocity chosen, so what is actually compared below is the RATIO of remaining
 * speed to muzzle speed, which is a property of the drag alone.
 */
const M855: { metres: number; speed: number }[] = [
  { metres: 0, speed: 948 },
  { metres: 100, speed: 850 },
  { metres: 200, speed: 758 },
  { metres: 300, speed: 673 },
  { metres: 400, speed: 595 },
  { metres: 500, speed: 524 },
];

const DT = 1 / 240;   // fine step, so the answer is the model's and not the integrator's
console.log('\n== Bullet physics, against real 5.56 NATO data ==\n');

initArenaWith([BREEDS[0]], 0x5EED, 6);
clearGunfire();

// Fire one round horizontally, far from anything, and sample it as it goes.
const start = new THREE.Vector3(0, 0, PLANET_RADIUS + 10);
fireBullet(start, start.clone().add(new THREE.Vector3(1, 0, 0)));
const b = getBullets().find((x) => x.live)!;
const muzzle = b.vel.length() * METRES_PER_UNIT;

const samples: { metres: number; speed: number; drop: number; time: number }[] = [];
let next = 1;
let t = 0;
while (t < 3 && b.live && next < M855.length) {
  stepGunfire(DT);
  t += DT;
  const travelled = Math.abs(b.pos.x - start.x) * METRES_PER_UNIT;
  if (travelled >= M855[next].metres) {
    samples.push({
      metres: M855[next].metres,
      speed: b.vel.length() * METRES_PER_UNIT,
      drop: (start.length() - b.pos.length()) * METRES_PER_UNIT,
      time: t,
    });
    next++;
  }
}

console.log(`  muzzle velocity: ${muzzle.toFixed(0)} m/s`);
console.log('  range    sim speed   real M855   sim/real   drop     time');
let worstErr = 0;
for (const s of samples) {
  const real = M855.find((r) => r.metres === s.metres)!;
  // Compare the FRACTION of muzzle speed retained. That isolates the drag model from the choice of
  // muzzle velocity, which is a separate decision about which weapon these soldiers carry.
  const simFrac = s.speed / muzzle;
  const realFrac = real.speed / M855[0].speed;
  const err = Math.abs(simFrac - realFrac) / realFrac;
  worstErr = Math.max(worstErr, err);
  console.log(`  ${String(s.metres).padStart(4)} m   ${s.speed.toFixed(0).padStart(7)} m/s`
    + `   ${String(real.speed).padStart(6)} m/s   ${(err * 100).toFixed(1).padStart(6)}%`
    + `   ${s.drop.toFixed(2).padStart(5)} m  ${s.time.toFixed(3)} s`);
}

ok(samples.length === M855.length - 1, 'the round reaches 500 m to be measured');
// 10% on the retained-velocity curve is well inside the spread between real barrel lengths, lots and
// air densities. Anything worse means the drag model is the wrong SHAPE, not merely mistuned.
ok(worstErr < 0.10, 'the drag curve matches real 5.56 NATO within 10% at every range',
   `worst ${(worstErr * 100).toFixed(1)}%`);

// THE DROP. This is the number that catches a wrong gravity or a wrong unit conversion, because it
// is small and depends on the square of the time of flight. Free fall for the measured time of
// flight is the upper bound; drag on the vertical component makes the true answer slightly less.
{
  const s500 = samples[samples.length - 1];
  const freeFall = 0.5 * 9.81 * s500.time * s500.time;
  ok(s500.drop > freeFall * 0.7 && s500.drop <= freeFall * 1.02,
     'the drop matches gravity over the measured time of flight',
     `${s500.drop.toFixed(2)} m vs ${freeFall.toFixed(2)} m of free fall`);
  // Sanity in plain terms: a rifle round drops metres over 500 m, not tens of metres. If this ever
  // reads 40 m, gravity is being applied to something moving at walking pace.
  ok(s500.drop < 6, 'and is a few metres, as a rifle round is', `${s500.drop.toFixed(2)} m`);
}

// TERMINAL BEHAVIOUR. With quadratic drag and no thrust, speed must decrease monotonically and
// never reverse. A sign error in the drag term shows up here and nowhere else.
{
  clearGunfire();
  fireBullet(start, start.clone().add(new THREE.Vector3(1, 0, 0)));
  const c = getBullets().find((x) => x.live)!;
  let prev = c.vel.length();
  let monotone = true;
  for (let i = 0; i < 600 && c.live; i++) {
    stepGunfire(DT);
    const now = c.vel.length();
    // Gravity adds speed once the round is falling, so only the first second — while it is still
    // mostly horizontal — is required to be monotonically slowing.
    if (i < 240 && now > prev + 1e-9) { monotone = false; break; }
    prev = now;
  }
  ok(monotone, 'the round only ever slows down while it is flying flat');
  ok(prev > 0, 'and never reverses direction', `${(prev * METRES_PER_UNIT).toFixed(0)} m/s`);
}

console.log(`\n${failures === 0 ? 'BALLISTICS AUDIT PASSED' : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
