// SiegeCharacterPair — stands a small set of player characters side-by-side near the Siege
// spawn so you can walk up and inspect them. Each one uses the PROVEN render recipe from
// SiegeCharacter (raw glb → SkeletonUtils.clone → useAnimations, play idle full-clip, CLEAN
// transform) but at a FIXED world position with a floating name tag — no dropdown, no inspect
// toggle, no player-avatar-in-your-face problem. Additive/diagnostic: lets us compare which
// characters render clean (arms/hands undistorted) through the bind-fix → unit-normalize pipeline.
import { Suspense, useEffect, useMemo, useRef } from 'react';
import { useGLTF, useAnimations, Billboard, Text } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { SkeletonUtils } from 'three-stdlib';
import * as THREE from 'three';
import { sampleHeight } from './terrainHeight';
import { APP_VERSION } from '@/version';
import { SIEGE_SPAWN_POINT } from './siegeAreas';

const CLEAN_SCALE = 1.1819;
const CLEAN_FEET_Y = -0.0327;

// The lineup to show, in display order (left → right). Both come from the dev's player-RIG
// exports run through convert_character_bindfix.py → glb_unit_normalize.py (rest==bind, ibm=1).
const PAIR: { id: string; name: string }[] = [
  { id: 'thorn', name: 'Thorn' },
  { id: 'shiyang', name: 'Shi Yang' },
];

const SPACING = 2.5; // metres between characters

// NOTE: rotation-only filtering was tried (v4.55.1) and PROVEN NOT to fix the stretched fingers
// (verified zoomed on a Metal GPU render: fingers still splay with rotation-only). The stretch
// comes from the bone ROTATIONS, not translations — static/bind pose is clean, ANY animation
// stretches. Almost certainly a bone-orientation mismatch between the dev's animation data and
// the exported rig (the bind-fix corrected the static pose but not the animated rotations). Do
// NOT re-add track filtering as "the fix"; it does nothing for the fingers.

// shiyang's GOOD file is shiyang_v2 (bind-fixed only). The "v3" unit-normalize step
// (ibm 100→1) actually CORRUPTED the rig — it blew the bind pose out to 3m wide and
// stretched the fingers into spikes on Apple/Metal GPUs (clean on software GL, which is
// why it fooled earlier tests). Proven by headless Metal-GPU render. Never re-normalize.
const GLB_FILE: Record<string, string> = { shiyang: 'shiyang_v2' };

// ── Animation-inspection control (module-level, read directly in useFrame) ──
// Lets the user FREEZE the animation on any frame and compare against the static REST pose, so
// they can tell me exactly what's distorted (I've been misjudging my own screenshots). Read live
// from the module var in useFrame; the DOM panel mutates it.
const animCtl = { paused: false, restPose: false, stepNonce: 0, stepDir: 0 };

function CharacterStand({ id, name, x, z }: { id: string; name: string; x: number; z: number }) {
  const file = GLB_FILE[id] ?? id;
  const { scene, animations } = useGLTF(`/siege/characters/${file}.glb?v=${APP_VERSION}`);
  const cloned = useMemo(() => SkeletonUtils.clone(scene) as THREE.Group, [scene]);
  const group = useRef<THREE.Group>(null);
  const { actions, names } = useAnimations(animations, group);
  const actionRef = useRef<THREE.AnimationAction | null>(null);
  const skelRef = useRef<THREE.Skeleton | null>(null);
  const lastNonce = useRef(0);

  // Feet on the ground; face roughly toward where the player spawns (so you see the front).
  const groundY = useMemo(() => (sampleHeight(x, z) ?? SIEGE_SPAWN_POINT[1]) - CLEAN_FEET_Y, [x, z]);

  // Capture the skinned mesh's skeleton so REST-pose mode can reset bones to bind.
  useEffect(() => {
    cloned.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) skelRef.current = (o as THREE.SkinnedMesh).skeleton; });
  }, [cloned]);

  useEffect(() => {
    if (!names.length) return;
    const idle = names.find((n) => n.toLowerCase().includes('idle')) || names[0];
    const a = actions[idle];
    a?.reset().fadeIn(0.2).play();
    actionRef.current = a ?? null;
    return () => { a?.fadeOut(0.2); };
  }, [actions, names]);

  useFrame(() => {
    const g = group.current; if (!g) return;
    // these rigs face -Z; +π turns the front toward +Z (toward the spawn/camera approach)
    g.rotation.set(0, Math.PI, 0);
    // apply the inspection control
    const a = actionRef.current;
    if (a) {
      if (animCtl.restPose) {
        a.enabled = false;                  // stop driving bones…
        skelRef.current?.pose();            // …and snap skeleton to its bind/rest pose
      } else {
        a.enabled = true;
        a.paused = animCtl.paused;
        if (animCtl.stepNonce !== lastNonce.current) {  // single-frame scrub while paused
          lastNonce.current = animCtl.stepNonce;
          a.paused = true; animCtl.paused = true;
          a.time = Math.max(0, a.time + animCtl.stepDir * 0.05);
        }
      }
    }
  });

  return (
    <group>
      <group ref={group} position={[x, groundY, z]} scale={CLEAN_SCALE}>
        <primitive object={cloned} />
      </group>
      <Billboard position={[x, groundY + 2.4, z]}>
        <Text fontSize={0.35} color="#ffffff" anchorX="center" outlineWidth={0.03} outlineColor="#000000">
          {name}
        </Text>
      </Billboard>
    </group>
  );
}

// Build a small DOM control panel (appended to body, like the old char dropdown) so the user can
// pause/step/reset the animation and report what they see. Styled dark to match the game UI.
function useAnimControlPanel() {
  useEffect(() => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:10000;display:flex;gap:8px;align-items:center;background:rgba(10,12,16,.82);border:1px solid #3a4456;border-radius:8px;padding:8px 12px;font:13px sans-serif;color:#dfe6f0;box-shadow:0 3px 12px rgba(0,0,0,.5)';
    const mk = (label: string) => { const b = document.createElement('button'); b.textContent = label; b.style.cssText = 'background:#1d2532;color:#dfe6f0;border:1px solid #46536b;border-radius:5px;padding:5px 10px;cursor:pointer;font:13px sans-serif'; wrap.appendChild(b); return b; };
    const lbl = document.createElement('span'); lbl.textContent = 'Anim:'; lbl.style.opacity = '.7'; wrap.appendChild(lbl);
    const playBtn = mk('⏸ Pause');
    const stepB = mk('◀ Step'); const stepF = mk('Step ▶');
    const rest = mk('Rest Pose');
    const sync = () => {
      playBtn.textContent = animCtl.paused ? '▶ Play' : '⏸ Pause';
      rest.style.background = animCtl.restPose ? '#3a5bd0' : '#1d2532';
    };
    playBtn.onclick = () => { animCtl.paused = !animCtl.paused; sync(); };
    stepB.onclick = () => { animCtl.stepDir = -1; animCtl.stepNonce++; sync(); };
    stepF.onclick = () => { animCtl.stepDir = 1; animCtl.stepNonce++; sync(); };
    rest.onclick = () => { animCtl.restPose = !animCtl.restPose; sync(); };
    document.body.appendChild(wrap); sync();
    return () => { wrap.remove(); animCtl.paused = false; animCtl.restPose = false; };
  }, []);
}

export function SiegeCharacterPair() {
  useAnimControlPanel();
  const n = PAIR.length;
  // A few metres in front of the spawn point (toward +Z), in a clear row.
  const cx = SIEGE_SPAWN_POINT[0];
  const cz = SIEGE_SPAWN_POINT[2] + 4;
  return (
    <Suspense fallback={null}>
      {PAIR.map((c, i) => (
        <CharacterStand key={c.id} id={c.id} name={c.name} x={cx + (i - (n - 1) / 2) * SPACING} z={cz} />
      ))}
    </Suspense>
  );
}
