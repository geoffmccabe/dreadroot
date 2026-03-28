/**
 * Mesh Worker — computes instance buffers for InstancedAtlasBlockGroup.
 *
 * Runs in a background Web Worker thread. Receives block arrays,
 * computes position/UV/color Float32Arrays, and sends them back
 * via Transferable (zero-copy).
 *
 * Stateless per job. Only depends on the UV/anim lookup tables
 * sent during init (no DOM, no THREE.js, no atlas manager).
 */

import type {
  MainToWorkerMessage,
  WorkerToMainMessage,
  UVEntry,
  AnimEntry,
  WorkerBlock,
  MeshResultMessage,
} from './meshWorkerTypes';

// ---- State (set during init, updated on atlas change) ----
let uvTable: Record<string, UVEntry> = {};
let animTable: Record<string, AnimEntry> = {};
let atlasGridSize = 32;
let slotUvSize = 1 / 32;

// Active job ID — used for cancellation
const cancelledJobs = new Set<number>();

// Default UV for unknown block types (center of atlas)
const DEFAULT_UV: UVEntry = { uvOffsetX: 0, uvOffsetY: 0 };

// ---- UV helpers (pure math, no dependencies) ----

function slotIndexToUV(slotIndex: number): UVEntry {
  const col = slotIndex % atlasGridSize;
  const row = Math.floor(slotIndex / atlasGridSize);
  return {
    uvOffsetX: col * slotUvSize,
    uvOffsetY: 1 - (row + 1) * slotUvSize,
  };
}

function getUV(blockType: string): UVEntry {
  return uvTable[blockType] ?? DEFAULT_UV;
}

function getAnimInfo(blockType: string): AnimEntry | null {
  return animTable[blockType] ?? null;
}

// ---- Core computation ----

function buildMesh(blocks: WorkerBlock[], jobId: number): MeshResultMessage | null {
  const n = blocks.length;
  if (n === 0) {
    return {
      type: 'meshResult',
      jobId,
      chunkKey: '',
      positions: new Float32Array(0),
      uvOffsets: new Float32Array(0),
      colors: new Float32Array(0),
      blockCount: 0,
      boundsMin: [0, 0, 0],
      boundsMax: [0, 0, 0],
      animatedBlocks: [],
      shrineBlocks: [],
      hasBranchDepth: false,
    };
  }

  const positions = new Float32Array(n * 3);
  const uvOffsets = new Float32Array(n * 2);
  const colors = new Float32Array(n * 3);

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  const animatedBlocks: MeshResultMessage['animatedBlocks'] = [];
  const shrineBlocks: MeshResultMessage['shrineBlocks'] = [];
  let hasBranchDepth = false;

  for (let i = 0; i < n; i++) {
    // Check cancellation every 5000 blocks
    if ((i & 4095) === 0 && cancelledJobs.has(jobId)) {
      cancelledJobs.delete(jobId);
      return null; // Cancelled
    }

    const block = blocks[i];
    const x = block.position_x;
    const y = block.position_y;
    const z = block.position_z;

    // Position (translation only — center of block)
    positions[i * 3] = x + 0.5;
    positions[i * 3 + 1] = y + 0.5;
    positions[i * 3 + 2] = z + 0.5;

    // UV offset
    const animInfo = getAnimInfo(block.block_type);
    if (animInfo && animInfo.frameCount > 1) {
      animatedBlocks.push({
        blockIndex: i,
        frameCount: animInfo.frameCount,
        frameDelayMs: animInfo.frameDelayMs,
        baseSlotIndex: animInfo.baseSlotIndex,
      });
      const uvs = slotIndexToUV(animInfo.baseSlotIndex);
      uvOffsets[i * 2] = uvs.uvOffsetX;
      uvOffsets[i * 2 + 1] = uvs.uvOffsetY;
    } else {
      const uvs = getUV(block.block_type);
      uvOffsets[i * 2] = uvs.uvOffsetX;
      uvOffsets[i * 2 + 1] = uvs.uvOffsetY;
    }

    // Color (glow bark, shrine, branch depth)
    const bt = block.block_type;
    const isGlowBark = bt.charCodeAt(0) === 103 && bt.charCodeAt(1) === 98; // 'gb'
    const isShrine = bt.charCodeAt(0) === 115 && bt.charCodeAt(1) === 104 && bt.charCodeAt(2) === 114; // 'shr'

    if (isShrine) {
      shrineBlocks.push({ index: i, x, y, z });
    }

    if (isGlowBark) {
      hasBranchDepth = true;
      colors[i * 3] = 1.4;
      colors[i * 3 + 1] = 2.0;
      colors[i * 3 + 2] = 1.5;
    } else {
      const depth = block.branch_depth;
      if (depth !== undefined && depth !== null) {
        hasBranchDepth = true;
        const lightenFactor = 1.0 + Math.max(0, depth + 1) * 0.12;
        colors[i * 3] = lightenFactor;
        colors[i * 3 + 1] = lightenFactor;
        colors[i * 3 + 2] = lightenFactor;
      } else {
        colors[i * 3] = 1.0;
        colors[i * 3 + 1] = 1.0;
        colors[i * 3 + 2] = 1.0;
      }
    }

    // Bounds
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x + 1 > maxX) maxX = x + 1;
    if (y + 1 > maxY) maxY = y + 1;
    if (z + 1 > maxZ) maxZ = z + 1;
  }

  return {
    type: 'meshResult',
    jobId,
    chunkKey: '',  // filled by caller
    positions,
    uvOffsets,
    colors,
    blockCount: n,
    boundsMin: [minX, minY, minZ],
    boundsMax: [maxX, maxY, maxZ],
    animatedBlocks,
    shrineBlocks,
    hasBranchDepth,
  };
}

// ---- Message handler ----

self.onmessage = (e: MessageEvent<MainToWorkerMessage>) => {
  const msg = e.data;

  switch (msg.type) {
    case 'init':
      uvTable = msg.uvTable;
      animTable = msg.animTable;
      atlasGridSize = msg.atlasGridSize;
      slotUvSize = 1 / atlasGridSize;
      (self as any).postMessage({ type: 'ready' } satisfies WorkerToMainMessage);
      break;

    case 'updateUVTable':
      // Merge new entries into existing tables (don't replace)
      Object.assign(uvTable, msg.uvTable);
      Object.assign(animTable, msg.animTable);
      break;

    case 'buildMesh': {
      const result = buildMesh(msg.blocks, msg.jobId);
      if (result) {
        result.chunkKey = msg.chunkKey;
        // Transfer ownership of Float32Arrays (zero-copy)
        (self as any).postMessage(result, [
          result.positions.buffer,
          result.uvOffsets.buffer,
          result.colors.buffer,
        ]);
      }
      break;
    }

    case 'cancel':
      cancelledJobs.add(msg.jobId);
      break;
  }
};
