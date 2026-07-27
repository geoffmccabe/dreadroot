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
  /** Metres below sea level (0 on land or at the surface). */
  depthMetres: number;
}

export const body: KaijuBody = {
  dir: new THREE.Vector3(0, 0, 1),
  radius: PLANET_RADIUS + 1,
  vertVel: 0,
  forward: new THREE.Vector3(0, 1, 0),
  onGround: false,
  speed: 0,
  /** Rotation applied to `dir` by the last move, so callers can transport their own vectors with it. */
  lastMoveQuat: new THREE.Quaternion(),
  submerged: false,
  depthMetres: 0,
};

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

/** World position of the body's feet. */
export function feetPosition(out: THREE.Vector3): THREE.Vector3 {
  return out.copy(body.dir).multiplyScalar(body.radius);
}

/** Terrain radius (planet centre to ground) under the body, or null if tiles are not loaded. */
export function groundRadius(): number | null {
  const m = sampleGlobeSurface(body.dir.x, body.dir.y, body.dir.z);
  return m == null ? null : PLANET_RADIUS + m / METRES_PER_UNIT;
}

/** Place the body at a lat/lon-derived direction, standing on the ground. */
export function placeOnSurface(dir: THREE.Vector3, forward?: THREE.Vector3): void {
  body.dir.copy(dir).normalize();
  if (forward) body.forward.copy(forward);
  reTangent(body.forward);
  const g = groundRadius();
  body.radius = (g ?? PLANET_RADIUS) + 0.01;
  body.vertVel = 0;
  body.onGround = true;
}

const _move = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _right = new THREE.Vector3();
const WORLD_Y = new THREE.Vector3(0, 1, 0);

/** Re-project `v` onto the tangent plane at the body and normalise. Kills accumulated drift. */
export function reTangent(v: THREE.Vector3): THREE.Vector3 {
  v.addScaledVector(body.dir, -v.dot(body.dir));
  if (v.lengthSq() < 1e-12) {
    // Degenerate only if v was parallel to up; pick any tangent direction.
    v.crossVectors(body.dir, WORLD_Y);
    if (v.lengthSq() < 1e-12) v.crossVectors(body.dir, new THREE.Vector3(1, 0, 0));
  }
  return v.normalize();
}

/** Body-right = forward x up. Tangent, unit. */
export function rightVector(out: THREE.Vector3): THREE.Vector3 {
  return out.crossVectors(body.forward, body.dir).normalize();
}

/** The direction the body is facing, in world space. */
export function facingVector(out: THREE.Vector3): THREE.Vector3 {
  return out.copy(body.forward);
}

/** Rotate a tangent vector about the local up by `radians` (positive = toward body-right). */
export function turnTangent(v: THREE.Vector3, radians: number): THREE.Vector3 {
  return v.applyAxisAngle(body.dir, radians).normalize();
}

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
export function stepBody(
  dt: number, inputFwd: number, inputRight: number, wantJump: boolean,
  running: boolean, heightUnits: number, desiredForward: THREE.Vector3 | null,
  inputUp = 0,
): void {
  const g = gravityUnits();
  body.lastMoveQuat.identity();

  // Keep `forward` exactly tangent; floating point slowly tilts it out of the plane.
  reTangent(body.forward);

  // Turn toward the steering direction at a finite rate, so a 300 m body has visible inertia
  // instead of pivoting like a turret.
  if (desiredForward && (inputFwd !== 0 || inputRight !== 0)) {
    _move.copy(desiredForward);
    reTangent(_move);
    const cos = Math.max(-1, Math.min(1, body.forward.dot(_move)));
    let angle = Math.acos(cos);
    if (angle > 1e-5) {
      // Sign from which side of `forward` the target lies on.
      rightVector(_right);
      const sign = _move.dot(_right) >= 0 ? 1 : -1;
      angle = Math.min(angle, TURN_RATE * dt);
      turnTangent(body.forward, sign * angle);
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

  const speed = (running ? runSpeed(heightUnits) : walkSpeed(heightUnits))
    * (body.submerged ? SWIM_SPEED_FRAC : 1);
  rightVector(_right);
  _move.set(0, 0, 0)
    .addScaledVector(body.forward, inputFwd)
    .addScaledVector(_right, inputRight);

  const moveLen = _move.length();
  if (moveLen > 1e-6) {
    _move.divideScalar(moveLen);
    const dist = speed * dt * Math.min(1, moveLen);
    _axis.crossVectors(body.dir, _move).normalize();
    const angle = dist / Math.max(1, body.radius);
    body.lastMoveQuat.setFromAxisAngle(_axis, angle);
    body.dir.applyQuaternion(body.lastMoveQuat).normalize();
    body.forward.applyQuaternion(body.lastMoveQuat);
    reTangent(body.forward);
    body.speed = dist / dt;
  } else {
    body.speed = 0;
  }

  // Vertical: gravity, jump, ground contact.
  const gr = groundRadius();
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
    const vSpeed = speed * SWIM_VERT_FRAC;
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
    if (wantJump && body.onGround) {
      body.vertVel = jumpVelocity(heightUnits);
      body.onGround = false;
    }
    body.vertVel -= g * dt;
    body.radius += body.vertVel * dt;
  }

  const snap = heightUnits * SNAP_FRAC;
  if (body.radius <= gr + snap) {
    body.radius = gr;
    if (body.vertVel < 0) body.vertVel = 0;
    body.onGround = true;
  } else {
    body.onGround = false;
  }
}
