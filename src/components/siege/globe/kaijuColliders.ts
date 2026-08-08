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

/**
 * Drop an agent's limb capsules without forgetting its rig.
 *
 * For when the model is no longer being posed where the capsules say it is. They are world-space
 * positions captured from a pose, so the instant something stops refreshing them they become solid
 * shapes floating wherever the creature USED to be — an arm hanging in the air that bullets bounce
 * off. Better to have no limbs than limbs somewhere else.
 */
export function clearRigCapsules(id: string): void {
  const rig = rigs.get(id);
  if (rig) rig.capsules.length = 0;
}

/** The limb capsules for an agent, or an empty list if it has no model (headless). */
export function limbCapsules(id: string): Capsule[] { return rigs.get(id)?.capsules ?? []; }

/**
 * Separation radius as a fraction of body height. MEASURED, and it is the BODY.
 *
 * THE HISTORY OF THIS NUMBER IS A LESSON IN OVERCORRECTING.
 *
 * It was 0.25, guessed, and far too narrow — two Kaiju were held half a body apart while their
 * chests reached 0.31 and 0.44, so roughly 78 m of a 300 m creature was inside the other one.
 * Geoff: "the red demon still walks right through me."
 *
 * So I widened it to cover the arms as well, at 0.70, reasoning that arms are what you SEE
 * overlapping. That is when Geoff got this: "there's a big red cylinder around each kaiju and when
 * another kaiju approaches me our oversized huge red colliders collide and it blocks its ability to
 * get near me, so we can't fight." Which is exactly right, and worse than the problem it fixed. At
 * 0.70 two Kaiju are held 420 m apart — more than a body height of clear air between two creatures
 * that are supposed to be brawling. I had made them unable to touch each other in a fighting game.
 *
 * SEPARATION KEEPS BODIES OUT OF EACH OTHER. THAT IS ALL IT IS FOR. Arms passing through each other
 * during a swing is what fighting looks like; two torsos occupying one space is not. So this is now
 * the measured chest width per model — 0.244 on a Red Demon, 0.287 on a Fort Golem — which holds
 * them about 170 m apart: close enough to hit each other, far enough that neither is standing inside
 * the other. The arms are the melee system's business, and they have real bone capsules now.
 *
 * SUPERSEDED by SEPARATION_BY_TYPE below, which is per model and measured in the WALK clip. This
 * remains only as the fallback for a Kaiju whose type is not in that table.
 */
const TORSO_FRAC = 0.453;   // the widest WALKING chest in the roster

/**
 * The widest this may go before a swing can no longer reach a touching target.
 *
 * Now the genuine physical limit rather than a second constant's opinion: at contact two bodies are
 * 2r apart and a swing reaches rangeBodies (0.9) + r, so combat survives while r < 0.9. Kept next to
 * the value it constrains and asserted in check-player-collision, because the failure mode is
 * silent — the Kaiju simply stop fighting and nothing anywhere says why.
 */
export const TORSO_FRAC_CEILING = 0.80;

/**
 * How close an AI must get before it will decide to attack, in body heights.
 *
 * DERIVED, not chosen. It must always be a little further than two colliders touching, or widening
 * the collider silently switches combat off — which is exactly the trap the previous hardcoded 1.3
 * set. The 0.06 is one-off slack so an agent whose target drifts a few metres does not flicker in
 * and out of the decision every frame.
 */
export const MELEE_GATE_BODIES = (meleeRangeBodies: number): number =>
  Math.max(meleeRangeBodies + 0.4, MAX_SEPARATION_FRAC * 2 + 0.06);

/**
 * The always-available torso capsule: feet to shoulders, up the body's own local up.
 *
 * This is what separation and projectile hits use, so the simulation never depends on art having
 * loaded.
 */
export function torsoCapsule(
  dir: THREE.Vector3, radiusUnits: number, heightUnits: number, out?: Capsule,
  radiusFrac = TORSO_FRAC,
): Capsule {
  const feet = (out?.a ?? new THREE.Vector3()).copy(dir).multiplyScalar(radiusUnits);
  const top = (out?.b ?? new THREE.Vector3()).copy(dir).multiplyScalar(radiusUnits + heightUnits * 0.82);
  const r = heightUnits * radiusFrac;
  if (out) { out.radius = r; out.part = 'torso'; return out; }
  return { a: feet, b: top, radius: r, part: 'torso' };
}

/**
 * A MUCH narrower torso, for things that have to touch the creature you can SEE.
 *
 * Geoff: "there's no flash when it hits that kaiju... but I do see the bounce."
 *
 * Both halves of that are explained by one mistake. The separation collider above is deliberately
 * generous — 0.70 of body height, sized so two Kaiju cannot put their ARMS inside each other, which
 * makes it a cylinder 210 m in radius around a creature whose chest is about 100 m. That is correct
 * for keeping bodies apart and completely wrong for a bullet: rounds were bouncing off thin air a
 * hundred metres short of the monster, so the ricochet was visible and the impact spark was floating
 * in the sky beside it rather than landing on its hide.
 *
 * 0.34 is the measured torso half-width: 0.313 on the Red Demon, 0.444 on the golems, from
 * scripts/measure-glb-width.mjs. Sitting between the two means sparks land just proud of the Demon's
 * chest and just inside the golems', which the render then nudges toward the camera to clear. The
 * arms, legs and head are covered by their own bone capsules and are unaffected by this number.
 */
export const BULLET_TORSO_FRAC = 0.34;

/**
 * ...and PER MODEL, and narrower than it looks, because the arms have their own colliders now.
 *
 * SECOND ATTEMPT at this, and the first one was still too wide. measure-glb-width reports two
 * numbers per model: the spread during the WALK clip and during IDLE. I used walk — 0.444 on a Fort
 * Golem — on the reasoning that it is the pose you usually see. But that band runs from hips to
 * shoulders and therefore INCLUDES THE UPPER ARMS AS THEY SWING, so it measures the creature's
 * widest reach rather than its chest. A capsule that size stands 40 m proud of the body, and a round
 * that stops 40 m short sparks in clear air: Geoff's invisible wall, twice.
 *
 * The IDLE figures are the body core, which is what this should always have been. The arms are not
 * missing from the hit test — they have their own bone capsules, which is the whole point of having
 * wired the rig up. Torso for the chest, limbs for the limbs, nothing pretending to be both.
 *
 * Geoff: "when they shoot at my kaiju, the bullets don't hit my kaiju... they are hitting an
 * invisible wall between my kaiju and them, as if the colliders are in the wrong place and don't
 * match with my mesh."
 *
 * A single 0.34 was a compromise between a Red Demon whose chest is 0.313 of its height and golems
 * whose chests are 0.444 — so it stood 8 m proud of the Demon and 40 m inside a golem. Proud is what
 * reads as an invisible wall: the round stops, sparks and bounces in clear air short of the body.
 *
 * These are measured, by scripts/measure-glb-width.mjs, off each model's own walk clip. Keyed by the
 * catalog's monster type so a Kaiju that is not in the list falls back to the average rather than to
 * something confidently wrong.
 */
/**
 * MEASURED IN THE POSE THEY ARE DRAWN IN, which is walking, not idling.
 *
 * These were the IDLE torso — 0.287 for a Fort Golem — and a golem's chest is 0.444 while it walks.
 * A Kaiju spends its fight walking, so the bullet collider was a third narrower than the creature
 * for almost the whole time it mattered. Numbers from scripts/measure-glb-width, which evaluates
 * each model's own clips.
 */
export const BULLET_TORSO_BY_TYPE: Record<number, number> = {
  8: 0.313,    // Red Demon,       walk
  15: 0.453,   // Elemental Golem, walk
  16: 0.450,   // Mechanical Golem — same family as the other two golems
  17: 0.444,   // Fort Golem,      walk
};

export const bulletTorsoFrac = (monsterType: number): number =>
  BULLET_TORSO_BY_TYPE[monsterType] ?? BULLET_TORSO_FRAC;

/**
 * HOW WIDE A KAIJU IS FOR THE PURPOSE OF NOT STANDING INSIDE ANOTHER ONE.
 *
 * Geoff: "there are no collider effects when kaijus meet... they go right through each other. Also,
 * the kaiju I have somehow ended up on top of the other one."
 *
 * THIS NUMBER HAS NOW BEEN WRONG IN BOTH DIRECTIONS, and the middle is not a compromise — it is a
 * specific, measurable thing.
 *
 *   0.70, the FULL ARM REACH. Rejected, by Geoff, in these words: "there's a big red cylinder around
 *   each kaiju and when another kaiju approaches me our oversized huge red colliders collide and it
 *   blocks its ability to get near me, so we can't fight." Correct: it holds two golems 412 m apart
 *   when their arms only reach 206 m each, so they can never touch. Unable to fight, in a fighting
 *   game.
 *
 *   0.287, THE CHEST — BUT MEASURED WHILE IDLING. The overcorrection, and where it stood until now.
 *   A Kaiju spends its entire fight WALKING, and a walking golem's chest is 0.444 of its height, not
 *   0.287. So the collider was a third narrower than the creature for the whole time it mattered:
 *   two golems held 172 m apart with 266 m of combined chest, which is 94 m of torso inside torso.
 *   That is "they go right through each other", and on sloping ground it is also how one ends up
 *   drawn on top of the other.
 *
 * THE CHEST, IN THE POSE IT IS ACTUALLY IN. Torsos then just touch and never interpenetrate, while
 * the arms still overlap by 145 m so the two can reach each other and brawl. Which is the whole
 * point: two bodies occupying one space is a bug, arms passing through each other during a swing is
 * what fighting looks like.
 *
 * Walk-clip measurements from scripts/measure-glb-width:
 *
 *     red demon        chest 0.313   reach 0.548
 *     fort golem       chest 0.444   reach 0.686
 *     elemental golem  chest 0.453   reach 0.672
 */
export const SEPARATION_BY_TYPE: Record<number, number> = {
  8: 0.313,    // Red Demon
  15: 0.453,   // Elemental Golem
  16: 0.450,   // Mechanical Golem — unmeasured; the family average
  17: 0.444,   // Fort Golem
};

/**
 * Full arm reach per model, from the same walk-clip measurement. NOT used for separation — this is
 * how far a creature can put a limb, which is what the mesh broad phase has to cover.
 */
export const REACH_BY_TYPE: Record<number, number> = {
  8: 0.548, 15: 0.672, 16: 0.686, 17: 0.686,
};
/** The furthest any Kaiju can reach. The mesh test's broad phase is derived from this. */
export const MAX_REACH_FRAC = Math.max(...Object.values(REACH_BY_TYPE));

/** The widest any Kaiju separates at. The melee gate is derived from this so the two cannot drift. */
export const MAX_SEPARATION_FRAC = Math.max(...Object.values(SEPARATION_BY_TYPE));

/**
 * What the PLAYER'S Kaiju is currently drawn as. Pushed in by the renderer, never read from it.
 *
 * Lives here rather than with the gunfire because the ARENA needs it too now, and the arena cannot
 * import the gunfire without a cycle. `type: -1` means nothing has been reported yet, in which case
 * the agent's own build is used.
 */
export const playerVisual = { type: -1, height: 0 };
export function setPlayerVisual(type: number, height: number): void {
  playerVisual.type = type;
  playerVisual.height = height;
}

/**
 * How wide this agent is for SEPARATION, preferring whatever is actually on screen for the player.
 *
 * Deliberately NOT called something generic like `bodyFracFor`. A name that does not say which of
 * the two body widths it means is how the bullet collider ended up doing the physics.
 */
export const separationFracFor = (isPlayer: boolean, monsterType: number): number => {
  const t = isPlayer && playerVisual.type >= 0 ? playerVisual.type : monsterType;
  return SEPARATION_BY_TYPE[t] ?? TORSO_FRAC;
};

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

// --- BULLETS ------------------------------------------------------------------------------------
//
// A rifle bullet is a SEGMENT, not a point, so hitting a Kaiju with one is a segment-vs-capsule
// question rather than the point-vs-capsule test above.
//
// WHY NOT A REAL MESH COLLIDER. three-mesh-bvh is already a dependency and would give exact
// per-triangle hits — on a STATIC mesh. A Kaiju is a skinned mesh: its triangles only exist in the
// pose after skinning, which happens on the GPU. Testing against them on the CPU means re-skinning
// every vertex each frame and refitting the BVH, for every Kaiju, forever. That is the single most
// expensive thing this scene could do, and it buys nothing visible: at 300 m tall a spark placed on
// the surface of an arm-shaped capsule and a spark placed on the exact triangle of that arm are the
// same handful of pixels. So the collider is the SKELETON — capsules that follow the real animated
// bones — which is what shipped games do for exactly this reason.

const _d1 = new THREE.Vector3();
const _d2 = new THREE.Vector3();
const _r = new THREE.Vector3();

/**
 * Closest approach between two segments. Returns the distance; writes the parameter along the first
 * segment into `outT` (index 0) so a caller can work out WHERE along a bullet's flight it happened.
 *
 * The standard clamped solution — the degenerate cases (either segment a point, the two parallel)
 * matter here because a bullet fired point-blank and a limb capsule can both collapse.
 */
export function segmentDistance(
  p0: THREE.Vector3, p1: THREE.Vector3, q0: THREE.Vector3, q1: THREE.Vector3, outT: Float64Array,
): number {
  _d1.copy(p1).sub(p0);
  _d2.copy(q1).sub(q0);
  _r.copy(p0).sub(q0);
  const a = _d1.dot(_d1), e = _d2.dot(_d2), f = _d2.dot(_r);
  let s = 0, t = 0;
  if (a < 1e-12 && e < 1e-12) { outT[0] = 0; return _r.length(); }
  if (a < 1e-12) { t = Math.min(1, Math.max(0, f / e)); }
  else {
    const c = _d1.dot(_r);
    if (e < 1e-12) { s = Math.min(1, Math.max(0, -c / a)); }
    else {
      const b = _d1.dot(_d2);
      const denom = a * e - b * b;
      s = denom > 1e-12 ? Math.min(1, Math.max(0, (b * f - c * e) / denom)) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -c / a)); }
      else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (b - c) / a)); }
    }
  }
  outT[0] = s;
  _p1.copy(p0).addScaledVector(_d1, s);
  _p2.copy(q0).addScaledVector(_d2, t);
  return _p1.distanceTo(_p2);
}

const _tOut = new Float64Array(1);

/**
 * Where a bullet fired from `from` to `to` first meets a capsule, or null if it misses.
 *
 * Writes the ENTRY point — the near surface — into `out`, not the closest-approach point, because a
 * spark belongs on the skin the bullet struck rather than buried inside the limb. Returns the
 * fraction along the shot, so the nearest of several hits can be picked.
 */
export function shotHitsCapsule(
  from: THREE.Vector3, to: THREE.Vector3, c: Capsule, out: THREE.Vector3,
): number | null {
  const d = segmentDistance(from, to, c.a, c.b, _tOut);
  if (d > c.radius) return null;
  const len = from.distanceTo(to);
  if (len < 1e-9) return null;
  // Step back from closest approach to where the bullet crossed the surface.
  const halfChord = Math.sqrt(Math.max(0, c.radius * c.radius - d * d)) / len;
  const t = Math.max(0, Math.min(1, _tOut[0] - halfChord));
  out.copy(from).lerp(to, t);
  return t;
}
