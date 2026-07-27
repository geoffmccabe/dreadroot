/**
 * check-globe-transect — walk a line across a mountain and print the ground profile.
 *
 * Two previous terrain fixes were measured, correct, and did not fix what Geoff sees: "mostly flat
 * featureless plains and no real mountains, just short bumps". So this stops testing the LOD
 * machinery and tests the thing that actually decides what you look at — the elevation the game's
 * own sampler returns, walking a real transect at the spacing the renderer uses.
 *
 * The raw tiles are known good (3,463 m of relief at Everest, verified by fetching them). If this
 * transect is flat, the loss is somewhere between the file and the vertex, and this narrows it to
 * a specific stage rather than another guess.
 *
 * Run: npm run check:globe-transect
 */

import { latLonToDirection, PLANET_RADIUS, METRES_PER_UNIT } from '../src/components/siege/globe/cubeSphere';
import { loadManifest, requestTile, getManifest } from '../src/components/siege/globe/earthTiles';
import { sampleGlobeElevation } from '../src/components/siege/globe/globeGround';
import { directionToFaceUv, uvToTileIndex } from '../src/components/siege/globe/cubeSphere';

let failures = 0;
function ok(cond: boolean, label: string, detail = ''): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!cond) failures++;
}

/** Pull in every tile level covering a point, so the sampler has the best data available. */
async function warm(lat: number, lon: number, maxLevel: number): Promise<void> {
  const d = new Float64Array(3);
  latLonToDirection(lat, lon, d);
  const { face, u, v } = directionToFaceUv(d[0], d[1], d[2]);
  for (let level = 0; level <= maxLevel; level++) {
    // A 3x3 block, so the transect does not walk off the edge of a single tile.
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
}

const PLACES: [string, number, number][] = [
  ['Mount Everest', 27.9881, 86.9250],
  ['Grand Canyon', 36.1069, -112.1129],
];

console.log('\n== Ground profile as the game samples it ==\n');

const mf = await loadManifest();
if (!mf) {
  console.log('  Could not load the tile manifest — no network?');
  process.exit(1);
}
console.log(`  manifest: maxLevel ${mf.maxLevel}, ${(mf as { detailRegions?: number }).detailRegions ?? '?'} detail regions\n`);

for (const [name, lat, lon] of PLACES) {
  await warm(lat, lon, mf.maxLevel);

  // Walk 12 km across the point, sampling every 250 m — a Kaiju is 300 m, so this is roughly
  // "one sample per creature", which is the scale the flatness complaint is about.
  const STEP_M = 250;
  const SPAN_M = 12000;
  const n = Math.round(SPAN_M / STEP_M);

  const d = new Float64Array(3);
  latLonToDirection(lat, lon, d);
  const centre = [d[0], d[1], d[2]] as [number, number, number];
  // An east-ish tangent to walk along.
  const up = [0, 1, 0];
  let ex = up[1] * centre[2] - up[2] * centre[1];
  let ey = up[2] * centre[0] - up[0] * centre[2];
  let ez = up[0] * centre[1] - up[1] * centre[0];
  const el = Math.hypot(ex, ey, ez) || 1;
  ex /= el; ey /= el; ez /= el;

  const heights: number[] = [];
  for (let i = -n / 2; i <= n / 2; i++) {
    const arc = (i * STEP_M) / (PLANET_RADIUS * METRES_PER_UNIT);   // radians
    const x = centre[0] * Math.cos(arc) + ex * Math.sin(arc);
    const y = centre[1] * Math.cos(arc) + ey * Math.sin(arc);
    const z = centre[2] * Math.cos(arc) + ez * Math.sin(arc);
    const m = sampleGlobeElevation(x, y, z);
    heights.push(m ?? Number.NaN);
  }

  const good = heights.filter((h) => Number.isFinite(h));
  const min = Math.min(...good), max = Math.max(...good);
  const relief = max - min;

  console.log(`${name}  —  ${SPAN_M / 1000} km transect, one sample per ${STEP_M} m`);
  console.log(`   elevation ${min.toFixed(0)} .. ${max.toFixed(0)} m   RELIEF ${relief.toFixed(0)} m`);
  console.log(`   missing samples: ${heights.length - good.length} of ${heights.length}`);

  // Draw it, so the shape is visible rather than just its extremes.
  const rows = 14;
  for (let r = rows - 1; r >= 0; r--) {
    const lo = min + (relief * r) / rows;
    const line = heights.map((h) => (Number.isFinite(h) && h >= lo ? '#' : ' ')).join('');
    console.log(`   ${lo.toFixed(0).padStart(6)} m |${line}`);
  }

  // A 300 m Kaiju standing here: how many times its own height is the local relief?
  console.log(`   => local relief is ${(relief / 300).toFixed(1)}x a Kaiju's height\n`);

  if (name === 'Mount Everest') {
    ok(good.length === heights.length, 'every sample along the transect returned a height',
       `${heights.length - good.length} missing`);
    ok(relief > 2000, 'Everest shows thousands of metres of relief, not bumps',
       `${relief.toFixed(0)} m`);
  }
}

console.log(`${failures === 0 ? 'TRANSECT CHECKS PASSED' : `${failures} TRANSECT CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
