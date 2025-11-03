import React, { useRef, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useFBX } from '@react-three/drei';
import { useAvatar } from '@/contexts/AvatarContext';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

export function LocalPlayerAvatar() {
  const groupRef = useRef<THREE.Group>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const actionsRef = useRef<Map<string, THREE.AnimationAction>>(new Map());
  const currentActionRef = useRef<string>('Idle');
  const velocityRef = useRef(new THREE.Vector3());
  const lastPositionRef = useRef(new THREE.Vector3());
  
  const { camera } = useThree();
  const { avatarConfig, currentAnimation } = useAvatar();
  
  const fbx = useFBX(avatarConfig.model);

  // Configure avatar materials and shadows (Effect 1: Cheap operations)
  useEffect(() => {
    if (!fbx) return;
    
    // Ensure camera only renders layer 0 (default)
    camera.layers.set(0);
    
    // Configure materials and shadows - hide from local view but cast shadows
    fbx.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        // Set to layer 1 so it's invisible to the camera (which is on layer 0)
        child.layers.set(1);
        // But enable shadow casting - shadows work across layers
        child.castShadow = true;
        child.receiveShadow = true;
        
        if (child.material) {
          const material = child.material as THREE.MeshStandardMaterial;
          material.color.set(avatarConfig.color);
          // Ensure material can reflect in transparent surfaces
          material.metalness = 0.3;
          material.roughness = 0.7;
        }
      }
    });
  }, [fbx, avatarConfig.color, camera]);

  // Load animations (Effect 2: Expensive operations - only run when animations change)
  useEffect(() => {
    if (!fbx) return;

    // Setup animation mixer
    mixerRef.current = new THREE.AnimationMixer(fbx);
    actionsRef.current.clear();
    
    // Load all animations from config
    const loader = new FBXLoader();
    
    avatarConfig.animations.forEach(animConfig => {
      loader.load(
        animConfig.file,
        (animFBX) => {
          if (animFBX.animations && animFBX.animations.length > 0 && mixerRef.current) {
            const action = mixerRef.current.clipAction(animFBX.animations[0]);
            action.setLoop(animConfig.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
            action.timeScale = animConfig.speed;
            actionsRef.current.set(animConfig.name, action);
            
            // Start idle animation by default
            if (animConfig.trigger === 'idle') {
              action.play();
              currentActionRef.current = animConfig.name;
            }
          }
        },
        undefined,
        (error) => {
          console.warn(`Failed to load animation: ${animConfig.file}`, error);
        }
      );
    });

    return () => {
      mixerRef.current?.stopAllAction();
    };
  }, [fbx, avatarConfig.animations]);

  // Follow camera and update animations with smooth interpolation
  useFrame((_, delta) => {
    if (!groupRef.current) return;
    
    // Calculate camera velocity
    const currentPos = camera.position.clone();
    velocityRef.current.copy(currentPos).sub(lastPositionRef.current);
    
    // Get camera direction for positioning
    const cameraDirection = new THREE.Vector3();
    camera.getWorldDirection(cameraDirection);
    
    // Position avatar exactly with camera (no lerp to avoid desyncing)
    groupRef.current.position.copy(currentPos);

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
    
    // Determine which animation should play based on movement
    let desiredAnimation = currentAnimation;
    
    // Override with movement/idle if using automatic triggers
    const movementAnim = avatarConfig.animations.find(a => a.trigger === 'movement');
    const idleAnim = avatarConfig.animations.find(a => a.trigger === 'idle');
    
    if (isMoving && movementAnim) {
      desiredAnimation = movementAnim.name;
    } else if (!isMoving && idleAnim) {
      desiredAnimation = idleAnim.name;
    }
    
    // Handle animation transitions
    if (desiredAnimation !== currentActionRef.current) {
      const currentAction = actionsRef.current.get(currentActionRef.current);
      const newAction = actionsRef.current.get(desiredAnimation);
      
      if (newAction) {
        const animConfig = avatarConfig.animations.find(a => a.name === desiredAnimation);
        const fadeOutDuration = animConfig?.fadeOutDuration || 0.2;
        const fadeInDuration = animConfig?.fadeInDuration || 0.2;
        
        if (currentAction) {
          currentAction.fadeOut(fadeOutDuration);
        }
        newAction.reset().fadeIn(fadeInDuration).play();
        currentActionRef.current = desiredAnimation;
      }
    }

    lastPositionRef.current.copy(currentPos);
  });

  return (
    <group ref={groupRef} position={[0, -0.9, 0]}>
      {fbx && (
        <primitive 
          object={fbx} 
          scale={[
            avatarConfig.scale * avatarConfig.scaleX,
            avatarConfig.scale * avatarConfig.scaleY,
            avatarConfig.scale * avatarConfig.scaleZ
          ]}
        />
      )}
    </group>
  );
}
