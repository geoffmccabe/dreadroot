// FruitRenderer - renders fruit spheres with flame plumes on trees
// Uses InstancedMesh with atlas textures for per-tier fruit appearance
// Shows "Press F to Harvest" text above nearest fruit in range

import React, { useRef, useMemo, useEffect, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { TreeFruit } from '@/features/trees/types';
import { FRUIT_CONFIG, getFruitTier } from '@/features/trees/constants';
import { CHUNK_SIZE } from '@/lib/chunkManager';
import type { UniversalFlameRendererHandle } from '@/components/fortress/UniversalFlameRenderer';
import { getGlobalAtlasTexture, isAtlasReady } from '@/hooks/useTextureAtlas';
import { getTreeUVs } from '@/lib/atlasLookup';
import { createAtlasStandardMaterial, createUvOffsetAttribute, setInstanceUvOffset } from '@/lib/atlasMaterial';
import { renderedChunkKeys } from '@/lib/renderedChunks';

interface FruitRendererProps {
  treeFruits: TreeFruit[];
  cameraRef: React.RefObject<THREE.Camera>;
  playerLevel: number;
  universalFlameRef: React.RefObject<UniversalFlameRendererHandle>;
  adminSeeAll?: boolean;
  findClosestFruit?: () => TreeFruit | null;
  /** Chunk data map — used to skip fruits in chunks with no loaded blocks */
  loadedChunksRef?: React.RefObject<Map<string, { blocks: any[] }>>;
}

// Shared geometry (created once)
const SPHERE_GEO = new THREE.SphereGeometry(0.4, 12, 12);

// Fallback material (brown) used before atlas is ready
const FALLBACK_MATERIAL = new THREE.MeshStandardMaterial({
  color: '#cc8833',
  roughness: 0.6,
  metalness: 0.1,
});

// Temp objects to avoid GC in frame loop
const _mat4 = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _color = new THREE.Color();

export const FruitRenderer = React.memo(function FruitRenderer({
  treeFruits,
  cameraRef,
  playerLevel,
  universalFlameRef,
  adminSeeAll = false,
  findClosestFruit,
  loadedChunksRef,
}: FruitRendererProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const uvAttrRef = useRef<THREE.InstancedBufferAttribute | null>(null);
  const activeFlamesRef = useRef<Map<string, string>>(new Map()); // fruitId -> flameId
  const flameInRangeRef = useRef<Set<string>>(new Set()); // fruitIds that had "in harvest range" flames
  const promptGroupRef = useRef<THREE.Group>(null);
  const findClosestFruitRef = useRef(findClosestFruit);
  findClosestFruitRef.current = findClosestFruit;

  // Track atlas readiness
  const [atlasReady, setAtlasReady] = useState(false);

  // Check atlas readiness periodically
  useEffect(() => {
    const checkAtlas = () => {
      if (isAtlasReady()) {
        setAtlasReady(true);
      }
    };
    checkAtlas();
    const interval = setInterval(checkAtlas, 100);
    return () => clearInterval(interval);
  }, []);

  // Visibility range based on player level (admin override = 500 blocks)
  const visibilityRange = useMemo(() => {
    if (adminSeeAll) return 500;
    return FRUIT_CONFIG.BASE_VISIBILITY + Math.floor(playerLevel / FRUIT_CONFIG.VISIBILITY_LEVEL_DIVISOR);
  }, [playerLevel, adminSeeAll]);

  // Max instance count
  const maxCount = FRUIT_CONFIG.MAX_VISIBLE_FRUITS;

  // Create atlas material when ready
  const atlasMaterial = useMemo(() => {
    if (!atlasReady) return null;
    const texture = getGlobalAtlasTexture();
    if (!texture) return null;
    return createAtlasStandardMaterial(texture, { roughness: 0.6, metalness: 0.1 });
  }, [atlasReady]);

  // Set up UV offset attribute when mesh is created
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || !atlasMaterial) return;

    // Assign atlas material
    mesh.material = atlasMaterial;

    // Create UV offset attribute
    uvAttrRef.current = createUvOffsetAttribute(mesh, maxCount);
  }, [atlasMaterial, maxCount]);

  // Clean up flames on unmount
  useEffect(() => {
    return () => {
      const flameRef = universalFlameRef.current;
      if (!flameRef) return;
      for (const flameId of activeFlamesRef.current.values()) {
        flameRef.removeFlame(flameId);
      }
      activeFlamesRef.current.clear();
    };
  }, [universalFlameRef]);

  // Pre-allocated visible buffer to avoid per-frame GC
  const visibleBuf = useRef<Array<{ fruit: TreeFruit; dist: number }>>(
    Array.from({ length: maxCount }, () => ({ fruit: null as any, dist: 0 }))
  );

  useFrame(() => {
    const mesh = meshRef.current;
    const cam = cameraRef.current;
    if (!mesh || !cam) return;

    const camPos = cam.position;
    const range = visibilityRange;
    const rangeSq = range * range;
    const buf = visibleBuf.current;
    const chunksMap = loadedChunksRef?.current;
    const uvAttr = uvAttrRef.current;
    const hasAtlas = atlasReady && uvAttr !== null;

    // Collect visible fruits into pre-allocated buffer
    let visibleCount = 0;

    for (const fruit of treeFruits) {
      // Skip fruits whose host chunk is not RENDERED yet — just loaded into
      // memory isn't enough; otherwise the fruit pops in mid-air before the
      // tree appears around it.
      if (!adminSeeAll) {
        const cx = Math.floor(fruit.position_x / CHUNK_SIZE);
        const cz = Math.floor(fruit.position_z / CHUNK_SIZE);
        if (!renderedChunkKeys.has(`chunk_${cx}_${cz}`)) continue;
      }

      const fx = fruit.position_x + 0.5;
      const fy = fruit.position_y + 0.5;
      const fz = fruit.position_z + 0.5;

      const dx = fx - camPos.x;
      const dy = fy - camPos.y;
      const dz = fz - camPos.z;
      const distSq = dx * dx + dy * dy + dz * dz;

      if (distSq <= rangeSq && visibleCount < maxCount) {
        buf[visibleCount].fruit = fruit;
        buf[visibleCount].dist = Math.sqrt(distSq);
        visibleCount++;
      }
    }

    // Sort only the populated portion (in-place, then use count to bound loops)
    // Simple insertion sort for small N (max 50) — avoids slice allocation
    for (let i = 1; i < visibleCount; i++) {
      const tmp = buf[i];
      let j = i - 1;
      while (j >= 0 && buf[j].dist > tmp.dist) {
        buf[j + 1] = buf[j];
        j--;
      }
      buf[j + 1] = tmp;
    }
    const count = visibleCount;

    // Update instanced mesh
    for (let i = 0; i < count; i++) {
      const { fruit, dist } = buf[i];
      const fx = fruit.position_x + 0.5;
      const fy = fruit.position_y + 0.5;
      const fz = fruit.position_z + 0.5;

      _mat4.makeTranslation(fx, fy, fz);
      mesh.setMatrixAt(i, _mat4);

      // Set UV offset from atlas for this fruit's tier
      if (hasAtlas && uvAttr) {
        const uvs = getTreeUVs(fruit.tier, 'fruit');
        if (uvs) {
          setInstanceUvOffset(uvAttr, i, uvs.uvOffsetX, uvs.uvOffsetY);
        }
      }
    }

    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    if (uvAttr) uvAttr.needsUpdate = true;

    // Update "Press F to Harvest" prompt position
    const promptGroup = promptGroupRef.current;
    if (promptGroup && findClosestFruitRef.current) {
      const closest = findClosestFruitRef.current();
      // Skip phantom/ghost fruit at origin (0,0,0) - known issue
      const isPhantom = closest && closest.position_x === 0 && closest.position_y === 0 && closest.position_z === 0;
      if (closest && !isPhantom) {
        promptGroup.visible = true;
        promptGroup.position.set(
          closest.position_x + 0.5,
          closest.position_y + 1.4, // Above the fruit sphere
          closest.position_z + 0.5
        );
        // Billboard: face camera
        promptGroup.quaternion.copy(cam.quaternion);
      } else {
        promptGroup.visible = false;
      }
    }

    // Manage flames for visible fruits
    const flameRef = universalFlameRef.current;
    if (flameRef) {
      const nowVisibleIds = new Set<string>();

      for (let i = 0; i < count; i++) {
        const { fruit, dist } = buf[i];
        nowVisibleIds.add(fruit.id);

        // Only show flames on closer fruits (50% of range) for performance
        if (dist > range * 0.5) continue;

        const fx = fruit.position_x + 0.5;
        const fy = fruit.position_y + 0.9; // Top of sphere
        const fz = fruit.position_z + 0.5;

        // Check if within harvest range for size boost
        const inHarvestRange = dist <= FRUIT_CONFIG.HARVEST_RANGE;
        const tierDef = getFruitTier(fruit.tier);

        const wasInRange = flameInRangeRef.current.has(fruit.id);
        const needsRecreate = activeFlamesRef.current.has(fruit.id) && wasInRange !== inHarvestRange;

        if (needsRecreate) {
          // Harvest range boundary crossed — recreate flame with new size
          flameRef.removeFlame(activeFlamesRef.current.get(fruit.id)!);
          activeFlamesRef.current.delete(fruit.id);
        }

        if (!activeFlamesRef.current.has(fruit.id)) {
          // Spawn new flame
          const flameId = flameRef.spawnFlame({
            type: 'plume',
            position: new THREE.Vector3(fx, fy, fz),
            colors: [...tierDef.flameColors],
            size: inHarvestRange ? 0.6 : 0.3,
            height: inHarvestRange ? 0.8 : 0.4,
            duration: 999999,
            colorMode: tierDef.flameColorMode,
          });
          activeFlamesRef.current.set(fruit.id, flameId);
        } else {
          // Update position (fruit might have moved if falling)
          const flameId = activeFlamesRef.current.get(fruit.id)!;
          flameRef.updateAttachedPosition(flameId, _pos.set(fx, fy, fz));
        }

        // Track harvest range state for next frame
        if (inHarvestRange) {
          flameInRangeRef.current.add(fruit.id);
        } else {
          flameInRangeRef.current.delete(fruit.id);
        }
      }

      // Remove flames for fruits that left visibility
      for (const [fruitId, flameId] of activeFlamesRef.current) {
        if (!nowVisibleIds.has(fruitId)) {
          flameRef.removeFlame(flameId);
          activeFlamesRef.current.delete(fruitId);
          flameInRangeRef.current.delete(fruitId);
        }
      }

    }
  });

  if (treeFruits.length === 0) return null;

  // Use fallback material until atlas is ready
  const material = atlasMaterial || FALLBACK_MATERIAL;

  return (
    <>
      <instancedMesh
        ref={meshRef}
        args={[SPHERE_GEO, material, maxCount]}
        frustumCulled={false}
      />
      {/* "Press F to Harvest" prompt — HTML overlay, always visible on top */}
      <group ref={promptGroupRef} visible={false}>
        <Html center distanceFactor={8} style={{ pointerEvents: 'none' }}>
          <div style={{
            color: 'white',
            fontSize: '14px',
            fontWeight: 'bold',
            textShadow: '0 0 4px black, 0 0 8px black',
            whiteSpace: 'nowrap',
            userSelect: 'none',
          }}>
            Press F to Harvest
          </div>
        </Html>
      </group>
    </>
  );
});
