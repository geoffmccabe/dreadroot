import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { PlayerState } from '@/hooks/useMultiplayer';
import { Text, useFBX } from '@react-three/drei';

interface MultiplayerPlayersProps {
  players: Map<string, PlayerState>;
}

function OtherPlayer({ player }: { player: PlayerState }) {
  const meshRef = useRef<THREE.Group>(null);
  const fbx = useFBX('/y-bot.fbx');
  const targetPosition = useRef(new THREE.Vector3(
    player.position.x,
    player.position.y,
    player.position.z
  ));
  const targetRotation = useRef(player.rotation.yaw);

  // Update target when player state changes
  React.useEffect(() => {
    targetPosition.current.set(
      player.position.x,
      player.position.y,
      player.position.z
    );
    targetRotation.current = player.rotation.yaw;
  }, [player.position.x, player.position.y, player.position.z, player.rotation.yaw]);

  // Configure avatar materials and shadows
  React.useEffect(() => {
    if (fbx) {
      const color = player.color || '#ff6b6b';
      fbx.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          if (child.material) {
            const material = child.material as THREE.MeshStandardMaterial;
            material.color.set(color);
          }
        }
      });
    }
  }, [fbx, player.color]);

  // Smooth interpolation
  useFrame(() => {
    if (!meshRef.current) return;
    
    // Lerp position
    meshRef.current.position.lerp(targetPosition.current, 0.3);
    
    // Lerp rotation
    const currentYaw = meshRef.current.rotation.y;
    meshRef.current.rotation.y = THREE.MathUtils.lerp(
      currentYaw,
      targetRotation.current,
      0.3
    );
  });

  const avatarClone = React.useMemo(() => {
    if (!fbx) return null;
    return fbx.clone();
  }, [fbx]);

  return (
    <group ref={meshRef} position={[player.position.x, player.position.y, player.position.z]}>
      {/* 3D Avatar Model */}
      {avatarClone && (
        <primitive 
          object={avatarClone} 
          scale={0.01}
          position={[0, -0.9, 0]}
        />
      )}

      {/* Username label above player */}
      <Text
        position={[0, 1.3, 0]}
        fontSize={0.15}
        color="white"
        anchorX="center"
        anchorY="bottom"
        outlineWidth={0.02}
        outlineColor="black"
      >
        {player.username || 'Player'}
      </Text>
    </group>
  );
}

export function MultiplayerPlayers({ players }: MultiplayerPlayersProps) {
  const playerArray = Array.from(players.values());

  if (playerArray.length === 0) {
    return null;
  }

  console.log('[MultiplayerPlayers] Rendering', playerArray.length, 'other players');

  return (
    <>
      {playerArray.map((player) => (
        <OtherPlayer key={player.userId} player={player} />
      ))}
    </>
  );
}
