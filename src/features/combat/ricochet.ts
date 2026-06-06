// Pre-DO combat gap "G": PURE bullet ricochet math (no React, no Three.js).
//
// Today the reflection lives inline in useFortressFrameLoop.ts:
//   R = D - 2(D·N)N, then velocity damping + ricochet-count decrement.
// The DO must resolve ricochets authoritatively, so the math is extracted
// here as a pure function it (and, later, the client) can share. The hit face
// normal comes from raycastVoxels (voxelTrace.ts).

import type { Vec3 } from '@/lib/voxelTrace';

/** Reflect a direction/velocity about a surface normal: R = D - 2(D·N)N.
 *  `normal` should be unit-length (voxel face normals already are). */
export function reflect(dir: Vec3, normal: Vec3): Vec3 {
  const dot = dir.x * normal.x + dir.y * normal.y + dir.z * normal.z;
  return {
    x: dir.x - 2 * dot * normal.x,
    y: dir.y - 2 * dot * normal.y,
    z: dir.z - 2 * dot * normal.z,
  };
}

export interface RicochetResult {
  velocity: Vec3;
  /** Remaining ricochets after this bounce (caller stops at 0). */
  ricochetsLeft: number;
}

/**
 * Apply one wall bounce: reflect the velocity, damp it, and decrement the
 * ricochet budget. `damping` in (0,1] scales speed lost per bounce.
 */
export function applyRicochet(
  velocity: Vec3,
  normal: Vec3,
  ricochetsLeft: number,
  damping = 1,
): RicochetResult {
  const r = reflect(velocity, normal);
  return {
    velocity: { x: r.x * damping, y: r.y * damping, z: r.z * damping },
    ricochetsLeft: ricochetsLeft - 1,
  };
}
