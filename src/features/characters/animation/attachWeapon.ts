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
