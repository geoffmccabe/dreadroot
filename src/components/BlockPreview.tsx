import React, { useRef, useState, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useBlocksData } from '@/hooks/useBlocksData';
import { calculateBlockPlacement } from '@/lib/blockPlacement';
import { useAnimatedTexture } from '@/hooks/useAnimatedTexture';

interface BlockPreviewProps {
  blockType: string;
  visible: boolean;
  existingBlocks?: Array<{ position_x: number; position_y: number; position_z: number }>;
}

export const BlockPreview: React.FC<BlockPreviewProps> = ({ blockType, visible, existingBlocks = [] }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const { camera, clock } = useThree();
  const [previewPosition, setPreviewPosition] = useState<THREE.Vector3>(new THREE.Vector3());
  const { getBlockByKey } = useBlocksData();
  
  // Throttle expensive raycasting
  const frameCountRef = useRef(0);
  const cachedPlacementRef = useRef<any>(null);
  
  // Get block definition from database
  const blockDef = useMemo(() => getBlockByKey(blockType), [blockType, getBlockByKey]);
  
  // Load texture with animated GIF support
  const textureUrl = blockDef?.texture?.diffuse || '/cliff_texture_seamless.webp';
  const { texture, isAnimated } = useAnimatedTexture(textureUrl);
  
  // Set up texture properties
  useMemo(() => {
    if (!texture) return;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1, 1);
  }, [texture]);

  useFrame((state, delta) => {
    frameCountRef.current++;
    
    if (!visible || !meshRef.current) return;

    // Throttle raycasting to every 3 frames (20 FPS instead of 60 FPS)
    if (frameCountRef.current % 3 === 0 || !cachedPlacementRef.current) {
      cachedPlacementRef.current = calculateBlockPlacement({
        camera,
        existingBlocks: existingBlocks as any,
        maxDistance: 5,
      });
    }
    
    const placementResult = cachedPlacementRef.current;
    
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
    
    // Pulsing opacity effect (30% to 60% every second)
    const time = clock.getElapsedTime();
    const pulseOpacity = 0.45 + Math.sin(time * Math.PI * 2) * 0.15; // Oscillates between 0.3 and 0.6
    
    material.transparent = true;
    material.opacity = isTransparent ? pulseOpacity * 0.7 : pulseOpacity;
    
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