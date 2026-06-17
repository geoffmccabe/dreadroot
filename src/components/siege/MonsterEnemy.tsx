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
import { worldCollisionGrid, monsterColliderGrid } from '@/lib/spatialHashGrid';
import { sdbg } from './siegeDebug';
import { addDemon, removeDemon, hurtDemon, type DemonInstance } from './siegeHorde';
import { useBossAura } from './darkLordAura';
import { dealPlayerDamage } from './spray/sprayAttackSystem';
import { playSpatialSound } from '@/lib/spatialAudio';
import { getSiegeFlame } from './siegeFlame';

// Blast-impact damage: kinetic, only above a threshold speed. min(120, 0.12·v²).
const IMPACT_MIN = 7;
// Fall + slam (velocity) impact damage, reduced 80% — monsters were dying just
// from climbing over simple objects. Both the horizontal-slam (hs) and the
// landing/fall (iv) checks run through this, so both drop 80%.
const impactDamage = (v: number) => v > IMPACT_MIN ? Math.min(24, 0.024 * v * v) : 0;

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
  noStun?: boolean;           // bullets don't stun-freeze it (keeps walking when shot) — test/boss
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
  animSpeed?: number;         // playback-rate multiplier for ALL clips (1 = native; 3 = 3x faster)
  rangedRange?: number;       // if set, fires a ranged attack when the player is within this (m) but beyond melee
  rangedCooldownMs?: number;  // MIN recharge (ms) between ranged attacks (default 60000)
  rangedCooldownMaxMs?: number; // MAX recharge — each cooldown is random in [min,max]; defaults to min
  onRangedAttack?: (x: number, y: number, z: number, dx: number, dy: number, dz: number) => void; // fire the breath weapon
  boss?: 'teleporter';        // 'teleporter' = Dark Lord: teleports around the player, opacity = damage
                              // resistance, aura of black/purple fire + smoke, melee strike from behind
  bossSpeedFactor?: number;   // shamble-speed multiplier while corporeal (default 0.4 = slow)
  // Per-individual colour treatment (for varied hordes). Applied in-shader in this order:
  // hue-rotate → desaturate → red tint. Each defaults to off (or the zombie auto-desat).
  desat?: number;             // explicit desaturation 0..1 (overrides the zombie auto-desat)
  hueShift?: number;          // hue rotation in RADIANS (±)
  tintRed?: number;           // blood-red tint mix 0..1
  moanSounds?: string[];      // ambient moan clips (random pick, ~per 4-8s, distance-scaled)
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
const _fwd = new THREE.Vector3();   // scratch: player look direction (for teleport-behind)
const _flame = new THREE.Vector3(); // scratch: boss body-flame position
const BOSS_FLAME_COLORS = ['#FFFF00', '#FF6600', '#FF3300'];   // same fire as bullet-impact hex
const BOSS_FLAME_SIDES: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
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
  // Animation rhythm jitter × per-monster playback-rate (e.g. slow zombie clip → 3x).
  useEffect(() => { mixer.timeScale = J.anim * (c.animSpeed ?? 1); }, [mixer, J.anim, c.animSpeed]);
  const st = useRef({ x: spawn[0], y: spawn[1], z: spawn[2], vy: 0, cur: '', lastAttack: 0, swipeUntil: 0, wx: spawn[0], wz: spawn[2], wNext: 0, tumbling: false, spinX: 0, spinZ: 0, wasClimbing: false, lastRanged: 0, nextRangedCd: 0,
    teleAt: 0, teleArrived: 0, teleDwell: 0, behindUntil: 0, bossAttacked: false, resting: false, moanNext: 0 });
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
    kvx: 0, kvz: 0, kvy: 0, stunUntil: 0, hitAt: 0,
    headFrac: cfg.zombie ? 0.20 : 0.25,   // head ≈ top 20% of a humanoid demon
    noStun: cfg.noStun ?? false,
    yaw: 0,
    opacity: 1,
  }).current;
  useEffect(() => { addDemon(inst); return () => removeDemon(inst); }, [inst]);
  useBossAura(inst, cfg.boss === 'teleporter');
  const bossMats = useRef<THREE.MeshStandardMaterial[]>([]);   // boss: faded each frame to inst.opacity
  const flameIds = useRef<string[]>([]);                       // boss: 4 hex body-flame ids
  // Spawn-once-then-follow: the 4 tall hex flames are spawned lazily in useFrame and removed here.
  useEffect(() => () => {
    const fr = getSiegeFlame();
    if (fr) for (const id of flameIds.current) fr.removeFlame(id);
  }, []);
  // Bone-attach for burns: a hit point locks to the nearest skeleton bone so the
  // fire rides the gait bob + turn + walk (the animation drives the bones), not
  // just the collider. inst.attach(x,y,z) → a per-frame world-position follower.
  useEffect(() => {
    const bones: THREE.Bone[] = [];
    cloned.traverse((o) => { if ((o as THREE.Bone).isBone) bones.push(o as THREE.Bone); });
    inst.attach = (x, y, z) => {
      if (!bones.length) return null;
      const hit = new THREE.Vector3(x, y, z);
      const wp = new THREE.Vector3();
      let best: THREE.Bone | null = null, bestD = Infinity;
      for (const b of bones) {
        b.updateWorldMatrix(true, false);
        b.getWorldPosition(wp);
        const d = wp.distanceToSquared(hit);
        if (d < bestD) { bestD = d; best = b; }
      }
      if (!best) return null;
      const bone = best;
      const localOffset = bone.worldToLocal(hit.clone()); // exact hit spot, in bone space
      return (out: THREE.Vector3) => {
        bone.updateWorldMatrix(true, false);
        out.copy(localOffset).applyMatrix4(bone.matrixWorld);
        return true;
      };
    };
    return () => { inst.attach = undefined; };
  }, [cloned, inst]);
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
    const colDesat = cfg.desat ?? (cfg.zombie ? J.desat : 0);   // explicit desat overrides the zombie auto-desat
    const colHue = cfg.hueShift ?? 0;
    const colRed = cfg.tintRed ?? 0;
    const needsColor = colDesat > 0 || colHue !== 0 || colRed > 0;
    cloned.traverse((o: THREE.Object3D) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      let mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (cfg.zombie || needsColor) {   // clone so per-demon uniforms are independent
        mats = mats.map((mm) => (mm as THREE.Material).clone());
        mesh.material = Array.isArray(mesh.material) ? mats : mats[0];
      }
      mats.forEach((mm) => {
        const m = mm as THREE.MeshStandardMaterial;
        if (!m) return;
        if ('metalness' in m) m.metalness = 0;
        if ('roughness' in m) m.roughness = 0.85;
        if ('emissive' in m && m.map) { m.emissive = new THREE.Color(0xffffff); m.emissiveMap = m.map; m.emissiveIntensity = 0.5; }
        if (cfg.boss === 'teleporter') { m.transparent = true; m.depthWrite = true; bossMats.current.push(m); }
        if (needsColor) {
          // ONE shared program per texture-feature set (uniforms vary per demon): hue-rotate
          // around the grey axis → desaturate → blood-red tint. All three default to no-op.
          m.customProgramCacheKey = () => `zcol_${m.map ? 1 : 0}_${m.emissiveMap ? 1 : 0}`;
          m.onBeforeCompile = (shader) => {
            shader.uniforms.uDesat = { value: colDesat };
            shader.uniforms.uHue = { value: colHue };
            shader.uniforms.uRed = { value: colRed };
            shader.fragmentShader = 'uniform float uDesat;\nuniform float uHue;\nuniform float uRed;\n' + shader.fragmentShader;
            if (shader.fragmentShader.includes('#include <dithering_fragment>')) {
              shader.fragmentShader = shader.fragmentShader.replace(
                '#include <dithering_fragment>',
                '#include <dithering_fragment>\n{ vec3 _c = gl_FragColor.rgb;'
                + ' if (uHue != 0.0) { vec3 _k = vec3(0.57735); float _cs = cos(uHue), _sn = sin(uHue); _c = _c*_cs + cross(_k,_c)*_sn + _k*dot(_k,_c)*(1.0-_cs); }'
                + ' float _zl = dot(_c, vec3(0.299,0.587,0.114));'
                + ' _c = mix(_c, vec3(_zl), uDesat);'
                + ' _c = mix(_c, vec3(min(1.0,_zl*1.4+0.15), _zl*0.15, _zl*0.12), uRed);'
                + ' gl_FragColor.rgb = clamp(_c, 0.0, 1.0); }',
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

    // Ambient moans (SW zombie sounds): per-monster, ~every 4-8s a 50% chance, distance-scaled.
    if (c.moanSounds) {
      if (!s.moanNext) s.moanNext = now + Math.random() * 6000;
      else if (now > s.moanNext) {
        s.moanNext = now + 4000 + Math.random() * 4000;
        if (Math.random() < 0.12 && dist < 55) {   // ~10%/cycle like the SW shombies — ambient, not a wall
          const u = c.moanSounds[(Math.random() * c.moanSounds.length) | 0];
          playSpatialSound(u, dist, { baseVolume: 0.55, playbackRate: 0.8 + Math.random() * 0.4 });
        }
      }
    }

    // ── Blast vertical launch: apply once → gravity arcs them; kick off a tumbling spin. ──
    if (inst.kvy) {
      s.vy = inst.kvy; inst.kvy = 0;
      s.wasClimbing = false;   // a blast cancels any in-progress climb so they fly, not re-climb
      s.tumbling = true;
      const a = Math.random() * Math.PI * 2;
      s.spinX = Math.cos(a) * (Math.random() * 13);   // 0–13 rad/s tumble
      s.spinZ = Math.sin(a) * (Math.random() * 13);
    }
    // ── Horizontal knockback slide. Decays only while GROUNDED (friction); airborne keeps its
    //    momentum so a blast flings them in a full arc instead of stopping after ~1m. ──
    if (inst.kvx || inst.kvz) {
      s.x += inst.kvx * delta; s.z += inst.kvz * delta;
      if (sup.g) {
        const decay = Math.exp(-6 * delta);
        inst.kvx *= decay; inst.kvz *= decay;
        if (Math.abs(inst.kvx) < 0.05) inst.kvx = 0;
        if (Math.abs(inst.kvz) < 0.05) inst.kvz = 0;
      }
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
    } else if (c.boss === 'teleporter') {                   // ── TELEPORTING DARK LORD ──
      g.rotation.y = Math.atan2(dx, dz) + c.faceOffset;
      const dwell = s.teleDwell || 1;
      inst.opacity = Math.max(0, 1 - (now - s.teleArrived) / dwell);   // fade out before each jump
      if (now >= s.teleAt) {
        camera.getWorldDirection(_fwd); _fwd.y = 0; _fwd.normalize();
        let nx: number, nz: number;
        if (Math.random() < 0.10) {
          // FAR retreat: 10-50m out, then rest (idle) 3-6s before jumping back in.
          const ang = Math.random() * Math.PI * 2, r = 10 + Math.random() * 40;
          nx = camera.position.x + Math.cos(ang) * r; nz = camera.position.z + Math.sin(ang) * r;
          s.behindUntil = 0; s.teleDwell = 3000 + Math.random() * 3000; s.resting = true;
        } else {
          // Near: 1-in-3 lands directly behind the player for a strike, else 8-15m out.
          const behind = Math.random() < 1 / 3;
          if (behind) {
            nx = camera.position.x - _fwd.x * 2.2; nz = camera.position.z - _fwd.z * 2.2;
            s.behindUntil = now + 1000;          // 1s grace — run forward to dodge the strike
          } else {
            const ang = Math.random() * Math.PI * 2, r = 8 + Math.random() * 7;
            nx = camera.position.x + Math.cos(ang) * r; nz = camera.position.z + Math.sin(ang) * r;
            s.behindUntil = 0;
          }
          s.teleDwell = 1000 + Math.random() * 3000; s.resting = false;
        }
        s.x = nx; s.z = nz;
        s.y = sampleHeight(nx, nz) ?? s.y;       // arrive standing on the ground there
        s.teleArrived = now; s.teleAt = now + s.teleDwell;
        s.bossAttacked = false; inst.opacity = 1; play(clips.idle);
      } else if (s.resting) {
        play(clips.idle);                        // far retreat: rest in place, no shamble
      } else if (s.behindUntil && now > s.behindUntil && !s.bossAttacked && dist <= c.attackRange + 0.6) {
        s.bossAttacked = true; s.swipeUntil = now + c.attackClipMs; play(clips.attack, true);
        dealPlayerDamage(20 + Math.random() * 80, dx / dist, 0, dz / dist, 6);   // 20-100 dmg back-strike
      } else if (s.behindUntil && now <= s.behindUntil) {
        play(clips.idle);                        // wind-up: the player's dodge window
      } else if (dist > 2.0) {                   // slow shamble toward the player while corporeal
        const step = Math.min(SPD * (c.bossSpeedFactor ?? 0.4) * delta, dist - 2.0);
        mvx = dx / dist; mvz = dz / dist; moving = true;
        s.x += mvx * step; s.z += mvz * step; play(clips.walk);
      } else if (now > s.swipeUntil) play(clips.idle);
    } else if (dist < c.aggro) {                            // found a player -> pursue/attack
      g.rotation.y = Math.atan2(dx, dz) + c.faceOffset;
      const inBand = !!c.rangedRange && dist <= c.rangedRange && dist > c.attackRange;
      if (inBand) {                                          // RANGED breath weapon: HOLD here + spray
        if (now - s.lastRanged > s.nextRangedCd) {
          const cdMin = c.rangedCooldownMs ?? 60000;
          s.lastRanged = now;
          s.nextRangedCd = cdMin + Math.random() * Math.max(0, (c.rangedCooldownMaxMs ?? cdMin) - cdMin);
          s.swipeUntil = now + 1000;                         // attack anim runs for the 1s spray, then idle
          play(clips.attack);                                // loop the attack pose while spraying
          const aAtk = clip(clips.attack); if (aAtk) aAtk.time = 0.5;  // start 0.5s in so it matches the spray
          // Mouth ≈ 30% down from the top (0.70·H, accounts for the long horns). Nudge a
          // touch forward to the face so from the side it reads as coming from the mouth,
          // slightly inside (not floating in the air in front).
          const fxn = dx / dist, fzn = dz / dist;
          const my = s.y + H * 0.70;
          const ox = s.x + fxn * H * 0.04, oz = s.z + fzn * H * 0.04;
          c.onRangedAttack?.(ox, my, oz, dx, dist * 0.4, dz);
        } else if (now > s.swipeUntil) play(clips.idle);     // hold position between sprays
      } else if (dist > c.attackRange) {
        const step = Math.min(SPD * delta, dist - c.attackRange);
        mvx = dx / dist; mvz = dz / dist; moving = true;
        s.x += mvx * step; s.z += mvz * step;
        play(clips.walk);
      } else if (c.rangedRange) { play(clips.idle); }        // ranged monsters don't melee-bite up close (looks silly)
      else if (now - s.lastAttack > c.attackMs) { s.lastAttack = now; s.swipeUntil = now + c.attackClipMs; play(clips.attack, true); }
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
      // Static mesh-object greedy boxes (towns / rocks) live in their OWN grid that
      // the player + bullets never read. Same standable / wall logic, so monsters climb
      // the real shape instead of walking through it (or air-climbing one fat box).
      const mcnt = monsterColliderGrid.getNearby(s.x, s.z, me.r + 0.4);
      const mres = monsterColliderGrid.nearbyResult;
      for (let i = 0; i < mcnt; i++) {
        const b = mres[i] as THREE.Box3;
        if (!b || !b.max) continue;
        if (s.x >= b.min.x - fr && s.x <= b.max.x + fr && s.z >= b.min.z - fr && s.z <= b.max.z + fr) {
          const top = b.max.y;
          if (top <= feet + STEP_UP) { if (top > groundY) groundY = top; }                         // standable / step-up
          else if (b.min.y < feet + H && top > wallTop) { wallTop = top; wallIsMonster = false; }   // too tall → wall
        }
      }
    }
    const grounded = feet <= groundY + 0.08 && s.vy <= 0.02;
    const belowTop = wallTop > -Infinity && feet < wallTop - 0.1;

    // UNIVERSAL: never walk through a wall. Undo the horizontal step that entered it (both gaits).
    if (belowTop) {
      s.x = preX; s.z = preZ;
      // Blast-slam into a wall/building → kinetic impact damage from horizontal speed (kvx/kvz
      // are only non-zero from knockback, so normal walking never triggers this).
      const hs = Math.hypot(inst.kvx, inst.kvz);
      if (hs > IMPACT_MIN && !inst.dead) { hurtDemon(inst, impactDamage(hs)); inst.kvx = 0; inst.kvz = 0; }
    }

    // ── Blocked by a wall — two reusable SW gaits ──
    let climbing = false;
    if (wallTop > -Infinity && moving) {
      if (gait === 'climb') {
        // Start a climb only from the GROUND (at the wall's base), then keep climbing while
        // already on the face. Without this, a demon flung airborne by a blast would switch to
        // climb-mode mid-flight near a wall — killing its arc and walking it up into the sky.
        climbing = belowTop && (grounded || s.wasClimbing);
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

    s.wasClimbing = climbing;   // continuity so an in-progress wall climb isn't dropped mid-ascent

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
      const fallV = s.vy;
      s.y += s.vy * delta;
      if (s.y <= groundY) {
        // Hard landing after a blast launch (was airborne) → kinetic impact damage.
        if (!sup.g) {
          const iv = Math.hypot(inst.kvx, fallV, inst.kvz);
          if (iv > IMPACT_MIN && !inst.dead) { hurtDemon(inst, impactDamage(iv)); inst.kvx = 0; inst.kvz = 0; }
        }
        s.y = groundY; s.vy = 0;
      }
    }
    // Publish support: resting on something solid (landed, not climbing/airborne) → others may
    // stand on us. Climbing or falling → not supported, so nobody climbs us mid-air.
    sup.g = !climbing && s.vy === 0;

    // Tumble through the air after a blast; land + settle upright once grounded.
    if (s.tumbling) {
      if (sup.g) { s.tumbling = false; g.rotation.x = 0; g.rotation.z = 0; }
      else { g.rotation.x += s.spinX * delta; g.rotation.z += s.spinZ * delta; }
    }

    me.y = s.y;
    g.position.set(s.x, s.y, s.z);
    inst.x = s.x; inst.y = s.y; inst.z = s.z;   // keep the combat hitbox on the live body
    inst.yaw = g.rotation.y;                     // so attached fire rotates with the body
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
    if (cfg.boss === 'teleporter') {
      const o = inst.opacity ?? 1, mats = bossMats.current;   // fade the model to its opacity
      for (let i = 0; i < mats.length; i++) mats[i].opacity = o;
      // 4 tall, thin hex flames at the collider sides (20% inside the edge), riding the body.
      const fr = getSiegeFlame();
      if (fr) {
        const off = inst.radius * 0.8;
        if (!flameIds.current.length) {
          for (let i = 0; i < 4; i++) {
            _flame.set(s.x + BOSS_FLAME_SIDES[i][0] * off, s.y, s.z + BOSS_FLAME_SIDES[i][1] * off);
            flameIds.current.push(fr.spawnFlame({
              type: 'hex', position: _flame, colors: BOSS_FLAME_COLORS,
              size: 0.4, height: H * 1.5, duration: 1e9, particleCount: 60,
              attachTo: `dlf_${inst.id}_${i}`, colorMode: 'static',
            }));
          }
        } else {
          for (let i = 0; i < 4; i++) {
            fr.updateAttachedPosition(`dlf_${inst.id}_${i}`,
              _flame.set(s.x + BOSS_FLAME_SIDES[i][0] * off, s.y, s.z + BOSS_FLAME_SIDES[i][1] * off));
          }
        }
      }
    }
    sdbg.monsters = MONSTERS.size; // SW debug
  });

  return <group ref={group} scale={scale}><primitive object={cloned} /></group>;
}
