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
        {/* Forearm - positioned back and less visible */}
        <mesh position={[-0.02, -0.08, -0.1]} rotation={[Math.PI / 2.5, 0, 0.1]}>
          <cylinderGeometry args={[0.02, 0.025, 0.2, 8]} />
          <meshStandardMaterial color="#c4956a" roughness={0.8} />
        </mesh>
        
        {/* Hand gripping the gun */}
        <mesh position={[0, -0.02, 0.02]}>
          <boxGeometry args={[0.04, 0.035, 0.05]} />
          <meshStandardMaterial color="#c4956a" roughness={0.8} />
        </mesh>

        {/* Pistol - gunmetal grey */}
        <group position={[0, 0.03, 0.12]}>
          {/* Main barrel/slide */}
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <boxGeometry args={[0.035, 0.18, 0.05]} />
            <meshStandardMaterial color="#3d3d3d" metalness={0.9} roughness={0.25} />
          </mesh>
          
          {/* Top slide detail */}
          <mesh position={[0, 0.02, 0.02]} rotation={[Math.PI / 2, 0, 0]}>
            <boxGeometry args={[0.032, 0.14, 0.02]} />
            <meshStandardMaterial color="#4a4a4a" metalness={0.95} roughness={0.2} />
          </mesh>
          
          {/* Front sight */}
          <mesh position={[0, 0.025, 0.08]}>
            <boxGeometry args={[0.008, 0.01, 0.01]} />
            <meshStandardMaterial color="#2a2a2a" metalness={0.8} roughness={0.3} />
          </mesh>
          
          {/* Rear sight */}
          <mesh position={[0, 0.025, -0.04]}>
            <boxGeometry args={[0.025, 0.012, 0.01]} />
            <meshStandardMaterial color="#2a2a2a" metalness={0.8} roughness={0.3} />
          </mesh>
          
          {/* Grip */}
          <mesh position={[0, -0.045, -0.05]} rotation={[0.25, 0, 0]}>
            <boxGeometry args={[0.032, 0.09, 0.04]} />
            <meshStandardMaterial color="#1a1a1a" roughness={0.95} />
          </mesh>
          
          {/* Trigger guard */}
          <mesh position={[0, -0.025, 0.01]} rotation={[0, 0, Math.PI]}>
            <torusGeometry args={[0.018, 0.004, 8, 12, Math.PI]} />
            <meshStandardMaterial color="#3d3d3d" metalness={0.85} roughness={0.3} />
          </mesh>
          
          {/* Trigger */}
          <mesh position={[0, -0.025, 0.01]}>
            <boxGeometry args={[0.006, 0.02, 0.008]} />
            <meshStandardMaterial color="#2a2a2a" metalness={0.7} roughness={0.4} />
          </mesh>
        </group>
      </group>
    </group>
  );
}
