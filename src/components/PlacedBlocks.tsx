import React, { useRef, useMemo, useCallback, useEffect, MutableRefObject } from 'react';
import * as THREE from 'three';
import { PlacedBlock, BlockType } from '@/types/blocks';
import { useBlocksData } from '@/hooks/useBlocksData';
import { InstancedBlockGroup, clearTextureCache as clearInstancedTextureCache } from './InstancedBlockGroup';
import { diagnostics } from '@/lib/diagnosticsLogger';
import { frameLoop } from '@/lib/frameLoop';
import { collisionGrid } from '@/lib/spatialHashGrid';
import { isInvisiblock, isTreeBlockType } from '@/features/trees/lib/blockTypeEncoder';
import { getMaterialVariantId, fnv1a32, canonicalizeTextureUrl } from '@/lib/renderKeys';

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

// Re-export clearTextureCache for backward compatibility
export const clearTextureCache = clearInstancedTextureCache;

// Shared geometry for performance
const SharedBlockGeometry = () => {
  return useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
};

// Track falling blocks with their current Y position - exported for stacking calculations
export const fallingBlocksState = new Map<string, { currentY: number; velocity: number; targetY: number }>();

// Height map for O(1) stacking lookups
export const heightMap = new Map<string, number>();

// D2: Cheap O(1) group key for fast cache hit detection
// Only compute expensive visual signature when cheap key differs
function cheapGroupKey(arr: PlacedBlock[]): string {
  const n = arr.length;
  if (n === 0) return '0';
  const a = arr[0];
  const b = arr[n - 1];
  const atx = canonicalizeTextureUrl(a.texture_url || '');
  const btx = canonicalizeTextureUrl(b.texture_url || '');
  const abd = (a as any).branch_depth ?? '';
  const bbd = (b as any).branch_depth ?? '';
  return `${n}|${a.position_x},${a.position_y},${a.position_z},${a.block_type},${atx},${abd}|${b.position_x},${b.position_y},${b.position_z},${b.block_type},${btx},${bbd}`;
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

// Shared geometry for invisiblock outlines (reused across all invisiblocks)
const invisiblockEdgesGeometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
const invisiblockOutlineMaterial = new THREE.LineBasicMaterial({ 
  color: new THREE.Color(0.4, 0.4, 0.4), // Subtle grey
  linewidth: 1,
  transparent: true,
  opacity: 0.5
});

// B2.2: Global threshold for auto-enabling performance mode
const GLOBAL_VISIBLE_BLOCKS_THRESHOLD = 3000;

interface PlacedBlocksProps {
  blocks: PlacedBlock[]; 
  onCollision?: (boxes: THREE.Box3[]) => void;
  showOwnershipOutline?: boolean;
  currentUserId?: string;
  hoveredBlockId?: string | null;
  onMeshReady?: (blockType: string, mesh: THREE.InstancedMesh | null) => void;
  performanceMode?: boolean;
}

// F2.1: Wrap in React.memo with custom comparison to prevent cascade re-renders
// Only re-render when blocks array ref changes or hover/outline state changes
const PlacedBlocksInner: React.FC<PlacedBlocksProps> = ({ 
  blocks, 
  onCollision, 
  showOwnershipOutline = false, 
  currentUserId, 
  hoveredBlockId = null, 
  onMeshReady, 
  performanceMode = false 
}) => {
  // B2.2: Auto-enable performance mode when total visible blocks exceed threshold
  const effectivePerformanceMode = performanceMode || blocks.length > GLOBAL_VISIBLE_BLOCKS_THRESHOLD;
  const collisionBoxes = useRef<Map<string, THREE.Box3>>(new Map());
  const geometry = SharedBlockGeometry();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastThudTime = useRef(0);
  
  // Initialize audio
  useEffect(() => {
    audioRef.current = new Audio('/wooden_thud_sound.mp3');
    audioRef.current.volume = 0.3;
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);
  
  // Ensure block definitions are loaded before rendering any blocks
  const { isLoading: blockDefsLoading, blocksMap } = useBlocksData();
  
  // Height map rebuilding: GATED - only enabled when block-rain tooling is active
  // This was O(n) work on every blocks update but heightMap appears unused in production
  const ENABLE_HEIGHTMAP = false; // Set to true when block-rain debug tooling is needed
  
  // Initialize falling state for new blocks with expires_at and update height map
  useEffect(() => {
    // Clean up removed blocks from falling state
    const blockIds = new Set(blocks.map(b => b.id));
    Array.from(fallingBlocksState.keys()).forEach(id => {
      if (!blockIds.has(id)) {
        fallingBlocksState.delete(id);
      }
    });
    
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
  
  // Create block ID to block map for O(1) lookups in frame loop
  const blocksById = useMemo(() => {
    const map = new Map<string, PlacedBlock>();
    blocks.forEach(block => map.set(block.id, block));
    return map;
  }, [blocks]);
  
  // Store blocksById in ref for frame loop access
  const blocksByIdRef = useRef(blocksById);
  useEffect(() => { blocksByIdRef.current = blocksById; }, [blocksById]);
  
  // Physics update for falling blocks - register with centralized frame loop
  useEffect(() => {
    const unregister = frameLoop.register('placed-blocks', (delta) => {
      // Note: useFrameCallCount only tracked in master loop now
      
      if (fallingBlocksState.size === 0) return; // Early exit if nothing falling
      
      const gravity = 9.8;
      const maxDelta = 0.1;
      const cappedDelta = Math.min(delta, maxDelta);
      
      const currentBlocksById = blocksByIdRef.current;
      
      fallingBlocksState.forEach((fallState, blockId) => {
        const block = currentBlocksById.get(blockId);
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

  const handleBlockCollision = useCallback((box: THREE.Box3, blockId: string) => {
    collisionBoxes.current.set(blockId, box);
  }, []);

  // Use ref to avoid stale closure with onCollision
  const onCollisionRef = useRef(onCollision);
  React.useEffect(() => {
    onCollisionRef.current = onCollision;
  }, [onCollision]);
  
  // Only update collision boxes when blocks are added/removed
  const blockIds = useMemo(() => new Set(blocks.map(b => b.id)), [blocks]);
  
  React.useEffect(() => {
    // Remove collision boxes for deleted blocks
    const currentBoxIds = Array.from(collisionBoxes.current.keys());
    currentBoxIds.forEach(id => {
      if (!blockIds.has(id)) {
        collisionBoxes.current.delete(id);
      }
    });
    
    // Call onCollision with updated collision boxes
    if (onCollisionRef.current && collisionBoxes.current.size > 0) {
      onCollisionRef.current(Array.from(collisionBoxes.current.values()));
    }
  }, [blockIds]);

  // Separate invisiblocks from visible blocks
  // Invisiblocks need collision registration but no visual rendering
  // OPTIMIZATION: Cap texture variants per block_type to prevent excessive InstancedBlockGroup components
  const MAX_TEXTURE_VARIANTS_PER_TYPE = 8;
  
  // D2: Cache for stable array references with cheap key + expensive signature
  // Cheap key (O(1)) is checked first, expensive signature only when cheap differs
  const groupCacheRef = useRef<Map<string, { 
    blocks: PlacedBlock[]; 
    textureOverride?: string;
    signature: string;
    cheapKey: string;
  }>>(new Map());
  const invisiblocksCacheRef = useRef<{ blocks: PlacedBlock[]; signature: string; cheapKey: string }>({ blocks: [], signature: '', cheapKey: '' });
  
  const { groupedBlocks, invisiblocks } = useMemo(() => {
    const groups = new Map<string, { blocks: PlacedBlock[]; textureOverride?: string }>();
    const invisibleBlocks: PlacedBlock[] = [];
    const seenIds = new Set<string>();
    
    // First pass: dedupe blocks silently
    const deduped: PlacedBlock[] = [];
    for (const block of blocks) {
      if (seenIds.has(block.id)) continue;
      seenIds.add(block.id);
      deduped.push(block);
    }
    
    // Count texture variants per block_type - use CANONICAL URLs
    const variantsByType = new Map<string, Set<string>>();
    for (const b of deduped) {
      if (!b.texture_url) continue;
      let s = variantsByType.get(b.block_type);
      if (!s) variantsByType.set(b.block_type, (s = new Set()));
      s.add(canonicalizeTextureUrl(b.texture_url));
    }
    
    // Temporary grouping to build signatures
    const tempGroups = new Map<string, PlacedBlock[]>();
    
    // Second pass: group with cap
    for (const block of deduped) {
      // Invisiblocks go to separate array for collision-only handling
      if (isInvisiblock(block.block_type)) {
        invisibleBlocks.push(block);
        continue;
      }
      
      // Check if this block_type has too many texture variants
      const variantCount = variantsByType.get(block.block_type)?.size ?? 0;
      const allowOverride = variantCount > 0 && variantCount <= MAX_TEXTURE_VARIANTS_PER_TYPE;
      
      // C2: Create stable group key using canonical texture URL hash
      const groupKey = allowOverride && block.texture_url
        ? getMaterialVariantId(block.block_type, block.texture_url)
        : `${block.block_type}:default`;
      
      const arr = tempGroups.get(groupKey) || [];
      arr.push(block);
      tempGroups.set(groupKey, arr);
    }
    
    // D2: Build stable arrays with CHEAP precheck + expensive signature fallback
    // Cheap key O(1) catches 99% of "no change" cases; expensive signature only when needed
    const cache = groupCacheRef.current;
    const usedKeys = new Set<string>();
    
    for (const [groupKey, blocksArr] of tempGroups) {
      usedKeys.add(groupKey);
      
      // D2: Compute cheap O(1) key first
      const cheap = cheapGroupKey(blocksArr);
      const cached = cache.get(groupKey);
      
      // C2: Extract block type from new groupKey format (blockType:default or blockType:tx:hash)
      const blockType = groupKey.split(':')[0];
      const textureOverride = (variantsByType.get(blockType)?.size ?? 0) <= MAX_TEXTURE_VARIANTS_PER_TYPE
        ? (blocksArr[0]?.texture_url || undefined)
        : undefined;
      
      // D2: FAST PATH - cheap key matches, reuse cached array immediately
      if (cached && cached.cheapKey === cheap) {
        groups.set(groupKey, { blocks: cached.blocks, textureOverride: cached.textureOverride });
        continue; // Skip expensive signature computation!
      }
      
      // D2: SLOW PATH - cheap key differs, compute expensive signature
      const sig = blocksArr.length === 0 ? 'empty' : computeGroupSignature(blocksArr);
      
      if (cached && cached.signature === sig) {
        // Visual signature matches (order changed but content same) - update cheap key and reuse
        cached.cheapKey = cheap;
        groups.set(groupKey, { blocks: cached.blocks, textureOverride: cached.textureOverride });
      } else {
        // Content actually changed - use new array and update cache
        cache.set(groupKey, { blocks: blocksArr, textureOverride, signature: sig, cheapKey: cheap });
        groups.set(groupKey, { blocks: blocksArr, textureOverride });
      }
    }
    
    // Clean up stale cache entries
    for (const key of cache.keys()) {
      if (!usedKeys.has(key)) {
        cache.delete(key);
      }
    }
    
    // D2: Stable invisiblocks array with cheap precheck
    const invisiCheap = cheapGroupKey(invisibleBlocks);
    
    let stableInvisiblocks: PlacedBlock[];
    if (invisiblocksCacheRef.current.cheapKey === invisiCheap) {
      stableInvisiblocks = invisiblocksCacheRef.current.blocks;
    } else {
      // Cheap key differs - compute expensive signature
      const invisiSig = invisibleBlocks.length === 0 ? 'empty' : computeGroupSignature(invisibleBlocks);
      if (invisiblocksCacheRef.current.signature === invisiSig) {
        // Content same, just update cheap key
        invisiblocksCacheRef.current.cheapKey = invisiCheap;
        stableInvisiblocks = invisiblocksCacheRef.current.blocks;
      } else {
        invisiblocksCacheRef.current = { blocks: invisibleBlocks, signature: invisiSig, cheapKey: invisiCheap };
        stableInvisiblocks = invisibleBlocks;
      }
    }
    
    return { groupedBlocks: groups, invisiblocks: stableInvisiblocks };
  }, [blocks]);
  
  // NOTE: Invisiblock colliders are now handled by chunk loader (ensureBlockCollider)
  // This removes duplicate collider authority that was causing grid inflation

  // Don't render blocks until block definitions are loaded
  if (blockDefsLoading || blocks.length === 0) {
    return null;
  }

  return (
    <>
      {Array.from(groupedBlocks.entries()).map(([groupKey, { blocks: blocksOfType, textureOverride }]) => {
        // C2: Extract block_type from new groupKey format (blockType:default or blockType:tx:hash)
        const blockType = groupKey.split(':')[0];
        
        // For tree blocks (textureOverride OR encoded tree type), ALWAYS use fallback
        // This prevents color tinting from the blocks table (e.g., brown "trunk" block)
        // The fallback has white color so textures render at full brightness
        // Also handles tree blocks without textures (like branches when branch_texture_url is null)
        let blockDef: BlockType | undefined;
        if (textureOverride || isTreeBlockType(blockType)) {
          blockDef = TREE_BLOCK_FALLBACK;
        } else {
          blockDef = blocksMap.get(blockType);
        }
        
        if (!blockDef) {
          // Skip blocks with missing definitions silently (common for deprecated/removed block types)
          return null;
        }
        
        return (
          <InstancedBlockGroup
            key={groupKey}
            blocks={blocksOfType}
            blockDef={blockDef}
            geometry={geometry}
            onCollision={handleBlockCollision}
            showOwnershipOutline={showOwnershipOutline}
            currentUserId={currentUserId}
            hoveredBlockId={hoveredBlockId}
            onMeshReady={onMeshReady ? (mesh) => onMeshReady(blockType, mesh) : undefined}
            performanceMode={effectivePerformanceMode}
            textureOverride={textureOverride}
          />
        );
      })}
      
      {/* Render subtle grey outlines for invisiblocks */}
      {invisiblocks.map((block) => (
        <lineSegments 
          key={`invisi-outline-${block.id}`} 
          position={[block.position_x + 0.5, block.position_y + 0.5, block.position_z + 0.5]}
        >
          <primitive object={invisiblockEdgesGeometry} attach="geometry" />
          <primitive object={invisiblockOutlineMaterial} attach="material" />
        </lineSegments>
      ))}
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
    prev.performanceMode === next.performanceMode
  );
});