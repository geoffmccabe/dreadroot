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
import type { ColorMods } from './challengeTypes';

const FALLBACK = '/siege/monsters/skeletonlight.glb';                 // type 6 (horde) has no CFG
const urlFor = (type: number) => CFG[type as MType]?.url ?? FALLBACK;
const heightFor = (type: number) => CFG[type as MType]?.modelHeight ?? 1.795;
const flamesFor = (type: number) => CFG[type as MType]?.bodyFlames;
const TARGET = 1.4;   // normalized model height (world units); body centred on the origin

export const COLOR_NEUTRAL: ColorMods = { sat: 100, hue: 0, tint: '#ffffff', tintAmt: 0 };
// Bloody Skeleton (type 6) reads RED in-game (per-mob red tint + desaturation) — match that here so
// the preview looks like the game; the user can recolour it from there.
const COLOR_BLOODY: ColorMods = { sat: 55, hue: 0, tint: '#c01818', tintAmt: 48 };
export const defaultColor = (type: number): ColorMods => (type === 6 ? COLOR_BLOODY : COLOR_NEUTRAL);

type ColUniforms = { uHue: { value: number }; uSat: { value: number }; uTint: { value: THREE.Color }; uTintAmt: { value: number } };

function Model({ url, modelHeight, flames, color }: { url: string; modelHeight: number; flames?: BodyFlame[]; color: ColorMods }) {
  const { scene, animations } = useGLTF(url);
  const uniforms = useRef<ColUniforms[]>([]);
  // Clone (skeleton + skinned mesh) so this copy animates + recolours independently. Brighten the
  // dark source textures (metalness 0 + emissive map) like MonsterEnemy, and inject the recolour.
  const cloned = useMemo(() => {
    const c = SkeletonUtils.clone(scene) as THREE.Group;
    const list: ColUniforms[] = [];
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
        const u: ColUniforms = { uHue: { value: 0 }, uSat: { value: 1 }, uTint: { value: new THREE.Color('#ffffff') }, uTintAmt: { value: 0 } };
        m.customProgramCacheKey = () => `chalcol_${m.map ? 1 : 0}_${m.emissiveMap ? 1 : 0}`;
        m.onBeforeCompile = (shader) => {
          shader.uniforms.uHue = u.uHue; shader.uniforms.uSat = u.uSat;
          shader.uniforms.uTint = u.uTint; shader.uniforms.uTintAmt = u.uTintAmt;
          shader.fragmentShader = 'uniform float uHue;\nuniform float uSat;\nuniform vec3 uTint;\nuniform float uTintAmt;\n' + shader.fragmentShader;
          shader.fragmentShader = shader.fragmentShader.replace(
            '#include <dithering_fragment>',
            '#include <dithering_fragment>\n{ vec3 _c = gl_FragColor.rgb;'
            + ' if (uHue != 0.0) { vec3 _k = vec3(0.57735); float _cs = cos(uHue), _sn = sin(uHue); _c = _c*_cs + cross(_k,_c)*_sn + _k*dot(_k,_c)*(1.0-_cs); }'
            + ' float _l = dot(_c, vec3(0.299,0.587,0.114));'
            + ' _c = mix(vec3(_l), _c, uSat);'      // uSat: 0 grey · 1 normal · 2 oversaturated
            + ' _c = mix(_c, uTint, uTintAmt);'      // colour overlay
            + ' gl_FragColor.rgb = clamp(_c, 0.0, 1.0); }',
          );
        };
        m.needsUpdate = true;
        list.push(u);
      });
    });
    uniforms.current = list;
    return c;
  }, [scene]);

  // Push the live colour into every material's uniforms (no recompile) whenever it changes.
  useEffect(() => {
    for (const u of uniforms.current) {
      u.uHue.value = (color.hue * Math.PI) / 180;
      u.uSat.value = color.sat / 100;
      u.uTint.value.set(color.tint);
      u.uTintAmt.value = color.tintAmt / 100;
    }
  }, [color, cloned]);

  const turn = useRef<THREE.Group>(null);
  const { actions, names } = useAnimations(animations, turn);
  useEffect(() => {
    // Prefer a clip whose name CONTAINS "idle" (Synty rigs name it "A_Idle_Standing_Masc" etc.),
    // not an exact "idle" key — else we'd fall through to names[0], which is often the ATTACK clip
    // (e.g. mushroomgrunt → "A_Attack…", a broken-looking walk). Match the in-game resolver.
    const idleName = names.find((nm) => nm.toLowerCase().includes('idle')) ?? names[0];
    const a = idleName ? actions[idleName] : null;
    a?.reset().fadeIn(0.3).play();
    return () => { a?.fadeOut(0.2); };
  }, [actions, names]);
  useFrame((_, d) => { if (turn.current) turn.current.rotation.y += d * 0.5; });

  // Authored feet-at-origin; scale to TARGET tall then drop by TARGET/2 so the body is centred.
  const scale = TARGET / (modelHeight || 1.795);
  const feetY = -TARGET / 2;
  const radius = 0.2 * TARGET;

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
function Scene({ type, color, dist, fov }: { type: number; color: ColorMods; dist: number; fov: number }) {
  return (
    <>
      <PerspectiveCamera makeDefault position={[0, 0, dist]} fov={fov} />
      <ambientLight intensity={0.85} />
      <directionalLight position={[3, 5, 4]} intensity={1.5} />
      <directionalLight position={[-4, 2, -3]} intensity={0.6} color="#7fb0ff" />
      <Suspense fallback={null}>
        <Model url={urlFor(type)} modelHeight={heightFor(type)} flames={flamesFor(type)} color={color} />
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
