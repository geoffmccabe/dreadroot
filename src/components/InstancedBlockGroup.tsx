import React, { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
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
}

export const InstancedBlockGroup: React.FC<InstancedBlockGroupProps> = ({
  blocks,
  blockDef,
  geometry,
  onCollision
}) => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const materialRef = useRef<THREE.Material | null>(null);
  const hasIncrementedRef = useRef(false);
  
  // Reuse matrix to avoid garbage collection
  const matrixRef = useRef(new THREE.Matrix4());
  
  // Load texture with animated GIF support
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
  
  // Register animated texture update function
  useEffect(() => {
    if (cachedTextureData?.isAnimated && cachedTextureData.updateFn && textureUrl) {
      console.log('🎬 Registering animated texture:', textureUrl);
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
        
        if (blockDef.properties?.emissive) {
          materialProps.emissive = baseColor;
          const glowFactor = blockDef.properties.glowFactor || 3.0;
          materialProps.emissiveIntensity = glowFactor * 1.0;
        }
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
  useEffect(() => {
    if (!meshRef.current) return;
    
    const matrix = matrixRef.current;
    const boundingBox = new THREE.Box3();
    
    blocks.forEach((block, i) => {
      const fallState = fallingBlocksState.get(block.id);
      // Add 0.5 offset because Three.js positions by center, database stores corner
      const x = block.position_x + 0.5;
      // Use fallState if actively falling (in-memory only), otherwise use database position
      const y = (fallState && !fallState.landed ? fallState.currentY : block.position_y) + 0.5;
      const z = block.position_z + 0.5;
      
      matrix.setPosition(x, y, z);
      meshRef.current!.setMatrixAt(i, matrix);
      
      // Expand bounding box to include this block (1x1x1 cube)
      boundingBox.expandByPoint(new THREE.Vector3(x - 0.5, y - 0.5, z - 0.5));
      boundingBox.expandByPoint(new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5));
    });
    
    meshRef.current.instanceMatrix.needsUpdate = true;
    
    // Set the bounding box and sphere for proper frustum culling
    meshRef.current.geometry.boundingBox = boundingBox;
    meshRef.current.geometry.boundingSphere = new THREE.Sphere();
    boundingBox.getBoundingSphere(meshRef.current.geometry.boundingSphere);
  }, [blocks]);
  
  // Update falling block positions every frame (direct matrix updates, no React re-renders)
  useFrame(() => {
    if (!meshRef.current) return;
    
    let needsUpdate = false;
    const matrix = matrixRef.current;
    
    blocks.forEach((block, i) => {
      const fallState = fallingBlocksState.get(block.id);
      if (fallState && !fallState.landed) {
        // Add 0.5 offset because Three.js positions by center, database stores corner
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
      // Use fallState if actively falling (in-memory only), otherwise use database position
      const y = (fallState && !fallState.landed) ? fallState.currentY : block.position_y;
      
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
  
  // Get glow properties
  const glowFactor = blockDef?.properties?.glowFactor || 0;
  const shouldGlow = blockDef?.properties?.emissive && glowFactor > 0;
  
  // Memoize glowing blocks to prevent re-renders
  const glowingBlocks = useMemo(() => {
    if (!shouldGlow) return [];
    const seenIds = new Set<string>();
    return blocks.filter(block => {
      if (seenIds.has(block.id)) return false;
      seenIds.add(block.id);
      return true;
    });
  }, [blocks, shouldGlow]);
  
  if (!material) return null;

  return (
    <>
      <instancedMesh
        ref={meshRef}
        args={[geometry, material, blocks.length]}
        castShadow
        receiveShadow
        frustumCulled={false}
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
    </>
  );
};
