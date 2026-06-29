// Registry of the live lineup-weapon wraps, so the WeaponEditBridge can apply ONE Arrange-panel edit
// to every character's gun at once (the orientation/grip is shared) and read back the bakeable numbers.
// The wrap's LOCAL rotation = the weapon def's rotDeg; its LOCAL position (×handScale) = gripPos.
import type * as THREE from 'three';

export interface WeaponWrapReg {
  wrap: THREE.Group;        // group whose local rotation/position is the bakeable rotDeg / gripPos
  hand: THREE.Object3D;     // the hand bone it's parented to
  handScale: number;        // hand world scale (gripPos metres ↔ wrap-local units)
}

const regs = new Map<string, WeaponWrapReg>();   // key = unique per-character instance id

export function registerWeaponWrap(id: string, reg: WeaponWrapReg): void { regs.set(id, reg); }
export function unregisterWeaponWrap(id: string): void { regs.delete(id); }
export function weaponWraps(): WeaponWrapReg[] { return [...regs.values()]; }

// The editor-object id every gun wrap tags itself with, so the crosshair/L selects them all as one.
export const WEAPON_EDIT_ID = 'weapon:ak47';
