// make-city-water — the Marina's marina, and Downtown's lake.
//
// Geoff: "The Marina area has no marina... the areas that are internal waterways into the area
// aren't there... they're just sand. It's the same problem in the downtown area where there are big
// famous water features that aren't there. Maybe you can do it as just a colour the way you did the
// roads?"
//
// The colour is exactly right, and for a reason worth writing down. The land mask ALREADY knows
// about these: the Marina's channels and the Burj Lake are punched out of it, so the ground under
// them genuinely dips to sea floor. But knowing where the water is and DRAWING it are different
// jobs, and two things stopped it reading as water:
//
//   THE MESH IS TOO COARSE. The terrain resolves 38 m at best. The Marina's channel is about 120 m
//   across, so it gets three vertices to describe a trench with two vertical walls — which comes out
//   as a shallow dip, not a canal.
//
//   THE OCEAN IS NEARLY CLEAR HERE. Its opacity ramps with depth and does not reach solid until
//   120 m. A coastal channel is a fraction of that, so what was drawn over the sand was a faint blue
//   tint. Sand, essentially.
//
// So the waterways get their own flat surface, drawn from their real OSM outlines and laid at sea
// level like a sheet — the same trick as the roads, and for the same reason: the shape is known
// exactly, it is flat, and it needs to be opaque enough to read.
//
// TRIANGULATED HERE, NOT IN THE BROWSER. Ear clipping is O(n^2) and these are done once; shipping
// triangles rather than outlines also means no triangulation library in the bundle.
//
// Run: node scripts/make-city-water.mjs      (expects /tmp/coast_all.json)
// Writes: public/siege/city/dubai-water.bin

import { readFileSync, writeFileSync } from 'node:fs';

const IN = '/tmp/coast_all.json';
const OUT = 'public/siege/city/dubai-water.bin';

const LAT0 = 25.14, LON0 = 55.21;
const MPER_LAT = 111320;
const MPER_LON = MPER_LAT * Math.cos((LAT0 * Math.PI) / 180);
const MAX_RANGE_M = 26000;

/** Below this a pond is a swimming pool, and at 300 m tall you cannot see it. */
const MIN_AREA_M2 = 2000;

const project = (p) => [(p.lon - LON0) * MPER_LON, -(p.lat - LAT0) * MPER_LAT];

function area2(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j][0] * ring[i][1]) - (ring[i][0] * ring[j][1]);
  }
  return a / 2;
}

/** Ear clipping. Plain, unoptimised, and run once offline on rings of at most a few hundred points. */
function triangulate(ring) {
  const pts = ring.slice();
  if (area2(pts) < 0) pts.reverse();               // work counter-clockwise
  const idx = pts.map((_, i) => i);
  const out = [];
  let guard = idx.length * idx.length + 16;
  while (idx.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const a = pts[idx[(i + idx.length - 1) % idx.length]];
      const b = pts[idx[i]];
      const c = pts[idx[(i + 1) % idx.length]];
      const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (cross <= 0) continue;                    // reflex, not an ear
      // No other vertex may sit inside the candidate ear.
      let ok = true;
      for (let k = 0; k < idx.length && ok; k++) {
        if (k === i || k === (i + idx.length - 1) % idx.length || k === (i + 1) % idx.length) continue;
        const p = pts[idx[k]];
        const d1 = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
        const d2 = (c[0] - b[0]) * (p[1] - b[1]) - (c[1] - b[1]) * (p[0] - b[0]);
        const d3 = (a[0] - c[0]) * (p[1] - c[1]) - (a[1] - c[1]) * (p[0] - c[0]);
        if (d1 >= 0 && d2 >= 0 && d3 >= 0) ok = false;
      }
      if (!ok) continue;
      out.push([a, b, c]);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    // A self-intersecting ring has no ear anywhere. Dropping the rest is better than looping: OSM
    // water outlines are occasionally traced across themselves, and one malformed lake is invisible
    // where a hang is not.
    if (!clipped) break;
  }
  if (idx.length === 3) out.push([pts[idx[0]], pts[idx[1]], pts[idx[2]]]);
  return out;
}

const els = JSON.parse(readFileSync(IN, 'utf8')).elements ?? [];
const rings = [];
let fromWays = 0, fromRelations = 0;

for (const e of els) {
  const t = e.tags ?? {};
  if (t.natural === 'coastline') continue;

  // Ways carry their own geometry; relations (multipolygons — the Creek and the bigger lagoons are
  // mapped this way) carry it on their outer members. Skipping relations would lose exactly the
  // large, famous water that prompted this.
  const candidates = [];
  if (e.geometry) candidates.push(e.geometry);
  else if (e.members) {
    for (const m of e.members) {
      if (m.role === 'inner') continue;            // islands in a lake; ignored, they are tiny here
      if (m.geometry && m.geometry.length >= 3) candidates.push(m.geometry);
    }
  }

  for (const g of candidates) {
    if (g.length < 3) continue;
    const ring = g.map(project).filter(([x, z]) => Math.abs(x) < MAX_RANGE_M && Math.abs(z) < MAX_RANGE_M);
    if (ring.length < 3) continue;
    if (Math.abs(area2(ring)) < MIN_AREA_M2) continue;
    rings.push(ring);
    if (e.geometry) fromWays++; else fromRelations++;
  }
}
console.error(`${rings.length} water outlines (${fromWays} ways, ${fromRelations} relation members)`);

const tris = [];
let totalArea = 0;
for (const ring of rings) {
  totalArea += Math.abs(area2(ring));
  for (const t of triangulate(ring)) tris.push(t);
}
console.error(`${tris.length} triangles, ${(totalArea / 1e6).toFixed(2)} km2 of water`);

// uint32 triangle count, then 3 x (int16 x, int16 z) per triangle.
const size = 4 + tris.length * 12;
const out = new Uint8Array(size);
const dv = new DataView(out.buffer);
let o = 0;
dv.setUint32(o, tris.length, true); o += 4;
const c16 = (v) => Math.max(-32768, Math.min(32767, Math.round(v)));
for (const t of tris) {
  for (const [x, z] of t) { dv.setInt16(o, c16(x), true); o += 2; dv.setInt16(o, c16(z), true); o += 2; }
}
writeFileSync(OUT, Buffer.from(out));
console.error(`wrote ${OUT} — ${(size / 1024).toFixed(0)} KB`);
