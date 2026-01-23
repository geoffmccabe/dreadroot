// Seed Preview - Shows a flashing cube with the seed texture and T# label when in tree planting mode
// Similar to BlockPreview but for seed placement

import React, { useRef, useMemo, useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { frameLoop } from '@/lib/frameLoop';
import { calculatePlacementFast } from '@/lib/voxelRaycast';
import { Text } from '@react-three/drei';

interface SeedPreviewProps {
  tier: number;
  visible: boolean;
  existingBlocks?: Array<{ position_x: number; position_y: number; position_z: number }>;
  trunkTextureUrl?: string | null;
}

export function SeedPreview({ tier, visible, existingBlocks = [], trunkTextureUrl }: SeedPreviewProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const groupRef = useRef<THREE.Group>(null);
  const { camera } = useThree();
  
  // Load texture
  const texture = useMemo(() => {
    if (!trunkTextureUrl) {
      // Default green color for seed without texture
      return null;
    }
    const loader = new THREE.TextureLoader();
    const tex = loader.load(trunkTextureUrl);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    return tex;
  }, [trunkTextureUrl]);

  // Refs for values needed in frame loop
  const visibleRef = useRef(visible);
  const existingBlocksRef = useRef(existingBlocks);
  
  useEffect(() => {
    visibleRef.current = visible;
  }, [visible]);
  
  useEffect(() => {
    existingBlocksRef.current = existingBlocks;
  }, [existingBlocks]);

  // Register frame loop callback for preview updates
  useEffect(() => {
    if (!visible) return;
    
    const unregister = frameLoop.register('seed-preview', (delta, elapsed) => {
      if (!visibleRef.current || !groupRef.current || !meshRef.current) return;
      
      // Calculate placement position
      const placementResult = calculatePlacementFast(
        camera,
        existingBlocksRef.current as any,
        5
      );
      
      // Update group position (center of block)
      groupRef.current.position.set(
        placementResult.x + 0.5,
        placementResult.y + 0.5,
        placementResult.z + 0.5
      );
      
      // Make mesh visible
      groupRef.current.visible = true;
      
      const material = meshRef.current.material as THREE.MeshBasicMaterial;
      
      // Faster pulsing for seeds (more noticeable)
      const pulseOpacity = 0.5 + Math.sin(elapsed * Math.PI * 4) * 0.4;
      
      material.transparent = true;
      material.opacity = pulseOpacity;
      
      if (placementResult.isValid) {
        material.color.set('#88ff88'); // Green tint for valid
      } else {
        material.color.setRGB(1, 0.3, 0.3); // Red for invalid
      }
    }, 70);

    return unregister;
  }, [camera, visible]);

  if (!visible) return null;

  const tierLabel = `T${tier}`;

  return (
    <group ref={groupRef} position={[0, 0, 0]} visible={true}>
      <mesh ref={meshRef}>
        <boxGeometry args={[1, 1, 1]} />
        {texture ? (
          <meshBasicMaterial map={texture} transparent opacity={0.7} />
        ) : (
          <meshBasicMaterial color="#228B22" transparent opacity={0.7} />
        )}
      </mesh>
      {/* T# label centered on the block */}
      <Text
        position={[0, 0.6, 0]}
        fontSize={0.4}
        color="white"
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.05}
        outlineColor="black"
      >
        {tierLabel}
      </Text>
    </group>
  );
}
