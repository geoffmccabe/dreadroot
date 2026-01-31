/**
 * Greedy Best-First Search
 *
 * Uses only the heuristic (distance to goal) to choose the next node.
 * Always moves toward the goal without considering path cost.
 *
 * Pros:
 * - Very fast, minimal computation
 * - Works well in open spaces
 * - Good for when "close enough" is acceptable
 *
 * Cons:
 * - Can get stuck in dead ends
 * - May take very long paths around obstacles
 * - Not guaranteed to find a path even if one exists
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
  h: number; // Heuristic only
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
      if (this.nodes[parent].h <= this.nodes[i].h) break;
      [this.nodes[parent], this.nodes[i]] = [this.nodes[i], this.nodes[parent]];
      i = parent;
    }
  }

  private bubbleDown(i: number): void {
    while (true) {
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      let smallest = i;
      if (left < this.nodes.length && this.nodes[left].h < this.nodes[smallest].h) smallest = left;
      if (right < this.nodes.length && this.nodes[right].h < this.nodes[smallest].h) smallest = right;
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

const greedyBestAlgorithm: PathfindingAlgorithm = {
  code: 'greedy',
  name: 'Greedy Best-First Search',
  description: 'Always moves toward the goal using only distance as a guide, ignoring path cost. Very fast but can get stuck in dead ends or take long detours around obstacles. Best for open areas or when speed matters more than path quality.',
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

    const openSet = new MinHeap();
    const visited = new Set<string>();

    const startNode: PathNode = { x: sx, z: sz, h: heuristic(sx, sz, gx, gz), parent: null };
    openSet.push(startNode);

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

    while (openSet.length > 0 && iterations < maxIterations) {
      iterations++;
      const current = openSet.pop()!;
      const currentKey = nodeKey(current.x, current.z);

      if (visited.has(currentKey)) continue;
      visited.add(currentKey);

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

        if (dir.dx !== 0 && dir.dz !== 0) {
          if (!isWalkable(current.x + dir.dx * gridSize, current.z, entityRadius, entityHeight) ||
              !isWalkable(current.x, current.z + dir.dz * gridSize, entityRadius, entityHeight)) {
            continue;
          }
        }

        openSet.push({ x: nx, z: nz, h: heuristic(nx, nz, gx, gz), parent: current });
      }
    }

    return { path: null, nodesExplored: iterations };
  },
};

algorithmRegistry.register(greedyBestAlgorithm);
export default greedyBestAlgorithm;
