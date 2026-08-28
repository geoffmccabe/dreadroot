/**
 * Per-character shoulder adjustment on top of the animation clips.
 *
 * The Mixamo pistol clips are a TWO-HANDED grip recorded on one actor. Two
 * things about that pose do not transfer to every character:
 *
 *  - SPREAD. A character narrower through the shoulders than the capture actor
 *    ends up with the palms intersecting — the hands read as one lump (Jankz).
 *  - PITCH. The whole arm assembly sits too high on everyone, so the character's
 *    eye does not line up down the sights. Both shoulders want rotating down.
 *
 * Both are applied as a rotation of the two upper-arm bones about an axis in the
 * CHARACTER's own frame — forward for spread, right for pitch. Deliberately not
 * a bone-local axis: which way a given Mixamo bone's local X points is not
 * something to guess at, and guessing at it is how the gun rotations went in
 * wrong twice.
 *
 * Applied AFTER the animation mixer each frame, or the clip overwrites it.
 */
import * as THREE from 'three';

export interface ArmPose { spread: number; pitch: number }

/** Live values being tuned, per character. */
const pose = new Map<string, ArmPose>();

/**
 * Baked defaults, in degrees.
 *  spread: + pulls the hands apart.
 *  pitch:  + lowers the arms (rotates the shoulders down).
 */
/**
 * Everyone gets the arms lowered by default. The pistol clips carry the whole arm
 * assembly too high, so the character's eye does not line up down the sights —
 * reported on every character, so it belongs in the default rather than per name.
 * 5° is the starting guess; measured, it drops the hands ~3.5 cm.
 */
const DEFAULT_PITCH = 5;

const BAKED: Record<string, ArmPose> = {
  // Eye-tuned 2026-Aug-28. Pitch varies a lot more than expected: Dago and Fluffer, the two
  // tallest, need roughly three times the drop the others do to get the eye down onto the sights.
  Ash: { spread: 0, pitch: 5 },
  Dago: { spread: 0, pitch: 17 },
  Fluffer: { spread: 0, pitch: 14 },
  Thorn: { spread: -3, pitch: 5 },
  // Not re-adjusted in the last pass, so these stand.
  Jankz: { spread: 4, pitch: DEFAULT_PITCH },
  Rajax: { spread: 0, pitch: DEFAULT_PITCH },
  // Not in the lineup — inherit from the nearest analogue by height, as elsewhere.
  Flamma: { spread: 0, pitch: 5 },
  Jeanette: { spread: -3, pitch: 5 },
  'Shi Yang': { spread: 0, pitch: DEFAULT_PITCH },
};

const ZERO: ArmPose = { spread: 0, pitch: DEFAULT_PITCH };

export function getPose(charName: string): ArmPose {
  return pose.get(charName) ?? BAKED[charName] ?? ZERO;
}

export function nudgePose(
  charName: string | null, names: string[], field: keyof ArmPose, deg: number,
): void {
  for (const n of charName ? [charName] : names) {
    const cur = getPose(n);
    pose.set(n, { ...cur, [field]: cur[field] + deg });
  }
}

export function poseExportLines(): string[] {
  const out: string[] = [];
  for (const [name, p] of pose) out.push(`  ${name}: armSpread=${p.spread.toFixed(0)} armPitch=${p.pitch.toFixed(0)}`);
  return out.sort();
}

const _axis = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _parentQ = new THREE.Quaternion();
const _right = new THREE.Vector3();
const D2R = Math.PI / 180;

export interface UpperArms { left: THREE.Object3D | null; right: THREE.Object3D | null }

/** Find the two upper-arm bones. glTF strips ':' from names, so match by suffix.
 *  'LeftForeArm' ends in 'ForeArm', so it can never be mistaken for 'LeftArm'. */
export function findUpperArms(root: THREE.Object3D): UpperArms {
  let left: THREE.Object3D | null = null, right: THREE.Object3D | null = null;
  root.traverse((o) => {
    if (o.name.endsWith('LeftArm')) left = o;
    else if (o.name.endsWith('RightArm')) right = o;
  });
  return { left, right };
}

/** Rotate one bone by `deg` about a world-space axis, composed onto the clip pose. */
function rotateBone(bone: THREE.Object3D | null, worldAxis: THREE.Vector3, deg: number): void {
  if (!bone || !bone.parent || !deg) return;
  // The axis expressed in the bone's PARENT frame — the frame its own quaternion lives in.
  bone.parent.getWorldQuaternion(_parentQ).invert();
  _axis.copy(worldAxis).applyQuaternion(_parentQ).normalize();
  _q.setFromAxisAngle(_axis, deg * D2R);
  bone.quaternion.premultiply(_q);
}

/**
 * Apply spread + pitch to both upper arms.
 * `yaw` is the character group's Y rotation; forward is (sin, 0, cos) and right
 * is that turned a quarter clockwise.
 * Call after the mixer has written the clip pose for this frame.
 */
export function applyArmPose(arms: UpperArms, yaw: number, p: ArmPose): void {
  if (!p.spread && !p.pitch) return;
  const fwdX = Math.sin(yaw), fwdZ = Math.cos(yaw);
  if (p.spread) {
    // VERTICAL, not forward. In a two-handed pistol grip both arms point FORWARD, and rotating a
    // forward-pointing arm about the forward axis just spins it along its own length — measured, 12°
    // moved the hands 8mm apart, which is why this read as a dead key. About the vertical axis the
    // hand swings sideways, which is what "pull them apart" means.
    _right.set(0, 1, 0);
    rotateBone(arms.left, _right, -p.spread);
    rotateBone(arms.right, _right, p.spread);
  }
  if (p.pitch) {
    _right.set(fwdZ, 0, -fwdX);                   // right: the pitch axis
    // Same sign on both arms: the whole assembly drops together.
    rotateBone(arms.left, _right, p.pitch);
    rotateBone(arms.right, _right, p.pitch);
  }
}

// ── Dev probe ────────────────────────────────────────────────────────────────
// How far apart are the hands, really? A shoulder tweak that "does nothing" is
// otherwise indistinguishable from a key that never fired, and this tool has
// already burned two rounds on exactly that ambiguity.
const roots = new Map<string, THREE.Object3D>();
export function registerArmRoot(charName: string, root: THREE.Object3D): void {
  roots.set(charName, root);
}
if (typeof window !== 'undefined') {
  (window as unknown as { __lineupHands?: () => unknown }).__lineupHands = () => {
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    const out: Record<string, unknown> = {};
    for (const [name, root] of roots) {
      let lh: THREE.Object3D | null = null, rh: THREE.Object3D | null = null;
      root.traverse((o) => {
        if (o.name.endsWith('LeftHand')) lh = o;
        else if (o.name.endsWith('RightHand')) rh = o;
      });
      if (!lh || !rh) { out[name] = 'hands not found'; continue; }
      (lh as THREE.Object3D).getWorldPosition(a);
      (rh as THREE.Object3D).getWorldPosition(b);
      out[name] = { gapCm: +(a.distanceTo(b) * 100).toFixed(1), leftY: +a.y.toFixed(3), pose: getPose(name) };
    }
    return out;
  };
}
