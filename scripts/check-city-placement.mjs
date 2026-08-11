// check-city-placement — is the city where the city is?
//
// THE GUIDE TELLS AGENTS TO ASSERT AGAINST REAL NAMED PLACES, and this is the script that does it.
// It is the single most valuable check in the set, because a mis-projected city is not obviously
// broken from inside the game — it is a plausible-looking city standing a kilometre from where it
// should be, or mirrored, or rotated, and every one of those survives a look.
//
// Dubai's build hit all three failure modes this catches:
//
//   OFFSET      "The whole city seems to be off by 1km or so" — it was not; the ground override was.
//               But the only way to know that was to measure a landmark against its real coordinate.
//   MIRRORED    A rotation applied the wrong way round mirrors every building. On a grid city that
//               reads as "almost right", which is the most expensive kind of wrong.
//   HOLES       Five tiles of Dubai Marina, three 330 m towers among them, went missing to a failed
//               request that looked like an empty answer. Nothing complained.
//
// Landmarks come from the city's own config, so adding a city means adding coordinates rather than
// editing this file.
//
// Run: node scripts/check-city-placement.mjs <slug>

import { readFileSync, existsSync } from 'node:fs';
import { loadCity, slugFromArgv } from './city/cityConfig.mjs';

const city = loadCity(slugFromArgv());
const BIN = `${city.outDir}/buildings.bin`;
if (!existsSync(BIN)) { console.error(`no ${BIN} — run the bake first`); process.exit(2); }

const buf = readFileSync(BIN);
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
const lat0 = dv.getFloat64(0), lon0 = dv.getFloat64(8), count = dv.getUint32(16);
const f = new Float32Array(buf.buffer, buf.byteOffset + 24, count * 6);
// Field order is x, z, w, d, ROT, H — the rotation comes before the height, and reading them the
// other way round reports every building as 3 m tall, which looks like a broken bake rather than a
// broken reader. It cost half an hour once already.
const X = 0, Z = 1, W = 2, D = 3, H = 5;

// BOTH FILES, OR THE LANDMARKS ARE THE ONES THAT LOOK MISSING. make-detail promotes every building
// OSM describes in 3D to a real extruded polygon and REMOVES its box from buildings.bin — so the
// famous towers, which are exactly the ones worth asserting on, are the ones absent from the box
// file. The first run of this check reported the Burj Khalifa as a hole for precisely that reason.
const solids = [];
const DETAIL = `${city.outDir}/detail.bin`;
if (existsSync(DETAIL)) {
  const db = readFileSync(DETAIL);
  const d = new DataView(db.buffer, db.byteOffset, db.byteLength);
  let o = 0;
  const n = d.getUint32(o, true); o += 4;
  for (let i = 0; i < n; i++) {
    o += 1;                                   // roof shape
    const pts = d.getUint16(o, true); o += 2;
    o += 2;                                   // min height
    const h = d.getInt16(o, true); o += 2;
    o += 2;                                   // roof height
    const cx = d.getInt16(o, true); o += 2;
    const cz = d.getInt16(o, true); o += 2;
    o += pts * 4;
    solids.push({ x: cx, z: cz, h });
  }
}

let fails = 0;
const fail = (m) => { console.log(`FAIL  ${m}`); fails++; };
const pass = (m) => console.log(`PASS  ${m}`);

console.log(`== ${city.name ?? city.slug}: ${count.toLocaleString()} boxes + ${solids.length.toLocaleString()} detailed solids ==\n`);

// The bake must have written the config's own origin, or every offset below means something else.
if (Math.abs(lat0 - city.lat0) > 1e-9 || Math.abs(lon0 - city.lon0) > 1e-9) {
  fail(`bake origin ${lat0}, ${lon0} does not match the config's ${city.lat0}, ${city.lon0}`);
} else {
  pass(`origin ${lat0}, ${lon0} matches the config`);
}

// --- landmarks --------------------------------------------------------------------------------
const marks = city.landmarks ?? [];
if (!marks.length) {
  fail('no "landmarks" in the config — add 5-6 real places or this city is unverified');
}
for (const m of marks) {
  const [tx, tz] = city.project(m);
  const within = m.within ?? 250;
  let n = 0, tallest = 0;
  for (let i = 0; i < count; i++) {
    if (Math.hypot(f[i * 6 + X] - tx, f[i * 6 + Z] - tz) < within) {
      n++;
      if (f[i * 6 + H] > tallest) tallest = f[i * 6 + H];
    }
  }
  for (const s2 of solids) {
    if (Math.hypot(s2.x - tx, s2.z - tz) < within) {
      n++;
      if (s2.h > tallest) tallest = s2.h;
    }
  }
  const want = m.expect ?? 5;
  if (n < want) fail(`${m.name}: only ${n} buildings within ${within} m (wanted ${want}) — a hole, or the city is offset`);
  else pass(`${m.name.padEnd(30)} ${String(n).padStart(4)} buildings within ${within} m, tallest ${tallest.toFixed(0)} m`);
}

// --- extent -----------------------------------------------------------------------------------
// Nothing may sit outside the radius the ground is held flat over, or it stands on unheld ground.
const range = city.maxRangeMetres ?? 26000;
let outside = 0, maxR = 0;
for (let i = 0; i < count; i++) {
  const r = Math.hypot(f[i * 6 + X], f[i * 6 + Z]);
  if (r > maxR) maxR = r;
  if (r > range) outside++;
}
if (outside) fail(`${outside} buildings lie beyond maxRangeMetres ${range} (furthest ${maxR.toFixed(0)} m)`);
else pass(`every building within ${maxR.toFixed(0)} m of the origin (limit ${range} m)`);

// --- shape sanity -------------------------------------------------------------------------------
// A bake that reads its fields in the wrong order produces a city of identical 3 m sheds, and that
// is indistinguishable from a real low-rise city unless you look at the SPREAD.
let sumH = 0, over30 = 0, over100 = 0, tallest = 0, zeroArea = 0;
for (let i = 0; i < count; i++) {
  const h = f[i * 6 + H];
  sumH += h;
  if (h > 30) over30++;
  if (h > 100) over100++;
  if (h > tallest) tallest = h;
  if (f[i * 6 + W] < 0.5 || f[i * 6 + D] < 0.5) zeroArea++;
}
for (const s2 of solids) {
  if (s2.h > 30) over30++;
  if (s2.h > 100) over100++;
  if (s2.h > tallest) tallest = s2.h;
}
console.log(`\n  mean height ${(sumH / count).toFixed(1)} m · over 30 m: ${over30} · over 100 m: ${over100} · tallest ${tallest.toFixed(0)} m`);
if (tallest < 12) fail(`tallest building is ${tallest.toFixed(0)} m — the height field is probably being read from the wrong offset`);
if (over30 === 0) fail('not one building over 30 m — no city looks like this');
if (zeroArea > count * 0.02) fail(`${zeroArea} buildings have no footprint — the width/depth fields look wrong`);

// --- coverage -------------------------------------------------------------------------------------
// Holes are the failure that leaves no trace. A 1 km grid over the built area shows them.
const CELL = 1000;
const occupied = new Set();
for (let i = 0; i < count; i++) {
  occupied.add(`${Math.round(f[i * 6 + X] / CELL)},${Math.round(f[i * 6 + Z] / CELL)}`);
}
console.log(`  ${occupied.size} occupied square kilometres`);

console.log(fails ? `\n${fails} FAILURES` : '\nALL PASS');
process.exit(fails ? 1 : 0);
