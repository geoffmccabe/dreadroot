// Round-trip check for src/components/siege/globe/cubeSphere.ts (step B1 of
// docs/MINI_EARTH_P1_BUILD.md). Run BEFORE anything renders: every later bug will look like
// a rendering bug and actually be here.
//
//   node scripts/earth/check_cubesphere.mjs
//
// Checks:
//   1. direction -> face/uv -> direction round-trips to float noise
//   2. lat/lon -> direction -> lat/lon round-trips
//   3. known landmarks land on the face we expect
//   4. tile index / uv range agree with each other
//   5. the face table matches build_earth_tiles.py

import { readFileSync } from 'node:fs';

// Strip the TypeScript types with esbuild (already a vite dependency) rather than by hand,
// then import the result. Keeps this check honest: it runs the REAL module source.
import { transform } from 'esbuild';

const srcPath = 'src/components/siege/globe/cubeSphere.ts';
const ts = readFileSync(srcPath, 'utf8');
const { code: js } = await transform(ts, { loader: 'ts', format: 'esm' });

const mod = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const {
  faceUvToDirection, directionToFaceUv, directionToLatLon, latLonToDirection,
  uvToTileIndex, tileUvRange, tileArcUnits, sampleSpacingUnits, PLANET_RADIUS, FACE_NAMES,
} = mod;

let failures = 0;
const fail = (msg) => { console.error('  FAIL ' + msg); failures++; };

// --- 1. direction -> face/uv -> direction -----------------------------------------------
{
  let worst = 0;
  const out = new Float64Array(3);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  for (let i = 0; i < 20000; i++) {
    let x = rnd(), y = rnd(), z = rnd();
    const len = Math.hypot(x, y, z);
    if (len < 1e-6) continue;
    x /= len; y /= len; z /= len;
    const { face, u, v } = directionToFaceUv(x, y, z);
    faceUvToDirection(face, u, v, out);
    worst = Math.max(worst, Math.hypot(out[0] - x, out[1] - y, out[2] - z));
  }
  console.log(`1. direction round-trip: worst error ${worst.toExponential(2)}`);
  if (worst > 1e-12) fail(`round-trip error ${worst} exceeds 1e-12`);
}

// --- 2. lat/lon round-trip ---------------------------------------------------------------
{
  let worst = 0;
  const out = new Float64Array(3);
  for (let lat = -89; lat <= 89; lat += 7) {
    for (let lon = -180; lon < 180; lon += 11) {
      latLonToDirection(lat, lon, out);
      const r = directionToLatLon(out[0], out[1], out[2]);
      let dlon = Math.abs(r.lon - lon);
      if (dlon > 180) dlon = 360 - dlon;
      worst = Math.max(worst, Math.abs(r.lat - lat), dlon);
    }
  }
  console.log(`2. lat/lon round-trip: worst error ${worst.toExponential(2)} degrees`);
  if (worst > 1e-9) fail(`lat/lon round-trip error ${worst} exceeds 1e-9 degrees`);
}

// --- 3. landmarks land on a sensible face ------------------------------------------------
{
  // Expected faces derived by hand from the direction each place points in, NOT guessed.
  // These flipped when the mirrored-longitude bug was fixed (see 3b): with the correct
  // right-handed convention Everest (lon 87 E) is dominated by -X and Quito (lon 78 W) by +X.
  // Recomputed from dir = (-cos(lat)sin(lon), sin(lat), -cos(lat)cos(lon)), not from the failure.
  const places = [
    ['North Pole',   90, 0,      'py'],
    ['South Pole',  -90, 0,      'ny'],
    ['Null Island',   0, 0,      'nz'],
    ['Everest',   27.99, 86.93,  'nx'],
    ['Mariana',   11.35, 142.2,  'pz'],
    ['Quito',     -0.18, -78.47, 'px'],
  ];
  const out = new Float64Array(3);
  for (const [name, lat, lon, expect] of places) {
    latLonToDirection(lat, lon, out);
    const { face } = directionToFaceUv(out[0], out[1], out[2]);
    const got = FACE_NAMES[face];
    const ok = got === expect;
    console.log(`3. ${name.padEnd(12)} lat ${String(lat).padStart(7)} lon ${String(lon).padStart(8)} -> face ${got} ${ok ? '' : `(expected ${expect})`}`);
    if (!ok) fail(`${name} landed on face ${got}, expected ${expect}`);
  }
}

// --- 3b. HANDEDNESS: the bug landmark checks cannot see ------------------------------------
// A mirrored planet is self-consistent: latLonToDirection and directionToLatLon still invert
// each other, and sampling a known place still returns its true elevation, so every check in
// this file up to here passes while every continent renders backwards. The only thing that
// catches it is that (East, North, Up) must be RIGHT-handed, E x N = U, as it is on Earth.
{
  const out = new Float64Array(3), oe = new Float64Array(3), on = new Float64Array(3);
  const eps = 1e-5;
  let left = 0, total = 0;
  for (let lat = -60; lat <= 60; lat += 30) {
    for (let lon = -150; lon < 180; lon += 60) {
      latLonToDirection(lat, lon, out);
      latLonToDirection(lat, lon + eps, oe);
      const e = [oe[0] - out[0], oe[1] - out[1], oe[2] - out[2]];
      latLonToDirection(lat + eps, lon, on);
      const n = [on[0] - out[0], on[1] - out[1], on[2] - out[2]];
      // (E x N) . U must be positive
      const cx = e[1] * n[2] - e[2] * n[1];
      const cy = e[2] * n[0] - e[0] * n[2];
      const cz = e[0] * n[1] - e[1] * n[0];
      if (cx * out[0] + cy * out[1] + cz * out[2] < 0) left++;
      total++;
    }
  }
  console.log(`3b. handedness (E x N = U): ${total - left}/${total} right-handed`);
  if (left) fail(`${left}/${total} points are LEFT-handed: the globe renders MIRRORED`);
}

// --- 4. tile indexing self-consistency ---------------------------------------------------
{
  let bad = 0;
  for (let level = 0; level <= 6; level++) {
    const n = 1 << level;
    for (let i = 0; i < n; i++) {
      const [lo, hi] = tileUvRange(i, level);
      const mid = (lo + hi) / 2;
      if (uvToTileIndex(mid, level) !== i) bad++;
      if (Math.abs(hi - lo - 2 / n) > 1e-12) bad++;
    }
  }
  console.log(`4. tile index/range consistency across levels 0-6: ${bad === 0 ? 'ok' : bad + ' mismatches'}`);
  if (bad) fail(`${bad} tile index mismatches`);
}

// --- 5. face table matches the Python ----------------------------------------------------
{
  const py = readFileSync('scripts/earth/build_earth_tiles.py', 'utf8');
  const block = py.slice(py.indexOf('FACES = ['), py.indexOf(']', py.indexOf('FACES = [')));
  const pyFaces = [...block.matchAll(/\("(\w\w)",\s*\(([^)]*)\),\s*\(([^)]*)\),\s*\(([^)]*)\)\)/g)]
    .map((m) => [m[1], ...m.slice(2).map((s) => s.split(',').map((v) => Number(v.trim())))]);
  const tsBlock = ts.slice(ts.indexOf('const FACES'), ts.indexOf('];', ts.indexOf('const FACES')));
  const tsFaces = [...tsBlock.matchAll(/origin: \[([^\]]*)\],\s*u: \[([^\]]*)\],\s*v: \[([^\]]*)\][^/]*\/\/ (\w\w)/g)]
    .map((m) => [m[4], ...m.slice(1, 4).map((s) => s.split(',').map((v) => Number(v.trim())))]);

  let mismatch = 0;
  if (pyFaces.length !== 6 || tsFaces.length !== 6) {
    fail(`parsed ${pyFaces.length} python faces and ${tsFaces.length} ts faces, expected 6 each`);
  } else {
    for (let i = 0; i < 6; i++) {
      if (JSON.stringify(pyFaces[i]) !== JSON.stringify(tsFaces[i])) {
        fail(`face ${i} differs: py ${JSON.stringify(pyFaces[i])} vs ts ${JSON.stringify(tsFaces[i])}`);
        mismatch++;
      }
    }
  }
  console.log(`5. python/ts face tables: ${mismatch === 0 && pyFaces.length === 6 ? 'identical' : 'MISMATCH'}`);
}

// --- info --------------------------------------------------------------------------------
console.log('\nscale reference:');
console.log(`  planet radius      ${PLANET_RADIUS.toLocaleString()} units`);
for (const l of [0, 1, 2, 3, 4, 5]) {
  console.log(`  level ${l}: tile arc ${tileArcUnits(l).toFixed(0).padStart(7)} units, `
    + `sample spacing ${sampleSpacingUnits(l).toFixed(1).padStart(6)} units `
    + `(${(sampleSpacingUnits(l) * 100 / 1000).toFixed(2)} km real)`);
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
