/**
 * Put the held weapon in the character's hand, using the fitting Geoff already
 * tuned.
 *
 * NONE OF THESE NUMBERS ARE NEW. `sizeByChar`, `rotByChar` and `gripByChar` in
 * weaponModels.ts were tuned by hand, per character, per weapon, in the lineup
 * editor. The Siege self-avatar has been using them all along; the DreadRoot
 * avatar simply never attached anything, so the character held air. This reads
 * the same table rather than re-deriving anything.
 *
 * Everything is expressed relative to the HAND BONE, which is why the scale and
 * grip are divided by the hand's world scale: these models are skinned under
 * armatures with wildly different scales (0.01 on the pilots, 1 on Jeanette),
 * so a position in metres means nothing until it is converted into the hand's
 * own space.
 */
import * as THREE from 'three';
import { heldWeaponFor, type HeldWeapon } from '@/components/siege/charlineup/weaponModels';

const D2R = Math.PI / 180;

/**
 * Corrections applied in WORLD space after the per-character grip is set.
 *
 * These are world-space on purpose. The weapon hangs off the HAND BONE, which
 * is itself rotated, so the wrap's local Y is NOT the world vertical — nudging
 * the Euler angles would rotate it about some tilted axis and land somewhere
 * unpredictable. Converting a world axis into the hand's space first is the
 * only way "rotate 90 degrees about vertical" means what it says.
 *
 * YAW_FIX_DEG is NEGATIVE because Geoff asked for CLOCKWISE seen from above,
 * and a POSITIVE rotation about +Y is COUNTER-clockwise from above. Verified
 * rather than recalled: +90 about Y takes +X (east) to -Z (north), and
 * east-to-north is counter-clockwise on a map. So clockwise is negative.
 */
export const YAW_FIX_DEG = -90;
/** Metres to pull the weapon back toward the body — it floated in front. */
export const PULL_BACK_M = 0.10;

export interface AttachedWeapon {
  /** The wrapper parented to the hand bone. Hide it when unarmed. */
  wrap: THREE.Group;
  /** Where the shot comes from, in the weapon's own space. */
  muzzleLocal: THREE.Vector3;
  weapon: HeldWeapon;
}

export function weaponForItem(itemNumber: number | null | undefined): HeldWeapon | null {
  if (itemNumber === null || itemNumber === undefined) return null;
  return heldWeaponFor(itemNumber);
}

/**
 * Build and parent the weapon. Returns null when the hand bone or its world
 * matrices are not ready yet — the caller should simply try again next frame,
 * which is what the Siege avatar does.
 */
export function attachWeapon(
  root: THREE.Object3D,
  handBone: THREE.Object3D,
  gunScene: THREE.Object3D,
  weapon: HeldWeapon,
  characterName: string,
): AttachedWeapon | null {
  root.updateWorldMatrix(true, true);
  const ws = new THREE.Vector3();
  handBone.getWorldScale(ws);
  const hs = ws.x || 0;
  if (!hs) return null;   // matrices not live yet

  const model = gunScene.clone(true);
  // A weapon in your own hand must never block your own shots.
  model.traverse((o) => { (o as THREE.Mesh).raycast = () => {}; });

  const box = new THREE.Box3().setFromObject(model);
  const size = new THREE.Vector3();
  box.getSize(size);
  const longest = Math.max(size.x, size.y, size.z) || 1;

  const rot = weapon.rotByChar?.[characterName] ?? weapon.rotDeg;
  const grip = weapon.gripByChar?.[characterName] ?? weapon.gripPos;
  const sz = weapon.sizeByChar?.[characterName] ?? 1;
  const s = (weapon.lengthM * sz / longest) / hs;

  const wrap = new THREE.Group();
  wrap.scale.setScalar(s);
  wrap.position.set(grip[0] / hs, grip[1] / hs, grip[2] / hs);
  wrap.rotation.set(rot[0] * D2R, rot[1] * D2R, rot[2] * D2R);
  wrap.add(model);
  handBone.add(wrap);

  // ── World-space corrections ────────────────────────────────────────────
  // Everything above is in the hand bone's space. These two are stated in
  // world terms, so they are converted into that space rather than applied to
  // the Euler angles directly.
  const handWorldQ = new THREE.Quaternion();
  handBone.getWorldQuaternion(handWorldQ);
  const handInv = handWorldQ.clone().invert();

  // Turn about the WORLD vertical, expressed in hand space.
  const worldUpInHand = new THREE.Vector3(0, 1, 0).applyQuaternion(handInv).normalize();
  wrap.quaternion.premultiply(
    new THREE.Quaternion().setFromAxisAngle(worldUpInHand, YAW_FIX_DEG * D2R),
  );

  // Pull it back toward the body. The character's forward is +Z in model space,
  // so "toward the body" is the negative of the ROOT's forward — taken from the
  // root rather than the hand, because the hand swings as the arms animate and
  // a hand-relative offset would drift with the pose.
  const rootQ = new THREE.Quaternion();
  root.getWorldQuaternion(rootQ);
  const backWorld = new THREE.Vector3(0, 0, 1).applyQuaternion(rootQ).normalize().negate();
  const backInHand = backWorld.applyQuaternion(handInv);
  // Divided by the hand's world scale for the same reason the grip is: metres
  // mean nothing until they are in the hand's own units.
  wrap.position.addScaledVector(backInHand, PULL_BACK_M / hs);

  /**
   * The muzzle: the far end of the model along its longest axis.
   *
   * Derived from the model's own bounds rather than stored per weapon, because
   * there is no muzzle data in the table and guessing a number per gun would be
   * exactly the hand-tuning this file exists to avoid. The longest axis of a
   * gun IS the barrel, so its far end is the muzzle to within a few
   * centimetres — close enough for a tracer origin, which only has to look
   * right, not be authoritative. AIM still comes from the camera.
   */
  const c = new THREE.Vector3();
  box.getCenter(c);
  const muzzleLocal = c.clone();
  if (size.x >= size.y && size.x >= size.z) muzzleLocal.x = box.max.x;
  else if (size.y >= size.z) muzzleLocal.y = box.max.y;
  else muzzleLocal.z = box.max.z;

  return { wrap, muzzleLocal, weapon };
}
