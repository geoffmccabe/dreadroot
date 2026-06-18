// MonsterPreview — a small floating 3D box that shows ONE monster, lit, gently turning on a
// turntable and playing its idle clip, with its body fire/smoke aura if it has one (Dark Lord,
// Spintroll). The Challenge Creator pops it above the spawn card you're hovering / the dropdown
// option you're pointing at. Tiny standalone Canvas, mounted only while needed (zero idle cost).
//
// Framing: an orthographic camera + a measured model so the feet always sit 10% up from the bottom
// of the box and the head ~90% (no cropping, no empty half). Model url/scale/clone mirror MonsterEnemy.
import { Suspense, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { useGLTF, useAnimations } from '@react-three/drei';
import { SkeletonUtils } from 'three-stdlib';
import * as THREE from 'three';
import { CFG, type MType, type BodyFlame } from '../siegeMonsterCatalog';
import { DarkLordFlame } from '../DarkLordFlame';

const FALLBACK = '/siege/monsters/skeletonlight.glb';                 // type 6 (horde) has no CFG
const urlFor = (type: number) => CFG[type as MType]?.url ?? FALLBACK;
const flamesFor = (type: number) => CFG[type as MType]?.bodyFlames;

// Warm the GLB cache so the first hover renders instantly.
Object.values(CFG).forEach((c) => c && useGLTF.preload(c.url));
useGLTF.preload(FALLBACK);

function Model({ url, flames }: { url: string; flames?: BodyFlame[] }) {
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

  // Normalize to 1 world-unit tall, vertical centre at y=0 (feet ≈ -0.5, head ≈ +0.5); the ortho
  // camera (zoom = 0.8·boxPx) then lands the feet at 10% up and the head at ~90%.
  const { scale, centerOff, feetY, radius } = useMemo(() => {
    const box = new THREE.Box3().setFromObject(cloned);
    const size = new THREE.Vector3(); box.getSize(size);
    const h = size.y || 1;
    const s = 1 / h;
    const cy = -((box.min.y + box.max.y) / 2) * s;       // vertical centre → y=0
    const fy = cy + box.min.y * s;                       // feet world y (≈ -0.5)
    const rad = Math.max(size.x, size.z) * s * 0.5;      // body radius (world)
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
            <DarkLordFlame key={i} height={f.heightMul} radius={radius * f.radiusMul}
                           colorHot={f.colorHot} colorCool={f.colorCool} />
          ))}
        </group>
      )}
    </group>
  );
}

export function MonsterPreviewBox({ type, name, x, y, w = 260, h = 260 }: {
  type: number; name: string; x: number; y: number; w?: number; h?: number;
}) {
  return (
    <div style={{
      position: 'fixed', left: x, top: y, width: w, height: h, zIndex: 150, pointerEvents: 'none',
      borderRadius: 10, overflow: 'hidden', border: '1px solid hsl(var(--panel-glow) / 0.6)',
      background: 'radial-gradient(120% 90% at 50% 16%, hsla(220,30%,22%,0.96), hsla(222,34%,7%,0.98))',
      boxShadow: '0 0 0 2px hsl(var(--panel-glow) / 0.35), 0 0 26px 4px hsl(var(--panel-glow) / 0.4), 0 16px 40px -8px rgb(0 0 0 / 0.7)',
    }}>
      <div style={{
        position: 'absolute', left: 0, right: 0, top: 0, padding: '5px 9px', fontSize: 13, zIndex: 1,
        fontWeight: 800, color: '#e8eefb', textAlign: 'center', textShadow: '0 1px 3px #000',
        background: 'linear-gradient(hsla(222,40%,5%,0.85), transparent)',
      }}>{name}</div>
      <Canvas orthographic camera={{ position: [0, 0, 10], zoom: 0.8 * h, near: 0.1, far: 100 }}
              gl={{ alpha: true, antialias: true }} dpr={[1, 2]} style={{ width: '100%', height: '100%' }}>
        <ambientLight intensity={0.8} />
        <directionalLight position={[3, 5, 4]} intensity={1.5} />
        <directionalLight position={[-4, 2, -3]} intensity={0.6} color="#7fb0ff" />
        <Suspense fallback={null}>
          <Model url={urlFor(type)} flames={flamesFor(type)} />
        </Suspense>
      </Canvas>
    </div>
  );
}
