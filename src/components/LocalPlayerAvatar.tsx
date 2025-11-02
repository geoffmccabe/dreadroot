import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

export function LocalPlayerAvatar() {
  const groupRef = useRef<THREE.Group>(null);
  const { camera } = useThree();

  // Follow camera position
  useFrame(() => {
    if (!groupRef.current) return;
    
    // Position avatar at player's feet
    const cameraDirection = new THREE.Vector3();
    camera.getWorldDirection(cameraDirection);
    
    groupRef.current.position.set(
      camera.position.x - cameraDirection.x * 0.2,
      camera.position.y - 1.7,
      camera.position.z - cameraDirection.z * 0.2
    );

    // Rotate avatar to match camera yaw
    const yaw = Math.atan2(cameraDirection.x, cameraDirection.z);
    groupRef.current.rotation.y = yaw;
  });

  return (
    <group ref={groupRef}>
      {/* Simple avatar placeholder that casts shadows */}
      <mesh position={[0, 0.9, 0]} castShadow receiveShadow={false}>
        <capsuleGeometry args={[0.3, 1.2, 8, 16]} />
        <meshStandardMaterial color="#4a9eff" />
      </mesh>
    </group>
  );
}
