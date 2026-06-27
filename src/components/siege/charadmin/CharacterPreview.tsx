// CharacterPreview — live 3D character turntables for the Characters admin panel. Mirrors the
// Enemies-SW MonsterHexThumb (shared drei <View> port → ONE WebGL context for all six), but renders
// the lineup character glbs driven by the shared animation library (a calm 'Pistol Idle'). The hex +
// model are 2.5× the Enemies size. Reuses MonsterPortCanvas as the shared View.Port.
import { Suspense, useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF, useAnimations, View, PerspectiveCamera } from '@react-three/drei';
import { SkeletonUtils } from 'three-stdlib';
import * as THREE from 'three';
import { charGlbUrl } from './characterStats';

const TARGET = 1.4;   // normalized model height in the hex (all characters appear the same size)
const HEX = 'polygon(50% 1%, 93% 25%, 93% 75%, 50% 99%, 7% 75%, 7% 25%)';
const BOX_BG = 'radial-gradient(120% 100% at 50% 10%, hsla(220,30%,24%,0.96), hsla(222,34%,8%,0.98))';
// Shared idle library: one Draco + rotation-only glb holding each character's hand-picked idle clip
// (idle_ash, idle_dago, …). Loaded once for the whole panel; each card plays its own clip by name.
const IDLE_LIBRARY = '/siege/characters/character_idles.glb';
// scratch for the procedural tail swish (no per-frame allocation)
const _tailEuler = new THREE.Euler();
const _tailQ = new THREE.Quaternion();

useGLTF.preload(charGlbUrl(IDLE_LIBRARY), '/draco/');

function CharModel({ file, rawH, name }: { file: string; rawH: number; name: string }) {
  const { scene } = useGLTF(charGlbUrl(file), '/draco/');
  const { animations } = useGLTF(charGlbUrl(IDLE_LIBRARY), '/draco/');
  const cloned = useMemo(() => {
    const c = SkeletonUtils.clone(scene) as THREE.Group;
    c.traverse((o) => { (o as THREE.Mesh).frustumCulled = false; });
    return c;
  }, [scene]);
  const root = useRef<THREE.Group>(null);
  const { actions, names } = useAnimations(animations, root);
  // Procedural tail (Rajax): the idle clips don't touch the grafted Tail_01..08 bones, so they'd sit
  // stiff. Drive the same travelling-wave swish the &&& lineup uses. Auto-gated: only Rajax has Tail
  // bones, so this is a no-op for everyone else.
  const tailBones = useMemo(() => {
    const bs: THREE.Object3D[] = [];
    cloned.traverse((o) => { if (o.name.startsWith('Tail_')) bs.push(o); });
    return bs.sort((a, b) => a.name.localeCompare(b.name));
  }, [cloned]);
  const tailRest = useMemo(() => tailBones.map((b) => b.quaternion.clone()), [tailBones]);
  useEffect(() => {
    const want = `idle_${name.toLowerCase()}`;
    const clip = names.find((n) => n.toLowerCase() === want) ?? names[0];
    const a = clip ? actions[clip] : null;
    if (a) a.reset().fadeIn(0.3).play();
    return () => { a?.fadeOut(0.2); };
  }, [actions, names, name]);
  useFrame((state) => {
    if (!tailBones.length) return;
    const t = state.clock.elapsedTime;
    const N = tailBones.length;
    for (let i = 0; i < N; i++) {
      const frac = i / (N - 1);
      const amp = 0.22 + 0.42 * frac;             // base → tip whip
      const ph = t * 1.6 - i * 0.7;               // travelling wave
      _tailEuler.set(Math.sin(ph) * amp, 0, Math.sin(ph * 0.5 + 1.2) * amp * 0.3);
      _tailQ.setFromEuler(_tailEuler);
      tailBones[i].quaternion.copy(tailRest[i]).multiply(_tailQ);  // compose onto rest, keep the droop
    }
  });
  const scale = TARGET / (rawH || 1.8);
  return (
    <group ref={root}>
      {/* feet-at-origin → centre vertically on the hex */}
      <group position={[0, -TARGET / 2, 0]} scale={scale}>
        <primitive object={cloned} />
      </group>
    </group>
  );
}

function CharScene({ file, rawH, name, dist, fov }: { file: string; rawH: number; name: string; dist: number; fov: number }) {
  const turn = useRef<THREE.Group>(null);
  useFrame((_, d) => { if (turn.current) turn.current.rotation.y += d * 0.5; });
  return (
    <>
      <PerspectiveCamera makeDefault position={[0, 0, dist]} fov={fov} />
      <ambientLight intensity={0.85} />
      <directionalLight position={[3, 5, 4]} intensity={1.5} />
      <directionalLight position={[-4, 2, -3]} intensity={0.6} color="#7fb0ff" />
      <Suspense fallback={null}>
        <group ref={turn}><CharModel file={file} rawH={rawH} name={name} /></group>
      </Suspense>
    </>
  );
}

// Hexagon turntable for the admin rows. size = hex width (2.5× the 88px Enemies hex = 220).
export function CharHexThumb({ file, rawH, name, size = 220 }: { file: string; rawH: number; name: string; size?: number }) {
  const view = Math.round(size * 1.28);   // 3D box bigger than the hex → model pokes past the edges
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <div style={{
        position: 'absolute', inset: 0, clipPath: HEX, WebkitClipPath: HEX,
        background: 'hsl(var(--panel-glow) / 0.85)',
        filter: 'drop-shadow(0 0 9px hsl(var(--panel-glow) / 0.55))',
      }} />
      <div style={{ position: 'absolute', inset: 3, clipPath: HEX, WebkitClipPath: HEX, background: BOX_BG }} />
      <View style={{
        position: 'absolute', left: '50%', top: '48%', width: view, height: view,
        transform: 'translate(-50%, -50%)', pointerEvents: 'none',
      }}>
        <CharScene file={file} rawH={rawH} name={name} dist={3.5} fov={30} />
      </View>
    </div>
  );
}
