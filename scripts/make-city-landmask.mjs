// make-city-landmask — work out where Dubai is LAND, from the buildings themselves.
//
// Geoff: "The palm is supposed to be a set of islands in the water but everything is inland. The
// whole city seems to be off by 1km or so and not right on the coast like it should be."
//
// The city is NOT mispositioned — the Burj Khalifa lands within 45 m of where its real latitude and
// longitude put it. What went wrong is the ground override: a city declares its own elevation
// because the only terrain data over Dubai is a nine-kilometre-per-sample tile that reads -87 m,
// and I applied that as a flat disc fifteen kilometres across. Which fills in the Persian Gulf, the
// Marina's waterways, and every channel between the Palm's fronds. There was no coastline left to
// be on the wrong side of.
//
// THE BUILDINGS ARE THE LAND MAP. Nothing else needs downloading: 59,202 surveyed footprints say
// exactly where the ground is, including on artificial islands that no bathymetry survey knows
// about. So:
//
//   1. Mark every 100 m cell containing a building as land.
//   2. Dilate a little, because a building implies the road and pavement around it.
//   3. FLOOD-FILL THE SEA from the open Gulf in the northwest, through everything not marked.
//   4. Anything the sea could not reach is land.
//
// Step 3 is what makes this work rather than just outlining the buildings. Water between the Palm's
// fronds connects to the open Gulf, so it stays water. A gap in the desert south of the city does
// not connect to anything, so it becomes land instead of a lake. One flood fill separates the two
// cases correctly and no hand-drawn coastline is needed.
//
// Run: node scripts/make-city-landmask.mjs
// Writes: src/components/siege/globe/dubaiLandMask.ts

import { readFileSync, writeFileSync } from 'node:fs';

const BIN = 'public/siege/city/dubai.bin';
const OUT = 'src/components/siege/globe/dubaiLandMask.ts';

/** Metres per cell. 100 m resolves the Palm's fronds, which are 150-250 m across. */
const CELL = 100;
/** Half-width of the grid, in metres. Must cover the blend radius in cityGround. */
const HALF = 26000;
/**
 * Cells of land grown around every building — just one, 100 m.
 *
 * Deliberately small, and the reason is the Palm. Its fronds are 150-250 m across with about 150 m
 * of water between them, so anything past a single cell welds them into one blob and the islands
 * Geoff asked about stop being islands. The MAINLAND does not need dilation because it comes from
 * the coastline below, not from the buildings.
 */
const DILATE = 1;

// The bake's origin, and the same projection it used. These must match cityData exactly or the mask
// is offset from the buildings it was made from.
const LAT0 = 25.14, LON0 = 55.21;
const MPER_LAT = 111320;
const MPER_LON = MPER_LAT * Math.cos((LAT0 * Math.PI) / 180);

const buf = readFileSync(BIN);
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
const count = dv.getUint32(16);
const f = new Float32Array(buf.buffer, buf.byteOffset + 24, count * 6);

const N = Math.ceil((HALF * 2) / CELL);
const land = new Uint8Array(N * N);
const idx = (cx, cy) => cy * N + cx;
const toCell = (m) => Math.floor((m + HALF) / CELL);

let placed = 0;
for (let i = 0; i < count; i++) {
  const x = f[i * 6], z = f[i * 6 + 1];
  const w = f[i * 6 + 2], d = f[i * 6 + 3];
  // Stamp the building's own FOOTPRINT, not just its centre — the Dubai Mall is 1.2 km long and a
  // single cell would leave most of it as sea.
  const r = Math.max(w, d) / 2;
  const c0x = toCell(x - r), c1x = toCell(x + r);
  const c0y = toCell(z - r), c1y = toCell(z + r);
  for (let cy = c0y; cy <= c1y; cy++) {
    for (let cx = c0x; cx <= c1x; cx++) {
      if (cx < 0 || cy < 0 || cx >= N || cy >= N) continue;
      land[idx(cx, cy)] = 1;
    }
  }
  placed++;
}
console.error(`stamped ${placed} buildings into a ${N}x${N} grid at ${CELL} m`);

// --- dilate -------------------------------------------------------------------------------------
for (let pass = 0; pass < DILATE; pass++) {
  const next = land.slice();
  for (let cy = 1; cy < N - 1; cy++) {
    for (let cx = 1; cx < N - 1; cx++) {
      if (land[idx(cx, cy)]) continue;
      if (land[idx(cx - 1, cy)] || land[idx(cx + 1, cy)]
        || land[idx(cx, cy - 1)] || land[idx(cx, cy + 1)]) next[idx(cx, cy)] = 1;
    }
  }
  land.set(next);
}

// --- the mainland, from an actual coastline ------------------------------------------------------
//
// TWO EARLIER ATTEMPTS FAILED, and both failed the same way. Marking only the buildings gave 5.7%
// land — every tower its own island. Growing them 800 m and flood-filling the sea from the Gulf gave
// 7.5%, because a coastal city does not ENCLOSE anything: the fill simply walks around the ends of
// the built strip and into the desert behind it. There is no topological trick that separates
// "desert behind the city" from "open sea" when the city is a strip along a shore.
//
// So the coast is stated, as the geography it is. Dubai's shoreline runs southwest to northeast in
// very nearly a straight line for the whole 25 km this covers, from the Marina beaches up past
// Jumeirah to the creek. Two real points on it define the line; everything on the inland side is
// land, and the building mask then ADDS the artificial islands that sit outside it — the Palm,
// the Marina's waterfront — which is exactly the case a coastline alone gets wrong.
const COAST_A = { lat: 25.078, lon: 55.130 };   // the beach at JBR / Marina
const COAST_B = { lat: 25.270, lon: 55.320 };   // up past Jumeirah toward the creek

const toLocal = (p) => ({
  x: (p.lon - LON0) * MPER_LON,
  z: -(p.lat - LAT0) * MPER_LAT,
});
const a = toLocal(COAST_A), b = toLocal(COAST_B);
// Normal pointing INLAND — southeast, which in this frame is +x and +z.
let nx = (b.z - a.z), nz = -(b.x - a.x);
if (nx + nz < 0) { nx = -nx; nz = -nz; }
const inland = (x, z) => (x - a.x) * nx + (z - a.z) * nz > 0;

let fromCoast = 0;
for (let cy = 0; cy < N; cy++) {
  for (let cx = 0; cx < N; cx++) {
    const k = idx(cx, cy);
    if (land[k]) continue;
    const x = (cx + 0.5) * CELL - HALF;
    const z = (cy + 0.5) * CELL - HALF;
    if (inland(x, z)) { land[k] = 1; fromCoast++; }
  }
}
console.error(`coastline added ${fromCoast} mainland cells`);
const filled = 0;

const landCells = land.reduce((a, b) => a + b, 0);
console.error(`land ${landCells} cells (${((landCells / land.length) * 100).toFixed(1)}%), `
  + `${filled} enclosed cells filled, sea ${land.length - landCells}`);

// --- pack to bits and emit ------------------------------------------------------------------------
const bytes = new Uint8Array(Math.ceil(land.length / 8));
for (let k = 0; k < land.length; k++) if (land[k]) bytes[k >> 3] |= 1 << (k & 7);
const b64 = Buffer.from(bytes).toString('base64');

writeFileSync(OUT, `// GENERATED by scripts/make-city-landmask.mjs — do not edit by hand.
//
// Where Dubai is land, derived from its own 59,202 building footprints and a flood fill of the
// Gulf. See that script for why this exists: without it the city's ground override fills in the sea,
// and the Palm stops being islands.
//
// ${N}x${N} cells of ${CELL} m, covering +/-${HALF / 1000} km around the city origin. One bit per
// cell, base64. ${(bytes.length / 1024).toFixed(1)} KB raw, and it compresses far smaller in transit
// because it is mostly runs of the same value.

export const MASK_CELL_METRES = ${CELL};
export const MASK_HALF_METRES = ${HALF};
export const MASK_N = ${N};

const PACKED = '${b64}';

/** Unpacked once, lazily — nothing pays for this until a city is actually near. */
let bits: Uint8Array | null = null;

/** True if this offset from the city origin, in metres east and south, is land. */
export function isCityLand(xMetres: number, zMetres: number): boolean {
  if (!bits) {
    const raw = atob(PACKED);
    bits = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bits[i] = raw.charCodeAt(i);
  }
  // CLAMPED, not bounds-rejected. Returning false outside the grid would ring the whole city with
  // sea at exactly 26 km — desert included. Clamping continues the edge outward instead, so the
  // coastline runs off the side of the map the way a coastline does.
  const cx = Math.min(MASK_N - 1, Math.max(0, Math.floor((xMetres + MASK_HALF_METRES) / MASK_CELL_METRES)));
  const cy = Math.min(MASK_N - 1, Math.max(0, Math.floor((zMetres + MASK_HALF_METRES) / MASK_CELL_METRES)));
  const k = cy * MASK_N + cx;
  return (bits[k >> 3] & (1 << (k & 7))) !== 0;
}
`);
console.error(`wrote ${OUT} — ${(b64.length / 1024).toFixed(1)} KB of base64`);
