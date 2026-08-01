// kaijuColliders — Kaiju that cannot stand inside each other, and limbs that can actually hit.
//
// Geoff: "the kaijus aren't respecting each others' colliders... The Red demon is just standing
// inside me walking in circles. He doesn't attack with his arm, which would be his main attack."
//
// Both come from the same gap: the fight had NO body volume at all. Agents were points with a
// radius used only for projectile tests, so nothing stopped two 300 m creatures occupying the same
// space, and melee was a cone test from the body centre rather than anything to do with an arm.
//
// TWO LAYERS, deliberately separated:
//
//   SIMULATION capsules — a torso, always present, derived from height alone. Cheap, deterministic
//   and available with no model loaded, which matters because the whole fight is verified headless.
//   Separation and knockback run on these.
//
//   SKELETON capsules — real limbs, read from the animated bones each frame, registered by the
//   renderer when a model exists. Used for melee, so a swing connects when the ARM arrives rather
//   than when the body is nearby. Absent headless, and everything degrades to the torso.
//
// Getting that split wrong is how this kind of system usually rots: put the physics in the
// renderer and it stops being testable, put the limbs in the simulation and it needs the art.

import * as THREE from 'three';

/** A capsule: a segment with a radius, in world space. */
export interface Capsule {
  a: THREE.Vector3;
  b: THREE.Vector3;
  radius: number;
  /** Which body part, for damage weighting and for the tracker. */
  part: 'torso' | 'head' | 'armL' | 'armR' | 'legL' | 'legR';
}

/** Bone-name fragments per limb, matched case-insensitively. Synty rigs first, Mixamo second. */
const LIMB_BONES: { part: Capsule['part']; from: string[]; to: string[]; radiusFrac: number }[] = [
  { part: 'head', from: ['neck'], to: ['head'], radiusFrac: 0.11 },
  { part: 'armL', from: ['upperarm_l', 'leftarm', 'shoulder_l'], to: ['hand_l', 'lefthand'], radiusFrac: 0.075 },
  { part: 'armR', from: ['upperarm_r', 'rightarm', 'shoulder_r'], to: ['hand_r', 'righthand'], radiusFrac: 0.075 },
  { part: 'legL', from: ['upperleg_l', 'leftupleg', 'thigh_l'], to: ['foot_l', 'leftfoot'], radiusFrac: 0.09 },
  { part: 'legR', from: ['upperleg_r', 'rightupleg', 'thigh_r'], to: ['foot_r', 'rightfoot'], radiusFrac: 0.09 },
];

interface Rig {
  pairs: { part: Capsule['part']; from: THREE.Object3D; to: THREE.Object3D; radiusFrac: number }[];
  capsules: Capsule[];
}

const rigs = new Map<string, Rig>();

/**
 * Find the limb bones on a model once, and remember them for this agent.
 *
 * Missing bones are simply skipped rather than faked — a rig without separable arms should fall
 * back to the torso, not sprout an imaginary one in roughly the right place.
 */
export function registerRig(id: string, model: THREE.Object3D): void {
  const byName = new Map<string, THREE.Object3D>();
  model.traverse((o) => { if ((o as THREE.Bone).isBone) byName.set(o.name.toLowerCase(), o); });

  const find = (fragments: string[]): THREE.Object3D | null => {
    for (const f of fragments) {
      for (const [name, obj] of byName) if (name.includes(f)) return obj;
    }
    return null;
  };

  const pairs: Rig['pairs'] = [];
  for (const l of LIMB_BONES) {
    const from = find(l.from);
    const to = find(l.to);
    if (from && to) pairs.push({ part: l.part, from, to, radiusFrac: l.radiusFrac });
  }
  rigs.set(id, { pairs, capsules: [] });
}

export function unregisterRig(id: string): void { rigs.delete(id); }
export function rigLimbCount(id: string): number { return rigs.get(id)?.pairs.length ?? 0; }

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

/**
 * Refresh a rig's world-space limb capsules from the CURRENT animated pose.
 *
 * Called by the renderer each frame, because bone matrices are only meaningful once the animation
 * mixer has run. `heightUnits` sets the capsule radii, so limbs scale with the creature.
 */
export function updateRigCapsules(id: string, heightUnits: number): void {
  const rig = rigs.get(id);
  if (!rig) return;
  rig.capsules.length = 0;
  for (const p of rig.pairs) {
    p.from.getWorldPosition(_a);
    p.to.getWorldPosition(_b);
    rig.capsules.push({
      a: _a.clone(), b: _b.clone(),
      radius: heightUnits * p.radiusFrac,
      part: p.part,
    });
  }
}

/** The limb capsules for an agent, or an empty list if it has no model (headless). */
export function limbCapsules(id: string): Capsule[] { return rigs.get(id)?.capsules ?? []; }

/**
 * Torso radius as a fraction of body height. MEASURED, not estimated.
 *
 * This was 0.25, described in a comment as "about right for these broad-shouldered golems". It was
 * not: scripts/measure-glb-width.mjs evaluates each model's own walk and idle clips and reports how
 * far the bones actually get from the body's centre line, in the TORSO band (hips to shoulders,
 * ignoring hands swinging forward, which are silhouette rather than bulk):
 *
 *     red demon        walk 0.313    idle 0.244
 *     fort golem       walk 0.444    idle 0.287    breathidle 0.532
 *     elemental golem  walk 0.453    idle 0.274    breathidle 0.541
 *
 * At 0.25 each, two Kaiju were held 0.5 x height apart while their chests reached 0.31 and 0.44 —
 * so roughly 78 m of a 300 m creature was inside the other one, before the arms are counted at
 * all. That is Geoff's "the red demon still walks right through me", and no amount of correct
 * separation maths could have fixed it, because the maths was correctly separating the wrong shape.
 *
 * 0.46 covers every walk and run pose. It does not cover the arms-out breathing idle at 0.53, and
 * deliberately not: that would hold two Kaiju 318 m apart, and a hand overlapping while both stand
 * still is a far smaller lie than a pair of creatures that visibly cannot approach each other.
 *
 * Melee still reaches: the hit test allows the attacker's 0.9-body reach PLUS the target's own
 * radius, so two Kaiju touching at 0.92 apart are comfortably inside 1.36.
 */
const TORSO_FRAC = 0.46;

/**
 * The always-available torso capsule: feet to shoulders, up the body's own local up.
 *
 * This is what separation and projectile hits use, so the simulation never depends on art having
 * loaded.
 */
export function torsoCapsule(
  dir: THREE.Vector3, radiusUnits: number, heightUnits: number, out?: Capsule,
): Capsule {
  const feet = (out?.a ?? new THREE.Vector3()).copy(dir).multiplyScalar(radiusUnits);
  const top = (out?.b ?? new THREE.Vector3()).copy(dir).multiplyScalar(radiusUnits + heightUnits * 0.82);
  const r = heightUnits * TORSO_FRAC;
  if (out) { out.radius = r; out.part = 'torso'; return out; }
  return { a: feet, b: top, radius: r, part: 'torso' };
}

/** Exported so the collision check can assert the capsule still covers the measured bodies. */
export const torsoRadiusFrac = TORSO_FRAC;

const _seg = new THREE.Vector3();
const _toP = new THREE.Vector3();

/** Closest point on segment ab to p, written into `out`. */
export function closestOnSegment(a: THREE.Vector3, b: THREE.Vector3, p: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  _seg.copy(b).sub(a);
  const len2 = _seg.lengthSq();
  if (len2 < 1e-12) return out.copy(a);
  _toP.copy(p).sub(a);
  const t = Math.max(0, Math.min(1, _toP.dot(_seg) / len2));
  return out.copy(a).addScaledVector(_seg, t);
}

const _p1 = new THREE.Vector3();
const _p2 = new THREE.Vector3();

/**
 * Do two capsules overlap, and by how much?
 *
 * Returns the penetration depth (positive when overlapping) and writes the push direction — from
 * A toward B — into `axis`. An iterative closest-point between two segments would be more exact;
 * this samples each segment against the other's midpoint and takes the better answer, which for
 * roughly-parallel limb capsules is accurate enough and far cheaper.
 */
export function capsuleOverlap(a: Capsule, b: Capsule, axis: THREE.Vector3): number {
  _p1.copy(b.a).add(b.b).multiplyScalar(0.5);
  closestOnSegment(a.a, a.b, _p1, _p1);
  closestOnSegment(b.a, b.b, _p1, _p2);
  closestOnSegment(a.a, a.b, _p2, _p1);
  axis.copy(_p2).sub(_p1);
  const d = axis.length();
  const reach = a.radius + b.radius;
  if (d < 1e-6) { axis.set(0, 1, 0); return reach; }
  axis.divideScalar(d);
  return reach - d;
}

/** Distance from a point to a capsule's surface. Negative means inside. */
export function pointToCapsule(p: THREE.Vector3, c: Capsule): number {
  closestOnSegment(c.a, c.b, p, _p1);
  return _p1.distanceTo(p) - c.radius;
}
