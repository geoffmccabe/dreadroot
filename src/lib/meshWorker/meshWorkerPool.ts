/**
 * MeshWorkerPool — manages a pool of mesh computation Web Workers.
 *
 * Dispatches chunk mesh build jobs to available workers.
 * Results arrive via callbacks. Jobs can be cancelled.
 * Pool size is configurable and workers are stateless.
 */

import type {
  MainToWorkerMessage,
  WorkerToMainMessage,
  MeshResultMessage,
  UVEntry,
  AnimEntry,
  WorkerBlock,
} from './meshWorkerTypes';

export interface MeshBuildResult extends MeshResultMessage {}

interface PendingJob {
  jobId: number;
  chunkKey: string;
  resolve: (result: MeshBuildResult) => void;
  timestamp: number;
}

// Job timeout (if worker doesn't respond in 10 seconds, consider it stuck)
const JOB_TIMEOUT_MS = 10000;

class MeshWorkerPool {
  private workers: Worker[] = [];
  private workerBusy: boolean[] = [];
  private pendingJobs = new Map<number, PendingJob>();
  private jobQueue: Array<{ msg: MainToWorkerMessage & { type: 'buildMesh' }; resolve: (result: MeshBuildResult) => void }> = [];
  private nextJobId = 1;
  private initialized = false;
  private poolSize: number;

  // UV/anim tables sent to workers on init
  private uvTable: Record<string, UVEntry> = {};
  private animTable: Record<string, AnimEntry> = {};

  constructor(poolSize = 2) {
    this.poolSize = poolSize;
  }

  /**
   * Initialize the worker pool. Call once after UV tables are ready.
   */
  init(uvTable: Record<string, UVEntry>, animTable: Record<string, AnimEntry>): void {
    if (this.initialized) return;

    this.uvTable = uvTable;
    this.animTable = animTable;

    for (let i = 0; i < this.poolSize; i++) {
      const worker = new Worker(
        new URL('./meshWorker.ts', import.meta.url),
        { type: 'module' }
      );

      worker.onmessage = (e: MessageEvent<WorkerToMainMessage>) => {
        this.handleWorkerMessage(i, e.data);
      };

      worker.onerror = (err) => {
        console.error(`[MeshWorkerPool] Worker ${i} error:`, err);
        // Mark worker as free so it can accept new jobs
        this.workerBusy[i] = false;
        this.dispatchNext(i);
      };

      // Send init message with UV tables
      worker.postMessage({
        type: 'init',
        uvTable: this.uvTable,
        animTable: this.animTable,
        atlasGridSize: 32,
      } satisfies MainToWorkerMessage);

      this.workers.push(worker);
      this.workerBusy.push(false);
    }

    this.initialized = true;
    console.log(`[MeshWorkerPool] Initialized ${this.poolSize} workers`);

    // Periodic cleanup of timed-out jobs
    setInterval(() => this.cleanupStaleJobs(), 5000);
  }

  /**
   * Update UV tables on all workers (when atlas version changes)
   */
  updateUVTables(uvTable: Record<string, UVEntry>, animTable: Record<string, AnimEntry>): void {
    this.uvTable = uvTable;
    this.animTable = animTable;

    const msg: MainToWorkerMessage = {
      type: 'updateUVTable',
      uvTable,
      animTable,
    };

    for (const worker of this.workers) {
      worker.postMessage(msg);
    }
  }

  /**
   * Submit a mesh build job. Returns a promise that resolves with the computed buffers.
   */
  buildMesh(chunkKey: string, blocks: WorkerBlock[], priority: number): Promise<MeshBuildResult> {
    if (!this.initialized) {
      // Fallback: if pool not ready, reject so caller can use sync path
      return Promise.reject(new Error('MeshWorkerPool not initialized'));
    }

    const jobId = this.nextJobId++;

    return new Promise<MeshBuildResult>((resolve) => {
      const msg: MainToWorkerMessage & { type: 'buildMesh' } = {
        type: 'buildMesh',
        jobId,
        chunkKey,
        blocks,
        priority,
      };

      // Try to dispatch immediately to a free worker
      const freeWorker = this.findFreeWorker();
      if (freeWorker >= 0) {
        this.workerBusy[freeWorker] = true;
        this.pendingJobs.set(jobId, { jobId, chunkKey, resolve, timestamp: Date.now() });
        this.workers[freeWorker].postMessage(msg);
      } else {
        // All workers busy — queue the job
        this.jobQueue.push({ msg, resolve });
      }
    });
  }

  /**
   * Cancel a pending or queued job (e.g., chunk no longer needed)
   */
  cancel(jobId: number): void {
    // Remove from pending
    const pending = this.pendingJobs.get(jobId);
    if (pending) {
      this.pendingJobs.delete(jobId);
      // Tell worker to stop (it checks cancellation periodically)
      for (const worker of this.workers) {
        worker.postMessage({ type: 'cancel', jobId } satisfies MainToWorkerMessage);
      }
    }

    // Remove from queue
    const qIdx = this.jobQueue.findIndex(j => j.msg.jobId === jobId);
    if (qIdx >= 0) {
      this.jobQueue.splice(qIdx, 1);
    }
  }

  /**
   * Cancel all pending and queued jobs (e.g., world change)
   */
  cancelAll(): void {
    for (const [jobId] of this.pendingJobs) {
      for (const worker of this.workers) {
        worker.postMessage({ type: 'cancel', jobId } satisfies MainToWorkerMessage);
      }
    }
    this.pendingJobs.clear();
    this.jobQueue.length = 0;
  }

  /**
   * Get pool status for diagnostics
   */
  getStatus(): { poolSize: number; busy: number; queued: number; pending: number } {
    return {
      poolSize: this.poolSize,
      busy: this.workerBusy.filter(b => b).length,
      queued: this.jobQueue.length,
      pending: this.pendingJobs.size,
    };
  }

  get isInitialized(): boolean {
    return this.initialized;
  }

  // ---- Internal ----

  private handleWorkerMessage(workerIndex: number, msg: WorkerToMainMessage): void {
    if (msg.type === 'ready') {
      // Worker initialized
      return;
    }

    if (msg.type === 'meshResult') {
      const pending = this.pendingJobs.get(msg.jobId);
      if (pending) {
        this.pendingJobs.delete(msg.jobId);
        pending.resolve(msg);
      }

      // Worker is now free — dispatch next queued job
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
    this.workers[workerIndex].postMessage(next.msg);
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
        console.warn(`[MeshWorkerPool] Job ${jobId} (${job.chunkKey}) timed out after ${JOB_TIMEOUT_MS}ms`);
        this.pendingJobs.delete(jobId);
        // Don't resolve — caller will retry via integrity check
      }
    }
  }

  /**
   * Terminate all workers (cleanup)
   */
  destroy(): void {
    this.cancelAll();
    for (const worker of this.workers) {
      worker.terminate();
    }
    this.workers = [];
    this.workerBusy = [];
    this.initialized = false;
  }
}

// Singleton instance
export const meshWorkerPool = new MeshWorkerPool(2);
