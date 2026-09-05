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

// ---------------------------------------------------------------- tuneables

/** Peak height above the base plane, metres. Valleys sit near 0. */
export const MAX_HEIGHT_M = 400;

/** Wavelengths in metres. Bigger = broader, smoother features. */
const WL_CONTINENT = 8000;
const WL_MOUNTAIN = 3000;
const WL_HILL = 900;
const WL_DETAIL = 60;

/** Amplitudes in metres, before the biome modifier. */
const AMP_CONTINENT = 120;
const AMP_MOUNTAIN = 320;
const AMP_HILL = 50;
const AMP_DETAIL = 4;

/** Biome regions: one cell every this many metres (about 18 parcels across). */
const BIOME_CELL_M = 1800;

/** The Fortress and its surroundings are flat: fully flat to here, fully normal by the outer radius. */
const FLAT_RADIUS_M = 160;
const FLAT_BLEND_M = 520;

// ---------------------------------------------------------------- noise

/** Integer hash → [0,1). Cheap, well-mixed, and identical on every platform. */
function hash(x: number, z: number, seed: number): number {
  let h = (x * 374761393) ^ (z * 668265263) ^ (seed * 1442695040888963407);
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
}

const BIOMES: Biome[] = [
  { name: 'plains',    detail: 0.35, hill: 0.45, mountain: 0.25, spikes: 0 },
  { name: 'downs',     detail: 0.8,  hill: 1.0,  mountain: 0.5,  spikes: 0 },
  { name: 'highlands', detail: 1.0,  hill: 1.1,  mountain: 1.35, spikes: 0 },
  { name: 'flats',     detail: 0.12, hill: 0.18, mountain: 0.06, spikes: 0 },   // eerily smooth
  { name: 'broken',    detail: 2.4,  hill: 1.2,  mountain: 1.0,  spikes: 0.35 },
  // Rare and deliberately extreme: a forest of spikes and pits. Confined to one cell and eased out.
  { name: 'spires',    detail: 3.2,  hill: 0.9,  mountain: 1.2,  spikes: 1.0 },
];

/** Weighted pick: ordinary land is common, the extreme regions are rare. */
const BIOME_WEIGHTS = [26, 26, 20, 12, 12, 4];
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
const NEUTRAL: Biome = { name: 'neutral', detail: 1, hill: 1, mountain: 1, spikes: 0 };

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
  };
}

/** Which biome dominates here — for debug readouts and, later, per-parcel land type. */
export const biomeNameAt = (x: number, z: number, seed: number) => biomeAt(x, z, seed).name;

// ---------------------------------------------------------------- height

/** 0 on the Fortress plaza, easing to 1 by FLAT_BLEND_M, so the centre parcels stay flat. */
function fortressFlatten(x: number, z: number): number {
  const d = Math.hypot(x, z);
  if (d <= FLAT_RADIUS_M) return 0;
  if (d >= FLAT_BLEND_M) return 1;
  return fade((d - FLAT_RADIUS_M) / (FLAT_BLEND_M - FLAT_RADIUS_M));
}

/**
 * Ground height at a world position. This is the authoritative shape of Starblink.
 */
export function terrainHeight(x: number, z: number, seed: number): number {
  const b = biomeAt(x, z, seed);

  const continent = fbm(x / WL_CONTINENT, z / WL_CONTINENT, seed + 11, 3) * AMP_CONTINENT;

  // Ridged, and squared so low ground stays low: it keeps ranges as ranges instead of raising
  // everything into a general lumpiness.
  const r = ridged(x / WL_MOUNTAIN, z / WL_MOUNTAIN, seed + 23, 5);
  const mountain = r * r * AMP_MOUNTAIN * b.mountain;

  const hill = fbm(x / WL_HILL, z / WL_HILL, seed + 37, 4) * AMP_HILL * b.hill;
  const detail = fbm(x / WL_DETAIL, z / WL_DETAIL, seed + 53, 3) * AMP_DETAIL * b.detail;

  // Spikes and pits. Only the extreme biomes switch this on, and it is signed so the same term
  // makes towers and holes rather than only pushing the ground up.
  let spikes = 0;
  if (b.spikes > 0.001) {
    const s = fbm(x / 34, z / 34, seed + 71, 2);
    spikes = Math.sign(s) * Math.pow(Math.abs(s), 2.2) * 90 * b.spikes;
  }

  const h = continent + mountain + hill + detail + spikes;
  return Math.min(MAX_HEIGHT_M, h) * fortressFlatten(x, z);
}

/** Approximate uphill slope (0 = flat, 1 = vertical) — for cliff shading and scatter rejection. */
export function terrainSlope(x: number, z: number, seed: number, step = 2): number {
  const hx = terrainHeight(x + step, z, seed) - terrainHeight(x - step, z, seed);
  const hz = terrainHeight(x, z + step, seed) - terrainHeight(x, z - step, seed);
  return Math.min(1, Math.hypot(hx, hz) / (2 * step));
}
