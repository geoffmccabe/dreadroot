// In-flight egg renderer. One InstancedMesh per tier, each carrying
// the matching shpider's body texture so a thrown T7 egg looks like a
// tiny T7 shpider body. Falls back to a neutral texture if a tier's
// shpider definition lacks a body texture.

import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import type { ShpiderEggInstance } from '../types';
import { EGG_VISUAL_RADIUS, MAX_LIVE_EGGS } from '../constants';
import type { ShpiderDefinition } from '@/features/shpider/types';

interface Props {
  eggsRef: React.RefObject<ShpiderEggInstance[]>;
  definitions: ShpiderDefinition[];
}

const NUM_TIERS = 10;
const FALLBACK_TEX = '/Bamboo_Seamless_t1.webp';

export function ShpiderEggRenderer({ eggsRef, definitions }: Props) {
  const defsByTier = useMemo(() => {
    const arr: (ShpiderDefinition | null)[] = new Array(NUM_TIERS + 1).fill(null);
    for (const d of definitions) {
      if (d.tier >= 1 && d.tier <= NUM_TIERS) arr[d.tier] = d;
    }
    return arr;
  }, [definitions]);

  const urls = useMemo(() => {
    const arr: string[] = [];
    for (let t = 1; t <= NUM_TIERS; t++) {
      arr.push(defsByTier[t]?.body_texture_url || FALLBACK_TEX);
    }
    return arr;
  }, [defsByTier]);

  const texs = useLoader(THREE.TextureLoader, urls);
  useEffect(() => {
    texs.forEach(t => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.minFilter = THREE.LinearMipMapLinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.needsUpdate = true;
    });
  }, [texs]);

  const geometry = useMemo(
    () => new THREE.SphereGeometry(EGG_VISUAL_RADIUS, 12, 10),
    [],
  );
  const materials = useMemo(
    () => texs.map(tex => new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.55,
      metalness: 0.05,
    })),
    [texs],
  );

  // One mesh ref per tier (1-indexed).
  const meshRefs = useRef<(THREE.InstancedMesh | null)[]>(
    new Array(NUM_TIERS + 1).fill(null),
  );
  const counts = useRef<Int32Array>(new Int32Array(NUM_TIERS + 1));
  const _mat4 = useMemo(() => new THREE.Matrix4(), []);

  useFrame(() => {
    const list = eggsRef.current;
    if (!list) return;
    counts.current.fill(0);
    const cap = Math.min(list.length, MAX_LIVE_EGGS);
    for (let i = 0; i < cap; i++) {
      const e = list[i];
      const tier = Math.max(1, Math.min(NUM_TIERS, e.tier));
      const mesh = meshRefs.current[tier];
      if (!mesh) continue;
      const idx = counts.current[tier]++;
      _mat4.makeTranslation(e.position.x, e.position.y, e.position.z);
      mesh.setMatrixAt(idx, _mat4);
    }
    for (let t = 1; t <= NUM_TIERS; t++) {
      const mesh = meshRefs.current[t];
      if (!mesh) continue;
      mesh.count = counts.current[t];
      mesh.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <>
      {Array.from({ length: NUM_TIERS }).map((_, idx) => {
        const tier = idx + 1;
        return (
          <instancedMesh
            key={tier}
            ref={(m) => { meshRefs.current[tier] = m; }}
            args={[geometry, materials[idx], MAX_LIVE_EGGS]}
            frustumCulled={false}
          />
        );
      })}
    </>
  );
}
