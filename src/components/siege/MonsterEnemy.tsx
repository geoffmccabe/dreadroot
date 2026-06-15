// MonsterEnemy — generic, reusable Siege Worlds enemy entity (ports the common Java NPC
// behavior: wander+search when no player near, pursue + attack when in aggro range). One
// component, configured per monster — no per-monster forks. Brightens the model's materials
// (the source meshes render very dark) and ground-follows the terrain.
//
// NOTE: combat (taking player bullets / dealing damage) is intentionally NOT here yet — it
// will arrive with the shared Dreadroot weapon/combat system, not a bespoke one.

import { useEffect, useRef, useMemo } from 'react';
import { useGLTF, useAnimations } from '@react-three/drei';
import { SkeletonUtils } from 'three-stdlib';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { sampleHeight } from './terrainHeight';
import { worldCollisionGrid } from '@/lib/spatialHashGrid';
import { sdbg } from './siegeDebug';
import { addDemon, removeDemon, type DemonInstance } from './siegeHorde';

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
  health?: number;            // HP (default 100)
  id?: string;                // stable combat id (auto if omitted)
  onDespawn?: (id: string) => void;  // called once after the death anim finishes
  clips?: { idle?: string; walk?: string; attack?: string; death?: string; hit?: string };
}

const DEF = { speed: 2.5, attackRange: 2.8, attackMs: 3000, attackClipMs: 1300, aggro: 60, wanderRadius: 14, faceOffset: 0 };
const DEFCLIPS = { idle: 'idle', walk: 'walk', attack: 'attack', death: 'death', hit: 'hit' };
const DEATH_DESPAWN_MS = 2600; // play the death clip, hold the pose, then remove
let _mid = 0;
// Climbing physics. JUMP_VEL apex ≈ own height (1.8m) so a demon can mount one box / one
// demon per hop; piling several lets them clear taller walls.
const GRAVITY = 22, JUMP_VEL = 9.5, STEP_UP = 0.45;
const TRAP_RADIUS = 1.3, TRAP_COUNT = 3; // boxed in by this many of its own kind → climb over

// Shared live registry of monster footprints so each pushes out of the others (cheap O(n²)
// separation — fine for the handful of beach monsters). Each entry = current x/z + radius.
const MONSTERS = new Set<{ x: number; y: number; z: number; r: number }>();

export function MonsterEnemy({ spawn, ...cfg }: { spawn: [number, number, number] } & MonsterConfig) {
  const c = { ...DEF, ...cfg };
  const clips = { ...DEFCLIPS, ...(cfg.clips || {}) };
  const { scene, animations } = useGLTF(c.url);
  // Clone the rig so MANY instances of the same model (e.g. a horde of red demons) each get
  // their own skeleton — a plain shared scene can only render in one place. SkeletonUtils
  // clones the skinned mesh + skeleton properly (materials stay shared, which is fine).
  const cloned = useMemo(() => SkeletonUtils.clone(scene) as THREE.Group, [scene]);
  const group = useRef<THREE.Group>(null);
  const { actions, names } = useAnimations(animations, group);
  const camera = useThree((s) => s.camera);
  const scale = c.height / c.modelHeight;
  const st = useRef({ x: spawn[0], y: spawn[1], z: spawn[2], vy: 0, cur: '', lastAttack: 0, swipeUntil: 0, wx: spawn[0], wz: spawn[2], wNext: 0 });
  // Separation footprint (registered in the shared registry; updated each frame). y lets
  // separation skip STACKED demons (one standing on another) so piles don't shove apart.
  const me = useRef({ x: spawn[0], y: spawn[1], z: spawn[2], r: Math.max(0.8, c.height * 0.3) }).current;
  useEffect(() => { MONSTERS.add(me); return () => { MONSTERS.delete(me); }; }, [me]);
  // Combat instance — registered with the shared horde so Dreadroot weapons can damage it.
  const inst = useRef<DemonInstance>({
    id: cfg.id ?? `mon_${_mid++}`,
    x: spawn[0], y: spawn[1], z: spawn[2],
    height: c.height, radius: Math.max(0.35, c.height * 0.22),
    hp: cfg.health ?? 100, maxHp: cfg.health ?? 100,
    dead: false, deadAt: 0, despawned: false,
    kvx: 0, kvz: 0, stunUntil: 0, hitAt: 0,
  }).current;
  useEffect(() => { addDemon(inst); return () => removeDemon(inst); }, [inst]);
  // Stable per-demon climbing role from the id: ~25% are climbers (hop over walls/rocks);
  // `side` is a stable left/right preference for crabbing around obstacles. (Any demon also
  // climbs when boxed in by its own kind — that crowd-jumping is what stacks them up.)
  const role = useRef<{ climb: boolean; side: number } | null>(null);
  if (!role.current) {
    let h = 0; for (let i = 0; i < inst.id.length; i++) h = (h * 31 + inst.id.charCodeAt(i)) | 0;
    role.current = { climb: (h >>> 0) % 100 < 25, side: (h & 1) ? 1 : -1 };
  }
  // Engine collider so the PLAYER can't walk through this monster (the player queries
  // worldCollisionGrid). Updated each frame to follow the monster; removed on unmount.
  const box = useRef(new THREE.Box3()).current;
  useEffect(() => { worldCollisionGrid.insert(box); return () => worldCollisionGrid.remove(box); }, [box]);

  // Source meshes render very dark — drop metalness and self-light the texture a bit.
  useMemo(() => {
    cloned.traverse((o: THREE.Object3D) => {
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
  }, [cloned]);

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
    const now = performance.now();
    const dx = camera.position.x - s.x, dz = camera.position.z - s.z;
    const dist = Math.hypot(dx, dz) || 1;

    // ── DEATH: play the death clip once, slide out the last knockback, then despawn ──
    if (inst.dead) {
      play(clips.death, true);
      s.x += inst.kvx * delta; s.z += inst.kvz * delta;
      inst.kvx *= 0.82; inst.kvz *= 0.82;
      const dh = sampleHeight(s.x, s.z); if (dh != null) s.y = dh;
      g.position.set(s.x, s.y, s.z);
      inst.x = s.x; inst.y = s.y; inst.z = s.z;
      if (!inst.despawned && now - inst.deadAt > DEATH_DESPAWN_MS) {
        inst.despawned = true; cfg.onDespawn?.(inst.id);
      }
      return;
    }

    // ── Knockback: horizontal slide that decays (friction) ──
    if (inst.kvx || inst.kvz) {
      s.x += inst.kvx * delta; s.z += inst.kvz * delta;
      const decay = Math.exp(-6 * delta);
      inst.kvx *= decay; inst.kvz *= decay;
      if (Math.abs(inst.kvx) < 0.05) inst.kvx = 0;
      if (Math.abs(inst.kvz) < 0.05) inst.kvz = 0;
    }

    // Capture pre-move XZ so a blocked go-around demon can undo its step. Record the
    // intended move direction (mvx,mvz) for the climb/deflect logic below.
    const preX = s.x, preZ = s.z;
    let mvx = 0, mvz = 0, moving = false;

    const stunned = now < inst.stunUntil;
    if (stunned) {                                          // hit-stunned -> flinch + hold
      g.rotation.y = Math.atan2(dx, dz) + c.faceOffset;
      if (inst.hitAt && now - inst.hitAt < 450) play(clips.hit, true);
      else play(clips.idle);
    } else if (dist < c.aggro) {                            // found a player -> pursue/attack
      g.rotation.y = Math.atan2(dx, dz) + c.faceOffset;
      if (dist > c.attackRange) {
        const step = Math.min(c.speed * delta, dist - c.attackRange);
        mvx = dx / dist; mvz = dz / dist; moving = true;
        s.x += mvx * step; s.z += mvz * step;
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
        mvx = wdx / wd; mvz = wdz / wd; moving = true;
        s.x += mvx * step; s.z += mvz * step;
        play(clips.walk);
      } else play(clips.idle);
    }

    // Separation — push out of overlapping monsters AT THE SAME LEVEL (stacked demons,
    // |Δy|>1m, are left alone so piles don't shove apart). Count same-level crowding so a
    // demon boxed in by its own kind knows to climb over rather than grind in place.
    let crowd = 0;
    for (const o of MONSTERS) {
      if (o === me || Math.abs(s.y - o.y) > 1.0) continue;
      const ox = s.x - o.x, oz = s.z - o.z;
      const od = Math.hypot(ox, oz);
      if (od < TRAP_RADIUS) crowd++;
      const minD = me.r + o.r;
      if (od > 1e-3 && od < minD) {
        const push = (minD - od) * 0.5;
        s.x += (ox / od) * push; s.z += (oz / od) * push;
      }
    }
    me.x = s.x; me.z = s.z;

    // ── Voxel ground + climb. The collision grid holds buildings, rocks AND every monster's
    //    own collider, so one query gives standable tops (terrain / box / another demon's
    //    head) AND too-tall walls. groundY = highest standable surface; wallTop = a box we're
    //    pressed against that's taller than a step. ──
    const feet = s.y;
    let groundY = sampleHeight(s.x, s.z) ?? feet;
    let wallTop = -Infinity;
    const cnt = worldCollisionGrid.getNearby(s.x, s.z, me.r + 0.4);
    const res = worldCollisionGrid.nearbyResult;
    for (let i = 0; i < cnt; i++) {
      const b = res[i] as THREE.Box3;
      if (!b || b === box || !b.max) continue;
      if (s.x >= b.min.x - me.r && s.x <= b.max.x + me.r && s.z >= b.min.z - me.r && s.z <= b.max.z + me.r) {
        const top = b.max.y;
        if (top <= feet + STEP_UP) { if (top > groundY) groundY = top; }            // standable / step-up
        else if (b.min.y < feet + c.height && top > wallTop) wallTop = top;          // too tall → wall
      }
    }
    const grounded = feet <= groundY + 0.08 && s.vy <= 0.02;

    // ── Blocked by a wall: climbers (and anyone boxed in by the crowd) hop up onto it;
    //    everyone else undoes the step and crabs sideways to go around. ──
    if (wallTop > -Infinity && moving && grounded) {
      const trapped = crowd >= TRAP_COUNT;
      if (role.current!.climb || trapped) {
        s.vy = JUMP_VEL;                       // hop ~own height; pile up to clear more
      } else if (feet < wallTop - 0.1) {
        s.x = preX; s.z = preZ;
        const sg = role.current!.side;
        const step = c.speed * delta;
        s.x += (-mvz * sg) * step; s.z += (mvx * sg) * step;   // crab perpendicular to the wall
      }
    }

    // ── Gravity + vertical integrate + land on the highest standable surface ──
    s.vy -= GRAVITY * delta;
    s.y += s.vy * delta;
    if (s.y <= groundY) { s.y = groundY; s.vy = 0; }

    me.y = s.y;
    g.position.set(s.x, s.y, s.z);
    inst.x = s.x; inst.y = s.y; inst.z = s.z;   // keep the combat hitbox on the live body
    // Move this monster's collider to its new footprint so the player + other demons collide
    // with it (the latter is how they stack: a demon's box is a standable surface).
    box.min.set(s.x - me.r, s.y, s.z - me.r);
    box.max.set(s.x + me.r, s.y + c.height, s.z + me.r);
    worldCollisionGrid.update(box);
    sdbg.monsters = MONSTERS.size; // SW debug
  });

  return <group ref={group} scale={scale}><primitive object={cloned} /></group>;
}
