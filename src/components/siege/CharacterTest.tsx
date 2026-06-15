// CharacterTest — loads the converted player character (player.glb) and plays a
// selected animation clip via drei's useAnimations. Proof that rigged models +
// animations port cleanly; later this becomes the real player avatar + the
// character roster.

import { useEffect, useRef } from 'react';
import { useGLTF, useAnimations } from '@react-three/drei';
import * as THREE from 'three';

export function CharacterTest({ position, anim }: { position: [number, number, number]; anim: string }) {
  const { scene, animations } = useGLTF('/siege/characters/shiyang.glb');
  const ref = useRef<THREE.Group>(null);
  const { actions, names } = useAnimations(animations, ref);

  useEffect(() => {
    const action = actions[anim] || actions[names.find((n) => n.toLowerCase().includes('idle')) || names[0]];
    if (!action) return;
    action.reset().fadeIn(0.25).play();
    return () => { action.fadeOut(0.25); };
  }, [actions, names, anim]);

  // Model imports ~100x too big and lying down (Z-up FBX). Scale down + stand up.
  return (
    <group ref={ref} position={position} scale={0.01}>
      <group rotation={[-Math.PI / 2, Math.PI, 0]}>
        <primitive object={scene} />
      </group>
    </group>
  );
}
