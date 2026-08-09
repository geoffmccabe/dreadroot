// KaijuArenaScene — draws the Everest fight: the opposing Kaiju, and every projectile in flight.
//
// The player's own Kaiju is still drawn by GlobeKaiju/KaijuLabController, which is untouched.
// This module only adds the opponents and the ordnance, and drives the simulation clock.
//
// WHY A SEPARATE AVATAR COMPONENT. GlobeKaiju's avatar derives its transform from the CAMERA (it
// is the player's third-person stand-in). An AI Kaiju has its own simulated body, so it needs a
// renderer that reads a KaijuBody instead. Rather than thread a mode flag through the working
// player renderer — which is shared with the other Claude on this branch — this is its own module.

import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { resolveGait, stripRootMotion } from './kaijuClips';

/** Model-local X, the axis a body topples about when it falls forward. */
const _xAxis = new THREE.Vector3(1, 0, 0);
import { useFrame, useThree } from '@react-three/fiber';
import { useGLTF, useAnimations } from '@react-three/drei';
import { SkeletonUtils } from 'three-stdlib';
import * as THREE from 'three';
import { globeLook } from '@/features/look/globeLookStore';
import { CFG, MONSTER_CATALOG } from '../siegeMonsterCatalog';
import { APP_VERSION } from '@/version';
import { walkSpeed, runSpeed, type KaijuBody } from './kaijuBody';
import { METRES_PER_UNIT } from './cubeSphere';
import {
  getAgents, stepArena, arenaStarted, playerAttack, subscribeArena, arenaVersion,
  ARENA_HEIGHT, swingSeconds, type Agent,
} from './kaijuArena';
import { getProjectiles } from './kaijuWeapons';
import { fireSpriteSheet, fireMaterial } from './fireSprite';
import { footOffset, footOffsetRaw } from './modelFeet';
import { updateKaijuFootsteps, stopKaijuFootsteps, stopAllKaijuFootsteps, scream } from './kaijuAudio';
import { registerRig, unregisterRig, updateRigCapsules, rigLimbCount } from './kaijuColliders';
import { consumeStrikes, applySkeletonImpact, bodyLean } from './kaijuImpact';
import { findLegRig, plantFeet, clearFootIK, type LegRig } from './kaijuFootIK';
import { PLANET_RADIUS } from './cubeSphere';
import { sampleGlobeSurface, sampleGlobeNormal } from './globeGround';
import { registerHitMesh, unregisterHitMesh } from './kaijuMeshHit';
import { prepareFlash, applyFlash, flashIntensity, releaseFlash } from './kaijuFlash';

/** Clip preferences per gait, matching GlobeKaiju so both look the same. */
// Clip choice lives in kaijuClips.ts now, shared with GlobeKaiju. The list that used to be here
// demanded an EXACT name match and fell back to names[0] — which on the Red Demon is the Mixamo
// container track, and is why its attack read as fast twitching rather than a swipe. See the note
// in that file; it is measured against the real clip lists in check-kaiju-clips.

/**
 * Playback rate for a Kaiju's clips. TWO factors, and this had NEITHER of them right.
 *
 * 1. SIZE. Under dynamic similarity a creature scaled up by S moves its limbs at 1/sqrt(S). A
 *    300 m Kaiju built from a 4 m Red Demon is 75x its natural size, so its clips must play at
 *    about 0.12x. This applied no size factor at all — which is why Geoff's opponent was
 *    "running super fast": the AI Kaiju were animating roughly fifteen times too quickly while
 *    the player's own Kaiju (which does apply it) looked correct.
 *
 * 2. GAIT. The stride correction has to be measured against the speed the CURRENT CLIP depicts.
 *    Dividing by walk speed while the run clip is playing pushed it to the 1.8x clamp on top of
 *    everything else. Same bug already fixed in GlobeKaiju; it lived on here.
 *
 * `naturalMetres` is the creature's real-world height from the catalog, not the model's units.
 */
function animRate(b: KaijuBody, h: number, naturalMetres: number, running: boolean): number {
  const sizeRatio = (h * METRES_PER_UNIT) / Math.max(0.01, naturalMetres);
  const sizeMul = 1 / Math.sqrt(sizeRatio);
  const reference = running ? runSpeed(h) : walkSpeed(h);
  const stride = Math.min(1.6, Math.max(0.35, b.speed / Math.max(1e-4, reference)));
  return sizeMul * stride;
}


function AgentAvatar({ agent }: { agent: Agent }) {
  const camera = useThree((s) => s.camera);
  const look = useRef(new THREE.Vector3());
  const cfg = CFG[agent.monsterType as keyof typeof CFG];
  const url = cfg?.url;
  const modelHeight = cfg?.modelHeight ?? 2;
  // The creature's REAL-WORLD height, which is what the size slowdown is measured against — a Red
  // Demon is naturally 4 m, a Fort Golem 12 m, so blowing both up to 300 m slows them by very
  // different amounts.
  const naturalMetres = MONSTER_CATALOG.find((c) => c.id === agent.monsterType)?.baseHeight ?? 2;
  const group = useRef<THREE.Group>(null);
  const { scene, animations } = useGLTF(`${url}?v=${APP_VERSION}`);

  // SkeletonUtils.clone, not scene.clone() — see the long note in GlobeKaiju.tsx. A plain clone
  // leaves each SkinnedMesh bound to the original skeleton and renders nothing at all.
  const model = useMemo(() => {
    const c = SkeletonUtils.clone(scene) as THREE.Group;
    // SHADOWS, from the Lightning Panel. Off by default — this is why the Kaiju read as cartoons:
    // every mesh had both flags disabled, so a 300 m creature stood in full sun with nothing beneath
    // it. Receiving matters nearly as much as casting: it is what puts an arm's shadow across the
    // chest and gives the body its own form.
    const wantShadows = globeLook().enabled && globeLook().shadowsOn;
    c.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) { o.castShadow = wantShadows; o.receiveShadow = wantShadows; }
    });
    prepareFlash(c);
    return c;
  }, [scene]);
  useEffect(() => () => releaseFlash(model), [model]);

  // STRIP ROOT MOTION FROM THE DEATH CLIP before the mixer ever sees it. Left in, it drags the
  // corpse hundreds of metres and then clamps there — the "floating in the air" Geoff reported.
  const deathReady = useMemo(() => {
    const clips = animations.map((a) => ({ name: a.name, duration: a.duration }));
    const deadName = resolveGait(clips, 'dead');
    for (const a of animations) if (a.name === deadName) stripRootMotion(a);
    return animations;
  }, [animations]);
  const { actions, names, mixer } = useAnimations(deathReady, model);
  const gait = useRef<string>('idle');
  const current = useRef<THREE.AnimationAction | null>(null);

  // Clip list for THIS model, with real durations, so the resolver can reject the zero-length and
  // container tracks rather than trusting a name.
  const clipInfo = useMemo(
    () => animations.map((a) => ({ name: a.name, duration: a.duration })),
    [animations],
  );

  const play = (g: string) => {
    if (gait.current === g && current.current) return;
    gait.current = g;
    const name = resolveGait(clipInfo, g);
    // No sensible clip: keep whatever is playing. Switching to an arbitrary track is what produced
    // the twitching, so doing nothing is strictly better.
    if (!name) return;
    const next = actions[name];
    if (!next || next === current.current) return;
    current.current?.fadeOut(0.25);
    next.reset().fadeIn(0.25).play();
    if (g === 'dead' || g === 'attack') { next.setLoop(THREE.LoopOnce, 1); next.clampWhenFinished = true; }
    else next.setLoop(THREE.LoopRepeat, Infinity);
    current.current = next;
  };

  useEffect(() => { if (names.length) play('idle'); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [names.length]);

  const right = useRef(new THREE.Vector3());
  const trueF = useRef(new THREE.Vector3());
  const basis = useRef(new THREE.Matrix4());
  const footLift = useRef(0);
  const _normal = useRef(new THREE.Vector3());
  const _lean = useRef(new THREE.Vector3());
  const _leanQ = useRef(new THREE.Quaternion());
  /** Every bone in this Kaiju, gathered once — the impact springs live on these. */
  const impactBones = useRef<THREE.Object3D[]>([]);
  /** Legs, for planting the feet on ground the animation knows nothing about. */
  const legs = useRef<LegRig | null>(null);
  const _knee = useRef(new THREE.Vector3());
  const _tip = useRef(new THREE.Quaternion());
  // THE LIMB COLLIDERS, FINALLY CONNECTED.
  //
  // kaijuColliders has built bone-following capsules for a head, two arms and two legs since the day
  // it was written, and NOTHING HAS EVER CALLED IT. registerRig and updateRigCapsules had no callers
  // anywhere in the repo, so limbCapsules() has always returned an empty list, melee has always
  // silently degraded to the torso, and the file's own comment about "real limbs, read from the
  // animated bones each frame" described something that did not happen. Found while looking for
  // somewhere to put bullet impacts.
  useEffect(() => {
    const bs: THREE.Object3D[] = [];
    model.traverse((o) => { if ((o as THREE.Bone).isBone) bs.push(o); });
    impactBones.current = bs;
    legs.current = findLegRig(model);
    clearFootIK(agent.id);
    registerRig(agent.id, model);
    // ...and the model ITSELF as the bullet collider. Triangles, in the pose being drawn.
    registerHitMesh(agent.id, model);
    console.log(`[kaiju] ${agent.name} rig: ${rigLimbCount(agent.id)} limb capsules, mesh collider on`);
    return () => { unregisterRig(agent.id); unregisterHitMesh(agent.id); };
  }, [model, agent.id, agent.name]);

  useEffect(() => {
    const scale = ARENA_HEIGHT / Math.max(0.01, modelHeight);
    footLift.current = footOffset(model) * scale;
    // Print the raw measurement. Two attempts at this have now gone wrong in opposite directions
    // because the model's actual layout was assumed rather than known.
    console.log(`[kaiju] ${agent.name} model foot offset: raw ${footOffsetRaw(model).toFixed(3)}, `
      + `applied ${footLift.current.toFixed(3)} units (${(footLift.current * 100).toFixed(0)} m)`);
  }, [model, modelHeight, agent.name]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const g = group.current;
    if (!g) return;
    const b = agent.body;

    // Lift by however far the model's origin sits above its own feet, so it stands ON the ground
    // rather than half inside it.
    g.position.copy(b.dir).multiplyScalar(b.radius + footLift.current);
    // FACING. The model's local +Z is its front — the same convention MonsterEnemy uses when it
    // does `rotation.y = atan2(dx, dz)`. So the basis must map local +Z to `forward`, local +Y to
    // the local up, and local +X to up x forward.
    //
    // This previously built makeBasis(right, up, -forward), which is a valid right-handed frame
    // but is rotated 180 degrees about up — so the Kaiju faced and animated exactly backwards
    // while walking forwards. Verified numerically rather than by eye.
    right.current.crossVectors(b.dir, b.forward).normalize();
    trueF.current.copy(b.forward).normalize();
    basis.current.makeBasis(right.current, b.dir, trueF.current);
    g.quaternion.setFromRotationMatrix(basis.current);

    // THE FLINCH, before anything reads the pose. A blow bends the skeleton away from where it
    // landed and springs it back; the walk keeps running underneath. Applied here because the mixer
    // has just overwritten every bone from the clip, and this multiplies on top of that — do it
    // earlier and the clip erases it, later and the colliders read a pose the screen never showed.
    if (impactBones.current.length) {
      consumeStrikes(agent.id, impactBones.current, ARENA_HEIGHT);
      applySkeletonImpact(agent.id, impactBones.current, dt, ARENA_HEIGHT, naturalMetres);
      const lean = bodyLean(agent.id, _lean.current);
      const a = lean.length();
      if (a > 1e-5) g.quaternion.multiply(_leanQ.current.setFromAxisAngle(lean.divideScalar(a), a));
    }

    // FEET ON THE ACTUAL GROUND. The clip was authored on a flat floor, so on a hillside one foot
    // hangs in the air and the other is buried. Runs after the flinch — it corrects whatever pose the
    // animation and the hit reaction between them produced — and before anything reads bone
    // positions, or the colliders describe a pose the screen never showed.
    if (legs.current?.left || legs.current?.right) {
      plantFeet(
        agent.id, legs.current, g, b.radius,
        (d) => {
          const m = sampleGlobeSurface(d.x, d.y, d.z);
          return m == null ? null : PLANET_RADIUS + m / METRES_PER_UNIT;
        },
        sampleGlobeNormal, dt, 1, _knee.current.copy(b.forward),
      );
    }

    // Re-read the limb capsules from the pose the mixer just produced. It has to happen HERE, after
    // the group is placed and before any of the early returns below, or a Kaiju that is swinging or
    // dead would freeze its colliders wherever they were when it started — and the arm you are
    // watching swing is exactly the arm a bullet should be able to hit.
    updateRigCapsules(agent.id, ARENA_HEIGHT);

    if (!agent.alive) {
      play('dead');
      mixer.timeScale = 0.4;
      stopKaijuFootsteps(agent.id);

      // RAGDOLL-ISH: fall, then lie along the slope.
      //
      // Geoff: "when the kaijus die, their bodies float up in the air... can you have them ragdoll
      // when they die and fall on the terrain, such that if the terrain is at an angle, they lay at
      // an angle like a ragdoll should?"
      //
      // Two things were lifting them. The body stopped being simulated the moment it died, so
      // gravity never acted again (fixed in kaijuArena — a corpse still falls). And the death CLIP
      // carries baked root motion: the Red Demon's "Two Handed Sword Death" translates its hips 75
      // units, which at this scale is hundreds of metres of drift, upward included. That track is
      // stripped when the clip is prepared, below.
      //
      // A true joint-by-joint ragdoll needs a physics solver this project does not have. What
      // actually reads on screen at 300 m is the BODY going down and lying at the angle of the
      // ground, so that is what is simulated: the model topples about its own right axis onto the
      // terrain NORMAL, easing over a couple of seconds, and settles flat against the hillside.
      const t = agent.deadFor ?? 0;
      const TOPPLE_SECONDS = 2.4;
      const fall = Math.min(1, t / TOPPLE_SECONDS);
      // Ease out, so it goes over slowly, accelerates, and settles rather than snapping flat.
      const ease = 1 - (1 - fall) * (1 - fall);
      const nrm = sampleGlobeNormal(b.dir, _normal.current);
      // Build the upright frame against the SLOPE rather than the radial direction, then tip it.
      const fwdFlat = trueF.current.copy(b.forward)
        .addScaledVector(nrm, -b.forward.dot(nrm));
      if (fwdFlat.lengthSq() < 1e-9) fwdFlat.copy(b.dir);
      fwdFlat.normalize();
      right.current.crossVectors(nrm, fwdFlat).normalize();
      basis.current.makeBasis(right.current, nrm, fwdFlat);
      g.quaternion.setFromRotationMatrix(basis.current);
      // Face-plant forward, 90 degrees about its own right axis.
      g.quaternion.multiply(
        _tip.current.setFromAxisAngle(_xAxis, -Math.PI * 0.5 * ease),
      );
      // Once down, the body's own centre is roughly half a width off the ground, so drop the model
      // by that much: a creature lying on its side does not float at standing height.
      g.position.copy(b.dir).multiplyScalar(b.radius + footLift.current);
      return;
    }

    // THE SWIPE. While a swing is in flight the attack clip owns the body, and its playback is
    // stretched to the swing's real duration so the arm arrives exactly when the blow lands rather
    // than finishing early and hitting nothing. The clip is played once, not looped.
    if (agent.swingTimer > 0) {
      play('attack');
      const total = Math.max(0.05, swingSeconds(agent));
      const clipLen = current.current?.getClip().duration ?? total;
      mixer.timeScale = clipLen / total;
      camera.getWorldDirection(look.current);
      updateKaijuFootsteps(agent.id, b, ARENA_HEIGHT, camera.position, look.current, false);
      applyFlash(model, flashIntensity(agent.ackFlash), agent.burning);
      return;
    }

    const wS = walkSpeed(ARENA_HEIGHT), rS = runSpeed(ARENA_HEIGHT);
    const running = b.speed > (wS + rS) * 0.5;
    play(running ? 'run' : b.speed > wS * 0.25 ? 'walk' : 'idle');
    mixer.timeScale = animRate(b, ARENA_HEIGHT, naturalMetres, running);

    // Footsteps, positioned in the world — so an enemy Kaiju crossing behind you is something you
    // hear before you see, which at this scale is most of the drama.
    camera.getWorldDirection(look.current);

    // It cries out when set alight. The flag is set by the simulation and cleared here, so the
    // sound fires exactly once however many burning particles landed that frame.
    if (agent.screamed) {
      agent.screamed = false;
      scream(g.position, camera.position, look.current);
    }
    // Hand the walk clip's own phase over, so the stomp lands with the foot instead of being
    // paced by a separate distance counter that drifts against the animation.
    const act = current.current;
    const clipLen = act?.getClip().duration ?? 0;
    const phase = act && clipLen > 0 && (gait.current === 'walk' || gait.current === 'run')
      ? (act.time % clipLen) / clipLen
      : undefined;
    updateKaijuFootsteps(agent.id, b, ARENA_HEIGHT, camera.position, look.current, true, dt, phase);
    applyFlash(model, flashIntensity(agent.ackFlash), agent.burning);
  });

  useEffect(() => () => stopKaijuFootsteps(agent.id), [agent.id]);

  if (!url) return null;
  const scale = ARENA_HEIGHT / Math.max(0.01, modelHeight);
  return (
    <group ref={group}>
      <primitive object={model} scale={scale} />
    </group>
  );
}

/**
 * Every projectile, drawn as fire rather than as a pile of circles.
 *
 * Geoff: "they still look pathetically bad... not just a bunch of yellow circles."
 *
 * The old version was instanced SPHERES with a flat additive colour, and a sphere drawn additively
 * is a disc — hard circular edge, no internal detail. A thousand of them is a thousand visible
 * circles however many more you add. This is camera-facing quads carrying a flipbook of
 * noise-generated flame masks (see fireSprite.ts): ragged silhouettes, lit interiors, sixteen
 * different shapes, each spinning at its own rate.
 *
 * TWO PASSES, and both are needed. Hot fire is ADDITIVE, which is what makes overlapping flames
 * build into a bright core the way real fire does. Smoke cannot be: additive black is invisible, so
 * the cooling end of every particle is drawn again with normal blending. Two draw calls for the
 * whole battlefield either way.
 */
function Projectiles() {
  // 3000: the flame alone keeps about 1500 alive and a grenade throws 420 debris particles.
  const MAX = 3000;
  const sheet = useMemo(() => fireSpriteSheet(), []);
  const hotMat = useMemo(() => fireMaterial(sheet, false), [sheet]);
  const smokeMat = useMemo(() => fireMaterial(sheet, true), [sheet]);
  useEffect(() => () => { sheet.dispose(); hotMat.dispose(); smokeMat.dispose(); }, [sheet, hotMat, smokeMat]);

  const iPos = useMemo(() => new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3), []);
  const iData = useMemo(() => new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4), []);

  /**
   * ONE geometry, shared by both passes.
   *
   * A plain quad with the per-particle attributes bolted on. InstancedMesh is not used because it
   * insists on an instanceMatrix this shader has no use for — the billboarding happens in the
   * vertex shader, so uploading 3000 unused 4x4 matrices every frame would be the most expensive
   * thing in the effect.
   */
  const geom = useMemo(() => {
    const quad = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = quad.index;
    g.setAttribute('position', quad.attributes.position);
    g.setAttribute('uv', quad.attributes.uv);
    g.setAttribute('iPos', iPos);
    g.setAttribute('iData', iData);
    g.instanceCount = 0;
    // Never culled: the bounding sphere is computed from an empty buffer, so left on the whole
    // effect vanishes the moment the camera is not looking at the planet's centre.
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
    quad.dispose();
    return g;
  }, [iPos, iData]);
  useEffect(() => () => geom.dispose(), [geom]);

  useFrame(() => {
    const list = getProjectiles();
    const n = Math.min(list.length, MAX);
    const pos = iPos.array as Float32Array;
    const dat = iData.array as Float32Array;
    for (let i = 0; i < n; i++) {
      const p = list[i];
      const o3 = i * 3, o4 = i * 4;
      pos[o3] = p.pos.x; pos[o3 + 1] = p.pos.y; pos[o3 + 2] = p.pos.z;
      // age 0 (just fired) to 1 (about to die).
      dat[o4] = 1 - Math.max(0, Math.min(1, p.life / Math.max(1e-4, p.maxLife)));
      dat[o4 + 1] = p.size;
      dat[o4 + 2] = p.seed;
      dat[o4 + 3] = p.visual === 'blast' ? 1 : 0;
    }
    geom.instanceCount = n;
    iPos.needsUpdate = true;
    iData.needsUpdate = true;
  });

  return (
    <>
      {/* Hot fire first, then the smoke over it. */}
      <mesh geometry={geom} material={hotMat} frustumCulled={false} renderOrder={8} />
      <mesh geometry={geom} material={smokeMat} frustumCulled={false} renderOrder={9} />
    </>
  );
}

/**
 * Mount inside the globe scene. Steps the simulation and draws the opponents.
 *
 * `playerControlled` tells the arena to leave agent 0's body alone, because the walk controller
 * is driving it. With it false the player's Kaiju fights itself, which is how the headless check
 * runs a full three-way battle.
 */
export function KaijuArenaScene({ playerControlled }: { playerControlled: boolean }) {
  // SUBSCRIBE, do not just read.
  //
  // Reading the arena state during render meant this component mounted with no fight running,
  // returned null, and was never re-rendered when one started — so the opponents could never
  // appear, however correct the simulation underneath was. That is the whole of the "I only see
  // my own Kaiju" symptom. The version counter changes on every start, reset and stop, which is
  // what brings React back to build the models.
  useSyncExternalStore(subscribeArena, arenaVersion, arenaVersion);
  const agents = getAgents();
  const firing = useRef(false);
  const aimDir = useRef(new THREE.Vector3());
  const camera = useThree((s) => s.camera);

  // Left mouse held = fire your weapon (the flamethrower, which is continuous, so holding is the
  // natural way to use it). R = swing. Both go through the same cooldowns and hit tests the AI
  // uses, so nothing about the player's Kaiju is privileged.
  useEffect(() => {
    const down = (e: MouseEvent) => { if (e.button === 0) firing.current = true; };
    const up = (e: MouseEvent) => { if (e.button === 0) firing.current = false; };
    const key = (e: KeyboardEvent) => {
      if (e.code === 'KeyR' && !e.repeat && arenaStarted()) playerAttack('melee');
    };
    window.addEventListener('mousedown', down);
    window.addEventListener('mouseup', up);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('mousedown', down);
      window.removeEventListener('mouseup', up);
      window.removeEventListener('keydown', key);
    };
  }, []);

  useEffect(() => () => stopAllKaijuFootsteps(), []);

  useFrame((_, rawDt) => {
    if (!arenaStarted()) return;
    // Clamp: a long frame (tab restored, a stall) must not teleport everybody through each other.
    if (firing.current) {
      // The crosshair direction, flattened onto the ground plane the Kaiju stands on.
      camera.getWorldDirection(aimDir.current);
      playerAttack('weapon', aimDir.current, Math.min(rawDt, 0.05));
    }
    stepArena(Math.min(rawDt, 0.05), playerControlled);
  });

  if (!arenaStarted()) return null;
  return (
    <>
      {agents.filter((a) => !a.isPlayer).map((a) => <AgentAvatar key={a.id} agent={a} />)}
      <Projectiles />
    </>
  );
}
