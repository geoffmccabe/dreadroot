/**
 * meshWorkerPool — Main-thread bridge to mesh-building Web Workers.
 *
 * Manages a pool of workers, pre-processes PlacedBlock[] into typed arrays,
 * dispatches to free workers, and returns promises with computed GPU buffers.
 *
 * Follows the same pattern as pathfinding/workerBridge.ts.
 */

import type { PlacedBlock } from '@/types/blocks';

// ---- Result type (matches worker response) ----

export interface WorkerRebuildResult {
  id: number;
  matrixData: Float32Array;
  uvOffsetData: Float32Array;
  colorData: Float32Array;
  shrineIndices: number[];
  hasBranchDepth: boolean;
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
  blockCount: number;
  durationMs: number;
}

// ---- Pool implementation ----

interface PendingJob {
  resolve: (result: WorkerRebuildResult) => void;
  reject: (error: any) => void;
  workerIdx: number;
}

interface QueuedJob {
  request: any;
  transfers: ArrayBuffer[];
  resolve: (result: WorkerRebuildResult) => void;
  reject: (error: any) => void;
}

class MeshWorkerPool {
  private workers: Worker[] = [];
  private busy: boolean[] = [];
  private pending = new Map<number, PendingJob>();
  private queue: QueuedJob[] = [];

  constructor(size: number) {
    for (let i = 0; i < size; i++) {
      try {
        const worker = new Worker(
          new URL('./meshWorker.ts', import.meta.url),
          { type: 'module' }
        );
        worker.onmessage = (e) => this.handleResponse(i, e.data);
        worker.onerror = (err) => {
          console.error(`[MeshWorkerPool] Worker ${i} error:`, err);
          this.busy[i] = false;
          // Reject the pending promise so callers can recover
          for (const [id, job] of this.pending) {
            if (job.workerIdx === i) {
              this.pending.delete(id);
              job.reject(err);
              break;
            }
          }
          this.dispatch();
        };
        this.workers.push(worker);
        this.busy.push(false);
      } catch (err) {
        console.warn(`[MeshWorkerPool] Failed to create worker ${i}:`, err);
      }
    }
    if (this.workers.length > 0) {
      console.log(`[MeshWorkerPool] Initialized ${this.workers.length} workers`);
    }
  }

  /**
   * Pre-process blocks and dispatch to a worker for mesh computation.
   *
   * @param blocks The PlacedBlock array to rebuild
   * @param meshCapacity InstancedMesh capacity (for buffer sizing)
   * @param uvResolver Returns UV offset for a block type (called once per unique type)
   * @param glowBarkCheck Returns true for glow bark block types
   * @param shrineCheck Returns true for shrine block types
   * @param rebuildId Unique version ID for stale-result detection
   */
  rebuild(
    blocks: PlacedBlock[],
    meshCapacity: number,
    uvResolver: (blockType: string) => { uvOffsetX: number; uvOffsetY: number },
    glowBarkCheck: (blockType: string) => boolean,
    shrineCheck: (blockType: string) => boolean,
    rebuildId: number,
  ): Promise<WorkerRebuildResult> {
    const blockCount = blocks.length;

    // === Pre-processing: convert object arrays to typed arrays ===
    // This runs on the main thread but is lightweight (~1-2ms for 20K blocks):
    // just reading properties and writing to typed arrays, no heavy computation.

    const positions = new Float32Array(blockCount * 3);
    const branchDepths = new Float32Array(blockCount);

    // Build type index map (block_type string → numeric index)
    const typeMap = new Map<string, number>();
    const typeList: string[] = [];
    const typeIndices = new Uint16Array(blockCount);

    for (let i = 0; i < blockCount; i++) {
      const b = blocks[i];
      positions[i * 3] = b.position_x;
      positions[i * 3 + 1] = b.position_y;
      positions[i * 3 + 2] = b.position_z;
      branchDepths[i] = (b.branch_depth !== undefined && b.branch_depth !== null)
        ? b.branch_depth : NaN;

      let ti = typeMap.get(b.block_type);
      if (ti === undefined) {
        ti = typeList.length;
        typeMap.set(b.block_type, ti);
        typeList.push(b.block_type);
      }
      typeIndices[i] = ti;
    }

    // Build UV lookup table and type flags for each unique type (~30 types)
    const uvLookup = new Float32Array(typeList.length * 2);
    const typeFlags = new Uint8Array(typeList.length);

    for (let t = 0; t < typeList.length; t++) {
      const bt = typeList[t];
      const uv = uvResolver(bt);
      uvLookup[t * 2] = uv.uvOffsetX;
      uvLookup[t * 2 + 1] = uv.uvOffsetY;

      let flags = 0;
      if (glowBarkCheck(bt)) flags |= 1;
      if (shrineCheck(bt)) flags |= 2;
      typeFlags[t] = flags;
    }

    const request = {
      type: 'rebuild' as const,
      id: rebuildId,
      blockCount,
      meshCapacity,
      positions,
      typeIndices,
      branchDepths,
      uvLookup,
      typeFlags,
    };

    // All typed arrays are freshly allocated — safe to transfer
    const transfers = [
      positions.buffer,
      typeIndices.buffer,
      branchDepths.buffer,
      uvLookup.buffer,
      typeFlags.buffer,
    ];

    return new Promise<WorkerRebuildResult>((resolve, reject) => {
      this.queue.push({ request, transfers, resolve, reject });
      this.dispatch();
    });
  }

  /** Check if any workers are available */
  isAvailable(): boolean {
    return this.workers.length > 0;
  }

  private dispatch(): void {
    while (this.queue.length > 0) {
      const freeIdx = this.busy.indexOf(false);
      if (freeIdx === -1) break;

      const job = this.queue.shift()!;
      this.busy[freeIdx] = true;
      this.pending.set(job.request.id, { resolve: job.resolve, reject: job.reject, workerIdx: freeIdx });

      this.workers[freeIdx].postMessage(job.request, job.transfers);
    }
  }

  private handleResponse(workerIdx: number, data: any): void {
    this.busy[workerIdx] = false;

    if (data.type === 'rebuild-complete') {
      const job = this.pending.get(data.id);
      if (job) {
        this.pending.delete(data.id);
        job.resolve(data as WorkerRebuildResult);
      }
    }

    // Check for queued work
    this.dispatch();
  }

  terminate(): void {
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.busy = [];
    this.pending.clear();
    this.queue = [];
  }
}

// ---- Singleton ----

let pool: MeshWorkerPool | null = null;

export function getMeshWorkerPool(): MeshWorkerPool {
  if (!pool) {
    const cores = navigator.hardwareConcurrency || 4;
    // Use cores-1 workers (leave one core for main thread), max 4
    const size = Math.min(Math.max(cores - 1, 1), 4);
    pool = new MeshWorkerPool(size);
  }
  return pool;
}
