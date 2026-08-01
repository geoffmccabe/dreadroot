/**
 * probe-canyon-sites — which Grand Canyon viewpoint actually has the terrain we want?
 *
 * Geoff: "In B2 I land on a relatively flat and featureless area... there appears to be a canyon,
 * but it's only around 300-500 m deep, while the grand canyon normally is much deeper and has
 * straighter sides. I may be located at a part of the grand canyon where it's not very deep."
 *
 * The current drop is 36.1069, -112.1129. On the map that is not the rim at all — it is well north
 * of the South Rim visitor area, out over the inner canyon. So this measures the REAL elevation
 * data at a set of named viewpoints and reports, for each:
 *
 *   elevation at the point, how much relief is within 5 km, and the steepest slope nearby
 *
 * ...and picks the site with the most dramatic terrain, rather than choosing one from a map by eye.
 *
 * Also reports DATA LEVEL, because Geoff's second observation — "the two areas don't line up well,
 * I think it may be the intersection of two sectors, one with more detail and one with less" — is
 * the boundary of a landmark detail region. Level 10 data (38 m) exists only inside those; outside
 * it falls back to level 4 (2.44 km). Landing near an edge puts that seam in view, so the site
 * with the best data coverage around it is also the right answer.
 *
 * Run: npm run probe:canyon-sites
 */

import {
  latLonToDirection, PLANET_RADIUS, METRES_PER_UNIT, directionToFaceUv, uvToTileIndex,
} from '../src/components/siege/globe/cubeSphere';
import { loadManifest, requestTile, hasTile } from '../src/components/siege/globe/earthTiles';
import { sampleGlobeElevation } from '../src/components/siege/globe/globeGround';

/** Named viewpoints. Coordinates are the published locations of each overlook. */
const SITES: { name: string; lat: number; lon: number; note: string }[] = [
  { name: 'CURRENT DROP', lat: 36.1069, lon: -112.1129, note: 'what B2 uses today' },
  { name: 'Mather Point', lat: 36.0616, lon: -112.1076, note: 'the main South Rim visitor centre' },
  { name: 'Yavapai Point', lat: 36.0664, lon: -112.1178, note: 'South Rim, geology museum' },
  { name: 'Grand Canyon Village', lat: 36.0544, lon: -112.1401, note: 'South Rim, Bright Angel trailhead' },
  { name: 'Hopi Point', lat: 36.0725, lon: -112.1585, note: 'South Rim, wide open views' },
  { name: 'Desert View', lat: 36.0441, lon: -111.8266, note: 'South Rim, the Watchtower' },
  { name: 'Bright Angel Point', lat: 36.1975, lon: -112.0525, note: 'North Rim lodge' },
  { name: 'Point Imperial', lat: 36.2733, lon: -111.9986, note: 'highest North Rim point, 2683 m' },
  { name: 'Toroweap Overlook', lat: 36.2117, lon: -113.0672, note: 'sheer ~900 m vertical drop' },
];

const mf = await loadManifest();
if (!mf) { console.log('No manifest — no network. Skipping.'); process.exit(0); }

/** Pull every level covering a point so the sampler sees the best data that exists there. */
async function warm(lat: number, lon: number): Promise<void> {
  const d = new Float64Array(3);
  latLonToDirection(lat, lon, d);
  const { face, u, v } = directionToFaceUv(d[0], d[1], d[2]);
  for (let level = 0; level <= mf!.maxLevel; level++) {
    const cx = uvToTileIndex(u, level), cy = uvToTileIndex(v, level);
    const n = 1 << level;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= n || y >= n) continue;
        await requestTile(face, level, x, y);
      }
    }
  }
}

/** The finest data level actually resident at a point — how detailed the terrain can possibly be. */
function bestLevel(lat: number, lon: number): number {
  const d = new Float64Array(3);
  latLonToDirection(lat, lon, d);
  const { face, u, v } = directionToFaceUv(d[0], d[1], d[2]);
  for (let level = mf!.maxLevel; level >= 0; level--) {
    if (hasTile(face, level, uvToTileIndex(u, level), uvToTileIndex(v, level))) return level;
  }
  return -1;
}

/** Elevation statistics on a grid around a point. `halfKm` is the half-width of the box. */
function survey(lat: number, lon: number, halfKm: number, steps = 41) {
  const d = new Float64Array(3);
  let min = Infinity, max = -Infinity, centre = 0;
  let steepest = 0;
  const degLat = halfKm / 111;
  const degLon = halfKm / (111 * Math.cos((lat * Math.PI) / 180));
  const grid: number[][] = [];

  for (let j = 0; j < steps; j++) {
    const row: number[] = [];
    const la = lat - degLat + (2 * degLat * j) / (steps - 1);
    for (let i = 0; i < steps; i++) {
      const lo = lon - degLon + (2 * degLon * i) / (steps - 1);
      latLonToDirection(la, lo, d);
      const m = sampleGlobeElevation(d[0], d[1], d[2]) ?? 0;
      row.push(m);
      if (m < min) min = m;
      if (m > max) max = m;
      if (j === (steps - 1) / 2 && i === (steps - 1) / 2) centre = m;
    }
    grid.push(row);
  }

  // Steepest neighbouring drop, as a gradient in metres per metre.
  const cellM = (2 * halfKm * 1000) / (steps - 1);
  for (let j = 0; j < steps; j++) {
    for (let i = 1; i < steps; i++) {
      steepest = Math.max(steepest, Math.abs(grid[j][i] - grid[j][i - 1]) / cellM);
      if (j > 0) steepest = Math.max(steepest, Math.abs(grid[j][i] - grid[j - 1][i]) / cellM);
    }
  }
  return { min, max, centre, relief: max - min, steepest };
}

console.log('\n== Grand Canyon: which viewpoint actually has the terrain? ==\n');
console.log('  A 300 m Kaiju needs relief measured in KILOMETRES to read as a canyon at all.\n');

const results: Array<{ name: string; note: string; lat: number; lon: number;
  relief: number; steepest: number; centre: number; level: number; score: number }> = [];

for (const s of SITES) {
  await warm(s.lat, s.lon);
  const level = bestLevel(s.lat, s.lon);
  const near = survey(s.lat, s.lon, 5);
  // What makes a good drop: deep relief nearby, steep sides, and the finest data available.
  const score = near.relief * (1 + near.steepest) * (level >= 8 ? 1.25 : 1);
  results.push({
    name: s.name, note: s.note, lat: s.lat, lon: s.lon,
    relief: near.relief, steepest: near.steepest, centre: near.centre, level, score,
  });
}

results.sort((a, b) => b.score - a.score);
console.log('  site                     ground   relief within 5 km   steepest   data level');
console.log('  ' + '-'.repeat(78));
for (const r of results) {
  const angle = (Math.atan(r.steepest) * 180) / Math.PI;
  console.log(
    `  ${r.name.padEnd(22)} ${String(Math.round(r.centre)).padStart(5)} m   `
    + `${String(Math.round(r.relief)).padStart(5)} m           `
    + `${angle.toFixed(0).padStart(3)}°       `
    + `${r.level >= 0 ? r.level : '-'}${r.level >= 8 ? '  (fine)' : '  (COARSE)'}`,
  );
}

const best = results[0];
const current = results.find(r => r.name === 'CURRENT DROP')!;
console.log(`\n  Current drop: ${Math.round(current.relief)} m of relief, `
  + `${((Math.atan(current.steepest) * 180) / Math.PI).toFixed(0)}° steepest, data level ${current.level}`);
console.log(`  Best site:    ${best.name} — ${Math.round(best.relief)} m of relief, `
  + `${((Math.atan(best.steepest) * 180) / Math.PI).toFixed(0)}° steepest, data level ${best.level}`);
console.log(`                ${best.lat}, ${best.lon}  (${best.note})`);
console.log(`\n  That is ${(best.relief / Math.max(1, current.relief)).toFixed(1)}x the relief of where B2 drops today.\n`);
