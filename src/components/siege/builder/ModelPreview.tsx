// ModelPreview — a big floating, auto-rotating render of the species you hover in the PG list, shown
// just left of the Model Placer panel so you can see exactly what a model is. Its own transparent R3F
// canvas (separate from the game), ~60% of screen height. All species are preloaded so it's instant.
import { Canvas, useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { Suspense, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { importUrl, MUSHROOM_TREES } from './mushroomCatalog';
import { usePgPreview } from './pgState';

function PreviewModel({ file }: { file: string }) {
  const { scene } = useGLTF(importUrl(file), '/draco/');
  const spin = useRef<THREE.Group>(null);
  // Centre + fit the model to ~2 units so any size reads clearly; force materials opaque.
  const { obj, s, center } = useMemo(() => {
    const c = scene.clone(true);
    c.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.material) return;
      (Array.isArray(m.material) ? m.material : [m.material]).forEach((mm) => {
        const sm = mm as THREE.MeshStandardMaterial;
        sm.side = THREE.DoubleSide; sm.transparent = false; sm.depthWrite = true; sm.alphaTest = 0;
        if ('opacity' in sm) sm.opacity = 1; sm.needsUpdate = true;
      });
    });
    const box = new THREE.Box3().setFromObject(c);
    const size = box.getSize(new THREE.Vector3());
    const ctr = box.getCenter(new THREE.Vector3());
    return { obj: c, s: 2 / Math.max(0.001, Math.max(size.x, size.y, size.z)), center: ctr };
  }, [scene]);
  useFrame((_, dt) => { if (spin.current) spin.current.rotation.y += dt * 0.6; });
  return (
    <group ref={spin}>
      <group scale={s}><primitive object={obj} position={[-center.x, -center.y, -center.z]} /></group>
    </group>
  );
}

export function ModelPreview({ panelLeft }: { panelLeft: number }) {
  const file = usePgPreview();
  useEffect(() => { MUSHROOM_TREES.forEach((f) => useGLTF.preload(importUrl(f), '/draco/')); }, []);  // warm the cache
  const h = Math.round((typeof window !== 'undefined' ? window.innerHeight : 800) * 0.6);
  const left = Math.max(8, panelLeft - h - 16);   // sit just left of the panel, vertically centred
  return (
    <div style={{ position: 'fixed', left, top: '20vh', width: h, height: h, pointerEvents: 'none', zIndex: 60, opacity: file ? 1 : 0, transition: 'opacity 120ms' }}>
      {file && (
        <Canvas gl={{ alpha: true }} camera={{ position: [0, 0, 4], fov: 40 }} style={{ background: 'transparent' }}>
          <ambientLight intensity={0.9} />
          <directionalLight position={[3, 5, 4]} intensity={1.3} />
          <directionalLight position={[-4, 2, -3]} intensity={0.5} />
          <Suspense fallback={null}><PreviewModel file={file} /></Suspense>
        </Canvas>
      )}
    </div>
  );
}
