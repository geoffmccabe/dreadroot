// ============================================================
// FORTRESS BLOCK SCHEMATIC
// ============================================================
//
// Deterministic conversion of the hardcoded mesh fortress (FortressStructure.tsx)
// into a list of unit-cube block positions. Each entry is the integer min-corner
// of a 1x1x1 voxel — i.e. the block occupies [p, p+1] on every axis, exactly the
// convention used by createBlockColliders() and placed_blocks rows.
//
// The volumes here are derived 1:1 from the mesh boxes in FortressStructure.tsx so
// every wall surface lands on the SAME world coordinate it does today. That keeps
// the waterfall + interior image placements aligned after the swap to real blocks.
//
// Source of truth for dimensions: FORTRESS_DIMENSIONS (FortressCollision.ts).
// This module is PURE — no Three.js, no DB. It only computes positions.

import { FORTRESS_DIMENSIONS } from './FortressCollision';

export interface FortressVoxel {
  x: number;
  y: number;
  z: number;
}

// Block type + texture used for every fortress block. The cliff texture is applied
// per-block (tiled look) so each cube samples the same stone the mesh walls use.
export const FORTRESS_BLOCK_TYPE = 'fortress_block';
export const FORTRESS_BLOCK_TEXTURE = '/cliff_texture_seamless.webp';

// Battlement (merlon) layout on top of the walls: 2-wide stone teeth every 4 units
// (2 on, 2 off), 2 blocks tall, flush at each corner. Grid-snapped so they sit on
// integer voxels (the mesh used fractional centers; cosmetic teeth only).
const MERLON_LEN = 2;
const MERLON_PERIOD = 4; // 2 merlon + 2 gap
const MERLON_HEIGHT = 2;

/** Inclusive integer range [a, b]. */
function range(a: number, b: number): number[] {
  const out: number[] = [];
  for (let v = a; v <= b; v++) out.push(v);
  return out;
}

/**
 * Start coordinates of each 2-long merlon along an edge spanning block-min coords
 * [lo, hi] inclusive. Always places a merlon flush at lo and at hi.
 */
function merlonStarts(lo: number, hi: number): number[] {
  const starts: number[] = [];
  for (let s = lo; s <= hi - MERLON_LEN + 1; s += MERLON_PERIOD) starts.push(s);
  const lastStart = hi - MERLON_LEN + 1;
  if (starts.length === 0) starts.push(lo);
  if (starts[starts.length - 1] !== lastStart) starts.push(lastStart);
  return starts;
}

/**
 * Generate the full fortress as unit-block min-corner positions. Deduplicated
 * (wall corners overlap) via a position-key Set. Returns walls + battlements;
 * the grass courtyard floor is intentionally excluded (stays as world ground).
 */
export function generateFortressVoxels(): FortressVoxel[] {
  const { cliffW, cliffH, frontT, courtyardDepth, frontZ, openingHalfW } = FORTRESS_DIMENSIONS;
  const openingH = 5;

  // Wall block extents (min-corner coords), derived from the mesh boxes:
  const halfW = cliffW / 2;                 // 20
  const backZmin = frontZ - courtyardDepth - frontT; // -40 (back wall outer block plane base)

  // X spans of the front pillars (gate opening is x in [-openingHalfW, openingHalfW]).
  const leftPillarX = range(-halfW, -openingHalfW - 1);      // -20 .. -3
  const rightPillarX = range(openingHalfW, halfW - 1);       // 2 .. 19
  const gateTopX = range(-openingHalfW, openingHalfW - 1);   // -2 .. 1

  const frontZcols = [frontZ - 1, frontZ];                   // -9, -8  (front wall 2 thick)
  const sideZ = range(backZmin, frontZ - 1);                 // -40 .. -9 (side walls run front->back)
  const leftWallX = [-halfW, -halfW + 1];                    // -20, -19
  const rightWallX = [halfW - 2, halfW - 1];                 // 18, 19
  const backZcols = [backZmin - 1, backZmin];                // -41, -40
  const backX = range(-halfW, halfW - 1);                    // -20 .. 19
  const wallY = range(0, cliffH - 1);                        // 0 .. 19

  const seen = new Set<number>();
  const out: FortressVoxel[] = [];
  // Position key packs x,y,z into one number (offsets keep them non-negative).
  const KEY = (x: number, y: number, z: number) => ((x + 256) * 1024 + (y + 256)) * 1024 + (z + 256);
  const push = (x: number, y: number, z: number) => {
    const k = KEY(x, y, z);
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ x, y, z });
  };

  // --- WALLS (y 0..19) ---
  for (const y of wallY) {
    // Front-left + front-right pillars
    for (const z of frontZcols) {
      for (const x of leftPillarX) push(x, y, z);
      for (const x of rightPillarX) push(x, y, z);
    }
    // Front gate lintel (only above the opening, y >= openingH)
    if (y >= openingH) {
      for (const z of frontZcols) for (const x of gateTopX) push(x, y, z);
    }
    // Side walls
    for (const z of sideZ) {
      for (const x of leftWallX) push(x, y, z);
      for (const x of rightWallX) push(x, y, z);
    }
    // Back wall
    for (const z of backZcols) for (const x of backX) push(x, y, z);
  }

  // --- BATTLEMENTS (merlons), y = cliffH .. cliffH+1 ---
  const top = cliffH;
  const merlonY = range(top, top + MERLON_HEIGHT - 1);
  // Front + back edges run along X over their wall's 2 z-columns.
  for (const sx of merlonStarts(-halfW, halfW - 1)) {
    for (const y of merlonY)
      for (let dx = 0; dx < MERLON_LEN; dx++) {
        for (const z of frontZcols) push(sx + dx, y, z);
        for (const z of backZcols) push(sx + dx, y, z);
      }
  }
  // Left + right edges run along Z over their wall's 2 x-columns.
  for (const sz of merlonStarts(backZmin, frontZ - 1)) {
    for (const y of merlonY)
      for (let dz = 0; dz < MERLON_LEN; dz++) {
        for (const x of leftWallX) push(x, y, sz + dz);
        for (const x of rightWallX) push(x, y, sz + dz);
      }
  }

  return out;
}

/** Bounding box + count summary — handy for verification / sanity logging. */
export function fortressSchematicSummary() {
  const v = generateFortressVoxels();
  const b = {
    minX: Infinity, maxX: -Infinity,
    minY: Infinity, maxY: -Infinity,
    minZ: Infinity, maxZ: -Infinity,
  };
  for (const p of v) {
    if (p.x < b.minX) b.minX = p.x; if (p.x > b.maxX) b.maxX = p.x;
    if (p.y < b.minY) b.minY = p.y; if (p.y > b.maxY) b.maxY = p.y;
    if (p.z < b.minZ) b.minZ = p.z; if (p.z > b.maxZ) b.maxZ = p.z;
  }
  return { count: v.length, bounds: b };
}
