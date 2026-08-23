/**
 * Renders every NON-TREE block in one set of batches, world-wide, instead of
 * per chunk.
 *
 * WHY. Draw-call count is the strongest measured predictor of frame rate in
 * this game: correlation with FPS was -0.814 and -0.851 across two sessions,
 * while correlation with VIEW DISTANCE was +0.055 and -0.130 — i.e. none. At
 * the same number of visible chunks, under 110 draw calls gave 47-53 fps and
 * over 250 gave 18-24 fps.
 *
 * Where they came from: rendering is per chunk, and each chunk produced one
 * atlas batch for its tree blocks plus ONE BATCH PER non-tree block type and
 * texture variant it happened to contain — measured at ~3 per chunk (max 14).
 * With ~84 visible chunks that is ~250 batches for the non-tree blocks alone,
 * which matches the observed spikes to 300-428.
 *
 * The thing that makes this worth doing: non-tree blocks are only
 * 0.7% OF THE WORLD — 6,746 blocks against 967,849 tree blocks in a sampled
 * 320x320 area — spread over just 57 distinct type/texture combinations. So
 * they cost three quarters of the draw calls to draw almost none of the
 * geometry.
 *
 * Batching them globally collapses "chunks x types" into "types". The cost is
 * that they lose per-chunk frustum culling: a batch is now drawn if any part
 * of it is on screen. For 0.7% of the blocks — a few thousand cubes, tens of
 * thousands of triangles — that is a trade worth making, and the world is
 * confirmed GEOMETRY bound only because of the other 99.3%.
 *
 * Tree blocks deliberately stay per chunk. They share one atlas material so
 * they are already a single batch per chunk, and batching a million of them
 * globally would destroy the frustum culling that keeps the triangle count
 * down.
 */
import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { PlacedBlock } from '@/types/blocks';
import type { BlockType } from '@/types/blocks';
import { InstancedBlockGroup } from './InstancedBlockGroup';
import { isInvisiblock, isTreeBlockType } from '@/features/trees/lib/blockTypeEncoder';
import { getMaterialVariantId, canonicalizeTextureUrl } from '@/lib/renderKeys';

/** Matches PlacedBlocks: beyond this many variants a type shares one batch. */
const MAX_TEXTURE_VARIANTS_PER_TYPE = 8;

export interface GlobalNonTreeBlocksProps {
  /** Per-chunk block arrays for everything currently visible. */
  entries: Array<{ key: string; blocks: PlacedBlock[] }>;
  geometry: THREE.BoxGeometry;
  blocksMap: Map<string, BlockType>;
  defaultBlockDef: BlockType;
  treeFallbackDef: BlockType;
  showOwnershipOutline?: boolean;
  currentUserId?: string;
  hoveredBlockId?: string | null;
  performanceMode?: boolean;
}

export const GlobalNonTreeBlocks: React.FC<GlobalNonTreeBlocksProps> = ({
  entries,
  geometry,
  blocksMap,
  defaultBlockDef,
  treeFallbackDef,
  showOwnershipOutline,
  currentUserId,
  hoveredBlockId,
  performanceMode,
}) => {
  // Per-chunk cache of "which of this chunk's blocks are non-tree".
  //
  // WHY THIS EXISTS. `entries` gets a new identity every time ANY chunk loads
  // or unloads, and that happens constantly while moving — 75 unloads in a
  // 14-second recording. Without this cache, one chunk changing re-walked
  // EVERY block in EVERY visible chunk (~100k of them) just to re-find the
  // ~1% that are not trees. That is roughly 7.5 million block reads over those
  // 14 seconds, and it showed up exactly where you would expect: 371MB of
  // garbage collected in 14 seconds and constant stutter.
  //
  // A chunk's block array is replaced wholesale when it changes, so reference
  // equality is a sound and free way to know the cached answer still holds.
  const chunkCache = useRef(new Map<string, { src: PlacedBlock[]; nonTree: PlacedBlock[] }>());
  const lastGroups = useRef<Map<string, { blocks: PlacedBlock[]; textureOverride?: string }> | null>(null);

  const groups = useMemo(() => {
    const cache = chunkCache.current;
    const live = new Set<string>();
    // True only if nothing that affects NON-TREE blocks changed. Tree-only
    // churn (the overwhelmingly common case) must not rebuild these batches,
    // because handing InstancedBlockGroup a new array makes it rewrite every
    // instance matrix it owns.
    let unchanged = lastGroups.current !== null;

    for (let e = 0; e < entries.length; e++) {
      const { key, blocks: arr } = entries[e];
      live.add(key);
      const hit = cache.get(key);
      if (hit !== undefined && hit.src === arr) continue;

      const nonTree: PlacedBlock[] = [];
      for (let i = 0; i < arr.length; i++) {
        const b = arr[i];
        // A block with a missing type cannot be rendered, and reading a
        // character off it would take down the whole render.
        if (typeof b.block_type !== 'string') continue;
        if (isInvisiblock(b.block_type)) continue;
        if (isTreeBlockType(b.block_type)) continue;
        nonTree.push(b);
      }
      cache.set(key, { src: arr, nonTree });
      // Re-grouping is only needed if this chunk actually contributes, or used
      // to contribute, a non-tree block.
      if (nonTree.length > 0 || (hit !== undefined && hit.nonTree.length > 0)) unchanged = false;
    }

    // Drop chunks that are no longer visible, so the cache cannot grow forever.
    for (const key of cache.keys()) {
      if (live.has(key)) continue;
      if ((cache.get(key)?.nonTree.length ?? 0) > 0) unchanged = false;
      cache.delete(key);
    }

    if (unchanged && lastGroups.current !== null) return lastGroups.current;

    // From here on we only ever touch the non-tree blocks — under 1% of the
    // world — so this is cheap even though it rebuilds from scratch.
    const nonTree: PlacedBlock[] = [];
    for (const key of live) {
      const c = cache.get(key);
      if (c === undefined) continue;
      for (let i = 0; i < c.nonTree.length; i++) nonTree.push(c.nonTree[i]);
    }

    // How many distinct textures each type uses, world-wide rather than per
    // chunk — so a type does not split into different batches in different
    // chunks purely because of what happened to be nearby.
    const variantsByType = new Map<string, Set<string>>();
    for (let i = 0; i < nonTree.length; i++) {
      const b = nonTree[i];
      if (!b.texture_url) continue;
      let s = variantsByType.get(b.block_type);
      if (!s) variantsByType.set(b.block_type, (s = new Set()));
      s.add(canonicalizeTextureUrl(b.texture_url));
    }

    const out = new Map<string, { blocks: PlacedBlock[]; textureOverride?: string }>();
    for (let i = 0; i < nonTree.length; i++) {
      const block = nonTree[i];
      const variantCount = variantsByType.get(block.block_type)?.size ?? 0;
      const allowOverride = variantCount > 0 && variantCount <= MAX_TEXTURE_VARIANTS_PER_TYPE;

      const groupKey = allowOverride && block.texture_url
        ? getMaterialVariantId(block.block_type, block.texture_url)
        : `${block.block_type}:default`;

      let g = out.get(groupKey);
      if (!g) {
        const blockType = groupKey.split(':')[0];
        const textureOverride = (variantsByType.get(blockType)?.size ?? 0) <= MAX_TEXTURE_VARIANTS_PER_TYPE
          ? (block.texture_url || undefined)
          : undefined;
        g = { blocks: [], textureOverride };
        out.set(groupKey, g);
      }
      g.blocks.push(block);
    }

    // Reuse the PREVIOUS array for any group whose contents are identical, so
    // an unrelated group changing does not force every batch to rebuild.
    const prev = lastGroups.current;
    if (prev !== null) {
      for (const [k, g] of out) {
        const p = prev.get(k);
        if (p === undefined || p.blocks.length !== g.blocks.length) continue;
        let same = true;
        for (let i = 0; i < g.blocks.length; i++) {
          if (p.blocks[i] !== g.blocks[i]) { same = false; break; }
        }
        if (same) out.set(k, p);
      }
    }
    lastGroups.current = out;
    return out;
  }, [entries]);

  if (groups.size === 0) return null;

  return (
    <>
      {Array.from(groups.entries()).map(([groupKey, { blocks, textureOverride }]) => {
        const blockType = groupKey.split(':')[0];
        const blockDef = textureOverride
          ? treeFallbackDef
          : (blocksMap.get(blockType) ?? defaultBlockDef);
        return (
          <InstancedBlockGroup
            key={groupKey}
            blocks={blocks}
            blockDef={blockDef}
            geometry={geometry}
            showOwnershipOutline={showOwnershipOutline}
            currentUserId={currentUserId}
            hoveredBlockId={hoveredBlockId}
            performanceMode={performanceMode}
            textureOverride={textureOverride}
          />
        );
      })}
    </>
  );
};
