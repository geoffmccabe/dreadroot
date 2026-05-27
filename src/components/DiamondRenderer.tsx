// Renders diamonds spawned on trees (the 6-in-a-row owner-harvest bonus
// reward). Visually distinct from fruits: a small cut-diamond shape (cone
// pointing down) with bright emissive white/blue and a slow spin. Lives
// in the same tree_fruits table as fruits but with fruit_code='diamond';
// FruitRenderer filters those out so we own the rendering here.

import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { TreeFruit } from '@/features/trees/types';

interface Props {
  treeFruits: TreeFruit[];
  cameraRef: React.RefObject<THREE.Camera>;
  loadedChunksRef?: React.RefObject<Map<string, any> | null>;
  renderedChunkKeys: Set<string>;
  adminSeeAll?: boolean;
  visibilityRange?: number;
}

const CHUNK_SIZE = 16;
const MAX_DIAMONDS = 64;
const DIAMOND_SCALE = 0.45;

// Geometry: a short cone pointing down (apex at bottom = classic gem
// silhouette). 8 sides for a faceted look without overdoing triangles.
function buildDiamondGeometry(): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(DIAMOND_SCALE, DIAMOND_SCALE * 1.4, 8);
  // ConeGeometry points up by default — flip so apex is down.
  g.rotateX(Math.PI);
  return g;
}

export function DiamondRenderer({
  treeFruits,
  cameraRef,
  renderedChunkKeys,
  adminSeeAll = false,
  visibilityRange = 80,
}: Props) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const _mat4 = useMemo(() => new THREE.Matrix4(), []);
  const _quat = useMemo(() => new THREE.Quaternion(), []);
  const _eul = useMemo(() => new THREE.Euler(), []);
  const _vec = useMemo(() => new THREE.Vector3(), []);

  const geometry = useMemo(() => buildDiamondGeometry(), []);
  const material = useMemo(() => {
    // Bright blue-white emissive. depthWrite stays true so it occludes
    // tree blocks behind it. We're not additive — diamonds are solid.
    return new THREE.MeshStandardMaterial({
      color: '#cce7ff',
      emissive: '#7fbfff',
      emissiveIntensity: 1.6,
      roughness: 0.15,
      metalness: 0.7,
    });
  }, []);

  // Diamonds we'll render this frame (filtered + within range).
  const visibleBuf = useRef<Array<{ fruit: TreeFruit; distSq: number }>>(
    Array.from({ length: MAX_DIAMONDS }, () => ({ fruit: null as any, distSq: 0 }))
  );

  useFrame((_, dt) => {
    const mesh = meshRef.current;
    const cam = cameraRef.current;
    if (!mesh || !cam) return;
    const camPos = cam.position;
    const rangeSq = visibilityRange * visibilityRange;
    const buf = visibleBuf.current;
    let count = 0;
    for (const f of treeFruits) {
      if (f.fruit_code !== 'diamond') continue;
      if (!adminSeeAll) {
        const cx = Math.floor(f.position_x / CHUNK_SIZE);
        const cz = Math.floor(f.position_z / CHUNK_SIZE);
        if (!renderedChunkKeys.has(`chunk_${cx}_${cz}`)) continue;
      }
      const dx = f.position_x + 0.5 - camPos.x;
      const dy = f.position_y + 0.5 - camPos.y;
      const dz = f.position_z + 0.5 - camPos.z;
      const distSq = dx * dx + dy * dy + dz * dz;
      if (distSq > rangeSq) continue;
      if (count >= MAX_DIAMONDS) break;
      buf[count].fruit = f;
      buf[count].distSq = distSq;
      count++;
    }

    // Slow spin animation — feels alive without being distracting.
    // Same yaw for all diamonds in a frame is fine; they're not aligned
    // to each other in the world, so they'll appear individually spinning.
    spinYawRef.current = (spinYawRef.current + dt * 1.2) % (Math.PI * 2);
    const yaw = spinYawRef.current;

    for (let i = 0; i < count; i++) {
      const f = buf[i].fruit;
      _vec.set(f.position_x + 0.5, f.position_y + 0.5, f.position_z + 0.5);
      _eul.set(0, yaw, 0);
      _quat.setFromEuler(_eul);
      _mat4.compose(_vec, _quat, new THREE.Vector3(1, 1, 1));
      mesh.setMatrixAt(i, _mat4);
    }

    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
  });

  const spinYawRef = useRef(0);

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, MAX_DIAMONDS]}
      frustumCulled={false}
      castShadow={false}
      receiveShadow={false}
    />
  );
}
