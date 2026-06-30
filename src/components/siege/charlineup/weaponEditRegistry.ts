// Registry of the live lineup-weapon wraps + the manual orientation-tuning tool.
// Each gun's wrap LOCAL rotation = baseRot(euler) ∘ tune(weaponKey). The tune is PER WEAPON (keyed by
// model url) so tuning one rifle never disturbs another, and each weapon's tweak persists across
// reloads (localStorage). flipWeaponLocal flips the CURRENTLY-shown weapon and logs the bakeable rotDeg.
import * as THREE from 'three';

export interface WeaponWrapReg {
  wrap: THREE.Group;        // group whose local rotation/position is the bakeable rotDeg / gripPos
  hand: THREE.Object3D;     // the hand bone it's parented to
  handScale: number;        // hand world scale (gripPos metres ↔ wrap-local units)
  baseRot: [number, number, number];  // the weapon def's rotDeg (deg); the tune composes onto this
  weaponKey: string;        // unique per weapon MODEL (its url) — selects which tune applies
}

const regs = new Map<string, WeaponWrapReg>();   // key = unique per-character instance id

export function registerWeaponWrap(id: string, reg: WeaponWrapReg): void { regs.set(id, reg); applyWrapRotation(reg); }
export function unregisterWeaponWrap(id: string): void { regs.delete(id); }
export function weaponWraps(): WeaponWrapReg[] { return [...regs.values()]; }

// The editor-object id every gun wrap tags itself with, so the crosshair/L selects them all as one.
export const WEAPON_EDIT_ID = 'weapon:held';

// ── Per-weapon orientation tuning (^ then x/y/z) ─────────────────────────────────────────────────
// One accumulated-flip quaternion per weapon model, loaded/saved to localStorage so a weapon's manual
// orientation sticks across reloads. Every gun's wrap rotation = baseRot(euler) ∘ tune(weaponKey).
const tunes = new Map<string, THREE.Quaternion>();
const tuneKeyFor = (weaponKey: string) => `siege_weapon_tune::${weaponKey}`;

function getTune(weaponKey: string): THREE.Quaternion {
  let q = tunes.get(weaponKey);
  if (!q) {
    q = new THREE.Quaternion();
    try {
      const saved = typeof localStorage !== 'undefined' && localStorage.getItem(tuneKeyFor(weaponKey));
      if (saved) { const a = JSON.parse(saved); if (Array.isArray(a) && a.length === 4) q.fromArray(a); }
    } catch { /* localStorage unavailable — identity */ }
    tunes.set(weaponKey, q);
  }
  return q;
}

const _baseE = new THREE.Euler();
const _flip = new THREE.Quaternion();
const _axisV = new THREE.Vector3();
const _out = new THREE.Quaternion();
const _outE = new THREE.Euler();
const D2R = Math.PI / 180, R2D = 180 / Math.PI;

export function applyWrapRotation(reg: WeaponWrapReg): void {
  _baseE.set(reg.baseRot[0] * D2R, reg.baseRot[1] * D2R, reg.baseRot[2] * D2R, 'XYZ');
  reg.wrap.quaternion.setFromEuler(_baseE).multiply(getTune(reg.weaponKey));
}

// Flip the CURRENTLY-shown weapon 180° about its own local axis (post-multiply = gun's point of view).
// All mounted wraps hold the same selected weapon, so the current key = any wrap's weaponKey.
export function flipWeaponLocal(axis: 'x' | 'y' | 'z'): void {
  const all = weaponWraps();
  const rep = all[0];
  if (!rep) { console.log('[weapon-flip] axis', axis, '(no gun mounted — show a Rifle clip first)'); return; }
  const tune = getTune(rep.weaponKey);
  _axisV.set(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0);
  _flip.setFromAxisAngle(_axisV, Math.PI);
  tune.multiply(_flip);
  try { localStorage.setItem(tuneKeyFor(rep.weaponKey), JSON.stringify(tune.toArray())); } catch { /* ignore */ }
  all.forEach(applyWrapRotation);
  _baseE.set(rep.baseRot[0] * D2R, rep.baseRot[1] * D2R, rep.baseRot[2] * D2R, 'XYZ');
  _out.setFromEuler(_baseE).multiply(tune);
  _outE.setFromQuaternion(_out, 'XYZ');
  console.log('[weapon-flip]', rep.weaponKey, 'axis', axis, '→ bake rotDeg:',
    [Math.round(_outE.x * R2D), Math.round(_outE.y * R2D), Math.round(_outE.z * R2D)]);
}
