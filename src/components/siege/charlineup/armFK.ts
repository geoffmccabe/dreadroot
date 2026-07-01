// armFK — MANUAL per-joint left-arm posing for held weapons, replacing the finicky two-bone IK.
// For each (character, weapon) the user cycles the joint ({ }) and rotates it on 3 LOCAL axes
// (arrows + , .). Each joint holds a degrees-offset from its bind pose; applied every frame it poses
// the arm to grip the gun, and — unlike IK — a nudge moves ONLY that joint by that amount. Per
// character (arms differ) per weapon. Persisted in localStorage; exported with the gun tuning ('\').
import * as THREE from 'three';

export const ARM_JOINTS = ['shoulder', 'elbow', 'wrist'] as const;   // LeftArm, LeftForeArm, LeftHand
type FK = [number, number, number][];   // [joint][x,y,z] degrees

const store = new Map<string, FK>();     // `${char}::${weapon}` → 3×3 degrees
const dirty = new Set<string>();          // pairs the user adjusted (drives the export)
const ck = (c: string, w: string) => `${c}::${w}`;
const lsKey = (c: string, w: string) => `siege_armfk::${c}::${w}`;
const D2R = Math.PI / 180;
const blank = (): FK => [[0, 0, 0], [0, 0, 0], [0, 0, 0]];

export function getArmFK(charName: string, weaponKey: string): FK {
  const k = ck(charName, weaponKey);
  let v = store.get(k);
  if (!v) {
    v = blank();
    try {
      const s = typeof localStorage !== 'undefined' && localStorage.getItem(lsKey(charName, weaponKey));
      if (s) { const a = JSON.parse(s); if (Array.isArray(a) && a.length === 3) v = a.map((j: number[]) => [j[0] || 0, j[1] || 0, j[2] || 0]); }
    } catch { /* blank */ }
    store.set(k, v);
  }
  return v;
}
export function hasArmFK(charName: string, weaponKey: string): boolean {
  return getArmFK(charName, weaponKey).some((j) => j[0] || j[1] || j[2]);
}

// Rotate ONE joint of the selected character (charName) — or every character (charName = null, using
// `allChars`) — by `deg` on a local axis (0=x,1=y,2=z).
export function nudgeArmFK(charName: string | null, weaponKey: string, joint: number, axis: 0 | 1 | 2, deg: number, allChars: string[]): void {
  const targets = charName === null ? allChars : [charName];
  for (const c of targets) {
    const fk = getArmFK(c, weaponKey);
    fk[joint][axis] = Math.round((fk[joint][axis] + deg) * 10) / 10;
    try { localStorage.setItem(lsKey(c, weaponKey), JSON.stringify(fk)); } catch { /* ignore */ }
    dirty.add(ck(c, weaponKey));
  }
  const rep = getArmFK(targets[0], weaponKey);
  console.log('[arm-fk]', charName ?? 'ALL', weaponKey, ARM_JOINTS[joint], ['x', 'y', 'z'][axis], `${deg > 0 ? '+' : ''}${deg}°`, '→', rep[joint]);
}

const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
// Pose the 3 arm bones: bone = bind ∘ offset(deg), overriding the animation's left-arm motion so the
// posed hold is steady and predictable. `bind` = each bone's rest-pose local quaternion (captured
// before the mixer ran).
export function applyArmFK(bones: { arm: THREE.Object3D; fore: THREE.Object3D; hand: THREE.Object3D },
  bind: [THREE.Quaternion, THREE.Quaternion, THREE.Quaternion], fk: FK): void {
  const chain = [bones.arm, bones.fore, bones.hand];
  for (let j = 0; j < 3; j++) {
    _e.set(fk[j][0] * D2R, fk[j][1] * D2R, fk[j][2] * D2R, 'XYZ');
    chain[j].quaternion.copy(bind[j]).multiply(_q.setFromEuler(_e));
    chain[j].updateMatrixWorld(true);
  }
}

// Lines for the '\' export (per adjusted character+weapon).
export function armFKExportLines(): string[] {
  const out: string[] = [];
  for (const k of dirty) {
    const sep = k.indexOf('::'); if (sep < 0) continue;
    const c = k.slice(0, sep), w = k.slice(sep + 2);
    const fk = getArmFK(c, w);
    out.push(`  ${w} ${c}: shoulder=[${fk[0].join(', ')}] elbow=[${fk[1].join(', ')}] wrist=[${fk[2].join(', ')}]`);
  }
  return out.sort();
}
