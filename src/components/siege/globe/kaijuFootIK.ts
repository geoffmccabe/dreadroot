// kaijuFootIK — feet that touch the ground they are standing on.
//
// Geoff: "right now they stand on the ground and one foot may be floating in the air, because the
// ground isn't even."
//
// He is describing the oldest problem in character rendering. An animation clip is authored on a
// flat floor, so the walk cycle puts each foot at a fixed height below the hips — and the moment
// that is played on a hillside one foot hangs in the air and the other is buried to the ankle.
// Nothing in the clip knows the terrain exists.
//
// NO PHYSICS LIBRARY IS NEEDED FOR THIS, and it is worth saying why, because it is the obvious place
// to reach for one. Rapier, Cannon and Ammo solve rigid bodies colliding under forces — they answer
// "where does this fall to". That is the wrong question. The foot's position is not in doubt: the
// terrain height under it is known exactly, from the same sampler the body already stands on. The
// only question is what the KNEE and HIP must do so the foot arrives there, and that is inverse
// kinematics — geometry, not simulation. Bringing in a physics engine would add a megabyte of WASM,
// a second source of truth about where the ground is, and a solver fighting the animation every
// frame, in order to compute something the law of cosines gives exactly in one step.
//
// THE STANDARD PIPELINE, and this is it in order:
//
//   1. Ask the ground how high it is under each foot, where the foot ACTUALLY is right now.
//   2. Work out how far each foot must move to reach it.
//   3. DROP THE HIPS by whichever foot has to reach down furthest. This is the step people miss:
//      without it the lower leg simply stretches, and a stretched leg reads far worse than a
//      crouched one. Lowering the body is what a person does on a slope.
//   4. Solve two-bone IK per leg so the foot lands on its target.
//   5. Roll the foot to lie along the slope, so it meets the hillside flat instead of on one edge.
//
// THE SOLVER IS ANALYTIC, and that was not the first choice. The repo already had a two-bone IK for
// the characters' gun hands, and reusing it was the obvious move — but measured on a leg it delivered
// three units of a twenty-five unit correction. It iterates toward the answer from the current pose,
// which converges nicely for a hand reaching a nearby grip and barely moves for a leg that has to
// fold to less than its own length. A leg is the easy case for the closed form: two bones, a target,
// and a knee that only bends one way. The law of cosines gives the exact knee angle in one step, with
// no iteration to under-converge, and the answer can be checked to floating point.

import * as THREE from 'three';

/** One leg: hip joint, knee, ankle. */
export interface Leg {
  thigh: THREE.Object3D;
  calf: THREE.Object3D;
  foot: THREE.Object3D;
}

export interface LegRig {
  /** The bone the whole lower body hangs from, dropped to let the low foot reach. */
  hips: THREE.Object3D | null;
  left: Leg | null;
  right: Leg | null;
  /** Rest height of the hips above the feet, in model units — the scale everything is judged against. */
  standHeight: number;
}

/** Bone-name fragments, in the same style and order as kaijuColliders' limb table. */
const LEG_BONES = {
  thigh: { l: ['upperleg_l', 'leftupleg', 'thigh_l', 'upperlegl', 'thighl'], r: ['upperleg_r', 'rightupleg', 'thigh_r', 'upperlegr', 'thighr'] },
  calf: { l: ['lowerleg_l', 'leftleg', 'calf_l', 'lowerlegl', 'calfl', 'shin_l'], r: ['lowerleg_r', 'rightleg', 'calf_r', 'lowerlegr', 'calfr', 'shin_r'] },
  foot: { l: ['foot_l', 'leftfoot', 'footl', 'ankle_l'], r: ['foot_r', 'rightfoot', 'footr', 'ankle_r'] },
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9_]/g, '');

/**
 * Find both legs on a model. Returns nulls rather than guesses — a rig without a recognisable knee
 * must fall back to playing the clip untouched, not have one invented in roughly the right place.
 */
export function findLegRig(root: THREE.Object3D): LegRig {
  const bones = new Map<string, THREE.Object3D>();
  root.traverse((o) => { if ((o as THREE.Bone).isBone) bones.set(norm(o.name), o); });

  const find = (frags: string[]): THREE.Object3D | null => {
    for (const f of frags) for (const [name, obj] of bones) if (name.includes(f)) return obj;
    return null;
  };
  const leg = (side: 'l' | 'r'): Leg | null => {
    const thigh = find(LEG_BONES.thigh[side]);
    const calf = find(LEG_BONES.calf[side]);
    const foot = find(LEG_BONES.foot[side]);
    return thigh && calf && foot ? { thigh, calf, foot } : null;
  };
  const left = leg('l');
  const right = leg('r');

  // The hips are whatever both thighs hang from. Derived rather than matched by name, because that
  // bone is called Hips, Pelvis, Bip01 or Root depending on who exported it, and the hierarchy is
  // never ambiguous.
  let hips: THREE.Object3D | null = null;
  if (left && right) {
    const chain = new Set<THREE.Object3D>();
    for (let p: THREE.Object3D | null = left.thigh.parent; p; p = p.parent) chain.add(p);
    for (let p: THREE.Object3D | null = right.thigh.parent; p; p = p.parent) {
      if (chain.has(p)) { hips = p; break; }
    }
  } else if (left || right) {
    hips = (left ?? right)!.thigh.parent;
  }

  // How tall this creature stands in its own units, measured hips-to-foot, so the limits below can
  // be expressed as fractions of a leg rather than as magic numbers.
  let standHeight = 1;
  const anyLeg = left ?? right;
  if (anyLeg && hips) {
    const h = new THREE.Vector3(); const f = new THREE.Vector3();
    hips.getWorldPosition(h); anyLeg.foot.getWorldPosition(f);
    // RADIALLY, not as a straight-line distance. The feet are set apart sideways, so the 3D distance
    // from the hips to a foot is the hypotenuse and comes out longer than the creature's actual
    // standing height — which then inflates every limit expressed as a fraction of it.
    standHeight = Math.max(1e-4, h.length() - f.length());
  }
  return { hips, left, right, standHeight };
}

/** How far the hips may drop, as a fraction of leg length. Past this it is a crouch, not a slope. */
const MAX_HIP_DROP = 0.34;
/** How far a foot may be lifted above where the clip put it, same units. */
const MAX_FOOT_LIFT = 0.55;
/** How fast the correction eases in and out, per second. Stops a step onto a ledge from snapping. */
const EASE_PER_SEC = 7;

export interface FootPlantResult {
  /** How far the hips were lowered, in model units. Zero on flat ground. */
  hipDrop: number;
  /** How far each foot was moved to reach the ground. */
  liftL: number;
  liftR: number;
  /** False when the rig had no usable legs, so a caller can say so rather than wonder. */
  solved: boolean;
}

const _fw = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _target = new THREE.Vector3();
const _hipPos = new THREE.Vector3();
const _up = new THREE.Vector3();
const _nrm = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _wq = new THREE.Quaternion();
const _pq = new THREE.Quaternion();

const _hipW = new THREE.Vector3();
const _kneeW = new THREE.Vector3();
const _footW = new THREE.Vector3();
const _seedAxis = new THREE.Vector3();
const _seedQ = new THREE.Quaternion();
const _aim = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _kneeGoal = new THREE.Vector3();
const _footGoal = new THREE.Vector3();
const _cur = new THREE.Vector3();
const _des = new THREE.Vector3();

/** Point a bone's chain-direction at `desired`, both in world space. */
function aimBone(bone: THREE.Object3D, from: THREE.Vector3, current: THREE.Vector3, desired: THREE.Vector3): void {
  _cur.copy(current).sub(from);
  _des.copy(desired).sub(from);
  if (_cur.lengthSq() < 1e-16 || _des.lengthSq() < 1e-16) return;
  _q.setFromUnitVectors(_cur.normalize(), _des.normalize());
  bone.getWorldQuaternion(_wq);
  _wq.premultiply(_q);
  bone.parent!.getWorldQuaternion(_pq);
  bone.quaternion.copy(_pq.invert().multiply(_wq));
  bone.updateMatrixWorld(true);
}

/**
 * Exact two-bone IK. Puts `foot` on `target` by bending the knee, with `pole` deciding which way.
 *
 * The construction is the intersection of two spheres — one of thigh-length about the hip, one of
 * calf-length about the target — which is a circle. The pole picks the point on that circle, and that
 * is the entire reason a pole is needed at all: without one the knee is free to be anywhere on a ring
 * around the leg, and a solver that picks arbitrarily gives a knee that bends sideways.
 *
 * Returns false when the rig is degenerate, so a caller can leave the animation alone rather than
 * apply a half-solved pose.
 */
export function solveTwoBone(
  thigh: THREE.Object3D, calf: THREE.Object3D, foot: THREE.Object3D,
  target: THREE.Vector3, pole: THREE.Vector3 | null,
): boolean {
  thigh.getWorldPosition(_hipW);
  calf.getWorldPosition(_kneeW);
  foot.getWorldPosition(_footW);
  const l1 = _hipW.distanceTo(_kneeW);
  const l2 = _kneeW.distanceTo(_footW);
  if (l1 < 1e-6 || l2 < 1e-6) return false;

  _aim.copy(target).sub(_hipW);
  // REACH IS FINITE. Clamped just inside full extension and just outside full fold, because at
  // exactly those distances the circle collapses to a point and the square root below goes imaginary.
  const d = Math.min(l1 + l2 - 1e-4, Math.max(Math.abs(l1 - l2) + 1e-4, _aim.length()));
  if (_aim.lengthSq() < 1e-16) return false;
  _aim.normalize();

  // Where the knee sits: x along the hip-to-target line, h out to the side of it.
  const x = (d * d + l1 * l1 - l2 * l2) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - x * x));

  // The bend plane. Prefer the knee's CURRENT direction so an animation's own bend is respected, and
  // fall back to the pole only when the leg is too straight to have one.
  _pole.copy(_kneeW).sub(_hipW);
  _pole.addScaledVector(_aim, -_pole.dot(_aim));
  if (_pole.lengthSq() < 1e-8 && pole) {
    _pole.copy(pole).addScaledVector(_aim, -pole.dot(_aim));
  }
  if (_pole.lengthSq() < 1e-12) {
    _pole.set(0, 1, 0).addScaledVector(_aim, -_aim.y);
    if (_pole.lengthSq() < 1e-12) _pole.set(1, 0, 0).addScaledVector(_aim, -_aim.x);
    if (_pole.lengthSq() < 1e-12) return false;
  }
  _pole.normalize();

  _kneeGoal.copy(_hipW).addScaledVector(_aim, x).addScaledVector(_pole, h);
  _footGoal.copy(_hipW).addScaledVector(_aim, d);

  aimBone(thigh, _hipW, _kneeW, _kneeGoal);
  // The knee has moved, so where the foot is NOW has to be re-read before aiming the calf at it.
  calf.getWorldPosition(_kneeW);
  foot.getWorldPosition(_footW);
  aimBone(calf, _kneeW, _footW, _footGoal);
  return true;
}

/** Smoothed state per rig, so corrections ease instead of popping. */
const smooth = new Map<string, { hip: number; l: number; r: number }>();
export function clearFootIK(id?: string): void {
  if (id) smooth.delete(id); else smooth.clear();
}

/** Live readout, so "are the feet planted?" is answerable by looking. */
export const footIkDiag = { rigs: 0, hipDropM: 0, liftM: 0 };

/**
 * How far a foot must move, along its own up, to sit on the ground.
 *
 * Pure and exported so the arithmetic can be checked without a planet: positive means the foot is
 * BELOW the ground and must come up, negative means it is hanging in the air.
 */
export function footOffsetToGround(
  footWorld: THREE.Vector3, groundRadius: number, soleClearance: number,
): number {
  return groundRadius + soleClearance - footWorld.length();
}

/**
 * Plant both feet on the terrain.
 *
 * `groundRadiusAt` returns the distance from the planet centre to the surface under a direction, or
 * null where terrain has not streamed in — in which case that foot is left exactly as the animation
 * posed it, which is always better than moving it somewhere invented.
 *
 * Call AFTER the animation mixer and AFTER any hit reaction, because it corrects whatever pose those
 * produced. Call BEFORE anything reads bone positions for colliders, or they describe a pose the
 * screen never showed.
 */
export function plantFeet(
  id: string,
  rig: LegRig,
  group: THREE.Object3D,
  bodyGroundRadius: number,
  groundRadiusAt: (dir: THREE.Vector3) => number | null,
  normalAt: ((dir: THREE.Vector3, out: THREE.Vector3) => THREE.Vector3) | null,
  dt: number,
  weight = 1,
  kneeForward: THREE.Vector3 | null = null,
): FootPlantResult {
  const out: FootPlantResult = { hipDrop: 0, liftL: 0, liftR: 0, solved: false };
  if (!rig.hips || (!rig.left && !rig.right)) return out;

  const legs: { leg: Leg; side: 'l' | 'r' }[] = [];
  if (rig.left) legs.push({ leg: rig.left, side: 'l' });
  if (rig.right) legs.push({ leg: rig.right, side: 'r' });

  // 1 + 2. HOW FAR IS THE GROUND UNDER EACH FOOT FROM THE GROUND THE BODY THINKS IT IS ON.
  //
  // RELATIVE, and that is the whole trick. The clip was authored on a flat floor, so it already puts
  // each foot at the right height above the body's own footing — sole thickness, ankle offset and
  // all. Asking "how high is the terrain here compared to where the body is standing" needs none of
  // that: it is exactly zero on flat ground, whatever the model's proportions, so a solver measured
  // this way cannot fight an animation it has no business touching.
  //
  // The first version compared the foot's absolute height to the terrain plus a guessed sole
  // thickness, and lifted BOTH feet by that guess on perfectly flat ground.
  const need: number[] = [];
  for (const { leg } of legs) {
    leg.foot.getWorldPosition(_fw);
    _dir.copy(_fw).normalize();
    const g = groundRadiusAt(_dir);
    // Unknown ground: this foot asks for nothing rather than for something made up.
    need.push(g == null ? 0 : g - bodyGroundRadius);
  }

  // 3. DROP THE BODY by the foot that has to reach down furthest — the most NEGATIVE requirement.
  // Both feet then have that much less to do, and neither leg has to stretch to reach.
  const lowest = Math.min(...need, 0);
  const wantDrop = Math.max(-rig.standHeight * MAX_HIP_DROP, lowest);

  const sm = smooth.get(id) ?? { hip: 0, l: 0, r: 0 };
  const ease = 1 - Math.exp(-EASE_PER_SEC * Math.min(dt, 0.1));
  sm.hip += (wantDrop * weight - sm.hip) * ease;

  // APPLIED TO THE GROUP, NOT THE HIP BONE, and that is not a stylistic choice.
  //
  // The renderer rewrites this group's position from the body every single frame, so nudging it is
  // idempotent: next frame starts clean. Writing into the hip BONE is not — it accumulated, and over
  // three hundred frames walked the creature a thousand units into the earth while every limit in
  // this file reported that it had held. Caught by the cliff test, which is the only reason I know.
  // UP COMES FROM THE HIPS, NOT FROM THE GROUP. On a sphere "up" is the direction away from the
  // planet centre AT THE CREATURE — and the group's own origin may be anywhere, including exactly at
  // the world centre, where it has no direction at all. Read from the group it silently did nothing.
  rig.hips.getWorldPosition(_hipPos);
  if (_hipPos.lengthSq() > 1e-9 && Math.abs(sm.hip) > 1e-6) {
    _up.copy(_hipPos).normalize();
    // ...and the group is moved in its PARENT's frame, which is where its position lives.
    if (group.parent) {
      group.parent.getWorldQuaternion(_wq);
      _up.applyQuaternion(_pq.copy(_wq).invert());
    }
    group.position.addScaledVector(_up, sm.hip);
    group.updateMatrixWorld(true);
  }

  // 4 + 5. EACH FOOT TO ITS TARGET, then rolled onto the slope. The body has already come down by
  // sm.hip, so each foot only has to make up the difference.
  legs.forEach(({ leg, side }, i) => {
    const raw = Math.min(need[i] - sm.hip, rig.standHeight * MAX_FOOT_LIFT);
    const key = side === 'l' ? 'l' : 'r';
    sm[key] += (raw * weight - sm[key]) * ease;
    const lift = sm[key];
    if (Math.abs(lift) < 1e-5) return;

    leg.foot.getWorldPosition(_fw);
    _up.copy(_fw).normalize();
    _target.copy(_fw).addScaledVector(_up, lift);
    solveTwoBone(leg.thigh, leg.calf, leg.foot, _target, kneeForward);

    // Lie the foot along the hillside. Without this it meets a slope on one corner, which on a
    // 300 m creature is a fifteen-metre gap under the heel.
    if (normalAt) {
      leg.foot.getWorldPosition(_fw);
      _dir.copy(_fw).normalize();
      normalAt(_dir, _nrm);
      if (_nrm.lengthSq() > 1e-9) {
        _q.setFromUnitVectors(_dir, _nrm.normalize());
        leg.foot.getWorldQuaternion(_wq);
        _wq.premultiply(_q);
        leg.foot.parent!.getWorldQuaternion(_pq);
        leg.foot.quaternion.copy(_pq.invert().multiply(_wq));
        leg.foot.updateMatrixWorld(true);
      }
    }
    if (side === 'l') out.liftL = lift; else out.liftR = lift;
  });

  smooth.set(id, sm);
  out.hipDrop = sm.hip;
  out.solved = true;
  footIkDiag.rigs = smooth.size;
  footIkDiag.hipDropM = Math.abs(sm.hip);
  footIkDiag.liftM = Math.max(Math.abs(out.liftL), Math.abs(out.liftR));
  return out;
}
