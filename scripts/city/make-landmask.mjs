// make-city-landmask — where Dubai is land, from OpenStreetMap's actual coastline.
//
// Geoff: "it seems to have created more land, not less, and it's very pixellated coastline, like
// made of 50 m squares or something that are blurry. It's worse than before."
//
// Both halves of that are right, and they are the same fault. THE OLD MASK WAS A STRAIGHT LINE.
// Two points were picked off the map, everything on the inland side was declared land, and the
// buildings added back the artificial islands. A straight line through a coast that bulges and
// inlets is wrong in both directions at once — it invents land where there is water and drowns land
// where there is not — and there is no resolution at which a straight line stops being straight.
//
// It was also rasterised at 100 m, which is coarser than the terrain itself: the mesh puts a vertex
// every 38 m at full detail, so the ground could already draw a coastline two and a half times
// finer than the mask was telling it about. Those are the squares.
//
// SO THE COASTLINE IS NOW THE REAL ONE. 463 coastline ways and 707 water polygons, straight from
// OSM, which is where the Palm's fronds, the Marina's channels and the Creek all actually live.
// Rasterised at 40 m, just under what the mesh can express, so the mesh is the limit rather than
// this file.
//
// HOW THE FILL WORKS, because "which side is the sea" is the whole problem. OSM coastline ways are
// lines, not areas — a closed sea polygon does not exist to test against. So:
//
//   1. Draw every coastline segment as a BARRIER, two cells thick, which seals the small gaps
//      where one way ends and the next begins.
//   2. Flood fill from the northwest corner of the grid, which is twenty kilometres out in the
//      Gulf and unambiguously open sea.
//   3. Whatever the flood reached is sea. Everything else is land.
//   4. Then punch out the inland water bodies -- lagoons, the Marina's basin, the channels
//      between the Palm's fronds -- which are mapped as areas rather than coastline.
//   5. Finally stamp the buildings back in as land, because a surveyed building is better
//      evidence than any coastline, and it catches reclaimed ground mapped later than the shore.
//
// The earlier attempt at a flood fill failed because it started from the buildings and tried to
// infer the coast; this one starts from the coast, which is the thing that was missing.
//
// Run:    node scripts/city/make-landmask.mjs <slug>
// Writes: src/components/siege/globe/sites/landmasks/<slug>.ts

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { loadCity, slugFromArgv } from './cityConfig.mjs';

const city = loadCity(slugFromArgv());
const BIN = `${city.outDir}/buildings.bin`;
const COAST = `${city.rawDir}/coast.json`;
const OUT = `src/components/siege/globe/sites/landmasks/${city.slug}.ts`;
if (!existsSync(COAST)) {
  console.error(`no ${COAST} — run  node scripts/city/make-water.mjs ${city.slug}  first, it downloads the coastline`);
  process.exit(1);
}

/**
 * Metres per cell.
 *
 * 40 m, chosen against the terrain rather than picked round: the cube-sphere puts a vertex every
 * 38 m at full detail, so anything finer than this is detail the ground cannot draw and anything
 * coarser is the ground being held back by the mask. This is the number that stops the coast
 * looking like squares.
 */
const CELL = city.maskCellMetres ?? 40;
/** Half-width of the grid, in metres. Must cover the blend radius the site declares. */
const HALF = city.maxRangeMetres ?? 26000;
/**
 * The coastline is rasterised on a grid this many times finer, then averaged down.
 *
 * Geoff: "Some essential parts of the land that should be islands are now connected with the land,
 * when they shouldn't be."
 *
 * THE BARRIER WAS THE BRIDGE. Coastline ways are lines, and a line drawn one cell wide leaks: the
 * flood fill slips diagonally through a rasterised staircase and swallows the whole desert. The
 * previous fix was to draw it three cells thick — which at 40 m cells is EIGHTY METRES of invented
 * land on the seaward side of every shore. On an open coast that is a broad fake beach. Between two
 * of the Palm's fronds, which are about 150 m apart, it is 80 m of land from each side closing a
 * 150 m channel to 70 m, and where they converge near the trunk it seals them together completely.
 * Same for the crescent breakwater against the frond tips.
 *
 * Drawing at 10 m instead makes the same three-cell-thick seal only 20 m wide, which is under a
 * lane of road. The flood still cannot leak, and nothing gets bridged that is not genuinely joined.
 */
const SUB = city.maskSubdivide ?? 4;
const SUB_CELL = CELL / SUB;

const N = Math.ceil((HALF * 2) / CELL);
const FN = N * SUB;
const idx = (cx, cy) => cy * FN + cx;
const toCellX = (m) => Math.floor((m + HALF) / SUB_CELL);
const project = city.project;

console.error(`output ${N}x${N} at ${CELL} m, rasterised at ${FN}x${FN} / ${SUB_CELL} m (+/-${HALF / 1000} km)`);

// --- 1. draw the coastline as a barrier ----------------------------------------------------------
const BARRIER = 1, SEA = 2;
const grid = new Uint8Array(FN * FN);

/** Bresenham, thickened. A one-cell line leaks: two adjacent ways rarely share an exact endpoint. */
function stroke(x0, y0, x1, y1) {
  let cx = toCellX(x0), cy = toCellX(y0);
  const ex = toCellX(x1), ey = toCellX(y1);
  const dx = Math.abs(ex - cx), sx = cx < ex ? 1 : -1;
  const dy = -Math.abs(ey - cy), sy = cy < ey ? 1 : -1;
  let err = dx + dy;
  for (let guard = 0; guard < 100000; guard++) {
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const px = cx + ox, py = cy + oy;
        if (px >= 0 && py >= 0 && px < FN && py < FN) grid[idx(px, py)] = BARRIER;
      }
    }
    if (cx === ex && cy === ey) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; cx += sx; }
    if (e2 <= dx) { err += dx; cy += sy; }
  }
}

const coast = JSON.parse(readFileSync(COAST, 'utf8')).elements ?? [];
let coastWays = 0, waterAreas = [];
for (const e of coast) {
  const g = e.geometry ?? [];
  if (g.length < 2) continue;
  const t = e.tags ?? {};
  if (t.natural === 'coastline') {
    coastWays++;
    for (let i = 1; i < g.length; i++) {
      const [ax, ay] = project(g[i - 1]);
      const [bx, by] = project(g[i]);
      stroke(ax, ay, bx, by);
    }
  } else {
    // Inland water: kept as a polygon for step 4 rather than stroked, because it is an AREA and
    // its interior is what matters, not its edge.
    waterAreas.push(g.map(project));
  }
}
console.error(`stroked ${coastWays} coastline ways, held ${waterAreas.length} water areas`);

// --- 2. flood the sea in from the open Gulf -------------------------------------------------------
//
// WHERE THE SEA STARTS HAS TO BE STATED, and this used to be hardcoded to the grid's northwest
// corner because for Dubai that corner is 25 km out in the Persian Gulf. It is a property of one
// city, not of cities.
//
// For New York the northwest corner of the grid is the New Jersey Meadowlands. Seeding there floods
// the LAND, and everything the flood cannot reach — the Hudson, the East River, the Upper Bay —
// becomes "land". The mask comes out inverted: Manhattan is sea and the rivers are fields. Nothing
// about that failure is loud; the file is the right size and the script reports success.
//
// So `seaSeed` is a real coordinate in open water, given per city in its config, and it is checked.
const queue = new Int32Array(FN * FN);
let qh = 0, qt = 0;
let seedCx, seedCy;
if (city.seaSeed) {
  const [sx, sz] = city.project({ lat: city.seaSeed[0], lon: city.seaSeed[1] });
  seedCx = toCellX(sx); seedCy = toCellX(sz);
  if (seedCx < 0 || seedCy < 0 || seedCx >= FN || seedCy >= FN) {
    console.error(`seaSeed ${city.seaSeed} is OUTSIDE the mask grid (+/-${HALF / 1000} km) — pick open water nearer the origin`);
    process.exit(1);
  }
  console.error(`sea seeded at ${city.seaSeed[0]}, ${city.seaSeed[1]} (${Math.round(sx)} m E, ${Math.round(sz)} m S)`);
} else {
  seedCx = 1; seedCy = 1;
  console.error('WARNING: no seaSeed in the config — falling back to the northwest corner, which is '
    + 'only open water for some cities. If the coastline comes out inverted, this is why.');
}
const seed = idx(seedCx, seedCy);
if (grid[seed] === BARRIER) {
  // A seed sitting exactly on a stroked coastline cannot start the fill, and the result is a mask
  // that is entirely land — which looks like a working file.
  console.error('seaSeed landed ON the coastline itself — move it further out to sea');
  process.exit(1);
}
grid[seed] = SEA; queue[qt++] = seed;
while (qh < qt) {
  const k = queue[qh++];
  const cx = k % FN, cy = (k / FN) | 0;
  // Four-connected, deliberately. Eight-connected leaks diagonally through a barrier drawn as a
  // staircase, and a staircase is exactly what a rasterised diagonal coastline is.
  if (cx > 0 && grid[k - 1] === 0) { grid[k - 1] = SEA; queue[qt++] = k - 1; }
  if (cx < FN - 1 && grid[k + 1] === 0) { grid[k + 1] = SEA; queue[qt++] = k + 1; }
  if (cy > 0 && grid[k - FN] === 0) { grid[k - FN] = SEA; queue[qt++] = k - FN; }
  if (cy < FN - 1 && grid[k + FN] === 0) { grid[k + FN] = SEA; queue[qt++] = k + FN; }
}
const floodPct = (qt / grid.length) * 100;
console.error(`flood reached ${qt} cells (${floodPct.toFixed(1)}%)`);
// A COASTAL CITY IS NEITHER ALL SEA NOR ALL LAND. Outside this band something has gone wrong in a
// way that produces a perfectly well-formed file: the seed was on the wrong side (inverted), or the
// coastline had a gap and the fill walked inland through it (drowned). Both are silent otherwise.
if (floodPct < 3) {
  console.error('\nFAILED: the flood barely spread. The seed is probably enclosed by coastline, or on land.');
  process.exit(1);
}
if (floodPct > 90) {
  console.error('\nFAILED: the flood covered almost everything. The coastline has a gap and the sea leaked inland,');
  console.error('or the seed is on the land side. Widen coastBbox so the shore is complete past both ends of the city.');
  process.exit(1);
}

// --- 3. land is everything the sea could not reach -------------------------------------------------
const fine = new Uint8Array(FN * FN);
for (let k = 0; k < grid.length; k++) fine[k] = grid[k] === SEA ? 0 : 1;

// --- 4. punch out the inland water bodies ----------------------------------------------------------
//
// Even-odd scanline fill per polygon. These are the Marina's basin, the lagoons and the water
// between the Palm's fronds where it is mapped as an area instead of coastline — all of it inside
// the coastline, so the flood above could never reach it.
let waterCells = 0;
for (const poly of waterAreas) {
  if (poly.length < 3) continue;
  let minY = Infinity, maxY = -Infinity;
  for (const [, y] of poly) { if (y < minY) minY = y; if (y > maxY) maxY = y; }
  const c0 = Math.max(0, toCellX(minY)), c1 = Math.min(FN - 1, toCellX(maxY));
  for (let cy = c0; cy <= c1; cy++) {
    const y = (cy + 0.5) * SUB_CELL - HALF;
    const xs = [];
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > y) !== (yj > y)) xs.push(xi + ((y - yi) / (yj - yi)) * (xj - xi));
    }
    xs.sort((a, b) => a - b);
    for (let s = 0; s + 1 < xs.length; s += 2) {
      const a = Math.max(0, toCellX(xs[s])), b = Math.min(FN - 1, toCellX(xs[s + 1]));
      for (let cx = a; cx <= b; cx++) { if (fine[idx(cx, cy)]) { fine[idx(cx, cy)] = 0; waterCells++; } }
    }
  }
}
console.error(`inland water removed ${waterCells} cells`);

// --- 5. buildings are land, whatever the coastline says --------------------------------------------
//
// Last word, and deliberately so. A surveyed building footprint is stronger evidence than a
// coastline traced from imagery, and reclaimed ground is routinely built on before the shore around
// it is redrawn. This is what keeps a tower from standing in the sea.
const buf = readFileSync(BIN);
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
const count = dv.getUint32(16);
const f = new Float32Array(buf.buffer, buf.byteOffset + 24, count * 6);
let reclaimed = 0;
for (let i = 0; i < count; i++) {
  const x = f[i * 6], z = f[i * 6 + 1];
  // NO DILATION. The old version grew every footprint by a whole 40 m cell "because a building
  // implies the road around it" — but a villa on one of the Palm's fronds is 20 m from the water,
  // so a 40 m skirt walks straight across the channel and joins it to the next frond. The coastline
  // is accurate enough now to say where the ground ends; the buildings only need to correct it
  // where a tower genuinely stands on ground the shoreline data has not caught up with.
  const r = Math.max(f[i * 6 + 2], f[i * 6 + 3]) / 2;
  const c0x = toCellX(x - r), c1x = toCellX(x + r);
  const c0y = toCellX(z - r), c1y = toCellX(z + r);
  for (let cy = c0y; cy <= c1y; cy++) {
    for (let cx = c0x; cx <= c1x; cx++) {
      if (cx < 0 || cy < 0 || cx >= FN || cy >= FN) continue;
      if (!fine[idx(cx, cy)]) reclaimed++;
      fine[idx(cx, cy)] = 1;
    }
  }
}
console.error(`buildings reclaimed ${reclaimed} fine cells the coastline called sea`);

// --- 6. average the fine grid down to the output grid ------------------------------------------------
//
// A cell is land if at least half of its sixteen subcells are. Majority rather than "any", because
// "any" would grow every island by up to 40 m again and undo the whole point of rasterising fine.
const land = new Uint8Array(N * N);
for (let cy = 0; cy < N; cy++) {
  for (let cx = 0; cx < N; cx++) {
    let sum = 0;
    for (let sy = 0; sy < SUB; sy++) {
      for (let sx = 0; sx < SUB; sx++) sum += fine[idx(cx * SUB + sx, cy * SUB + sy)];
    }
    land[cy * N + cx] = sum * 2 >= SUB * SUB ? 1 : 0;
  }
}

const landCells = land.reduce((a, b) => a + b, 0);
console.error(`land ${landCells} cells (${((landCells / land.length) * 100).toFixed(1)}%)`);

// --- a look at it, because a coastline is the one thing you can check by eye ------------------------
{
  const ROWS = 44, COLS = 88;
  const lines = [];
  for (let r = 0; r < ROWS; r++) {
    let s = '';
    for (let c = 0; c < COLS; c++) {
      const cx = Math.floor((c / COLS) * N), cy = Math.floor((r / ROWS) * N);
      s += land[cy * N + cx] ? '#' : '.';
    }
    lines.push(s);
  }
  console.error('\n' + lines.join('\n') + '\n');
}

// --- pack to bits and emit --------------------------------------------------------------------------
const bytes = new Uint8Array(Math.ceil(land.length / 8));
for (let k = 0; k < land.length; k++) if (land[k]) bytes[k >> 3] |= 1 << (k & 7);
const b64 = Buffer.from(bytes).toString('base64');

writeFileSync(OUT, `// GENERATED by scripts/city/make-landmask.mjs — do not edit by hand.
//
// Where Dubai is land, from OpenStreetMap's real coastline: ${coastWays} coastline ways flood-filled
// from the open Gulf, ${waterAreas.length} inland water areas punched out, and the city's own
// ${count.toLocaleString()} building footprints stamped back in as the final word. See that script.
//
// ${N}x${N} cells of ${CELL} m, covering +/-${HALF / 1000} km around the city origin. One bit per
// cell, base64. ${(bytes.length / 1024).toFixed(0)} KB raw, and it compresses far smaller in transit
// because a coastline is mostly long runs of the same value.

import { registerLandMask } from '../maskRegistry';

const MASK_CELL_METRES = ${CELL};
const MASK_HALF_METRES = ${HALF};
const MASK_N = ${N};

const PACKED = '${b64}';

/** Unpacked once, lazily — nothing pays for this until a city is actually near. */
let bits: Uint8Array | null = null;

function bit(cx: number, cy: number): number {
  // CLAMPED, not bounds-rejected. Returning sea outside the grid would ring the whole city with
  // water at exactly 26 km — desert included. Clamping continues the edge outward instead, so the
  // coastline runs off the side of the map the way a coastline does.
  const x = cx < 0 ? 0 : cx >= MASK_N ? MASK_N - 1 : cx;
  const y = cy < 0 ? 0 : cy >= MASK_N ? MASK_N - 1 : cy;
  const k = y * MASK_N + x;
  return (bits![k >> 3] & (1 << (k & 7))) !== 0 ? 1 : 0;
}

function ensure(): void {
  if (bits) return;
  const raw = atob(PACKED);
  const b = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) b[i] = raw.charCodeAt(i);
  bits = b;
}

/**
 * How much of this point is land, 0 to 1, sampled smoothly.
 *
 * A bit per cell makes a staircase, and a staircase forty metres on a side is what Geoff saw as
 * "made of 50 m squares". Reading the four surrounding cells and interpolating between them turns
 * the step into a ramp one cell wide, which the ground then renders as a beach slope rather than a
 * cliff — and it costs four array reads.
 */
function cityLandFraction(xMetres: number, zMetres: number): number {
  ensure();
  const fx = (xMetres + MASK_HALF_METRES) / MASK_CELL_METRES - 0.5;
  const fy = (zMetres + MASK_HALF_METRES) / MASK_CELL_METRES - 0.5;
  const cx = Math.floor(fx), cy = Math.floor(fy);
  const tx = fx - cx, ty = fy - cy;
  const a = bit(cx, cy), b = bit(cx + 1, cy), c = bit(cx, cy + 1), d = bit(cx + 1, cy + 1);
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

registerLandMask('${city.slug}', cityLandFraction);
`);
console.error(`wrote ${OUT} — ${(b64.length / 1024).toFixed(0)} KB of base64`);
