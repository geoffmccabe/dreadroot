// DancingDemon — ambient "dancing DF Demon" decorations in the SciFi City. NOT a pole dancer: it's the
// Fantasy Rivals DF Demon model (dfdemon_dance.glb = dfdemon + a retargeted Mixamo dance clip), lightly
// red-tinted, looping a dance in place. They exist ONLY here because we placed them here — purely
// decorative (no AI / no combat). Placed at Geoff's laser-readout spots and snapped onto the surface.
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF, useAnimations } from '@react-three/drei';
import { SkeletonUtils } from 'three-stdlib';
import * as THREE from 'three';
import { getChallengeState, subscribeChallenge } from './challenge/challengeStore';
import { meshGroundHeight } from './meshColliderSystem';

const URL = '/siege/monsters/dfdemon_dance.glb';   // Fantasy Rivals demon + retargeted dance clip

// INSTANCE-specific content. A Map (SciFi City) can have many INSTANCES — an ongoing multiplayer Open
// World vs single-player Challenges — that differ in content. The dancers belong to the "Death Dark
// City" CHALLENGE instance only, not the open-world city. Matched on the active challenge name; edit
// this predicate (or add names) to place the dancers in other instances later.
const isDancerInstance = (challengeName: string): boolean => {
  const n = challengeName.toLowerCase();
  return n.includes('dark') && n.includes('city');
};

export interface DancingDemonDef { pos: [number, number, number]; yaw?: number; scale?: number; tint?: string }

// Four dancing DF Demons at Geoff's laser-readout spots, 6m tall (model ≈1.9m → scale ≈3.14). The `pos`
// is the CAMERA/eye position he read (a few metres above the surface), so each snaps DOWN onto the
// building mesh below it (see the snap in <Dancer>). X/Z are placed exactly as given.
const DANCERS: DancingDemonDef[] = [
  { pos: [-2.214, 32.008, -5.028], yaw: 0, scale: 3.14, tint: '#e23b3b' },   // rooftop
  { pos: [38.589, 32.008, 35.227], yaw: 0, scale: 3.14, tint: '#e23b3b' },   // rooftop
  { pos: [13.566, 10.805, 70.058], yaw: 0, scale: 3.14, tint: '#e23b3b' },   // in front of the bright sign
  { pos: [-28.260, 18.499, 30.185], yaw: 0, scale: 3.14, tint: '#e23b3b' },  // ledge
];

function Dancer({ pos, yaw = 0, scale = 1, tint = '#e23b3b' }: DancingDemonDef) {
  const { scene, animations } = useGLTF(URL);
  const group = useRef<THREE.Group>(null);
  const cloned = useMemo(() => {
    const c = SkeletonUtils.clone(scene) as THREE.Group;
    const col = new THREE.Color(tint);
    c.traverse((o) => {
      const m = o as THREE.Mesh;
      m.frustumCulled = false;             // skinned-mesh cull spheres are wrong at bind pose
      if (!m.isMesh) return;
      const mats = (Array.isArray(m.material) ? m.material : [m.material]).map((mm) => (mm as THREE.Material).clone());
      m.material = Array.isArray(m.material) ? mats : mats[0];
      mats.forEach((mm) => {
        const sm = mm as THREE.MeshStandardMaterial;
        if ('color' in sm && sm.color) sm.color.lerp(col, 0.14);                          // light red tint (−75%) so the model reads
        if ('emissive' in sm) { sm.emissive = col.clone(); sm.emissiveIntensity = 0.09; } // faint self-light on dark maps
        if ('metalness' in sm) sm.metalness = 0;
        sm.needsUpdate = true;
      });
    });
    return c;
  }, [scene, tint]);
  const { actions, names } = useAnimations(animations, group);
  useEffect(() => {
    const n = names.find((x) => /dance/i.test(x)) ?? names[0];
    const a = n ? actions[n] : null;
    a?.reset().fadeIn(0.4).play();
    return () => { a?.fadeOut(0.2); };
  }, [actions, names]);
  // Drop her onto the BUILDING SURFACE just below the (eye-height) reading — NOT the terrain. Geoff's
  // "pos:" is the camera/eye, ~1.6–3m above the real surface. Use mesh-only ground (so a rooftop dancer
  // can't snap down to the distant terrain), cast from just above the reading, accept only within 8m,
  // and retry until the city BVH has loaded; give up after ~5s and keep the reading.
  const grounded = useRef(false);
  const tries = useRef(0);
  useFrame(() => {
    const g = group.current; if (!g || grounded.current) return;
    tries.current++;
    const f = meshGroundHeight(pos[0], pos[2], pos[1] + 1.0);
    if (f != null && pos[1] - f < 8) { g.position.y = f; grounded.current = true; }
    else if (tries.current > 300) grounded.current = true;
  });
  return <group ref={group} position={pos} rotation={[0, yaw, 0]} scale={scale}><primitive object={cloned} /></group>;
}

export function DancingDemons() {
  // TEMP (placement debug): render on the city map UNCONDITIONALLY so she's easy to find regardless of
  // the challenge name. Once Geoff confirms the spot via a laser readout, restore the instance gate:
  //   const name = useSyncExternalStore(subscribeChallenge, () => { const s = getChallengeState(); return s.active ? s.name : ''; });
  //   if (!isDancerInstance(name)) return null;
  return <>{DANCERS.map((d, i) => <Dancer key={i} {...d} />)}</>;
}

useGLTF.preload(URL);
