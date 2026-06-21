// Pure image -> fortress voxel algorithm (no DOM, no THREE). Treats the image as a
// FRONT ELEVATION: each column's silhouette top sets the wall height (peaks/towers),
// brightness -> N grey tiers (1 lightest .. N darkest). Walls are wrapped around a
// square and the interior is hollowed to thickness T.
//
// Symmetry:
//  - faceSym 'lr': each wall is generated from half its columns, mirrored (flip swaps
//    which half is the source). 'none' = no mirroring.
//  - wallSym '4way' (all walls identical) / '2way' (opposing walls share a profile,
//    perpendicular pair differs) / 'none' (all four independent). Distinct walls use
//    derived seeds so they vary even from a single image.
// Entry: a tunnel carved through one wall at the bottom (width x height, liftable).

import { addWallWalk } from './wallWalk';

export interface GrayGrid {
  gray: number[][];      // brightness 0..1, [row][col]; row 0 = TOP
  present: boolean[][];  // structure mask, [row][col]
  W: number;
  H: number;
}

export type FaceSym = 'lr' | 'none';
export type WallSym = '4way' | '2way' | 'none';

export interface FortressEntry {
  w: number;     // opening width (blocks)
  h: number;     // opening height (blocks)
  wall: number;  // 0 front, 1 right, 2 back, 3 left
  vert: number;  // lift off the ground (blocks)
}

export interface FortressBuildOpts {
  D: number;
  T: number;
  heightScale?: number;
  greyLevels?: number;
  seed?: number;
  faceSym?: FaceSym;
  faceFlip?: boolean;
  wallSym?: WallSym;
  chunk?: number; // block size (1=fine detail .. 5=chunky/blocky rectangles)
  entry?: FortressEntry | null;
  stairs?: boolean; // step blocks up to the entry (outside + mirrored inside) when vert >= 2
  // Per-tier extrude (index 0..4 = grey tier 1..5). Outer/inner face each:
  //  + protrudes that face outward/inward (max +2); - recesses into the wall (down to
  //  -T, i.e. all the way through -> windows/holes).
  extrudeOut?: number[];
  extrudeIn?: number[];
}

export interface FortressVoxel { x: number; y: number; z: number; tier: number; light?: number; } // light: 0 none, 1 extrude (protruding), 2 inset (recess surface)
export interface FortressBuildResult {
  voxels: FortressVoxel[];
  F: number;
  maxHeight: number;
  tierCounts: number[];
}

function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const tierFor = (b: number, levels: number): number =>
  Math.min(levels, Math.max(1, Math.round((1 - b) * (levels - 1)) + 1));

interface Profile { topH: number[]; greyCol: number[]; } // per column 0..F-1

// One wall's silhouette: topmost present pixel per column -> block height (+ optional
// seeded jitter), and which image column to sample grey from.
function baseProfile(grid: GrayGrid, F: number, heightScale: number, seed: number, chunk: number): Profile {
  const { present, H, W } = grid;
  const colAt = (gx: number) => (W === F ? gx : Math.min(W - 1, Math.floor((gx / F) * W)));
  const rnd = seed ? mulberry32(seed) : null;
  const maxBlockH = Math.round(H * heightScale);

  // Multi-octave seeded variation: a broad swell + a finer wave reshape the WHOLE
  // skyline per rebuild (not just ±a couple blocks at the very top), plus a little
  // per-column noise. Precompute the wave params so the variation is smooth.
  let a1 = 0, f1 = 1, p1 = 0, a2 = 0, f2 = 1, p2 = 0;
  if (rnd) {
    a1 = (0.12 + rnd() * 0.20) * maxBlockH;
    f1 = 1 + Math.floor(rnd() * 3);
    p1 = rnd() * Math.PI * 2;
    a2 = (0.05 + rnd() * 0.10) * maxBlockH;
    f2 = 4 + Math.floor(rnd() * 5);
    p2 = rnd() * Math.PI * 2;
  }

  // Bridge small interior gaps (windows/openings) up to ~6% of height; a larger gap
  // means we've left the building and entered the sky.
  const GAP = Math.max(2, Math.round(H * 0.06));
  const topH = new Array<number>(F).fill(0);
  const greyCol = new Array<number>(F).fill(0);
  for (let gx = 0; gx < F; gx++) {
    const c = colAt(gx);
    greyCol[gx] = c;
    // Silhouette top = top of the structure CONNECTED up from the ground. Scanning
    // from the bottom (instead of grabbing the highest present pixel anywhere) means
    // mis-thresholded sky/cloud pixels above a real gap are ignored — never built.
    let topRow = -1, gap = 0;
    for (let r = H - 1; r >= 0; r--) {
      if (present[r][c]) { topRow = r; gap = 0; }
      else if (topRow !== -1 && ++gap > GAP) break;
    }
    if (topRow === -1) continue; // empty column (all sky)
    let h = Math.round((H - topRow) * heightScale);
    if (rnd) {
      const u = F > 1 ? gx / (F - 1) : 0;
      h += Math.round(a1 * Math.sin(u * f1 * Math.PI + p1) + a2 * Math.sin(u * f2 * Math.PI + p2) + (rnd() - 0.5) * 4);
    }
    topH[gx] = Math.max(0, Math.min(maxBlockH, h));
  }

  // Chunkiness: collapse every `chunk`-wide group of columns to ONE height (the group's
  // max, so towers/merlons stay solid) and ONE grey column (the group centre). This
  // turns fine 1-block detail into blocky N-wide rectangles — the brutalist look.
  if (chunk > 1) {
    for (let c0 = 0; c0 < F; c0 += chunk) {
      const end = Math.min(F, c0 + chunk);
      let hMax = 0;
      for (let c = c0; c < end; c++) if (topH[c] > hMax) hMax = topH[c];
      const gc = greyCol[Math.min(F - 1, c0 + (chunk >> 1))];
      for (let c = c0; c < end; c++) { topH[c] = hMax; greyCol[c] = gc; }
    }
  }

  return { topH, greyCol };
}

function applyFaceSym(p: Profile, F: number, faceSym: FaceSym, flip: boolean): Profile {
  if (faceSym !== 'lr') return p;
  const topH = new Array<number>(F), greyCol = new Array<number>(F);
  const maxM = Math.floor((F - 1) / 2);
  for (let c = 0; c < F; c++) {
    // m: 0 at the two outer corners, maxM at the centre seam.
    const m = Math.min(c, F - 1 - c);
    // flip swaps centre<->corner so a centre peak moves OUT to the corners (and the
    // corners become the centre) — a genuinely different symmetric face.
    const src = flip ? (maxM - m) : m;
    topH[c] = p.topH[src];
    greyCol[c] = p.greyCol[src];
  }
  return { topH, greyCol };
}

// Distinct, deterministic seed per wall-group so independent walls actually differ
// (even when the user seed is 0/faithful).
const groupSeed = (seed: number, group: number): number =>
  group === 0 ? seed : (((seed || 12345) * 2654435761 + group * 40503) >>> 0) || (group * 40503);

export function buildFortressVoxels(grid: GrayGrid, opts: FortressBuildOpts): FortressBuildResult {
  const { D, T } = opts;
  const heightScale = opts.heightScale ?? 1;
  const levels = opts.greyLevels ?? 5;
  const seed = opts.seed ?? 0;
  const faceSym = opts.faceSym ?? 'none';
  const flip = opts.faceFlip ?? false;
  const wallSym = opts.wallSym ?? '4way';
  const entry = opts.entry ?? null;
  const chunk = Math.max(1, Math.round(opts.chunk ?? 1)); // block size for the chunky/blocky look
  const F = Math.max(1, Math.round(0.6 * D));
  const { gray, present, H } = grid;

  // Normalize the FACADE to the structure's actual tonal range so the full grey set
  // is used (darkest stone -> tier N, lightest -> tier 1). Concrete photos cluster in
  // the mid-greys, which is why only the middle tiers showed up before. Measured over
  // structure pixels only (ignoring sky).
  let bMin = 1, bMax = 0;
  for (let r = 0; r < H; r++) for (let c = 0; c < grid.W; c++) {
    if (!present[r][c]) continue;
    const b = gray[r][c];
    if (b < bMin) bMin = b;
    if (b > bMax) bMax = b;
  }
  const span = bMax - bMin;
  const norm = (b: number) => (span < 0.05 ? b : (b - bMin) / span);

  const mk = (group: number) => applyFaceSym(baseProfile(grid, F, heightScale, groupSeed(seed, group), chunk), F, faceSym, flip);
  // wallProfiles indexed by wall: 0 front, 1 right, 2 back, 3 left
  let wallProfiles: Profile[];
  if (wallSym === '4way') { const p = mk(0); wallProfiles = [p, p, p, p]; }
  else if (wallSym === '2way') { const a = mk(0), b = mk(1); wallProfiles = [a, b, a, b]; }
  else { wallProfiles = [mk(0), mk(1), mk(2), mk(3)]; }

  // Entry width must share the fortress parity so the opening (and stairs) are
  // perfectly centered/symmetric: even fortress -> even entry, odd -> odd.
  const entryW = entry ? Math.max(1, ((F - entry.w) % 2 === 0) ? entry.w : entry.w - 1) : 0;
  const entryLo = entry ? Math.floor((F - entryW) / 2) : 0;
  const entryHi = entry ? entryLo + entryW - 1 : -1;
  const inEntryColumns = (col: number) => entry !== null && col >= entryLo && col <= entryHi;

  const tierCounts = new Array<number>(levels + 1).fill(0);
  const half = Math.floor(F / 2);
  let maxHeight = 0;

  const exOutArr = opts.extrudeOut ?? [];
  const exInArr = opts.extrudeIn ?? [];
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

  // Dedup voxels (wall corners + stairs overlap). Local coords may be negative or
  // reach beyond the footprint (extrude protrusions, stairs), so offset before packing.
  const OFF = 1500, MUL = 4096;
  const occupied = new Map<number, number>(); // key -> tier
  const keyOf = (lx: number, y: number, lz: number) => ((lx + OFF) * MUL + (y + OFF)) * MUL + (lz + OFF);
  const place = (lx: number, y: number, lz: number, tier: number, light = 0) => {
    const k = keyOf(lx, y, lz);
    if (!occupied.has(k)) occupied.set(k, tier | (light << 4)); // pack tier (low) + light (high)
  };
  const removeAt = (lx: number, y: number, lz: number) => { occupied.delete(keyOf(lx, y, lz)); };
  // (w, column, depth) -> footprint (gx, gz). depth 0 = outer face, T-1 = inner face.
  const coordFor = (w: number, col: number, d: number): [number, number] => {
    if (w === 0) return [col, d];            // front: outer at gz 0, inward +z
    if (w === 2) return [col, F - 1 - d];    // back:  outer at gz F-1
    if (w === 3) return [d, col];            // left:  outer at gx 0
    return [F - 1 - d, col];                 // right: outer at gx F-1
  };

  // Build each wall column-by-column with explicit thickness, applying per-tier
  // extrude on the outer face (depth < 0 protrudes out) and inner face (depth > T-1).
  for (let w = 0; w < 4; w++) {
    const prof = wallProfiles[w];
    for (let col = 0; col < F; col++) {
      const h = prof.topH[col];
      if (h <= 0) continue;
      if (h > maxHeight) maxHeight = h;
      const greyCol = prof.greyCol[col];
      let carveLo = -1, carveHi = -1;
      if (entry && entry.wall === w && inEntryColumns(col)) {
        carveLo = entry.vert; carveHi = entry.vert + entry.h - 1;
      }
      for (let y = 0; y < h; y++) {
        if (y >= carveLo && y <= carveHi) continue; // entry tunnel (through full thickness)
        const r = Math.min(H - 1, Math.max(0, H - 1 - Math.floor(y / Math.max(heightScale, 1e-6))));
        // Snap the sampled row to the chunk grid too, so the facade reads as N×N
        // rectangles (greyCol is already chunked horizontally in baseProfile).
        const rC = chunk > 1 ? Math.min(H - 1, Math.floor(r / chunk) * chunk + (chunk >> 1)) : r;
        const tier = tierFor(norm(gray[rC][greyCol]), levels);
        const exOut = clamp(exOutArr[tier - 1] ?? 0, -T, 2);
        const exIn = clamp(exInArr[tier - 1] ?? 0, -T, 2);
        const dStart = -exOut;        // outer extent (negative = protrude; positive = recess)
        const dEnd = (T - 1) + exIn;  // inner extent (> T-1 = protrude inward; less = recess)
        for (let d = dStart; d <= dEnd; d++) {
          // Light tag: protruding cells (extrude relief) = 1; recessed face cells (inset) = 2.
          let light = 0;
          if (d < 0) light = 1;
          else if (exOut < 0 && d === dStart) light = 2;
          else if (exIn < 0 && d === dEnd) light = 2;
          const [gx, gz] = coordFor(w, col, d);
          place(gx - half, y, gz - half, tier, light);
        }
      }
    }
  }

  // --- Stairs up to the entry (outside) + mirrored inside, when lifted >= 2 blocks ---
  if (opts.stairs && entry && entry.vert >= 2 && entryW > 0) {
    const V = entry.vert;
    const stairTier = Math.min(3, levels);
    const placeCol = (gx: number, gz: number, height: number) => {
      for (let y = 0; y < height; y++) place(gx - half, y, gz - half, stairTier);
    };
    const horizontal = entry.wall === 0 || entry.wall === 2;
    const outerPerp = (entry.wall === 0 || entry.wall === 3) ? 0 : F - 1;
    const outDir = (entry.wall === 0 || entry.wall === 3) ? -1 : 1;
    const innerPerp = (entry.wall === 0 || entry.wall === 3) ? T : F - 1 - T;
    for (let d = 1; d <= V - 1; d++) {
      const height = V - d;
      const outPerp = outerPerp + outDir * d;
      const inPerp = innerPerp - outDir * (d - 1);
      for (let a = entryLo; a <= entryHi; a++) {
        if (horizontal) { placeCol(a, outPerp, height); placeCol(a, inPerp, height); }
        else { placeCol(outPerp, a, height); placeCol(inPerp, a, height); }
      }
    }
  }

  // --- Wall-walk + stairs around the top edge (only when the wall is >= 3 thick). ---
  if (T >= 3) {
    const innerProt = Math.max(0, ...exInArr.map((v) => clamp(v, -T, 2)));
    addWallWalk({
      F, T, half, levels,
      topH: wallProfiles.map((p) => p.topH),
      innerProt,
      coordFor,
      place,
      removeAt,
    });
  }

  // Materialize dedup'd voxels.
  const voxels: FortressVoxel[] = [];
  for (const [k, packed] of occupied) {
    const tier = packed & 15;
    const light = packed >> 4;
    const lz = (k % MUL) - OFF;
    const k2 = Math.floor(k / MUL);
    const y = (k2 % MUL) - OFF;
    const lx = Math.floor(k2 / MUL) - OFF;
    voxels.push({ x: lx, y, z: lz, tier, light });
    tierCounts[tier]++;
  }

  return { voxels, F, maxHeight, tierCounts };
}
