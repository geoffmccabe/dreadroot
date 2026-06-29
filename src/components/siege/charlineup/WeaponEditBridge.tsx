// WeaponEditBridge — connects the Arrange panel's selection/transform to the hand-attached guns.
//
// The panel edits world-space TRS; a gun is parented to an animated hand bone, so we convert. While
// the weapon object (WEAPON_EDIT_ID) is the panel's selection, each change to its world orientation is
// turned into the wrap's LOCAL rotation at the current hand pose (handWorld⁻¹ · worldQuat) and applied
// to EVERY character's gun (the rotDeg/gripPos are shared). The resulting bakeable numbers are logged
// so they can be pasted into weaponModels.ts. Nothing here renders or persists.
import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { weaponWraps, WEAPON_EDIT_ID } from './weaponEditRegistry';
import { current, getEditMode, registerExternal, removeExternal } from '@/features/objectEditor/store';
import type { Quat, Vec3 } from '@/features/objectEditor/types';

const R2D = 180 / Math.PI;
const _hq = new THREE.Quaternion();
const _wq = new THREE.Quaternion();
const _local = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _e = new THREE.Euler();
const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function WeaponEditBridge() {
  const registered = useRef(false);
  const prevQuat = useRef<Quat | null>(null);
  const prevPos = useRef<Vec3 | null>(null);

  useEffect(() => () => { removeExternal(WEAPON_EDIT_ID); }, []);

  useFrame(() => {
    const wraps = weaponWraps();
    if (!wraps.length) return;
    const rep = wraps[0];

    // Register the weapon as a selectable editor object once edit mode is on — seeded with the gun's
    // CURRENT world transform so selecting it doesn't jump.
    if (getEditMode() && !registered.current) {
      rep.wrap.getWorldQuaternion(_wq); rep.wrap.getWorldPosition(_v);
      registerExternal({ id: WEAPON_EDIT_ID, modelUrl: 'external:weapon',
        pos: [_v.x, _v.y, _v.z], quat: [_wq.x, _wq.y, _wq.z, _wq.w], scale: [1, 1, 1] });
      registered.current = true;
      prevQuat.current = [_wq.x, _wq.y, _wq.z, _wq.w];
      prevPos.current = [_v.x, _v.y, _v.z];
    }
    if (!getEditMode()) { registered.current = false; return; }

    // Only react while the weapon is the active selection.
    const sel = current();
    if (!sel || sel.id !== WEAPON_EDIT_ID) return;

    const q = sel.quat, p = sel.pos;
    const pq = prevQuat.current, pp = prevPos.current;
    const qChanged = !pq || q[0] !== pq[0] || q[1] !== pq[1] || q[2] !== pq[2] || q[3] !== pq[3];
    const pChanged = !pp || p[0] !== pp[0] || p[1] !== pp[1] || p[2] !== pp[2];
    if (!qChanged && !pChanged) return;
    prevQuat.current = [q[0], q[1], q[2], q[3]];
    prevPos.current = [p[0], p[1], p[2]];

    // World orientation → wrap-local at the rep hand's current pose (shared offset for all guns).
    rep.hand.getWorldQuaternion(_hq);
    _wq.set(q[0], q[1], q[2], q[3]);
    _local.copy(_hq).invert().multiply(_wq);
    // World position → rep-hand-local units → metres (gripPos), re-divided per gun's own hand scale.
    rep.hand.updateWorldMatrix(true, false);
    _v.set(p[0], p[1], p[2]); rep.hand.worldToLocal(_v); _v.multiplyScalar(rep.handScale);
    for (const w of wraps) {
      w.wrap.quaternion.copy(_local);
      w.wrap.position.set(_v.x / w.handScale, _v.y / w.handScale, _v.z / w.handScale);
    }
    _e.setFromQuaternion(_local, 'XYZ');
    // Copy these two into weaponModels.ts (rotDeg / gripPos):
    console.log('[weapon-tune] rotDeg:', [r2(_e.x * R2D), r2(_e.y * R2D), r2(_e.z * R2D)],
      ' gripPos:', [r3(_v.x), r3(_v.y), r3(_v.z)]);
  });

  return null;
}
