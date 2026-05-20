/**
 * Mesh Worker — off-thread instance-buffer build for InstancedAtlasBlockGroup.
 *
 * Receives PACKED transferables (positions/typeIndex/branchDepth) + a tiny
 * per-build draw table, runs the SHARED resolveBlockDraw (the exact same
 * function the sync path uses → parity by identical code), and returns
 * translation matrices + uv + color Float32Arrays via Transferable.
 *
 * No DOM, no THREE, no atlas manager. resolveBlockDraw is worker-safe.
 */

import type {
  MainToWorkerMessage,
  WorkerToMainMessage,
  MeshResultMessage,
  BuildMeshMessage,
} from './meshWorkerTypes';
import { resolveBlockDraw, BRANCH_DEPTH_NONE, type PackedChunk } from './blockPackShared';

const cancelledJobs = new Set<number>();

function buildMesh(msg: BuildMeshMessage): MeshResultMessage | null {
  const n = msg.count;
  const pk: PackedChunk = {
    positions: msg.positions,
    typeIndex: msg.typeIndex,
    branchDepth: msg.branchDepth,
    table: msg.table,
    count: n,
  };

  if (n === 0) {
    return {
      type: 'meshResult',
      jobId: msg.jobId,
      chunkKey: msg.chunkKey,
      matrices: new Float32Array(0),
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

  // Reuse caller-supplied buffers when they fit (saves ~150KB/job of
  // garbage that would otherwise be created here and discarded on main
  // after the .set copy). Worker doesn't track its own pool — the
  // InstancedAtlasBlockGroup that submitted owns the pool and sends
  // these buffers back via transferable on each job.
  const matrices = msg.outMatrices && msg.outMatrices.length >= n * 16
    ? msg.outMatrices
    : new Float32Array(n * 16);
  const uvOffsets = msg.outUvOffsets && msg.outUvOffsets.length >= n * 2
    ? msg.outUvOffsets
    : new Float32Array(n * 2);
  const colors = msg.outColors && msg.outColors.length >= n * 3
    ? msg.outColors
    : new Float32Array(n * 3);

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  const animatedBlocks: MeshResultMessage['animatedBlocks'] = [];
  const shrineBlocks: MeshResultMessage['shrineBlocks'] = [];
  let hasBranchDepth = false;

  for (let i = 0; i < n; i++) {
    if ((i & 4095) === 0 && cancelledJobs.has(msg.jobId)) {
      cancelledJobs.delete(msg.jobId);
      return null; // cancelled
    }

    const d = resolveBlockDraw(pk, i);

    // Translation matrix (column-major identity + translation).
    const b = i * 16;
    matrices[b] = 1;
    matrices[b + 5] = 1;
    matrices[b + 10] = 1;
    matrices[b + 12] = d.cx;
    matrices[b + 13] = d.cy;
    matrices[b + 14] = d.cz;
    matrices[b + 15] = 1;

    uvOffsets[i * 2] = d.uvX;
    uvOffsets[i * 2 + 1] = d.uvY;

    colors[i * 3] = d.r;
    colors[i * 3 + 1] = d.g;
    colors[i * 3 + 2] = d.b;

    const entry = pk.table[pk.typeIndex[i]];
    if (entry.isGlowBark || pk.branchDepth[i] !== BRANCH_DEPTH_NONE) {
      hasBranchDepth = true;
    }
    if (entry.animFrameCount > 1) {
      animatedBlocks.push({
        blockIndex: i,
        frameCount: entry.animFrameCount,
        frameDelayMs: entry.animFrameDelayMs,
        baseSlotIndex: entry.animBaseSlotIndex,
      });
    }
    const ix = pk.positions[i * 3];
    const iy = pk.positions[i * 3 + 1];
    const iz = pk.positions[i * 3 + 2];
    if (entry.isShrine) shrineBlocks.push({ index: i, x: ix, y: iy, z: iz });

    if (ix < minX) minX = ix;
    if (iy < minY) minY = iy;
    if (iz < minZ) minZ = iz;
    if (ix + 1 > maxX) maxX = ix + 1;
    if (iy + 1 > maxY) maxY = iy + 1;
    if (iz + 1 > maxZ) maxZ = iz + 1;
  }

  return {
    type: 'meshResult',
    jobId: msg.jobId,
    chunkKey: msg.chunkKey,
    matrices,
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

self.onmessage = (e: MessageEvent<MainToWorkerMessage>) => {
  const msg = e.data;
  switch (msg.type) {
    case 'init':
      (self as unknown as Worker).postMessage({ type: 'ready' } satisfies WorkerToMainMessage);
      break;
    case 'buildMesh': {
      const result = buildMesh(msg);
      if (result) {
        (self as unknown as Worker).postMessage(result, [
          result.matrices.buffer,
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
