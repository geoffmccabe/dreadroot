import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { PlacedBlock } from '@/types/blocks';

interface FadeChunkEntry {
  key: string;
  blocks: PlacedBlock[];
  distanceFactor: number; // 0 = just beyond visualDistance, 1 = at max fade distance
}

interface FadeChunkBlocksProps {
  entries: FadeChunkEntry[];
}

const MAX_FADE_INSTANCES = 15000;

// Per-ring opacity: ring 1 (closest) → ring 3 (farthest, nearly invisible)
// distanceFactor: ~0.33 = ring 1, ~0.67 = ring 2, ~1.0 = ring 3
const RING_OPACITY = [0.45, 0.22, 0.08];

// Light grey base — Three.js fog will further blend toward background
const BASE_GREY = { r: 0.65, g: 0.67, b: 0.70 };

export function FadeChunkBlocks({ entries }: FadeChunkBlocksProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const tempObj = useMemo(() => new THREE.Object3D(), []);
  const tempColor = useMemo(() => new THREE.Color(), []);

  const geometry = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const material = useMemo(() => new THREE.MeshBasicMaterial({
    fog: true,
    transparent: true,
    depthWrite: false,
    vertexColors: true,
  }), []);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    let idx = 0;

    for (const entry of entries) {
      const t = entry.distanceFactor; // 0..1 across all fade rings

      // Map distanceFactor to ring index (0, 1, 2)
      const ringIdx = Math.min(2, Math.floor(t * 3));
      const opacity = RING_OPACITY[ringIdx];

      // Encode opacity into vertex color alpha via brightness scaling
      // Since MeshBasicMaterial with vertexColors multiplies color, we lighten
      // towards white as opacity decreases to simulate transparency against sky
      const fade = 1 - opacity; // 0 = full color, 1 = white
      const r = BASE_GREY.r + (1.0 - BASE_GREY.r) * fade;
      const g = BASE_GREY.g + (1.0 - BASE_GREY.g) * fade;
      const b = BASE_GREY.b + (1.0 - BASE_GREY.b) * fade;
      tempColor.setRGB(r, g, b);

      // Set material opacity to the ring's opacity
      // Since all entries share the same material, we use per-instance color
      // brightness to fake per-instance opacity

      for (const block of entry.blocks) {
        if (idx >= MAX_FADE_INSTANCES) break;

        tempObj.position.set(block.x + 0.5, block.y + 0.5, block.z + 0.5);
        tempObj.scale.set(1, 1, 1);
        tempObj.updateMatrix();
        mesh.setMatrixAt(idx, tempObj.matrix);
        mesh.setColorAt(idx, tempColor);
        idx++;
      }
      if (idx >= MAX_FADE_INSTANCES) break;
    }

    mesh.count = idx;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true;
    }

    // Use the middle ring opacity as the material-level opacity
    // Per-instance color brightness handles the per-ring variation
    mesh.material.opacity = 0.5;
  }, [entries, tempObj, tempColor]);

  if (entries.length === 0) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, MAX_FADE_INSTANCES]}
      frustumCulled={false}
      name="fade-chunk-blocks"
    />
  );
}
