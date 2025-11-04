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
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const actionsRef = useRef<{ [key: string]: THREE.AnimationAction | null }>({});
  const currentActionRef = useRef<string>('idle');
  const lastPositionRef = useRef(new THREE.Vector3(player.position.x, player.position.y, player.position.z));
  
  const fbx = useFBX('/y-bot.fbx');
  const walkAnim = useFBX('/Unarmed_Walk_Forward.fbx');
  
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

  // Configure avatar materials, shadows, and animations
  React.useEffect(() => {
    if (!fbx) return;
    
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

    // Setup animation mixer
    mixerRef.current = new THREE.AnimationMixer(fbx);
    
    // Load walk animation
    if (walkAnim && walkAnim.animations.length > 0) {
      const walkAction = mixerRef.current.clipAction(walkAnim.animations[0]);
      walkAction.play();
      actionsRef.current.walk = walkAction;
    }

    return () => {
      mixerRef.current?.stopAllAction();
    };
  }, [fbx, walkAnim, player.color]);

  // Smooth interpolation and animation updates
  useFrame((_, delta) => {
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

    // Update animation mixer
    if (mixerRef.current) {
      mixerRef.current.update(delta);
    }

    // Detect movement for animation switching
    const currentPos = meshRef.current.position;
    const distanceMoved = currentPos.distanceTo(lastPositionRef.current);
    const isMoving = distanceMoved > 0.01;
    
    // Switch between idle and walk
    const desiredAction = isMoving ? 'walk' : 'idle';
    if (desiredAction !== currentActionRef.current) {
      if (desiredAction === 'walk' && actionsRef.current.walk) {
        actionsRef.current.walk.reset().fadeIn(0.2).play();
      } else if (desiredAction === 'idle' && actionsRef.current.walk) {
        actionsRef.current.walk.fadeOut(0.2);
      }
      currentActionRef.current = desiredAction;
    }

    lastPositionRef.current.copy(currentPos);
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

  return (
    <>
      {playerArray.map((player) => (
        <OtherPlayer key={player.userId} player={player} />
      ))}
    </>
  );
}
