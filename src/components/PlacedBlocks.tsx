import React, { useRef } from 'react';
import { useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import { usePlacedBlocks } from '@/hooks/usePlacedBlocks';

// Fortress Block component with collision detection
function FortressBlock({ position, onCollision }: { 
  position: [number, number, number];
  onCollision?: (box: THREE.Box3) => void;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  
  // Load cliff texture for consistency with fortress
  const cliffTexture = useLoader(THREE.TextureLoader, '/cliff_texture_seamless.webp');
  cliffTexture.wrapS = THREE.RepeatWrapping;
  cliffTexture.wrapT = THREE.RepeatWrapping;
  cliffTexture.repeat.set(1, 1);

  // Create collision box and register it
  React.useEffect(() => {
    if (meshRef.current && onCollision) {
      const box = new THREE.Box3().setFromObject(meshRef.current);
      onCollision(box);
    }
  }, [position, onCollision]);

  return (
    <mesh ref={meshRef} position={position} castShadow receiveShadow>
      <boxGeometry args={[1, 1, 1]} />
      <meshLambertMaterial map={cliffTexture} />
    </mesh>
  );
}

// Component to render all placed blocks with collision detection
export const PlacedBlocks: React.FC<{ onCollision?: (boxes: THREE.Box3[]) => void }> = ({ onCollision }) => {
  const { blocks } = usePlacedBlocks();
  const collisionBoxes = useRef<THREE.Box3[]>([]);

  const handleBlockCollision = React.useCallback((box: THREE.Box3) => {
    collisionBoxes.current.push(box);
    if (onCollision) {
      onCollision([...collisionBoxes.current]);
    }
  }, [onCollision]);

  // Reset collision boxes when blocks change
  React.useEffect(() => {
    collisionBoxes.current = [];
  }, [blocks]);

  return (
    <>
      {blocks.map((block) => (
        <FortressBlock
          key={block.id}
          position={[block.position_x, block.position_y, block.position_z]}
          onCollision={handleBlockCollision}
        />
      ))}
    </>
  );
};