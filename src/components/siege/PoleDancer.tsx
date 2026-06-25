// PoleDancer — decorative dancing girls on the pole-dance poles. A female Synty model (hunterf) with
// a retargeted Mixamo dance clip ('dance'), red devil-tinted and self-lit, looping in place. Same
// model + clip for every pole; per-pole position/scale/tint give the three some variety. Static decor
// (no AI / no combat). NOTE: a true "pole dance" clip wasn't available open-source, so this is a
// hip-hop dance stand-in on the pole — swap the clip in hunterf_dance.glb to upgrade.
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF, useAnimations } from '@react-three/drei';
import { SkeletonUtils } from 'three-stdlib';
import * as THREE from 'three';
import { getChallengeState, subscribeChallenge } from './challenge/challengeStore';
import { groundAt } from './siegeGround';

const URL = '/siege/monsters/dfdemon_dance.glb';   // Fantasy Rivals demon + retargeted dance clip

// INSTANCE-specific content. A Map (SciFi City) can have many INSTANCES — an ongoing multiplayer Open
// World vs single-player Challenges — that differ in content. The dancers belong to the "Death Dark
// City" CHALLENGE instance only, not the open-world city. Matched on the active challenge name; edit
// this predicate (or add names) to place the dancers in other instances later.
const isDancerInstance = (challengeName: string): boolean => {
  const n = challengeName.toLowerCase();
  return n.includes('dark') && n.includes('city');
};

export interface PoleDancerDef { pos: [number, number, number]; yaw?: number; scale?: number; tint?: string }

// The three poles (world coords). Pole #1 base block was reported at (12, 4, -27); the dancer stands
// ONE dancer (dfdemon, red-tinted), placed ~1m from the pole-base reading [12,4,-27], 1m toward the
// door (−Z guess). Floor Y kept at the base's 4 — send a laser readout at the exact spot to refine.
const DANCERS: PoleDancerDef[] = [
  { pos: [12, 4, -28], yaw: 0, scale: 1.0, tint: '#e23b3b' },
];

function Dancer({ pos, yaw = 0, scale = 1, tint = '#e23b3b' }: PoleDancerDef) {
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
        if ('color' in sm && sm.color) sm.color.lerp(col, 0.55);                          // red devil tint
        if ('emissive' in sm) { sm.emissive = col.clone(); sm.emissiveIntensity = 0.35; } // self-light on dark maps
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
  // Drop her onto the actual floor — the city was lowered ~2.8m after the pole reading was taken, so
  // the baked Y is stale. Snap to the BVH floor once it's available (keeps Y if the floor is voxel).
  const grounded = useRef(false);
  useFrame(() => {
    const g = group.current; if (!g || grounded.current) return;
    const f = groundAt(pos[0], pos[2], pos[1] + 4);
    if (f != null) { g.position.y = f; grounded.current = true; }
  });
  return <group ref={group} position={pos} rotation={[0, yaw, 0]} scale={scale}><primitive object={cloned} /></group>;
}

export function PoleDancers() {
  // TEMP (placement debug): render on the city map UNCONDITIONALLY so she's easy to find regardless of
  // the challenge name. Once Geoff confirms the spot via a laser readout, restore the instance gate:
  //   const name = useSyncExternalStore(subscribeChallenge, () => { const s = getChallengeState(); return s.active ? s.name : ''; });
  //   if (!isDancerInstance(name)) return null;
  return <>{DANCERS.map((d, i) => <Dancer key={i} {...d} />)}</>;
}

useGLTF.preload(URL);
