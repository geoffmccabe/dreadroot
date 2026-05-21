// Pulsing Seed Blocks - Renders fruit blocks (seeds) with animated pulsing glow effect
// Uses centralized frame loop for performance

import React, { useRef, useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { PlacedBlock } from '@/types/blocks';
import { frameLoop } from '@/lib/frameLoop';
import { useAnimatedTexture } from '@/hooks/useAnimatedTexture';
import { getBaseTreeBlockType } from '../lib/blockTypeEncoder';

interface PulsingSeedBlocksProps {
  blocks: PlacedBlock[];
  seedTexturesByTier: Map<number, string>; // tier -> fruit_texture_url
}

// Shared geometry for all seed blocks
const seedGeometry = new THREE.BoxGeometry(1, 1, 1);

// Extract tier from block_type like 'f_0_29' -> 29
function getTierFromBlockType(blockType: string): number {
  if (typeof blockType !== 'string') return 0;
  const parts = blockType.split('_');
  if (parts.length >= 3) {
    const tier = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(tier)) return tier;
  }
  return 0;
}

// Single pulsing seed block
function PulsingSeedBlock({ block, textureUrl }: { block: PlacedBlock; textureUrl: string | null }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const glowIntensityRef = useRef(0.3);
  const glowDirectionRef = useRef(1);
  const loopIdRef = useRef<string | null>(null);
  
  const { texture } = useAnimatedTexture(textureUrl || '/placeholder.svg');
  
  // Create emissive material for pulsing glow
  const material = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      map: texture,
      color: new THREE.Color(0xffffff),
      emissiveMap: texture,
      emissive: new THREE.Color(0xffffff),
      emissiveIntensity: 0.3,
      roughness: 0.6,
      metalness: 0.2,
    });
  }, [texture]);
  
  // Update texture on material when it changes
  useEffect(() => {
    if (texture && material) {
      material.map = texture;
      material.emissiveMap = texture;
      material.needsUpdate = true;
    }
  }, [texture, material]);
  
  // Register with frame loop for pulsing animation
  useEffect(() => {
    const loopId = `pulsing-seed-${block.id}`;
    loopIdRef.current = loopId;
    
    const unregister = frameLoop.register(loopId, (delta) => {
      // Pulse glow intensity between 0.2 and 0.8
      const pulseSpeed = 1.5;
      glowIntensityRef.current += glowDirectionRef.current * delta * pulseSpeed;
      
      if (glowIntensityRef.current >= 0.8) {
        glowIntensityRef.current = 0.8;
        glowDirectionRef.current = -1;
      } else if (glowIntensityRef.current <= 0.2) {
        glowIntensityRef.current = 0.2;
        glowDirectionRef.current = 1;
      }
      
      // Apply to material
      if (meshRef.current && meshRef.current.material instanceof THREE.MeshStandardMaterial) {
        meshRef.current.material.emissiveIntensity = glowIntensityRef.current;
      }
    }, 60); // Priority 60 for visual effects
    
    return unregister;
  }, [block.id]);
  
  // Cleanup material on unmount
  useEffect(() => {
    return () => {
      material.dispose();
    };
  }, [material]);
  
  return (
    <mesh
      ref={meshRef}
      geometry={seedGeometry}
      material={material}
      position={[block.position_x + 0.5, block.position_y + 0.5, block.position_z + 0.5]}
    />
  );
}

export function PulsingSeedBlocks({ blocks, seedTexturesByTier }: PulsingSeedBlocksProps) {
  // Filter to only fruit blocks
  const fruitBlocks = useMemo(() => {
    return blocks.filter(b => getBaseTreeBlockType(b.block_type) === 'fruit');
  }, [blocks]);

  if (fruitBlocks.length === 0) return null;
  
  return (
    <>
      {fruitBlocks.map(block => {
        const tier = getTierFromBlockType(block.block_type);
        const textureUrl = block.texture_url || seedTexturesByTier.get(tier) || null;
        
        return (
          <PulsingSeedBlock
            key={block.id}
            block={block}
            textureUrl={textureUrl}
          />
        );
      })}
    </>
  );
}
