// SiegeCharacterPair — stands the player characters side-by-side near the Siege spawn so you can
// walk up and inspect them. Raw glb → SkeletonUtils.clone → useAnimations, play idle, at a fixed
// world position with a floating name tag.
//
// ⭐ The long-chased "stretched fingers" distortion is in the SOURCE animation data, NOT our
// pipeline or renderer — the dev (Ivan) confirmed the finger animations are broken even in Unity
// (forearms fine, only fingers), and Babylon reproduces it identically. Until the animations are
// redone properly, we STRIP the finger/thumb bone tracks (see stripFingerTracks) so the body and
// arms animate normally while the fingers rest in their clean bind pose instead of tearing apart.
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

const PAIR: { id: string; name: string }[] = [
  { id: 'thorn', name: 'Thorn' },
  { id: 'shiyang', name: 'Shi Yang' },
];

const SPACING = 2.5; // metres between characters

// shiyang's good file is shiyang_v2 (bind-fixed only; never the unit-normalized v3, which
// corrupted the rig). thorn uses thorn.glb directly.
const GLB_FILE: Record<string, string> = { shiyang: 'shiyang_v2' };

// Strip the finger/thumb/index bone tracks from every clip so they stay at their (clean) bind
// pose while the rest of the body animates. The source finger animations distort the mesh (bad
// in Unity too, per the dev). Rebuild each clip so we don't mutate the cached useGLTF data.
function stripFingerTracks(clips: THREE.AnimationClip[]): THREE.AnimationClip[] {
  return clips.map((c) => new THREE.AnimationClip(
    c.name, c.duration,
    c.tracks.filter((t) => !/finger|thumb|index/i.test(t.name)),
  ));
}

function CharacterStand({ id, name, x, z }: { id: string; name: string; x: number; z: number }) {
  const file = GLB_FILE[id] ?? id;
  const { scene, animations } = useGLTF(`/siege/characters/${file}.glb?v=${APP_VERSION}`);
  const cloned = useMemo(() => SkeletonUtils.clone(scene) as THREE.Group, [scene]);
  const group = useRef<THREE.Group>(null);
  const clips = useMemo(() => stripFingerTracks(animations), [animations]);
  const { actions, names } = useAnimations(clips, group);

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
