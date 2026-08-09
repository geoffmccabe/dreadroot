// check-city-coast — is the coastline in the right place, and is the beach a slope?
//
// Geoff: "it seems to have created more land, not less, and it's very pixellated coastline, like
// made of 50 m squares." Both were true. This is the measurement that says whether they still are,
// and it reads the EMITTED file rather than the bake's own grid — the bake being right about a
// coastline it then packs wrongly is exactly the sort of thing that survives a look.
//
// Run: node scripts/check-city-coast.mjs

import { readFileSync } from 'node:fs';

const SRC = readFileSync('src/components/siege/globe/dubaiLandMask.ts', 'utf8');
const CELL = Number(/MASK_CELL_METRES = (\d+)/.exec(SRC)[1]);
const HALF = Number(/MASK_HALF_METRES = (\d+)/.exec(SRC)[1]);
const N = Number(/MASK_N = (\d+)/.exec(SRC)[1]);
const bits = Buffer.from(/const PACKED = '([^']+)'/.exec(SRC)[1], 'base64');

const bit = (cx, cy) => {
  const x = cx < 0 ? 0 : cx >= N ? N - 1 : cx;
  const y = cy < 0 ? 0 : cy >= N ? N - 1 : cy;
  const k = y * N + x;
  return (bits[k >> 3] & (1 << (k & 7))) ? 1 : 0;
};
const landFraction = (xm, zm) => {
  const fx = (xm + HALF) / CELL - 0.5, fy = (zm + HALF) / CELL - 0.5;
  const cx = Math.floor(fx), cy = Math.floor(fy);
  const tx = fx - cx, ty = fy - cy;
  const a = bit(cx, cy), b = bit(cx + 1, cy), c = bit(cx, cy + 1), d = bit(cx + 1, cy + 1);
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
};

const LAT0 = 25.14, LON0 = 55.21;
const MLAT = 111320, MLON = MLAT * Math.cos((LAT0 * Math.PI) / 180);
const at = (lat, lon) => [(lon - LON0) * MLON, -(lat - LAT0) * MLAT];

let fails = 0;
function expect(name, lat, lon, wantLand) {
  const [x, z] = at(lat, lon);
  const f = landFraction(x, z);
  const ok = (f > 0.5) === wantLand;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(32)} land=${f.toFixed(2)}  (want ${wantLand ? 'land' : 'sea'})`);
}

console.log(`== Dubai coastline (${N}x${N} at ${CELL} m; terrain resolves 38 m) ==\n`);
expect('Burj Khalifa', 25.1972, 55.2744, true);
expect('Dubai Marina towers', 25.0805, 55.1403, true);
expect('Sheikh Zayed Rd', 25.2175, 55.2825, true);
expect('Palm Jumeirah trunk', 25.1124, 55.1390, true);
expect('desert 15 km inland', 25.05, 55.35, true);
expect('open Gulf 12 km offshore', 25.20, 55.10, false);
expect('Gulf off Jumeirah beach', 25.16, 55.17, false);
expect('NW corner of the grid', 25.35, 54.97, false);

// THE PALM IS ISLANDS, and this is the assertion that actually says so. A hand-picked "water"
// coordinate is a guess about which side of a 150 m frond it fell on; counting how many times a
// line crossing the fronds changes between land and sea is not. Sixteen fronds means a lot of
// crossings, and a filled-in blob means almost none — which is exactly the failure Geoff reported
// when he said the Palm "is supposed to be a set of islands in the water but everything is inland".
{
  let flips = 0, prev = -1;
  for (let lat = 25.095; lat <= 25.135; lat += 0.0004) {
    const [x, z] = at(lat, 55.135);
    const v = landFraction(x, z) > 0.5 ? 1 : 0;
    if (prev >= 0 && v !== prev) flips++;
    prev = v;
  }
  // Six, and the number is chosen against the failure rather than the success: a Palm filled in
  // solid gives exactly TWO crossings — in one side and out the other — so anything well above two
  // proves separation. This line meets four fronds and reports eight.
  const ok = flips >= 6;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${'Palm fronds are separate islands'.padEnd(32)} ${flips} land/sea crossings (a filled blob gives 2)`);
}

console.log('\n== the beach is a slope, not a step ==');
// Walk northwest out of the Marina into the Gulf. A binary mask steps 1 -> 0 with nothing between;
// a partial value anywhere along the walk means the interpolation is doing its job.
// Start from the Marina towers, which the assertions above have already proved are land, rather
// than from a hand-picked point near the waterline — the waterline is the thing under test, so
// starting on it makes the test depend on the answer.
const [mx, mz] = at(25.0805, 55.1403);
const row = [];
let partial = false;
for (let d = 0; d <= 1600; d += 80) {
  const f = landFraction(mx - d * 0.7, mz - d * 0.7);
  if (f > 0.02 && f < 0.98) partial = true;
  if (d % 160 === 0) row.push(`${String(d).padStart(4)}m:${f.toFixed(2)}`);
}
console.log('  ' + row.join(' '));
if (!partial) fails++;
console.log(`  ${partial ? 'PASS' : 'FAIL'}  a partial value exists between land and sea`);

console.log(fails ? `\n${fails} FAILURES` : '\nALL PASS');
process.exit(fails ? 1 : 0);
