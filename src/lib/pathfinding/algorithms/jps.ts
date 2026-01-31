/**
 * Jump Point Search (JPS)
 *
 * Optimized A* that "jumps" over redundant nodes in uniform-cost grids.
 * Identifies "jump points" - nodes where the path could change direction.
 *
 * Pros:
 * - Much faster than A* in open spaces
 * - Still finds optimal paths
 * - Reduces nodes explored dramatically
 *
 * Cons:
 * - More complex implementation
 * - Requires uniform cost grid (no terrain costs)
 * - Memory overhead for jump point detection
 */

import * as THREE from 'three';
import type { PathfindingAlgorithm, PathfindingAlgorithmResult, AlgorithmOptions } from '../types';
import { algorithmRegistry } from '../algorithmRegistry';
import { worldCollisionGrid } from '@/lib/spatialHashGrid';

const _testBox = new THREE.Box3();
const _testMin = new THREE.Vector3();
const _testMax = new THREE.Vector3();

interface JPSNode {
  x: number;
  z: number;
  g: number;
  f: number;
  parent: JPSNode | null;
}

class MinHeap {
  private nodes: JPSNode[] = [];

  push(node: JPSNode): void {
    this.nodes.push(node);
    this.bubbleUp(this.nodes.length - 1);
  }

  pop(): JPSNode | undefined {
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
      if (left < this.nodes.length && this.nodes[left].f < this.nodes[smallest].f) smallest = left;
      if (right < this.nodes.length && this.nodes[right].f < this.nodes[smallest].f) smallest = right;
      if (smallest === i) break;
      [this.nodes[i], this.nodes[smallest]] = [this.nodes[smallest], this.nodes[i]];
      i = smallest;
    }
  }
}

let _entityRadius = 0;
let _entityHeight = 0;
let _gridSize = 1;

function isWalkable(x: number, z: number): boolean {
  _testMin.set(x - _entityRadius, 0.1, z - _entityRadius);
  _testMax.set(x + _entityRadius, _entityHeight, z + _entityRadius);
  _testBox.set(_testMin, _testMax);
  const count = worldCollisionGrid.getNearbyFiltered(x, z, _entityRadius + 1, 0, _entityHeight);
  const colliders = worldCollisionGrid.nearbyResult;
  for (let i = 0; i < count; i++) {
    if (_testBox.intersectsBox(colliders[i])) return false;
  }
  return true;
}

function nodeKey(x: number, z: number): string {
  return `${Math.round(x)},${Math.round(z)}`;
}

function heuristic(ax: number, az: number, bx: number, bz: number): number {
  return Math.sqrt((ax - bx) ** 2 + (az - bz) ** 2);
}

/**
 * Jump in a cardinal direction until hitting obstacle or finding jump point
 */
function jumpCardinal(
  x: number,
  z: number,
  dx: number,
  dz: number,
  gx: number,
  gz: number,
  maxJumps: number
): { x: number; z: number } | null {
  let jumps = 0;

  while (jumps < maxJumps) {
    const nx = x + dx * _gridSize;
    const nz = z + dz * _gridSize;

    if (!isWalkable(nx, nz)) return null;

    // Found goal
    if (nx === gx && nz === gz) return { x: nx, z: nz };

    // Check for forced neighbors (indicates jump point)
    // For horizontal movement (dx != 0, dz == 0)
    if (dx !== 0 && dz === 0) {
      // Check above and below
      if ((!isWalkable(nx, nz - _gridSize) && isWalkable(nx + dx * _gridSize, nz - _gridSize)) ||
          (!isWalkable(nx, nz + _gridSize) && isWalkable(nx + dx * _gridSize, nz + _gridSize))) {
        return { x: nx, z: nz };
      }
    }
    // For vertical movement (dx == 0, dz != 0)
    else if (dx === 0 && dz !== 0) {
      // Check left and right
      if ((!isWalkable(nx - _gridSize, nz) && isWalkable(nx - _gridSize, nz + dz * _gridSize)) ||
          (!isWalkable(nx + _gridSize, nz) && isWalkable(nx + _gridSize, nz + dz * _gridSize))) {
        return { x: nx, z: nz };
      }
    }

    x = nx;
    z = nz;
    jumps++;
  }

  return null;
}

/**
 * Jump in a diagonal direction
 */
function jumpDiagonal(
  x: number,
  z: number,
  dx: number,
  dz: number,
  gx: number,
  gz: number,
  maxJumps: number
): { x: number; z: number } | null {
  let jumps = 0;

  while (jumps < maxJumps) {
    const nx = x + dx * _gridSize;
    const nz = z + dz * _gridSize;

    // Check diagonal movement is valid (no corner cutting)
    if (!isWalkable(nx, nz) ||
        !isWalkable(x + dx * _gridSize, z) ||
        !isWalkable(x, z + dz * _gridSize)) {
      return null;
    }

    // Found goal
    if (nx === gx && nz === gz) return { x: nx, z: nz };

    // Check cardinal jumps from this position
    if (jumpCardinal(nx, nz, dx, 0, gx, gz, maxJumps) !== null ||
        jumpCardinal(nx, nz, 0, dz, gx, gz, maxJumps) !== null) {
      return { x: nx, z: nz };
    }

    // Check for forced neighbors
    if ((!isWalkable(nx - dx * _gridSize, nz) && isWalkable(nx - dx * _gridSize, nz + dz * _gridSize)) ||
        (!isWalkable(nx, nz - dz * _gridSize) && isWalkable(nx + dx * _gridSize, nz - dz * _gridSize))) {
      return { x: nx, z: nz };
    }

    x = nx;
    z = nz;
    jumps++;
  }

  return null;
}

const jpsAlgorithm: PathfindingAlgorithm = {
  code: 'jps',
  name: 'Jump Point Search',
  description: 'Optimized A* variant that skips redundant nodes by "jumping" to important decision points. Much faster than standard A* in open areas with uniform terrain. Finds optimal paths while exploring far fewer nodes. Best for large open maps.',
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

    // Set module-level variables for isWalkable
    _entityRadius = entityRadius;
    _entityHeight = entityHeight;
    _gridSize = gridSize;

    const sx = Math.round(startX / gridSize) * gridSize;
    const sz = Math.round(startZ / gridSize) * gridSize;
    const gx = Math.round(goalX / gridSize) * gridSize;
    const gz = Math.round(goalZ / gridSize) * gridSize;

    if (!isWalkable(sx, sz)) return { path: null, nodesExplored: 0 };
    if (!isWalkable(gx, gz)) return { path: null, nodesExplored: 0 };

    if (Math.abs(sx - gx) + Math.abs(sz - gz) <= gridSize) {
      return { path: [new THREE.Vector3(gx, 0, gz)], nodesExplored: 1 };
    }

    const openSet = new MinHeap();
    const closedSet = new Set<string>();
    const gScores = new Map<string, number>();

    const startNode: JPSNode = {
      x: sx, z: sz, g: 0,
      f: heuristic(sx, sz, gx, gz),
      parent: null,
    };

    openSet.push(startNode);
    gScores.set(nodeKey(sx, sz), 0);

    // All 8 directions for initial expansion
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
    const maxJumps = Math.floor(maxIterations / 10);

    while (openSet.length > 0 && iterations < maxIterations) {
      iterations++;
      const current = openSet.pop()!;
      const currentKey = nodeKey(current.x, current.z);

      if (closedSet.has(currentKey)) continue;
      closedSet.add(currentKey);

      if (current.x === gx && current.z === gz) {
        const path: THREE.Vector3[] = [];
        let node: JPSNode | null = current;
        while (node && path.length < maxPathLength) {
          path.unshift(new THREE.Vector3(node.x, 0, node.z));
          node = node.parent;
        }
        return { path, nodesExplored: iterations };
      }

      // Expand in all directions from current
      for (const dir of directions) {
        let jumpPoint: { x: number; z: number } | null = null;

        if (dir.dx !== 0 && dir.dz !== 0) {
          // Diagonal
          jumpPoint = jumpDiagonal(current.x, current.z, dir.dx, dir.dz, gx, gz, maxJumps);
        } else {
          // Cardinal
          jumpPoint = jumpCardinal(current.x, current.z, dir.dx, dir.dz, gx, gz, maxJumps);
        }

        if (jumpPoint) {
          const jpKey = nodeKey(jumpPoint.x, jumpPoint.z);
          if (closedSet.has(jpKey)) continue;

          const dist = Math.sqrt(
            (jumpPoint.x - current.x) ** 2 + (jumpPoint.z - current.z) ** 2
          );
          const tentativeG = current.g + dist;

          const existingG = gScores.get(jpKey);
          if (existingG !== undefined && tentativeG >= existingG) continue;

          gScores.set(jpKey, tentativeG);
          const h = heuristic(jumpPoint.x, jumpPoint.z, gx, gz);

          openSet.push({
            x: jumpPoint.x,
            z: jumpPoint.z,
            g: tentativeG,
            f: tentativeG + h,
            parent: current,
          });
        }
      }
    }

    return { path: null, nodesExplored: iterations };
  },
};

algorithmRegistry.register(jpsAlgorithm);
export default jpsAlgorithm;
