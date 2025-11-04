import React, { useRef, useMemo, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { PlacedBlock, BlockType } from '@/types/blocks';
import { useAnimatedTexture } from '@/hooks/useAnimatedTexture';
import { fallingBlocksState } from './PlacedBlocks';

// Global texture cache - shared across all instanced groups
const textureCache = new Map<string, { 
  texture: THREE.Texture; 
  isAnimated: boolean; 
  updateFn?: (delta: number) => void;
  refCount: number;
}>();

// Track which textures need frame updates
export const activeAnimatedTextures = new Map<string, (delta: number) => void>();

// Function to clear texture cache
export const clearTextureCache = () => {
  textureCache.forEach(({ texture }) => texture.dispose());
  textureCache.clear();
  activeAnimatedTextures.clear();
};

// Helper to get base color from block definition
const getBaseColor = (blockDef: BlockType): THREE.Color => {
  return blockDef?.properties?.color 
    ? new THREE.Color(blockDef.properties.color) 
    : new THREE.Color(0xcccccc);
};

interface InstancedBlockGroupProps {
  blocks: PlacedBlock[];
  blockDef: BlockType;
  geometry: THREE.BoxGeometry;
  onCollision?: (box: THREE.Box3, blockId: string) => void;
  showOwnershipOutline?: boolean;
  currentUserId?: string;
}

export const InstancedBlockGroup: React.FC<InstancedBlockGroupProps> = ({
  blocks,
  blockDef,
  geometry,
  onCollision,
  showOwnershipOutline = false,
  currentUserId
}) => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const materialRef = useRef<THREE.Material | null>(null);
  const hasIncrementedRef = useRef(false);
  const { camera } = useThree();
  
  // Reuse matrix to avoid garbage collection
  const matrixRef = useRef(new THREE.Matrix4());
  
  const textureUrl = blockDef?.texture?.diffuse || '/cliff_texture_seamless.webp';
  const { texture: loadedTexture, updateTexture, isAnimated } = useAnimatedTexture(textureUrl);
  
  // Get or cache the texture
  const cachedTextureData = useMemo(() => {
    if (!loadedTexture) return null;
    
    if (textureCache.has(textureUrl)) {
      const cached = textureCache.get(textureUrl)!;
      if (!hasIncrementedRef.current) {
        cached.refCount++;
        hasIncrementedRef.current = true;
      }
      return cached;
    }
    
    loadedTexture.wrapS = THREE.RepeatWrapping;
    loadedTexture.wrapT = THREE.RepeatWrapping;
    loadedTexture.repeat.set(1, 1);
    loadedTexture.offset.set(0, 0);
    
    const cached = { 
      texture: loadedTexture, 
      isAnimated, 
      updateFn: updateTexture,
      refCount: 1 
    };
    textureCache.set(textureUrl, cached);
    hasIncrementedRef.current = true;
    
    return cached;
  }, [loadedTexture, textureUrl, isAnimated, updateTexture]);
  
  const texture = cachedTextureData?.texture || null;
  const cachedIsAnimated = cachedTextureData?.isAnimated || false;
  
  useEffect(() => {
    if (cachedTextureData?.isAnimated && cachedTextureData.updateFn && textureUrl) {
      activeAnimatedTextures.set(textureUrl, cachedTextureData.updateFn);
    }
  }, [cachedTextureData, textureUrl]);
  
  // Cleanup: Decrement ref count when component unmounts
  useEffect(() => {
    return () => {
      if (!textureUrl) return;
      
      const cached = textureCache.get(textureUrl);
      if (cached) {
        cached.refCount--;
        
        if (cached.refCount <= 0) {
          cached.texture.dispose();
          textureCache.delete(textureUrl);
          activeAnimatedTextures.delete(textureUrl);
        }
      }
    };
  }, [textureUrl]);
  
  // Create material based on block properties
  const material = useMemo(() => {
    if (materialRef.current) {
      materialRef.current.dispose();
      materialRef.current = null;
    }

    if (!texture || !blockDef) return null;
    
    const materialProps: any = {
      map: texture,
    };
    
  if (blockDef.key !== 'grass_block') {
    const baseColor = getBaseColor(blockDef);
    
    if (cachedIsAnimated) {
      const lightTint = new THREE.Color(0xffffff).lerp(baseColor, 0.3);
      materialProps.color = lightTint;
    } else {
      materialProps.color = baseColor;
    }
  }
    
    let newMaterial: THREE.Material;
    
    if (blockDef.properties?.transparent) {
      const baseColor = getBaseColor(blockDef);
      newMaterial = new THREE.MeshPhysicalMaterial({
        map: texture,
        color: baseColor,
        transparent: true,
        opacity: 0.6,
        transmission: 0.5,
        thickness: 0.5,
        roughness: 0.1,
        metalness: 0.2,
        clearcoat: 1.0,
        clearcoatRoughness: 0.1,
        ior: 1.5,
        reflectivity: 0.7,
        envMapIntensity: 1.2,
      });
    } else if (blockDef.properties?.emissive) {
      // Use MeshStandardMaterial with emissiveMap for glowing blocks
      // This makes the texture glow in its own colors, not washed out
      newMaterial = new THREE.MeshStandardMaterial({
        map: texture,
        color: new THREE.Color(0xffffff), // Let texture show through naturally
        emissiveMap: texture, // Use texture for glow color
        emissive: new THREE.Color(0xffffff), // Base emissive color
        emissiveIntensity: 0.4, // Brightness of self-illumination
        roughness: 0.8,
        metalness: 0.1,
      });
    } else {
      newMaterial = new THREE.MeshLambertMaterial(materialProps);
    }
    
    materialRef.current = newMaterial;
    return newMaterial;
  }, [texture, blockDef, cachedIsAnimated]);

  // Cleanup material on unmount
  useEffect(() => {
    return () => {
      if (materialRef.current) {
        materialRef.current.dispose();
        materialRef.current = null;
      }
    };
  }, []);
  
  // Set up instance matrices and compute bounding box
  const prevBlocksLengthRef = useRef<number>(0);
  
  useEffect(() => {
    if (!meshRef.current) return;
    
    // Skip GPU re-upload if block count hasn't changed (just a state update from falling block landing)
    if (prevBlocksLengthRef.current === blocks.length && prevBlocksLengthRef.current > 0) {
      return;
    }
    
    prevBlocksLengthRef.current = blocks.length;
    
    const matrix = matrixRef.current;
    const boundingBox = new THREE.Box3();
    
    blocks.forEach((block, i) => {
      const fallState = fallingBlocksState.get(block.id);
      // Add 0.5 offset because Three.js positions by center, database stores corner
      const x = block.position_x + 0.5;
      // Use fallState currentY if falling, otherwise use database position
      const y = (fallState ? fallState.currentY : block.position_y) + 0.5;
      const z = block.position_z + 0.5;
      
      matrix.setPosition(x, y, z);
      meshRef.current!.setMatrixAt(i, matrix);
      
      // Expand bounding box to include this block (1x1x1 cube)
      boundingBox.expandByPoint(new THREE.Vector3(x - 0.5, y - 0.5, z - 0.5));
      boundingBox.expandByPoint(new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5));
    });
    
    meshRef.current.instanceMatrix.needsUpdate = true;
    
    // Set bounding box/sphere on the MESH (not geometry) for proper frustum culling
    // This tells Three.js the bounds of ALL instances combined
    if (!meshRef.current.boundingBox) {
      meshRef.current.boundingBox = new THREE.Box3();
    }
    if (!meshRef.current.boundingSphere) {
      meshRef.current.boundingSphere = new THREE.Sphere();
    }
    meshRef.current.boundingBox.copy(boundingBox);
    boundingBox.getBoundingSphere(meshRef.current.boundingSphere);
  }, [blocks]);
  
  // Update ONLY falling block positions every frame (skip static blocks for performance)
  useFrame(() => {
    if (!meshRef.current || fallingBlocksState.size === 0) return;
    
    let needsUpdate = false;
    const matrix = matrixRef.current;
    
    blocks.forEach((block, i) => {
      const fallState = fallingBlocksState.get(block.id);
      
      // ONLY update if this block is currently falling
      if (fallState) {
        const x = block.position_x + 0.5;
        const y = fallState.currentY + 0.5;
        const z = block.position_z + 0.5;
        
        matrix.setPosition(x, y, z);
        meshRef.current!.setMatrixAt(i, matrix);
        needsUpdate = true;
      }
    });
    
    if (needsUpdate) {
      meshRef.current.instanceMatrix.needsUpdate = true;
    }
  });
  
  // Create collision boxes for all instances (only when blocks change, not on every frame)
  useEffect(() => {
    if (!onCollision) return;
    
    blocks.forEach(block => {
      const fallState = fallingBlocksState.get(block.id);
      // Use fallState currentY if falling, otherwise use database position
      const y = fallState ? fallState.currentY : block.position_y;
      
      const box = new THREE.Box3(
        new THREE.Vector3(
          block.position_x,
          y,
          block.position_z
        ),
        new THREE.Vector3(
          block.position_x + 1,
          y + 1,
          block.position_z + 1
        )
      );
      onCollision(box, block.id);
    });
  }, [blocks, onCollision]);
  
  // Filter blocks owned by current user for outline rendering (must be before early returns)
  const ownedBlocks = useMemo(() => {
    if (!showOwnershipOutline || !currentUserId) return [];
    return blocks.filter(block => block.user_id === currentUserId);
  }, [blocks, showOwnershipOutline, currentUserId]);

  // Get glow properties
  const glowFactor = blockDef?.properties?.glowFactor || 0;
  const shouldGlow = blockDef?.properties?.emissive && glowFactor > 0;
  
  // Limit point lights to nearest 10 blocks for performance
  // With 100+ blocks, too many point lights destroy FPS
  const glowingBlocks = useMemo(() => {
    if (!shouldGlow) return [];
    const seenIds = new Set<string>();
    const uniqueBlocks = blocks.filter(block => {
      if (seenIds.has(block.id)) return false;
      seenIds.add(block.id);
      return true;
    });
    
    // Calculate distance from camera to each block's center
    const blocksWithDistance = uniqueBlocks.map(block => {
      const blockCenter = new THREE.Vector3(
        block.position_x + 0.5,
        block.position_y + 0.5,
        block.position_z + 0.5
      );
      const distance = camera.position.distanceTo(blockCenter);
      return { block, distance };
    });
    
    // Sort by distance (nearest first) and take the 10 closest
    return blocksWithDistance
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 10)
      .map(item => item.block);
  }, [blocks, shouldGlow, camera.position]);
  
  if (!material) return null;

  return (
    <>
      <instancedMesh
        ref={meshRef}
        args={[geometry, material, blocks.length]}
        castShadow
        receiveShadow
        frustumCulled={true}
      />
      {glowingBlocks.map((block) => (
        <pointLight
          key={block.id}
          position={[block.position_x + 0.5, block.position_y + 0.5, block.position_z + 0.5]}
          color={blockDef?.properties?.color || '#FFE135'}
          intensity={glowFactor * 2}
          distance={glowFactor * 3}
          decay={2}
        />
      ))}
      {/* Render red outlines for owned blocks */}
      {showOwnershipOutline && ownedBlocks.map((block) => {
        const fallState = fallingBlocksState.get(block.id);
        const x = block.position_x + 0.5;
        const y = (fallState ? fallState.currentY : block.position_y) + 0.5;
        const z = block.position_z + 0.5;
        
        return (
          <lineSegments key={`outline-${block.id}`} position={[x, y, z]}>
            <edgesGeometry args={[geometry]} />
            <lineBasicMaterial color="#ff0000" linewidth={2} />
          </lineSegments>
        );
      })}
    </>
  );
};
