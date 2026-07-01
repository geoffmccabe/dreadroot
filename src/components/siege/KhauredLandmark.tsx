// A fixed Khaured Tower landmark on Bleakrock 2, centred at (-1022, 533) and ground-snapped to the
// (possibly sculpted) terrain there every frame — so it sits on the land you raised, whatever height
// you make it. Mounted only on bleakrock2. Static prop (no collider — walk-around landmark).
import { useMemo, useRef } from 'react';
import { useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { sampleHeight } from './terrainHeight';

const X = -1022, Z = 533;

export function KhauredLandmark() {
  const { scene } = useGLTF('/siege/imports/Khaured_Tower_1.glb', '/draco/');
  const grp = useRef<THREE.Group>(null);
  const cloned = useMemo(() => scene.clone(true), [scene]);
  useFrame(() => {
    if (!grp.current) return;
    const y = sampleHeight(X, Z);
    if (y != null) grp.current.position.y = y;   // sit on the terrain (your raised land)
  });
  return <group ref={grp} position={[X, 14, Z]}><primitive object={cloned} /></group>;
}
