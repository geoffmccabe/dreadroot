// LineupWeapon — attaches a two-handed gun model to a cloned character's Hand_R bone, sized so it
// reads as a real-world weapon on ANY character automatically. Mirrors the proven monster HandWeapon
// attach, but adds runtime size-normalisation: it measures the model's longest axis and the hand
// bone's WORLD scale, then derives the wrap scale to hit the weapon's target length. That removes the
// per-character scale tuning (Jankz's small hand vs Fluffer's large hand both get the right gun size).
// Position/rotation come straight from the weapon def (shared Mixamo hand frame → same for everyone).
import { useEffect } from 'react';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { CHAR_ASSET_VERSION } from './siegeCharLineupState';
import type { LineupWeaponDef } from './lineupWeapons';

const _box = new THREE.Box3();
const _size = new THREE.Vector3();
const _ws = new THREE.Vector3();
const D2R = Math.PI / 180;

export function LineupWeapon({ root, weapon }: { root: THREE.Group; weapon: LineupWeaponDef }) {
  const { scene } = useGLTF(`${weapon.url}?a=${CHAR_ASSET_VERSION}`, '/draco/');
  useEffect(() => {
    // Mixamo characters name the bone 'mixamorig:RightHand' (Synty monsters use 'Hand_R' — try both).
    let hand: THREE.Object3D | undefined;
    root.traverse((o) => { if (o.name === 'mixamorig:RightHand' || o.name === 'Hand_R') hand = o; });
    if (!hand) return;

    const model = scene.clone(true);
    // Model's longest rendered axis = the barrel length, in the glb's own units.
    model.updateMatrixWorld(true);
    _box.setFromObject(model); _box.getSize(_size);
    const longest = Math.max(_size.x, _size.y, _size.z) || 1;
    // Hand bone's world scale (includes the character group scale). Countering it makes the authored
    // numbers universal across characters instead of per-hand.
    root.updateWorldMatrix(true, true);
    hand.getWorldScale(_ws);
    const handScale = _ws.x || 1;
    const s = (weapon.lengthM / longest) / handScale;

    const wrap = new THREE.Group();
    wrap.scale.setScalar(s);
    // grip offset is authored in world metres → convert to the (scaled) hand-local frame
    wrap.position.set(weapon.gripPos[0] / handScale, weapon.gripPos[1] / handScale, weapon.gripPos[2] / handScale);
    wrap.rotation.set(weapon.rotDeg[0] * D2R, weapon.rotDeg[1] * D2R, weapon.rotDeg[2] * D2R);
    wrap.add(model);
    hand.add(wrap);
    const h = hand;
    return () => { h.remove(wrap); };
  }, [root, scene, weapon]);
  return null;
}
