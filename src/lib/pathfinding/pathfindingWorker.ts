/**
 * pathfindingWorker — Web Worker for off-thread A* pathfinding.
 *
 * Receives a height map snapshot and pathfinding request from the main thread,
 * runs A* using the height map for O(1) walkability checks, and returns the path.
 *
 * No THREE.js, no DOM, no collision grid — fully standalone.
 */

// ---- Types (duplicated here to avoid importing from main thread) ----

interface WorkerRequest {
  type: 'findPath';
  id: number;
  heightMap: Uint16Array;
  mapOriginX: number;
  mapOriginZ: number;
  mapWidth: number;
  mapDepth: number;
  startX: number;
  startZ: number;
  goalX: number;
  goalZ: number;
  entityRadius: number;
  entityHeight: number;
  entityFeetY: number;
  gridSize: number;
  maxIterations: number;
}

interface WorkerResponse {
  type: 'pathResult';
  id: number;
  success: boolean;
  path: Float32Array | null;
  nodesExplored: number;
  computeTimeMs: number;
  error?: string;
}

// ---- Height map walkability ----

let _hm: Uint16Array;
let _hmOriginX: number;
let _hmOriginZ: number;
let _hmWidth: number;
let _hmDepth: number;

function setupHeightMap(
  hm: Uint16Array,
  originX: number,
  originZ: number,
  width: number,
  depth: number
): void {
  _hm = hm;
  _hmOriginX = originX;
  _hmOriginZ = originZ;
  _hmWidth = width;
  _hmDepth = depth;
}

/**
 * O(1) walkability check using the height map.
 * An entity can walk at (x, z) if the highest block at that cell
 * doesn't extend above the entity's feet.
 *
 * For entities with radius > 0.5, we check multiple cells.
 */
function isWalkable(
  x: number,
  z: number,
  entityRadius: number,
  entityFeetY: number
): boolean {
  // Check cells covered by entity's footprint
  const minX = Math.floor(x - entityRadius) - _hmOriginX;
  const maxX = Math.floor(x + entityRadius) - _hmOriginX;
  const minZ = Math.floor(z - entityRadius) - _hmOriginZ;
  const maxZ = Math.floor(z + entityRadius) - _hmOriginZ;

  for (let lx = minX; lx <= maxX; lx++) {
    for (let lz = minZ; lz <= maxZ; lz++) {
      // Out of bounds = treat as walkable (unloaded area)
      if (lx < 0 || lx >= _hmWidth || lz < 0 || lz >= _hmDepth) continue;

      const maxH = _hm[lz * _hmWidth + lx];
      if (maxH > entityFeetY) return false;
    }
  }

  return true;
}

// ---- A* Implementation (self-contained, no THREE.js) ----

interface PathNode {
  x: number;
  z: number;
  g: number;
  h: number;
  f: number;
  parent: PathNode | null;
}

/** Binary min-heap for the open set */
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
      const parent = (i - 1) >> 1;
      if (this.nodes[parent].f <= this.nodes[i].f) break;
      const tmp = this.nodes[parent];
      this.nodes[parent] = this.nodes[i];
      this.nodes[i] = tmp;
      i = parent;
    }
  }

  private bubbleDown(i: number): void {
    const len = this.nodes.length;
    while (true) {
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      let smallest = i;
      if (left < len && this.nodes[left].f < this.nodes[smallest].f) smallest = left;
      if (right < len && this.nodes[right].f < this.nodes[smallest].f) smallest = right;
      if (smallest === i) break;
      const tmp = this.nodes[i];
      this.nodes[i] = this.nodes[smallest];
      this.nodes[smallest] = tmp;
      i = smallest;
    }
  }
}

/** Integer-based node key for Map lookups (avoids string allocation) */
function nodeKeyInt(x: number, z: number): number {
  // Pack two 16-bit signed values into one 32-bit integer
  // Range: -32768 to 32767 per axis (covers ±65536 world units at gridSize=2)
  return ((Math.round(x) & 0xFFFF) << 16) | (Math.round(z) & 0xFFFF);
}

function heuristic(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

function findNearestWalkable(
  x: number,
  z: number,
  entityRadius: number,
  entityFeetY: number,
  maxRadius: number,
  gridSize: number
): { x: number; z: number } | null {
  for (let r = gridSize; r <= maxRadius * gridSize; r += gridSize) {
    for (let dx = -r; dx <= r; dx += gridSize) {
      for (let dz = -r; dz <= r; dz += gridSize) {
        if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
        const nx = x + dx;
        const nz = z + dz;
        if (isWalkable(nx, nz, entityRadius, entityFeetY)) {
          return { x: nx, z: nz };
        }
      }
    }
  }
  return null;
}

const MAX_PATH_LENGTH = 500;

function runAStar(
  startX: number,
  startZ: number,
  goalX: number,
  goalZ: number,
  entityRadius: number,
  entityFeetY: number,
  gridSize: number,
  maxIterations: number
): { path: Float32Array | null; nodesExplored: number } {
  const sx = Math.round(startX / gridSize) * gridSize;
  const sz = Math.round(startZ / gridSize) * gridSize;
  const gx = Math.round(goalX / gridSize) * gridSize;
  const gz = Math.round(goalZ / gridSize) * gridSize;

  // Check start/goal walkability
  if (!isWalkable(sx, sz, entityRadius, entityFeetY)) {
    const near = findNearestWalkable(sx, sz, entityRadius, entityFeetY, 8, gridSize);
    if (!near) return { path: null, nodesExplored: 0 };
    return runAStar(near.x, near.z, goalX, goalZ, entityRadius, entityFeetY, gridSize, maxIterations);
  }

  if (!isWalkable(gx, gz, entityRadius, entityFeetY)) {
    const near = findNearestWalkable(gx, gz, entityRadius, entityFeetY, 10, gridSize);
    if (!near) return { path: null, nodesExplored: 0 };
    return runAStar(startX, startZ, near.x, near.z, entityRadius, entityFeetY, gridSize, maxIterations);
  }

  // Already at goal
  if (Math.abs(sx - gx) + Math.abs(sz - gz) <= gridSize) {
    const path = new Float32Array(2);
    path[0] = gx;
    path[1] = gz;
    return { path, nodesExplored: 1 };
  }

  const openSet = new MinHeap();
  const closedSet = new Map<number, PathNode>();
  const openMap = new Map<number, PathNode>();

  const startNode: PathNode = {
    x: sx, z: sz,
    g: 0,
    h: heuristic(sx, sz, gx, gz),
    f: heuristic(sx, sz, gx, gz),
    parent: null,
  };

  openSet.push(startNode);
  openMap.set(nodeKeyInt(sx, sz), startNode);

  const DIAG_COST = gridSize * 1.414;
  const dirs = [
    { dx: 1, dz: 0, cost: gridSize },
    { dx: -1, dz: 0, cost: gridSize },
    { dx: 0, dz: 1, cost: gridSize },
    { dx: 0, dz: -1, cost: gridSize },
    { dx: 1, dz: 1, cost: DIAG_COST },
    { dx: -1, dz: 1, cost: DIAG_COST },
    { dx: 1, dz: -1, cost: DIAG_COST },
    { dx: -1, dz: -1, cost: DIAG_COST },
  ];

  let iterations = 0;

  while (openSet.length > 0 && iterations < maxIterations) {
    iterations++;

    const current = openSet.pop()!;
    const currentKey = nodeKeyInt(current.x, current.z);
    openMap.delete(currentKey);
    closedSet.set(currentKey, current);

    // Reached goal
    if (current.x === gx && current.z === gz) {
      // Reconstruct path
      const waypoints: Array<{ x: number; z: number }> = [];
      let node: PathNode | null = current;
      while (node !== null && waypoints.length < MAX_PATH_LENGTH) {
        waypoints.push({ x: node.x, z: node.z });
        node = node.parent;
      }
      waypoints.reverse();

      // Simplify: remove collinear waypoints
      const simplified: Array<{ x: number; z: number }> = [waypoints[0]];
      for (let i = 1; i < waypoints.length - 1; i++) {
        const prev = simplified[simplified.length - 1];
        const curr = waypoints[i];
        const next = waypoints[i + 1];
        if (Math.sign(curr.x - prev.x) !== Math.sign(next.x - curr.x) ||
            Math.sign(curr.z - prev.z) !== Math.sign(next.z - curr.z)) {
          simplified.push(curr);
        }
      }
      if (waypoints.length > 1) simplified.push(waypoints[waypoints.length - 1]);

      // Pack into Float32Array [x0,z0, x1,z1, ...]
      const path = new Float32Array(simplified.length * 2);
      for (let i = 0; i < simplified.length; i++) {
        path[i * 2] = simplified[i].x;
        path[i * 2 + 1] = simplified[i].z;
      }
      return { path, nodesExplored: iterations };
    }

    // Explore neighbors
    for (const dir of dirs) {
      const nx = current.x + dir.dx * gridSize;
      const nz = current.z + dir.dz * gridSize;
      const nKey = nodeKeyInt(nx, nz);

      if (closedSet.has(nKey)) continue;

      if (!isWalkable(nx, nz, entityRadius, entityFeetY)) {
        closedSet.set(nKey, { x: nx, z: nz, g: Infinity, h: 0, f: Infinity, parent: null });
        continue;
      }

      // Prevent corner cutting on diagonals
      if (dir.dx !== 0 && dir.dz !== 0) {
        if (!isWalkable(current.x + dir.dx * gridSize, current.z, entityRadius, entityFeetY) ||
            !isWalkable(current.x, current.z + dir.dz * gridSize, entityRadius, entityFeetY)) {
          continue;
        }
      }

      const tentativeG = current.g + dir.cost;
      const existingOpen = openMap.get(nKey);
      if (existingOpen && tentativeG >= existingOpen.g) continue;

      const h = heuristic(nx, nz, gx, gz);
      const newNode: PathNode = {
        x: nx, z: nz,
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
}

// ---- Worker message handler ----

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;

  if (req.type === 'findPath') {
    const t0 = performance.now();

    setupHeightMap(req.heightMap, req.mapOriginX, req.mapOriginZ, req.mapWidth, req.mapDepth);

    const result = runAStar(
      req.startX,
      req.startZ,
      req.goalX,
      req.goalZ,
      req.entityRadius,
      req.entityFeetY,
      req.gridSize,
      req.maxIterations
    );

    const computeTimeMs = performance.now() - t0;

    const response: WorkerResponse = {
      type: 'pathResult',
      id: req.id,
      success: result.path !== null,
      path: result.path,
      nodesExplored: result.nodesExplored,
      computeTimeMs,
    };

    // Transfer the path buffer back (zero-copy)
    const transferables: Transferable[] = [];
    if (result.path) transferables.push(result.path.buffer);

    (self as unknown as Worker).postMessage(response, transferables);
  }
};
