import React, { useRef, useState, useEffect } from 'react';
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
  
  // Use ref for physics state to avoid re-renders during animation
  const fallingBlocksRef = useRef<Map<string, FallingBlock>>(new Map());
  const [renderTrigger, setRenderTrigger] = useState(0);
  
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastThudTime = useRef(0);
  const lastUpdateTime = useRef(0);
  const RENDER_THROTTLE = 50; // ms between React re-renders
  
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
    let hasChanges = false;

    blocks.forEach(block => {
      if (!fallingBlocksRef.current.has(block.id)) {
        // New block - start it at Y=100, falling
        fallingBlocksRef.current.set(block.id, {
          ...block,
          currentY: 100,
          velocity: 0,
          falling: true
        });
        hasChanges = true;
      }
    });

    // Remove blocks that no longer exist
    Array.from(fallingBlocksRef.current.keys()).forEach(id => {
      if (!blocks.find(b => b.id === id)) {
        fallingBlocksRef.current.delete(id);
        hasChanges = true;
      }
    });

    if (hasChanges) {
      setRenderTrigger(prev => prev + 1);
    }
  }, [blocks]);

  // Physics update - uses refs to avoid state updates every frame
  useFrame((state, delta) => {
    if (fallingBlocksRef.current.size === 0) return;
    
    const gravity = 9.8;
    let hasLanded = false;
    const now = Date.now();

    fallingBlocksRef.current.forEach((block, id) => {
      if (!block.falling) return;
      
      // Apply gravity - mutate ref directly
      block.velocity += gravity * delta;
      block.currentY -= block.velocity * delta;

      // Check if landed at target position
      if (block.currentY <= block.position_y) {
        block.currentY = block.position_y;
        block.falling = false;
        
        // Play thud sound (throttled)
        if (audioRef.current && now - lastThudTime.current > 50) {
          audioRef.current.currentTime = 0;
          audioRef.current.play().catch(() => {});
          lastThudTime.current = now;
        }

        if (onLanded) {
          onLanded(id);
        }

        // Remove landed block from ref
        fallingBlocksRef.current.delete(id);
        hasLanded = true;
      }
    });

    // Only trigger React re-render when blocks land or periodically for position updates
    if (hasLanded || (fallingBlocksRef.current.size > 0 && now - lastUpdateTime.current > RENDER_THROTTLE)) {
      lastUpdateTime.current = now;
      setRenderTrigger(prev => prev + 1);
    }
  });

  return (
    <>
      {Array.from(fallingBlocksRef.current.values()).map((block: FallingBlock) => {
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
  const { texture, isAnimated } = useAnimatedTexture(
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
