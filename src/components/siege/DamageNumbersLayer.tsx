// DamageNumbers — renders the floating combat popups (damageNumbers.ts) as billboarded 3D text,
// replicating the Unity FloatingDamageText motion: pop-in with an OutBack overshoot (0.75s), drift
// up + sideways at the puff's speed, hold full opacity for the first half of its ~1s life then fade.
// Mounts inside the R3F Canvas (siege scene).
import { useRef, useState, useSyncExternalStore } from 'react';
import { useFrame } from '@react-three/fiber';
import { Billboard, Text } from '@react-three/drei';
import * as THREE from 'three';
import {
  getDamageNumbers, getDNVersion, subscribeDamageNumbers, pruneDamageNumbers, DN_LIFE_MS,
  type DamageNumber,
} from './damageNumbers';

// Unity Ease.OutBack — overshoots past 1 then settles (the little "pop").
function outBack(t: number): number {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function DamageItem({ d }: { d: DamageNumber }) {
  const group = useRef<THREE.Group>(null);
  const txt = useRef<(THREE.Mesh & { material: THREE.Material; outlineWidth: number; sync?: () => void }) | null>(null);
  const outlineSet = useRef(false);
  // Troika <Text> renders a WHITE placeholder quad until its glyph SDF is synced (≈1s on the first
  // use while the font/shader load) — that's the "white screen on the first hit". Stay invisible
  // until the first sync completes, so no placeholder is ever shown.
  const [ready, setReady] = useState(false);
  useFrame((state) => {
    const g = group.current; if (!g) return;
    const age = performance.now() - d.born;
    const rise = d.speed * (Math.min(age, DN_LIFE_MS) / 1000);          // up at `speed` m/s
    g.position.set(d.x + d.driftX * d.speed * (Math.min(age, DN_LIFE_MS) / 1000) * 0.5, d.y + rise, d.z);
    g.scale.setScalar(age < 750 ? Math.max(0, outBack(age / 750)) : 1); // pop-in 0→1 over 0.75s
    const t = age / DN_LIFE_MS;
    // Peak at 70% opacity (30% transparent), hold 0.5s, then fade out.
    const alpha = 0.7 * (t < 0.5 ? 1 : Math.max(0, 1 - (t - 0.5) / 0.5));
    const m = txt.current?.material as (THREE.Material & { opacity: number }) | undefined;
    if (m) { m.transparent = true; m.opacity = alpha; }
    // Scale the black border to distance (once — the number only lives ~1s) so it reads as a
    // uniform thickness whether the kill is point-blank or across the map.
    if (!outlineSet.current && txt.current) {
      outlineSet.current = true;
      const camDist = state.camera.position.distanceTo(g.position);
      txt.current.outlineWidth = Math.min(0.14, Math.max(0.025, 0.006 * camDist));
      txt.current.sync?.();
    }
  });
  return (
    <Billboard ref={group} position={[d.x, d.y, d.z]}>
      <Text ref={txt as never} visible={ready} onSync={() => setReady(true)}
            font="/AVENGEANCE.ttf" fontSize={0.4} color={d.color}
            anchorX="center" anchorY="middle" outlineWidth={0.03} outlineColor="#000000">
        {d.text}
      </Text>
    </Billboard>
  );
}

export function DamageNumbers() {
  useSyncExternalStore(subscribeDamageNumbers, getDNVersion, getDNVersion);
  useFrame(() => pruneDamageNumbers(performance.now()));
  return (
    <>
      {/* Pre-warm troika (load the font + compile the SDF shader) off-screen + fully transparent, so
          by the first real hit there's no font-load delay and no white placeholder flash. */}
      <Text font="/AVENGEANCE.ttf" fontSize={0.1} fillOpacity={0} outlineOpacity={0} position={[0, -9999, 0]}>0123456789</Text>
      {getDamageNumbers().map((d) => <DamageItem key={d.id} d={d} />)}
    </>
  );
}
