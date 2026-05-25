// GrenadeRenderer — instanced sphere mesh for every grenade in flight
// or rolling. One mesh, per-instance colors so all 10 tier shades can
// live on the same draw call.
//
// Physics is owned by useGrenadeSystem; this renderer only reads
// position / velocity from the live grenades ref and writes matrices
// into the instanced mesh.

import React, { useRef, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { GrenadeInstance } from '../types';
import {
  GRENADE_VISUAL_RADIUS,
  MAX_LIVE_GRENADES,
  grenadeColors,
} from '../constants';

interface GrenadeRendererProps {
  grenadesRef: React.RefObject<GrenadeInstance[]>;
}

const _mat = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3(1, 1, 1);
const _axis = new THREE.Vector3(0, 1, 0);
const _color = new THREE.Color();

// Cylinder/sphere base for the grenade. Slightly squashed sphere
// reads as a "grenade body" without needing a custom mesh.
const GRENADE_GEO = new THREE.SphereGeometry(GRENADE_VISUAL_RADIUS, 12, 10);
GRENADE_GEO.scale(1, 1.15, 1);

export function GrenadeRenderer({ grenadesRef }: GrenadeRendererProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  // Base color must be white so per-instance tier color shows through
  // multiplicatively. Emissive stays subtle so the body still reads as
  // a metal object and not a glowing orb.
  const material = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#ffffff',
    metalness: 0.6,
    roughness: 0.4,
    emissive: '#000000',
    emissiveIntensity: 0,
  }), []);

  useFrame(() => {
    const mesh = meshRef.current;
    const list = grenadesRef.current;
    if (!mesh || !list) return;

    let count = 0;
    for (let i = 0; i < list.length && count < MAX_LIVE_GRENADES; i++) {
      const g = list[i];
      if (g.exploded) continue;

      _pos.copy(g.position);
      // Spin: simulate tumbling by rotating about the world up axis
      // proportional to flight time. Live grenades spin fast, rolling
      // ones spin slower (matches the visible motion).
      const flightSec = performance.now() / 1000 - g.spawnedAt;
      const spinSpeed = g.isRolling ? 4 : 12; // rad/sec
      _quat.setFromAxisAngle(_axis, g.throwYaw + flightSec * spinSpeed);
      _mat.compose(_pos, _quat, _scale);
      mesh.setMatrixAt(count, _mat);

      // Per-instance color = tier color (middle of the 3-color set).
      const [, mid] = grenadeColors(g.tier);
      _color.set(mid);
      mesh.setColorAt(count, _color);

      count++;
    }
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[GRENADE_GEO, material, MAX_LIVE_GRENADES]}
      frustumCulled={false}
    />
  );
}
