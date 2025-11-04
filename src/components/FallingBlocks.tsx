import React, { useRef, useMemo, useState, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { PlacedBlock } from '@/types/blocks';
import { useBlocksData } from '@/hooks/useBlocksData';
import { useAnimatedTexture } from '@/hooks/useAnimatedTexture';

interface FallingBlock extends PlacedBlock {
  currentY: number;
  velocity: number;
  falling: boolean;
}

export const FallingBlocks: React.FC<{ 
  blocks: PlacedBlock[];
  onLanded?: (blockId: string) => void;
}> = ({ blocks, onLanded }) => {
  const { blocksMap } = useBlocksData();
  const [fallingBlocks, setFallingBlocks] = useState<Map<string, FallingBlock>>(new Map());
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

  // Track new blocks and initialize them as falling from Y=100
  useEffect(() => {
    const newFallingBlocks = new Map(fallingBlocks);
    let hasChanges = false;

    blocks.forEach(block => {
      if (!newFallingBlocks.has(block.id)) {
        // New block - start it at Y=100, falling
        newFallingBlocks.set(block.id, {
          ...block,
          currentY: 100,
          velocity: 0,
          falling: true
        });
        hasChanges = true;
      }
    });

    // Remove blocks that no longer exist
    Array.from(newFallingBlocks.keys()).forEach(id => {
      if (!blocks.find(b => b.id === id)) {
        newFallingBlocks.delete(id);
        hasChanges = true;
      }
    });

    if (hasChanges) {
      setFallingBlocks(newFallingBlocks);
    }
  }, [blocks]);

  // Physics update
  useFrame((state, delta) => {
    const gravity = 9.8;
    let hasUpdates = false;
    const newFallingBlocks = new Map(fallingBlocks);

    newFallingBlocks.forEach((block, id) => {
      // Apply gravity
      const newVelocity = block.velocity + gravity * delta;
      const newY = block.currentY - newVelocity * delta;

      // Check if landed at target position
      if (newY <= block.position_y) {
        // Play thud sound (throttled)
        const now = Date.now();
        if (audioRef.current && now - lastThudTime.current > 50) {
          audioRef.current.currentTime = 0;
          audioRef.current.play().catch(() => {});
          lastThudTime.current = now;
        }

        if (onLanded) {
          onLanded(id);
        }

        // Remove the block from falling blocks since it has landed
        newFallingBlocks.delete(id);
        hasUpdates = true;
      } else {
        block.currentY = newY;
        block.velocity = newVelocity;
        hasUpdates = true;
      }
    });

    if (hasUpdates) {
      setFallingBlocks(new Map(newFallingBlocks));
    }
  });

  return (
    <>
      {Array.from(fallingBlocks.values()).map(block => {
        const blockDef = blocksMap.get(block.block_type);
        if (!blockDef) return null;

        return (
          <FallingBlockMesh
            key={block.id}
            block={block}
            blockDef={blockDef}
          />
        );
      })}
    </>
  );
};

const FallingBlockMesh: React.FC<{
  block: FallingBlock;
  blockDef: any;
}> = ({ block, blockDef }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const { texture, updateTexture, isAnimated } = useAnimatedTexture(
    blockDef.texture_url
  );

  useFrame((state, delta) => {
    if (!meshRef.current) return;
    
    // Update position
    meshRef.current.position.set(
      block.position_x,
      block.currentY,
      block.position_z
    );

    // Update animated texture
    if (isAnimated && updateTexture) {
      updateTexture(delta);
    }

    // Add slight rotation while falling for visual effect
    if (block.falling) {
      meshRef.current.rotation.x += delta * 2;
      meshRef.current.rotation.z += delta * 1.5;
    } else {
      // Snap to no rotation when landed
      meshRef.current.rotation.set(0, 0, 0);
    }
  });

  return (
    <mesh ref={meshRef}>
      <boxGeometry args={[1, 1, 1]} />
      <meshLambertMaterial 
        map={texture}
        transparent={blockDef.properties?.transparent ?? false}
        opacity={blockDef.properties?.opacity ?? 1}
      />
    </mesh>
  );
};
