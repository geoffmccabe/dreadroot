import React, { useRef, useMemo, useEffect, MutableRefObject } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { PlacedBlock, BlockType } from '@/types/blocks';
import { useBlocksData } from '@/hooks/useBlocksData';
import { InstancedBlockGroup, clearTextureCache as clearInstancedTextureCache } from './InstancedBlockGroup';
import { InstancedAtlasBlockGroup } from './InstancedAtlasBlockGroup';
import { diagnostics } from '@/lib/diagnosticsLogger';
import { frameLoop } from '@/lib/frameLoop';
// collisionGrid import removed — collision handled by useChunkLoader (ensureBlockCollider)
import { isInvisiblock, isTreeBlockType } from '@/features/trees/lib/blockTypeEncoder';
import { shrineTracker } from '@/lib/shrineTracker';
import { getMaterialVariantId, fnv1a32, canonicalizeTextureUrl } from '@/lib/renderKeys';
import { useTextureAtlas } from '@/hooks/useTextureAtlas';
import { useAtlasSync } from '@/hooks/useAtlasSync';
import { initLogStep } from '@/contexts/InitializationContext';
import { cullOccludedBlocks } from '@/lib/occlusionCulling';
import { getSoundUrl } from '@/hooks/useGameSounds';

// Fallback block definition for tree blocks that might not have entries in the blocks table
// Use white color so textures render at full brightness without tinting
const TREE_BLOCK_FALLBACK: BlockType = {
  id: -1,
  key: 'tree_block',
  name: 'Tree Block',
  description: 'A tree block',
  cost: 0,
  category: 'building',
  rarity: 'common',
  class: 'basic',
  tier: 1,
  properties: {
    color: '#ffffff', // White - lets texture show through without darkening
    emissive: false,
    transparent: false,
    glowFactor: 0
  }
};

// Fallback block definition for user-placed blocks without database entries
// Uses the default cliff texture from InstancedBlockGroup
const DEFAULT_BLOCK_FALLBACK: BlockType = {
  id: -2,
  key: 'default_block',
  name: 'Block',
  description: 'A block',
  cost: 0,
  category: 'building',
  rarity: 'common',
  class: 'basic',
  tier: 1,
  properties: {
    color: '#ffffff', // White - lets default texture show through
    emissive: false,
    transparent: false,
    glowFactor: 0
  }
};

// Re-export clearTextureCache for backward compatibility
export const clearTextureCache = clearInstancedTextureCache;

// Flags for one-time init logging
let _loggedTreeBlocksReady = false;
let _loggedAtlasRendering = false;
let _loggedNonTreeBlocks = false;

// Shared geometry for performance
const SharedBlockGeometry = () => {
  return useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
};

// Track falling blocks with their current Y position - exported for stacking calculations
export const fallingBlocksState = new Map<string, { currentY: number; velocity: number; targetY: number }>();

// Height map for O(1) stacking lookups
export const heightMap = new Map<string, number>();

// D2/B10/B11: Order-independent group key using XOR of ALL block position hashes.
// XOR is commutative, so reordering the same blocks produces the same hash.
// O(n) but eliminates the 91%+ cache miss rate from order-dependent sampling.
// Uses Math.imul for guaranteed 32-bit integer multiplication (avoids JS float overflow).
function cheapGroupKey(arr: PlacedBlock[]): string {
  const n = arr.length;
  if (n === 0) return '0';

  // XOR all block position hashes - order doesn't matter due to XOR commutativity
  // Math.imul ensures 32-bit integer multiplication (no floating point overflow)
  let posXor = 0;
  let posSum = 0;
  for (let i = 0; i < n; i++) {
    const b = arr[i];
    // Use Math.imul for deterministic 32-bit multiplication
    const hx = Math.imul(b.position_x | 0, 73856093);
    const hy = Math.imul(b.position_y | 0, 19349663);
    const hz = Math.imul(b.position_z | 0, 83492791);
    const h = (hx ^ hy ^ hz) | 0;
    posXor = (posXor ^ h) | 0;
    posSum = (posSum + (h >>> 0)) >>> 0;
  }

  return `${n}|${(posXor >>> 0)}|${posSum}`;
}

// C2: Visual signature helpers - order-insensitive, ID-independent (EXPENSIVE - only call when needed)
function blockSig(b: PlacedBlock): string {
  const tx = canonicalizeTextureUrl(b.texture_url || '');
  return `${b.position_x},${b.position_y},${b.position_z}|${b.block_type}|${tx}|${(b as any).branch_depth ?? ''}`;
}

function computeGroupSignature(arr: PlacedBlock[]): string {
  let xor = 0;
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    const h = parseInt(fnv1a32(blockSig(arr[i])), 16) >>> 0;
    xor ^= h;
    sum = (sum + h) >>> 0;
  }
  return `${arr.length}:${xor.toString(16)}:${sum.toString(16)}`;
}

// Invisiblock outlines disabled for performance - uncomment to debug
// const invisiblockEdgesGeometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
// const invisiblockOutlineMaterial = new THREE.LineBasicMaterial({
//   color: new THREE.Color(0.4, 0.4, 0.4),
//   linewidth: 1,
//   transparent: true,
//   opacity: 0.5
// });

// Performance: Skip invisiblock outline rendering - each was a separate draw call
const RENDER_INVISIBLOCK_OUTLINES = false;

// B2.2: Global threshold for auto-enabling performance mode
const GLOBAL_VISIBLE_BLOCKS_THRESHOLD = 3000;

interface PlacedBlocksProps {
  blocks: PlacedBlock[];
  showOwnershipOutline?: boolean;
  currentUserId?: string;
  hoveredBlockId?: string | null;
  onMeshReady?: (blockType: string, mesh: THREE.InstancedMesh | null) => void;
  performanceMode?: boolean;
  // Phase 1 optimization: hoisted hooks — when provided, skip internal hook calls
  hoistedAtlasTexture?: THREE.Texture | null;
  hoistedAtlasReady?: boolean;
  hoistedBlocksMap?: Map<string, BlockType>;
  hoistedBlockDefsLoading?: boolean;
}

// F2.1: Wrap in React.memo with custom comparison to prevent cascade re-renders
// Only re-render when blocks array ref changes or hover/outline state changes
const PlacedBlocksInner: React.FC<PlacedBlocksProps> = ({
  blocks,
  showOwnershipOutline = false,
  currentUserId,
  hoveredBlockId = null,
  onMeshReady,
  performanceMode = false,
  hoistedAtlasTexture,
  hoistedAtlasReady,
  hoistedBlocksMap,
  hoistedBlockDefsLoading
}) => {
  // B2.2: Auto-enable performance mode when total visible blocks exceed threshold
  const effectivePerformanceMode = performanceMode || blocks.length > GLOBAL_VISIBLE_BLOCKS_THRESHOLD;
  const geometry = SharedBlockGeometry();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastThudTime = useRef(0);

  // Phase 1 optimization: use hoisted hooks when provided (per-chunk rendering),
  // fall back to internal hooks for standalone usage
  const internalAtlas = useTextureAtlas();
  const atlasTexture = hoistedAtlasTexture !== undefined ? hoistedAtlasTexture : internalAtlas.texture;
  const atlasReady = hoistedAtlasReady !== undefined ? hoistedAtlasReady : internalAtlas.isReady;

  // Only run atlas sync if not hoisted (parent handles it)
  useAtlasSync({ enabled: hoistedAtlasTexture === undefined });

  // Force the 256MB atlas onto the GPU as soon as it's ready, instead of
  // letting Three.js upload it lazily on first draw (which freezes a frame
  // mid-game — the "grey screen"). Runs once.
  const { gl } = useThree();
  const atlasUploadedRef = useRef(false);
  useEffect(() => {
    if (atlasReady && atlasTexture && !atlasUploadedRef.current) {
      atlasUploadedRef.current = true;
      gl.initTexture(atlasTexture);
    }
  }, [atlasReady, atlasTexture, gl]);

  
  // Initialize audio
  useEffect(() => {
    audioRef.current = new Audio(getSoundUrl('block_place', '/wooden_thud_sound.mp3'));
    audioRef.current.volume = 0.3;
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);
  
  // Phase 1 optimization: use hoisted block definitions when provided
  const internalBlocksData = useBlocksData();
  const blocksMap = hoistedBlocksMap !== undefined ? hoistedBlocksMap : internalBlocksData.blocksMap;
  const blockDefsLoading = hoistedBlockDefsLoading !== undefined ? hoistedBlockDefsLoading : internalBlocksData.isLoading;
  
  // Height map rebuilding: GATED - only enabled when block-rain tooling is active
  // This was O(n) work on every blocks update but heightMap appears unused in production
  const ENABLE_HEIGHTMAP = false; // Set to true when block-rain debug tooling is needed
  
  // Initialize falling state for new blocks with expires_at and update height map
  useEffect(() => {
    // B8: Clean up removed blocks from falling state WITHOUT creating world-sized Set
    // fallingBlocksState is tiny (only actively falling blocks), so O(n*m) is fine
    // where n=falling count (tiny) and m=blocks count (large but only scanned per falling block)
    if (fallingBlocksState.size > 0) {
      const toRemove: string[] = [];
      for (const id of fallingBlocksState.keys()) {
        // Linear search is fine since fallingBlocksState is tiny
        const exists = blocks.some(b => b.id === id);
        if (!exists) toRemove.push(id);
      }
      for (const id of toRemove) {
        fallingBlocksState.delete(id);
      }
    }
    
    // Do NOT automatically make blocks with expires_at fall from the sky
    // Falling state is tracked in-memory only and does not persist across refreshes
    // expires_at is ONLY for database cleanup via delete_expired_blocks()
    
    // GATED: Only rebuild height map if debug tooling is enabled
    if (ENABLE_HEIGHTMAP) {
      heightMap.clear();
      for (const block of blocks) {
        const key = `${Math.round(block.position_x)},${Math.round(block.position_z)}`;
        const currentMax = heightMap.get(key) || 0;
        const blockTop = Math.round(block.position_y) + 1;
        if (blockTop > currentMax) {
          heightMap.set(key, blockTop);
        }
      }
    }
  }, [blocks]);
  
  // B5: Use ref instead of Map to avoid massive allocations on every blocks change
  // Falling blocks count is tiny, so linear lookup is fine
  const blocksRef = useRef<PlacedBlock[]>(blocks);
  useEffect(() => { blocksRef.current = blocks; }, [blocks]);
  
  // Physics update for falling blocks - register with centralized frame loop
  useEffect(() => {
    const unregister = frameLoop.register('placed-blocks', (delta) => {
      // Note: useFrameCallCount only tracked in master loop now
      
      if (fallingBlocksState.size === 0) return; // Early exit if nothing falling
      
      const gravity = 9.8;
      const maxDelta = 0.1;
      const cappedDelta = Math.min(delta, maxDelta);
      
      // B5: Use linear lookup - falling blocks count is tiny so this is fine
      const currentBlocks = blocksRef.current;

      fallingBlocksState.forEach((fallState, blockId) => {
        const block = currentBlocks.find(b => b.id === blockId);
        if (!block) return;
        
        fallState.velocity += gravity * cappedDelta;
        fallState.currentY -= fallState.velocity * cappedDelta;
        
        const landingY = block.position_y;
        
        if (fallState.currentY <= landingY) {
          fallState.currentY = block.position_y;
          
          const now = Date.now();
          if (audioRef.current && now - lastThudTime.current > 50) {
            audioRef.current.currentTime = 0;
            audioRef.current.play().catch(() => {});
            lastThudTime.current = now;
          }
          
          fallingBlocksState.delete(blockId);
        }
      });
    }, 50); // Priority 50

    return unregister;
  }, []);

  // Collision is fully managed by useChunkLoader (ensureBlockCollider).
  // No per-render collision allocation needed.

  // Separate invisiblocks from visible blocks and group by block type
  // B6: Signature-based caching to avoid O(n) work when blocks haven't changed
  const MAX_TEXTURE_VARIANTS_PER_TYPE = 8;

  // B6: Cache for groupedBlocks result - avoids re-grouping on every render
  type GroupedResult = {
    groupedBlocks: Map<string, { blocks: PlacedBlock[]; textureOverride?: string }>;
    invisiblocks: PlacedBlock[];
    atlasTreeBlocks: PlacedBlock[];
  };
  const groupCacheRef = useRef<{ key: string; blocksRef: PlacedBlock[]; result: GroupedResult } | null>(null);

  // B10: Cache variant counts across re-groupings. Block types/textures don't change
  // on chunk boundary crossings (only positions change), so we can reuse variant counts.
  const variantsCacheRef = useRef<{
    typeHash: number;
    variantsByType: Map<string, Set<string>>;
  } | null>(null);

  const { groupedBlocks, invisiblocks, atlasTreeBlocks } = useMemo(() => {
    // Fast O(1) reference check — if blocks array ref is identical, skip the O(n) hash
    if (groupCacheRef.current && groupCacheRef.current.blocksRef === blocks) {
      diagnostics.recordGroupCacheHit();
      return groupCacheRef.current.result;
    }

    // B6: Compute cheap key to detect if blocks content changed (different ref, same data)
    const cheapKey = cheapGroupKey(blocks);
    if (groupCacheRef.current && groupCacheRef.current.key === cheapKey) {
      // Update stored ref so next check is O(1)
      groupCacheRef.current.blocksRef = blocks;
      diagnostics.recordGroupCacheHit();
      return groupCacheRef.current.result;
    }

    // D-Flow: Track grouping time when cache misses
    const groupT0 = performance.now();

    // Key changed - must recompute grouping
    const groups = new Map<string, { blocks: PlacedBlock[]; textureOverride?: string }>();
    const invisibleBlocks: PlacedBlock[] = [];
    const treeBlocksForAtlas: PlacedBlock[] = [];

    // Pass 1: Classify ALL blocks (tree/invis/non-tree) and compute type hash.
    // Tree blocks (~80%+ of total) are pushed directly. Non-tree blocks are
    // collected for a second pass that only iterates the non-tree subset.
    // This reduces total iterations from 3×N to N + 2×(non-tree count).
    let typeHash = 0;
    let nonTreeCount = 0;
    const nonTreeBlocks: PlacedBlock[] = [];

    // Clear shrine blocks and re-detect from loaded blocks
    shrineTracker.clearBlocks();
    const shrineBlockPositions: Array<{ x: number; y: number; z: number }> = [];

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];

      if (isInvisiblock(block.block_type)) {
        invisibleBlocks.push(block);
        continue;
      }

      if (isTreeBlockType(block.block_type)) {
        treeBlocksForAtlas.push(block);
        // Detect shrine blocks for proximity tracking (fast char check: 'shr')
        const bt = block.block_type;
        if (bt.charCodeAt(0) === 115 && bt.charCodeAt(1) === 104 && bt.charCodeAt(2) === 114) {
          shrineBlockPositions.push({
            x: block.position_x,
            y: block.position_y,
            z: block.position_z,
          });
        }
        continue;
      }

      // Non-tree: collect + compute type hash
      nonTreeBlocks.push(block);
      nonTreeCount++;
      const bt = block.block_type;
      typeHash ^= (bt.charCodeAt(0) | 0) * 73856093;
      if (bt.length > 1) typeHash ^= (bt.charCodeAt(1) | 0) * 19349663;
      typeHash ^= bt.length * 83492791;
    }
    typeHash = (typeHash ^ nonTreeCount) >>> 0;

    // Register detected shrine blocks
    if (shrineBlockPositions.length > 0) {
      shrineTracker.registerShrineBlocks(shrineBlockPositions);
    }

    // Check variant cache (only iterates non-tree blocks on miss)
    let variantsByType: Map<string, Set<string>>;

    if (variantsCacheRef.current && variantsCacheRef.current.typeHash === typeHash) {
      variantsByType = variantsCacheRef.current.variantsByType;
    } else {
      variantsByType = new Map<string, Set<string>>();
      for (let i = 0; i < nonTreeBlocks.length; i++) {
        const b = nonTreeBlocks[i];
        if (!b.texture_url) continue;
        let s = variantsByType.get(b.block_type);
        if (!s) variantsByType.set(b.block_type, (s = new Set()));
        s.add(canonicalizeTextureUrl(b.texture_url));
      }
      variantsCacheRef.current = { typeHash, variantsByType };
    }

    // Pass 2: Group only non-tree blocks (typically ~20% of total)
    for (let i = 0; i < nonTreeBlocks.length; i++) {
      const block = nonTreeBlocks[i];
      const variantCount = variantsByType.get(block.block_type)?.size ?? 0;
      const allowOverride = variantCount > 0 && variantCount <= MAX_TEXTURE_VARIANTS_PER_TYPE;

      const groupKey = allowOverride && block.texture_url
        ? getMaterialVariantId(block.block_type, block.texture_url)
        : `${block.block_type}:default`;

      let group = groups.get(groupKey);
      if (!group) {
        const blockType = groupKey.split(':')[0];
        const textureOverride = (variantsByType.get(blockType)?.size ?? 0) <= MAX_TEXTURE_VARIANTS_PER_TYPE
          ? (block.texture_url || undefined)
          : undefined;
        group = { blocks: [], textureOverride };
        groups.set(groupKey, group);
      }
      group.blocks.push(block);
    }

    const result: GroupedResult = { groupedBlocks: groups, invisiblocks: invisibleBlocks, atlasTreeBlocks: treeBlocksForAtlas };

    // D-Flow: Record grouping time
    diagnostics.recordGrouping(performance.now() - groupT0, blocks.length);

    // B6: Cache the result for next render
    groupCacheRef.current = { key: cheapKey, blocksRef: blocks, result };

    return result;
  }, [blocks]);
  
  // NOTE: Invisiblock colliders are now handled by chunk loader (ensureBlockCollider)
  // This removes duplicate collider authority that was causing grid inflation

  // Render-time culling for tree blocks: removes fully-surrounded interior blocks.
  // Chunks are pre-culled on load, but after mutations visibleBlocks is invalidated
  // and the full blocks array is emitted. This render-time pass catches those.
  // Cached by cheapGroupKey to avoid recomputing when blocks haven't changed.
  const occlusionCacheRef = useRef<{ key: string; culled: PlacedBlock[] } | null>(null);

  const culledAtlasTreeBlocks = useMemo(() => {
    if (atlasTreeBlocks.length < 50) return atlasTreeBlocks;

    const treeKey = cheapGroupKey(atlasTreeBlocks);
    if (occlusionCacheRef.current && occlusionCacheRef.current.key === treeKey) {
      return occlusionCacheRef.current.culled;
    }

    const culled = cullOccludedBlocks(atlasTreeBlocks);
    occlusionCacheRef.current = { key: treeKey, culled };

    return culled;
  }, [atlasTreeBlocks]);

  // Log render state to init overlay (once per session)
  if (!_loggedTreeBlocksReady && atlasTreeBlocks.length > 0) {
    _loggedTreeBlocksReady = true;
    const culledCount = atlasTreeBlocks.length - culledAtlasTreeBlocks.length;
    initLogStep('PlacedBlocks.tsx', `Tree blocks loaded (${culledCount} interior culled)`, culledAtlasTreeBlocks.length);
  }
  if (!_loggedAtlasRendering && atlasReady && atlasTexture && culledAtlasTreeBlocks.length > 0) {
    _loggedAtlasRendering = true;
    initLogStep('PlacedBlocks.tsx', `Tree atlas rendering started`, culledAtlasTreeBlocks.length);
  }

  if (!_loggedNonTreeBlocks && groupedBlocks.size > 0) {
    _loggedNonTreeBlocks = true;
    const totalNonTreeBlocks = Array.from(groupedBlocks.values()).reduce((sum, g) => sum + g.blocks.length, 0);
    initLogStep('PlacedBlocks.tsx', `Non-tree blocks rendering`, totalNonTreeBlocks);

    // DEBUG: Log all non-tree block groups with their types and counts
    for (const [groupKey, { blocks: gBlocks, textureOverride }] of groupedBlocks) {
      const blockType = groupKey.split(':')[0];
      const blockDef = blocksMap.get(blockType);
      const texUrl = textureOverride || blockDef?.texture?.diffuse || '/cliff_texture_seamless.webp';
      console.warn(`[PlacedBlocks GROUP] "${groupKey}": ${gBlocks.length} blocks, blockDef=${blockDef ? blockDef.key : 'MISSING→fallback'}, texture=${texUrl}, sample pos=(${gBlocks[0]?.position_x},${gBlocks[0]?.position_y},${gBlocks[0]?.position_z})`);
    }
  }

  // Don't render if there are no blocks to show
  // Note: blockDefsLoading is NOT gated here — fallback definitions
  // (DEFAULT_BLOCK_FALLBACK, TREE_BLOCK_FALLBACK) ensure blocks render
  // even before Supabase block definitions load.
  if (blocks.length === 0) {
    return null;
  }

  // DEBUG: Log total blocks, tree blocks, non-tree blocks on first render per chunk
  if (groupedBlocks.size > 0 || culledAtlasTreeBlocks.length > 0) {
    const nonTreeTotal = Array.from(groupedBlocks.values()).reduce((sum, g) => sum + g.blocks.length, 0);
    if (nonTreeTotal > 0) {
      console.warn(`[PlacedBlocks RENDER] total=${blocks.length}, tree=${culledAtlasTreeBlocks.length}, nonTree=${nonTreeTotal}, groups=${groupedBlocks.size}, atlasReady=${atlasReady}`);
    }
  }

  return (
    <>
      {/* Render tree blocks with atlas (single draw call for ALL tree blocks) */}
      {atlasReady && atlasTexture && culledAtlasTreeBlocks.length > 0 && (
        <InstancedAtlasBlockGroup
          key="tree-atlas"
          blocks={culledAtlasTreeBlocks}
          blockDef={TREE_BLOCK_FALLBACK}
          geometry={geometry}
          atlasTexture={atlasTexture}

          showOwnershipOutline={showOwnershipOutline}
          currentUserId={currentUserId}
          hoveredBlockId={hoveredBlockId}
          onMeshReady={onMeshReady ? (mesh) => onMeshReady('tree_atlas', mesh) : undefined}
          performanceMode={effectivePerformanceMode}
        />
      )}

      {/* Fallback: render tree blocks without atlas while loading */}
      {(!atlasReady || !atlasTexture) && culledAtlasTreeBlocks.length > 0 && (
        <InstancedBlockGroup
          key="tree-fallback"
          blocks={culledAtlasTreeBlocks}
          blockDef={TREE_BLOCK_FALLBACK}
          geometry={geometry}

          showOwnershipOutline={showOwnershipOutline}
          currentUserId={currentUserId}
          hoveredBlockId={hoveredBlockId}
          onMeshReady={onMeshReady ? (mesh) => onMeshReady('tree_fallback', mesh) : undefined}
          performanceMode={effectivePerformanceMode}
        />
      )}

      {/* Render non-tree blocks with individual textures */}
      {Array.from(groupedBlocks.entries()).map(([groupKey, { blocks: blocksOfType, textureOverride }]) => {
        // C2: Extract block_type from new groupKey format (blockType:default or blockType:tx:hash)
        const blockType = groupKey.split(':')[0];

        // Get block definition (non-tree blocks only now)
        let blockDef: BlockType | undefined;
        if (textureOverride) {
          blockDef = TREE_BLOCK_FALLBACK;
        } else {
          blockDef = blocksMap.get(blockType);
          // Use default fallback for user-placed blocks without database entries
          if (!blockDef) {
            blockDef = DEFAULT_BLOCK_FALLBACK;
          }
        }

        return (
          <InstancedBlockGroup
            key={groupKey}
            blocks={blocksOfType}
            blockDef={blockDef}
            geometry={geometry}
  
            showOwnershipOutline={showOwnershipOutline}
            currentUserId={currentUserId}
            hoveredBlockId={hoveredBlockId}
            onMeshReady={onMeshReady ? (mesh) => onMeshReady(blockType, mesh) : undefined}
            performanceMode={effectivePerformanceMode}
            textureOverride={textureOverride}
          />
        );
      })}

      {/* Invisiblock outlines disabled for performance (was creating N draw calls)
          Set RENDER_INVISIBLOCK_OUTLINES = true to debug invisiblock positions */}
    </>
  );
};

// F2.1: Export memoized version to prevent unnecessary re-renders
// Custom comparison only re-renders when blocks ref or key props change
export const PlacedBlocks = React.memo(PlacedBlocksInner, (prev, next) => {
  // Return true if props are EQUAL (no re-render needed)
  return (
    prev.blocks === next.blocks &&
    prev.hoveredBlockId === next.hoveredBlockId &&
    prev.showOwnershipOutline === next.showOwnershipOutline &&
    prev.currentUserId === next.currentUserId &&
    prev.performanceMode === next.performanceMode &&
    prev.hoistedAtlasTexture === next.hoistedAtlasTexture &&
    prev.hoistedAtlasReady === next.hoistedAtlasReady &&
    prev.hoistedBlocksMap === next.hoistedBlocksMap &&
    prev.hoistedBlockDefsLoading === next.hoistedBlockDefsLoading
  );
});