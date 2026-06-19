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

function CharacterStand({ id, name, x, z }: { id: string; name: string; x: number; z: number }) {
  const file = GLB_FILE[id] ?? id;
  const { scene, animations } = useGLTF(`/siege/characters/${file}.glb?v=${APP_VERSION}`);
  const cloned = useMemo(() => SkeletonUtils.clone(scene) as THREE.Group, [scene]);
  const group = useRef<THREE.Group>(null);
  const { actions, names } = useAnimations(animations, group);

  // Feet on the ground; face roughly toward where the player spawns (so you see the front).
  const groundY = useMemo(() => (sampleHeight(x, z) ?? SIEGE_SPAWN_POINT[1]) - CLEAN_FEET_Y, [x, z]);

  useEffect(() => {
    if (!names.length) return;
    const idle = names.find((n) => n.toLowerCase().includes('idle')) || names[0];
    const a = actions[idle];
    a?.reset().fadeIn(0.2).play();
    return () => { a?.fadeOut(0.2); };
  }, [actions, names]);

  useFrame(() => {
    const g = group.current; if (!g) return;
    // these rigs face -Z; +π turns the front toward +Z (toward the spawn/camera approach)
    g.rotation.set(0, Math.PI, 0);
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

export function SiegeCharacterPair() {
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
