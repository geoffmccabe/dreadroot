import React, { useRef, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

interface FirstPersonArmsProps {
  isGunEquipped: boolean;
}

export function FirstPersonArms({ isGunEquipped }: FirstPersonArmsProps) {
  const groupRef = useRef<THREE.Group>(null);
  const gunRef = useRef<THREE.Group>(null);
  const { camera } = useThree();
  
  // Animation state
  const animationRef = useRef({
    targetY: 0,
    currentY: -0.5, // Start hidden below
    velocity: 0,
  });

  useEffect(() => {
    // Set target based on gun state
    animationRef.current.targetY = isGunEquipped ? 0 : -0.5;
  }, [isGunEquipped]);

  useFrame((_, delta) => {
    if (!groupRef.current) return;

    // Smooth animation for equipping/holstering
    const anim = animationRef.current;
    const diff = anim.targetY - anim.currentY;
    anim.velocity += diff * 10 * delta;
    anim.velocity *= 0.85; // Damping
    anim.currentY += anim.velocity;

    // Position relative to camera
    const cameraDirection = new THREE.Vector3();
    camera.getWorldDirection(cameraDirection);
    
    const cameraRight = new THREE.Vector3();
    cameraRight.crossVectors(cameraDirection, camera.up).normalize();
    
    const cameraUp = new THREE.Vector3();
    cameraUp.crossVectors(cameraRight, cameraDirection).normalize();

    // Position arms in front and slightly down-right from camera
    groupRef.current.position.copy(camera.position);
    groupRef.current.position.add(cameraDirection.clone().multiplyScalar(0.4)); // Forward
    groupRef.current.position.add(cameraRight.clone().multiplyScalar(0.25)); // Right
    groupRef.current.position.add(cameraUp.clone().multiplyScalar(-0.25 + anim.currentY)); // Down + animation

    // Match camera rotation
    groupRef.current.quaternion.copy(camera.quaternion);

    // Slight sway based on movement for immersion
    if (gunRef.current) {
      const time = performance.now() * 0.001;
      gunRef.current.rotation.z = Math.sin(time * 2) * 0.02;
      gunRef.current.rotation.x = Math.sin(time * 1.5) * 0.01;
    }
  });

  // Don't render if gun is fully hidden
  if (animationRef.current.currentY < -0.45 && !isGunEquipped) {
    return null;
  }

  return (
    <group ref={groupRef}>
      <group ref={gunRef}>
        {/* Simple arm representation */}
        <mesh position={[0, -0.05, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.025, 0.03, 0.25, 8]} />
          <meshStandardMaterial color="#d4a574" roughness={0.8} />
        </mesh>
        
        {/* Hand */}
        <mesh position={[0, -0.02, 0.08]}>
          <sphereGeometry args={[0.035, 8, 8]} />
          <meshStandardMaterial color="#d4a574" roughness={0.8} />
        </mesh>

        {/* Pistol body */}
        <group position={[0, 0.02, 0.15]}>
          {/* Main barrel */}
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <boxGeometry args={[0.03, 0.15, 0.04]} />
            <meshStandardMaterial color="#2a2a2a" metalness={0.8} roughness={0.3} />
          </mesh>
          
          {/* Slide */}
          <mesh position={[0, 0.015, 0.02]} rotation={[Math.PI / 2, 0, 0]}>
            <boxGeometry args={[0.028, 0.12, 0.025]} />
            <meshStandardMaterial color="#3a3a3a" metalness={0.9} roughness={0.2} />
          </mesh>
          
          {/* Grip */}
          <mesh position={[0, -0.04, -0.04]} rotation={[0.3, 0, 0]}>
            <boxGeometry args={[0.025, 0.08, 0.035]} />
            <meshStandardMaterial color="#1a1a1a" roughness={0.9} />
          </mesh>
          
          {/* Trigger guard */}
          <mesh position={[0, -0.02, 0]}>
            <torusGeometry args={[0.015, 0.003, 8, 16, Math.PI]} />
            <meshStandardMaterial color="#2a2a2a" metalness={0.7} roughness={0.4} />
          </mesh>
        </group>
      </group>
    </group>
  );
}
