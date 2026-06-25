// SiegeCharacterLineup — the toggleable lineup of the Starblind characters (Ash, Thorn, … as more
// are rigged). Toggle with "&&&". They appear ON THE GROUND in a row in front of the player in any
// SWW world, facing you. M = next animation, N = previous (same Mixamo skeleton + clips on every
// character, so one index drives them all). The current animation's number/name shows in the HUD.
//
// In-canvas only (renders inside <Canvas>); the HUD readout lives in SiegeCharLineupHud (DOM).
import { Suspense, useEffect, useMemo, useRef } from 'react';
import { useGLTF, useAnimations } from '@react-three/drei';
import { useThree, useFrame } from '@react-three/fiber';
import { SkeletonUtils } from 'three-stdlib';
import * as THREE from 'three';
import { sampleHeight } from './terrainHeight';
import {
  LINEUP_CHARS, ANIM_LIBRARY, CHAR_ASSET_VERSION, useCharLineup, getCharLineupEnabled,
  toggleCharLineup, cycleCharAnim, setCharAnimNames, setCharAnchor, triggerFlight,
  getFlightSeq, getFlightMode,
} from './charlineup/siegeCharLineupState';
import { AnimFSM } from './charlineup/animFSM';
import { FLIGHT_GRAPH } from './charlineup/flightGraph';

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
LINEUP_CHARS.forEach((c) => useGLTF.preload(glbUrl(c.file), '/draco/'));

function LineupChar({ file, x, z, yaw, fallbackY, scale, minY, animIndex }: { file: string; x: number; z: number; yaw: number; fallbackY: number; scale: number; minY: number; animIndex: number }) {
  const { scene } = useGLTF(glbUrl(file), '/draco/');
  // Animations come from ONE shared library (deduped across all characters); useGLTF caches it so
  // it's fetched once and reused. Bind its clips to this character by bone name (all mixamorig).
  const { animations } = useGLTF(glbUrl(ANIM_LIBRARY), '/draco/');
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
        const amp = 0.10 + 0.20 * frac;          // base → tip (whip), grows toward the tip
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
        fsmRef.current = null;
        g.position.set(x, groundY, z);
        actions[names[animIndex % names.length]]?.reset().fadeIn(0.3).play();
      };
      fsm.start();
      fsmRef.current = fsm;
    }
    const fsm = fsmRef.current;
    if (fsm?.active) {
      fsm.tick(dt);
      g.position.y = Math.max(groundY, groundY + fsm.offsetY);
      g.position.x = x + Math.sin(yaw) * fsm.offsetZ;
      g.position.z = z + Math.cos(yaw) * fsm.offsetZ;
    }
  });

  return (
    <group ref={group} position={[x, groundY, z]} rotation={[0, yaw, 0]} scale={scale}>
      <primitive object={cloned} />
    </group>
  );
}

export function SiegeCharacterLineup() {
  const { enabled, animIndex, anchor } = useCharLineup();
  const { camera } = useThree();

  // "&&&" toggles the lineup; M / N cycle animations while it's shown. Capture-phase so the
  // lineup's M/N win over any other M handler when the lineup is up.
  useEffect(() => {
    let amp: number[] = [];
    const onKey = (e: KeyboardEvent) => {
      // Never hijack typing in a field.
      const tgt = e.target as HTMLElement | null;
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)) return;
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

  return (
    <Suspense fallback={null}>
      {LINEUP_CHARS.map((c, i) => {
        const off = (i - (n - 1) / 2) * SPACING;
        return (
          <LineupChar key={c.name} file={c.file} x={anchor.x + rx * off} z={anchor.z + rz * off} yaw={anchor.yaw} fallbackY={anchor.groundY} scale={c.scale} minY={c.minY} animIndex={animIndex} />
        );
      })}
    </Suspense>
  );
}
