import React, { useRef, useMemo, useCallback, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { PlacedBlock } from '@/types/blocks';
import { useBlocksData } from '@/hooks/useBlocksData';
import { InstancedBlockGroup, activeAnimatedTextures, clearTextureCache as clearInstancedTextureCache } from './InstancedBlockGroup';

// Re-export clearTextureCache for backward compatibility
export const clearTextureCache = clearInstancedTextureCache;

// Shared geometry for performance
const SharedBlockGeometry = () => {
  return useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
};

// Track falling blocks with their current Y position - exported for stacking calculations
export const fallingBlocksState = new Map<string, { currentY: number; velocity: number; landed: boolean }>();

// Height map for O(1) stacking lookups
export const heightMap = new Map<string, number>();

// Component to render all placed blocks with collision detection using instanced rendering
export const PlacedBlocks: React.FC<{ 
  blocks: PlacedBlock[]; 
  onCollision?: (boxes: THREE.Box3[]) => void; 
}> = ({ blocks, onCollision }) => {
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
    blocks.forEach(block => {
      if (block.expires_at && !fallingBlocksState.has(block.id)) {
        // New falling block - start at Y=100
        fallingBlocksState.set(block.id, {
          currentY: 100,
          velocity: 0,
          landed: false
        });
      }
      
      // Update height map for all blocks (for O(1) stacking lookups)
      const key = `${Math.round(block.position_x)},${Math.round(block.position_z)}`;
      const currentMax = heightMap.get(key) || 0;
      heightMap.set(key, Math.max(currentMax, block.position_y));
    });
    
    // Clean up removed blocks from falling state and height map
    const blockIds = new Set(blocks.map(b => b.id));
    Array.from(fallingBlocksState.keys()).forEach(id => {
      if (!blockIds.has(id)) {
        fallingBlocksState.delete(id);
      }
    });
    
    // Rebuild height map from scratch to ensure accuracy
    heightMap.clear();
    blocks.forEach(block => {
      // Skip falling blocks that haven't landed yet
      const fallState = fallingBlocksState.get(block.id);
      if (fallState && !fallState.landed) return;
      
      const key = `${Math.round(block.position_x)},${Math.round(block.position_z)}`;
      const currentMax = heightMap.get(key) || 0;
      heightMap.set(key, Math.max(currentMax, block.position_y + 1));
    });
  }, [blocks]);
  
  // Physics update for falling blocks (no React re-renders, just update state)
  useFrame((state, delta) => {
    const gravity = 9.8;
    
    // Apply gravity to falling blocks
    fallingBlocksState.forEach((fallState, blockId) => {
      if (fallState.landed) return;
      
      const block = blocks.find(b => b.id === blockId);
      if (!block) return;
      
      // Apply gravity
      fallState.velocity += gravity * delta;
      fallState.currentY -= fallState.velocity * delta;
      
      // Find the correct landing height (ground or top of stack)
      const key = `${Math.round(block.position_x)},${Math.round(block.position_z)}`;
      const stackHeight = heightMap.get(key) || 0;
      const landingY = stackHeight;
      
      // Check if landed
      if (fallState.currentY <= landingY) {
        fallState.currentY = landingY;
        fallState.velocity = 0;
        fallState.landed = true;
        
        // Update height map when block lands
        heightMap.set(key, landingY + 1);
        
        // Play thud sound (throttled)
        const now = Date.now();
        if (audioRef.current && now - lastThudTime.current > 50) {
          audioRef.current.currentTime = 0;
          audioRef.current.play().catch(() => {});
          lastThudTime.current = now;
        }
      }
    });
    
    // Update animated textures
    if (activeAnimatedTextures.size > 0) {
      activeAnimatedTextures.forEach((updateFn) => {
        updateFn(delta);
      });
    }
  });

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
  const groupedBlocks = useMemo(() => {
    const groups = new Map<string, PlacedBlock[]>();
    
    blocks.forEach(block => {
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
          />
        );
      })}
    </>
  );
};