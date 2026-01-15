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
    if (!visible || !meshRef.current) return;

    // Calculate block placement every frame for accurate positioning
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
    
    // Change material based on valid placement - use MeshBasicMaterial (no lighting)
    const material = meshRef.current.material as THREE.MeshBasicMaterial;
    
    // Pulsing opacity effect: cycle from fully visible (1.0) to fully transparent (0.0)
    // Full cycle takes 1 second (0.5s visible to transparent, 0.5s back)
    const time = clock.getElapsedTime();
    const pulseOpacity = 0.5 + Math.sin(time * Math.PI * 2) * 0.5; // Oscillates between 0.0 and 1.0
    
    material.transparent = true;
    material.opacity = pulseOpacity;
    
    if (isValid) {
      // Keep the block looking normal (white color lets texture show through)
      material.color.set('#ffffff');
    } else {
      // Red tint for invalid placement
      material.color.setRGB(1, 0.3, 0.3);
    }
  });

  if (!visible || !texture) return null;

  // Use MeshBasicMaterial to prevent lighting from darkening the preview
  // This ensures the block looks exactly like placed blocks at full brightness
  return (
    <mesh ref={meshRef} position={[0, 0, 0]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial 
        map={texture}
        transparent 
        opacity={0.8}
        color={'#ffffff'}
      />
    </mesh>
  );
};