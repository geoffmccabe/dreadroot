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
import * as THREE from 'three';
import { CFG } from '../siegeMonsterCatalog';
import { APP_VERSION } from '@/version';
import { PLANET_RADIUS, METRES_PER_UNIT } from './cubeSphere';
import { sampleGlobeSurface } from './globeGround';
import { animSpeedMul, type KaijuLabState } from './kaijuLabState';
import { body as kaijuBodyState, facingVector, walkSpeed, runSpeed } from './kaijuBody';
import { isKaijuWalkActive } from './KaijuWalkController';

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

type Gait = 'glide' | 'land' | 'walk' | 'run' | 'idle' | 'swim';

/** Preferred clip per gait, in priority order. Models differ (Red Demon uses Mixamo names). */
const CLIPS: Record<Gait, string[]> = {
  glide: ['flex', 'jumpattack', 'idle'],
  land:  ['stand_to_crouch', 'hit', 'idle'],
  walk:  ['walk', 'walking'],
  run:   ['run', 'walk', 'walking'],
  idle:  ['breathidle', 'idle'],
  // No model has a swim clip yet, so reuse the limbs-out 'flex' that also serves as the glide
  // pose. It reads as moving through a medium rather than standing, which is the point. A real
  // swim cycle is part of the animation work in P13.
  swim:  ['flex', 'crawl', 'idle'],
};

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
  const camera = useThree((s) => s.camera);
  const group = useRef<THREE.Group>(null);
  const { scene, animations } = useGLTF(`${url}?v=${APP_VERSION}`);

  // Clone per instance: the cached glTF scene is shared and mutating it would corrupt every other
  // user of the same model.
  const model = useMemo(() => {
    const c = scene.clone(true);
    c.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = false; o.receiveShadow = false; } });
    return c;
  }, [scene]);

  const { actions, names, mixer } = useAnimations(animations, group);
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

  /** Resolve a gait to an actual clip on THIS model, case-insensitively. */
  const clipFor = (g: Gait): string | null => {
    for (const want of CLIPS[g]) {
      const hit = names.find((n) => n.toLowerCase() === want);
      if (hit) return hit;
    }
    return names[0] ?? null;
  };

  const play = (g: Gait) => {
    if (gait.current === g && current.current) return;
    gait.current = g;
    const name = clipFor(g);
    if (!name) return;
    const next = actions[name];
    if (!next || next === current.current) return;
    current.current?.fadeOut(0.25);
    next.reset().fadeIn(0.25).play();
    if (g === 'land') { next.setLoop(THREE.LoopOnce, 1); next.clampWhenFinished = true; }
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
      g.position.copy(b.dir).multiplyScalar(b.radius);
      const bUp = up.current.copy(b.dir);
      const bFwd = fwd.current;
      facingVector(bFwd);
      const bRight = new THREE.Vector3().crossVectors(bFwd, bUp).normalize();
      const trueF = new THREE.Vector3().crossVectors(bUp, bRight).normalize();
      basis.current.makeBasis(bRight, bUp, trueF.negate());
      g.quaternion.setFromRotationMatrix(basis.current);

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

      // Stride rate relative to this body's natural walk speed, so the feet roughly keep up with
      // the ground instead of always sitting at the clamp.
      const stride = gait.current === 'walk' || gait.current === 'run'
        ? Math.min(3, Math.max(0.4, b.speed / Math.max(1e-4, walkSpeed(h)))) : 1;
      mixer.timeScale = animSpeedMul(state) * stride;
      return;
    }

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
  });

  // Scale so the model stands `state.height` units tall.
  const scale = state.height / Math.max(0.01, modelHeight);

  return (
    <group ref={group} scale={scale} name="globe-kaiju">
      <primitive object={model} />
    </group>
  );
}
