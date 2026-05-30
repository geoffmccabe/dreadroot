// Pure chunk-binary helpers — encode-side functions extracted from
// useChunkLoader.ts so the L2 Durable Object can import them from
// plain Node (no React, no THREE, no Supabase, no browser APIs).
//
// What lives here:
//   • ChunkSignature type + computation (incremental world-signature)
//   • Deterministic block sort
//   • Surface-only culling (Minecraft-style interior-block removal)
//
// What does NOT live here:
//   • Fetching blocks from Supabase   → chunkFetch.ts (Phase C step 2)
//   • IndexedDB cache layer            → chunkCache.ts (Phase C step 3)
//   • Collider lifecycle, React refs   → stays in useChunkLoader.ts
//
// L2 DO contract: these functions are pure (no side effects, no hidden
// globals except a single Uint8Array scratch buffer for surface culling).
// Same input → same output every time. Safe to mirror server-side.

import { PlacedBlock } from '@/types/blocks';
import { CHUNK_SIZE } from '@/lib/chunkManager';
import { isTreeBlockType } from '@/features/trees/lib/blockTypeEncoder';

// ── Types ───────────────────────────────────────────────────────────

/** Numeric chunk fingerprint. Compared with signaturesEqual() to detect
 *  changes without re-rendering. Sized to survive a quadrillion blocks
 *  before the sum overflows uint32 wraparound becomes ambiguous. */
export interface ChunkSignature {
  count: number;
  xor: number;
  sum: number;
}

export const EMPTY_CHUNK_SIG: ChunkSignature = { count: 0, xor: 0, sum: 0 };

// ── Hashing primitives ──────────────────────────────────────────────

/** Fast integer mixing function. No allocations, no string conversion. */
export const mix32 = (n: number): number => {
  n |= 0;
  n = Math.imul(n ^ (n >>> 16), 0x7feb352d);
  n = Math.imul(n ^ (n >>> 15), 0x846ca68b);
  return (n ^ (n >>> 16)) >>> 0;
};

/** Numeric hash for a single block — FNV-1a style with position, block
 *  type, and branch_depth. No string allocations. */
export const blockSig32 = (b: PlacedBlock): number => {
  let h = 2166136261 >>> 0; // FNV offset basis
  h = Math.imul(h ^ mix32(b.position_x | 0), 16777619) >>> 0;
  h = Math.imul(h ^ mix32(b.position_y | 0), 16777619) >>> 0;
  h = Math.imul(h ^ mix32(b.position_z | 0), 16777619) >>> 0;
  // Hash block_type string by summing char codes (fast, no allocation).
  const bt = b.block_type || '';
  let btHash = 0;
  for (let i = 0; i < bt.length; i++) {
    btHash = (btHash * 31 + bt.charCodeAt(i)) | 0;
  }
  h = Math.imul(h ^ mix32(btHash), 16777619) >>> 0;
  h = Math.imul(h ^ mix32((b as any).branch_depth | 0), 16777619) >>> 0;
  return h >>> 0;
};

/** Compute the chunk's numeric signature. O(n) over blocks, no
 *  string allocations. */
export function computeChunkSignature(blocks: PlacedBlock[]): ChunkSignature {
  let xor = 0 >>> 0;
  let sum = 0 >>> 0;
  for (let i = 0; i < blocks.length; i++) {
    const v = blockSig32(blocks[i]);
    xor = (xor ^ v) >>> 0;
    sum = (sum + v) >>> 0;
  }
  return { count: blocks.length, xor, sum };
}

export const signaturesEqual = (a: ChunkSignature, b: ChunkSignature): boolean => {
  return a.count === b.count && a.xor === b.xor && a.sum === b.sum;
};

// ── Deterministic ordering ──────────────────────────────────────────

/** In-place sort by (y, x, z). Stabilizes sampling-based cache keys so
 *  blocks arriving in different order from server vs cache don't churn
 *  downstream signatures. */
export const sortBlocksDeterministic = (blocks: PlacedBlock[]): void => {
  blocks.sort((a, b) =>
    (a.position_y - b.position_y) ||
    (a.position_x - b.position_x) ||
    (a.position_z - b.position_z)
  );
};

// ── Surface culling ─────────────────────────────────────────────────
//
// Removes fully-surrounded interior blocks from a chunk so rendering
// only draws blocks with at least one exposed face. Same idea as
// Minecraft's mesher: faces, not cubes.
//
// Buffer state below is module-local but reused across calls — saves
// hundreds of KB of GC per chunk on large tree chunks.

// Pre-allocate for 300-block-tall chunks (300 × 256 = 76800 bytes) so
// the first call doesn't pay an allocation stall. Grows on demand for
// taller chunks.
const INITIAL_OCC_BUF_SIZE = 300 * 256;
let _occBuf: Uint8Array = new Uint8Array(INITIAL_OCC_BUF_SIZE);
let _occBufSize = INITIAL_OCC_BUF_SIZE;

/** Surface-only culling. Returns a NEW array of blocks with at least
 *  one exposed face. Chunk edges and non-tree (user-placed) blocks are
 *  always kept. */
export function computeSurfaceVisibleBlocks(
  chunkX: number,
  chunkZ: number,
  blocks: PlacedBlock[],
): PlacedBlock[] {
  if (blocks.length < 50) return blocks; // Not worth culling tiny sets

  const originX = chunkX * CHUNK_SIZE;
  const originZ = chunkZ * CHUNK_SIZE;

  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < blocks.length; i++) {
    const y = blocks[i].position_y;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  const ySpan = (maxY - minY + 1);
  if (ySpan <= 0 || ySpan > 2048) return blocks; // Safety fallback

  const stride = 256; // 16 * 16 per Y layer
  const needed = ySpan * stride;
  if (_occBufSize < needed) {
    _occBuf = new Uint8Array(needed);
    _occBufSize = needed;
  }
  const occ = _occBuf;
  occ.fill(0, 0, needed);

  // Fill occupancy grid
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const lx = b.position_x - originX;
    const lz = b.position_z - originZ;
    const ly = b.position_y - minY;
    if (lx < 0 || lx >= 16 || lz < 0 || lz >= 16) continue;
    occ[(ly * stride) + (lz * 16) + lx] = 1;
  }

  // Filter: keep blocks with at least one exposed face.
  // Non-tree (user-placed) blocks are always kept visible.
  const visible: PlacedBlock[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];

    if (!isTreeBlockType(b.block_type)) {
      visible.push(b);
      continue;
    }

    const lx = b.position_x - originX;
    const lz = b.position_z - originZ;
    const ly = b.position_y - minY;

    if (lx < 0 || lx >= 16 || lz < 0 || lz >= 16) {
      visible.push(b);
      continue;
    }

    const base = (ly * stride) + (lz * 16) + lx;
    const exposed =
      (lx === 0) || (lx === 15) || (lz === 0) || (lz === 15) ||
      (ly === 0) || (ly === ySpan - 1) ||
      (occ[base - 1] === 0) || (occ[base + 1] === 0) ||       // ±X
      (occ[base - 16] === 0) || (occ[base + 16] === 0) ||     // ±Z
      (occ[base - stride] === 0) || (occ[base + stride] === 0); // ±Y

    if (exposed) visible.push(b);
  }

  // Safety net: tree branches always have exposed faces, so this
  // shouldn't fire — but if it does, return the original blocks rather
  // than an empty chunk.
  if (visible.length === 0 && blocks.length > 0) {
    console.warn(`[SurfaceCulling] All ${blocks.length} tree blocks culled for chunk (${chunkX},${chunkZ}) - returning original to prevent invisible chunk`);
    return blocks;
  }

  // Stabilize cheapGroupKey sampling in PlacedBlocks.tsx by sorting
  // deterministically — without this, culling order shifts and
  // downstream signature caches false-miss.
  sortBlocksDeterministic(visible);

  return visible;
}
