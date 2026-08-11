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

import { readFileSync, existsSync, mkdirSync } from 'node:fs';

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
  for (const url of OVERPASS) {
    try {
      const res = await fetch(url, { method: 'POST', body: query });
      if (!res.ok) { console.error(`  ${res.status} from ${url}`); continue; }
      const text = await res.text();
      if (!text.startsWith('{')) { console.error(`  non-JSON from ${url}`); continue; }
      const data = JSON.parse(text);
      // An empty answer is not trusted from a single mirror — see the note on osm.ch above. Fall
      // through to the next one, and only return empty once they have all agreed.
      if ((data.elements?.length ?? 0) === 0 && url !== OVERPASS[OVERPASS.length - 1]) {
        console.error(`  empty from ${url} — trying another mirror`);
        continue;
      }
      return data;
    } catch (err) {
      console.error(`  ${url} failed: ${err.message}`);
    }
  }
  return null;
}

/** Sleep, for backing off between Overpass calls. It throttles, and hammering it gets you blocked. */
export const pause = (ms) => new Promise((r) => setTimeout(r, ms));
