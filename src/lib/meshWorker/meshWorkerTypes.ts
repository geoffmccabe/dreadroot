/**
 * Shared types for mesh worker messages.
 * Used by both main thread (pool) and worker thread.
 */

// Minimal block data sent to worker (no unused fields)
export interface WorkerBlock {
  position_x: number;
  position_y: number;
  position_z: number;
  block_type: string;
  branch_depth?: number;
}

// UV lookup entry (serialized from main thread's cache)
export interface UVEntry {
  uvOffsetX: number;
  uvOffsetY: number;
}

// Animation info entry
export interface AnimEntry {
  frameCount: number;
  frameDelayMs: number;
  baseSlotIndex: number;
}

// ---- Messages: Main → Worker ----

export interface InitMessage {
  type: 'init';
  uvTable: Record<string, UVEntry>;         // block_type → UV offset
  animTable: Record<string, AnimEntry>;     // block_type → animation info
  atlasGridSize: number;                     // 32
}

export interface BuildMeshMessage {
  type: 'buildMesh';
  jobId: number;
  chunkKey: string;
  blocks: WorkerBlock[];
  priority: number;  // lower = higher priority (distance to player)
}

export interface CancelMessage {
  type: 'cancel';
  jobId: number;
}

export interface UpdateUVTableMessage {
  type: 'updateUVTable';
  uvTable: Record<string, UVEntry>;
  animTable: Record<string, AnimEntry>;
}

export type MainToWorkerMessage = InitMessage | BuildMeshMessage | CancelMessage | UpdateUVTableMessage;

// ---- Messages: Worker → Main ----

export interface MeshResultMessage {
  type: 'meshResult';
  jobId: number;
  chunkKey: string;
  // Transferable Float32Arrays (zero-copy)
  positions: Float32Array;    // 3 floats per block (x+0.5, y+0.5, z+0.5)
  uvOffsets: Float32Array;    // 2 floats per block (uvOffsetX, uvOffsetY)
  colors: Float32Array;       // 3 floats per block (r, g, b)
  blockCount: number;
  // Bounding box
  boundsMin: [number, number, number];
  boundsMax: [number, number, number];
  // Special blocks
  animatedBlocks: Array<{ blockIndex: number; frameCount: number; frameDelayMs: number; baseSlotIndex: number }>;
  shrineBlocks: Array<{ index: number; x: number; y: number; z: number }>;
  hasBranchDepth: boolean;
}

export interface WorkerReadyMessage {
  type: 'ready';
}

export type WorkerToMainMessage = MeshResultMessage | WorkerReadyMessage;
