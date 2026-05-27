// Instanced renderer for live thrown Shpider Eggs. Small dark spheres
// with the egg's tier color hint. Texture-per-tier is deferred to a
// later phase — for now just colored spheres that read as "eggs".

import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { ShpiderEggInstance } from '../types';
import { EGG_VISUAL_RADIUS, MAX_LIVE_EGGS } from '../constants';

interface Props {
  eggsRef: React.RefObject<ShpiderEggInstance[]>;
}

// Tier color palette — same intent as grenade tiers (low = drab,
// high = bright/metallic). Single value per tier; egg base material
// is dark grey so tiers tint subtly.
const TIER_COLOR: Record<number, string> = {
  1: '#5b5040', 2: '#7a3030', 3: '#a05a18', 4: '#a09c20', 5: '#2a8030',
  6: '#208070', 7: '#2050a0', 8: '#6030a0', 9: '#9c3070', 10: '#cccccc',
};

export function ShpiderEggRenderer({ eggsRef }: Props) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const _mat4 = useMemo(() => new THREE.Matrix4(), []);
  const _color = useMemo(() => new THREE.Color(), []);

  const geometry = useMemo(
    () => new THREE.SphereGeometry(EGG_VISUAL_RADIUS, 12, 10),
    [],
  );
  const material = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: '#ffffff', // multiplied by per-instance color
      roughness: 0.55,
      metalness: 0.1,
    });
  }, []);

  useFrame(() => {
    const mesh = meshRef.current;
    const list = eggsRef.current;
    if (!mesh || !list) return;
    const count = Math.min(list.length, MAX_LIVE_EGGS);
    for (let i = 0; i < count; i++) {
      const e = list[i];
      _mat4.makeTranslation(e.position.x, e.position.y, e.position.z);
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
      args={[geometry, material, MAX_LIVE_EGGS]}
      frustumCulled={false}
    />
  );
}
