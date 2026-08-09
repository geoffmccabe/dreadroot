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
// Run: node scripts/make-city-landmask.mjs      (expects /tmp/coast_all.json)
// Writes: src/components/siege/globe/dubaiLandMask.ts

import { readFileSync, writeFileSync } from 'node:fs';

const BIN = 'public/siege/city/dubai.bin';
const COAST = '/tmp/coast_all.json';
const OUT = 'src/components/siege/globe/dubaiLandMask.ts';

/**
 * Metres per cell.
 *
 * 40 m, chosen against the terrain rather than picked round: the cube-sphere puts a vertex every
 * 38 m at full detail, so anything finer than this is detail the ground cannot draw and anything
 * coarser is the ground being held back by the mask. This is the number that stops the coast
 * looking like squares.
 */
const CELL = 40;
/** Half-width of the grid, in metres. Must cover the blend radius in cityGround. */
const HALF = 26000;

// The bake's origin, and the same projection it used. These must match cityData exactly or the mask
// is offset from the buildings it was made from.
const LAT0 = 25.14, LON0 = 55.21;
const MPER_LAT = 111320;
const MPER_LON = MPER_LAT * Math.cos((LAT0 * Math.PI) / 180);

const N = Math.ceil((HALF * 2) / CELL);
const idx = (cx, cy) => cy * N + cx;
const toCellX = (m) => Math.floor((m + HALF) / CELL);
const project = (p) => [(p.lon - LON0) * MPER_LON, -(p.lat - LAT0) * MPER_LAT];

console.error(`grid ${N}x${N} at ${CELL} m (+/-${HALF / 1000} km)`);

// --- 1. draw the coastline as a barrier ----------------------------------------------------------
const BARRIER = 1, SEA = 2;
const grid = new Uint8Array(N * N);

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
        if (px >= 0 && py >= 0 && px < N && py < N) grid[idx(px, py)] = BARRIER;
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
// The northwest corner of the grid is 26 km west and 26 km north of the city origin, which puts it
// roughly 25 km offshore. There is nothing there but the Persian Gulf.
const queue = new Int32Array(N * N);
let qh = 0, qt = 0;
const seed = idx(1, 1);
if (grid[seed] !== BARRIER) { grid[seed] = SEA; queue[qt++] = seed; }
while (qh < qt) {
  const k = queue[qh++];
  const cx = k % N, cy = (k / N) | 0;
  // Four-connected, deliberately. Eight-connected leaks diagonally through a barrier drawn as a
  // staircase, and a staircase is exactly what a rasterised diagonal coastline is.
  if (cx > 0 && grid[k - 1] === 0) { grid[k - 1] = SEA; queue[qt++] = k - 1; }
  if (cx < N - 1 && grid[k + 1] === 0) { grid[k + 1] = SEA; queue[qt++] = k + 1; }
  if (cy > 0 && grid[k - N] === 0) { grid[k - N] = SEA; queue[qt++] = k - N; }
  if (cy < N - 1 && grid[k + N] === 0) { grid[k + N] = SEA; queue[qt++] = k + N; }
}
console.error(`flood reached ${qt} cells (${((qt / grid.length) * 100).toFixed(1)}%)`);

// --- 3. land is everything the sea could not reach -------------------------------------------------
const land = new Uint8Array(N * N);
for (let k = 0; k < grid.length; k++) land[k] = grid[k] === SEA ? 0 : 1;

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
  const c0 = Math.max(0, toCellX(minY)), c1 = Math.min(N - 1, toCellX(maxY));
  for (let cy = c0; cy <= c1; cy++) {
    const y = (cy + 0.5) * CELL - HALF;
    const xs = [];
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > y) !== (yj > y)) xs.push(xi + ((y - yi) / (yj - yi)) * (xj - xi));
    }
    xs.sort((a, b) => a - b);
    for (let s = 0; s + 1 < xs.length; s += 2) {
      const a = Math.max(0, toCellX(xs[s])), b = Math.min(N - 1, toCellX(xs[s + 1]));
      for (let cx = a; cx <= b; cx++) { if (land[idx(cx, cy)]) { land[idx(cx, cy)] = 0; waterCells++; } }
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
  const r = Math.max(f[i * 6 + 2], f[i * 6 + 3]) / 2 + CELL;
  const c0x = toCellX(x - r), c1x = toCellX(x + r);
  const c0y = toCellX(z - r), c1y = toCellX(z + r);
  for (let cy = c0y; cy <= c1y; cy++) {
    for (let cx = c0x; cx <= c1x; cx++) {
      if (cx < 0 || cy < 0 || cx >= N || cy >= N) continue;
      if (!land[idx(cx, cy)]) reclaimed++;
      land[idx(cx, cy)] = 1;
    }
  }
}
console.error(`buildings reclaimed ${reclaimed} cells the coastline called sea`);

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
      s += land[idx(cx, cy)] ? '#' : '.';
    }
    lines.push(s);
  }
  console.error('\n' + lines.join('\n') + '\n');
}

// --- pack to bits and emit --------------------------------------------------------------------------
const bytes = new Uint8Array(Math.ceil(land.length / 8));
for (let k = 0; k < land.length; k++) if (land[k]) bytes[k >> 3] |= 1 << (k & 7);
const b64 = Buffer.from(bytes).toString('base64');

writeFileSync(OUT, `// GENERATED by scripts/make-city-landmask.mjs — do not edit by hand.
//
// Where Dubai is land, from OpenStreetMap's real coastline: ${coastWays} coastline ways flood-filled
// from the open Gulf, ${waterAreas.length} inland water areas punched out, and the city's own
// ${count.toLocaleString()} building footprints stamped back in as the final word. See that script.
//
// ${N}x${N} cells of ${CELL} m, covering +/-${HALF / 1000} km around the city origin. One bit per
// cell, base64. ${(bytes.length / 1024).toFixed(0)} KB raw, and it compresses far smaller in transit
// because a coastline is mostly long runs of the same value.

export const MASK_CELL_METRES = ${CELL};
export const MASK_HALF_METRES = ${HALF};
export const MASK_N = ${N};

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

/** True if this offset from the city origin, in metres east and south, is land. */
export function isCityLand(xMetres: number, zMetres: number): boolean {
  ensure();
  return bit(Math.floor((xMetres + MASK_HALF_METRES) / MASK_CELL_METRES),
             Math.floor((zMetres + MASK_HALF_METRES) / MASK_CELL_METRES)) === 1;
}

/**
 * How much of this point is land, 0 to 1, sampled smoothly.
 *
 * A bit per cell makes a staircase, and a staircase forty metres on a side is what Geoff saw as
 * "made of 50 m squares". Reading the four surrounding cells and interpolating between them turns
 * the step into a ramp one cell wide, which the ground then renders as a beach slope rather than a
 * cliff — and it costs four array reads.
 */
export function cityLandFraction(xMetres: number, zMetres: number): number {
  ensure();
  const fx = (xMetres + MASK_HALF_METRES) / MASK_CELL_METRES - 0.5;
  const fy = (zMetres + MASK_HALF_METRES) / MASK_CELL_METRES - 0.5;
  const cx = Math.floor(fx), cy = Math.floor(fy);
  const tx = fx - cx, ty = fy - cy;
  const a = bit(cx, cy), b = bit(cx + 1, cy), c = bit(cx, cy + 1), d = bit(cx + 1, cy + 1);
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}
`);
console.error(`wrote ${OUT} — ${(b64.length / 1024).toFixed(0)} KB of base64`);
