import React, { useRef, useMemo, useCallback, useEffect, MutableRefObject } from 'react';
import * as THREE from 'three';
import { PlacedBlock } from '@/types/blocks';
import { useBlocksData } from '@/hooks/useBlocksData';
import { useBlocks } from '@/contexts/BlocksContext';
import { InstancedBlockGroup, clearTextureCache as clearInstancedTextureCache } from './InstancedBlockGroup';
import { diagnostics } from '@/lib/diagnosticsLogger';
import { frameLoop } from '@/lib/frameLoop';

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
  const { visibleChunksRef } = useBlocks();
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
    
    // Rebuild height map from scratch for accurate stacking
    heightMap.clear();
    blocks.forEach(block => {
      const key = `${Math.round(block.position_x)},${Math.round(block.position_z)}`;
      const currentMax = heightMap.get(key) || 0;
      
      // Always use actual database position for heightMap
      // Falling state is visual only, doesn't affect stacking logic
      const blockY = block.position_y;
      
      // Store the Y position where the NEXT block should land (top of this block)
      const blockTop = Math.round(blockY) + 1;
      heightMap.set(key, Math.max(currentMax, blockTop));
    });
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
  // Use block IDs to ensure uniqueness and prevent duplicate renders
  const groupedBlocks = useMemo(() => {
    const groups = new Map<string, PlacedBlock[]>();
    const seenIds = new Set<string>();
    
    blocks.forEach(block => {
      // Skip duplicate IDs (happens during temp->real block transitions)
      if (seenIds.has(block.id)) {
        console.warn('Duplicate block ID detected:', block.id);
        return;
      }
      seenIds.add(block.id);
      
      const existing = groups.get(block.block_type) || [];
      existing.push(block);
      groups.set(block.block_type, existing);
    });
    return groups;
  }, [blocks]);

  // Don't render blocks until block definitions are loaded
  if (blockDefsLoading || blocks.length === 0) {
    return null;
  }

  return (
    <>
      {Array.from(groupedBlocks.entries()).map(([blockType, blocksOfType]) => {
        const blockDef = blocksMap.get(blockType);
        if (!blockDef) return null;
        
        return (
          <InstancedBlockGroup
            key={blockType}
            blocks={blocksOfType}
            blockDef={blockDef}
            geometry={geometry}
            onCollision={handleBlockCollision}
            showOwnershipOutline={showOwnershipOutline}
            currentUserId={currentUserId}
            hoveredBlockId={hoveredBlockId}
            visibleChunksRef={visibleChunksRef}
            onMeshReady={onMeshReady ? (mesh) => onMeshReady(blockType, mesh) : undefined}
            performanceMode={performanceMode}
          />
        );
      })}
    </>
  );
};