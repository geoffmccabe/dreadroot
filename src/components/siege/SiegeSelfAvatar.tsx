// SiegeSelfAvatar — renders the player's OWN character at the player position (from playerState),
// holding the weapon, while the third-person camera is zoomed out — so you can see how each character
// holds each gun as it animates. Hidden in first-person. Purely additive: it reads the player pose +
// zoom distance and renders; it never touches the camera or controls, so it can't break gameplay.
//
// V1 = Rajax + the AK, rifle-idle. Character-select, live-anim sync (walk/run/aim) and the left-hand
// grip are follow-ups.
import { Suspense, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF, useAnimations } from '@react-three/drei';
import { SkeletonUtils } from 'three-stdlib';
import * as THREE from 'three';
import { playerState } from './playerState';
import { getTPDist } from './siegeThirdPerson';
import { sampleHeight } from './terrainHeight';
import { groundAt } from './siegeGround';
import { setCharSnap, pushCharAnimEvent, type CharSnap } from './charAnimDebug';
import { CHAR_ASSET_VERSION, RIFLE_LIBRARY, ANIM_LIBRARY } from './charlineup/siegeCharLineupState';
import { heldWeaponByKey } from './charlineup/weaponModels';

const EYE_HEIGHT = 1.6;
const SHOW_DIST = 0.3;   // reveal the body once the camera has pulled past this
const D2R = Math.PI / 180;
const glbUrl = (f: string) => `${f}?a=${CHAR_ASSET_VERSION}`;

// V1 self character (matches the spawn intro). A character-select panel will set this later.
const SELF = { name: 'Rajax', file: '/siege/characters/pilot_rajax.glb', scale: 1.140, minY: -0.0002 };

// Rifle locomotion clips (from siege_rifle_anims). Selected by movement state, cross-faded — the
// standard "locomotion selector" every game uses. (No dedicated rifle walk-back clip → backward-run
// covers both back speeds. Holster + reload one-shots are a follow-up.)
const CLIP = {
  idle: 'Anim_Rifle_Idle_NoSkin',
  walkF: 'Anim_Rifle_Walk_Not_Aiming_NoSkin',
  runF: 'Anim_Rifle_Run_NoSkin',
  back: 'Anim_Rifle_Backward_Run_NoSkin',
  strafeL: 'Anim_Rifle_Strafe_Left_NoSkin', strafeR: 'Anim_Rifle_Strafe_Right_NoSkin',
  runL: 'Anim_Rifle_Run_Left_NoSkin', runR: 'Anim_Rifle_Run_Right_NoSkin',
  jumpUp: 'Anim_Rifle_Jump_Up_NoSkin', jumpDown: 'Anim_Rifle_Jump_Down_NoSkin',
};
// Snapshot of everything driving the current clip, for the DFLOW character-anim tracker.
function gatherSnap(clip: string): CharSnap {
  const s = playerState;
  const grid: (number | null)[] = [];
  for (let r = -1; r <= 1; r++) for (let c = -1; c <= 1; c++) grid.push(sampleHeight(s.x + c * 0.5, s.z + r * 0.5));
  return {
    t: performance.now(), clip,
    grounded: s.grounded, vy: s.vy, mf: s.mf, mr: s.mr, run: s.run, gun: s.gun,
    x: s.x, y: s.y, z: s.z, eyeH: EYE_HEIGHT,
    groundTerrain: sampleHeight(s.x, s.z),
    groundMesh: groundAt(s.x, s.z, s.y + 2),
    grid,
  };
}

function pickRifleClip(): string {
  const s = playerState;
  // Only play jump/fall on REAL vertical motion — a momentary "not grounded" with ~zero vertical
  // speed (e.g. grounded flicker on a slope) shouldn't trigger a jump loop; treat it as locomotion.
  if (!s.grounded && Math.abs(s.vy) > 0.8) return s.vy > 0 ? CLIP.jumpUp : CLIP.jumpDown;
  if (s.mf > 0) return s.run ? CLIP.runF : CLIP.walkF;    // forward (run takes priority over strafe)
  if (s.mf < 0) return CLIP.back;                          // backward
  if (s.mr < 0) return s.run ? CLIP.runL : CLIP.strafeL;  // strafe left
  if (s.mr > 0) return s.run ? CLIP.runR : CLIP.strafeR;  // strafe right
  return CLIP.idle;
}

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
    // NEVER raycast the self-avatar: it's just a view of you, sitting at your camera. In three.js
    // visible=false does NOT skip raycasts, so without this the body intercepts your own shots.
    c.traverse((o) => { const m = o as THREE.Mesh; m.frustumCulled = false; m.raycast = () => {}; });
    return c;
  }, [scene]);
  const anims = useMemo(() => [...rifleAnims, ...baseAnims], [rifleAnims, baseAnims]);
  const { actions } = useAnimations(anims, inner);
  const curClip = useRef('');
  const lastGather = useRef(0);

  useFrame(() => {
    const g = group.current; if (!g) return;
    // Locomotion selector (runs even when hidden so the pose is right the instant you zoom out):
    // pick the clip for the current movement and cross-fade to it when it changes.
    const want = pickRifleClip();
    if (want !== curClip.current && actions[want]) {
      const snap = gatherSnap(want);
      pushCharAnimEvent(curClip.current || '(start)', want, snap);   // DFLOW tracker
      setCharSnap(snap);
      if (curClip.current && actions[curClip.current]) actions[curClip.current]!.fadeOut(0.2);
      actions[want]!.reset().fadeIn(0.2).play();
      curClip.current = want;
    }
    // Refresh the live snapshot ~5×/s so the COPY dump shows the current state even when the clip
    // is stuck (which is the case we're trying to debug).
    if (performance.now() - lastGather.current > 200) { lastGather.current = performance.now(); setCharSnap(gatherSnap(curClip.current || want)); }
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
          model.traverse((o) => { (o as THREE.Mesh).raycast = () => {}; });   // never block your own shots
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
