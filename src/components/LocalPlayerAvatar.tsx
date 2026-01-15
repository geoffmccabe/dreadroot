import React, { useRef, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useFBX } from '@react-three/drei';
import { useAvatar } from '@/contexts/AvatarContext';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// Global animation cache to prevent reloading the same files
const animationCache = new Map<string, THREE.AnimationClip>();

// Universal loader that handles multiple formats
const loadAnimation = async (url: string): Promise<THREE.AnimationClip | null> => {
  // Check cache first
  if (animationCache.has(url)) {
    console.log(`✅ Using cached animation: ${url}`);
    return animationCache.get(url)!;
  }

  console.log(`📥 Loading animation from network: ${url}`);
  
  const extension = url.split('.').pop()?.toLowerCase();
  
  try {
    if (extension === 'fbx') {
      const loader = new FBXLoader();
      const fbx = await new Promise<THREE.Group>((resolve, reject) => {
        loader.load(url, resolve, undefined, reject);
      });
      
      if (fbx.animations && fbx.animations.length > 0) {
        const clip = fbx.animations[0];
        animationCache.set(url, clip);
        console.log(`✅ Cached FBX animation: ${url}`);
        return clip;
      }
    } else if (extension === 'glb' || extension === 'gltf') {
      const loader = new GLTFLoader();
      const gltf = await new Promise<any>((resolve, reject) => {
        loader.load(url, resolve, undefined, reject);
      });
      
      if (gltf.animations && gltf.animations.length > 0) {
        const clip = gltf.animations[0];
        animationCache.set(url, clip);
        console.log(`✅ Cached GLTF animation: ${url}`);
        return clip;
      }
    }
  } catch (error) {
    console.warn(`Failed to load animation: ${url}`, error);
  }
  
  return null;
};

export function LocalPlayerAvatar() {
  const groupRef = useRef<THREE.Group>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const actionsRef = useRef<Map<string, THREE.AnimationAction>>(new Map());
  const currentActionRef = useRef<string>('Idle');
  const velocityRef = useRef(new THREE.Vector3());
  const lastPositionRef = useRef(new THREE.Vector3());
  
  // Reusable Vector3 objects to prevent garbage collection
  const tempVectorRef = useRef(new THREE.Vector3());
  const cameraDirectionRef = useRef(new THREE.Vector3());
  
  // Cache animation lookups
  const movementAnimRef = useRef<string | null>(null);
  const idleAnimRef = useRef<string | null>(null);
  const animationConfigMapRef = useRef(new Map<string, any>());
  
  const { camera } = useThree();
  const { avatarConfig, currentAnimation } = useAvatar();
  
  const fbx = useFBX(avatarConfig.model);

  // Configure avatar materials and shadows (Effect 1: Cheap operations)
  useEffect(() => {
    if (!fbx) return;
    
    // Ensure camera only renders layer 0 (default)
    camera.layers.set(0);
    
    // Configure materials and shadows - visible to camera AND shadow camera
    fbx.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        // Keep on default layer 0 so camera can see it
        child.layers.set(0);
        // Also enable layer 1 for shadow camera (configured in DynamicLighting)
        child.layers.enable(1);
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
    
    // Load all animations using cache
    const loadAnimations = async () => {
      for (const animConfig of avatarConfig.animations) {
        const clip = await loadAnimation(animConfig.file);
        
        if (clip && mixerRef.current) {
          const action = mixerRef.current.clipAction(clip);
          action.setLoop(animConfig.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
          action.timeScale = animConfig.speed;
          actionsRef.current.set(animConfig.name, action);
          
          // Start idle animation by default
          if (animConfig.trigger === 'idle') {
            action.play();
            currentActionRef.current = animConfig.name;
          }
        }
      }
    };
    
    loadAnimations();
    
    // Update animation lookup cache
    const movementAnim = avatarConfig.animations.find(a => a.trigger === 'movement');
    const idleAnim = avatarConfig.animations.find(a => a.trigger === 'idle');
    movementAnimRef.current = movementAnim?.name || null;
    idleAnimRef.current = idleAnim?.name || null;
    
    // Build animation config map for fast lookup
    const configMap = new Map();
    avatarConfig.animations.forEach(config => {
      configMap.set(config.name, config);
    });
    animationConfigMapRef.current = configMap;

    return () => {
      mixerRef.current?.stopAllAction();
    };
  }, [fbx, avatarConfig.animations]);

  // Follow camera and update animations with smooth interpolation
  useFrame((_, delta) => {
    if (!groupRef.current) return;
    
    // Calculate camera velocity using reusable vector
    tempVectorRef.current.copy(camera.position).sub(lastPositionRef.current);
    const speed = tempVectorRef.current.length();
    velocityRef.current.copy(tempVectorRef.current);
    
    // Get camera direction using reusable vector
    camera.getWorldDirection(cameraDirectionRef.current);
    
    // Position avatar exactly with camera (no lerp to avoid desyncing)
    groupRef.current.position.copy(camera.position);

    // Rotate to match camera yaw
    const yaw = Math.atan2(cameraDirectionRef.current.x, cameraDirectionRef.current.z);
    groupRef.current.rotation.y = yaw;

    // Update animations
    if (mixerRef.current) {
      mixerRef.current.update(delta);
    }

    // Detect movement based on velocity
    const isMoving = speed > 0.01;
    
    // Determine which animation should play based on movement
    let desiredAnimation = currentAnimation;
    
    // Override with movement/idle if using automatic triggers (use cached refs)
    if (isMoving && movementAnimRef.current) {
      desiredAnimation = movementAnimRef.current;
    } else if (!isMoving && idleAnimRef.current) {
      desiredAnimation = idleAnimRef.current;
    }
    
    // Handle animation transitions
    if (desiredAnimation !== currentActionRef.current) {
      const currentAction = actionsRef.current.get(currentActionRef.current);
      const newAction = actionsRef.current.get(desiredAnimation);
      
      if (newAction) {
        const animConfig = animationConfigMapRef.current.get(desiredAnimation);
        const fadeOutDuration = animConfig?.fadeOutDuration || 0.2;
        const fadeInDuration = animConfig?.fadeInDuration || 0.2;
        
        if (currentAction) {
          currentAction.fadeOut(fadeOutDuration);
        }
        newAction.reset().fadeIn(fadeInDuration).play();
        currentActionRef.current = desiredAnimation;
      }
    }

    lastPositionRef.current.copy(camera.position);
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
