// KaijuDisplay — one animated Kaiju standing on the Mini Earth.
//
// Step D1/D3 of docs/MINI_EARTH_P1_BUILD.md.
//
// WHY THIS IS NOT `CatalogMonster`
// -------------------------------
// The full monster (MonsterEnemy) grounds itself through sampleHeight(x, z) and assumes the
// world is Y-up, both of which are false on a sphere: it would sit at SWW's fallback sea level
// inside the planet, lying on its side. Making the AI sphere-aware is P2 (sphere locomotion) and
// deserves its own controller rather than being bolted on here.
//
// So P1 renders the SAME .glb assets and the SAME animation clips, just placed and oriented by
// hand: positioned at a latitude/longitude on the surface and rotated so its up vector is the
// surface normal. That is enough to answer the question P1 exists to answer, which is how big a
// Kaiju should be relative to the planet.

import { useEffect, useMemo, useRef } from 'react';
import { useGLTF, useAnimations } from '@react-three/drei';
import * as THREE from 'three';
import { CFG } from '../siegeMonsterCatalog';
import { APP_VERSION } from '@/version';
import { PLANET_RADIUS, METRES_PER_UNIT, latLonToDirection } from './cubeSphere';
import { animSpeedMul, type KaijuLabState } from './kaijuLabState';
import { sampleGlobeElevation } from './globeGround';

/** Preferred idle-ish clip names, in order. Falls back to whatever the model ships. */
const IDLE_CLIPS = ['breathidle', 'idle', 'breath', 'flex', 'walk', 'run'];

export function KaijuDisplay({ state, lat, lon }: { state: KaijuLabState; lat: number; lon: number }) {
  const cfg = CFG[state.type];
  const url = cfg?.url;
  if (!url) return null;
  return <KaijuModel url={url} state={state} lat={lat} lon={lon} modelHeight={cfg.modelHeight ?? 2} />;
}

function KaijuModel({
  url, state, lat, lon, modelHeight,
}: { url: string; state: KaijuLabState; lat: number; lon: number; modelHeight: number }) {
  const group = useRef<THREE.Group>(null);
  const { scene, animations } = useGLTF(`${url}?v=${APP_VERSION}`);

  // Clone per instance: the cached glTF scene is shared, and mutating it would affect every
  // other user of the same model (this bit the repo before with shared monster scenes).
  const model = useMemo(() => {
    const c = scene.clone(true);
    c.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = false; o.receiveShadow = false; } });
    return c;
  }, [scene]);

  const { actions, names, mixer } = useAnimations(animations, group);

  // Place + orient: position on the sphere at (lat, lon), then rotate so the model's local +Y
  // points along the surface normal (straight up, away from the planet centre).
  const { position, quaternion } = useMemo(() => {
    const dir = new Float64Array(3);
    latLonToDirection(lat, lon, dir);
    const up = new THREE.Vector3(dir[0], dir[1], dir[2]).normalize();
    const groundMetres = sampleGlobeElevation(up.x, up.y, up.z) ?? 0;
    const r = PLANET_RADIUS + groundMetres / METRES_PER_UNIT;
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
    return { position: up.clone().multiplyScalar(r), quaternion: q };
  }, [lat, lon, state.generation]);

  // Scale the model so it stands `state.height` units tall.
  const scale = state.height / Math.max(0.01, modelHeight);

  // Start a clip, and set playback rate from the size (bigger = slower, see kaijuLabState).
  useEffect(() => {
    if (!names.length) return;
    const pick = IDLE_CLIPS.find((n) => names.some((a) => a.toLowerCase() === n)) ?? null;
    const chosen = pick ? names.find((a) => a.toLowerCase() === pick)! : names[0];
    const action = actions[chosen];
    if (!action) return;
    action.reset().fadeIn(0.2).play();
    return () => { action.fadeOut(0.2); };
  }, [actions, names]);

  useEffect(() => {
    mixer.timeScale = animSpeedMul(state);
  }, [mixer, state.height, state.baseHeight, state]);

  return (
    <group ref={group} position={position} quaternion={quaternion} scale={scale} name="kaiju-display">
      <primitive object={model} />
    </group>
  );
}
