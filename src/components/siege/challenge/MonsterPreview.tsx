// MonsterPreview — live 3D monsters for the Challenge Creator, in two sizes:
//   • MonsterThumb     — a small turntable in every spawn-card header (drei <View>, so ALL the
//                        thumbnails share ONE WebGL context — no per-card context blow-up).
//   • MonsterPreviewBox— a big floating turntable shown while you hover a card / its dropdown.
// Both render the same <Model>. CRITICAL: scale comes from the known modelHeight (like MonsterEnemy),
// NOT Box3.setFromObject — that returns an empty box for not-yet-mounted skinned meshes, which made
// the model scale to ~0 and vanish (the "doesn't render" bug). Meshes are frustumCulled=false too.
import { Suspense, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { useGLTF, useAnimations, View, PerspectiveCamera } from '@react-three/drei';
import { SkeletonUtils } from 'three-stdlib';
import * as THREE from 'three';
import { CFG, type MType, type BodyFlame } from '../siegeMonsterCatalog';
import { DarkLordFlame } from '../DarkLordFlame';

const FALLBACK = '/siege/monsters/skeletonlight.glb';                 // type 6 (horde) has no CFG
const urlFor = (type: number) => CFG[type as MType]?.url ?? FALLBACK;
const heightFor = (type: number) => CFG[type as MType]?.modelHeight ?? 1.795;
const flamesFor = (type: number) => CFG[type as MType]?.bodyFlames;
const TARGET = 1.4;   // normalized model height (world units); body centred on the origin

// Warm the GLB cache so previews render instantly.
Object.values(CFG).forEach((c) => c && useGLTF.preload(c.url));
useGLTF.preload(FALLBACK);

function Model({ url, modelHeight, flames }: { url: string; modelHeight: number; flames?: BodyFlame[] }) {
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

  // Models are authored feet-at-origin; scale to TARGET tall then drop by TARGET/2 so the body is
  // centred (feet ≈ -TARGET/2, head ≈ +TARGET/2). No bbox measurement → always visible.
  const scale = TARGET / (modelHeight || 1.795);
  const feetY = -TARGET / 2;
  const radius = 0.2 * TARGET;   // approx body radius for the fire shell

  return (
    <group ref={turn}>
      <group position={[0, feetY, 0]} scale={scale}>
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

// Shared lights + the model; `dist` sets camera framing (small = whole body, big = feet low/head high).
function Scene({ type, dist, fov }: { type: number; dist: number; fov: number }) {
  return (
    <>
      <PerspectiveCamera makeDefault position={[0, 0, dist]} fov={fov} />
      <ambientLight intensity={0.85} />
      <directionalLight position={[3, 5, 4]} intensity={1.5} />
      <directionalLight position={[-4, 2, -3]} intensity={0.6} color="#7fb0ff" />
      <Suspense fallback={null}>
        <Model url={urlFor(type)} modelHeight={heightFor(type)} flames={flamesFor(type)} />
      </Suspense>
    </>
  );
}

const BOX_BG = 'radial-gradient(120% 100% at 50% 10%, hsla(220,30%,24%,0.96), hsla(222,34%,8%,0.98))';

// Small square in a card header. The DOM box is drawn here; the monster comes from MonsterPortCanvas.
export function MonsterThumb({ type, size = 60 }: { type: number; size?: number }) {
  return (
    <View style={{
      width: size, height: size, flexShrink: 0, borderRadius: 7, overflow: 'hidden',
      border: '1px solid hsl(var(--panel-glow) / 0.55)', background: BOX_BG,
    }}>
      <Scene type={type} dist={3.6} fov={28} />
    </View>
  );
}

// One fixed, transparent, click-through Canvas that draws every <MonsterThumb> on the page.
export function MonsterPortCanvas() {
  return (
    <Canvas gl={{ alpha: true, antialias: true }} dpr={[1, 2]}
            style={{ position: 'fixed', inset: 0, zIndex: 90, pointerEvents: 'none' }}>
      <View.Port />
    </Canvas>
  );
}

// Big floating turntable (its own Canvas) — feet sit ~10% up, head ~90%; shown on hover / dropdown.
export function MonsterPreviewBox({ type, name, x, y, w = 260, h = 260 }: {
  type: number; name: string; x: number; y: number; w?: number; h?: number;
}) {
  return (
    <div style={{
      position: 'fixed', left: x, top: y, width: w, height: h, zIndex: 150, pointerEvents: 'none',
      borderRadius: 10, overflow: 'hidden', border: '1px solid hsl(var(--panel-glow) / 0.6)', background: BOX_BG,
      boxShadow: '0 0 0 2px hsl(var(--panel-glow) / 0.35), 0 0 26px 4px hsl(var(--panel-glow) / 0.4), 0 16px 40px -8px rgb(0 0 0 / 0.7)',
    }}>
      <div style={{
        position: 'absolute', left: 0, right: 0, top: 0, padding: '5px 9px', fontSize: 13, zIndex: 1,
        fontWeight: 800, color: '#e8eefb', textAlign: 'center', textShadow: '0 1px 3px #000',
        background: 'linear-gradient(hsla(222,40%,5%,0.85), transparent)',
      }}>{name}</div>
      <Canvas gl={{ alpha: true, antialias: true }} dpr={[1, 2]} style={{ width: '100%', height: '100%' }}>
        <Scene type={type} dist={2.78} fov={35} />
      </Canvas>
    </div>
  );
}
