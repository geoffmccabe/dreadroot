import React, { useRef, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useFBX } from '@react-three/drei';
import { useAvatar } from '@/contexts/AvatarContext';

export function LocalPlayerAvatar() {
  const groupRef = useRef<THREE.Group>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const actionsRef = useRef<{ [key: string]: THREE.AnimationAction | null }>({});
  const currentActionRef = useRef<string>('idle');
  const velocityRef = useRef(new THREE.Vector3());
  const lastPositionRef = useRef(new THREE.Vector3());
  
  const { camera } = useThree();
  const { avatarConfig, currentAnimation } = useAvatar();
  
  const fbx = useFBX(avatarConfig.model);
  
  // Load all animations dynamically
  const animationFiles = avatarConfig.animations.reduce((acc, anim) => {
    acc[anim.name] = anim.file;
    return acc;
  }, {} as Record<string, string>);
  
  // Load animation FBX files
  const loadedAnims = Object.fromEntries(
    Object.entries(animationFiles).map(([name, file]) => [name, useFBX(file)])
  );

  // Configure avatar materials, shadows, and animations
  useEffect(() => {
    if (!fbx) return;
    
    // Configure materials and shadows
    fbx.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        if (child.material) {
          const material = child.material as THREE.MeshStandardMaterial;
          material.color.set(avatarConfig.color);
        }
      }
    });

    // Setup animation mixer
    mixerRef.current = new THREE.AnimationMixer(fbx);
    
    // Load all animations
    avatarConfig.animations.forEach((animConfig) => {
      const animFBX = loadedAnims[animConfig.name];
      if (animFBX?.animations.length > 0) {
        const action = mixerRef.current!.clipAction(animFBX.animations[0]);
        action.setLoop(animConfig.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
        action.timeScale = animConfig.speed;
        actionsRef.current[animConfig.name] = action;
        
        // Start idle animation by default
        if (animConfig.trigger === 'idle') {
          action.play();
          currentActionRef.current = animConfig.name;
        }
      }
    });

    return () => {
      mixerRef.current?.stopAllAction();
    };
  }, [fbx, avatarConfig, loadedAnims]);

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
    const targetX = currentPos.x - cameraDirection.x * Math.abs(avatarConfig.offsetZ);
    const targetY = currentPos.y + avatarConfig.offsetY;
    const targetZ = currentPos.z - cameraDirection.z * Math.abs(avatarConfig.offsetZ);
    
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
    
    // Find appropriate animation based on trigger and state
    let desiredAction = currentAnimation;
    
    // Auto-trigger animations based on movement
    const movementAnim = avatarConfig.animations.find(a => a.trigger === 'movement');
    const idleAnim = avatarConfig.animations.find(a => a.trigger === 'idle');
    
    if (isMoving && movementAnim) {
      desiredAction = movementAnim.name;
    } else if (!isMoving && idleAnim && currentAnimation !== 'manual') {
      desiredAction = idleAnim.name;
    }
    
    // Handle animation transitions
    if (desiredAction !== currentActionRef.current) {
      const currentAction = actionsRef.current[currentActionRef.current];
      const newAction = actionsRef.current[desiredAction];
      
      if (newAction) {
        const animConfig = avatarConfig.animations.find(a => a.name === desiredAction);
        if (animConfig) {
          if (currentAction) {
            currentAction.fadeOut(animConfig.fadeOutDuration);
          }
          newAction.reset().fadeIn(animConfig.fadeInDuration).play();
          currentActionRef.current = desiredAction;
        }
      }
    }

    lastPositionRef.current.copy(currentPos);
  });

  return (
    <group ref={groupRef}>
      {fbx && (
        <primitive 
          object={fbx} 
          scale={avatarConfig.scale}
          position={[avatarConfig.offsetX, 0, 0]}
        />
      )}
    </group>
  );
}
