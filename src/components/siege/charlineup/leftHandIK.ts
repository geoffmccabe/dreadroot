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
const tKey = (w: string) => `siege_lefthand_pt::${w}`;
const wKey = (w: string) => `siege_lefthand_wrist::${w}`;

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
export function getWrist(weaponKey: string): number {
  if (!wrist.has(weaponKey)) {
    let d = 0;
    try { const s = typeof localStorage !== 'undefined' && localStorage.getItem(wKey(weaponKey)); if (s) { const n = parseFloat(s); if (isFinite(n)) d = n; } } catch { /* 0 */ }
    wrist.set(weaponKey, d);
  }
  return wrist.get(weaponKey) ?? 0;
}
export function nudgeWrist(weaponKey: string, deg: number): void {
  const d = getWrist(weaponKey) + deg; wrist.set(weaponKey, d);
  try { localStorage.setItem(wKey(weaponKey), String(d)); } catch { /* ignore */ }
  console.log('[lefthand-wrist]', weaponKey, '→', Math.round(d) + '°');
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
export function solveArmIK(arm: THREE.Object3D, fore: THREE.Object3D, hand: THREE.Object3D, targetWorld: THREE.Vector3, wristTwistDeg: number): void {
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
  if (_axis.lengthSq() < 1e-8) _axis.set(0, 1, 0);   // straight arm → arbitrary pole
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
    out.push(`  ${weaponKey} leftHand: point=[${[v.x, v.y, v.z].map((n) => +n.toFixed(3)).join(', ')}] wrist=${Math.round(getWrist(weaponKey))}`);
  }
  return out;
}
