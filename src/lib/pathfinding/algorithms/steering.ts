/**
 * Steering Behavior
 *
 * Real-time movement that continuously adjusts direction toward the goal
 * while avoiding nearby obstacles. No grid, no pre-computation.
 *
 * Pros:
 * - Very fast, O(1) per update
 * - Smooth, natural-looking movement
 * - Works well for short distances
 * - No memory overhead
 *
 * Cons:
 * - Can get stuck in local minima (concave obstacles)
 * - Cannot navigate complex mazes
 * - Best combined with waypoints from another algorithm
 */

import * as THREE from 'three';
import type { PathfindingAlgorithm, PathfindingAlgorithmResult, AlgorithmOptions } from '../types';
import { algorithmRegistry } from '../algorithmRegistry';
import { worldCollisionGrid } from '@/lib/spatialHashGrid';

const _testBox = new THREE.Box3();
const _testMin = new THREE.Vector3();
const _testMax = new THREE.Vector3();

function isWalkable(x: number, z: number, entityRadius: number, entityHeight: number): boolean {
  _testMin.set(x - entityRadius, 0.1, z - entityRadius);
  _testMax.set(x + entityRadius, entityHeight, z + entityRadius);
  _testBox.set(_testMin, _testMax);
  const count = worldCollisionGrid.getNearbyFiltered(x, z, entityRadius + 1, 0, entityHeight);
  const colliders = worldCollisionGrid.nearbyResult;
  for (let i = 0; i < count; i++) {
    if (_testBox.intersectsBox(colliders[i])) return false;
  }
  return true;
}

/**
 * Generate intermediate waypoints using steering behavior
 * This creates a smooth path by sampling the steering direction
 */
function generateSteeringPath(
  startX: number,
  startZ: number,
  goalX: number,
  goalZ: number,
  entityRadius: number,
  entityHeight: number,
  maxSteps: number,
  stepSize: number
): { path: THREE.Vector3[]; nodesExplored: number } {
  const path: THREE.Vector3[] = [new THREE.Vector3(startX, 0, startZ)];

  let currentX = startX;
  let currentZ = startZ;
  let steps = 0;

  const avoidanceRays = 8; // Number of rays for obstacle detection
  const avoidanceRange = entityRadius * 4;

  while (steps < maxSteps) {
    steps++;

    // Check if we've reached the goal
    const dx = goalX - currentX;
    const dz = goalZ - currentZ;
    const distToGoal = Math.sqrt(dx * dx + dz * dz);

    if (distToGoal < stepSize * 2) {
      path.push(new THREE.Vector3(goalX, 0, goalZ));
      return { path, nodesExplored: steps };
    }

    // Calculate desired direction (toward goal)
    const desiredX = dx / distToGoal;
    const desiredZ = dz / distToGoal;

    // Calculate avoidance force by raycasting
    let avoidX = 0;
    let avoidZ = 0;

    for (let i = 0; i < avoidanceRays; i++) {
      const angle = (i / avoidanceRays) * Math.PI * 2;
      const rayX = Math.cos(angle);
      const rayZ = Math.sin(angle);

      // Check if there's an obstacle in this direction
      for (let d = entityRadius; d < avoidanceRange; d += entityRadius) {
        const testX = currentX + rayX * d;
        const testZ = currentZ + rayZ * d;

        if (!isWalkable(testX, testZ, entityRadius, entityHeight)) {
          // Obstacle found - add repulsion force
          const strength = 1 - (d / avoidanceRange);
          avoidX -= rayX * strength;
          avoidZ -= rayZ * strength;
          break;
        }
      }
    }

    // Normalize avoidance if significant
    const avoidMag = Math.sqrt(avoidX * avoidX + avoidZ * avoidZ);
    if (avoidMag > 0.1) {
      avoidX /= avoidMag;
      avoidZ /= avoidMag;
    }

    // Blend desired direction with avoidance
    const avoidWeight = Math.min(avoidMag, 1);
    const desiredWeight = 1 - avoidWeight * 0.7;

    let finalX = desiredX * desiredWeight + avoidX * avoidWeight;
    let finalZ = desiredZ * desiredWeight + avoidZ * avoidWeight;

    // Normalize final direction
    const finalMag = Math.sqrt(finalX * finalX + finalZ * finalZ);
    if (finalMag > 0.01) {
      finalX /= finalMag;
      finalZ /= finalMag;
    } else {
      // Stuck - try random direction
      const randAngle = Math.random() * Math.PI * 2;
      finalX = Math.cos(randAngle);
      finalZ = Math.sin(randAngle);
    }

    // Move in the final direction
    const nextX = currentX + finalX * stepSize;
    const nextZ = currentZ + finalZ * stepSize;

    // Check if next position is walkable
    if (isWalkable(nextX, nextZ, entityRadius, entityHeight)) {
      currentX = nextX;
      currentZ = nextZ;
      path.push(new THREE.Vector3(currentX, 0, currentZ));
    } else {
      // Try sliding along walls
      if (isWalkable(nextX, currentZ, entityRadius, entityHeight)) {
        currentX = nextX;
        path.push(new THREE.Vector3(currentX, 0, currentZ));
      } else if (isWalkable(currentX, nextZ, entityRadius, entityHeight)) {
        currentZ = nextZ;
        path.push(new THREE.Vector3(currentX, 0, currentZ));
      } else {
        // Completely stuck
        break;
      }
    }
  }

  // Add goal if we're close enough
  const finalDist = Math.sqrt(
    Math.pow(goalX - currentX, 2) + Math.pow(goalZ - currentZ, 2)
  );
  if (finalDist < stepSize * 4) {
    path.push(new THREE.Vector3(goalX, 0, goalZ));
  }

  return { path: path.length > 1 ? path : null, nodesExplored: steps };
}

const steeringAlgorithm: PathfindingAlgorithm = {
  code: 'steering',
  name: 'Steering Behavior',
  description: 'Real-time movement using obstacle avoidance rays. No grid or pre-computation - just move toward the goal while avoiding nearby obstacles. Very fast and smooth but can get stuck in complex environments. Best for short distances or open areas.',
  category: 'steering',

  findPath(
    startX: number,
    startZ: number,
    goalX: number,
    goalZ: number,
    entityRadius: number,
    entityHeight: number,
    options: AlgorithmOptions
  ): PathfindingAlgorithmResult {
    const { maxIterations, algorithmParams } = options;
    const stepSize = (algorithmParams?.stepSize as number) || 1.0;

    if (!isWalkable(startX, startZ, entityRadius, entityHeight)) {
      return { path: null, nodesExplored: 0 };
    }

    // For very short distances, just go direct
    const dx = goalX - startX;
    const dz = goalZ - startZ;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist < stepSize * 2) {
      if (isWalkable(goalX, goalZ, entityRadius, entityHeight)) {
        return { path: [new THREE.Vector3(goalX, 0, goalZ)], nodesExplored: 1 };
      }
      return { path: null, nodesExplored: 1 };
    }

    const result = generateSteeringPath(
      startX, startZ,
      goalX, goalZ,
      entityRadius, entityHeight,
      maxIterations,
      stepSize
    );

    return {
      path: result.path ? result.path : null,
      nodesExplored: result.nodesExplored,
    };
  },
};

algorithmRegistry.register(steeringAlgorithm);
export default steeringAlgorithm;
