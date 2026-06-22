// MagicChest — the in-world chest model (kingdom chest base + separate lid) at the lobby chest
// spot. The lid eases open while the chest is being opened (phase != idle) and closes after. Lid
// hinge is approximate (rotates the lid group); refine if needed.
import { useMemo, useRef } from 'react';
import { useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getChestPhase } from './chestState';

const POS: [number, number, number] = [-84.69, 23.7, 312.155];
const YAW = Math.PI;             // face roughly toward the player approach
const LID_OPEN = -1.8;           // radians

export function MagicChest() {
  const base = useGLTF('/siege/scifi/kingdom_SM_Prop_Chest_01.gltf', '/draco/');
  const lid = useGLTF('/siege/scifi/kingdom_SM_Prop_Chest_01_Lid.gltf', '/draco/');
  const baseScene = useMemo(() => base.scene.clone(true), [base.scene]);
  const lidScene = useMemo(() => lid.scene.clone(true), [lid.scene]);
  const lidRef = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    const target = getChestPhase() === 'idle' ? 0 : LID_OPEN;
    const g = lidRef.current;
    if (g) g.rotation.x += (target - g.rotation.x) * Math.min(1, dt * 4);
  });
  return (
    <group position={POS} rotation={[0, YAW, 0]}>
      <primitive object={baseScene} />
      <group ref={lidRef}><primitive object={lidScene} /></group>
    </group>
  );
}

useGLTF.preload('/siege/scifi/kingdom_SM_Prop_Chest_01.gltf', '/draco/');
useGLTF.preload('/siege/scifi/kingdom_SM_Prop_Chest_01_Lid.gltf', '/draco/');
