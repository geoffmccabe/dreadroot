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

const TEX_REPEAT_M = 6; // grass detail tiles every 6 m (matches TerrainLayer scale)

export function FlatGroundLayer({ world, onReady }: { world: WorldDefinition; onReady?: () => void }) {
  const surfaceY = world.ground.surfaceY ?? 0;
  const half = world.ground.flatSize ?? 1000;

  const mesh = useMemo(() => {
    const grass = new THREE.TextureLoader().load('/siege/terrain/grass.png');
    grass.wrapS = grass.wrapT = THREE.RepeatWrapping;
    grass.colorSpace = THREE.SRGBColorSpace;
    grass.repeat.set((half * 2) / TEX_REPEAT_M, (half * 2) / TEX_REPEAT_M);
    const geo = new THREE.PlaneGeometry(half * 2, half * 2);
    const mat = new THREE.MeshStandardMaterial({ map: grass, color: 0x6f8a48, roughness: 1, metalness: 0 });
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(0, surfaceY, 0);
    m.userData.ground = true;
    return m;
  }, [half, surfaceY]);

  useEffect(() => {
    // One flat tile covering the whole map → bilinear sample = surfaceY everywhere.
    const tile: HeightTile = {
      posX: -half, posZ: -half, sizeX: half * 2, sizeZ: half * 2, res: 2,
      heights: new Float32Array([surfaceY, surfaceY, surfaceY, surfaceY]),
    };
    setTiles([tile]);
    onReady?.();
  }, [half, surfaceY]);

  return <primitive object={mesh} />;
}
