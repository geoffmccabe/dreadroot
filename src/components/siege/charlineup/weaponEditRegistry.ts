// Registry of the live lineup-weapon wraps + the manual gun-tuning tools. EVERY tuning axis —
// orientation, position, and size — is PER CHARACTER PER WEAPON (keyed `${charName}::${weaponKey}`),
// because hand size/shape differ so a gun that grips right on one character is off on another. The
// adjusters act only on the SELECTED character. Each gun's wrap = baseRot(char,weapon) ∘ rotTune,
// pos = baseGrip + posTune, scale = baseScale × size. All persist in localStorage; '\' exports them.
import * as THREE from 'three';
import { leftHandExportLines } from './leftHandIK';
import { armFKExportLines } from './armFK';
import { atlasExportLines } from './weaponAtlas';
import { poseExportLines } from './armSpread';

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
    return weaponWraps().map((r) => {
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
      const wp = new THREE.Vector3(); r.wrap.getWorldPosition(wp);
      return { char: r.charName, weapon: r.weaponKey.split('/').pop(),
        world: [+wp.x.toFixed(3), +wp.y.toFixed(3), +wp.z.toFixed(3)], longestM: +Math.max(s.x, s.y, s.z).toFixed(3), mats, textured,
        rot: [deg(e.x), deg(e.y), deg(e.z)],
        pos: [+r.wrap.position.x.toFixed(3), +r.wrap.position.y.toFixed(3), +r.wrap.position.z.toFixed(3)] };
    });
  };
}

// The editor-object id every gun wrap tags itself with, so the crosshair/L selects them all as one.
export const WEAPON_EDIT_ID = 'weapon:held';

// When weapon tuning is baked into code, the in-browser tweaks for those weapons must be cleared ONCE
// so the baked values apply cleanly (else base ∘ saved-tune doubles). Bump BAKE_VERSION + list the
// baked urls; a scan removes their per-character tune/pos keys. (Size never doubles, so it's kept.)
const BAKE_VERSION = '19';  // v19: 7 untuned weapons moved off the blind guess onto RIFLE_ROT
const BAKED_URLS = new Set([
  '/siege/weapons/ak47.glb', '/siege/weapons/item_17.glb', '/siege/weapons/item_18.glb',
  '/siege/weapons/item_19.glb', '/siege/weapons/item_142.glb', '/siege/weapons/item_4.glb',
  '/siege/weapons/item_12.glb', '/siege/weapons/item_1.glb', '/siege/weapons/item_5.glb',
  '/siege/weapons/item_6.glb', '/siege/weapons/item_14.glb',
  // v12 — the one-handed weapons, all now carrying the eye-tuned PISTOL_ROT/PISTOL_GRIP baseline.
  '/siege/weapons/item_15.glb', '/siege/weapons/item_0.glb', '/siege/weapons/item_201.glb',
  '/siege/weapons/item_25.glb', '/siege/weapons/item_193.glb', '/siege/weapons/item_2.glb',
  '/siege/weapons/item_3.glb', '/siege/weapons/item_153.glb',
  // v19 — the seven still on the original blind guess, now on the tuned two-handed baseline.
  '/siege/weapons/item_208.glb', '/siege/weapons/item_24.glb', '/siege/weapons/item_168.glb',
  '/siege/weapons/item_180.glb', '/siege/weapons/item_26.glb', '/siege/weapons/item_215.glb',
  '/siege/weapons/item_222.glb',
]);
try {
  if (typeof localStorage !== 'undefined' && localStorage.getItem('siege_weapon_bake') !== BAKE_VERSION) {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i); if (!k) continue;
      // Also the left-hand hold (grip point / wrist / swivel). Those are ABSOLUTE values rather
      // than offsets so they cannot double like rotation and position do — but a saved one still
      // SHADOWS a newly baked one, so the person who tuned it would be the only one seeing the fix.
      if (k.startsWith('siege_weapon_tune::') || k.startsWith('siege_weapon_pos::')
          || k.startsWith('siege_lefthand_')) {
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
const _wq2 = new THREE.Quaternion();
const _dir = new THREE.Vector3();
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

/**
 * Move the current weapon in a direction the USER can see, for the SELECTED character (or ALL).
 *
 * WHY THIS EXISTS. The offset is stored along the HAND BONE's own axes, and a hand
 * bone points wherever the skeleton says — nowhere near screen left/right/up/down.
 * So the left arrow moved the gun up, the up arrow moved it sideways, and so on.
 * Reported as "the arrow keys are all reversed"; they were worse than reversed,
 * they were scrambled, and differently per character.
 *
 * `worldDir` is a direction the viewer means — screen right, world up, into the
 * screen — and it is converted into each hand's own frame here. Same key, same
 * visible result, on every character.
 */
export function nudgeWeaponPosDir(charName: string | null, worldDir: THREE.Vector3, metres: number): void {
  const targets = weaponWraps().filter((r) => charName === null || r.charName === charName);
  if (!targets.length) { console.log('[weapon-pos] (no gun on the selected character)'); return; }
  for (const reg of targets) {
    reg.hand.getWorldQuaternion(_wq2).invert();
    _dir.copy(worldDir).normalize().applyQuaternion(_wq2).multiplyScalar(metres);
    const p = getPos(reg.charName, reg.weaponKey);
    for (let i = 0; i < 3; i++) p[i] = Math.round((p[i] + _dir.getComponent(i)) * 1000) / 1000;
    try { localStorage.setItem(posKey(reg.charName, reg.weaponKey), JSON.stringify(p)); } catch { /* ignore */ }
    dirty.add(ck(reg.charName, reg.weaponKey));
    applyWrapPos(reg);
  }
  const rep = targets[0]; const p = getPos(rep.charName, rep.weaponKey);
  console.log('[gun-pos]', charName ?? 'ALL', 'grip now',
    [rep.baseGrip[0] + p[0], rep.baseGrip[1] + p[1], rep.baseGrip[2] + p[2]].map((n) => Math.round(n * 1000) / 1000));
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
  const spr = poseExportLines();
  if (spr.length) { lines.push('--- shoulders: spread [ ] / pitch { } ---'); lines.push(...spr); }
  // The step that is easy to forget and silently wrecks the result: baking a value into code
  // while the browser still holds the SAME value as a tune makes the wrap apply it twice
  // (rotation composes, position adds). Naming the urls here means the bake instruction travels
  // WITH the numbers instead of living only in a comment further up this file.
  if (byWeapon.size) {
    lines.push('--- WHEN BAKING THESE: bump BAKE_VERSION and add to BAKED_URLS ---');
    for (const weaponKey of byWeapon.keys()) lines.push(`  '${weaponKey}',`);
  }
  const text = lines.join('\n');
  try { navigator.clipboard?.writeText(text); } catch { /* clipboard blocked — console only */ }
  console.log(text + '\n(copied to clipboard)');
}
