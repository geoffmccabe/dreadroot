// leftHandIK — puts each character's LEFT (support) hand on the gun via two-bone IK (shoulder + elbow),
// so the support hand actually holds the weapon in every rifle animation instead of floating.
//
// The grip point is captured by aiming at the gun (a ray hit), stored in the gun WRAP's local frame —
// the SAME spot on the gun for every character, since the gun model is identical. Per weapon. The
// elbow bends to reach it (arm length differs per character; the solver handles that). A wrist twist
// ( ( / ) ) rolls the hand about the forearm to wrap the grip. All per-weapon, persisted, exportable.
import * as THREE from 'three';

const targets = new Map<string, THREE.Vector3 | null>();   // weaponKey → grip point in wrap-local
const wrist = new Map<string, number>();                    // weaponKey → wrist twist (degrees)
const swivel = new Map<string, number>();                   // weaponKey → elbow pole angle (degrees)
const tKey = (w: string) => `siege_lefthand_pt::${w}`;
const wKey = (w: string) => `siege_lefthand_wrist::${w}`;
const sKey = (w: string) => `siege_lefthand_swivel::${w}`;

export function getLeftTarget(weaponKey: string): THREE.Vector3 | null {
  if (!targets.has(weaponKey)) {
    let v: THREE.Vector3 | null = null;
    try { const s = typeof localStorage !== 'undefined' && localStorage.getItem(tKey(weaponKey)); if (s) { const a = JSON.parse(s); if (Array.isArray(a) && a.length === 3) v = new THREE.Vector3(a[0], a[1], a[2]); } } catch { /* none */ }
    targets.set(weaponKey, v);
  }
  return targets.get(weaponKey) ?? null;
}
export function setLeftTarget(weaponKey: string, wrapLocal: THREE.Vector3): void {
  targets.set(weaponKey, wrapLocal.clone());
  try { localStorage.setItem(tKey(weaponKey), JSON.stringify([+wrapLocal.x.toFixed(4), +wrapLocal.y.toFixed(4), +wrapLocal.z.toFixed(4)])); } catch { /* ignore */ }
  console.log('[lefthand] target set for', weaponKey, '→', [wrapLocal.x, wrapLocal.y, wrapLocal.z].map((n) => +n.toFixed(3)));
}
export function getWrist(weaponKey: string, fallback = 0): number {
  if (!wrist.has(weaponKey)) {
    let d = fallback;   // baked wrist unless the user has a saved override
    try { const s = typeof localStorage !== 'undefined' && localStorage.getItem(wKey(weaponKey)); if (s) { const n = parseFloat(s); if (isFinite(n)) d = n; } } catch { /* fallback */ }
    wrist.set(weaponKey, d);
  }
  return wrist.get(weaponKey) ?? fallback;
}
export function nudgeWrist(weaponKey: string, deg: number): void {
  const d = getWrist(weaponKey) + deg; wrist.set(weaponKey, d);
  try { localStorage.setItem(wKey(weaponKey), String(d)); } catch { /* ignore */ }
  console.log('[lefthand-wrist]', weaponKey, '→', Math.round(d) + '°');
}

/**
 * ELBOW SWIVEL — the pole angle.
 *
 * THIS IS THE THING THAT WAS MISSING, and it is why arms came out bent the wrong
 * way on weapons like the Rocket Launcher. A two-bone solve fixes the shoulder and
 * elbow ANGLES, but not which way the elbow points: the whole arm can rotate freely
 * about the shoulder-to-hand axis with the hand staying exactly where it is. Some
 * value has to choose that rotation. The solver below inherited it from the
 * animation clip's own pose, which is fine while the target is near where the clip
 * put the hand and produces an elbow through the ribcage when it is not.
 *
 * Every mainstream rig exposes this as a control: Blender calls it the IK
 * constraint's Pole Target and Pole Angle, Unity's Animator IK calls it
 * SetIKHintPosition(AvatarIKHint.LeftElbow), Unreal's TwoBoneIK node calls it the
 * Joint Target. Same idea in each — pick the plane the limb bends in.
 *
 * Per weapon rather than per character: the grip point is the same spot on the same
 * model for everyone, so the elbow wants to go the same way for everyone.
 */
export function getSwivel(weaponKey: string, fallback = 0): number {
  if (!swivel.has(weaponKey)) {
    let d = fallback;
    try { const s = typeof localStorage !== 'undefined' && localStorage.getItem(sKey(weaponKey)); if (s) { const n = parseFloat(s); if (isFinite(n)) d = n; } } catch { /* fallback */ }
    swivel.set(weaponKey, d);
  }
  return swivel.get(weaponKey) ?? fallback;
}
export function nudgeSwivel(weaponKey: string, deg: number): void {
  const d = getSwivel(weaponKey) + deg; swivel.set(weaponKey, d);
  try { localStorage.setItem(sKey(weaponKey), String(d)); } catch { /* ignore */ }
  console.log('[lefthand-swivel]', weaponKey, '→', Math.round(d) + '° (elbow direction)');
}

/**
 * Move the captured grip point in a direction the USER can see.
 *
 * Same reason as the gun's own position keys: the point is stored in the gun
 * model's frame, and that frame is rotated ~90° in two axes to sit in the hand, so
 * its axes have nothing to do with what is on screen. `worldDir` is what the viewer
 * means; `wrap` converts it into the model's frame, scale included.
 */
export function nudgeLeftTargetDir(weaponKey: string, wrap: THREE.Object3D, worldDir: THREE.Vector3, metres: number): void {
  const cur = getLeftTarget(weaponKey);
  const v = cur ? cur.clone() : new THREE.Vector3();
  wrap.getWorldQuaternion(_wq);
  wrap.getWorldScale(_scale);
  _dirL.copy(worldDir).normalize().applyQuaternion(_wq.invert());
  // Undo the wrap's scale so a centimetre on screen is a centimetre on screen for
  // every weapon, however the model happens to be scaled.
  v.x += (_dirL.x * metres) / (_scale.x || 1);
  v.y += (_dirL.y * metres) / (_scale.y || 1);
  v.z += (_dirL.z * metres) / (_scale.z || 1);
  setLeftTarget(weaponKey, v);
}

/** Move the captured grip point along one axis of the gun's own frame, in metres.
 *  Without this the target could only be set by a raycast, so it could be placed
 *  but never adjusted — and a grip point is exactly the kind of thing you want to
 *  creep a centimetre at a time. */
export function nudgeLeftTarget(weaponKey: string, axis: 0 | 1 | 2, delta: number): void {
  const cur = getLeftTarget(weaponKey);
  const v = cur ? cur.clone() : new THREE.Vector3();
  v.setComponent(axis, v.getComponent(axis) + delta);
  setLeftTarget(weaponKey, v);
}

// Left-arm bone chain of a mixamorig character (sanitized names have no colon).
export function findLeftArm(root: THREE.Object3D): { arm: THREE.Object3D; fore: THREE.Object3D; hand: THREE.Object3D } | null {
  let arm: THREE.Object3D | undefined, fore: THREE.Object3D | undefined, hand: THREE.Object3D | undefined;
  root.traverse((o) => {
    if (o.name.endsWith('LeftArm')) arm = o;
    else if (o.name.endsWith('LeftForeArm')) fore = o;
    else if (o.name.endsWith('LeftHand')) hand = o;   // finger bones end in Thumb/Index/... so no clash
  });
  return arm && fore && hand ? { arm, fore, hand } : null;
}

const _pA = new THREE.Vector3(), _pB = new THREE.Vector3(), _pC = new THREE.Vector3();
const _dAT = new THREE.Vector3(), _dAC = new THREE.Vector3(), _dAB = new THREE.Vector3();
const _n1 = new THREE.Vector3(), _n2 = new THREE.Vector3();
const _axis = new THREE.Vector3(), _fore = new THREE.Vector3();
const _q = new THREE.Quaternion(), _wq = new THREE.Quaternion(), _pq = new THREE.Quaternion();
const _scale = new THREE.Vector3(), _dirL = new THREE.Vector3();
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

// Apply a WORLD-space rotation (axis, angle) to a bone, converting back to its local quaternion, then
// refresh its world matrix so the next getWorldPosition() (child bones) reads the updated pose.
function rotateBoneWorld(bone: THREE.Object3D, axis: THREE.Vector3, angle: number): void {
  if (!isFinite(angle) || Math.abs(angle) < 1e-6) return;
  _q.setFromAxisAngle(axis, angle);
  bone.getWorldQuaternion(_wq);
  _wq.premultiply(_q);
  bone.parent!.getWorldQuaternion(_pq);
  bone.quaternion.copy(_pq.invert().multiply(_wq));
  bone.updateMatrixWorld(true);
}

// Two-bone IK: bend shoulder (arm) + elbow (fore) so the hand reaches targetWorld, then roll the wrist.
// Iterated a few times so it converges even when the target is far from the animation's hand pose (a
// single pass under-reaches on far targets like a long gun's foregrip).
const warned = new Set<string>();
/** Warn ONCE if a grip point is beyond the arm's reach. The solver clamps rather than breaking, so
 *  an out-of-reach target quietly produces a straight arm aimed off into space — which looks like a
 *  broken rig rather than like bad data, and is worth naming. */
export function checkReach(arm: THREE.Object3D, fore: THREE.Object3D, hand: THREE.Object3D, targetWorld: THREE.Vector3, label: string): void {
  if (warned.has(label)) return;
  arm.getWorldPosition(_pA); fore.getWorldPosition(_pB); hand.getWorldPosition(_pC);
  const reach = _pA.distanceTo(_pB) + _pB.distanceTo(_pC);
  const need = _pA.distanceTo(targetWorld);
  if (need > reach * 1.02) {
    warned.add(label);
    console.warn(`[lefthand] ${label}: grip point is ${need.toFixed(2)}m from the shoulder but the arm only reaches ${reach.toFixed(2)}m — the arm will stretch straight at it. Re-capture with K, or nudge it in LEFT HAND mode.`);
  }
}

export function solveArmIK(arm: THREE.Object3D, fore: THREE.Object3D, hand: THREE.Object3D, targetWorld: THREE.Vector3, wristTwistDeg: number, swivelDeg = 0): void {
  for (let iter = 0; iter < 4; iter++) {
    arm.getWorldPosition(_pA); fore.getWorldPosition(_pB); hand.getWorldPosition(_pC);
    const lAB = _pA.distanceTo(_pB), lBC = _pB.distanceTo(_pC);
    if (lAB < 1e-5 || lBC < 1e-5) return;
    _dAT.copy(targetWorld).sub(_pA);
    const lAT = clamp(_dAT.length(), Math.abs(lAB - lBC) + 1e-4, lAB + lBC - 1e-4);
    _dAB.copy(_pB).sub(_pA); _dAC.copy(_pC).sub(_pA);
    // current + desired interior angles (law of cosines)
    const a0 = Math.acos(clamp(_n1.copy(_dAB).normalize().dot(_n2.copy(_dAC).normalize()), -1, 1));
    const b0 = Math.acos(clamp(_n1.copy(_pA).sub(_pB).normalize().dot(_n2.copy(_pC).sub(_pB).normalize()), -1, 1));
    const a1 = Math.acos(clamp((lAB * lAB + lAT * lAT - lBC * lBC) / (2 * lAB * lAT), -1, 1));
    const b1 = Math.acos(clamp((lAB * lAB + lBC * lBC - lAT * lAT) / (2 * lAB * lBC), -1, 1));
    // bend axis = normal of the shoulder-elbow-hand plane (keeps the current elbow direction)
    _axis.copy(_dAB).cross(_dAC);
    if (_axis.lengthSq() < 1e-8) { _axis.copy(_dAB).cross(_dAT); if (_axis.lengthSq() < 1e-8) _axis.set(0, 1, 0); }   // straight arm → pole toward target
    _axis.normalize();
    rotateBoneWorld(arm, _axis, a1 - a0);              // set shoulder angle
    rotateBoneWorld(fore, _axis, b1 - b0);             // set elbow angle
    // aim: rotate the shoulder so the (now re-bent) hand direction points at the target
    hand.getWorldPosition(_pC);
    _dAC.copy(_pC).sub(_pA); _dAT.copy(targetWorld).sub(_pA);
    if (_dAC.lengthSq() > 1e-8 && _dAT.lengthSq() > 1e-8) {
      _q.setFromUnitVectors(_dAC.normalize(), _dAT.normalize());
      arm.getWorldQuaternion(_wq); _wq.premultiply(_q);
      arm.parent!.getWorldQuaternion(_pq); arm.quaternion.copy(_pq.invert().multiply(_wq)); arm.updateMatrixWorld(true);
    }
  }
  // Elbow swivel (pole). Rotating the SHOULDER about the shoulder-to-hand axis leaves the hand
  // exactly where it is — it lies on that axis — while swinging the elbow around it. So this
  // chooses the bend plane without disturbing the solve above, which is why it goes last.
  if (swivelDeg) {
    arm.getWorldPosition(_pA); hand.getWorldPosition(_pC);
    _axis.copy(_pC).sub(_pA);
    if (_axis.lengthSq() > 1e-8) { _axis.normalize(); rotateBoneWorld(arm, _axis, swivelDeg * Math.PI / 180); }
  }
  // wrist twist: roll the hand about the forearm axis to wrap the grip
  if (wristTwistDeg) {
    hand.getWorldPosition(_pC); fore.getWorldPosition(_pB);
    _fore.copy(_pC).sub(_pB); if (_fore.lengthSq() > 1e-8) { _fore.normalize(); rotateBoneWorld(hand, _fore, wristTwistDeg * Math.PI / 180); }
  }
}

// Lines for the '\' export (per weapon that has a captured left-hand grip).
export function leftHandExportLines(): string[] {
  const out: string[] = [];
  for (const [weaponKey, v] of targets) {
    if (!v) continue;
    out.push(`  ${weaponKey} leftHand: point=[${[v.x, v.y, v.z].map((n) => +n.toFixed(3)).join(', ')}] wrist=${Math.round(getWrist(weaponKey))} swivel=${Math.round(getSwivel(weaponKey))}`);
  }
  return out;
}
