// MonsterPreview — live 3D monster thumbnails for the Challenge Creator. Every spawn card shows the
// monster it spawns as a small turntable that plays the idle clip (plus its body-fire aura for the
// Dark Lord / Spintroll). To keep ONE WebGL context across many cards we use drei <View>: each card
// drops a <MonsterThumb> (a DOM box) and a single <MonsterPortCanvas> renders all of them. Model
// url / scale / clone conventions mirror MonsterEnemy; meshes are frustumCulled=false so the tight
// thumbnail camera never culls a skinned body (that was the "doesn't render" bug).
import { Suspense, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { useGLTF, useAnimations, View, PerspectiveCamera } from '@react-three/drei';
import { SkeletonUtils } from 'three-stdlib';
import * as THREE from 'three';
import { CFG, type MType, type BodyFlame } from '../siegeMonsterCatalog';
import { DarkLordFlame } from '../DarkLordFlame';

const FALLBACK = '/siege/monsters/skeletonlight.glb';                 // type 6 (horde) has no CFG
const urlFor = (type: number) => CFG[type as MType]?.url ?? FALLBACK;
const flamesFor = (type: number) => CFG[type as MType]?.bodyFlames;
const TARGET = 1.4;   // normalized model height (world units); camera framed a touch wider

// Warm the GLB cache so cards render instantly.
Object.values(CFG).forEach((c) => c && useGLTF.preload(c.url));
useGLTF.preload(FALLBACK);

function Model({ url, flames }: { url: string; flames?: BodyFlame[] }) {
  const { scene, animations } = useGLTF(url);
  // Clone (skeleton + skinned mesh) so this copy animates independently; never frustum-cull it.
  const cloned = useMemo(() => {
    const c = SkeletonUtils.clone(scene) as THREE.Group;
    c.traverse((o) => { (o as THREE.Mesh).frustumCulled = false; });
    return c;
  }, [scene]);
  const turn = useRef<THREE.Group>(null);
  const { actions, names } = useAnimations(animations, turn);
  useEffect(() => {
    const a = actions['idle'] || (names.length ? actions[names[0]] : null);
    a?.reset().fadeIn(0.3).play();
    return () => { a?.fadeOut(0.2); };
  }, [actions, names]);
  useFrame((_, d) => { if (turn.current) turn.current.rotation.y += d * 0.5; });

  // Normalize to TARGET tall, vertical centre at y=0 (so the body sits centred in the square).
  const { scale, centerOff, feetY, radius } = useMemo(() => {
    const box = new THREE.Box3().setFromObject(cloned);
    const size = new THREE.Vector3(); box.getSize(size);
    const h = size.y || 1;
    const s = TARGET / h;
    const cy = -((box.min.y + box.max.y) / 2) * s;
    const fy = cy + box.min.y * s;
    const rad = Math.max(size.x, size.z) * s * 0.5;
    return { scale: s, centerOff: cy, feetY: fy, radius: rad };
  }, [cloned]);

  return (
    <group ref={turn}>
      <group position={[0, centerOff, 0]} scale={scale}>
        <primitive object={cloned} />
      </group>
      {flames && flames.length > 0 && (
        <group position={[0, feetY, 0]}>
          {flames.map((f, i) => (
            <DarkLordFlame key={i} height={TARGET * Math.min(f.heightMul, 1.15)} radius={radius * f.radiusMul}
                           colorHot={f.colorHot} colorCool={f.colorCool} />
          ))}
        </group>
      )}
    </group>
  );
}

function ThumbScene({ type }: { type: number }) {
  return (
    <>
      <PerspectiveCamera makeDefault position={[0, 0, 4]} fov={28} />
      <ambientLight intensity={0.85} />
      <directionalLight position={[3, 5, 4]} intensity={1.5} />
      <directionalLight position={[-4, 2, -3]} intensity={0.6} color="#7fb0ff" />
      <Suspense fallback={null}>
        <Model url={urlFor(type)} flames={flamesFor(type)} />
      </Suspense>
    </>
  );
}

// A small square in a card header. The DOM box (border + dark vignette) is drawn here; the monster
// pixels come from the shared <MonsterPortCanvas> rendering into this box's rect.
export function MonsterThumb({ type, size = 60 }: { type: number; size?: number }) {
  return (
    <View style={{
      width: size, height: size, flexShrink: 0, borderRadius: 7, overflow: 'hidden',
      border: '1px solid hsl(var(--panel-glow) / 0.55)',
      background: 'radial-gradient(120% 100% at 50% 10%, hsla(220,30%,24%,0.96), hsla(222,34%,8%,0.98))',
    }}>
      <ThumbScene type={type} />
    </View>
  );
}

// One fixed, transparent, click-through Canvas that renders every <MonsterThumb> on the page.
export function MonsterPortCanvas() {
  return (
    <Canvas gl={{ alpha: true, antialias: true }} dpr={[1, 2]}
            style={{ position: 'fixed', inset: 0, zIndex: 90, pointerEvents: 'none' }}>
      <View.Port />
    </Canvas>
  );
}
