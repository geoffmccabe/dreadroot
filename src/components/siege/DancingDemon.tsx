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
import { fireSiegeExplosion } from './SiegeExplosion';
import { getCityMusicTime } from './SciFiCityMusic';

const URL = '/siege/monsters/dfdemon_dance.glb';   // Fantasy Rivals demon + retargeted dance clip
const DROP_H = 100;   // metres above the landing spot each demon drops from
const GRAVITY = 22;   // m/s² fall

// Music-timed blasts: when the soundtrack's loop time crosses each of these (seconds), fire a blast at
// every demon's landed spot. Geoff's timecodes 0:0:17:20 + 0:01:09:00 → 17.20s + 69.00s.
const BLAST_TIMES = [17.20, 69.00];
const LANDED_POS: [number, number, number][] = [];   // filled as demons land

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
  { pos: [-3.966, 26.650, -21.300], yaw: 0, scale: 3.14, tint: '#e23b3b' },   // rooftop (moved — old spot too cramped to dance)
  { pos: [37.507, 26.650, -1.152], yaw: 0, scale: 3.14, tint: '#e23b3b' },   // rooftop (moved)
  { pos: [13.850, 12.284, 69.129], yaw: 0, scale: 3.14, tint: '#e23b3b' },   // in front of the bright sign (moved off the wall)
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
  const danceName = useMemo(() => names.find((x) => /dance/i.test(x)) ?? names[0], [names]);
  const idleName = useMemo(() => names.find((x) => /idle/i.test(x)) ?? danceName, [names, danceName]);
  // Idle pose while it falls; switch to the dance on landing.
  useEffect(() => {
    const a = idleName ? actions[idleName] : null;
    a?.reset().fadeIn(0.3).play();
    return () => { a?.fadeOut(0.2); };
  }, [actions, idleName]);

  // ENTRANCE: each demon drops from 100m onto the surface below the (eye-height) reading, then starts
  // dancing on landing. The landing target is the BUILDING mesh just below the reading (mesh-only, within
  // 8m so it can't fall to the distant terrain); if no collider is found in ~5s it lands at the reading.
  // Hidden until it has a target so it never flashes at the eye-Y first.
  const phase = useRef<'wait' | 'fall' | 'land'>('wait');
  const landY = useRef(0);
  const vy = useRef(0);
  const tries = useRef(0);
  useFrame((_, dt) => {
    const g = group.current; if (!g || phase.current === 'land') return;
    dt = Math.min(dt, 0.05);
    const toDance = () => {
      if (idleName) actions[idleName]?.fadeOut(0.25);
      const d = danceName ? actions[danceName] : null; d?.reset().fadeIn(0.3).play();
    };
    if (phase.current === 'wait') {
      g.visible = false;
      tries.current++;
      const f = meshGroundHeight(pos[0], pos[2], pos[1] + 1.0);
      const target = (f != null && pos[1] - f < 8) ? f : (tries.current > 300 ? pos[1] : null);
      if (target != null) { landY.current = target; g.position.set(pos[0], target + DROP_H, pos[2]); g.visible = true; vy.current = 0; phase.current = 'fall'; }
      return;
    }
    // FALL
    vy.current -= GRAVITY * dt;
    g.position.y += vy.current * dt;
    if (g.position.y <= landY.current) {
      g.position.y = landY.current; phase.current = 'land'; toDance();
      LANDED_POS.push([pos[0], landY.current, pos[2]]);        // remember where it landed (for the music blasts)
      fireSiegeExplosion(pos[0], landY.current, pos[2], 3);    // BIG grenade blast on impact (cosmetic — no damage)
    }
  });
  return <group ref={group} position={pos} rotation={[0, yaw, 0]} scale={scale}><primitive object={cloned} /></group>;
}

// Fires a blast at every landed demon when the soundtrack's loop time crosses a BLAST_TIMES entry.
function MusicBlasts() {
  const lastT = useRef(-1);
  useFrame(() => {
    const t = getCityMusicTime();
    if (t == null) { lastT.current = -1; return; }
    if (t < lastT.current) lastT.current = -1;   // the loop wrapped → re-arm all times
    for (const bt of BLAST_TIMES) {
      if (lastT.current < bt && t >= bt) {
        for (const p of LANDED_POS) fireSiegeExplosion(p[0], p[1], p[2], 3);
      }
    }
    lastT.current = t;
  });
  return null;
}

export function DancingDemons() {
  // TEMP (placement debug): render on the city map UNCONDITIONALLY so she's easy to find regardless of
  // the challenge name. Once Geoff confirms the spot via a laser readout, restore the instance gate:
  //   const name = useSyncExternalStore(subscribeChallenge, () => { const s = getChallengeState(); return s.active ? s.name : ''; });
  //   if (!isDancerInstance(name)) return null;
  useEffect(() => { LANDED_POS.length = 0; }, []);   // reset on (re)entering the city so it doesn't accumulate
  return <>{DANCERS.map((d, i) => <Dancer key={i} {...d} />)}<MusicBlasts /></>;
}

useGLTF.preload(URL);
