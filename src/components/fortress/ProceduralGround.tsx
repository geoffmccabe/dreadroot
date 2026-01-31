import * as THREE from 'three';
import React, { useEffect, useMemo, useRef } from 'react';
import { useTexture } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { CHUNK_SIZE } from '@/lib/chunkManager';
import { TERRAIN_CONFIG } from '@/lib/terrainGenerator';

interface ProceduralGroundProps {
  visibleChunksRef: React.MutableRefObject<Set<string>>;
  renderTrigger: number;
  textureUrl?: string;
  visualDistance?: number;
  cameraRef?: React.RefObject<THREE.Camera>;
}

const SURFACE_Y = TERRAIN_CONFIG.SURFACE_Y;

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

  // Colors for chunk boundary highlighting (dark edge between chunks)
  const NORMAL_COLOR = useMemo(() => new THREE.Color(1, 1, 1), []);
  const EDGE_COLOR = useMemo(() => new THREE.Color(0.85, 0.85, 0.85), []);
  // Reusable color for far ground tinting
  const farColor = useMemo(() => new THREE.Color(), []);

  // Rebuild ground instances
  const rebuildGround = (camChunkX: number, camChunkZ: number) => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const { WORLD_HALF_SIZE } = TERRAIN_CONFIG;
    let instanceIdx = 0;

    // NEAR GROUND: individual blocks for closest chunks only (capped at NEAR_DETAIL_RADIUS)
    const nearRadius = Math.min(visualDistance, NEAR_DETAIL_RADIUS);
    for (let cx = camChunkX - nearRadius; cx <= camChunkX + nearRadius; cx++) {
      for (let cz = camChunkZ - nearRadius; cz <= camChunkZ + nearRadius; cz++) {
        const baseX = cx * CHUNK_SIZE;
        const baseZ = cz * CHUNK_SIZE;

        if (baseX + CHUNK_SIZE - 1 < -WORLD_HALF_SIZE || baseX > WORLD_HALF_SIZE) continue;
        if (baseZ + CHUNK_SIZE - 1 < -WORLD_HALF_SIZE || baseZ > WORLD_HALF_SIZE) continue;

        for (let dx = 0; dx < CHUNK_SIZE; dx++) {
          const worldX = baseX + dx;
          if (worldX < -WORLD_HALF_SIZE || worldX > WORLD_HALF_SIZE) continue;

          for (let dz = 0; dz < CHUNK_SIZE; dz++) {
            const worldZ = baseZ + dz;
            if (worldZ < -WORLD_HALF_SIZE || worldZ > WORLD_HALF_SIZE) continue;

            if (instanceIdx >= MAX_NEAR_INSTANCES) break;

            temp.position.set(worldX + 0.5, SURFACE_Y + 0.5, worldZ + 0.5);
            temp.scale.set(1, 1, 1);
            temp.updateMatrix();
            mesh.setMatrixAt(instanceIdx, temp.matrix);

            const isEdgeX = dx === 0 || dx === CHUNK_SIZE - 1;
            const isEdgeZ = dz === 0 || dz === CHUNK_SIZE - 1;
            mesh.setColorAt(instanceIdx, (isEdgeX || isEdgeZ) ? EDGE_COLOR : NORMAL_COLOR);

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

        if (baseX + CHUNK_SIZE - 1 < -WORLD_HALF_SIZE || baseX > WORLD_HALF_SIZE) continue;
        if (baseZ + CHUNK_SIZE - 1 < -WORLD_HALF_SIZE || baseZ > WORLD_HALF_SIZE) continue;
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

        // Distance-based tinting:
        // Within visualDistance: full green (textured look via color tint)
        // Beyond visualDistance: fade from muted green to light grey
        const dist = Math.max(dcx, dcz); // Chebyshev distance in chunks
        if (dist <= visualDistance) {
          // Still within visual range — use slightly muted normal color
          farColor.setRGB(0.90, 0.95, 0.88);
        } else {
          const t = Math.min(1, (dist - visualDistance) / GROUND_EXTRA_DISTANCE);
          // Lerp from muted green (0.35, 0.50, 0.30) to light grey (0.80, 0.80, 0.80)
          farColor.setRGB(
            0.35 + t * 0.45,
            0.50 + t * 0.30,
            0.30 + t * 0.50
          );
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
