// SiegeCharLab — TEMPORARY diagnostic. Renders 4 Shi Yangs in a row, each playing idle with a
// different skinning-fix strategy, so we can SEE which one renders the arms/hands correctly in
// three.js (the asset is proven-correct; this isolates the GPU-skinning fix). Remove once solved.
//
// Left → right: [0] plain clone (matches the headless setup that gets bones right)
//               [1] clone + normalizeSkinWeights
//               [2] clone + detached re-bind (identity bindMatrix)
//               [3] raw scene (no clone)
import { useEffect, useMemo, useRef } from 'react';
import { useGLTF } from '@react-three/drei';
import { useThree, useFrame } from '@react-three/fiber';
import { SkeletonUtils } from 'three-stdlib';
import * as THREE from 'three';
import { sampleHeight } from './terrainHeight';

const FIXES = ['clone', 'normalize', 'rebind', 'raw'] as const;
type Fix = typeof FIXES[number];

function LabChar({ fix, pos }: { fix: Fix; pos: [number, number, number] }) {
  const { scene, animations } = useGLTF('/siege/characters/shiyang.glb');
  const root = useMemo(
    () => (fix === 'raw' ? scene : (SkeletonUtils.clone(scene) as THREE.Group)),
    [scene, fix],
  );
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);

  useEffect(() => {
    root.traverse((o) => {
      const sm = o as THREE.SkinnedMesh;
      if (!sm.isSkinnedMesh) return;
      if (fix === 'normalize') sm.normalizeSkinWeights();
      if (fix === 'rebind') { sm.bindMode = 'detached' as THREE.BindMode; sm.bind(sm.skeleton, new THREE.Matrix4()); }
    });
    const mixer = new THREE.AnimationMixer(root);
    mixerRef.current = mixer;
    const idle = animations.find((a) => /idle/i.test(a.name)) || animations[0];
    if (idle) mixer.clipAction(idle).play();
    return () => { mixer.stopAllAction(); mixerRef.current = null; };
  }, [root, animations, fix]);

  useFrame((_, dt) => mixerRef.current?.update(dt));

  return (
    <group position={pos} scale={1.1819} rotation={[0, Math.PI, 0]}>
      <primitive object={root} />
    </group>
  );
}

export function SiegeCharLab() {
  const camera = useThree((s) => s.camera);
  const base = useRef<THREE.Vector3 | null>(null);
  if (!base.current) {
    const d = new THREE.Vector3(); camera.getWorldDirection(d); d.y = 0; d.normalize();
    base.current = new THREE.Vector3(camera.position.x + d.x * 6, 0, camera.position.z + d.z * 6);
  }
  const b = base.current;
  return (
    <>
      {FIXES.map((f, i) => {
        const x = b.x + (i - 1.5) * 1.6;
        const y = (sampleHeight(x, b.z) ?? camera.position.y - 1.6) + 0.0327;
        return <LabChar key={f} fix={f} pos={[x, y, b.z]} />;
      })}
    </>
  );
}
