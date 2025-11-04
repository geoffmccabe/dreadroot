import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { PlayerState } from '@/hooks/useMultiplayer';
import { Text, useFBX } from '@react-three/drei';

interface MultiplayerPlayersProps {
  players: Map<string, PlayerState>;
}

// Load FBX assets once at the top level
function SharedAssetsLoader({ children }: { children: (fbx: THREE.Group, walkClip: THREE.AnimationClip) => React.ReactNode }) {
  const fbx = useFBX('/y-bot.fbx');
  const walkAnim = useFBX('/Unarmed_Walk_Forward.fbx');
  
  if (!fbx || !walkAnim || !walkAnim.animations[0]) {
    return null;
  }
  
  return <>{children(fbx, walkAnim.animations[0])}</>;
}

// Single useFrame loop for ALL players (instead of one per player)
function PlayersController({ players, fbx, walkClip }: MultiplayerPlayersProps & { fbx: THREE.Group; walkClip: THREE.AnimationClip }) {
  const playersRefs = useRef<Map<string, {
    mesh: THREE.Group;
    mixer: THREE.AnimationMixer;
    actions: { walk: THREE.AnimationAction | null };
    currentAction: string;
    lastPosition: THREE.Vector3;
    targetPosition: THREE.Vector3;
    targetRotation: number;
  }>>(new Map());
  
  // ONE useFrame for ALL players (massive performance gain)
  useFrame((_, delta) => {
    playersRefs.current.forEach((playerData) => {
      if (!playerData.mesh) return;
      
      // Lerp position
      playerData.mesh.position.lerp(playerData.targetPosition, 0.3);
      
      // Lerp rotation
      const currentYaw = playerData.mesh.rotation.y;
      playerData.mesh.rotation.y = THREE.MathUtils.lerp(
        currentYaw,
        playerData.targetRotation,
        0.3
      );

      // Update animation mixer
      if (playerData.mixer) {
        playerData.mixer.update(delta);
      }

      // Detect movement for animation switching
      const currentPos = playerData.mesh.position;
      const distanceMoved = currentPos.distanceTo(playerData.lastPosition);
      const isMoving = distanceMoved > 0.01;
      
      // Switch between idle and walk
      const desiredAction = isMoving ? 'walk' : 'idle';
      if (desiredAction !== playerData.currentAction) {
        if (desiredAction === 'walk' && playerData.actions.walk) {
          playerData.actions.walk.reset().fadeIn(0.2).play();
        } else if (desiredAction === 'idle' && playerData.actions.walk) {
          playerData.actions.walk.fadeOut(0.2);
        }
        playerData.currentAction = desiredAction;
      }

      playerData.lastPosition.copy(currentPos);
    });
  });
  
  return (
    <>
      {Array.from(players.values()).map((player) => (
        <OtherPlayer 
          key={player.userId} 
          player={player} 
          playersRefs={playersRefs}
          fbx={fbx}
          walkClip={walkClip}
        />
      ))}
    </>
  );
}

function OtherPlayer({ player, playersRefs, fbx, walkClip }: { 
  player: PlayerState;
  playersRefs: React.MutableRefObject<Map<string, any>>;
  fbx: THREE.Group;
  walkClip: THREE.AnimationClip;
}) {
  const meshRef = useRef<THREE.Group>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const actionsRef = useRef<{ walk: THREE.AnimationAction | null }>({ walk: null });

  // Configure avatar materials, shadows, and animations
  React.useEffect(() => {
    if (!fbx || !meshRef.current) return;
    
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
    
    // Use shared walk animation clip
    const walkAction = mixerRef.current.clipAction(walkClip);
    walkAction.play();
    actionsRef.current.walk = walkAction;
    
    // Register this player in the controller
    playersRefs.current.set(player.userId, {
      mesh: meshRef.current,
      mixer: mixerRef.current,
      actions: actionsRef.current,
      currentAction: 'idle',
      lastPosition: new THREE.Vector3(player.position.x, player.position.y, player.position.z),
      targetPosition: new THREE.Vector3(player.position.x, player.position.y, player.position.z),
      targetRotation: player.rotation.yaw
    });

    return () => {
      mixerRef.current?.stopAllAction();
      playersRefs.current.delete(player.userId);
    };
  }, [fbx, player.color, player.userId]);
  
  // Update target position when player moves (no useFrame needed per player!)
  React.useEffect(() => {
    const playerData = playersRefs.current.get(player.userId);
    if (playerData) {
      playerData.targetPosition.set(
        player.position.x,
        player.position.y,
        player.position.z
      );
      playerData.targetRotation = player.rotation.yaw;
    }
  }, [player.position.x, player.position.y, player.position.z, player.rotation.yaw, player.userId]);

  // Clone the FBX ONCE per player, not on every render
  const avatarClone = React.useMemo(() => {
    if (!fbx) return null;
    return fbx.clone();
  }, []); // Empty deps - clone once when component mounts

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
  if (players.size === 0) {
    return null;
  }

  // Load assets once and pass them to all players
  return (
    <SharedAssetsLoader>
      {(fbx, walkClip) => (
        <PlayersController players={players} fbx={fbx} walkClip={walkClip} />
      )}
    </SharedAssetsLoader>
  );
}
