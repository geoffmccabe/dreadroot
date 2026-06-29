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

const _box = new THREE.Box3();
const _size = new THREE.Vector3();
const _ws = new THREE.Vector3();
const _charBox = new THREE.Box3();
const _charSize = new THREE.Vector3();
const D2R = Math.PI / 180;
const REF_HEIGHT = 1.8;   // gun length is calibrated for a 1.8 m character; taller chars get bigger guns

export function LineupWeapon({ root, weapon }: { root: THREE.Group; weapon: LineupWeaponDef }) {
  const { scene } = useGLTF(`${weapon.url}?a=${CHAR_ASSET_VERSION}`);
  const wrapRef = useRef<THREE.Group | null>(null);

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
    _charBox.setFromObject(root); const charH = _charBox.getSize(_charSize).y || REF_HEIGHT;
    const gunLen = weapon.lengthM * (charH / REF_HEIGHT);
    const s = (gunLen / longest) / handScale;

    const wrap = new THREE.Group();
    wrap.scale.setScalar(s);
    wrap.position.set(weapon.gripPos[0] / handScale, weapon.gripPos[1] / handScale, weapon.gripPos[2] / handScale);
    wrap.rotation.set(weapon.rotDeg[0] * D2R, weapon.rotDeg[1] * D2R, weapon.rotDeg[2] * D2R);
    wrap.add(model);
    hand.add(wrap);
    wrapRef.current = wrap;
  });

  useEffect(() => () => {
    const w = wrapRef.current;
    if (w && w.parent) w.parent.remove(w);
    wrapRef.current = null;
  }, []);

  return null;
}
