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

/** Player-is-above threshold (in blocks) past which the AI switches
 *  into "climber mode": more samples, much stronger upward bias, and
 *  a fallback that aims UP at the player instead of snapping to the
 *  ground. Below this gap we keep the original behaviour. */
const CLIMB_GAP = 5;

/**
 * Try to pick a 3D hop target near the player, optionally favouring
 * higher blocks (so the shpider climbs trees the player has fled up).
 *
 * Strategy: sample N random directions in a hemisphere oriented along
 * the shpider's current up. For each, build a candidate point at
 * `dist` blocks out; if findLandingSurface accepts it, return it.
 *
 * When the player is significantly above the shpider (CLIMB_GAP+ blocks)
 * we switch into climber mode: 24 samples instead of 6, with the
 * vertical bias amplified so most candidates land above the shpider.
 *
 * Fallback when no landing surface is found:
 *   - Normal mode: aim toward player horizontally, snap Y to ground.
 *   - Climber mode: aim toward the player at their ACTUAL Y, accept
 *     the mid-air landing. The hop AI's gravity-fall will catch the
 *     shpider if it misses, so they at least make progress upward.
 */
export function pickTreeAwareTarget(
  shpiderX: number, shpiderY: number, shpiderZ: number,
  playerX: number, playerY: number, playerZ: number,
  surfaceNormal: THREE.Vector3,
  hopDistMin: number, hopDistMax: number,
  outPos: THREE.Vector3,
  outNormal: THREE.Vector3,
): boolean {
  const verticalGap = playerY - shpiderY;
  const climbing = verticalGap > CLIMB_GAP;

  // Climber mode: 4× more samples, no extra cost since each sample is
  // a few math ops + one O(1) grid probe.
  const samples = climbing ? 24 : 6;

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
    // Bias toward player with random jitter (smaller jitter while
    // climbing — we don't want to scatter sideways).
    const jitterScale = climbing ? 0.5 : 1.2;
    const jitter = (Math.random() - 0.5) * jitterScale;
    const cos = Math.cos(jitter);
    const sin = Math.sin(jitter);
    const dx = ux * cos - uz * sin;
    const dz = ux * sin + uz * cos;
    // Vertical bias: climber mode gets a strong +Y boost so most
    // candidates land ABOVE the shpider. Normal mode keeps the small
    // upward nudge.
    const dy = climbing
      ? Math.max(0.55, uy + Math.random() * 0.6)
      : uy + (Math.random() - 0.4) * 0.6;

    const candidateX = shpiderX + dx * dist;
    const candidateY = shpiderY + dy * dist;
    const candidateZ = shpiderZ + dz * dist;

    if (findLandingSurface(candidateX, candidateY, candidateZ, outNormal, outPos)) {
      return true;
    }
  }

  // Climber-mode fallback: AIM UPWARD AT THE PLAYER even though no
  // landing surface was confirmed. The hop will probably end mid-air;
  // the gravity-fall in stepShpiderHopAI will pull the shpider back
  // down (possibly onto a branch it couldn't sample). Better than
  // teleporting back to ground level every time we miss.
  if (climbing) {
    const tdx = playerX - shpiderX;
    const tdy = playerY - shpiderY;
    const tdz = playerZ - shpiderZ;
    const tdl = Math.hypot(tdx, tdy, tdz) || 1;
    const cx = shpiderX + (tdx / tdl) * dist;
    const cy = shpiderY + (tdy / tdl) * dist;
    const cz = shpiderZ + (tdz / tdl) * dist;
    outPos.set(cx, cy, cz);
    outNormal.set(0, 1, 0);
    return false;
  }

  // Normal-mode fallback: horizontal hop toward player, snap to
  // ground. (Previous default behaviour. Prevents the "all shpiders
  // heading to the horizon" bug — see 2026-May-24.)
  const horizDX = playerX - shpiderX;
  const horizDZ = playerZ - shpiderZ;
  const horizLen = Math.hypot(horizDX, horizDZ);
  let fbDX: number;
  let fbDZ: number;
  if (horizLen > 0.1) {
    fbDX = (horizDX / horizLen) * dist;
    fbDZ = (horizDZ / horizLen) * dist;
  } else {
    const ang = Math.random() * Math.PI * 2;
    fbDX = Math.cos(ang) * dist;
    fbDZ = Math.sin(ang) * dist;
  }
  const fbX = shpiderX + fbDX;
  const fbZ = shpiderZ + fbDZ;
  const groundY = findGroundY(fbX, shpiderY + 4, fbZ, 64);
  outPos.set(fbX, groundY === -Infinity ? 0 : groundY, fbZ);
  outNormal.set(0, 1, 0);
  return false;
}

/**
 * After landing, check whether the shpider is adjacent to a tree
 * trunk (any of the 4 horizontal neighbour voxels is solid). If yes,
 * fill `outNormal` with the world-space normal pointing AWAY from
 * that voxel (so the shpider attaches as a wall-crawler) and return
 * true. Otherwise return false and leave outNormal untouched.
 *
 * Used in stepShpiderHopAI to "stick to" trees that the shpider
 * happens to land next to — once attached, the existing tangent-
 * plane crawl naturally climbs the trunk.
 */
export function findAdjacentWall(
  x: number, y: number, z: number,
  outNormal: THREE.Vector3,
): boolean {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  // +X
  if (worldCollisionGrid.hasVoxel(ix + 1, iy, iz)) {
    outNormal.set(-1, 0, 0);
    return true;
  }
  // -X
  if (worldCollisionGrid.hasVoxel(ix - 1, iy, iz)) {
    outNormal.set(1, 0, 0);
    return true;
  }
  // +Z
  if (worldCollisionGrid.hasVoxel(ix, iy, iz + 1)) {
    outNormal.set(0, 0, -1);
    return true;
  }
  // -Z
  if (worldCollisionGrid.hasVoxel(ix, iy, iz - 1)) {
    outNormal.set(0, 0, 1);
    return true;
  }
  return false;
}
