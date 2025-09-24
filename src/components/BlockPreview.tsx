import React, { useRef, useState, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import { getBlockByKey } from '@/data/blockRegistry';

interface BlockPreviewProps {
  blockType: string;
  visible: boolean;
}

export const BlockPreview: React.FC<BlockPreviewProps> = ({ blockType, visible }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const { camera, raycaster, pointer } = useThree();
  const [previewPosition, setPreviewPosition] = useState<THREE.Vector3>(new THREE.Vector3());
  
  // Get block definition from registry
  const blockDef = useMemo(() => getBlockByKey(blockType), [blockType]);
  
  // Load texture based on block definition
  const textureUrl = blockDef?.texture?.diffuse || '/cliff_texture_seamless.webp';
  const texture = useLoader(THREE.TextureLoader, textureUrl);
  
  // Set up texture properties
  useMemo(() => {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1, 1);
  }, [texture]);

  // Fortress center position for distance calculations
  const fortressCenter = new THREE.Vector3(0, 0, -20);
  
  // Waterfall blocking area - extends infinitely forward from the waterfall
  const waterfallZ = -6; // Waterfall is around z = -6
  const waterfallBlockingWidth = 4; // Block area 4 units wide centered on waterfall

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
    
    // Snap to voxel grid (1 unit blocks) - place ON grid, not between
    newPosition.x = Math.round(newPosition.x);
    newPosition.y = Math.max(0, Math.round(newPosition.y)); // Keep above ground
    newPosition.z = Math.round(newPosition.z);
    
    setPreviewPosition(newPosition);
    meshRef.current.position.copy(newPosition);
    
    // Change material based on valid placement and block properties
    const material = meshRef.current.material as THREE.MeshLambertMaterial;
    const isValid = isValidPlacement(newPosition);
    
    // Base block properties from registry
    const baseColor = blockDef?.properties?.color || '#ffffff';
    const isEmissive = blockDef?.properties?.emissive || false;
    const isTransparent = blockDef?.properties?.transparent || false;
    
    material.transparent = true;
    material.opacity = isTransparent ? 0.5 : 0.7;
    
    if (isValid) {
      material.color.set(baseColor);
      if (isEmissive) {
        material.emissive.set(baseColor);
        material.emissiveIntensity = 0.2;
      } else {
        material.emissive.setRGB(0, 0, 0);
        material.emissiveIntensity = 0;
      }
    } else {
      material.color.setRGB(1, 0.2, 0.2); // Red tint for invalid placement
      material.emissive.setRGB(0.3, 0.1, 0.1); // Add red glow
      material.emissiveIntensity = 0.5;
    }
  });

  if (!visible) return null;

  return (
    <mesh ref={meshRef} position={previewPosition}>
      <boxGeometry args={[1, 1, 1]} />
      <meshLambertMaterial 
        map={texture}
        transparent 
        opacity={blockDef?.properties?.transparent ? 0.5 : 0.7}
        color={blockDef?.properties?.color || '#ffffff'}
        emissive={blockDef?.properties?.emissive ? (blockDef?.properties?.color || '#FFE135') : '#000000'}
        emissiveIntensity={blockDef?.properties?.emissive ? 0.2 : 0}
      />
    </mesh>
  );
};