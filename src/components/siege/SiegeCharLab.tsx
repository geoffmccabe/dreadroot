// SiegeCharLab — TEMPORARY diagnostic. Renders Shi Yangs in a row to find the fix for the
// three.js scaled-skinning precision bug (#13288): her ×100 inverse-bind matrices + 0.01 root
// node inflate the GPU skinning math, stretching limbs. Fix = collapse that scale split so the
// skinning runs near unit scale ("flatten"), scaling geometry + bone rest + animation translation
// tracks together by k, then re-binding so three.js recomputes the inverse-bind matrices.
//
// Left → right: [0] control (no flatten)  [1] flatten WITH geometry scaled  [2] flatten WITHOUT
// geometry scaled. Remove once the winning variant is folded into SiegeCharacter.
import { useEffect, useMemo, useRef } from 'react';
import { useGLTF } from '@react-three/drei';
import { useThree, useFrame } from '@react-three/fiber';
import { SkeletonUtils } from 'three-stdlib';
import * as THREE from 'three';
import { sampleHeight } from './terrainHeight';

const K = 0.01;
const FIXES = ['control', 'flattenGeo', 'flattenNoGeo'] as const;
type Fix = typeof FIXES[number];

// Collapse the 0.01-scaled ancestor into the data so skinning runs near unit scale.
function flatten(root: THREE.Object3D, scaleGeo: boolean) {
  root.updateMatrixWorld(true);
  root.traverse((o) => { if (Math.abs(o.scale.x - K) < 1e-4) o.scale.setScalar(1); });
  root.traverse((o) => {
    const bone = o as THREE.Bone;
    if (bone.isBone) { bone.position.multiplyScalar(K); bone.updateMatrix(); }
    const sm = o as THREE.SkinnedMesh;
    if (sm.isSkinnedMesh && scaleGeo) {
      const p = sm.geometry.attributes.position as THREE.BufferAttribute;
      const a = (p.array as Float32Array).slice();
      for (let i = 0; i < a.length; i++) a[i] *= K;
      sm.geometry.setAttribute('position', new THREE.BufferAttribute(a, p.itemSize));
      sm.geometry.computeBoundingBox(); sm.geometry.computeBoundingSphere();
    }
  });
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    const sm = o as THREE.SkinnedMesh;
    if (sm.isSkinnedMesh) { sm.bindMode = THREE.AttachedBindMode; sm.bind(sm.skeleton); }
  });
}

// Clone clips and scale ONLY translation tracks by k (rotations/scales are scale-invariant).
function scaledClips(animations: THREE.AnimationClip[]) {
  return animations.map((c) => {
    const cc = c.clone();
    for (const t of cc.tracks) {
      if (t.name.endsWith('.position')) {
        const v = t.values as Float32Array;
        for (let i = 0; i < v.length; i++) v[i] *= K;
      }
    }
    return cc;
  });
}

function LabChar({ fix, pos }: { fix: Fix; pos: [number, number, number] }) {
  const { scene, animations } = useGLTF('/siege/characters/shiyang.glb');
  const { root, clips, scale } = useMemo(() => {
    const r = SkeletonUtils.clone(scene) as THREE.Group;
    if (fix === 'control') return { root: r, clips: animations, scale: 1.1819 };
    flatten(r, fix === 'flattenGeo');
    // flatten moved the 0.01 into the data; net size is preserved for flattenGeo, so render scale
    // matches control; flattenNoGeo leaves the mesh 100x so it needs the 0.01 back on the outside.
    return { root: r, clips: scaledClips(animations), scale: fix === 'flattenGeo' ? 1.1819 : 1.1819 * K };
  }, [scene, animations, fix]);

  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  useEffect(() => {
    const mixer = new THREE.AnimationMixer(root);
    mixerRef.current = mixer;
    const idle = clips.find((a) => /idle/i.test(a.name)) || clips[0];
    if (idle) mixer.clipAction(idle).play();
    return () => { mixer.stopAllAction(); mixerRef.current = null; };
  }, [root, clips]);
  useFrame((_, dt) => mixerRef.current?.update(dt));

  return (
    <group position={pos} scale={scale} rotation={[0, Math.PI, 0]}>
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
        const x = b.x + (i - 1) * 1.8;
        const y = (sampleHeight(x, b.z) ?? camera.position.y - 1.6) + 0.0327;
        return <LabChar key={f} fix={f} pos={[x, y, b.z]} />;
      })}
    </>
  );
}
