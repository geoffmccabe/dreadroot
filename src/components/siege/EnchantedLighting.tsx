// EnchantedLighting — keeps Enchanted Forest's fixed dusk mood. The global fortress day/night
// system (FortressScene) drives scene.fog + scene.background from the live sky EVERY frame, which
// clobbers a static <fogExp2 attach="fog">. So re-assert EF's dense dusk-blue exponential fog +
// matching dark background each frame (same approach BleakrockLighting uses for its horror fog),
// so the enchanted dusk look — and the additive fireflies' visibility against it — survive the
// day cycle. Snapshots + restores whatever was there on unmount.
import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

const FOG = new THREE.FogExp2(0x2e436b, 0.016);   // dusk-blue, matches the original EF fog
const BG = new THREE.Color('#1b2740');            // a touch darker than the fog so fireflies pop

export function EnchantedLighting() {
  const scene = useThree((s) => s.scene);
  const saved = useRef<{ fog: THREE.FogBase | null; bg: typeof scene.background } | null>(null);
  useEffect(() => {
    saved.current = { fog: scene.fog, bg: scene.background };
    return () => { if (saved.current) { scene.fog = saved.current.fog; scene.background = saved.current.bg; } };
  }, [scene]);
  // Re-assert each frame so the day/night fog/background override can't strip the dusk mood.
  useFrame(() => {
    scene.fog = FOG;
    if (scene.background !== BG) scene.background = BG;
  });
  return null;
}
