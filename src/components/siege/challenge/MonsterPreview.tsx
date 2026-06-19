// MonsterPreview — live 3D monsters for the Challenge Creator, in two sizes:
//   • MonsterThumb     — a small turntable in every spawn-card header (drei <View>, so ALL the
//                        thumbnails share ONE WebGL context — no per-card context blow-up).
//   • MonsterPreviewBox— a big floating turntable shown while you hover a card / its dropdown.
// Both render the same <Model>, which recolours the monster in REAL TIME from a ColorMods (hue /
// saturation / tint), generalizing the in-game zombie shader. Scale comes from the known modelHeight
// (like MonsterEnemy), NOT Box3.setFromObject (that returns an empty box for not-yet-mounted skinned
// meshes → scale ~0 → invisible). Meshes are frustumCulled=false too.
import { Suspense, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { useGLTF, useAnimations, View, PerspectiveCamera } from '@react-three/drei';
import { SkeletonUtils } from 'three-stdlib';
import * as THREE from 'three';
import { CFG, type MType, type BodyFlame } from '../siegeMonsterCatalog';
import { DarkLordFlame } from '../DarkLordFlame';
import { injectRecolor, setRecolor, type RecolorUniforms } from './colorMods';
import type { ColorMods } from './challengeTypes';

const FALLBACK = '/siege/monsters/skeletonlight.glb';                 // type 6 (horde) has no CFG
// Types without a CFG entry (6 = horde, 9 = Ghost) get a model here so the preview isn't blank.
const PREVIEW_MODEL: Record<number, { url: string; h: number }> = {
  9: { url: '/siege/monsters/skeletonflesh.glb', h: 1.803 },        // Ghost (rendered upside-down + faint in-game)
};
const urlFor = (type: number) => PREVIEW_MODEL[type]?.url ?? CFG[type as MType]?.url ?? FALLBACK;
const heightFor = (type: number) => PREVIEW_MODEL[type]?.h ?? CFG[type as MType]?.modelHeight ?? 1.795;
const flamesFor = (type: number) => CFG[type as MType]?.bodyFlames;
const TARGET = 1.4;   // normalized model height (world units); body centred on the origin

export const COLOR_NEUTRAL: ColorMods = { sat: 100, hue: 0, tint: '#ffffff', tintAmt: 0 };
// Bloody Skeleton (type 6) reads RED in-game (per-mob red tint + desaturation) — match that here so
// the preview looks like the game; the user can recolour it from there.
const COLOR_BLOODY: ColorMods = { sat: 55, hue: 0, tint: '#c01818', tintAmt: 48 };
export const defaultColor = (type: number): ColorMods => (type === 6 ? COLOR_BLOODY : COLOR_NEUTRAL);

// Per-type preview behaviour, matching the in-game look:
//  • 7 Spintroll spins fast (its in-game ~3.5 rev/s), 9 Ghost spins slowly like its idle.
//  • 9 Ghost renders upside-down + 50% transparent.
//  • 1 Demon Horde + 2 Mushroom Grunt + 6 Bloody Skeleton are HORDES — show 5 in a cluster, not one.
const spinRate = (type: number) => (type === 7 ? 22 : type === 9 ? 0.9 : 0.5);   // rad/s
const isUpsideDown = (type: number) => type === 9;
const opacityFor = (type: number) => (type === 9 ? 0.5 : 1);
const countFor = (type: number) => (type === 1 || type === 2 || type === 6 ? 5 : 1);
const HORDE_OFFSETS: [number, number, number][] = [
  [0, 0, 0.18], [-0.55, 0, -0.12], [0.55, 0, -0.12], [-0.3, 0, 0.5], [0.32, 0, -0.52],
];

// Brighten + recolour a clone's materials (the SAME shader the game uses), returning its uniforms.
function setupMaterials(c: THREE.Group, opacity: number): RecolorUniforms[] {
  const list: RecolorUniforms[] = [];
  c.traverse((o) => {
    const mesh = o as THREE.Mesh;
    mesh.frustumCulled = false;
    if (!mesh.isMesh) return;
    const src = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const mats = src.map((mm) => (mm as THREE.Material).clone());
    mesh.material = Array.isArray(mesh.material) ? mats : mats[0];
    mats.forEach((mm) => {
      const m = mm as THREE.MeshStandardMaterial;
      if ('metalness' in m) m.metalness = 0;
      if ('roughness' in m) m.roughness = 0.85;
      if ('emissive' in m && m.map) { m.emissive = new THREE.Color(0xffffff); m.emissiveMap = m.map; m.emissiveIntensity = 0.5; }
      if (opacity < 1) { m.transparent = true; m.opacity = opacity; m.depthWrite = false; }
      list.push(injectRecolor(m));
    });
  });
  return list;
}

// One animated monster (its own skeleton clone + mixer), placed at `offset` within the group.
function Member({ url, modelHeight, color, opacity, upsideDown, scaleMul, offset }: {
  url: string; modelHeight: number; color: ColorMods; opacity: number; upsideDown: boolean; scaleMul: number; offset: [number, number, number];
}) {
  const { scene, animations } = useGLTF(url);
  const uniforms = useRef<RecolorUniforms[]>([]);
  const cloned = useMemo(() => { const c = SkeletonUtils.clone(scene) as THREE.Group; uniforms.current = setupMaterials(c, opacity); return c; }, [scene, opacity]);
  useEffect(() => { for (const u of uniforms.current) setRecolor(u, color); }, [color, cloned]);
  const root = useRef<THREE.Group>(null);
  const { actions, names } = useAnimations(animations, root);
  useEffect(() => {
    const idleName = names.find((nm) => nm.toLowerCase().includes('idle')) ?? names[0];
    const a = idleName ? actions[idleName] : null;
    if (a) { a.reset().fadeIn(0.3).play(); a.time = Math.random() * (a.getClip().duration || 1); }   // desync horde members
    return () => { a?.fadeOut(0.2); };
  }, [actions, names]);

  const scale = (TARGET / (modelHeight || 1.795)) * scaleMul;
  const half = (TARGET * scaleMul) / 2;
  return (
    <group ref={root} position={offset}>
      {/* feet-at-origin model; flip 180° on X (head-down) for the ghost, recentred so it stays framed. */}
      <group position={[0, upsideDown ? half : -half, 0]} rotation={[upsideDown ? Math.PI : 0, 0, 0]} scale={scale}>
        <primitive object={cloned} />
      </group>
    </group>
  );
}

// The spinning group: 1 member normally, 5 for a horde; body flames for single flame-monsters.
function Model({ type, color }: { type: number; color: ColorMods }) {
  const url = urlFor(type), mh = heightFor(type), flames = flamesFor(type);
  const count = countFor(type), upsideDown = isUpsideDown(type), opacity = opacityFor(type), spin = spinRate(type);
  const scaleMul = count > 1 ? 0.62 : 1;
  const turn = useRef<THREE.Group>(null);
  useFrame((_, d) => { if (turn.current) turn.current.rotation.y += d * spin; });
  const feetY = -TARGET / 2, radius = 0.2 * TARGET;
  return (
    <group ref={turn}>
      {HORDE_OFFSETS.slice(0, count).map((o, i) => (
        <Member key={i} url={url} modelHeight={mh} color={color} opacity={opacity} upsideDown={upsideDown} scaleMul={scaleMul} offset={count > 1 ? o : [0, 0, 0]} />
      ))}
      {count === 1 && flames && flames.length > 0 && (
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
function Scene({ type, color, dist, fov }: { type: number; color: ColorMods; dist: number; fov: number }) {
  return (
    <>
      <PerspectiveCamera makeDefault position={[0, 0, dist]} fov={fov} />
      <ambientLight intensity={0.85} />
      <directionalLight position={[3, 5, 4]} intensity={1.5} />
      <directionalLight position={[-4, 2, -3]} intensity={0.6} color="#7fb0ff" />
      <Suspense fallback={null}>
        <Model type={type} color={color} />
      </Suspense>
    </>
  );
}

const BOX_BG = 'radial-gradient(120% 100% at 50% 10%, hsla(220,30%,24%,0.96), hsla(222,34%,8%,0.98))';

// Small square in a card header. The DOM box is drawn here; the monster comes from MonsterPortCanvas.
export function MonsterThumb({ type, color, size = 60 }: { type: number; color: ColorMods; size?: number }) {
  return (
    <View style={{
      width: size, height: size, flexShrink: 0, borderRadius: 7, overflow: 'hidden',
      border: '1px solid hsl(var(--panel-glow) / 0.55)', background: BOX_BG,
    }}>
      <Scene type={type} color={color} dist={3.6} fov={28} />
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
export function MonsterPreviewBox({ type, name, color, x, y, w = 260, h = 260 }: {
  type: number; name: string; color: ColorMods; x: number; y: number; w?: number; h?: number;
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
        <Scene type={type} color={color} dist={2.78} fov={35} />
      </Canvas>
    </div>
  );
}
