// Seed Preview - Shows a flashing cube with the seed texture and T# label when in tree planting mode
// Similar to BlockPreview but for seed placement

import React, { useRef, useMemo, useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { frameLoop } from '@/lib/frameLoop';
import { calculatePlacementFast } from '@/lib/voxelRaycast';
import { Text, Billboard } from '@react-three/drei';

// Tier colors matching bullet system
// T1-3 yellow, T4-6 green, T7-9 blue, T10 purple
const TIER_COLORS: Record<number, string> = {
  1: '#FFFF00', 2: '#FFEE00', 3: '#FFDD00',
  4: '#00FF00', 5: '#00EE00', 6: '#00DD00',
  7: '#0088FF', 8: '#0066FF', 9: '#0044FF',
  10: '#8B00FF',
};

interface SeedPreviewProps {
  tier: number;
  visible: boolean;
  existingBlocks?: Array<{ position_x: number; position_y: number; position_z: number }>;
  trunkTextureUrl?: string | null;
  isFungal?: boolean;
}

export function SeedPreview({ tier, visible, existingBlocks = [], trunkTextureUrl, isFungal = false }: SeedPreviewProps) {
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
  const isFungalRef = useRef(isFungal);
  const tierRef = useRef(tier);

  useEffect(() => {
    visibleRef.current = visible;
  }, [visible]);

  useEffect(() => {
    existingBlocksRef.current = existingBlocks;
  }, [existingBlocks]);

  useEffect(() => {
    isFungalRef.current = isFungal;
  }, [isFungal]);

  useEffect(() => {
    tierRef.current = tier;
  }, [tier]);

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
        // Use tier color (yellow, green, blue, purple based on tier)
        const validColor = TIER_COLORS[tierRef.current] || '#FFFFFF';
        material.color.set(validColor);
      } else {
        material.color.setRGB(1, 0.3, 0.3); // Red for invalid
      }
    }, 70);

    return unregister;
  }, [camera, visible]);

  if (!visible) return null;

  // F1, F2, etc for fungal, T1, T2 etc for regular trees
  const tierLabel = isFungal ? `F${tier}` : `T${tier}`;
  // Use tier color system (yellow, green, blue, purple for tiers 1-10)
  const tierColor = TIER_COLORS[tier] || '#FFFFFF';

  return (
    <group ref={groupRef} position={[0, 0, 0]} visible={true}>
      <mesh ref={meshRef}>
        <boxGeometry args={[1, 1, 1]} />
        {texture ? (
          <meshBasicMaterial map={texture} transparent opacity={0.7} />
        ) : (
          <meshBasicMaterial color={tierColor} transparent opacity={0.7} />
        )}
      </mesh>
      {/* T# label that always faces the camera */}
      <Billboard follow={true} lockX={false} lockY={false} lockZ={false}>
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
      </Billboard>
    </group>
  );
}
