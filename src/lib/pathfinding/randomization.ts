/**
 * Path Randomization Module
 *
 * Applies various randomization effects to paths to make movement
 * less predictable and more natural.
 *
 * Modes:
 * - straight: No randomization, path remains as-is
 * - curved: Smooth bezier curves between waypoints
 * - jagged: Random offsets at each waypoint
 */

import * as THREE from 'three';
import type { RandomizationMode } from './types';
import { worldCollisionGrid } from '@/lib/spatialHashGrid';

// Pre-allocated vectors for collision checks
const _testMin = new THREE.Vector3();
const _testMax = new THREE.Vector3();
const _testBox = new THREE.Box3();

/**
 * Apply randomization to a path
 *
 * @param path - Original path waypoints
 * @param variance - Maximum deviation in meters
 * @param mode - Randomization mode
 * @param entityRadius - For collision checking
 * @param entityHeight - For collision checking
 * @returns Randomized path
 */
export function applyRandomization(
  path: THREE.Vector3[],
  variance: number,
  mode: RandomizationMode,
  entityRadius: number,
  entityHeight: number
): THREE.Vector3[] {
  if (variance <= 0 || mode === 'straight' || path.length < 2) {
    return path;
  }

  switch (mode) {
    case 'curved':
      return applyCurvedRandomization(path, variance, entityRadius, entityHeight);
    case 'jagged':
      return applyJaggedRandomization(path, variance, entityRadius, entityHeight);
    default:
      return path;
  }
}

/**
 * Apply curved (bezier) randomization
 * Creates smooth curves between waypoints
 */
function applyCurvedRandomization(
  path: THREE.Vector3[],
  variance: number,
  entityRadius: number,
  entityHeight: number
): THREE.Vector3[] {
  if (path.length < 3) {
    return applyJaggedRandomization(path, variance, entityRadius, entityHeight);
  }

  const result: THREE.Vector3[] = [path[0].clone()]; // Keep start point

  // Generate control points with random offsets
  const controlPoints: THREE.Vector3[] = path.map((p, i) => {
    if (i === 0 || i === path.length - 1) {
      return p.clone(); // Keep start and end exact
    }

    // Random offset perpendicular to path direction
    const prev = path[i - 1];
    const next = path[i + 1];

    // Direction along path
    const dirX = next.x - prev.x;
    const dirZ = next.z - prev.z;
    const len = Math.sqrt(dirX * dirX + dirZ * dirZ);

    if (len < 0.01) return p.clone();

    // Perpendicular direction
    const perpX = -dirZ / len;
    const perpZ = dirX / len;

    // Random offset along perpendicular
    const offset = (Math.random() * 2 - 1) * variance;

    const newX = p.x + perpX * offset;
    const newZ = p.z + perpZ * offset;

    // Check if new position is walkable
    if (isWalkable(newX, newZ, entityRadius, entityHeight)) {
      return new THREE.Vector3(newX, 0, newZ);
    }
    return p.clone();
  });

  // Interpolate bezier curves between points
  const segmentsPerCurve = 4;

  for (let i = 0; i < controlPoints.length - 1; i++) {
    const p0 = i > 0 ? controlPoints[i - 1] : controlPoints[i];
    const p1 = controlPoints[i];
    const p2 = controlPoints[i + 1];
    const p3 = i < controlPoints.length - 2 ? controlPoints[i + 2] : controlPoints[i + 1];

    // Catmull-Rom to Bezier conversion for smooth curves
    for (let j = 1; j <= segmentsPerCurve; j++) {
      const t = j / segmentsPerCurve;
      const point = catmullRomInterpolate(p0, p1, p2, p3, t);

      // Verify the interpolated point is walkable
      if (isWalkable(point.x, point.z, entityRadius, entityHeight)) {
        result.push(point);
      }
    }
  }

  // Ensure end point is included
  const last = path[path.length - 1];
  if (result.length === 0 || result[result.length - 1].distanceTo(last) > 0.1) {
    result.push(last.clone());
  }

  return result;
}

/**
 * Catmull-Rom spline interpolation
 */
function catmullRomInterpolate(
  p0: THREE.Vector3,
  p1: THREE.Vector3,
  p2: THREE.Vector3,
  p3: THREE.Vector3,
  t: number
): THREE.Vector3 {
  const t2 = t * t;
  const t3 = t2 * t;

  const x = 0.5 * (
    (2 * p1.x) +
    (-p0.x + p2.x) * t +
    (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
    (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3
  );

  const z = 0.5 * (
    (2 * p1.z) +
    (-p0.z + p2.z) * t +
    (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 +
    (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3
  );

  return new THREE.Vector3(x, 0, z);
}

/**
 * Apply jagged randomization
 * Adds random offsets to each waypoint
 */
function applyJaggedRandomization(
  path: THREE.Vector3[],
  variance: number,
  entityRadius: number,
  entityHeight: number
): THREE.Vector3[] {
  const result: THREE.Vector3[] = [];

  for (let i = 0; i < path.length; i++) {
    const p = path[i];

    // Keep start and end points exact
    if (i === 0 || i === path.length - 1) {
      result.push(p.clone());
      continue;
    }

    // Random offset in any direction
    const angle = Math.random() * Math.PI * 2;
    const distance = Math.random() * variance;

    const newX = p.x + Math.cos(angle) * distance;
    const newZ = p.z + Math.sin(angle) * distance;

    // Check if new position is walkable
    if (isWalkable(newX, newZ, entityRadius, entityHeight)) {
      result.push(new THREE.Vector3(newX, 0, newZ));
    } else {
      // Try smaller offsets
      let found = false;
      for (let attempt = 0; attempt < 4; attempt++) {
        const reducedDist = distance * (0.5 - attempt * 0.1);
        const tryX = p.x + Math.cos(angle) * reducedDist;
        const tryZ = p.z + Math.sin(angle) * reducedDist;

        if (isWalkable(tryX, tryZ, entityRadius, entityHeight)) {
          result.push(new THREE.Vector3(tryX, 0, tryZ));
          found = true;
          break;
        }
      }

      if (!found) {
        result.push(p.clone()); // Keep original if all attempts fail
      }
    }
  }

  return result;
}

/**
 * Check if a position is walkable (no collision)
 */
function isWalkable(x: number, z: number, entityRadius: number, entityHeight: number): boolean {
  _testMin.set(x - entityRadius, 0.1, z - entityRadius);
  _testMax.set(x + entityRadius, entityHeight, z + entityRadius);
  _testBox.set(_testMin, _testMax);

  const count = worldCollisionGrid.getNearbyFiltered(x, z, entityRadius + 1, 0, entityHeight);
  const colliders = worldCollisionGrid.nearbyResult;

  for (let i = 0; i < count; i++) {
    const collider = colliders[i];
    if (_testBox.intersectsBox(collider)) {
      return false;
    }
  }

  return true;
}
