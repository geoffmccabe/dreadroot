/**
 * A* Search Algorithm
 *
 * Classic A* pathfinding using a grid-based approach.
 * Uses Euclidean distance heuristic and supports 8-directional movement.
 *
 * Pros:
 * - Guaranteed to find shortest path (optimal)
 * - Well-balanced between speed and accuracy
 * - Good for most general pathfinding needs
 *
 * Cons:
 * - Can be slow for very long distances
 * - Memory usage grows with search area
 */

import * as THREE from 'three';
import type { PathfindingAlgorithm, PathfindingAlgorithmResult, AlgorithmOptions } from '../types';
import { algorithmRegistry } from '../algorithmRegistry';
import { worldCollisionGrid } from '@/lib/spatialHashGrid';

// Pre-allocated reusable objects for collision checking
const _testBox = new THREE.Box3();
const _testMin = new THREE.Vector3();
const _testMax = new THREE.Vector3();

interface PathNode {
  x: number;
  z: number;
  g: number; // Cost from start
  h: number; // Heuristic to goal
  f: number; // Total cost (g + h)
  parent: PathNode | null;
}

/**
 * Binary min-heap for efficient priority queue operations
 */
class MinHeap {
  private nodes: PathNode[] = [];

  push(node: PathNode): void {
    this.nodes.push(node);
    this.bubbleUp(this.nodes.length - 1);
  }

  pop(): PathNode | undefined {
    if (this.nodes.length === 0) return undefined;
    const result = this.nodes[0];
    const last = this.nodes.pop()!;
    if (this.nodes.length > 0) {
      this.nodes[0] = last;
      this.bubbleDown(0);
    }
    return result;
  }

  get length(): number {
    return this.nodes.length;
  }

  private bubbleUp(i: number): void {
    while (i > 0) {
      const parent = Math.floor((i - 1) / 2);
      if (this.nodes[parent].f <= this.nodes[i].f) break;
      [this.nodes[parent], this.nodes[i]] = [this.nodes[i], this.nodes[parent]];
      i = parent;
    }
  }

  private bubbleDown(i: number): void {
    while (true) {
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      let smallest = i;

      if (left < this.nodes.length && this.nodes[left].f < this.nodes[smallest].f) {
        smallest = left;
      }
      if (right < this.nodes.length && this.nodes[right].f < this.nodes[smallest].f) {
        smallest = right;
      }
      if (smallest === i) break;

      [this.nodes[i], this.nodes[smallest]] = [this.nodes[smallest], this.nodes[i]];
      i = smallest;
    }
  }
}

/**
 * Check if a position is walkable (no collision at ground level)
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

/**
 * Get the node key for a position (for hash map lookup)
 */
function nodeKey(x: number, z: number): string {
  return `${Math.round(x)},${Math.round(z)}`;
}

/**
 * Euclidean distance heuristic
 */
function heuristic(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

/**
 * Find nearest walkable position to a blocked target
 */
function findNearestWalkable(
  x: number,
  z: number,
  entityRadius: number,
  entityHeight: number,
  maxRadius: number,
  gridSize: number
): { x: number; z: number } | null {
  for (let r = gridSize; r <= maxRadius * gridSize; r += gridSize) {
    for (let dx = -r; dx <= r; dx += gridSize) {
      for (let dz = -r; dz <= r; dz += gridSize) {
        if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
        const nx = x + dx;
        const nz = z + dz;
        if (isWalkable(nx, nz, entityRadius, entityHeight)) {
          return { x: nx, z: nz };
        }
      }
    }
  }
  return null;
}

/**
 * Simplify path by removing collinear waypoints
 */
function simplifyPath(path: THREE.Vector3[]): THREE.Vector3[] {
  if (path.length <= 2) return path;

  const simplified: THREE.Vector3[] = [path[0]];

  for (let i = 1; i < path.length - 1; i++) {
    const prev = simplified[simplified.length - 1];
    const curr = path[i];
    const next = path[i + 1];

    const dx1 = curr.x - prev.x;
    const dz1 = curr.z - prev.z;
    const dx2 = next.x - curr.x;
    const dz2 = next.z - curr.z;

    if (Math.sign(dx1) !== Math.sign(dx2) || Math.sign(dz1) !== Math.sign(dz2)) {
      simplified.push(curr);
    }
  }

  simplified.push(path[path.length - 1]);
  return simplified;
}

/**
 * A* Search Algorithm Implementation
 */
const astarAlgorithm: PathfindingAlgorithm = {
  code: 'astar',
  name: 'A* Search',
  description: 'Classic A* pathfinding algorithm. Uses Euclidean distance heuristic with 8-directional movement. Guaranteed to find the shortest path. Best for general-purpose pathfinding where accuracy is important.',
  category: 'grid',
  isDefault: true,

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

    // Round to grid
    const sx = Math.round(startX / gridSize) * gridSize;
    const sz = Math.round(startZ / gridSize) * gridSize;
    const gx = Math.round(goalX / gridSize) * gridSize;
    const gz = Math.round(goalZ / gridSize) * gridSize;

    // Check if start is blocked
    if (!isWalkable(sx, sz, entityRadius, entityHeight)) {
      const nearbyStart = findNearestWalkable(sx, sz, entityRadius, entityHeight, 8, gridSize);
      if (!nearbyStart) return { path: null, nodesExplored: 0 };
      return this.findPath(nearbyStart.x, nearbyStart.z, goalX, goalZ, entityRadius, entityHeight, options);
    }

    // Check if goal is blocked
    if (!isWalkable(gx, gz, entityRadius, entityHeight)) {
      const nearbyGoal = findNearestWalkable(gx, gz, entityRadius, entityHeight, 10, gridSize);
      if (!nearbyGoal) return { path: null, nodesExplored: 0 };
      return this.findPath(startX, startZ, nearbyGoal.x, nearbyGoal.z, entityRadius, entityHeight, options);
    }

    // Already at goal
    const distToGoal = Math.abs(sx - gx) + Math.abs(sz - gz);
    if (distToGoal <= gridSize) {
      return { path: [new THREE.Vector3(gx, 0, gz)], nodesExplored: 1 };
    }

    const openSet = new MinHeap();
    const closedSet = new Map<string, PathNode>();
    const openMap = new Map<string, PathNode>();

    const startNode: PathNode = {
      x: sx,
      z: sz,
      g: 0,
      h: heuristic(sx, sz, gx, gz),
      f: heuristic(sx, sz, gx, gz),
      parent: null,
    };

    openSet.push(startNode);
    openMap.set(nodeKey(sx, sz), startNode);

    // 8-directional movement
    const directions = [
      { dx: 1, dz: 0, cost: gridSize },
      { dx: -1, dz: 0, cost: gridSize },
      { dx: 0, dz: 1, cost: gridSize },
      { dx: 0, dz: -1, cost: gridSize },
      { dx: 1, dz: 1, cost: gridSize * 1.414 },
      { dx: -1, dz: 1, cost: gridSize * 1.414 },
      { dx: 1, dz: -1, cost: gridSize * 1.414 },
      { dx: -1, dz: -1, cost: gridSize * 1.414 },
    ];

    let iterations = 0;

    while (openSet.length > 0 && iterations < maxIterations) {
      iterations++;

      const current = openSet.pop()!;
      const currentKey = nodeKey(current.x, current.z);
      openMap.delete(currentKey);
      closedSet.set(currentKey, current);

      // Reached goal
      if (current.x === gx && current.z === gz) {
        const path: THREE.Vector3[] = [];
        let node: PathNode | null = current;
        while (node !== null && path.length < maxPathLength) {
          path.unshift(new THREE.Vector3(node.x, 0, node.z));
          node = node.parent;
        }
        return { path: simplifyPath(path), nodesExplored: iterations };
      }

      // Explore neighbors
      for (const dir of directions) {
        const nx = current.x + dir.dx * gridSize;
        const nz = current.z + dir.dz * gridSize;
        const nKey = nodeKey(nx, nz);

        if (closedSet.has(nKey)) continue;

        if (!isWalkable(nx, nz, entityRadius, entityHeight)) {
          closedSet.set(nKey, { x: nx, z: nz, g: Infinity, h: 0, f: Infinity, parent: null });
          continue;
        }

        // Prevent corner cutting on diagonals
        if (dir.dx !== 0 && dir.dz !== 0) {
          if (!isWalkable(current.x + dir.dx * gridSize, current.z, entityRadius, entityHeight) ||
              !isWalkable(current.x, current.z + dir.dz * gridSize, entityRadius, entityHeight)) {
            continue;
          }
        }

        const tentativeG = current.g + dir.cost;

        const existingOpen = openMap.get(nKey);
        if (existingOpen && tentativeG >= existingOpen.g) {
          continue;
        }

        const h = heuristic(nx, nz, gx, gz);
        const newNode: PathNode = {
          x: nx,
          z: nz,
          g: tentativeG,
          h,
          f: tentativeG + h,
          parent: current,
        };

        openSet.push(newNode);
        openMap.set(nKey, newNode);
      }
    }

    return { path: null, nodesExplored: iterations };
  },
};

// Register the algorithm
algorithmRegistry.register(astarAlgorithm);

export default astarAlgorithm;
