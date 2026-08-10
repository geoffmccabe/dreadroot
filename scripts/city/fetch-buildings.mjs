// fetch-dubai-buildings — turn OpenStreetMap into a city the Kaiju can smash.
//
// Geoff: "I must have all three districts and The Palm too or it won't have the right 3D effect and
// scale." So this covers Downtown, the Sheikh Zayed Road corridor, Dubai Marina and Palm Jumeirah.
//
// WHAT THIS PRODUCES, AND WHY IT IS TINY.
//
// Every building comes out of OSM as a polygon with a dozen or more corners. Kept that way, the four
// districts would be hundreds of megabytes of JSON and a nightmare to collide against. Instead each
// footprint is reduced to its BEST-FIT ROTATED BOX — the smallest rectangle that contains it, at
// whatever angle fits best — which is six numbers: two for position, two for size, one for rotation,
// one for height. Twenty-four bytes a building. A hundred thousand of them is 2.4 MB.
//
// That is not a compromise made for size. It is what the game needs anyway: Geoff asked for box
// colliders, and a rotated box is simultaneously the collider, the render instance, and the thing
// that gets sliced into shards when a Kaiju walks through it. One piece of data, three jobs.
//
// HEIGHTS. Only about one building in six carries a height tag in OSM — but the ones that do are the
// towers, because that is what mappers care about. Everything missing is villas, warehouses and car
// parks. Those are filled in from footprint area with a seeded random, so the skyline is REAL and
// the filler is merely plausible. Nobody can tell the difference at 300 m tall, and the alternative
// is a city of identical boxes.
//
// Fetched in small tiles with a pause between them, because Overpass is a free service run on
// donated hardware and hammering it with one enormous query is both rude and slower.
//
// Run:    node scripts/city/fetch-buildings.mjs <slug>
// Output:
//   public/siege/city/dubai.bin            the city: 24 bytes a building, this is what the game loads
//   public/siege/city/dubai-ids.bin        OSM ids, for permanent damage later. Nothing loads it yet.
//   public/siege/city/dubai-landmarks.json the named towers, for labels and for sanity-checking

import { writeFileSync, mkdirSync, existsSync, readFileSync, appendFileSync } from 'node:fs';
import { loadCity, slugFromArgv } from './cityConfig.mjs';

const city = loadCity(slugFromArgv());

/**
 * RESUMABLE, because this run takes half an hour and got killed twice.
 *
 * Each tile's REDUCED result — boxes, not the megabytes of polygon it came from — is cached to disk
 * the moment it arrives. Re-running skips every tile already on disk, so an interrupted fetch costs
 * only the tile it was in the middle of. Without this, one stray kill twenty-five minutes in throws
 * away twenty-five minutes of somebody else's donated server time, which is the part that actually
 * matters.
 */
const CACHE_DIR = `${city.rawDir}/tiles`;
const LOG = '.city-cache/progress.log';
function note(line) {
  process.stderr.write(line);
  // Straight to disk as well: piping this through `tail` buffers it, so a long run looks hung and
  // there is no way to tell a slow tile from a dead one.
  try { appendFileSync(LOG, line); } catch { /* logging must never break the fetch */ }
}

const OUT_DIR = city.outDir;

/**
 * The four areas, as Geoff listed them. Deliberately generous boxes: the gaps between districts are
 * mostly low-rise, and an empty corridor between two skylines reads worse than filler does.
 */
/**
 * The areas to fetch, from the city's config.
 *
 * `areas` is a list of named sub-boxes, which is worth having rather than one big box: Overpass
 * times out on a large dense query, and a city is usually a few built clusters with empty ground
 * between them. Dubai is fetched as four districts. If a config gives no `areas`, the whole bbox is
 * fetched as one — fine for a compact city, and it will simply take longer for a sprawling one.
 */
const AREAS = (city.areas && city.areas.length)
  ? city.areas
  : [{ name: city.name ?? city.slug, s: city.bbox[0], w: city.bbox[1], n: city.bbox[2], e: city.bbox[3] }];


/** Overpass gets a box this big at a time. Small enough to answer quickly and not time out. */
const TILE_DEG = 0.02;
/** Seconds between requests. Overpass is free and donated; this is the polite rate. */
const PAUSE_S = 4;

const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));

/**
 * MIRRORS, tried in order.
 *
 * The main overpass-api.de instance stopped answering this machine entirely — not a rate-limit
 * reply, no TCP connection at all — after the exploratory queries that proved this idea works. That
 * is the correct behaviour from a free service run on donated hardware, and the lesson is to be
 * gentler, not to find a way round it. private.coffee is a public mirror of the same database.
 */
const ENDPOINTS = [
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
];
const UA = 'DreadRoot-Kaiju/1.0 (geoff@lightningworks.io) one-time city import';

/**
 * One tile of buildings, or NULL if it could not be fetched.
 *
 * THE NULL MATTERS MORE THAN THE DATA. This used to return an empty result on failure, which is
 * indistinguishable from a tile that genuinely has no buildings in it — and the caller then wrote
 * that empty result to the resume cache as though it were an answer. Five tiles of Dubai Marina got
 * recorded as "no buildings here", permanently, and the resume logic would have skipped them on
 * every future run. A city with holes in it, and nothing anywhere to say why.
 *
 * Failure and emptiness must never be the same value.
 */
async function overpass(s, w, n, e) {
  const q = `[out:json][timeout:180];(way["building"](${s},${w},${n},${e});`
    + `relation["building"](${s},${w},${n},${e}););out geom;`;
  for (let attempt = 0; attempt < 6; attempt++) {
    const endpoint = ENDPOINTS[attempt % ENDPOINTS.length];
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        body: q,
        headers: { 'User-Agent': UA, 'Content-Type': 'text/plain' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      // A rate-limited mirror replies with prose, which JSON.parse reports as a syntax error and
      // which reads like a bug in this script rather than what it is.
      if (!text.startsWith('{')) throw new Error('not JSON (rate limited)');
      return JSON.parse(text);
    } catch (err) {
      const wait = PAUSE_S * (attempt + 2);
      note(`    retry in ${wait}s via next mirror (${err.message})\n`);
      await sleep(wait);
    }
  }
  return null;
}

// --- geometry -----------------------------------------------------------------------------------

/** Andrew's monotone chain. The rotated box only needs the hull, and the hull is far smaller. */
function convexHull(pts) {
  if (pts.length < 3) return pts;
  const p = pts.slice().sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

/**
 * Smallest-area rectangle containing the points, at any angle.
 *
 * Rotating calipers: the minimum-area rectangle always has one side flush with an edge of the convex
 * hull, so trying each hull edge as the axis and keeping the best is exact rather than a search.
 * This matters because towers are not axis-aligned — Dubai's grid runs at about 50 degrees to north,
 * and an axis-aligned box round a rotated tower is up to 40% too big in both directions.
 */
function minAreaRect(pts) {
  const hull = convexHull(pts);
  if (hull.length < 3) return null;
  let best = null;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;
    const ux = dx / len, uy = dy / len;      // along the edge
    const vx = -uy, vy = ux;                 // across it
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const p of hull) {
      const u = p[0] * ux + p[1] * uy;
      const v = p[0] * vx + p[1] * vy;
      if (u < minU) minU = u; if (u > maxU) maxU = u;
      if (v < minV) minV = v; if (v > maxV) maxV = v;
    }
    const area = (maxU - minU) * (maxV - minV);
    if (!best || area < best.area) {
      const cu = (minU + maxU) / 2, cv = (minV + maxV) / 2;
      best = {
        area,
        cx: cu * ux + cv * vx,
        cy: cu * uy + cv * vy,
        w: maxU - minU,
        d: maxV - minV,
        rot: Math.atan2(uy, ux),
      };
    }
  }
  return best;
}

// --- heights ------------------------------------------------------------------------------------

/** Deterministic hash -> 0..1, so a rebuild produces the identical city. */
function hash01(n) {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/**
 * A plausible height for a building OSM does not describe.
 *
 * Driven by footprint area, because that is what actually correlates: a 40 m² box is a villa, a
 * 3,000 m² one is a mall or a tower base. The random is seeded from the id so the same building is
 * the same height on every rebuild — a city that reshuffles itself each time you load it would make
 * every screenshot and every bug report useless.
 */
function guessHeight(areaM2, id) {
  const r = hash01(id);
  if (areaM2 < 120) return 3.5 + r * 4;             // villa / shed
  if (areaM2 < 400) return 7 + r * 7;               // house, small block
  if (areaM2 < 1200) return 12 + r * 22;            // low-rise block
  if (areaM2 < 4000) return 20 + r * 45;            // mid-rise
  return 30 + r * 60;                               // mall, big base
}

function parseHeight(t) {
  if (t.height) {
    const v = parseFloat(String(t.height).replace(',', '.'));
    if (isFinite(v) && v > 1 && v < 900) return v;
  }
  if (t['building:levels']) {
    const v = parseFloat(String(t['building:levels']).replace(',', '.'));
    if (isFinite(v) && v > 0 && v < 200) return v * 3.2;
  }
  return null;
}

// --- main ---------------------------------------------------------------------------------------

const METRES_PER_DEG_LAT = 111320;

async function main() {
  // One origin for the whole city, so every building is a small offset in metres rather than a
  // full-precision coordinate. That is what keeps it to float32 without losing centimetres.
  const lat0 = city.lat0, lon0 = city.lon0;
  const mPerLon = METRES_PER_DEG_LAT * Math.cos((lat0 * Math.PI) / 180);

  mkdirSync(CACHE_DIR, { recursive: true });
  const out = [];
  const ids = [];
  const failedTiles = [];
  let oversized = 0;
  const named = [];
  const seen = new Set();

  for (const area of AREAS) {
    note(`\n${area.name}\n`);
    for (let s = area.s; s < area.n; s += TILE_DEG) {
      for (let w = area.w; w < area.e; w += TILE_DEG) {
        const n = Math.min(s + TILE_DEG, area.n);
        const e = Math.min(w + TILE_DEG, area.e);
        // THE CACHE KEY MUST DESCRIBE THE WHOLE BOX, NOT JUST ITS CORNER.
        //
        // This was `${s}_${w}` and it lost the Burj Khalifa. Adjacent districts overlap, and a tile
        // at the edge of one gets CLAMPED to that district's boundary — so Sheikh Zayed Road fetched
        // a 500 m strip at (25.180, 55.275) and cached it under that corner, and Downtown then
        // reused the strip for its own tile at the same corner, which is twenty times larger and
        // contains the tallest building in the world.
        //
        // Nothing about that looked wrong: the log said "cached", the file had thousands of
        // buildings in it, and the only symptom was a Dubai with no Burj in it.
        const tileKey = `${s.toFixed(4)}_${w.toFixed(4)}_${n.toFixed(4)}_${e.toFixed(4)}`;
        const cacheFile = `${CACHE_DIR}/${tileKey}.json`;
        let tileRows = null;
        // AN EMPTY CACHED TILE IS NEVER TRUSTED.
        //
        // Twice now a tile has been recorded as "no buildings here" when the truth was 871 buildings
        // including three 330 m towers — once from a failed request that looked like an empty
        // answer, and once because a migration carried that poison forward. Both times the log said
        // "cached", the file was valid JSON, and the only symptom was a Dubai missing a district.
        //
        // In a city, an empty tile is almost always a lie. Re-fetching them costs a few minutes on
        // the handful that really are open sea, and buys the guarantee that a hole in the city
        // cannot survive a re-run. Non-empty caches are still trusted, so a good run is not thrown
        // away to get this.
        if (existsSync(cacheFile)) {
          tileRows = JSON.parse(readFileSync(cacheFile, 'utf8'));
          if (tileRows.length === 0) {
            note(`  ${s.toFixed(3)},${w.toFixed(3)}  cached EMPTY — distrusted, refetching\n`);
            tileRows = null;
          }
        }
        if (tileRows) {
          for (const r of tileRows) {
            if (seen.has(r.k)) continue;
            seen.add(r.k);
            out.push(r.b); ids.push(r.i);
            if (r.n) named.push({ name: r.n, h: Math.round(r.b[5]), x: Math.round(r.b[0]), z: Math.round(r.b[1]) });
          }
          note(`  ${s.toFixed(3)},${w.toFixed(3)}  cached ${tileRows.length}  (total ${out.length})\n`);
          continue;
        }

        const json = await overpass(s.toFixed(4), w.toFixed(4), n.toFixed(4), e.toFixed(4));
        if (json === null) {
          // NOT cached, so a later run retries it. Recorded loudly, because a city quietly missing
          // a district is the failure this whole change exists to prevent.
          failedTiles.push(tileKey);
          note(`  ${s.toFixed(3)},${w.toFixed(3)}  FAILED — will retry on the next run\n`);
          continue;
        }
        tileRows = [];
        let added = 0;
        for (const el of json.elements ?? []) {
          const key = `${el.type}${el.id}`;
          const t = el.tags ?? {};

          // Gather the outline in local metres. Ways carry `geometry`; relations carry members.
          const pts = [];
          const push = (g) => { for (const p of g ?? []) {
            pts.push([(p.lon - lon0) * mPerLon, -(p.lat - lat0) * METRES_PER_DEG_LAT]);
          } };
          if (el.geometry) push(el.geometry);
          // Role '' as well as 'outer': a multipolygon whose outer ring was mapped without an
          // explicit role is common and perfectly valid, and skipping it drops the building.
          else if (el.members) {
            for (const m of el.members) if (m.role === 'outer' || m.role === '') push(m.geometry);
          }
          if (pts.length < 3) continue;

          const rect = minAreaRect(pts);
          if (!rect || rect.w < 2 || rect.d < 2) continue;

          // HOW BIG IS TOO BIG, AND WHY A FLAT CAP WAS WRONG.
          //
          // The cap exists because a whole gated estate tagged as one building becomes a 900 m slab
          // lying across the skyline. But at a flat 400 m it also deleted the DUBAI MALL, which is
          // roughly 1,200 m long and one of the largest buildings on Earth — along with every other
          // mall, airport terminal and stadium in the city. An audit of the cache found nothing at
          // all above 400 m, which is not a fact about Dubai.
          //
          // The two cases separate cleanly: a real enormous building is NAMED and usually carries a
          // height or a floor count, because it is a landmark somebody cared enough to map properly.
          // A mis-tagged estate boundary is anonymous. So named or measured buildings get a much
          // wider allowance, and anonymous sprawl still gets caught.
          const described = Boolean(t.name || t.height || t['building:levels']);
          const limit = described ? 1500 : 400;
          if (rect.w > limit || rect.d > limit) { oversized++; continue; }

          const idNum = Number(el.id) | 0;
          const h = parseHeight(t) ?? guessHeight(rect.w * rect.d, idNum);
          const box = [rect.cx, rect.cy, rect.w, rect.d, rect.rot, h];
          const osmId = el.type === 'relation' ? -Number(el.id) : Number(el.id);
          tileRows.push({ k: key, b: box, i: osmId, n: (t.name && h >= 150) ? t.name : null });
          if (seen.has(key)) continue;          // tiles overlap at the seams
          seen.add(key);
          out.push(box);
          // THE OSM ID goes in a sidecar file nothing loads yet. Permanent damage means a database
          // row, and a row needs a key that survives a rebuild of this file. The array INDEX cannot
          // be that key — insert one building and every index after it shifts, so every saved ruin
          // moves to a different tower. An OSM id is stable for as long as the building exists.
          ids.push(osmId);
          if (t.name && h >= 150) named.push({ name: t.name, h: Math.round(h), x: Math.round(rect.cx), z: Math.round(rect.cy) });
          added++;
        }
        writeFileSync(cacheFile, JSON.stringify(tileRows));
        note(`  ${s.toFixed(3)},${w.toFixed(3)}  +${added}  (total ${out.length})\n`);
        await sleep(PAUSE_S);
      }
    }
  }

  mkdirSync(OUT_DIR, { recursive: true });
  // Header: origin as float64 so the whole city can be re-projected exactly, then the count.
  const head = new ArrayBuffer(24);
  const hv = new DataView(head);
  hv.setFloat64(0, lat0); hv.setFloat64(8, lon0); hv.setUint32(16, out.length);
  const body = new Float32Array(out.length * 6);
  out.forEach((b, i) => { for (let k = 0; k < 6; k++) body[i * 6 + k] = b[k]; });
  writeFileSync(`${OUT_DIR}/buildings.bin`, Buffer.concat([Buffer.from(head), Buffer.from(body.buffer)]));
  // Float64, not Int32: OSM way ids are past 1.3 billion and climbing toward the 2.1 billion that
  // an Int32 can hold. Running out of key space years from now, silently, is not a trade worth
  // 240 KB. Negative means a relation, so the two id spaces cannot collide.
  writeFileSync(`${OUT_DIR}/ids.bin`, Buffer.from(new Float64Array(ids).buffer));
  named.sort((a, b) => b.h - a.h);
  writeFileSync(`${OUT_DIR}/landmarks.json`, JSON.stringify(named.slice(0, 300), null, 1));

  if (failedTiles.length) {
    note(`\n${failedTiles.length} TILE(S) FAILED and were NOT written: ${failedTiles.join(' ')}\n`);
    note(`Run this script again to fill them in; everything else is cached and will be skipped.\n`);
  }
  note(`\n${oversized} footprint(s) rejected as too large to be one building.\n`);
  const kb = (24 + out.length * 24) / 1024;
  note(`\nDONE  ${out.length} buildings, ${kb.toFixed(0)} KB\n`);
  note(`Tallest:\n`);
  for (const n of named.slice(0, 10)) note(`  ${String(n.h).padStart(4)} m  ${n.name}\n`);
}

main();
