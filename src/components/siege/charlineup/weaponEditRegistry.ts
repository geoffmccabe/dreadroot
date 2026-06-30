// Registry of the live lineup-weapon wraps + the manual gun-tuning tools (orientation + per-character
// size). Each gun's wrap LOCAL rotation = baseRot(euler) ∘ tune(weaponKey); its scale = baseScale ×
// sizeMult(charName, weaponKey). Orientation is PER WEAPON (same in every hand); size is PER CHARACTER
// PER WEAPON (hand size/aesthetics differ). Everything persists in localStorage and can be exported to
// the clipboard for baking into code.
import * as THREE from 'three';

export interface WeaponWrapReg {
  wrap: THREE.Group;        // group whose local rotation/scale we drive
  hand: THREE.Object3D;     // the hand bone it's parented to
  handScale: number;        // hand world scale (gripPos metres ↔ wrap-local units)
  baseRot: [number, number, number];  // weapon def rotDeg (deg); tune composes onto this
  baseScale: number;        // the auto-fit wrap scale; sizeMult multiplies it
  baseGrip: [number, number, number];  // weapon def gripPos (m); pos tune adds onto this
  weaponKey: string;        // weapon MODEL url — selects orientation tune + (with char) size
  charName: string;         // which character holds this wrap — selects the size multiplier
}

const regs = new Map<string, WeaponWrapReg>();   // key = unique per-character instance id

export function registerWeaponWrap(id: string, reg: WeaponWrapReg): void {
  regs.set(id, reg);
  baseRotByWeapon.set(reg.weaponKey, reg.baseRot);
  baseGripByWeapon.set(reg.weaponKey, reg.baseGrip);
  applyWrapRotation(reg);
  applyWrapScale(reg);
  applyWrapPos(reg);
}
export function unregisterWeaponWrap(id: string): void { regs.delete(id); }
export function weaponWraps(): WeaponWrapReg[] { return [...regs.values()]; }

// The editor-object id every gun wrap tags itself with, so the crosshair/L selects them all as one.
export const WEAPON_EDIT_ID = 'weapon:held';

const _baseE = new THREE.Euler();
const _flip = new THREE.Quaternion();
const _axisV = new THREE.Vector3();
const _out = new THREE.Quaternion();
const _outE = new THREE.Euler();
const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

// ── Orientation tune (^ then x/y/z) — one accumulated-flip quaternion PER weapon model ──────────────
const tunes = new Map<string, THREE.Quaternion>();
const baseRotByWeapon = new Map<string, [number, number, number]>();   // for export
const baseGripByWeapon = new Map<string, [number, number, number]>();  // for export
const tuneKeyFor = (weaponKey: string) => `siege_weapon_tune::${weaponKey}`;

function getTune(weaponKey: string): THREE.Quaternion {
  let q = tunes.get(weaponKey);
  if (!q) {
    q = new THREE.Quaternion();
    try {
      const s = typeof localStorage !== 'undefined' && localStorage.getItem(tuneKeyFor(weaponKey));
      if (s) { const a = JSON.parse(s); if (Array.isArray(a) && a.length === 4) q.fromArray(a); }
    } catch { /* identity */ }
    tunes.set(weaponKey, q);
  }
  return q;
}

export function applyWrapRotation(reg: WeaponWrapReg): void {
  _baseE.set(reg.baseRot[0] * D2R, reg.baseRot[1] * D2R, reg.baseRot[2] * D2R, 'XYZ');
  reg.wrap.quaternion.setFromEuler(_baseE).multiply(getTune(reg.weaponKey));
}

// Flip the CURRENTLY-shown weapon 180° about its own local axis (all mounted wraps share that weapon).
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
  console.log('[weapon-flip]', rep.weaponKey, 'axis', axis, '→ rotDeg',
    [Math.round(_outE.x * R2D), Math.round(_outE.y * R2D), Math.round(_outE.z * R2D)]);
}

// ── Size tune (number selects character, -/= shrink/grow) — multiplier PER character PER weapon ──────
const sizes = new Map<string, number>();   // key = `${charName}::${weaponKey}`
const sizeKey = (charName: string, weaponKey: string) => `siege_weapon_size::${charName}::${weaponKey}`;

export function getWeaponSize(charName: string, weaponKey: string): number {
  const k = `${charName}::${weaponKey}`;
  let v = sizes.get(k);
  if (v === undefined) {
    v = 1;
    try { const s = typeof localStorage !== 'undefined' && localStorage.getItem(sizeKey(charName, weaponKey)); if (s) { const n = parseFloat(s); if (isFinite(n) && n > 0) v = n; } } catch { /* default 1 */ }
    sizes.set(k, v);
  }
  return v;
}

export function applyWrapScale(reg: WeaponWrapReg): void {
  reg.wrap.scale.setScalar(reg.baseScale * getWeaponSize(reg.charName, reg.weaponKey));
}

// Grow/shrink the current weapon for ONE character (charName) or ALL of them (charName = null).
export function bumpWeaponSize(charName: string | null, factor: number): void {
  let touched = 0;
  for (const reg of regs.values()) {
    if (charName !== null && reg.charName !== charName) continue;
    const k = `${reg.charName}::${reg.weaponKey}`;
    const next = clamp(getWeaponSize(reg.charName, reg.weaponKey) * factor, 0.2, 5);
    sizes.set(k, next);
    try { localStorage.setItem(sizeKey(reg.charName, reg.weaponKey), String(next)); } catch { /* ignore */ }
    applyWrapScale(reg);
    touched++;
  }
  console.log('[weapon-size]', charName ?? 'ALL', '×', factor.toFixed(2), `(${touched} gun${touched === 1 ? '' : 's'})`);
}

// ── Position tune (arrows + ,/. move the gun in the hand) — offset PER weapon (shared across chars) ──
const posTunes = new Map<string, [number, number, number]>();   // metres added onto baseGrip
const posKeyFor = (weaponKey: string) => `siege_weapon_pos::${weaponKey}`;

function getPos(weaponKey: string): [number, number, number] {
  let p = posTunes.get(weaponKey);
  if (!p) {
    p = [0, 0, 0];
    try { const s = typeof localStorage !== 'undefined' && localStorage.getItem(posKeyFor(weaponKey)); if (s) { const a = JSON.parse(s); if (Array.isArray(a) && a.length === 3) p = a as [number, number, number]; } } catch { /* default */ }
    posTunes.set(weaponKey, p);
  }
  return p;
}

export function applyWrapPos(reg: WeaponWrapReg): void {
  const p = getPos(reg.weaponKey);
  reg.wrap.position.set((reg.baseGrip[0] + p[0]) / reg.handScale, (reg.baseGrip[1] + p[1]) / reg.handScale, (reg.baseGrip[2] + p[2]) / reg.handScale);
}

// Move the current weapon along a hand-local axis (all characters share the grip offset).
export function nudgeWeaponPos(axis: 'x' | 'y' | 'z', delta: number): void {
  const all = weaponWraps();
  const rep = all[0];
  if (!rep) { console.log('[weapon-pos]', axis, '(no gun mounted)'); return; }
  const p = getPos(rep.weaponKey);
  const i = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
  p[i] = Math.round((p[i] + delta) * 1000) / 1000;
  try { localStorage.setItem(posKeyFor(rep.weaponKey), JSON.stringify(p)); } catch { /* ignore */ }
  for (const reg of all) if (reg.weaponKey === rep.weaponKey) applyWrapPos(reg);
  console.log('[weapon-pos]', rep.weaponKey, 'gripPos',
    [rep.baseGrip[0] + p[0], rep.baseGrip[1] + p[1], rep.baseGrip[2] + p[2]].map((n) => Math.round(n * 1000) / 1000));
}

// ── Export everything so it can be baked into code ──────────────────────────────────────────────────
// Copies a readable block of every tuned weapon's orientation (rotDeg) + per-character size multipliers
// to the clipboard (console as fallback). Paste it to Claude to make the tuning permanent for all players.
export function exportTuning(): void {
  const lines = ['=== SIEGE GUN TUNING (paste to Claude to bake) ==='];
  for (const [weaponKey, baseRot] of baseRotByWeapon) {
    _baseE.set(baseRot[0] * D2R, baseRot[1] * D2R, baseRot[2] * D2R, 'XYZ');
    _out.setFromEuler(_baseE).multiply(getTune(weaponKey));
    _outE.setFromQuaternion(_out, 'XYZ');
    const g = baseGripByWeapon.get(weaponKey) ?? [0, 0, 0]; const pp = getPos(weaponKey);
    const grip = [g[0] + pp[0], g[1] + pp[1], g[2] + pp[2]].map((n) => Math.round(n * 1000) / 1000);
    let line = `${weaponKey}  rotDeg=[${Math.round(_outE.x * R2D)}, ${Math.round(_outE.y * R2D)}, ${Math.round(_outE.z * R2D)}]  gripPos=[${grip.join(', ')}]`;
    const scaleParts: string[] = [];
    for (const [k, v] of sizes) { if (k.endsWith(`::${weaponKey}`) && Math.abs(v - 1) > 1e-3) scaleParts.push(`${k.split('::')[0]}=${v.toFixed(2)}`); }
    if (scaleParts.length) line += `  size: ${scaleParts.join(' ')}`;
    lines.push(line);
  }
  const text = lines.join('\n');
  try { navigator.clipboard?.writeText(text); } catch { /* clipboard blocked — console only */ }
  console.log(text + '\n(copied to clipboard)');
}
