/**
 * MergedTreeMesh
 *
 * Renders ALL tree blocks across ALL chunks in a single InstancedMesh (1 draw call).
 * Replaces per-chunk InstancedAtlasBlockGroup for tree blocks.
 *
 * Key design:
 * - Single InstancedMesh with 300K instance capacity
 * - Chunk-range allocator: each chunk owns a contiguous buffer range
 * - Workers build per-chunk data, results copied to buffer at chunk offset
 * - NO per-frame frustum culling (GPU clips out-of-view triangles natively;
 *   modifying the 19.2MB matrix buffer every frame for culling was net-negative)
 */

import React, { useRef, useMemo, useEffect, useCallback } from 'react';
import * as THREE from 'three';
import type { PlacedBlock } from '@/types/blocks';
import { createTreeAtlasMaterial } from '@/lib/atlasMaterial';
import { MergedMeshAllocator } from '@/lib/mergedMeshAllocator';
import { frameLoop } from '@/lib/frameLoop';
import { diagnostics } from '@/lib/diagnosticsLogger';
import { getMeshWorkerPool } from '@/lib/meshWorkerPool';
import { playerTracker } from '@/lib/playerTracker';
import { shrineTracker } from '@/lib/shrineTracker';
import { fallingBlocksState } from './PlacedBlocks';
import {
  getInstanceUVsForTreeBlock,
  getTreeBlockAnimationInfo,
  getAnimatedUVOffset,
  getAtlasVersion,
} from '@/hooks/useTextureAtlas';

// ============================================
// Constants
// ============================================

const INITIAL_CAPACITY = 300_000;

// UV lookup cache (shared with IABG — same module-level Maps)
const uvCache = new Map<string, { uvOffsetX: number; uvOffsetY: number }>();
const animCache = new Map<string, ReturnType<typeof getTreeBlockAnimationInfo>>();

function getCachedUVs(bt: string) {
  let c = uvCache.get(bt);
  if (!c) { c = getInstanceUVsForTreeBlock(bt); uvCache.set(bt, c); }
  return c;
}
function getCachedAnimInfo(bt: string) {
  if (animCache.has(bt)) return animCache.get(bt)!;
  const info = getTreeBlockAnimationInfo(bt);
  animCache.set(bt, info);
  return info;
}

// ============================================
// Buffer helpers
// ============================================

/** Zero-scale a range of instances in the matrix buffer (degenerate triangles) */
function zeroScaleRange(matBuf: Float32Array, start: number, count: number) {
  for (let i = start; i < start + count; i++) {
    const base = i * 16;
    // Column-major identity with scale 0 → degenerate triangle
    matBuf[base] = 0; matBuf[base + 1] = 0; matBuf[base + 2] = 0; matBuf[base + 3] = 0;
    matBuf[base + 4] = 0; matBuf[base + 5] = 0; matBuf[base + 6] = 0; matBuf[base + 7] = 0;
    matBuf[base + 8] = 0; matBuf[base + 9] = 0; matBuf[base + 10] = 0; matBuf[base + 11] = 0;
    matBuf[base + 12] = 0; matBuf[base + 13] = 0; matBuf[base + 14] = 0; matBuf[base + 15] = 1;
  }
}

// ============================================
// Component
// ============================================

interface MergedTreeMeshProps {
  treeBlocksByChunk: Map<string, PlacedBlock[]>;
  atlasTexture: THREE.Texture | null;
  atlasReady: boolean;
  onMeshReady?: (blockType: string, mesh: THREE.InstancedMesh | null) => void;
}

export const MergedTreeMesh: React.FC<MergedTreeMeshProps> = ({
  treeBlocksByChunk,
  atlasTexture,
  atlasReady,
  onMeshReady,
}) => {
  // ---- Refs ----
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const allocatorRef = useRef(new MergedMeshAllocator());
  const capacityRef = useRef(INITIAL_CAPACITY);

  // Track which blocks ref each chunk was built from (detect changes)
  const chunkBlocksRef = useRef(new Map<string, PlacedBlock[]>());

  // Worker version tracking (global counter for stale detection)
  const workerVersionRef = useRef(0);
  // Per-chunk pending worker version (to discard stale results)
  const pendingChunks = useRef(new Map<string, number>());

  // Shrine tracking for this mesh
  const shrineInstancesRef = useRef<Array<{ instanceIdx: number; x: number; y: number; z: number }>>([]);
  const lastShrineGlowState = useRef(false);
  const lastShrineCheckTime = useRef(0);
  // Per-chunk shrine positions for cleanup when chunks unload
  const chunkShrinePositions = useRef(new Map<string, Array<{ x: number; y: number; z: number }>>());

  // Atlas version tracking
  const lastAtlasVersionRef = useRef(0);

  // Instance → block mapping for raycasting
  const instanceBlockMapRef = useRef(new Map<number, PlacedBlock>());

  // Falling blocks: blockId → { instanceIndex, block }
  const blockByIdRef = useRef(new Map<string, { instanceIndex: number; block: PlacedBlock }>());
  const previouslyFallingRef = useRef(new Set<string>());
  const currentlyFallingRef = useRef(new Set<string>());

  // Staggered worker dispatch queue (avoids synchronous stall from many dispatches at once)
  const dispatchQueueRef = useRef<Array<{ key: string; blocks: PlacedBlock[] }>>([]);

  // Attribute refs
  const uvAttrRef = useRef<THREE.InstancedBufferAttribute | null>(null);
  const colorAttrRef = useRef<THREE.InstancedBufferAttribute | null>(null);

  // Reusable matrix
  const matrixRef = useRef(new THREE.Matrix4());

  // ---- Material ----
  const materialRef = useRef<THREE.MeshLambertMaterial | null>(null);
  const material = useMemo(() => {
    if (!atlasTexture) return null;
    materialRef.current?.dispose();
    const mat = createTreeAtlasMaterial(atlasTexture);
    materialRef.current = mat;
    return mat;
  }, [atlasTexture]);

  // ---- Geometry ----
  const geometry = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);

  // ---- Cleanup ----
  useEffect(() => {
    return () => {
      materialRef.current?.dispose();
      materialRef.current = null;
      geometry.dispose();
      meshRef.current?.dispose();
    };
  }, [geometry]);

  // ---- Notify parent (raycasting) ----
  useEffect(() => {
    if (meshRef.current && onMeshReady) {
      onMeshReady('tree_atlas_merged', meshRef.current);
    }
    return () => { onMeshReady?.('tree_atlas_merged', null); };
  }, [onMeshReady, material]);

  // ---- GPU attribute setup (runs once when mesh mounts) ----
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const cap = capacityRef.current;

    // UV offset attribute
    const uvData = new Float32Array(cap * 2);
    const uvAttr = new THREE.InstancedBufferAttribute(uvData, 2);
    mesh.geometry.setAttribute('instanceUvOffset', uvAttr);
    uvAttrRef.current = uvAttr;

    // Color attribute (branch depth + glow bark)
    const colorData = new Float32Array(cap * 3);
    // Default to white
    for (let i = 0; i < cap * 3; i++) colorData[i] = 1.0;
    const colorAttr = new THREE.InstancedBufferAttribute(colorData, 3);
    mesh.geometry.setAttribute('instanceColor', colorAttr);
    colorAttrRef.current = colorAttr;

    // Use DynamicDrawUsage for frequently updated buffers (partial uploads)
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    uvAttr.setUsage(THREE.DynamicDrawUsage);
    colorAttr.setUsage(THREE.DynamicDrawUsage);

    mesh.count = 0;
  }, [material]); // re-runs when material changes (mesh recreated)

  // ---- Write worker result to buffers at offset ----
  const writeChunkData = useCallback((
    chunkKey: string,
    blocks: PlacedBlock[],
    result: { matrixData: Float32Array; uvOffsetData: Float32Array; colorData: Float32Array; shrineIndices: number[]; blockCount: number; minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number; hasBranchDepth: boolean },
  ) => {
    const mesh = meshRef.current;
    const allocator = allocatorRef.current;
    if (!mesh) return;

    const slot = allocator.getSlot(chunkKey);
    if (!slot) return; // chunk was removed before worker finished

    const start = slot.start;
    const bc = result.blockCount;

    // Copy to GPU matrix buffer (partial upload — only this chunk's range)
    (mesh.instanceMatrix.array as Float32Array).set(
      result.matrixData.subarray(0, bc * 16), start * 16
    );
    mesh.instanceMatrix.addUpdateRange(start * 16, bc * 16);
    mesh.instanceMatrix.needsUpdate = true;

    if (uvAttrRef.current) {
      (uvAttrRef.current.array as Float32Array).set(
        result.uvOffsetData.subarray(0, bc * 2), start * 2
      );
      uvAttrRef.current.addUpdateRange(start * 2, bc * 2);
      uvAttrRef.current.needsUpdate = true;
    }

    if (colorAttrRef.current) {
      (colorAttrRef.current.array as Float32Array).set(
        result.colorData.subarray(0, bc * 3), start * 3
      );
      colorAttrRef.current.addUpdateRange(start * 3, bc * 3);
      colorAttrRef.current.needsUpdate = true;
    }

    // Update bounding box
    slot.minX = result.minX; slot.minY = result.minY; slot.minZ = result.minZ;
    slot.maxX = result.maxX; slot.maxY = result.maxY; slot.maxZ = result.maxZ;

    // Track shrine blocks (global indices)
    if (result.shrineIndices.length > 0) {
      const newShrines = result.shrineIndices.map(localIdx => ({
        instanceIdx: start + localIdx,
        x: blocks[localIdx]?.position_x ?? 0,
        y: blocks[localIdx]?.position_y ?? 0,
        z: blocks[localIdx]?.position_z ?? 0,
      }));
      // Remove old shrine entries for this chunk, add new ones
      shrineInstancesRef.current = shrineInstancesRef.current
        .filter(s => s.instanceIdx < start || s.instanceIdx >= start + bc)
        .concat(newShrines);
      lastShrineGlowState.current = false; // reset glow check
    }

    // Build instance → block mapping for raycasting
    const map = instanceBlockMapRef.current;
    const byId = blockByIdRef.current;
    for (let i = 0; i < bc; i++) {
      const globalIdx = start + i;
      map.set(globalIdx, blocks[i]);
      byId.set(blocks[i].id, { instanceIndex: globalIdx, block: blocks[i] });
    }

    // Set mesh count
    mesh.count = allocator.highWaterMark;

    // Update overall bounding box
    updateMeshBounds(mesh, allocator);
  }, []);

  // ---- Dispatch worker for a chunk ----
  const dispatchChunkWorker = useCallback((chunkKey: string, blocks: PlacedBlock[]) => {
    const allocator = allocatorRef.current;
    const version = ++workerVersionRef.current;
    pendingChunks.current.set(chunkKey, version);

    const pool = getMeshWorkerPool();
    const uvResolver = (bt: string) => {
      const ai = getCachedAnimInfo(bt);
      if (ai && ai.frameCount > 1) return getAnimatedUVOffset(ai.baseSlotIndex, 0);
      return getCachedUVs(bt);
    };

    pool.rebuild(
      blocks,
      blocks.length, // exact capacity — worker allocates just what's needed
      uvResolver,
      (bt) => bt.charCodeAt(0) === 103 && bt.charCodeAt(1) === 98, // 'gb'
      (bt) => bt.charCodeAt(0) === 115 && bt.charCodeAt(1) === 104 && bt.charCodeAt(2) === 114, // 'shr'
      version,
    ).then((result) => {
      // Discard stale results
      const expected = pendingChunks.current.get(chunkKey);
      if (expected !== version) return;
      pendingChunks.current.delete(chunkKey);

      writeChunkData(chunkKey, blocks, result);
    }).catch((err) => {
      console.warn(`[MergedTreeMesh] Worker error for ${chunkKey}:`, err);
      pendingChunks.current.delete(chunkKey);
    });
  }, [writeChunkData]);

  // Keep dispatch function in a ref so the frame loop can access it
  const dispatchFnRef = useRef(dispatchChunkWorker);
  dispatchFnRef.current = dispatchChunkWorker;

  // ---- Diff treeBlocksByChunk on change ----
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || !atlasReady || !atlasTexture) return;

    const allocator = allocatorRef.current;
    const prevBlocks = chunkBlocksRef.current;

    // Check for atlas version change → clear UV caches and rebuild all
    const currentAtlasVersion = getAtlasVersion();
    const atlasChanged = currentAtlasVersion !== lastAtlasVersionRef.current;
    if (atlasChanged) {
      lastAtlasVersionRef.current = currentAtlasVersion;
      uvCache.clear();
      animCache.clear();
    }

    // Collect chunks to add, remove, rebuild
    const toRemove: string[] = [];
    const toAdd: Array<{ key: string; blocks: PlacedBlock[] }> = [];

    // Find removed chunks (in allocator but not in new data)
    for (const key of allocator.getAllSlots().keys()) {
      if (!treeBlocksByChunk.has(key)) {
        toRemove.push(key);
      }
    }

    // Find added and changed chunks
    for (const [key, blocks] of treeBlocksByChunk) {
      if (!allocator.hasChunk(key)) {
        toAdd.push({ key, blocks });
      } else if (prevBlocks.get(key) !== blocks || atlasChanged) {
        // Blocks ref changed or atlas changed → rebuild
        toRemove.push(key);
        toAdd.push({ key, blocks });
      }
    }

    // Nuclear reset: if most chunks need removal (world change, atlas rebuild),
    // clear everything and re-add from scratch to avoid expensive sequential shifts
    if (toRemove.length > 0 && toRemove.length >= allocator.chunkCount * 0.5) {
      allocator.clear();
      mesh.count = 0;
      instanceBlockMapRef.current.clear();
      blockByIdRef.current.clear();
      shrineInstancesRef.current = [];
      shrineTracker.clearBlocks();
      chunkShrinePositions.current.clear();
      prevBlocks.clear();

      // Re-add all chunks fresh
      for (const [key, blocks] of treeBlocksByChunk) {
        if (blocks.length === 0) continue;
        const start = allocator.addChunk(key, blocks.length, {
          minX: Infinity, minY: Infinity, minZ: Infinity,
          maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity,
        });
        if (allocator.highWaterMark > capacityRef.current) {
          console.warn(`[MergedTreeMesh] Capacity exceeded on reset`);
          allocator.removeChunk(key);
          continue;
        }
        zeroScaleRange(mesh.instanceMatrix.array as Float32Array, start, blocks.length);
        dispatchQueueRef.current.push({ key, blocks });
        prevBlocks.set(key, blocks);
      }
      mesh.count = allocator.highWaterMark;
      if (allocator.highWaterMark > 0) {
        mesh.instanceMatrix.addUpdateRange(0, allocator.highWaterMark * 16);
      }
      mesh.instanceMatrix.needsUpdate = true;
      chunkBlocksRef.current = new Map(treeBlocksByChunk);
      return;
    }

    // Incremental update: process individual removals and additions

    // Process removals first (frees buffer space via free-list — no shifting)
    for (const key of toRemove) {
      const removed = allocator.removeChunk(key);
      if (removed) {
        // Zero-scale the freed range (partial upload — only this chunk's range)
        zeroScaleRange(mesh.instanceMatrix.array as Float32Array, removed.start, removed.count);
        mesh.instanceMatrix.addUpdateRange(removed.start * 16, removed.count * 16);
        mesh.instanceMatrix.needsUpdate = true;

        // Clean up instance maps for removed range (no shifting needed)
        const map = instanceBlockMapRef.current;
        const byId = blockByIdRef.current;
        for (let i = removed.start; i < removed.start + removed.count; i++) {
          const block = map.get(i);
          if (block) byId.delete(block.id);
          map.delete(i);
        }

        // Remove shrine entries in removed range (no index shifting needed)
        shrineInstancesRef.current = shrineInstancesRef.current
          .filter(s => s.instanceIdx < removed.start || s.instanceIdx >= removed.start + removed.count);

        // Unregister shrine positions from global tracker for this chunk
        const storedShrines = chunkShrinePositions.current.get(key);
        if (storedShrines) {
          for (const pos of storedShrines) {
            shrineTracker.unregisterShrineBlock(pos.x, pos.y, pos.z);
          }
          chunkShrinePositions.current.delete(key);
        }
      }
      prevBlocks.delete(key);
    }

    // Update mesh count after removals
    mesh.count = allocator.highWaterMark;

    // Defragment if >50% of buffer is wasted (dead gaps from free-list)
    // This prevents highWaterMark (and thus mesh.count / GPU vertex work) from
    // staying near peak after many chunks unload from interior positions.
    if (allocator.wastedCount > allocator.liveCount && allocator.liveCount > 0) {
      allocator.clear();
      mesh.count = 0;
      instanceBlockMapRef.current.clear();
      blockByIdRef.current.clear();
      shrineInstancesRef.current = [];
      shrineTracker.clearBlocks();
      chunkShrinePositions.current.clear();
      prevBlocks.clear();

      for (const [key, blocks] of treeBlocksByChunk) {
        if (blocks.length === 0) continue;
        const start = allocator.addChunk(key, blocks.length, {
          minX: Infinity, minY: Infinity, minZ: Infinity,
          maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity,
        });
        if (allocator.highWaterMark > capacityRef.current) {
          allocator.removeChunk(key);
          continue;
        }
        zeroScaleRange(mesh.instanceMatrix.array as Float32Array, start, blocks.length);
        dispatchQueueRef.current.push({ key, blocks });
        prevBlocks.set(key, blocks);
      }
      mesh.count = allocator.highWaterMark;
      if (allocator.highWaterMark > 0) {
        mesh.instanceMatrix.addUpdateRange(0, allocator.highWaterMark * 16);
      }
      mesh.instanceMatrix.needsUpdate = true;
      chunkBlocksRef.current = new Map(treeBlocksByChunk);
      return;
    }

    // Process additions
    for (const { key, blocks } of toAdd) {
      if (blocks.length === 0) continue;

      // Allocate slot (appends at end)
      const start = allocator.addChunk(key, blocks.length, {
        minX: Infinity, minY: Infinity, minZ: Infinity,
        maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity,
      });

      // Check capacity
      if (allocator.highWaterMark > capacityRef.current) {
        console.warn(`[MergedTreeMesh] Capacity exceeded: ${allocator.highWaterMark} > ${capacityRef.current}`);
        // For now, skip this chunk. Capacity growth would require mesh recreation.
        allocator.removeChunk(key);
        continue;
      }

      // Set mesh count to include the new slot (worker will fill data async)
      mesh.count = allocator.highWaterMark;

      // Initialize with zero-scale until worker data arrives (partial upload)
      zeroScaleRange(mesh.instanceMatrix.array as Float32Array, start, blocks.length);
      mesh.instanceMatrix.addUpdateRange(start * 16, blocks.length * 16);
      mesh.instanceMatrix.needsUpdate = true;

      // Queue worker dispatch (processed in frame loop to avoid synchronous stall)
      dispatchQueueRef.current.push({ key, blocks });

      // Register shrine blocks for proximity detection and track per chunk for cleanup
      const shrinePositions: Array<{ x: number; y: number; z: number }> = [];
      for (const b of blocks) {
        const bt = b.block_type;
        if (bt.charCodeAt(0) === 115 && bt.charCodeAt(1) === 104 && bt.charCodeAt(2) === 114) {
          shrinePositions.push({ x: b.position_x, y: b.position_y, z: b.position_z });
        }
      }
      if (shrinePositions.length > 0) {
        shrineTracker.registerShrineBlocks(shrinePositions);
        chunkShrinePositions.current.set(key, shrinePositions);
      }

      prevBlocks.set(key, blocks);
    }

    // Update chunkBlocksRef
    chunkBlocksRef.current = new Map(treeBlocksByChunk);
  }, [treeBlocksByChunk, atlasReady, atlasTexture]);

  // ---- Frame loop: frustum culling + shrine glow + falling blocks ----
  useEffect(() => {
    const unregister = frameLoop.register('merged-tree-mesh', (delta) => {
      const mesh = meshRef.current;
      if (!mesh || mesh.count === 0) return;

      let matrixNeedsUpdate = false;
      let colorNeedsUpdate = false;

      // ========== DISPATCH QUEUE (staggered worker dispatch, max 8/frame) ==========
      const queue = dispatchQueueRef.current;
      if (queue.length > 0) {
        const batch = Math.min(queue.length, 8);
        const fn = dispatchFnRef.current;
        for (let i = 0; i < batch; i++) {
          const item = queue.shift()!;
          fn(item.key, item.blocks);
        }
      }

      // NOTE: No per-frame frustum culling. The GPU clips out-of-frustum triangles
      // natively with negligible cost. Modifying the 19.2MB matrix buffer every frame
      // to zero-scale hidden chunks was causing a full bufferSubData upload per frame,
      // which was the dominant performance bottleneck (50+ ms on macOS/Metal).

      // ========== SHRINE PROXIMITY GLOW (throttled to 100ms) ==========
      const shrines = shrineInstancesRef.current;
      if (shrines.length > 0 && colorAttrRef.current) {
        const now = performance.now();
        if (now - lastShrineCheckTime.current >= 100) {
          lastShrineCheckTime.current = now;

          const player = playerTracker.getPlayerById('local');
          let isNearShrine = false;
          if (player) {
            isNearShrine = shrineTracker.hasShrineBLockNearby(
              player.position.x, player.position.y, player.position.z, 5
            );
          }

          if (isNearShrine !== lastShrineGlowState.current) {
            lastShrineGlowState.current = isNearShrine;
            const colorArr = colorAttrRef.current.array as Float32Array;
            const colorAttr = colorAttrRef.current;
            for (const s of shrines) {
              const idx = s.instanceIdx;
              if (isNearShrine) {
                colorArr[idx * 3] = 1.8;
                colorArr[idx * 3 + 1] = 0.8;
                colorArr[idx * 3 + 2] = 2.0;
              } else {
                colorArr[idx * 3] = 1.0;
                colorArr[idx * 3 + 1] = 1.0;
                colorArr[idx * 3 + 2] = 1.0;
              }
              colorAttr.addUpdateRange(idx * 3, 3);
            }
            colorNeedsUpdate = true;
          }
        }
      }

      // ========== FALLING BLOCKS ==========
      const hasFalling = fallingBlocksState.size > 0;
      const hadFalling = previouslyFallingRef.current.size > 0;

      if (hasFalling || hadFalling) {
        const currentlyFalling = currentlyFallingRef.current;
        currentlyFalling.clear();
        const blockById = blockByIdRef.current;
        const matrix = matrixRef.current;

        fallingBlocksState.forEach((fallState, blockId) => {
          const entry = blockById.get(blockId);
          if (!entry) return;
          currentlyFalling.add(blockId);

          matrix.setPosition(
            entry.block.position_x + 0.5,
            fallState.currentY + 0.5,
            entry.block.position_z + 0.5
          );
          const base = entry.instanceIndex * 16;
          const gpuMatrix = mesh.instanceMatrix.array as Float32Array;
          // Write identity matrix with position (column-major)
          gpuMatrix[base] = 1; gpuMatrix[base + 1] = 0; gpuMatrix[base + 2] = 0; gpuMatrix[base + 3] = 0;
          gpuMatrix[base + 4] = 0; gpuMatrix[base + 5] = 1; gpuMatrix[base + 6] = 0; gpuMatrix[base + 7] = 0;
          gpuMatrix[base + 8] = 0; gpuMatrix[base + 9] = 0; gpuMatrix[base + 10] = 1; gpuMatrix[base + 11] = 0;
          gpuMatrix[base + 12] = entry.block.position_x + 0.5;
          gpuMatrix[base + 13] = fallState.currentY + 0.5;
          gpuMatrix[base + 14] = entry.block.position_z + 0.5;
          gpuMatrix[base + 15] = 1;
          mesh.instanceMatrix.addUpdateRange(entry.instanceIndex * 16, 16);
          matrixNeedsUpdate = true;
        });

        // Reset blocks that stopped falling
        previouslyFallingRef.current.forEach(blockId => {
          if (!currentlyFalling.has(blockId)) {
            const entry = blockById.get(blockId);
            if (entry) {
              const base = entry.instanceIndex * 16;
              const gpuMatrix = mesh.instanceMatrix.array as Float32Array;
              gpuMatrix[base + 13] = entry.block.position_y + 0.5; // restore Y
              mesh.instanceMatrix.addUpdateRange(entry.instanceIndex * 16, 16);
              matrixNeedsUpdate = true;
            }
          }
        });

        const temp = previouslyFallingRef.current;
        previouslyFallingRef.current = currentlyFalling;
        currentlyFallingRef.current = temp;
      }

      if (matrixNeedsUpdate) mesh.instanceMatrix.needsUpdate = true;
      if (colorNeedsUpdate && colorAttrRef.current) colorAttrRef.current.needsUpdate = true;
    }, 55); // After frustum-update (5), before other rendering

    return unregister;
  }, []);

  // ---- D-Flow: track single draw call ----
  useEffect(() => {
    diagnostics.mountDrawCall('treeAtlas');
    return () => { diagnostics.unmountDrawCall('treeAtlas'); };
  }, []);

  // ---- Render ----
  if (!material || !atlasReady) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, capacityRef.current]}
      frustumCulled={false}
      castShadow
      receiveShadow
    />
  );
};

// ---- Helper: update mesh's overall bounding box from all chunk slots ----
function updateMeshBounds(mesh: THREE.InstancedMesh, allocator: MergedMeshAllocator) {
  let gMinX = Infinity, gMinY = Infinity, gMinZ = Infinity;
  let gMaxX = -Infinity, gMaxY = -Infinity, gMaxZ = -Infinity;

  for (const slot of allocator.getAllSlots().values()) {
    if (slot.minX < gMinX) gMinX = slot.minX;
    if (slot.minY < gMinY) gMinY = slot.minY;
    if (slot.minZ < gMinZ) gMinZ = slot.minZ;
    if (slot.maxX > gMaxX) gMaxX = slot.maxX;
    if (slot.maxY > gMaxY) gMaxY = slot.maxY;
    if (slot.maxZ > gMaxZ) gMaxZ = slot.maxZ;
  }

  if (gMinX < Infinity) {
    mesh.boundingBox ??= new THREE.Box3();
    mesh.boundingBox.min.set(gMinX, gMinY, gMinZ);
    mesh.boundingBox.max.set(gMaxX, gMaxY, gMaxZ);
    mesh.boundingSphere ??= new THREE.Sphere();
    mesh.boundingBox.getBoundingSphere(mesh.boundingSphere);
    mesh.geometry.boundingBox = mesh.boundingBox.clone();
    mesh.geometry.boundingSphere = mesh.boundingSphere.clone();
  }
}

export default MergedTreeMesh;
