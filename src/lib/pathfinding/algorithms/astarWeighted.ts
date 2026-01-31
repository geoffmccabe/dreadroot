/**
 * Weighted A* Search Algorithm
 *
 * A variation of A* that multiplies the heuristic by a weight factor.
 * Higher weights make it faster but potentially suboptimal.
 *
 * Pros:
 * - Faster than standard A* for long distances
 * - Still finds reasonable paths
 * - Configurable trade-off between speed and optimality
 *
 * Cons:
 * - May not find the shortest path
 * - Can take suboptimal routes
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
  g: number;
  h: number;
  f: number;
  parent: PathNode | null;
}

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
      if (left < this.nodes.length && this.nodes[left].f < this.nodes[smallest].f) smallest = left;
      if (right < this.nodes.length && this.nodes[right].f < this.nodes[smallest].f) smallest = right;
      if (smallest === i) break;
      [this.nodes[i], this.nodes[smallest]] = [this.nodes[smallest], this.nodes[i]];
      i = smallest;
    }
  }
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

function heuristic(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

const astarWeightedAlgorithm: PathfindingAlgorithm = {
  code: 'astar_weighted',
  name: 'Weighted A*',
  description: 'Faster variant of A* that trades optimality for speed. Uses a weight multiplier (default 1.5) on the heuristic to explore fewer nodes. Good for long-distance pathfinding where perfect accuracy is not critical.',
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
    const { gridSize, maxIterations, maxPathLength, algorithmParams } = options;
    const weight = (algorithmParams?.weight as number) || 1.5;

    const sx = Math.round(startX / gridSize) * gridSize;
    const sz = Math.round(startZ / gridSize) * gridSize;
    const gx = Math.round(goalX / gridSize) * gridSize;
    const gz = Math.round(goalZ / gridSize) * gridSize;

    if (!isWalkable(sx, sz, entityRadius, entityHeight)) return { path: null, nodesExplored: 0 };
    if (!isWalkable(gx, gz, entityRadius, entityHeight)) return { path: null, nodesExplored: 0 };

    if (Math.abs(sx - gx) + Math.abs(sz - gz) <= gridSize) {
      return { path: [new THREE.Vector3(gx, 0, gz)], nodesExplored: 1 };
    }

    const openSet = new MinHeap();
    const closedSet = new Map<string, PathNode>();
    const openMap = new Map<string, PathNode>();

    const startNode: PathNode = {
      x: sx, z: sz, g: 0,
      h: heuristic(sx, sz, gx, gz) * weight,
      f: heuristic(sx, sz, gx, gz) * weight,
      parent: null,
    };

    openSet.push(startNode);
    openMap.set(nodeKey(sx, sz), startNode);

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

        if (closedSet.has(nKey)) continue;
        if (!isWalkable(nx, nz, entityRadius, entityHeight)) {
          closedSet.set(nKey, { x: nx, z: nz, g: Infinity, h: 0, f: Infinity, parent: null });
          continue;
        }

        if (dir.dx !== 0 && dir.dz !== 0) {
          if (!isWalkable(current.x + dir.dx * gridSize, current.z, entityRadius, entityHeight) ||
              !isWalkable(current.x, current.z + dir.dz * gridSize, entityRadius, entityHeight)) {
            continue;
          }
        }

        const tentativeG = current.g + dir.cost;
        const existingOpen = openMap.get(nKey);
        if (existingOpen && tentativeG >= existingOpen.g) continue;

        const h = heuristic(nx, nz, gx, gz) * weight;
        const newNode: PathNode = { x: nx, z: nz, g: tentativeG, h, f: tentativeG + h, parent: current };
        openSet.push(newNode);
        openMap.set(nKey, newNode);
      }
    }

    return { path: null, nodesExplored: iterations };
  },
};

algorithmRegistry.register(astarWeightedAlgorithm);
export default astarWeightedAlgorithm;
