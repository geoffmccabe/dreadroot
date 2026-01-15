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
      console.log('✅ Loaded FPS animation:', url);
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
}

export function FirstPersonArms({ isGunEquipped, isAiming = false }: FirstPersonArmsProps) {
  const groupRef = useRef<THREE.Group>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const { camera } = useThree();
  
  // Load the y-bot model
  const fbx = useFBX('/y-bot.fbx');
  
  // Animation values
  const animRef = useRef({
    equipProgress: 0, // 0 = hidden, 1 = visible
    aimProgress: 0,   // 0 = hip fire, 1 = aimed
  });
  
  // Clone model for FPS use
  const armsModel = useMemo(() => {
    if (!fbx) return null;
    const clone = fbx.clone();
    
    clone.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = false;
        child.receiveShadow = false;
        if (child.material) {
          const mat = child.material as THREE.MeshStandardMaterial;
          mat.color = new THREE.Color('#4a9eff');
        }
      }
    });
    
    console.log('✅ FPS arms model loaded');
    return clone;
  }, [fbx]);
  
  // Setup animation
  useEffect(() => {
    if (!armsModel) return;
    
    const mixer = new THREE.AnimationMixer(armsModel);
    mixerRef.current = mixer;
    
    loadFPSAnimation('/Pistol_Walk.fbx').then((clip) => {
      if (clip && mixerRef.current) {
        const action = mixerRef.current.clipAction(clip);
        action.setLoop(THREE.LoopRepeat, Infinity);
        action.timeScale = 0; // Freeze for idle pose
        action.play();
      }
    });
    
    return () => { mixer.stopAllAction(); };
  }, [armsModel]);
  
  useFrame((_, delta) => {
    if (!groupRef.current || !armsModel) return;
    
    // Update mixer
    mixerRef.current?.update(delta);
    
    // Animate equip progress
    const targetEquip = isGunEquipped ? 1 : 0;
    animRef.current.equipProgress += (targetEquip - animRef.current.equipProgress) * 8 * delta;
    
    // Animate aim progress
    const targetAim = isAiming ? 1 : 0;
    animRef.current.aimProgress += (targetAim - animRef.current.aimProgress) * 10 * delta;
    
    // Update camera FOV for aiming
    if (camera instanceof THREE.PerspectiveCamera) {
      const targetFov = isAiming ? 50 : 75;
      camera.fov += (targetFov - camera.fov) * 5 * delta;
      camera.updateProjectionMatrix();
    }
    
    // Calculate position
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    
    const right = new THREE.Vector3();
    right.crossVectors(dir, camera.up).normalize();
    
    const up = new THREE.Vector3();
    up.crossVectors(right, dir).normalize();
    
    // Base position: in front of camera, down and to the right
    const equipOffset = animRef.current.equipProgress;
    const aimOffset = animRef.current.aimProgress;
    
    // When hidden (equipOffset=0), push down. When equipped, bring up.
    const verticalOffset = -0.4 + equipOffset * 0.25;
    // When aiming, center the gun more
    const horizontalOffset = 0.2 - aimOffset * 0.15;
    
    groupRef.current.position.copy(camera.position);
    groupRef.current.position.add(dir.clone().multiplyScalar(0.5));
    groupRef.current.position.add(right.clone().multiplyScalar(horizontalOffset));
    groupRef.current.position.add(up.clone().multiplyScalar(verticalOffset));
    
    // Match camera rotation
    groupRef.current.quaternion.copy(camera.quaternion);
    
    // Subtle bob
    const time = performance.now() * 0.001;
    groupRef.current.rotation.z += Math.sin(time * 2) * 0.008;
  });
  
  // Always render (let animation handle visibility)
  if (!armsModel) return null;
  
  return (
    <group ref={groupRef}>
      <primitive 
        object={armsModel} 
        scale={[0.008, 0.008, 0.008]}
        rotation={[0, Math.PI, 0]}
        position={[0, -0.3, 0]}
      />
    </group>
  );
}
