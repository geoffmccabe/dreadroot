/**
 * Shared types for mesh worker messages. Used by main thread (pool) and
 * the worker. Transport is now PACKED TRANSFERABLES (no structured-clone
 * of block-object arrays — that's what got the worker abandoned). The tiny
 * per-build draw table travels with each job so the worker needs no
 * atlas/UV-table sync (it runs the same resolveBlockDraw).
 */

import type { DrawTableEntry } from './blockPackShared';

// ---- Messages: Main → Worker ----

/** Handshake only — worker replies 'ready'. No payload needed anymore. */
export interface InitMessage {
  type: 'init';
}

export interface BuildMeshMessage {
  type: 'buildMesh';
  jobId: number;
  chunkKey: string;
  priority: number; // lower = higher priority (distance to player)
  count: number;
  // Transferred (zero-copy): ownership moves to the worker.
  positions: Int32Array; // count*3 block min-corner
  typeIndex: Uint16Array; // count -> index into table
  branchDepth: Int8Array; // count, or BRANCH_DEPTH_NONE
  table: DrawTableEntry[]; // small, structured-cloned (cheap)
}

export interface CancelMessage {
  type: 'cancel';
  jobId: number;
}

export type MainToWorkerMessage = InitMessage | BuildMeshMessage | CancelMessage;

// ---- Messages: Worker → Main ----

export interface MeshResultMessage {
  type: 'meshResult';
  jobId: number;
  chunkKey: string;
  // Transferable Float32Arrays (zero-copy back to main thread).
  matrices: Float32Array; // count*16 translation matrices (column-major)
  uvOffsets: Float32Array; // count*2 (uvOffsetX, uvOffsetY)
  colors: Float32Array; // count*3 (r, g, b)
  blockCount: number;
  boundsMin: [number, number, number];
  boundsMax: [number, number, number];
  animatedBlocks: Array<{
    blockIndex: number;
    frameCount: number;
    frameDelayMs: number;
    baseSlotIndex: number;
  }>;
  shrineBlocks: Array<{ index: number; x: number; y: number; z: number }>;
  hasBranchDepth: boolean;
}

export interface WorkerReadyMessage {
  type: 'ready';
}

export type WorkerToMainMessage = MeshResultMessage | WorkerReadyMessage;
