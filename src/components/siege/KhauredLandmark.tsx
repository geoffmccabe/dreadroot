// A fixed Khaured Tower landmark on Bleakrock 2, centred at (-1022, 533) and ground-snapped to the
// (possibly sculpted) terrain there — so it sits on the land you raised, whatever height you make it.
// Registered as a walk-on MESH (BVH) collider so you can climb its stairs and go inside; the collider
// re-registers whenever the ground-snap Y settles (or you re-sculpt under it). Mounted only on bleakrock2.
import { useEffect, useMemo, useRef } from 'react';
import { useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { sampleHeight } from './terrainHeight';
import { registerMeshGeometry, setGroupInstances, clearGroup, type MeshInstanceInput } from './meshColliderSystem';

const X = -1022, Z = 533, GROUP = 'khaured-landmark';

export function KhauredLandmark() {
  const { scene } = useGLTF('/siege/imports/Khaured_Tower_1.glb', '/draco/');
  const grp = useRef<THREE.Group>(null);
  const lastY = useRef(-9999);
  const cloned = useMemo(() => scene.clone(true), [scene]);

  useFrame(() => {
    const g = grp.current; if (!g) return;
    const y = sampleHeight(X, Z);
    if (y != null) g.position.y = y;                 // sit on the terrain (your raised land)
    if (Math.abs(g.position.y - lastY.current) < 0.5) return;   // rebuild collider only when it settles/moves
    lastY.current = g.position.y;
    g.updateWorldMatrix(true, true);
    const inputs: MeshInstanceInput[] = [];
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.geometry) return;
      const geo = m.geometry as THREE.BufferGeometry;
      if (!geo.boundingBox) geo.computeBoundingBox();
      registerMeshGeometry(GROUP, geo.uuid, geo, 1);
      inputs.push({ key: geo.uuid, matrix: m.matrixWorld.clone(), geoBox: geo.boundingBox as THREE.Box3 });
    });
    setGroupInstances(GROUP, inputs);
  });
  useEffect(() => () => clearGroup(GROUP), []);

  return <group ref={grp} position={[X, 14, Z]}><primitive object={cloned} /></group>;
}
