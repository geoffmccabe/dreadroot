import React, { useRef, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useFBX } from '@react-three/drei';

export function LocalPlayerAvatar() {
  const groupRef = useRef<THREE.Group>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const actionsRef = useRef<{ [key: string]: THREE.AnimationAction | null }>({});
  const currentActionRef = useRef<string>('idle');
  const lastPositionRef = useRef(new THREE.Vector3());
  const [loadError, setLoadError] = React.useState(false);
  
  const { camera } = useThree();
  
  let fbx = null;
  let walkAnim = null;
  
  try {
    fbx = useFBX('/y-bot.fbx');
    walkAnim = useFBX('/Unarmed_Walk_Forward.fbx');
  } catch (error) {
    console.error('Failed to load FBX models for local player:', error);
    if (!loadError) setLoadError(true);
  }

  // Configure avatar materials, shadows, and animations
  useEffect(() => {
    if (!fbx) return;
    
    fbx.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        if (child.material) {
          const material = child.material as THREE.MeshStandardMaterial;
          material.color.set('#4a9eff'); // Blue for local player
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
  }, [fbx, walkAnim]);

  const avatarClone = React.useMemo(() => {
    if (!fbx) return null;
    return fbx.clone();
  }, [fbx]);

  // Follow camera and update animations
  useFrame((_, delta) => {
    if (!groupRef.current) return;
    
    // Position avatar relative to camera (slightly below and in front)
    groupRef.current.position.set(
      camera.position.x,
      camera.position.y - 0.9, // Lower to ground level
      camera.position.z
    );

    // Rotate avatar to match camera yaw (not pitch)
    const cameraDirection = new THREE.Vector3();
    camera.getWorldDirection(cameraDirection);
    const yaw = Math.atan2(cameraDirection.x, cameraDirection.z);
    groupRef.current.rotation.y = yaw;

    // Update animation mixer
    if (mixerRef.current) {
      mixerRef.current.update(delta);
    }

    // Detect movement for animation switching
    const currentPos = camera.position;
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

  return (
    <group ref={groupRef}>
      {/* 3D Avatar Model or fallback capsule */}
      {avatarClone && !loadError ? (
        <primitive 
          object={avatarClone} 
          scale={0.01}
          position={[0, 0, 0]}
        />
      ) : (
        <>
          {/* Fallback: Simple capsule for local player */}
          <mesh position={[0, 0, 0]} castShadow receiveShadow>
            <capsuleGeometry args={[0.3, 1.2, 8, 16]} />
            <meshStandardMaterial color="#4a9eff" />
          </mesh>
          <mesh position={[0, 0.8, 0]} castShadow>
            <sphereGeometry args={[0.2, 16, 16]} />
            <meshStandardMaterial color="#4a9eff" emissive="#4a9eff" emissiveIntensity={0.3} />
          </mesh>
        </>
      )}
    </group>
  );
}
