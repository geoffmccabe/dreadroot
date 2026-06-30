// LineupWeapon — attaches a two-handed gun model to a cloned character's right-hand bone, sized so it
// reads as a real-world weapon on ANY character automatically. It measures the model's longest axis
// and the hand bone's WORLD scale, then derives the wrap scale to hit the weapon's target length —
// so no per-character scale tuning (Jankz's small hand vs Fluffer's large hand both get the right
// size). Position/rotation come from the weapon def (shared Mixamo hand frame → same for everyone).
//
// The attach runs in useFrame and RETRIES until the bone exists and the world matrices are live, then
// does it once. (A one-shot useEffect could fire a frame too early — bone not found / identity matrix
// → nothing attaches and never retries; that silent miss is why the gun didn't appear.)
import { useEffect, useRef } from 'react';
import { useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { CHAR_ASSET_VERSION } from './siegeCharLineupState';
import type { LineupWeaponDef } from './lineupWeapons';
import { registerWeaponWrap, unregisterWeaponWrap, WEAPON_EDIT_ID } from './weaponEditRegistry';

const _box = new THREE.Box3();
const _size = new THREE.Vector3();
const _ws = new THREE.Vector3();
const D2R = Math.PI / 180;
const REF_HEIGHT = 1.8;   // gun length is calibrated for a 1.8 m character; taller chars get bigger guns

export function LineupWeapon({ root, weapon, charHeight }: { root: THREE.Group; weapon: LineupWeaponDef; charHeight: number }) {
  const { scene } = useGLTF(`${weapon.url}?a=${CHAR_ASSET_VERSION}`);
  const wrapRef = useRef<THREE.Group | null>(null);
  const regId = useRef<string>(`wpn-${Math.random().toString(36).slice(2)}`);   // unique per instance

  useFrame(() => {
    if (wrapRef.current) return;            // already attached
    let hand: THREE.Object3D | undefined;   // Mixamo chars: 'mixamorig:RightHand'; Synty: 'Hand_R'.
    // three.js GLTFLoader sanitizes node names (strips reserved chars incl. ':'), so at RUNTIME the
    // bone is 'mixamorigRightHand' — NOT the file's 'mixamorig:RightHand'. Match by endsWith so it
    // works either way; finger bones end in Thumb/Index/Ring etc, so they never collide.
    root.traverse((o) => { if (o.name.endsWith('RightHand') || o.name === 'Hand_R') hand = o; });
    if (!hand) return;                      // bone not ready yet → try again next frame
    root.updateWorldMatrix(true, true);
    hand.getWorldScale(_ws);
    const handScale = _ws.x || 0;
    if (!handScale) return;                 // matrices not live yet → retry

    const model = scene.clone(true);
    model.updateMatrixWorld(true);
    _box.setFromObject(model); _box.getSize(_size);
    const longest = Math.max(_size.x, _size.y, _size.z) || 1;
    // Gun length scales with the CHARACTER's height (taller char → bigger gun): lengthM is the length
    // at REF_HEIGHT and grows/shrinks from there.
    // Size the gun from the character's KNOWN height (not a live bbox — that includes hats/hair/
    // cigarette smoke/raised arms and made Ash's gun comically large). Taller char → bigger gun.
    const gunLen = weapon.lengthM * ((charHeight || REF_HEIGHT) / REF_HEIGHT);
    const s = (gunLen / longest) / handScale;

    const wrap = new THREE.Group();
    wrap.scale.setScalar(s);
    wrap.position.set(weapon.gripPos[0] / handScale, weapon.gripPos[1] / handScale, weapon.gripPos[2] / handScale);
    wrap.rotation.set(weapon.rotDeg[0] * D2R, weapon.rotDeg[1] * D2R, weapon.rotDeg[2] * D2R);
    wrap.add(model);
    // RGB orientation gizmo in the gun's OWN frame: Red = X, Green = Y, Blue = Z. Drawn on top
    // (depthTest off) so it reads through the gun, sized to the gun's length. Lets us agree on axes
    // by colour and flip with ^ then x/y/z. Tagged so it can't be mistaken for a selectable child.
    const gizmo = new THREE.AxesHelper(longest);
    gizmo.renderOrder = 999;
    (gizmo.material as THREE.Material).depthTest = false;
    wrap.add(gizmo);
    hand.add(wrap);
    wrapRef.current = wrap;
    // Make the gun selectable in the Arrange panel (crosshair/L), and register it so one panel edit
    // drives every character's gun. Tag the model children too so any ray hit walks up to this id.
    wrap.userData.worldObjectId = WEAPON_EDIT_ID;
    wrap.traverse((c) => { c.userData.worldObjectId = WEAPON_EDIT_ID; });
    // Register with the weapon's base rotation; registerWeaponWrap re-applies base ∘ weaponTune so
    // any flips made earlier this session carry onto this freshly-mounted gun too.
    registerWeaponWrap(regId.current, { wrap, hand, handScale, baseRot: weapon.rotDeg });
  });

  useEffect(() => {
    const id = regId.current;
    return () => {
      unregisterWeaponWrap(id);
      const w = wrapRef.current;
      if (w && w.parent) w.parent.remove(w);
      wrapRef.current = null;
    };
  }, []);

  return null;
}
