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
import { useShadowsEnabled } from '@/features/lights/shadowStore';
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
  intensity: 0.6,    // 30% of the previous 2.0 …
  angleDeg: 11,      // half as narrow (was 24)
  range: 48,         // … but reaches much farther
  decay: 1.0,        // gentle falloff so it actually carries the distance
  penumbra: 0.7,
  pitchDeg: 0,       // the group carries the full 3D aim at the target; no extra tilt
  shadowSize: 512,   // keep the single shadow-caster cheap
  emitterColor: '#bfe6ff',
  emitterIntensity: 1.6,
  emitterSize: 0.35,
  fogColor: '#bfe6ff',
  fogStrength: 0.18,
  fogLength: 42,     // long, soft beam
};

export function ShombieFaceLights({ shombies }: { shombies: ShombieInstance[] }) {
  const { camera } = useThree();
  const shadowsEnabled = useShadowsEnabled();
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
      // Aim each chosen light AT the enemy (the player) in full 3D — so the beam
      // tracks the target and swivels UP when the player is above (e.g. up a tree),
      // even though the shombie can't climb. Smoothly slerped for a searchlight feel.
      const px = camera.position.x, py = camera.position.y, pz = camera.position.z;
      for (let i = 0; i < POOL; i++) {
        const g = groupRefs[i].current;
        if (!g) continue;
        const s = chosen[i];
        if (!s || !s.isActive) { g.position.set(0, -10000, 0); continue; }
        const sc = s.scale || 1;
        const headY = s.position.y + 1.7 * sc; // head cube centre
        // Desired direction from the head to the target (player), in 3D.
        fwd.set(px - s.position.x, py - headY, pz - s.position.z);
        if (fwd.lengthSq() < 1e-6) fwd.copy(lastFacing[i]); else fwd.normalize();
        // Smooth swivel toward the target (so it "searches" rather than snapping).
        lastFacing[i].lerp(fwd, 0.12);
        if (lastFacing[i].lengthSq() < 1e-6) lastFacing[i].set(0, 0, -1); else lastFacing[i].normalize();
        const aim = lastFacing[i];
        // Lamp sits on the head's surface in the aim direction (front of the head,
        // tilting up with the beam) and the beam (group -Z) points exactly at the target.
        pos.set(s.position.x + aim.x * 0.28 * sc, headY + aim.y * 0.28 * sc, s.position.z + aim.z * 0.28 * sc);
        g.position.copy(pos);
        q.setFromUnitVectors(Z, aim);
        g.quaternion.copy(q);
      }
    }, 35);
    return unreg;
  }, [camera, groupRefs, lastFacing]);

  return (
    <>
      {Array.from({ length: POOL }).map((_, i) => (
        <group key={i} ref={(n) => { groupRefs[i].current = n; }}>
          <GameLight def={{ ...def, shadowOn: shadowsEnabled && i < SHADOW_CAP }} idSuffix={`shombie-${i}`} />
        </group>
      ))}
    </>
  );
}
