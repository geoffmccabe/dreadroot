// Model preview widgets for the PG species lists, reusing the Challenge Creator's <View>/<View.Port>
// turntable pattern (all the little thumbnails share ONE WebGL context via ModelPortCanvas — no
// per-thumb context blow-up):
//   • ModelThumb      — a small rotating 3D square shown inline in each species row.
//   • ModelPortCanvas — the single fixed transparent canvas that draws every ModelThumb.
//   • ModelPreview    — the big floating turntable shown to the left while you hover a thumb.
import { Canvas, useFrame } from '@react-three/fiber';
import { useGLTF, View, PerspectiveCamera } from '@react-three/drei';
import { Suspense, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { importUrl, MUSHROOM_TREES } from './mushroomCatalog';
import { usePgPreview } from './pgState';

const BOX_BG = 'radial-gradient(120% 100% at 50% 10%, hsla(220,30%,24%,0.96), hsla(222,34%,8%,0.98))';

// The centred, auto-rotating model (used at every size). Materials forced opaque + double-sided.
function SpinModel({ file, rate = 0.6 }: { file: string; rate?: number }) {
  const { scene } = useGLTF(importUrl(file), '/draco/');
  const spin = useRef<THREE.Group>(null);
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
    return { obj: c, s: 2 / Math.max(0.001, Math.max(size.x, size.y, size.z)), center: box.getCenter(new THREE.Vector3()) };
  }, [scene]);
  useFrame((_, d) => { if (spin.current) spin.current.rotation.y += d * rate; });
  return (
    <group ref={spin}>
      <group scale={s}><primitive object={obj} position={[-center.x, -center.y, -center.z]} /></group>
    </group>
  );
}

function Lights() {
  return (<>
    <ambientLight intensity={0.9} />
    <directionalLight position={[3, 5, 4]} intensity={1.3} />
    <directionalLight position={[-4, 2, -3]} intensity={0.5} color="#7fb0ff" />
  </>);
}

// Small inline square in a species row. The monster comes from the shared ModelPortCanvas.
export function ModelThumb({ file, size = 30 }: { file: string; size?: number }) {
  return (
    <View style={{
      width: size, height: size, flexShrink: 0, borderRadius: 5, overflow: 'hidden',
      border: '1px solid hsl(var(--panel-glow) / 0.5)', background: BOX_BG,
    }}>
      <PerspectiveCamera makeDefault position={[0, 0, 4]} fov={40} />
      <Lights />
      <Suspense fallback={null}><SpinModel file={file} /></Suspense>
    </View>
  );
}

// One fixed, transparent, click-through canvas that draws every ModelThumb on the page.
export function ModelPortCanvas() {
  return (
    <Canvas gl={{ alpha: true, antialias: true }} dpr={[1, 2]}
      style={{ position: 'fixed', inset: 0, zIndex: 55, pointerEvents: 'none' }}>
      <View.Port />
    </Canvas>
  );
}

// Big floating turntable to the left of the panel while a thumb is hovered.
export function ModelPreview({ panelLeft }: { panelLeft: number }) {
  const file = usePgPreview();
  const h = Math.round((typeof window !== 'undefined' ? window.innerHeight : 800) * 0.6);
  const left = Math.max(8, panelLeft - h - 16);
  return (
    <div style={{ position: 'fixed', left, top: '20vh', width: h, height: h, pointerEvents: 'none', zIndex: 60, opacity: file ? 1 : 0, transition: 'opacity 120ms' }}>
      {file && (
        <Canvas gl={{ alpha: true }} camera={{ position: [0, 0, 4], fov: 40 }} style={{ background: 'transparent' }}>
          <Lights />
          <Suspense fallback={null}><SpinModel file={file} /></Suspense>
        </Canvas>
      )}
    </div>
  );
}

// Warm the model cache so thumbs + previews pop instantly (call once from the panel).
export function preloadModels() { MUSHROOM_TREES.forEach((f) => useGLTF.preload(importUrl(f), '/draco/')); }
