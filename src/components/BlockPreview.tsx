import React, { useRef, useState, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useBlocksCache } from '@/hooks/useBlocksCache';
import { calculateBlockPlacement } from '@/lib/blockPlacement';
import { useCachedTexture } from '@/hooks/useCachedTexture';

interface BlockPreviewProps {
  blockType: string;
  visible: boolean;
  existingBlocks?: Array<{ position_x: number; position_y: number; position_z: number }>;
}

export const BlockPreview: React.FC<BlockPreviewProps> = ({ blockType, visible, existingBlocks = [] }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const { camera } = useThree();
  const [previewPosition, setPreviewPosition] = useState<THREE.Vector3>(new THREE.Vector3());
  const { getBlockByKey } = useBlocksCache();
  
  // Get block definition from cache
  const blockDef = useMemo(() => getBlockByKey(blockType), [blockType, getBlockByKey]);
  
  // Load texture with caching
  const textureUrl = blockDef?.texture?.diffuse || '/cliff_texture_seamless.webp';
  const { texture, updateTexture, isAnimated } = useCachedTexture(textureUrl);
  
  // Set up texture properties
  useMemo(() => {
    if (!texture) return;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1, 1);
  }, [texture]);

  useFrame((state, delta) => {
    // Update animated texture
    if (isAnimated && updateTexture) {
      updateTexture(delta);
    }
    
    if (!visible || !meshRef.current) return;

    // Use centralized block placement system to get accurate placement position
    // This ensures preview matches actual placement (including overlap detection)
    const placementResult = calculateBlockPlacement({
      camera,
      existingBlocks: existingBlocks as any,
      maxDistance: 5,
    });
    
    // Use placement result for positioning and validity
    const newPosition = placementResult.position || new THREE.Vector3();
    const renderPosition = placementResult.renderPosition || new THREE.Vector3();
    const isValid = placementResult.isValid;
    
    setPreviewPosition(newPosition);
    meshRef.current.position.copy(renderPosition);
    
    // Change material based on valid placement and block properties
    const material = meshRef.current.material as THREE.MeshLambertMaterial;
    
    // Base block properties from registry
    const baseColor = blockDef?.properties?.color || '#ffffff';
    const isEmissive = blockDef?.properties?.emissive || false;
    const isTransparent = blockDef?.properties?.transparent || false;
    
    material.transparent = true;
    material.opacity = isTransparent ? 0.5 : 0.7;
    
    if (isValid) {
      material.color.set(baseColor);
      if (isEmissive) {
        material.emissive.set(baseColor);
        const glowFactor = blockDef?.properties?.glowFactor || 3.0;
        material.emissiveIntensity = glowFactor * 0.5;
      } else {
        material.emissive.setRGB(0, 0, 0);
        material.emissiveIntensity = 0;
      }
    } else {
      material.color.setRGB(1, 0.2, 0.2); // Red tint for invalid placement
      material.emissive.setRGB(0.3, 0.1, 0.1); // Add red glow
      material.emissiveIntensity = 0.5;
    }
  });

  if (!visible || !texture) return null;

  return (
    <mesh ref={meshRef} position={[0, 0, 0]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshLambertMaterial 
        map={texture}
        transparent 
        opacity={blockDef?.properties?.transparent ? 0.5 : 0.7}
        color={blockDef?.properties?.color || '#ffffff'}
        emissive={blockDef?.properties?.emissive ? (blockDef?.properties?.color || '#FFE135') : '#000000'}
        emissiveIntensity={blockDef?.properties?.emissive ? (blockDef?.properties?.glowFactor || 3.0) * 0.5 : 0}
      />
    </mesh>
  );
};