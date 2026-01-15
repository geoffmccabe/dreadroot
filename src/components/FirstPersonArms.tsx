import React, { useRef, useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useFBX } from '@react-three/drei';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

// Animation cache
const fpsAnimationCache = new Map<string, THREE.AnimationClip>();

const loadFPSAnimation = async (url: string): Promise<THREE.AnimationClip | null> => {
  if (fpsAnimationCache.has(url)) {
    return fpsAnimationCache.get(url)!;
  }
  
  try {
    const loader = new FBXLoader();
    const fbx = await new Promise<THREE.Group>((resolve, reject) => {
      loader.load(url, resolve, undefined, reject);
    });
    
    if (fbx.animations && fbx.animations.length > 0) {
      const clip = fbx.animations[0];
      fpsAnimationCache.set(url, clip);
      return clip;
    }
  } catch (error) {
    console.warn(`Failed to load FPS animation: ${url}`, error);
  }
  
  return null;
};

interface FirstPersonArmsProps {
  isGunEquipped: boolean;
  isAiming?: boolean;
  isShooting?: boolean;
}

/**
 * First-person arms using the y-bot model with Pistol animations.
 * Shows only the arms portion of the model positioned in front of the camera.
 */
export function FirstPersonArms({ isGunEquipped, isAiming = false, isShooting = false }: FirstPersonArmsProps) {
  const groupRef = useRef<THREE.Group>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const currentActionRef = useRef<THREE.AnimationAction | null>(null);
  const { camera } = useThree();
  
  // Load the y-bot model for arms
  const fbx = useFBX('/y-bot.fbx');
  
  // Animation state for smooth equip/holster
  const animStateRef = useRef({
    targetY: -0.8,
    currentY: -0.8,
    velocity: 0,
  });
  
  // Aim state for zoom
  const aimStateRef = useRef({
    targetFov: 75,
    currentFov: 75,
    targetOffsetX: 0.15,
    currentOffsetX: 0.15,
  });
  
  // Clone the model for first-person use
  const armsModel = useMemo(() => {
    if (!fbx) return null;
    const clone = fbx.clone();
    
    // Configure materials for first-person visibility
    clone.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = false;
        child.receiveShadow = false;
        // Make arms slightly smaller for FPS view
        if (child.material) {
          const mat = child.material as THREE.MeshStandardMaterial;
          mat.color = new THREE.Color('#4a9eff');
        }
      }
    });
    
    return clone;
  }, [fbx]);
  
  // Setup animation mixer and load pistol animation
  useEffect(() => {
    if (!armsModel) return;
    
    const mixer = new THREE.AnimationMixer(armsModel);
    mixerRef.current = mixer;
    
    // Load Pistol_Walk animation (standing with pistol held)
    loadFPSAnimation('/Pistol_Walk.fbx').then((clip) => {
      if (clip && mixerRef.current) {
        const action = mixerRef.current.clipAction(clip);
        action.setLoop(THREE.LoopRepeat, Infinity);
        action.timeScale = 0; // Freeze at first frame for idle
        action.play();
        currentActionRef.current = action;
      }
    });
    
    return () => {
      mixer.stopAllAction();
    };
  }, [armsModel]);
  
  // Update animation state
  useEffect(() => {
    animStateRef.current.targetY = isGunEquipped ? 0 : -0.8;
  }, [isGunEquipped]);
  
  // Update aim state
  useEffect(() => {
    if (isAiming) {
      aimStateRef.current.targetFov = 45; // Zoom in
      aimStateRef.current.targetOffsetX = 0; // Center the gun
    } else {
      aimStateRef.current.targetFov = 75;
      aimStateRef.current.targetOffsetX = 0.15; // Offset right
    }
  }, [isAiming]);
  
  useFrame((state, delta) => {
    if (!groupRef.current || !armsModel) return;
    
    // Update animation mixer
    if (mixerRef.current) {
      mixerRef.current.update(delta);
    }
    
    // Smooth equip/holster animation
    const anim = animStateRef.current;
    const diff = anim.targetY - anim.currentY;
    anim.velocity += diff * 12 * delta;
    anim.velocity *= 0.8;
    anim.currentY += anim.velocity;
    
    // Smooth aim animation
    const aim = aimStateRef.current;
    aim.currentFov += (aim.targetFov - aim.currentFov) * 5 * delta;
    aim.currentOffsetX += (aim.targetOffsetX - aim.currentOffsetX) * 8 * delta;
    
    // Update camera FOV for aiming
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.fov = aim.currentFov;
      camera.updateProjectionMatrix();
    }
    
    // Position relative to camera
    const cameraDirection = new THREE.Vector3();
    camera.getWorldDirection(cameraDirection);
    
    const cameraRight = new THREE.Vector3();
    cameraRight.crossVectors(cameraDirection, camera.up).normalize();
    
    const cameraUp = new THREE.Vector3();
    cameraUp.crossVectors(cameraRight, cameraDirection).normalize();
    
    // Position arms in front of camera
    groupRef.current.position.copy(camera.position);
    groupRef.current.position.add(cameraDirection.clone().multiplyScalar(0.3));
    groupRef.current.position.add(cameraRight.clone().multiplyScalar(aim.currentOffsetX));
    groupRef.current.position.add(cameraUp.clone().multiplyScalar(-0.2 + anim.currentY));
    
    // Match camera rotation with slight offset for natural feel
    groupRef.current.quaternion.copy(camera.quaternion);
    
    // Subtle sway for immersion
    const time = performance.now() * 0.001;
    groupRef.current.rotation.z += Math.sin(time * 1.5) * 0.01;
  });
  
  // Don't render if fully hidden
  if (animStateRef.current.currentY < -0.7 && !isGunEquipped) {
    return null;
  }
  
  if (!armsModel) return null;
  
  return (
    <group ref={groupRef}>
      <primitive 
        object={armsModel} 
        scale={[0.004, 0.004, 0.004]} // Smaller scale for FPS view
        rotation={[0, Math.PI, 0]} // Face forward
        position={[0, -0.15, 0]} // Offset down so we see arms, not head
      />
    </group>
  );
}
