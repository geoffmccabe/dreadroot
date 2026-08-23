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
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { charGlbUrl } from '@/components/siege/charadmin/characterStats';
import {
  DREADROOT_CHARACTERS, SW_STAT_SCHEMA, SW_BASELINE, statDelta,
  MIXAMO_IDLE_LIBRARY, ROOT_RIG_ANIM_SOURCE, swSpeeds,
  type DreadrootCharacter, type SwStats,
} from './dreadrootCharacters';
import { useSelectedCharacter, setSelectedCharacter } from './characterSelection';



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
   * Size and stand the model from its ACTUAL rendered bounds, not from a
   * number in the roster.
   *
   * The roster's rawH came from reading raw mesh data, which ignores the node
   * transforms above the mesh — so it was wrong for any model whose exporter
   * put the scale on the root (Jeanette read as 33.7 units). Measuring the
   * real world-space box after loading is correct for every character and
   * needs no per-model number.
   *
   * The rotation still has to be declared: a bounding box cannot tell you
   * whether a character is lying down or simply wide.
   */
  const fitted = useMemo(() => {
    const holder = new THREE.Group();
    if (c.rootFix?.rotXDeg) holder.rotation.x = (c.rootFix.rotXDeg * Math.PI) / 180;
    if (c.rootFix?.scale) holder.scale.setScalar(c.rootFix.scale);
    holder.add(cloned);
    holder.updateWorldMatrix(true, true);

    const box = new THREE.Box3().setFromObject(holder);
    const size = new THREE.Vector3();
    const centre = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(centre);

    // Height is the tallest axis only AFTER the root fix has stood it up.
    const h = size.y > 1e-6 ? size.y : Math.max(size.x, size.z, 1);
    const k = c.targetH / h;

    const outer = new THREE.Group();
    outer.add(holder);
    outer.scale.setScalar(k);
    // Sit its feet on the origin, then drop by half so it is centred in view.
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="user-panel-dialog max-w-[880px] w-[92vw] p-0 overflow-hidden">
        <div className="flex flex-col md:flex-row" style={{ minHeight: 460 }}>
          {/* LEFT — name above the character, then the character itself */}
          <div className="md:w-[46%] flex flex-col border-b md:border-b-0 md:border-r"
               style={{ borderColor: 'var(--hud-border)' }}>
            <div className="px-5 pt-4 pb-1">
              <div className="text-3xl font-bold leading-tight">{c.name}</div>
              <div className="text-xs opacity-70">
                Opt+Cmd+{idx + 1}

              </div>
            </div>
            <div className="flex-1 min-h-[300px]">
              <Preview c={c} />
            </div>
          </div>

          {/* RIGHT — everything known about the character */}
          <div className="md:w-[54%] p-5 overflow-y-auto" style={{ maxHeight: '70vh' }}>
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
      </DialogContent>
    </Dialog>
  );
}
