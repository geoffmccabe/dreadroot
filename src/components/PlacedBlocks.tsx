import React, { useRef, useMemo, useCallback } from 'react';
import { useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import { usePlacedBlocks } from '@/hooks/usePlacedBlocks';

// Shared texture and geometry for performance
const SharedBlockResources = () => {
  const cliffTexture = useLoader(THREE.TextureLoader, '/cliff_texture_seamless.webp');
  cliffTexture.wrapS = THREE.RepeatWrapping;
  cliffTexture.wrapT = THREE.RepeatWrapping;
  cliffTexture.repeat.set(1, 1);
  
  const geometry = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const material = useMemo(() => new THREE.MeshLambertMaterial({ 
    map: cliffTexture, 
    color: 0xcccccc 
  }), [cliffTexture]);
  
  return { geometry, material };
};

// Memoized individual block component
const FortressBlock = React.memo(({ 
  position, 
  onCollision,
  geometry,
  material 
}: { 
  position: [number, number, number];
  onCollision?: (box: THREE.Box3, blockId: string) => void;
  geometry: THREE.BoxGeometry;
  material: THREE.MeshLambertMaterial;
}) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const blockId = useMemo(() => `${position[0]}-${position[1]}-${position[2]}`, [position]);

  // Create collision box only once per block
  React.useEffect(() => {
    if (meshRef.current && onCollision) {
      const box = new THREE.Box3().setFromObject(meshRef.current);
      onCollision(box, blockId);
    }
  }, [blockId, onCollision]);

  return (
    <mesh ref={meshRef} position={position} castShadow receiveShadow geometry={geometry} material={material} />
  );
});

// Component to render all placed blocks with collision detection
export const PlacedBlocks: React.FC<{ onCollision?: (boxes: THREE.Box3[]) => void }> = ({ onCollision }) => {
  const { blocks } = usePlacedBlocks();
  const collisionBoxes = useRef<Map<string, THREE.Box3>>(new Map());
  const { geometry, material } = SharedBlockResources();

  const handleBlockCollision = useCallback((box: THREE.Box3, blockId: string) => {
    collisionBoxes.current.set(blockId, box);
    if (onCollision) {
      onCollision(Array.from(collisionBoxes.current.values()));
    }
  }, [onCollision]);

  // Only update collision boxes when blocks are added/removed
  const blockIds = useMemo(() => new Set(blocks.map(b => b.id)), [blocks]);
  
  React.useEffect(() => {
    // Remove collision boxes for deleted blocks
    const currentBoxIds = Array.from(collisionBoxes.current.keys());
    currentBoxIds.forEach(id => {
      if (!blockIds.has(id)) {
        collisionBoxes.current.delete(id);
      }
    });
    
    if (onCollision) {
      onCollision(Array.from(collisionBoxes.current.values()));
    }
  }, [blockIds, onCollision]);

  // Memoize the blocks list to prevent unnecessary re-renders
  const memoizedBlocks = useMemo(() => blocks, [blocks]);

  return (
    <>
      {memoizedBlocks.map((block) => (
        <FortressBlock
          key={block.id}
          position={[block.position_x, block.position_y, block.position_z]}
          onCollision={handleBlockCollision}
          geometry={geometry}
          material={material}
        />
      ))}
    </>
  );
};