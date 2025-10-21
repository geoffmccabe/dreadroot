import React, { useRef, useMemo, useCallback } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { PlacedBlock } from '@/types/blocks';
import { useBlocksData } from '@/hooks/useBlocksData';
import { useAnimatedTexture } from '@/hooks/useAnimatedTexture';

// Global texture cache - shared across all PlacedBlockComponent instances
const textureCache = new Map<string, { texture: THREE.Texture; isAnimated: boolean; updateFn?: (delta: number) => void }>();

// Global material cache - shared across all PlacedBlockComponent instances
const materialCache = new Map<string, THREE.Material>();

// Generate unique cache key based on material properties
const getMaterialCacheKey = (
  blockType: string,
  textureUrl: string,
  isAnimated: boolean,
  properties?: {
    color?: string;
    emissive?: boolean;
    transparent?: boolean;
    glowFactor?: number;
  }
): string => {
  return `${blockType}-${textureUrl}-${isAnimated}-${properties?.color || 'default'}-${properties?.emissive || false}-${properties?.transparent || false}-${properties?.glowFactor || 0}`;
};

// Function to clear caches when needed
export const clearMaterialCache = () => {
  materialCache.forEach(material => material.dispose());
  materialCache.clear();
  textureCache.forEach(({ texture }) => texture.dispose());
  textureCache.clear();
};

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
  const { getBlockByKey } = useBlocksData();
  
  // Get block definition from database
  const blockDef = getBlockByKey(blockType);
  
  // Load texture with animated GIF support - using shared texture cache
  const textureUrl = blockDef?.texture?.diffuse || '/cliff_texture_seamless.webp';
  const { texture: loadedTexture, updateTexture, isAnimated } = useAnimatedTexture(textureUrl);
  
  // Get or cache the texture (first block to load creates it, others reuse)
  const cachedTextureData = useMemo(() => {
    if (!loadedTexture) return null;
    
    // Check if we already have this texture cached
    if (textureCache.has(textureUrl)) {
      return textureCache.get(textureUrl)!;
    }
    
    // Configure texture for first time
    loadedTexture.wrapS = THREE.RepeatWrapping;
    loadedTexture.wrapT = THREE.RepeatWrapping;
    loadedTexture.repeat.set(1, 1);
    loadedTexture.offset.set(0, 0);
    
    // Cache it for future blocks
    const cached = { texture: loadedTexture, isAnimated, updateFn: updateTexture };
    textureCache.set(textureUrl, cached);
    return cached;
  }, [loadedTexture, textureUrl, isAnimated, updateTexture]);
  
  const texture = cachedTextureData?.texture || null;
  const cachedUpdateTexture = cachedTextureData?.updateFn;
  const cachedIsAnimated = cachedTextureData?.isAnimated || false;
  
  // Update animated texture on each frame (all blocks sharing the texture will animate in sync)
  useFrame((state, delta) => {
    if (cachedIsAnimated && cachedUpdateTexture) {
      cachedUpdateTexture(delta);
    }
  });
  
  // Create material based on block properties with caching
  const material = useMemo(() => {
    if (!texture) return null;
    
    // Generate cache key (now using cached texture reference)
    const cacheKey = getMaterialCacheKey(
      blockType,
      textureUrl,
      cachedIsAnimated,
      blockDef?.properties
    );
    
    // Check if material already exists in cache
    if (materialCache.has(cacheKey)) {
      return materialCache.get(cacheKey)!;
    }
    
    const materialProps: any = {
      map: texture,
    };
    
    // Apply different color tinting based on block type
    if (blockType !== 'grass_block') {
      const baseColor = blockDef?.properties?.color ? new THREE.Color(blockDef.properties.color) : new THREE.Color(0xcccccc);
      
      // For animated GIFs, use a lighter tint (blend between base color and white)
      // This gives a middle ground between full color tint and no tint
      if (cachedIsAnimated) {
        const lightTint = new THREE.Color(0xffffff).lerp(baseColor, 0.3); // 30% of base color, 70% white
        materialProps.color = lightTint;
      } else {
        // Static textures get full color tint
        materialProps.color = baseColor;
        
        // Handle special properties
        if (blockDef?.properties?.emissive) {
          materialProps.emissive = baseColor;
          const glowFactor = blockDef?.properties?.glowFactor || 3.0;
          materialProps.emissiveIntensity = glowFactor * 1.0;
        }
      }
    }
    
    let newMaterial: THREE.Material;
    
    if (blockDef?.properties?.transparent) {
      // Use MeshPhysicalMaterial for glass/crystal effect with texture overlay
      const baseColor = blockDef?.properties?.color ? new THREE.Color(blockDef.properties.color) : new THREE.Color(0xcccccc);
      newMaterial = new THREE.MeshPhysicalMaterial({
        map: texture, // Apply the texture to the glass surface
        color: baseColor,
        transparent: true,
        opacity: 0.6, // Slightly more opaque to show texture better
        transmission: 0.5, // Reduced transmission so texture is visible
        thickness: 0.5,
        roughness: 0.1, // Slightly rougher to show texture details
        metalness: 0.2, // Some metalness for shine
        clearcoat: 1.0, // Maximum clearcoat for glossy glass effect
        clearcoatRoughness: 0.1, // Smooth clearcoat
        ior: 1.5, // Index of refraction for glass
        reflectivity: 0.7, // Good reflectivity
        envMapIntensity: 1.2, // Environment reflections
        // This creates a "textured glass" effect where the texture appears 
        // printed on/in the glass material while maintaining transparency
      });
    } else {
      newMaterial = new THREE.MeshLambertMaterial(materialProps);
    }
    
    // Store in cache before returning
    materialCache.set(cacheKey, newMaterial);
    
    return newMaterial;
  }, [texture, blockDef, blockType, cachedIsAnimated, textureUrl]);

  // Create collision box only once per block - removed onCollision from deps to prevent loop
  React.useEffect(() => {
    if (meshRef.current && onCollision) {
      const box = new THREE.Box3().setFromObject(meshRef.current);
      onCollision(box, blockId);
    }
  }, [blockId]); // Removed onCollision from dependencies to prevent infinite loop

  if (!material) return null;

  // Get glow factor for point light
  const glowFactor = blockDef?.properties?.glowFactor || 0;
  const shouldGlow = blockDef?.properties?.emissive && glowFactor > 0;

  return (
    <>
      <mesh ref={meshRef} position={position} castShadow receiveShadow geometry={geometry} material={material} />
      {shouldGlow && (
        <pointLight
          position={position}
          color={blockDef?.properties?.color || '#FFE135'}
          intensity={glowFactor * 2}
          distance={glowFactor * 3}
          decay={2}
        />
      )}
    </>
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