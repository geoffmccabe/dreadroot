/**
 * Character chooser. Temporary by design: players may switch at any time.
 *
 * Layout follows Geoff's spec — the character on the left with its idle
 * playing, the name large in the top-left, and everything we know about it on
 * the right. Styling reuses `user-panel-dialog` so it matches the rest of the
 * game HUD rather than inventing a look.
 */
import { Suspense, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { useGLTF, useAnimations } from '@react-three/drei';
import { SkeletonUtils } from 'three-stdlib';
import * as THREE from 'three';
import { charGlbUrl } from '@/components/siege/charadmin/characterStats';
import {
  DREADROOT_CHARACTERS, SW_STAT_SCHEMA, SW_BASELINE, statDelta,
  MIXAMO_IDLE_LIBRARY, ROOT_RIG_ANIM_SOURCE, swSpeeds,
  type DreadrootCharacter, type SwStats,
} from './dreadrootCharacters';
import { useSelectedCharacter, setSelectedCharacter } from './characterSelection';
import { GamePanel } from '@/components/ui/GamePanel';



function CharModel({ c }: { c: DreadrootCharacter }) {
  const { scene } = useGLTF(charGlbUrl(c.file), '/draco/');
  // Two incompatible skeletons: the pilot models are Mixamo-named and driven by
  // the shared idle library; flamma/jeanette/shiyang use a different rig whose
  // animations only exist inside Shi Yang's glb. Neither library can drive the
  // other — they share no bone names at all.
  const animSrc = c.rig === 'mixamo' ? MIXAMO_IDLE_LIBRARY : ROOT_RIG_ANIM_SOURCE;
  const { animations } = useGLTF(charGlbUrl(animSrc), '/draco/');
  const root = useRef<THREE.Group>(null);

  const cloned = useMemo(() => {
    const g = SkeletonUtils.clone(scene) as THREE.Group;
    g.traverse((o) => { (o as THREE.Mesh).frustumCulled = false; });
    return g;
  }, [scene]);

  const { actions, names } = useAnimations(animations, root);

  useEffect(() => {
    const found = names.find((n) => n === c.idleClip)
      ?? names.find((n) => n.toLowerCase() === c.idleClip.toLowerCase())
      ?? names[0];
    const a = found ? actions[found] : null;
    a?.reset().fadeIn(0.25).play();
    return () => { a?.fadeOut(0.2); };
  }, [actions, names, c]);

  useFrame((_, dt) => { if (root.current) root.current.rotation.y += dt * 0.35; });

  /**
   * Size and stand the model from the bounds the renderer ACTUALLY uses.
   *
   * THE BUG THIS FIXES, measured rather than guessed. Every pilot model is a
   * SKINNED mesh sitting under an armature node scaled by 0.01. glTF says a
   * skinned mesh's own node transform is IGNORED — the mesh is posed by joint
   * matrices in bind space — and three.js honours that. But Box3.setFromObject
   * does NOT: it multiplies by matrixWorld like any other object. So measuring
   * Ash returned 0.0038 units tall when he actually renders at 1.79, and
   * targetH / 0.0038 scaled him up about 450x. Hence a screen full of boot.
   *
   * So: take a skinned mesh's geometry bounds in BIND SPACE and skip its world
   * matrix, exactly as the renderer does. Non-skinned children still get their
   * transform, since for those it is real.
   *
   * Doing it from the live geometry rather than a number in the roster also
   * means a re-exported model needs no bookkeeping — and it is what tells
   * Jeanette apart, whose bind pose is lying down, so her HEIGHT is her Z
   * extent (173) and not her Y extent (33.7). Rotating the box before
   * measuring is what picks the right axis.
   */
  const fitted = useMemo(() => {
    const holder = new THREE.Group();
    if (c.rootFix?.rotXDeg) holder.rotation.x = (c.rootFix.rotXDeg * Math.PI) / 180;
    holder.add(cloned);
    holder.updateWorldMatrix(true, true);

    const box = new THREE.Box3();
    const tmp = new THREE.Box3();
    cloned.updateWorldMatrix(true, true);
    cloned.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!(m as unknown as { isMesh?: boolean }).isMesh || !m.geometry) return;
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      const bb = m.geometry.boundingBox;
      if (!bb) return;
      tmp.copy(bb);
      // The one line that matters: a skinned mesh renders in bind space, so
      // its world matrix must NOT be applied here.
      if (!(m as unknown as { isSkinnedMesh?: boolean }).isSkinnedMesh) {
        tmp.applyMatrix4(m.matrixWorld);
      }
      box.union(tmp);
    });

    // Rotate the box the same way the model is rotated, so "height" means the
    // axis that ends up vertical rather than the one it was authored on.
    if (c.rootFix?.rotXDeg) {
      box.applyMatrix4(new THREE.Matrix4().makeRotationX((c.rootFix.rotXDeg * Math.PI) / 180));
    }

    const size = new THREE.Vector3();
    const centre = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(centre);

    // Fall back to the roster height if the geometry told us nothing, so a
    // bad model can never produce another 450x.
    const h = size.y > 1e-4 ? size.y : c.rawH;
    const k = c.targetH / (h > 1e-4 ? h : 1);

    const outer = new THREE.Group();
    outer.add(holder);
    outer.scale.setScalar(k);
    // Feet on the origin, then drop by half so the body is centred in frame.
    holder.position.set(-centre.x, -box.min.y, -centre.z);
    return outer;
  }, [cloned, c]);

  return (
    <group ref={root} position={[0, -c.targetH / 2, 0]}>
      <primitive object={fitted} />
    </group>
  );
}

function Preview({ c }: { c: DreadrootCharacter }) {
  return (
    <Canvas camera={{ position: [0, 0.15, 3.0], fov: 38 }} dpr={[1, 1.5]} style={{ width: '100%', height: '100%' }}>
      <ambientLight intensity={1.1} />
      <directionalLight position={[3, 5, 4]} intensity={1.5} />
      <directionalLight position={[-3, 2, -2]} intensity={0.6} />
      <Suspense fallback={null}>
        <CharModel c={c} />
      </Suspense>
    </Canvas>
  );
}

function StatRow({ label, value, unit, lowerIsBetter, delta, hint }: {
  label: string; value: number; unit: string; lowerIsBetter?: boolean; delta: number; hint?: string;
}) {
  // A multiplier below 1 on "damage taken" is GOOD, so the colour follows the
  // benefit, not the number.
  const better = delta === 0 ? null : (lowerIsBetter ? delta < 0 : delta > 0);
  const colour = better === null ? 'inherit' : better ? 'hsl(140 60% 60%)' : 'hsl(0 70% 65%)';
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="opacity-80" title={hint}>{label}</span>
      <span className="font-mono flex items-baseline gap-2">
        {delta !== 0 && (
          <span style={{ color: colour, fontSize: 11 }}>{delta > 0 ? '+' : ''}{delta}%</span>
        )}
        <span>{unit === 'multiplier' ? `${value}x` : value}</span>
      </span>
    </div>
  );
}

export function CharacterChooserModal({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const selected = useSelectedCharacter();
  const c = DREADROOT_CHARACTERS.find((x) => x.name === selected) ?? DREADROOT_CHARACTERS[0];
  const idx = DREADROOT_CHARACTERS.indexOf(c);

  return (
    <GamePanel
      open={open}
      onClose={() => onOpenChange(false)}
      title="Choose Character"
      defaultWidth={880}
      defaultHeight={560}
      minWidth={520}
      maxWidth={1200}
      minHeight={380}
      maxHeight={900}
      // Down 8% of the viewport so it never lands on the FPS / info readout
      // that lives at the top of the screen.
      initialStyle={{ top: '8vh', left: '50%', marginLeft: -440 }}
      // The shared surface is too dark to read this much text against a bright
      // 3D world. Lighter here only; the panel theme is untouched elsewhere.
      surfaceBg="hsla(220 22% 20% / 0.90)"
    >
      <div className="flex flex-col md:flex-row h-full">
        {/* LEFT — name above the character, then the character itself */}
        <div className="md:w-[46%] flex flex-col border-b md:border-b-0 md:border-r"
             style={{ borderColor: 'var(--hud-border)' }}>
          <div className="px-2 pt-1 pb-1">
            <div className="text-3xl font-bold leading-tight">{c.name}</div>
            <div className="text-xs opacity-70">Opt+Cmd+{idx + 1}</div>
          </div>
          <div className="flex-1 min-h-[260px]">
            <Preview c={c} />
          </div>
        </div>

        {/* RIGHT — everything known about the character */}
        <div className="md:w-[54%] p-3 overflow-y-auto">
          <div className="text-sm font-semibold mb-2 opacity-80">
            Stats <span className="font-normal opacity-60">· vs standard</span>
          </div>
          <div className="space-y-1.5 mb-5">
            {SW_STAT_SCHEMA.map((f) => {
              const v = c.stats[f.key as keyof SwStats];
              return (
                <StatRow
                  key={f.key}
                  label={f.label}
                  value={v}
                  unit={f.unit}
                  lowerIsBetter={f.lowerIsBetter}
                  delta={statDelta(f.key as keyof SwStats, v)}
                  hint={f.hint}
                />
              );
            })}
          </div>
          <div className="text-xs opacity-70 mb-4 font-mono">
            Siege Worlds speed: {swSpeeds(c).walk} walk / {swSpeeds(c).run} run m/s
          </div>
          {c.statsAreDefault && (
            <div className="text-xs opacity-60 mb-4">
              Not in the Siege Worlds balance table yet — showing the server default.
            </div>
          )}

          <div className="text-sm font-semibold mb-1 opacity-80">Special Ability</div>
          {c.special ? (
            <div className="text-sm mb-5">
              <div className="font-semibold">{c.special.header}</div>
              <div className="opacity-80">{c.special.description}</div>
            </div>
          ) : (
            <div className="text-sm opacity-60 mb-5">None defined yet.</div>
          )}

          <div className="text-xs opacity-60 mb-4 leading-relaxed">
            Stats are the live Siege Worlds balance values, relative to a 1.0 standard — so 1.2x
            move speed is 20% faster than normal. Damage Taken multiplies incoming damage, so
            lower is better.
          </div>

          <div className="text-sm font-semibold mb-2 opacity-80">Choose Character</div>
          <div className="grid grid-cols-3 gap-2">
            {DREADROOT_CHARACTERS.map((x, i) => (
              <button
                key={x.name}
                data-no-drag
                onClick={() => setSelectedCharacter(x.name)}
                className="text-sm rounded px-2 py-2 border text-left"
                style={{
                  borderColor: x.name === c.name ? 'hsl(200 85% 55%)' : 'var(--hud-border)',
                  background: x.name === c.name ? 'hsla(200,85%,55%,0.18)' : 'transparent',
                }}
              >
                <div className="font-medium truncate">{x.name}</div>
                <div className="text-[10px] opacity-60">⌥⌘{i + 1}</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </GamePanel>
  );
}
