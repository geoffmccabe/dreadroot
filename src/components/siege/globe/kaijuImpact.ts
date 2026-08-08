// kaijuImpact — what a 300 m creature feels when something hits it.
//
// Geoff: "The red demon comes to me and swipes at me with an attack of his arm, but it passes right
// through me. I really want that swipe to have physics... They should be fairly stiff and not super
// soft rag dolls, but when he swipes and hits me then the physics should be applied to knock the
// skeleton of my kaiju and that force transmits throughout my skeleton."
//
// It passed through because the player is EXEMPT from knockback — kaijuArena zeroes it every tick,
// deliberately, because being shoved by physics you did not initiate reads as the controls breaking.
// So the blow landed, did damage, and produced no motion whatsoever.
//
// WHY THIS IS NOT A RAGDOLL. A ragdoll replaces the animation with a physics solve: the creature
// goes limp and falls. That is the right tool for a corpse and completely the wrong one for a
// creature that gets hit and keeps walking. What is wanted is the blow to BEND the skeleton away and
// have it spring back while the walk carries on underneath — which is a different technique
// entirely, and a much cheaper one.
//
// SO: every bone is a torsional spring with a damper on it, holding it to whatever pose the
// animation asked for. A hit injects angular velocity; the spring pulls it back. Stiff springs give
// a sharp flinch that recovers fast (what Geoff asked for); soft ones would wobble like jelly.
//
// HOW THE FORCE TRAVELS. The blow lands at a point in space, and every joint feels a torque about
// it — that is just the moment arm, r x F. Joints near the impact take the most, joints further
// along the chain take less, and heavy joints near the root barely move because they are carrying
// the whole body. So the arm that was struck snaps back hard, the shoulder follows, the spine
// registers it, and the far leg twitches. Nobody has to author that; it falls out of the geometry.
//
// EVERYTHING HERE IS DETERMINISTIC and depends only on state, elapsed time and the hit — no
// randomness, no reading the clock — so a fight resolves the same way with or without a renderer
// attached, and check-kaiju-impact can drive it headlessly against a synthetic skeleton.

import * as THREE from 'three';

/**
 * How long the flinch takes to settle, in seconds, for a creature at its NATURAL size.
 *
 * A struck human recovers his posture in about half a second. Under the same dynamic-similarity
 * rule the rest of this project uses, a creature scaled up by S settles sqrt(S) times slower — so a
 * 300 m Kaiju built from a 12 m golem takes about two and a quarter seconds. Slow, heavy, and
 * unmistakably enormous, which is the whole point.
 */
const SETTLE_SECONDS = 0.45;

/**
 * Damping ratio. Below 1 the spring overshoots and comes back.
 *
 * 0.45 gives exactly one visible recoil before it settles. At 1.0 the bone would creep back with no
 * rebound at all, which reads as the creature slowly correcting itself rather than being hit; below
 * about 0.25 it oscillates several times and turns into the soft ragdoll Geoff explicitly did not
 * want.
 */
const DAMPING = 0.45;

/**
 * Hard ceiling on how far any one joint may bend, in radians.
 *
 * This is what "fairly stiff" means numerically. 14 degrees is plainly visible on a 300 m limb —
 * tens of metres of travel at the hand — while making it impossible for a blow to fold the creature
 * into a shape its skeleton could not hold. Without a clamp, a big enough hit turns a Kaiju inside
 * out, and there is no force in this game large enough to justify that.
 */
const MAX_BEND = 0.245;

/** ...and the same for the whole-body lean, which is a heavier thing and moves less. */
const MAX_LEAN = 0.16;

/**
 * How quickly the response falls off with distance from the impact, as a fraction of body height.
 *
 * The falloff is 1/(1 + (d/REACH)^2): full strength at the point of contact, a quarter of it one
 * REACH away, and a twentieth at three. That is what makes a blow to the arm read as a blow to the
 * arm rather than as the whole creature shuddering uniformly.
 */
const REACH_FRAC = 0.30;

/**
 * Converts a blow's strength into angular velocity at the joint.
 *
 * Set so a full-strength swing — one that takes about a twelfth of the victim's health — peaks the
 * struck limb near nine degrees, which is roughly two thirds of MAX_BEND. On a 300 m creature that
 * is some twenty metres of travel at the hand: unmissable, and still plainly a flinch rather than a
 * collapse. The remaining third is headroom, so something genuinely enormous can reach the clamp
 * instead of every ordinary hit sitting on it and looking identical.
 */
const KICK_GAIN = 5;

/** Per-bone spring state. Axis-angle displacement and its rate, both in the bone's parent space. */
interface Spring {
  d: THREE.Vector3;
  v: THREE.Vector3;
}

interface RigState {
  springs: Map<string, Spring>;
  /** Whole-body lean, as an axis-angle vector, with its own spring. */
  leanD: THREE.Vector3;
  leanV: THREE.Vector3;
  /** Set while anything is still moving, so idle rigs cost nothing. */
  active: boolean;
}

const rigs = new Map<string, RigState>();

/** Live counters, so "did the hit register?" is answerable by looking. */
export const impactDiag = { strikes: 0, activeRigs: 0, peakBendDeg: 0 };

function stateFor(id: string): RigState {
  let s = rigs.get(id);
  if (!s) {
    s = { springs: new Map(), leanD: new THREE.Vector3(), leanV: new THREE.Vector3(), active: false };
    rigs.set(id, s);
  }
  return s;
}

export function clearImpacts(id?: string): void {
  if (id) rigs.delete(id); else rigs.clear();
  impactDiag.strikes = 0; impactDiag.activeRigs = 0; impactDiag.peakBendDeg = 0;
}

/** Is this Kaiju still reacting to something? Used to skip the whole pass when nothing is moving. */
export function isReacting(id: string): boolean {
  return rigs.get(id)?.active === true;
}

const _worldQuat = new THREE.Quaternion();
const _q = new THREE.Quaternion();
/**
 * Blows waiting for a renderer to apply them.
 *
 * The arena knows a hit landed and where the two creatures are; only the renderer knows where the
 * BONES are. Rather than drag the skeleton into the simulation — which would make the whole fight
 * depend on art having loaded, and it deliberately does not — a hit is queued here as plain data
 * and the renderer picks it up on its next frame. A hit that nobody is drawing simply expires.
 */
interface PendingStrike { id: string; pos: THREE.Vector3; dir: THREE.Vector3; strength: number; age: number }
const pending: PendingStrike[] = [];
/** Longest a queued blow waits for a renderer before it is dropped, in seconds. */
const STRIKE_TTL = 0.25;

export function queueStrike(
  id: string, pos: THREE.Vector3, dir: THREE.Vector3, strength: number,
): void {
  if (strength <= 0.02) return;   // a scratch does not visibly move a 300 m body
  // Coalesce: a flamethrower lands over a thousand hits a second, and each one queueing its own
  // strike would be a thousand skeleton passes a frame AND a permanent shudder.
  const same = pending.find((p) => p.id === id);
  if (same) {
    same.strength = Math.min(1.5, same.strength + strength * 0.25);
    same.pos.copy(pos); same.dir.copy(dir); same.age = 0;
    return;
  }
  pending.push({ id, pos: pos.clone(), dir: dir.clone(), strength, age: 0 });
}

/** Age the queue. Called once per simulation step. */
export function stepStrikeQueue(dt: number): void {
  for (let i = pending.length - 1; i >= 0; i--) {
    pending[i].age += dt;
    if (pending[i].age > STRIKE_TTL) pending.splice(i, 1);
  }
}

/** Take whatever is waiting for this Kaiju and drive it into the skeleton. */
export function consumeStrikes(
  id: string, bones: THREE.Object3D[], heightUnits: number,
): void {
  for (let i = pending.length - 1; i >= 0; i--) {
    if (pending[i].id !== id) continue;
    const p = pending[i];
    pending.splice(i, 1);
    strikeSkeleton(id, bones, p.pos, p.dir, p.strength, heightUnits);
  }
}

export function pendingStrikeCount(): number { return pending.length; }

const _arm = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _bonePos = new THREE.Vector3();
const _up = new THREE.Vector3();

/**
 * The angular kick one joint takes from a blow. Pure, so the falloff can be checked against numbers.
 *
 * `arm` is the vector from the joint to the point of contact and `force` is the blow's direction
 * times its strength. Their cross product is the torque — which carries BOTH the axis to rotate
 * about and the leverage, for free, because a blow straight down a limb's own length has no cross
 * product and correctly produces no bending at all.
 */
export function jointKick(
  arm: THREE.Vector3, force: THREE.Vector3, reach: number, inertia: number, out: THREE.Vector3,
): THREE.Vector3 {
  const fMag = force.length();
  if (fMag < 1e-12) return out.set(0, 0, 0);

  // TWO DIFFERENT ZEROS, and conflating them is wrong in opposite directions.
  //
  // A joint sitting exactly WHERE the blow landed has no moment arm, but the limb beyond it is still
  // shoved — a hand struck square must not be the one part of the body that ignores the hit. So it
  // gets a bend about any axis square to the force.
  //
  // A joint offset ALONG the force's own line is a different thing entirely: that is a blow straight
  // down the limb's axis, which really does produce no rotation. Treating that case with the same
  // fallback would make a Kaiju punched square in the chest snap its spine sideways.
  let len: number;
  if (arm.lengthSq() < (reach * 0.02) ** 2) {
    out.set(0, 1, 0).cross(force);
    if (out.lengthSq() < 1e-12) out.set(1, 0, 0).cross(force);
    len = out.length();
    if (len < 1e-12) return out.set(0, 0, 0);
  } else {
    out.crossVectors(arm, force);
    len = out.length();
    if (len < 1e-9) return out.set(0, 0, 0);
  }

  // Distance has a FLOOR of a quarter reach: a joint cannot be closer to a blow than the half-bone
  // the force actually acts on, and without the floor the joint at the contact point divides by
  // nearly nothing.
  const dist = Math.max(arm.length(), reach * 0.25);
  const falloff = 1 / (1 + (dist / Math.max(1e-6, reach)) ** 2);

  // DIVIDE BY `len` TO GET A PURE AXIS, THEN RE-APPLY THE MAGNITUDE. The first version divided by
  // len and stopped, which normalised the force away with it — every blow, from a scratch to a full
  // swing, landed with exactly the same strength. It is the sort of bug that looks like a tuning
  // problem forever: the reaction is there, it is just never bigger or smaller.
  return out.multiplyScalar((KICK_GAIN * fMag * falloff) / (len * Math.max(0.05, inertia)));
}

/**
 * Land a blow on a Kaiju's skeleton.
 *
 * `bones` is the live rig, `hit` is where contact happened and `dir` which way the blow was
 * travelling. `strength` is in units of "fraction of this creature's own health", so a scratch
 * nudges and a heavy swing throws it — the same currency the knockback already uses.
 */
export function strikeSkeleton(
  id: string, bones: THREE.Object3D[], hit: THREE.Vector3, dir: THREE.Vector3,
  strength: number, heightUnits: number,
): void {
  if (!bones.length || strength <= 0) return;
  const st = stateFor(id);
  const reach = heightUnits * REACH_FRAC;
  const force = _axis.copy(dir).normalize().multiplyScalar(strength);

  // Depth from the root, used as a stand-in for how much body each joint has to shift. A hip has to
  // move everything above it; a hand has to move a hand.
  let maxDepth = 1;
  const depth = new Map<string, number>();
  for (const b of bones) {
    let d = 0;
    for (let p: THREE.Object3D | null = b.parent; p && (p as THREE.Bone).isBone; p = p.parent) d++;
    depth.set(b.uuid, d);
    if (d > maxDepth) maxDepth = d;
  }

  const kick = new THREE.Vector3();
  for (const b of bones) {
    b.getWorldPosition(_bonePos);
    _arm.copy(hit).sub(_bonePos);
    const d = depth.get(b.uuid) ?? 0;
    // Root-ward joints are heavy, extremities are light. Three to one across the whole skeleton.
    const inertia = 1 + 2 * (1 - d / maxDepth);
    jointKick(_arm, force, reach, inertia, kick);
    if (kick.lengthSq() < 1e-14) continue;
    // The kick arrives in WORLD space; the spring lives in the bone's parent space, which is where
    // its quaternion is applied. Without this the whole flinch is in the wrong frame the moment the
    // creature turns to face you.
    if (b.parent) {
      b.parent.updateWorldMatrix(true, false);
      kick.applyQuaternion(
        _worldQuat.setFromRotationMatrix(b.parent.matrixWorld).invert(),
      );
    }
    let sp = st.springs.get(b.uuid);
    if (!sp) { sp = { d: new THREE.Vector3(), v: new THREE.Vector3() }; st.springs.set(b.uuid, sp); }
    sp.v.add(kick);
  }

  // ...and the body as a whole leans away. This is the part that reads from a distance: at 300 m a
  // fourteen-degree bend in an arm is a detail, and the torso tipping is the blow.
  _up.copy(hit).normalize();
  st.leanV.addScaledVector(
    kick.crossVectors(_up, force).normalize(),
    strength * 0.8,
  );
  st.active = true;
  impactDiag.strikes++;
}

/** Spring constants for a creature this size, from the settle time and damping ratio above. */
function springConsts(heightUnits: number, naturalMetres: number): { k: number; c: number } {
  const sizeRatio = Math.max(1, (heightUnits * 100) / Math.max(0.01, naturalMetres));
  const settle = SETTLE_SECONDS * Math.sqrt(sizeRatio);
  const omega = (2 * Math.PI) / Math.max(0.05, settle);
  return { k: omega * omega, c: 2 * DAMPING * omega };
}

/**
 * Advance the springs and write the result onto the bones. Called AFTER the animation mixer, every
 * frame, by whichever renderer owns this rig.
 *
 * The mixer overwrites every bone's rotation from the clip each frame, so this MULTIPLIES its offset
 * on top rather than setting it — the flinch rides the walk instead of replacing it, which is the
 * entire difference between a hit reaction and a ragdoll.
 */
export function applySkeletonImpact(
  id: string, bones: THREE.Object3D[], dt: number, heightUnits: number, naturalMetres: number,
): void {
  const st = rigs.get(id);
  if (!st || !st.active) return;
  const step = Math.min(dt, 0.05);
  const { k, c } = springConsts(heightUnits, naturalMetres);

  let moving = false;
  let peak = 0;
  for (const b of bones) {
    const sp = st.springs.get(b.uuid);
    if (!sp) continue;
    // Semi-implicit Euler: velocity first, then position. Stable at the step sizes a frame loop
    // produces, and it does not gain energy the way plain Euler does on a stiff spring.
    sp.v.addScaledVector(sp.d, -k * step).addScaledVector(sp.v, -c * step);
    sp.d.addScaledVector(sp.v, step);
    const mag = sp.d.length();
    if (mag > MAX_BEND) sp.d.multiplyScalar(MAX_BEND / mag);
    if (mag < 1e-5 && sp.v.lengthSq() < 1e-8) { sp.d.set(0, 0, 0); sp.v.set(0, 0, 0); continue; }
    moving = true;
    if (mag > peak) peak = mag;
    _axis.copy(sp.d);
    const a = _axis.length();
    if (a < 1e-6) continue;
    b.quaternion.multiply(_q.setFromAxisAngle(_axis.divideScalar(a), a));
  }

  // The whole-body lean, on the same spring.
  st.leanV.addScaledVector(st.leanD, -k * step).addScaledVector(st.leanV, -c * step);
  st.leanD.addScaledVector(st.leanV, step);
  const lean = st.leanD.length();
  if (lean > MAX_LEAN) st.leanD.multiplyScalar(MAX_LEAN / lean);
  if (lean > 1e-4 || st.leanV.lengthSq() > 1e-8) moving = true;

  st.active = moving;
  impactDiag.peakBendDeg = Math.max(impactDiag.peakBendDeg, (peak * 180) / Math.PI);
  impactDiag.activeRigs = [...rigs.values()].filter((r) => r.active).length;
}

/**
 * The body's current lean, as an axis-angle vector for the renderer to fold into the group's
 * rotation. Zero-length when nothing has hit it.
 */
export function bodyLean(id: string, out: THREE.Vector3): THREE.Vector3 {
  const st = rigs.get(id);
  return st ? out.copy(st.leanD) : out.set(0, 0, 0);
}
