import React, { useRef, useMemo, useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { Text, Billboard } from '@react-three/drei';
import { useBlocksData } from '@/hooks/useBlocksData';
import { calculatePlacementFast } from '@/lib/voxelRaycast';
import { useAnimatedTexture } from '@/hooks/useAnimatedTexture';
import { frameLoop } from '@/lib/frameLoop';
import { parseStripMetadata } from '@/lib/animationToStrip';
import { applyStripAnimation } from '@/lib/stripAnimationMaterial';

interface BlockPreviewProps {
  blockType: string;
  visible: boolean;
  existingBlocks?: Array<{ position_x: number; position_y: number; position_z: number }>;
  // Admins/superadmins sculpting the fortress: skip the fortress + waterfall no-build
  // zones so the cursor reads valid (white) where placement is now allowed.
  bypassZoneRestrictions?: boolean;
}

export const BlockPreview: React.FC<BlockPreviewProps> = ({ blockType, visible, existingBlocks = [], bypassZoneRestrictions = false }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const groupRef = useRef<THREE.Group>(null);
  const { camera, clock } = useThree();
  const { getBlockByKey, blocksMap } = useBlocksData();

  // Get block definition from database - depend on blocksMap.size to re-run when blocks load
  const blockDef = useMemo(() => getBlockByKey(blockType), [blockType, blocksMap.size]);

  // Get tier from block definition
  const tier = blockDef?.tier ?? 1;
  
  // Load texture with animated GIF support - use block's texture or default grass texture
  const textureUrl = blockDef?.texture?.diffuse || '/grass_texture_seamless.webp';
  const { texture } = useAnimatedTexture(textureUrl);

  // v4.12.15: if the texture URL is a sprite-strip WebP, animate it on the
  // GPU via shader UV-offset (zero per-tick CPU cost) instead of the legacy
  // GIF decode. parseStripMetadata returns null for plain static textures,
  // so the non-strip path below is untouched.
  const strip = useMemo(() => parseStripMetadata(textureUrl), [textureUrl]);

  // Set up texture properties
  useMemo(() => {
    if (!texture) return;
    if (strip) {
      // Strip UVs are computed in-shader and stay within [0,1); clamp wrap
      // avoids any edge bleed at the strip boundaries.
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
    } else {
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(1, 1);
    }
  }, [texture, strip]);

  // Attach the strip-animation shader to the preview material once both the
  // texture and strip metadata are ready.
  useEffect(() => {
    if (!strip || !meshRef.current) return;
    const material = meshRef.current.material as THREE.MeshBasicMaterial;
    applyStripAnimation(material, strip.frames, strip.delay);
  }, [strip, texture]);

  // Store refs to props for use in frame callback
  const visibleRef = useRef(visible);
  const existingBlocksRef = useRef(existingBlocks);
  const bypassRef = useRef(bypassZoneRestrictions);
  useEffect(() => { visibleRef.current = visible; }, [visible]);
  useEffect(() => { existingBlocksRef.current = existingBlocks; }, [existingBlocks]);
  useEffect(() => { bypassRef.current = bypassZoneRestrictions; }, [bypassZoneRestrictions]);

  // Register with centralized frame loop instead of useFrame
  useEffect(() => {
    const unregister = frameLoop.register('block-preview', (delta, elapsed) => {
      // Early exit for invisible - minimal overhead
      if (!visibleRef.current || !groupRef.current || !meshRef.current) return;

      // Calculate EVERY FRAME - voxel raycast is now O(1), no throttling needed
      const placementResult = calculatePlacementFast(
        camera,
        existingBlocksRef.current as any,
        5,
        bypassRef.current
      );

      // Update group position (so both mesh and text move together)
      groupRef.current.position.set(
        placementResult.x + 0.5,
        placementResult.y + 0.5,
        placementResult.z + 0.5
      );

      // Change material based on valid placement
      const material = meshRef.current.material as THREE.MeshBasicMaterial;

      // Pulsing opacity effect
      const pulseOpacity = 0.5 + Math.sin(elapsed * Math.PI * 2) * 0.3;

      material.transparent = true;
      material.opacity = 0.5 + pulseOpacity;

      if (placementResult.isValid) {
        material.color.set('#ffffff');
      } else {
        material.color.setRGB(1, 0.3, 0.3);
      }
    }, 70); // Lower priority

    return unregister;
  }, [camera]);

  if (!visible || !texture) return null;

  return (
    <group ref={groupRef} position={[0, -10000, 0]}>
      <mesh ref={meshRef}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial
          map={texture}
          transparent
          opacity={0.8}
          color={'#ffffff'}
        />
      </mesh>
      {/* T# label that always faces the camera */}
      <Billboard follow={true} lockX={false} lockY={false} lockZ={false}>
        <Text
          position={[0, 0.7, 0]}
          fontSize={0.35}
          color="white"
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.04}
          outlineColor="black"
        >
          {`T${tier}`}
        </Text>
      </Billboard>
    </group>
  );
};
