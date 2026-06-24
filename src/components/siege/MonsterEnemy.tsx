// MonsterEnemy — generic, reusable Siege Worlds enemy entity (ports the common Java NPC
// behavior: wander+search when no player near, pursue + attack when in aggro range). One
// component, configured per monster — no per-monster forks. Brightens the model's materials
// (the source meshes render very dark) and ground-follows the terrain.
//
// NOTE: combat (taking player bullets / dealing damage) is intentionally NOT here yet — it
// will arrive with the shared Dreadroot weapon/combat system, not a bespoke one.

import { useEffect, useRef, useMemo, useState } from 'react';
import { useGLTF, useAnimations } from '@react-three/drei';
import { SkeletonUtils } from 'three-stdlib';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { sampleHeight } from './terrainHeight';
import { groundAt } from './siegeGround';
import { injectRecolor, setRecolor } from './challenge/colorMods';
import type { ColorMods } from './challenge/challengeTypes';
import { worldCollisionGrid, monsterColliderGrid } from '@/lib/spatialHashGrid';
import { getChallengeState } from './challenge/challengeStore';
import { tickDarkLordLightning, tryStartLightning, clearLightningCaster } from './darkLord/darkLordLightning';
import { sdbg } from './siegeDebug';
import { addDemon, removeDemon, hurtDemon, type DemonInstance } from './siegeHorde';
import { getMonstersPaused, useSiegeHitboxes } from './siegeDebugToggles';
import { getHitboxFor, subscribeHitboxes, type MonsterHitbox } from './hitboxConfig';
import { bullseyePct, useBullseyeFactor, effectiveBullseyePct } from '@/features/bullseye/bullseyeZone';
import { registerEditable, getEditUrl, getSelectedBox, subscribeEditor } from './hitboxEditor';
import { useBossAura } from './darkLordAura';
import { dealPlayerDamage, getLastSprayHitAt } from './spray/sprayAttackSystem';
import { dropSiegeDivi } from './siegeCoinDrops';
import { play3DPositionalSound, startLoopSound, updateLoopSound, stopLoopSound, type LoopSound } from '@/lib/spatialAudio';
import { DarkLordFlame } from './DarkLordFlame';
import { useSmokeTrail } from './siegeSmoke';

// Blast-impact damage: kinetic, only above a threshold speed. min(120, 0.12·v²).
const IMPACT_MIN = 7;
// Fall + slam (velocity) impact damage, reduced 80% — monsters were dying just
// from climbing over simple objects. Both the horizontal-slam (hs) and the
// landing/fall (iv) checks run through this, so both drop 80%.
const impactDamage = (v: number) => v > IMPACT_MIN ? Math.min(24, 0.024 * v * v) : 0;

// Spintroll behaviour. Ranges are [min,max] (random per use). It spins fast, dashes ("zooms")
// in random directions, and damages the player on contact (double + flinging the player's view
// into a spin when the contact happens DURING a zoom).
export interface SpinConfig {
  revPerSec: [number, number];    // visual spin rate (full revs/sec)
  zoomEveryMs: [number, number];  // random gap between zoom dashes
  zoomSpeedMul: [number, number]; // dash speed = this × base speed
  contactDmg: [number, number];   // touch damage
  contactKb: [number, number];    // touch knockback (m)
  zoomHitMul: number;             // dmg + kb multiplier when the hit lands mid-zoom
  playerSpinRev: [number, number];// on a zoom-hit, spin the player's view this fast (revs/sec)
  spinSound?: string;             // looped 3D whir while spinning; pitch tracks this troll's spin rate
}

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
  noKnockback?: boolean;      // bullets/hits deal HP only — no shove (Spintroll drives its own motion)
  riseFromGround?: boolean;   // spawn sunk in the floor and rise out over 1s (challenge drops)
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
  kiteMin?: number;           // ranged "kite": hold this far from the player — retreat if closer
  kiteMax?: number;           // …approach if farther than this; else hold + face (no melee chase)
  rangedRange?: number;       // if set, fires a ranged attack when the player is within this (m) but beyond melee
  rangedCooldownMs?: number;  // MIN recharge (ms) between ranged attacks (default 60000)
  rangedCooldownMaxMs?: number; // MAX recharge — each cooldown is random in [min,max]; defaults to min
  onRangedAttack?: (x: number, y: number, z: number, dx: number, dy: number, dz: number, wide?: boolean) => void; // fire the breath weapon (wide = 90° sweep)
  boss?: 'teleporter';        // 'teleporter' = Dark Lord: teleports around the player, opacity = damage
                              // resistance, aura of black/purple fire + smoke, melee strike from behind
  bossSpeedFactor?: number;   // shamble-speed multiplier while corporeal (default 0.4 = slow)
  lightning?: boolean;        // Dark Lord: fingertip lightning stream attack (darkLordLightning)
  // Per-individual colour treatment (for varied hordes). Applied in-shader in this order:
  // hue-rotate → desaturate → red tint. Each defaults to off (or the zombie auto-desat).
  desat?: number;             // explicit desaturation 0..1 (overrides the zombie auto-desat)
  hueShift?: number;          // hue rotation in RADIANS (±)
  tintRed?: number;           // blood-red tint mix 0..1
  colorMods?: ColorMods;      // authored Challenge recolour (sat/hue/tint/blend) — takes over from the zombie tint
  moanSounds?: string[];      // ambient moan clips (random pick, ~per 4-8s, distance-scaled)
  meleeContact?: { dmg: [number, number]; kb: [number, number]; cooldownMs?: number }; // collider-touch swipe: random dmg + knockback (m)
  damageMul?: number;         // boss modifier: scales ALL damage this monster deals to the player
  contactDamage?: number;     // touching the player: 30% chance/sec to hit for this × height (m)
  kbInverseSize?: boolean;    // bullets don't stun; knockback ∝ 1/size (small = flung, big = barely)
  stackSink?: number;         // when standing on ANOTHER monster, sink feet this fraction into it (0.30)
  // Body flames: one procedural fire shell per spec (Dark Lord = 1 purple; Spintroll = green+blue).
  bodyFlames?: { radiusMul: number; heightMul: number; colorHot: string; colorCool: string }[];
  smokeTrail?: boolean;       // drop a long-lived (7s) smoke trail (Spintroll)
  spin?: SpinConfig;          // Spintroll: fast spin + erratic zoom + contact damage + player-spin
  clips?: { idle?: string; walk?: string; run?: string; attack?: string; death?: string; hit?: string };
  roarSound?: string;         // if set, the monster roars this (spatial) — 20% chance every 3-5s
  callSound?: string;         // ambient call (spatial) — 10% chance every 10-20s, ±15% pitch/speed
  annoyedSound?: string;      // ranged sprayer: plays after 2 vomits in a row that ALL missed
  attackSound?: string;       // if set, plays (spatial) the instant a melee swing starts — timed to the swipe
  missSound?: string;         // if set, plays (spatial) when a swing whiffs — the player left hit range before contact
  hitSound?: string;          // impact sound when THIS monster lands a hit (default punched.mp3 — e.g. little_slap for grunts)
  walkSound?: string;         // looped 3D footstep/stomp sound, audible only while the monster is moving
  hurtSound?: string;         // plays (spatial) each time a bullet hits this monster
  attackStyle?: 'spin-lunge'; // 'spin-lunge' = mushroom grunt: 360° body spin (0.25s) + lunge to 50% closer and back (0.5s),
                              // strike at the peak. No swipe. Reads dmg/kb from meleeContact.
  lungeOnSwing?: boolean;     // committed-swipe monsters: lunge the body 65% toward the camera + up
                              // toward its height (face in your view) during the swing, then snap back.
  bulletTumble?: boolean;     // mushroom grunt: a BULLET launches it 1-10m away from the shot + tumbles
                              // it end-over-end (1-5 rev/s) instead of a small slide.
  deathStyle?: 'deflate' | 'topple';   // 'deflate' = mushroom (face-first → flatten → sink);
                              // 'topple' = heel-pivot backward fall, slope-aware; corpse persists in challenges.
  // A weapon glb attached to the Hand_R bone. scale is a multiplier on top of the rig (the FR
  // hand bone has a 0.01 intrinsic scale, so ~100 ≈ a 1 m weapon that scales with the monster);
  // pos/rotDeg seat the grip in the fist.
  weapon?: { url: string; scale?: number; pos?: [number, number, number]; rotDeg?: [number, number, number] };
  enrageOnHit?: boolean;       // once damaged: walk→run clip + 50% faster (charges when shot)
}

const DEF = { speed: 2.5, attackRange: 2.8, attackMs: 3000, attackClipMs: 1300, aggro: 60, wanderRadius: 14, faceOffset: 0 };
const DEFCLIPS = { idle: 'idle', walk: 'walk', run: 'run', attack: 'attack', death: 'death', hit: 'hit' };
const DEATH_DESPAWN_MS = 2600; // play the death clip, hold the pose, then remove
let _mid = 0;
// Climbing physics. JUMP_VEL apex ≈ own height (1.8m) so a demon can mount one box / one
// demon per hop; piling several lets them clear taller walls.
const GRAVITY = 22, JUMP_VEL = 9.5, STEP_UP = 0.45;
const TRAP_RADIUS = 1.3, TRAP_COUNT = 3; // boxed in by this many of its own kind → climb over
const CLIMB_LOD = 90; // beyond this (m from camera) skip the per-frame world-collision query

// TRUE 3D directional audio for monster-emitted sounds (roar/attack/miss/moan): HRTF panning
// from the monster's mouth toward the player's ears + natural distance falloff. Skipped past
// 50m (inaudible). Scratch vectors are safe — play3DPositionalSound snapshots them synchronously.
const _aSrc = new THREE.Vector3();
const _aDir = new THREE.Vector3();
function emitMonster3D(camera: THREE.Camera, url: string, sx: number, sy: number, sz: number,
                      dist: number, opts: { baseVolume?: number; playbackRate?: number }) {
  if (dist > 50) return;
  _aSrc.set(sx, sy, sz);
  camera.getWorldDirection(_aDir);
  void play3DPositionalSound(url, _aSrc, camera.position, _aDir,
    { baseVolume: opts.baseVolume, playbackRate: opts.playbackRate, refDistance: 5, maxDistance: 50, rolloffFactor: 1.5 });
}

// Shared live registry of monster footprints so each pushes out of the others (cheap O(n²)
// separation — fine for the handful of beach monsters). Each entry = current x/z + radius.
const MONSTERS = new Set<{ x: number; y: number; z: number; r: number }>();
const _fwd = new THREE.Vector3();   // scratch: player look direction (for teleport-behind)
// Headshot waist-bend scratch (world-space rotation applied to the spine bone on
// top of the animation). Module-level + reused per-instance; frame callbacks run
// sequentially so sharing is safe.
const _hsGwq = new THREE.Quaternion();
const _hsRight = new THREE.Vector3();
const _hsDelta = new THREE.Quaternion();
const _hsPwq = new THREE.Quaternion();
const _hsLocal = new THREE.Quaternion();
const _hbWorld = new THREE.Vector3();   // scratch: head bone world position (hitbox follow)
// Bullseye spin-fall scratch: 360° pirouette about vertical (yaw) + 90° tip about
// the world horizontal axis ⟂ the bullet dir, composed as a quaternion.
const _bqTip = new THREE.Quaternion();
const _bqYaw = new THREE.Quaternion();
const _bAxis = new THREE.Vector3();
const _bUP = new THREE.Vector3(0, 1, 0);
const HALF_PI = Math.PI / 2;
const TWO_PI = Math.PI * 2;
function bullseyeQuat(out: THREE.Quaternion, yaw: number, spin: number, tip: number, bdx: number, bdz: number): void {
  const ax = bdz, az = -bdx, am = Math.hypot(ax, az) || 1;   // world horizontal axis ⟂ bullet dir
  _bAxis.set(ax / am, 0, az / am);
  _bqTip.setFromAxisAngle(_bAxis, tip);                       // tip toward the bullet dir
  _bqYaw.setFromAxisAngle(_bUP, yaw + spin);                  // base facing + vertical spin
  out.copy(_bqTip).multiply(_bqYaw);
}
// Bullseye-fall terrain analysis: a body of height H, feet at (fx,fz), toppling in
// horizontal direction (dx,dz). Marches the ground out one body-length and returns
//   tip      — the body angle (from vertical) that lays it PARALLEL to the average
//              slope it falls onto (90° = flat; <90° lying up an incline; >90° down).
//   slopeDeg — steepest local downslope along the fall, in degrees (0 if uphill/flat).
//   fallOff  — open space or a near-vertical face (cliff/ledge/rooftop) → free-fall.
function bullseyeLanding(fx: number, fz: number, dx: number, dz: number, H: number): { tip: number; slopeDeg: number; fallOff: boolean } {
  const yF = sampleHeight(fx, fz);
  if (yF == null) return { tip: HALF_PI, slopeDeg: 90, fallOff: true };
  const N = Math.max(3, Math.ceil(H / 0.4));
  const stepLen = H / N;
  let prevY = yF, yHead = yF, maxStepDrop = 0;
  for (let i = 1; i <= N; i++) {
    const d = stepLen * i;
    const y = sampleHeight(fx + dx * d, fz + dz * d);
    if (y == null) return { tip: HALF_PI, slopeDeg: 90, fallOff: true };   // toppled into open space
    const drop = prevY - y;                                    // + = ground falls away
    if (drop > maxStepDrop) maxStepDrop = drop;
    prevY = y; yHead = y;
  }
  // A single short step that plunges ≈vertically = a cliff/rooftop edge → fall off.
  const localDeg = Math.atan2(maxStepDrop, stepLen) * 180 / Math.PI;
  if (localDeg >= 80) return { tip: HALF_PI, slopeDeg: 90, fallOff: true };
  const slope = Math.atan2(yHead - yF, H);                     // + uphill / − downhill
  return { tip: HALF_PI - slope, slopeDeg: Math.max(0, -slope * 180 / Math.PI), fallOff: false };
}
// Advances the toppled body across terrain for ONE frame: free-falls off cliffs,
// slides down >60° slopes until they flatten below 30°, else rests parallel to the
// ground. Mutates the feet position (s.x/s.y/s.z) and slide/fall state on `s`.
// Returns the body's current tip and whether it is still in motion (not yet at rest).
function bullseyeSettle(s: { x: number; y: number; z: number; beSlideV: number; beSliding: boolean; beFell: boolean; beFellVY: number }, dx: number, dz: number, H: number, dt: number): { tip: number; moving: boolean } {
  if (s.beFell) {                                             // free-fall off an edge
    s.beFellVY -= 24 * dt;
    s.x += dx * 4 * dt; s.z += dz * 4 * dt; s.y += s.beFellVY * dt;
    const gy = sampleHeight(s.x, s.z);
    if (gy != null && s.y <= gy) { s.y = gy; s.beFell = false; return { tip: HALF_PI, moving: false }; }
    return { tip: HALF_PI, moving: true };
  }
  const land = bullseyeLanding(s.x, s.z, dx, dz, H);
  if (land.fallOff) { s.beFell = true; s.beFellVY = 0; return { tip: HALF_PI, moving: true }; }
  if (land.slopeDeg >= 60) s.beSliding = true;                // steep → start sliding
  if (s.beSliding && land.slopeDeg < 30) s.beSliding = false; // flattened out → stop
  if (s.beSliding) {
    const th = land.slopeDeg * Math.PI / 180;
    s.beSlideV = Math.min(s.beSlideV + 16 * Math.sin(th) * dt, 14);   // gravity-driven, friction-capped
    const horiz = s.beSlideV * Math.cos(th);
    s.x += dx * horiz * dt; s.z += dz * horiz * dt;
    const gy = sampleHeight(s.x, s.z); if (gy != null) s.y = gy;
    return { tip: land.tip, moving: true };
  }
  s.beSlideV = 0;
  const gy = sampleHeight(s.x, s.z); if (gy != null) s.y = gy;
  return { tip: land.tip, moving: false };
}
const rnd = ([a, b]: [number, number]) => a + Math.random() * (b - a);   // random in [a,b]
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

// Attaches a weapon glb to the monster's Hand_R bone (inside the already-cloned rig). The weapon
// is wrapped in a group so the glb's intrinsic scale is preserved; the wrapper carries the grip
// transform. Returns null — it only mutates the bone hierarchy.
function HandWeapon({ root, w }: { root: THREE.Group; w: NonNullable<MonsterConfig['weapon']> }) {
  const { scene } = useGLTF(w.url);
  useEffect(() => {
    let hand: THREE.Object3D | undefined;
    root.traverse((o) => { if (o.name === 'Hand_R') hand = o; });
    if (!hand) return;
    const wrap = new THREE.Group();
    wrap.scale.setScalar(w.scale ?? 100);
    if (w.pos) wrap.position.set(w.pos[0], w.pos[1], w.pos[2]);
    if (w.rotDeg) wrap.rotation.set(w.rotDeg[0] * Math.PI / 180, w.rotDeg[1] * Math.PI / 180, w.rotDeg[2] * Math.PI / 180);
    wrap.add(scene.clone(true));
    hand.add(wrap);
    const h = hand;
    return () => { h.remove(wrap); };
  }, [root, scene, w]);
  return null;
}

export function MonsterEnemy({ spawn, ...cfg }: { spawn: [number, number, number] } & MonsterConfig) {
  const c = { ...DEF, ...cfg };
  const clips = { ...DEFCLIPS, ...(cfg.clips || {}) };
  const { scene, animations } = useGLTF(c.url);
  // Clone the rig so MANY instances of the same model (e.g. a horde of red demons) each get
  // their own skeleton — a plain shared scene can only render in one place. SkeletonUtils
  // clones the skinned mesh + skeleton properly (materials stay shared, which is fine).
  const cloned = useMemo(() => SkeletonUtils.clone(scene) as THREE.Group, [scene]);
  // Waist/spine bone for the headshot recoil-bend. Take the LOWEST spine bone in
  // DFS order (hinges at the waist); fall back to hips/pelvis. null → no bend.
  const waistBone = useMemo(() => {
    let spine: THREE.Bone | null = null, hips: THREE.Bone | null = null;
    cloned.traverse((o) => {
      if (!(o as THREE.Bone).isBone) return;
      const n = o.name.toLowerCase();
      if (!spine && n.includes('spine')) spine = o as THREE.Bone;
      if (!hips && (n.includes('hips') || n.includes('pelvis'))) hips = o as THREE.Bone;
    });
    return (spine ?? hips) as THREE.Bone | null;
  }, [cloned]);

  // Dark Lord lightning origins: the two index fingertips (fall back to the hands). The beam
  // streams from these, so it tracks the cast pose's extended fingers.
  const liteBones = useMemo(() => {
    if (!cfg.lightning) return null;
    const by: Record<string, THREE.Object3D> = {};
    cloned.traverse((o) => { by[o.name] = o; });
    const l = by['IndexFinger_04'] ?? by['Hand_L'];
    const r = by['IndexFinger_04.001'] ?? by['Hand_R'];
    return l && r ? { l, r } : null;
  }, [cloned, cfg.lightning]);
  const _hL = useMemo(() => new THREE.Vector3(), []);
  const _hR = useMemo(() => new THREE.Vector3(), []);
  // Head bone — the head HITBOX rides this so it tracks the skull through the
  // animation (bend-back, bob, lunge). General: any rig with a 'head' bone gets
  // it; rigs without one fall back to the static root-anchored head box.
  const headBone = useMemo(() => {
    let head: THREE.Bone | null = null;
    cloned.traverse((o) => {
      if (!head && (o as THREE.Bone).isBone && o.name.toLowerCase().includes('head')) head = o as THREE.Bone;
    });
    return head as THREE.Bone | null;
  }, [cloned]);
  // The head bone's rest position in the monster's LOCAL frame (captured once);
  // the residual between the tuned box and this lets the box keep its tuned offset
  // (e.g. forward onto the face) while riding the bone.
  const headRestLocal = useRef<{ x: number; y: number; z: number } | null>(null);
  const headWireRef = useRef<THREE.Mesh>(null);   // the !hb head wireframe (world-space, bone-followed)
  const bullsWireRef = useRef<THREE.Mesh>(null);  // the !hb bullseye wireframe (nested in the head box)
  const group = useRef<THREE.Group>(null);
  const showHitboxes = useSiegeHitboxes();   // !hb toggle → draw body + head collision boxes
  useBullseyeFactor();                       // re-render the gold box when the size factor changes (role/items)
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
  // Skeletons scale their animation speed DOWN with size so giants don't look frantic: 4× at 2 m,
  // then ×0.8 for every metre taller (e.g. 6 m → 4·0.8⁴ ≈ 1.64×). Other monsters keep c.animSpeed.
  const isSkeletonMon = (c.url ?? '').includes('skeleton');
  const effAnimSpeed = isSkeletonMon ? 4 * Math.pow(0.8, H - 2) : (c.animSpeed ?? 1);
  // Animation rhythm jitter × per-monster playback-rate (e.g. slow zombie clip → 3x).
  useEffect(() => { mixer.timeScale = J.anim * effAnimSpeed; }, [mixer, J.anim, effAnimSpeed]);
  const st = useRef({ x: spawn[0], y: spawn[1], z: spawn[2], vy: 0, cur: '', lastAttack: 0, swipeUntil: 0, wx: spawn[0], wz: spawn[2], wNext: 0, tumbling: false, spinX: 0, spinZ: 0, wasClimbing: false, lastRanged: 0, nextRangedCd: 0,
    teleAt: 0, teleArrived: 0, teleDwell: 0, behindUntil: 0, bossAttacked: false, resting: false,
    liteActive: false, liteStart: 0, liteOnSince: 0, liteTick: 0, liteRoll: 0, rechargeUntil: 0,
    moanNext: 0, contactNext: 0, meleeNext: 0, swingResolveAt: 0, swingHit: false, attackSoundAt: 0, strikeAt: 0,
    lungeStart: 0, lungeOX: 0, lungeOZ: 0, lungeYaw0: 0, lungeStruck: false,
    spinVel: 0, zoomNext: 0, zoomUntil: 0, zoomVx: 0, zoomVz: 0, spinHitNext: 0, riseStart: 0,
    spiralHeading: 0, spiralPeriod: 0, spiralStart: 0, spiralOn: false, spiraling: false, lungeOY: 0,
    deathSnd: false, fellSound: false, lastHurtAt: 0, swingGap: 0,
    sprayFireAt: 0, sprayCheck: 0, sprayMiss: 0, wideNext: false, wideUntil: 0,
    tumbleYaw: 0, bulletTumble: false, killFired: false,
    // Bullseye topple terrain-settle state (per-fall, reset when bullseyeAt changes).
    beFor: 0, beSlideV: 0, beSliding: false, beFell: false, beFellVY: 0, beSettledAt: 0, beDone: false,
    // Skeleton injured-crawl + death-variant state.
    deathVariant: '' });

  // Body-flame container — shrunk to nothing over the first 2s of death so the flames go out.
  const flamesRef = useRef<THREE.Group>(null);
  // Looped 3D sounds (spintroll whir, walk stomps) — stopped on death/unmount.
  const spinLoopRef = useRef<LoopSound | null>(null);
  const walkLoopRef = useRef<LoopSound | null>(null);
  useEffect(() => () => {
    stopLoopSound(spinLoopRef.current); spinLoopRef.current = null;
    stopLoopSound(walkLoopRef.current); walkLoopRef.current = null;
  }, []);

  // Occasional roar (e.g. red demon): every 3-5s roll a 20% chance to roar from the
  // monster's position, with ±15% random pitch/length. Cleans up on death/despawn.
  useEffect(() => {
    if (!c.roarSound) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => {
        if (!alive) return;
        if (Math.random() < 0.20) {
          const s = st.current;
          const dist = Math.hypot(camera.position.x - s.x, camera.position.z - s.z);
          emitMonster3D(camera, c.roarSound!, s.x, s.y + 1.2, s.z, dist,
            { baseVolume: 0.85, playbackRate: 0.85 + Math.random() * 0.30 });
        }
        schedule(); // re-roll in another 3-5s
      }, 3000 + Math.random() * 2000);
    };
    schedule();
    return () => { alive = false; clearTimeout(timer); };
  }, [c.roarSound, camera]);
  // Occasional ambient CALL (e.g. vomit demon's deer roar): 10% chance every 10-20s, re-rolling
  // both the chance AND the gap each time, with ±15% pitch+speed variation.
  useEffect(() => {
    if (!c.callSound) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => {
        if (!alive) return;
        if (Math.random() < 0.10) {
          const s = st.current;
          const dist = Math.hypot(camera.position.x - s.x, camera.position.z - s.z);
          emitMonster3D(camera, c.callSound!, s.x, s.y + 1.2, s.z, dist,
            { baseVolume: 0.8, playbackRate: 0.85 + Math.random() * 0.30 });
        }
        schedule();
      }, 10000 + Math.random() * 10000);
    };
    schedule();
    return () => { alive = false; clearTimeout(timer); };
  }, [c.callSound, camera]);
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
    noKnockback: cfg.noKnockback ?? false,
    yaw: 0,
    opacity: 1,
    kbScale: cfg.kbInverseSize ? 6 / H : undefined,   // 1-3·(6/H) velocity → ~1-3m slide ÷ size
    tumbleOnBullet: cfg.bulletTumble ?? false,        // mushroom: bullets launch + tumble it
  }).current;
  useEffect(() => { addDemon(inst); return () => { removeDemon(inst); clearLightningCaster(inst.id); }; }, [inst]);
  useBossAura(inst, cfg.boss === 'teleporter');

  // Per-monster BOX hitboxes (reactive to editor edits). MUST be after `inst`/`H`
  // exist. Re-render on a hitbox-config change (recompute boxes) or an editor
  // selection change (highlight). (showHitboxes hook is declared earlier.)
  const [hbVersion, setHbVersion] = useState(0);
  useEffect(() => subscribeHitboxes(() => setHbVersion((v) => v + 1)), []);
  const [, setEditTick] = useState(0);
  useEffect(() => subscribeEditor(() => setEditTick((v) => v + 1)), []);
  const hitbox: MonsterHitbox = useMemo(
    () => getHitboxFor(c.url, inst.radius, H, inst.headFrac),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [c.url, inst.radius, H, inst.headFrac, hbVersion],
  );
  // Publish the boxes + an enclosing broad-phase cylinder to the combat instance.
  useEffect(() => {
    inst.hitboxes = hitbox;
    const reach = (b: MonsterHitbox['body']) => Math.hypot(Math.abs(b.lx) + b.hx, Math.abs(b.lz) + b.hz);
    inst.bpRadius = Math.max(reach(hitbox.body), reach(hitbox.head), inst.radius);
    inst.bpTop = Math.max(hitbox.body.ly + hitbox.body.hy, hitbox.head.ly + hitbox.head.hy, H);
    inst.bpBottom = Math.min(hitbox.body.ly - hitbox.body.hy, hitbox.head.ly - hitbox.head.hy, 0);
    // Bullseye box pct, by max dimension (max of height + footprint width/depth).
    const maxDim = Math.max(H, hitbox.body.hx * 2, hitbox.body.hz * 2);
    inst.bullseyePct = bullseyePct(maxDim);
  }, [hitbox, inst, H]);
  // Register with the editor so the box of the monster nearest the camera is edited.
  useEffect(
    () => registerEditable({ url: c.url, radius: inst.radius, height: H, headFrac: inst.headFrac, pos: () => ({ x: inst.x, z: inst.z }) }),
    [c.url, inst, H],
  );
  useSmokeTrail(inst, !!cfg.smokeTrail);
  const bossMats = useRef<THREE.MeshStandardMaterial[]>([]);   // boss: faded each frame to inst.opacity
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
    const cm = cfg.colorMods;                                   // authored Challenge recolour (takes over)
    const colDesat = cfg.desat ?? (cfg.zombie ? J.desat : 0);   // explicit desat overrides the zombie auto-desat
    const colHue = cfg.hueShift ?? 0;
    const colRed = cfg.tintRed ?? 0;
    const needsColor = colDesat > 0 || colHue !== 0 || colRed > 0;
    cloned.traverse((o: THREE.Object3D) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      let mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (cfg.zombie || needsColor || cm) {   // clone so per-demon uniforms are independent
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
        if (cm) {
          // Authored Challenge colour — the SAME shader the Creator preview uses (sat/hue/tint/blend).
          setRecolor(injectRecolor(m), cm);
        } else if (needsColor) {
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

  const clip = (key: string | undefined) => {
    if (!key) return null;   // guard: a missing clips.* key must never crash the frame loop
    // EXACT (case-insensitive) match first: many Synty rigs ship several "walk" clips
    // (walk, walk_strafe, walk_crossover, …). A loose substring match grabs whichever
    // comes first — often a strafe/crossover clip → "crossed legs" walk. Prefer the clip
    // named exactly `key` (the same one the review lineup cycles via KEEP), then fall back.
    const k = key.toLowerCase();
    const n = names.find((nm) => nm.toLowerCase() === k) ?? names.find((nm) => nm.toLowerCase().includes(k));
    if (n) return actions[n];
    // Synty/Mixamo rigs often ship clips NOT literally named "idle" (e.g. "A_Idle_Standing_Masc",
    // "Armature|Take 001|BaseLayer"). For the idle/default pose, fall back to the FIRST clip so the
    // monster animates instead of freezing in T-pose — matching the Challenge Creator preview, which
    // plays names[0] when there's no exact "idle". (Idle key only; walk/attack/death stay strict.)
    if (key === clips.idle && names.length) return actions[names[0]];
    return null;
  };
  const play = (key: string, once = false) => {
    const a = clip(key); if (!a || st.current.cur === key) return;
    Object.values(actions).forEach((x) => { if (x && x !== a) x.fadeOut(0.15); });
    a.reset(); a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
    a.clampWhenFinished = once; a.fadeIn(0.15).play();
    st.current.cur = key;
  };
  useEffect(() => { if (names.length) play(clips.idle); /* eslint-disable-next-line */ }, [actions, names]);

  // Skeleton-only retargeted clips (gated by availability, so it's a safe no-op on other monsters):
  // a second death variant + an injured crawl that kicks in at low health.
  const hasDeath2 = names.some((n) => n.toLowerCase() === 'death2');
  const hasCrawl = names.some((n) => n.toLowerCase() === 'crawl');

  useFrame((_, delta) => {
    const g = group.current; if (!g) return;
    // Head hitbox FOLLOW: ride the head bone so the box tracks the skull through
    // animation (bend-back, bob, lunge). Center = head bone world pos + the tuned
    // residual (in the body's yaw frame). Writes inst.headBoxWorld (detection) +
    // positions the wireframe (render). Runs even when paused so the editor's
    // live edits still reposition the box. No head bone → static box (below).
    const doHeadFollow = () => {
      if (!headBone) return;
      headBone.getWorldPosition(_hbWorld);
      const yaw = inst.yaw, cs = Math.cos(yaw), sn = Math.sin(yaw);
      if (!headRestLocal.current) {
        const dx = _hbWorld.x - inst.x, dy = _hbWorld.y - inst.y, dz = _hbWorld.z - inst.z;
        headRestLocal.current = { x: dx * cs - dz * sn, y: dy, z: dx * sn + dz * cs };   // world→local
      }
      const ref = headRestLocal.current, hh = hitbox.head;
      const rx = hh.lx - ref.x, ry = hh.ly - ref.y, rz = hh.lz - ref.z;                  // residual (local)
      const wx = _hbWorld.x + (rx * cs + rz * sn);                                        // local→world
      const wy = _hbWorld.y + ry;
      const wz = _hbWorld.z + (-rx * sn + rz * cs);
      if (!inst.headBoxWorld) inst.headBoxWorld = { x: 0, y: 0, z: 0 };
      inst.headBoxWorld.x = wx; inst.headBoxWorld.y = wy; inst.headBoxWorld.z = wz;
      if (headWireRef.current) { headWireRef.current.position.set(wx, wy, wz); headWireRef.current.rotation.y = yaw; }
      if (bullsWireRef.current) { bullsWireRef.current.position.set(wx, wy, wz); bullsWireRef.current.rotation.y = yaw; }   // nested, same center
    };
    // Debug pause (PPP): freeze movement AND animation in place so hitboxes can be
    // inspected. timeScale=0 stops the mixer; the early return skips all AI/physics.
    if (getMonstersPaused()) { mixer.timeScale = 0; doHeadFollow(); return; }
    if (mixer.timeScale === 0) mixer.timeScale = J.anim * (c.animSpeed ?? 1);   // restore on unpause
    const s = st.current;
    const now = performance.now();
    const dx = camera.position.x - s.x, dz = camera.position.z - s.z;
    const dist = Math.hypot(dx, dz) || 1;

    // Body flames go out on death: shrink to zero height over the first 2s (both colours).
    if (flamesRef.current && cfg.bodyFlames) {
      flamesRef.current.scale.y = inst.dead ? Math.max(0, 1 - (now - inst.deadAt) / 2000) : 1;
    }
    // Bullet-hit sound: fires each time a new bullet lands (inst.hitAt advances on every hit).
    if (c.hurtSound && inst.hitAt > s.lastHurtAt) {
      s.lastHurtAt = inst.hitAt;
      emitMonster3D(camera, c.hurtSound, s.x, s.y + H * 0.5, s.z, dist, { baseVolume: 0.7, playbackRate: 0.9 + Math.random() * 0.2 });
    }
    // Spray hit/miss check: 2s after a vomit (long enough for the blobs to land), did any connect?
    // Two vomits in a row that ALL missed → annoyed grunt + the NEXT vomit is a wide 90° sweep.
    if (s.sprayCheck && now > s.sprayCheck) {
      s.sprayCheck = 0;
      if (getLastSprayHitAt() > s.sprayFireAt) s.sprayMiss = 0;   // at least one blob hit you
      else if (++s.sprayMiss >= 2) {
        s.wideNext = true;
        if (c.annoyedSound) emitMonster3D(camera, c.annoyedSound, s.x, s.y + 1.2, s.z, dist, { baseVolume: 0.85, playbackRate: 0.85 + Math.random() * 0.30 });
      }
    }
    // Stop the walk loop once dead (death blocks below return early).
    if (inst.dead && walkLoopRef.current) { stopLoopSound(walkLoopRef.current); walkLoopRef.current = null; }
    // Coin drop: fire ONCE on death. Open-world only (the helper skips challenge kills). DIVI =
    // round(initialHealth/10) at the body.
    if (inst.dead && !s.killFired) { s.killFired = true; s.liteActive = false; clearLightningCaster(inst.id); void dropSiegeDivi(inst.x, inst.y + H * 0.3, inst.z, inst.maxHp); }

    // ── BULLSEYE DEATH: a bullseye that KILLS plays the same dramatic feet-pivot
    //    spin-fall as the stagger (360°+90° to flat, back/face by direction), then
    //    lies flat and sinks into the ground → despawn. Overrides the per-monster
    //    death style so every bullseye kill gets the signature fall. ──
    if (inst.dead && (inst.bullseyeAt || c.deathStyle === 'topple')) {
      if (s.beDone) return;   // finalized challenge corpse: transform + collider frozen, zero per-frame cost
      const key = inst.bullseyeAt || inst.deadAt;
      if (s.beFor !== key) { s.beFor = key; s.beSlideV = 0; s.beSliding = false; s.beFell = false; s.beFellVY = 0; s.beSettledAt = 0; }
      // Bullseye kills fall in the BULLET direction; a normal topple falls straight BACKWARD
      // (away from the monster's facing) so it lands on its back, pivoting over the heels.
      const bdx = inst.bullseyeAt ? (inst.bullseyeDirX ?? 0) : -Math.sin(inst.yaw);
      const bdz = inst.bullseyeAt ? (inst.bullseyeDirZ ?? 1) : -Math.cos(inst.yaw);
      const inChal = getChallengeState().active;
      const FALL = 380, LIE = 2500, SINK = 3000;
      const settle = bullseyeSettle(s, bdx, bdz, H, delta);      // slide/fall-off/rest on terrain
      const td = now - inst.deadAt;
      const fellIn = td >= FALL;
      play(clips.idle);   // freeze the body; the fall is procedural (the death CLIP spins about the mesh centre → floats)
      if (!fellIn || settle.moving) {                            // still tipping in, sliding, or falling off
        const e = Math.min(1, td / FALL), eo = e * e * (3 - 2 * e);
        bullseyeQuat(g.quaternion, inst.yaw, 0, fellIn ? settle.tip : settle.tip * eo, bdx, bdz);
        g.position.set(s.x, s.y, s.z);
        s.beSettledAt = 0;
      } else {                                                   // at rest on the slope
        if (s.beSettledAt === 0) s.beSettledAt = now;
        const held = now - s.beSettledAt;
        bullseyeQuat(g.quaternion, inst.yaw, 0, settle.tip, bdx, bdz);
        if (inChal) {
          // Challenge corpse: STAYS put (piles up) with a low collider until the challenge ends
          // (ChallengeRunner clears all mobs on finish/stop/player-death).
          g.position.set(s.x, s.y, s.z);
          const cr = Math.max(0.4, H * 0.3);
          box.min.set(s.x - cr, s.y, s.z - cr);
          box.max.set(s.x + cr, s.y + Math.max(0.5, H * 0.3), s.z + cr);
          worldCollisionGrid.update(box);
          s.beDone = true;                                       // freeze: stop per-frame terrain settle
        } else {                                                 // open world: lie, then sink → despawn
          const yOff = held >= LIE ? -H * Math.min(1, (held - LIE) / SINK) : 0;
          g.position.set(s.x, s.y + yOff, s.z);
          if (!inst.despawned && held > LIE + SINK) { inst.despawned = true; cfg.onDespawn?.(inst.id); }
        }
      }
      inst.x = g.position.x; inst.y = g.position.y; inst.z = g.position.z;
      return;
    }

    // ── SPINTROLL custom death: spin-down (2s) → stand (1s) → topple straight back → lie (3s)
    //    → sink into the ground (3s) → despawn. Pivots at the feet (model origin), not the mesh
    //    middle, so it falls onto its back without sinking through the floor. ──
    if (inst.dead && c.spin) {
      const td = now - inst.deadAt;
      const SPIN_DOWN = 2000, STAND_END = 3000, FALL = 600, FALL_END = STAND_END + FALL;  // 3600
      const LIE_END = FALL_END + 3000, SINK = 3000, SINK_END = LIE_END + SINK;            // 6600 / 9600
      const dh = sampleHeight(s.x, s.z); if (dh != null) s.y = dh;
      let yOff = 0;
      if (!s.deathSnd) {   // at death: play the death cry once
        s.deathSnd = true;
        emitMonster3D(camera, '/spintroll_death.mp3', s.x, s.y + H * 0.6, s.z,
          Math.hypot(camera.position.x - s.x, camera.position.z - s.z), { baseVolume: 0.9 });
      }
      if (td < SPIN_DOWN) {
        const f = 1 - td / SPIN_DOWN;                 // spin + slide ramp 1 → 0 over 2s
        g.rotation.y += s.spinVel * f * delta;
        s.x += inst.kvx * f * delta; s.z += inst.kvz * f * delta;
        play(clips.idle);
        if (spinLoopRef.current) {                    // whir: jump to 50% then fade to 0 with the spin
          const refRev = (c.spin.revPerSec[0] + c.spin.revPerSec[1]) / 2;
          const baseRate = refRev > 0 ? (Math.abs(s.spinVel) / (Math.PI * 2)) / refRev : 1;
          camera.getWorldDirection(_aDir);
          updateLoopSound(spinLoopRef.current, s.x, s.y + H * 0.5, s.z, camera.position, _aDir, baseRate * f, 0.25 * f);
        }
      } else {
        if (spinLoopRef.current) { stopLoopSound(spinLoopRef.current); spinLoopRef.current = null; }
        play(clips.idle);
        if (td >= STAND_END) {                        // topple straight back over the heels
          g.rotation.order = 'YXZ';
          const fp = Math.min(1, (td - STAND_END) / FALL);
          g.rotation.x = -(Math.PI / 2) * fp;
          if (!s.fellSound && fp >= 1) {              // body hits the ground
            s.fellSound = true;
            emitMonster3D(camera, '/enemy_hitting_ground.mp3', s.x, s.y, s.z,
              Math.hypot(camera.position.x - s.x, camera.position.z - s.z), { baseVolume: 0.8 });
          }
        }
        if (td >= LIE_END) yOff = -H * Math.min(1, (td - LIE_END) / SINK);   // sink under the ground
      }
      g.position.set(s.x, s.y + yOff, s.z);
      inst.x = s.x; inst.y = s.y + yOff; inst.z = s.z;
      if (!inst.despawned && td > SINK_END) { inst.despawned = true; cfg.onDespawn?.(inst.id); }
      return;
    }

    // ── MUSHROOM custom death: fall FACE-FIRST over the toes (0.6s) → lie 1s → DEFLATE (the mesh
    //    flattens, 80%, over 1s) → sink into the ground (3s) → despawn. Pivots at the feet. ──
    if (inst.dead && c.deathStyle === 'deflate') {
      const td = now - inst.deadAt;
      const FALL = 600, LIE_END = FALL + 1000, DEFLATE = 1000, DEFLATE_END = LIE_END + DEFLATE;  // 600/1600/2600
      const SINK = 3000, SINK_END = DEFLATE_END + SINK;                                          // 5600
      const dh = sampleHeight(s.x, s.z); if (dh != null) s.y = dh;
      s.x += inst.kvx * delta; s.z += inst.kvz * delta; inst.kvx *= 0.82; inst.kvz *= 0.82;  // settle last shove
      play(clips.idle);
      g.rotation.order = 'YXZ';
      const fp = Math.min(1, td / FALL);
      g.rotation.x = (Math.PI / 2) * fp;          // topple forward onto its face over the toes
      g.rotation.z = 0;                            // clear any roll left from a mid-tumble death
      if (!s.fellSound && fp >= 1) {              // face hits the ground
        s.fellSound = true;
        emitMonster3D(camera, '/enemy_hitting_ground.mp3', s.x, s.y, s.z,
          Math.hypot(camera.position.x - s.x, camera.position.z - s.z), { baseVolume: 0.7 });
      }
      // Deflate: compress the now-vertical body axis (local Z, once face-down) full → 20%.
      const defl = td >= LIE_END ? 1 - 0.8 * Math.min(1, (td - LIE_END) / DEFLATE) : 1;
      g.scale.set(scale, scale, scale * defl);
      const yOff = td >= DEFLATE_END ? -H * Math.min(1, (td - DEFLATE_END) / SINK) : 0;  // sink once flat
      g.position.set(s.x, s.y + yOff, s.z);
      inst.x = s.x; inst.y = s.y + yOff; inst.z = s.z;
      if (!inst.despawned && td > SINK_END) { inst.despawned = true; cfg.onDespawn?.(inst.id); }
      return;
    }

    // ── DEATH: play the death clip once, slide out the last knockback, then despawn ──
    if (inst.dead) {
      if (s.beDone) return;   // finalized challenge corpse: frozen
      if (spinLoopRef.current) { stopLoopSound(spinLoopRef.current); spinLoopRef.current = null; }  // kill the spin whir
      // Skeletons pick one of two death clips once, 50/50: the original 'death' or the retargeted 'death2'.
      if (!s.deathVariant) s.deathVariant = (hasDeath2 && Math.random() < 0.5) ? 'death2' : clips.death;
      play(s.deathVariant, true);
      s.x += inst.kvx * delta; s.z += inst.kvz * delta;
      inst.kvx *= 0.82; inst.kvz *= 0.82;
      const dh = sampleHeight(s.x, s.z); if (dh != null) s.y = dh;
      g.position.set(s.x, s.y, s.z);
      inst.x = s.x; inst.y = s.y; inst.z = s.z;
      // In a challenge the corpse STAYS (with a low collider) and piles up until the challenge
      // ends; in the open world it despawns after the death clip. (Deflate/spintroll deaths
      // handled above are exempt — they disappear by design.)
      if (getChallengeState().active) {
        if (now - inst.deadAt > DEATH_DESPAWN_MS) {
          const cr = Math.max(0.4, H * 0.3);
          box.min.set(s.x - cr, s.y, s.z - cr);
          box.max.set(s.x + cr, s.y + Math.max(0.5, H * 0.3), s.z + cr);
          worldCollisionGrid.update(box);
          s.beDone = true;   // freeze the corpse
        }
      } else if (!inst.despawned && now - inst.deadAt > DEATH_DESPAWN_MS) {
        inst.despawned = true; cfg.onDespawn?.(inst.id);
      }
      return;
    }

    // INJURED CRAWL (skeletons): at <=10% HP the monster drops to a retargeted crawl, moves at 25%
    // speed. `injured` overrides the locomotion clip + speed below. The crawl's animation rate is
    // ABSOLUTE 2× (its own natural speed ×2), decoupled from the monster's animSpeed (the giant plays
    // everything at 6× — the crawl must NOT inherit that). Re-applied below after play() runs.
    const injured = hasCrawl && inst.hp <= inst.maxHp * 0.10;
    const injMul = injured ? 0.25 : 1;

    // Ambient moans (SW zombie sounds): per-monster, ~every 4-8s a 50% chance, distance-scaled.
    if (c.moanSounds) {
      if (!s.moanNext) s.moanNext = now + Math.random() * 6000;
      else if (now > s.moanNext) {
        s.moanNext = now + 4000 + Math.random() * 4000;
        if (Math.random() < 0.12 && dist < 55) {   // ~10%/cycle like the SW shombies — ambient, not a wall
          const u = c.moanSounds[(Math.random() * c.moanSounds.length) | 0];
          emitMonster3D(camera, u, s.x, s.y + 1, s.z, dist, { baseVolume: 0.55, playbackRate: 0.8 + Math.random() * 0.4 });
        }
      }
    }

    // Passive melee contact: silent melee monsters (giant skeleton, bloody horde) deal damage
    // whenever they're overlapping the player. Monsters with a SWING (attackSound) instead deal
    // damage via the committed-swipe strike below, so they're excluded here; spin-lunge too.
    if (c.meleeContact && !c.attackSound && c.attackStyle !== 'spin-lunge') {
      const pTop = camera.position.y, pFeet = camera.position.y - 1.6;
      // Within swipe reach (its attack range, where it stops + swings) and overlapping vertically.
      if (s.y < pTop && s.y + H > pFeet && dist < c.attackRange + 0.6 && now > s.meleeNext) {
        s.meleeNext = now + (c.meleeContact.cooldownMs ?? 1100);
        dealPlayerDamage(rnd(c.meleeContact.dmg) * (c.damageMul ?? 1), dx / dist, 0, dz / dist, rnd(c.meleeContact.kb), c.hitSound);
        s.swingHit = true;   // this swing connected → no whiff sound
      }
    }

    // Contact damage: only a REAL hitbox overlap counts — horizontally touching AND the bodies
    // overlap vertically (player capsule = camera.y-1.6 … camera.y), so flying/standing above
    // them is safe. 30%/sec → base × height dmg + (1-2)m × height knockback.
    if (c.contactDamage) {
      const pTop = camera.position.y, pFeet = camera.position.y - 1.6;   // PLAYER_HEIGHT, camera at head
      const vertOverlap = s.y < pTop && s.y + H > pFeet;
      if (vertOverlap && dist < inst.radius + 0.35 && now > s.contactNext) {
        s.contactNext = now + 1000;
        if (Math.random() < 0.30) {
          dealPlayerDamage(c.contactDamage * H * (c.damageMul ?? 1), dx / dist, 0, dz / dist, (1 + Math.random()) * H, c.hitSound);
          s.swingHit = true;
        }
      }
    }

    // Delayed swing sound: fires 0.65s after the swipe begins so it lands on the strike, not
    // the wind-up. Distance is recomputed now (the monster may have closed in since).
    if (s.attackSoundAt && now > s.attackSoundAt) {
      s.attackSoundAt = 0;
      if (c.attackSound) emitMonster3D(camera, c.attackSound, s.x, s.y + 1, s.z, dist, { baseVolume: 0.9 });
    }

    // Committed-swipe strike: at the contact point (with the swipe sound) it CONNECTS only if the
    // player is actually within arm's reach — reach ≈ half the monster's height + ~0.5m to the
    // player's center (a 2m troll reaches ~1m, so centers within ~1.5m connect). So being knocked
    // back (or stepping away) makes the next swing whiff. HIT → punch (3D, the working audio path)
    // + damage + knockback; MISS → swoosh. No passive damage for swipe monsters.
    if (s.strikeAt && now > s.strikeAt) {
      s.strikeAt = 0;
      const reach = H * 0.5 + 0.5;
      const vOverlap = s.y < camera.position.y && s.y + H > camera.position.y - 1.6;
      const swoosh = () => { if (c.missSound) emitMonster3D(camera, c.missSound, s.x, s.y + 1, s.z, dist, { baseVolume: 0.6, playbackRate: 0.9 + Math.random() * 0.2 }); };
      if (c.meleeContact && dist < reach && vOverlap) {
        if (Math.random() < 0.5) {
          // HIT (50%): impact sound + damage + knockback + 0-90° view-spin.
          emitMonster3D(camera, c.hitSound ?? '/punched.mp3', s.x, s.y + 1, s.z, dist, { baseVolume: 0.85 });
          dealPlayerDamage(rnd(c.meleeContact.dmg) * (c.damageMul ?? 1), dx / dist, 0, dz / dist, rnd(c.meleeContact.kb), '');
          (window as { __applyPlayerSpin?: (r: number, d: number) => void }).__applyPlayerSpin?.(Math.random() * 0.38, -1);
        } else {
          // AUTO-DODGE (50%): you slip back ~1m out of reach — no damage, NO view-spin — + swoosh.
          (window as { __applyPlayerKnockback?: (d: THREE.Vector3, dist: number) => void })
            .__applyPlayerKnockback?.(new THREE.Vector3(dx / dist, 0, dz / dist), 0.6);
          swoosh();
        }
      } else {
        swoosh();   // already out of reach (you moved away): a clean miss
      }
    }

    // Whiff resolution: a swing was armed (missSound) and its contact moment has arrived.
    // Swoosh only on a GENUINE miss — no damage landed AND the player has left hit range
    // (a real dodge), so standing point-blank between cooldowns never false-triggers it.
    if (c.missSound && s.swingResolveAt && now > s.swingResolveAt) {
      s.swingResolveAt = 0;
      const inHitRange = dist < c.attackRange + 0.8
        && s.y < camera.position.y && s.y + H > camera.position.y - 1.6;
      if (!s.swingHit && !inHitRange) {
        emitMonster3D(camera, c.missSound, s.x, s.y + 1, s.z, dist, { baseVolume: 0.6, playbackRate: 0.9 + Math.random() * 0.2 });
      }
    }

    // ── Blast vertical launch: apply once → gravity arcs them; kick off a tumbling spin. ──
    if (inst.kvy) {
      s.vy = inst.kvy; inst.kvy = 0;
      s.wasClimbing = false;   // a blast/bullet-launch cancels any in-progress climb so they fly
      s.tumbling = true;
      if (inst.bulletTumbleAt) {
        // Bullet tumble (mushroom): a CLEAN end-over-end — face the flight direction, then pitch
        // backward at the chosen rev/sec, so it flips away from the shot perpendicular to it.
        s.tumbleYaw = Math.atan2(inst.kvx, inst.kvz);
        s.spinX = (inst.bulletTumbleRev || 2) * Math.PI * 2;   // rev/s → rad/s
        s.bulletTumble = true; inst.bulletTumbleAt = 0;
      } else {
        const a = Math.random() * Math.PI * 2;
        s.spinX = Math.cos(a) * (Math.random() * 13);   // 0–13 rad/s tumble (random axis, blast)
        s.spinZ = Math.sin(a) * (Math.random() * 13);
        s.bulletTumble = false;
      }
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
      // ── LIGHTNING: fingertip stream takes priority while a bout is active; full power despite
      //    transparency. A roll (40%/s) starts a bout while corporeal + settled; a >5s bout forces
      //    a recharge teleport (30-50m, rest 10s). ──
      let casting = false;
      if (c.lightning && liteBones) {
        liteBones.l.getWorldPosition(_hL); liteBones.r.getWorldPosition(_hR);
        if (s.liteActive) {
          const cmd = tickDarkLordLightning(inst.id, s, inst.hitAt, c.damageMul ?? 1, now,
            camera.position.x, camera.position.y, camera.position.z, _hL, _hR);
          casting = cmd.casting;
          if (cmd.recharge) s.teleAt = now;       // bout maxed → teleport away to recharge next
        } else if (!s.resting && now < s.teleAt) {
          tryStartLightning(s, now, camera.position.x, camera.position.y, camera.position.z, _hL, _hR);
        }
      }
      if (casting) {
        play(clips.attack);                       // hold the cast; no teleport/shamble mid-bout
      } else if (now >= s.teleAt) {
        camera.getWorldDirection(_fwd); _fwd.y = 0; _fwd.normalize();
        let nx: number, nz: number;
        const recharging = now < s.rechargeUntil;
        if (recharging || Math.random() < 0.10) {
          // RECHARGE (30-50m, rest the rest of the 10s) OR a normal far retreat (10-50m, 3-6s).
          const ang = Math.random() * Math.PI * 2, r = recharging ? (30 + Math.random() * 20) : (10 + Math.random() * 40);
          nx = camera.position.x + Math.cos(ang) * r; nz = camera.position.z + Math.sin(ang) * r;
          s.behindUntil = 0; s.teleDwell = recharging ? Math.max(1000, s.rechargeUntil - now) : (3000 + Math.random() * 3000); s.resting = true;
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
        dealPlayerDamage((20 + Math.random() * 80) * (c.damageMul ?? 1), dx / dist, 0, dz / dist, 6);   // 20-100 dmg back-strike
      } else if (s.behindUntil && now <= s.behindUntil) {
        play(clips.idle);                        // wind-up: the player's dodge window
      } else if (dist > 2.0) {                   // slow shamble toward the player while corporeal
        const step = Math.min(SPD * (c.bossSpeedFactor ?? 0.4) * delta, dist - 2.0);
        mvx = dx / dist; mvz = dz / dist; moving = true;
        s.x += mvx * step; s.z += mvz * step; play(clips.walk);
      } else if (now > s.swipeUntil) play(clips.idle);
    } else if (c.spin) {                                    // ── SPINTROLL ──
      if (!s.spinVel) {                                     // init once: spin rate + direction + first zoom
        s.spinVel = rnd(c.spin.revPerSec) * Math.PI * 2 * (Math.random() < 0.5 ? 1 : -1);
        s.zoomNext = now + rnd(c.spin.zoomEveryMs);
      }
      g.rotation.y += s.spinVel * delta;                   // fast visual spin (overrides facing)
      // Looped whir, pitched to THIS troll's spin rate (the ±20% per-individual variation maps to
      // ±20% playback rate). Started once; position + listener tracked at the end of the frame.
      if (c.spin.spinSound && !spinLoopRef.current) {
        const refRev = (c.spin.revPerSec[0] + c.spin.revPerSec[1]) / 2;
        const thisRev = Math.abs(s.spinVel) / (Math.PI * 2);
        spinLoopRef.current = startLoopSound(c.spin.spinSound, {
          x: s.x, y: s.y + H * 0.5, z: s.z, baseVolume: 0.5,
          playbackRate: refRev > 0 ? thisRev / refRev : 1,
        });
      }
      if (now > s.zoomNext) {                              // start a zoom dash (≥5m)
        // ~60% of dashes aim THROUGH the player (so it actually charges + contacts you — a zoom-hit
        // is the big one that flings your view); the rest are random for erratic evasion.
        const ang = Math.random() < 0.6
          ? Math.atan2(dx, dz) + (Math.random() - 0.5) * 0.7   // toward the player, ±0.35 rad
          : Math.random() * Math.PI * 2;
        const mul = rnd(c.spin.zoomSpeedMul);
        const speed = SPD * mul, targetDist = 5 + Math.random() * 15;   // 5-20m per dash
        s.zoomVx = Math.sin(ang) * speed; s.zoomVz = Math.cos(ang) * speed;
        s.zoomUntil = now + (targetDist / speed) * 1000;   // dash until it has covered the distance
        s.zoomNext = now + rnd(c.spin.zoomEveryMs);
      }
      const zooming = now < s.zoomUntil;
      s.spiraling = !zooming;
      if (zooming) {
        const zl = Math.hypot(s.zoomVx, s.zoomVz) || 1;
        mvx = s.zoomVx / zl; mvz = s.zoomVz / zl; moving = true;   // direction for the climb/hop gait
        s.x += s.zoomVx * delta; s.z += s.zoomVz * delta;
        play(clips.walk);
        s.spiralOn = false;   // re-seed a fresh spiral when this zoom ends
      } else {
        // Between zooms: SPIRAL OUTWARD like a top — a fast circular path whose heading sweeps a
        // full revolution every 0.5-1s (re-randomized after each zoom) while the radius grows, so
        // it's erratic and hard to hit. A collider hit (handled in the wall section) bounces it
        // straight into a zoom.
        if (!s.spiralOn) {
          s.spiralOn = true;
          s.spiralStart = now;
          s.spiralPeriod = 500 + Math.random() * 500;           // ms per full revolution (0.5-1s)
          s.spiralHeading = Math.atan2(s.zoomVx || dx, s.zoomVz || dz);  // flow out of the last zoom
        }
        const omega = (2 * Math.PI) / (s.spiralPeriod / 1000);  // rad/s, same direction as the visual spin
        s.spiralHeading += omega * delta * (s.spinVel > 0 ? 1 : -1);
        const t = (now - s.spiralStart) / 1000;
        const speed = Math.min(SPD * 5, SPD * 2.6 * (1 + t * 0.9));   // fast, grows outward, capped
        mvx = Math.sin(s.spiralHeading); mvz = Math.cos(s.spiralHeading); moving = true;
        s.x += mvx * speed * delta; s.z += mvz * speed * delta;
        play(clips.walk);
      }
      // Contact: real hitbox overlap → dmg + knockback; ×zoomHitMul + a view-spin fling mid-zoom.
      if (s.y < camera.position.y && s.y + H > camera.position.y - 1.6
          && dist < inst.radius + 0.45 && now > s.contactNext) {
        s.contactNext = now + 350;
        const mul = zooming ? c.spin.zoomHitMul : 1;
        // Spintroll's own impact sound on the working 3D path; '' skips dealPlayerDamage's own.
        emitMonster3D(camera, '/hit_by_spintroll.mp3', s.x, s.y + 1, s.z, dist, { baseVolume: 0.9 });
        // Big player knockback — scaled way up so it clearly flings you (the ×2 was too small).
        dealPlayerDamage(rnd(c.spin.contactDmg) * mul * (c.damageMul ?? 1), dx / dist, 0, dz / dist, rnd(c.spin.contactKb) * mul * 6, '');
        // Spin the player's view OPPOSITE the troll's spin — on EVERY hit now (was a rare zoom-only
        // fling). __applyPlayerSpin SETS + decays, so a short re-trigger gap keeps it recoverable.
        if (now > s.spinHitNext) {
          s.spinHitNext = now + 700;
          (window as { __applyPlayerSpin?: (r: number, d: number) => void }).__applyPlayerSpin?.(
            rnd(c.spin.playerSpinRev), s.spinVel > 0 ? -1 : 1);   // player spins OPPOSITE the troll
        }
      }
    } else if (dist < c.aggro) {                            // found a player -> pursue/attack
      g.rotation.y = Math.atan2(dx, dz) + c.faceOffset;
      // Ranged breath weapon: fire on cooldown whenever in range — INDEPENDENT of movement, so the
      // monster keeps WALKING toward you between spits instead of standing still and spraying.
      if (c.rangedRange && dist <= c.rangedRange && now - s.lastRanged > s.nextRangedCd) {
        const cdMin = c.rangedCooldownMs ?? 60000;
        s.lastRanged = now;
        s.nextRangedCd = cdMin + Math.random() * Math.max(0, (c.rangedCooldownMaxMs ?? cdMin) - cdMin);
        const fxn = dx / dist, fzn = dz / dist;
        const my = s.y + H * 0.60;            // mouth — lowered 10% of height (was 0.70)
        const ox = s.x + fxn * H * 0.04, oz = s.z + fzn * H * 0.04;
        // 3D aim: point at the player's ACTUAL height (camera.y) + a small upward arc so the acid
        // drops onto them over distance — no more firing flat over your head when you're downhill.
        const dyAim = (camera.position.y - my) + dist * 0.18;
        // After 2 vomits in a row that ALL missed, this one is a WIDE 90° sweep (+ head-shake below).
        const wide = s.wideNext; s.wideNext = false;
        if (wide) { s.wideUntil = now + 1000; s.sprayMiss = 0; }
        s.sprayFireAt = now; s.sprayCheck = now + 2000;   // check 2s later whether any blob connected
        c.onRangedAttack?.(ox, my, oz, dx, dyAim, dz, wide);
        s.swipeUntil = now + 1000;                        // plant + play the vomit pose for the 1s spray
        play(clips.attack); const aAtk = clip(clips.attack); if (aAtk) aAtk.time = 0;
      }
      // Kite (ranged standoff): hold between kiteMin..kiteMax — retreat if too close, approach if
      // too far, else face + idle. Replaces the melee chase for ranged-only monsters (e.g. golem).
      if (c.kiteMin) {
        const kMax = c.kiteMax ?? c.kiteMin;
        if (dist < c.kiteMin || dist > kMax) {
          const sgn = dist < c.kiteMin ? -1 : 1;
          mvx = (dx / dist) * sgn; mvz = (dz / dist) * sgn; moving = true;
          s.x += mvx * SPD * delta; s.z += mvz * SPD * delta;
          if (now > s.swipeUntil) play(clips.walk);
        } else if (now > s.swipeUntil) play(clips.idle);
      }
      // "Ready to swing": melee monsters only — close enough + off cooldown. Suppresses the chase
      // and fires the swing so being in range always attacks.
      const swingDist = Math.max(H * 0.5 + 0.5, c.attackRange);
      const meleeReady = (c.meleeContact || c.attackStyle === 'spin-lunge')
        && now - s.lastAttack > (s.swingGap || c.attackMs) && dist <= swingDist;
      // ENRAGE: once damaged (hp < max), an enrageOnHit monster switches walk→run and +50% speed.
      const enraged = !!c.enrageOnHit && inst.hp < inst.maxHp;
      const chaseSpd = (enraged ? SPD * 1.5 : SPD) * injMul;
      const loco = injured ? 'crawl' : (enraged ? clips.run : clips.walk);
      if (!c.kiteMin && dist > c.attackRange && !(c.attackSound && now < s.swipeUntil) && !meleeReady) {
        // Chase. Only a committed-SWIPE monster plants mid-attack (so knockback can't cancel its
        // swing); a ranged sprayer keeps WALKING toward you even while spitting — only its ANIM
        // holds the vomit pose during the spit (movement continues).
        const step = Math.min(chaseSpd * delta, dist - c.attackRange);
        mvx = dx / dist; mvz = dz / dist; moving = true;
        s.x += mvx * step; s.z += mvz * step;
        if (now > s.swipeUntil) play(loco);   // walk, or RUN once enraged
      } else if (c.rangedRange && !c.kiteMin) { if (now > s.swipeUntil) play(clips.idle); }   // hold the vomit pose mid-spray
      else if (meleeReady) {
        s.lastAttack = now;
        if (c.attackStyle === 'spin-lunge') {
          // Mushroom grunt: begin a 0.5s spin-lunge. Capture the forward offset (50% toward the
          // player NOW) and the base facing; the visual override below drives spin + lunge and
          // resolves hit/miss at the 0.25s peak.
          s.lungeStart = now; s.lungeStruck = false; s.swipeUntil = now + 500;
          s.lungeOX = (camera.position.x - s.x) * 0.5;
          s.lungeOZ = (camera.position.z - s.z) * 0.5;
          s.lungeYaw0 = Math.atan2(dx, dz) + c.faceOffset;
          play(clips.idle);   // limbs still — the WHOLE body spins + lunges
        } else {
          s.swipeUntil = now + c.attackClipMs; play(clips.attack, true);
          // Swing sound is delayed 0.65s so it lands ON the swipe, not at the wind-up. Played
          // frame-driven below (no rate variation, so it stays timed to the swing).
          if (c.attackSound) s.attackSoundAt = now + 650;
          if (c.meleeContact && c.attackSound) {
            // Committed swipe: the demon plants + swings through. The swipe sound lands at 0.65s
            // (the visible swipe); the strike (impact + knockback) is ~0.3s after that.
            s.strikeAt = now + 950;
            s.swingGap = 1000 + Math.random() * 2000;   // next swipe in a random 1-3s
            if (c.lungeOnSwing) {   // lunge the body 65% toward the camera + up toward its height
              s.lungeStart = now;
              s.lungeOX = (camera.position.x - s.x) * 0.65;
              s.lungeOZ = (camera.position.z - s.z) * 0.65;
              s.lungeOY = (camera.position.y - (s.y + H * 0.8)) * 0.65;
            }
          } else if (c.missSound) {
            // Legacy whiff (monsters with a swoosh but no committed strike).
            s.swingResolveAt = now + c.attackClipMs * 0.6; s.swingHit = false;
          }
        }
      }
      else if (now > s.swipeUntil) play(injured ? 'crawl' : clips.idle);
    } else {                                                // no player near -> wander + search
      if (now > s.wNext) {
        const ang = Math.random() * Math.PI * 2, r = Math.random() * c.wanderRadius;
        s.wx = spawn[0] + Math.cos(ang) * r; s.wz = spawn[2] + Math.sin(ang) * r;
        s.wNext = now + 3000 + Math.random() * 4000;
      }
      const wdx = s.wx - s.x, wdz = s.wz - s.z, wd = Math.hypot(wdx, wdz) || 1;
      if (wd > 0.6) {
        g.rotation.y = Math.atan2(wdx, wdz) + c.faceOffset;
        const step = Math.min(SPD * 0.5 * injMul * delta, wd);
        mvx = wdx / wd; mvz = wdz / wd; moving = true;
        s.x += mvx * step; s.z += mvz * step;
        play(injured ? 'crawl' : clips.walk);
      } else play(injured ? 'crawl' : clips.idle);
    }
    // Force the crawl to an ABSOLUTE 2× regardless of this monster's animSpeed (mixer.timeScale). Set
    // every frame because play()'s reset() clears per-action timeScale. CRAWL_RATE=2 → ~2.6s/loop.
    if (injured) { const ca = clip('crawl'); if (ca) ca.timeScale = 2 / (mixer.timeScale || 1); }

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
    // groundAt prefers the BVH mesh surface (city streets, SWW rocks) below the monster's
    // step reach, falling back to terrain — so monsters stand on the city instead of falling
    // through to the flat ground beneath it. Ceiling = feet + a step's worth of headroom.
    let groundY = groundAt(s.x, s.z, feet + 3) ?? feet;
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
          // Stacking on ANOTHER MONSTER: sink the feet by stackSink so they nest INSIDE the
          // body below (terrain/objects are unaffected — only monster boxes get lowered).
          const top = (c.stackSink && monsterBoxes.has(b)) ? b.max.y - c.stackSink * (b.max.y - b.min.y) : b.max.y;
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

    // Spintroll bounce: hitting a collider mid-spiral fires it straight into a zoom, away from
    // the wall — reads as bouncing off the object.
    if (c.spin && s.spiraling && wallTop > -Infinity && moving) {
      const ang = s.spiralHeading + Math.PI;                 // back the way it came
      const speed = SPD * rnd(c.spin.zoomSpeedMul);
      s.zoomVx = Math.sin(ang) * speed; s.zoomVz = Math.cos(ang) * speed;
      s.zoomUntil = now + ((5 + Math.random() * 15) / speed) * 1000;
      s.zoomNext = now + rnd(c.spin.zoomEveryMs);
      s.spiraling = false; s.spiralOn = false;
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
      if (sup.g) { s.tumbling = false; s.bulletTumble = false; g.rotation.x = 0; g.rotation.z = 0; }
      else if (s.bulletTumble) {
        // Clean end-over-end: lock the facing to the flight direction, backflip around local X.
        g.rotation.order = 'YXZ';
        g.rotation.y = s.tumbleYaw; g.rotation.z = 0;
        g.rotation.x -= s.spinX * delta;
      } else { g.rotation.x += s.spinX * delta; g.rotation.z += s.spinZ * delta; }
    }
    // BULLSEYE topple — a feet-pivot spin-fall: a full 360° + the final 90° to
    // land flat (sign −1 = on its back from a front shot, +1 = on its face from
    // behind), HOLD flat for the 2s stun, then stand up (only if still alive — a
    // bullseye KILL lets the normal death animation take over). Drives g.rotation.x
    // like the death topple (pivots at the feet). Takes priority over the lean.
    if (inst.bullseyeAt && !inst.dead && !s.tumbling) {
      if (s.beFor !== inst.bullseyeAt) { s.beFor = inst.bullseyeAt; s.beSlideV = 0; s.beSliding = false; s.beFell = false; s.beFellVY = 0; s.beSettledAt = 0; }
      inst.stunUntil = Math.max(inst.stunUntil, now + 200);   // stay suppressed while toppling/sliding
      const bt = (now - inst.bullseyeAt) / 1000;          // seconds since the bullseye
      const bdx = inst.bullseyeDirX ?? 0, bdz = inst.bullseyeDirZ ?? 1;
      const settle = bullseyeSettle(s, bdx, bdz, H, delta);   // slide/fall-off/rest on terrain
      const fellIn = bt >= 0.333;
      if (!fellIn || settle.moving) {                     // tipping in, sliding down, or falling off
        const e = Math.min(1, bt / 0.333), eo = e * e * (3 - 2 * e);
        bullseyeQuat(g.quaternion, inst.yaw, 0, fellIn ? settle.tip : settle.tip * eo, bdx, bdz);
        s.beSettledAt = 0;
      } else {                                            // at rest on the slope
        if (s.beSettledAt === 0) s.beSettledAt = now;
        const held = (now - s.beSettledAt) / 1000;
        if (held < 2.0) {                                 // HOLD (stunned, parallel to slope)
          bullseyeQuat(g.quaternion, inst.yaw, 0, settle.tip, bdx, bdz);
        } else if (held < 2.4) {                          // STAND back up (un-tip to vertical)
          const e = (held - 2.0) / 0.4, eo = e * e * (3 - 2 * e);
          bullseyeQuat(g.quaternion, inst.yaw, 0, settle.tip * (1 - eo), bdx, bdz);
        } else {
          g.rotation.set(0, inst.yaw, 0);
          inst.bullseyeAt = 0;                            // done — resume normal
        }
      }
      inst.x = s.x; inst.y = s.y; inst.z = s.z; me.x = s.x; me.z = s.z; me.y = s.y;   // hitbox/collider follow the slide (g.position applied below)
    }
    // Headshot recoil: BEND THE UPPER BODY BACK at the waist (spine bone) and
    // snap back over 0.15s. Applied here — AFTER the animation mixer has posed
    // the skeleton this frame — so it overrides the idle/walk/HIT clip instead of
    // being overwritten by it. Amplitude scales with height: 45° at ≤1m falling
    // to 0° at 8m, none ≥8m. The bend axis is the model's WORLD-space horizontal
    // "right", converted into the bone's local space, so it always tilts straight
    // back regardless of the rig's baked rest orientation.
    if (inst.headshotAt && !inst.bullseyeAt && waistBone && !s.tumbling) {
      const ht = (now - inst.headshotAt) / 300;   // 0..1 over 0.3s
      const leanDeg = H >= 8 ? 0 : Math.min(45, Math.max(0, 45 * (8 - H) / 7));
      if (ht < 1 && leanDeg > 0) {
        const angle = (leanDeg * Math.PI / 180) * Math.sin(Math.PI * ht);   // 0 → peak → 0
        g.getWorldQuaternion(_hsGwq);
        _hsRight.set(1, 0, 0).applyQuaternion(_hsGwq).normalize();   // model's right in world (horizontal)
        _hsDelta.setFromAxisAngle(_hsRight, -angle);                 // −angle = lean BACK (matches root −x convention)
        const parent = waistBone.parent;
        if (parent) {
          parent.getWorldQuaternion(_hsPwq);                        // bone parent → world
          // localDelta = parentWorld⁻¹ · Δworld · parentWorld, then premultiply onto the animated pose
          _hsLocal.copy(_hsPwq).invert().multiply(_hsDelta).multiply(_hsPwq);
          waistBone.quaternion.premultiply(_hsLocal);
        }
      } else if (ht >= 1) {
        inst.headshotAt = 0;   // done — mixer restores the bone next frame; re-triggers on the next headshot
      }
    }

    me.y = s.y;
    // Rise-out-of-the-ground intro: spawn sunk by one body-height, emerge over 1s. Render + the
    // combat hitbox (inst.y) rise together, so the emerging part is shootable the whole time.
    let yR = s.y;
    if (cfg.riseFromGround) {
      if (!s.riseStart) s.riseStart = now;
      const t = Math.min(1, (now - s.riseStart) / 1000);
      yR = s.y - (1 - t) * H;
    }
    g.position.set(s.x, yR, s.z);

    // ── Spin-lunge visual (mushroom grunt): override the rendered transform for 0.5s. Full
    //    body revolution over the first 0.25s; lunge to 50% closer and back (sin ease, peak at
    //    0.25s); strike resolved once at the peak → little_slap on a hit, swoosh on a whiff.
    //    Hitbox (inst/box) stays on s.x/s.z so it never shoves other colliders. ──
    if (c.attackStyle === 'spin-lunge' && s.lungeStart) {
      const el = now - s.lungeStart;
      if (el < 500) {
        const off = Math.sin(Math.PI * (el / 500));        // 0→1→0, peak at 0.25s
        g.position.set(s.x + s.lungeOX * off, yR, s.z + s.lungeOZ * off);
        g.rotation.y = s.lungeYaw0 + Math.min(1, el / 250) * Math.PI * 2;  // full spin over 0.25s
        if (!s.lungeStruck && el >= 250) {
          s.lungeStruck = true;
          const px = s.x + s.lungeOX, pz = s.z + s.lungeOZ;  // lunge-peak point
          const sdx = camera.position.x - px, sdz = camera.position.z - pz;
          const sdist = Math.hypot(sdx, sdz) || 1;
          const vOverlap = s.y < camera.position.y && s.y + H > camera.position.y - 1.6;
          if (sdist < (c.attackRange ?? 1.8) && vOverlap && c.meleeContact) {
            dealPlayerDamage(rnd(c.meleeContact.dmg) * (c.damageMul ?? 1), sdx / sdist, 0, sdz / sdist,
                             rnd(c.meleeContact.kb), c.hitSound);
          } else if (c.missSound) {
            emitMonster3D(camera, c.missSound, s.x, s.y + 1, s.z, dist, { baseVolume: 0.6, playbackRate: 0.9 + Math.random() * 0.2 });
          }
        }
      } else s.lungeStart = 0;
    }

    // ── Committed-swipe lunge (demon horde): lunge the body 65% toward the camera + UP toward its
    //    own height (so a small demon's face fills your view), peaking mid-swing, then snap back.
    //    No spin; the hitbox stays on s.x/s.z. ──
    if (c.lungeOnSwing && s.lungeStart) {
      const el = now - s.lungeStart, dur = c.attackClipMs;
      if (el < dur) {
        const off = Math.sin(Math.PI * (el / dur));   // 0→1→0 over the swing
        g.position.set(s.x + s.lungeOX * off, yR + s.lungeOY * off, s.z + s.lungeOZ * off);
      } else s.lungeStart = 0;
    }

    // ── Wide-vomit head-shake: oscillate the facing ±45° at 5 Hz so the 90° spray cone sweeps
    //    across the player (5 back-and-forths in the 1s wide spray). ──
    if (s.wideUntil) {
      if (now < s.wideUntil) {
        const ph = (s.wideUntil - now) / 1000;   // phase (1→0 over the second)
        g.rotation.y = Math.atan2(dx, dz) + c.faceOffset + (45 * Math.PI / 180) * Math.sin(2 * Math.PI * 5 * ph);
      } else s.wideUntil = 0;
    }

    inst.x = s.x; inst.y = yR; inst.z = s.z;   // keep the combat hitbox on the live body
    inst.yaw = g.rotation.y;                     // so attached fire rotates with the body
    doHeadFollow();                              // update the bone-followed head hitbox + wireframe
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
    if (cfg.boss === 'teleporter') {                 // fade the model to its current opacity
      const o = inst.opacity ?? 1, mats = bossMats.current;
      for (let i = 0; i < mats.length; i++) mats[i].opacity = o;
    }
    // Keep the looped spin whir on the troll's body + the listener on the camera.
    if (spinLoopRef.current) {
      camera.getWorldDirection(_aDir);
      updateLoopSound(spinLoopRef.current, s.x, s.y + H * 0.5, s.z, camera.position, _aDir);
    }
    // Walk stomps: looped on the feet, volume-gated so it's only audible while actually moving.
    if (c.walkSound) {
      if (!walkLoopRef.current) walkLoopRef.current = startLoopSound(c.walkSound, { x: s.x, y: s.y, z: s.z, baseVolume: 0 });
      camera.getWorldDirection(_aDir);
      updateLoopSound(walkLoopRef.current, s.x, s.y, s.z, camera.position, _aDir, 1, moving ? 0.55 : 0);
    }
    sdbg.monsters = MONSTERS.size; // SW debug
  });

  const sel = showHitboxes && getEditUrl() === c.url ? getSelectedBox() : null;
  // Gold box size — computed from render values (not the imperatively-set
  // inst.bullseyePct) so it always draws, × the global factor.
  const bpct = effectiveBullseyePct(bullseyePct(Math.max(H, hitbox.body.hx * 2, hitbox.body.hz * 2)));
  return (
   <>
    <group ref={group} scale={scale}>
      <primitive object={cloned} />
      {c.weapon && <HandWeapon root={cloned} w={c.weapon} />}
      {/* !hb debug: the BODY collision box (the exact geometry the bullet test uses).
          Root-anchored, inside the scale-cancelling group so it rotates with facing.
          The HEAD box is a bone-followed sibling below. Edited box = yellow. */}
      {showHitboxes && (
        <group scale={1 / scale}>
          <mesh position={[hitbox.body.lx, hitbox.body.ly, hitbox.body.lz]} renderOrder={999}>
            <boxGeometry args={[hitbox.body.hx * 2, hitbox.body.hy * 2, hitbox.body.hz * 2]} />
            <meshBasicMaterial color={sel === 'body' ? '#ffe000' : '#22ff55'} wireframe transparent opacity={0.55} depthTest={false} />
          </mesh>
          {/* No head bone → static head + bullseye boxes here (sibling versions skipped). */}
          {!headBone && (
            <mesh position={[hitbox.head.lx, hitbox.head.ly, hitbox.head.lz]} renderOrder={1000}>
              <boxGeometry args={[hitbox.head.hx * 2, hitbox.head.hy * 2, hitbox.head.hz * 2]} />
              <meshBasicMaterial color={sel === 'head' ? '#ffe000' : '#ff2233'} wireframe transparent opacity={0.85} depthTest={false} />
            </mesh>
          )}
          {!headBone && bpct > 0 && (
            <mesh position={[hitbox.head.lx, hitbox.head.ly, hitbox.head.lz]} renderOrder={1001}>
              <boxGeometry args={[hitbox.head.hx * 2 * bpct, hitbox.head.hy * 2 * bpct, hitbox.head.hz * 2 * bpct]} />
              <meshBasicMaterial color="#ffd000" wireframe transparent opacity={0.95} depthTest={false} />
            </mesh>
          )}
        </group>
      )}
      {/* Body fire: one procedural flame shell per spec, wrapping the body. The inner group
          cancels the model scale so flames are sized in world metres; being a child means they
          follow the body automatically as it moves/teleports/spins. */}
      <group ref={flamesRef}>
        {cfg.bodyFlames?.map((f, i) => (
          <group key={i} scale={1 / scale}>
            <DarkLordFlame height={H * f.heightMul} radius={inst.radius * f.radiusMul}
                           colorHot={f.colorHot} colorCool={f.colorCool} />
          </group>
        ))}
      </group>
    </group>
    {/* HEAD hitbox wireframe — world-space sibling, positioned every frame by
        doHeadFollow so it rides the head bone (tracks bend/bob/lunge). */}
    {showHitboxes && headBone && (
      <mesh ref={headWireRef} renderOrder={1000}>
        <boxGeometry args={[hitbox.head.hx * 2, hitbox.head.hy * 2, hitbox.head.hz * 2]} />
        <meshBasicMaterial color={sel === 'head' ? '#ffe000' : '#ff2233'} wireframe transparent opacity={0.85} depthTest={false} />
      </mesh>
    )}
    {showHitboxes && headBone && bpct > 0 && (
      <mesh ref={bullsWireRef} renderOrder={1001}>
        <boxGeometry args={[hitbox.head.hx * 2 * bpct, hitbox.head.hy * 2 * bpct, hitbox.head.hz * 2 * bpct]} />
        <meshBasicMaterial color="#ffd000" wireframe transparent opacity={0.95} depthTest={false} />
      </mesh>
    )}
   </>
  );
}
