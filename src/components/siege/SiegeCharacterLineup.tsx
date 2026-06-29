// SiegeCharacterLineup — the toggleable lineup of the Starblind characters (Ash, Thorn, … as more
// are rigged). Toggle with "&&&". They appear ON THE GROUND in a row in front of the player in any
// SWW world, facing you. M = next animation, N = previous (same Mixamo skeleton + clips on every
// character, so one index drives them all). The current animation's number/name shows in the HUD.
//
// In-canvas only (renders inside <Canvas>); the HUD readout lives in SiegeCharLineupHud (DOM).
import { Fragment, Suspense, useEffect, useMemo, useRef } from 'react';
import { isTypingTarget } from '@/lib/isTypingTarget';
import { useGLTF, useAnimations } from '@react-three/drei';
import { useThree, useFrame } from '@react-three/fiber';
import { SkeletonUtils } from 'three-stdlib';
import * as THREE from 'three';
import { sampleHeight } from './terrainHeight';
import {
  LINEUP_CHARS, ANIM_LIBRARY, RIFLE_LIBRARY, LOCO_LIBRARY, CHAR_ASSET_VERSION, useCharLineup, getCharLineupEnabled,
  toggleCharLineup, cycleCharAnim, setCharAnimNames, setCharAnchor, triggerFlight,
  getFlightSeq, getFlightMode, triggerParkour, getParkourSeq,
} from './charlineup/siegeCharLineupState';
import { AnimFSM } from './charlineup/animFSM';
import { FLIGHT_GRAPH } from './charlineup/flightGraph';
import { AshCigaretteFx } from './charadmin/AshCigaretteFx';
import { type LineupWeaponDef } from './charlineup/lineupWeapons';
import { heldWeaponByKey } from './charlineup/weaponModels';
import { LineupWeapon } from './charlineup/LineupWeapon';
import { classifyObstacle } from './charlineup/obstacleDetector';
import { parkourGraph } from './charlineup/parkourGraphs';
import { OBSTACLE_PRESETS, OBSTACLE_DIST } from './charlineup/parkourDemo';
import { UNARMED_MALE } from './charlineup/locomotionClips';

// Our first real held rifle: the AK74 (all 7 tiers share this one model + the rifle anims). Every
// lineup character holds it so we can see the confirmed-good rifle animations on the actual gun.
const AK47 = heldWeaponByKey('ak47')!;

const SPACING = 2.2; // metres between characters
const AHEAD = 5;     // metres in front of the player the row appears

// STABLE asset version (not APP_VERSION) so the browser caches the meshes + the shared animation
// library across deploys — they only re-download when CHAR_ASSET_VERSION is bumped (i.e. when the
// glbs are actually rebuilt). Draco-compressed, decoded via /draco/.
// scratch for the tail swish (no per-frame allocation)
const _tailEuler = new THREE.Euler();
const _tailQ = new THREE.Quaternion();

const glbUrl = (file: string) => `${file}?a=${CHAR_ASSET_VERSION}`;
useGLTF.preload(glbUrl(ANIM_LIBRARY), '/draco/');
useGLTF.preload(glbUrl(RIFLE_LIBRARY), '/draco/');
useGLTF.preload(glbUrl(LOCO_LIBRARY), '/draco/');
LINEUP_CHARS.forEach((c) => useGLTF.preload(glbUrl(c.file), '/draco/'));
useGLTF.preload(`${AK47.url}?a=${CHAR_ASSET_VERSION}`, '/draco/');

function LineupChar({ file, x, z, yaw, fallbackY, scale, minY, animIndex, weapon }: { file: string; x: number; z: number; yaw: number; fallbackY: number; scale: number; minY: number; animIndex: number; weapon: LineupWeaponDef }) {
  const { scene } = useGLTF(glbUrl(file), '/draco/');
  // Animations come from the shared category libraries (deduped across all characters); useGLTF
  // caches each so they're fetched once and reused. Merge their clips and bind to this character by
  // bone name (all mixamorig). Clip names are unique across libraries, so the merge is collision-free.
  const { animations: baseAnims } = useGLTF(glbUrl(ANIM_LIBRARY), '/draco/');
  const { animations: rifleAnims } = useGLTF(glbUrl(RIFLE_LIBRARY), '/draco/');
  const { animations: locoAnims } = useGLTF(glbUrl(LOCO_LIBRARY), '/draco/');
  const animations = useMemo(() => [...baseAnims, ...rifleAnims, ...locoAnims], [baseAnims, rifleAnims, locoAnims]);
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
  const groundY = useMemo(() => (sampleHeight(x, z) ?? fallbackY) - minY * scale, [x, z, fallbackY, minY, scale]);

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
  });

  // Show the held gun only during the rifle clips (hidden during dance/climb/flight, where a gun
  // stuck to the hand would look broken). Clip names from the rifle library all contain 'Rifle'.
  const currentName = names.length ? names[animIndex % names.length] : '';
  const showWeapon = currentName.includes('Rifle');

  return (
    <group ref={group} position={[x, groundY, z]} rotation={[0, yaw, 0]} scale={scale}>
      <primitive object={cloned} />
      {/* Ash's cigarette glow + smoke (no-op for other characters) */}
      <AshCigaretteFx group={cloned} />
      {/* Two-handed gun in the right hand during rifle animations (auto-sized per character) */}
      {showWeapon && <Suspense fallback={null}><LineupWeapon root={cloned} weapon={weapon} /></Suspense>}
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

export function SiegeCharacterLineup() {
  const { enabled, animIndex, anchor, parkourSeq } = useCharLineup();
  const { camera } = useThree();

  // "&&&" toggles the lineup; M / N cycle animations while it's shown. Capture-phase so the
  // lineup's M/N win over any other M handler when the lineup is up.
  useEffect(() => {
    let amp: number[] = [];
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
      else if (e.key === 'f' || e.key === 'F') { e.stopImmediatePropagation(); triggerFlight('land'); }
      else if (e.key === 'g' || e.key === 'G') { e.stopImmediatePropagation(); triggerFlight('wall'); }
      else if (e.key === 'j' || e.key === 'J') { e.stopImmediatePropagation(); triggerParkour(); } // cycle obstacle + auto-parkour
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
    // Ground under the player is loaded now → a safe fallback height for any row cell not yet sampled.
    const groundY = sampleHeight(p.x, p.z) ?? sampleHeight(cx, cz) ?? p.y;
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
              <LineupChar file={c.file} x={cx} z={cz} yaw={anchor.yaw} fallbackY={anchor.groundY} scale={c.scale} minY={c.minY} animIndex={animIndex} weapon={AK47} />
            </Suspense>
            {/* obstacle for the parkour demo (J) — only after the first trigger so it isn't clutter */}
            {parkourSeq > 0 && <ObstacleBox x={cx} z={cz} yaw={anchor.yaw} groundY={anchor.groundY} preset={OBSTACLE_PRESETS[parkourSeq % OBSTACLE_PRESETS.length]} />}
          </Fragment>
        );
      })}
    </>
  );
}
