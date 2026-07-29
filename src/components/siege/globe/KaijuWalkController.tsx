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
import { PLANET_RADIUS, METRES_PER_UNIT } from './cubeSphere';
import { sampleGlobeSurface } from './globeGround';

/** Eye height for the parked camera, in metres. A person, not a Kaiju. */
const EYE_METRES = 1.8;
import {
  body, stepBody, placeOnSurface, groundRadius, walkSpeed, runSpeed, reTangent, turnTangent,
} from './kaijuBody';
import { getKaijuLab, subscribeKaijuLab } from './kaijuLabState';
import { getWalkZoom, nudgeWalkZoom, resetWalkZoom, flyZoomDelta } from './globeZoom';

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

/**
 * Drop the Kaiju in at a specific place on the planet and hand over control.
 *
 * `dropHeights` puts it that many body-heights ABOVE the ground so it visibly falls, which is the
 * point: it demonstrates that gravity and ground contact are actually running rather than leaving
 * you to wonder. Used by the landmark jump.
 */
export function dropKaijuAt(dir: THREE.Vector3, forward: THREE.Vector3, dropHeights = 3): void {
  placeOnSurface(dir.clone().normalize(), forward);
  const h = getKaijuLab().height;
  body.radius += h * dropHeights;
  body.vertVel = 0;
  body.onGround = false;
  pendingEnter = true;
  setWalkActive(true);
}

/** Set when walk mode is entered externally, so the controller resets its camera on the next frame. */
let pendingEnter = false;

/**
 * Walk mode with the camera left alone.
 *
 * The scale view needs the Kaiju's BODY simulated and standing at a fixed spot on the ground
 * (which is what walk mode gives) while the camera sits somewhere else entirely, at human eye
 * height half a kilometre away. Without this the chase camera would immediately snap back behind
 * the Kaiju and the whole point of the shot would be lost.
 */
let cameraFree = false;
export function setWalkCameraFree(v: boolean): void { cameraFree = v; }

/** Adopt the camera's CURRENT facing as the look heading, so a parked shot opens where it is aimed. */
let seedLookFrom: THREE.Camera | null = null;
export function seedWalkLook(camera: THREE.Camera): void { seedLookFrom = camera; }
export function isWalkCameraFree(): boolean { return cameraFree; }

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
      // Typing in a panel: drop anything still held, or the last movement key sticks down.
      if (isTypingTarget(e.target)) { keys.current.clear(); return; }
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
    // SCROLL-WHEEL ZOOM. Missing on this map until now — the globe has its own camera and the
    // wheel was never wired to it, so it read as removed functionality. Plain wheel and Alt+wheel
    // both work: plain because that is what anyone expects on a map, Alt because that is the SWW
    // binding and the muscle memory should carry over.
    const wheel = (e: WheelEvent) => {
      if (isTypingTarget(e.target)) return;
      if (walkActive && cameraFree) {
        // Parked camera: dolly toward or away from the SUBJECT, by a fraction of how far away it
        // already is. My first attempt scaled the step by altitude above SEA LEVEL, which on the
        // canyon rim is 2,100 m — giving an 8.4 km step against a subject 500 m away, a 17x
        // overshoot on every notch. That is why zoom felt broken and why the camera kept ending up
        // somewhere distant and underground.
        const look = new THREE.Vector3();
        camera.getWorldDirection(look);
        const subject = playerBody.dir.clone().multiplyScalar(playerBody.radius);
        const toSubject = Math.max(0.5, camera.position.distanceTo(subject));
        camera.position.addScaledVector(look, -Math.sign(e.deltaY) * toSubject * 0.12);
      } else if (walkActive) {
        nudgeWalkZoom(e.deltaY);
      } else {
        // Flying: move the camera toward or away from the surface, by a step proportional to how
        // high you are, so orbit-to-ground is a handful of notches rather than hundreds.
        const r = camera.position.length();
        if (r < 1e-6) return;
        const altitude = r - PLANET_RADIUS;
        camera.position.setLength(Math.max(PLANET_RADIUS + 0.5, r + flyZoomDelta(e.deltaY, altitude)));
      }
      e.preventDefault();
    };
    /**
     * FORGET EVERY HELD KEY when focus goes anywhere else.
     *
     * THIS IS THE SLIDING. A keydown is recorded and the matching keyup is only ever delivered to
     * the focused element — so holding W and then clicking a panel, alt-tabbing, or losing pointer
     * lock leaves 'KeyW' in the set permanently, and the Kaiju walks forever with nothing on the
     * keyboard pressed. It looks exactly like being shoved by an invisible force, which is what it
     * was mistaken for through three separate attempted fixes.
     *
     * Clearing on every way focus can be lost is the standard remedy and it is cheap.
     */
    const forgetKeys = () => keys.current.clear();
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    window.addEventListener('mousemove', move);
    window.addEventListener('blur', forgetKeys);
    document.addEventListener('visibilitychange', forgetKeys);
    document.addEventListener('pointerlockchange', forgetKeys);
    // Not passive: this needs preventDefault so the page does not scroll behind the canvas.
    window.addEventListener('wheel', wheel, { passive: false });
    return () => {
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up, true);
      window.removeEventListener('mousemove', move);
      window.removeEventListener('wheel', wheel);
      window.removeEventListener('blur', forgetKeys);
      document.removeEventListener('visibilitychange', forgetKeys);
      document.removeEventListener('pointerlockchange', forgetKeys);
    };
  }, [camera]);

  useFrame((_, rawDt) => {
    if (!walkActive) return;
    if (pendingEnter) { pendingEnter = false; haveCam.current = false; haveFwd.current = false; resetWalkZoom(); }
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
      // Scroll-wheel zoom scales the whole chase offset, so pulling back also rises, which keeps
      // the Kaiju framed instead of sliding it up the screen as the camera retreats.
      const z = getWalkZoom();
      target.current.copy(feet.current)
        .addScaledVector(want.current, h * CAM_BACK * z)
        .addScaledVector(body.dir, h * CAM_UP * z);
    }

    // Do not let the camera end up underground on a slope.
    const gr = groundRadius();
    if (gr != null) {
      const minR = gr + h * 0.35;
      if (target.current.length() < minR) target.current.setLength(minR);
    }

    if (!haveCam.current) { camPos.current.copy(target.current); haveCam.current = true; }
    camPos.current.lerp(target.current, Math.min(1, CAM_LERP * dt));
    if (seedLookFrom) {
      const look = new THREE.Vector3();
      seedLookFrom.getWorldDirection(look);
      const up = seedLookFrom.position.clone().normalize();
      if (up.lengthSq() > 1e-12 && Number.isFinite(look.x)) {
        orbitPitch.current = -Math.asin(Math.max(-1, Math.min(1, look.dot(up))));
        look.addScaledVector(up, -look.dot(up));
        if (look.lengthSq() > 1e-12) { camFwd.current.copy(look).normalize(); haveFwd.current = true; }
      }
      seedLookFrom = null;
    }
    if (cameraFree) {
      // NEVER BELOW THE GROUND. The parked camera can be dollied, and the terrain under it is not
      // flat, so without this it burrows into the mountain — which is both disorienting and makes
      // the whole scene disappear behind rock. Clamped every frame, not just when it is placed.
      {
        const cd = camera.position.clone().normalize();
        const gm = sampleGlobeSurface(cd.x, cd.y, cd.z);
        if (gm != null) {
          const floor = PLANET_RADIUS + gm / METRES_PER_UNIT + EYE_METRES / METRES_PER_UNIT;
          if (camera.position.length() < floor) camera.position.setLength(floor);
        }
      }
      // FREE CAMERA: hold the position, but still let the mouse look around from it. A fixed shot
      // you cannot turn your head in is a screenshot, not a viewpoint — and the whole value of the
      // scale view is being able to look from the people up to the Kaiju and back.
      const up = camera.position.clone().normalize();
      const fwd = camFwd.current.clone();
      fwd.addScaledVector(up, -fwd.dot(up));
      // GUARD. A zero-length forward normalises to (0,0,0), lookAt then targets the camera's own
      // position, and the resulting quaternion is NaN — which does not merely look wrong, it
      // blanks the entire scene. That is very likely why the scale view showed nothing at all.
      if (fwd.lengthSq() < 1e-12) {
        fwd.crossVectors(up, new THREE.Vector3(0, 1, 0));
        if (fwd.lengthSq() < 1e-12) fwd.crossVectors(up, new THREE.Vector3(1, 0, 0));
      }
      fwd.normalize();
      const right = new THREE.Vector3().crossVectors(fwd, up).normalize();
      if (Number.isFinite(right.x)) fwd.applyAxisAngle(right, -orbitPitch.current);
      if (Number.isFinite(fwd.x) && fwd.lengthSq() > 1e-12) {
        camera.up.copy(up);
        camera.lookAt(camera.position.clone().add(fwd));
      }
    } else {
      camera.position.copy(camPos.current);
    }

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
