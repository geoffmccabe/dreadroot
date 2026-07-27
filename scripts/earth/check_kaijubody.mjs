// Physics checks for the Mini Earth Kaiju body.
//
// The property that actually matters is that horizontal movement is a ROTATION of the position
// direction rather than a translation, so no amount of travel can drift off the sphere or walk
// off an edge. Everything else follows from that. Fixed timestep so results are deterministic.
//
//   node scripts/earth/check_kaijubody.mjs
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { transform } from 'esbuild';
import * as three from 'three';

// Stub the two imports that need the browser/network; the physics does not depend on them.
const src = readFileSync('src/components/siege/globe/kaijuBody.ts', 'utf8')
  .replace("import { sampleGlobeSurface } from './globeGround';", 'const sampleGlobeSurface = () => 0;')
  .replace("import { PLANET_RADIUS, METRES_PER_UNIT } from './cubeSphere';",
           'const PLANET_RADIUS = 63710, METRES_PER_UNIT = 100;');
const { code } = await transform(src, { loader: 'ts', format: 'esm' });

// Must be a real file inside the project: a data: URL cannot resolve the bare "three" specifier.
const tmp = 'scripts/earth/_kaijubody.tmp.mjs';
writeFileSync(tmp, code);
let mod;
try { mod = await import('./_kaijubody.tmp.mjs'); } finally { unlinkSync(tmp); }

const { body, stepBody, walkSpeed, runSpeed, gravityUnits, placeOnSurface, jumpVelocity } = mod;
let fails = 0;
const fail = (m) => { console.log('  FAIL ' + m); fails++; };
const R = 63710;

console.log('1. speeds from Froude similarity');
const h = 3;   // 300 m Kaiju
console.log(`   300 m body: walk ${(walkSpeed(h)*100).toFixed(1)} m/s real, run ${(runSpeed(h)*100).toFixed(1)} m/s real`);
console.log(`    30 m body: walk ${(walkSpeed(0.3)*100).toFixed(1)} m/s real`);
if (!(runSpeed(h) > walkSpeed(h))) fail('run must exceed walk');
if (!(walkSpeed(9) > walkSpeed(1))) fail('bigger bodies must be faster in absolute terms');
// A taller body must be SLOWER in body-lengths per second: that is what reads as ponderous.
if (!(walkSpeed(9) / 9 < walkSpeed(1) / 1)) fail('bigger bodies must be slower in body-lengths/sec');

console.log('2. stays exactly on the sphere');
placeOnSurface(new three.Vector3(0, 0, 1));
const r0 = body.radius;
let worst = 0;
for (let i = 0; i < 20000; i++) {
  stepBody(1 / 60, 1, 0, false, true, h, null);
  worst = Math.max(worst, Math.abs(body.dir.length() - 1));
}
console.log(`   20,000 steps: |dir| error ${worst.toExponential(2)}, radius drift ${(body.radius - r0).toExponential(2)} units`);
if (worst > 1e-9) fail('position direction drifting off the unit sphere');

console.log('3. walking far enough goes AROUND the planet');
placeOnSurface(new three.Vector3(0, 0, 1));
const start = body.dir.clone();
const steps = Math.round((2 * Math.PI * R) / (runSpeed(h) * (1 / 60)));
for (let i = 0; i < steps; i++) stepBody(1 / 60, 1, 0, false, true, h, null);
const dot = body.dir.dot(start);
console.log(`   one full circumference (${steps.toLocaleString()} steps): dot(start) = ${dot.toFixed(5)}`);
if (dot < 0.999) fail(`did not return to the start (dot ${dot.toFixed(4)})`);

console.log('4. survives crossing a pole');
placeOnSurface(new three.Vector3(0, 0.9999, 0.0141).normalize());
let poleBad = 0;
for (let i = 0; i < 4000; i++) {
  stepBody(1 / 60, 1, 0, false, true, h, null);
  if (!Number.isFinite(body.dir.x + body.dir.y + body.dir.z) || Math.abs(body.dir.length() - 1) > 1e-6) poleBad++;
}
console.log(`   4,000 steps over the pole: ${poleBad} bad frames`);
if (poleBad) fail('the tangent frame degenerates at the pole');

console.log('5. gravity and jump are scale-correct');
console.log(`   g = ${(gravityUnits()*100).toFixed(2)} real m/s^2; a ${h*100} m body jumps ${(jumpVelocity(h)*100).toFixed(1)} m/s`);
if (Math.abs(gravityUnits() * 100 - 9.81) > 0.01) fail('gravity is not 9.81 real m/s^2');

console.log(fails ? `\n${fails} CHECK(S) FAILED` : '\nALL BODY CHECKS PASSED');
process.exit(fails ? 1 : 0);
