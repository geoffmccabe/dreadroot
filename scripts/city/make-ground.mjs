// make-ground — the elevation under every individual building.
//
// Geoff: "we need Seattle to look like Seattle... Costa Rica's terrain is very wrong... it's all
// flat and there are no chasms, rivers, roads... Nearby the city are Poas volcano and other
// volcanoes that need to be there."
//
// THE FLAT PLANE WAS ALWAYS THE PROBLEM, and this is the end of it.
//
// Until now a city stood on ONE tangent plane and the terrain under it was forced flat, because
// that is the only way boxes placed at a single height can meet the ground. It is right for Dubai,
// which is a coastal flat AND whose elevation data is wrong (-87 m across the emirate). It is
// wrong everywhere else. San Jose sits in a valley ringed by volcanoes and got a twenty-four
// kilometre table; Seattle is a set of steep hills and had 51 m shaved off Capitol Hill.
//
// The data was never the problem. Sampled around San Jose it runs from 67 m to 3,058 m inside forty
// kilometres — Irazu 3,058, Barva 2,533, Poas 2,479. All of that was being thrown away.
//
// So: sample the real elevation AT EACH BUILDING and store it. The terrain then keeps its own shape
// and every building sits on its own piece of it.
//
// IT MUST BE THE SAME NUMBER THE TERRAIN USES, or the buildings float. Two rules follow, and both
// are enforced elsewhere:
//
//   BASE ONLY, NO PROCEDURAL DETAIL. The renderer lays fractal relief over the measured elevation,
//   band-limited by the patch's own vertex spacing — so the height at a point CHANGES with the
//   level of detail. Nothing sampled offline can match that at every LOD. A city in 'follow' mode
//   therefore switches the detail off across its footprint (cityFlatness) and keeps the measured
//   elevation, which is stable.
//
//   THE SAME SAMPLER. This reads the identical tiles, at the identical levels, with the identical
//   nearest-sample lookup the game uses.
//
// Run:    node scripts/city/make-ground.mjs <slug>
// Writes: public/siege/city/<slug>/ground.bin — one int16 metre value per building, in order.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { loadCity, slugFromArgv } from './cityConfig.mjs';

const city = loadCity(slugFromArgv());
const BIN = `${city.outDir}/buildings.bin`;
const OUT = `${city.outDir}/ground.bin`;

const BASE = 'https://assets.dreadroot.com/siege/earth';
const EPOCH = 3;
const TILE = 257;
const FACE = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];
// Must mirror FACES in cubeSphere.ts exactly; a sign flip here mirrors the planet.
const FACES = [
  { u: [0, 0, -1], v: [0, -1, 0] }, { u: [0, 0, 1], v: [0, -1, 0] },
  { u: [1, 0, 0], v: [0, 0, 1] },   { u: [1, 0, 0], v: [0, 0, -1] },
  { u: [1, 0, 0], v: [0, -1, 0] },  { u: [-1, 0, 0], v: [0, -1, 0] },
];
/** Coarse to fine, as the game does: the finest tile that exists wins. */
const LEVELS = [10, 8, 6, 4];

const dirOf = (lat, lon) => {
  const la = (lat * Math.PI) / 180, lo = (lon * Math.PI) / 180, c = Math.cos(la);
  return [-c * Math.sin(lo), Math.sin(la), -c * Math.cos(lo)];
};
const faceUv = (x, y, z) => {
  const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
  let f;
  if (ax >= ay && ax >= az) f = x > 0 ? 0 : 1;
  else if (ay >= az) f = y > 0 ? 2 : 3;
  else f = z > 0 ? 4 : 5;
  const F = FACES[f], m = 1 / (ax >= ay && ax >= az ? ax : ay >= az ? ay : az);
  const px = x * m, py = y * m, pz = z * m;
  return { face: f, u: px * F.u[0] + py * F.u[1] + pz * F.u[2], v: px * F.v[0] + py * F.v[1] + pz * F.v[2] };
};
const tileIndex = (uv, level) => {
  const n = 1 << level;
  return Math.max(0, Math.min(n - 1, Math.floor(((uv + 1) / 2) * n)));
};

const tiles = new Map();
let fetched = 0;
async function tile(face, level, tx, ty) {
  const key = `${face}/${level}/${tx}_${ty}`;
  if (tiles.has(key)) return tiles.get(key);
  let data = null;
  for (let a = 0; a < 4; a++) {
    try {
      const r = await fetch(`${BASE}/h/${FACE[face]}/${level}/${tx}_${ty}.bin?v=${EPOCH}`);
      if (r.ok) { data = new Int16Array(await r.arrayBuffer()); break; }
      if (r.status === 404) break;                     // genuinely absent, not a failure
    } catch {
      await new Promise((res) => setTimeout(res, 1200 * (a + 1)));
    }
  }
  tiles.set(key, data);
  if (data) fetched++;
  return data;
}

async function elevation(lat, lon) {
  const [x, y, z] = dirOf(lat, lon);
  const { face, u, v } = faceUv(x, y, z);
  for (const level of LEVELS) {
    const tx = tileIndex(u, level), ty = tileIndex(v, level);
    const t = await tile(face, level, tx, ty);
    if (!t) continue;
    const n = 1 << level;
    const fu = ((u + 1) / 2) * n - tx, fv = ((v + 1) / 2) * n - ty;
    const i = Math.min(TILE - 1, Math.max(0, Math.round(fu * (TILE - 1))));
    const j = Math.min(TILE - 1, Math.max(0, Math.round(fv * (TILE - 1))));
    return t[j * TILE + i];
  }
  return null;
}

// --- read the buildings ---------------------------------------------------------------------------
const buf = readFileSync(BIN);
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
const lat0 = dv.getFloat64(0), lon0 = dv.getFloat64(8), count = dv.getUint32(16);
const f = new Float32Array(buf.buffer, buf.byteOffset + 24, count * 6);
const MPER_LAT = 111320;
const MPER_LON = MPER_LAT * Math.cos((lat0 * Math.PI) / 180);

console.error(`sampling ground under ${count.toLocaleString()} buildings...`);

const out = new Int16Array(count);
let min = Infinity, max = -Infinity, missing = 0;
for (let i = 0; i < count; i++) {
  const x = f[i * 6], z = f[i * 6 + 1];
  const lat = lat0 - z / MPER_LAT;
  const lon = lon0 + x / MPER_LON;
  const m = await elevation(lat, lon);
  if (m == null) { out[i] = 0; missing++; continue; }
  // Never below sea level: a building the bake placed is on land by definition, and one whose
  // ground reads negative would stand in the water. The coarse tiles average shorelines into
  // negatives all along a coast.
  const g = Math.max(1, Math.round(m));
  out[i] = g;
  if (g < min) min = g;
  if (g > max) max = g;
  if (i % 20000 === 0 && i) console.error(`  ${i.toLocaleString()}/${count.toLocaleString()}`);
}

writeFileSync(OUT, Buffer.from(out.buffer));

// --- and the same for the detailed solids ----------------------------------------------------------
//
// THE TOWERS NEED IT TOO, and forgetting them is worse than forgetting the boxes. OSM heights are
// measured from a building's OWN ground, and the renderer draws a solid from the city group's
// origin — so in follow mode every detailed tower would sit at the city's single reference height
// while the boxes around it stood on real terrain. In New York that is up to 42 m of error: the
// tallest, most recognisable buildings in the city, sunk into the ground or floating over it.
{
  const DPATH = `${city.outDir}/detail.bin`;
  if (existsSync(DPATH)) {
    const db = readFileSync(DPATH);
    const d = new DataView(db.buffer, db.byteOffset, db.byteLength);
    let o = 0;
    const n = d.getUint32(o, true); o += 4;
    const dg = new Int16Array(n);
    for (let i = 0; i < n; i++) {
      o += 1;                                    // roof shape
      const pts = d.getUint16(o, true); o += 2;
      o += 6;                                    // min height, height, roof height
      const cx = d.getInt16(o, true); o += 2;
      const cz = d.getInt16(o, true); o += 2;
      o += pts * 4;
      const lat = lat0 - cz / MPER_LAT;
      const lon = lon0 + cx / MPER_LON;
      const m = await elevation(lat, lon);
      dg[i] = m == null ? 0 : Math.max(1, Math.round(m));
    }
    writeFileSync(`${city.outDir}/detail-ground.bin`, Buffer.from(dg.buffer));
    console.error(`wrote ${city.outDir}/detail-ground.bin — ${n.toLocaleString()} solids`);
  }
}
console.error(`wrote ${OUT} — ${(out.byteLength / 1024).toFixed(0)} KB, ${fetched} tiles read`);
console.error(`ground under the city runs ${min} m to ${max} m (a spread of ${max - min} m)`);
if (missing) console.error(`${missing} buildings had no elevation data and were set to 0`);
if (max - min < 5) {
  console.error('NOTE: almost no spread — this city really is flat, or only the coarsest tiles exist here.');
}
