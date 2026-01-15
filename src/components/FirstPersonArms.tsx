import React, { useRef, useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useFBX } from '@react-three/drei';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

// Pre-allocate reusable vectors OUTSIDE component to prevent GC
const forwardVec = new THREE.Vector3();
const rightVec = new THREE.Vector3();
const upVec = new THREE.Vector3();

import { diagnostics } from '@/lib/diagnosticsLogger';

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
  
  // Animation progress
  const equipProgress = useRef(0);
  const aimProgress = useRef(0);
  
  // Clone and configure model
  const armsModel = useMemo(() => {
    if (!fbx) return null;
    const clone = fbx.clone();
    
    clone.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = false;
        child.receiveShadow = false;
        child.frustumCulled = false; // Prevent culling when close to camera
        if (child.material) {
          const mat = child.material as THREE.MeshStandardMaterial;
          mat.color = new THREE.Color('#4a9eff');
        }
      }
    });
    
    return clone;
  }, [fbx]);
  
  // Load pistol animation
  useEffect(() => {
    if (!armsModel) return;
    
    const mixer = new THREE.AnimationMixer(armsModel);
    mixerRef.current = mixer;
    
    const loader = new FBXLoader();
    loader.load('/Pistol_Walk.fbx', (animFbx) => {
      if (animFbx.animations.length > 0 && mixerRef.current) {
        const action = mixerRef.current.clipAction(animFbx.animations[0]);
        action.setLoop(THREE.LoopRepeat, Infinity);
        action.timeScale = 0; // Freeze at idle pose
        action.play();
      }
    });
    
    return () => { mixer.stopAllAction(); };
  }, [armsModel]);
  
  useFrame((_, delta) => {
    diagnostics.useFrameCallCount++;
    
    if (!groupRef.current) return;
    
    mixerRef.current?.update(delta);
    
    // Smooth animations
    const targetEquip = isGunEquipped ? 1 : 0;
    equipProgress.current += (targetEquip - equipProgress.current) * 6 * delta;
    
    const targetAim = isAiming ? 1 : 0;
    aimProgress.current += (targetAim - aimProgress.current) * 8 * delta;
    
    // FOV zoom when aiming - use damp for smooth exponential easing
    if (camera instanceof THREE.PerspectiveCamera) {
      const targetFov = isAiming ? 50 : 75;
      camera.fov = THREE.MathUtils.damp(camera.fov, targetFov, 8, delta);
      camera.updateProjectionMatrix();
    }
    
    // Get camera vectors - REUSE pre-allocated vectors (no allocations!)
    forwardVec.set(0, 0, -1).applyQuaternion(camera.quaternion);
    rightVec.set(1, 0, 0).applyQuaternion(camera.quaternion);
    upVec.set(0, 1, 0).applyQuaternion(camera.quaternion);
    
    // Position: start below screen, animate up when equipped
    const hideOffset = (1 - equipProgress.current) * 0.5;
    const aimCenterOffset = aimProgress.current * 0.12;
    
    groupRef.current.position.copy(camera.position);
    groupRef.current.position.addScaledVector(forwardVec, 0.4);
    groupRef.current.position.addScaledVector(rightVec, 0.18 - aimCenterOffset);
    groupRef.current.position.addScaledVector(upVec, -0.25 - hideOffset);
    
    // Rotate to face camera direction
    groupRef.current.quaternion.copy(camera.quaternion);
    // Rotate 180 degrees so model faces forward
    groupRef.current.rotateY(Math.PI);
    
    // Subtle sway
    const t = performance.now() * 0.001;
    groupRef.current.rotateZ(Math.sin(t * 1.5) * 0.01);
  });
  
  if (!armsModel) return null;
  
  // The model needs to be offset down so we see arms, not head
  return (
    <group ref={groupRef}>
      <primitive 
        object={armsModel} 
        scale={0.012}
        position={[0, -1.2, 0]} // Push down to show torso/arms
      />
    </group>
  );
}
