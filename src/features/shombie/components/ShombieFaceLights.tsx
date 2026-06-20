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
    const unreg = frameLoop.register('shombie-face-lights', () => {
      const list = shombiesRef.current.filter((s) => s.isActive);
      list.sort((a, b) => a.position.distanceToSquared(camera.position) - b.position.distanceToSquared(camera.position));
      for (let i = 0; i < POOL; i++) {
        const g = groupRefs[i].current;
        if (!g) continue;
        const s = list[i];
        if (!s) { g.position.set(0, -10000, 0); continue; } // park unused slots offscreen
        const sc = s.scale || 1;
        const speed = Math.hypot(s.velocity.x, s.velocity.z);
        if (speed > 0.05) fwd.set(s.velocity.x / speed, 0, s.velocity.z / speed); // walk direction
        else fwd.copy(lastFacing[i]);                                             // keep last when idle
        lastFacing[i].copy(fwd);
        const headY = s.position.y + 1.7 * sc; // head part offset
        pos.set(s.position.x + fwd.x * 0.3 * sc, headY, s.position.z + fwd.z * 0.3 * sc); // front of the head block
        g.position.copy(pos);
        q.setFromUnitVectors(Z, fwd); // GameLight's -z points along the walk direction
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
