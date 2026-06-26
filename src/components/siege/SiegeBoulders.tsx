// SiegeBoulders — the IN-GAME renderer + physics tick for Elemental Golem boulders. The boulder
// system (boulderSystem.ts) is module-level; this mounts in the live world so thrown boulders are
// simulated and drawn during challenges (previously they only existed on the lineup-review screen,
// which is why the Golem never appeared to throw anything in a real game). Each pooled mesh gets its
// own material clone so a boulder can be tinted its authored Spawn-Card colour (e.g. white for Yeti).

import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { getBoulders, updateBoulders } from './boulderSystem';
import { APP_VERSION } from '@/version';

const POOL = 24;
const DEFAULT_COL = 0x8a8a8a;

export function SiegeBoulders() {
  const camera = useThree((s) => s.camera);
  const refs = useRef<(THREE.Mesh | null)[]>([]);
  const { scene } = useGLTF(`/siege/monsters/boulder.glb?v=${APP_VERSION}`);

  // One shared geometry; a SEPARATE material per pool slot so each boulder can carry its own colour.
  const { geo, mats } = useMemo(() => {
    let g: THREE.BufferGeometry | null = null, base: THREE.Material | null = null;
    scene.traverse((o) => { const me = o as THREE.Mesh; if (me.isMesh && !g) { g = me.geometry; base = me.material as THREE.Material; } });
    const geometry = g ?? new THREE.SphereGeometry(1, 16, 12);
    const src = (base as THREE.Material) ?? new THREE.MeshStandardMaterial({ color: DEFAULT_COL, roughness: 1, metalness: 0 });
    const list = Array.from({ length: POOL }, () => src.clone() as THREE.MeshStandardMaterial);
    return { geo: geometry, mats: list };
  }, [scene]);

  useFrame((_, dt) => {
    updateBoulders(dt, camera.position.x, camera.position.y - 1.6, camera.position.z);
    const bs = getBoulders();
    for (let i = 0; i < POOL; i++) {
      const m = refs.current[i]; if (!m) continue;
      const b = bs[i];
      if (b) {
        m.visible = true;
        m.position.set(b.x, b.y, b.z);
        m.rotation.x += dt * 2; m.rotation.z += dt * 1.3;
        const mat = mats[i];
        if (mat.color) mat.color.set(b.color ?? DEFAULT_COL);
      } else {
        m.visible = false;
      }
    }
  });

  return <>{Array.from({ length: POOL }).map((_, i) => (
    <mesh key={i} ref={(el) => { refs.current[i] = el; }} geometry={geo} material={mats[i]} visible={false} frustumCulled={false} />
  ))}</>;
}

useGLTF.preload(`/siege/monsters/boulder.glb?v=${APP_VERSION}`);
