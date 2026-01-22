import React, { useRef, useMemo, useEffect, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { PlacedBlock, BlockType } from '@/types/blocks';
import { useAnimatedTexture } from '@/hooks/useAnimatedTexture';
import { fallingBlocksState } from './PlacedBlocks';
import { diagnostics } from '@/lib/diagnosticsLogger';
import { frameLoop } from '@/lib/frameLoop';

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

// B2.1: Shared EdgesGeometry for ownership outlines - prevents creating new geometry per block
const sharedEdgesGeometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));

// B2.2: Threshold for auto-enabling performance mode per group
const AUTO_PERFORMANCE_MODE_THRESHOLD = 1000;

interface InstancedBlockGroupProps {
  blocks: PlacedBlock[];
  blockDef: BlockType;
  geometry: THREE.BoxGeometry;
  onCollision?: (box: THREE.Box3, blockId: string) => void;
  showOwnershipOutline?: boolean;
  currentUserId?: string;
  hoveredBlockId?: string | null;
  onMeshReady?: (mesh: THREE.InstancedMesh | null) => void;
  performanceMode?: boolean;
  // Optional texture URL override - used for tree blocks with per-seed textures
  textureOverride?: string;
}

export const InstancedBlockGroup: React.FC<InstancedBlockGroupProps> = ({
  blocks,
  blockDef,
  geometry,
  onCollision,
  showOwnershipOutline = false,
  currentUserId,
  hoveredBlockId = null,
  onMeshReady,
  performanceMode = false,
  textureOverride
}) => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const materialRef = useRef<THREE.Material | null>(null);
  const hasIncrementedRef = useRef(false);
  const { camera } = useThree();
  const outlineMaterialRef = useRef<THREE.LineBasicMaterial | null>(null);
  const hoveredMaterialRef = useRef<THREE.Material | null>(null);
  const timeRef = useRef(0);
  const hoverTimeRef = useRef(0);

  // B2.2: Auto-disable expensive FX when block count is high
  const effectivePerformanceMode = performanceMode || blocks.length > AUTO_PERFORMANCE_MODE_THRESHOLD;
  const fxEnabled = !effectivePerformanceMode;
  const effectiveShowOwnershipOutline = fxEnabled && showOwnershipOutline;
  const effectiveHoveredBlockId = fxEnabled ? hoveredBlockId : null;
  
  // Create outline material once
  if (!outlineMaterialRef.current) {
    outlineMaterialRef.current = new THREE.LineBasicMaterial({ 
      color: new THREE.Color(1, 0, 0),
      linewidth: 2 
    });
  }
  
  // Reuse matrix to avoid garbage collection
  const matrixRef = useRef(new THREE.Matrix4());
  
  // Use textureOverride if provided (for tree blocks), otherwise use blockDef texture
  const textureUrl = textureOverride || blockDef?.texture?.diffuse || '/cliff_texture_seamless.webp';
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
      // Don't use vertexColors - it causes issues with instanced meshes
      // Branch depth lightening is applied via instanceColor in useEffect
      newMaterial = new THREE.MeshLambertMaterial(materialProps);
    }
    
    materialRef.current = newMaterial;
    return newMaterial;
  }, [texture, blockDef, cachedIsAnimated, textureOverride]);

  // Cleanup material on unmount
  useEffect(() => {
    return () => {
      if (materialRef.current) {
        materialRef.current.dispose();
        materialRef.current = null;
      }
    };
  }, []);
  
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
  
  // B2.4: Track last processed signature to skip redundant matrix rebuilds
  const lastProcessedSignatureRef = useRef<string>('');
  
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    
    // B2.4: Build cheap signature to detect actual content changes
    // Uses count + first/last block IDs + positions as a fast fingerprint
    let sig: string;
    if (blocks.length === 0) {
      sig = 'empty';
    } else {
      const first = blocks[0];
      const last = blocks[blocks.length - 1];
      sig = `${blocks.length}:${first.id}:${first.position_x},${first.position_y},${first.position_z}:${last.id}:${last.position_x},${last.position_y},${last.position_z}`;
    }
    
    // Skip rebuild if signature unchanged (array reference changed but content same)
    if (sig === lastProcessedSignatureRef.current) {
      // Still update mesh count in case it's out of sync
      mesh.count = blocks.length;
      return;
    }
    lastProcessedSignatureRef.current = sig;
    
    // IMPORTANT: Always update the mesh count to match blocks array
    mesh.count = blocks.length;
    
    const matrix = matrixRef.current;
    
    // Compute bounding box with numeric min/max - NO allocations per block
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      const x = block.position_x;
      const y = block.position_y;
      const z = block.position_z;
      
      // Instance matrix (centered)
      matrix.setPosition(x + 0.5, y + 0.5, z + 0.5);
      mesh.setMatrixAt(i, matrix);
      
      // Bounds tracking (no Vector3 allocations)
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x + 1 > maxX) maxX = x + 1;
      if (y + 1 > maxY) maxY = y + 1;
      if (z + 1 > maxZ) maxZ = z + 1;
    }
    
    mesh.instanceMatrix.needsUpdate = true;
    
    // Apply branch depth lightening for tree blocks via instance colors
    // This works WITHOUT vertexColors on material - Three.js applies instanceColor as tint
    // OPTIMIZATION: Reuse existing instanceColor attribute if possible to avoid flashing
    if (textureOverride && blocks.length > 0) {
      let colorAttr = mesh.instanceColor as THREE.InstancedBufferAttribute | null;
      
      // Only create new attribute if needed (size changed or doesn't exist)
      if (!colorAttr || colorAttr.count < blocks.length) {
        // Allocate with some extra capacity to reduce reallocations
        const capacity = Math.max(blocks.length, 64);
        const colorArray = new Float32Array(capacity * 3);
        colorAttr = new THREE.InstancedBufferAttribute(colorArray, 3);
        colorAttr.setUsage(THREE.DynamicDrawUsage);
        mesh.instanceColor = colorAttr;
      }
      
      const tempColor = new THREE.Color();
      
      for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        const depth = (block as any).branch_depth ?? -1;
        
        // Calculate lightening factor: trunk(-1)=1.0, depth0=1.1, depth1=1.2, etc.
        const lightenFactor = 1.0 + Math.max(0, depth + 1) * 0.12;
        const factor = Math.min(lightenFactor, 1.5);
        tempColor.setRGB(factor, factor, factor);
        colorAttr.setXYZ(i, factor, factor, factor);
      }
      
      colorAttr.needsUpdate = true;
    }
    
    // Set bounding box/sphere on the MESH for proper frustum culling
    if (blocks.length > 0) {
      mesh.boundingBox ??= new THREE.Box3();
      mesh.boundingSphere ??= new THREE.Sphere();
      
      mesh.boundingBox.min.set(minX, minY, minZ);
      mesh.boundingBox.max.set(maxX, maxY, maxZ);
      mesh.boundingBox.getBoundingSphere(mesh.boundingSphere);
    }
  }, [blocks, textureOverride]);
  
  // Update falling block positions every frame (direct matrix updates, no React re-renders)
  // Also track which blocks were falling so we can reset them when they land
  const previouslyFallingRef = useRef<Set<string>>(new Set());
  // Reuse Set to avoid GC pressure - clear and refill instead of creating new
  const currentlyFallingRef = useRef<Set<string>>(new Set());
  
  // Create block ID to index map for O(1) lookups instead of O(n) findIndex
  const blockIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    blocks.forEach((block, index) => {
      map.set(block.id, index);
    });
    return map;
  }, [blocks]);
  
  useFrame((_, delta) => {
    
    if (!meshRef.current) return;
    
    // Update visible blocks count for diagnostics
    diagnostics.visibleBlocks = blocks.length;
    
    let needsUpdate = false;
    const matrix = matrixRef.current;
    
    // Reuse Set instead of creating new one every frame
    const currentlyFalling = currentlyFallingRef.current;
    currentlyFalling.clear();
    
    // Update positions for falling blocks - O(1) lookup per block
    fallingBlocksState.forEach((fallState, blockId) => {
      const blockIndex = blockIndexMap.get(blockId);
      if (blockIndex === undefined) return;
      
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
        const blockIndex = blockIndexMap.get(blockId);
        if (blockIndex !== undefined) {
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
    
    // Swap Sets instead of copying (no allocation)
    const temp = previouslyFallingRef.current;
    previouslyFallingRef.current = currentlyFallingRef.current;
    currentlyFallingRef.current = temp;
    
    if (needsUpdate) {
      meshRef.current.instanceMatrix.needsUpdate = true;
    }
    
    // Animate outline color: red -> orange -> bright yellow -> back
    if (effectiveShowOwnershipOutline && outlineMaterialRef.current) {
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
  // REMOVED: O(n log n) sort + join - use blocks array reference instead
  const blockIdsForCollision = useMemo(() => 
    blocks.map(b => b.id).join(','), // Simple join without sort - O(n)
    [blocks]
  );
  
  useEffect(() => {
    if (!onCollision) return;
    
    // Clear stale collision data by passing null for removed blocks
    // The parent component should handle cleanup based on current block ids
    
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
  }, [blockIdsForCollision, onCollision]);
  
  // Filter blocks owned by current user for outline rendering (must be before early returns)
  // B2.1: Cap outlines to prevent performance death with many owned blocks (trees)
  const MAX_OWNERSHIP_OUTLINES = 200;
  
  const ownedBlocks = useMemo(() => {
    if (!effectiveShowOwnershipOutline || !currentUserId) return [];
    
    const owned = blocks.filter(block => block.user_id === currentUserId);
    
    // If too many owned blocks, only show nearest to camera for performance
    if (owned.length > MAX_OWNERSHIP_OUTLINES) {
      const cam = camera.position;
      
      // Single-pass top-K selection (same pattern as glow)
      const best: { b: PlacedBlock; d2: number }[] = [];
      
      for (const block of owned) {
        const dx = block.position_x + 0.5 - cam.x;
        const dy = block.position_y + 0.5 - cam.y;
        const dz = block.position_z + 0.5 - cam.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        
        if (best.length < MAX_OWNERSHIP_OUTLINES) {
          best.push({ b: block, d2 });
          continue;
        }
        
        // Find worst and replace if better
        let worstIdx = 0;
        let worstD2 = best[0].d2;
        for (let j = 1; j < best.length; j++) {
          if (best[j].d2 > worstD2) { worstD2 = best[j].d2; worstIdx = j; }
        }
        if (d2 < worstD2) best[worstIdx] = { b: block, d2 };
      }
      
      return best.map(x => x.b);
    }
    
    return owned;
  }, [blocks, effectiveShowOwnershipOutline, currentUserId, camera]);
  
  // Find the hovered block
  const hoveredBlock = useMemo(() => {
    if (!effectiveHoveredBlockId) return null;
    return blocks.find(block => block.id === effectiveHoveredBlockId);
  }, [blocks, effectiveHoveredBlockId]);
  
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
  const shouldGlow = fxEnabled && blockDef?.properties?.emissive && glowFactor > 0;
  
  // Track camera position for glow updates - only update when camera moves significantly
  const lastGlowCameraPos = useRef(new THREE.Vector3());
  const [glowUpdateTrigger, setGlowUpdateTrigger] = useState(0);
  
  // Stable loop id for this instanced group - uses blockDef.key and textureOverride
  const glowLoopId = useMemo(
    () => `glow-check:${blockDef.key}:${textureOverride ?? ''}`,
    [blockDef.key, textureOverride]
  );

  // Check camera movement via frameLoop - only trigger glow recalc when moved 5+ units
  useEffect(() => {
    if (!shouldGlow) return;

    let accMs = 0;

    const unregister = frameLoop.register(
      glowLoopId,
      (delta) => {
        accMs += delta * 1000;
        if (accMs < 500) return;
        accMs = 0;

        const distMoved = camera.position.distanceToSquared(lastGlowCameraPos.current);
        if (distMoved > 25) {
          lastGlowCameraPos.current.copy(camera.position);
          setGlowUpdateTrigger(v => v + 1);
        }
      },
      80
    );

    return () => {
      unregister();
    };
  }, [shouldGlow, glowLoopId, camera]);
  
  // B2.3: Limit point lights to nearest MAX_GLOW_LIGHTS blocks for performance
  // OPTIMIZATION: Single-pass "top K" selection instead of sort (O(n) vs O(n log n))
  // Safety cap: Skip glow entirely for very large groups
  const MAX_GLOW_LIGHTS = 8; // B2.3: Cap dynamic lights
  const MAX_GLOW_DISTANCE = 50;
  const GLOW_BLOCK_LIMIT = 2000; // Skip glow for groups larger than this
  
  const glowingBlocks = useMemo(() => {
    if (!shouldGlow) return [];
    if (blocks.length > GLOW_BLOCK_LIMIT) return []; // Safety cap for large groups
    
    const cam = lastGlowCameraPos.current;
    const maxDistSq = MAX_GLOW_DISTANCE * MAX_GLOW_DISTANCE;
    
    // Single-pass top-K selection (no sort, no allocations per block)
    const best: { b: PlacedBlock; d2: number }[] = [];
    
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const dx = b.position_x + 0.5 - cam.x;
      const dy = b.position_y + 0.5 - cam.y;
      const dz = b.position_z + 0.5 - cam.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      
      if (d2 > maxDistSq) continue;
      
      if (best.length < MAX_GLOW_LIGHTS) {
        best.push({ b, d2 });
        continue;
      }
      
      // Find worst in best array and replace if current is better
      let worstIdx = 0;
      let worstD2 = best[0].d2;
      for (let j = 1; j < best.length; j++) {
        if (best[j].d2 > worstD2) { worstD2 = best[j].d2; worstIdx = j; }
      }
      if (d2 < worstD2) best[worstIdx] = { b, d2 };
    }
    
    return best.map(x => x.b);
  }, [blocks, shouldGlow, glowUpdateTrigger]);
  
  if (!material) return null;
  
  // Pre-allocate buffer for more blocks to avoid remounting when blocks are added
  // Use MAX of current blocks.length + 50 or 100 to handle growth
  const bufferSize = Math.max(blocks.length + 50, 100);

  return (
    <>
      <instancedMesh
        ref={meshRef}
        args={[geometry, material, bufferSize]}
        castShadow={fxEnabled}
        receiveShadow={fxEnabled}
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
      {/* Render animated outlines for owned blocks - B2.1: use shared EdgesGeometry */}
      {effectiveShowOwnershipOutline && outlineMaterialRef.current && ownedBlocks.map((block) => {
        const fallState = fallingBlocksState.get(block.id);
        const x = block.position_x + 0.5;
        const y = (fallState ? fallState.currentY : block.position_y) + 0.5;
        const z = block.position_z + 0.5;
        
        return (
          <lineSegments key={`outline-${block.id}`} position={[x, y, z]}>
            <primitive object={sharedEdgesGeometry} attach="geometry" />
            <primitive object={outlineMaterialRef.current} attach="material" />
          </lineSegments>
        );
      })}
    </>
  );
};
