// TerrainLayer — builds the real Siege Worlds ground from the extracted heightfield
// tiles. Each tile is a mesh in world coords, registered with the height sampler so
// the player walks on it. Surface gets a tiling grass detail texture + height/slope
// vertex colors (sand at the waterline, grass on land, rock on steep/high ground) so
// the terrain reads clearly and at correct scale. Real splatmaps are a later upgrade.

import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { setTiles, type HeightTile } from './terrainHeight';

interface TileMeta {
  file: string; res: number; sizeX: number; sizeZ: number;
  pos: [number, number, number]; hMin: number; hMax: number;
}

const WATER_Y = 22;        // sea level (Client.cs)
const TEX_REPEAT_M = 6;    // detail texture tiles every 6 m (scale reference)

const SAND = new THREE.Color(0xcdbd92);
const GRASS = new THREE.Color(0x5c7a3a);
const GRASS_HI = new THREE.Color(0x6f8a48);
const ROCK = new THREE.Color(0x6d6660);

function tileColor(y: number, slopeUp: number, out: THREE.Color) {
  // beach band just around sea level -> sand
  if (y < WATER_Y + 2.5) out.copy(SAND);
  else if (y < WATER_Y + 6) out.lerpColors(SAND, GRASS, (y - (WATER_Y + 2.5)) / 3.5);
  else out.lerpColors(GRASS, GRASS_HI, Math.min(1, (y - WATER_Y - 6) / 80));
  // steep slopes -> rock, regardless of height
  if (slopeUp < 0.78) out.lerp(ROCK, Math.min(1, (0.78 - slopeUp) / 0.5));
}

function buildTileMesh(meta: TileMeta, heights: Float32Array, grass: THREE.Texture): THREE.Mesh {
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
  // vertex colors from height + slope (uses computed normals)
  const normal = geo.getAttribute('normal');
  const colors = new Float32Array(res * res * 3);
  const c = new THREE.Color();
  for (let i = 0; i < res * res; i++) {
    tileColor(verts[i * 3 + 1], normal.getY(i), c);
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.MeshStandardMaterial({
    map: grass, vertexColors: true, roughness: 1, metalness: 0, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.userData.ground = true;
  return mesh;
}

export function TerrainLayer({ onReady }: { onReady?: () => void } = {}) {
  const [group, setGroup] = useState<THREE.Group | null>(null);

  const grass = useMemo(() => {
    // Worn-rock base detail texture (neutral), tinted per-vertex into sand/grass/rock by tileColor().
    const t = new THREE.TextureLoader().load('/worn_rock_natural_01_1k.webp');
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const manifest = await fetch('/siege/terrain/manifest.json').then((r) => r.json());
        const g = new THREE.Group();
        const sampleTiles: HeightTile[] = [];
        for (const meta of manifest.tiles as TileMeta[]) {
          const buf = await fetch(`/siege/terrain/${meta.file}`).then((r) => r.arrayBuffer());
          const heights = new Float32Array(buf);
          g.add(buildTileMesh(meta, heights, grass));
          sampleTiles.push({ posX: meta.pos[0], posZ: meta.pos[2], sizeX: meta.sizeX, sizeZ: meta.sizeZ, res: meta.res, heights });
        }
        if (!alive) return;
        setTiles(sampleTiles);
        setGroup(g);
        onReady?.();          // terrain is ready -> let everything else mount on top of it
      } catch { /* manifest not present */ }
    })();
    return () => { alive = false; };
  }, [grass]);

  if (!group) return null;
  return <primitive object={group} />;
}
