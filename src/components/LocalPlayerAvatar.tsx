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

  // Clone the FBX for rendering
  const avatarClone = React.useMemo(() => {
    if (!fbx) return null;
    const clone = fbx.clone();
    
    // Debug: Log the FBX hierarchy and scales
    console.log('🤖 FBX Root scale:', fbx.scale);
    fbx.traverse((child) => {
      if (child instanceof THREE.Object3D) {
        console.log(`  - ${child.type} scale:`, child.scale, 'position:', child.position);
      }
    });
    
    // Force scale on ALL objects in the hierarchy
    clone.traverse((child) => {
      if (child instanceof THREE.Object3D && child !== clone) {
        child.scale.set(1, 1, 1); // Reset any baked scaling
      }
    });
    clone.scale.set(0.01, 0.01, 0.01);
    
    return clone;
  }, [fbx]);

  // Configure avatar materials, shadows, and animations on the clone
  useEffect(() => {
    if (!avatarClone) return;
    
    // Configure materials and shadows
    avatarClone.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        if (child.material) {
          const material = child.material as THREE.MeshStandardMaterial;
          material.color.set('#4a9eff'); // Blue for local player
        }
      }
    });

    // Setup animation mixer on the clone
    mixerRef.current = new THREE.AnimationMixer(avatarClone);
    
    // Load walk animation
    if (walkAnim?.animations.length > 0) {
      const walkAction = mixerRef.current.clipAction(walkAnim.animations[0]);
      walkAction.play();
      actionsRef.current.walk = walkAction;
    }

    return () => {
      mixerRef.current?.stopAllAction();
    };
  }, [avatarClone, walkAnim]);

  // Follow camera and update animations
  useFrame((_, delta) => {
    if (!groupRef.current) return;
    
    // Position avatar behind and below camera
    const cameraDirection = new THREE.Vector3();
    camera.getWorldDirection(cameraDirection);
    
    const newX = camera.position.x - cameraDirection.x * 0.3;
    const newY = camera.position.y - 0.9;
    const newZ = camera.position.z - cameraDirection.z * 0.3;
    
    groupRef.current.position.set(newX, newY, newZ);

    // Rotate to match camera yaw
    const yaw = Math.atan2(cameraDirection.x, cameraDirection.z);
    groupRef.current.rotation.y = yaw;

    // Update animations
    if (mixerRef.current) {
      mixerRef.current.update(delta);
    }

    // Detect movement
    const currentPos = camera.position;
    const distanceMoved = currentPos.distanceTo(lastPositionRef.current);
    const isMoving = distanceMoved > 0.01;
    
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
      {avatarClone && (
        <primitive 
          object={avatarClone} 
          position={[0, -0.9, 0]}
        />
      )}
    </group>
  );
}
