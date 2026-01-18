import * as THREE from 'three';
import React, { useEffect, useMemo, useRef } from 'react';
import { useTexture } from '@react-three/drei';
import { CHUNK_SIZE, parseChunkKey } from '@/lib/chunkManager';
import { TERRAIN_CONFIG } from '@/lib/terrainGenerator';

interface ProceduralGroundProps {
  visibleChunksRef: React.MutableRefObject<Set<string>>;
  renderTrigger: number;
  textureUrl?: string;
}

const SURFACE_Y = TERRAIN_CONFIG.SURFACE_Y;

export function ProceduralGround({
  visibleChunksRef,
  renderTrigger,
  textureUrl = '/grass_texture_seamless.webp',
}: ProceduralGroundProps) {
  const grassTexture = useTexture(textureUrl);
  
  useEffect(() => {
    grassTexture.wrapS = THREE.RepeatWrapping;
    grassTexture.wrapT = THREE.RepeatWrapping;
    grassTexture.anisotropy = 4;
    grassTexture.needsUpdate = true;
  }, [grassTexture]);
  
  // Shared geometry for all chunks
  const geometry = useMemo(() => {
    const g = new THREE.BoxGeometry(1, 1, 1);
    // Set bounding sphere for frustum culling per chunk
    const half = CHUNK_SIZE / 2;
    g.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(half, 0.5, half),
      Math.sqrt(half * half + half * half + 0.5)
    );
    return g;
  }, []);
  
  // Shared material for all chunks
  const material = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      map: grassTexture,
      roughness: 1,
      metalness: 0,
    });
  }, [grassTexture]);
  
  // Build list of visible chunks within world bounds
  const chunkList = useMemo(() => {
    const out: Array<{ x: number; z: number }> = [];
    visibleChunksRef.current.forEach((key) => {
      const parsed = parseChunkKey(key);
      if (!parsed) return;
      
      // Check if chunk is within world bounds
      const { WORLD_HALF_SIZE } = TERRAIN_CONFIG;
      const chunkMinX = parsed.chunkX * CHUNK_SIZE;
      const chunkMaxX = chunkMinX + CHUNK_SIZE - 1;
      const chunkMinZ = parsed.chunkZ * CHUNK_SIZE;
      const chunkMaxZ = chunkMinZ + CHUNK_SIZE - 1;
      
      if (chunkMaxX < -WORLD_HALF_SIZE || chunkMinX > WORLD_HALF_SIZE) return;
      if (chunkMaxZ < -WORLD_HALF_SIZE || chunkMinZ > WORLD_HALF_SIZE) return;
      
      out.push({ x: parsed.chunkX, z: parsed.chunkZ });
    });
    return out;
  }, [renderTrigger, visibleChunksRef]);
  
  return (
    <group name="procedural-ground">
      {chunkList.map(({ x, z }) => (
        <GroundChunk
          key={`ground_${x}_${z}`}
          chunkX={x}
          chunkZ={z}
          geometry={geometry}
          material={material}
        />
      ))}
    </group>
  );
}

function GroundChunk({
  chunkX,
  chunkZ,
  geometry,
  material,
}: {
  chunkX: number;
  chunkZ: number;
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const temp = useMemo(() => new THREE.Object3D(), []);
  
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    
    const baseX = chunkX * CHUNK_SIZE;
    const baseZ = chunkZ * CHUNK_SIZE;
    const { WORLD_HALF_SIZE } = TERRAIN_CONFIG;
    
    let i = 0;
    
    for (let dx = 0; dx < CHUNK_SIZE; dx++) {
      const worldX = baseX + dx;
      if (worldX < -WORLD_HALF_SIZE || worldX > WORLD_HALF_SIZE) continue;
      
      for (let dz = 0; dz < CHUNK_SIZE; dz++) {
        const worldZ = baseZ + dz;
        if (worldZ < -WORLD_HALF_SIZE || worldZ > WORLD_HALF_SIZE) continue;
        
        // Position block at center of voxel cell
        temp.position.set(dx + 0.5, SURFACE_Y + 0.5, dz + 0.5);
        temp.updateMatrix();
        mesh.setMatrixAt(i++, temp.matrix);
      }
    }
    
    mesh.count = i;
    mesh.instanceMatrix.needsUpdate = true;
  }, [chunkX, chunkZ, temp]);
  
  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, CHUNK_SIZE * CHUNK_SIZE]}
      position={[chunkX * CHUNK_SIZE, 0, chunkZ * CHUNK_SIZE]}
      frustumCulled
    />
  );
}
