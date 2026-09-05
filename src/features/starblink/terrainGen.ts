// terrainGen — the whole Starblink landscape as a pure function of (x, z) and a seed.
//
// Nothing is stored. Height is computed on demand wherever it is needed (mesh vertices, the player's
// feet, monster spawns), so 900 km2 of terrain costs one seed and the constants in this file. Manual
// brush edits still work: heightField keeps those as sparse overrides ON TOP of what this returns.
//
// Deterministic and dependency-free: integer hashing, not Math.random and not a noise library, so the
// same (x, z, seed) gives the same height on every machine forever. That matters because land is
// being sold, and a parcel's terrain must never move under its owner.
//
// SHAPE OF THE WORLD, largest features first:
//   continental  broad highlands and basins, so the map is not uniform
//   mountains    ridged noise, which gives real ridgelines instead of blobs
//   hills        the general roll of the land
//   detail       fine roughness so slopes are not glassy
//   biome        a regional modifier that makes patches much rougher or much smoother
//
// See docs/STARBLINK_WORLDGEN_PLAN.md.

import type { TerrainParams } from './terrainParams';

/** Kept for callers that just want the ceiling for a readout. */
export const MAX_HEIGHT_M = 400;

// ---------------------------------------------------------------- noise

/** Integer hash → [0,1). Cheap, well-mixed, and identical on every platform. */
function hash(x: number, z: number, seed: number): number {
  // ⚠ EVERY MULTIPLY HERE MUST BE Math.imul.
  //
  // This used to read `seed * 1442695040888963407`. That constant is 61 bits, so in JS the
  // product blows past the 2^53 float limit and the low bits, which are the ONLY bits `^`
  // keeps, are rounded away to zero. The seed was therefore discarded almost entirely:
  // measured, 100,000 distinct seeds collapsed to 6,002 distinct hashes, and 5,000 presses
  // of the Generate button produced NINE distinct worlds.
  //
  // That is the whole reason Generate appeared to do nothing: it really was changing the
  // seed, and the seed really was reaching this function, and this function was throwing it
  // away. Math.imul does a true 32-bit multiply with wraparound, which is what the algorithm
  // wanted in the first place. The x and z multiplies had the same latent problem at large
  // world coordinates.
  let h = Math.imul(x, 374761393) ^ Math.imul(z, 668265263) ^ Math.imul(seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const fade = (t: number) => t * t * (3 - 2 * t);   // smoothstep, for C1-continuous interpolation

/** Smooth value noise in [-1, 1]. */
function noise2(x: number, z: number, seed: number): number {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = fade(x - ix), fz = fade(z - iz);
  const a = hash(ix, iz, seed), b = hash(ix + 1, iz, seed);
  const c = hash(ix, iz + 1, seed), d = hash(ix + 1, iz + 1, seed);
  const top = a + (b - a) * fx, bot = c + (d - c) * fx;
  return (top + (bot - top) * fz) * 2 - 1;
}

/** Fractal noise: several octaves of noise2, each finer and quieter. Returns roughly [-1, 1]. */
function fbm(x: number, z: number, seed: number, octaves: number, gain = 0.5): number {
  let sum = 0, amp = 1, norm = 0, fx = x, fz = z;
  for (let i = 0; i < octaves; i++) {
    sum += noise2(fx, fz, seed + i * 1013) * amp;
    norm += amp;
    amp *= gain;
    fx *= 2.03; fz *= 2.03;   // not exactly 2, to avoid the octaves lining up into a grid
  }
  return sum / norm;
}

/**
 * Ridged noise in [0, 1]: mountains want sharp crests, and plain fbm gives rounded lumps. Folding
 * the noise about zero turns its zero-crossings into ridgelines, which is what reads as a range.
 */
function ridged(x: number, z: number, seed: number, octaves: number): number {
  let sum = 0, amp = 1, norm = 0, fx = x, fz = z;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(noise2(fx, fz, seed + i * 7919));
    sum += n * n * amp;
    norm += amp;
    amp *= 0.5;
    fx *= 2.07; fz *= 2.07;
  }
  return sum / norm;
}

// ---------------------------------------------------------------- biomes

/** One biome region every this many metres (about 18 parcels across). */
const BIOME_CELL_M = 1800;

/**
 * Regional character. Each biome cell picks a profile, and its influence EASES OUT towards the cell
 * edge so an extreme region is confined to its own patch and blends back to ordinary land rather
 * than ending at a seam. Because every cell eases to the same neutral base, neighbours always meet
 * smoothly without having to blend cells against each other.
 */
interface Biome {
  name: string;
  detail: number;     // multiplier on fine roughness
  hill: number;       // multiplier on the hill layer
  mountain: number;   // multiplier on the mountain layer
  spikes: number;     // extreme high-frequency spikes and holes (0 = none)
  terrace: number;    // flat-topped benches: buttes, mesas and cliff faces
  canyon: number;     // winding gorges cut down through whatever is there
  lake: number;       // scooped basins, which is where water will sit
}

const BIOMES: Biome[] = [
  { name: 'plains',    detail: 0.5,  hill: 0.6,  mountain: 0.3,  spikes: 0,    terrace: 0,    canyon: 0.15, lake: 0.5 },
  { name: 'downs',     detail: 1.0,  hill: 1.2,  mountain: 0.7,  spikes: 0,    terrace: 0.1,  canyon: 0.3,  lake: 0.3 },
  { name: 'highlands', detail: 1.4,  hill: 1.2,  mountain: 1.6,  spikes: 0.05, terrace: 0.25, canyon: 0.5,  lake: 0.1 },
  { name: 'flats',     detail: 0.12, hill: 0.18, mountain: 0.06, spikes: 0,    terrace: 0,    canyon: 0,    lake: 0.8 },
  { name: 'mesas',     detail: 1.1,  hill: 0.9,  mountain: 1.1,  spikes: 0,    terrace: 1.0,  canyon: 0.7,  lake: 0.1 },
  { name: 'canyonland',detail: 1.3,  hill: 0.8,  mountain: 0.9,  spikes: 0,    terrace: 0.55, canyon: 1.0,  lake: 0.1 },
  { name: 'broken',    detail: 2.6,  hill: 1.3,  mountain: 1.1,  spikes: 0.4,  terrace: 0.3,  canyon: 0.5,  lake: 0.2 },
  // Rare and deliberately extreme: a forest of spikes and pits. Confined to one cell and eased out.
  { name: 'spires',    detail: 3.4,  hill: 0.9,  mountain: 1.3,  spikes: 1.0,  terrace: 0,    canyon: 0.3,  lake: 0.2 },
];

/** Weighted pick: ordinary land is common, the extreme regions are rare. */
const BIOME_WEIGHTS = [20, 22, 16, 8, 12, 11, 8, 3];
const WEIGHT_TOTAL = BIOME_WEIGHTS.reduce((a, b) => a + b, 0);

function biomeOfCell(cx: number, cz: number, seed: number): Biome {
  let r = hash(cx, cz, seed ^ 0x5eed) * WEIGHT_TOTAL;
  for (let i = 0; i < BIOMES.length; i++) {
    r -= BIOME_WEIGHTS[i];
    if (r <= 0) return BIOMES[i];
  }
  return BIOMES[0];
}

/** The neutral profile every biome eases back to at its edges. */
const NEUTRAL: Biome = { name: 'neutral', detail: 1, hill: 1, mountain: 1, spikes: 0, terrace: 0.12, canyon: 0.25, lake: 0.2 };

/**
 * Blend this point's biome towards neutral by how far it sits from its cell's (jittered) centre.
 * Full character in the middle, ordinary land by the edge.
 */
function biomeAt(x: number, z: number, seed: number): Biome {
  const cx = Math.floor(x / BIOME_CELL_M), cz = Math.floor(z / BIOME_CELL_M);
  // Jitter the centre so the regions are not an obvious square grid.
  const jx = (cx + 0.25 + hash(cx, cz, seed ^ 0x11) * 0.5) * BIOME_CELL_M;
  const jz = (cz + 0.25 + hash(cx, cz, seed ^ 0x22) * 0.5) * BIOME_CELL_M;
  const d = Math.hypot(x - jx, z - jz) / (BIOME_CELL_M * 0.72);
  const w = 1 - fade(Math.min(1, Math.max(0, d)));   // 1 at the centre, 0 by the edge
  const b = biomeOfCell(cx, cz, seed);
  const mix = (a: number, bb: number) => a + (bb - a) * w;
  return {
    name: b.name,
    detail: mix(NEUTRAL.detail, b.detail),
    hill: mix(NEUTRAL.hill, b.hill),
    mountain: mix(NEUTRAL.mountain, b.mountain),
    spikes: mix(0, b.spikes),
    terrace: mix(NEUTRAL.terrace, b.terrace),
    canyon: mix(NEUTRAL.canyon, b.canyon),
    lake: mix(NEUTRAL.lake, b.lake),
  };
}

/** Which biome dominates here — for debug readouts and, later, per-parcel land type. */
export const biomeNameAt = (x: number, z: number, seed: number) => biomeAt(x, z, seed).name;

// ---------------------------------------------------------------- height

/** 0 on the Fortress plaza, easing to 1 by the outer radius, so the centre parcels stay flat. */
function fortressFlatten(x: number, z: number, p: TerrainParams): number {
  const d = Math.hypot(x, z);
  if (d <= p.flatRadius) return 0;
  if (d >= p.flatBlend) return 1;
  return fade((d - p.flatRadius) / (p.flatBlend - p.flatRadius));
}

/**
 * Compress the top of the range instead of slicing it off. A hard `Math.min` gave every high peak
 * an identical dead-flat summit at exactly the ceiling, which reads as a plateau rather than a
 * mountain. tanh eases the last stretch so summits stay pointed and still never exceed the ceiling.
 */
function softCeiling(h: number, maxH: number): number {
  const knee = maxH * 0.7;
  if (h <= knee) return h;
  const room = maxH - knee;
  return knee + room * Math.tanh((h - knee) / room);
}

/**
 * Benches. Quantising height to steps and then sharpening the tread is what makes buttes, mesas and
 * cliff faces: a flat top with a steep riser, rather than a smooth dome.
 */
function terrace(h: number, step: number, sharp: number): number {
  if (sharp <= 0.001 || step <= 0.1) return h;
  const q = Math.floor(h / step) * step;
  const f = (h - q) / step;
  const shaped = q + step * Math.pow(f, 1 + sharp * 5);
  return h + (shaped - h) * sharp;
}

/**
 * Ground height at a world position. This is the authoritative shape of Starblink.
 */
export function terrainHeight(x: number, z: number, p: TerrainParams): number {
  const seed = p.seed;
  const b = biomeAt(x, z, seed);

  // DOMAIN WARP. Sampling the noise at a position that has itself been stirred by noise is the
  // single biggest difference between "rolling blobs" and terrain that looks eroded and organic.
  // Applied to the mountain and hill layers; the continental shape stays unwarped so the broad
  // highlands keep their scale.
  const wl = p.warpWavelength;
  const wx = x + fbm(x / wl, z / wl, seed + 5, 2) * p.warpAmount;
  const wz = z + fbm(x / wl + 31.7, z / wl - 17.3, seed + 6, 2) * p.warpAmount;

  const continent = (fbm(x / p.wlContinent, z / p.wlContinent, seed + 11, 3) * 0.5 + 0.5) * p.ampContinent;

  // Ridges: only the top of the ridged field counts, then it is curved, so most ground gets no
  // mountain at all and the ranges rise out of it.
  const rr = ridged(wx / p.wlMountain, wz / p.wlMountain, seed + 23, 5);
  const r = Math.max(0, (rr - p.ridgeFloor) / (1 - p.ridgeFloor));
  const mountain = Math.pow(r, 1.4) * p.ampMountain * b.mountain;

  const hill = (fbm(wx / p.wlHill, wz / p.wlHill, seed + 37, 4) * 0.65 + 0.35) * p.ampHill * b.hill;

  // Two scales of surface texture, so slopes have something to read at walking distance.
  const detail = (fbm(wx / p.wlDetail, wz / p.wlDetail, seed + 53, 3) * 0.7
                + fbm(wx / 17, wz / 17, seed + 97, 2) * 0.3) * p.ampDetail * b.detail;

  let h = p.baseElevation + continent + mountain + hill + detail;

  // Spikes and pits. Signed, so the same term makes towers AND holes rather than only pushing up.
  if (b.spikes > 0.001) {
    const sp = fbm(x / 34, z / 34, seed + 71, 2);
    h += Math.sign(sp) * Math.pow(Math.abs(sp), 2.2) * 90 * b.spikes;
  }

  // Benches, before the cuts, so canyon walls inherit the bench profile.
  h = terrace(h, p.terraceStep, p.terraceSharpness * b.terrace);

  // CANYONS. A ridged field is a set of winding lines where it approaches its maximum; taking only
  // that top sliver gives narrow meandering gorges rather than broad valleys. Warped, so they snake.
  if (b.canyon > 0.001 && p.canyonDepth > 0) {
    const c = ridged(wx / p.canyonWavelength, wz / p.canyonWavelength, seed + 131, 3);
    const lo = 1 - Math.max(0.02, p.canyonWidth);
    const t = c <= lo ? 0 : fade(Math.min(1, (c - lo) / (1 - lo)));
    h -= t * p.canyonDepth * b.canyon;
  }

  // LAKE BASINS. Broad scoops in the low places, which is where water will sit later.
  if (b.lake > 0.001 && p.lakeDepth > 0) {
    const l = fbm(x / p.lakeWavelength, z / p.lakeWavelength, seed + 149, 2);
    const t = l >= -0.18 ? 0 : fade(Math.min(1, (-0.18 - l) / 0.42));
    h -= t * p.lakeDepth * b.lake;
  }

  return softCeiling(h, p.maxHeight) * fortressFlatten(x, z, p);
}

/** Approximate uphill slope (0 = flat, 1 = vertical) — for cliff shading and scatter rejection. */
export function terrainSlope(x: number, z: number, p: TerrainParams, step = 2): number {
  const hx = terrainHeight(x + step, z, p) - terrainHeight(x - step, z, p);
  const hz = terrainHeight(x, z + step, p) - terrainHeight(x, z - step, p);
  return Math.min(1, Math.hypot(hx, hz) / (2 * step));
}
