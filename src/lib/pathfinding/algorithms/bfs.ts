/**
 * Breadth-First Search (BFS)
 *
 * Simple graph traversal that explores all neighbors at each depth level.
 * All moves have equal cost (no diagonal penalty).
 *
 * Pros:
 * - Very simple and predictable
 * - Finds shortest path in terms of number of steps
 * - Low memory overhead per node
 *
 * Cons:
 * - Does not account for diagonal movement cost
 * - Slower than A* for most cases
 * - Paths may look unnatural (prefers cardinal directions)
 */

import * as THREE from 'three';
import type { PathfindingAlgorithm, PathfindingAlgorithmResult, AlgorithmOptions } from '../types';
import { algorithmRegistry } from '../algorithmRegistry';
import { worldCollisionGrid } from '@/lib/spatialHashGrid';

const _testBox = new THREE.Box3();
const _testMin = new THREE.Vector3();
const _testMax = new THREE.Vector3();

interface PathNode {
  x: number;
  z: number;
  parent: PathNode | null;
}

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

function nodeKey(x: number, z: number): string {
  return `${Math.round(x)},${Math.round(z)}`;
}

const bfsAlgorithm: PathfindingAlgorithm = {
  code: 'bfs',
  name: 'Breadth-First Search',
  description: 'Simple level-by-level graph exploration. Treats all moves as equal cost, finding the path with fewest steps. Good for simple grid-based movement where all directions are equally weighted. Paths may appear more "robotic" than A*.',
  category: 'grid',

  findPath(
    startX: number,
    startZ: number,
    goalX: number,
    goalZ: number,
    entityRadius: number,
    entityHeight: number,
    options: AlgorithmOptions
  ): PathfindingAlgorithmResult {
    const { gridSize, maxIterations, maxPathLength } = options;

    const sx = Math.round(startX / gridSize) * gridSize;
    const sz = Math.round(startZ / gridSize) * gridSize;
    const gx = Math.round(goalX / gridSize) * gridSize;
    const gz = Math.round(goalZ / gridSize) * gridSize;

    if (!isWalkable(sx, sz, entityRadius, entityHeight)) return { path: null, nodesExplored: 0 };
    if (!isWalkable(gx, gz, entityRadius, entityHeight)) return { path: null, nodesExplored: 0 };

    if (Math.abs(sx - gx) + Math.abs(sz - gz) <= gridSize) {
      return { path: [new THREE.Vector3(gx, 0, gz)], nodesExplored: 1 };
    }

    const queue: PathNode[] = [];
    const visited = new Set<string>();

    const startNode: PathNode = { x: sx, z: sz, parent: null };
    queue.push(startNode);
    visited.add(nodeKey(sx, sz));

    // 8-directional movement (equal cost in BFS)
    const directions = [
      { dx: 1, dz: 0 },
      { dx: -1, dz: 0 },
      { dx: 0, dz: 1 },
      { dx: 0, dz: -1 },
      { dx: 1, dz: 1 },
      { dx: -1, dz: 1 },
      { dx: 1, dz: -1 },
      { dx: -1, dz: -1 },
    ];

    let iterations = 0;

    while (queue.length > 0 && iterations < maxIterations) {
      iterations++;
      const current = queue.shift()!;

      if (current.x === gx && current.z === gz) {
        const path: THREE.Vector3[] = [];
        let node: PathNode | null = current;
        while (node && path.length < maxPathLength) {
          path.unshift(new THREE.Vector3(node.x, 0, node.z));
          node = node.parent;
        }
        return { path, nodesExplored: iterations };
      }

      for (const dir of directions) {
        const nx = current.x + dir.dx * gridSize;
        const nz = current.z + dir.dz * gridSize;
        const nKey = nodeKey(nx, nz);

        if (visited.has(nKey)) continue;
        if (!isWalkable(nx, nz, entityRadius, entityHeight)) {
          visited.add(nKey);
          continue;
        }

        // Prevent corner cutting
        if (dir.dx !== 0 && dir.dz !== 0) {
          if (!isWalkable(current.x + dir.dx * gridSize, current.z, entityRadius, entityHeight) ||
              !isWalkable(current.x, current.z + dir.dz * gridSize, entityRadius, entityHeight)) {
            continue;
          }
        }

        visited.add(nKey);
        queue.push({ x: nx, z: nz, parent: current });
      }
    }

    return { path: null, nodesExplored: iterations };
  },
};

algorithmRegistry.register(bfsAlgorithm);
export default bfsAlgorithm;
