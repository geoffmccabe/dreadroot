/**
 * bench-ground-sample — is a terrain lookup per flame particle per frame actually too expensive?
 *
 * kaijuWeapons says it is, and skips ground contact for the flamethrower on that basis:
 *
 *   "there are about a thousand of them: sampling the terrain per particle per frame would be
 *    60,000 height lookups a second to decide something invisible."
 *
 * That is an estimate, not a measurement, and Geoff now wants the flame to treat terrain as solid.
 * So: measure it on real tiles before designing around a cost that may not exist.
 *
 * Run: node --experimental-strip-types --loader ./scripts/ts-alias-loader.mjs scripts/bench-ground-sample.ts
 */

import { latLonToDirection, directionToFaceUv, uvToTileIndex } from '../src/components/siege/globe/cubeSphere';
import { loadManifest, requestTile } from '../src/components/siege/globe/earthTiles';
import { sampleGlobeSurface } from '../src/components/siege/globe/globeGround';

const mf = await loadManifest();
if (!mf) { console.log('No manifest — no network. Skipping.'); process.exit(0); }

// Warm the tiles around Everest, so the sampler is doing its real work rather than missing.
const d = new Float64Array(3);
latLonToDirection(27.9881, 86.9250, d);
const { face, u, v } = directionToFaceUv(d[0], d[1], d[2]);
for (let level = 0; level <= mf.maxLevel; level++) {
  const cx = uvToTileIndex(u, level), cy = uvToTileIndex(v, level);
  const n = 1 << level;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= n || y >= n) continue;
      await requestTile(face, level, x, y);
    }
  }
}

// A spread of directions around that point, like a jet of particles fanning out.
const N = 200_000;
const dirs = new Float64Array(N * 3);
for (let i = 0; i < N; i++) {
  const t = i / N;
  const a = t * 0.004;                // a few hundred metres of spread
  const b = (i % 97) / 97 * 0.004;
  dirs[i * 3] = d[0] + a;
  dirs[i * 3 + 1] = d[1] + b;
  dirs[i * 3 + 2] = d[2];
}

// Warm up, so the first-call JIT cost is not counted as the steady-state cost.
let sink = 0;
for (let i = 0; i < 20_000; i++) sink += sampleGlobeSurface(dirs[i * 3], dirs[i * 3 + 1], dirs[i * 3 + 2]) ?? 0;

const t0 = process.hrtime.bigint();
for (let i = 0; i < N; i++) sink += sampleGlobeSurface(dirs[i * 3], dirs[i * 3 + 1], dirs[i * 3 + 2]) ?? 0;
const t1 = process.hrtime.bigint();

const totalMs = Number(t1 - t0) / 1e6;
const perCallUs = (totalMs * 1000) / N;

console.log(`\n== Cost of one ground sample ==\n`);
console.log(`  ${N.toLocaleString()} samples in ${totalMs.toFixed(1)} ms`);
console.log(`  ${perCallUs.toFixed(3)} microseconds per call\n`);

for (const particles of [500, 1000, 1500, 3000]) {
  const perFrameMs = (particles * perCallUs) / 1000;
  const pctOf60fps = (perFrameMs / 16.67) * 100;
  console.log(`  ${String(particles).padStart(4)} particles: ${perFrameMs.toFixed(2)} ms/frame `
    + `= ${pctOf60fps.toFixed(1)}% of a 60 fps budget`);
}
console.log(`\n  (sink ${sink.toFixed(0)}, printed so the loop cannot be optimised away)\n`);
