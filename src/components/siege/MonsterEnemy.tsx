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
  zombie?: boolean;           // horde variant: per-demon size/speed/rhythm jitter, desaturated
                              // shading, head+body colliders, low stack
  gait?: 'hop' | 'climb';     // SW movement style (both reusable by any monster):
                              //  'hop'   = bouncy: hop over walls + crowd-jump to pile up (mushrooms, default)
                              //  'climb' = no jump: walk UP obstacles at half speed, climb over
                              //            moving demons → continuous stacking (red demons)
  sizeJitter?: number;        // per-demon ± size fraction (0.10 = ±10%, 0.50 = ±50%)
  speedJitter?: number;       // per-demon ± walk-speed fraction
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
const CLIMB_LOD = 90; // beyond this (m from camera) skip the per-frame world-collision query

// Shared live registry of monster footprints so each pushes out of the others (cheap O(n²)
// separation — fine for the handful of beach monsters). Each entry = current x/z + radius.
const MONSTERS = new Set<{ x: number; y: number; z: number; r: number }>();
// Demon HEAD colliders live in the same grid (for the player + headshot reference) but are
// skipped when computing a monster's standing surface, so demons stand on shoulders, not heads.
const headBoxes = new Set<THREE.Box3>();
// Monster BODY colliders — lets the climb gait tell a MOVING collider (another monster, climb
// over it) from a static world wall (climb the face only, don't penetrate).
const monsterBoxes = new Set<THREE.Box3>();
// Per-monster support state, read by OTHER monsters: `g` = is it currently resting on something
// solid (vs. airborne/climbing), `pri` = a stable priority. A monster may only stand/climb on
// another monster that is supported AND lower-priority — so two can't climb each other into the
// air (mutual-support deadlock), and a chain only stacks once each link has actually landed.
const monsterSupport = new Map<THREE.Box3, { g: boolean; pri: number }>();

export function MonsterEnemy({ spawn, ...cfg }: { spawn: [number, number, number] } & MonsterConfig) {
  const c = { ...DEF, ...cfg };
  const clips = { ...DEFCLIPS, ...(cfg.clips || {}) };
  const { scene, animations } = useGLTF(c.url);
  // Clone the rig so MANY instances of the same model (e.g. a horde of red demons) each get
  // their own skeleton — a plain shared scene can only render in one place. SkeletonUtils
  // clones the skinned mesh + skeleton properly (materials stay shared, which is fine).
  const cloned = useMemo(() => SkeletonUtils.clone(scene) as THREE.Group, [scene]);
  const group = useRef<THREE.Group>(null);
  const { actions, names, mixer } = useAnimations(animations, group);
  const camera = useThree((s) => s.camera);
  // Per-demon variation for the zombie horde (stable): size ±10%, speed +0-10%, animation
  // rhythm +0-10%, desaturation 30-80% (greyed-out shades). Non-zombie monsters = no jitter.
  const jit = useRef<{ size: number; speed: number; anim: number; desat: number } | null>(null);
  if (!jit.current) {
    const R = Math.random;
    const sj = cfg.sizeJitter ?? 0.10;     // ± size fraction
    const vj = cfg.speedJitter ?? 0.10;    // ± walk-speed fraction (± so some are clearly slower/faster)
    jit.current = cfg.zombie
      ? { size: 1 + (R() * 2 - 1) * sj, speed: 1 + (R() * 2 - 1) * vj, anim: 1 + R() * 0.10, desat: 0.30 + R() * 0.50 }
      : { size: 1, speed: 1, anim: 1, desat: 0 };
  }
  const J = jit.current;
  const gait = cfg.gait ?? 'hop';
  const H = c.height * J.size;              // jittered in-world height
  const SPD = (c.speed ?? DEF.speed) * J.speed;
  const STAND = cfg.zombie ? 0.80 : 1.0;    // standable top = 0.8H so stacked demons sit on shoulders
  const scale = H / c.modelHeight;
  // Animation rhythm jitter — vary the whole mixer tempo per demon.
  useEffect(() => { mixer.timeScale = J.anim; }, [mixer, J.anim]);
  const st = useRef({ x: spawn[0], y: spawn[1], z: spawn[2], vy: 0, cur: '', lastAttack: 0, swipeUntil: 0, wx: spawn[0], wz: spawn[2], wNext: 0 });
  // Separation footprint (registered in the shared registry; updated each frame). y lets
  // separation skip STACKED demons (one standing on another) so piles don't shove apart.
  // Separation radius. Horde monsters pack TIGHT — based on the body collider (≈H*0.26), +20%
  // so colliders settle ~20% of their width apart (almost touching → they pile up readily).
  // Arms are ignored (body collider only). Named monsters keep the old wider spacing.
  const me = useRef({ x: spawn[0], y: spawn[1], z: spawn[2], r: cfg.zombie ? H * 0.26 * 1.2 : Math.max(0.8, H * 0.3) }).current;
  useEffect(() => { MONSTERS.add(me); return () => { MONSTERS.delete(me); }; }, [me]);
  // Combat instance — registered with the shared horde so Dreadroot weapons can damage it.
  const inst = useRef<DemonInstance>({
    id: cfg.id ?? `mon_${_mid++}`,
    x: spawn[0], y: spawn[1], z: spawn[2],
    height: H, radius: Math.max(0.35, H * 0.22),
    hp: cfg.health ?? 100, maxHp: cfg.health ?? 100,
    dead: false, deadAt: 0, despawned: false,
    kvx: 0, kvz: 0, stunUntil: 0, hitAt: 0,
    headFrac: cfg.zombie ? 0.20 : 0.25,   // head ≈ top 20% of a humanoid demon
  }).current;
  useEffect(() => { addDemon(inst); return () => removeDemon(inst); }, [inst]);
  // Stable per-demon climbing role from the id: ~25% are climbers (hop over walls/rocks);
  // `side` is a stable left/right preference for crabbing around obstacles. (Any demon also
  // climbs when boxed in by its own kind — that crowd-jumping is what stacks them up.)
  const role = useRef<{ climb: boolean; side: number; pri: number } | null>(null);
  if (!role.current) {
    let h = 0; for (let i = 0; i < inst.id.length; i++) h = (h * 31 + inst.id.charCodeAt(i)) | 0;
    role.current = { climb: (h >>> 0) % 100 < 25, side: (h & 1) ? 1 : -1, pri: (h >>> 0) };
  }
  // Support state other monsters read (g mutated each frame; pri stable).
  const sup = useRef({ g: false, pri: 0 }).current;
  sup.pri = role.current.pri;
  // Engine collider so the PLAYER can't walk through this monster (the player queries
  // worldCollisionGrid). Updated each frame to follow the monster; removed on unmount.
  const box = useRef(new THREE.Box3()).current;
  useEffect(() => {
    worldCollisionGrid.insert(box); monsterBoxes.add(box); monsterSupport.set(box, sup);
    return () => { worldCollisionGrid.remove(box); monsterBoxes.delete(box); monsterSupport.delete(box); };
  }, [box, sup]);
  // Zombie: a separate HEAD collider above the body, registered in the grid + head set (so it
  // gives the head a physical/headshot shape but demons don't stand on it).
  const headBox = useRef(cfg.zombie ? new THREE.Box3() : null).current;
  useEffect(() => {
    if (!headBox) return;
    worldCollisionGrid.insert(headBox); headBoxes.add(headBox);
    return () => { worldCollisionGrid.remove(headBox); headBoxes.delete(headBox); };
  }, [headBox]);

  // Source meshes render very dark — drop metalness and self-light the texture a bit. For the
  // zombie horde, also CLONE each material (so this demon is independent) and inject a per-demon
  // grayscale mix in the fragment shader → varied greyed-out red shades (zombie look).
  useMemo(() => {
    const dz = J.desat;
    cloned.traverse((o: THREE.Object3D) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      let mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (cfg.zombie) {
        mats = mats.map((mm) => (mm as THREE.Material).clone());
        mesh.material = Array.isArray(mesh.material) ? mats : mats[0];
      }
      mats.forEach((mm) => {
        const m = mm as THREE.MeshStandardMaterial;
        if (!m) return;
        if ('metalness' in m) m.metalness = 0;
        if ('roughness' in m) m.roughness = 0.85;
        if ('emissive' in m && m.map) { m.emissive = new THREE.Color(0xffffff); m.emissiveMap = m.map; m.emissiveIntensity = 0.5; }
        if (cfg.zombie && dz > 0) {
          // Share ONE compiled program across all zombie mats with the same texture features
          // (else 1 compile per demon); the desat amount varies per material via its uniform.
          m.customProgramCacheKey = () => `zdesat_${m.map ? 1 : 0}_${m.emissiveMap ? 1 : 0}`;
          m.onBeforeCompile = (shader) => {
            shader.uniforms.uDesat = { value: dz };
            shader.fragmentShader = 'uniform float uDesat;\n' + shader.fragmentShader;
            if (shader.fragmentShader.includes('#include <dithering_fragment>')) {
              shader.fragmentShader = shader.fragmentShader.replace(
                '#include <dithering_fragment>',
                '#include <dithering_fragment>\n{ float _zl = dot(gl_FragColor.rgb, vec3(0.299,0.587,0.114)); gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(_zl), uDesat); }',
              );
            }
          };
        }
        m.needsUpdate = true;
      });
    });
  }, [cloned, J.desat]);

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
        const step = Math.min(SPD * delta, dist - c.attackRange);
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
        const step = Math.min(SPD * 0.5 * delta, wd);
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
    let wallTop = -Infinity, wallIsMonster = false;
    // World-collision/climb is the per-demon hot path (a grid query every frame). Only run it
    // for demons near the camera; distant horde members just walk the terrain. Keeps a 1000-
    // strong horde cheap without affecting any climbing you can actually see up close.
    if (dist < CLIMB_LOD) {
      const fr = cfg.zombie ? Math.max(0.30, H * 0.26) : me.r;   // footprint ≈ body collider, not the fat separation radius
      const cnt = worldCollisionGrid.getNearby(s.x, s.z, me.r + 0.4);
      const res = worldCollisionGrid.nearbyResult;
      for (let i = 0; i < cnt; i++) {
        const b = res[i] as THREE.Box3;
        if (!b || b === box || headBoxes.has(b) || !b.max) continue;   // never stand on a head
        if (monsterBoxes.has(b)) {
          // Only stand/climb on a monster that is itself supported (not mid-air) AND lower
          // priority — prevents two from climbing each other up into the air.
          const os = monsterSupport.get(b);
          if (!os || !os.g || os.pri >= sup.pri) continue;
        }
        if (s.x >= b.min.x - fr && s.x <= b.max.x + fr && s.z >= b.min.z - fr && s.z <= b.max.z + fr) {
          const top = b.max.y;
          if (top <= feet + STEP_UP) { if (top > groundY) groundY = top; }            // standable / step-up
          else if (b.min.y < feet + H && top > wallTop) { wallTop = top; wallIsMonster = monsterBoxes.has(b); } // too tall → wall
        }
      }
    }
    const grounded = feet <= groundY + 0.08 && s.vy <= 0.02;
    const belowTop = wallTop > -Infinity && feet < wallTop - 0.1;

    // UNIVERSAL: never walk through a wall. Undo the horizontal step that entered it (both gaits).
    if (belowTop) { s.x = preX; s.z = preZ; }

    // ── Blocked by a wall — two reusable SW gaits ──
    let climbing = false;
    if (wallTop > -Infinity && moving) {
      if (gait === 'climb') {
        climbing = belowTop;                   // ascend the face (handled in the vertical step)
      } else if (grounded && belowTop) {
        // 'hop': climbers (and anyone boxed in by the crowd) hop onto it; everyone else crabs
        // sideways to go around. Forward penetration was already undone above.
        const trapped = crowd >= TRAP_COUNT;
        if (role.current!.climb || trapped) {
          // Hop just high enough to land ON the obstacle in front (+a little), never higher.
          // For the small things a mushroom hops onto this is ~half the old fixed velocity;
          // capped so a tall wall can't launch them.
          s.vy = Math.min(JUMP_VEL, Math.sqrt(2 * GRAVITY * Math.max(0.25, wallTop - feet + 0.2)));
        } else {
          const sg = role.current!.side;
          const step = SPD * delta;
          s.x += (-mvz * sg) * step; s.z += (mvx * sg) * step; // crab perpendicular to the wall
        }
      }
    }

    // ── Vertical ──
    if (climbing) {
      // Walk UP the obstacle face at half speed (no penetration — respects the collider). Only
      // when climbing a MOVING collider (another monster) also advance, so they climb over it;
      // on a static wall they ascend the face and crest the top.
      s.y = Math.min(wallTop, s.y + SPD * 0.5 * delta);
      s.vy = 0;
      if (wallIsMonster) { s.x += mvx * SPD * 0.5 * delta; s.z += mvz * SPD * 0.5 * delta; }
    } else {
      // Gravity + land on the highest standable surface.
      s.vy -= GRAVITY * delta;
      s.y += s.vy * delta;
      if (s.y <= groundY) { s.y = groundY; s.vy = 0; }
    }
    // Publish support: resting on something solid (landed, not climbing/airborne) → others may
    // stand on us. Climbing or falling → not supported, so nobody climbs us mid-air.
    sup.g = !climbing && s.vy === 0;

    me.y = s.y;
    g.position.set(s.x, s.y, s.z);
    inst.x = s.x; inst.y = s.y; inst.z = s.z;   // keep the combat hitbox on the live body
    // BODY collider: feet → shoulders (STAND·H). Other demons stand on its top, so a stacked
    // demon sits at shoulder height (~0.8H) instead of floating above the head below it.
    const br = cfg.zombie ? H * 0.26 : me.r;
    box.min.set(s.x - br, s.y, s.z - br);
    box.max.set(s.x + br, s.y + H * STAND, s.z + br);
    worldCollisionGrid.update(box);
    // HEAD collider (zombie): shoulders → top, narrower. Physical head + headshot reference.
    if (headBox) {
      const hr = H * 0.16;
      headBox.min.set(s.x - hr, s.y + H * STAND, s.z - hr);
      headBox.max.set(s.x + hr, s.y + H, s.z + hr);
      worldCollisionGrid.update(headBox);
    }
    sdbg.monsters = MONSTERS.size; // SW debug
  });

  return <group ref={group} scale={scale}><primitive object={cloned} /></group>;
}
