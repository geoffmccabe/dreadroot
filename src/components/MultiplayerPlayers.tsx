import React, { useRef, useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { PlayerState } from '@/hooks/useMultiplayer';
import { Text, useFBX } from '@react-three/drei';
import { frameLoop } from '@/lib/frameLoop';

interface MultiplayerPlayersProps {
  players: Map<string, PlayerState>;
}

// Shared assets loaded once
function SharedAssetsLoader({ children }: { children: (assets: { fbx: THREE.Group; walkClip: THREE.AnimationClip }) => React.ReactNode }) {
  const fbx = useFBX('/y-bot.fbx');
  const walkAnim = useFBX('/Unarmed_Walk_Forward.fbx');
  
  if (!fbx || !walkAnim || !walkAnim.animations[0]) return null;
  
  return <>{children({ fbx, walkClip: walkAnim.animations[0] })}</>;
}

// Single controller for all players - uses centralized frame loop
function PlayersController({ 
  players, 
  fbx, 
  walkClip 
}: { 
  players: Map<string, PlayerState>; 
  fbx: THREE.Group;
  walkClip: THREE.AnimationClip;
}) {
  const playersRefs = useRef<Map<string, {
    mesh: THREE.Group;
    mixer: THREE.AnimationMixer;
    walkAction: THREE.AnimationAction;
    targetPosition: THREE.Vector3;
    targetRotation: number;
    lastPosition: THREE.Vector3;
    currentAction: string;
  }>>(new Map());
  
  // Register with centralized frame loop instead of useFrame
  useEffect(() => {
    const unregister = frameLoop.register('multiplayer-players', (delta) => {
      playersRefs.current.forEach((playerData) => {
        const { mesh, mixer, walkAction, targetPosition, targetRotation, lastPosition } = playerData;
        
        // Lerp position
        mesh.position.lerp(targetPosition, 0.3);
        
        // Lerp rotation
        mesh.rotation.y = THREE.MathUtils.lerp(mesh.rotation.y, targetRotation, 0.3);
        
        // Update animation mixer
        mixer.update(delta);
        
        // Detect movement for animation switching
        const distanceMoved = mesh.position.distanceTo(lastPosition);
        const isMoving = distanceMoved > 0.01;
        
        const desiredAction = isMoving ? 'walk' : 'idle';
        if (desiredAction !== playerData.currentAction) {
          if (desiredAction === 'walk') {
            walkAction.reset().fadeIn(0.2).play();
          } else {
            walkAction.fadeOut(0.2);
          }
          playerData.currentAction = desiredAction;
        }
        
        lastPosition.copy(mesh.position);
      });
    }, 55); // Medium-low priority
    
    return unregister;
  }, []);
  
  return (
    <>
      {Array.from(players.values()).map((player) => (
        <OtherPlayer 
          key={player.userId} 
          player={player} 
          fbx={fbx}
          walkClip={walkClip}
          playersRefs={playersRefs}
        />
      ))}
    </>
  );
}

function OtherPlayer({ 
  player, 
  fbx, 
  walkClip,
  playersRefs
}: { 
  player: PlayerState; 
  fbx: THREE.Group;
  walkClip: THREE.AnimationClip;
  playersRefs: React.MutableRefObject<Map<string, any>>;
}) {
  const meshRef = useRef<THREE.Group>(null);
  
  // Clone FBX once on mount (not on every render)
  const avatarClone = useMemo(() => fbx.clone(), []);

  // Setup mixer and register with controller
  useEffect(() => {
    if (!meshRef.current || !avatarClone) return;
    
    const color = player.color || '#ff6b6b';
    avatarClone.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        if (child.material) {
          const material = child.material as THREE.MeshStandardMaterial;
          material.color.set(color);
        }
      }
    });

    const mixer = new THREE.AnimationMixer(avatarClone);
    const walkAction = mixer.clipAction(walkClip);
    walkAction.play();
    
    // Register with controller
    playersRefs.current.set(player.userId, {
      mesh: meshRef.current,
      mixer,
      walkAction,
      targetPosition: new THREE.Vector3(player.position.x, player.position.y, player.position.z),
      targetRotation: player.rotation.yaw,
      lastPosition: new THREE.Vector3(player.position.x, player.position.y, player.position.z),
      currentAction: 'idle'
    });

    return () => {
      mixer.stopAllAction();
      playersRefs.current.delete(player.userId);
    };
  }, [avatarClone, player.userId, player.color, walkClip, playersRefs]);
  
  // Update target position/rotation when player state changes
  useEffect(() => {
    const playerData = playersRefs.current.get(player.userId);
    if (playerData) {
      playerData.targetPosition.set(player.position.x, player.position.y, player.position.z);
      playerData.targetRotation = player.rotation.yaw;
    }
  }, [player.position.x, player.position.y, player.position.z, player.rotation.yaw, player.userId, playersRefs]);

  return (
    <group ref={meshRef} position={[player.position.x, player.position.y, player.position.z]}>
      {avatarClone && (
        <primitive 
          object={avatarClone} 
          scale={0.01}
          position={[0, -0.9, 0]}
        />
      )}

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
  if (players.size === 0) return null;

  console.log('[MultiplayerPlayers] Rendering', players.size, 'other players');

  return (
    <SharedAssetsLoader>
      {(assets) => (
        <PlayersController players={players} fbx={assets.fbx} walkClip={assets.walkClip} />
      )}
    </SharedAssetsLoader>
  );
}
