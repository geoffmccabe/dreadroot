// KaijuWalkController — drive the Kaiju directly, third person, on the sphere.
//
// Press G to toggle between FLY (free camera, the Kaiju rides in front of it) and WALK (you are
// the Kaiju; the camera chases it). Fly is for crossing a 400,750-unit planet; walk is for being
// somewhere.
//
// While walking this owns the camera and the shared FortressControls stands down, the same way
// the spawn cinematic already does. Two movers fighting over one camera is the failure mode to
// avoid, so exactly one is authoritative at a time.
//
// The mouse orbits the camera around the Kaiju and sets where it is steering; the body then TURNS
// toward that heading at a finite rate rather than snapping, because a 300 m creature that pivots
// instantly looks weightless.

import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { isTypingTarget } from '@/lib/isTypingTarget';
import { PLANET_RADIUS } from './cubeSphere';
import {
  body, stepBody, placeOnSurface, groundRadius, walkSpeed, runSpeed, reTangent, turnTangent,
} from './kaijuBody';
import { getKaijuLab, subscribeKaijuLab } from './kaijuLabState';

/** Camera distance behind the Kaiju, in body heights. */
const CAM_BACK = 4.2;
/** Camera height above it, in body heights. */
const CAM_UP = 1.7;
/** How fast the chase camera catches up (per second). Lower = laggier, heavier feeling. */
const CAM_LERP = 6;
/** Mouse sensitivity for the orbit. */
const LOOK_SENS = 0.0022;
/** Eye height as a fraction of body height. A 300 m Kaiju sees from about 270 m. */
const EYE_FRAC = 0.9;

let walkActive = false;
const listeners = new Set<() => void>();
/** FortressControls checks this to stand down. Read by the shared controller, so keep it cheap. */
export function isKaijuWalkActive(): boolean { return walkActive; }
export function subscribeKaijuWalk(fn: () => void): () => void {
  listeners.add(fn); return () => { listeners.delete(fn); };
}
/**
 * Enter walk mode from outside (the "land here" key), placing the body under the camera and
 * facing the way you were looking.
 */
export function enterWalkMode(camera: THREE.Camera): void {
  const d = camera.position.clone();
  if (d.lengthSq() < 1e-6) return;
  const look = new THREE.Vector3();
  camera.getWorldDirection(look);
  placeOnSurface(d.normalize(), look);
  pendingEnter = true;
  setWalkActive(true);
}

/** Set when walk mode is entered externally, so the controller resets its camera on the next frame. */
let pendingEnter = false;

function setWalkActive(v: boolean) {
  if (walkActive === v) return;
  walkActive = v;
  for (const l of listeners) l();
}

export function KaijuWalkController() {
  const camera = useThree((s) => s.camera);
  const keys = useRef(new Set<string>());
  // The camera's own heading is carried as a TANGENT VECTOR and transported with the body, for
  // the same reason the body's is (see kaijuBody): any angle measured against a global reference
  // flips at the poles. Mouse-x rotates it about local up; mouse-y is a simple pitch.
  const camFwd = useRef(new THREE.Vector3());
  const haveFwd = useRef(false);
  const orbitPitch = useRef(0.25);
  const pendingYaw = useRef(0);
  /** First person puts the camera at the Kaiju's own eye height, which is what "eye level" means
   *  for a body this size: about 270 m up for a 300 m Kaiju. Third person stays the default. */
  const firstPerson = useRef(false);
  const camPos = useRef(new THREE.Vector3());
  const haveCam = useRef(false);

  // Scratch
  const camRight = useRef(new THREE.Vector3());
  const steer = useRef(new THREE.Vector3());
  const feet = useRef(new THREE.Vector3());
  const want = useRef(new THREE.Vector3());
  const target = useRef(new THREE.Vector3());

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (e.code === 'KeyG' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (!walkActive) {
          // Entering walk mode: drop the Kaiju onto the ground beneath the camera so you do not
          // have to find it. Tiles may still be streaming, in which case placeOnSurface leaves it
          // at the planet radius and the body's own "hold while ungrounded" rule takes over.
          const d = camera.position.clone();
          if (d.lengthSq() > 1e-6) {
            // Face the way the camera was looking, so entering walk mode does not spin you round.
            const look = new THREE.Vector3();
            camera.getWorldDirection(look);
            placeOnSurface(d.normalize(), look);
          }
          haveCam.current = false;
          haveFwd.current = false;
        }
        setWalkActive(!walkActive);
        e.preventDefault();
        return;
      }
      if (!walkActive) return;
      if (e.code === 'KeyV') { firstPerson.current = !firstPerson.current; haveCam.current = false; e.preventDefault(); return; }
      keys.current.add(e.code);
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.code);
    const move = (e: MouseEvent) => {
      if (!walkActive || document.pointerLockElement == null) return;
      pendingYaw.current -= e.movementX * LOOK_SENS;
      orbitPitch.current = Math.max(-0.9, Math.min(1.2, orbitPitch.current + e.movementY * LOOK_SENS));
    };
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    window.addEventListener('mousemove', move);
    return () => {
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up, true);
      window.removeEventListener('mousemove', move);
    };
  }, [camera]);

  useFrame((_, rawDt) => {
    if (!walkActive) return;
    if (pendingEnter) { pendingEnter = false; haveCam.current = false; haveFwd.current = false; }
    const dt = Math.min(rawDt, 0.05);
    const k = keys.current;
    const h = getKaijuLab().height;

    const fwd = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
    const right = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    const running = k.has('ShiftLeft') || k.has('ShiftRight');
    const jump = k.has('Space');

    // Initialise the camera heading from the body's facing the first time.
    if (!haveFwd.current) { camFwd.current.copy(body.forward); haveFwd.current = true; }
    reTangent(camFwd.current);
    if (pendingYaw.current !== 0) { turnTangent(camFwd.current, pendingYaw.current); pendingYaw.current = 0; }

    // Steering: W walks where the CAMERA is looking, A/D relative to that.
    let desired: THREE.Vector3 | null = null;
    if (fwd !== 0 || right !== 0) {
      camRight.current.crossVectors(camFwd.current, body.dir).normalize();
      steer.current.set(0, 0, 0)
        .addScaledVector(camFwd.current, fwd)
        .addScaledVector(camRight.current, right);
      if (steer.current.lengthSq() > 1e-8) desired = reTangent(steer.current);
    }

    // Underwater the same keys mean vertical thrust rather than a jump: Space rises, Z or Ctrl
    // dives. Held, not edge-triggered, because swimming up is continuous.
    const up = (k.has('Space') ? 1 : 0) - (k.has('KeyZ') || k.has('ControlLeft') ? 1 : 0);
    stepBody(dt, fwd, right, jump && !body.submerged, running, h, desired, up);
    if (jump && !body.submerged) k.delete('Space');   // edge-trigger the jump only

    // Transport the camera heading by the SAME rotation the body just underwent, so it stays
    // tangent and keeps its bearing relative to the ground as the planet curves away.
    camFwd.current.applyQuaternion(body.lastMoveQuat);
    reTangent(camFwd.current);

    // --- camera ---------------------------------------------------------------------------
    feet.current.copy(body.dir).multiplyScalar(body.radius);
    const cp = Math.cos(orbitPitch.current), sp = Math.sin(orbitPitch.current);
    want.current.copy(camFwd.current).multiplyScalar(-cp)
      .addScaledVector(body.dir, sp)
      .normalize();

    if (firstPerson.current) {
      // Sit at the Kaiju's own eye height rather than behind it.
      target.current.copy(feet.current).addScaledVector(body.dir, h * EYE_FRAC);
    } else {
      target.current.copy(feet.current)
        .addScaledVector(want.current, h * CAM_BACK)
        .addScaledVector(body.dir, h * CAM_UP);
    }

    // Do not let the camera end up underground on a slope.
    const gr = groundRadius();
    if (gr != null) {
      const minR = gr + h * 0.35;
      if (target.current.length() < minR) target.current.setLength(minR);
    }

    if (!haveCam.current) { camPos.current.copy(target.current); haveCam.current = true; }
    camPos.current.lerp(target.current, Math.min(1, CAM_LERP * dt));
    camera.position.copy(camPos.current);

    // Look along the heading (first person) or at the body (third person). camera.up is local up
    // either way, which is what keeps the horizon level on a sphere.
    camera.up.copy(body.dir);
    if (firstPerson.current) {
      target.current.copy(camera.position)
        .addScaledVector(camFwd.current, h * 4)
        .addScaledVector(body.dir, Math.tan(-orbitPitch.current) * h * 4);
    } else {
      target.current.copy(feet.current).addScaledVector(body.dir, h * 0.55);
    }
    camera.lookAt(target.current);
  }, 1);   // priority 1: run AFTER the shared controller so the camera write wins

  return null;
}

/** Speeds for the HUD, so the readout matches what the body actually does. */
export function walkSpeeds(heightUnits: number) {
  return { walk: walkSpeed(heightUnits), run: runSpeed(heightUnits), planet: PLANET_RADIUS };
}
