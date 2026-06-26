// FlatGroundLayer — a single flat grass plane at world.ground.surfaceY, used by
// flat maps (e.g. Starblink) as a blank canvas for the in-world builder. It is the
// 'flat' counterpart of TerrainLayer: same height-sampler contract (registers ONE
// flat HeightTile so sampleHeight() returns surfaceY everywhere within the map), so
// player ground-follow, coin drops, and boulder physics all work with no voxels.
// Phase 1D swaps this for a chunked GPU-displaced heightmap that the terrain brush
// edits; the flat plane is the y=0 starting state.

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { WorldDefinition } from '@/config/worldDefinition';
import { setTiles, type HeightTile } from './terrainHeight';
import { toRenderSpace } from '@/lib/renderSpace';

const TEX_REPEAT_M = 6; // grass detail tiles every 6 m (matches TerrainLayer scale)

/** Map extent in WORLD coords, from bounds (authoritative) with a flatSize fallback. */
function extentOf(world: WorldDefinition) {
  const b = world.bounds;
  if (b) return { minX: b.min[0], maxX: b.max[0], minZ: b.min[1], maxZ: b.max[1] };
  const h = world.ground.flatSize ?? 1000;
  return { minX: -h, maxX: h, minZ: -h, maxZ: h };
}

export function FlatGroundLayer({ world, onReady }: { world: WorldDefinition; onReady?: () => void }) {
  const surfaceY = world.ground.surfaceY ?? 0;
  const { minX, maxX, minZ, maxZ } = extentOf(world);
  const sizeX = maxX - minX, sizeZ = maxZ - minZ;
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;

  const mesh = useMemo(() => {
    const grass = new THREE.TextureLoader().load('/worn_rock_natural_01_1k.webp');
    grass.wrapS = grass.wrapT = THREE.RepeatWrapping;
    grass.colorSpace = THREE.SRGBColorSpace;
    grass.repeat.set(sizeX / TEX_REPEAT_M, sizeZ / TEX_REPEAT_M);
    const geo = new THREE.PlaneGeometry(sizeX, sizeZ);
    const mat = new THREE.MeshStandardMaterial({ map: grass, color: 0x6f8a48, roughness: 1, metalness: 0 });
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    // Position through the world→render boundary (identity today; large-world origin shift later).
    const [rx, ry, rz] = toRenderSpace(cx, surfaceY, cz);
    m.position.set(rx, ry, rz);
    m.userData.ground = true;
    return m;
  }, [sizeX, sizeZ, cx, cz, surfaceY]);

  useEffect(() => {
    // One flat tile covering the whole map → bilinear sample = surfaceY everywhere.
    const tile: HeightTile = {
      posX: minX, posZ: minZ, sizeX, sizeZ, res: 2,
      heights: new Float32Array([surfaceY, surfaceY, surfaceY, surfaceY]),
    };
    setTiles([tile]);
    onReady?.();
  }, [minX, minZ, sizeX, sizeZ, surfaceY]);

  return <primitive object={mesh} />;
}
