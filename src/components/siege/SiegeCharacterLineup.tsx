// SiegeCharacterLineup — the toggleable lineup of the Starblind characters (Ash, Thorn, … as more
// are rigged). Toggle with "&&&". They appear ON THE GROUND in a row in front of the player in any
// SWW world, facing you. M = next animation, N = previous (same Mixamo skeleton + clips on every
// character, so one index drives them all). The current animation's number/name shows in the HUD.
//
// In-canvas only (renders inside <Canvas>); the HUD readout lives in SiegeCharLineupHud (DOM).
import { Fragment, Suspense, useEffect, useMemo, useRef } from 'react';
import { isTypingTarget } from '@/lib/isTypingTarget';
import { deferLobbyPreload } from './siegeDeferredPreload';
import { useGLTF, useAnimations } from '@react-three/drei';
import { useThree, useFrame } from '@react-three/fiber';
import { SkeletonUtils } from 'three-stdlib';
import * as THREE from 'three';
import { lineupGroundY } from './charlineup/lineupGround';
import {
  LINEUP_CHARS, ANIM_LIBRARY, RIFLE_LIBRARY, LOCO_LIBRARY, PISTOL_LIBRARY, CHAR_ASSET_VERSION, useCharLineup, getCharLineupEnabled,
  toggleCharLineup, cycleCharAnim, setCharAnimNames, setCharAnchor, triggerFlight,
  getFlightSeq, getFlightMode, triggerParkour, getParkourSeq, cycleWeapon, getTuneCharIndex, setTuneCharIndex,
  getArmJoint, cycleArmJoint, setCharAnimByName, setCharAnimIndex, setWeaponIndex,
} from './charlineup/siegeCharLineupState';
import { getArmFK, hasArmFK, nudgeArmFK, applyArmFK, ARM_JOINTS } from './charlineup/armFK';
import { AnimFSM } from './charlineup/animFSM';
import { FLIGHT_GRAPH } from './charlineup/flightGraph';
import { AshCigaretteFx } from './charadmin/AshCigaretteFx';
import { type LineupWeaponDef } from './charlineup/lineupWeapons';
import { HELD_WEAPONS } from './charlineup/weaponModels';
import { LineupWeapon } from './charlineup/LineupWeapon';
import { WeaponEditBridge } from './charlineup/WeaponEditBridge';
import { rotateWeaponLocal, bumpWeaponSize, exportTuning, nudgeWeaponPos, weaponWraps } from './charlineup/weaponEditRegistry';
import { setLeftTarget, nudgeWrist, findLeftArm, getLeftTarget, getWrist, solveArmIK } from './charlineup/leftHandIK';
import { classifyObstacle } from './charlineup/obstacleDetector';
import { parkourGraph } from './charlineup/parkourGraphs';
import { OBSTACLE_PRESETS, OBSTACLE_DIST } from './charlineup/parkourDemo';
import { UNARMED_MALE } from './charlineup/locomotionClips';

// All held guns the lineup cycles through with '*' — the REAL SWU weapons by item ID (AK74 first).
// Each is sized + oriented independently; flip a gun with ^x/y/z and size with the number+−/= keys,
// persisted per model/character. HeldWeapon is shape-compatible with LineupWeaponDef.
const GUNS: LineupWeaponDef[] = HELD_WEAPONS;

const SPACING = 2.2; // metres between characters
const AHEAD = 5;     // metres in front of the player the row appears

// STABLE asset version (not APP_VERSION) so the browser caches the meshes + the shared animation
// library across deploys — they only re-download when CHAR_ASSET_VERSION is bumped (i.e. when the
// glbs are actually rebuilt). Draco-compressed, decoded via /draco/.
// scratch for the tail swish (no per-frame allocation)
const _tailEuler = new THREE.Euler();
const _tailQ = new THREE.Quaternion();
const _ikTarget = new THREE.Vector3();   // scratch: left-hand grip point in world space
const _bakedLeft = new THREE.Vector3();  // scratch: baked left-hand point when there's no saved capture
const CHAR_NAMES = LINEUP_CHARS.map((c) => c.name);   // for "adjust ALL characters" (tune target = null)

const glbUrl = (file: string) => `${file}?a=${CHAR_ASSET_VERSION}`;
// Shared animation libraries stay warmed at boot — the spawn character needs them for its idle the
// instant the intro avatar mounts, so deferring these would risk a cold-load anim hitch on spawn.
useGLTF.preload(glbUrl(ANIM_LIBRARY), '/draco/');
useGLTF.preload(glbUrl(RIFLE_LIBRARY), '/draco/');
useGLTF.preload(glbUrl(LOCO_LIBRARY), '/draco/');
useGLTF.preload(glbUrl(PISTOL_LIBRARY), '/draco/');
// The 6 lineup character meshes + the first gun are NOT visible on spawn (the lineup is a dev-only
// '&&&' overlay; the spawn character loads on-demand via the intro avatar). Warm them on idle AFTER
// the lobby is up so they don't fight the lobby's load for bandwidth.
deferLobbyPreload(() => {
  LINEUP_CHARS.forEach((c) => useGLTF.preload(glbUrl(c.file), '/draco/'));
  useGLTF.preload(`${GUNS[0].url}?a=${CHAR_ASSET_VERSION}`);
});

function LineupChar({ file, charName, x, z, yaw, fallbackY, scale, minY, heightM, animIndex, weapon, showGizmo }: { file: string; charName: string; x: number; z: number; yaw: number; fallbackY: number; scale: number; minY: number; heightM: number; animIndex: number; weapon: LineupWeaponDef; showGizmo: boolean }) {
  const { scene } = useGLTF(glbUrl(file), '/draco/');
  // Animations come from the shared category libraries (deduped across all characters); useGLTF
  // caches each so they're fetched once and reused. Merge their clips and bind to this character by
  // bone name (all mixamorig). Clip names are unique across libraries, so the merge is collision-free.
  const { animations: baseAnims } = useGLTF(glbUrl(ANIM_LIBRARY), '/draco/');
  const { animations: rifleAnims } = useGLTF(glbUrl(RIFLE_LIBRARY), '/draco/');
  const { animations: locoAnims } = useGLTF(glbUrl(LOCO_LIBRARY), '/draco/');
  // The one-handed set. Without it a pistol is posed on a two-handed rifle stance, which is the
  // wrong shape to tune a grip against.
  const { animations: pistolAnims } = useGLTF(glbUrl(PISTOL_LIBRARY), '/draco/');
  // Bind the rifle clips UNMODIFIED. (An earlier band-aid stripped the Spine/Spine1 tracks thinking
  // the clips had a bad lower-spine curve — but the user had confirmed they look good; stripping the
  // spine while the hips still tilt forward folded every character 90° at the waist. Reverted.)
  // Bind all clips UNMODIFIED. (Runtime clip-surgery on the rifle clips — spine-strip and Hips-yaw —
  // both caused worse distortion; the rifle clips' curved lower back is an ASSET flaw, fixed by
  // rebuilding the rifle library, not by patching tracks at load.)
  const animations = useMemo(() => [...baseAnims, ...rifleAnims, ...locoAnims, ...pistolAnims], [baseAnims, rifleAnims, locoAnims, pistolAnims]);
  const cloned = useMemo(() => SkeletonUtils.clone(scene) as THREE.Group, [scene]);
  const group = useRef<THREE.Group>(null);
  const { actions, names } = useAnimations(animations, group);

  // Procedural tail (Rajax): the shared Mixamo clips don't touch the grafted Tail_01..05 bones, so
  // they'd sit stiff. Drive a slow travelling-wave sway each frame for a cat-like flick. Auto-gated:
  // only Rajax has Tail bones, so this is a no-op for everyone else.
  const tailBones = useMemo(() => {
    const bs: THREE.Object3D[] = [];
    cloned.traverse((o) => { if (o.name.startsWith('Tail_')) bs.push(o); });
    return bs.sort((a, b) => a.name.localeCompare(b.name));
  }, [cloned]);
  // Capture each tail bone's REST rotation so the swish is applied RELATIVE to the curve/droop
  // instead of overwriting it (overwriting flattened the tail straight).
  const tailRest = useMemo(() => tailBones.map((b) => b.quaternion.clone()), [tailBones]);

  // Publish the clip names once (identical across characters — same skeleton/clips).
  useEffect(() => { if (names.length) setCharAnimNames(names); }, [names]);

  // Feet on the terrain; if the row's cell isn't sampled yet, fall back to the player's ground Y.
  // Offset by the scaled feet (minY) so scaling doesn't sink/float the model.
  const groundY = useMemo(() => lineupGroundY(x, z, fallbackY + 3) - minY * scale, [x, z, fallbackY, minY, scale]);

  useEffect(() => {
    if (!names.length) return;
    const name = names[animIndex % names.length];
    const a = actions[name];
    a?.reset().fadeIn(0.2).play();
    return () => { a?.fadeOut(0.2); };
  }, [actions, names, animIndex]);

  // Flight demo: when triggered (F/G), run the data-driven FSM (launch → glide → land/wall) on this
  // character, applying the FSM's vertical lift + forward drift to the root. Resumes the normal
  // cycled clip when the sequence finishes. Forward axis for a yaw-rotated group is (sin, cos).
  const fsmRef = useRef<AnimFSM | null>(null);
  // Left-arm bones + their BIND (rest) local rotations, captured from the clone BEFORE the mixer runs,
  // so the FK poser can set each joint = bind ∘ offset. Plus an axes gizmo for the selected joint.
  const leftArm = useMemo(() => {
    const b = findLeftArm(cloned);
    return b ? { bones: b, bind: [b.arm.quaternion.clone(), b.fore.quaternion.clone(), b.hand.quaternion.clone()] as [THREE.Quaternion, THREE.Quaternion, THREE.Quaternion] } : null;
  }, [cloned]);
  const armGizmo = useMemo(() => { const a = new THREE.AxesHelper(0.18); (a.material as THREE.Material).depthTest = false; a.renderOrder = 999; return a; }, []);
  const seenSeq = useRef(getFlightSeq());
  const seenParkour = useRef(getParkourSeq());
  const demoMode = useRef<'flight' | 'parkour' | null>(null);
  useFrame((state, rawDt) => {
    const g = group.current; if (!g) return;
    const dt = Math.min(rawDt, 0.05);
    // Tail swish — the standard procedural-tail formula: a TRAVELLING sine wave down the chain
    // (phase lag per segment) with amplitude GROWING toward the tip, so it whips like a cat's tail.
    // A slower, smaller wave on a second axis keeps it from being a flat 2D wag.
    if (tailBones.length) {
      const t = state.clock.elapsedTime;
      const N = tailBones.length;
      for (let i = 0; i < N; i++) {
        const frac = i / (N - 1);
        const amp = 0.22 + 0.42 * frac;          // base → tip (whip) — doubled for a clear bend
        const ph = t * 1.6 - i * 0.7;            // travelling wave (phase lag per bone)
        // Swish about the bone's perpendicular bend axes (NOT Y = twist). Composed onto the REST
        // rotation so the resting curve/droop is kept. X = side-to-side here, Z = small up-down.
        _tailEuler.set(Math.sin(ph) * amp, 0, Math.sin(ph * 0.5 + 1.2) * amp * 0.3);
        _tailQ.setFromEuler(_tailEuler);
        tailBones[i].quaternion.copy(tailRest[i]).multiply(_tailQ);
      }
    }
    const seq = getFlightSeq();
    if (seq !== seenSeq.current) {
      seenSeq.current = seq;
      const mode = getFlightMode();
      actions[names[animIndex % names.length]]?.fadeOut(0.15); // drop the cycled clip
      const fsm = new AnimFSM(actions, FLIGHT_GRAPH, (s) => (s === 'glide' ? mode : null));
      fsm.onDone = () => {
        fsmRef.current = null; demoMode.current = null;
        g.position.set(x, groundY, z);
        actions[names[animIndex % names.length]]?.reset().fadeIn(0.3).play();
      };
      demoMode.current = 'flight'; fsm.start();
      fsmRef.current = fsm;
    }
    // Parkour demo (J): classify the current obstacle preset and run the matching move on this
    // character. The detector picks vault/dive/slide/drop/wall-run purely from the obstacle's size.
    const pseq = getParkourSeq();
    if (pseq !== seenParkour.current) {
      seenParkour.current = pseq;
      const preset = OBSTACLE_PRESETS[pseq % OBSTACLE_PRESETS.length];
      const action = classifyObstacle(preset.probe);
      const graph = parkourGraph(action, UNARMED_MALE, pseq);
      if (graph) {
        actions[names[animIndex % names.length]]?.fadeOut(0.15);
        const fsm = new AnimFSM(actions, graph);
        fsm.onDone = () => {
          fsmRef.current = null; demoMode.current = null;
          g.position.set(x, groundY, z);
          actions[names[animIndex % names.length]]?.reset().fadeIn(0.3).play();
        };
        demoMode.current = 'parkour'; fsm.start();
        fsmRef.current = fsm;
      }
    }
    const fsm = fsmRef.current;
    if (fsm?.active) {
      fsm.tick(dt);
      // Parkour drops off ledges (negative lift), so it must be allowed below groundY; flight is
      // clamped to the ground so the glide never sinks.
      g.position.y = demoMode.current === 'parkour' ? groundY + fsm.offsetY : Math.max(groundY, groundY + fsm.offsetY);
      g.position.x = x + Math.sin(yaw) * fsm.offsetZ;
      g.position.z = z + Math.cos(yaw) * fsm.offsetZ;
    }
    // Left-hand IK — this useFrame is registered AFTER useAnimations, so it runs after the animation
    // mixer and its result isn't overwritten. Bend the left arm to the captured grip point on the gun.
    const cn = names.length ? names[animIndex % names.length] : '';
    if (cn.includes('Rifle') && !/Reload|Put_Away|Crawl|Dive|Fall|Jump|Backward/i.test(cn) && leftArm) {
      const b = leftArm.bones;
      if (hasArmFK(charName, weapon.url)) {
        // MANUAL FK pose (supersedes IK once any joint is adjusted): hold each joint at bind ∘ offset.
        g.updateWorldMatrix(true, false);
        applyArmFK(b, leftArm.bind, getArmFK(charName, weapon.url));
      } else {
        // Fallback: two-bone IK to the captured / baked grip point.
        const bp = weapon.leftHand?.point;
        const tgt = getLeftTarget(weapon.url) ?? (bp ? _bakedLeft.set(bp[0], bp[1], bp[2]) : null);
        const reg = tgt ? weaponWraps().find((r) => r.charName === charName && r.weaponKey === weapon.url) : null;
        if (tgt && reg) {
          g.updateWorldMatrix(true, true);
          _ikTarget.copy(tgt); reg.wrap.localToWorld(_ikTarget);
          solveArmIK(b.arm, b.fore, b.hand, _ikTarget, getWrist(weapon.url, weapon.leftHand?.wrist ?? 0));
        }
      }
    }
    // Arm-joint axes gizmo: while a joint is active ({ } turned it on), attach the coloured X/Y/Z axes
    // to the SELECTED joint of the gizmo character, so you can see which axis each key rotates.
    const aj = getArmJoint();
    const jb = (aj >= 0 && showGizmo && leftArm) ? [leftArm.bones.arm, leftArm.bones.fore, leftArm.bones.hand][aj] : null;
    if (jb) { if (armGizmo.parent !== jb) { armGizmo.parent?.remove(armGizmo); jb.add(armGizmo); } }
    else if (armGizmo.parent) { armGizmo.parent.remove(armGizmo); }
  });

  // Show the held gun only during the rifle clips (hidden during dance/climb/flight, where a gun
  // stuck to the hand would look broken). Clip names from the rifle library all contain 'Rifle'.
  const currentName = names.length ? names[animIndex % names.length] : '';
  const showWeapon = currentName.includes('Rifle');
  // Left hand belongs on the gun's foregrip EXCEPT when the clip deliberately moves it away (reload,
  // holster/put-away, crawl, dives, falls, jumps, backward-run) — IK is disabled on those.
  const leftHandActive = !/Reload|Put_Away|Crawl|Dive|Fall|Jump|Backward/i.test(currentName);

  return (
    <group ref={group} position={[x, groundY, z]} rotation={[0, yaw, 0]} scale={scale}>
      <primitive object={cloned} />
      {/* Ash's cigarette glow + smoke (no-op for other characters) */}
      <AshCigaretteFx group={cloned} />
      {/* Two-handed gun in the right hand during rifle animations (auto-sized per character) */}
      {showWeapon && <Suspense fallback={null}><LineupWeapon key={weapon.url} root={cloned} weapon={weapon} charHeight={heightM} charName={charName} showGizmo={showGizmo} leftHandActive={leftHandActive} /></Suspense>}
    </group>
  );
}

// A semi-transparent demo obstacle drawn ahead of a character, sized to the current preset, so you
// can see what it's vaulting / diving / sliding under. The ledge preset has no box (null).
function ObstacleBox({ x, z, yaw, groundY, preset }: { x: number; z: number; yaw: number; groundY: number; preset: typeof OBSTACLE_PRESETS[number] }) {
  const b = preset.box;
  if (!b) return null;
  const wx = x + Math.sin(yaw) * OBSTACLE_DIST;
  const wz = z + Math.cos(yaw) * OBSTACLE_DIST;
  return (
    <mesh position={[wx, groundY + b.yBottom + b.h / 2, wz]} rotation={[0, yaw, 0]}>
      <boxGeometry args={[b.w, b.h, b.d]} />
      <meshStandardMaterial color={preset.color} transparent opacity={0.55} />
    </mesh>
  );
}

/** The gun the tool opens on. Pistols are what needs tuning, and a pistol tuned against a rifle
 *  stance is tuned against the wrong pose entirely. */
const START_GUN = 'basic_pistol';
/** Rifle Idle-Aiming — a still two-handed pose, the one the rifle tuning was done against. */
const RIFLE_IDLE_INDEX = 18;

export function SiegeCharacterLineup() {
  const { enabled, animIndex, animNames, anchor, parkourSeq, weaponIndex, tuneCharIndex } = useCharLineup();
  const gun = GUNS[weaponIndex % GUNS.length];
  const animSet = HELD_WEAPONS[weaponIndex % HELD_WEAPONS.length].animSet;

  // Open on a pistol rather than on whatever was last selected (index 0 = the AK74).
  useEffect(() => {
    if (!enabled) return;
    const i = HELD_WEAPONS.findIndex((g) => g.key === START_GUN);
    if (i >= 0) setWeaponIndex(i);
  }, [enabled]);

  // Pose follows the weapon. Only fires when the SET changes, so M/N still cycle freely within a set.
  useEffect(() => {
    if (!enabled || !animNames.length) return;
    if (animSet === 'pistol') setCharAnimByName('pistol_idle');
    else setCharAnimIndex(RIFLE_IDLE_INDEX);
  }, [enabled, animSet, animNames.length]);

  const gunRef = useRef(gun); gunRef.current = gun;   // current gun for the '[]'-deps key handler
  const { camera } = useThree();

  // "&&&" toggles the lineup; M / N cycle animations while it's shown. Capture-phase so the
  // lineup's M/N win over any other M handler when the lineup is up.
  useEffect(() => {
    let amp: number[] = [];
    const POS = 0.02;        // position-nudge step, metres
    const GROW = 1.02;       // size step (2%); shrink is the exact inverse
    // Every adjuster (rotate/size/position) targets the SELECTED character only (null = ALL when 0).
    const tuneTarget = () => { const i = getTuneCharIndex(); return i < 0 ? null : LINEUP_CHARS[i]?.name ?? null; };
    const ARM_STEP = 3;   // degrees per arrow tap when a left-arm joint is active
    // Arrows/,. route to the ACTIVE left-arm joint (FK) when one is selected, else move the gun.
    const armK = (axis: 0 | 1 | 2, deg: number, posAxis: 'x' | 'y' | 'z', pos: number) => {
      const jointOn = getArmJoint();
      const url = gunRef.current?.url;
      if (jointOn >= 0 && url) nudgeArmFK(tuneTarget(), url, jointOn, axis, deg, CHAR_NAMES);
      else nudgeWeaponPos(tuneTarget(), posAxis, pos);
    };
    const logJoint = () => { const aj = getArmJoint(); console.log('[arm-fk] joint →', aj < 0 ? 'OFF (arrows move the gun)' : `${ARM_JOINTS[aj]} — arrows = X/Y, ,/. = Z`); };
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e)) return;   // never hijack typing (covers <select> + contentEditable)
      if (e.key === '&') {
        const now = Date.now();
        amp = amp.filter((t) => now - t < 900);
        amp.push(now);
        if (amp.length >= 3) { amp = []; toggleCharLineup(); }
        return;
      }
      if (!getCharLineupEnabled()) return;
      if (e.key === 'm' || e.key === 'M') { e.stopImmediatePropagation(); cycleCharAnim(1); }
      else if (e.key === 'n' || e.key === 'N') { e.stopImmediatePropagation(); cycleCharAnim(-1); }
      // F/G (flight demo) and J (parkour demo) are DISABLED — they hijack the pose during weapon tuning
      // and were hard to stop. Re-enable later if the demos are needed again.
      else if (e.key === '*') { e.stopImmediatePropagation(); cycleWeapon(1, GUNS.length); } // next held gun
      // ── Gun tuning (lineup-only, captured so it never reaches game/Chrome/macOS) ──
      // 1-6 select which character the gizmo shows on + size keys target (1=Ash … 6=Fluffer); 0 = ALL.
      else if (e.key >= '1' && e.key <= '6') { e.preventDefault(); e.stopImmediatePropagation(); setTuneCharIndex(Number(e.key) - 1); }
      else if (e.key === '0') { e.preventDefault(); e.stopImmediatePropagation(); setTuneCharIndex(-1); }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); e.stopImmediatePropagation(); bumpWeaponSize(tuneTarget(), 1 / GROW); } // 2% smaller
      else if (e.key === '=' || e.key === '+') { e.preventDefault(); e.stopImmediatePropagation(); bumpWeaponSize(tuneTarget(), GROW); }     // 2% bigger
      // Position: arrows move the gun in the hand's X (left/right) & Y (up/down); ,/. move Z (in/out).
      // { } cycle the left-arm joint (off → shoulder → elbow → wrist → off). While a joint is active,
      // arrows + ,/. rotate THAT joint on its 3 local axes; otherwise they move the gun as before.
      else if (e.key === '{') { e.preventDefault(); e.stopImmediatePropagation(); cycleArmJoint(-1); logJoint(); }
      else if (e.key === '}') { e.preventDefault(); e.stopImmediatePropagation(); cycleArmJoint( 1); logJoint(); }
      else if (e.key === 'ArrowLeft')  { e.preventDefault(); e.stopImmediatePropagation(); armK(0, -ARM_STEP, 'x', -POS); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); e.stopImmediatePropagation(); armK(0,  ARM_STEP, 'x',  POS); }
      else if (e.key === 'ArrowUp')    { e.preventDefault(); e.stopImmediatePropagation(); armK(1,  ARM_STEP, 'y',  POS); }
      else if (e.key === 'ArrowDown')  { e.preventDefault(); e.stopImmediatePropagation(); armK(1, -ARM_STEP, 'y', -POS); }
      else if (e.key === ',')          { e.preventDefault(); e.stopImmediatePropagation(); armK(2, -ARM_STEP, 'z', -POS); }
      else if (e.key === '.')          { e.preventDefault(); e.stopImmediatePropagation(); armK(2,  ARM_STEP, 'z',  POS); }
      else if (e.key === '\\') { e.preventDefault(); e.stopImmediatePropagation(); exportTuning(); } // copy all tuning to clipboard
      // Left-hand IK: K = aim at the gun + capture the palm grip point; ( / ) = twist the wrist.
      // (K, not P — the Arrange tool steals P to spawn a box.)
      else if (e.key === 'k' || e.key === 'K') {
        e.preventDefault(); e.stopImmediatePropagation();
        const wraps = weaponWraps();
        const ro = camera.getWorldPosition(new THREE.Vector3()); const rd = camera.getWorldDirection(new THREE.Vector3());
        const rc = new THREE.Raycaster(ro, rd);
        const hit = rc.intersectObjects(wraps.map((r) => r.wrap), true).find((h) => (h.object as THREE.Mesh).isMesh);
        if (hit) {
          // find which gun wrap was hit, capture the point in ITS local frame (same spot for all guns)
          let o: THREE.Object3D | null = hit.object, wrap: THREE.Object3D | null = null;
          while (o) { if (wraps.some((r) => r.wrap === o)) { wrap = o; break; } o = o.parent; }
          if (wrap) setLeftTarget(gunRef.current.url, wrap.worldToLocal(hit.point.clone()));
        } else console.log('[lefthand] aim the crosshair AT the gun, then press K');
      }
      else if (e.key === '(') { e.preventDefault(); e.stopImmediatePropagation(); nudgeWrist(gunRef.current.url, -5); }
      else if (e.key === ')') { e.preventDefault(); e.stopImmediatePropagation(); nudgeWrist(gunRef.current.url,  5); }
      // Gun orientation about its LOCAL axes (Red=X, Green=Y, Blue=Z on the gizmo).
      //   Shift + X/Y/Z = 90° quarter turn   |   Alt + X/Y/Z = 2° fine nudge
      // A MODIFIER IS REQUIRED, deliberately. Plain Z and X are god-mode-down and holster in
      // DreadRoot; stealing them left the camera unable to descend, so the bare letters now pass
      // straight through to the game. Read from e.code, because Alt rewrites e.key on macOS.
      else if (e.code === 'KeyX' || e.code === 'KeyY' || e.code === 'KeyZ') {
        if (!e.shiftKey && !e.altKey) return;   // bare letter → let the game have it
        e.preventDefault(); e.stopImmediatePropagation();
        const axis = e.code.slice(3).toLowerCase() as 'x' | 'y' | 'z';
        rotateWeaponLocal(tuneTarget(), axis, e.shiftKey ? 90 : 2);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // When toggled on, snapshot a spot ~5m ahead of the player; the row sits there facing the player.
  useEffect(() => {
    if (!enabled) return;
    const p = camera.getWorldPosition(new THREE.Vector3());
    const f = camera.getWorldDirection(new THREE.Vector3());
    f.y = 0; if (f.lengthSq() < 1e-4) f.set(0, 0, 1); f.normalize();
    const cx = p.x + f.x * AHEAD;
    const cz = p.z + f.z * AHEAD;
    // Characters' +Z faces back toward the player.
    const yaw = Math.atan2(-f.x, -f.z);
    // Ground under the ROW, not under the camera: in god mode the camera can be a hundred metres up,
    // and using its Y put the whole lineup in the sky.
    const groundY = lineupGroundY(cx, cz, p.y);
    setCharAnchor({ x: cx, z: cz, yaw, groundY });
  }, [enabled, camera]);

  if (!enabled || !anchor) return null;

  const n = LINEUP_CHARS.length;
  // Spread along the row axis (perpendicular to the facing direction).
  const rx = Math.cos(anchor.yaw), rz = -Math.sin(anchor.yaw);

  // Each character gets its OWN Suspense so a slow/failed glb only blanks that one slot — never the
  // whole row (a single shared boundary meant one bad asset hid every character).
  return (
    <>
      {LINEUP_CHARS.map((c, i) => {
        const off = (i - (n - 1) / 2) * SPACING;
        const cx = anchor.x + rx * off, cz = anchor.z + rz * off;
        return (
          <Fragment key={c.name}>
            <Suspense fallback={null}>
              <LineupChar file={c.file} charName={c.name} x={cx} z={cz} yaw={anchor.yaw} fallbackY={anchor.groundY} scale={c.scale} minY={c.minY} heightM={c.heightM} animIndex={animIndex} weapon={gun} showGizmo={tuneCharIndex < 0 || tuneCharIndex === i} />
            </Suspense>
            {/* obstacle for the parkour demo (J) — only after the first trigger so it isn't clutter */}
            {parkourSeq > 0 && <ObstacleBox x={cx} z={cz} yaw={anchor.yaw} groundY={anchor.groundY} preset={OBSTACLE_PRESETS[parkourSeq % OBSTACLE_PRESETS.length]} />}
          </Fragment>
        );
      })}
      {/* Lets you select a gun in the Arrange panel (Shift+` edit mode, crosshair/L) and orient it;
          one edit drives every character's gun and logs the bakeable rotDeg/gripPos. */}
      <WeaponEditBridge />
    </>
  );
}
