// Registry of the live lineup-weapon wraps, so the WeaponEditBridge can apply ONE Arrange-panel edit
// to every character's gun at once (the orientation/grip is shared) and read back the bakeable numbers.
// The wrap's LOCAL rotation = the weapon def's rotDeg; its LOCAL position (×handScale) = gripPos.
import * as THREE from 'three';

export interface WeaponWrapReg {
  wrap: THREE.Group;        // group whose local rotation/position is the bakeable rotDeg / gripPos
  hand: THREE.Object3D;     // the hand bone it's parented to
  handScale: number;        // hand world scale (gripPos metres ↔ wrap-local units)
  baseRot: [number, number, number];  // the weapon def's rotDeg (deg); weaponTune composes onto this
}

const regs = new Map<string, WeaponWrapReg>();   // key = unique per-character instance id

export function registerWeaponWrap(id: string, reg: WeaponWrapReg): void { regs.set(id, reg); applyWrapRotation(reg); }
export function unregisterWeaponWrap(id: string): void { regs.delete(id); }
export function weaponWraps(): WeaponWrapReg[] { return [...regs.values()]; }

// The editor-object id every gun wrap tags itself with, so the crosshair/L selects them all as one.
export const WEAPON_EDIT_ID = 'weapon:ak47';

// ── Manual orientation tuning (^ then x/y/z) ───────────────────────────────────────────────────
// weaponTune accumulates 180° flips about the gun's OWN local axes. Every gun's wrap rotation =
// baseRot(euler) ∘ weaponTune, so all characters' guns stay identical and the tweak survives clip
// changes. flipWeaponLocal logs the resulting rotDeg so it can be baked into weaponModels.ts.
export const weaponTune = new THREE.Quaternion();
const _baseE = new THREE.Euler();
const _flip = new THREE.Quaternion();
const _axisV = new THREE.Vector3();
const _out = new THREE.Quaternion();
const _outE = new THREE.Euler();
const D2R = Math.PI / 180, R2D = 180 / Math.PI;

export function applyWrapRotation(reg: WeaponWrapReg): void {
  _baseE.set(reg.baseRot[0] * D2R, reg.baseRot[1] * D2R, reg.baseRot[2] * D2R, 'XYZ');
  reg.wrap.quaternion.setFromEuler(_baseE).multiply(weaponTune);
}

// Flip 180° about the gun's current local axis (post-multiply = gun's own point of view).
export function flipWeaponLocal(axis: 'x' | 'y' | 'z'): void {
  _axisV.set(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0);
  _flip.setFromAxisAngle(_axisV, Math.PI);
  weaponTune.multiply(_flip);
  const all = weaponWraps();
  all.forEach(applyWrapRotation);
  const rep = all[0];
  if (rep) {
    _baseE.set(rep.baseRot[0] * D2R, rep.baseRot[1] * D2R, rep.baseRot[2] * D2R, 'XYZ');
    _out.setFromEuler(_baseE).multiply(weaponTune);
    _outE.setFromQuaternion(_out, 'XYZ');
    console.log('[weapon-flip] axis', axis, '→ bake rotDeg:',
      [Math.round(_outE.x * R2D), Math.round(_outE.y * R2D), Math.round(_outE.z * R2D)]);
  } else {
    console.log('[weapon-flip] axis', axis, '(no gun mounted yet — show a Rifle clip first)');
  }
}
