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
      // Use MeshPhysicalMaterial for glass/crystal effect
      return new THREE.MeshPhysicalMaterial({
        color: baseColor,
        transparent: true,
        opacity: 0.7,
        transmission: 0.95, // Higher transmission for more glass-like effect
        thickness: 0.8,
        roughness: 0.05, // Very smooth surface for high reflectivity
        metalness: 0.1, // Slight metalness for more reflective appearance
        clearcoat: 1.0, // Maximum clearcoat for glossy look
        clearcoatRoughness: 0.0, // Perfectly smooth clearcoat
        ior: 1.52, // Index of refraction similar to crystal/glass
        reflectivity: 0.9, // High reflectivity
        envMapIntensity: 1.5, // Enhance environment reflections
        // Don't use texture map for crystal - rely on material properties
      });
    }
    
    return new THREE.MeshLambertMaterial(materialProps);
  }, [texture, blockDef]);

  // Create collision box only once per block - removed onCollision from deps to prevent loop
  React.useEffect(() => {
    if (meshRef.current && onCollision) {
      const box = new THREE.Box3().setFromObject(meshRef.current);
      onCollision(box, blockId);
    }
  }, [blockId]); // Removed onCollision from dependencies to prevent infinite loop

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
    console.log('PlacedBlocks received blocks array:', blocks);
    if (blocks.length > 0) {
      console.log('Block types present:', [...new Set(blocks.map(b => b.block_type))]);
      console.log('Block positions:', blocks.map(b => `${b.block_type} at (${b.position_x}, ${b.position_y}, ${b.position_z})`));
      console.log('Block IDs:', blocks.map(b => b.id));
    }
  }, [blocks]);

  const handleBlockCollision = useCallback((box: THREE.Box3, blockId: string) => {
    collisionBoxes.current.set(blockId, box);
    // Don't call onCollision here - let the effect handle it
  }, []);

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
    
    // Only call onCollision once after cleanup, and only if we have collision boxes
    if (onCollision && collisionBoxes.current.size > 0) {
      onCollision(Array.from(collisionBoxes.current.values()));
    }
  }, [blockIds]); // Remove onCollision from dependencies to prevent infinite loop

  if (!blocks || blocks.length === 0) {
    return null;
  }

  return (
    <>
      {blocks.map((block) => (
        <PlacedBlockComponent
          key={block.id}
          position={[block.position_x + 0.5, block.position_y + 0.5, block.position_z + 0.5]}
          blockType={block.block_type}
          onCollision={handleBlockCollision}
          geometry={geometry}
        />
      ))}
      <group key={`render-trigger-${blocks.length}-${Date.now()}`} />
    </>
  );
};