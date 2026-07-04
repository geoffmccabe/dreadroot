// SiegeSelfAvatar — renders the player's OWN character at the player position (from playerState),
// holding the weapon, while the third-person camera is zoomed out — so you can see how each character
// holds each gun as it animates. Hidden in first-person. Purely additive: it reads the player pose +
// zoom distance and renders; it never touches the camera or controls, so it can't break gameplay.
//
// V1 = Rajax + the AK, rifle-idle. Character-select, live-anim sync (walk/run/aim) and the left-hand
// grip are follow-ups.
import { Suspense, useEffect, useMemo, useRef } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import { useGLTF, useAnimations } from '@react-three/drei';
import { SkeletonUtils, FBXLoader } from 'three-stdlib';
import * as THREE from 'three';
import { playerState } from './playerState';
import { getTPDist } from './siegeThirdPerson';
import { sampleHeight } from './terrainHeight';
import { groundAt } from './siegeGround';
import { setCharSnap, pushCharAnimEvent, type CharSnap } from './charAnimDebug';
import { CHAR_ASSET_VERSION, RIFLE_LIBRARY, ANIM_LIBRARY, LOCO_LIBRARY, LINEUP_CHARS, getCharLineupEnabled, type LineupChar } from './charlineup/siegeCharLineupState';
import { heldWeaponByKey } from './charlineup/weaponModels';
import { getCharData } from './charadmin/characterStats';
import { useSelfCharIndex, setSelfCharIndex } from './siegeSelfChar';
import { getUniversalFlame } from '@/lib/flameBridge';
import { TIER_COLORS } from '@/features/shombie/constants';

const EYE_HEIGHT = 1.6;
const SHOW_DIST = 0.3;   // reveal the body once the camera has pulled past this
const D2R = Math.PI / 180;
const glbUrl = (f: string) => `${f}?a=${CHAR_ASSET_VERSION}`;
const HOLSTER_CLIP = 'Anim_Rifle_Put_Away_NoSkin';   // played forward = holster, reversed = draw
const _tailEuler = new THREE.Euler();
const _tailQ = new THREE.Quaternion();
const _footL = new THREE.Vector3();
const _footR = new THREE.Vector3();
// Jet-boot flame tier. Boots aren't a real equippable yet, so default to tier 1; when they exist this
// reads the boot's tier for its plume colour (the Jet Plume sprite from Admin/Effects/Flame).
const BOOT_TIER = 1;
const JET_L = 'siege_jetboot_L';
const JET_R = 'siege_jetboot_R';
// Coyote time: how long the player must be CONTINUOUSLY off the ground before FALLING counts as
// airborne. A brief unground from a bump / walking downhill (grounded flickers) stays < this, so it
// keeps the walk/run pose instead of snapping to the fall pose. Standard platformer/FPS technique.
// (A real JUMP bypasses this — it's detected by the upward launch speed and shows immediately.)
const COYOTE_MS = 230;
const JUMP_VY = 2;   // upward speed that means "the player just jumped" → jump pose with no delay

// Rifle locomotion clips (from siege_rifle_anims). Selected by movement state, cross-faded — the
// standard "locomotion selector" every game uses. (No dedicated rifle walk-back clip → backward-run
// covers both back speeds. Holster + reload one-shots are a follow-up.)
// Aiming-walk clips the user supplied as loose FBX (loaded at runtime, below). "Aiming & ready to fire"
// — NOT scoped/zoomed (right-mouse ADS); no walking-while-zoomed clips exist yet — add if found.
const WALK_AIM = [
  { url: '/Anim_Rifle/Anim_Rifle_Walk_Aiming_NoSkin.fbx',          name: 'WalkAimF' },
  { url: '/Anim_Rifle/Anim_Rifle_Walk_Backward_Aiming_NoSkin.fbx', name: 'WalkAimB' },
  { url: '/Anim_Rifle/Anim_Rifle_Walk_Left_Aiming_NoSkin.fbx',     name: 'WalkAimL' },
  { url: '/Anim_Rifle/Anim_Rifle_Walk_Right_Aiming_NoSkin.fbx',    name: 'WalkAimR' },
];
const WALK_AIM_URLS = WALK_AIM.map((w) => w.url);

const CLIP = {
  idle: 'Anim_Rifle_Idle_Aiming_NoSkin',   // gun up & ready when armed (not the relaxed/crossed idle)
  walkF: 'WalkAimF',                        // aiming walk, gun up & ready (the new FBX clips)
  runF: 'Anim_Rifle_Run_NoSkin',
  back: 'WalkAimB',
  strafeL: 'WalkAimL', strafeR: 'WalkAimR',
  runL: 'Anim_Rifle_Run_Left_NoSkin', runR: 'Anim_Rifle_Run_Right_NoSkin',
  jumpUp: 'Anim_Rifle_Jump_Up_NoSkin', idleFall: 'Anim_Idle_Falling_NoSkin',
  glide: 'Gliding',
};
// UNARMED locomotion (no weapon out) — the generic loco set, so the character isn't posed holding an
// invisible rifle when he has nothing in hand.
const UNARMED = {
  idle: 'Loco_M_idle',
  walkF: 'Loco_M_walking', runF: 'Loco_M_running',
  back: 'Anim_Walking_Backward_NoSkin',
  strafeL: 'Loco_M_left_strafe_walking', strafeR: 'Loco_M_right_strafe_walking',
  runL: 'Loco_M_left_strafe', runR: 'Loco_M_right_strafe',
  jumpUp: 'Loco_M_jump', idleFall: 'Anim_Idle_Falling_NoSkin',
  glide: 'Gliding',
};
// Jump clips are full standalone jumps with a crouch/windup at the START; the physics jump is instant,
// so we start the clip PAST the windup so the leap/airborne pose shows immediately, not the crouch.
const JUMP_OFFSET: Record<string, number> = { 'Loco_M_jump': 0.85, 'Anim_Rifle_Jump_Up_NoSkin': 0.12 };
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

function pickClip(armed: boolean, airborne: boolean, boosting: boolean): string {
  const C = armed ? CLIP : UNARMED;
  const s = playerState;
  if (s.gliding) return C.glide;                     // holding G → glide pose (slowed fall)
  if (boosting) return C.idleFall;                   // jet-boost (air-jump): NO jump pose — the boot
                                                     // flames do the work; hold a neutral airborne pose
  if (airborne) return s.vy > 0 ? C.jumpUp : C.idleFall;   // rising = jump, falling = idle fall
  if (s.mf > 0) return s.run ? C.runF : C.walkF;     // forward (run takes priority over strafe)
  if (s.mf < 0) return C.back;                        // backward
  if (s.mr < 0) return s.run ? C.runL : C.strafeL;   // strafe left
  if (s.mr > 0) return s.run ? C.runR : C.strafeR;   // strafe right
  return C.idle;
}

function SelfBody({ char }: { char: LineupChar }) {
  const { scene } = useGLTF(glbUrl(char.file), '/draco/');
  const { animations: rifleAnims } = useGLTF(glbUrl(RIFLE_LIBRARY), '/draco/');
  const { animations: baseAnims } = useGLTF(glbUrl(ANIM_LIBRARY), '/draco/');
  const { animations: locoAnims } = useGLTF(glbUrl(LOCO_LIBRARY), '/draco/');   // Gliding + Idle Fall clips
  // Aiming-walk clips from loose FBX (bind by the same mixamorig: bone names as the skeleton). Rename to
  // our keys and zero the Hips X/Z translation so they stay in-place (physics drives the movement).
  const walkFbx = useLoader(FBXLoader, WALK_AIM_URLS);
  const walkAimClips = useMemo(() => walkFbx.map((grp, i) => {
    const src = grp.animations?.[0]; if (!src) return null;
    const clip = src.clone(); clip.name = WALK_AIM[i].name;
    for (const t of clip.tracks) {
      if (/Hips\.position$/i.test(t.name)) for (let k = 0; k < t.values.length; k += 3) { t.values[k] = 0; t.values[k + 2] = 0; }
    }
    return clip;
  }).filter((c): c is THREE.AnimationClip => !!c), [walkFbx]);
  const ak = heldWeaponByKey('ak47');
  const { scene: gunScene } = useGLTF(glbUrl(ak?.url ?? char.file), '/draco/');

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
  // Grafted tail bones (Rajax) + their rest pose — the shared clips don't animate these, so we swish
  // them procedurally (as in the &&& lineup), otherwise the tail hangs dead straight.
  const tailBones = useMemo(() => {
    const bs: THREE.Object3D[] = [];
    cloned.traverse((o) => { if (o.name.startsWith('Tail_')) bs.push(o); });
    return bs.sort((a, b) => a.name.localeCompare(b.name));
  }, [cloned]);
  const tailRest = useMemo(() => tailBones.map((b) => b.quaternion.clone()), [tailBones]);
  const footBones = useMemo(() => {
    let L: THREE.Object3D | undefined, R: THREE.Object3D | undefined;
    cloned.traverse((o) => { if (o.name.endsWith('LeftFoot')) L = o; else if (o.name.endsWith('RightFoot')) R = o; });
    return { L, R };
  }, [cloned]);
  const anims = useMemo(() => [...rifleAnims, ...baseAnims, ...locoAnims, ...walkAimClips], [rifleAnims, baseAnims, locoAnims, walkAimClips]);
  const { actions } = useAnimations(anims, inner);
  const curClip = useRef('');
  const lastGather = useRef(0);
  const prevGun = useRef(playerState.gun);
  const oneShotUntil = useRef(0);
  const airborneAt = useRef(0);   // when the player last LEFT the ground (0 = grounded), for coyote time
  const jetFlamesOn = useRef(false);

  // Make sure the jet-boot flames are removed if this avatar unmounts (e.g. character switch) mid-burn.
  useEffect(() => () => { const f = getUniversalFlame(); f?.removeAttached(JET_L); f?.removeAttached(JET_R); }, []);

  useFrame((state) => {
    const g = group.current; if (!g) return;
    const armed = playerState.gun;

    // Airborne detection:
    //  - a real JUMP (strong upward speed) shows immediately, and STAYS airborne through the whole arc
    //    (once we've been off the ground past the grace, vy magnitude no longer matters — so the apex,
    //    where vy≈0, no longer flickers back to the ground pose, which read as a broken jump).
    //  - a FALL (walking off a ledge, no launch) only counts after being off the ground continuously
    //    past COYOTE_MS, so a bump / downhill (grounded flickers back, resetting the timer) never trips it.
    const now = performance.now();
    if (playerState.grounded) airborneAt.current = 0;
    else if (!airborneAt.current) airborneAt.current = now;
    const jumping = playerState.vy > JUMP_VY && !playerState.boosting;   // a jet-boost isn't a jump pose
    const sustainedAir = !playerState.grounded && airborneAt.current > 0 && now - airborneAt.current > COYOTE_MS;
    const airborne = jumping || sustainedAir;

    // Holster / draw one-shot: on the weapon-out state flipping, play the put-away clip forward
    // (holster) or reversed (draw), and hold off the locomotion selector until it finishes.
    if (armed !== prevGun.current) {
      prevGun.current = armed;
      const a = actions[HOLSTER_CLIP];
      if (a) {
        const dur = a.getClip().duration;
        if (curClip.current && actions[curClip.current]) actions[curClip.current]!.fadeOut(0.12);
        a.reset(); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true;
        a.timeScale = armed ? -1 : 1; a.time = armed ? dur : 0;
        a.fadeIn(0.12).play();
        curClip.current = HOLSTER_CLIP;
        oneShotUntil.current = performance.now() + dur * 1000;
        if (armed && wrapRef.current) wrapRef.current.visible = true;   // gun appears as you draw it
      }
    }
    const inOneShot = performance.now() < oneShotUntil.current;

    // Locomotion selector (armed = rifle set, unarmed = generic loco set). Runs even when hidden so the
    // pose is right the instant you zoom out — but not while a holster/draw one-shot is playing.
    if (!inOneShot) {
      const want = pickClip(armed, airborne, playerState.boosting);
      if (want !== curClip.current && actions[want]) {
        const snap = gatherSnap(want);
        pushCharAnimEvent(curClip.current || '(start)', want, snap);   // DFLOW tracker
        setCharSnap(snap);
        // The jump-up clip snaps in fast and plays ONCE from PAST its windup, holding the rising pose —
        // otherwise the fade + the clip's crouch make the jump read as delayed / not happening.
        const isJump = want === CLIP.jumpUp || want === UNARMED.jumpUp;
        const fade = isJump ? 0.06 : 0.2;
        if (curClip.current && actions[curClip.current]) actions[curClip.current]!.fadeOut(fade);
        const na = actions[want]!; na.reset();
        if (isJump) na.time = JUMP_OFFSET[want] ?? 0;
        na.setLoop(isJump ? THREE.LoopOnce : THREE.LoopRepeat, isJump ? 1 : Infinity);
        na.clampWhenFinished = isJump;
        na.timeScale = 1; na.fadeIn(fade).play();
        curClip.current = want;
      }
      if (wrapRef.current) wrapRef.current.visible = armed;   // gun hidden while unarmed
    }

    // Refresh the live snapshot ~5×/s so the COPY dump shows the current state even when stuck.
    if (performance.now() - lastGather.current > 200) {
      lastGather.current = performance.now();
      playerState.glideFactor = getCharData(char.name).stats.glide;   // the Admin/Characters glide stat
      setCharSnap(gatherSnap(curClip.current));
    }
    const shown = getTPDist() > SHOW_DIST;
    g.visible = shown;
    // Jet-boot flames off when hidden (first person) or the burn ended.
    if ((!shown || !playerState.boosting) && jetFlamesOn.current) {
      jetFlamesOn.current = false;
      const f = getUniversalFlame(); f?.removeAttached(JET_L); f?.removeAttached(JET_R);
    }
    if (!shown) return;
    // Stand at the player's feet, facing the look direction (away from the camera).
    g.position.set(playerState.x, playerState.y - EYE_HEIGHT - char.minY * char.scale, playerState.z);
    g.rotation.y = Math.atan2(playerState.fx, playerState.fz);

    // Jet-boot flames while boosting (air-jump): two downward Jet Plume sprites at the soles.
    if (playerState.boosting && footBones.L && footBones.R) {
      const flame = getUniversalFlame();
      if (flame) {
        g.updateWorldMatrix(true, true);
        footBones.L.getWorldPosition(_footL);
        footBones.R.getWorldPosition(_footR);
        if (!jetFlamesOn.current) {
          jetFlamesOn.current = true;
          const colors = TIER_COLORS[BOOT_TIER] ?? ['#FF6600'];
          const cfg = { type: 'plume' as const, colors, size: 0.2, height: 0.5, duration: 999999, particleCount: 40, colorMode: 'static' as const };
          flame.spawnFlame({ ...cfg, position: _footL, attachTo: JET_L });
          flame.spawnFlame({ ...cfg, position: _footR, attachTo: JET_R });
        }
        flame.updateAttachedPosition(JET_L, _footL);
        flame.updateAttachedPosition(JET_R, _footR);
      }
    }

    // Procedural tail (Rajax) — ALWAYS swish (never straight); spread wider while gliding (rudder-like).
    if (tailBones.length) {
      const t = state.clock.elapsedTime; const N = tailBones.length;
      const boost = playerState.gliding ? 1.6 : 1;
      for (let i = 0; i < N; i++) {
        const frac = i / (N - 1);
        const amp = (0.22 + 0.42 * frac) * boost;
        const ph = t * 1.6 - i * 0.7;
        _tailEuler.set(Math.sin(ph) * amp, 0, Math.sin(ph * 0.5 + 1.2) * amp * 0.3);
        _tailQ.setFromEuler(_tailEuler);
        tailBones[i].quaternion.copy(tailRest[i]).multiply(_tailQ);
      }
    }

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
          const rot = ak.rotByChar?.[char.name] ?? ak.rotDeg;
          const grip = ak.gripByChar?.[char.name] ?? ak.gripPos;
          const sz = ak.sizeByChar?.[char.name] ?? 1;
          const s = (ak.lengthM * sz / longest) / hs;
          const wrap = new THREE.Group();
          wrap.scale.setScalar(s);
          wrap.position.set(grip[0] / hs, grip[1] / hs, grip[2] / hs);
          wrap.rotation.set(rot[0] * D2R, rot[1] * D2R, rot[2] * D2R);
          wrap.add(model); hand.add(wrap); wrap.visible = armed; wrapRef.current = wrap;
        }
      }
    }
  });

  return (
    <group ref={group} scale={char.scale} visible={false}>
      <group ref={inner}><primitive object={cloned} /></group>
    </group>
  );
}

export function SiegeSelfAvatar() {
  const idx = useSelfCharIndex();
  // '*' then 1-6 switches which of the 6 characters you are (for testing all of them). '*' arms a
  // 2s window; the digit picks the character. Capture-phase + preventDefault so the digit doesn't
  // also hit the hotbar. ('*' still cycles weapons while the &&& lineup is up — deferred to it there.)
  useEffect(() => {
    let armed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (e.key === '*') {
        if (getCharLineupEnabled()) return;
        armed = true; if (timer) clearTimeout(timer); timer = setTimeout(() => { armed = false; }, 2000);
        e.preventDefault(); return;
      }
      if (armed && /^[1-6]$/.test(e.key)) {
        e.preventDefault(); e.stopPropagation();
        setSelfCharIndex(parseInt(e.key, 10) - 1);
        armed = false; if (timer) clearTimeout(timer);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('keydown', onKey, true); if (timer) clearTimeout(timer); };
  }, []);
  return <Suspense fallback={null}><SelfBody key={idx} char={LINEUP_CHARS[idx]} /></Suspense>;
}
