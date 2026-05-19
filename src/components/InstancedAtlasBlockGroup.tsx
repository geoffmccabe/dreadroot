/**
 * InstancedAtlasBlockGroup
 *
 * Renders instanced blocks using a texture atlas for minimal draw calls.
 * Each instance has its own UV offset to sample the correct region of the atlas.
 *
 * Key difference from InstancedBlockGroup:
 * - All instances share ONE texture (the atlas)
 * - Per-instance UV offsets select which texture region to use
 * - Dramatically reduces draw calls for tree blocks
 */

import React, { useRef, useMemo, useEffect, useState, useCallback } from 'react';
import * as THREE from 'three';
import { PlacedBlock, BlockType } from '@/types/blocks';
import { fallingBlocksState } from './PlacedBlocks';
import { diagnostics } from '@/lib/diagnosticsLogger';
import { frameLoop } from '@/lib/frameLoop';
import { ATLAS_GRID_SIZE } from '@/lib/textureAtlas';
// enqueueJob no longer used — atlas rebuild uses its own RAF loop
// to avoid being blocked by collider removal jobs in the shared queue
import {
  getInstanceUVsForTreeBlock,
  getGlobalAtlasTexture,
  isAtlasReady,
  getAtlasVersion,
  getTreeBlockAnimationInfo,
  getAnimatedUVOffset,
} from '@/hooks/useTextureAtlas';
import { playerTracker } from '@/lib/playerTracker';
import { shrineTracker } from '@/lib/shrineTracker';
import { meshWorkerPool } from '@/lib/meshWorker/meshWorkerPool';
import { packChunkBlocks } from '@/lib/meshWorker/blockPack';

// #2 Phase 2a: off-thread mesh build — TEMPORARILY OFF (2026-May-19).
// First real-world DF report after enabling showed a regression: 16.5fps
// avg, 1720ms max frame, 9103ms in long tasks / 15s. Root cause: the
// worker BUILDS off-thread but the APPLY (Float32Array copies, attribute
// updates, posMap rebuild) runs all-at-once on the main thread, whereas
// the pre-#2 sync path BUDGETED that work across many frames at 2ms each.
// We traded many small stutters for fewer big ones. Reverting until the
// apply is itself budgeted (chunked across frames) OR limited to small
// chunks. Diagnostics now record real apply ms (no more 0ms lies),
// fallback count, and incremental vs full rebuild separately.
const WORKER_MESH_ENABLED = false;

// Shared geometry for all block instances
const sharedEdgesGeometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));

// UV lookup cache: block_type string → { uvOffsetX, uvOffsetY }
// Only ~30 unique tree block types exist (10 tiers × 3 types), so 99%+ of
// 44K lookups per rebuild hit this cache instead of decoding strings.
const uvLookupCache = new Map<string, { uvOffsetX: number; uvOffsetY: number }>();
const animInfoCache = new Map<string, ReturnType<typeof getTreeBlockAnimationInfo>>();
// Diagnostic: track which block types have been logged (fires once per unique type, ~30 max)
const _uvDiagLogged = new Set<string>();

function getCachedUVs(blockType: string): { uvOffsetX: number; uvOffsetY: number } {
  let cached = uvLookupCache.get(blockType);
  if (!cached) {
    cached = getInstanceUVsForTreeBlock(blockType);
    uvLookupCache.set(blockType, cached);
    if (!_uvDiagLogged.has(blockType)) {
      _uvDiagLogged.add(blockType);
      console.log(`[AtlasUV] ${blockType} → uv(${cached.uvOffsetX.toFixed(4)}, ${cached.uvOffsetY.toFixed(4)})`);
    }
  }
  return cached;
}

function getCachedAnimInfo(blockType: string) {
  if (animInfoCache.has(blockType)) return animInfoCache.get(blockType)!;
  const info = getTreeBlockAnimationInfo(blockType);
  animInfoCache.set(blockType, info);
  return info;
}

// Numeric position key: collision-free for block coords in [-32768, 32767]
// Eliminates string allocation that causes GC pressure during incremental updates
function numPosKey(x: number, y: number, z: number): number {
  return (x + 32768) * 4294967296 + (y + 32768) * 65536 + (z + 32768);
}

// Threshold for auto-enabling performance mode
// ── Cross-chunk frame-budgeted rebuild scheduler ──────────────────────────────
// On region entry many chunks request a sync rebuild in the same few frames.
// Run them per-instance-synchronously but spread ACROSS frames within a time
// budget, so a burst can't stack into one 0.3–2.9s main-thread stall (it
// becomes a brief progressive fill instead). Keyed per instance (latest wins).
const _pendingRebuilds = new Map<object, () => void>();
let _rebuildDriverScheduled = false;
const REBUILD_FRAME_BUDGET_MS = 8;
function _runRebuildDriver() {
  _rebuildDriverScheduled = false;
  const start = performance.now();
  for (const [key, fn] of _pendingRebuilds) {
    _pendingRebuilds.delete(key);
    try { fn(); } catch { /* one bad chunk must not block the rest */ }
    if (performance.now() - start >= REBUILD_FRAME_BUDGET_MS) break;
  }
  if (_pendingRebuilds.size > 0) _ensureRebuildDriver();
}
function _ensureRebuildDriver() {
  if (_rebuildDriverScheduled) return;
  _rebuildDriverScheduled = true;
  requestAnimationFrame(_runRebuildDriver);
}
function scheduleSyncRebuild(key: object, fn: () => void) {
  _pendingRebuilds.set(key, fn); // dedup per instance — newest data wins
  _ensureRebuildDriver();
}

const AUTO_PERFORMANCE_MODE_THRESHOLD = 1000;

// One shared material per atlas texture. Each material with onBeforeCompile
// compiles its own GPU shader program; creating one per chunk recompiled
// shaders on every chunk stream-in during flight (profile: getProgramInfoLog
// ~3.7% self-time + long-frame hitches). Per-instance data is via instance
// attributes, not material state, so sharing is safe. WeakMap so a retired
// atlas texture's material is GC'd with it.
const _sharedAtlasMaterialByTexture = new WeakMap<THREE.Texture, THREE.MeshLambertMaterial>();
let _lastSharedTex: THREE.Texture | null = null;
let _lastSharedMat: THREE.MeshLambertMaterial | null = null;
function getSharedAtlasMaterial(atlasTexture: THREE.Texture): THREE.MeshLambertMaterial {
  let m = _sharedAtlasMaterialByTexture.get(atlasTexture);
  if (!m) {
    // Atlas texture changed (e.g. atlas version bump → new texture object).
    // Dispose the previous shared material's GPU program: WeakMap GC frees
    // the JS entry but NOT the WebGL program — THREE needs explicit dispose()
    // or it leaks one program per atlas rebuild. All instances use the same
    // current atlas texture, so the old material is safe to drop here.
    if (_lastSharedMat && _lastSharedTex && _lastSharedTex !== atlasTexture) {
      _lastSharedMat.dispose();
      _sharedAtlasMaterialByTexture.delete(_lastSharedTex);
    }
    m = createAtlasMaterial(atlasTexture);
    _sharedAtlasMaterialByTexture.set(atlasTexture, m);
  }
  _lastSharedTex = atlasTexture;
  _lastSharedMat = m;
  return m;
}

interface InstancedAtlasBlockGroupProps {
  blocks: PlacedBlock[];
  blockDef: BlockType;
  geometry: THREE.BoxGeometry;
  atlasTexture: THREE.Texture;
  showOwnershipOutline?: boolean;
  currentUserId?: string;
  hoveredBlockId?: string | null;
  onMeshReady?: (mesh: THREE.InstancedMesh | null) => void;
  performanceMode?: boolean;
}

/**
 * Create a material with custom shader modifications for atlas UV offsets
 * and per-face directional shading for depth perception
 */
function createAtlasMaterial(atlasTexture: THREE.Texture): THREE.MeshLambertMaterial {
  const material = new THREE.MeshLambertMaterial({
    map: atlasTexture,
    color: 0xffffff,
    transparent: false,  // Don't use alpha from texture
    alphaTest: 0,        // Don't discard based on alpha
  });

  // Inject custom shader code to handle per-instance UV offsets and face shading
  material.onBeforeCompile = (shader) => {
    // Add attribute for UV offset and varying for face shading
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>
      attribute vec2 instanceUvOffset;
      varying vec2 vInstanceUvOffset;
      varying float vFaceShade;`
    );

    // Pass UV offset and calculate face shading based on normal
    // Top (+Y) = 1.0, Sides = 0.85, Bottom (-Y) = 0.65
    shader.vertexShader = shader.vertexShader.replace(
      '#include <uv_vertex>',
      `#include <uv_vertex>
      vInstanceUvOffset = instanceUvOffset;

      // Per-face directional shading based on world normal
      vec3 worldNormal = normalize(mat3(modelMatrix) * normal);
      if (worldNormal.y > 0.5) {
        vFaceShade = 1.0;        // Top face - full brightness
      } else if (worldNormal.y < -0.5) {
        vFaceShade = 0.65;       // Bottom face - darkest
      } else if (abs(worldNormal.z) > 0.5) {
        vFaceShade = 0.8;        // Front/back faces - medium
      } else {
        vFaceShade = 0.9;        // Left/right faces - slightly darker
      }`
    );

    // Receive UV offset and face shade in fragment shader
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
      varying vec2 vInstanceUvOffset;
      varying float vFaceShade;`
    );

    // Apply UV offset when sampling the texture and apply face shading
    // The atlas has 32x32 slots, so each slot is 1/32 of the texture
    const slotSize = 1.0 / ATLAS_GRID_SIZE;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#ifdef USE_MAP
        // Apply instance UV offset to map the correct atlas region
        vec2 slotUv = clamp(fract(vMapUv), vec2(${(4.0/256).toFixed(6)}), vec2(${(1 - 4.0/256).toFixed(6)}));
        vec2 atlasUv = vInstanceUvOffset + slotUv * ${slotSize.toFixed(6)};
        vec4 sampledDiffuseColor = texture2D(map, atlasUv);
        // Apply per-face directional shading for depth perception
        sampledDiffuseColor.rgb *= vFaceShade;
        diffuseColor *= sampledDiffuseColor;
      #endif`
    );
  };

  return material;
}

export const InstancedAtlasBlockGroup: React.FC<InstancedAtlasBlockGroupProps> = ({
  blocks,
  blockDef,
  geometry,
  atlasTexture,
  showOwnershipOutline = false,
  currentUserId,
  hoveredBlockId = null,
  onMeshReady,
  performanceMode = false,
}) => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const materialRef = useRef<THREE.MeshLambertMaterial | null>(null);
  const uvOffsetAttrRef = useRef<THREE.InstancedBufferAttribute | null>(null);

  // Track atlas version to rebuild UV offsets when atlas updates
  const [atlasVersion, setAtlasVersion] = useState(() => getAtlasVersion());
  const lastAtlasVersionRef = useRef(atlasVersion);

  // Check for atlas version changes periodically
  useEffect(() => {
    const checkVersion = () => {
      const currentVersion = getAtlasVersion();
      if (currentVersion !== lastAtlasVersionRef.current) {
        lastAtlasVersionRef.current = currentVersion;
        setAtlasVersion(currentVersion);
      }
    };

    const interval = setInterval(checkVersion, 200);
    return () => clearInterval(interval);
  }, []);

  // Performance mode auto-enable for large block counts
  const effectivePerformanceMode = performanceMode || blocks.length > AUTO_PERFORMANCE_MODE_THRESHOLD;
  const fxEnabled = !effectivePerformanceMode;
  const effectiveShowOwnershipOutline = fxEnabled && showOwnershipOutline;
  const effectiveHoveredBlockId = fxEnabled ? hoveredBlockId : null;

  // Reuse matrix to avoid GC
  const matrixRef = useRef(new THREE.Matrix4());

  // Shrine glow tracking - stores instance indices and positions of shrine blocks
  const shrineBlocksRef = useRef<Array<{ index: number; x: number; y: number; z: number }>>([]);
  const lastShrineGlowState = useRef<boolean>(false);
  const lastShrineCheckTime = useRef<number>(0);

  // Track refs for efficient updates
  const effectiveShowOwnershipOutlineRef = useRef(effectiveShowOwnershipOutline);
  effectiveShowOwnershipOutlineRef.current = effectiveShowOwnershipOutline;

  // Use the shared per-texture material (compiled once, reused by every
  // chunk) instead of one material per component. Do NOT dispose it here —
  // it is shared; disposing on one chunk's unmount would break all others.
  const material = useMemo(() => {
    if (!atlasTexture) return null;
    const mat = getSharedAtlasMaterial(atlasTexture);
    materialRef.current = mat;
    return mat;
  }, [atlasTexture]);

  // Notify parent when mesh is ready (material gates mesh creation)
  useEffect(() => {
    if (meshRef.current && onMeshReady) {
      onMeshReady(meshRef.current);
    }
    return () => {
      if (onMeshReady) {
        onMeshReady(null);
      }
    };
  }, [onMeshReady, material]);

  // Track last processed signature to skip redundant rebuilds
  const lastProcessedSignatureRef = useRef<string>('');

  // Throttle rebuilds/incremental updates to prevent frame spikes during rapid changes
  const lastRebuildTimeRef = useRef<number>(0);
  const pendingRebuildRef = useRef<boolean>(false);
  const rebuildTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const REBUILD_THROTTLE_MS = 50; // Max one rebuild per 50ms
  const lastIncrementalTimeRef = useRef<number>(0);
  const pendingIncrementalRef = useRef<boolean>(false);
  const incrementalTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const INCREMENTAL_THROTTLE_MS = 50; // Max one incremental per 50ms
  const rebuildRafRef = useRef<number | null>(null);

  // CRITICAL: Use stable mesh capacity to prevent mesh recreation on chunk boundaries
  // Capacity only grows, never shrinks - this keeps the same mesh instance
  const meshCapacityRef = useRef<number>(Math.max(blocks.length, 100));
  if (blocks.length > meshCapacityRef.current) {
    // Grow capacity with some headroom to reduce future reallocations
    meshCapacityRef.current = Math.ceil(blocks.length * 1.5);
  }
  const meshCapacity = meshCapacityRef.current;

  // Reusable buffers (avoid allocation on every update)
  const uvBufferRef = useRef<Float32Array | null>(null);
  const colorBufferRef = useRef<Float32Array | null>(null);
  const colorAttrRef = useRef<THREE.InstancedBufferAttribute | null>(null);
  // Reusable Set for incremental seen-keys (avoids 150K-entry Set allocation per call)
  const seenKeysRef = useRef<Set<number>>(new Set());

  // Store blocks ref for deferred access
  const blocksRef = useRef<PlacedBlock[]>(blocks);
  blocksRef.current = blocks;

  // Stable instance index tracking for incremental (delta) updates
  // Maps numeric position key → { instanceIndex, blockType, branchDepth }
  // Numeric keys eliminate string allocation GC pressure (3-5x faster than string keys)
  interface StableIndexEntry {
    index: number;
    blockType: string;
    branchDepth: number | undefined;
    x: number;
    y: number;
    z: number;
  }
  const positionIndexMapRef = useRef<Map<number, StableIndexEntry>>(new Map());
  const freeIndicesRef = useRef<number[]>([]);
  const highWaterMarkRef = useRef<number>(0);
  const initialBuildDoneRef = useRef<boolean>(false);
  // Track mesh identity to detect recreation (meshCapacity growth)
  const lastMeshObjRef = useRef<THREE.InstancedMesh | null>(null);
  // Block lookup by ID for falling blocks (maps blockId → { instanceIndex, block })
  const blockByIdRef = useRef<Map<string, { instanceIndex: number; block: PlacedBlock }>>(new Map());

  // Track animated blocks for UV offset cycling
  interface AnimatedBlockInfo {
    blockIndex: number;
    frameCount: number;
    frameDelayMs: number;
    baseSlotIndex: number;
  }
  const animatedBlocksRef = useRef<AnimatedBlockInfo[]>([]);

  // B9: Track rebuild state for budgeted processing
  const rebuildStateRef = useRef<{
    blocks: PlacedBlock[];
    idx: number;
    version: number;
    prevCount: number;
    uvOffsetData: Float32Array;
    colorData: Float32Array;
    animatedBlocks: AnimatedBlockInfo[];
    shrineBlocks: Array<{ index: number; x: number; y: number; z: number }>;
    hasBranchDepth: boolean;
    minX: number; minY: number; minZ: number;
    maxX: number; maxY: number; maxZ: number;
    startTime: number;
  } | null>(null);
  const rebuildVersionRef = useRef(0);
  // #2: build-version of an in-flight off-thread worker job (0 = none).
  // While set, the blocks-change effect must route to a full doRebuild
  // (which bumps rebuildVersionRef → cleanly supersedes the stale job)
  // instead of doIncrementalUpdate, which does NOT bump the version and
  // would desync posMap vs the matrices the worker is about to apply.
  // Stays 0 forever when WORKER_MESH is OFF → zero behavior change.
  const workerPendingVersionRef = useRef(0);

  // Queued rebuild: when a budgeted rebuild is in progress and new blocks arrive,
  // we DON'T cancel the current rebuild (which causes flickering from stale data
  // at wrong positions). Instead we queue a re-rebuild that starts after the
  // current one finishes. This keeps the visual state consistent throughout.
  const rebuildQueuedRef = useRef(false);

  // Web Worker mesh pool: kept for future use once data transfer is optimized
  // (structured clone of block objects was the bottleneck, needs TypedArray encoding)

  // B9: Batch size for budgeted rebuild (process this many blocks per RAF tick)
  // Each batch of 5000 blocks takes ~3-4ms. Only used for 5000+ block chunks (fungal trees).
  // The rebuild runs in its own RAF loop, separate from the collider removal queue.
  const REBUILD_BATCH_SIZE = 5000;

  // B9: The actual rebuild function - now uses budgeted work for large block counts
  const doRebuild = useCallback(() => {
    const mesh = meshRef.current;
    const currentBlocks = blocksRef.current;
    if (!mesh || currentBlocks.length === 0) return;

    // If a budgeted rebuild is already in progress, queue this one instead of
    // canceling. Canceling causes flickering because the mesh shows stale
    // position/UV data at wrong indices while the new rebuild processes.
    if (rebuildRafRef.current !== null && rebuildStateRef.current) {
      rebuildQueuedRef.current = true;
      return;
    }

    lastRebuildTimeRef.current = performance.now();
    pendingRebuildRef.current = false;

    // Chunks under 2000 blocks: still a full sync rebuild, but routed through
    // the cross-chunk frame-budgeted scheduler so a burst of new chunks on
    // region entry spreads over a few frames instead of one stacked stall.
    // Re-reads refs at run time so it always rebuilds the latest data.
    if (currentBlocks.length < 2000) {
      scheduleSyncRebuild(meshRef, () => {
        const m = meshRef.current;
        const b = blocksRef.current;
        if (m && b.length > 0) doRebuildSync(m, b);
      });
      return;
    }

    // Existing budgeted RAF rebuild, verbatim, extracted so it can be both
    // the default path AND the off-thread fallback. With WORKER_MESH off
    // this is the ONLY path that runs — identical behavior to before.
    const startBudgeted = () => {
      // B9: For large block counts, use budgeted work to spread across frames
      const version = ++rebuildVersionRef.current;

      // Initialize rebuild state
      const requiredUvSize = meshCapacity * 2;
      const requiredColorSize = meshCapacity * 3;

      // Save previous mesh.count so we don't render uninitialized indices during rebuild
      const prevCount = mesh.count;

      rebuildStateRef.current = {
        blocks: currentBlocks,
        idx: 0,
        version,
        prevCount,
        uvOffsetData: uvBufferRef.current?.length >= requiredUvSize
          ? uvBufferRef.current
          : new Float32Array(requiredUvSize),
        colorData: colorBufferRef.current?.length >= requiredColorSize
          ? colorBufferRef.current
          : new Float32Array(requiredColorSize),
        animatedBlocks: [],
        shrineBlocks: [],
        hasBranchDepth: false,
        minX: Infinity, minY: Infinity, minZ: Infinity,
        maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity,
        startTime: performance.now()
      };

      // Update buffer refs
      uvBufferRef.current = rebuildStateRef.current.uvOffsetData;
      colorBufferRef.current = rebuildStateRef.current.colorData;

      // CRITICAL: Use dedicated RAF loop instead of enqueueJob.
      // The budgeted work queue is FIFO and shared with collider removal jobs.
      // Using a separate RAF loop guarantees the rebuild runs independently.
      //
      // Time-limited: process multiple batches per frame within 6ms budget.
      const REBUILD_BUDGET_MS = 6;
      const runBatch = () => {
        const frameStart = performance.now();
        while (performance.now() - frameStart < REBUILD_BUDGET_MS) {
          const done = processBudgetedRebuild(mesh);
          if (done) {
            rebuildRafRef.current = null;
            // If a rebuild was queued while this one ran, start it now.
            // Track the RAF so any new requests during the gap still queue properly.
            if (rebuildQueuedRef.current) {
              rebuildQueuedRef.current = false;
              rebuildRafRef.current = requestAnimationFrame(() => {
                rebuildRafRef.current = null;
                rebuildStateRef.current = null;
                doRebuild();
              });
            }
            return;
          }
        }
        rebuildRafRef.current = requestAnimationFrame(runBatch);
      };
      rebuildRafRef.current = requestAnimationFrame(runBatch);
    };

    const workerOn =
      WORKER_MESH_ENABLED ||
      (typeof window !== 'undefined' &&
        (window as { __WORKER_MESH?: boolean }).__WORKER_MESH === true);

    if (workerOn) {
      if (!meshWorkerPool.isInitialized) {
        try { meshWorkerPool.init(); } catch { /* fall through to sync */ }
      }
      if (meshWorkerPool.isInitialized) {
        const myVersion = ++rebuildVersionRef.current;
        workerPendingVersionRef.current = myVersion;
        const packed = packChunkBlocks(currentBlocks);
        let settled = false;
        // Clear the pending token iff WE are still the awaited job. A newer
        // doRebuild overwrites it with its own version, so a superseded
        // job won't reopen the incremental gate out from under the new one.
        const clearPending = () => {
          if (workerPendingVersionRef.current === myVersion) {
            workerPendingVersionRef.current = 0;
          }
        };
        // Main-side timeout: the pool drops stale jobs without rejecting,
        // so guarantee a sync fallback if the worker never responds.
        const to = setTimeout(() => {
          if (settled) return;
          settled = true;
          clearPending();
          diagnostics.recordWorkerFallback();
          const w = window as { __workerMeshFallbacks?: number };
          w.__workerMeshFallbacks = (w.__workerMeshFallbacks ?? 0) + 1;
          if (rebuildVersionRef.current === myVersion && meshRef.current) startBudgeted();
        }, 8000);
        meshWorkerPool
          .buildMesh('atlas', packed, 0)
          .then((res) => {
            if (settled) return;
            settled = true;
            clearTimeout(to);
            clearPending();
            if (rebuildVersionRef.current !== myVersion) return; // superseded
            const applyT0 = performance.now();
            const m = meshRef.current;
            if (!m) return; // unmounted
            const n = res.blockCount;
            if (n > meshCapacity) { startBudgeted(); return; } // sync handles growth

            // Apply atomically — mirrors processBudgetedRebuild's finalize.
            (m.instanceMatrix.array as Float32Array).set(res.matrices.subarray(0, n * 16));
            m.instanceMatrix.needsUpdate = true;

            if (uvOffsetAttrRef.current && uvOffsetAttrRef.current.count >= meshCapacity) {
              (uvOffsetAttrRef.current.array as Float32Array).set(res.uvOffsets.subarray(0, n * 2));
              uvOffsetAttrRef.current.needsUpdate = true;
            } else {
              const a = new THREE.InstancedBufferAttribute(res.uvOffsets.slice(0, n * 2), 2);
              a.needsUpdate = true;
              m.geometry.setAttribute('instanceUvOffset', a);
              uvOffsetAttrRef.current = a;
            }

            if (res.hasBranchDepth) {
              if (colorAttrRef.current && colorAttrRef.current.count >= meshCapacity) {
                (colorAttrRef.current.array as Float32Array).set(res.colors.subarray(0, n * 3));
                colorAttrRef.current.needsUpdate = true;
              } else {
                const c = new THREE.InstancedBufferAttribute(res.colors.slice(0, n * 3), 3);
                c.needsUpdate = true;
                m.geometry.setAttribute('instanceColor', c);
                colorAttrRef.current = c;
              }
            }

            m.boundingBox ??= new THREE.Box3();
            m.boundingBox.min.set(res.boundsMin[0], res.boundsMin[1], res.boundsMin[2]);
            m.boundingBox.max.set(res.boundsMax[0], res.boundsMax[1], res.boundsMax[2]);
            m.boundingSphere ??= new THREE.Sphere();
            m.boundingBox.getBoundingSphere(m.boundingSphere);
            m.geometry.boundingBox = m.boundingBox.clone();
            m.geometry.boundingSphere = m.boundingSphere.clone();

            m.count = n; // LAST — GPU now has complete matrix + UV + color

            const posMap = positionIndexMapRef.current;
            posMap.clear();
            freeIndicesRef.current.length = 0;
            // MUST be the SAME array the worker meshed (packChunkBlocks’
            // currentBlocks snapshot), not blocksRef.current — otherwise
            // posMap maps newer blocks onto stale matrix indices. Mirrors
            // doRebuildSync, which builds posMap from its own snapshot.
            const cb = currentBlocks;
            for (let i = 0; i < n && i < cb.length; i++) {
              const b = cb[i];
              posMap.set(numPosKey(b.position_x, b.position_y, b.position_z), {
                index: i, blockType: b.block_type, branchDepth: b.branch_depth,
                x: b.position_x, y: b.position_y, z: b.position_z,
              });
            }
            highWaterMarkRef.current = n;
            animatedBlocksRef.current = res.animatedBlocks;
            shrineBlocksRef.current = res.shrineBlocks;
            lastShrineGlowState.current = false;
            initialBuildDoneRef.current = true;
            m.frustumCulled = true;
            // Real main-thread apply cost (matrix copy + attr update +
            // posMap rebuild + bounds recompute). Earlier we recorded
            // 0ms here, which hid the regression that motivated rolling
            // the flag back. Now separated from sync MeshRebuilds.
            diagnostics.recordWorkerApply(performance.now() - applyT0, n);
            const w = window as { __workerMeshApplies?: number };
            w.__workerMeshApplies = (w.__workerMeshApplies ?? 0) + 1;
          })
          .catch(() => {
            if (settled) return;
            settled = true;
            clearTimeout(to);
            clearPending();
            diagnostics.recordWorkerFallback();
            const w = window as { __workerMeshFallbacks?: number };
            w.__workerMeshFallbacks = (w.__workerMeshFallbacks ?? 0) + 1;
            startBudgeted();
          });
        return;
      }
    }

    startBudgeted();
  }, [meshCapacity]);

  // B9: Process a batch of blocks in the budgeted rebuild
  const processBudgetedRebuild = useCallback((mesh: THREE.InstancedMesh): boolean => {
    const state = rebuildStateRef.current;
    if (!state) return true; // No state, job complete

    // Check if a newer rebuild was started (abandon this one)
    if (state.version !== rebuildVersionRef.current) {
      return true; // Newer version started, abandon this job
    }

    const matrix = matrixRef.current;
    const { blocks, uvOffsetData, colorData, animatedBlocks } = state;
    const batchStart = state.idx;
    const end = Math.min(batchStart + REBUILD_BATCH_SIZE, blocks.length);

    for (let i = batchStart; i < end; i++) {
      const block = blocks[i];
      const x = block.position_x;
      const y = block.position_y;
      const z = block.position_z;

      matrix.setPosition(x + 0.5, y + 0.5, z + 0.5);
      mesh.setMatrixAt(i, matrix);

      // Use cached lookups — only ~30 unique block types vs 44K blocks
      const animInfo = getCachedAnimInfo(block.block_type);
      if (animInfo && animInfo.frameCount > 1) {
        animatedBlocks.push({
          blockIndex: i,
          frameCount: animInfo.frameCount,
          frameDelayMs: animInfo.frameDelayMs,
          baseSlotIndex: animInfo.baseSlotIndex,
        });
        const uvs = getAnimatedUVOffset(animInfo.baseSlotIndex, 0);
        uvOffsetData[i * 2] = uvs.uvOffsetX;
        uvOffsetData[i * 2 + 1] = uvs.uvOffsetY;
      } else {
        const uvs = getCachedUVs(block.block_type);
        uvOffsetData[i * 2] = uvs.uvOffsetX;
        uvOffsetData[i * 2 + 1] = uvs.uvOffsetY;
      }

      // Glow bark blocks get bright green-tinted color for visual glow effect
      const isGlowBark = block.block_type.charCodeAt(0) === 103 && block.block_type.charCodeAt(1) === 98; // 'gb'
      // Shrine blocks - track for dynamic proximity glow ('shr')
      const isShrine = block.block_type.charCodeAt(0) === 115 && // 's'
                       block.block_type.charCodeAt(1) === 104 && // 'h'
                       block.block_type.charCodeAt(2) === 114;   // 'r'
      if (isShrine) {
        // Track shrine block for dynamic glow updates
        state.shrineBlocks.push({ index: i, x, y, z });
      }
      if (isGlowBark) {
        state.hasBranchDepth = true;
        colorData[i * 3] = 1.4;     // slight warm tint
        colorData[i * 3 + 1] = 2.0; // strong green boost
        colorData[i * 3 + 2] = 1.5; // slight cyan tint
      } else {
        // Shrine blocks start with default color (glow applied dynamically via frame loop)
        const depth = block.branch_depth;
        if (depth !== undefined && depth !== null) {
          state.hasBranchDepth = true;
          const lightenFactor = 1.0 + Math.max(0, depth + 1) * 0.12;
          colorData[i * 3] = lightenFactor;
          colorData[i * 3 + 1] = lightenFactor;
          colorData[i * 3 + 2] = lightenFactor;
        } else {
          colorData[i * 3] = 1.0;
          colorData[i * 3 + 1] = 1.0;
          colorData[i * 3 + 2] = 1.0;
        }
      }

      if (x < state.minX) state.minX = x;
      if (y < state.minY) state.minY = y;
      if (z < state.minZ) state.minZ = z;
      if (x + 1 > state.maxX) state.maxX = x + 1;
      if (y + 1 > state.maxY) state.maxY = y + 1;
      if (z + 1 > state.maxZ) state.maxZ = z + 1;
    }

    state.idx = end;

    // ATOMIC REBUILD: Do NOT upload partial data to GPU during batches.
    // Writing to JS buffers (setMatrixAt, staging arrays) is fine — those
    // stay in CPU memory. Only set needsUpdate at finalization so the GPU
    // sees ONE complete state change, preventing wrong-texture artifacts
    // from stale UV data at unprocessed indices.
    //
    // mesh.count stays at prevCount during rebuild — GPU renders the OLD
    // complete state until the new one is fully written.

    // Check if complete
    if (state.idx >= blocks.length) {
      // Finalize: atomically upload ALL buffers to GPU in one frame.
      // During the batch loop above, we only wrote to CPU-side staging arrays
      // (setMatrixAt writes to instanceMatrix.array, uvOffsetData/colorData are
      // plain Float32Arrays). Now copy them into the GPU attribute arrays and
      // set needsUpdate so Three.js uploads everything in a single
      // gl.bufferSubData per attribute — the GPU never sees partial state.
      animatedBlocksRef.current = animatedBlocks;
      shrineBlocksRef.current = state.shrineBlocks;
      lastShrineGlowState.current = false; // Reset glow state for fresh proximity check

      // 1. Matrix buffer — setMatrixAt already wrote to instanceMatrix.array
      mesh.instanceMatrix.needsUpdate = true;

      // 2. UV offset attribute — copy staging buffer into attribute array
      if (uvOffsetAttrRef.current && uvOffsetAttrRef.current.count >= meshCapacity) {
        const arr = uvOffsetAttrRef.current.array as Float32Array;
        arr.set(state.uvOffsetData.subarray(0, blocks.length * 2));
        uvOffsetAttrRef.current.needsUpdate = true;
      } else {
        const uvOffsetAttr = new THREE.InstancedBufferAttribute(state.uvOffsetData, 2);
        uvOffsetAttr.needsUpdate = true;
        mesh.geometry.setAttribute('instanceUvOffset', uvOffsetAttr);
        uvOffsetAttrRef.current = uvOffsetAttr;
      }

      // 3. Color attribute (branch depth lightening)
      if (state.hasBranchDepth) {
        if (colorAttrRef.current && colorAttrRef.current.count >= meshCapacity) {
          const arr = colorAttrRef.current.array as Float32Array;
          arr.set(state.colorData.subarray(0, blocks.length * 3));
          colorAttrRef.current.needsUpdate = true;
        } else {
          const colorAttr = new THREE.InstancedBufferAttribute(state.colorData, 3);
          colorAttr.needsUpdate = true;
          mesh.geometry.setAttribute('instanceColor', colorAttr);
          colorAttrRef.current = colorAttr;
        }
      }

      // Bounding box
      if (blocks.length > 0) {
        mesh.boundingBox ??= new THREE.Box3();
        mesh.boundingBox.min.set(state.minX, state.minY, state.minZ);
        mesh.boundingBox.max.set(state.maxX, state.maxY, state.maxZ);
        mesh.boundingSphere ??= new THREE.Sphere();
        mesh.boundingBox.getBoundingSphere(mesh.boundingSphere);
        mesh.geometry.boundingBox = mesh.boundingBox.clone();
        mesh.geometry.boundingSphere = mesh.boundingSphere.clone();
      }

      // 4. Set count LAST — GPU now has complete matrix + UV + color data
      mesh.count = blocks.length;

      // Populate stable index map (used by falling blocks lookup)
      const posMap = positionIndexMapRef.current;
      posMap.clear();
      freeIndicesRef.current.length = 0;
      for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i];
        posMap.set(numPosKey(b.position_x, b.position_y, b.position_z), {
          index: i, blockType: b.block_type, branchDepth: b.branch_depth,
          x: b.position_x, y: b.position_y, z: b.position_z,
        });
      }
      highWaterMarkRef.current = blocks.length;
      initialBuildDoneRef.current = true;
      // Per-chunk bounds are valid now — safe to frustum-cull this mesh so
      // off-screen tree chunks stop costing a draw call. (Culling is off
      // pre-build because the default unit-cube bounds mis-cull tall trees.)
      mesh.frustumCulled = true;

      // D-Flow: Record rebuild time
      diagnostics.recordMeshRebuild(performance.now() - state.startTime, blocks.length);

      rebuildStateRef.current = null;
      return true; // Job complete
    }

    return false; // More work to do
  }, [meshCapacity]);

  // B9: Synchronous rebuild for small block counts (no budgeting overhead)
  const doRebuildSync = useCallback((mesh: THREE.InstancedMesh, currentBlocks: PlacedBlock[]) => {
    const rebuildT0 = performance.now();
    const matrix = matrixRef.current;

    // Reuse or grow UV buffer
    const requiredSize = meshCapacity * 2;
    if (!uvBufferRef.current || uvBufferRef.current.length < requiredSize) {
      uvBufferRef.current = new Float32Array(requiredSize);
    }
    const uvOffsetData = uvBufferRef.current;

    // Track animated blocks and shrine blocks
    const animatedBlocks: AnimatedBlockInfo[] = [];
    const shrineBlocks: Array<{ index: number; x: number; y: number; z: number }> = [];

    // Reuse or grow color buffer
    const colorRequiredSize = meshCapacity * 3;
    if (!colorBufferRef.current || colorBufferRef.current.length < colorRequiredSize) {
      colorBufferRef.current = new Float32Array(colorRequiredSize);
    }
    const colorData = colorBufferRef.current;
    let hasBranchDepth = false;

    // Compute bounding box
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    for (let i = 0; i < currentBlocks.length; i++) {
      const block = currentBlocks[i];
      const x = block.position_x;
      const y = block.position_y;
      const z = block.position_z;

      matrix.setPosition(x + 0.5, y + 0.5, z + 0.5);
      mesh.setMatrixAt(i, matrix);

      const animInfo = getTreeBlockAnimationInfo(block.block_type);
      if (animInfo && animInfo.frameCount > 1) {
        animatedBlocks.push({
          blockIndex: i,
          frameCount: animInfo.frameCount,
          frameDelayMs: animInfo.frameDelayMs,
          baseSlotIndex: animInfo.baseSlotIndex,
        });
        const uvs = getAnimatedUVOffset(animInfo.baseSlotIndex, 0);
        uvOffsetData[i * 2] = uvs.uvOffsetX;
        uvOffsetData[i * 2 + 1] = uvs.uvOffsetY;
      } else {
        const uvs = getInstanceUVsForTreeBlock(block.block_type);
        uvOffsetData[i * 2] = uvs.uvOffsetX;
        uvOffsetData[i * 2 + 1] = uvs.uvOffsetY;
      }

      // Detect glow bark blocks (fast char check: 'gb')
      const isGlowBark = block.block_type.charCodeAt(0) === 103 && block.block_type.charCodeAt(1) === 98;
      // Detect shrine blocks (fast char check: 'shr')
      const isShrine = block.block_type.charCodeAt(0) === 115 &&
                       block.block_type.charCodeAt(1) === 104 &&
                       block.block_type.charCodeAt(2) === 114;

      if (isShrine) {
        shrineBlocks.push({ index: i, x, y, z });
      }

      if (isGlowBark) {
        hasBranchDepth = true;
        colorData[i * 3] = 1.4;
        colorData[i * 3 + 1] = 2.0;
        colorData[i * 3 + 2] = 1.5;
      } else {
        const depth = block.branch_depth;
        if (depth !== undefined && depth !== null) {
          hasBranchDepth = true;
          const lightenFactor = 1.0 + Math.max(0, depth + 1) * 0.12;
          colorData[i * 3] = lightenFactor;
          colorData[i * 3 + 1] = lightenFactor;
          colorData[i * 3 + 2] = lightenFactor;
        } else {
          colorData[i * 3] = 1.0;
          colorData[i * 3 + 1] = 1.0;
          colorData[i * 3 + 2] = 1.0;
        }
      }

      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x + 1 > maxX) maxX = x + 1;
      if (y + 1 > maxY) maxY = y + 1;
      if (z + 1 > maxZ) maxZ = z + 1;
    }

    animatedBlocksRef.current = animatedBlocks;
    shrineBlocksRef.current = shrineBlocks;
    lastShrineGlowState.current = false; // Reset glow state for fresh proximity check
    mesh.instanceMatrix.needsUpdate = true;

    // Update colors
    if (hasBranchDepth) {
      if (colorAttrRef.current && colorAttrRef.current.count >= meshCapacity) {
        const arr = colorAttrRef.current.array as Float32Array;
        arr.set(colorData.subarray(0, currentBlocks.length * 3));
        colorAttrRef.current.needsUpdate = true;
      } else {
        const colorAttr = new THREE.InstancedBufferAttribute(colorData, 3);
        colorAttr.needsUpdate = true;
        mesh.geometry.setAttribute('instanceColor', colorAttr);
        colorAttrRef.current = colorAttr;
      }
    }

    // Update UVs
    if (uvOffsetAttrRef.current && uvOffsetAttrRef.current.count >= meshCapacity) {
      const arr = uvOffsetAttrRef.current.array as Float32Array;
      arr.set(uvOffsetData.subarray(0, currentBlocks.length * 2));
      uvOffsetAttrRef.current.needsUpdate = true;
    } else {
      const uvOffsetAttr = new THREE.InstancedBufferAttribute(uvOffsetData, 2);
      uvOffsetAttr.needsUpdate = true;
      mesh.geometry.setAttribute('instanceUvOffset', uvOffsetAttr);
      uvOffsetAttrRef.current = uvOffsetAttr;
    }

    // Set count AFTER attributes are ready to prevent WebGL buffer errors
    mesh.count = currentBlocks.length;

    // Bounding box
    if (currentBlocks.length > 0) {
      mesh.boundingBox ??= new THREE.Box3();
      mesh.boundingBox.min.set(minX, minY, minZ);
      mesh.boundingBox.max.set(maxX, maxY, maxZ);
      mesh.boundingSphere ??= new THREE.Sphere();
      mesh.boundingBox.getBoundingSphere(mesh.boundingSphere);
      mesh.geometry.boundingBox = mesh.boundingBox.clone();
      mesh.geometry.boundingSphere = mesh.boundingSphere.clone();
    }

    // Populate stable index map for subsequent incremental updates
    const posMap = positionIndexMapRef.current;
    posMap.clear();
    freeIndicesRef.current.length = 0;
    for (let i = 0; i < currentBlocks.length; i++) {
      const b = currentBlocks[i];
      posMap.set(numPosKey(b.position_x, b.position_y, b.position_z), {
        index: i, blockType: b.block_type, branchDepth: b.branch_depth,
        x: b.position_x, y: b.position_y, z: b.position_z,
      });
    }
    highWaterMarkRef.current = currentBlocks.length;
    initialBuildDoneRef.current = true;
    // Per-chunk bounds are valid now — safe to frustum-cull (see budgeted path).
    mesh.frustumCulled = true;

    // D-Flow: Record rebuild time
    diagnostics.recordMeshRebuild(performance.now() - rebuildT0, currentBlocks.length);
  }, [meshCapacity]);

  // Delta-based incremental update: only processes added/removed/modified blocks
  // Uses numeric position keys (zero string allocation) and two-pass approach
  const doIncrementalUpdate = useCallback(() => {
    const mesh = meshRef.current;
    const currentBlocks = blocksRef.current;
    if (!mesh) return;

    // Handle empty blocks: clear the mesh and reset tracking
    if (!currentBlocks || currentBlocks.length === 0) {
      mesh.count = 0;
      positionIndexMapRef.current.clear();
      freeIndicesRef.current.length = 0;
      highWaterMarkRef.current = 0;
      animatedBlocksRef.current = [];
      return;
    }

    const t0 = performance.now();
    const matrix = matrixRef.current;
    const posMap = positionIndexMapRef.current;
    const freeIndices = freeIndicesRef.current;

    // CRITICAL: Write directly to GPU attribute arrays, not staging buffers.
    // After the budgeted rebuild, the attribute array and uvBufferRef are DIFFERENT
    // Float32Arrays (the rebuild copies data from staging buffer into the attribute).
    // Writing to the staging buffer and setting needsUpdate would upload stale data.
    const uvAttrArray = uvOffsetAttrRef.current?.array as Float32Array | undefined;
    const colorAttrArray = colorAttrRef.current?.array as Float32Array | undefined;

    if (!uvAttrArray) {
      // No attribute yet (shouldn't happen after initial build) — fall back to full rebuild
      initialBuildDoneRef.current = false;
      doRebuild();
      return;
    }

    const uvData = uvAttrArray;
    const colorData = colorAttrArray ?? colorBufferRef.current ?? new Float32Array(meshCapacity * 3);

    lastIncrementalTimeRef.current = performance.now();
    pendingIncrementalRef.current = false;

    let changedCount = 0;
    let hasBranchDepth = false;
    const animatedBlocks: AnimatedBlockInfo[] = [];

    // Pass 1: Iterate new blocks — find additions/modifications, build seen-keys set
    // Uses numeric keys (zero string allocation) for O(1) Map lookups
    // PERF: Reuse Set to avoid allocating 150K-entry Set per call (was causing
    // +300MB heap growth and 700ms GC pauses from boxing large numbers)
    seenKeysRef.current.clear();
    const seenKeys = seenKeysRef.current;

    for (let i = 0; i < currentBlocks.length; i++) {
      const block = currentBlocks[i];
      const key = numPosKey(block.position_x, block.position_y, block.position_z);
      seenKeys.add(key);

      const existing = posMap.get(key);

      if (existing) {
        // Block exists at same position
        if (existing.blockType !== block.block_type || existing.branchDepth !== block.branch_depth) {
          // Properties changed - update UV and/or color at same index
          const idx = existing.index;
          existing.blockType = block.block_type;
          existing.branchDepth = block.branch_depth;

          const animInfo = getTreeBlockAnimationInfo(block.block_type);
          if (animInfo && animInfo.frameCount > 1) {
            animatedBlocks.push({ blockIndex: idx, frameCount: animInfo.frameCount, frameDelayMs: animInfo.frameDelayMs, baseSlotIndex: animInfo.baseSlotIndex });
            const uvs = getAnimatedUVOffset(animInfo.baseSlotIndex, 0);
            uvData[idx * 2] = uvs.uvOffsetX;
            uvData[idx * 2 + 1] = uvs.uvOffsetY;
          } else {
            const uvs = getInstanceUVsForTreeBlock(block.block_type);
            uvData[idx * 2] = uvs.uvOffsetX;
            uvData[idx * 2 + 1] = uvs.uvOffsetY;
          }

          const isGlowBlock = block.block_type.charCodeAt(0) === 103 && block.block_type.charCodeAt(1) === 98;
          if (isGlowBlock) {
            hasBranchDepth = true;
            colorData[idx * 3] = 1.4;
            colorData[idx * 3 + 1] = 2.0;
            colorData[idx * 3 + 2] = 1.5;
          } else {
            // Shrine blocks start with default color - glow is applied dynamically via frame loop
            const depth = block.branch_depth;
            if (depth !== undefined && depth !== null) {
              hasBranchDepth = true;
              const f = 1.0 + Math.max(0, depth + 1) * 0.12;
              colorData[idx * 3] = f;
              colorData[idx * 3 + 1] = f;
              colorData[idx * 3 + 2] = f;
            } else {
              colorData[idx * 3] = 1.0;
              colorData[idx * 3 + 1] = 1.0;
              colorData[idx * 3 + 2] = 1.0;
            }
          }
          changedCount++;
        } else {
          // Unchanged - just collect animation info
          const animInfo = getTreeBlockAnimationInfo(block.block_type);
          if (animInfo && animInfo.frameCount > 1) {
            animatedBlocks.push({ blockIndex: existing.index, frameCount: animInfo.frameCount, frameDelayMs: animInfo.frameDelayMs, baseSlotIndex: animInfo.baseSlotIndex });
          }
          if (block.branch_depth !== undefined && block.branch_depth !== null) {
            hasBranchDepth = true;
          }
        }
      } else {
        // New block - assign instance index from free list or extend high water mark
        let idx: number;
        if (freeIndices.length > 0) {
          idx = freeIndices.pop()!;
        } else {
          // Safety: if high water mark would exceed mesh capacity, fall back to full rebuild
          if (highWaterMarkRef.current >= meshCapacity) {
            initialBuildDoneRef.current = false;
            doRebuild();
            return;
          }
          idx = highWaterMarkRef.current++;
        }
        posMap.set(key, {
          index: idx, blockType: block.block_type, branchDepth: block.branch_depth,
          x: block.position_x, y: block.position_y, z: block.position_z,
        });

        // Set matrix
        matrix.setPosition(block.position_x + 0.5, block.position_y + 0.5, block.position_z + 0.5);
        mesh.setMatrixAt(idx, matrix);

        // Set UV
        const animInfo = getTreeBlockAnimationInfo(block.block_type);
        if (animInfo && animInfo.frameCount > 1) {
          animatedBlocks.push({ blockIndex: idx, frameCount: animInfo.frameCount, frameDelayMs: animInfo.frameDelayMs, baseSlotIndex: animInfo.baseSlotIndex });
          const uvs = getAnimatedUVOffset(animInfo.baseSlotIndex, 0);
          uvData[idx * 2] = uvs.uvOffsetX;
          uvData[idx * 2 + 1] = uvs.uvOffsetY;
        } else {
          const uvs = getInstanceUVsForTreeBlock(block.block_type);
          uvData[idx * 2] = uvs.uvOffsetX;
          uvData[idx * 2 + 1] = uvs.uvOffsetY;
        }

        // Set color — glow bark gets bright green tint
        // Shrine blocks start with default color - glow is applied dynamically via frame loop
        const isGlowNew = block.block_type.charCodeAt(0) === 103 && block.block_type.charCodeAt(1) === 98;
        if (isGlowNew) {
          hasBranchDepth = true;
          colorData[idx * 3] = 1.4;
          colorData[idx * 3 + 1] = 2.0;
          colorData[idx * 3 + 2] = 1.5;
        } else {
          const depth = block.branch_depth;
          if (depth !== undefined && depth !== null) {
            hasBranchDepth = true;
            const f = 1.0 + Math.max(0, depth + 1) * 0.12;
            colorData[idx * 3] = f;
            colorData[idx * 3 + 1] = f;
            colorData[idx * 3 + 2] = f;
          } else {
            colorData[idx * 3] = 1.0;
            colorData[idx * 3 + 1] = 1.0;
            colorData[idx * 3 + 2] = 1.0;
          }
        }
        changedCount++;
      }
    }

    // Pass 2: Find deleted blocks (in posMap but not in seenKeys)
    // OPTIMIZATION: Skip this O(N) scan if no deletions are possible.
    // If seenKeys has as many entries as posMap, every posMap entry was seen → no deletions.
    if (seenKeys.size < posMap.size) {
      const toRemove: number[] = [];
      for (const [key, entry] of posMap) {
        if (!seenKeys.has(key)) {
          toRemove.push(key);
          freeIndices.push(entry.index);
          // Hide instance by scaling to zero
          matrix.makeScale(0, 0, 0);
          mesh.setMatrixAt(entry.index, matrix);
          uvData[entry.index * 2] = 0;
          uvData[entry.index * 2 + 1] = 0;
          changedCount++;
        }
      }
      for (let i = 0; i < toRemove.length; i++) {
        posMap.delete(toRemove[i]);
      }
    }

    animatedBlocksRef.current = animatedBlocks;

    if (changedCount > 0) {
      mesh.instanceMatrix.needsUpdate = true;

      // Update UV attribute (full buffer upload - THREE.js limitation)
      if (uvOffsetAttrRef.current && uvOffsetAttrRef.current.count >= meshCapacity) {
        uvOffsetAttrRef.current.needsUpdate = true;
      } else {
        const attr = new THREE.InstancedBufferAttribute(uvData, 2);
        attr.needsUpdate = true;
        mesh.geometry.setAttribute('instanceUvOffset', attr);
        uvOffsetAttrRef.current = attr;
      }

      // Update color attribute if needed
      if (hasBranchDepth) {
        if (colorAttrRef.current && colorAttrRef.current.count >= meshCapacity) {
          colorAttrRef.current.needsUpdate = true;
        } else {
          const attr = new THREE.InstancedBufferAttribute(colorData, 3);
          attr.needsUpdate = true;
          mesh.geometry.setAttribute('instanceColor', attr);
          colorAttrRef.current = attr;
        }
      }
    }

    mesh.count = highWaterMarkRef.current;

    // D-Flow: Record rebuild with changed count (not total) to show delta efficiency
    // Incremental delta update — separated from full MeshRebuilds so DF
    // reports show the full-vs-delta ratio honestly.
    diagnostics.recordIncremental(performance.now() - t0, changedCount);
  }, [meshCapacity, doRebuild]);

  // Update instance matrices and UV offsets when blocks change
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    // Detect mesh recreation (meshCapacity growth) - reset for full rebuild
    if (mesh !== lastMeshObjRef.current) {
      lastMeshObjRef.current = mesh;
      // Instance matrix is re-uploaded on every rebuild; tell the driver it
      // changes often (default STATIC_DRAW causes per-upload reallocation
      // stalls — the bufferSubData spikes that show as long frames).
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      initialBuildDoneRef.current = false;
      positionIndexMapRef.current.clear();
      freeIndicesRef.current.length = 0;
      highWaterMarkRef.current = 0;
      // Re-register the new mesh for raycasting
      if (onMeshReady) {
        onMeshReady(mesh);
      }
    }

    // Track atlas version — clear UV cache if atlas changed (slots may have moved)
    // This forces a rebuild by resetting the signature
    if (atlasVersion !== lastAtlasVersionRef.current) {
      console.log(`[AtlasUV] Atlas version changed ${lastAtlasVersionRef.current} → ${atlasVersion}, clearing ${uvLookupCache.size} cached UVs`);
      uvLookupCache.clear();
      animInfoCache.clear();
      _uvDiagLogged.clear();
      lastAtlasVersionRef.current = atlasVersion;
      lastProcessedSignatureRef.current = ''; // Force rebuild with new UVs
    }

    // B11: Order-independent signature using XOR of ALL block position hashes.
    // XOR is commutative, so reordering blocks produces the same hash.
    // Uses Math.imul for guaranteed 32-bit integer multiplication (no JS float overflow).
    let sig: string;
    if (blocks.length === 0) {
      sig = 'empty';
    } else {
      let posXor = 0;
      let posSum = 0;
      const n = blocks.length;
      for (let i = 0; i < n; i++) {
        const b = blocks[i];
        // Use Math.imul for deterministic 32-bit multiplication
        const hx = Math.imul(b.position_x | 0, 73856093);
        const hy = Math.imul(b.position_y | 0, 19349663);
        const hz = Math.imul(b.position_z | 0, 83492791);
        const h = (hx ^ hy ^ hz) | 0;
        posXor = (posXor ^ h) | 0;
        posSum = (posSum + (h >>> 0)) >>> 0;
      }
      sig = `${n}:${(posXor >>> 0)}:${posSum}`;
    }

    if (sig === lastProcessedSignatureRef.current) {
      return;
    }
    lastProcessedSignatureRef.current = sig;

    // Use incremental updates when possible — avoids full O(N) rebuild on every
    // chunk load/unload. Only fall back to full rebuild when the mesh hasn't been
    // built yet or a budgeted rebuild is already in progress (to avoid data races
    // between incremental writes to GPU attributes and budgeted staging buffers).
    const canIncremental = initialBuildDoneRef.current
      && rebuildRafRef.current === null
      && rebuildStateRef.current === null
      && workerPendingVersionRef.current === 0; // #2: don't incremental over a pending off-thread apply

    if (canIncremental) {
      // Throttle incremental updates — each one is O(N) for all blocks,
      // so 381 calls × 150K blocks = 57M iterations without throttling
      const now = performance.now();
      const timeSinceLastIncremental = now - lastIncrementalTimeRef.current;

      if (timeSinceLastIncremental >= INCREMENTAL_THROTTLE_MS) {
        doIncrementalUpdate();
      } else if (!pendingIncrementalRef.current) {
        pendingIncrementalRef.current = true;
        const delay = INCREMENTAL_THROTTLE_MS - timeSinceLastIncremental;

        if (incrementalTimeoutRef.current) {
          clearTimeout(incrementalTimeoutRef.current);
        }
        incrementalTimeoutRef.current = setTimeout(() => {
          incrementalTimeoutRef.current = null;
          doIncrementalUpdate();
        }, delay);
      }
    } else {
      const now = performance.now();
      const timeSinceLastRebuild = now - lastRebuildTimeRef.current;

      if (timeSinceLastRebuild >= REBUILD_THROTTLE_MS) {
        doRebuild();
      } else if (!pendingRebuildRef.current) {
        pendingRebuildRef.current = true;
        const delay = REBUILD_THROTTLE_MS - timeSinceLastRebuild;

        if (rebuildTimeoutRef.current) {
          clearTimeout(rebuildTimeoutRef.current);
        }
        rebuildTimeoutRef.current = setTimeout(() => {
          rebuildTimeoutRef.current = null;
          doRebuild();
        }, delay);
      }
    }

    return () => {
      // Only clean up the throttle timeouts on re-render.
      // Do NOT cancel the RAF-based rebuild here — the queuing system in
      // doRebuild handles the case where blocks change mid-rebuild.
      // Canceling here would bypass queuing and cause flickering.
      if (rebuildTimeoutRef.current) {
        clearTimeout(rebuildTimeoutRef.current);
        rebuildTimeoutRef.current = null;
      }
      if (incrementalTimeoutRef.current) {
        clearTimeout(incrementalTimeoutRef.current);
        incrementalTimeoutRef.current = null;
      }
    };
  }, [blocks, atlasVersion, doRebuild, doIncrementalUpdate]);

  // Cleanup RAF on unmount only
  useEffect(() => {
    return () => {
      if (rebuildRafRef.current !== null) {
        cancelAnimationFrame(rebuildRafRef.current);
        rebuildRafRef.current = null;
      }
      // Invalidate any in-flight off-thread mesh result so its async
      // .then is discarded (version mismatch) after unmount.
      rebuildVersionRef.current++;
    };
  }, []);

  // Register frame loop callback for falling block updates
  const componentId = useRef(`atlas-blocks-${Math.random().toString(36).slice(2, 8)}`);
  const previouslyFallingRef = useRef<Set<string>>(new Set());
  const currentlyFallingRef = useRef<Set<string>>(new Set());

  // Pre-compute blockId -> instance index map for O(1) lookups (falling blocks)
  const blockIndexMapRef = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    const map = blockIndexMapRef.current;
    const byId = blockByIdRef.current;
    map.clear();
    byId.clear();
    const posMap = positionIndexMapRef.current;
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const entry = posMap.get(numPosKey(b.position_x, b.position_y, b.position_z));
      if (entry) {
        map.set(b.id, entry.index);
        byId.set(b.id, { instanceIndex: entry.index, block: b });
      }
    }
  }, [blocks]);

  useEffect(() => {
    const id = componentId.current;

    const unregister = frameLoop.register(id, (delta) => {
      const mesh = meshRef.current;
      if (!mesh || blocks.length === 0) return;

      let matrixNeedsUpdate = false;
      let colorNeedsUpdate = false;
      const matrix = matrixRef.current;

      // ========== SHRINE PROXIMITY GLOW (throttled to 100ms) ==========
      const shrineBlocks = shrineBlocksRef.current;
      if (shrineBlocks.length > 0 && colorAttrRef.current) {
        const now = performance.now();
        if (now - lastShrineCheckTime.current >= 100) {
          lastShrineCheckTime.current = now;

          // Get player position
          const player = playerTracker.getPlayerById('local');
          let isNearShrine = false;

          if (player) {
            // Check if player is near any shrine block (within 5 blocks)
            // Uses block-based detection for dynamic glow
            isNearShrine = shrineTracker.hasShrineBLockNearby(
              player.position.x,
              player.position.y,
              player.position.z,
              5 // radius
            );
          }

          // Update colors only if state changed
          if (isNearShrine !== lastShrineGlowState.current) {
            lastShrineGlowState.current = isNearShrine;
            const colorArr = colorAttrRef.current.array as Float32Array;

            for (const shrine of shrineBlocks) {
              const idx = shrine.index;
              if (isNearShrine) {
                // Purple glow
                colorArr[idx * 3] = 1.8;
                colorArr[idx * 3 + 1] = 0.8;
                colorArr[idx * 3 + 2] = 2.0;
              } else {
                // Default color
                colorArr[idx * 3] = 1.0;
                colorArr[idx * 3 + 1] = 1.0;
                colorArr[idx * 3 + 2] = 1.0;
              }
            }
            colorNeedsUpdate = true;
          }
        }
      }

      // ========== FALLING BLOCKS ==========
      const hasFallingBlocks = fallingBlocksState.size > 0;
      const hadFallingBlocks = previouslyFallingRef.current.size > 0;

      if (hasFallingBlocks || hadFallingBlocks) {
        // Handle falling blocks - only iterate falling blocks, not all blocks
        const currentlyFalling = currentlyFallingRef.current;
        currentlyFalling.clear();

        // Iterate only the falling blocks state, not all blocks
        const blockById = blockByIdRef.current;
        fallingBlocksState.forEach((fallingState, blockId) => {
          const entry = blockById.get(blockId);
          if (!entry) return; // Not our block

          currentlyFalling.add(blockId);

          matrix.setPosition(entry.block.position_x + 0.5, fallingState.currentY + 0.5, entry.block.position_z + 0.5);
          mesh.setMatrixAt(entry.instanceIndex, matrix);
          matrixNeedsUpdate = true;
        });

        // Reset blocks that stopped falling
        previouslyFallingRef.current.forEach(blockId => {
          if (!currentlyFalling.has(blockId)) {
            const entry = blockById.get(blockId);
            if (entry) {
              matrix.setPosition(entry.block.position_x + 0.5, entry.block.position_y + 0.5, entry.block.position_z + 0.5);
              mesh.setMatrixAt(entry.instanceIndex, matrix);
              matrixNeedsUpdate = true;
            }
          }
        });

        // Swap sets
        const temp = previouslyFallingRef.current;
        previouslyFallingRef.current = currentlyFalling;
        currentlyFallingRef.current = temp;
      }

      if (matrixNeedsUpdate) {
        mesh.instanceMatrix.needsUpdate = true;
      }
      if (colorNeedsUpdate && colorAttrRef.current) {
        colorAttrRef.current.needsUpdate = true;
      }

      // Animate UV offsets for animated textures
      // TEMPORARILY DISABLED - investigating flashing issue
      // const animatedBlocks = animatedBlocksRef.current;
      // if (animatedBlocks.length > 0 && uvOffsetAttrRef.current) {
      //   const uvAttr = uvOffsetAttrRef.current;
      //   const now = performance.now();
      //   let uvNeedsUpdate = false;

      //   for (const anim of animatedBlocks) {
      //     // Calculate current frame based on time
      //     const frameIndex = Math.floor(now / anim.frameDelayMs) % anim.frameCount;
      //     const uvs = getAnimatedUVOffset(anim.baseSlotIndex, frameIndex);

      //     // Update UV offset in attribute
      //     const offset = anim.blockIndex * 2;
      //     if (uvAttr.array[offset] !== uvs.uvOffsetX || uvAttr.array[offset + 1] !== uvs.uvOffsetY) {
      //       (uvAttr.array as Float32Array)[offset] = uvs.uvOffsetX;
      //       (uvAttr.array as Float32Array)[offset + 1] = uvs.uvOffsetY;
      //       uvNeedsUpdate = true;
      //     }
      //   }

      //   if (uvNeedsUpdate) {
      //     uvAttr.needsUpdate = true;
      //   }
      // }
    }, 60);

    return unregister;
  }, [blocks]);

  if (!material || blocks.length === 0) {
    return null;
  }

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, meshCapacity]}
      frustumCulled={false} // Initial only — flipped to true after the first rebuild sets valid per-chunk bounds (pre-build bounds mis-cull tall trees)
      castShadow
      receiveShadow
    />
  );
};

export default InstancedAtlasBlockGroup;
