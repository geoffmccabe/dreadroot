/**
 * Budgeted Work Queue
 *
 * Spreads expensive operations across multiple frames to prevent
 * main thread freezes during chunk load/unload.
 *
 * Jobs return true when complete, false to continue next frame.
 */

import { diagnostics } from './diagnosticsLogger';

type Job = {
  id: string;
  run: () => boolean; // return true when finished
};

let queue: Job[] = [];
let queueHead = 0;

// Track active job IDs to prevent duplicates
const activeJobs = new Set<string>();

/**
 * Enqueue a job to be processed over multiple frames
 * @param id Unique identifier (prevents duplicate jobs)
 * @param run Function that returns true when complete
 */
export function enqueueJob(id: string, run: () => boolean): void {
  // Skip if job with this ID is already queued
  if (activeJobs.has(id)) {
    return;
  }
  activeJobs.add(id);
  queue.push({ id, run });
  diagnostics.recordBudgetJobAdded();
}

/**
 * Process jobs within a time budget
 * Call this once per frame from the frame loop
 * @param budgetMs Maximum milliseconds to spend (default 2ms)
 */
export function tickBudgetedWork(budgetMs = 2.0): void {
  const pending = queue.length - queueHead;
  if (pending === 0) {
    diagnostics.recordBudgetTick(0, 0, 0);
    return;
  }

  const start = performance.now();
  let completed = 0;

  while (queueHead < queue.length && performance.now() - start < budgetMs) {
    const job = queue[queueHead];
    const done = job.run();

    if (done) {
      queueHead++;
      activeJobs.delete(job.id);
      completed++;
    }
  }

  // Compact when half the array is consumed
  if (queueHead > 64 && queueHead > queue.length / 2) {
    queue = queue.slice(queueHead);
    queueHead = 0;
  }

  diagnostics.recordBudgetTick(queue.length - queueHead, completed, performance.now() - start);
}

/**
 * Check if there are pending jobs
 */
export function hasPendingWork(): boolean {
  return queueHead < queue.length;
}

/**
 * Get pending job count (for diagnostics)
 */
export function getPendingJobCount(): number {
  return queue.length - queueHead;
}

/**
 * Cancel a specific pending job by ID.
 * Returns true if found and removed, false if not found or already running.
 */
export function cancelJob(id: string): boolean {
  if (!activeJobs.has(id)) return false;
  // Mark the job as cancelled by removing from activeJobs.
  // The job entry stays in the queue but will be skipped on next tick.
  activeJobs.delete(id);
  // Find and neutralize the job in the queue so it doesn't run
  for (let i = queueHead; i < queue.length; i++) {
    if (queue[i].id === id) {
      queue[i].run = () => true; // no-op, completes immediately
      return true;
    }
  }
  return false;
}

/**
 * Clear all pending jobs (use on world switch)
 */
export function clearPendingJobs(): void {
  queue = [];
  queueHead = 0;
  activeJobs.clear();
}
