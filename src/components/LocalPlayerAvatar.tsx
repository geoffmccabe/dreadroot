import React, { useRef, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useFBX } from '@react-three/drei';

export function LocalPlayerAvatar() {
  const groupRef = useRef<THREE.Group>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const actionsRef = useRef<{ walk: THREE.AnimationAction | null; idle: THREE.AnimationAction | null }>({
    walk: null,
    idle: null,
  });
  const currentActionRef = useRef<string>('idle');
  const velocityRef = useRef(new THREE.Vector3());
  const lastPositionRef = useRef(new THREE.Vector3());
  
  const { camera } = useThree();
  
  const fbx = useFBX('/y-bot.fbx');
  const walkAnim = useFBX('/Unarmed_Walk_Forward.fbx');
  const idleAnim = useFBX('/Sitting_Laughing.fbx');

  // Configure avatar materials, shadows, and animations
  useEffect(() => {
    if (!fbx) return;
    
    // Configure materials and shadows - invisible but casts shadows
    fbx.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = false; // Don't receive shadows to improve performance
        child.visible = false; // Hide from view but keep shadow casting
        if (child.material) {
          const material = child.material as THREE.MeshStandardMaterial;
          material.colorWrite = false; // Don't write color but keep shadow
        }
      }
    });

    // Setup animation mixer
    mixerRef.current = new THREE.AnimationMixer(fbx);
    
    // Load walk animation
    if (walkAnim?.animations.length > 0) {
      const walkAction = mixerRef.current.clipAction(walkAnim.animations[0]);
      walkAction.setLoop(THREE.LoopRepeat, Infinity);
      actionsRef.current.walk = walkAction;
    }
    
    // Load idle animation
    if (idleAnim?.animations.length > 0) {
      const idleAction = mixerRef.current.clipAction(idleAnim.animations[0]);
      idleAction.setLoop(THREE.LoopRepeat, Infinity);
      idleAction.play();
      actionsRef.current.idle = idleAction;
      currentActionRef.current = 'idle';
    }

    return () => {
      mixerRef.current?.stopAllAction();
    };
  }, [fbx, walkAnim, idleAnim]);

  // Follow camera and update animations with smooth interpolation
  useFrame((_, delta) => {
    if (!groupRef.current) return;
    
    // Calculate camera velocity
    const currentPos = camera.position.clone();
    velocityRef.current.copy(currentPos).sub(lastPositionRef.current);
    
    // Get camera direction for positioning
    const cameraDirection = new THREE.Vector3();
    camera.getWorldDirection(cameraDirection);
    
    // Calculate target position (behind and below camera)
    const targetX = currentPos.x;
    const targetY = currentPos.y - 0.9;
    const targetZ = currentPos.z;
    
    // Smoothly interpolate to target position to match camera movement
    groupRef.current.position.lerp(
      new THREE.Vector3(targetX, targetY, targetZ),
      0.3 // Smooth follow factor
    );

    // Rotate to match camera yaw
    const yaw = Math.atan2(cameraDirection.x, cameraDirection.z);
    groupRef.current.rotation.y = yaw;

    // Update animations
    if (mixerRef.current) {
      mixerRef.current.update(delta);
    }

    // Detect movement based on velocity
    const speed = velocityRef.current.length();
    const isMoving = speed > 0.01;
    
    // Handle animation transitions
    const desiredAction = isMoving ? 'walk' : 'idle';
    
    if (desiredAction !== currentActionRef.current) {
      const currentAction = actionsRef.current[currentActionRef.current as 'walk' | 'idle'];
      const newAction = actionsRef.current[desiredAction];
      
      if (currentAction && newAction) {
        currentAction.fadeOut(0.2);
        newAction.reset().fadeIn(0.2).play();
        currentActionRef.current = desiredAction;
      }
    }

    lastPositionRef.current.copy(currentPos);
  });

  return (
    <group ref={groupRef}>
      {fbx && (
        <primitive 
          object={fbx} 
          scale={0.01}
        />
      )}
    </group>
  );
}
