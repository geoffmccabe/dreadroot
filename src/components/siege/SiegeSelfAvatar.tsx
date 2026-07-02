// SiegeSelfAvatar — renders the player's OWN character at the player position (from playerState),
// holding the weapon, while the third-person camera is zoomed out — so you can see how each character
// holds each gun as it animates. Hidden in first-person. Purely additive: it reads the player pose +
// zoom distance and renders; it never touches the camera or controls, so it can't break gameplay.
//
// V1 = Rajax + the AK, rifle-idle. Character-select, live-anim sync (walk/run/aim) and the left-hand
// grip are follow-ups.
import { Suspense, useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF, useAnimations } from '@react-three/drei';
import { SkeletonUtils } from 'three-stdlib';
import * as THREE from 'three';
import { playerState } from './playerState';
import { getTPDist } from './siegeThirdPerson';
import { CHAR_ASSET_VERSION, RIFLE_LIBRARY, ANIM_LIBRARY } from './charlineup/siegeCharLineupState';
import { heldWeaponByKey } from './charlineup/weaponModels';

const EYE_HEIGHT = 1.6;
const SHOW_DIST = 0.3;   // reveal the body once the camera has pulled past this
const D2R = Math.PI / 180;
const glbUrl = (f: string) => `${f}?a=${CHAR_ASSET_VERSION}`;

// V1 self character (matches the spawn intro). A character-select panel will set this later.
const SELF = { name: 'Rajax', file: '/siege/characters/pilot_rajax.glb', scale: 1.140, minY: -0.0002 };

function SelfBody() {
  const { scene } = useGLTF(glbUrl(SELF.file), '/draco/');
  const { animations: rifleAnims } = useGLTF(glbUrl(RIFLE_LIBRARY), '/draco/');
  const { animations: baseAnims } = useGLTF(glbUrl(ANIM_LIBRARY), '/draco/');
  const ak = heldWeaponByKey('ak47');
  const { scene: gunScene } = useGLTF(glbUrl(ak?.url ?? SELF.file), '/draco/');

  const group = useRef<THREE.Group>(null);
  const inner = useRef<THREE.Group>(null);
  const wrapRef = useRef<THREE.Group | null>(null);
  const cloned = useMemo(() => {
    const c = SkeletonUtils.clone(scene) as THREE.Group;
    c.traverse((o) => { (o as THREE.Mesh).frustumCulled = false; });
    return c;
  }, [scene]);
  const anims = useMemo(() => [...rifleAnims, ...baseAnims], [rifleAnims, baseAnims]);
  const { actions, names } = useAnimations(anims, inner);

  // Play a rifle idle/aim clip so the two-handed hold is visible.
  useEffect(() => {
    if (!names.length) return;
    const pick = names.find((n) => /rifle/i.test(n) && /idle/i.test(n)) ?? names.find((n) => /rifle/i.test(n)) ?? names[0];
    const a = pick ? actions[pick] : null;
    if (a) a.reset().fadeIn(0.3).play();
    return () => { a?.fadeOut(0.2); };
  }, [actions, names]);

  useFrame(() => {
    const g = group.current; if (!g) return;
    const shown = getTPDist() > SHOW_DIST;
    g.visible = shown;
    if (!shown) return;
    // Stand at the player's feet, facing the look direction (away from the camera).
    g.position.set(playerState.x, playerState.y - EYE_HEIGHT - SELF.minY * SELF.scale, playerState.z);
    g.rotation.y = Math.atan2(playerState.fx, playerState.fz);
    // Attach the gun to the right hand once the bone + world matrices are live (retry each frame).
    if (!wrapRef.current && ak) {
      let hand: THREE.Object3D | undefined;
      cloned.traverse((o) => { if (o.name.endsWith('RightHand')) hand = o; });
      if (hand) {
        g.updateWorldMatrix(true, true);
        const ws = new THREE.Vector3(); hand.getWorldScale(ws); const hs = ws.x || 0;
        if (hs) {
          const model = gunScene.clone(true);
          const box = new THREE.Box3().setFromObject(model); const size = new THREE.Vector3(); box.getSize(size);
          const longest = Math.max(size.x, size.y, size.z) || 1;
          const rot = ak.rotByChar?.[SELF.name] ?? ak.rotDeg;
          const grip = ak.gripByChar?.[SELF.name] ?? ak.gripPos;
          const sz = ak.sizeByChar?.[SELF.name] ?? 1;
          const s = (ak.lengthM * sz / longest) / hs;
          const wrap = new THREE.Group();
          wrap.scale.setScalar(s);
          wrap.position.set(grip[0] / hs, grip[1] / hs, grip[2] / hs);
          wrap.rotation.set(rot[0] * D2R, rot[1] * D2R, rot[2] * D2R);
          wrap.add(model); hand.add(wrap); wrapRef.current = wrap;
        }
      }
    }
  });

  return (
    <group ref={group} scale={SELF.scale} visible={false}>
      <group ref={inner}><primitive object={cloned} /></group>
    </group>
  );
}

export function SiegeSelfAvatar() {
  return <Suspense fallback={null}><SelfBody /></Suspense>;
}
