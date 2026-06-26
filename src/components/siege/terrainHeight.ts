// Shared terrain height sampler. TerrainLayer fills it once the heightfield tiles
// load; the controller queries sampleHeight(x,z) for ground-following (O(1), no
// per-frame raycasts). All coordinates are world-space.

export interface HeightTile {
  posX: number;
  posZ: number;
  sizeX: number;
  sizeZ: number;
  res: number;
  heights: Float32Array; // row-major [row*res + col], row=z, col=x
}

const tiles: HeightTile[] = [];

export function setTiles(t: HeightTile[]) {
  tiles.length = 0;
  tiles.push(...t);
}

// Dynamic provider for EDITABLE maps (heightField). When set it is the authority —
// the brush edits it and the player/coins/boulders follow it live. Static gltf-terrain
// maps leave it null and keep using the tile path below. One sampler, both worlds.
type HeightProvider = (x: number, z: number) => number | null;
let dynamicProvider: HeightProvider | null = null;
export function setDynamicHeightProvider(fn: HeightProvider | null) { dynamicProvider = fn; }

// Baked heightmap provider — for BAKED-MESH maps (e.g. Adventure Town / Snowy Cabin) a one-time pass
// ray-traces the collider mesh from the sky and stores the real top-surface elevation on a grid; this
// provider serves it. It takes PRIORITY over `dynamicProvider` (which on those maps is a flat Y=0
// fallback plane — a false floor UNDER the terrain). With it, the player's gravity floor and every
// entity's groundAt() get the true elevation, so nothing sinks through the ground.
let bakedProvider: HeightProvider | null = null;
export function setBakedHeightProvider(fn: HeightProvider | null) { bakedProvider = fn; }

export function hasTerrain() {
  return tiles.length > 0 || dynamicProvider != null || bakedProvider != null;
}

/** Ground height at world (x,z), or null if outside all tiles. Bilinear. */
export function sampleHeight(x: number, z: number): number | null {
  if (dynamicProvider) {
    const h = dynamicProvider(x, z);
    if (h != null) return h;
  }
  for (const t of tiles) {
    if (x < t.posX || x >= t.posX + t.sizeX || z < t.posZ || z >= t.posZ + t.sizeZ) continue;
    const fx = ((x - t.posX) / t.sizeX) * (t.res - 1);
    const fz = ((z - t.posZ) / t.sizeZ) * (t.res - 1);
    const x0 = Math.floor(fx), z0 = Math.floor(fz);
    const x1 = Math.min(x0 + 1, t.res - 1), z1 = Math.min(z0 + 1, t.res - 1);
    const tx = fx - x0, tz = fz - z0;
    const h = t.heights;
    const h00 = h[z0 * t.res + x0], h10 = h[z0 * t.res + x1];
    const h01 = h[z1 * t.res + x0], h11 = h[z1 * t.res + x1];
    const a = h00 * (1 - tx) + h10 * tx;
    const b = h01 * (1 - tx) + h11 * tx;
    return a * (1 - tz) + b * tz;
  }
  return null;
}
