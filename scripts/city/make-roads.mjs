// make-city-roads — Dubai's streets, as lines with a width and a class.
//
// Geoff: "Also there are no roads. Can you put in the roads between the buildings somehow?"
//
// He is right that this was missing, and missing in a way that matters more than it sounds. A city
// is not buildings; it is buildings AND the gaps between them, and the gaps are what give the eye
// something to measure against. Fifty-nine thousand boxes on bare sand reads as a field of boxes.
// The same boxes with a road grid running between them reads as a city, because the roads are the
// only thing at human scale in the whole scene.
//
// It also fixes the traffic. The first pass took only motorways and trunk roads — 301 of them —
// because that was enough to carry streams of light. But cars on invisible roads look like cars
// driving through the desert, and Geoff asked for ten times as many of them, which on 301 roads
// would be a traffic jam on a handful of highways and nothing anywhere else.
//
// SO EVERYTHING DRIVEABLE, from motorways down to residential streets. That is 38,508 ways and
// 384,009 points raw, which is far too much geometry to draw as ribbons — so:
//
//   SIMPLIFIED at 12 m by Douglas-Peucker. A road's shape from a 300 m creature's eye height needs
//   a point every hundred metres or so, not every four. This throws away most points and changes
//   nothing anyone can see.
//
//   STUBS DROPPED below a class-dependent length. A 30 m residential spur is a driveway; drawn, it
//   is a speck, and there are tens of thousands of them.
//
//   INT16 METRES. The range is +/-26,000 and an int16 holds +/-32,767, so a point is four bytes at
//   a metre of precision — a tenth of a lane width, and finer than anything visible from up there.
//
// Emitted as a .bin rather than base64 in a .ts, unlike the first pass: at this size it belongs in
// a file the browser can cache and decode natively, not in the JavaScript bundle.
//
// Run:    node scripts/city/make-roads.mjs <slug>
// Writes: public/siege/city/<slug>/roads.bin

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { loadCity, slugFromArgv, overpassTiled } from './cityConfig.mjs';

const city = loadCity(slugFromArgv());
const RAW = `${city.rawDir}/roads.json`;
const OUT = `${city.outDir}/roads.bin`;

const SIMPLIFY_M = 12;
const MAX_RANGE_M = city.maxRangeMetres ?? 26000;

// FETCHED ONCE AND KEPT. Overpass throttles, and a re-bake that has to re-download 38,000 ways is a
// re-bake nobody runs — so the raw response is cached under .city-cache/<slug>/ and reused.
{
  console.error(`fetching roads for ${city.slug}...`);
  // TILED at 0.04 degrees, about 4 km. One query for a whole city is refused outright on a busy day
  // — see overpassTiled — and a city with no streets is the result.
  const data = await overpassTiled(city, 'roads', 0.04, (s, w, n, e) => `[out:json][timeout:120];
way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|motorway_link|trunk_link|primary_link)$"](${s},${w},${n},${e});
out geom;`);
  if (!data.elements.length) { console.error('nothing came back — re-run when Overpass is quieter'); process.exit(1); }
  // ALWAYS RE-RUN THE TILED FETCH. The per-tile cache under .city-cache is the real cache; this
  // merged file is only an artifact. Guarding on it existing meant a run that lost 55 of 56 tiles
  // wrote a merged file from the one survivor and then SKIPPED the fetch on every later attempt —
  // so "re-run it to fill the gaps", which the script itself prints, did nothing at all.
  writeFileSync(RAW, JSON.stringify(data));
}

/**
 * Road classes, in the order they are stored.
 *
 * WIDTHS ARE REAL, measured off the actual roads rather than picked to look right. Sheikh Zayed
 * Road is genuinely six lanes each way plus shoulders and a median, which is why 44 m is not a
 * mistake; and a Dubai residential street with parking both sides really is about 9 m of asphalt.
 * Getting these wrong in either direction is immediately obvious next to a 300 m creature.
 *
 * `minLen` is how short a way of this class has to be before it is a slip lane or a driveway rather
 * than a road. Motorways are never stubs; residential streets very often are.
 */
const CLASSES = [
  { key: 'motorway',      width: 44, minLen: 60,  traffic: 1.0 },
  { key: 'trunk',         width: 40, minLen: 60,  traffic: 1.0 },
  { key: 'primary',       width: 28, minLen: 80,  traffic: 0.8 },
  { key: 'secondary',     width: 20, minLen: 90,  traffic: 0.5 },
  { key: 'tertiary',      width: 15, minLen: 100, traffic: 0.3 },
  { key: 'residential',   width: 9,  minLen: 120, traffic: 0.08 },
  { key: 'unclassified',  width: 9,  minLen: 120, traffic: 0.08 },
  { key: 'motorway_link', width: 12, minLen: 80,  traffic: 0.25 },
  { key: 'trunk_link',    width: 12, minLen: 80,  traffic: 0.25 },
  { key: 'primary_link',  width: 11, minLen: 80,  traffic: 0.2 },
];
const CLASS_OF = new Map(CLASSES.map((c, i) => [c.key, i]));

function simplify(pts, eps) {
  if (pts.length < 3) return pts;
  let maxD = 0, idx = 0;
  const [ax, az] = pts[0], [bx, bz] = pts[pts.length - 1];
  const dx = bx - ax, dz = bz - az;
  const len = Math.hypot(dx, dz) || 1;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((pts[i][0] - ax) * dz - (pts[i][1] - az) * dx) / len;
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD <= eps) return [pts[0], pts[pts.length - 1]];
  return simplify(pts.slice(0, idx + 1), eps).slice(0, -1).concat(simplify(pts.slice(idx), eps));
}

const els = JSON.parse(readFileSync(RAW, 'utf8')).elements ?? [];
const roads = [];
let dropped = 0, clipped = 0;

for (const e of els) {
  const g = e.geometry ?? [];
  if (g.length < 2) continue;
  const cls = CLASS_OF.get((e.tags ?? {}).highway);
  if (cls === undefined) continue;

  // Clip to the city box, keeping the RUNS that fall inside rather than the points — a road that
  // leaves and re-enters must become two roads, or it gets a straight line drawn across the gap.
  const raw = g.map(city.project);
  const runs = [];
  let run = [];
  for (const p of raw) {
    if (Math.abs(p[0]) < MAX_RANGE_M && Math.abs(p[1]) < MAX_RANGE_M) run.push(p);
    else { if (run.length >= 2) { runs.push(run); clipped++; } run = []; }
  }
  if (run.length >= 2) runs.push(run);

  for (let pts of runs) {
    pts = simplify(pts, SIMPLIFY_M);
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (len < CLASSES[cls].minLen) { dropped++; continue; }
    // int16 caps a run at 32,767 points, and nothing here is remotely close; the guard is for the
    // format, not for the data.
    if (pts.length > 30000) pts = pts.slice(0, 30000);
    roads.push({ cls, pts, len });
  }
}

const totalPts = roads.reduce((a, r) => a + r.pts.length, 0);
const totalKm = roads.reduce((a, r) => a + r.len, 0) / 1000;
const perClass = {};
for (const r of roads) perClass[CLASSES[r.cls].key] = (perClass[CLASSES[r.cls].key] ?? 0) + 1;
console.error(`${roads.length} roads, ${totalPts} points, ${totalKm.toFixed(0)} km`);
console.error(`dropped ${dropped} stubs, ${clipped} runs clipped at the boundary`);
console.error(perClass);

// --- pack ------------------------------------------------------------------------------------------
// uint32 count, then per road: uint8 class, uint16 point count, then int16 x,z pairs.
const size = 4 + roads.length * 3 + totalPts * 4;
const out = new Uint8Array(size);
const dv = new DataView(out.buffer);
let o = 0;
dv.setUint32(o, roads.length, true); o += 4;
const clamp16 = (v) => Math.max(-32768, Math.min(32767, Math.round(v)));
for (const r of roads) {
  dv.setUint8(o, r.cls); o += 1;
  dv.setUint16(o, r.pts.length, true); o += 2;
  for (const [x, z] of r.pts) {
    dv.setInt16(o, clamp16(x), true); o += 2;
    dv.setInt16(o, clamp16(z), true); o += 2;
  }
}
writeFileSync(OUT, Buffer.from(out));
console.error(`wrote ${OUT} — ${(size / 1024).toFixed(0)} KB`);
console.error('class widths (metres): ' + CLASSES.map((c) => `${c.key}=${c.width}`).join(' '));
