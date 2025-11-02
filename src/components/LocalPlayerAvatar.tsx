import React, { useRef, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useFBX } from '@react-three/drei';

export function LocalPlayerAvatar() {
  const groupRef = useRef<THREE.Group>(null);
  const cloneRef = useRef<THREE.Group | null>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const actionsRef = useRef<{ [key: string]: THREE.AnimationAction | null }>({});
  const currentActionRef = useRef<string>('idle');
  const lastPositionRef = useRef(new THREE.Vector3());
  
  const { camera } = useThree();
  const fbx = useFBX('/y-bot.fbx');
  const walkAnim = useFBX('/Unarmed_Walk_Forward.fbx');

  // Create clone once and configure it
  useEffect(() => {
    if (!fbx || cloneRef.current) return;
    
    // Clone the model
    const clone = fbx.clone();
    cloneRef.current = clone;
    
    // Configure materials and shadows on the clone
    clone.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        if (child.material) {
          const material = (child.material as THREE.MeshStandardMaterial).clone();
          material.color.set('#4a9eff');
          child.material = material;
        }
      }
    });

    // Setup animation mixer
    mixerRef.current = new THREE.AnimationMixer(clone);
    
    // Load walk animation
    if (walkAnim?.animations.length > 0) {
      const walkAction = mixerRef.current.clipAction(walkAnim.animations[0]);
      walkAction.play();
      actionsRef.current.walk = walkAction;
    }

    return () => {
      mixerRef.current?.stopAllAction();
      cloneRef.current = null;
    };
  }, [fbx, walkAnim]);

  // Follow camera and update animations
  useFrame((_, delta) => {
    if (!groupRef.current) return;
    
    // Position avatar behind and below camera
    const cameraDirection = new THREE.Vector3();
    camera.getWorldDirection(cameraDirection);
    
    groupRef.current.position.set(
      camera.position.x - cameraDirection.x * 0.3,
      camera.position.y - 1.7,
      camera.position.z - cameraDirection.z * 0.3
    );

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
      {cloneRef.current && (
        <primitive 
          object={cloneRef.current} 
          scale={0.018}
          position={[0, 0, 0]}
        />
      )}
    </group>
  );
}
