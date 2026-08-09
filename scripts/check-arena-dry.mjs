// check-arena-dry — nobody spawns in the sea.
//
// Geoff: "one of the kaiju seems to be missing from B3... the one that throws bombs that make the
// fire needs to be there."
//
// It was never missing. The spawn ring puts each Kaiju at a fixed compass point 1.8 km out, and at
// three of Dubai's four districts the point due WEST is open water — which is exactly where the
// grenade thrower sits. Spawned below sea level it is submerged: swimming, not walking, and
// invisible under the surface. Which reads as an absent creature.
//
// This reproduces the ring against the real land mask, and asserts that the land-seeking placement
// added to initArenaWith finds dry ground for all four at every stop.
//
// Run: node scripts/check-arena-dry.mjs

import { readFileSync } from 'node:fs';

const SRC = readFileSync('src/components/siege/globe/dubaiLandMask.ts', 'utf8');
const CELL = +/MASK_CELL_METRES = (\d+)/.exec(SRC)[1];
const HALF = +/MASK_HALF_METRES = (\d+)/.exec(SRC)[1];
const N = +/MASK_N = (\d+)/.exec(SRC)[1];
const bits = Buffer.from(/const PACKED = '([^']+)'/.exec(SRC)[1], 'base64');

const LAT0 = 25.14, LON0 = 55.21, MLAT = 111320, MLON = MLAT * Math.cos(LAT0 * Math.PI / 180);
const land = (lat, lon) => {
  const cx = Math.max(0, Math.min(N - 1, Math.floor(((lon - LON0) * MLON + HALF) / CELL)));
  const cy = Math.max(0, Math.min(N - 1, Math.floor((-(lat - LAT0) * MLAT + HALF) / CELL)));
  const k = cy * N + cx;
  return (bits[k >> 3] & (1 << (k & 7))) !== 0;
};

// ARENA_HEIGHT 3 units x spreadBodies 6 x 100 m per unit.
const R = 1800;
const at = (lat, lon, ang, radius) => [lat + Math.sin(ang) * radius / MLAT, lon + Math.cos(ang) * radius / MLON];

/** The same search initArenaWith does: rotate first, then shrink. */
function findDry(lat, lon, ang0) {
  if (land(...at(lat, lon, ang0, R))) return { ang: ang0, radius: R, moved: false };
  for (let shrink = 0; shrink < 4; shrink++) {
    const radius = R * (1 - shrink * 0.22);
    for (let step = 1; step <= 12; step++) {
      for (const sign of [1, -1]) {
        const ang = ang0 + sign * step * (Math.PI / 12);
        if (land(...at(lat, lon, ang, radius))) return { ang, radius, moved: true };
      }
    }
  }
  return null;
}

const STOPS = [
  ['Dubai Marina', 25.0805, 55.1403],
  ['Palm Jumeirah', 25.1124, 55.1390],
  ['Downtown / Burj', 25.1880, 55.2650],
  ['Sheikh Zayed Rd', 25.2175, 55.2825],
];
const NAMES = ['Bastion (you)', 'Sentinel gun', 'Reaver GRENADE', 'Martyr gun'];

let fails = 0;
console.log('== arena spawns, all four Dubai stops ==\n');
for (const [name, lat, lon] of STOPS) {
  const notes = [];
  for (let i = 0; i < 4; i++) {
    const ang0 = (i / 4) * Math.PI * 2;
    const wasDry = land(...at(lat, lon, ang0, R));
    const found = findDry(lat, lon, ang0);
    if (!found) { fails++; notes.push(`${NAMES[i]}=NO DRY GROUND`); continue; }
    notes.push(`${NAMES[i]}=${wasDry ? 'ok' : `moved ${Math.round((found.ang - ang0) * 180 / Math.PI)}deg`}`);
  }
  console.log(`${name.padEnd(17)} ${notes.join('  ')}`);
}

console.log(fails ? `\n${fails} FAILURES` : '\nALL PASS — every Kaiju has dry ground at every stop');
process.exit(fails ? 1 : 0);
