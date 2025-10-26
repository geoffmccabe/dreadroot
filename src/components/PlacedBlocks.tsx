import React, { useRef, useMemo, useCallback, useState, useEffect } from 'react';
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

// Track falling blocks with their current Y position
const fallingBlocksState = new Map<string, { currentY: number; velocity: number; landed: boolean }>();

// Component to render all placed blocks with collision detection using instanced rendering
export const PlacedBlocks: React.FC<{ 
  blocks: PlacedBlock[]; 
  onCollision?: (boxes: THREE.Box3[]) => void; 
}> = ({ blocks, onCollision }) => {
  const collisionBoxes = useRef<Map<string, THREE.Box3>>(new Map());
  const geometry = SharedBlockGeometry();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastThudTime = useRef(0);
  const [, forceUpdate] = useState(0);
  
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
  
  // Initialize falling state for new blocks with expires_at
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
    });
    
    // Clean up removed blocks
    const blockIds = new Set(blocks.map(b => b.id));
    Array.from(fallingBlocksState.keys()).forEach(id => {
      if (!blockIds.has(id)) {
        fallingBlocksState.delete(id);
      }
    });
  }, [blocks]);
  
  // Physics update for falling blocks
  useFrame((state, delta) => {
    const gravity = 9.8;
    let hasUpdates = false;
    
    fallingBlocksState.forEach((fallState, blockId) => {
      if (fallState.landed) return;
      
      const block = blocks.find(b => b.id === blockId);
      if (!block) return;
      
      // Apply gravity
      fallState.velocity += gravity * delta;
      fallState.currentY -= fallState.velocity * delta;
      hasUpdates = true;
      
      // Check if landed
      if (fallState.currentY <= block.position_y) {
        fallState.currentY = block.position_y;
        fallState.velocity = 0;
        fallState.landed = true;
        
        // Play thud sound (throttled)
        const now = Date.now();
        if (audioRef.current && now - lastThudTime.current > 50) {
          audioRef.current.currentTime = 0;
          audioRef.current.play().catch(() => {});
          lastThudTime.current = now;
        }
      }
    });
    
    // Force re-render if blocks are moving
    if (hasUpdates) {
      forceUpdate(prev => prev + 1);
    }
    
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

  // Group blocks by block_type for instanced rendering
  const groupedBlocks = useMemo(() => {
    const groups = new Map<string, PlacedBlock[]>();
    
    // Adjust Y position for falling blocks
    const adjustedBlocks = blocks.map(block => {
      const fallState = fallingBlocksState.get(block.id);
      if (fallState && !fallState.landed) {
        return { ...block, position_y: fallState.currentY };
      }
      return block;
    });
    
    adjustedBlocks.forEach(block => {
      const existing = groups.get(block.block_type) || [];
      existing.push(block);
      groups.set(block.block_type, existing);
    });
    return groups;
  }, [blocks]); // Re-compute each render when falling

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