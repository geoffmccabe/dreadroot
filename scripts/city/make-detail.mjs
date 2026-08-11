// make-city-detail — the buildings that are not boxes.
//
// Geoff: "I think the Burj is just a rectangle that has its top cropped off, and all other buildings
// that have a spire or a dome or anything other than a rectangle are also wrong. Are you able to
// give these their correct heights and shapes?"
//
// Yes, for the ones the world has bothered to describe, and the Burj Khalifa is the clearest case.
// Its OSM outline carries no height at all — only `building:levels=163`, which the box bake turned
// into 163 x 3.2 = 522 m. That is why it looked cropped: it WAS cropped, by 306 m.
//
// The real shape lives in a different OSM layer. Simple 3D Buildings maps a complicated building as
// a stack of `building:part` polygons, each with its own height and optional min_height, plus a
// roof shape. The Burj is 38 of them, nested, rising from 545 m to 828 m — which is exactly the
// telescoping setback tower it actually is, spire included. Across Dubai there are 1,319 parts:
// 101 pyramidal roofs, 40 skillions, 13 domes, 6 round, and 220 parts with a min_height, which is
// what makes podiums and setbacks.
//
// TWO TIERS, DELIBERATELY. The 59,202 ordinary buildings stay instanced boxes — that is what keeps
// the city to one draw call, and a box is a fair model of a building nobody has surveyed in 3D. Only
// the described ones are promoted to real extruded polygons, and their boxes are REMOVED from the
// box bake so a grey rectangle does not stand inside the tower that replaced it.
//
// The polygons are real, not bounding boxes: the Burj's plan is a three-lobed Y, and reducing it to
// a rectangle would lose the one thing that makes it recognisable from below.
//
// Run:    node scripts/city/make-detail.mjs <slug>
// Writes: public/siege/city/<slug>/detail.bin, and REWRITES buildings.bin + ids.bin without the
//         boxes it has replaced.
//
// RUN IT LAST, and only once per bake. It EDITS buildings.bin, so running it twice removes a second
// set of boxes that were never replaced. If in doubt, re-run fetch-buildings first.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { loadCity, slugFromArgv, overpassTiled } from './cityConfig.mjs';

const city = loadCity(slugFromArgv());
const PARTS = `${city.rawDir}/parts.json`;
const ROOFS = `${city.rawDir}/roofs.json`;
const BIN = `${city.outDir}/buildings.bin`;
const IDS = `${city.outDir}/ids.bin`;
const OUT = `${city.outDir}/detail.bin`;
const MAX_RANGE_M = city.maxRangeMetres ?? 26000;

// OSM's Simple 3D Buildings layer, which nothing else reads. Two queries, cached.
{
  {
    console.error(`fetching building:part for ${city.slug}...`);
    const d = await overpassTiled(city, 'parts', 0.05, (s, w, n, e) => `[out:json][timeout:120];
(way["building:part"](${s},${w},${n},${e});
 relation["building:part"](${s},${w},${n},${e}););
out geom;`);
    // See make-roads: the per-tile cache is the cache; skipping on this file existing froze a
    // half-fetched result in place forever.
    writeFileSync(PARTS, JSON.stringify(d));
  }
  {
    console.error(`fetching roof shapes for ${city.slug}...`);
    const d = await overpassTiled(city, 'roofs', 0.05, (s, w, n, e) => `[out:json][timeout:120];
way["building"]["roof:shape"](${s},${w},${n},${e});
out geom;`);
    writeFileSync(ROOFS, JSON.stringify(d));
  }
}

/** Roof shapes the renderer knows how to build. Everything else becomes flat. */
const ROOF_FLAT = 0, ROOF_PYRAMID = 1, ROOF_DOME = 2;
const ROOF_CODE = {
  flat: ROOF_FLAT, skillion: ROOF_FLAT, 'triple_skillion': ROOF_FLAT,
  pyramidal: ROOF_PYRAMID, gabled: ROOF_PYRAMID, hipped: ROOF_PYRAMID, cone: ROOF_PYRAMID,
  dome: ROOF_DOME, round: ROOF_DOME, onion: ROOF_DOME,
};

const project = city.project;

/** OSM heights come as "828", "760 m", "12,5" and worse. */
function metres(v) {
  if (v == null) return null;
  const n = parseFloat(String(v).replace(',', '.'));
  return isFinite(n) && n > 0 && n < 1000 ? n : null;
}

function simplifyRing(ring, eps) {
  if (ring.length < 4) return ring;
  const out = [ring[0]];
  for (let i = 1; i < ring.length; i++) {
    const p = out[out.length - 1];
    if (Math.hypot(ring[i][0] - p[0], ring[i][1] - p[1]) >= eps) out.push(ring[i]);
  }
  return out.length >= 3 ? out : ring;
}

// --- gather the described solids --------------------------------------------------------------------
const solids = [];
let skipped = 0;

function addSolid(g, t) {
  let ring = g.map(project).filter(([x, z]) => Math.abs(x) < MAX_RANGE_M && Math.abs(z) < MAX_RANGE_M);
  // OSM closes a way by repeating its first node; the renderer closes it itself.
  if (ring.length > 2 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]) ring.pop();
  // Half a metre of simplification. Traced outlines carry vertices a few centimetres apart that no
  // 300 m creature will ever resolve, and every one of them is a triangle.
  ring = simplifyRing(ring, 0.5);
  if (ring.length < 3 || ring.length > 400) { skipped++; return; }

  const h = metres(t.height)
    ?? (metres(t['building:levels']) != null ? metres(t['building:levels']) * 3.2 : null);
  if (h == null || h < 2) { skipped++; return; }
  const minH = metres(t.min_height) ?? 0;
  if (minH >= h) { skipped++; return; }

  const shape = ROOF_CODE[t['roof:shape']] ?? ROOF_FLAT;
  let roofH = metres(t['roof:height']) ?? 0;
  if (shape !== ROOF_FLAT && roofH <= 0) {
    // Not tagged, so estimate from the plan. A pyramid or dome over a 30 m footprint is roughly
    // 8-15 m; scaling with the smaller plan dimension keeps a mosque dome domed and stops a long
    // warehouse growing a 40 m spike.
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [x, z] of ring) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    const span = Math.min(maxX - minX, maxZ - minZ);
    roofH = shape === ROOF_DOME ? span * 0.45 : Math.min(span * 0.5, 18);
  }
  // A roof cannot be taller than the building carries; OSM roof:height is occasionally the whole
  // building's height by mistake, which would put a 200 m cone on a 200 m tower.
  roofH = Math.min(roofH, (h - minH) * 0.6);

  let cx = 0, cz = 0;
  for (const [x, z] of ring) { cx += x; cz += z; }
  cx /= ring.length; cz /= ring.length;

  solids.push({ ring, cx, cz, minH, h, shape, roofH });
}

const parts = JSON.parse(readFileSync(PARTS, 'utf8')).elements ?? [];
let partCount = 0;
for (const e of parts) {
  const g = e.geometry ?? [];
  if (g.length < 3) continue;
  addSolid(g, e.tags ?? {});
  partCount++;
}

// Buildings with a roof shape but no parts. Small set, but it is every mosque dome in the city, and
// a dome is the most recognisable thing a building can have.
const roofs = JSON.parse(readFileSync(ROOFS, 'utf8')).elements ?? [];
let roofCount = 0;
for (const e of roofs) {
  const t = e.tags ?? {};
  if (!t['roof:shape'] || t['roof:shape'] === 'flat') continue;
  const g = e.geometry ?? [];
  if (g.length < 3) continue;
  addSolid(g, t);
  roofCount++;
}
console.error(`${solids.length} solids from ${partCount} parts + ${roofCount} roofed buildings (${skipped} skipped)`);

// --- which boxes do these replace? -------------------------------------------------------------------
//
// Spatially, by testing each solid's centroid against the box bake. There is no id linking a
// building:part to its parent building in the data — Simple 3D Buildings expects a renderer to work
// it out from geometry, and a centroid-in-box test is the cheap version of that.
const buf = readFileSync(BIN);
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
const count = dv.getUint32(16);
const f = new Float32Array(buf.buffer, buf.byteOffset + 24, count * 6);
const ids = new Float64Array(readFileSync(IDS).buffer.slice(0));

// A 200 m grid over the boxes, so each solid tests a handful rather than 59,202.
const CELLM = 200;
const cellKey = (x, z) => `${Math.floor(x / CELLM)},${Math.floor(z / CELLM)}`;
const grid = new Map();
for (let i = 0; i < count; i++) {
  const k = cellKey(f[i * 6], f[i * 6 + 1]);
  if (!grid.has(k)) grid.set(k, []);
  grid.get(k).push(i);
}

const suppress = new Set();
for (const s of solids) {
  for (let gx = -1; gx <= 1; gx++) {
    for (let gz = -1; gz <= 1; gz++) {
      const list = grid.get(`${Math.floor(s.cx / CELLM) + gx},${Math.floor(s.cz / CELLM) + gz}`);
      if (!list) continue;
      for (const i of list) {
        const bx = f[i * 6], bz = f[i * 6 + 1], bw = f[i * 6 + 2], bd = f[i * 6 + 3], rot = f[i * 6 + 4];
        // Into the box's own frame, then a simple half-extent test.
        const dx = s.cx - bx, dz = s.cz - bz;
        const c = Math.cos(-rot), sn = Math.sin(-rot);
        const lx = dx * c - dz * sn, lz = dx * sn + dz * c;
        if (Math.abs(lx) <= bw / 2 && Math.abs(lz) <= bd / 2) suppress.add(i);
      }
    }
  }
}
console.error(`replacing ${suppress.size} boxes with ${solids.length} detailed solids`);

// --- rewrite the box bake without them -----------------------------------------------------------
const keep = [];
for (let i = 0; i < count; i++) if (!suppress.has(i)) keep.push(i);
const nb = new ArrayBuffer(24 + keep.length * 24);
const nd = new DataView(nb);
nd.setFloat64(0, dv.getFloat64(0));
nd.setFloat64(8, dv.getFloat64(8));
nd.setUint32(16, keep.length);
nd.setUint32(20, dv.getUint32(20));
const nf = new Float32Array(nb, 24, keep.length * 6);
const nids = new Float64Array(keep.length);
keep.forEach((src, dst) => {
  for (let k = 0; k < 6; k++) nf[dst * 6 + k] = f[src * 6 + k];
  nids[dst] = ids[src] ?? 0;
});
writeFileSync(BIN, Buffer.from(nb));
writeFileSync(IDS, Buffer.from(nids.buffer));
console.error(`${city.slug}/buildings.bin now ${keep.length.toLocaleString()} boxes (was ${count.toLocaleString()})`);

// --- pack the solids ---------------------------------------------------------------------------------
// uint32 count, then per solid:
//   uint8 roofShape, uint16 nPoints, int16 minH, int16 h, int16 roofH, int16 cx, int16 cz,
//   nPoints x (int16 dx, int16 dz) in DECIMETRES relative to the centroid.
let bytes = 4;
for (const s of solids) bytes += 13 + s.ring.length * 4;
const out = new Uint8Array(bytes);
const od = new DataView(out.buffer);
let o = 0;
od.setUint32(o, solids.length, true); o += 4;
const c16 = (v) => Math.max(-32768, Math.min(32767, Math.round(v)));
for (const s of solids) {
  od.setUint8(o, s.shape); o += 1;
  od.setUint16(o, s.ring.length, true); o += 2;
  od.setInt16(o, c16(s.minH), true); o += 2;
  od.setInt16(o, c16(s.h), true); o += 2;
  od.setInt16(o, c16(s.roofH), true); o += 2;
  od.setInt16(o, c16(s.cx), true); o += 2;
  od.setInt16(o, c16(s.cz), true); o += 2;
  // Decimetres relative to the centroid: 0.1 m of precision, and +/-3.2 km of reach, which is far
  // more than any single building's plan.
  for (const [x, z] of s.ring) {
    od.setInt16(o, c16((x - s.cx) * 10), true); o += 2;
    od.setInt16(o, c16((z - s.cz) * 10), true); o += 2;
  }
}
writeFileSync(OUT, Buffer.from(out));

const tall = solids.filter((s) => s.h > 300).sort((a, b) => b.h - a.h);
console.error(`wrote ${OUT} — ${(bytes / 1024).toFixed(0)} KB`);
console.error(`tallest solids: ${tall.slice(0, 6).map((s) => `${s.h.toFixed(0)}m`).join(', ')}`);
