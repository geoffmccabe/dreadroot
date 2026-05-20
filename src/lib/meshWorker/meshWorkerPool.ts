/**
 * MeshWorkerPool — pool of mesh-build Web Workers. Dispatches packed chunk
 * jobs, results via promise. Jobs cancellable. Stateless workers; the tiny
 * draw table travels per-job (no UV-table sync needed anymore).
 */

import type {
  MainToWorkerMessage,
  WorkerToMainMessage,
  MeshResultMessage,
  BuildMeshMessage,
} from './meshWorkerTypes';
import type { PackedChunk } from './blockPackShared';

export type MeshBuildResult = MeshResultMessage;

interface PendingJob {
  jobId: number;
  chunkKey: string;
  resolve: (result: MeshBuildResult) => void;
  timestamp: number;
}

const JOB_TIMEOUT_MS = 10000;

const transferList = (m: BuildMeshMessage): Transferable[] => {
  const list: Transferable[] = [m.positions.buffer, m.typeIndex.buffer, m.branchDepth.buffer];
  // Optional caller-supplied output buffers (ping-pong pool) — also
  // transferred zero-copy so worker can write into them.
  if (m.outMatrices) list.push(m.outMatrices.buffer);
  if (m.outUvOffsets) list.push(m.outUvOffsets.buffer);
  if (m.outColors) list.push(m.outColors.buffer);
  return list;
};

class MeshWorkerPool {
  private workers: Worker[] = [];
  private workerBusy: boolean[] = [];
  private pendingJobs = new Map<number, PendingJob>();
  private jobQueue: Array<{ msg: BuildMeshMessage; resolve: (r: MeshBuildResult) => void }> = [];
  private nextJobId = 1;
  private initialized = false;
  private poolSize: number;

  constructor(poolSize = 2) {
    this.poolSize = poolSize;
  }

  /** Initialize the worker pool. Idempotent. */
  init(): void {
    if (this.initialized) return;
    for (let i = 0; i < this.poolSize; i++) {
      const worker = new Worker(new URL('./meshWorker.ts', import.meta.url), {
        type: 'module',
      });
      worker.onmessage = (e: MessageEvent<WorkerToMainMessage>) => {
        this.handleWorkerMessage(i, e.data);
      };
      worker.onerror = (err) => {
        console.error(`[MeshWorkerPool] Worker ${i} error:`, err);
        this.workerBusy[i] = false;
        this.dispatchNext(i);
      };
      worker.postMessage({ type: 'init' } satisfies MainToWorkerMessage);
      this.workers.push(worker);
      this.workerBusy.push(false);
    }
    this.initialized = true;
    console.log(`[MeshWorkerPool] Initialized ${this.poolSize} workers`);
    setInterval(() => this.cleanupStaleJobs(), 5000);
  }

  /**
   * Submit a packed chunk build. Resolves with computed buffers; rejects
   * if the pool isn't initialized so the caller can use the sync path.
   */
  buildMesh(
    chunkKey: string,
    packed: PackedChunk,
    priority: number,
    pooledOut?: { matrices?: Float32Array; uvOffsets?: Float32Array; colors?: Float32Array },
  ): Promise<MeshBuildResult> {
    if (!this.initialized) {
      return Promise.reject(new Error('MeshWorkerPool not initialized'));
    }
    const jobId = this.nextJobId++;
    const msg: BuildMeshMessage = {
      type: 'buildMesh',
      jobId,
      chunkKey,
      priority,
      count: packed.count,
      positions: packed.positions,
      typeIndex: packed.typeIndex,
      branchDepth: packed.branchDepth,
      table: packed.table,
      // Pass caller pool buffers through if provided; worker reuses them
      // when big enough and transfers them back in the result.
      outMatrices: pooledOut?.matrices,
      outUvOffsets: pooledOut?.uvOffsets,
      outColors: pooledOut?.colors,
    };
    return new Promise<MeshBuildResult>((resolve) => {
      const freeWorker = this.findFreeWorker();
      if (freeWorker >= 0) {
        this.workerBusy[freeWorker] = true;
        this.pendingJobs.set(jobId, { jobId, chunkKey, resolve, timestamp: Date.now() });
        this.workers[freeWorker].postMessage(msg, transferList(msg));
      } else {
        this.jobQueue.push({ msg, resolve });
      }
    });
  }

  cancel(jobId: number): void {
    const pending = this.pendingJobs.get(jobId);
    if (pending) {
      this.pendingJobs.delete(jobId);
      for (const worker of this.workers) {
        worker.postMessage({ type: 'cancel', jobId } satisfies MainToWorkerMessage);
      }
    }
    const qIdx = this.jobQueue.findIndex((j) => j.msg.jobId === jobId);
    if (qIdx >= 0) this.jobQueue.splice(qIdx, 1);
  }

  cancelAll(): void {
    for (const [jobId] of this.pendingJobs) {
      for (const worker of this.workers) {
        worker.postMessage({ type: 'cancel', jobId } satisfies MainToWorkerMessage);
      }
    }
    this.pendingJobs.clear();
    this.jobQueue.length = 0;
  }

  getStatus(): { poolSize: number; busy: number; queued: number; pending: number } {
    return {
      poolSize: this.poolSize,
      busy: this.workerBusy.filter((b) => b).length,
      queued: this.jobQueue.length,
      pending: this.pendingJobs.size,
    };
  }

  get isInitialized(): boolean {
    return this.initialized;
  }

  // ---- Internal ----

  private handleWorkerMessage(workerIndex: number, msg: WorkerToMainMessage): void {
    if (msg.type === 'ready') return;
    if (msg.type === 'meshResult') {
      const pending = this.pendingJobs.get(msg.jobId);
      if (pending) {
        this.pendingJobs.delete(msg.jobId);
        pending.resolve(msg);
      }
      this.workerBusy[workerIndex] = false;
      this.dispatchNext(workerIndex);
    }
  }

  private dispatchNext(workerIndex: number): void {
    if (this.jobQueue.length === 0) return;
    const next = this.jobQueue.shift()!;
    this.workerBusy[workerIndex] = true;
    this.pendingJobs.set(next.msg.jobId, {
      jobId: next.msg.jobId,
      chunkKey: next.msg.chunkKey,
      resolve: next.resolve,
      timestamp: Date.now(),
    });
    this.workers[workerIndex].postMessage(next.msg, transferList(next.msg));
  }

  private findFreeWorker(): number {
    for (let i = 0; i < this.workerBusy.length; i++) {
      if (!this.workerBusy[i]) return i;
    }
    return -1;
  }

  private cleanupStaleJobs(): void {
    const now = Date.now();
    for (const [jobId, job] of this.pendingJobs) {
      if (now - job.timestamp > JOB_TIMEOUT_MS) {
        console.warn(
          `[MeshWorkerPool] Job ${jobId} (${job.chunkKey}) timed out after ${JOB_TIMEOUT_MS}ms`,
        );
        this.pendingJobs.delete(jobId);
        // Don't resolve — caller's own timeout/fallback handles it.
      }
    }
  }

  destroy(): void {
    this.cancelAll();
    for (const worker of this.workers) worker.terminate();
    this.workers = [];
    this.workerBusy = [];
    this.initialized = false;
  }
}

export const meshWorkerPool = new MeshWorkerPool(2);
