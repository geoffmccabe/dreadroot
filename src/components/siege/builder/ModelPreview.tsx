// Model preview widgets for the PG species lists, reusing the Challenge Creator's <View>/<View.Port>
// turntable pattern (all the little thumbnails share ONE WebGL context via ModelPortCanvas — no
// per-thumb context blow-up):
//   • ModelThumb      — a small rotating 3D square shown inline in each species row.
//   • ModelPortCanvas — the single fixed transparent canvas that draws every ModelThumb.
//   • ModelPreview    — the big floating turntable shown to the left while you hover a thumb.
import { Canvas, useFrame } from '@react-three/fiber';
import { useGLTF, View, PerspectiveCamera } from '@react-three/drei';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { importUrl, MUSHROOM_TREES } from './mushroomCatalog';
import { usePgPreview } from './pgState';

// The centred, auto-rotating model (used at every size), by full glb URL (works for local imports AND
// R2 catalog assets). Materials forced opaque + double-sided.
function SpinModel({ url, rate = 0.6 }: { url: string; rate?: number }) {
  const { scene } = useGLTF(url, '/draco/');
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

// Small inline square in a species/catalog row — transparent so the panel colour shows through. The
// model is drawn by the shared full-viewport ModelPortCanvas. To stop it floating over the header/other
// panels when scrolled out of the list, an IntersectionObserver (rooted on the nearest scroll ancestor)
// removes the <View> once the row leaves the list — a plain sized box holds its place.
export function ModelThumb({ url, size = 44 }: { url: string; size?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [vis, setVis] = useState(true);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    let root: HTMLElement | null = el.parentElement;
    while (root && root !== document.body) {
      const oy = getComputedStyle(root).overflowY;
      if (oy === 'auto' || oy === 'scroll') break;
      root = root.parentElement;
    }
    const io = new IntersectionObserver(([e]) => setVis(e.isIntersecting), { root: root ?? null });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} style={{ width: size, height: size, flexShrink: 0 }}>
      {vis && (
        <View style={{ width: size, height: size, borderRadius: 5, overflow: 'hidden', border: '1px solid hsl(var(--panel-glow) / 0.35)', background: 'transparent' }}>
          <PerspectiveCamera makeDefault position={[0, 0, 3.4]} fov={42} />
          <Lights />
          <Suspense fallback={null}><SpinModel url={url} /></Suspense>
        </View>
      )}
    </div>
  );
}

// The one full-viewport, transparent, click-through canvas that draws every ModelThumb (drei <View>
// needs a viewport-covering canvas to position correctly). Mount ONE while the panel is open.
export function ModelPortCanvas() {
  return (
    <Canvas gl={{ alpha: true, antialias: true }} dpr={[1, 2]}
      style={{ position: 'fixed', inset: 0, zIndex: 55, pointerEvents: 'none' }}>
      <View.Port />
    </Canvas>
  );
}

// Big floating turntable to the left of the panel while a thumb is hovered (usePgPreview holds a URL).
// If onGrab is given (PLACE mode), the preview is clickable — click it to GRAB the model for placing.
export function ModelPreview({ panelLeft, onGrab }: { panelLeft: number; onGrab?: () => void }) {
  const url = usePgPreview();
  const h = Math.round((typeof window !== 'undefined' ? window.innerHeight : 800) * 0.6);
  const left = Math.max(8, panelLeft - h - 16);
  const grabbable = !!(url && onGrab);
  return (
    <div onClick={grabbable ? onGrab : undefined}
      style={{ position: 'fixed', left, top: '20vh', width: h, height: h, pointerEvents: grabbable ? 'auto' : 'none', cursor: grabbable ? 'grab' : 'default', zIndex: 60, opacity: url ? 1 : 0, transition: 'opacity 120ms' }}>
      {url && (
        <Canvas gl={{ alpha: true }} camera={{ position: [0, 0, 4], fov: 40 }} style={{ background: 'transparent' }}>
          <Lights />
          <Suspense fallback={null}><SpinModel url={url} /></Suspense>
        </Canvas>
      )}
      {grabbable && (
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 12, textAlign: 'center', color: '#e8eefb', fontSize: 13, fontWeight: 700, textShadow: '0 1px 4px #000', pointerEvents: 'none' }}>
          click to grab
        </div>
      )}
    </div>
  );
}

// Warm the mushroom cache (PG); and a generic list warmer / purger for PLACE categories.
export function preloadModels() { MUSHROOM_TREES.forEach((f) => useGLTF.preload(importUrl(f), '/draco/')); }
export function preloadUrls(urls: string[]) { urls.forEach((u) => useGLTF.preload(u, '/draco/')); }
export function purgeUrls(urls: string[]) { urls.forEach((u) => { try { useGLTF.clear(u); } catch { /* ignore */ } }); }
