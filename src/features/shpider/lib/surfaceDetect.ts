// Voxel-aware surface detection.
//
// Spiders need to know which 6-axis-aligned face they're sitting on so
// the body can lie flat. We sample 6 neighbours of the foot voxel; the
// first occupied neighbour wins (priority: down > horizontal > up,
// matching ground > wall > ceiling).
//
// hasVoxel() is the existing voxel-index probe on worldCollisionGrid;
// it's O(1) so we can fire it dozens of times per shpider per frame
// without measurable cost.

import * as THREE from 'three';
import { worldCollisionGrid } from '@/lib/spatialHashGrid';

const _v = new THREE.Vector3();

/**
 * Find a candidate landing-face for a hop-target point. Returns null
 * if the point is inside a block (target rejected) OR floating in
 * empty space with no adjacent surface (will free-fall).
 *
 * `out` is filled with the surface normal in world space.
 * `outPos` is filled with the snapped landing position (on top of the
 * support voxel).
 */
export function findLandingSurface(
  x: number,
  y: number,
  z: number,
  out: THREE.Vector3,
  outPos: THREE.Vector3,
): boolean {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);

  // Reject if inside a solid voxel.
  if (worldCollisionGrid.hasVoxel(ix, iy, iz)) return false;

  // Probe order: support beneath, then 4 horizontal walls, then ceiling.
  // Faces returned point *away* from the supporting voxel.
  // ── Floor (block beneath) ──
  if (worldCollisionGrid.hasVoxel(ix, iy - 1, iz)) {
    out.set(0, 1, 0);
    outPos.set(ix + 0.5, iy, iz + 0.5);
    return true;
  }
  // ── +X wall (block to the +X of us) ──
  if (worldCollisionGrid.hasVoxel(ix + 1, iy, iz)) {
    out.set(-1, 0, 0);
    outPos.set(ix + 1, iy + 0.5, iz + 0.5);
    return true;
  }
  // ── -X wall ──
  if (worldCollisionGrid.hasVoxel(ix - 1, iy, iz)) {
    out.set(1, 0, 0);
    outPos.set(ix, iy + 0.5, iz + 0.5);
    return true;
  }
  // ── +Z wall ──
  if (worldCollisionGrid.hasVoxel(ix, iy, iz + 1)) {
    out.set(0, 0, -1);
    outPos.set(ix + 0.5, iy + 0.5, iz + 1);
    return true;
  }
  // ── -Z wall ──
  if (worldCollisionGrid.hasVoxel(ix, iy, iz - 1)) {
    out.set(0, 0, 1);
    outPos.set(ix + 0.5, iy + 0.5, iz);
    return true;
  }
  // ── Ceiling (block above) ──
  if (worldCollisionGrid.hasVoxel(ix, iy + 1, iz)) {
    out.set(0, -1, 0);
    outPos.set(ix + 0.5, iy + 1, iz + 0.5);
    return true;
  }
  return false;
}

/**
 * Cast a short ray downward from the shpider's position to find a
 * support voxel. Used when free-falling.
 *
 * Returns the world-space ground Y if a block is found within
 * `maxDepth` of `y`, else -Infinity.
 */
export function findGroundY(x: number, y: number, z: number, maxDepth: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const startIy = Math.floor(y);
  for (let dy = 0; dy <= maxDepth; dy++) {
    const iy = startIy - dy;
    if (worldCollisionGrid.hasVoxel(ix, iy, iz)) {
      // Land on top face of that voxel.
      return iy + 1;
    }
    if (iy < -64) break;
  }
  return -Infinity;
}

/**
 * Try to pick a 3D hop target near the player, optionally favouring
 * higher blocks (so the shpider climbs trees the player has fled up).
 *
 * Strategy: sample N random directions in a hemisphere oriented along
 * the shpider's current up. For each, build a candidate point at
 * `dist` blocks out; if findLandingSurface accepts it, return it.
 *
 * Falls back to the simple horizontal target if no surface is found.
 */
export function pickTreeAwareTarget(
  shpiderX: number, shpiderY: number, shpiderZ: number,
  playerX: number, playerY: number, playerZ: number,
  surfaceNormal: THREE.Vector3,
  hopDistMin: number, hopDistMax: number,
  outPos: THREE.Vector3,
  outNormal: THREE.Vector3,
): boolean {
  const samples = 6;
  // Pull dx,dy,dz toward the player so most candidates aim at them.
  const toPlayerX = playerX - shpiderX;
  const toPlayerY = playerY - shpiderY;
  const toPlayerZ = playerZ - shpiderZ;
  const toPlayerLen = Math.hypot(toPlayerX, toPlayerY, toPlayerZ) || 1;
  const ux = toPlayerX / toPlayerLen;
  const uy = toPlayerY / toPlayerLen;
  const uz = toPlayerZ / toPlayerLen;

  const dist = hopDistMin + Math.random() * (hopDistMax - hopDistMin);

  for (let i = 0; i < samples; i++) {
    // Bias toward player with random jitter.
    const jitter = (Math.random() - 0.5) * 1.2;
    const cos = Math.cos(jitter);
    const sin = Math.sin(jitter);
    const dx = ux * cos - uz * sin;
    const dz = ux * sin + uz * cos;
    // Add a small upward bias proportional to how far above the player is.
    const dy = uy + (Math.random() - 0.4) * 0.6;

    const candidateX = shpiderX + dx * dist;
    const candidateY = shpiderY + dy * dist;
    const candidateZ = shpiderZ + dz * dist;

    if (findLandingSurface(candidateX, candidateY, candidateZ, outNormal, outPos)) {
      return true;
    }
  }

  // Final fallback: stay on current surface, hop in current up's tangent plane.
  _v.set(surfaceNormal.x, surfaceNormal.y, surfaceNormal.z);
  // Pick any vector orthogonal to surfaceNormal.
  const tanX = Math.abs(_v.y) < 0.9 ? 0 : 1;
  const tanZ = Math.abs(_v.y) < 0.9 ? 1 : 0;
  outNormal.copy(_v);
  outPos.set(
    shpiderX + (tanX ? 1 : 0) * dist,
    shpiderY,
    shpiderZ + (tanZ ? 1 : 0) * dist,
  );
  return false;
}
