import React, { useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useLoader } from '@react-three/fiber';
import * as THREE from 'three';

interface BlockPreviewProps {
  blockType: string;
  visible: boolean;
}

export const BlockPreview: React.FC<BlockPreviewProps> = ({ blockType, visible }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const { camera, raycaster, pointer } = useThree();
  const [previewPosition, setPreviewPosition] = useState<THREE.Vector3>(new THREE.Vector3());
  
  // Load cliff texture for fortress blocks
  const cliffTexture = useLoader(THREE.TextureLoader, '/cliff_texture_seamless.webp');
  cliffTexture.wrapS = THREE.RepeatWrapping;
  cliffTexture.wrapT = THREE.RepeatWrapping;
  cliffTexture.repeat.set(1, 1);

  // Fortress center position for distance calculations
  const fortressCenter = new THREE.Vector3(0, 0, -20);
  
  // Waterfall blocking area - extends infinitely forward from the waterfall
  const waterfallZ = -6; // Waterfall is around z = -6
  const waterfallBlockingWidth = 8; // Block area 8 units wide centered on waterfall

  const isValidPlacement = (position: THREE.Vector3): boolean => {
    // Check distance from fortress (30 meter restriction)
    const distanceToFortress = position.distanceTo(fortressCenter);
    if (distanceToFortress < 30) {
      return false;
    }

    // Check if in front of waterfall (blocking player movement)
    if (Math.abs(position.x) < waterfallBlockingWidth / 2 && position.z > waterfallZ) {
      return false;
    }

    return true;
  };

  useFrame((state) => {
    if (!visible || !meshRef.current) return;

    // Cast ray from camera forward to find placement position
    const direction = new THREE.Vector3(0, 0, -1);
    direction.applyQuaternion(camera.quaternion);
    
    // Set ray from camera position in forward direction
    raycaster.set(camera.position, direction);
    
    // Calculate position 3 units in front of camera at ground level
    const distance = 3;
    const newPosition = camera.position.clone().add(direction.multiplyScalar(distance));
    
    // Snap to voxel grid (1 unit blocks)
    newPosition.x = Math.floor(newPosition.x) + 0.5;
    newPosition.y = Math.max(0.5, Math.floor(newPosition.y + 0.5) + 0.5); // Keep above ground
    newPosition.z = Math.floor(newPosition.z) + 0.5;
    
    setPreviewPosition(newPosition);
    meshRef.current.position.copy(newPosition);
    
    // Change material based on valid placement
    const material = meshRef.current.material as THREE.MeshLambertMaterial;
    const isValid = isValidPlacement(newPosition);
    material.transparent = true;
    material.opacity = 0.5;
    
    if (isValid) {
      material.color.setRGB(1, 1, 1); // White tint for valid placement
    } else {
      material.color.setRGB(1, 0.2, 0.2); // Red tint for invalid placement
    }
  });

  if (!visible) return null;

  return (
    <mesh ref={meshRef} position={previewPosition}>
      <boxGeometry args={[1, 1, 1]} />
      <meshLambertMaterial 
        map={cliffTexture} 
        transparent 
        opacity={0.5}
      />
    </mesh>
  );
};