// Mounts the authored 'shombie-face' light on the FRONT of each Shombie's head, aimed
// along its walk direction so it sweeps trees/ground/players as it moves. Plan B at
// scale: a fixed POOL of lights follows the nearest-K active Shombies (constant light
// count → no shader recompiles), and only SHADOW_CAP of them cast a real (cheap) shadow.
// Uses the saved light by code (live edits from the Lights panel apply too); falls back
// to the default so there's always something to test with.
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { frameLoop } from '@/lib/frameLoop';
import { GameLight } from '@/features/lights/GameLight';
import { useLightStore } from '@/features/lights/lightStore';
import { loadLights, getLight } from '@/features/lights/lightsDb';
import { DEFAULT_LIGHT, type LightDef } from '@/features/lights/lightTypes';
import type { ShombieInstance } from '../types';

const CODE = 'shombie-face';
const POOL = 4;        // max simultaneous face-lights (nearest to camera)
const SHADOW_CAP = 1;  // how many of those cast a real shadow

// Built-in default so Shombies ALWAYS have a visible face-beam, even before anyone
// saves a 'shombie-face' light in the Lights panel. A saved one (or live edit) overrides.
const FALLBACK: LightDef = {
  ...DEFAULT_LIGHT,
  code: CODE,
  name: 'Shombie Face',
  color: '#bfe6ff',
  intensity: 2.0,
  angleDeg: 24,
  range: 24,
  pitchDeg: 4,
  shadowSize: 512, // keep the single shadow-caster cheap
  emitterColor: '#bfe6ff',
  emitterIntensity: 2.0,
  emitterSize: 0.35,
  fogColor: '#bfe6ff',
  fogStrength: 0.18,
};

export function ShombieFaceLights({ shombies }: { shombies: ShombieInstance[] }) {
  const { camera } = useThree();
  const live = useLightStore();
  const [saved, setSaved] = useState<LightDef | null>(null);
  useEffect(() => { loadLights().then(() => setSaved(getLight(CODE))); }, []);
  // Live-edit if the Lights panel is editing this code; else the saved one; else fallback.
  const def = live.def.code === CODE ? live.def : (saved ?? FALLBACK);

  const shombiesRef = useRef(shombies);
  useEffect(() => { shombiesRef.current = shombies; }, [shombies]);

  const groupRefs = useMemo(() => Array.from({ length: POOL }, () => ({ current: null as THREE.Group | null })), []);
  const lastFacing = useMemo(() => Array.from({ length: POOL }, () => new THREE.Vector3(0, 0, -1)), []);

  useEffect(() => {
    const fwd = new THREE.Vector3();
    const pos = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const Z = new THREE.Vector3(0, 0, -1);
    // Reused selection buffers — the nearest POOL shombies, chosen in one O(n) pass
    // (no filter/sort, no per-frame allocation) and re-picked at ~5Hz, not 60Hz.
    const chosen: (ShombieInstance | null)[] = new Array(POOL).fill(null);
    const bestDist = new Float64Array(POOL);
    let sinceSelect = 1e9;

    const unreg = frameLoop.register('shombie-face-lights', (delta) => {
      sinceSelect += delta;
      if (sinceSelect >= 0.2) {
        sinceSelect = 0;
        for (let k = 0; k < POOL; k++) { chosen[k] = null; bestDist[k] = Infinity; }
        const all = shombiesRef.current;
        const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
        for (let n = 0; n < all.length; n++) {
          const s = all[n];
          if (!s.isActive) continue;
          const dx = s.position.x - cx, dy = s.position.y - cy, dz = s.position.z - cz;
          const d = dx * dx + dy * dy + dz * dz;
          // Insert into the small sorted top-K (POOL=4, so this inner loop is tiny).
          if (d >= bestDist[POOL - 1]) continue;
          let j = POOL - 1;
          while (j > 0 && bestDist[j - 1] > d) { bestDist[j] = bestDist[j - 1]; chosen[j] = chosen[j - 1]; j--; }
          bestDist[j] = d; chosen[j] = s;
        }
      }
      // Track the chosen lights every frame so they move smoothly.
      for (let i = 0; i < POOL; i++) {
        const g = groupRefs[i].current;
        if (!g) continue;
        const s = chosen[i];
        if (!s || !s.isActive) { g.position.set(0, -10000, 0); continue; }
        const sc = s.scale || 1;
        const speed = Math.hypot(s.velocity.x, s.velocity.z);
        if (speed > 0.05) fwd.set(s.velocity.x / speed, 0, s.velocity.z / speed);
        else fwd.copy(lastFacing[i]);
        lastFacing[i].copy(fwd);
        const headY = s.position.y + 1.7 * sc;
        pos.set(s.position.x + fwd.x * 0.3 * sc, headY, s.position.z + fwd.z * 0.3 * sc);
        g.position.copy(pos);
        q.setFromUnitVectors(Z, fwd);
        g.quaternion.copy(q);
      }
    }, 35);
    return unreg;
  }, [camera, groupRefs, lastFacing]);

  return (
    <>
      {Array.from({ length: POOL }).map((_, i) => (
        <group key={i} ref={(n) => { groupRefs[i].current = n; }}>
          <GameLight def={{ ...def, shadowOn: def.shadowOn && i < SHADOW_CAP }} idSuffix={`shombie-${i}`} />
        </group>
      ))}
    </>
  );
}
