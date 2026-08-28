/**
 * Pulls a character's upper arms apart (or together) on top of the animation.
 *
 * The Mixamo pistol clips are a TWO-HANDED grip: the support hand wraps the
 * shooting hand. That geometry only works for the proportions the clip was
 * recorded on. Jankz is narrower through the shoulders than the capture actor,
 * so her palms end up intersecting — the hands read as one lump.
 *
 * The fix is a couple of degrees of abduction on each upper arm, per character.
 * The rotation is applied about the CHARACTER's own forward axis, which is what
 * "spread the arms apart" means regardless of how a given bone's local axes
 * happen to be oriented — guessing at a bone-local axis is how the earlier gun
 * rotations went in wrong.
 *
 * Applied AFTER the animation mixer each frame, or the mixer overwrites it.
 */
import * as THREE from 'three';

/** Degrees of outward rotation per character. Positive = hands further apart. */
const spread = new Map<string, number>();

/** Baked defaults. Everyone else is 0 — the clips fit them as recorded. */
const BAKED: Record<string, number> = {};

export const getSpread = (charName: string): number =>
  spread.get(charName) ?? BAKED[charName] ?? 0;

export function nudgeSpread(charName: string | null, names: string[], deg: number): void {
  for (const n of charName ? [charName] : names) spread.set(n, getSpread(n) + deg);
}

export function spreadExportLines(): string[] {
  const out: string[] = [];
  for (const [name, deg] of spread) out.push(`  ${name}: armSpread=${deg.toFixed(0)}`);
  return out.sort();
}

const _axis = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _parentQ = new THREE.Quaternion();
const D2R = Math.PI / 180;

export interface UpperArms { left: THREE.Object3D | null; right: THREE.Object3D | null }

/** Find the two upper-arm bones. glTF strips ':' from names, so match by suffix. */
export function findUpperArms(root: THREE.Object3D): UpperArms {
  let left: THREE.Object3D | null = null, right: THREE.Object3D | null = null;
  root.traverse((o) => {
    // 'LeftArm' is the upper arm; 'LeftForeArm' must not match it.
    if (o.name.endsWith('LeftArm')) left = o;
    else if (o.name.endsWith('RightArm')) right = o;
  });
  return { left, right };
}

/**
 * Rotate both upper arms outward by `deg` about `worldForward`.
 * Call after the mixer has written the clip pose for this frame.
 */
export function applySpread(arms: UpperArms, worldForward: THREE.Vector3, deg: number): void {
  if (!deg) return;
  for (const [bone, sign] of [[arms.left, 1], [arms.right, -1]] as Array<[THREE.Object3D | null, number]>) {
    if (!bone || !bone.parent) continue;
    // The forward axis expressed in this bone's PARENT frame, which is the frame
    // the bone's own quaternion lives in.
    bone.parent.getWorldQuaternion(_parentQ).invert();
    _axis.copy(worldForward).applyQuaternion(_parentQ).normalize();
    _q.setFromAxisAngle(_axis, sign * deg * D2R);
    bone.quaternion.premultiply(_q);
  }
}
