import React, { useRef, useMemo, useCallback, useEffect, MutableRefObject } from 'react';
import * as THREE from 'three';
import { PlacedBlock, BlockType } from '@/types/blocks';
import { useBlocksData } from '@/hooks/useBlocksData';
import { InstancedBlockGroup, clearTextureCache as clearInstancedTextureCache } from './InstancedBlockGroup';
import { diagnostics } from '@/lib/diagnosticsLogger';
import { frameLoop } from '@/lib/frameLoop';

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

// Component to render all placed blocks with collision detection using instanced rendering
export const PlacedBlocks: React.FC<{ 
  blocks: PlacedBlock[]; 
  onCollision?: (boxes: THREE.Box3[]) => void;
  showOwnershipOutline?: boolean;
  currentUserId?: string;
  hoveredBlockId?: string | null;
  onMeshReady?: (blockType: string, mesh: THREE.InstancedMesh | null) => void;
  performanceMode?: boolean;
}> = ({ blocks, onCollision, showOwnershipOutline = false, currentUserId, hoveredBlockId = null, onMeshReady, performanceMode = false }) => {
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

  // Group blocks by block_type for instanced rendering (stable grouping)
  // Group blocks by block_type AND texture_url to handle per-seed tree textures
  // Key format: "blockType" or "blockType|textureUrl" if texture override present
  const groupedBlocks = useMemo(() => {
    const groups = new Map<string, { blocks: PlacedBlock[]; textureOverride?: string }>();
    const seenIds = new Set<string>();
    
    blocks.forEach(block => {
      // Skip duplicate IDs (happens during temp->real block transitions)
      if (seenIds.has(block.id)) {
        console.warn('Duplicate block ID detected:', block.id);
        return;
      }
      seenIds.add(block.id);
      
      // Create group key based on block_type and optional texture_url
      const groupKey = block.texture_url 
        ? `${block.block_type}|${block.texture_url}` 
        : block.block_type;
      
      const existing = groups.get(groupKey) || { blocks: [], textureOverride: block.texture_url || undefined };
      existing.blocks.push(block);
      groups.set(groupKey, existing);
    });
    return groups;
  }, [blocks]);

  // Don't render blocks until block definitions are loaded
  if (blockDefsLoading || blocks.length === 0) {
    return null;
  }

  return (
    <>
      {Array.from(groupedBlocks.entries()).map(([groupKey, { blocks: blocksOfType, textureOverride }]) => {
        // Extract block_type from groupKey (before the | if present)
        const blockType = groupKey.includes('|') ? groupKey.split('|')[0] : groupKey;
        
        // For blocks with textureOverride (like tree blocks), ALWAYS use fallback
        // This prevents color tinting from the blocks table (e.g., brown "trunk" block)
        // The fallback has white color so textures render at full brightness
        let blockDef: BlockType | undefined;
        if (textureOverride) {
          blockDef = TREE_BLOCK_FALLBACK;
        } else {
          blockDef = blocksMap.get(blockType);
        }
        
        if (!blockDef) {
          // Log missing block definitions to help debug (non-tree blocks only)
          console.warn(`[PlacedBlocks] No block definition for type: "${blockType}", skipping ${blocksOfType.length} blocks`);
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
            performanceMode={performanceMode}
            textureOverride={textureOverride}
          />
        );
      })}
    </>
  );
};