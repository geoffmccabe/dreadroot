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

import {
  body, stepBody, placeOnSurface, walkSpeed, runSpeed, reTangent, turnTangent,
  reTangentOf, turnTangentOf,
} from './kaijuBody';
import { getKaijuLab, subscribeKaijuLab } from './kaijuLabState';
import { getWalkZoom, nudgeWalkZoom, resetWalkZoom, setWalkZoom, flyZoomDelta } from './globeZoom';
import { getAgents } from './kaijuArena';

/**
 * ONE CAMERA. It orbits the Kaiju at a DISTANCE and a PITCH, and that is all it does.
 *
 * There used to be a second, "free" camera for the Grand Canyon scale shot, parked in space with
 * its own rules. Geoff, twice: "why is each location on the globe getting different rules and
 * controls? that's stupid and not supposed to be like that." He is right, and the second camera
 * also silently lost three separate features — you could not orbit it, its ground clamp used the
 * Kaiju's ground rather than its own, and the chase code below overwrote its aim every frame.
 *
 * So the scale shot is no longer a different camera. It is this camera with the distance dialled
 * out to 500 m and the pitch dialled down to a person's eye height. Everything else — orbiting,
 * the wheel, staying above the terrain, aiming the weapon — is the same code it always was.
 */
/** Orbit distance at zoom 1, in body heights. */
const CAM_ORBIT = 4.9;
/**
 * Resting pitch, radians above the horizon.
 *
 * 0.59 with CAM_ORBIT 4.9 reproduces the previous framing exactly: the old camera was 12.2 body
 * heights back and 8.2 up, which is the same point in polar form. Expressing it as one distance
 * and one angle is what lets a shot be composed by setting two numbers.
 */
const DEFAULT_PITCH = 0.59;
/** How fast the chase camera catches up (per second). Lower = laggier, heavier feeling. */
const CAM_LERP = 6;
/** Mouse sensitivity for the orbit. */
const LOOK_SENS = 0.0022;
/** Metres the camera must stay above whatever ground is under IT. */
const CAM_CLEAR_METRES = 2;
/** Eye height as a fraction of body height. A 300 m Kaiju sees from about 270 m. */
const EYE_FRAC = 0.9;

/**
 * THE CAMERA IS NO LONGER WELDED TO ONE CREATURE.
 *
 * Geoff: "don't limit my camera movement so much... It seems fixated on a single kaiju but the game
 * will have multiple ones that the player owns and can control, so we need more free camera
 * movement."
 *
 * Three additions, and they compose rather than each being a mode of its own:
 *
 *   SUBJECT  — who the camera orbits. Tab cycles it through every Kaiju in the fight. Your own is
 *              index 0, so Tab from the far end brings you straight home.
 *   PAN      — a sideways offset from the subject, on middle-drag. The camera keeps following, it
 *              just is not centred any more, which is how you watch a fight you are standing in.
 *   FREE     — C detaches entirely. WASD then flies the CAMERA and the Kaiju stands still.
 *
 * WASD still drives YOUR Kaiju while the camera is watching somebody else; switching which one you
 * actually control is a bigger change than a camera one, because the player's body is a single
 * shared object the whole engine reads.
 */
/** Which agent the camera orbits, by index into the arena. 0 is always the player. */
let followIndex = 0;
/** Detached camera: WASD flies the camera and nothing drives the Kaiju. */
let freeCam = false;
/** Sideways offset from the subject, in the camera's own right/up axes, in body heights. */
const panOffset = { right: 0, up: 0 };
/**
 * Extra look-around yaw that does NOT steer.
 *
 * Alt + right-drag. Ordinary right-drag turns the camera heading, and W then walks along it — so
 * looking around and choosing a direction are the same act, and you cannot glance left while still
 * running forward. This offset moves the VIEW only; the steering heading is untouched.
 */
let lookYaw = 0;

export function cameraSubjectName(): string {
  const agents = getAgents();
  if (freeCam) return 'FREE CAMERA';
  const a = agents[followIndex];
  return a ? (a.isPlayer ? `${a.name} (you)` : a.name) : 'you';
}

/**
 * THE INPUT CHAIN, VISIBLE.
 *
 * Geoff: "WASD still does nothing, so I can't walk." I have not been able to reproduce it and have
 * now guessed wrong about the cause more than once, so this stops being a guess. Every link in the
 * chain between a key going down and the body moving is reported on screen:
 *
 *   mode      — walk mode off means the handler never even records a key
 *   focus     — a text field anywhere (the command panel) swallows every keystroke by design
 *   keys      — what the controller currently believes is held
 *   speed     — what the body did with it
 *
 * Whichever of those four is wrong says exactly where the break is, and they need different fixes.
 */
export const walkInputDiag = {
  keys: '' as string,
  moveSpeed: 0,
  freeCam: false,
  typing: false,
  walking: false,
};

/** 'w' -> 'KeyW', so a keyboard that reports no `code` still steers. Ignored for anything longer. */
function keyAlias(e: KeyboardEvent): string | null {
  const k = e.key;
  if (!k || k.length !== 1) return null;
  const c = k.toUpperCase();
  return c >= 'A' && c <= 'Z' ? `Key${c}` : null;
}

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
 * A composed shot: stand this far back, at this eye height. Applied on the next frame.
 *
 * Deferred rather than written straight into the zoom, because entering walk mode resets the zoom
 * on the frame it takes effect — so setting it beforehand would be wiped out immediately.
 */
let pendingShot: { distanceMetres: number; eyeMetres: number } | null = null;

/**
 * Compose a shot: the camera `distanceMetres` from the Kaiju, its eye `eyeMetres` above the
 * ground. This is the Grand Canyon scale view, and it is ordinary camera settings rather than a
 * second camera.
 */
export function setChaseShot(distanceMetres: number, eyeMetres: number): void {
  pendingShot = { distanceMetres, eyeMetres };
}

/** Back to the resting over-the-shoulder view. Every site calls this so none inherits another's. */
export function resetChaseShot(): void {
  pendingShot = null;
  resetWalkZoom();
  restPitch = true;
}
/** Set when the pitch should return to its resting value on the next frame. */
let restPitch = false;

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
  const orbitPitch = useRef(DEFAULT_PITCH);
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
  const localUp = useRef(new THREE.Vector3());
  /** The VIEW heading: the steering heading plus the alt-drag glance. Never fed back into steering. */
  const view = useRef(new THREE.Vector3());

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      // Typing in a panel: drop anything still held, or the last movement key sticks down.
      if (isTypingTarget(e.target)) {
        keys.current.clear();
        // Reported, because this is silent and total: click the command panel's text box and every
        // movement key stops working with nothing on screen to say why.
        walkInputDiag.typing = true;
        return;
      }
      walkInputDiag.typing = false;
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
      // KEYS ARE RECORDED IN BOTH MODES NOW.
      //
      // THIS IS THE "WASD DOES NOTHING" BUG, and it is not a regression — it is a hole that has
      // always been here. This handler used to bail whenever walk mode was off, so in FLY mode the
      // keys were never even recorded. And nothing else moves you on this map either: the shared
      // FortressControls mover is built for a flat world, its ground sampler returns nothing on a
      // sphere, and its own comment says so. So on the globe, out of walk mode, WASD was wired to
      // literally nothing. Below, fly mode now flies the camera with the same code the detached
      // camera uses.
      if (e.code === 'KeyV' && walkActive) {
        firstPerson.current = !firstPerson.current; haveCam.current = false; e.preventDefault(); return;
      }
      // TAB — watch the next Kaiju. Wraps back to your own, so it is never a dead end.
      if (e.code === 'Tab') {
        const n = Math.max(1, getAgents().length);
        followIndex = (followIndex + 1) % n;
        panOffset.right = 0; panOffset.up = 0;
        haveCam.current = false;
        e.preventDefault();
        return;
      }
      // C — detach the camera. WASD flies it; the Kaiju stops taking orders until you come back.
      if (e.code === 'KeyC' && !e.metaKey && !e.ctrlKey) {
        freeCam = !freeCam;
        haveCam.current = false;
        e.preventDefault();
        return;
      }
      // BOTH the physical code and a normalised name. `e.code` is layout-independent, which is
      // right, but it is empty on some remappers and virtual keyboards; falling back on the letter
      // costs one string and removes a whole class of "it works on my machine".
      keys.current.add(e.code);
      const alt = keyAlias(e);
      if (alt) keys.current.add(alt);
    };
    const up = (e: KeyboardEvent) => {
      keys.current.delete(e.code);
      const alt = keyAlias(e);
      if (alt) keys.current.delete(alt);
    };

    // RIGHT-DRAG ORBITS, AND IT DOES NOT NEED POINTER LOCK.
    //
    // Geoff: "if I hold the right mouse button and slide the mouse left or right, the camera
    // location would rotate around the Kaiju so it can change positions, but nothing at all
    // happens."
    //
    // Looking around was gated on pointer lock alone, so without a lock the mouse did nothing —
    // and left-click is already taken by the flamethrower, so clicking to acquire a lock fires
    // instead. Right-drag is the convention everywhere else and costs nothing to support: the
    // same yaw and pitch, just a different way of delivering them.
    const dragging = { on: false, alt: false };
    // MIDDLE BUTTON: drag to pan the camera off the subject, click (no drag) to snap back.
    const panning = { on: false, moved: 0 };
    const mouseDown = (e: MouseEvent) => {
      // CLICKING THE WORLD GIVES THE KEYBOARD BACK.
      //
      // The command panel's text box keeps focus once clicked, and a focused text box swallows
      // every movement key by design — permanently, silently, with nothing on screen to say why.
      // Clicking back into the 3D view plainly means "I am done typing", and every game treats it
      // that way; this one did not, so the controls simply stopped working and stayed stopped.
      if ((e.target as HTMLElement | null)?.tagName === 'CANVAS') {
        const el = document.activeElement as HTMLElement | null;
        if (el && el.tagName !== 'CANVAS' && el.tagName !== 'BODY') el.blur?.();
      }
      if (!walkActive) return;
      if (e.button === 2) { dragging.on = true; dragging.alt = e.altKey; }
      if (e.button === 1) { panning.on = true; panning.moved = 0; e.preventDefault(); }
    };
    const mouseUp = (e: MouseEvent) => {
      if (e.button === 2) { dragging.on = false; dragging.alt = false; }
      if (e.button === 1) {
        // A click, not a drag: recentre. The threshold is what tells the two apart, and without it
        // a pan that ends with a twitch would snap back and undo itself.
        if (panning.on && panning.moved < 6) { panOffset.right = 0; panOffset.up = 0; }
        panning.on = false;
      }
    };
    // Without this the browser's context menu opens on top of the drag and eats the mouse-up.
    const noMenu = (e: MouseEvent) => { if (walkActive) e.preventDefault(); };

    const move = (e: MouseEvent) => {
      if (!walkActive) return;
      if (panning.on) {
        panning.moved += Math.abs(e.movementX) + Math.abs(e.movementY);
        // In body heights, so panning feels the same at any Kaiju size or zoom level.
        panOffset.right -= e.movementX * LOOK_SENS * 3;
        panOffset.up += e.movementY * LOOK_SENS * 3;
        return;
      }
      if (document.pointerLockElement == null && !dragging.on) return;
      if (dragging.alt) {
        // ALT — look around WITHOUT steering. The view swings; the direction W walks in does not.
        lookYaw -= e.movementX * LOOK_SENS;
        orbitPitch.current = Math.max(-0.9, Math.min(1.2, orbitPitch.current + e.movementY * LOOK_SENS));
        return;
      }
      // An ordinary drag re-centres the look offset as it goes, or the view would stay skewed by
      // however far you had glanced last time.
      lookYaw *= 0.85;
      pendingYaw.current -= e.movementX * LOOK_SENS;
      orbitPitch.current = Math.max(-0.9, Math.min(1.2, orbitPitch.current + e.movementY * LOOK_SENS));
    };
    // SCROLL-WHEEL ZOOM. Missing on this map until now — the globe has its own camera and the
    // wheel was never wired to it, so it read as removed functionality. Plain wheel and Alt+wheel
    // both work: plain because that is what anyone expects on a map, Alt because that is the SWW
    // binding and the muscle memory should carry over.
    const wheel = (e: WheelEvent) => {
      if (isTypingTarget(e.target)) return;
      if (walkActive) {
        // ONE ZOOM. The scale view used to dolly the camera by hand instead, which is where the
        // 17x-overshoot bug lived; there is nothing left for a second path to get wrong.
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
    /**
     * THIS IS WHY JUMP WORKED AND WASD DID NOT.
     *
     * Geoff: "I still can't move, I can't walk, WASD does nothing. Jump works." That one sentence
     * is the whole diagnosis, because both keys are read out of the SAME set a line apart — so the
     * set was being emptied, and only a key that keeps re-arriving could survive it.
     *
     * On macOS, holding a LETTER key does not repeat: press-and-hold shows the accent menu instead,
     * so 'KeyW' arrives exactly once and then has to stay in the set to keep working. Space is not
     * a letter, repeats normally, and is re-added thirty times a second. Empty the set periodically
     * and you get precisely this: movement dead, jump fine.
     *
     * What was emptying it was `pointerlockchange`. Clicking to fire the flamethrower makes the
     * shared controls acquire or release the pointer lock, and every one of those was being treated
     * as "the player has let go of everything". It never was: pointer lock changing says nothing at
     * all about which keys are held.
     *
     * Only genuine focus loss clears now — the window blurring or the tab being hidden — which are
     * the two cases where a keyup really will never arrive. Also clears on the way OUT of a lock
     * only, never on the way in, for the one real case: pressing Escape to leave a lock does not
     * deliver keyups for anything still held.
     */
    const forgetKeys = () => keys.current.clear();
    const lockChange = () => { if (document.pointerLockElement == null) keys.current.clear(); };
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    window.addEventListener('mousemove', move);
    window.addEventListener('mousedown', mouseDown);
    window.addEventListener('mouseup', mouseUp);
    window.addEventListener('contextmenu', noMenu);
    window.addEventListener('blur', forgetKeys);
    document.addEventListener('visibilitychange', forgetKeys);
    document.addEventListener('pointerlockchange', lockChange);
    // Not passive: this needs preventDefault so the page does not scroll behind the canvas.
    window.addEventListener('wheel', wheel, { passive: false });
    return () => {
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up, true);
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mousedown', mouseDown);
      window.removeEventListener('mouseup', mouseUp);
      window.removeEventListener('contextmenu', noMenu);
      window.removeEventListener('wheel', wheel);
      window.removeEventListener('blur', forgetKeys);
      document.removeEventListener('visibilitychange', forgetKeys);
      document.removeEventListener('pointerlockchange', lockChange);
    };
  }, [camera]);

  /**
   * FLY THE CAMERA. Used by fly mode and by the C-detached camera, which are the same behaviour.
   *
   * Written once and shared deliberately. Two camera movers with their own rules is the exact
   * failure this file was created to end, and the Grand Canyon "second camera" is what it cost the
   * last time: it could not be orbited, its ground clamp measured the wrong ground, and its aim was
   * overwritten every frame by the chase code.
   */
  const flyCamera = (dt: number) => {
    const k = keys.current;
    const h = getKaijuLab().height;
    const fwd = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
    const right = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    const rise = (k.has('Space') ? 1 : 0) - (k.has('KeyZ') || k.has('ControlLeft') ? 1 : 0);
    const running = k.has('ShiftLeft') || k.has('ShiftRight');

    if (!haveCam.current) { camPos.current.copy(camera.position); haveCam.current = true; }
    if (camPos.current.lengthSq() < 1e-6) camPos.current.copy(camera.position);
    localUp.current.copy(camPos.current).normalize();

    // The heading, then pitched. Same two dials the orbit camera uses, so flying does not feel like
    // a different game.
    if (!haveFwd.current) { camFwd.current.copy(body.forward); haveFwd.current = true; }
    if (pendingYaw.current !== 0) {
      camFwd.current.applyAxisAngle(localUp.current, pendingYaw.current);
      pendingYaw.current = 0;
    }
    camFwd.current.addScaledVector(localUp.current, -camFwd.current.dot(localUp.current)).normalize();
    steer.current.copy(camFwd.current).multiplyScalar(Math.cos(orbitPitch.current))
      .addScaledVector(localUp.current, -Math.sin(orbitPitch.current)).normalize();
    camRight.current.crossVectors(steer.current, localUp.current).normalize();

    // Speed scales with height above the GROUND, so the same key crosses a battlefield from up high
    // and creeps between two Kaiju down low. Measured against the ground, never against sea level —
    // that mistake has cost this project a day twice already.
    const cd = camPos.current.clone().normalize();
    const gm = sampleGlobeSurface(cd.x, cd.y, cd.z);
    const floor = PLANET_RADIUS + (gm ?? 0) / METRES_PER_UNIT;
    const overGround = Math.max(h * 0.4, camPos.current.length() - floor);
    const speed = overGround * (running ? 2.4 : 0.8);

    if (fwd !== 0 || right !== 0 || rise !== 0) {
      camPos.current
        .addScaledVector(steer.current, fwd * speed * dt)
        .addScaledVector(camRight.current, right * speed * dt)
        .addScaledVector(localUp.current, rise * speed * dt);
    }
    // Never underground, measured where the CAMERA is.
    if (gm != null) {
      const clear = floor + CAM_CLEAR_METRES / METRES_PER_UNIT;
      if (camPos.current.length() < clear) camPos.current.setLength(clear);
    }

    camera.position.copy(camPos.current);
    camera.up.copy(localUp.current);
    camera.lookAt(target.current.copy(camera.position).addScaledVector(steer.current, h * 8));
  };

  useFrame((_, rawDt) => {
    // Reported before anything can return, or the readout goes stale exactly when it is needed.
    walkInputDiag.keys = [...keys.current].map((c) => c.replace('Key', '').replace('Digit', '')).join(' ');
    walkInputDiag.moveSpeed = body.moveSpeed;
    walkInputDiag.freeCam = freeCam;
    walkInputDiag.walking = walkActive;

    // FLY MODE FLIES THE CAMERA. Same dials, same code path as the detached camera; the only
    // difference is that nothing is being followed.
    // NOT IN FLY MODE. This file's own header states the rule and I broke it: "Two movers fighting
    // over one camera is the failure mode to avoid, so exactly one is authoritative at a time."
    //
    // FortressControls stands down only while WALK mode is active. So making this drive the camera
    // in FLY mode put two movers on it every single frame, each overwriting the other. Geoff: "when
    // I move the camera around, it flashes crazily... and the earth model behind the kaiju and
    // everything else is flashing" — and the camera appears frozen because the two cancel out.
    //
    // A performance trace settled it: 100 frames a second, 1.1 ms of JavaScript per frame. Nothing
    // was slow. It was two writers.
    //
    // The detached camera below is a different case and is safe: C only works inside walk mode, so
    // FortressControls has already stood down and flyCamera really is the only mover.
    //
    // WHY THIS WAS ADDED, AND WHY THAT REASON WAS WRONG. I thought WASD was "wired to nothing" in
    // fly mode. FortressControls does read WASD; it simply moves poorly on a sphere. The actual
    // cause of "I can't move" turned out to be that Geoff had been killed. Fixing a misdiagnosis
    // with a second camera owner cost far more than the thing it was meant to fix.
    if (!walkActive) return;
    if (pendingEnter) { pendingEnter = false; haveCam.current = false; haveFwd.current = false; resetWalkZoom(); }
    const dt = Math.min(rawDt, 0.05);
    const k = keys.current;
    const h = getKaijuLab().height;

    if (restPitch) { restPitch = false; orbitPitch.current = DEFAULT_PITCH; }
    // A COMPOSED SHOT IS JUST THE ORDINARY DIALS. Applied here, AFTER the walk-mode entry above
    // has had its chance to reset the zoom, or arriving somewhere would immediately undo it.
    if (pendingShot) {
      const { distanceMetres, eyeMetres } = pendingShot;
      pendingShot = null;
      const distUnits = distanceMetres / METRES_PER_UNIT;
      const eyeUnits = eyeMetres / METRES_PER_UNIT;
      orbitPitch.current = Math.atan2(eyeUnits, distUnits);
      setWalkZoom(Math.hypot(distUnits, eyeUnits) / Math.max(1e-4, h * CAM_ORBIT));
      haveCam.current = false;                       // snap, do not sail in from the old position
    }

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

    if (freeCam) { flyCamera(dt); return; }

    stepBody(dt, fwd, right, jump && !body.submerged, running, h, desired, up);
    if (jump && !body.submerged) k.delete('Space');   // edge-trigger the jump only

    // Transport the camera heading by the SAME rotation the body just underwent, so it stays
    // tangent and keeps its bearing relative to the ground as the planet curves away.
    camFwd.current.applyQuaternion(body.lastMoveQuat);
    reTangent(camFwd.current);

    // --- camera ---------------------------------------------------------------------------
    //
    // WHO IS BEING WATCHED. Tab cycles this; index 0 is always the player, so the ordinary case is
    // byte-for-byte what it always was. Falls back to your own body whenever the chosen agent has
    // gone — a Kaiju dying should not strand the camera.
    const agents = getAgents();
    if (followIndex >= agents.length) followIndex = 0;
    const subj = agents[followIndex]?.body ?? body;

    feet.current.copy(subj.dir).multiplyScalar(subj.radius);
    // The view heading = the steering heading plus however far you have GLANCED with alt-drag.
    // Kept separate so looking around never changes where W takes you.
    view.current.copy(camFwd.current);
    if (Math.abs(lookYaw) > 1e-4) {
      // Tangent to the SUBJECT's ground, not the player's — otherwise glancing while watching a
      // Kaiju on the far side of a hill tilts the view off the horizon.
      reTangentOf(subj, view.current);
      turnTangentOf(subj, view.current, lookYaw);
    }
    const cp = Math.cos(orbitPitch.current), sp = Math.sin(orbitPitch.current);
    want.current.copy(view.current).multiplyScalar(-cp)
      .addScaledVector(subj.dir, sp)
      .normalize();

    if (firstPerson.current) {
      // Sit at the Kaiju's own eye height rather than behind it.
      target.current.copy(feet.current).addScaledVector(body.dir, h * EYE_FRAC);
    } else {
      // A PLAIN ORBIT: one distance, one angle. `want` already carries the pitch, so the camera
      // rises as it is pitched up and drops toward eye level as it is pitched down — which is what
      // makes a 500 m, 1.8 m scale shot reachable with the same two dials as every other view.
      target.current.copy(feet.current)
        .addScaledVector(want.current, h * CAM_ORBIT * getWalkZoom());
    }
    // PAN. Applied to the orbit point rather than to the camera, so the camera keeps circling the
    // same place it is now looking at instead of swinging round a subject it is no longer aimed at.
    if (panOffset.right !== 0 || panOffset.up !== 0) {
      camRight.current.crossVectors(want.current, subj.dir).normalize();
      target.current
        .addScaledVector(camRight.current, panOffset.right * h)
        .addScaledVector(subj.dir, panOffset.up * h);
    }

    // NEVER UNDERGROUND — MEASURED WHERE THE CAMERA ACTUALLY IS.
    //
    // This used to clamp against the ground under the KAIJU, which is a different place: on the
    // canyon rim the camera can be out over the gorge, or back up the slope, hundreds of metres
    // from the Kaiju's own ground height. Clamping to the wrong ground both buried the camera on a
    // rise and shoved it into the air over a drop. Sampling under the camera is the only version
    // of this that means what it says.
    {
      const cd = target.current.clone().normalize();
      const gm = sampleGlobeSurface(cd.x, cd.y, cd.z);
      if (gm != null) {
        const floor = PLANET_RADIUS + gm / METRES_PER_UNIT + CAM_CLEAR_METRES / METRES_PER_UNIT;
        if (target.current.length() < floor) target.current.setLength(floor);
      }
    }

    if (!haveCam.current) { camPos.current.copy(target.current); haveCam.current = true; }
    camPos.current.lerp(target.current, Math.min(1, CAM_LERP * dt));
    camera.position.copy(camPos.current);

    // Look along the heading (first person) or at the body (third person). camera.up is local up
    // either way, which is what keeps the horizon level on a sphere.
    camera.up.copy(subj.dir);
    if (firstPerson.current) {
      target.current.copy(camera.position)
        .addScaledVector(view.current, h * 4)
        .addScaledVector(subj.dir, Math.tan(-orbitPitch.current) * h * 4);
    } else {
      target.current.copy(feet.current).addScaledVector(subj.dir, h * 0.55);
      if (panOffset.right !== 0 || panOffset.up !== 0) {
        camRight.current.crossVectors(want.current, subj.dir).normalize();
        target.current
          .addScaledVector(camRight.current, panOffset.right * h)
          .addScaledVector(subj.dir, panOffset.up * h);
      }
    }
    camera.lookAt(target.current);
  }, 1);   // priority 1: run AFTER the shared controller so the camera write wins

  return null;
}

/** Speeds for the HUD, so the readout matches what the body actually does. */
export function walkSpeeds(heightUnits: number) {
  return { walk: walkSpeed(heightUnits), run: runSpeed(heightUnits), planet: PLANET_RADIUS };
}
