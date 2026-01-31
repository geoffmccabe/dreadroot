import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { PlacedBlock } from '@/types/blocks';

interface FadeChunkEntry {
  key: string;
  blocks: PlacedBlock[];
  distanceFactor: number; // 0..1 across fade rings
}

interface FadeChunkBlocksProps {
  entries: FadeChunkEntry[];
}

const MAX_INSTANCES_PER_RING = 5000;

// Per-ring settings: opacity drops sharply, color lightens toward sky
const RINGS = [
  { opacity: 0.40, color: new THREE.Color(0.60, 0.62, 0.65) }, // Ring 1: visible silhouette
  { opacity: 0.18, color: new THREE.Color(0.72, 0.73, 0.75) }, // Ring 2: faint
  { opacity: 0.06, color: new THREE.Color(0.85, 0.85, 0.86) }, // Ring 3: barely there
];

function FadeRing({ blocks, ring }: { blocks: PlacedBlock[]; ring: number }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const tempObj = useMemo(() => new THREE.Object3D(), []);
  const geometry = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const material = useMemo(() => new THREE.MeshBasicMaterial({
    fog: true,
    transparent: true,
    depthWrite: false,
    color: RINGS[ring].color,
    opacity: RINGS[ring].opacity,
  }), [ring]);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const count = Math.min(blocks.length, MAX_INSTANCES_PER_RING);
    for (let i = 0; i < count; i++) {
      const block = blocks[i];
      tempObj.position.set(block.x + 0.5, block.y + 0.5, block.z + 0.5);
      tempObj.scale.set(1, 1, 1);
      tempObj.updateMatrix();
      mesh.setMatrixAt(i, tempObj.matrix);
    }

    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
  }, [blocks, tempObj]);

  if (blocks.length === 0) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, MAX_INSTANCES_PER_RING]}
      frustumCulled={false}
      name={`fade-ring-${ring}`}
    />
  );
}

export function FadeChunkBlocks({ entries }: FadeChunkBlocksProps) {
  // Bucket entries into 3 rings by distanceFactor
  const ringBlocks = useMemo(() => {
    const rings: [PlacedBlock[], PlacedBlock[], PlacedBlock[]] = [[], [], []];
    for (const entry of entries) {
      // distanceFactor: 0.33 = ring 0, 0.67 = ring 1, 1.0 = ring 2
      const ringIdx = Math.min(2, Math.round(entry.distanceFactor * 3) - 1);
      const idx = Math.max(0, ringIdx);
      for (const block of entry.blocks) {
        rings[idx].push(block);
      }
    }
    return rings;
  }, [entries]);

  if (entries.length === 0) return null;

  return (
    <>
      {ringBlocks[0].length > 0 && <FadeRing blocks={ringBlocks[0]} ring={0} />}
      {ringBlocks[1].length > 0 && <FadeRing blocks={ringBlocks[1]} ring={1} />}
      {ringBlocks[2].length > 0 && <FadeRing blocks={ringBlocks[2]} ring={2} />}
    </>
  );
}
