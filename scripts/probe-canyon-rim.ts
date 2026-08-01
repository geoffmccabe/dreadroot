/**
 * probe-canyon-rim — find the exact lip of the South Rim near the visitor centre.
 *
 * probe-canyon-sites established WHY B2 looks flat: the drop sits at 1020 m, which is the canyon
 * FLOOR. Every rim viewpoint is 2100-2600 m. Standing on the floor of a canyon is the one place a
 * canyon does not read as one.
 *
 * Standing at the rim needs more than the right rough coordinate, though. A published viewpoint is
 * accurate to a few hundred metres, and a few hundred metres back from the lip is featureless
 * plateau — which is exactly what "relatively flat and featureless area" describes. So this
 * searches a grid around the visitor centre for the point that best satisfies:
 *
 *   * high ground (on the plateau, not in the gorge)
 *   * a big drop within one kilometre (the canyon is RIGHT THERE, not somewhere over yonder)
 *   * steep ground immediately ahead (a lip, not a slope)
 *
 * Run: npm run probe:canyon-rim
 */

import { latLonToDirection, directionToFaceUv, uvToTileIndex } from '../src/components/siege/globe/cubeSphere';
import { loadManifest, requestTile } from '../src/components/siege/globe/earthTiles';
import { sampleGlobeElevation } from '../src/components/siege/globe/globeGround';

const mf = await loadManifest();
if (!mf) { console.log('No manifest — no network. Skipping.'); process.exit(0); }

/** The visitor centre / Mather Point area. */
const CENTRE_LAT = 36.0616;
const CENTRE_LON = -112.1076;
/** How far around it to search, in kilometres. */
const SEARCH_KM = 4;

const d = new Float64Array(3);
const elev = (lat: number, lon: number): number => {
  latLonToDirection(lat, lon, d);
  return sampleGlobeElevation(d[0], d[1], d[2]) ?? 0;
};

// Warm every level over a block wide enough to cover the search.
for (let dLat = -1; dLat <= 1; dLat++) {
  for (let dLon = -1; dLon <= 1; dLon++) {
    const la = CENTRE_LAT + dLat * 0.05, lo = CENTRE_LON + dLon * 0.05;
    latLonToDirection(la, lo, d);
    const { face, u, v } = directionToFaceUv(d[0], d[1], d[2]);
    for (let level = 0; level <= mf.maxLevel; level++) {
      const cx = uvToTileIndex(u, level), cy = uvToTileIndex(v, level);
      const n = 1 << level;
      for (let x = cx - 1; x <= cx + 1; x++) {
        for (let y = cy - 1; y <= cy + 1; y++) {
          if (x < 0 || y < 0 || x >= n || y >= n) continue;
          await requestTile(face, level, x, y);
        }
      }
    }
  }
}

const degLat = SEARCH_KM / 111;
const degLon = SEARCH_KM / (111 * Math.cos((CENTRE_LAT * Math.PI) / 180));
const STEPS = 61;

interface Cand {
  lat: number; lon: number; here: number;
  /** Lowest ground within 1 km — how far it falls away right in front of you. */
  drop: number;
  /** Steepest gradient within 1 km, as degrees. */
  steep: number;
  score: number;
  /** Compass bearing, degrees, toward the deepest ground nearby: which way to FACE. */
  facing: number;
}

const cands: Cand[] = [];

for (let j = 0; j < STEPS; j++) {
  const lat = CENTRE_LAT - degLat + (2 * degLat * j) / (STEPS - 1);
  for (let i = 0; i < STEPS; i++) {
    const lon = CENTRE_LON - degLon + (2 * degLon * i) / (STEPS - 1);
    const here = elev(lat, lon);
    // Only consider standing ON the plateau. The rim here runs about 2100-2300 m.
    if (here < 2000) continue;

    // Look around within a kilometre for the lowest ground and the direction to it.
    let lowest = here;
    let bearing = 0;
    let steep = 0;
    const R = 1 / 111;                                 // 1 km in degrees of latitude
    for (let a = 0; a < 16; a++) {
      const th = (a / 16) * Math.PI * 2;
      for (const frac of [0.35, 0.7, 1]) {
        const la = lat + Math.cos(th) * R * frac;
        const lo = lon + (Math.sin(th) * R * frac) / Math.cos((lat * Math.PI) / 180);
        const e = elev(la, lo);
        if (e < lowest) { lowest = e; bearing = (th * 180) / Math.PI; }
        const distM = 1000 * frac;
        steep = Math.max(steep, Math.abs(here - e) / distM);
      }
    }
    const drop = here - lowest;
    // Want: standing high, a big drop close by, and a steep face. Drop dominates.
    const score = drop * (1 + Math.atan(steep));
    cands.push({ lat, lon, here, drop, steep: (Math.atan(steep) * 180) / Math.PI, score, facing: bearing });
  }
}

cands.sort((a, b) => b.score - a.score);

console.log('\n== The lip of the South Rim, near the visitor centre ==\n');
console.log('  lat        lon          stands at   falls away within 1 km   face angle   look toward');
console.log('  ' + '-'.repeat(84));
for (const c of cands.slice(0, 8)) {
  const compass = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(c.facing / 45) % 8];
  console.log(
    `  ${c.lat.toFixed(4)}   ${c.lon.toFixed(4)}    ${String(Math.round(c.here)).padStart(4)} m      `
    + `${String(Math.round(c.drop)).padStart(4)} m                ${c.steep.toFixed(0).padStart(2)}°          ${compass}`,
  );
}

const best = cands[0];
console.log(`\n  Current B2 drop stands at ${Math.round(elev(36.1069, -112.1129))} m — on the canyon FLOOR.`);
console.log(`  Best rim point stands at ${Math.round(best.here)} m with ${Math.round(best.drop)} m `
  + `falling away within a kilometre.\n`);
console.log(`  Suggested drop: ${best.lat.toFixed(4)}, ${best.lon.toFixed(4)}\n`);
