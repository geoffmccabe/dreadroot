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

const MAX_FADE_INSTANCES = 10000;

// Grey tint endpoints: near fade = medium grey, far fade = light grey (approaches fog)
const NEAR_GREY = { r: 0.50, g: 0.52, b: 0.55 };
const FAR_GREY = { r: 0.70, g: 0.72, b: 0.73 };

export function FadeChunkBlocks({ entries }: FadeChunkBlocksProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const tempObj = useMemo(() => new THREE.Object3D(), []);
  const tempColor = useMemo(() => new THREE.Color(), []);

  const geometry = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const material = useMemo(() => new THREE.MeshBasicMaterial({
    fog: true,
    vertexColors: true,
  }), []);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    let idx = 0;

    for (const entry of entries) {
      const t = entry.distanceFactor;
      // Lerp between near and far grey
      const r = NEAR_GREY.r + (FAR_GREY.r - NEAR_GREY.r) * t;
      const g = NEAR_GREY.g + (FAR_GREY.g - NEAR_GREY.g) * t;
      const b = NEAR_GREY.b + (FAR_GREY.b - NEAR_GREY.b) * t;
      tempColor.setRGB(r, g, b);

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
