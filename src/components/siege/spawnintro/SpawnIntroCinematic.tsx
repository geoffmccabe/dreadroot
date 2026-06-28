// SpawnIntroCinematic — renders + drives the cinematic spawn intro (see siegeSpawnIntro.ts). While an
// intro is active it owns the camera (the Fortress controller stands down via isSiegeIntroActive) and
// shows the chosen character idling. Phases: ARRIVE (push-in, char faces camera) → LOADING (hold,
// wait for ground) → COUNTDOWN (hold, bypassable) → INHABIT (char turns away, camera dollies down
// into the head) → hand off to FPS at the exact final eye pose/facing.
// (File named distinctly from siegeSpawnIntro.ts so the two never collide on a case-insensitive FS.)
import { Suspense, useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useGLTF, useAnimations } from '@react-three/drei';
import { SkeletonUtils } from 'three-stdlib';
import * as THREE from 'three';
import { sampleHeight } from '../terrainHeight';
import { CHAR_ASSET_VERSION } from '../charlineup/siegeCharLineupState';
import { onSiegeLobbyReady } from '../siegeInitLoad';
import { getChallengeState } from '../challenge/challengeStore';
import { isTypingTarget } from '@/lib/isTypingTarget';
import {
  useSiegeIntro, getIntroPhase, getIntroTarget, setIntroPhase, endSiegeIntro,
  consumeIntroBypass, requestIntroBypass, isSiegeIntroActive, startSpawnIntro, type IntroTarget,
} from './siegeSpawnIntro';

const IDLE_LIBRARY = '/siege/characters/character_idles.glb';
const glbUrl = (f: string) => `${f}?a=${CHAR_ASSET_VERSION}`;

const EYE_HEIGHT = 1.6;
const ARRIVE_DUR = 0.8;
const LOAD_MIN = 1.5;
const LOAD_MAX = 6.0;        // safety: proceed even if the ground sampler never reports ready (never hang)
const TURN_DUR = 0.5;
const DOLLY_DUR = 0.7;
const INHABIT_DUR = TURN_DUR + DOLLY_DUR;   // 1.2s
const CAM_BACK = 4.0;        // metres behind the character
const CAM_UP_OVER = 1.0;     // metres above the character's full height

const smooth = (t: number) => t * t * (3 - 2 * t);   // smoothstep
const _tailEuler = new THREE.Euler();
const _tailQ = new THREE.Quaternion();

// The idle character (Rajax for V1). Group transform (position/rotation/visibility) is owned by the
// driver via groupRef; this component only loads the model, plays its idle, and swishes the tail.
function IntroAvatar({ target, groupRef }: { target: IntroTarget; groupRef: React.RefObject<THREE.Group> }) {
  const { scene } = useGLTF(glbUrl(target.charFile), '/draco/');
  const { animations } = useGLTF(glbUrl(IDLE_LIBRARY), '/draco/');
  const cloned = useMemo(() => {
    const c = SkeletonUtils.clone(scene) as THREE.Group;
    c.traverse((o) => { (o as THREE.Mesh).frustumCulled = false; });
    return c;
  }, [scene]);
  const inner = useRef<THREE.Group>(null);
  const { actions, names } = useAnimations(animations, inner);

  const tailBones = useMemo(() => {
    const bs: THREE.Object3D[] = [];
    cloned.traverse((o) => { if (o.name.startsWith('Tail_')) bs.push(o); });
    return bs.sort((a, b) => a.name.localeCompare(b.name));
  }, [cloned]);
  const tailRest = useMemo(() => tailBones.map((b) => b.quaternion.clone()), [tailBones]);

  useEffect(() => {
    const clip = names.find((n) => n.toLowerCase() === target.idleClip.toLowerCase()) ?? names[0];
    const a = clip ? actions[clip] : null;
    if (a) a.reset().fadeIn(0.3).play();
    return () => { a?.fadeOut(0.2); };
  }, [actions, names, target.idleClip]);

  useFrame((state) => {
    if (!tailBones.length) return;
    const t = state.clock.elapsedTime; const N = tailBones.length;
    for (let i = 0; i < N; i++) {
      const frac = i / (N - 1);
      const amp = 0.22 + 0.42 * frac;
      const ph = t * 1.6 - i * 0.7;
      _tailEuler.set(Math.sin(ph) * amp, 0, Math.sin(ph * 0.5 + 1.2) * amp * 0.3);
      _tailQ.setFromEuler(_tailEuler);
      tailBones[i].quaternion.copy(tailRest[i]).multiply(_tailQ);
    }
  });

  return (
    <group ref={groupRef} scale={target.scale}>
      <group ref={inner}><primitive object={cloned} /></group>
    </group>
  );
}

function IntroDriver({ target }: { target: IntroTarget }) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const avatarRef = useRef<THREE.Group>(null);
  const prevPhase = useRef<string>('');
  const t0 = useRef(0);

  // Geometry of the shot (all derived from the final eye pose + yaw).
  const g = useMemo(() => {
    const eye = new THREE.Vector3(target.pos[0], target.pos[1], target.pos[2]);
    const fq = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, target.yaw, 0, 'YXZ'));
    const F = new THREE.Vector3(0, 0, -1).applyQuaternion(fq); F.y = 0; F.normalize();
    const feetY = eye.y - EYE_HEIGHT;
    const avatarY = feetY - target.minY * target.scale;          // group y so feet sit on the ground
    const charTopY = feetY + target.charHeight;
    const camHigh = new THREE.Vector3(eye.x - F.x * CAM_BACK, charTopY + CAM_UP_OVER, eye.z - F.z * CAM_BACK);
    const camStart = camHigh.clone().addScaledVector(F, -0.6);   // a touch further back for the push-in
    const lookHead = new THREE.Vector3(eye.x, feetY + target.charHeight * 0.85, eye.z);
    const yawFace = Math.atan2(-F.x, -F.z);                      // char faces the camera (-F)
    // quats for the dolly: looking-at-head (from camHigh) → final FPS (+F)
    const m = new THREE.Matrix4().lookAt(camHigh, lookHead, new THREE.Vector3(0, 1, 0));
    const holdQuat = new THREE.Quaternion().setFromRotationMatrix(m);
    const finalQuat = fq.clone();
    return { eye, F, avatarY, camHigh, camStart, lookHead, yawFace, holdQuat, finalQuat };
  }, [target]);

  // Free the cursor for the intro (inventory / triple-click equip). Unmounting PointerLockControls
  // doesn't reliably release the lock, so do it explicitly when the intro starts.
  useEffect(() => { document.exitPointerLock?.(); }, []);

  useFrame((state) => {
    const phase = getIntroPhase();
    if (phase === 'off') return;
    if (phase !== prevPhase.current) { prevPhase.current = phase; t0.current = state.clock.elapsedTime; }
    const e = state.clock.elapsedTime - t0.current;
    const av = avatarRef.current;
    // Place the avatar every frame (the ref is null until the glb resolves — see the isolated
    // Suspense in the return, which lets THIS useFrame run immediately so the camera never freezes).
    if (av) { av.position.set(target.pos[0], g.avatarY, target.pos[2]); av.visible = true; }

    if (phase === 'arrive') {
      camera.position.lerpVectors(g.camStart, g.camHigh, smooth(Math.min(1, e / ARRIVE_DUR)));
      camera.lookAt(g.lookHead);
      if (av) av.rotation.y = g.yawFace;
      if (e >= ARRIVE_DUR) setIntroPhase('loading');
    } else if (phase === 'loading') {
      camera.position.copy(g.camHigh); camera.lookAt(g.lookHead);
      if (av) av.rotation.y = g.yawFace;
      const ready = sampleHeight(g.eye.x, g.eye.z) != null;
      if ((e >= LOAD_MIN && ready) || e >= LOAD_MAX) setIntroPhase('countdown');
    } else if (phase === 'countdown') {
      camera.position.copy(g.camHigh); camera.lookAt(g.lookHead);
      if (av) av.rotation.y = g.yawFace;
      // Start the turn+dolly so it FINISHES at the countdown's end. Challenge: the real clock
      // (countdownEndsAt). Open-world: a self-timed beat (countdownSec). Bypass jumps in immediately.
      const endNow = target.countdownEndsAt != null
        ? performance.now() >= target.countdownEndsAt - INHABIT_DUR * 1000
        : e >= Math.max(0, target.countdownSec - INHABIT_DUR);
      if (consumeIntroBypass() || endNow) setIntroPhase('inhabit');
    } else if (phase === 'inhabit') {
      if (e < TURN_DUR) {                                       // 1) character turns 180° away
        if (av) av.rotation.y = g.yawFace + Math.PI * smooth(e / TURN_DUR);
        camera.position.copy(g.camHigh); camera.lookAt(g.lookHead);
      } else {                                                  // 2) camera dollies down into the head
        if (av) av.rotation.y = g.yawFace + Math.PI;
        const dk = smooth(Math.min(1, (e - TURN_DUR) / DOLLY_DUR));
        camera.position.lerpVectors(g.camHigh, g.eye, dk);
        camera.quaternion.slerpQuaternions(g.holdQuat, g.finalQuat, dk);
        if (av && dk > 0.85) av.visible = false;                // hide just before we enter the skull
      }
      if (e >= INHABIT_DUR) {
        camera.position.copy(g.eye);
        camera.quaternion.copy(g.finalQuat);
        endSiegeIntro();
        try { gl.domElement.requestPointerLock?.(); } catch { /* needs a gesture in some browsers */ }
      }
    }
  });

  // Avatar in its OWN Suspense so its glb load never blocks the camera-driving useFrame above.
  return <Suspense fallback={null}><IntroAvatar target={target} groupRef={avatarRef} /></Suspense>;
}

// DEBUG (editor scene only — in the real game "I" is the item grid): press I to run the intro from
// the current spot with a short self-timed countdown; the player ends up exactly where they are now,
// facing the same way. Space/Enter during the countdown bypasses it. Mounted only in SiegeWorldScene.
export function SiegeSpawnIntroTestKey() {
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e)) return;
      if (isSiegeIntroActive()) {
        if (e.code === 'Space' || e.code === 'Enter') requestIntroBypass();
        return;
      }
      if (e.code !== 'KeyI') return;
      const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
      startSpawnIntro([camera.position.x, camera.position.y, camera.position.z], euler.y, { countdownSec: 4 });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [camera]);
  return null;
}

// Open-world spawn: fire the cinematic the instant the lobby finishes loading — the genuine spawn
// into the open world (NOT a Cmd-J dev jump, which never re-arms the load). Final pose = where the
// player just spawned (current camera); a shorter self-timed countdown. Skipped if a challenge is
// running (that path fires its own clock-aligned intro).
function OpenWorldSpawnIntro() {
  const camera = useThree((s) => s.camera);
  useEffect(() => onSiegeLobbyReady(() => {
    if (isSiegeIntroActive() || getChallengeState().active) return;
    const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
    startSpawnIntro([camera.position.x, camera.position.y, camera.position.z], euler.y, { countdownSec: 5 });
  }), [camera]);
  return null;
}

// Live bypass: Space/Enter during ANY active intro skips the countdown. Safe to listen always — the
// controller is stood down while an intro plays, so these keys aren't doing anything else then.
function IntroLiveBypassKey() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e)) return;
      if (isSiegeIntroActive() && (e.code === 'Space' || e.code === 'Enter')) requestIntroBypass();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return null;
}

// Real-game-only live triggers: open-world auto-fire + live countdown bypass. Mounted in
// SiegeWorldLayers (NOT the editor scene, which auto-fires nothing and uses the 'I' test key).
export function SiegeSpawnIntroLiveTriggers() {
  return (<><OpenWorldSpawnIntro /><IntroLiveBypassKey /></>);
}

// The cinematic itself — mount it anywhere inside the Canvas (it's a no-op until startSpawnIntro
// fires). NO key binding here, so it's safe to mount in the real game alongside the item grid's "I".
export function SiegeSpawnIntro() {
  useSiegeIntro();                       // re-render on phase changes
  const target = getIntroTarget();
  // No Suspense here — IntroDriver must NOT suspend (it owns the camera). The avatar's own Suspense
  // lives inside IntroDriver.
  return getIntroPhase() !== 'off' && target ? <IntroDriver target={target} /> : null;
}
