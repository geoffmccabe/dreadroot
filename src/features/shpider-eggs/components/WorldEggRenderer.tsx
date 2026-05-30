// World-egg renderer. Owner-scoped (hook only fetches own eggs).
// Spinning + bobbing eggs, per-tier shpider body texture so the egg
// looks like a tiny version of the shpider that hatches from it.

import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import type { WorldEgg } from '../hooks/useWorldEggs';
import type { ShpiderDefinition } from '@/features/shpider/types';

interface Props {
  eggs: WorldEgg[];
  definitions: ShpiderDefinition[];
}

const NUM_TIERS = 10;
const FALLBACK_TEX = '/Bamboo_Seamless_t1.webp';
const VISUAL_RADIUS = 0.22;
const FLOAT_HEIGHT = 0.4;
const FLOAT_AMPLITUDE = 0.08;
const FLOAT_FREQ = 1.6;
const MAX_PER_TIER = 16;

export function WorldEggRenderer({ eggs, definitions }: Props) {
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
    () => new THREE.SphereGeometry(VISUAL_RADIUS, 14, 12),
    [],
  );
  const materials = useMemo(
    () => texs.map(tex => new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.4,
      metalness: 0.15,
      emissive: '#1a1a1a',
      emissiveIntensity: 0.35,
    })),
    [texs],
  );

  const meshRefs = useRef<(THREE.InstancedMesh | null)[]>(
    new Array(NUM_TIERS + 1).fill(null),
  );
  const counts = useRef<Int32Array>(new Int32Array(NUM_TIERS + 1));
  const _mat4 = useMemo(() => new THREE.Matrix4(), []);
  const _q = useMemo(() => new THREE.Quaternion(), []);
  const _euler = useMemo(() => new THREE.Euler(), []);
  const _pos = useMemo(() => new THREE.Vector3(), []);
  const _scale = useMemo(() => new THREE.Vector3(1, 1, 1), []);

  useFrame(({ clock }) => {
    counts.current.fill(0);
    const t = clock.elapsedTime;
    for (let i = 0; i < eggs.length; i++) {
      const e = eggs[i];
      const tier = Math.max(1, Math.min(NUM_TIERS, e.tier));
      const mesh = meshRefs.current[tier];
      if (!mesh) continue;
      const idx = counts.current[tier];
      if (idx >= MAX_PER_TIER) continue;
      counts.current[tier]++;
      const bob = Math.sin(t * FLOAT_FREQ + i * 1.7) * FLOAT_AMPLITUDE;
      _pos.set(e.x, e.y + FLOAT_HEIGHT + bob, e.z);
      _euler.set(0, t * 1.2 + i, 0);
      _q.setFromEuler(_euler);
      _mat4.compose(_pos, _q, _scale);
      mesh.setMatrixAt(idx, _mat4);
    }
    for (let t2 = 1; t2 <= NUM_TIERS; t2++) {
      const mesh = meshRefs.current[t2];
      if (!mesh) continue;
      mesh.count = counts.current[t2];
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
            args={[geometry, materials[idx], MAX_PER_TIER]}
            frustumCulled={false}
          />
        );
      })}
    </>
  );
}
