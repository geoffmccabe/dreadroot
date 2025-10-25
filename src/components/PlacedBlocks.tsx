import React, { useRef, useMemo, useCallback } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { PlacedBlock, BlockType } from '@/types/blocks';
import { useBlocksData } from '@/hooks/useBlocksData';
import { useAnimatedTexture } from '@/hooks/useAnimatedTexture';

// Global texture cache - shared across all PlacedBlockComponent instances
// Tracks: texture, animation state, update function, and usage count for cleanup
const textureCache = new Map<string, { 
  texture: THREE.Texture; 
  isAnimated: boolean; 
  updateFn?: (delta: number) => void;
  refCount: number; // Track how many blocks are using this texture
}>();

// Global material cache - shared across all PlacedBlockComponent instances
const materialCache = new Map<string, THREE.Material>();

// Track which textures need frame updates (only one entry per unique texture URL)
const activeAnimatedTextures = new Map<string, (delta: number) => void>();

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
  activeAnimatedTextures.clear();
};

// Helper to get base color from block definition
const getBaseColor = (blockDef: any): THREE.Color => {
  return blockDef?.properties?.color 
    ? new THREE.Color(blockDef.properties.color) 
    : new THREE.Color(0xcccccc);
};

// Shared geometry for performance
const SharedBlockGeometry = () => {
  return useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
};

// Individual block component with proper textures
const PlacedBlockComponent = ({ 
  position, 
  blockType,
  onCollision,
  geometry,
  blocksMap
}: { 
  position: [number, number, number];
  blockType: string;
  onCollision?: (box: THREE.Box3, blockId: string) => void;
  geometry: THREE.BoxGeometry;
  blocksMap: Map<string, BlockType>;
}) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const blockId = useMemo(() => `${position[0]}-${position[1]}-${position[2]}`, [position]);
  
  // Get block definition from map passed as prop
  const blockDef = blocksMap.get(blockType);
  
  // Load texture with animated GIF support - using shared texture cache
  const textureUrl = blockDef?.texture?.diffuse || '/cliff_texture_seamless.webp';
  const { texture: loadedTexture, updateTexture, isAnimated } = useAnimatedTexture(textureUrl);
  
  // Get or cache the texture (first block to load creates it, others reuse)
  // Track if we already incremented refCount for this component instance
  const hasIncrementedRef = useRef(false);
  
  const cachedTextureData = useMemo(() => {
    if (!loadedTexture) return null;
    
    // Check if we already have this texture cached
    if (textureCache.has(textureUrl)) {
      const cached = textureCache.get(textureUrl)!;
      
      // Only increment refCount once per component instance
      if (!hasIncrementedRef.current) {
        cached.refCount++;
        hasIncrementedRef.current = true;
      }
      
      return cached;
    }
    
    // Configure texture for first time
    loadedTexture.wrapS = THREE.RepeatWrapping;
    loadedTexture.wrapT = THREE.RepeatWrapping;
    loadedTexture.repeat.set(1, 1);
    loadedTexture.offset.set(0, 0);
    
    // Cache it for future blocks with initial ref count of 1
    const cached = { 
      texture: loadedTexture, 
      isAnimated, 
      updateFn: updateTexture,
      refCount: 1 
    };
    textureCache.set(textureUrl, cached);
    hasIncrementedRef.current = true;
    
    // If animated, register the update function (only once per texture URL)
    if (isAnimated && updateTexture) {
      console.log('🎬 Registering animated texture:', textureUrl);
      activeAnimatedTextures.set(textureUrl, updateTexture);
    }
    
    return cached;
  }, [loadedTexture, textureUrl, isAnimated, updateTexture]);
  
  const texture = cachedTextureData?.texture || null;
  const cachedIsAnimated = cachedTextureData?.isAnimated || false;
  
  // Cleanup: Decrement ref count when component unmounts
  React.useEffect(() => {
    return () => {
      if (!textureUrl) return;
      
      const cached = textureCache.get(textureUrl);
      if (cached) {
        cached.refCount--;
        
        // If no more blocks are using this texture, remove it from cache
        if (cached.refCount <= 0) {
          cached.texture.dispose();
          textureCache.delete(textureUrl);
          activeAnimatedTextures.delete(textureUrl);
        }
      }
    };
  }, [textureUrl]);
  
  // Create material based on block properties with caching
  const material = useMemo(() => {
    if (!texture || !blockDef) return null;
    
    // Don't use cached materials - textures load async and materials need to update
    // Generate cache key for potential future optimization
    const cacheKey = getMaterialCacheKey(
      blockType,
      textureUrl,
      cachedIsAnimated,
      blockDef.properties
    );
    
    const materialProps: any = {
      map: texture,
    };
    
    // Apply different color tinting based on block type
    if (blockType !== 'grass_block') {
      const baseColor = getBaseColor(blockDef);
      
      // For animated GIFs, use a lighter tint (blend between base color and white)
      // This gives a middle ground between full color tint and no tint
      if (cachedIsAnimated) {
        const lightTint = new THREE.Color(0xffffff).lerp(baseColor, 0.3); // 30% of base color, 70% white
        materialProps.color = lightTint;
      } else {
        // Static textures get full color tint
        materialProps.color = baseColor;
        
        // Handle special properties
        if (blockDef.properties?.emissive) {
          materialProps.emissive = baseColor;
          const glowFactor = blockDef.properties.glowFactor || 3.0;
          materialProps.emissiveIntensity = glowFactor * 1.0;
        }
      }
    }
    
    let newMaterial: THREE.Material;
    
    if (blockDef.properties?.transparent) {
      // Use MeshPhysicalMaterial for glass/crystal effect with texture overlay
      const baseColor = getBaseColor(blockDef);
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
    
    // Don't cache materials since textures load async
    return newMaterial;
  }, [texture, blockDef, blockType, cachedIsAnimated, textureUrl]);

  // Use ref to avoid stale closure issues with onCollision callback
  const onCollisionRef = useRef(onCollision);
  React.useEffect(() => {
    onCollisionRef.current = onCollision;
  }, [onCollision]);
  
  // Create collision box only once per block
  React.useEffect(() => {
    if (meshRef.current && onCollisionRef.current) {
      const box = new THREE.Box3().setFromObject(meshRef.current);
      onCollisionRef.current(box, blockId);
    }
  }, [blockId]);

  // Get glow factor for point light (with null check)
  const glowFactor = blockDef?.properties?.glowFactor || 0;
  const shouldGlow = blockDef?.properties?.emissive && glowFactor > 0;

  // Don't render if material isn't ready yet (but keep all hooks called)
  if (!material) return null;

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
};

// Component to render all placed blocks with collision detection
export const PlacedBlocks: React.FC<{ 
  blocks: PlacedBlock[]; 
  onCollision?: (boxes: THREE.Box3[]) => void; 
}> = ({ blocks, onCollision }) => {
  const collisionBoxes = useRef<Map<string, THREE.Box3>>(new Map());
  const geometry = SharedBlockGeometry();
  
  // Ensure block definitions are loaded before rendering any blocks
  const { isLoading: blockDefsLoading, blocksMap } = useBlocksData();
  
  // Single useFrame to update ALL animated textures (called once per frame, not once per block)
  useFrame((state, delta) => {
    if (activeAnimatedTextures.size > 0) {
      activeAnimatedTextures.forEach((updateFn) => {
        updateFn(delta);
      });
    }
  });

  const handleBlockCollision = useCallback((box: THREE.Box3, blockId: string) => {
    collisionBoxes.current.set(blockId, box);
  }, []);

  // Use ref to avoid stale closure with onCollision
  const onCollisionRef = useRef(onCollision);
  React.useEffect(() => {
    onCollisionRef.current = onCollision;
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
    
    // Call onCollision with updated collision boxes
    if (onCollisionRef.current && collisionBoxes.current.size > 0) {
      onCollisionRef.current(Array.from(collisionBoxes.current.values()));
    }
  }, [blockIds]);

  // Don't render blocks until block definitions are loaded
  if (blockDefsLoading || blocks.length === 0) {
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
          blocksMap={blocksMap}
        />
      ))}
    </>
  );
};