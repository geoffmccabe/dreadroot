// Pre-DO combat gap "H": a PURE voxel ray-tracer (no React, no Three.js).
//
// The existing src/lib/voxelRaycast.ts is Three.js-coupled and tied to client
// state, so the Cloudflare DO can't use it. The DO has no THREE.Raycaster and
// no meshes — to hit-test a bullet against the world it walks the bullet's
// path cell-by-cell and asks the collision grid `hasVoxel`. This is that walk
// (Amanatides–Woo voxel DDA), operating purely on the VoxelCollider interface
// (satisfied by chunkBuilder.buildVoxelGrid) and plain {x,y,z} vectors.

import type { VoxelCollider } from '@/features/combat/grenadePhysics';

export interface Vec3 { x: number; y: number; z: number; }

export interface VoxelTraceHit {
  /** Integer cell that was hit. */
  x: number; y: number; z: number;
  /** Face normal of the hit (each component -1, 0, or 1). */
  nx: number; ny: number; nz: number;
  /** World distance from the ray origin to the hit face. */
  distance: number;
}

/**
 * March a ray through the voxel grid and return the first solid cell, with the
 * face normal and distance, or null if nothing solid within maxDist.
 *
 * @param origin   ray start (world coords, floats)
 * @param dir      ray direction (need not be normalized)
 * @param maxDist  max world distance to travel
 * @param collider anything with hasVoxel(ix,iy,iz)
 */
export function raycastVoxels(
  origin: Vec3,
  dir: Vec3,
  maxDist: number,
  collider: VoxelCollider,
): VoxelTraceHit | null {
  const len = Math.hypot(dir.x, dir.y, dir.z);
  if (len === 0 || maxDist <= 0) return null;
  const dx = dir.x / len, dy = dir.y / len, dz = dir.z / len;

  let ix = Math.floor(origin.x);
  let iy = Math.floor(origin.y);
  let iz = Math.floor(origin.z);

  const stepX = dx > 0 ? 1 : (dx < 0 ? -1 : 0);
  const stepY = dy > 0 ? 1 : (dy < 0 ? -1 : 0);
  const stepZ = dz > 0 ? 1 : (dz < 0 ? -1 : 0);

  // World distance covered per full cell crossing on each axis.
  const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;

  const fracX = origin.x - ix;
  const fracY = origin.y - iy;
  const fracZ = origin.z - iz;

  // Distance along the ray to the first cell boundary on each axis.
  let tMaxX = dx > 0 ? (1 - fracX) * tDeltaX : (dx < 0 ? fracX * tDeltaX : Infinity);
  let tMaxY = dy > 0 ? (1 - fracY) * tDeltaY : (dy < 0 ? fracY * tDeltaY : Infinity);
  let tMaxZ = dz > 0 ? (1 - fracZ) * tDeltaZ : (dz < 0 ? fracZ * tDeltaZ : Infinity);

  // Ray starts inside a solid cell → immediate hit; normal points back at origin.
  if (collider.hasVoxel(ix, iy, iz)) {
    return { x: ix, y: iy, z: iz, nx: -stepX, ny: -stepY, nz: -stepZ, distance: 0 };
  }

  let t = 0;
  let nx = 0, ny = 0, nz = 0;
  // Cap iterations as a safety net against pathological inputs.
  const maxSteps = Math.ceil(maxDist) * 3 + 3;
  for (let i = 0; i < maxSteps; i++) {
    if (tMaxX <= tMaxY && tMaxX <= tMaxZ) {
      ix += stepX; t = tMaxX; tMaxX += tDeltaX; nx = -stepX; ny = 0; nz = 0;
    } else if (tMaxY <= tMaxZ) {
      iy += stepY; t = tMaxY; tMaxY += tDeltaY; nx = 0; ny = -stepY; nz = 0;
    } else {
      iz += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; nx = 0; ny = 0; nz = -stepZ;
    }
    if (t > maxDist) return null;
    if (collider.hasVoxel(ix, iy, iz)) {
      return { x: ix, y: iy, z: iz, nx, ny, nz, distance: t };
    }
  }
  return null;
}
