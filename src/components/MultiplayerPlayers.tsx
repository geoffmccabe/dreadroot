import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { PlayerState } from '@/hooks/useMultiplayer';
import { Text } from '@react-three/drei';

interface MultiplayerPlayersProps {
  players: Map<string, PlayerState>;
}

function OtherPlayer({ player }: { player: PlayerState }) {
  const meshRef = useRef<THREE.Group>(null);
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

  const color = player.color || '#ff6b6b';

  return (
    <group ref={meshRef} position={[player.position.x, player.position.y, player.position.z]}>
      {/* Body - Capsule-like player */}
      <mesh position={[0, 0, 0]}>
        <capsuleGeometry args={[0.3, 1.2, 8, 16]} />
        <meshStandardMaterial color={color} />
      </mesh>

      {/* Head indicator */}
      <mesh position={[0, 0.8, 0]}>
        <sphereGeometry args={[0.2, 16, 16]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.3} />
      </mesh>

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

      {/* Direction indicator (small cone pointing forward) */}
      <mesh position={[0, 0.9, 0.4]} rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.1, 0.2, 8]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.5} />
      </mesh>
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
