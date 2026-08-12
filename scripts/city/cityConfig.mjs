// cityConfig — one JSON per city, read by every bake script.
//
// THE PROJECTION MUST MATCH EVERYWHERE OR NOTHING LINES UP. The buildings, the roads, the water and
// the land mask are four separate bakes, and every one of them turns latitude and longitude into
// metres east and south of a single origin. If two of them disagree about that origin by so much as
// a hundred metres, the traffic drives beside the roads and the coastline cuts through the towers.
// So the origin lives in the config, not in the scripts, and every script imports it from here.
//
// Run any bake as:  node scripts/city/<script>.mjs <slug>
//
// The config also records the bounding box that was fetched, so a rebuild fetches the identical
// ground. Without that, "re-run the bake" quietly means "fetch whatever I type this time".

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';

export function loadCity(slug) {
  if (!slug) {
    throw new Error('usage: node scripts/city/<script>.mjs <slug>   (e.g. dubai)');
  }
  const path = `scripts/city/cities/${slug}.json`;
  if (!existsSync(path)) throw new Error(`no config at ${path} — write it first, see docs/BUILD_A_CITY.md`);
  const c = JSON.parse(readFileSync(path, 'utf8'));

  for (const k of ['slug', 'lat0', 'lon0', 'bbox']) {
    if (c[k] === undefined) throw new Error(`${path} is missing "${k}"`);
  }
  if (c.slug !== slug) throw new Error(`${path} says slug "${c.slug}" but is named ${slug}.json`);

  // Metres per degree at THIS city's latitude. Longitude degrees shrink toward the poles, and using
  // the equatorial figure would stretch Reykjavik by half and squash nothing at all in Singapore.
  c.mPerLat = 111320;
  c.mPerLon = 111320 * Math.cos((c.lat0 * Math.PI) / 180);
  c.project = (p) => [(p.lon - c.lon0) * c.mPerLon, -(p.lat - c.lat0) * c.mPerLat];
  c.outDir = `public/siege/city/${slug}`;
  mkdirSync(c.outDir, { recursive: true });
  // Where the raw Overpass downloads are kept, so a re-bake needs no network.
  c.rawDir = `.city-cache/${slug}`;
  mkdirSync(c.rawDir, { recursive: true });
  return c;
}

/** The slug from argv, with a clear error rather than a stack trace. */
export function slugFromArgv() {
  const slug = process.argv[2];
  if (!slug || slug.startsWith('-')) {
    console.error('usage: node scripts/city/<script>.mjs <slug>');
    process.exit(2);
  }
  return slug;
}

/** Overpass mirrors, in the order worth trying. The main one throttles hardest. */
export const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
// overpass.kumi.systems IS ALSO OUT. Asked for the same small box in central San Jose it returned
// 83 buildings where overpass-api.de returned 215, twice, and then began failing outright. A mirror
// that answers with a THIRD of the data is more dangerous than one that answers with none: the
// zero-element guard below cannot see it, and what you get is a city with invisible thin patches.
// overpass.osm.ch was removed for returning zero outside Switzerland. Add a mirror only after
// checking it agrees with overpass-api.de on a box you can count.

// overpass.osm.ch is NOT in this list. It answers quickly, with valid JSON, and ZERO ELEMENTS for
// anything outside Switzerland — a successful lie, which is the one failure mode that gets cached
// and never noticed. It silently emptied a tile of central San Jose before it was spotted.

/**
 * POST a query, trying each mirror. Returns parsed JSON, or null on total failure.
 *
 * NULL, NOT AN EMPTY RESULT. A failed fetch that returns [] is indistinguishable from a genuinely
 * empty area, and if it gets cached the missing ground is missing for good — which is how the Burj
 * Khalifa went absent from the first Dubai bake.
 */
export async function overpass(query) {
  // SIX ATTEMPTS WITH BACKOFF, cycling the mirrors — the same patience the buildings fetcher has
  // always had, and which this did not.
  //
  // It tried each mirror ONCE and gave up, and on a busy afternoon that meant 55 of New York's 56
  // coastline tiles failed. The land mask built from the one that survived flooded 99.5% of the
  // grid: no coastline to stop it, so the sea swallowed Manhattan and the file came out looking
  // perfectly valid. Overpass refuses far more often than it fails permanently, and waiting twenty
  // seconds is the difference between a city and a puddle.
  for (let attempt = 0; attempt < 6; attempt++) {
    const url = OVERPASS[attempt % OVERPASS.length];
    try {
      const res = await fetch(url, {
        method: 'POST',
        body: query,
        headers: { 'User-Agent': UA, 'Content-Type': 'text/plain' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (!text.startsWith('{')) throw new Error('not JSON (rate limited)');
      const data = JSON.parse(text);
      // An empty answer is not trusted from a single mirror — see the note on partial mirrors above.
      // Believed only on the last attempt, once they have all agreed.
      if ((data.elements?.length ?? 0) === 0 && attempt < 5) throw new Error('empty (possible partial mirror)');
      return data;
    } catch (err) {
      if (attempt === 5) { console.error(`  gave up: ${err.message}`); return null; }
      const wait = 4000 * (attempt + 2);
      await pause(wait);
    }
  }
  return null;
}

/** Sent on every request, so Overpass can see who is asking and throttle us rather than block us. */
const UA = 'DreadRoot-Kaiju/1.0 (geoff@lightningworks.io) one-time city import';

/** Sleep, for backing off between Overpass calls. It throttles, and hammering it gets you blocked. */
export const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Run a query over a bounding box in TILES, caching each one, and merge the results.
 *
 * WHY THIS EXISTS. The buildings fetch has always been tiled; roads, water and the 3D-shape layer
 * each fired ONE query covering the whole city. On a quiet day that works. On a busy one it does
 * not, and the failure is total: San Jose's buildings imported fine — 29,402 of them, tiled — and
 * then its roads and its 3D layer both came back
 *
 *     runtime error: ... The server is probably too busy to handle your request
 *
 * from every mirror, leaving the city with no streets at all. A big query is not just slower to
 * answer, it is far likelier to be refused outright, because Overpass rejects what it cannot fit in
 * its time and memory budget rather than returning part of it.
 *
 * Tiling turns one all-or-nothing request into forty small ones that individually almost always
 * succeed, and — because each is cached — a run that dies half way resumes instead of restarting.
 *
 * Elements are DEDUPED BY TYPE AND ID, because a road crossing a tile boundary is returned by both
 * tiles and would otherwise be drawn, and driven along, twice.
 */
export async function overpassTiled(city, name, stepDeg, buildQuery, bbox) {
  const [s0, w0, n0, e0] = bbox ?? city.bbox;
  const dir = `${city.rawDir}/${name}`;
  mkdirSync(dir, { recursive: true });

  const tiles = [];
  for (let s = s0; s < n0; s += stepDeg) {
    for (let w = w0; w < e0; w += stepDeg) {
      tiles.push([s, w, Math.min(n0, s + stepDeg), Math.min(e0, w + stepDeg)]);
    }
  }
  console.error(`${name}: ${tiles.length} tiles of ${stepDeg} degrees`);

  const seen = new Set();
  const merged = [];
  let done = 0, failed = 0;
  for (const [s, w, n, e] of tiles) {
    const key = `${s.toFixed(4)}_${w.toFixed(4)}_${n.toFixed(4)}_${e.toFixed(4)}`;
    const file = `${dir}/${key}.json`;
    let data = null;
    if (existsSync(file)) {
      data = JSON.parse(readFileSync(file, 'utf8'));
    } else {
      data = await overpass(buildQuery(s, w, n, e));
      // NOT CACHED ON FAILURE. A null written to disk as though it were an answer is how ground goes
      // permanently missing — the whole reason the buildings fetch distrusts empty caches.
      if (data) writeFileSync(file, JSON.stringify(data));
      else failed++;
      await pause(1500);
    }
    if (!data) continue;
    for (const el of data.elements ?? []) {
      const id = `${el.type}${el.id}`;
      if (seen.has(id)) continue;
      seen.add(id);
      merged.push(el);
    }
    done++;
    if (done % 10 === 0) console.error(`  ${done}/${tiles.length} tiles, ${merged.length} elements`);
  }
  if (failed) {
    console.error(`  ${failed} TILES FAILED — re-run this script to fill them in; the rest is cached.`);
  }
  console.error(`${name}: ${merged.length} elements from ${done}/${tiles.length} tiles`);
  return { elements: merged, failed };
}

/**
 * Assemble a multipolygon relation's member ways into closed rings.
 *
 * A BIG LAKE IS NOT ONE WAY. OSM maps anything with islands, or anything longer than a way's node
 * limit, as a relation whose outer boundary is split across many member ways — each an OPEN ARC,
 * in arbitrary order and arbitrary direction. Treating each member as a polygon in its own right
 * fills nothing, because an arc has no interior.
 *
 * That is exactly why Seattle's first two land masks had Lake Union, Lake Washington and the Ship
 * Canal as dry ground while Elliott Bay and Puget Sound came out right: salt water arrives as
 * coastline ways and works, fresh water arrives as relations and did not. Lake Washington alone is
 * 112 member ways.
 *
 * So: walk the members, joining end to end, reversing where needed, until the ring closes.
 * Endpoints are matched with a tolerance because they are floats that have been through a
 * projection — an exact comparison finds nothing.
 */
export function assembleRings(members, tolMetres = 1) {
  const ways = members
    .filter((m) => m.role !== 'inner' && m.geometry && m.geometry.length >= 2)
    .map((m) => m.geometry.slice());
  const rings = [];
  const used = new Array(ways.length).fill(false);
  // Degrees, roughly: a metre of latitude. Good enough to decide "is this the same node".
  const tol = tolMetres / 111320;
  const near = (a, b) => Math.abs(a.lat - b.lat) < tol && Math.abs(a.lon - b.lon) < tol;

  for (let i = 0; i < ways.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const ring = ways[i].slice();
    let grew = true;
    while (grew) {
      grew = false;
      const end = ring[ring.length - 1];
      for (let j = 0; j < ways.length; j++) {
        if (used[j]) continue;
        const w = ways[j];
        if (near(end, w[0])) { ring.push(...w.slice(1)); used[j] = true; grew = true; break; }
        if (near(end, w[w.length - 1])) { ring.push(...w.slice(0, -1).reverse()); used[j] = true; grew = true; break; }
      }
      // A ring that has closed on itself is finished, whatever is left over.
      if (ring.length > 3 && near(ring[0], ring[ring.length - 1])) break;
    }
    if (ring.length >= 4) rings.push(ring);
  }
  return rings;
}
