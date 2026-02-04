/**
 * workerBridge — Main-thread bridge to the pathfinding Web Worker.
 *
 * Manages worker lifecycle, message passing, and promise resolution.
 * Height map snapshots are transferred (zero-copy) to the worker.
 */

import * as THREE from 'three';
import { getHeightMapSnapshot } from '@/lib/chunkHeightMap';
import { CHUNK_SIZE } from '@/lib/chunkManager';
import type { PathfindingResult } from './types';

// ---- Worker message types (must match pathfindingWorker.ts) ----

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

// ---- State ----

let worker: Worker | null = null;
let nextRequestId = 1;
const pendingRequests = new Map<number, {
  resolve: (result: PathfindingResult) => void;
  reject: (error: Error) => void;
  timestamp: number;
}>();

// Timeout for stale requests (10 seconds)
const REQUEST_TIMEOUT_MS = 10000;
// Cleanup interval handle
let cleanupIntervalId: ReturnType<typeof setInterval> | null = null;

// ---- Public API ----

/**
 * Spawn the pathfinding Web Worker.
 * Safe to call multiple times — only creates one worker.
 */
export function initPathfindingWorker(): void {
  if (worker) return;

  try {
    worker = new Worker(
      new URL('./pathfindingWorker.ts', import.meta.url),
      { type: 'module' }
    );

    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const res = e.data;
      if (res.type === 'pathResult') {
        const pending = pendingRequests.get(res.id);
        if (!pending) return;
        pendingRequests.delete(res.id);

        // Convert Float32Array path back to Vector3[]
        let path: THREE.Vector3[] | null = null;
        if (res.success && res.path) {
          const arr = res.path;
          path = [];
          for (let i = 0; i < arr.length; i += 2) {
            path.push(new THREE.Vector3(arr[i], 0, arr[i + 1]));
          }
        }

        pending.resolve({
          success: res.success,
          path,
          algorithmUsed: 'astar-worker',
          computeTimeMs: res.computeTimeMs,
          nodesExplored: res.nodesExplored,
          error: res.error,
        });
      }
    };

    worker.onerror = (err) => {
      console.error('[PathfindingWorker] Worker error:', err);
      // Reject all pending requests
      for (const [id, pending] of pendingRequests) {
        pending.reject(new Error('Worker error'));
        pendingRequests.delete(id);
      }
    };

    // Periodically clean up stale requests (worker hang protection)
    cleanupIntervalId = setInterval(cleanupStaleRequests, REQUEST_TIMEOUT_MS);

    console.log('[PathfindingWorker] Worker initialized');
  } catch (err) {
    console.warn('[PathfindingWorker] Failed to create worker:', err);
    worker = null;
  }
}

/**
 * Whether the worker is available.
 */
export function isWorkerAvailable(): boolean {
  return worker !== null;
}

/**
 * Request a path from the worker asynchronously.
 *
 * Extracts a height map snapshot covering the search area and transfers it
 * to the worker (zero-copy). Returns a Promise that resolves with the path.
 *
 * @param searchRadiusChunks — how many chunks around start/goal to include in the height map
 */
export function requestPathAsync(params: {
  startX: number;
  startZ: number;
  goalX: number;
  goalZ: number;
  entityRadius: number;
  entityHeight: number;
  entityFeetY: number;
  gridSize: number;
  maxIterations: number;
  searchRadiusChunks?: number;
}): Promise<PathfindingResult> {
  if (!worker) {
    return Promise.reject(new Error('Pathfinding worker not available'));
  }

  const id = nextRequestId++;
  const extraChunks = params.searchRadiusChunks ?? 3;

  // Compute chunk bounds that cover both start and goal with padding
  const startCX = Math.floor(params.startX / CHUNK_SIZE);
  const startCZ = Math.floor(params.startZ / CHUNK_SIZE);
  const goalCX = Math.floor(params.goalX / CHUNK_SIZE);
  const goalCZ = Math.floor(params.goalZ / CHUNK_SIZE);

  const minCX = Math.min(startCX, goalCX) - extraChunks;
  const maxCX = Math.max(startCX, goalCX) + extraChunks;
  const minCZ = Math.min(startCZ, goalCZ) - extraChunks;
  const maxCZ = Math.max(startCZ, goalCZ) + extraChunks;

  const snapshot = getHeightMapSnapshot(minCX, maxCX, minCZ, maxCZ);

  return new Promise<PathfindingResult>((resolve, reject) => {
    pendingRequests.set(id, { resolve, reject, timestamp: Date.now() });

    const req: WorkerRequest = {
      type: 'findPath',
      id,
      heightMap: snapshot.data,
      mapOriginX: snapshot.originX,
      mapOriginZ: snapshot.originZ,
      mapWidth: snapshot.width,
      mapDepth: snapshot.depth,
      startX: params.startX,
      startZ: params.startZ,
      goalX: params.goalX,
      goalZ: params.goalZ,
      entityRadius: params.entityRadius,
      entityHeight: params.entityHeight,
      entityFeetY: params.entityFeetY,
      gridSize: params.gridSize,
      maxIterations: params.maxIterations,
    };

    // Transfer the height map buffer (zero-copy)
    worker!.postMessage(req, [snapshot.data.buffer]);
  });
}

/**
 * Clean up stale pending requests (call periodically).
 */
export function cleanupStaleRequests(): void {
  const now = Date.now();
  for (const [id, pending] of pendingRequests) {
    if (now - pending.timestamp > REQUEST_TIMEOUT_MS) {
      pending.reject(new Error('Pathfinding request timed out'));
      pendingRequests.delete(id);
    }
  }
}

/**
 * Terminate the worker (cleanup on unmount/world change).
 */
export function terminatePathfindingWorker(): void {
  if (cleanupIntervalId !== null) {
    clearInterval(cleanupIntervalId);
    cleanupIntervalId = null;
  }
  if (worker) {
    worker.terminate();
    worker = null;
  }
  // Reject all pending
  for (const [id, pending] of pendingRequests) {
    pending.reject(new Error('Worker terminated'));
    pendingRequests.delete(id);
  }
}
