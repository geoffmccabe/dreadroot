import * as THREE from 'three';
import { worldCollisionGrid } from '@/lib/spatialHashGrid';

/**
 * A* pathfinding for ground-based navigation
 * Optimized for shtickman enemies patrolling between trees
 */

// Grid resolution for pathfinding (1 block = 1 unit)
const GRID_SIZE = 2; // Larger grid for faster pathfinding with less precision
const MAX_ITERATIONS = 3000; // More iterations for longer paths
const MAX_PATH_LENGTH = 500; // Allow longer paths for navigating around forests

// Pre-allocated reusable objects
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

// Simple binary heap for priority queue
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
 * @param x World X coordinate
 * @param z World Z coordinate
 * @param entityRadius Radius of the entity
 * @param entityHeight Height of the entity
 */
function isWalkable(x: number, z: number, entityRadius: number, entityHeight: number): boolean {
  // Check collision at this position
  _testMin.set(x - entityRadius, 0.1, z - entityRadius);
  _testMax.set(x + entityRadius, entityHeight, z + entityRadius);
  _testBox.set(_testMin, _testMax);

  // Query nearby colliders
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
 * Euclidean distance heuristic (better for diagonal movement)
 */
function heuristic(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

/**
 * Find a path from start to goal using A*
 * Returns array of waypoints or null if no path found
 */
export function findPath(
  startX: number,
  startZ: number,
  goalX: number,
  goalZ: number,
  entityRadius: number,
  entityHeight: number
): THREE.Vector3[] | null {
  // Round to grid
  const sx = Math.round(startX / GRID_SIZE) * GRID_SIZE;
  const sz = Math.round(startZ / GRID_SIZE) * GRID_SIZE;
  const gx = Math.round(goalX / GRID_SIZE) * GRID_SIZE;
  const gz = Math.round(goalZ / GRID_SIZE) * GRID_SIZE;

  // Quick check: if start is blocked, find nearest walkable position
  if (!isWalkable(sx, sz, entityRadius, entityHeight)) {
    const nearbyStart = findNearestWalkable(sx, sz, entityRadius, entityHeight, 8);
    if (!nearbyStart) return null;
    return findPath(nearbyStart.x, nearbyStart.z, goalX, goalZ, entityRadius, entityHeight);
  }

  // Quick check: if goal is blocked, try nearby positions
  if (!isWalkable(gx, gz, entityRadius, entityHeight)) {
    // Goal is blocked - find nearest walkable position with larger search radius
    const nearbyGoal = findNearestWalkable(gx, gz, entityRadius, entityHeight, 10);
    if (!nearbyGoal) return null;
    return findPath(startX, startZ, nearbyGoal.x, nearbyGoal.z, entityRadius, entityHeight);
  }

  // Already at goal (within grid tolerance)
  const distToGoal = Math.abs(sx - gx) + Math.abs(sz - gz);
  if (distToGoal <= GRID_SIZE) {
    return [new THREE.Vector3(gx, 0, gz)];
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

  // 8-directional movement (including diagonals)
  // Costs are multiplied by GRID_SIZE for accurate distance calculations
  const directions = [
    { dx: 1, dz: 0, cost: GRID_SIZE },
    { dx: -1, dz: 0, cost: GRID_SIZE },
    { dx: 0, dz: 1, cost: GRID_SIZE },
    { dx: 0, dz: -1, cost: GRID_SIZE },
    { dx: 1, dz: 1, cost: GRID_SIZE * 1.414 },
    { dx: -1, dz: 1, cost: GRID_SIZE * 1.414 },
    { dx: 1, dz: -1, cost: GRID_SIZE * 1.414 },
    { dx: -1, dz: -1, cost: GRID_SIZE * 1.414 },
  ];

  let iterations = 0;

  while (openSet.length > 0 && iterations < MAX_ITERATIONS) {
    iterations++;

    const current = openSet.pop()!;
    const currentKey = nodeKey(current.x, current.z);
    openMap.delete(currentKey);
    closedSet.set(currentKey, current);

    // Reached goal
    if (current.x === gx && current.z === gz) {
      return reconstructPath(current);
    }

    // Explore neighbors
    for (const dir of directions) {
      const nx = current.x + dir.dx * GRID_SIZE;
      const nz = current.z + dir.dz * GRID_SIZE;
      const nKey = nodeKey(nx, nz);

      // Skip if already evaluated
      if (closedSet.has(nKey)) continue;

      // Check if walkable
      if (!isWalkable(nx, nz, entityRadius, entityHeight)) {
        closedSet.set(nKey, { x: nx, z: nz, g: Infinity, h: 0, f: Infinity, parent: null });
        continue;
      }

      // For diagonal movement, also check the two adjacent cells to prevent corner cutting
      if (dir.dx !== 0 && dir.dz !== 0) {
        if (!isWalkable(current.x + dir.dx * GRID_SIZE, current.z, entityRadius, entityHeight) ||
            !isWalkable(current.x, current.z + dir.dz * GRID_SIZE, entityRadius, entityHeight)) {
          continue;
        }
      }

      const tentativeG = current.g + dir.cost;

      const existingOpen = openMap.get(nKey);
      if (existingOpen && tentativeG >= existingOpen.g) {
        continue; // Not a better path
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

  // No path found
  return null;
}

/**
 * Find nearest walkable position to a blocked target
 * Searches in expanding circles using GRID_SIZE steps
 */
function findNearestWalkable(
  x: number,
  z: number,
  entityRadius: number,
  entityHeight: number,
  maxRadius: number
): { x: number; z: number } | null {
  // Search in expanding squares using grid size steps
  for (let r = GRID_SIZE; r <= maxRadius * GRID_SIZE; r += GRID_SIZE) {
    // Check perimeter of the square at radius r
    for (let dx = -r; dx <= r; dx += GRID_SIZE) {
      for (let dz = -r; dz <= r; dz += GRID_SIZE) {
        // Only check perimeter cells
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
 * Reconstruct path from goal node back to start
 */
function reconstructPath(goalNode: PathNode): THREE.Vector3[] {
  const path: THREE.Vector3[] = [];
  let current: PathNode | null = goalNode;

  while (current !== null && path.length < MAX_PATH_LENGTH) {
    path.unshift(new THREE.Vector3(current.x, 0, current.z));
    current = current.parent;
  }

  // Simplify path by removing collinear waypoints
  return simplifyPath(path);
}

/**
 * Remove unnecessary waypoints from path
 */
function simplifyPath(path: THREE.Vector3[]): THREE.Vector3[] {
  if (path.length <= 2) return path;

  const simplified: THREE.Vector3[] = [path[0]];

  for (let i = 1; i < path.length - 1; i++) {
    const prev = simplified[simplified.length - 1];
    const curr = path[i];
    const next = path[i + 1];

    // Check if direction changes
    const dx1 = curr.x - prev.x;
    const dz1 = curr.z - prev.z;
    const dx2 = next.x - curr.x;
    const dz2 = next.z - curr.z;

    // If direction changes, keep this waypoint
    if (Math.sign(dx1) !== Math.sign(dx2) || Math.sign(dz1) !== Math.sign(dz2)) {
      simplified.push(curr);
    }
  }

  simplified.push(path[path.length - 1]);
  return simplified;
}

/**
 * Check if there's a clear line of sight between two points (for path optimization)
 */
export function hasLineOfSight(
  x1: number,
  z1: number,
  x2: number,
  z2: number,
  entityRadius: number,
  entityHeight: number
): boolean {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const dist = Math.sqrt(dx * dx + dz * dz);
  const steps = Math.ceil(dist / GRID_SIZE);

  if (steps === 0) return true;

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = x1 + dx * t;
    const z = z1 + dz * t;
    if (!isWalkable(x, z, entityRadius, entityHeight)) {
      return false;
    }
  }

  return true;
}
