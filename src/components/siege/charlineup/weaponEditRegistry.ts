// Registry of the live lineup-weapon wraps + the manual gun-tuning tools. EVERY tuning axis —
// orientation, position, and size — is PER CHARACTER PER WEAPON (keyed `${charName}::${weaponKey}`),
// because hand size/shape differ so a gun that grips right on one character is off on another. The
// adjusters act only on the SELECTED character. Each gun's wrap = baseRot(char,weapon) ∘ rotTune,
// pos = baseGrip + posTune, scale = baseScale × size. All persist in localStorage; '\' exports them.
import * as THREE from 'three';
import { leftHandExportLines } from './leftHandIK';
import { armFKExportLines } from './armFK';
import { atlasExportLines } from './weaponAtlas';
import { spreadExportLines } from './armSpread';

export interface WeaponWrapReg {
  wrap: THREE.Group;        // group whose local rotation/scale we drive
  hand: THREE.Object3D;     // the hand bone it's parented to
  handScale: number;        // hand world scale (gripPos metres ↔ wrap-local units)
  baseRot: [number, number, number];  // effective per-char baseline rotDeg (deg); rotTune composes on
  baseScale: number;        // the auto-fit wrap scale; size multiplies it
  bakedSize: number;        // baked per-character size multiplier; default 1
  baseGrip: [number, number, number];  // effective per-char baseline gripPos (m); posTune adds on
  weaponKey: string;        // weapon MODEL url
  charName: string;         // which character holds this wrap
}

const regs = new Map<string, WeaponWrapReg>();   // key = unique per-character instance id
const ck = (charName: string, weaponKey: string) => `${charName}::${weaponKey}`;

export function registerWeaponWrap(id: string, reg: WeaponWrapReg): void {
  regs.set(id, reg);
  baseRotByKey.set(ck(reg.charName, reg.weaponKey), reg.baseRot);
  baseGripByKey.set(ck(reg.charName, reg.weaponKey), reg.baseGrip);
  applyWrapRotation(reg);
  applyWrapScale(reg);
  applyWrapPos(reg);
}
export function unregisterWeaponWrap(id: string): void { regs.delete(id); }
export function weaponWraps(): WeaponWrapReg[] { return [...regs.values()]; }

// Dev probe for scripts/check-lineup.mjs. "Is a weapon model actually IN the hand?"
// is the one question a screenshot answers and nothing else does — the lineup once
// posed a pistol correctly while rendering no gun at all.
if (typeof window !== 'undefined') {
  // Console fallback for the '\\' export. Tuning lives only in memory until it is exported, and
  // a mistyped key should never mean redoing an hour of work — __lineupExport() from the console
  // prints and copies exactly the same thing.
  (window as unknown as { __lineupExport?: () => void }).__lineupExport = () => exportTuning();
  (window as unknown as { __lineupWeapons?: () => unknown }).__lineupWeapons = () =>
    weaponWraps().map((r) => ({ char: r.charName, weapon: r.weaponKey }));
  // Rendered size + whether a texture landed, per weapon in hand. A registry lengthM that is
  // wrong shows up here as a world size far off target — the Muskets were rendering at rifle
  // length because they were listed as 1.4 m long guns.
  (window as unknown as { __lineupWeaponSizes?: () => unknown }).__lineupWeaponSizes = () => {
    const THREEB = new THREE.Box3();
    return weaponWraps().filter((r) => r.charName === 'Rajax').map((r) => {
      THREEB.setFromObject(r.wrap);
      const s = THREEB.getSize(new THREE.Vector3());
      let textured = false, mats = 0;
      r.wrap.traverse((o) => {
        const m = (o as THREE.Mesh).material;
        if (!m) return;
        for (const mm of Array.isArray(m) ? m : [m]) { mats++; if ((mm as THREE.MeshStandardMaterial).map) textured = true; }
      });
      const e = new THREE.Euler().setFromQuaternion(r.wrap.quaternion);
      const deg = (v: number) => Math.round(v * 180 / Math.PI);
      return { weapon: r.weaponKey.split('/').pop(), longestM: +Math.max(s.x, s.y, s.z).toFixed(3), mats, textured,
        rot: [deg(e.x), deg(e.y), deg(e.z)] };
    });
  };
}

// The editor-object id every gun wrap tags itself with, so the crosshair/L selects them all as one.
export const WEAPON_EDIT_ID = 'weapon:held';

// When weapon tuning is baked into code, the in-browser tweaks for those weapons must be cleared ONCE
// so the baked values apply cleanly (else base ∘ saved-tune doubles). Bump BAKE_VERSION + list the
// baked urls; a scan removes their per-character tune/pos keys. (Size never doubles, so it's kept.)
const BAKE_VERSION = '11';  // v11: also baked Rocket Launcher (item_14) — clear its saved tweaks
const BAKED_URLS = new Set(['/siege/weapons/ak47.glb', '/siege/weapons/item_17.glb', '/siege/weapons/item_18.glb', '/siege/weapons/item_19.glb', '/siege/weapons/item_142.glb', '/siege/weapons/item_4.glb', '/siege/weapons/item_12.glb', '/siege/weapons/item_1.glb', '/siege/weapons/item_5.glb', '/siege/weapons/item_6.glb', '/siege/weapons/item_14.glb']);
try {
  if (typeof localStorage !== 'undefined' && localStorage.getItem('siege_weapon_bake') !== BAKE_VERSION) {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i); if (!k) continue;
      if (k.startsWith('siege_weapon_tune::') || k.startsWith('siege_weapon_pos::')) {
        const url = k.slice(k.lastIndexOf('::') + 2);           // key = prefix[::char]::url
        if (BAKED_URLS.has(url)) localStorage.removeItem(k);
      }
    }
    localStorage.setItem('siege_weapon_bake', BAKE_VERSION);
  }
} catch { /* localStorage unavailable */ }

const _baseE = new THREE.Euler();
const _flip = new THREE.Quaternion();
const _axisV = new THREE.Vector3();
const _out = new THREE.Quaternion();
const _outE = new THREE.Euler();
const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const baseRotByKey = new Map<string, [number, number, number]>();   // `${char}::${weapon}` → baseline
const baseGripByKey = new Map<string, [number, number, number]>();
const dirty = new Set<string>();   // `${char}::${weapon}` the user actually adjusted — only these export

// ── Orientation tune (x/y/z rotate) — per character per weapon ───────────────────────────────────────
const tunes = new Map<string, THREE.Quaternion>();
const tuneKey = (charName: string, weaponKey: string) => `siege_weapon_tune::${charName}::${weaponKey}`;

function getTune(charName: string, weaponKey: string): THREE.Quaternion {
  const key = ck(charName, weaponKey);
  let q = tunes.get(key);
  if (!q) {
    q = new THREE.Quaternion();
    try { const s = typeof localStorage !== 'undefined' && localStorage.getItem(tuneKey(charName, weaponKey)); if (s) { const a = JSON.parse(s); if (Array.isArray(a) && a.length === 4) q.fromArray(a); } } catch { /* identity */ }
    tunes.set(key, q);
  }
  return q;
}

export function applyWrapRotation(reg: WeaponWrapReg): void {
  _baseE.set(reg.baseRot[0] * D2R, reg.baseRot[1] * D2R, reg.baseRot[2] * D2R, 'XYZ');
  reg.wrap.quaternion.setFromEuler(_baseE).multiply(getTune(reg.charName, reg.weaponKey));
}

// Rotate the current weapon `degrees` about its own local axis, for the SELECTED character (charName)
// or ALL characters (charName = null). Post-multiply = gun's own frame.
export function rotateWeaponLocal(charName: string | null, axis: 'x' | 'y' | 'z', degrees: number): void {
  const targets = weaponWraps().filter((r) => charName === null || r.charName === charName);
  if (!targets.length) { console.log('[weapon-rot]', axis, '(no gun on the selected character)'); return; }
  _axisV.set(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0);
  _flip.setFromAxisAngle(_axisV, degrees * D2R);
  for (const reg of targets) {
    const tune = getTune(reg.charName, reg.weaponKey);
    tune.multiply(_flip);
    try { localStorage.setItem(tuneKey(reg.charName, reg.weaponKey), JSON.stringify(tune.toArray())); } catch { /* ignore */ }
    dirty.add(ck(reg.charName, reg.weaponKey));
    applyWrapRotation(reg);
  }
  const rep = targets[0];
  _baseE.set(rep.baseRot[0] * D2R, rep.baseRot[1] * D2R, rep.baseRot[2] * D2R, 'XYZ');
  _out.setFromEuler(_baseE).multiply(getTune(rep.charName, rep.weaponKey));
  _outE.setFromQuaternion(_out, 'XYZ');
  console.log('[weapon-rot]', charName ?? 'ALL', rep.weaponKey, `${degrees > 0 ? '+' : ''}${degrees}° ${axis}`,
    '→ rotDeg', [Math.round(_outE.x * R2D), Math.round(_outE.y * R2D), Math.round(_outE.z * R2D)]);
}

// ── Size tune (-/=) — multiplier per character per weapon ─────────────────────────────────────────────
const sizes = new Map<string, number>();
const sizeKey = (charName: string, weaponKey: string) => `siege_weapon_size::${charName}::${weaponKey}`;

export function getWeaponSize(charName: string, weaponKey: string, fallback = 1): number {
  const key = ck(charName, weaponKey);
  let v = sizes.get(key);
  if (v === undefined) {
    v = fallback;
    try { const s = typeof localStorage !== 'undefined' && localStorage.getItem(sizeKey(charName, weaponKey)); if (s) { const n = parseFloat(s); if (isFinite(n) && n > 0) v = n; } } catch { /* default */ }
    sizes.set(key, v);
  }
  return v;
}

export function applyWrapScale(reg: WeaponWrapReg): void {
  reg.wrap.scale.setScalar(reg.baseScale * getWeaponSize(reg.charName, reg.weaponKey, reg.bakedSize));
}

// Grow/shrink the current weapon for ONE character (charName) or ALL of them (charName = null).
export function bumpWeaponSize(charName: string | null, factor: number): void {
  const targets = weaponWraps().filter((r) => charName === null || r.charName === charName);
  for (const reg of targets) {
    const next = clamp(getWeaponSize(reg.charName, reg.weaponKey, reg.bakedSize) * factor, 0.2, 5);
    sizes.set(ck(reg.charName, reg.weaponKey), next);
    try { localStorage.setItem(sizeKey(reg.charName, reg.weaponKey), String(next)); } catch { /* ignore */ }
    dirty.add(ck(reg.charName, reg.weaponKey));
    applyWrapScale(reg);
  }
  console.log('[weapon-size]', charName ?? 'ALL', '×', factor.toFixed(3), `(${targets.length} gun${targets.length === 1 ? '' : 's'})`);
}

// ── Position tune (arrows + ,/.) — offset per character per weapon ────────────────────────────────────
const posTunes = new Map<string, [number, number, number]>();
const posKey = (charName: string, weaponKey: string) => `siege_weapon_pos::${charName}::${weaponKey}`;

function getPos(charName: string, weaponKey: string): [number, number, number] {
  const key = ck(charName, weaponKey);
  let p = posTunes.get(key);
  if (!p) {
    p = [0, 0, 0];
    try { const s = typeof localStorage !== 'undefined' && localStorage.getItem(posKey(charName, weaponKey)); if (s) { const a = JSON.parse(s); if (Array.isArray(a) && a.length === 3) p = a as [number, number, number]; } } catch { /* default */ }
    posTunes.set(key, p);
  }
  return p;
}

export function applyWrapPos(reg: WeaponWrapReg): void {
  const p = getPos(reg.charName, reg.weaponKey);
  reg.wrap.position.set((reg.baseGrip[0] + p[0]) / reg.handScale, (reg.baseGrip[1] + p[1]) / reg.handScale, (reg.baseGrip[2] + p[2]) / reg.handScale);
}

// Move the current weapon along a hand-local axis, for the SELECTED character (or ALL).
export function nudgeWeaponPos(charName: string | null, axis: 'x' | 'y' | 'z', delta: number): void {
  const targets = weaponWraps().filter((r) => charName === null || r.charName === charName);
  if (!targets.length) { console.log('[weapon-pos]', axis, '(no gun on the selected character)'); return; }
  const i = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
  for (const reg of targets) {
    const p = getPos(reg.charName, reg.weaponKey);
    p[i] = Math.round((p[i] + delta) * 1000) / 1000;
    try { localStorage.setItem(posKey(reg.charName, reg.weaponKey), JSON.stringify(p)); } catch { /* ignore */ }
    dirty.add(ck(reg.charName, reg.weaponKey));
    applyWrapPos(reg);
  }
  const rep = targets[0]; const p = getPos(rep.charName, rep.weaponKey);
  console.log('[weapon-pos]', charName ?? 'ALL', rep.weaponKey, 'gripPos',
    [rep.baseGrip[0] + p[0], rep.baseGrip[1] + p[1], rep.baseGrip[2] + p[2]].map((n) => Math.round(n * 1000) / 1000));
}

// ── Export every tuned (character, weapon): orientation + grip + size, grouped by weapon ───────────────
export function exportTuning(): void {
  const byWeapon = new Map<string, string[]>();
  for (const key of dirty) {   // only the (character, weapon) pairs the user actually adjusted
    const sep = key.indexOf('::'); if (sep < 0) continue;
    const charName = key.slice(0, sep), weaponKey = key.slice(sep + 2);
    const baseRot = baseRotByKey.get(key); const baseGrip = baseGripByKey.get(key);
    if (!baseRot || !baseGrip) continue;   // never mounted this session → nothing to read
    _baseE.set(baseRot[0] * D2R, baseRot[1] * D2R, baseRot[2] * D2R, 'XYZ');
    _out.setFromEuler(_baseE).multiply(getTune(charName, weaponKey));
    _outE.setFromQuaternion(_out, 'XYZ');
    const p = getPos(charName, weaponKey);
    const grip = [baseGrip[0] + p[0], baseGrip[1] + p[1], baseGrip[2] + p[2]].map((n) => Math.round(n * 1000) / 1000);
    const size = getWeaponSize(charName, weaponKey);
    const line = `  ${charName}: rotDeg=[${Math.round(_outE.x * R2D)}, ${Math.round(_outE.y * R2D)}, ${Math.round(_outE.z * R2D)}] gripPos=[${grip.join(', ')}] size=${size.toFixed(2)}`;
    if (!byWeapon.has(weaponKey)) byWeapon.set(weaponKey, []);
    byWeapon.get(weaponKey)!.push(line);
  }
  const lines = ['=== SIEGE GUN TUNING (paste to Claude to bake) ==='];
  for (const [weaponKey, rows] of byWeapon) { lines.push(weaponKey); lines.push(...rows.sort()); }
  const lh = leftHandExportLines();
  if (lh.length) { lines.push('--- left hand ---'); lines.push(...lh); }
  const afk = armFKExportLines();
  if (afk.length) { lines.push('--- left arm (FK) ---'); lines.push(...afk); }
  const atl = atlasExportLines();
  if (atl.length) { lines.push('--- texture atlas (;) ---'); lines.push(...atl); }
  const spr = spreadExportLines();
  if (spr.length) { lines.push('--- shoulder spread ([ ]) ---'); lines.push(...spr); }
  const text = lines.join('\n');
  try { navigator.clipboard?.writeText(text); } catch { /* clipboard blocked — console only */ }
  console.log(text + '\n(copied to clipboard)');
}
