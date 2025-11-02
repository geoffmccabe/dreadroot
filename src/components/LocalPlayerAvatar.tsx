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
  
  const { camera } = useThree();
  const fbx = useFBX('/y-bot.fbx');
  const walkAnim = useFBX('/Unarmed_Walk_Forward.fbx');

  // Configure avatar materials, shadows, and animations
  useEffect(() => {
    if (!fbx) {
      console.log('LocalPlayerAvatar: FBX not loaded yet');
      return;
    }
    
    console.log('LocalPlayerAvatar: Configuring avatar for shadows', fbx);
    let meshCount = 0;
    fbx.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        meshCount++;
        child.castShadow = true;
        child.receiveShadow = false;
        console.log('LocalPlayerAvatar: Configured mesh', child.name, 'for shadows');
        if (child.material) {
          const material = child.material as THREE.MeshStandardMaterial;
          material.color.set('#4a9eff'); // Blue for local player
        }
      }
    });
    console.log('LocalPlayerAvatar: Total meshes configured:', meshCount);

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
    const clone = fbx.clone();
    // Ensure shadows are enabled on clone
    clone.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = false;
      }
    });
    return clone;
  }, [fbx]);

  // Follow camera and update animations
  useFrame((_, delta) => {
    if (!groupRef.current) return;
    
    // Position avatar slightly behind and below the camera so it's out of view
    // but close enough to cast a shadow where the player is
    const cameraDirection = new THREE.Vector3();
    camera.getWorldDirection(cameraDirection);
    
    groupRef.current.position.set(
      camera.position.x - cameraDirection.x * 0.3, // Slightly behind camera
      camera.position.y - 1.7, // At ground level (camera is at 1.8m, avatar is ~1.8m tall)
      camera.position.z - cameraDirection.z * 0.3
    );

    // Rotate avatar to match camera yaw (not pitch)
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
      {/* Debug sphere - should always cast shadow */}
      <mesh position={[0, 0.9, 0]} castShadow>
        <sphereGeometry args={[0.3]} />
        <meshStandardMaterial color="red" />
      </mesh>
      
      {/* 3D Avatar Model */}
      {avatarClone && (
        <primitive 
          object={avatarClone} 
          scale={0.018}
          position={[0, 0, 0]}
        />
      )}
    </group>
  );
}
