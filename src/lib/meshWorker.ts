/**
 * meshWorker — Web Worker for off-thread mesh data preparation.
 *
 * Receives pre-processed typed arrays from the main thread,
 * computes matrix, UV offset, and color buffers for InstancedMesh,
 * and transfers them back (zero-copy).
 *
 * No THREE.js, no DOM, no app imports — fully standalone.
 */

// ---- Types (duplicated here to avoid importing from main thread) ----

interface MeshRebuildRequest {
  type: 'rebuild';
  id: number;
  blockCount: number;
  meshCapacity: number;
  positions: Float32Array;    // [x0, y0, z0, x1, y1, z1, ...] length = blockCount * 3
  typeIndices: Uint16Array;   // type index per block, length = blockCount
  branchDepths: Float32Array; // branch depth per block, NaN = undefined, length = blockCount
  uvLookup: Float32Array;     // [uvX_type0, uvY_type0, uvX_type1, uvY_type1, ...] per unique type
  typeFlags: Uint8Array;      // bit 0 = glowBark, bit 1 = shrine, per unique type
}

interface MeshRebuildResponse {
  type: 'rebuild-complete';
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

// ---- Message handler ----

self.onmessage = (e: MessageEvent<MeshRebuildRequest>) => {
  const req = e.data;
  if (req.type !== 'rebuild') return;

  const t0 = performance.now();
  const { blockCount, meshCapacity, positions, typeIndices, branchDepths, uvLookup, typeFlags } = req;

  // Allocate output buffers at mesh capacity (matches InstancedMesh size)
  const matrixData = new Float32Array(meshCapacity * 16);
  const uvOffsetData = new Float32Array(meshCapacity * 2);
  const colorData = new Float32Array(meshCapacity * 3);

  const shrineIndices: number[] = [];
  let hasBranchDepth = false;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  for (let i = 0; i < blockCount; i++) {
    const px = positions[i * 3];
    const py = positions[i * 3 + 1];
    const pz = positions[i * 3 + 2];

    // Identity matrix with position (column-major, matches THREE.Matrix4 layout)
    // Only non-zero elements need to be set (Float32Array is zero-initialized)
    const base = i * 16;
    matrixData[base] = 1;       // m[0][0]
    matrixData[base + 5] = 1;   // m[1][1]
    matrixData[base + 10] = 1;  // m[2][2]
    matrixData[base + 12] = px + 0.5; // translation X
    matrixData[base + 13] = py + 0.5; // translation Y
    matrixData[base + 14] = pz + 0.5; // translation Z
    matrixData[base + 15] = 1;  // m[3][3]

    // UV offset from pre-computed type lookup table
    const ti = typeIndices[i];
    uvOffsetData[i * 2] = uvLookup[ti * 2];
    uvOffsetData[i * 2 + 1] = uvLookup[ti * 2 + 1];

    // Type flags
    const flags = typeFlags[ti];
    const isGlowBark = (flags & 1) !== 0;
    const isShrine = (flags & 2) !== 0;

    if (isShrine) {
      shrineIndices.push(i);
    }

    // Color computation
    if (isGlowBark) {
      hasBranchDepth = true;
      colorData[i * 3] = 1.4;
      colorData[i * 3 + 1] = 2.0;
      colorData[i * 3 + 2] = 1.5;
    } else {
      const depth = branchDepths[i];
      // NaN check: NaN !== NaN
      if (depth === depth) {
        hasBranchDepth = true;
        const f = 1.0 + Math.max(0, depth + 1) * 0.12;
        colorData[i * 3] = f;
        colorData[i * 3 + 1] = f;
        colorData[i * 3 + 2] = f;
      } else {
        colorData[i * 3] = 1.0;
        colorData[i * 3 + 1] = 1.0;
        colorData[i * 3 + 2] = 1.0;
      }
    }

    // Bounding box accumulation
    if (px < minX) minX = px;
    if (py < minY) minY = py;
    if (pz < minZ) minZ = pz;
    if (px + 1 > maxX) maxX = px + 1;
    if (py + 1 > maxY) maxY = py + 1;
    if (pz + 1 > maxZ) maxZ = pz + 1;
  }

  const response: MeshRebuildResponse = {
    type: 'rebuild-complete',
    id: req.id,
    matrixData,
    uvOffsetData,
    colorData,
    shrineIndices,
    hasBranchDepth,
    minX, minY, minZ, maxX, maxY, maxZ,
    blockCount,
    durationMs: performance.now() - t0,
  };

  // Transfer Float32Array buffers (zero-copy)
  (self as unknown as Worker).postMessage(response, [
    matrixData.buffer,
    uvOffsetData.buffer,
    colorData.buffer,
  ]);
};
