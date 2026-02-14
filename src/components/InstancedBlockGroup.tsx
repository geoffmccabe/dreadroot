import React, { useRef, useMemo, useEffect, useState, useId } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { PlacedBlock, BlockType } from '@/types/blocks';
import { useAnimatedTexture } from '@/hooks/useAnimatedTexture';
import { fallingBlocksState } from './PlacedBlocks';
import { diagnostics } from '@/lib/diagnosticsLogger';
import { frameLoop } from '@/lib/frameLoop';
import { canonicalizeTextureUrl } from '@/lib/renderKeys';

// Global texture cache - shared across all instanced groups
// C3: Cache keyed by CANONICAL texture URL to prevent signed URL churn
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
  showOwnershipOutline = false,
  currentUserId,
  hoveredBlockId = null,
  onMeshReady,
  performanceMode = false,
  textureOverride
}) => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const materialRef = useRef<THREE.Material | null>(null);
  // C3: Track last texture cache key for proper ref counting on texture changes
  const lastTextureCacheKeyRef = useRef<string>('');
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
  
  // C3: Canonical texture cache key - prevents signed URL query param churn
  const textureCacheKey = canonicalizeTextureUrl(textureUrl) || textureUrl;

  // Track previous cache key to detect URL changes (prevents stale texture cross-contamination)
  const prevTextureCacheKeyRef = useRef<string>(textureCacheKey);

  // Get or cache the texture using canonical key
  // IMPORTANT: When textureCacheKey changes (e.g. blockDef loaded with different URL),
  // loadedTexture may still be the OLD texture from useAnimatedTexture's stale state.
  // We must NOT create a cache entry in that case, or the new URL gets mapped to the old texture.
  const cachedTextureData = useMemo(() => {
    if (!loadedTexture) {
      prevTextureCacheKeyRef.current = textureCacheKey;
      return null;
    }

    if (textureCache.has(textureCacheKey)) {
      const cached = textureCache.get(textureCacheKey)!;
      // Don't increment ref here - we handle it in the effect below
      prevTextureCacheKeyRef.current = textureCacheKey;
      return cached;
    }

    // Only create a new cache entry if the cache key hasn't changed since last render.
    // If it DID change, loadedTexture is stale (belongs to the old URL) — return null
    // and wait for useAnimatedTexture to load the correct texture for the new URL.
    if (prevTextureCacheKeyRef.current !== textureCacheKey) {
      prevTextureCacheKeyRef.current = textureCacheKey;
      return null;
    }

    loadedTexture.wrapS = THREE.RepeatWrapping;
    loadedTexture.wrapT = THREE.RepeatWrapping;
    loadedTexture.repeat.set(1, 1);
    loadedTexture.offset.set(0, 0);

    const cached = {
      texture: loadedTexture,
      isAnimated,
      refCount: 0  // Start at 0, effect will increment
    };
    textureCache.set(textureCacheKey, cached);
    prevTextureCacheKeyRef.current = textureCacheKey;

    return cached;
  }, [loadedTexture, textureCacheKey, isAnimated]);
  
  const texture = cachedTextureData?.texture || null;
  const cachedIsAnimated = cachedTextureData?.isAnimated || false;
  
  // C3: Proper ref counting that handles texture URL changes safely
  useEffect(() => {
    if (!textureCacheKey) return;
    
    const cached = textureCache.get(textureCacheKey);
    if (cached) {
      // Increment ref for new/current texture
      cached.refCount++;
      lastTextureCacheKeyRef.current = textureCacheKey;
    }
    
    return () => {
      // Decrement ref for this texture on cleanup or texture change
      const keyToDecrement = lastTextureCacheKeyRef.current;
      if (!keyToDecrement) return;
      
      const cachedToDecrement = textureCache.get(keyToDecrement);
      if (cachedToDecrement) {
        cachedToDecrement.refCount--;
        
        if (cachedToDecrement.refCount <= 0) {
          cachedToDecrement.texture.dispose();
          textureCache.delete(keyToDecrement);
        }
      }
      
      lastTextureCacheKeyRef.current = '';
    };
  }, [textureCacheKey]);
  
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

  // Cleanup material and mesh GPU resources on unmount
  useEffect(() => {
    return () => {
      if (materialRef.current) {
        materialRef.current.dispose();
        diagnostics.recordDispose('material');
        materialRef.current = null;
      }
      // Dispose InstancedMesh GPU buffers (instanceMatrix, instanceColor)
      const mesh = meshRef.current;
      if (mesh) {
        mesh.dispose();
        diagnostics.recordDispose('mesh');
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
  
  // Reference gating: skip rebuild if array ref + texture + material are identical.
  // Safe because PlacedBlocks group cache reuses the same array for unchanged content.
  // NOTE: material is included because when the component first mounts, texture hasn't
  // loaded yet so material is null and the <instancedMesh> doesn't exist. When the
  // texture loads, material becomes non-null and the mesh appears for the first time.
  // Without material in deps, this effect wouldn't re-run to set instance matrices.
  const lastProcessedBlocksRef = useRef<PlacedBlock[] | null>(null);
  const lastProcessedTextureRef = useRef<string | null>(null);
  const lastProcessedMaterialRef = useRef<THREE.Material | null>(null);
  const prevCountRef = useRef(0);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const texId = textureOverride ?? null;
    if (blocks === lastProcessedBlocksRef.current && texId === lastProcessedTextureRef.current && material === lastProcessedMaterialRef.current) {
      return;
    }
    lastProcessedBlocksRef.current = blocks;
    lastProcessedTextureRef.current = texId;
    lastProcessedMaterialRef.current = material;

    const matrix = matrixRef.current;

    // If the array shrank, zero out the old tail to prevent stale instance artifacts
    const prevCount = prevCountRef.current;
    if (prevCount > blocks.length) {
      matrix.makeScale(0, 0, 0);
      for (let i = blocks.length; i < prevCount; i++) {
        mesh.setMatrixAt(i, matrix);
      }
      matrix.identity(); // Reset for the active block loop below
    }

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

    // Set mesh.count AFTER all instance data is written to prevent
    // rendering uninitialized indices for a single frame (flicker).
    mesh.count = blocks.length;
    prevCountRef.current = blocks.length;
  }, [blocks, textureOverride, material]);

  // Update falling block positions every frame (direct matrix updates, no React re-renders)
  // Also track which blocks were falling so we can reset them when they land
  const previouslyFallingRef = useRef<Set<string>>(new Set());
  // Reuse Set to avoid GC pressure - clear and refill instead of creating new
  const currentlyFallingRef = useRef<Set<string>>(new Set());
  
  // B8: Only build index map for FALLING blocks (tiny set), not all blocks
  // This eliminates world-sized Map allocation that was causing GC storms
  const fallingIndexRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    const m = fallingIndexRef.current;
    m.clear();

    // Early exit if nothing is falling
    if (fallingBlocksState.size === 0) return;

    // Build indices only for currently-falling blocks
    const want = new Set<string>();
    for (const id of fallingBlocksState.keys()) want.add(id);

    for (let i = 0; i < blocks.length; i++) {
      const id = blocks[i].id;
      if (want.has(id)) {
        m.set(id, i);
        if (m.size === want.size) break; // Found all falling blocks
      }
    }
  }, [blocks]);
  
  // E1: Migrate from useFrame to centralized frameLoop to eliminate per-group fan-out
  // F4.1: Use DETERMINISTIC loop ID with unique instance ID
  // React's useId() provides stable, unique ID per component instance
  const instanceId = useId();
  const loopId = useMemo(
    () => `instanced-blocks:${instanceId}`,
    [instanceId]
  );
  
  // Store refs for access in frameLoop callback (avoids stale closures)
  const blocksRef = useRef(blocks);
  const effectiveShowOwnershipOutlineRef = useRef(effectiveShowOwnershipOutline);
  const hoveredBlockRef = useRef<PlacedBlock | null>(null); // Initialize as null, updated by effect after hoveredBlock is defined

  useEffect(() => {
    blocksRef.current = blocks;
    effectiveShowOwnershipOutlineRef.current = effectiveShowOwnershipOutline;
  }, [blocks, effectiveShowOwnershipOutline]);
  
  useEffect(() => {
    const unregister = frameLoop.register(loopId, (delta) => {
      if (!meshRef.current) return;

      const currentBlocks = blocksRef.current;

      // D1A: ACCUMULATE visible blocks count (not overwrite)
      // Reset happens once per frame in FortressScene master loop
      diagnostics.visibleBlocks += currentBlocks.length;

      // B8: Early exit if nothing is falling - avoid any work
      if (fallingBlocksState.size === 0 && previouslyFallingRef.current.size === 0) {
        return;
      }

      let needsUpdate = false;
      const matrix = matrixRef.current;
      const fallingIndex = fallingIndexRef.current;

      // Reuse Set instead of creating new one every frame
      const currentlyFalling = currentlyFallingRef.current;
      currentlyFalling.clear();

      // Update positions for falling blocks - O(1) lookup per block
      fallingBlocksState.forEach((fallState, blockId) => {
        const blockIndex = fallingIndex.get(blockId);
        if (blockIndex === undefined) return;

        currentlyFalling.add(blockId);

        const block = currentBlocks[blockIndex];
        if (!block) return;
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
          const blockIndex = fallingIndex.get(blockId);
          if (blockIndex !== undefined) {
            const block = currentBlocks[blockIndex];
            if (!block) return;
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
      if (effectiveShowOwnershipOutlineRef.current && outlineMaterialRef.current) {
        timeRef.current += delta;
        // Cycle every 2 seconds (0 to 60 hue in HSL)
        const cycle = (timeRef.current % 2) / 2; // 0 to 1
        const hue = cycle * 60; // 0 (red) to 60 (yellow)
        outlineMaterialRef.current.color.setHSL(hue / 360, 1, 0.5);
      }
      
      // Animate hovered block opacity - double speed (0.5s cycle)
      if (hoveredBlockRef.current && hoveredMaterialRef.current) {
        hoverTimeRef.current += delta;
        // Cycle every 0.5 seconds: from full opacity (1) to transparent (0)
        const cycle = (hoverTimeRef.current % 0.5) / 0.5; // 0 to 1
        const opacity = Math.abs(Math.sin(cycle * Math.PI)); // 0 to 1 to 0
        (hoveredMaterialRef.current as THREE.MeshLambertMaterial).opacity = opacity;
      } else {
        hoverTimeRef.current = 0;
      }
    }, 60); // Priority 60 - runs after controls (10) but before rendering
    
    return unregister;
  }, [loopId]);
  
  // Collision is fully managed by useChunkLoader (ensureBlockCollider).
  
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
  
  // E1: Update hoveredBlockRef for frameLoop access (defined after hoveredBlock useMemo)
  useEffect(() => {
    hoveredBlockRef.current = hoveredBlock;
  }, [hoveredBlock]);

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
  
  // Track draw call mount/unmount for D-Flow breakdown
  useEffect(() => {
    diagnostics.mountDrawCall('nonTree');
    return () => { diagnostics.unmountDrawCall('nonTree'); };
  }, []);

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
