// PlacementEditor — renders the village and, in editor mode, attaches a standard
// move/rotate/scale gizmo (drei TransformControls) + orbit camera so the whole
// village can be dragged into place. The live transform is published for the HUD.

import { Suspense, useRef, useState } from 'react';
import { useGLTF, TransformControls, OrbitControls } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { placementState } from './placementState';

const VILLAGE = [
  '/siege/buildings/BeachTown.glb',
  '/siege/buildings/ShantyTown.glb',
  '/siege/buildings/JungleHuts.glb',
];
const HOME: [number, number, number] = [984, 26, -503]; // starts near the beach spawn

function Part({ url }: { url: string }) {
  const { scene } = useGLTF(url);
  const obj = useRef<THREE.Object3D>();
  if (!obj.current) {
    obj.current = scene.clone(true);
    obj.current.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        mats.forEach((mm) => { (mm as THREE.Material).side = THREE.DoubleSide; });
      }
    });
  }
  return <primitive object={obj.current} />;
}

export function PlacementEditor({ editorMode, mode }: { editorMode: boolean; mode: 'translate' | 'rotate' | 'scale' }) {
  const [grp, setGrp] = useState<THREE.Group | null>(null);

  useFrame(() => {
    if (!grp) return;
    placementState.pos = [grp.position.x, grp.position.y, grp.position.z];
    placementState.rotDeg = [
      Math.round(THREE.MathUtils.radToDeg(grp.rotation.x)),
      Math.round(THREE.MathUtils.radToDeg(grp.rotation.y)),
      Math.round(THREE.MathUtils.radToDeg(grp.rotation.z)),
    ];
    placementState.scale = grp.scale.x;
  });

  return (
    <>
      <group ref={setGrp} position={HOME}>
        <Suspense fallback={null}>
          {VILLAGE.map((u) => <Part key={u} url={u} />)}
        </Suspense>
      </group>
      {editorMode && grp && (
        <>
          <OrbitControls makeDefault target={HOME} />
          <TransformControls object={grp} mode={mode} size={0.8} />
        </>
      )}
    </>
  );
}
