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
  refCount: number;
}>();

// Function to clear texture cache
export const clearTextureCache = () => {
  textureCache.forEach(({ texture }) => texture.dispose());
  textureCache.clear();
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
  hoveredBlockId?: string | null;
  onMeshReady?: (mesh: THREE.InstancedMesh | null) => void;
}

export const InstancedBlockGroup: React.FC<InstancedBlockGroupProps> = ({
  blocks,
  blockDef,
  geometry,
  onCollision,
  showOwnershipOutline = false,
  currentUserId,
  hoveredBlockId = null,
  onMeshReady
}) => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const materialRef = useRef<THREE.Material | null>(null);
  const hasIncrementedRef = useRef(false);
  const { camera } = useThree();
  const outlineMaterialRef = useRef<THREE.LineBasicMaterial | null>(null);
  const hoveredMaterialRef = useRef<THREE.Material | null>(null);
  const timeRef = useRef(0);
  const hoverTimeRef = useRef(0);
  
  // Create outline material once
  if (!outlineMaterialRef.current) {
    outlineMaterialRef.current = new THREE.LineBasicMaterial({ 
      color: new THREE.Color(1, 0, 0),
      linewidth: 2 
    });
  }
  
  // Reuse matrix to avoid garbage collection
  const matrixRef = useRef(new THREE.Matrix4());
  
  const textureUrl = blockDef?.texture?.diffuse || '/cliff_texture_seamless.webp';
  const { texture: loadedTexture, isAnimated } = useAnimatedTexture(textureUrl);
  
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
      refCount: 1 
    };
    textureCache.set(textureUrl, cached);
    hasIncrementedRef.current = true;
    
    return cached;
  }, [loadedTexture, textureUrl, isAnimated]);
  
  const texture = cachedTextureData?.texture || null;
  const cachedIsAnimated = cachedTextureData?.isAnimated || false;
  
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
  // Track block IDs to detect actual changes (not just count)
  const prevBlockIdsRef = useRef<string>('');
  
  // Notify parent when mesh is ready for raycasting
  useEffect(() => {
    if (meshRef.current && onMeshReady) {
      onMeshReady(meshRef.current);
    }
    return () => {
      if (onMeshReady) {
        onMeshReady(null);
      }
    };
  }, [onMeshReady]);
  
  useEffect(() => {
    if (!meshRef.current) return;
    
    // Create stable key from block IDs to detect actual changes
    const blockIdsKey = blocks.map(b => b.id).sort().join(',');
    
    // IMPORTANT: Always update the mesh count to match blocks array
    // This is needed because the instancedMesh may have been created with a different count
    meshRef.current.count = blocks.length;
    
    // Skip matrix re-upload only if block IDs haven't changed
    if (prevBlockIdsRef.current === blockIdsKey && blocks.length > 0) {
      return;
    }
    
    prevBlockIdsRef.current = blockIdsKey;
    
    const matrix = matrixRef.current;
    const boundingBox = new THREE.Box3();
    
    blocks.forEach((block, i) => {
      // Always use database position for initial matrix setup
      // Falling blocks will be updated in useFrame
      const x = block.position_x + 0.5;
      const y = block.position_y + 0.5;
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
  
  // Update falling block positions every frame (direct matrix updates, no React re-renders)
  // Also track which blocks were falling so we can reset them when they land
  const previouslyFallingRef = useRef<Set<string>>(new Set());
  
  useFrame((_, delta) => {
    if (!meshRef.current) return;
    
    let needsUpdate = false;
    const matrix = matrixRef.current;
    const currentlyFalling = new Set<string>();
    
    // Update positions for falling blocks
    fallingBlocksState.forEach((fallState, blockId) => {
      const blockIndex = blocks.findIndex(b => b.id === blockId);
      if (blockIndex === -1) return;
      
      currentlyFalling.add(blockId);
      
      const block = blocks[blockIndex];
      const x = block.position_x + 0.5;
      const y = fallState.currentY + 0.5;
      const z = block.position_z + 0.5;
      
      matrix.setPosition(x, y, z);
      meshRef.current!.setMatrixAt(blockIndex, matrix);
      needsUpdate = true;
    });
    
    // Reset blocks that were falling but have now landed to their database position
    previouslyFallingRef.current.forEach(blockId => {
      if (!currentlyFalling.has(blockId)) {
        const blockIndex = blocks.findIndex(b => b.id === blockId);
        if (blockIndex !== -1) {
          const block = blocks[blockIndex];
          const x = block.position_x + 0.5;
          const y = block.position_y + 0.5; // Use database position
          const z = block.position_z + 0.5;
          
          matrix.setPosition(x, y, z);
          meshRef.current!.setMatrixAt(blockIndex, matrix);
          needsUpdate = true;
        }
      }
    });
    
    previouslyFallingRef.current = currentlyFalling;
    
    if (needsUpdate) {
      meshRef.current.instanceMatrix.needsUpdate = true;
    }
    
    // Animate outline color: red -> orange -> bright yellow -> back
    if (showOwnershipOutline && outlineMaterialRef.current) {
      timeRef.current += delta;
      // Cycle every 2 seconds (0 to 60 hue in HSL)
      const cycle = (timeRef.current % 2) / 2; // 0 to 1
      const hue = cycle * 60; // 0 (red) to 60 (yellow)
      outlineMaterialRef.current.color.setHSL(hue / 360, 1, 0.5);
    }
    
    // Animate hovered block opacity - double speed (0.5s cycle)
    if (hoveredBlock && hoveredMaterialRef.current) {
      hoverTimeRef.current += delta;
      // Cycle every 0.5 seconds: from full opacity (1) to transparent (0)
      const cycle = (hoverTimeRef.current % 0.5) / 0.5; // 0 to 1
      const opacity = Math.abs(Math.sin(cycle * Math.PI)); // 0 to 1 to 0
      (hoveredMaterialRef.current as THREE.MeshLambertMaterial).opacity = opacity;
    } else {
      hoverTimeRef.current = 0;
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
  
  // Find the hovered block
  const hoveredBlock = useMemo(() => {
    if (!hoveredBlockId) return null;
    return blocks.find(block => block.id === hoveredBlockId);
  }, [blocks, hoveredBlockId]);
  
  // Create transparent material for hovered block
  useEffect(() => {
    if (hoveredBlock && texture) {
      if (hoveredMaterialRef.current) {
        hoveredMaterialRef.current.dispose();
      }
      
      const baseColor = getBaseColor(blockDef);
      hoveredMaterialRef.current = new THREE.MeshLambertMaterial({
        map: texture,
        color: baseColor,
        transparent: true,
        opacity: 0.5
      });
    }
    
    return () => {
      if (hoveredMaterialRef.current) {
        hoveredMaterialRef.current.dispose();
        hoveredMaterialRef.current = null;
      }
    };
  }, [hoveredBlock, texture, blockDef]);

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
  
  // Pre-allocate buffer for more blocks to avoid remounting when blocks are added
  // Use MAX of current blocks.length + 50 or 100 to handle growth
  const bufferSize = Math.max(blocks.length + 50, 100);

  return (
    <>
      <instancedMesh
        ref={meshRef}
        args={[geometry, material, bufferSize]}
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
      {/* Render hovered block with animated opacity */}
      {hoveredBlock && hoveredMaterialRef.current && (
        <mesh
          position={[
            hoveredBlock.position_x + 0.5,
            hoveredBlock.position_y + 0.5,
            hoveredBlock.position_z + 0.5
          ]}
          geometry={geometry}
          material={hoveredMaterialRef.current}
          castShadow
          receiveShadow
        />
      )}
      {/* Render animated outlines for owned blocks */}
      {showOwnershipOutline && outlineMaterialRef.current && ownedBlocks.map((block) => {
        const fallState = fallingBlocksState.get(block.id);
        const x = block.position_x + 0.5;
        const y = (fallState ? fallState.currentY : block.position_y) + 0.5;
        const z = block.position_z + 0.5;
        
        return (
          <lineSegments key={`outline-${block.id}`} position={[x, y, z]}>
            <edgesGeometry args={[geometry]} />
            <primitive object={outlineMaterialRef.current} attach="material" />
          </lineSegments>
        );
      })}
    </>
  );
};
