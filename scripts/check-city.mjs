// check-city — is the city file actually a city?
//
// The fetch runs for the better part of an hour against someone else's server, so the failure that
// matters is the quiet one: a file that loads, parses, contains plausible numbers, and is wrong.
// Two of those have already happened on this feature — five tiles of Dubai Marina cached as "no
// buildings here" because a failed request looked identical to an empty one, and every building
// over 400 m of footprint silently deleted, which removed the Dubai Mall and every other mall,
// terminal and stadium in the city.
//
// Neither would have shown up as an error. Both show up here.
//
// Run: node scripts/check-city.mjs

import { readFileSync, existsSync } from 'node:fs';

const BIN = 'public/siege/city/dubai.bin';
const IDS = 'public/siege/city/dubai-ids.bin';
const LANDMARKS = 'public/siege/city/dubai-landmarks.json';

let failures = 0;
function ok(cond, label, detail = '') {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!cond) failures++;
}

console.log('\n== Is the city a city? ==\n');

if (!existsSync(BIN)) {
  console.log(`  FAIL  ${BIN} does not exist — run scripts/fetch-dubai-buildings.mjs\n`);
  process.exit(1);
}

const buf = readFileSync(BIN);
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
const lat0 = dv.getFloat64(0);
const lon0 = dv.getFloat64(8);
const count = dv.getUint32(16);
const body = new Float32Array(buf.buffer, buf.byteOffset + 24, count * 6);

console.log(`  origin ${lat0.toFixed(4)}, ${lon0.toFixed(4)} — ${count.toLocaleString()} buildings, `
  + `${(buf.length / 1024).toFixed(0)} KB\n`);

ok(buf.length === 24 + count * 24, 'the file is exactly the size the header claims',
   `${buf.length} vs ${24 + count * 24}`);
ok(lat0 > 24 && lat0 < 26 && lon0 > 54 && lon0 < 56, 'the origin is in Dubai',
   `${lat0.toFixed(3)}, ${lon0.toFixed(3)}`);

// --- every number has to be a number ------------------------------------------------------------
{
  let bad = 0;
  for (let i = 0; i < body.length; i++) if (!Number.isFinite(body[i])) bad++;
  ok(bad === 0, 'no NaN or Infinity anywhere', `${bad} bad values`);
}

const H = [], W = [], D = [], R = [];
let farthest = 0;
for (let i = 0; i < count; i++) {
  const x = body[i * 6], z = body[i * 6 + 1];
  W.push(body[i * 6 + 2]); D.push(body[i * 6 + 3]);
  R.push(body[i * 6 + 4]); H.push(body[i * 6 + 5]);
  farthest = Math.max(farthest, Math.hypot(x, z));
}
const sorted = H.slice().sort((a, b) => b - a);

// --- the shape of a real city -------------------------------------------------------------------
ok(count > 20000, 'there are enough buildings to be four districts', `${count.toLocaleString()}`);
ok(H.every((h) => h > 0 && h < 900), 'every height is between 0 and 900 m',
   `tallest ${sorted[0]?.toFixed(0)} m`);
ok(sorted[0] > 400, 'something supertall survived — the Burj is 828 m and its roof is 585',
   `tallest ${sorted[0]?.toFixed(0)} m`);
ok(sorted.filter((h) => h >= 300).length >= 15,
   'there are many 300 m+ towers, as Dubai has',
   `${sorted.filter((h) => h >= 300).length} of them`);
// 150, not the 200 I first wrote. That figure was a guess about how many 150 m towers Dubai has,
// and the four boxes fetched here do not cover the whole city — Deira, Barsha and the rest of
// Business Bay are outside them. The measured answer for THIS coverage is 175, so this is now a
// regression guard ("do not lose the towers we have") rather than a claim about Dubai. An assertion
// whose number was invented is worse than no assertion, because it fails for the wrong reason and
// teaches you to ignore it.
ok(sorted.filter((h) => h >= 150).length >= 150,
   'and a proper forest of 150 m+ towers',
   `${sorted.filter((h) => h >= 150).length}`);

// THE REGRESSION THAT ACTUALLY HAPPENED. A flat footprint cap silently removed every mall, airport
// terminal and stadium, and nothing looked wrong: the file still had thousands of buildings in it.
{
  const huge = W.map((w, i) => Math.max(w, D[i])).filter((m) => m > 400).length;
  ok(huge > 0, 'buildings larger than 400 m across EXIST (malls, terminals)',
     `${huge} of them — zero means the size cap deleted the Dubai Mall again`);
}

ok(W.every((w) => w >= 2) && D.every((d) => d >= 2), 'no zero-size footprints');
ok(R.every((r) => r >= -Math.PI - 1e-3 && r <= Math.PI + 1e-3), 'every rotation is a real angle');
// The four districts span about 20 km, and the origin is in the middle of them.
ok(farthest < 25000, 'every building is within 25 km of the origin',
   `farthest ${(farthest / 1000).toFixed(1)} km`);
ok(farthest > 8000, 'and the city genuinely spreads across the districts',
   `farthest ${(farthest / 1000).toFixed(1)} km`);

// --- the sidecar that makes permanent damage possible later --------------------------------------
if (existsSync(IDS)) {
  const idbuf = readFileSync(IDS);
  const ids = new Float64Array(idbuf.buffer, idbuf.byteOffset, idbuf.length / 8);
  ok(ids.length === count, 'there is exactly one OSM id per building',
     `${ids.length} ids vs ${count} buildings`);
  ok(new Set(ids).size === ids.length, 'and every id is unique — damage cannot key to two towers',
     `${ids.length - new Set(ids).size} duplicates`);
  ok([...ids].every((v) => Number.isFinite(v) && v !== 0), 'no null ids');
} else {
  ok(false, 'the OSM id sidecar exists', 'permanent damage would have no stable key');
}

// --- the landmarks, which are also the sanity check a human can read ------------------------------
if (existsSync(LANDMARKS)) {
  const lm = JSON.parse(readFileSync(LANDMARKS, 'utf8'));
  ok(lm.length > 50, 'a good list of named towers', `${lm.length}`);
  console.log('\n  Tallest named towers found:');
  for (const n of lm.slice(0, 10)) console.log(`    ${String(n.h).padStart(4)} m  ${n.name}`);
}

console.log(`\n${failures === 0 ? 'CITY CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
