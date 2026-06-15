// MonsterEnemy — generic, reusable Siege Worlds enemy entity (ports the common Java NPC
// behavior: wander+search when no player near, pursue + attack when in aggro range). One
// component, configured per monster — no per-monster forks. Brightens the model's materials
// (the source meshes render very dark) and ground-follows the terrain.
//
// NOTE: combat (taking player bullets / dealing damage) is intentionally NOT here yet — it
// will arrive with the shared Dreadroot weapon/combat system, not a bespoke one.

import { useEffect, useRef, useMemo } from 'react';
import { useGLTF, useAnimations } from '@react-three/drei';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { sampleHeight } from './terrainHeight';
import { worldCollisionGrid } from '@/lib/spatialHashGrid';

export interface MonsterConfig {
  url: string;
  modelHeight: number;        // intrinsic glb height (m), from the converter
  height: number;             // desired in-world height (m)
  speed?: number;
  attackRange?: number;
  attackMs?: number;
  attackClipMs?: number;
  aggro?: number;
  wanderRadius?: number;
  faceOffset?: number;
  clips?: { idle?: string; walk?: string; attack?: string };
}

const DEF = { speed: 2.5, attackRange: 2.8, attackMs: 3000, attackClipMs: 1300, aggro: 60, wanderRadius: 14, faceOffset: 0 };
const DEFCLIPS = { idle: 'idle', walk: 'walk', attack: 'attack' };

// Shared live registry of monster footprints so each pushes out of the others (cheap O(n²)
// separation — fine for the handful of beach monsters). Each entry = current x/z + radius.
const MONSTERS = new Set<{ x: number; z: number; r: number }>();

export function MonsterEnemy({ spawn, ...cfg }: { spawn: [number, number, number] } & MonsterConfig) {
  const c = { ...DEF, ...cfg };
  const clips = { ...DEFCLIPS, ...(cfg.clips || {}) };
  const { scene, animations } = useGLTF(c.url);
  const group = useRef<THREE.Group>(null);
  const { actions, names } = useAnimations(animations, group);
  const camera = useThree((s) => s.camera);
  const scale = c.height / c.modelHeight;
  const st = useRef({ x: spawn[0], y: spawn[1], z: spawn[2], cur: '', lastAttack: 0, swipeUntil: 0, wx: spawn[0], wz: spawn[2], wNext: 0 });
  // Separation footprint (registered in the shared registry; updated each frame).
  const me = useRef({ x: spawn[0], z: spawn[2], r: Math.max(0.8, c.height * 0.3) }).current;
  useEffect(() => { MONSTERS.add(me); return () => { MONSTERS.delete(me); }; }, [me]);
  // Engine collider so the PLAYER can't walk through this monster (the player queries
  // worldCollisionGrid). Updated each frame to follow the monster; removed on unmount.
  const box = useRef(new THREE.Box3()).current;
  useEffect(() => { worldCollisionGrid.insert(box); return () => worldCollisionGrid.remove(box); }, [box]);

  // Source meshes render very dark — drop metalness and self-light the texture a bit.
  useMemo(() => {
    scene.traverse((o: THREE.Object3D) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mats.forEach((mm) => {
        const m = mm as THREE.MeshStandardMaterial;
        if (!m) return;
        if ('metalness' in m) m.metalness = 0;
        if ('roughness' in m) m.roughness = 0.85;
        if ('emissive' in m && m.map) { m.emissive = new THREE.Color(0xffffff); m.emissiveMap = m.map; m.emissiveIntensity = 0.5; }
        m.needsUpdate = true;
      });
    });
  }, [scene]);

  const clip = (key: string) => { const n = names.find((nm) => nm.toLowerCase().includes(key)); return n ? actions[n] : null; };
  const play = (key: string, once = false) => {
    const a = clip(key); if (!a || st.current.cur === key) return;
    Object.values(actions).forEach((x) => { if (x && x !== a) x.fadeOut(0.15); });
    a.reset(); a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
    a.clampWhenFinished = once; a.fadeIn(0.15).play();
    st.current.cur = key;
  };
  useEffect(() => { if (names.length) play(clips.idle); /* eslint-disable-next-line */ }, [actions, names]);

  useFrame((_, delta) => {
    const g = group.current; if (!g) return;
    const s = st.current;
    g.position.set(s.x, s.y, s.z);
    const dx = camera.position.x - s.x, dz = camera.position.z - s.z;
    const dist = Math.hypot(dx, dz) || 1;
    const now = performance.now();

    if (dist < c.aggro) {                                   // found a player -> pursue/attack
      g.rotation.y = Math.atan2(dx, dz) + c.faceOffset;
      if (dist > c.attackRange) {
        const step = Math.min(c.speed * delta, dist - c.attackRange);
        s.x += (dx / dist) * step; s.z += (dz / dist) * step;
        const h = sampleHeight(s.x, s.z); if (h != null) s.y = h;
        play(clips.walk);
      } else if (now - s.lastAttack > c.attackMs) { s.lastAttack = now; s.swipeUntil = now + c.attackClipMs; play(clips.attack, true); }
      else if (now > s.swipeUntil) play(clips.idle);
    } else {                                                // no player near -> wander + search
      if (now > s.wNext) {
        const ang = Math.random() * Math.PI * 2, r = Math.random() * c.wanderRadius;
        s.wx = spawn[0] + Math.cos(ang) * r; s.wz = spawn[2] + Math.sin(ang) * r;
        s.wNext = now + 3000 + Math.random() * 4000;
      }
      const wdx = s.wx - s.x, wdz = s.wz - s.z, wd = Math.hypot(wdx, wdz) || 1;
      if (wd > 0.6) {
        g.rotation.y = Math.atan2(wdx, wdz) + c.faceOffset;
        const step = Math.min(c.speed * 0.5 * delta, wd);
        s.x += (wdx / wd) * step; s.z += (wdz / wd) * step;
        const h = sampleHeight(s.x, s.z); if (h != null) s.y = h;
        play(clips.walk);
      } else play(clips.idle);
    }

    // Separation — push out of any overlapping monster so they don't stand inside each other.
    for (const o of MONSTERS) {
      if (o === me) continue;
      const ox = s.x - o.x, oz = s.z - o.z;
      const od = Math.hypot(ox, oz);
      const minD = me.r + o.r;
      if (od > 1e-3 && od < minD) {
        const push = (minD - od) * 0.5;
        s.x += (ox / od) * push; s.z += (oz / od) * push;
      }
    }
    me.x = s.x; me.z = s.z;
    const gh = sampleHeight(s.x, s.z); if (gh != null) s.y = gh;
    g.position.set(s.x, s.y, s.z);
    // Move this monster's collider to its new footprint so the player collides with it.
    box.min.set(s.x - me.r, s.y, s.z - me.r);
    box.max.set(s.x + me.r, s.y + c.height, s.z + me.r);
    worldCollisionGrid.update(box);
  });

  return <group ref={group} scale={scale}><primitive object={scene} /></group>;
}
