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
import { findLeftArm, getLeftTarget, getWrist, solveArmIK } from './leftHandIK';

const _box = new THREE.Box3();
const _size = new THREE.Vector3();
const _center = new THREE.Vector3();
const _ws = new THREE.Vector3();
const _targetWorld = new THREE.Vector3();
const REF_HEIGHT = 1.8;   // gun length is calibrated for a 1.8 m character; taller chars get bigger guns

export function LineupWeapon({ root, weapon, charHeight, charName, showGizmo, leftHandActive }: { root: THREE.Group; weapon: LineupWeaponDef; charHeight: number; charName: string; showGizmo: boolean; leftHandActive: boolean }) {
  const { scene } = useGLTF(`${weapon.url}?a=${CHAR_ASSET_VERSION}`);
  const wrapRef = useRef<THREE.Group | null>(null);
  const gizmoRef = useRef<THREE.AxesHelper | null>(null);
  const showGizmoRef = useRef(showGizmo); showGizmoRef.current = showGizmo;   // latest, read in the frame loop
  const lhaRef = useRef(leftHandActive); lhaRef.current = leftHandActive;      // left-hand IK on for this clip?
  const bonesRef = useRef<ReturnType<typeof findLeftArm>>(null);
  const regId = useRef<string>(`wpn-${Math.random().toString(36).slice(2)}`);   // unique per instance

  useFrame(() => {
    if (gizmoRef.current) gizmoRef.current.visible = showGizmoRef.current;   // gizmo only on the selected char
    if (wrapRef.current) {
      // Left-hand support IK: place the left hand on the gun's captured grip point (runs after the
      // animation set the pose). Skips when no point captured or the clip has the left hand off the gun.
      const target = lhaRef.current ? getLeftTarget(weapon.url) : null;
      if (target) {
        if (!bonesRef.current) bonesRef.current = findLeftArm(root);
        const b = bonesRef.current;
        if (b) {
          root.updateMatrixWorld(true);
          _targetWorld.copy(target); wrapRef.current.localToWorld(_targetWorld);
          solveArmIK(b.arm, b.fore, b.hand, _targetWorld, getWrist(weapon.url));
        }
      }
      return;
    }            // already attached
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
    _box.setFromObject(model); _box.getSize(_size); _box.getCenter(_center);
    const longest = Math.max(_size.x, _size.y, _size.z) || 1;
    // RECENTER the model so its geometric centre sits at the wrap origin. The SWU weapon models have
    // their pivot far from the geometry, so without this they float off in the air; recentering puts
    // them in the hand, and gripPos (+ position nudges) fine-tunes from there.
    model.position.set(-_center.x, -_center.y, -_center.z);
    // Size the gun from the character's KNOWN height (not a live bbox — that includes hats/hair/
    // cigarette smoke/raised arms and made Ash's gun comically large). Taller char → bigger gun.
    const gunLen = weapon.lengthM * ((charHeight || REF_HEIGHT) / REF_HEIGHT);
    const s = (gunLen / longest) / handScale;

    const wrap = new THREE.Group();
    wrap.add(model);
    // RGB orientation gizmo in the gun's OWN frame: Red = X, Green = Y, Blue = Z. Drawn on top
    // (depthTest off) so it reads through the gun, sized to the gun's length. Shown only on the
    // selected character (showGizmo). Tagged so it can't be mistaken for a selectable child.
    const gizmo = new THREE.AxesHelper(longest);
    gizmo.renderOrder = 999;
    (gizmo.material as THREE.Material).depthTest = false;
    gizmo.visible = showGizmoRef.current;
    wrap.add(gizmo);
    gizmoRef.current = gizmo;
    hand.add(wrap);
    wrapRef.current = wrap;
    wrap.userData.worldObjectId = WEAPON_EDIT_ID;
    wrap.traverse((c) => { c.userData.worldObjectId = WEAPON_EDIT_ID; });
    // Register with base rotation/scale/grip + char/weapon keys; registerWeaponWrap applies the saved
    // orientation, per-character size, and position offset for this weapon onto the wrap.
    // Effective per-character baseline (a baked per-char override if present, else the shared value);
    // the runtime tune refines from there.
    const baseRot = weapon.rotByChar?.[charName] ?? weapon.rotDeg;
    const baseGrip = weapon.gripByChar?.[charName] ?? weapon.gripPos;
    registerWeaponWrap(regId.current, { wrap, hand, handScale, baseRot, baseScale: s, bakedSize: weapon.sizeByChar?.[charName] ?? 1, baseGrip, weaponKey: weapon.url, charName });
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
