import React, { useRef, useMemo, useCallback } from 'react';
import { useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import { PlacedBlock } from '@/types/blocks';
import { getBlockByKey } from '@/data/blockRegistry';

// Shared geometry for performance
const SharedBlockGeometry = () => {
  return useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
};

// Memoized individual block component with proper textures
const PlacedBlockComponent = React.memo(({ 
  position, 
  blockType,
  onCollision,
  geometry
}: { 
  position: [number, number, number];
  blockType: string;
  onCollision?: (box: THREE.Box3, blockId: string) => void;
  geometry: THREE.BoxGeometry;
}) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const blockId = useMemo(() => `${position[0]}-${position[1]}-${position[2]}`, [position]);
  
  // Get block definition from registry
  const blockDef = getBlockByKey(blockType);
  
  // Load texture based on block type
  const texture = useLoader(THREE.TextureLoader, blockDef?.texture?.diffuse || '/cliff_texture_seamless.webp');
  
  // Configure texture
  React.useEffect(() => {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1, 1);
  }, [texture]);
  
  // Create material based on block properties
  const material = useMemo(() => {
    const baseColor = blockDef?.properties?.color ? new THREE.Color(blockDef.properties.color) : new THREE.Color(0xcccccc);
    
    const materialProps: any = {
      map: texture,
      color: baseColor
    };
    
    // Handle special properties
    if (blockDef?.properties?.emissive) {
      materialProps.emissive = baseColor;
      materialProps.emissiveIntensity = 0.3;
    }
    
    if (blockDef?.properties?.transparent) {
      materialProps.transparent = true;
      materialProps.opacity = 0.7;
    }
    
    return new THREE.MeshLambertMaterial(materialProps);
  }, [texture, blockDef]);

  // Create collision box only once per block
  React.useEffect(() => {
    if (meshRef.current && onCollision) {
      const box = new THREE.Box3().setFromObject(meshRef.current);
      onCollision(box, blockId);
    }
  }, [blockId, onCollision]);

  // Clean up material when component unmounts
  React.useEffect(() => {
    return () => {
      material.dispose();
    };
  }, [material]);

  return (
    <mesh ref={meshRef} position={position} castShadow receiveShadow geometry={geometry} material={material} />
  );
});

// Component to render all placed blocks with collision detection
export const PlacedBlocks: React.FC<{ 
  blocks: PlacedBlock[]; 
  onCollision?: (boxes: THREE.Box3[]) => void; 
}> = ({ blocks, onCollision }) => {
  const collisionBoxes = useRef<Map<string, THREE.Box3>>(new Map());
  const geometry = SharedBlockGeometry();

  // Debug logging and force re-render when blocks change
  React.useEffect(() => {
    console.log('PlacedBlocks component updated - total blocks:', blocks.length);
    if (blocks.length > 0) {
      console.log('Block types present:', [...new Set(blocks.map(b => b.block_type))]);
      console.log('Block positions:', blocks.map(b => `${b.block_type} at (${b.position_x}, ${b.position_y}, ${b.position_z})`));
    }
  }, [blocks]);

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

  if (!blocks || blocks.length === 0) {
    return null;
  }

  return (
    <>
      {blocks.map((block) => (
        <PlacedBlockComponent
          key={`${block.id}-${block.position_x}-${block.position_y}-${block.position_z}`}
          position={[block.position_x, block.position_y, block.position_z]}
          blockType={block.block_type}
          onCollision={handleBlockCollision}
          geometry={geometry}
        />
      ))}
      <group key={`block-group-${blocks.length}`} />
    </>
  );
};