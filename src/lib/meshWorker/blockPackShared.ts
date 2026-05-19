// #2 Phase 2a — worker-SAFE shared module. NO imports of @/hooks/useTextureAtlas
// (or anything DOM/THREE/atlas), so BOTH the main thread and the mesh worker
// import the SAME resolveBlockDraw — parity is identical code, not a
// reimplementation. `packChunkBlocks` (atlas-using, main-thread only) lives
// in ./blockPack and produces these structures via the canonical atlas fns.

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
  /** block_type starts with "shr" (shrine — tracked for proximity glow). */
  isShrine: boolean;
}

export interface PackedChunk {
  /** n*3 ints: block min-corner (cube center = +0.5). */
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
 * Reference resolver = EXACTLY what InstancedAtlasBlockGroup.doRebuildSync
 * computes per block (cube center, atlas uv, branch-depth/glow-bark color).
 * The worker calls THIS function, so worker output cannot diverge in
 * pixels from the sync path by construction. (Shrine base color follows
 * the branch-depth rule; the shrine *glow* is a separate per-frame path
 * that uses the isShrine flag + the shrine index list, not this color.)
 */
export function resolveBlockDraw(
  pk: PackedChunk,
  i: number,
): {
  cx: number; cy: number; cz: number;
  uvX: number; uvY: number;
  r: number; g: number; b: number;
} {
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
