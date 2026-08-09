// GlobeKaiju — your Kaiju, seen in third person, on the Mini Earth.
//
// Replaces the old KaijuDisplay, which parked one monster at a fixed latitude/longitude in the
// Himalaya. On a planet 400,750 units around, a 3-unit creature at a fixed point is effectively
// impossible to find, which is why none was ever visible.
//
// HOW IT WORKS, AND WHAT IT IS NOT
// --------------------------------
// The Kaiju is an AVATAR driven by the camera, not an independently simulated character. It is
// placed a fixed distance ahead of the camera along the local surface, and grounded on the
// terrain there. So flying the camera flies the Kaiju, and the existing controls, the planet-
// centric movement basis and the altitude-scaled speed all work on it for free, with nothing
// added to the shared controller.
//
// That is deliberate for this step. Giving the Kaiju its own physics, pathfinding and collision
// is P2 (sphere locomotion) and wants its own controller; doing it here would mean a second
// mover fighting the first. What this DOES deliver is the thing worth seeing now: a correctly
// scaled Kaiju in front of you that glides as you descend, lands, and walks as you move.
//
// STATE MACHINE, driven purely by altitude above the terrain and horizontal speed:
//   GLIDE  high above ground        -> 'flex' (limbs outward), body pitched into the dive
//   LAND   passing through the      -> 'stand_to_crouch', a landing crouch
//          landing band
//   WALK   grounded and moving      -> 'walk' or 'run' by speed
//   IDLE   grounded and still       -> 'breathidle'

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useGLTF, useAnimations } from '@react-three/drei';
import { SkeletonUtils } from 'three-stdlib';
import * as THREE from 'three';
import { useGlobeLook } from '@/features/look/globeLookStore';
import { CFG } from '../siegeMonsterCatalog';
import { APP_VERSION } from '@/version';
import { PLANET_RADIUS, METRES_PER_UNIT } from './cubeSphere';
import { sampleGlobeSurface } from './globeGround';
import { animSpeedMul, type KaijuLabState } from './kaijuLabState';
import { kaijuDiag } from './kaijuDiag';
import { body as kaijuBodyState, facingVector, walkSpeed, runSpeed } from './kaijuBody';
import { isKaijuWalkActive } from './KaijuWalkController';
import { footOffset, footOffsetRaw } from './modelFeet';
import { resolveGait, stripRootMotion } from './kaijuClips';
import { updateKaijuFootsteps, stopKaijuFootsteps } from './kaijuAudio';
import { prepareFlash, applyFlash, flashIntensity, releaseFlash } from './kaijuFlash';
import { ackFlashRemaining, playerBurning, playerAgent } from './kaijuArena';
import { sampleGlobeNormal } from './globeGround';
import { registerRig, unregisterRig, updateRigCapsules, clearRigCapsules, setPlayerVisual } from './kaijuColliders';
import { registerHitMesh, unregisterHitMesh, hasHitMesh } from './kaijuMeshHit';
import { consumeStrikes, applySkeletonImpact, bodyLean } from './kaijuImpact';
import { findLegRig, plantFeet, clearFootIK, type LegRig } from './kaijuFootIK';
import { sampleGlobeNormal as groundNormal } from './globeGround';


/** Model-local X, the axis a body topples about when it falls forward. */
const DEATH_AXIS = new THREE.Vector3(1, 0, 0);

/** How far ahead of the camera the Kaiju stands, in multiples of its own height. */
const AHEAD = 2.6;
/** How far below the camera line it sits, in multiples of its height. */
const BELOW = 0.55;
/** Above this altitude (in Kaiju heights) it is gliding. */
const GLIDE_ALT = 3.5;
/** Below this altitude it is considered grounded. */
const GROUND_ALT = 0.35;
/** Horizontal speed (units/sec) above which walking becomes running. */
const RUN_SPEED = 12;
/** Speed below which it is standing still. */
const STILL_SPEED = 0.6;

type Gait = 'glide' | 'land' | 'walk' | 'run' | 'idle' | 'swim' | 'dead';

// Clip choice is shared with the arena renderer (kaijuClips.ts). This file used to carry its own
// exact-match table and its own names[0] fallback — two copies of the same brittle logic, which is
// how one of them could be wrong about the Red Demon for as long as it was.

/** Ground radius under the body, tolerant of tiles that have not streamed in yet. */
function groundRadiusCached(b: typeof kaijuBodyState): number | null {
  const m = sampleGlobeSurface(b.dir.x, b.dir.y, b.dir.z);
  return m == null ? null : PLANET_RADIUS + m / METRES_PER_UNIT;
}

export function GlobeKaiju({ state }: { state: KaijuLabState }) {
  const cfg = CFG[state.type];
  if (!cfg?.url) return null;
  return <KaijuAvatar url={cfg.url} state={state} modelHeight={cfg.modelHeight ?? 2} />;
}


function KaijuAvatar({ url, state, modelHeight }: { url: string; state: KaijuLabState; modelHeight: number }) {
  const look = useGlobeLook();
  const camera = useThree((s) => s.camera);
  const group = useRef<THREE.Group>(null);
  const { scene, animations } = useGLTF(`${url}?v=${APP_VERSION}`);

  // MUST be SkeletonUtils.clone, not scene.clone().
  //
  // These are SKINNED models. A plain clone copies the meshes but leaves each SkinnedMesh bound to
  // the ORIGINAL skeleton, which is not in the copy's own hierarchy, so the result renders
  // collapsed or not at all. That is why the Kaiju was never visible: it was being created every
  // frame and drawing nothing. MonsterEnemy already does this correctly and says so in a comment;
  // I should have followed the working renderer instead of writing a fresh one.
  const model = useMemo(() => {
    const c = SkeletonUtils.clone(scene) as THREE.Group;
    // SHADOWS, from the Lightning Panel. Off by default — this is why the Kaiju read as cartoons:
    // every mesh had both flags disabled, so a 300 m creature stood in full sun with nothing beneath
    // it. Receiving matters nearly as much as casting: it is what puts an arm's shadow across the
    // chest and gives the body its own form.
    // Flags are owned by the effect below, which reacts to the panel. Setting them here would only
    // capture whatever the switch happened to say at load time, which is what was broken.
    // Own copies of the materials, so tinting THIS Kaiju does not tint every Kaiju sharing the
    // model. Two of the four in the demo fight would otherwise flash together.
    prepareFlash(c);
    return c;
  }, [scene]);
  useEffect(() => () => releaseFlash(model), [model]);

  /**
   * SHADOW FLAGS, REACTIVELY.
   *
   * Geoff: "Shadows doesn't work at all... I see no shadows with any settings."
   *
   * They were set inside the clone's useMemo, which runs ONCE when the model loads. So the flags
   * were whatever the panel said at that instant — and since the panel defaults to off, and the
   * model loads long before anyone opens it, they were always false. Toggling the switch changed a
   * value nothing ever read again.
   */
  const wantShadows = look.enabled && look.shadowsOn;
  useEffect(() => {
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) { m.castShadow = wantShadows; m.receiveShadow = wantShadows; }
    });
  }, [model, wantShadows]);


  // STRIP ROOT MOTION FROM THE DEATH CLIP before the mixer ever sees it. Left in, it drags the
  // corpse hundreds of metres and then clamps there. Same treatment the AI Kaiju already get.
  const deathReady = useMemo(() => {
    const clips = animations.map((a) => ({ name: a.name, duration: a.duration }));
    const deadName = resolveGait(clips, 'dead');
    for (const a of animations) if (a.name === deadName) stripRootMotion(a);
    return animations;
  }, [animations]);

  // Bind the mixer to the CLONE, so the clips drive the clone's own bones.
  const { actions, names, mixer } = useAnimations(deathReady, model);
  useEffect(() => {
    kaijuDiag.loaded = true;
    return () => { kaijuDiag.loaded = false; stopKaijuFootsteps('player'); };
  }, []);

  // YOUR OWN limb colliders, under the ARENA'S id for you rather than a made-up one — a bullet test
  // looks up capsules by agent id, so registering as 'player' would mean the crowd could hit every
  // Kaiju except the one you are standing in.
  //
  // Checked per frame rather than once, because this component outlives the fight: it mounts before
  // any arena exists and stays mounted across every jump to a new battle site, each of which builds
  // a fresh set of agents. A one-shot registration at mount would bind to whatever the id was then,
  // which is usually nothing at all.
  const rigId = useRef<string | null>(null);
  const _lean = useRef(new THREE.Vector3());
  const _leanQ = useRef(new THREE.Quaternion());
  /** Every bone, gathered when the model changes — the impact springs live on these. */
  const impactBones = useRef<THREE.Object3D[]>([]);
  const legs = useRef<LegRig | null>(null);
  const _knee = useRef(new THREE.Vector3());
  useEffect(() => {
    const bs: THREE.Object3D[] = [];
    model.traverse((o) => { if ((o as THREE.Bone).isBone) bs.push(o); });
    impactBones.current = bs;
    legs.current = findLegRig(model);
    clearFootIK('player');
  }, [model]);
  const deathNrm = useRef(new THREE.Vector3());
  const deathFwd = useRef(new THREE.Vector3());
  const deathSide = useRef(new THREE.Vector3());
  const deathTip = useRef(new THREE.Quaternion());
  const rigBroken = useRef(false);
  const ensureRig = () => {
    const want = playerAgent()?.id ?? null;
    // Re-register if the mesh was dropped (fly mode drops it, because there the model is carried by
    // the camera and its triangles are nowhere near the body). Checking rather than assuming, or
    // coming back from fly mode would leave you permanently bullet-proof.
    if (want === rigId.current) {
      if (want && !hasHitMesh(want)) registerHitMesh(want, model);
      return;
    }
    if (rigId.current) { unregisterRig(rigId.current); unregisterHitMesh(rigId.current); }
    rigId.current = want;
    if (want) { registerRig(want, model); registerHitMesh(want, model); }
  };
  useEffect(() => () => {
    if (rigId.current) { unregisterRig(rigId.current); unregisterHitMesh(rigId.current); rigId.current = null; }
  }, []);
  const gait = useRef<Gait>('glide');
  const current = useRef<THREE.AnimationAction | null>(null);
  const landTimer = useRef(0);
  const prevPos = useRef(new THREE.Vector3());
  const havePrev = useRef(false);

  // Scratch, reused every frame.
  const up = useRef(new THREE.Vector3());
  const view = useRef(new THREE.Vector3());
  const camUp = useRef(new THREE.Vector3());
  const fwd = useRef(new THREE.Vector3());
  const target = useRef(new THREE.Vector3());
  const quat = useRef(new THREE.Quaternion());
  const basis = useRef(new THREE.Matrix4());
  const footLift = useRef(0);
  useEffect(() => {
    footLift.current = footOffset(model) * (state.height / Math.max(0.01, modelHeight));
    console.log(`[kaiju] player model foot offset: raw ${footOffsetRaw(model).toFixed(3)}, `
      + `applied ${footLift.current.toFixed(3)} units (${(footLift.current * 100).toFixed(0)} m)`);
  }, [model, modelHeight, state.height]);

  // Clip list for THIS model with real durations, so zero-length and container tracks are rejected.
  const clipInfo = useMemo(
    () => animations.map((a) => ({ name: a.name, duration: a.duration })),
    [animations],
  );
  const clipFor = (g: Gait): string | null => resolveGait(clipInfo, g);

  const play = (g: Gait) => {
    if (gait.current === g && current.current) return;
    gait.current = g;
    const name = clipFor(g);
    if (!name) return;
    const next = actions[name];
    if (!next || next === current.current) return;
    current.current?.fadeOut(0.25);
    next.reset().fadeIn(0.25).play();
    if (g === 'land' || g === 'dead') { next.setLoop(THREE.LoopOnce, 1); next.clampWhenFinished = true; }
    else next.setLoop(THREE.LoopRepeat, Infinity);
    current.current = next;
  };

  useEffect(() => {
    if (names.length) play('glide');
    return () => { current.current?.fadeOut(0.2); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [names.length]);

  useFrame((_, rawDt) => {
    const g = group.current;
    if (!g) return;
    const dt = Math.min(rawDt, 0.05);
    const h = state.height;   // Kaiju height in game units

    // WALK MODE: the body is simulated, so read its transform instead of deriving one from the
    // camera. Everything below (gait, animation rate, scale) is shared between the two modes.
    if (isKaijuWalkActive()) {
      const b = kaijuBodyState;
      // Stand ON the ground: lift by however far this model's origin is above its own feet.
      g.position.copy(b.dir).multiplyScalar(b.radius + footLift.current);

      // Footsteps. Only while walking: in fly mode the Kaiju is carried by the camera rather than
      // simulated, so it has no real gait to match and stomping would be a lie.
      camera.getWorldDirection(view.current);
      // Same rule as the arena avatars: the clip drives the sound.
      const act = current.current;
      const clipLen = act?.getClip().duration ?? 0;
      const phase = act && clipLen > 0 && (gait.current === 'walk' || gait.current === 'run')
        ? (act.time % clipLen) / clipLen
        : undefined;
      updateKaijuFootsteps('player', b, h, camera.position, view.current, true, dt, phase);
      // "I heard you": three vivid pulses in one second whenever a command is understood.
      applyFlash(model, flashIntensity(ackFlashRemaining('player')), playerBurning());
      const bUp = up.current.copy(b.dir);
      const bFwd = fwd.current;
      facingVector(bFwd);
      // FACING. The model's local +Z is its front — the same convention MonsterEnemy uses when it
      // does `rotation.y = atan2(dx, dz)`. So the basis must map local +Z to `forward`, local +Y to
      // the local up, and local +X to up x forward.
      //
      // This previously built makeBasis(right, up, -forward), which is a valid right-handed frame
      // but is rotated 180 degrees about up — so the Kaiju faced and animated exactly backwards
      // while walking forwards. Verified numerically rather than by eye.
      const bX = new THREE.Vector3().crossVectors(bUp, bFwd).normalize();
      basis.current.makeBasis(bX, bUp, bFwd.clone().normalize());
      g.quaternion.setFromRotationMatrix(basis.current);

      // TELL THE SIMULATION WHAT IS ACTUALLY BEING DRAWN. The bullet collider is shaped from this,
      // and `[` `]` and `-` `=` change it at any moment — so reading it once would leave the hit
      // test shaped like whichever Kaiju you last left.
      setPlayerVisual(state.type, h);

      // YOU CAN BE KILLED, AND YOU SHOULD BE ABLE TO SEE IT.
      //
      // Geoff: "you're allowing the other kaijus to be able to kill me so then I can't move... but I
      // haven't fallen over... so I need a death animation." The AI Kaiju have had one for weeks;
      // the player's own renderer never grew one, so being killed looked exactly like the controls
      // breaking — which is most of why the last several days went the way they did.
      const meAgent = playerAgent();
      if (meAgent && !meAgent.alive) {
        play('dead');
        mixer.timeScale = 0.4;
        stopKaijuFootsteps('player');
        // Topple onto the SLOPE, easing over a couple of seconds, exactly as the AI corpses do.
        const t = meAgent.deadFor ?? 0;
        const ease = 1 - (1 - Math.min(1, t / 2.4)) * (1 - Math.min(1, t / 2.4));
        const nrm = deathNrm.current;
        sampleGlobeNormal(b.dir, nrm);
        const flat = deathFwd.current.copy(b.forward).addScaledVector(nrm, -b.forward.dot(nrm));
        if (flat.lengthSq() < 1e-9) flat.copy(b.dir);
        flat.normalize();
        const side = deathSide.current.crossVectors(nrm, flat).normalize();
        basis.current.makeBasis(side, nrm, flat);
        g.quaternion.setFromRotationMatrix(basis.current);
        g.quaternion.multiply(deathTip.current.setFromAxisAngle(DEATH_AXIS, -Math.PI * 0.5 * ease));
        g.scale.setScalar(h / Math.max(0.01, modelHeight));
        if (rigId.current) clearRigCapsules(rigId.current);
        return;
      }

      // THE FLINCH. Geoff: "he swipes and hits me but it passes right through." Your knockback is
      // deliberately zeroed — being shoved by physics you did not initiate reads as broken controls
      // — so a blow moved nothing at all. A skeletal bend costs you no control and still lands.
      if (impactBones.current.length && rigId.current) {
        consumeStrikes(rigId.current, impactBones.current, h);
        applySkeletonImpact(rigId.current, impactBones.current, dt, h, state.baseHeight * 100);
        const lean = bodyLean(rigId.current, _lean.current);
        const la = lean.length();
        if (la > 1e-5) g.quaternion.multiply(_leanQ.current.setFromAxisAngle(lean.divideScalar(la), la));
      }

      // FEET ON THE ACTUAL GROUND. Geoff: "one foot may be floating in the air, because the ground
      // isn't even." Runs after the flinch and before the colliders are read.
      if (legs.current?.left || legs.current?.right) {
        plantFeet(
          'player', legs.current, g, b.radius,
          (d) => {
            const m = sampleGlobeSurface(d.x, d.y, d.z);
            return m == null ? null : PLANET_RADIUS + m / METRES_PER_UNIT;
          },
          groundNormal, dt, 1, facingVector(_knee.current),
        );
      }

      // Limb capsules from the pose just drawn, so the crowd's bullets can spark on your own arms.
      //
      // WRAPPED, AND IT MATTERS. This is the one thing in this frame loop that reaches into another
      // system, and everything AFTER it is what makes the Kaiju walk — the gait choice, the clip,
      // the animation rate. A throw here would leave the body simulating correctly while the model
      // stood frozen with its legs still, which reads as "you broke walking" and points at entirely
      // the wrong file. Cosmetic hit-detection is never worth taking the player's avatar down with
      // it, so it fails once, says so, and switches itself off.
      if (!rigBroken.current) {
        try {
          ensureRig();
          if (rigId.current) updateRigCapsules(rigId.current, h);
        } catch (err) {
          rigBroken.current = true;
          console.error('[kaiju] limb colliders disabled after error', err);
        }
      }

      const alt = b.radius - (groundRadiusCached(b) ?? b.radius);
      const altH = alt / Math.max(0.001, h);
      if (b.submerged) { play('swim'); mixer.timeScale = animSpeedMul(state) * 0.7; return; }
      if (landTimer.current > 0) landTimer.current -= dt;
      else if (!b.onGround && altH > GLIDE_ALT) play('glide');
      else if (!b.onGround && gait.current === 'glide') { play('land'); landTimer.current = 0.7; }
      else if (b.onGround) {
        // Thresholds must be RELATIVE to this body's own speeds. A 300 m Kaiju walks at 0.27
        // units/sec and runs at 0.86; the fixed values used in fly mode (12 and 0.6, tuned for
        // camera flight) would classify a walk as standing still and a run as a walk.
        const wS = walkSpeed(h), rS = runSpeed(h);
        play(b.speed > (wS + rS) * 0.5 ? 'run' : b.speed > wS * 0.25 ? 'walk' : 'idle');
      }

      // Stride rate, measured against the speed THE CURRENT CLIP represents.
      //
      // This used to divide by the walk speed whichever clip was playing, so a running Kaiju —
      // moving at a bit over three times walking pace — drove the run cycle at 3x and the legs
      // blurred. A run clip already depicts running; it only needs correcting for how far from
      // that reference the body actually is.
      const ref = gait.current === 'run' ? runSpeed(h) : walkSpeed(h);
      const stride = gait.current === 'walk' || gait.current === 'run'
        ? Math.min(1.6, Math.max(0.35, b.speed / Math.max(1e-4, ref))) : 1;
      mixer.timeScale = animSpeedMul(state) * stride;

      // The pre-jump crouch. Sink the model and compress it slightly, so the gather is visible even
      // on models with no crouch clip of their own.
      //
      // The squash must be applied WITHIN the Kaiju's own scale, not instead of it. This group
      // already carries `state.height / modelHeight` from the JSX prop, so writing a raw 1 here
      // shrank a 300 m Kaiju down to its model's natural size the moment it crouched — and left
      // it there, because a frame-loop write is not undone by re-rendering.
      // THE CROUCH IS A COMPRESSION, NOT A DESCENT.
      //
      // It used to also translate the whole model 54 m DOWN, which is why it read as the Kaiju
      // sinking into the ground rather than gathering itself. The group's origin is at the feet,
      // so scaling y alone keeps the feet planted and brings the head down — which is what a
      // squat actually is. Deepened from 12% to 30% so it is visible at all.
      //
      // THE SQUASH IS GONE, AND IT HAD TO BE. It set a NON-UNIFORM scale on this group — the same
      // group that carries the body's rotation quaternion — with the whole animated skeleton
      // underneath.
      //
      // three.js composes a node as translation x rotation x scale, and every child inherits that
      // product. So a bone with its own rotation R ends up evaluated as S x R with S non-uniform,
      // and a non-uniform scale applied before a rotation is a SHEAR, not a squash. Bones that are
      // rotated relative to the body get skewed; bones aligned with it do not. During a walk the
      // legs are exactly the bones that rotate most, which is precisely the reported symptom:
      // twisted legs and feet.
      //
      // A vertical squash of a skinned character cannot be done with a transform at all — it is
      // inherently non-uniform, so it inherently shears. Real crouches are animated, and these
      // models already ship a stand_to_crouch clip that the gait resolver knows how to find.
      // Losing a brief pre-jump compression is a fair price for a rig that cannot skew.
      g.scale.setScalar(h / Math.max(0.01, modelHeight));
      return;
    }

    // FLY MODE. The Kaiju is carried by the camera rather than simulated, so its body and its model
    // are in two different places — and the limb capsules captured in walk mode are still sitting in
    // world space where it used to stand. Left there they are invisible arms that stop bullets.
    if (rigId.current) { clearRigCapsules(rigId.current); unregisterHitMesh(rigId.current); }

    // Place it relative to the CAMERA'S OWN axes, so it is always in frame.
    //
    // This previously used the local tangent frame, which is degenerate exactly when you look
    // straight down at the planet: the arrival view. The fallback then used `camera.up`, which in
    // three.js is the world up HINT (0,1,0), not the camera's up axis, and put the Kaiju 90
    // degrees off the view direction. With a 70 degree FOV that is 55 degrees outside the screen,
    // which is why it was never visible.
    camera.getWorldDirection(view.current);
    camUp.current.setFromMatrixColumn(camera.matrixWorld, 1).normalize();   // the REAL up axis

    target.current.copy(camera.position)
      .addScaledVector(view.current, h * AHEAD)
      .addScaledVector(camUp.current, -h * BELOW);

    // Local up AT THE KAIJU, for standing it upright on the planet.
    up.current.copy(target.current);
    if (up.current.lengthSq() < 1e-6) return;
    up.current.normalize();

    // Facing: the view flattened onto the ground. Falls back to the camera's real up flattened,
    // which when looking straight down is the direction the top of the screen points at, so the
    // Kaiju faces "up the screen" rather than somewhere arbitrary.
    fwd.current.copy(view.current).addScaledVector(up.current, -view.current.dot(up.current));
    if (fwd.current.lengthSq() < 1e-8) {
      fwd.current.copy(camUp.current).addScaledVector(up.current, -camUp.current.dot(up.current));
      if (fwd.current.lengthSq() < 1e-8) return;
    }
    fwd.current.normalize();

    const tLen = target.current.length();
    if (tLen < 1e-6) return;
    const tux = up.current.x, tuy = up.current.y, tuz = up.current.z;

    // Ground height at the Kaiju's own position, including procedural detail, so it stands on the
    // surface you can actually see rather than on the raw data.
    const groundM = sampleGlobeSurface(tux, tuy, tuz);
    const groundR = PLANET_RADIUS + (groundM ?? 0) / METRES_PER_UNIT;
    const altitude = tLen - groundR;                 // units above the ground
    const altH = altitude / Math.max(0.001, h);      // ...in Kaiju heights

    // Never let it sink below the ground; above the landing band it flies where it was placed.
    const radius = altitude < 0 ? groundR : tLen;
    g.position.set(tux * radius, tuy * radius, tuz * radius);

    // Orientation: local up is radial. Facing is the camera's tangent forward. While gliding,
    // pitch the body forward into the dive so it reads as flight rather than a standing pose.
    const kUp = up.current;
    const kFwd = fwd.current;
    const right = new THREE.Vector3().crossVectors(kFwd, kUp).normalize();
    const trueFwd = new THREE.Vector3().crossVectors(kUp, right).normalize();
    basis.current.makeBasis(right, kUp, trueFwd.clone().negate());
    quat.current.setFromRotationMatrix(basis.current);
    if (gait.current === 'glide') {
      // Lean into the direction of travel; the steeper the dive, the more it tips.
      const dive = Math.max(0, -view.current.dot(kUp));
      quat.current.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -dive * 1.1));
    }
    g.quaternion.copy(quat.current);

    // Horizontal speed, measured from actual movement rather than from key state, so it is right
    // whatever drives the camera.
    let speed = 0;
    if (havePrev.current && dt > 0) speed = prevPos.current.distanceTo(g.position) / dt;
    prevPos.current.copy(g.position);
    havePrev.current = true;

    // Gait selection.
    if (landTimer.current > 0) {
      landTimer.current -= dt;
    } else if (altH > GLIDE_ALT) {
      play('glide');
    } else if (gait.current === 'glide') {
      play('land');
      landTimer.current = 0.7;                       // hold the landing crouch briefly
    } else if (altH <= GROUND_ALT) {
      play(speed > RUN_SPEED ? 'run' : speed > STILL_SPEED ? 'walk' : 'idle');
    }

    // Playback rate: the Froude rule (bigger plays slower), and walking/running also speeds up
    // with how fast the body is actually travelling so the feet do not skate too badly.
    const strideRate = gait.current === 'walk' || gait.current === 'run'
      ? Math.min(2.5, Math.max(0.35, speed / (h * 1.6)))
      : 1;
    mixer.timeScale = animSpeedMul(state) * strideRate;

    // Publish what actually happened, so the HUD can say whether it is loaded, where it is, and
    // whether it is in front of the camera at all.
    const p = g.position;
    kaijuDiag.finite = Number.isFinite(p.x + p.y + p.z);
    kaijuDiag.dist = camera.position.distanceTo(p);
    kaijuDiag.height = h;
    const toK = target.current.copy(p).sub(camera.position);
    kaijuDiag.offAxisDeg = toK.lengthSq() > 1e-9
      ? THREE.MathUtils.radToDeg(toK.normalize().angleTo(view.current)) : 0;
  });

  // Scale so the model stands `state.height` units tall.
  const scale = state.height / Math.max(0.01, modelHeight);

  return (
    <group ref={group} scale={scale} name="globe-kaiju">
      <primitive object={model} />
    </group>
  );
}
