// TerrainLayer — builds the real Siege Worlds ground from the extracted heightfield
// tiles. Each tile is a mesh in world coords, registered with the height sampler so
// the player walks on it. Surface blends THREE real textures (sand at the waterline,
// grass on land, rock on steep ground) by a per-vertex weight authored from height +
// slope, so the terrain reads clearly and at correct scale. Real splatmaps are a later upgrade.

import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { setTiles, type HeightTile } from './terrainHeight';
import { siegeLoadStart, siegeLoadFinish, siegeLoadNote } from './siegeInitLoad';
import { loadTerrainTex, makeTerrainBlendMaterial } from './terrain/terrainBlend';

interface TileMeta {
  file: string; res: number; sizeX: number; sizeZ: number;
  pos: [number, number, number]; hMin: number; hMax: number;
}

const WATER_Y = 22;        // sea level (Client.cs)
const TEX_REPEAT_M = 6;    // detail texture tiles every 6 m (scale reference)

// Sand/grass/rock blend weights for one vertex, from height + slope.
//  • Beach: PURE SAND from the waterline up a few metres, regardless of slope — shores slope up out of
//    the water, and the slope→rock rule was overriding sand there (why the beach showed rock).
//  • Above the beach: sand→grass transition, then grass; rock only on steep LAND.
const BEACH_TOP = WATER_Y + 3;     // pure sand up to here (covers the sloped shore)
const GRASS_FULL = WATER_Y + 7;    // fully grass above here
function tileWeights(y: number, slopeUp: number, out: Float32Array, i: number) {
  if (y < BEACH_TOP) { out[i * 3] = 1; out[i * 3 + 1] = 0; out[i * 3 + 2] = 0; return; }
  let s: number, g: number;
  if (y < GRASS_FULL) { const t = (y - BEACH_TOP) / (GRASS_FULL - BEACH_TOP); s = 1 - t; g = t; }
  else { s = 0; g = 1; }
  const rock = slopeUp < 0.78 ? Math.min(1, (0.78 - slopeUp) / 0.5) : 0;
  out[i * 3] = s * (1 - rock); out[i * 3 + 1] = g * (1 - rock); out[i * 3 + 2] = rock;
}

function buildTileMesh(meta: TileMeta, heights: Float32Array, mat: THREE.Material): THREE.Mesh {
  const { res, sizeX, sizeZ, pos } = meta;
  const verts = new Float32Array(res * res * 3);
  const uvs = new Float32Array(res * res * 2);
  for (let iz = 0; iz < res; iz++) {
    for (let ix = 0; ix < res; ix++) {
      const i = iz * res + ix;
      const wx = pos[0] + (ix / (res - 1)) * sizeX;
      const wz = pos[2] + (iz / (res - 1)) * sizeZ;
      verts[i * 3] = wx; verts[i * 3 + 1] = heights[i]; verts[i * 3 + 2] = wz;
      uvs[i * 2] = wx / TEX_REPEAT_M; uvs[i * 2 + 1] = wz / TEX_REPEAT_M;
    }
  }
  const indices: number[] = [];
  for (let iz = 0; iz < res - 1; iz++)
    for (let ix = 0; ix < res - 1; ix++) {
      const a = iz * res + ix, b = a + 1, c = a + res, d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  // per-vertex sand/grass/rock weights from height + slope (uses computed normals)
  const normal = geo.getAttribute('normal');
  const weights = new Float32Array(res * res * 3);
  for (let i = 0; i < res * res; i++) tileWeights(verts[i * 3 + 1], normal.getY(i), weights, i);
  geo.setAttribute('aWgt', new THREE.BufferAttribute(weights, 3));
  const mesh = new THREE.Mesh(geo, mat);
  mesh.userData.ground = true;
  return mesh;
}

export function TerrainLayer({ onReady }: { onReady?: () => void } = {}) {
  const [group, setGroup] = useState<THREE.Group | null>(null);

  // One shared sand/grass/rock blend material for every tile.
  const mat = useMemo(() => makeTerrainBlendMaterial(
    loadTerrainTex('/sww_terrain_sand.webp'),
    loadTerrainTex('/sww_terrain_grass.webp'),
    loadTerrainTex('/sww_terrain_rock.webp'),
    { side: THREE.DoubleSide },
  ), []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const tStep = siegeLoadStart('Terrain', 'Loading lobby terrain...');
      try {
        const mStep = siegeLoadStart('Terrain', 'Fetching terrain manifest...');
        const manifest = await fetch('/siege/terrain/manifest.json').then((r) => r.json());
        const tiles = manifest.tiles as TileMeta[];
        siegeLoadFinish(mStep, tiles.length);
        // Download every tile in PARALLEL (was one-at-a-time = 16 serial round-trips, the main reason
        // terrain took so long — nothing else can render until terrain is ready). Report EACH tile as
        // it arrives so the user sees steady progress. 16 tiles × ~258KB.
        const dStep = siegeLoadStart('Terrain', `Downloading ${tiles.length} terrain tiles...`);
        let got = 0;
        const bufs = await Promise.all(tiles.map((m) =>
          fetch(`/siege/terrain/${m.file}`).then((r) => r.arrayBuffer()).then((buf) => {
            siegeLoadNote('Terrain', `Tile ${++got}/${tiles.length} received`);
            return buf;
          })
        ));
        siegeLoadFinish(dStep, tiles.length);
        if (!alive) return;
        const bStep = siegeLoadStart('Terrain', 'Building terrain meshes...');
        const g = new THREE.Group();
        const sampleTiles: HeightTile[] = [];
        for (let i = 0; i < tiles.length; i++) {
          const meta = tiles[i];
          const heights = new Float32Array(bufs[i]);
          g.add(buildTileMesh(meta, heights, mat));
          sampleTiles.push({ posX: meta.pos[0], posZ: meta.pos[2], sizeX: meta.sizeX, sizeZ: meta.sizeZ, res: meta.res, heights });
        }
        siegeLoadFinish(bStep, tiles.length);
        if (!alive) return;
        setTiles(sampleTiles);
        setGroup(g);
        siegeLoadFinish(tStep, tiles.length);
        onReady?.();          // terrain is ready -> let everything else mount on top of it
      } catch { siegeLoadFinish(tStep); /* manifest not present */ }
    })();
    return () => { alive = false; };
  }, [mat]);

  if (!group) return null;
  return <primitive object={group} />;
}
