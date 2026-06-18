// MonsterPreview — a small floating 3D box that shows ONE monster, lit, gently turning on a
// turntable and playing its idle clip. The Challenge Creator pops it above the spawn card you're
// hovering so you can see the monster you picked. It's a tiny standalone Canvas, mounted only while
// a card is hovered (zero cost when idle). Model url / scale / clone conventions mirror MonsterEnemy.
import { Suspense, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { useGLTF, useAnimations, Center } from '@react-three/drei';
import { SkeletonUtils } from 'three-stdlib';
import * as THREE from 'three';
import { CFG, type MType } from '../siegeMonsterCatalog';

const FALLBACK = '/siege/monsters/skeletonlight.glb';                 // type 6 (horde) has no CFG
const urlFor = (type: number) => CFG[type as MType]?.url ?? FALLBACK;
const heightFor = (type: number) => CFG[type as MType]?.modelHeight ?? 1.795;

// Warm the GLB cache so the first hover renders instantly.
Object.values(CFG).forEach((c) => c && useGLTF.preload(c.url));
useGLTF.preload(FALLBACK);

function Model({ url, modelHeight }: { url: string; modelHeight: number }) {
  const { scene, animations } = useGLTF(url);
  // Clone (skeleton + skinned mesh) so this copy animates independently of the in-game ones.
  const cloned = useMemo(() => SkeletonUtils.clone(scene) as THREE.Group, [scene]);
  const turn = useRef<THREE.Group>(null);
  const { actions, names } = useAnimations(animations, turn);
  useEffect(() => {
    const a = actions['idle'] || (names.length ? actions[names[0]] : null);
    a?.reset().fadeIn(0.3).play();
    return () => { a?.fadeOut(0.2); };
  }, [actions, names]);
  // Slow turntable so the monster reads from every side regardless of which way the model faces.
  useFrame((_, d) => { if (turn.current) turn.current.rotation.y += d * 0.5; });
  return (
    <group ref={turn}>
      <Center>
        <primitive object={cloned} scale={1.7 / modelHeight} />
      </Center>
    </group>
  );
}

export function MonsterPreviewBox({ type, name, x, y, w = 240, h = 200 }: {
  type: number; name: string; x: number; y: number; w?: number; h?: number;
}) {
  return (
    <div style={{
      position: 'fixed', left: x, top: y, width: w, height: h, zIndex: 150, pointerEvents: 'none',
      borderRadius: 10, overflow: 'hidden', border: '1px solid hsl(var(--panel-glow) / 0.6)',
      background: 'radial-gradient(120% 90% at 50% 16%, hsla(220,30%,22%,0.96), hsla(222,34%,7%,0.98))',
      boxShadow: '0 0 0 2px hsl(var(--panel-glow) / 0.35), 0 0 26px 4px hsl(var(--panel-glow) / 0.4), 0 16px 40px -8px rgb(0 0 0 / 0.7)',
    }}>
      <Canvas camera={{ position: [0, 0.1, 3.0], fov: 35 }} gl={{ alpha: true, antialias: true }} dpr={[1, 2]} style={{ width: '100%', height: '100%' }}>
        <ambientLight intensity={0.8} />
        <directionalLight position={[3, 5, 4]} intensity={1.5} />
        <directionalLight position={[-4, 2, -3]} intensity={0.6} color="#7fb0ff" />
        <Suspense fallback={null}>
          <Model url={urlFor(type)} modelHeight={heightFor(type)} />
        </Suspense>
      </Canvas>
      <div style={{
        position: 'absolute', left: 0, right: 0, bottom: 0, padding: '5px 9px', fontSize: 13,
        fontWeight: 800, color: '#e8eefb', textAlign: 'center', textShadow: '0 1px 3px #000',
        background: 'linear-gradient(transparent, hsla(222,40%,5%,0.85))',
      }}>{name}</div>
    </div>
  );
}
