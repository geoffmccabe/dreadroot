// World-egg renderer. Owner-scoped (hook only fetches own eggs), so
// every rendered egg belongs to the local player. Spinning, slightly
// bobbing, tier-tinted spheres. Sits about 0.3m off the ground for
// visibility.

import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { WorldEgg } from '../hooks/useWorldEggs';

interface Props {
  eggs: WorldEgg[];
}

const TIER_COLOR: Record<number, string> = {
  1: '#5b5040', 2: '#7a3030', 3: '#a05a18', 4: '#a09c20', 5: '#2a8030',
  6: '#208070', 7: '#2050a0', 8: '#6030a0', 9: '#9c3070', 10: '#cccccc',
};

const VISUAL_RADIUS = 0.18;
const FLOAT_HEIGHT = 0.4;
const FLOAT_AMPLITUDE = 0.08;
const FLOAT_FREQ = 1.6;

export function WorldEggRenderer({ eggs }: Props) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const _mat4 = useMemo(() => new THREE.Matrix4(), []);
  const _q = useMemo(() => new THREE.Quaternion(), []);
  const _euler = useMemo(() => new THREE.Euler(), []);
  const _pos = useMemo(() => new THREE.Vector3(), []);
  const _scale = useMemo(() => new THREE.Vector3(1, 1, 1), []);
  const _color = useMemo(() => new THREE.Color(), []);

  const geometry = useMemo(
    () => new THREE.SphereGeometry(VISUAL_RADIUS, 14, 12),
    [],
  );
  const material = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#ffffff',
    roughness: 0.4,
    metalness: 0.15,
    emissive: '#222222',
    emissiveIntensity: 0.4,
  }), []);

  // Max instances cap — owner-scoped, so this is the max eggs one
  // player can have dropped in the world at once.
  const MAX = 32;

  useFrame(({ clock }) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const t = clock.elapsedTime;
    const count = Math.min(eggs.length, MAX);
    for (let i = 0; i < count; i++) {
      const e = eggs[i];
      const bob = Math.sin(t * FLOAT_FREQ + i * 1.7) * FLOAT_AMPLITUDE;
      _pos.set(e.x, e.y + FLOAT_HEIGHT + bob, e.z);
      _euler.set(0, t * 1.2 + i, 0);
      _q.setFromEuler(_euler);
      _mat4.compose(_pos, _q, _scale);
      mesh.setMatrixAt(i, _mat4);
      _color.set(TIER_COLOR[e.tier] || '#888888');
      mesh.setColorAt(i, _color);
    }
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, 32]}
      frustumCulled={false}
    />
  );
}
