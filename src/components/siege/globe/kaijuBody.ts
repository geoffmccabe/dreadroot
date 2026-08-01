// kaijuBody — the authoritative transform and physics state for the Kaiju on the Mini Earth.
//
// This is the piece that turns the Kaiju from a puppet into a character. Until now it was placed
// relative to the camera each frame (GlobeKaiju), so "walking" was really just the camera moving
// with a walk animation attached. Here it has its own position, velocity and ground contact, and
// in WALK mode the camera follows IT rather than the other way round.
//
// TWO MODES, one body:
//   'fly'  the camera is free (the existing god-mode flight) and the body is carried in front of
//          it. Right for crossing a 400,750-unit planet and for looking at the globe.
//   'walk' the body is simulated and the camera is a third-person chase. Right for actually being
//          somewhere.
// Keeping one body for both means the model, animation and HUD never care which mode is active.
//
// PHYSICS ON A SPHERE. There is no world "up" here: up is the unit direction from the planet
// centre, recomputed every step, so walking far enough genuinely carries you around the planet
// rather than off the edge of a plane. Position is stored as (direction, radius) rather than xyz
// because that is what the maths actually wants, and it keeps the surface constraint exact
// instead of something that drifts.
//
// SCALE-CORRECT MOVEMENT. Speeds come from the Froude number, the same dynamic-similarity rule
// used for the animation rate: v = sqrt(Fr * g * L). A 300 m creature walks at about 27 real m/s,
// which is 97 km/h and yet reads as an unhurried stride, because it is 300 m tall. Hard-coding a
// "nice" speed instead would look wrong at every size.

import * as THREE from 'three';
import { PLANET_RADIUS, METRES_PER_UNIT } from './cubeSphere';
import { sampleGlobeSurface } from './globeGround';

export type KaijuMode = 'fly' | 'walk';

/** Froude numbers: dimensionless speed^2/(g*L). ~0.25 is a walk, ~2.5 a run, in real animals. */
const FROUDE_WALK = 0.25;
const FROUDE_RUN = 2.5;
/** Real gravity. Divided by METRES_PER_UNIT to get game units/s^2 (0.0981 at S=100). */
const G_REAL = 9.81;
/** Jump height as a fraction of body height. */
const JUMP_BODY_FRAC = 0.45;
/** How quickly the body turns to face where you are steering, radians/sec. */
const TURN_RATE = 2.2;
/**
 * MOMENTUM. How long a Kaiju takes to reach full speed, and to stop, in seconds.
 *
 * Geoff: "he's responsive, but slow to move" — the controls answer immediately, the 300-metre body
 * does not. Without this the body snapped between standing still and full running speed on the
 * frame the key went down, which is why the walk cycle never matched: the legs were being asked to
 * play a run at a speed the body reached instantly and left instantly.
 *
 * Braking is MUCH quicker than accelerating, because a creature digging its heels in stops faster
 * than it gets going. This was 1.3 s, which coasted ~56 m after you let go — enough to read as the
 * Kaiju sliding around on its own, which is not what "slow to slow down" asked for. At 0.5 s it
 * still has weight without feeling like ice.
 */
const ACCEL_SECONDS = 2.2;
const BRAKE_SECONDS = 0.5;
/**
 * JUMP WIND-UP: seconds spent crouching before the leap, for a 1-unit body.
 *
 * Scaled by the square root of height for the same dynamic-similarity reason everything else here
 * is: big things do everything more slowly. A 3-unit (300 m) Kaiju therefore takes about 0.7 s to
 * gather itself, then leaves the ground under real gravity.
 */
const JUMP_CROUCH_SECONDS = 0.4;
/** Ground stickiness: snap to the surface when within this many body-heights of it. */
const SNAP_FRAC = 0.06;
/**
 * Swimming (Geoff's spec: "water could just be movement-restricting to 50% normal and also the
 * Kaiju can move around in 3D rather than walking").
 */
const SWIM_SPEED_FRAC = 0.5;
/** Vertical swim speed as a fraction of the horizontal swim speed. */
const SWIM_VERT_FRAC = 0.8;
/** Residual sink/float while submerged, as a fraction of gravity. Slightly buoyant. */
const BUOYANCY = -0.12;
/** Water drag: fraction of vertical velocity bled off per second when submerged. */
const WATER_DRAG = 3.0;

export interface KaijuBody {
  /** Unit direction from the planet centre. With `radius`, this IS the position. */
  dir: THREE.Vector3;
  /** Distance from the planet centre, in game units. */
  radius: number;
  /** Velocity along the local up axis (units/sec). Horizontal motion is applied directly. */
  vertVel: number;
  /**
   * Facing as a unit vector TANGENT to the sphere, not a bearing angle.
   *
   * A bearing needs a global reference direction to be measured against, and every such
   * reference (world up, "north") is singular at the poles: the frame flips discontinuously as
   * you cross one, which silently bends your path. A test walking one full circumference ended
   * up 90 degrees from the start because of exactly that. Carrying the facing as a vector and
   * parallel-transporting it along the motion has no singularity anywhere on the sphere.
   */
  forward: THREE.Vector3;
  onGround: boolean;
  /** Horizontal speed last frame (units/sec), for gait selection. */
  speed: number;
  /** Rotation the last move applied to `dir`. Transport any tangent vector with this to keep it valid. */
  lastMoveQuat: THREE.Quaternion;
  /** True while the body's centre is below sea level. */
  submerged: boolean;
  /**
   * Current horizontal speed, carried between frames so the body has momentum.
   *
   * `speed` above is the speed actually achieved last frame and is what the gait reads; this is
   * the state the acceleration integrates.
   */
  moveSpeed: number;
  /** Seconds left in the pre-jump crouch. Zero when not about to jump. */
  crouchTimer: number;
  /** 0..1 how deep into the crouch it is, for the renderer to squat on. */
  crouchFrac: number;
  /** Metres below sea level (0 on land or at the surface). */
  depthMetres: number;
}

/**
 * Make a new body. Every Kaiju gets one: the player's, and each AI agent's.
 *
 * This started as a single module-level object because there was only ever one Kaiju. `body` below
 * is still that one, so the walk controller and HUD are unchanged, but the physics now takes the
 * body as an argument so any number of agents can share it.
 */
export function createKaijuBody(): KaijuBody {
  return {
    dir: new THREE.Vector3(0, 0, 1),
    radius: PLANET_RADIUS + 1,
    vertVel: 0,
    forward: new THREE.Vector3(0, 1, 0),
    onGround: false,
    speed: 0,
    lastMoveQuat: new THREE.Quaternion(),
    submerged: false,
    depthMetres: 0,
    moveSpeed: 0,
    crouchTimer: 0,
    crouchFrac: 0,
  };
}

/** The PLAYER's body. AI agents each hold their own from createKaijuBody(). */
export const body: KaijuBody = createKaijuBody();

/** Gravity in game units/s^2. */
export const gravityUnits = () => G_REAL / METRES_PER_UNIT;

/** Walk speed in units/sec for a body `heightUnits` tall, from dynamic similarity. */
export function walkSpeed(heightUnits: number): number {
  const lengthM = heightUnits * METRES_PER_UNIT;
  return Math.sqrt(FROUDE_WALK * G_REAL * lengthM) / METRES_PER_UNIT;
}

export function runSpeed(heightUnits: number): number {
  const lengthM = heightUnits * METRES_PER_UNIT;
  return Math.sqrt(FROUDE_RUN * G_REAL * lengthM) / METRES_PER_UNIT;
}

export function jumpVelocity(heightUnits: number): number {
  return Math.sqrt(2 * gravityUnits() * heightUnits * JUMP_BODY_FRAC);
}

/** How long this body crouches before a jump. Bigger bodies gather themselves more slowly. */
export function crouchSeconds(heightUnits: number): number {
  return JUMP_CROUCH_SECONDS * Math.sqrt(Math.max(0.01, heightUnits));
}

/** World position of the body's feet. */
export function feetPosition(out: THREE.Vector3): THREE.Vector3 {
  return out.copy(body.dir).multiplyScalar(body.radius);
}

/** Terrain radius (planet centre to ground) under the body, or null if tiles are not loaded. */
export function groundRadiusOf(b: KaijuBody): number | null {
  const m = sampleGlobeSurface(b.dir.x, b.dir.y, b.dir.z);
  return m == null ? null : PLANET_RADIUS + m / METRES_PER_UNIT;
}
export const groundRadius = () => groundRadiusOf(body);

/** Place the body at a lat/lon-derived direction, standing on the ground. */
export function placeBodyOnSurface(b: KaijuBody, dir: THREE.Vector3, forward?: THREE.Vector3): void {
  b.dir.copy(dir).normalize();
  if (forward) b.forward.copy(forward);
  reTangentOf(b, b.forward);
  const g = groundRadiusOf(b);
  b.radius = (g ?? PLANET_RADIUS) + 0.01;
  b.vertVel = 0;
  b.onGround = true;
}
export const placeOnSurface = (dir: THREE.Vector3, forward?: THREE.Vector3) =>
  placeBodyOnSurface(body, dir, forward);

const _move = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _right = new THREE.Vector3();
const WORLD_Y = new THREE.Vector3(0, 1, 0);

/** Re-project `v` onto the tangent plane at the body and normalise. Kills accumulated drift. */
export function reTangentOf(b: KaijuBody, v: THREE.Vector3): THREE.Vector3 {
  v.addScaledVector(b.dir, -v.dot(b.dir));
  if (v.lengthSq() < 1e-12) {
    // Degenerate only if v was parallel to up; pick any tangent direction.
    v.crossVectors(b.dir, WORLD_Y);
    if (v.lengthSq() < 1e-12) v.crossVectors(b.dir, new THREE.Vector3(1, 0, 0));
  }
  return v.normalize();
}

/** Convenience wrappers bound to the player's body, so existing call sites are untouched. */
export const reTangent = (v: THREE.Vector3) => reTangentOf(body, v);

/** Body-right = forward x up. Tangent, unit. */
export function rightVectorOf(b: KaijuBody, out: THREE.Vector3): THREE.Vector3 {
  return out.crossVectors(b.forward, b.dir).normalize();
}
export const rightVector = (out: THREE.Vector3) => rightVectorOf(body, out);

/** The direction the body is facing, in world space. */
export function facingVector(out: THREE.Vector3): THREE.Vector3 {
  return out.copy(body.forward);
}

/**
 * Rotate a tangent vector about the local up.
 *
 * POSITIVE turns LEFT (counter-clockwise seen from above), which is what a right-handed rotation
 * about local up does. The mouse handler therefore NEGATES movementX, matching the engine's
 * `yaw += -movementX`. An earlier comment here claimed positive was rightward, which was wrong and
 * would have sent the next person fixing "inverted" controls in exactly the wrong direction.
 */
export function turnTangentOf(b: KaijuBody, v: THREE.Vector3, radians: number): THREE.Vector3 {
  return v.applyAxisAngle(b.dir, radians).normalize();
}
export const turnTangent = (v: THREE.Vector3, radians: number) => turnTangentOf(body, v, radians);

/**
 * Advance the simulation.
 *
 * @param dt        seconds
 * @param inputFwd  -1..1 along the facing direction
 * @param inputRight -1..1 across it
 * @param wantJump  jump pressed this frame
 * @param running   sprint held
 * @param heightUnits the Kaiju's height, which sets every speed
 * @param desiredHeading where the camera wants the body to face; it turns toward this
 */
export function stepBodyOf(
  body: KaijuBody,
  dt: number, inputFwd: number, inputRight: number, wantJump: boolean,
  running: boolean, heightUnits: number, desiredForward: THREE.Vector3 | null,
  inputUp = 0,
): void {
  const g = gravityUnits();
  body.lastMoveQuat.identity();

  // Keep `forward` exactly tangent; floating point slowly tilts it out of the plane.
  reTangentOf(body, body.forward);

  // Turn toward the steering direction at a finite rate, so a 300 m body has visible inertia
  // instead of pivoting like a turret.
  if (desiredForward && (inputFwd !== 0 || inputRight !== 0)) {
    _move.copy(desiredForward);
    reTangentOf(body, _move);
    const cos = Math.max(-1, Math.min(1, body.forward.dot(_move)));
    let angle = Math.acos(cos);
    if (angle > 1e-5) {
      // Sign from which side of `forward` the target lies on.
      //
      // NOTE THE MINUS. `turnTangentOf` rotates about `dir` by the right-hand rule, and
      // body-right is `forward x dir`, so a POSITIVE rotation swings `forward` toward
      // MINUS right. Getting this backwards makes a body steer away from wherever it is
      // aiming: it looks like drifting rather than like a broken turn, which is why it
      // survived until the Kaiju arena made three agents chase each other and separate.
      rightVectorOf(body, _right);
      const sign = _move.dot(_right) >= 0 ? -1 : 1;
      angle = Math.min(angle, TURN_RATE * dt);
      turnTangentOf(body, body.forward, sign * angle);
    }
  }

  // Horizontal movement is a ROTATION of the position about an axis, not a translation. That is
  // what keeps the body exactly on the sphere however far it walks, and `forward` is rotated by
  // the SAME rotation (parallel transport) so a straight walk stays on one great circle even
  // over a pole.
  // Submerged when the body's MIDPOINT is below sea level: waist-deep wading still walks.
  const midRadius = body.radius + heightUnits * 0.5;
  body.submerged = midRadius < PLANET_RADIUS;
  body.depthMetres = body.submerged ? (PLANET_RADIUS - midRadius) * METRES_PER_UNIT : 0;

  const topSpeed = (running ? runSpeed(heightUnits) : walkSpeed(heightUnits))
    * (body.submerged ? SWIM_SPEED_FRAC : 1);
  rightVectorOf(body, _right);
  _move.set(0, 0, 0)
    .addScaledVector(body.forward, inputFwd)
    .addScaledVector(_right, inputRight);

  const moveLen = _move.length();
  const wanted = moveLen > 1e-6 ? topSpeed * Math.min(1, moveLen) : 0;

  // MOMENTUM. Ease toward the speed being asked for instead of snapping to it. A 300 m creature
  // that reaches a run in one frame reads as weightless, and it is also why the walk cycle never
  // matched the ground: the gait is chosen from `speed`, so if `speed` is a square wave the legs
  // are too. Ramping it makes the animation follow the body continuously.
  const rampSeconds = wanted > body.moveSpeed ? ACCEL_SECONDS : BRAKE_SECONDS;
  // Crouching for a jump plants the feet: you cannot accelerate while gathering yourself.
  const gathering = body.crouchTimer > 0;
  const rate = topSpeed / Math.max(0.05, rampSeconds * (gathering ? 3 : 1));
  if (wanted > body.moveSpeed) body.moveSpeed = Math.min(wanted, body.moveSpeed + rate * dt);
  else body.moveSpeed = Math.max(wanted, body.moveSpeed - rate * dt);

  // STATIC FRICTION. Below a twentieth of walking pace with nothing asking it to move, stop dead.
  // Without this a body can retain a vanishingly small speed indefinitely and creep across the
  // ground — which at these distances is a Kaiju visibly sliding while standing still.
  if (wanted === 0 && body.onGround && body.moveSpeed < walkSpeed(heightUnits) * 0.05) {
    body.moveSpeed = 0;
  }
  if (body.moveSpeed < 1e-4) body.moveSpeed = 0;

  if (body.moveSpeed > 0 && moveLen > 1e-6) {
    _move.divideScalar(moveLen);
    const dist = body.moveSpeed * dt;
    _axis.crossVectors(body.dir, _move).normalize();
    const angle = dist / Math.max(1, body.radius);
    body.lastMoveQuat.setFromAxisAngle(_axis, angle);
    body.dir.applyQuaternion(body.lastMoveQuat).normalize();
    body.forward.applyQuaternion(body.lastMoveQuat);
    reTangentOf(body, body.forward);
    body.speed = dist / dt;
  } else if (body.moveSpeed > 0) {
    // Still carrying speed with no input: coast along the current heading rather than stopping dead.
    const dist = body.moveSpeed * dt;
    _axis.crossVectors(body.dir, body.forward).normalize();
    body.lastMoveQuat.setFromAxisAngle(_axis, dist / Math.max(1, body.radius));
    body.dir.applyQuaternion(body.lastMoveQuat).normalize();
    body.forward.applyQuaternion(body.lastMoveQuat);
    reTangentOf(body, body.forward);
    body.speed = dist / dt;
  } else {
    body.speed = 0;
  }

  // Vertical: gravity, jump, ground contact.
  const gr = groundRadiusOf(body);
  if (gr == null) {
    // Tiles not loaded here yet. HOLD rather than fall, or the body sinks toward the planet
    // centre while streaming, which is unrecoverable.
    body.vertVel = 0;
    return;
  }

  if (body.submerged) {
    // SWIMMING: full 3D. Vertical is driven directly rather than by gravity, with drag so it
    // settles instead of oscillating, and a slight upward bias so an idle body drifts to the
    // surface rather than sinking forever.
    // `topSpeed`, not a bare `speed` — there is no such variable in this scope, so every frame the
    // body was submerged threw a ReferenceError and the whole physics step died mid-way. Swimming
    // simply did not work, and neither did anything scheduled after it.
    const vSpeed = topSpeed * SWIM_VERT_FRAC;
    if (inputUp !== 0) {
      body.vertVel += (inputUp * vSpeed - body.vertVel) * Math.min(1, WATER_DRAG * dt);
    } else {
      body.vertVel += (g * BUOYANCY - body.vertVel) * Math.min(1, WATER_DRAG * dt);
    }
    body.radius += body.vertVel * dt;
    // Do not breach the surface under swim power; you surface, you do not launch.
    const surface = PLANET_RADIUS - heightUnits * 0.5;
    if (body.radius > surface && body.vertVel > 0) { body.radius = surface; body.vertVel = 0; }
  } else {
    // JUMPING IS A TWO-STAGE MOVE: gather, then leave the ground.
    //
    // Geoff: "if I click jump he needs to slowly squat down and then jump, but it all happens based
    // on real gravity". So the button starts a crouch, the crouch takes a time proportional to the
    // square root of the body's height, and only when it completes does the body get its takeoff
    // velocity — after which real gravity has it, exactly as before.
    if (body.crouchTimer > 0) {
      body.crouchTimer = Math.max(0, body.crouchTimer - dt);
      body.crouchFrac = Math.min(1, body.crouchFrac + dt / Math.max(0.05, crouchSeconds(heightUnits)));
      if (body.crouchTimer === 0) {
        body.vertVel = jumpVelocity(heightUnits);
        body.onGround = false;
        body.crouchFrac = 0;
      }
    } else if (wantJump && body.onGround) {
      body.crouchTimer = crouchSeconds(heightUnits);
      body.crouchFrac = 0;
    } else {
      body.crouchFrac = Math.max(0, body.crouchFrac - dt * 3);
    }
    body.vertVel -= g * dt;
    body.radius += body.vertVel * dt;
  }

  const snap = heightUnits * SNAP_FRAC;
  // ONLY SNAP WHEN FALLING OR LEVEL — never while moving up.
  //
  // This is why jumping did nothing. The snap band is 0.18 units, and the first frame of a jump
  // rises 0.0086 — twenty-one times less — so the body was re-grounded and its velocity zeroed on
  // the very frame it launched, every time. It never left the ground at all; what looked like
  // "bounces back up instantly" was the crouch offset returning.
  if (body.radius <= gr + snap && body.vertVel <= 0) {
    body.radius = gr;
    if (body.vertVel < 0) body.vertVel = 0;
    body.onGround = true;
  } else {
    body.onGround = false;
  }
}

/** Step the PLAYER's body. AI agents call stepBodyOf with their own. */
export function stepBody(
  dt: number, inputFwd: number, inputRight: number, wantJump: boolean,
  running: boolean, heightUnits: number, desiredForward: THREE.Vector3 | null,
  inputUp = 0,
): void {
  stepBodyOf(body, dt, inputFwd, inputRight, wantJump, running, heightUnits, desiredForward, inputUp);
}
