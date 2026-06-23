// SiegeCharacterLineup — the toggleable lineup of the Starblind characters (Ash, Thorn, … as more
// are rigged). Toggle with "&&&". They appear ON THE GROUND in a row in front of the player in any
// SWW world, facing you. M = next animation, N = previous (same Mixamo skeleton + clips on every
// character, so one index drives them all). The current animation's number/name shows in the HUD.
//
// In-canvas only (renders inside <Canvas>); the HUD readout lives in SiegeCharLineupHud (DOM).
import { Suspense, useEffect, useMemo, useRef } from 'react';
import { useGLTF, useAnimations } from '@react-three/drei';
import { useThree, useFrame } from '@react-three/fiber';
import { SkeletonUtils } from 'three-stdlib';
import * as THREE from 'three';
import { sampleHeight } from './terrainHeight';
import { APP_VERSION } from '@/version';
import {
  LINEUP_CHARS, useCharLineup, getCharLineupEnabled, toggleCharLineup,
  cycleCharAnim, setCharAnimNames, setCharAnchor,
} from './charlineup/siegeCharLineupState';

const SPACING = 2.2; // metres between characters
const AHEAD = 5;     // metres in front of the player the row appears

function LineupChar({ file, x, z, yaw, animIndex }: { file: string; x: number; z: number; yaw: number; animIndex: number }) {
  const { scene, animations } = useGLTF(`${file}?v=${APP_VERSION}`);
  const cloned = useMemo(() => SkeletonUtils.clone(scene) as THREE.Group, [scene]);
  const group = useRef<THREE.Group>(null);
  const { actions, names } = useAnimations(animations, group);

  // Publish the clip names once (identical across characters — same skeleton/clips).
  useEffect(() => { if (names.length) setCharAnimNames(names); }, [names]);

  const groundY = useMemo(() => sampleHeight(x, z) ?? 0, [x, z]);

  useEffect(() => {
    if (!names.length) return;
    const name = names[animIndex % names.length];
    const a = actions[name];
    a?.reset().fadeIn(0.2).play();
    return () => { a?.fadeOut(0.2); };
  }, [actions, names, animIndex]);

  return (
    <group ref={group} position={[x, groundY, z]} rotation={[0, yaw, 0]}>
      <primitive object={cloned} />
    </group>
  );
}

export function SiegeCharacterLineup() {
  const { enabled, animIndex, anchor } = useCharLineup();
  const { camera } = useThree();

  // "&&&" toggles the lineup; M / N cycle animations while it's shown. Capture-phase so the
  // lineup's M/N win over any other M handler when the lineup is up.
  useEffect(() => {
    let amp: number[] = [];
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '&') {
        const now = Date.now();
        amp = amp.filter((t) => now - t < 900);
        amp.push(now);
        if (amp.length >= 3) { amp = []; toggleCharLineup(); }
        return;
      }
      if (!getCharLineupEnabled()) return;
      const tgt = e.target as HTMLElement | null;
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)) return;
      if (e.key === 'm' || e.key === 'M') { e.stopImmediatePropagation(); cycleCharAnim(1); }
      else if (e.key === 'n' || e.key === 'N') { e.stopImmediatePropagation(); cycleCharAnim(-1); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // When toggled on, snapshot a spot ~5m ahead of the player; the row sits there facing the player.
  useEffect(() => {
    if (!enabled) return;
    const p = camera.getWorldPosition(new THREE.Vector3());
    const f = camera.getWorldDirection(new THREE.Vector3());
    f.y = 0; if (f.lengthSq() < 1e-4) f.set(0, 0, 1); f.normalize();
    const cx = p.x + f.x * AHEAD;
    const cz = p.z + f.z * AHEAD;
    // Characters' +Z faces back toward the player.
    const yaw = Math.atan2(-f.x, -f.z);
    setCharAnchor({ x: cx, z: cz, yaw });
  }, [enabled, camera]);

  if (!enabled || !anchor) return null;

  const n = LINEUP_CHARS.length;
  // Spread along the row axis (perpendicular to the facing direction).
  const rx = Math.cos(anchor.yaw), rz = -Math.sin(anchor.yaw);

  return (
    <Suspense fallback={null}>
      {LINEUP_CHARS.map((c, i) => {
        const off = (i - (n - 1) / 2) * SPACING;
        return (
          <LineupChar key={c.name} file={c.file} x={anchor.x + rx * off} z={anchor.z + rz * off} yaw={anchor.yaw} animIndex={animIndex} />
        );
      })}
    </Suspense>
  );
}
