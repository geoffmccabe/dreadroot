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
  DREADROOT_CHARACTERS, SW_STAT_SCHEMA, type DreadrootCharacter,
} from './dreadrootCharacters';
import { useSelectedCharacter, setSelectedCharacter } from './characterSelection';

const IDLE_LIBRARY = '/siege/characters/character_idles.glb';
/** Normalised height so every character reads the same size in the preview. */
const TARGET_H = 1.75;

function CharModel({ c }: { c: DreadrootCharacter }) {
  const { scene, animations: ownAnims } = useGLTF(charGlbUrl(c.file), '/draco/');
  const { animations: sharedAnims } = useGLTF(charGlbUrl(IDLE_LIBRARY), '/draco/');
  const root = useRef<THREE.Group>(null);

  const cloned = useMemo(() => {
    const g = SkeletonUtils.clone(scene) as THREE.Group;
    g.traverse((o) => { (o as THREE.Mesh).frustumCulled = false; });
    return g;
  }, [scene]);

  // A character either plays a clip from the shared idle library, or one from
  // its own glb. Flamma and Jeanette ship no animation data at all, so they
  // stand in their bind pose — that is the asset, not a bug.
  const clips = c.ownIdleClip ? ownAnims : sharedAnims;
  const { actions, names } = useAnimations(clips, root);

  useEffect(() => {
    const want = c.ownIdleClip ?? c.idleClip;
    if (!want) return;
    const found = names.find((n) => n === want)
      ?? names.find((n) => n.toLowerCase() === want.toLowerCase())
      ?? names[0];
    const a = found ? actions[found] : null;
    a?.reset().fadeIn(0.25).play();
    return () => { a?.fadeOut(0.2); };
  }, [actions, names, c]);

  // Slow turntable so the model can be seen from more than one angle.
  useFrame((_, dt) => { if (root.current) root.current.rotation.y += dt * 0.35; });

  const scale = TARGET_H / (c.rawH || 1);
  return (
    <group ref={root}>
      <primitive object={cloned} scale={scale} position={[0, -TARGET_H / 2, 0]} />
    </group>
  );
}

function Preview({ c }: { c: DreadrootCharacter }) {
  return (
    <Canvas camera={{ position: [0, 0.15, 3.1], fov: 38 }} dpr={[1, 1.5]} style={{ width: '100%', height: '100%' }}>
      <ambientLight intensity={1.1} />
      <directionalLight position={[3, 5, 4]} intensity={1.5} />
      <directionalLight position={[-3, 2, -2]} intensity={0.6} />
      <Suspense fallback={null}>
        <CharModel c={c} />
      </Suspense>
    </Canvas>
  );
}

function formatStat(v: number, unit?: string): string {
  return unit === 'multiplier' ? `${v}x` : String(v);
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
                {c.staticOnly ? ' · no idle animation in this model' : ''}
              </div>
            </div>
            <div className="flex-1 min-h-[300px]">
              <Preview c={c} />
            </div>
          </div>

          {/* RIGHT — everything known about the character */}
          <div className="md:w-[54%] p-5 overflow-y-auto" style={{ maxHeight: '70vh' }}>
            <div className="text-sm font-semibold mb-2 opacity-80">Stats</div>
            <div className="space-y-1.5 mb-5">
              {SW_STAT_SCHEMA.map((s) => (
                <div key={s.key} className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="opacity-80">{s.label}</span>
                  <span className="font-mono">{formatStat(s.base, s.unit)}</span>
                </div>
              ))}
            </div>

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
              Stat fields match the Siege Worlds client so both games describe a character the same
              way. The values are the Siege Worlds baselines: in Unity the real numbers arrive from
              the game server at runtime, so they are not in any file to copy.
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
