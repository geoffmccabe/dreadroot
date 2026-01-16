import React, { useRef, useMemo, useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useBlocksData } from '@/hooks/useBlocksData';
import { calculateBlockPlacement } from '@/lib/blockPlacement';
import { useAnimatedTexture } from '@/hooks/useAnimatedTexture';
import { frameLoop } from '@/lib/frameLoop';

interface BlockPreviewProps {
  blockType: string;
  visible: boolean;
  existingBlocks?: Array<{ position_x: number; position_y: number; position_z: number }>;
}

export const BlockPreview: React.FC<BlockPreviewProps> = ({ blockType, visible, existingBlocks = [] }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const { camera, clock } = useThree();
  const { getBlockByKey } = useBlocksData();
  
  // Performance optimization: throttle calculations
  const frameCountRef = useRef(0);
  const lastCameraPosRef = useRef(new THREE.Vector3());
  const lastCameraRotRef = useRef(0);
  const cachedResultRef = useRef<{ renderPosition: THREE.Vector3; isValid: boolean } | null>(null);
  
  // Get block definition from database
  const blockDef = useMemo(() => getBlockByKey(blockType), [blockType, getBlockByKey]);
  
  // Load texture with animated GIF support
  const textureUrl = blockDef?.texture?.diffuse || '/cliff_texture_seamless.webp';
  const { texture } = useAnimatedTexture(textureUrl);
  
  // Set up texture properties
  useMemo(() => {
    if (!texture) return;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1, 1);
  }, [texture]);

  // Store refs to props for use in frame callback
  const visibleRef = useRef(visible);
  const existingBlocksRef = useRef(existingBlocks);
  useEffect(() => { visibleRef.current = visible; }, [visible]);
  useEffect(() => { existingBlocksRef.current = existingBlocks; }, [existingBlocks]);

  // Register with centralized frame loop instead of useFrame
  useEffect(() => {
    const unregister = frameLoop.register('block-preview', (delta, elapsed) => {
      // Early exit for invisible - minimal overhead
      if (!visibleRef.current || !meshRef.current) return;
      
      frameCountRef.current++;
      
      // Check if camera moved significantly
      const cameraMoved = camera.position.distanceToSquared(lastCameraPosRef.current) > 0.001;
      const cameraRotated = Math.abs(camera.rotation.y - lastCameraRotRef.current) > 0.01;
      
      // Only recalculate every 5 frames OR if camera moved/rotated significantly
      const shouldRecalculate = frameCountRef.current % 5 === 0 || cameraMoved || cameraRotated;
      
      if (shouldRecalculate || !cachedResultRef.current) {
        const placementResult = calculateBlockPlacement({
          camera,
          existingBlocks: existingBlocksRef.current as any,
          maxDistance: 5,
        });
        
        cachedResultRef.current = {
          renderPosition: placementResult.renderPosition || new THREE.Vector3(),
          isValid: placementResult.isValid
        };
        
        lastCameraPosRef.current.copy(camera.position);
        lastCameraRotRef.current = camera.rotation.y;
      }
      
      // Use cached result
      const { renderPosition, isValid } = cachedResultRef.current;
      meshRef.current.position.copy(renderPosition);
      
      // Change material based on valid placement
      const material = meshRef.current.material as THREE.MeshBasicMaterial;
      
      // Pulsing opacity effect
      const pulseOpacity = 0.5 + Math.sin(elapsed * Math.PI * 2) * 0.5;
      
      material.transparent = true;
      material.opacity = pulseOpacity;
      
      if (isValid) {
        material.color.set('#ffffff');
      } else {
        material.color.setRGB(1, 0.3, 0.3);
      }
    }, 70); // Lower priority
    
    return unregister;
  }, [camera]);

  if (!visible || !texture) return null;

  return (
    <mesh ref={meshRef} position={[0, -10000, 0]}>
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
