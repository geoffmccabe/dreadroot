import * as THREE from 'three';
import React, { useEffect, useMemo, useRef } from 'react';
import { useTexture } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { CHUNK_SIZE } from '@/lib/chunkManager';
import { TERRAIN_CONFIG } from '@/lib/terrainGenerator';

// FSZ bounds: 4 chunks wide (64 blocks) x 6 chunks deep (96 blocks)
// Must match values in fortressSafeZone.ts
const FSZ_MIN_X = -32;
const FSZ_MAX_X = 32;
const FSZ_MIN_Z = -64;
const FSZ_MAX_Z = 32;

// Check if a world position is inside the FSZ
const isInFSZ = (worldX: number, worldZ: number): boolean => {
  return worldX >= FSZ_MIN_X && worldX < FSZ_MAX_X &&
         worldZ >= FSZ_MIN_Z && worldZ < FSZ_MAX_Z;
};

// Check if a chunk is partially or fully inside the FSZ
const isChunkInFSZ = (chunkX: number, chunkZ: number): boolean => {
  const baseX = chunkX * CHUNK_SIZE;
  const baseZ = chunkZ * CHUNK_SIZE;
  // Check if any corner of chunk is in FSZ or FSZ is inside chunk
  return baseX < FSZ_MAX_X && baseX + CHUNK_SIZE > FSZ_MIN_X &&
         baseZ < FSZ_MAX_Z && baseZ + CHUNK_SIZE > FSZ_MIN_Z;
};

interface ProceduralGroundProps {
  visibleChunksRef: React.MutableRefObject<Set<string>>;
  renderTrigger: number;
  textureUrl?: string;
  visualDistance?: number;
  cameraRef?: React.RefObject<THREE.Camera>;
}

const SURFACE_Y = TERRAIN_CONFIG.SURFACE_Y;
const LAND_HALF_SIZE = TERRAIN_CONFIG.LAND_HALF_SIZE;

// Extra chunks beyond visual distance rendered as LoD (single block per chunk)
const GROUND_EXTRA_DISTANCE = 4;

// Near ground: individual blocks for chunks within NEAR_DETAIL_RADIUS of camera
// Beyond that, use single scaled block per chunk (LoD) even within visualDistance
const NEAR_DETAIL_RADIUS = 5; // Individual blocks only for closest 5 chunks
const MAX_NEAR_CHUNKS = 121; // 11x11
const MAX_NEAR_INSTANCES = MAX_NEAR_CHUNKS * CHUNK_SIZE * CHUNK_SIZE;

// Far ground: single scaled block per chunk (LoD for rest of visualDistance + extra)
const MAX_FAR_CHUNKS = 2000;

// Total
const MAX_INSTANCES = MAX_NEAR_INSTANCES + MAX_FAR_CHUNKS;

export function ProceduralGround({
  visibleChunksRef,
  renderTrigger,
  textureUrl = '/grass_texture_seamless.webp',
  visualDistance = 4,
  cameraRef,
}: ProceduralGroundProps) {
  const grassTexture = useTexture(textureUrl);
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const temp = useMemo(() => new THREE.Object3D(), []);
  const lastCameraChunkRef = useRef({ x: Infinity, z: Infinity });

  useEffect(() => {
    grassTexture.wrapS = THREE.RepeatWrapping;
    grassTexture.wrapT = THREE.RepeatWrapping;
    grassTexture.anisotropy = 4;
    grassTexture.needsUpdate = true;
  }, [grassTexture]);

  const geometry = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);

  const material = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      map: grassTexture,
      roughness: 1,
      metalness: 0,
    });
  }, [grassTexture]);

  const groundRadius = visualDistance + GROUND_EXTRA_DISTANCE;

  // Distance-based darkening: darkens in bands every 5 chunks from center
  // 100%, 95%, 90%, 85%... down to 50% at edge
  const BAND_SIZE = 5; // chunks per band
  const DARKENING_PER_BAND = 0.05; // 5% darker each band
  const MIN_BRIGHTNESS = 0.5; // floor at 50%
  const EDGE_HIGHLIGHT_BOOST = 0.08; // Chunk edges are 8% lighter

  // Reusable color objects
  const blockColor = useMemo(() => new THREE.Color(), []);
  const farColor = useMemo(() => new THREE.Color(), []);

  /**
   * Calculate base color for a position based on distance from world center.
   * Returns brightness multiplier stepped every 5 chunks:
   * 0-4: 100%, 5-9: 95%, 10-14: 90%, etc. down to 50% minimum.
   */
  const getDistanceBrightness = (chunkX: number, chunkZ: number): number => {
    // Distance from center in chunks (using max of X/Z for consistent square rings)
    const distFromCenter = Math.max(Math.abs(chunkX), Math.abs(chunkZ));

    // Which band are we in? (0-4 = band 0, 5-9 = band 1, etc.)
    const band = Math.floor(distFromCenter / BAND_SIZE);

    // Each band is 5% darker
    const brightness = Math.max(MIN_BRIGHTNESS, 1.0 - (band * DARKENING_PER_BAND));

    return brightness;
  };

  // Rebuild ground instances
  const rebuildGround = (camChunkX: number, camChunkZ: number) => {
    const mesh = meshRef.current;
    if (!mesh) return;

    let instanceIdx = 0;

    // NEAR GROUND: individual blocks for closest chunks only (capped at NEAR_DETAIL_RADIUS)
    const nearRadius = Math.min(visualDistance, NEAR_DETAIL_RADIUS);
    for (let cx = camChunkX - nearRadius; cx <= camChunkX + nearRadius; cx++) {
      for (let cz = camChunkZ - nearRadius; cz <= camChunkZ + nearRadius; cz++) {
        const baseX = cx * CHUNK_SIZE;
        const baseZ = cz * CHUNK_SIZE;

        // Valid range: -800 to 799 (50 full chunks each direction)
        if (baseX + CHUNK_SIZE - 1 < -LAND_HALF_SIZE || baseX >= LAND_HALF_SIZE) continue;
        if (baseZ + CHUNK_SIZE - 1 < -LAND_HALF_SIZE || baseZ >= LAND_HALF_SIZE) continue;

        for (let dx = 0; dx < CHUNK_SIZE; dx++) {
          const worldX = baseX + dx;
          if (worldX < -LAND_HALF_SIZE || worldX >= LAND_HALF_SIZE) continue;

          for (let dz = 0; dz < CHUNK_SIZE; dz++) {
            const worldZ = baseZ + dz;
            if (worldZ < -LAND_HALF_SIZE || worldZ >= LAND_HALF_SIZE) continue;

            if (instanceIdx >= MAX_NEAR_INSTANCES) break;

            temp.position.set(worldX + 0.5, SURFACE_Y + 0.5, worldZ + 0.5);
            temp.scale.set(1, 1, 1);
            temp.updateMatrix();
            mesh.setMatrixAt(instanceIdx, temp.matrix);

            // Calculate base brightness from distance to world center
            const brightness = getDistanceBrightness(cx, cz);

            // Check if this is a chunk edge block
            const isEdgeX = dx === 0 || dx === CHUNK_SIZE - 1;
            const isEdgeZ = dz === 0 || dz === CHUNK_SIZE - 1;

            // Edge blocks are slightly lighter, interior blocks use base brightness
            const finalBrightness = (isEdgeX || isEdgeZ)
              ? Math.min(1.0, brightness + EDGE_HIGHLIGHT_BOOST)
              : brightness;

            // Check if block is in Fortress Safe Zone - make 50% lighter
            if (isInFSZ(worldX, worldZ)) {
              const lighterBrightness = Math.min(1.0, finalBrightness + (1.0 - finalBrightness) * 0.5);
              blockColor.setRGB(lighterBrightness, lighterBrightness, lighterBrightness);
            } else {
              blockColor.setRGB(finalBrightness, finalBrightness, finalBrightness);
            }
            mesh.setColorAt(instanceIdx, blockColor);

            instanceIdx++;
          }
        }
      }
    }

    // FAR GROUND: single scaled block per chunk beyond near detail radius
    // Covers both the rest of visualDistance AND extra distance beyond it
    for (let cx = camChunkX - groundRadius; cx <= camChunkX + groundRadius; cx++) {
      for (let cz = camChunkZ - groundRadius; cz <= camChunkZ + groundRadius; cz++) {
        // Skip near detail chunks (already rendered as individual blocks above)
        const dcx = Math.abs(cx - camChunkX);
        const dcz = Math.abs(cz - camChunkZ);
        if (dcx <= nearRadius && dcz <= nearRadius) continue;

        const baseX = cx * CHUNK_SIZE;
        const baseZ = cz * CHUNK_SIZE;

        // Valid range: -800 to 799 (50 full chunks each direction)
        if (baseX + CHUNK_SIZE - 1 < -LAND_HALF_SIZE || baseX >= LAND_HALF_SIZE) continue;
        if (baseZ + CHUNK_SIZE - 1 < -LAND_HALF_SIZE || baseZ >= LAND_HALF_SIZE) continue;
        if (instanceIdx >= MAX_INSTANCES) break;

        // Place one large block at chunk center, scaled to cover entire chunk
        temp.position.set(
          baseX + CHUNK_SIZE / 2,
          SURFACE_Y + 0.5,
          baseZ + CHUNK_SIZE / 2
        );
        temp.scale.set(CHUNK_SIZE, 1, CHUNK_SIZE);
        temp.updateMatrix();
        mesh.setMatrixAt(instanceIdx, temp.matrix);

        // Distance-based darkening from world center
        const brightness = getDistanceBrightness(cx, cz);

        // Check if chunk is in Fortress Safe Zone
        const chunkInFSZ = isChunkInFSZ(cx, cz);

        // Additional fade for chunks beyond visual distance (LoD fade)
        const distFromCamera = Math.max(dcx, dcz);
        if (distFromCamera <= visualDistance) {
          // Within visual range: use distance-from-center brightness
          if (chunkInFSZ) {
            // FSZ is 50% lighter
            const lighterBrightness = Math.min(1.0, brightness + (1.0 - brightness) * 0.5);
            farColor.setRGB(lighterBrightness, lighterBrightness, lighterBrightness);
          } else {
            farColor.setRGB(brightness, brightness, brightness);
          }
        } else {
          // Beyond visual range: additional fade toward grey
          const lodT = Math.min(1, (distFromCamera - visualDistance) / GROUND_EXTRA_DISTANCE);
          // Blend from distance-darkened color toward muted grey
          const greyTarget = 0.6;
          if (chunkInFSZ) {
            // FSZ is 50% lighter, then fades
            const lighterBrightness = Math.min(1.0, brightness + (1.0 - brightness) * 0.5);
            farColor.setRGB(
              lighterBrightness + lodT * (greyTarget - lighterBrightness),
              lighterBrightness + lodT * (greyTarget - lighterBrightness),
              lighterBrightness + lodT * (greyTarget - lighterBrightness)
            );
          } else {
            farColor.setRGB(
              brightness + lodT * (greyTarget - brightness),
              brightness + lodT * (greyTarget - brightness),
              brightness + lodT * (greyTarget - brightness)
            );
          }
        }
        mesh.setColorAt(instanceIdx, farColor);
        instanceIdx++;
      }
    }

    mesh.count = instanceIdx;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true;
    }
  };

  // Initial build and rebuild on visual distance change
  useEffect(() => {
    const cam = cameraRef?.current;
    const camX = cam ? Math.floor(cam.position.x / CHUNK_SIZE) : 0;
    const camZ = cam ? Math.floor(cam.position.z / CHUNK_SIZE) : 0;
    lastCameraChunkRef.current = { x: camX, z: camZ };
    rebuildGround(camX, camZ);
  }, [renderTrigger, visualDistance]);

  // Track camera movement to rebuild ground when camera changes chunk
  useFrame(() => {
    const cam = cameraRef?.current;
    if (!cam) return;

    const cx = Math.floor(cam.position.x / CHUNK_SIZE);
    const cz = Math.floor(cam.position.z / CHUNK_SIZE);

    if (cx !== lastCameraChunkRef.current.x || cz !== lastCameraChunkRef.current.z) {
      lastCameraChunkRef.current = { x: cx, z: cz };
      rebuildGround(cx, cz);
    }
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, MAX_INSTANCES]}
      frustumCulled={false}
      name="procedural-ground"
    />
  );
}
