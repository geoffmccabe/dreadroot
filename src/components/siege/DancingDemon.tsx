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
import { fireSiegeExplosion } from './SiegeExplosion';
import { getCityMusicTime } from './SciFiCityMusic';

const URL = '/siege/monsters/dfdemon_dance.glb';   // Fantasy Rivals demon + retargeted dance clip
const DROP_H = 100;   // metres above the landing spot each demon drops from
const GRAVITY = 22;   // m/s² fall

// Music-timed blasts: when the soundtrack's loop time crosses each of these (seconds), fire a blast at
// every demon's CURRENT centre. Geoff's timecodes 0:0:17:20 + 0:01:09:00 → 17.20s + 69.00s.
const BLAST_TIMES = [17.20, 69.00];
const BLAST_SCALE = 9;   // grenade blast ×9 — big enough to read on a rooftop

// The laser readout is the EYE position; Geoff stood on each spot, so the floor is one standing
// height below it. We drop the demon onto THIS, not the mesh collider (which catches roof railings/
// props at variable heights and leaves the demon hovering 1–3 m up).
const EYE = 1.6;

// Live centre of each mounted demon (tracks the dance's root motion, so a blast lands ON the demon
// wherever it has danced to — not back at the spawn spot). Each <Dancer> registers/removes its getter.
const DEMON_CENTERS = new Set<(out: THREE.Vector3) => void>();

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

  // The demon's live centre = its Hips bone (the dance has root motion, so the body drifts off the
  // spawn spot). Blasts target this so they always land ON the demon. Falls back to the group origin.
  const hips = useMemo(() => { let h: THREE.Object3D | null = null; cloned.traverse((o) => { if (!h && o.name === 'Hips') h = o; }); return h; }, [cloned]);
  const centerOf = useMemo(() => (out: THREE.Vector3) => {
    if (hips) hips.getWorldPosition(out);
    else if (group.current) group.current.getWorldPosition(out);
  }, [hips]);
  useEffect(() => { DEMON_CENTERS.add(centerOf); return () => { DEMON_CENTERS.delete(centerOf); }; }, [centerOf]);

  // ENTRANCE: drop from 100m onto the floor Geoff stood on (reading minus one standing height — NOT the
  // mesh collider, which catches roof props and leaves the demon hovering), then dance + blast on impact.
  const phase = useRef<'fall' | 'land'>('fall');
  const landY = useRef(pos[1] - EYE);
  const vy = useRef(0);
  const started = useRef(false);
  const _c = useMemo(() => new THREE.Vector3(), []);
  useFrame((_, dt) => {
    const g = group.current; if (!g || phase.current === 'land') return;
    dt = Math.min(dt, 0.05);
    if (!started.current) { g.position.set(pos[0], landY.current + DROP_H, pos[2]); started.current = true; }
    vy.current -= GRAVITY * dt;
    g.position.y += vy.current * dt;
    if (g.position.y <= landY.current) {
      g.position.y = landY.current; phase.current = 'land';
      if (idleName) actions[idleName]?.fadeOut(0.25);
      (danceName ? actions[danceName] : null)?.reset().fadeIn(0.3).play();
      centerOf(_c); fireSiegeExplosion(_c.x, _c.y, _c.z, BLAST_SCALE);   // BIG blast at the demon's centre (cosmetic)
    }
  });
  return <group ref={group} position={pos} rotation={[0, yaw, 0]} scale={scale}><primitive object={cloned} /></group>;
}

// Fires a blast at every demon's current centre when the soundtrack's loop time crosses a BLAST_TIMES entry.
function MusicBlasts() {
  const lastT = useRef(-1);
  const _c = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const t = getCityMusicTime();
    if (t == null) { lastT.current = -1; return; }
    if (t < lastT.current) lastT.current = -1;   // the loop wrapped → re-arm all times
    for (const bt of BLAST_TIMES) {
      if (lastT.current < bt && t >= bt) {
        for (const getC of DEMON_CENTERS) { getC(_c); fireSiegeExplosion(_c.x, _c.y, _c.z, BLAST_SCALE); }
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
  return <>{DANCERS.map((d, i) => <Dancer key={i} {...d} />)}<MusicBlasts /></>;
}

useGLTF.preload(URL);
