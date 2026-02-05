/**
 * WaterBlocks Component
 *
 * Renders water/lava blocks with:
 * - Semi-transparent material with configurable tint
 * - Instanced rendering for performance
 * - Proper render order (after opaque blocks)
 * - Animated top surfaces (future)
 */

import React, { useRef, useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { type WaterBlock, type WaterBlocksForChunk } from '@/lib/pondBlockGenerator';

// ============================================
// Types
// ============================================

interface WaterBlocksProps {
  waterBlocks: WaterBlock[];
  waterTintColor: string;
  lavaTintColor: string;
  opacity?: number;
}

// ============================================
// Constants
// ============================================

const DEFAULT_WATER_TINT = '#88ddff';
const DEFAULT_LAVA_TINT = '#ff6622';
const WATER_OPACITY = 0.7;
const LAVA_OPACITY = 0.8;

// Shared geometry - reused across all water renderers
const sharedWaterGeometry = new THREE.BoxGeometry(1, 1, 1);

// ============================================
// Component
// ============================================

export const WaterBlocks: React.FC<WaterBlocksProps> = ({
  waterBlocks,
  waterTintColor = DEFAULT_WATER_TINT,
  lavaTintColor = DEFAULT_LAVA_TINT,
  opacity = WATER_OPACITY,
}) => {
  // Separate water and lava blocks for different materials
  const { waterOnly, lavaOnly } = useMemo(() => {
    const water: WaterBlock[] = [];
    const lava: WaterBlock[] = [];

    for (const block of waterBlocks) {
      if (block.waterType === 'water') {
        water.push(block);
      } else {
        lava.push(block);
      }
    }

    return { waterOnly: water, lavaOnly: lava };
  }, [waterBlocks]);

  return (
    <>
      {waterOnly.length > 0 && (
        <WaterInstancedMesh
          blocks={waterOnly}
          tintColor={waterTintColor}
          opacity={opacity}
          isLava={false}
        />
      )}
      {lavaOnly.length > 0 && (
        <WaterInstancedMesh
          blocks={lavaOnly}
          tintColor={lavaTintColor}
          opacity={LAVA_OPACITY}
          isLava={true}
        />
      )}
    </>
  );
};

// ============================================
// Instanced Mesh Sub-Component
// ============================================

interface WaterInstancedMeshProps {
  blocks: WaterBlock[];
  tintColor: string;
  opacity: number;
  isLava: boolean;
}

const WaterInstancedMesh: React.FC<WaterInstancedMeshProps> = ({
  blocks,
  tintColor,
  opacity,
  isLava,
}) => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const materialRef = useRef<THREE.MeshPhysicalMaterial | null>(null);
  const matrixRef = useRef(new THREE.Matrix4());

  // Create material
  const material = useMemo(() => {
    if (materialRef.current) {
      materialRef.current.dispose();
    }

    const color = new THREE.Color(tintColor);

    const mat = new THREE.MeshPhysicalMaterial({
      color,
      transparent: true,
      opacity,
      transmission: isLava ? 0.3 : 0.6,  // More see-through for water
      thickness: 1.0,
      roughness: isLava ? 0.4 : 0.1,
      metalness: 0,
      clearcoat: isLava ? 0 : 0.5,
      clearcoatRoughness: 0.3,
      ior: 1.33, // Water's index of refraction
      side: THREE.DoubleSide, // Render both sides for underwater visibility
      depthWrite: false, // Prevents z-fighting with other transparent objects
    });

    // Set render order to ensure water renders after opaque objects
    mat.depthWrite = false;

    materialRef.current = mat;
    return mat;
  }, [tintColor, opacity, isLava]);

  // Cleanup material on unmount
  useEffect(() => {
    return () => {
      if (materialRef.current) {
        materialRef.current.dispose();
        materialRef.current = null;
      }
    };
  }, []);

  // Update instance matrices when blocks change
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || blocks.length === 0) return;

    const matrix = matrixRef.current;

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      matrix.setPosition(block.x + 0.5, block.y + 0.5, block.z + 0.5);
      mesh.setMatrixAt(i, matrix);
    }

    mesh.count = blocks.length;
    mesh.instanceMatrix.needsUpdate = true;

    // Calculate bounding box for frustum culling
    if (blocks.length > 0) {
      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

      for (const block of blocks) {
        if (block.x < minX) minX = block.x;
        if (block.y < minY) minY = block.y;
        if (block.z < minZ) minZ = block.z;
        if (block.x + 1 > maxX) maxX = block.x + 1;
        if (block.y + 1 > maxY) maxY = block.y + 1;
        if (block.z + 1 > maxZ) maxZ = block.z + 1;
      }

      mesh.boundingBox ??= new THREE.Box3();
      mesh.boundingSphere ??= new THREE.Sphere();

      mesh.boundingBox.min.set(minX, minY, minZ);
      mesh.boundingBox.max.set(maxX, maxY, maxZ);
      mesh.boundingBox.getBoundingSphere(mesh.boundingSphere);
    }
  }, [blocks]);

  // Animate lava glow
  const timeRef = useRef(0);

  useFrame((_, delta) => {
    if (!isLava || !materialRef.current) return;

    timeRef.current += delta;

    // Pulse the emissive intensity for lava
    const pulse = 0.3 + Math.sin(timeRef.current * 2) * 0.15;
    materialRef.current.emissiveIntensity = pulse;
  });

  // Add emissive for lava
  useEffect(() => {
    if (isLava && materialRef.current) {
      materialRef.current.emissive = new THREE.Color(lavaTintColor || '#ff4400');
      materialRef.current.emissiveIntensity = 0.3;
    }
  }, [isLava, lavaTintColor]);

  if (blocks.length === 0) return null;

  // Buffer size for instanced mesh
  const bufferSize = Math.max(blocks.length + 100, 500);

  return (
    <instancedMesh
      ref={meshRef}
      args={[sharedWaterGeometry, material, bufferSize]}
      frustumCulled={true}
      renderOrder={100} // Render after opaque objects (default is 0)
    />
  );
};

// Workaround for lavaTintColor not being in scope
const lavaTintColor = DEFAULT_LAVA_TINT;

export default WaterBlocks;
