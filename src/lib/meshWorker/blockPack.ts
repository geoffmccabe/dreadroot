// #2 Phase 2a — Step 1 (isolated, NOT wired into rendering yet).
//
// Packs a chunk's blocks into transferable typed arrays so the mesh build
// can be moved to a worker WITHOUT the structured-clone GC cost that got
// the worker abandoned. Parity with the main-thread sync rebuild
// (InstancedAtlasBlockGroup.doRebuildSync) is guaranteed BY CONSTRUCTION:
// per distinct block_type we precompute uv/anim here using the SAME
// canonical functions the sync path uses, and the worker only does
// arithmetic + table lookups (it never re-derives atlas logic). The
// `resolveBlockDraw` reference below is exactly what the worker will
// reproduce in Step 2, and is the self-audit contract for Step 1.

import type { PlacedBlock } from '@/types/blocks';
import {
  getInstanceUVsForTreeBlock,
  getTreeBlockAnimationInfo,
  getAnimatedUVOffset,
} from '@/hooks/useTextureAtlas';

/** Int8 sentinel meaning "block has no branch_depth" (undefined/null). */
export const BRANCH_DEPTH_NONE = 127;

export interface DrawTableEntry {
  uvOffsetX: number;
  uvOffsetY: number;
  /** 1 when static; >1 identifies an animated texture. */
  animFrameCount: number;
  animFrameDelayMs: number;
  /** -1 when static. */
  animBaseSlotIndex: number;
  /** block_type starts with "gb" (glow-bark fixed bright color). */
  isGlowBark: boolean;
}

export interface PackedChunk {
  /** n*3 ints: block min-corner (the worker adds +0.5 for the cube center). */
  positions: Int32Array;
  /** n: index into `table`. */
  typeIndex: Uint16Array;
  /** n: branch_depth, or BRANCH_DEPTH_NONE. */
  branchDepth: Int8Array;
  /** Small (~#distinct block types) — cloned, not transferred. */
  table: DrawTableEntry[];
  count: number;
}

/**
 * Pure. Main-thread only (uses the atlas helpers). Produces transferables
 * (positions/typeIndex/branchDepth .buffer) + a tiny per-build draw table.
 */
export function packChunkBlocks(blocks: PlacedBlock[]): PackedChunk {
  const n = blocks.length;
  const positions = new Int32Array(n * 3);
  const typeIndex = new Uint16Array(n);
  const branchDepth = new Int8Array(n);
  const table: DrawTableEntry[] = [];
  const typeToIdx = new Map<string, number>();

  for (let i = 0; i < n; i++) {
    const b = blocks[i];
    positions[i * 3] = b.position_x | 0;
    positions[i * 3 + 1] = b.position_y | 0;
    positions[i * 3 + 2] = b.position_z | 0;

    let idx = typeToIdx.get(b.block_type);
    if (idx === undefined) {
      idx = table.length;
      typeToIdx.set(b.block_type, idx);

      const anim = getTreeBlockAnimationInfo(b.block_type);
      let uvOffsetX: number;
      let uvOffsetY: number;
      let animFrameCount = 1;
      let animFrameDelayMs = 0;
      let animBaseSlotIndex = -1;
      if (anim && anim.frameCount > 1) {
        // Frame 0 — identical to the sync path's animated branch.
        const uv = getAnimatedUVOffset(anim.baseSlotIndex, 0);
        uvOffsetX = uv.uvOffsetX;
        uvOffsetY = uv.uvOffsetY;
        animFrameCount = anim.frameCount;
        animFrameDelayMs = anim.frameDelayMs;
        animBaseSlotIndex = anim.baseSlotIndex;
      } else {
        const uv = getInstanceUVsForTreeBlock(b.block_type);
        uvOffsetX = uv.uvOffsetX;
        uvOffsetY = uv.uvOffsetY;
      }

      const bt = b.block_type;
      const isGlowBark = bt.charCodeAt(0) === 103 && bt.charCodeAt(1) === 98; // 'gb'
      table.push({
        uvOffsetX,
        uvOffsetY,
        animFrameCount,
        animFrameDelayMs,
        animBaseSlotIndex,
        isGlowBark,
      });
    }
    typeIndex[i] = idx;

    const d = b.branch_depth;
    branchDepth[i] =
      d === undefined || d === null
        ? BRANCH_DEPTH_NONE
        : Math.max(-128, Math.min(126, d | 0));
  }

  return { positions, typeIndex, branchDepth, table, count: n };
}

/**
 * Reference resolver = EXACTLY what the sync rebuild computes per block
 * (position center, atlas uv, branch-depth/glow-bark color). The worker
 * in Step 2 must reproduce this byte-for-byte. Kept here so Step 1 is
 * self-auditable in isolation.
 */
export function resolveBlockDraw(
  pk: PackedChunk,
  i: number,
): { cx: number; cy: number; cz: number; uvX: number; uvY: number; r: number; g: number; b: number } {
  const e = pk.table[pk.typeIndex[i]];
  let r = 1;
  let g = 1;
  let bcol = 1;
  if (e.isGlowBark) {
    r = 1.4;
    g = 2.0;
    bcol = 1.5;
  } else {
    const d = pk.branchDepth[i];
    if (d !== BRANCH_DEPTH_NONE) {
      const lf = 1.0 + Math.max(0, d + 1) * 0.12;
      r = lf;
      g = lf;
      bcol = lf;
    }
  }
  return {
    cx: pk.positions[i * 3] + 0.5,
    cy: pk.positions[i * 3 + 1] + 0.5,
    cz: pk.positions[i * 3 + 2] + 0.5,
    uvX: e.uvOffsetX,
    uvY: e.uvOffsetY,
    r,
    g,
    b: bcol,
  };
}
