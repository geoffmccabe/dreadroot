/**
 * UV Lookup Table Serializer
 *
 * Extracts UV offset and animation data from the main thread's atlas caches
 * into plain objects that can be sent to Web Workers via postMessage.
 *
 * Workers can't access the atlas manager or DOM, so they need a snapshot
 * of the UV lookup tables. This is rebuilt when the atlas version changes
 * (~30 entries, negligible cost).
 */

import {
  getInstanceUVsForTreeBlock,
  getTreeBlockAnimationInfo,
} from '@/hooks/useTextureAtlas';
import type { UVEntry, AnimEntry } from './meshWorkerTypes';

// All known tree block type prefixes that need UV lookups
// Workers receive this pre-computed table instead of calling atlas functions
const TREE_BLOCK_PREFIXES = [
  'trunk', 'branch', 'fruit', 'leaf', 'root',
  'fungal_stem', 'fungal_cap_top', 'fungal_cap_underside',
  'glow_bark', 'shrine', 'gb',
  't_', 'b_', 'f_', 'l_', 'r_',
  'fs_', 'fct_', 'fcu_',
];

/**
 * Build UV and animation lookup tables from the current atlas state.
 * Call this after atlas initialization and whenever atlas version changes.
 *
 * @param knownBlockTypes - Set of block_type strings seen in loaded chunks.
 *   Passing this ensures we capture all types the workers will encounter.
 */
export function buildWorkerUVTables(knownBlockTypes?: Set<string>): {
  uvTable: Record<string, UVEntry>;
  animTable: Record<string, AnimEntry>;
} {
  const uvTable: Record<string, UVEntry> = {};
  const animTable: Record<string, AnimEntry> = {};

  const types = knownBlockTypes ?? new Set<string>();

  // Add known tree types for tiers 1-30
  for (let tier = 1; tier <= 30; tier++) {
    for (const prefix of ['t_', 'b_', 'f_', 'l_', 'r_']) {
      // Encoded format: "prefix_depthOffset_tier" e.g. "t_0_5"
      for (let depth = -3; depth <= 10; depth++) {
        types.add(`${prefix}${depth}_${tier}`);
      }
    }
    // Fungal types
    types.add(`fs_0_${tier}`);
    types.add(`fct_0_${tier}`);
    types.add(`fcu_0_${tier}`);
    // Glow bark
    types.add(`gb_0_${tier}`);
    // Shrine
    types.add(`shr_0_${tier}`);
  }

  for (const blockType of types) {
    try {
      const uv = getInstanceUVsForTreeBlock(blockType);
      if (uv) {
        uvTable[blockType] = { uvOffsetX: uv.uvOffsetX, uvOffsetY: uv.uvOffsetY };
      }

      const anim = getTreeBlockAnimationInfo(blockType);
      if (anim && anim.frameCount > 1) {
        animTable[blockType] = {
          frameCount: anim.frameCount,
          frameDelayMs: anim.frameDelayMs,
          baseSlotIndex: anim.baseSlotIndex,
        };
      }
    } catch {
      // Skip invalid block types silently
    }
  }

  return { uvTable, animTable };
}
