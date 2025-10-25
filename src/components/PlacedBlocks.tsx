import React, { useRef, useMemo, useCallback } from 'react';
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

// Component to render all placed blocks with collision detection using instanced rendering
export const PlacedBlocks: React.FC<{ 
  blocks: PlacedBlock[]; 
  onCollision?: (boxes: THREE.Box3[]) => void; 
}> = ({ blocks, onCollision }) => {
  const collisionBoxes = useRef<Map<string, THREE.Box3>>(new Map());
  const geometry = SharedBlockGeometry();
  
  // Ensure block definitions are loaded before rendering any blocks
  const { isLoading: blockDefsLoading, blocksMap } = useBlocksData();
  
  // Single useFrame to update ALL animated textures (called once per frame, not once per block)
  useFrame((state, delta) => {
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