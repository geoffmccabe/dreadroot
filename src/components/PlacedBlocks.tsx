import React, { useRef } from 'react';
import { useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import { usePlacedBlocks } from '@/hooks/usePlacedBlocks';

// Fortress Block component
function FortressBlock({ position }: { position: [number, number, number] }) {
  const meshRef = useRef<THREE.Mesh>(null);
  
  // Load cliff texture for consistency with fortress
  const cliffTexture = useLoader(THREE.TextureLoader, '/cliff_texture_seamless.webp');
  cliffTexture.wrapS = THREE.RepeatWrapping;
  cliffTexture.wrapT = THREE.RepeatWrapping;
  cliffTexture.repeat.set(1, 1);

  return (
    <mesh ref={meshRef} position={position} castShadow receiveShadow>
      <boxGeometry args={[1, 1, 1]} />
      <meshLambertMaterial map={cliffTexture} />
    </mesh>
  );
}

// Component to render all placed blocks
export const PlacedBlocks: React.FC = () => {
  const { blocks } = usePlacedBlocks();

  return (
    <>
      {blocks.map((block) => (
        <FortressBlock
          key={block.id}
          position={[block.position_x, block.position_y, block.position_z]}
        />
      ))}
    </>
  );
};