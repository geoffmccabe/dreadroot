// #2 Phase 2a — main-thread packer. Uses the canonical atlas helpers to bake
// uv/anim/color into a tiny per-build table + transferable typed arrays, so
// the worker (which imports the SAME resolveBlockDraw from ./blockPackShared)
// produces byte-identical output to InstancedAtlasBlockGroup.doRebuildSync.
// NOT wired into rendering yet (Step 4).

import type { PlacedBlock } from '@/types/blocks';
import {
  getInstanceUVsForTreeBlock,
  getTreeBlockAnimationInfo,
  getAnimatedUVOffset,
} from '@/hooks/useTextureAtlas';
import {
  BRANCH_DEPTH_NONE,
  type DrawTableEntry,
  type PackedChunk,
  resolveBlockDraw,
} from './blockPackShared';

// Re-export so existing/import sites can use one entry point.
export { BRANCH_DEPTH_NONE, resolveBlockDraw };
export type { DrawTableEntry, PackedChunk };

/**
 * Pure. Main-thread only (uses the atlas helpers). Produces transferables
 * (positions/typeIndex/branchDepth .buffer) + a tiny per-build draw table
 * computed with the SAME canonical fns the sync rebuild uses.
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
      const isShrine =
        bt.charCodeAt(0) === 115 && bt.charCodeAt(1) === 104 && bt.charCodeAt(2) === 114; // 'shr'
      table.push({
        uvOffsetX,
        uvOffsetY,
        animFrameCount,
        animFrameDelayMs,
        animBaseSlotIndex,
        isGlowBark,
        isShrine,
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
