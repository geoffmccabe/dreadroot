import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { PlacedBlock } from '@/types/blocks';
import { getChunkKey, CHUNK_SIZE } from '@/lib/chunkManager';
import { blockDB, CachedChunk } from '@/hooks/useIndexedDB';
import { worldCollisionGrid } from '@/lib/spatialHashGrid';
import { initLogStep, initLogStartStep, initLogFinishStep, initLogErrorStep } from '@/contexts/InitializationContext';
import { fnv1a32, canonicalizeTextureUrl } from '@/lib/renderKeys';
import { isTreeBlockType } from '@/features/trees/lib/blockTypeEncoder';
import { enqueueJob, clearPendingJobs } from '@/lib/budgetedWork';
import { diagnostics } from '@/lib/diagnosticsLogger';
import { updateChunkHeightMap, removeChunkHeightMap, clearAllHeightMaps } from '@/lib/chunkHeightMap';
import * as THREE from 'three';

// Configuration for chunk loading
// LOAD_RADIUS is now dynamic — derived from loadRadius prop (defaults to 4)
const DEFAULT_LOAD_RADIUS = 4;
// Hysteresis for chunk unloading — prevents the load<->evict oscillation near
// boundaries. Was 1: only kept minimal because the OLD per-block Box3 collider
// model orphaned colliders in a wide ring (a memory problem). The voxel-field
// collision makes retained colliders ~free, while hysteresis=1 caused a severe
// thrash (474 unloads on a 2-chunk move) — and every unload bumps worldRevision
// which re-meshes ALL rendered chunks (the ~9s MeshRebuild stalls). Widening it
// keeps the near ring stable across small moves; the obsolete orphan concern
// no longer applies.
const UNLOAD_HYSTERESIS = 3;
const POSITION_UPDATE_THROTTLE = 200; // ms between position updates

// Budgeted unload configuration - prevents GC storms at chunk boundaries
const MIN_RESIDENCY_MS = 20000;       // Don't unload chunks loaded <20s ago — kills the load->evict->reload thrash on micro-moves (was 8000)
const COLLIDER_CREATION_BATCH = 200;  // Colliders to create per frame during load
const SYNC_COLLIDER_CAP = 350;        // Max blocks colliderized synchronously on chunk load; bigger chunks (complete trees) go through the budgeted queue — prevents multi-second freezes when trees stream in while moving

// B4: Disable prefetch to isolate stutter sources - re-enable with frame budget later
const PREFETCH_ENABLED = false;

// Phase 3A: Eviction configuration
const EVICTION_BATCH_SIZE = 10;

// Retry configuration for failed chunk loads
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 2000;     // 2s, 4s, 8s exponential backoff
const FAILED_CHUNK_RETRY_INTERVAL = 5000; // Retry failed chunks every 5s
const MAX_TOTAL_BLOCKS = 50000; // Safety limit for paginated fetches

// Phase 3D: Cache configuration
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const CACHE_TRUST_WINDOW_MS = 30000; // 30 seconds - skip version check for very fresh cache

// Phase 3E: Velocity-based prefetch configuration
const PREFETCH_DISTANCE = 2;         // Chunks beyond LOAD_RADIUS to prefetch
const PREFETCH_MIN_SPEED = 2.0;      // Blocks/sec threshold (ignore micro-jitter)
const PREFETCH_BATCH_SIZE = 2;       // Max chunks per idle callback
const PREFETCH_DEBOUNCE_MS = 300;    // Debounce rapid direction changes
const POSITION_HISTORY_SIZE = 5;     // Ring buffer size for velocity calc
const PREFETCH_HEADROOM = 20;        // Don't prefetch if within this many of MAX

// Phase 3E: Types
interface PositionSample {
  x: number;
  z: number;
  t: number;
}

interface PrefetchHandle {
  kind: 'idle' | 'timeout';
  id: number;
}

// B4: Numeric chunk signature for O(1) world signature updates
interface ChunkSignature {
  count: number;
  xor: number;
  sum: number;
}

interface ChunkData {
  blocks: PlacedBlock[];
  // Surface-only blocks for rendering (interior blocks culled via Uint8Array grid)
  // Collision uses `blocks`; rendering uses `visibleBlocks?.length ? visibleBlocks : blocks`
  // IMPORTANT: Must use ?.length check, not ??, because empty array [] is not nullish!
  visibleBlocks?: PlacedBlock[];
  loadedAt: number;
  // Phase 3A: Track for LRU and pinning
  lastAccessedAt: number;
  hasOptimisticBlocks: boolean;
  // B4: Numeric signature for incremental world signature tracking
  signature: ChunkSignature;
}

interface UseChunkLoaderProps {
  worldId: string | null;
  onBlocksChanged: (blocks: PlacedBlock[]) => void;
  // Phase 4: Revision callback for efficient dependency tracking
  onRevisionChanged?: (revision: number) => void;
  emitRadius?: number; // Only flatten/emit chunks within this radius (default: loadRadius)
  loadRadius?: number; // Chunk load radius — matches user's visual distance setting
}

// Static world blocks are now stored in worldCollisionGrid as a VOXEL FIELD
// (integer coords + lazily-materialized stable boxes), NOT per-block Box3 +
// spatial-hash insert. Per-block Box3 (240k+) + hash cells + insert/remove
// churn was the ~1GB heap + multi-second GC freeze once trees came back
// complete. addVoxel/removeVoxel are O(1) Set ops, no Box3, no hash cell
// thrash. The grid clears its own voxels on world switch (clear()), so no
// module-level cache or collisionGridCleared listener is needed here.

/**
 * Mark a block solid for collision (voxel add — O(1), no allocation).
 * Same name/signature as before so all call sites are unchanged.
 */
const ensureBlockCollider = (block: PlacedBlock): void => {
  const shouldTime = (Math.random() * 32) < 1;
  const t0 = shouldTime ? performance.now() : 0;
  worldCollisionGrid.addVoxel(block.position_x, block.position_y, block.position_z);
  if (shouldTime) diagnostics.recordColliderOp('add', performance.now() - t0);
};

/**
 * Remove a block's solidity from the collision grid (voxel remove).
 */
const removeBlockCollider = (block: PlacedBlock): void => {
  const shouldTime = (Math.random() * 32) < 1;
  const t0 = shouldTime ? performance.now() : 0;
  worldCollisionGrid.removeVoxel(block.position_x, block.position_y, block.position_z);
  if (shouldTime) diagnostics.recordColliderOp('remove', performance.now() - t0);
};

// Reusable occupancy buffer for surface culling — avoids allocating a new
// Uint8Array per chunk (up to 512KB each for tall trees, causing GC storms).
// Pre-allocate for 300-block-tall chunks (300 * 256 = 76800 bytes) to avoid
// first-use allocation stall. Buffer grows on demand for taller chunks.
const INITIAL_OCC_BUF_SIZE = 300 * 256;
let _occBuf: Uint8Array = new Uint8Array(INITIAL_OCC_BUF_SIZE);
let _occBufSize = INITIAL_OCC_BUF_SIZE;

/**
 * Surface-only culling: removes fully-surrounded interior blocks per chunk.
 * Uses a compact Uint8Array occupancy grid (16×16×H) for O(1) neighbor checks.
 * Chunk-edge blocks are always kept (cross-chunk culling is too expensive).
 * This is the "Minecraft approach" — render faces, not cubes.
 */
function computeSurfaceVisibleBlocks(chunkX: number, chunkZ: number, blocks: PlacedBlock[]): PlacedBlock[] {
  if (blocks.length < 50) return blocks; // Not worth culling tiny sets

  const originX = chunkX * CHUNK_SIZE;
  const originZ = chunkZ * CHUNK_SIZE;

  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < blocks.length; i++) {
    const y = blocks[i].position_y;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  const ySpan = (maxY - minY + 1);
  if (ySpan <= 0 || ySpan > 2048) return blocks; // Safety fallback

  const stride = 256; // 16 * 16 per Y layer
  const needed = ySpan * stride;
  // Reuse buffer if large enough, otherwise grow
  if (_occBufSize < needed) {
    _occBuf = new Uint8Array(needed);
    _occBufSize = needed;
  }
  const occ = _occBuf;
  // Zero only the portion we'll use (faster than allocating new)
  occ.fill(0, 0, needed);

  // Fill occupancy grid
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const lx = b.position_x - originX;
    const lz = b.position_z - originZ;
    const ly = b.position_y - minY;

    if (lx < 0 || lx >= 16 || lz < 0 || lz >= 16) continue;
    occ[(ly * stride) + (lz * 16) + lx] = 1;
  }

  // Filter: keep blocks with at least one exposed face
  // Only cull tree blocks — user-placed blocks are always kept visible
  const visible: PlacedBlock[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];

    // Never cull non-tree blocks (user-placed blocks should always render)
    if (!isTreeBlockType(b.block_type)) {
      visible.push(b);
      continue;
    }

    const lx = b.position_x - originX;
    const lz = b.position_z - originZ;
    const ly = b.position_y - minY;

    // Out-of-chunk blocks: always keep (shouldn't happen, but safe)
    if (lx < 0 || lx >= 16 || lz < 0 || lz >= 16) {
      visible.push(b);
      continue;
    }

    const base = (ly * stride) + (lz * 16) + lx;

    // Chunk edges = always exposed (cross-chunk neighbors unknown)
    const exposed =
      (lx === 0) || (lx === 15) || (lz === 0) || (lz === 15) ||
      (ly === 0) || (ly === ySpan - 1) ||
      (occ[base - 1] === 0) || (occ[base + 1] === 0) ||       // ±X
      (occ[base - 16] === 0) || (occ[base + 16] === 0) ||     // ±Z
      (occ[base - stride] === 0) || (occ[base + stride] === 0); // ±Y

    if (exposed) visible.push(b);
  }

  // Safety net: if all blocks were somehow culled, return original to prevent invisible chunks
  // This should never happen for tree structures (branches always have exposed faces)
  if (visible.length === 0 && blocks.length > 0) {
    console.warn(`[SurfaceCulling] All ${blocks.length} tree blocks culled for chunk (${chunkX},${chunkZ}) - returning original to prevent invisible chunk`);
    return blocks;
  }

  // B10: Sort visible blocks deterministically to stabilize sampling-based signatures
  // Without this, after culling removes different blocks, the sample indices shift and
  // cheapGroupKey/InstancedAtlasBlockGroup signatures change, causing cache misses
  sortBlocksDeterministic(visible);

  return visible;
}

/**
 * B4: Fast integer mixing for numeric signatures (no strings, no allocations)
 */
const mix32 = (n: number): number => {
  n |= 0;
  n = Math.imul(n ^ (n >>> 16), 0x7feb352d);
  n = Math.imul(n ^ (n >>> 15), 0x846ca68b);
  return (n ^ (n >>> 16)) >>> 0;
};

/**
 * B4: Compute numeric hash for a single block (no string creation)
 * Uses FNV-1a style mixing with position, block_type hash, and branch_depth
 */
const blockSig32 = (b: PlacedBlock): number => {
  let h = 2166136261 >>> 0; // FNV offset basis
  h = Math.imul(h ^ mix32(b.position_x | 0), 16777619) >>> 0;
  h = Math.imul(h ^ mix32(b.position_y | 0), 16777619) >>> 0;
  h = Math.imul(h ^ mix32(b.position_z | 0), 16777619) >>> 0;
  // Hash block_type string by summing char codes (fast, no allocation)
  const bt = b.block_type || '';
  let btHash = 0;
  for (let i = 0; i < bt.length; i++) {
    btHash = (btHash * 31 + bt.charCodeAt(i)) | 0;
  }
  h = Math.imul(h ^ mix32(btHash), 16777619) >>> 0;
  h = Math.imul(h ^ mix32((b as any).branch_depth | 0), 16777619) >>> 0;
  return h >>> 0;
};

/**
 * B4: Compute numeric chunk signature - O(n) but no string allocations
 * Returns {count, xor, sum} for incremental world signature updates
 */
function computeChunkSignature(blocks: PlacedBlock[]): ChunkSignature {
  let xor = 0 >>> 0;
  let sum = 0 >>> 0;
  for (let i = 0; i < blocks.length; i++) {
    const v = blockSig32(blocks[i]);
    xor = (xor ^ v) >>> 0;
    sum = (sum + v) >>> 0;
  }
  return { count: blocks.length, xor, sum };
}

// B4: Empty signature constant
const EMPTY_CHUNK_SIG: ChunkSignature = { count: 0, xor: 0, sum: 0 };

/**
 * Sort blocks deterministically by position (y, x, z).
 * Prevents reorder churn when the same blocks arrive in different order
 * from server queries or cache reads. This stabilizes cheapGroupKey sampling
 * in PlacedBlocks.tsx, avoiding false cache misses and unnecessary re-grouping.
 * In-place sort, O(n log n) per chunk — negligible for typical chunk sizes.
 */
const sortBlocksDeterministic = (blocks: PlacedBlock[]): void => {
  blocks.sort((a, b) =>
    (a.position_y - b.position_y) ||
    (a.position_x - b.position_x) ||
    (a.position_z - b.position_z)
  );
};

// B4: Compare two chunk signatures for equality
const signaturesEqual = (a: ChunkSignature, b: ChunkSignature): boolean => {
  return a.count === b.count && a.xor === b.xor && a.sum === b.sum;
};

/**
 * Hook to manage chunk-based loading of blocks based on player position.
 * Uses a single bounding query for initial/movement loads, and per-chunk
 * refetches for realtime updates.
 * 
 * This is the SINGLE SOURCE OF TRUTH for loaded blocks.
 * 
 * Phase 3.0: Single emit per frame batching
 * Phase 3A: Distance-aware eviction with LRU safety cap
 */
export function useChunkLoader({ worldId, onBlocksChanged, onRevisionChanged, emitRadius, loadRadius: loadRadiusProp }: UseChunkLoaderProps) {
  // Dynamic radii based on user's visual distance setting
  const LOAD_RADIUS = loadRadiusProp ?? DEFAULT_LOAD_RADIUS;
  const UNLOAD_RADIUS = LOAD_RADIUS + UNLOAD_HYSTERESIS;
  const MAX_LOADED_CHUNKS = (2 * UNLOAD_RADIUS + 1) ** 2 + 50;
  // EMIT_RADIUS: Only flatten chunks within this radius for emit (reduces downstream processing)
  const EMIT_RADIUS = emitRadius ?? LOAD_RADIUS;

  // Ref for use in interval callbacks (avoids stale closure captures)
  const loadRadiusRef = useRef(LOAD_RADIUS);
  loadRadiusRef.current = LOAD_RADIUS;
  // Loaded chunks: Map<chunkKey, ChunkData>
  const loadedChunksRef = useRef<Map<string, ChunkData>>(new Map());

  // Track chunks that failed to load — retried periodically
  const failedChunksRef = useRef<Map<string, { x: number; z: number; attempts: number }>>(new Map());

  // Current player chunk position
  const playerChunkRef = useRef<{ x: number; z: number } | null>(null);

  // Atomic chunk transitions: load-before-unload with transition ID for rapid crossings
  const transitionIdRef = useRef(0);

  // Throttle position updates
  const lastPositionUpdateRef = useRef(0);

  // Track if initial load has happened
  const [isLoading, setIsLoading] = useState(true);
  const initialLoadDone = useRef(false);

  // Track current world to clear on change
  const currentWorldRef = useRef<string | null>(null);

  // No mutex needed: JS is single-threaded, per-chunk cap check in the
  // processing loop sees accurate state between async yield points.

  // Ref for post-load eviction (avoids circular useCallback dependency)
  const evictAfterLoadRef = useRef<(() => void) | null>(null);

  // Phase 3.0: Single emit per frame batching
  const emitScheduledRef = useRef(false);

  // Phase 4: Stable block array reference tracking
  // Only emit a new array if contents actually changed (prevents React re-renders)
  const lastEmittedBlocksRef = useRef<PlacedBlock[]>([]);

  // Phase 4: World revision counter - incremented when visible content changes
  // Used by consumers for efficient useMemo dependencies
  const worldRevisionRef = useRef(0);

  // B4: Incremental world signature - updated when chunks change, checked in scheduleEmit
  // This is O(1) to check instead of O(blocks) to compute
  const worldSigRef = useRef<ChunkSignature>({ count: 0, xor: 0, sum: 0 });
  const lastEmittedWorldKeyRef = useRef<string>('');

  // Phase 3E: Velocity tracking with ring buffer
  const posHistRef = useRef({
    samples: Array.from({ length: POSITION_HISTORY_SIZE }, () => ({ x: 0, z: 0, t: 0 } as PositionSample)),
    head: 0,
    count: 0
  });

  // Phase 3E: Prefetch queue and scheduling
  const prefetchQueueRef = useRef<Array<{ x: number; z: number }>>([]);
  const prefetchQueuedSetRef = useRef<Set<string>>(new Set());
  const prefetchHandleRef = useRef<PrefetchHandle | null>(null);
  const lastPrefetchEnqueueAtRef = useRef(0);
  const lastDirRef = useRef<{ dx: number; dz: number } | null>(null);

  /**
   * B4: Update world signature incrementally when a chunk changes
   * This is O(1) - just XOR/add the old sig out and new sig in
   */
  const applyChunkSigChange = useCallback((
    prevSig: ChunkSignature,
    nextSig: ChunkSignature
  ): void => {
    const ws = worldSigRef.current;
    ws.count += (nextSig.count - prevSig.count);
    // XOR is self-inverse: XOR out old, XOR in new
    ws.xor = (ws.xor ^ prevSig.xor ^ nextSig.xor) >>> 0;
    // For sum: subtract old, add new
    ws.sum = (ws.sum - prevSig.sum + nextSig.sum) >>> 0;
  }, []);

  /**
   * Phase 3.0: Schedule a single emission per animation frame
   * This prevents multiple React updates from rapid chunk operations
   *
   * B4 OPTIMIZATION: World signature is maintained INCREMENTALLY via applyChunkSigChange.
   * scheduleEmit just checks if worldSigRef changed - O(1), no iteration at all.
   *
   * @param immediate - If true, emit synchronously (for initial load). Otherwise use RAF batching.
   */
  const scheduleEmit = useCallback((immediate = false) => {
    // Helper to do the actual emit
    const doEmit = () => {
      emitScheduledRef.current = false;

      // Get player chunk position for EMIT_RADIUS filtering
      const centerX = playerChunkRef.current?.x ?? 0;
      const centerZ = playerChunkRef.current?.z ?? 0;

      // B5: Compute visible-only signature (only chunks within EMIT_RADIUS)
      // This prevents flattening ALL loaded chunks when we only render visible ones
      let visibleBlockCount = 0;
      let visibleChunkCount = 0;
      let sigXor = 0 >>> 0;
      let sigSum = 0 >>> 0;

      for (let dx = -EMIT_RADIUS; dx <= EMIT_RADIUS; dx++) {
        for (let dz = -EMIT_RADIUS; dz <= EMIT_RADIUS; dz++) {
          const key = `chunk_${centerX + dx}_${centerZ + dz}`;
          const chunkData = loadedChunksRef.current.get(key);
          if (!chunkData) continue;

          visibleChunkCount++;
          // Use visibleBlocks (surface-only) for block count — interior blocks are culled
          // NOTE: Must check length explicitly - `??` doesn't catch empty arrays
          const blocksForCount = (chunkData.visibleBlocks?.length) ? chunkData.visibleBlocks : chunkData.blocks;
          visibleBlockCount += blocksForCount.length;

          // Use numeric signature from chunk (no string operations)
          const cs = chunkData.signature;
          sigXor = (sigXor ^ cs.xor) >>> 0;
          sigSum = (sigSum + cs.sum) >>> 0;
        }
      }

      // Gate on visible-only signature
      const visibleWorldKey = `${visibleChunkCount}:${visibleBlockCount}:${sigXor}:${sigSum}`;
      if (visibleWorldKey === lastEmittedWorldKeyRef.current) {
        return;
      }
      lastEmittedWorldKeyRef.current = visibleWorldKey;

      // Phase 4: Bump revision and notify callback
      // Phase 2 optimization: No longer flatten blocks — CameraTrackedBlocks reads loadedChunksRef directly
      worldRevisionRef.current++;
      if (onRevisionChanged) {
        onRevisionChanged(worldRevisionRef.current);
      }

      // Record flatten diagnostics and update chunk pipeline metrics
      diagnostics.recordFlattenEmit(0, 0);
      diagnostics.chunksInFlight = 0;
      if (playerChunkRef.current) {
        diagnostics.playerChunkX = playerChunkRef.current.x;
        diagnostics.playerChunkZ = playerChunkRef.current.z;
      }

      // Log first meaningful emit during initialization (once only)
      if (!initialLoadDone.current && visibleBlockCount > 0) {
        initLogStep('useChunkLoader.ts', `First emit: ${visibleChunkCount} chunks, ${visibleBlockCount} visible blocks`);
      }
    };

    if (immediate) {
      // Synchronous emit for initial load
      doEmit();
    } else {
      // Batched emit via RAF for runtime updates
      if (emitScheduledRef.current) return;
      emitScheduledRef.current = true;
      requestAnimationFrame(doEmit);
    }
  }, [onBlocksChanged, onRevisionChanged]);

  /**
   * Flatten all loaded chunks into a single blocks array
   * NOTE: This is still used for synchronous operations like optimistic updates
   */
  const flattenLoadedBlocks = useCallback((): PlacedBlock[] => {
    // Same strategy as scheduleEmit, preallocate and copy.
    // Uses visibleBlocks (surface-only) to avoid emitting interior blocks.
    // NOTE: Must check length explicitly - `??` doesn't catch empty arrays
    let total = 0;
    for (const chunkData of loadedChunksRef.current.values()) {
      const blocks = (chunkData.visibleBlocks?.length) ? chunkData.visibleBlocks : chunkData.blocks;
      total += blocks.length;
    }
    const allBlocks: PlacedBlock[] = new Array(total);
    let idx = 0;
    for (const chunkData of loadedChunksRef.current.values()) {
      const src = (chunkData.visibleBlocks?.length) ? chunkData.visibleBlocks : chunkData.blocks;
      for (let i = 0; i < src.length; i++) {
        allBlocks[idx++] = src[i];
      }
    }
    return allBlocks;
  }, []);

  /**
   * Phase 3A: Check if a chunk is "pinned" (should not be evicted)
   * Pinned if: within UNLOAD_RADIUS of player OR has optimistic blocks
   */
  const isChunkPinned = useCallback((chunkKey: string): boolean => {
    const match = chunkKey.match(/^chunk_(-?\d+)_(-?\d+)$/);
    if (!match) return true; // Don't evict malformed keys
    
    const chunkX = parseInt(match[1], 10);
    const chunkZ = parseInt(match[2], 10);
    const playerChunk = playerChunkRef.current;
    
    // If no player position, don't evict anything
    if (!playerChunk) return true;
    
    // Check distance to player
    const dx = Math.abs(chunkX - playerChunk.x);
    const dz = Math.abs(chunkZ - playerChunk.z);
    const distance = Math.max(dx, dz);
    
    if (distance <= UNLOAD_RADIUS) return true;
    
    // Check for optimistic blocks
    const chunkData = loadedChunksRef.current.get(chunkKey);
    if (chunkData?.hasOptimisticBlocks) return true;
    
    return false;
  }, []);

  /**
   * Phase 3A: Evict LRU chunks as a safety cap
   * Only evicts non-pinned chunks when we exceed MAX_LOADED_CHUNKS
   */
  /**
   * B3: LRU eviction now uses budgeted work for collider removal
   */
  const evictLRUChunks = useCallback(() => {
    const chunkCount = loadedChunksRef.current.size;
    if (chunkCount <= MAX_LOADED_CHUNKS) return;

    // Find non-pinned chunks sorted by lastAccessedAt (oldest first)
    const evictionCandidates: Array<{ key: string; lastAccessedAt: number }> = [];

    for (const [key, data] of loadedChunksRef.current.entries()) {
      if (!isChunkPinned(key)) {
        evictionCandidates.push({ key, lastAccessedAt: data.lastAccessedAt });
      }
    }

    // Sort by lastAccessedAt ascending (oldest first)
    evictionCandidates.sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);

    // Evict up to EVICTION_BATCH_SIZE chunks
    const toEvict = evictionCandidates.slice(0, EVICTION_BATCH_SIZE);

    if (toEvict.length > 0) {
      for (const { key } of toEvict) {
        const chunkData = loadedChunksRef.current.get(key);

        if (chunkData) {
          // B4: Update world signature before removing chunk
          applyChunkSigChange(chunkData.signature, EMPTY_CHUNK_SIG);
        }

        // Remove from map immediately (visuals disappear)
        loadedChunksRef.current.delete(key);
        removeChunkHeightMap(key);

        if (chunkData && chunkData.blocks.length > 0) {
          // Synchronous removal: budgeted removal "can't keep pace" with
          // loading, leaving orphaned colliders that balloon the grid + heap.
          // Removing the surface set (exactly what got colliders) is bounded
          // and fast (O(1-4 cells) each); the full-list fallback is a safe
          // no-op for blocks that never had a collider.
          const evictBlocks = chunkData.visibleBlocks?.length
            ? chunkData.visibleBlocks
            : chunkData.blocks;
          for (let i = 0; i < evictBlocks.length; i++) {
            removeBlockCollider(evictBlocks[i]);
          }
        }
      }
      // Use batched emit
      scheduleEmit();
    }
  }, [isChunkPinned, scheduleEmit, applyChunkSigChange]);

  /**
   * Add a block optimistically to the chunk loader's internal Map.
   * This ensures immediate UI feedback while awaiting server confirmation.
   * 
   * PERFORMANCE: We call onBlocksChanged synchronously for INSTANT feedback.
   * Phase 3A: Mark chunk as having optimistic blocks
   */
  const addBlockOptimistically = useCallback((block: PlacedBlock): void => {
    const chunkKey = getChunkKey(block.position_x, block.position_z);
    const chunkData = loadedChunksRef.current.get(chunkKey);
    const now = Date.now();
    
    if (chunkData) {
      // Check for duplicates at the same position
      const existsAtPosition = chunkData.blocks.some(b =>
        b.position_x === block.position_x &&
        b.position_y === block.position_y &&
        b.position_z === block.position_z
      );

      if (!existsAtPosition) {
        // B4: Save old signature before modification
        const oldSig = chunkData.signature;
        // Create collider for new block
        ensureBlockCollider(block);
        // Phase 1: Create new array reference so React.memo detects the change per-chunk
        chunkData.blocks = [...chunkData.blocks, block];
        // B10: Re-sort to maintain deterministic order for stable sampling signatures
        sortBlocksDeterministic(chunkData.blocks);
        // Phase 3A: Mark as having optimistic blocks (temp-*)
        if (block.id.startsWith('temp-')) {
          chunkData.hasOptimisticBlocks = true;
        }
        chunkData.lastAccessedAt = now;
        // B4: Update signature and world signature
        const newSig = computeChunkSignature(chunkData.blocks);
        chunkData.signature = newSig;
        applyChunkSigChange(oldSig, newSig);
        // Invalidate cached visibleBlocks — falls back to full blocks until next load/refetch.
        chunkData.visibleBlocks = undefined;
        // Batched emit via RAF — prevents rebuild storms from rapid block placements
        scheduleEmit();
      }
    } else {
      // Chunk not loaded - create it with just this block for immediate visibility
      // Create collider for new block
      ensureBlockCollider(block);
      const newBlocks = [block];
      const newSig = computeChunkSignature(newBlocks);
      loadedChunksRef.current.set(chunkKey, {
        blocks: newBlocks,
        loadedAt: now,
        lastAccessedAt: now,
        hasOptimisticBlocks: block.id.startsWith('temp-'),
        signature: newSig
        // visibleBlocks intentionally undefined — tiny chunk, not worth culling
      });
      // B4: Update world signature for new chunk
      applyChunkSigChange(EMPTY_CHUNK_SIG, newSig);
      scheduleEmit();
    }
  }, [scheduleEmit, applyChunkSigChange]);

  /**
   * BATCH: Add multiple blocks at once with a SINGLE React re-render.
   * Used by tree growth to prevent N re-renders when placing N blocks.
   * 
   * PERFORMANCE: Uses scheduleEmit for batched RAF callback instead of
   * immediate onBlocksChanged per block.
   */
  const addBlocksBatch = useCallback((blocks: PlacedBlock[]): void => {
    if (blocks.length === 0) return;

    const now = Date.now();
    // B4: Track old signatures for chunks we'll modify
    const oldSigs = new Map<string, ChunkSignature>();

    for (const block of blocks) {
      const chunkKey = getChunkKey(block.position_x, block.position_z);
      let chunkData = loadedChunksRef.current.get(chunkKey);

      if (!chunkData) {
        // Create chunk if needed - new chunks have empty signature
        chunkData = {
          blocks: [],
          loadedAt: now,
          lastAccessedAt: now,
          hasOptimisticBlocks: false,
          signature: EMPTY_CHUNK_SIG
        };
        loadedChunksRef.current.set(chunkKey, chunkData);
        oldSigs.set(chunkKey, EMPTY_CHUNK_SIG);
      } else if (!oldSigs.has(chunkKey)) {
        // First modification to existing chunk - save old signature
        oldSigs.set(chunkKey, chunkData.signature);
      }

      // Check for duplicates at the same position
      const existsAtPosition = chunkData.blocks.some(b =>
        b.position_x === block.position_x &&
        b.position_y === block.position_y &&
        b.position_z === block.position_z
      );

      if (!existsAtPosition) {
        // Create collider for new block
        ensureBlockCollider(block);
        // Phase 1: Create new array reference (batch — final copy done below in signature update)
        chunkData.blocks.push(block);
        if (block.id.startsWith('temp-')) {
          chunkData.hasOptimisticBlocks = true;
        }
        chunkData.lastAccessedAt = now;
      }
    }

    // B4: Update signatures for all modified chunks
    // Phase 1: Create new array references for all modified chunks
    if (oldSigs.size > 0) {
      for (const [chunkKey, oldSig] of oldSigs) {
        const chunkData = loadedChunksRef.current.get(chunkKey);
        if (chunkData) {
          // Phase 1: Create new array reference so React.memo detects the change
          chunkData.blocks = [...chunkData.blocks];
          // B10: Re-sort to maintain deterministic order for stable sampling signatures
          sortBlocksDeterministic(chunkData.blocks);
          const newSig = computeChunkSignature(chunkData.blocks);
          chunkData.signature = newSig;
          applyChunkSigChange(oldSig, newSig);
          // Invalidate visibleBlocks — PlacedBlocks culling handles tree blocks at render time
          chunkData.visibleBlocks = undefined;
        }
      }
      // Single emit for ALL blocks via requestAnimationFrame
      scheduleEmit();
    }
  }, [scheduleEmit, applyChunkSigChange]);

  /**
   * Replace a temp block with the real server block (by position match)
   * Phase 3A: Update hasOptimisticBlocks when temp blocks are replaced
   * 
   * OPTIMIZATION: Only trigger onBlocksChanged if visual data changed.
   * If only the ID changed (temp->real), skip the callback to prevent flashing.
   */
  const replaceBlockByPosition = useCallback((newBlock: PlacedBlock): void => {
    const chunkKey = getChunkKey(newBlock.position_x, newBlock.position_z);
    const chunkData = loadedChunksRef.current.get(chunkKey);
    
    if (chunkData) {
      const index = chunkData.blocks.findIndex(b => 
        b.position_x === newBlock.position_x &&
        b.position_y === newBlock.position_y &&
        b.position_z === newBlock.position_z
      );
      
      if (index >= 0) {
        const oldBlock = chunkData.blocks[index];
        
        // Check if visual data changed (block_type, texture_url)
        // If only ID changed (temp->real), skip re-render to prevent flashing
        const visualChanged = 
          oldBlock.block_type !== newBlock.block_type ||
          oldBlock.texture_url !== newBlock.texture_url;
        
        // Preserve branch_depth and collider from old block
        // This keeps tree lightening working after server sync and maintains collision
        const preservedBlock = {
          ...newBlock,
          branch_depth: newBlock.branch_depth ?? (oldBlock as any).branch_depth,
        };
        
        // Collision is a position-keyed voxel field now — a block that
        // persists at the same position keeps its voxel automatically
        // (idempotent add), so there is no per-block collider to transfer.

        // Phase 1: Create new array reference so React.memo detects the change per-chunk
        const newBlocks = [...chunkData.blocks];
        newBlocks[index] = preservedBlock;
        chunkData.blocks = newBlocks;
        chunkData.lastAccessedAt = Date.now();

        // Phase 3A: Recompute hasOptimisticBlocks after replacement
        chunkData.hasOptimisticBlocks = chunkData.blocks.some(b => b.id.startsWith('temp-'));

        // Only trigger React re-render if visual properties changed
        if (visualChanged) {
          // B4: Update signature and world signature
          const oldSig = chunkData.signature;
          const newSig = computeChunkSignature(chunkData.blocks);
          chunkData.signature = newSig;
          applyChunkSigChange(oldSig, newSig);
          chunkData.visibleBlocks = undefined;
          scheduleEmit();
        }
      }
    }
  }, [scheduleEmit, applyChunkSigChange]);

  /**
   * Remove a block by ID from the chunk loader
   * Phase 3A: Update hasOptimisticBlocks when blocks are removed
   */
  const removeBlockById = useCallback((blockId: string): void => {
    for (const [chunkKey, chunkData] of loadedChunksRef.current.entries()) {
      const index = chunkData.blocks.findIndex(b => b.id === blockId);
      if (index >= 0) {
        // B4: Save old signature before modification
        const oldSig = chunkData.signature;

        // Remove collider before removing block
        const block = chunkData.blocks[index];
        removeBlockCollider(block);

        // Phase 1: Create new array reference so React.memo detects the change per-chunk
        // Single copy + splice is cheaper than two slices + spread
        const newBlocks = chunkData.blocks.slice();
        newBlocks.splice(index, 1);
        chunkData.blocks = newBlocks;
        chunkData.lastAccessedAt = Date.now();

        // Phase 3A: Recompute hasOptimisticBlocks after removal
        chunkData.hasOptimisticBlocks = chunkData.blocks.some(b => b.id.startsWith('temp-'));
        // B4: Update signature and world signature
        const newSig = computeChunkSignature(chunkData.blocks);
        chunkData.signature = newSig;
        applyChunkSigChange(oldSig, newSig);
        chunkData.visibleBlocks = undefined;

        scheduleEmit();
        return;
      }
    }
  }, [scheduleEmit, applyChunkSigChange]);

  /**
   * Load chunks in a bounding box around the player using a single query
   * Phase 3.0: Uses scheduleEmit for batched emission
   * Phase 3A: Initializes lastAccessedAt and hasOptimisticBlocks
   * NOTE: Used for initial load only. Movement uses loadStripeChunks.
   */
  const loadChunksInRadius = useCallback(async (
    centerChunkX: number,
    centerChunkZ: number,
    radius: number
  ): Promise<void> => {
    if (!worldId) return;

    const minChunkX = centerChunkX - radius;
    const maxChunkX = centerChunkX + radius;
    const minChunkZ = centerChunkZ - radius;
    const maxChunkZ = centerChunkZ + radius;

    // Paginated bounding query for all chunks in radius — with retry
    const PAGE_SIZE = 1000;
    let blocks: PlacedBlock[] | null = null;
    let hitSafetyLimit = false;

    for (let attempt = 0; attempt < MAX_RETRY_ATTEMPTS; attempt++) {
      const fetched: PlacedBlock[] = [];
      hitSafetyLimit = false;
      let offset = 0;
      let hasMore = true;
      let pageError = false;

      while (hasMore) {
        const { data, error } = await supabase
          .from('placed_blocks')
          .select('*')
          .eq('world_id', worldId)
          .gte('chunk_x', minChunkX)
          .lte('chunk_x', maxChunkX)
          .gte('chunk_z', minChunkZ)
          .lte('chunk_z', maxChunkZ)
          .range(offset, offset + PAGE_SIZE - 1);

        if (error) {
          console.error(`[ChunkLoader] loadChunksInRadius page failed at offset ${offset} (attempt ${attempt + 1}/${MAX_RETRY_ATTEMPTS}):`, error.message);
          pageError = true;
          break;
        }

        if (data && data.length > 0) {
          fetched.push(...data);
          offset += data.length;
          hasMore = data.length === PAGE_SIZE;
        } else {
          hasMore = false;
        }

        if (offset >= MAX_TOTAL_BLOCKS) {
          console.warn(`[ChunkLoader] loadChunksInRadius hit ${MAX_TOTAL_BLOCKS} safety limit`);
          hitSafetyLimit = true;
          hasMore = false;
        }
      }

      if (!pageError) {
        blocks = fetched;
        break;
      }

      // Retry entire fetch
      if (attempt < MAX_RETRY_ATTEMPTS - 1) {
        await new Promise(r => setTimeout(r, RETRY_BASE_DELAY_MS * (2 ** attempt)));
      }
    }

    if (!blocks) {
      console.error('All retry attempts failed for loadChunksInRadius');
      // Track all chunks in radius as failed for periodic retry
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dz = -radius; dz <= radius; dz++) {
          const cx = centerChunkX + dx;
          const cz = centerChunkZ + dz;
          const key = `chunk_${cx}_${cz}`;
          if (!loadedChunksRef.current.has(key)) {
            failedChunksRef.current.set(key, { x: cx, z: cz, attempts: MAX_RETRY_ATTEMPTS });
          }
        }
      }
      return;
    }

    // Filter out expired blocks
    const now = new Date();
    const loadedAt = Date.now();
    const activeBlocks = (blocks || []).filter(block =>
      !block.expires_at || new Date(block.expires_at) > now
    );

    // Group blocks by chunk
    const chunkGroups = new Map<string, PlacedBlock[]>();
    for (const block of activeBlocks) {
      const chunkKey = getChunkKey(block.position_x, block.position_z);
      const existing = chunkGroups.get(chunkKey) || [];
      existing.push(block);
      chunkGroups.set(chunkKey, existing);
    }

    // Generate all chunk keys that should be loaded — clear from failed set on success
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        const chunkX = centerChunkX + dx;
        const chunkZ = centerChunkZ + dz;
        const chunkKey = `chunk_${chunkX}_${chunkZ}`;

        const chunkBlocks = chunkGroups.get(chunkKey) || [];

        // If we hit the safety limit and this chunk got zero blocks,
        // it may have been truncated — queue for individual retry instead
        // of storing as a loaded empty chunk
        if (hitSafetyLimit && chunkBlocks.length === 0) {
          failedChunksRef.current.set(chunkKey, { x: chunkX, z: chunkZ, attempts: 0 });
          continue;
        }

        failedChunksRef.current.delete(chunkKey);

        // CRITICAL: Remove old colliders before replacing chunk data
        const existingChunk = loadedChunksRef.current.get(chunkKey);
        if (existingChunk) {
          for (const oldBlock of existingChunk.blocks) {
            removeBlockCollider(oldBlock);
          }
        }

        // Deterministic sort to prevent reorder churn
        sortBlocksDeterministic(chunkBlocks);

        // Surface-only set for BOTH collision and rendering. Interior tree
        // blocks are unreachable, so they need neither. computeSurfaceVisibleBlocks
        // keeps every user-placed block, every chunk-edge block, and any tree
        // block with an exposed face (incl. the inner walls of navigable tree
        // interiors) — so physics/builds are unaffected. Colliding only this
        // set is what stops complete trees exploding the grid ~30x. Computed
        // once here, reused for visibleBlocks below.
        const surfaceBlocks = computeSurfaceVisibleBlocks(chunkX, chunkZ, chunkBlocks);

        // Only SMALL chunks get synchronous colliders (instant ground, ~ms).
        // Bigger chunks (complete trees) go through the budgeted queue —
        // mass-sync creation of a big tree's colliders in one frame was the
        // multi-second freeze when streaming in while moving.
        if (surfaceBlocks.length <= SYNC_COLLIDER_CAP) {
          for (const block of surfaceBlocks) {
            ensureBlockCollider(block);
          }
        } else if (surfaceBlocks.length > 0) {
          const blocksForColliders = surfaceBlocks;
          let colliderIdx = 0;
          enqueueJob(`load-colliders:${chunkKey}`, () => {
            const end = Math.min(colliderIdx + COLLIDER_CREATION_BATCH, blocksForColliders.length);
            for (; colliderIdx < end; colliderIdx++) {
              ensureBlockCollider(blocksForColliders[colliderIdx]);
            }
            return colliderIdx >= blocksForColliders.length;
          });
        }

        // Store chunk data (even if empty - means we loaded it)
        // Phase 3A: Initialize with lastAccessedAt and hasOptimisticBlocks
        const newSig = computeChunkSignature(chunkBlocks);
        const newChunkData: ChunkData = {
          blocks: chunkBlocks,
          loadedAt,
          lastAccessedAt: loadedAt,
          hasOptimisticBlocks: chunkBlocks.some(b => b.id.startsWith('temp-')),
          signature: newSig
        };
        newChunkData.visibleBlocks = surfaceBlocks;
        loadedChunksRef.current.set(chunkKey, newChunkData);
        // B4: Update world signature for new chunk
        applyChunkSigChange(EMPTY_CHUNK_SIG, newSig);
        // Update height map for pathfinding
        updateChunkHeightMap(chunkKey, chunkBlocks);
      }
    }

    // Phase 3.0: Use batched emit instead of synchronous callback
    scheduleEmit();
  }, [worldId, scheduleEmit, applyChunkSigChange]);

  /**
   * Phase 3D: Fetch chunk versions from server for a set of chunks
   * Returns Map<chunkKey, version>
   */
  const fetchChunkVersions = useCallback(async (
    chunkCoords: Array<{ x: number; z: number }>
  ): Promise<Map<string, number>> => {
    if (!worldId || chunkCoords.length === 0) return new Map();

    // Compute bounding box for version query
    const minX = Math.min(...chunkCoords.map(c => c.x));
    const maxX = Math.max(...chunkCoords.map(c => c.x));
    const minZ = Math.min(...chunkCoords.map(c => c.z));
    const maxZ = Math.max(...chunkCoords.map(c => c.z));

    const { data, error } = await supabase
      .from('chunk_versions')
      .select('chunk_x, chunk_z, version')
      .eq('world_id', worldId)
      .gte('chunk_x', minX)
      .lte('chunk_x', maxX)
      .gte('chunk_z', minZ)
      .lte('chunk_z', maxZ);

    if (error) {
      console.error('Error fetching chunk versions:', error);
      return new Map();
    }

    const versionMap = new Map<string, number>();
    for (const row of data || []) {
      const key = `chunk_${row.chunk_x}_${row.chunk_z}`;
      versionMap.set(key, row.version);
    }
    return versionMap;
  }, [worldId]);

  /**
   * Phase 3B+3D: Load specific chunks with cache support
   * 1. Check IndexedDB cache for each chunk
   * 2. Fetch server versions for cached chunks
   * 3. Use cache if version matches, fetch from server otherwise
   * 4. Save newly fetched chunks to cache
   */
  const loadSpecificChunks = useCallback(async (
    chunkCoords: Array<{ x: number; z: number }>
  ): Promise<void> => {
    if (!worldId || chunkCoords.length === 0) return;

    try {

    // Only evict when at/over the cap — prevents the load→evict→refetch
    // oscillation (chunks evicted then immediately re-fetched every call).
    if (loadedChunksRef.current.size >= MAX_LOADED_CHUNKS && playerChunkRef.current) {
      evictAfterLoadRef.current?.();
    }

    // Guard: don't load if still over chunk limit after eviction
    if (loadedChunksRef.current.size >= MAX_LOADED_CHUNKS) return;

    // Filter out already loaded chunks
    const toLoad = chunkCoords.filter(({ x, z }) => {
      const key = `chunk_${x}_${z}`;
      return !loadedChunksRef.current.has(key);
    });

    if (toLoad.length === 0) return;

    const loadedAt = Date.now();
    const now = new Date();

    // Phase 3D: Try to get chunks from cache
    let cachedChunks: Map<string, CachedChunk> = new Map();
    const USE_CHUNK_CACHE = true; // Re-enabled with fix
    if (USE_CHUNK_CACHE) {
      const cacheStepId = initLogStartStep('useChunkLoader.ts', `Reading IndexedDB cache (${toLoad.length} chunks)...`);
      try {
        cachedChunks = await blockDB.getCachedChunksBatch(worldId, toLoad);
        if (cacheStepId) initLogFinishStep(cacheStepId, cachedChunks.size);
      } catch (err) {
        console.warn('Cache read failed, fetching from server:', err);
        if (cacheStepId) initLogErrorStep(cacheStepId, 'Cache read failed');
      }
    }

    // Split into cached vs uncached
    const chunksWithCache: Array<{ x: number; z: number; cached: CachedChunk }> = [];
    const chunksWithoutCache: Array<{ x: number; z: number }> = [];

    for (const coord of toLoad) {
      const chunkKey = `chunk_${coord.x}_${coord.z}`;
      const cached = cachedChunks.get(chunkKey);
      if (cached) {
        chunksWithCache.push({ ...coord, cached });
      } else {
        chunksWithoutCache.push(coord);
      }
    }

    // Log cache hit/miss summary (only during initialization when it matters)
    if (!initialLoadDone.current && (chunksWithCache.length > 0 || chunksWithoutCache.length > 0)) {
      initLogStep('useChunkLoader.ts', `Cache: ${chunksWithCache.length} hits, ${chunksWithoutCache.length} misses`);
    }

    // Fetch server versions for cached chunks to check staleness
    const chunksToFetchFromServer: Array<{ x: number; z: number }> = [...chunksWithoutCache];
    const chunksFromCache: Array<{ x: number; z: number; blocks: PlacedBlock[] }> = [];

    if (chunksWithCache.length > 0) {
      // Performance optimization: Split cached chunks into "trustable" (very fresh) vs "need version check"
      // Chunks cached within CACHE_TRUST_WINDOW_MS are trusted without server round-trip
      const trustableChunks: Array<{ x: number; z: number; cached: CachedChunk }> = [];
      const needVersionCheck: Array<{ x: number; z: number; cached: CachedChunk }> = [];

      for (const chunkWithCache of chunksWithCache) {
        if (loadedAt - chunkWithCache.cached.cachedAt < CACHE_TRUST_WINDOW_MS) {
          trustableChunks.push(chunkWithCache);
        } else {
          needVersionCheck.push(chunkWithCache);
        }
      }

      // Process trustable chunks immediately without server check
      let trustedCount = 0;
      for (const { x, z, cached } of trustableChunks) {
        const activeBlocks = cached.blocks.filter(block =>
          !block.expires_at || new Date(block.expires_at) > now
        );

        // Truncation heuristic removed: the fetch_chunks_batch RPC now
        // returns full chunks (jsonb, no 1000-row cap), so a cached chunk
        // is complete — trust it.
        chunksFromCache.push({ x, z, blocks: activeBlocks });
        trustedCount++;
      }

      if (trustedCount > 0) {
        initLogStep('useChunkLoader.ts', `Cache trusted (fresh): ${trustedCount} chunks (no version check needed)`);
      }

      // For older cached chunks, check versions with server
      let freshCount = 0;
      let staleCount = 0;

      if (needVersionCheck.length > 0) {
        const verStepId = initLogStartStep('useChunkLoader.ts', `Checking ${needVersionCheck.length} chunk versions...`);
        const serverVersions = await fetchChunkVersions(needVersionCheck.map(c => ({ x: c.x, z: c.z })));
        if (verStepId) initLogFinishStep(verStepId, serverVersions.size);

        for (const { x, z, cached } of needVersionCheck) {
          const chunkKey = `chunk_${x}_${z}`;

          // Check if server has a version entry for this chunk
          const hasServerVersion = serverVersions.has(chunkKey);
          const serverVersion = serverVersions.get(chunkKey) ?? 0;

          // Cache is fresh if:
          // 1. Server has a version entry AND cache version >= server version, OR
          // 2. Server has NO version entry (chunk never modified since versioning started)
          const cacheIsFresh = hasServerVersion
            ? cached.version >= serverVersion
            : true; // No server version = no changes tracked, cache is valid

          if (cacheIsFresh) {
            // Cache is fresh - use it
            // Filter expired blocks from cache
            const activeBlocks = cached.blocks.filter(block =>
              !block.expires_at || new Date(block.expires_at) > now
            );

            // Truncation heuristic removed (RPC no longer caps at 1000) —
            // a fresh cached chunk is complete; use it.
            chunksFromCache.push({ x, z, blocks: activeBlocks });
            freshCount++;
          } else {
            // Cache is stale - need to fetch from server
            // BUT also load stale cache as fallback in case server fetch fails
            const activeBlocks = cached.blocks.filter(block =>
              !block.expires_at || new Date(block.expires_at) > now
            );
            chunksFromCache.push({ x, z, blocks: activeBlocks }); // Load stale as fallback
            chunksToFetchFromServer.push({ x, z }); // Also try to fetch fresh
            staleCount++;
          }
        }
        initLogStep('useChunkLoader.ts', `Cache freshness: ${freshCount} fresh, ${staleCount} stale`);
      }
    }

    // Load chunks from cache into memory (NO emit yet - wait for server data).
    // Yielding batches: a large integrity-check load (~299 cached chunks)
    // used to apply in ONE synchronous pass — the 2026-May-21 trace showed
    // that as a 1461ms main-thread freeze. Mirror the server-load path.
    let cacheBlockCount = 0;
    const CACHE_PROCESS_BATCH = 8;
    // Closest-first ordering: render chunks the player can actually see before
    // distant ones. Re-sorted each batch (below) so turning around mid-load
    // re-prioritizes toward the new heading.
    {
      const p0 = playerChunkRef.current;
      if (p0) chunksFromCache.sort((a, b) =>
        Math.max(Math.abs(a.x - p0.x), Math.abs(a.z - p0.z)) -
        Math.max(Math.abs(b.x - p0.x), Math.abs(b.z - p0.z)));
    }
    for (let cacheBatchStart = 0; cacheBatchStart < chunksFromCache.length; cacheBatchStart += CACHE_PROCESS_BATCH) {
      if (loadedChunksRef.current.size >= MAX_LOADED_CHUNKS) break;
      const cacheBatchEnd = Math.min(cacheBatchStart + CACHE_PROCESS_BATCH, chunksFromCache.length);
      for (let ci = cacheBatchStart; ci < cacheBatchEnd; ci++) {
      const { x, z, blocks } = chunksFromCache[ci];
      // Cap check: stop loading if at limit
      if (loadedChunksRef.current.size >= MAX_LOADED_CHUNKS) break;
      const chunkKey = `chunk_${x}_${z}`;
      if (loadedChunksRef.current.has(chunkKey)) continue;

      // CRITICAL: Remove old colliders before replacing chunk data
      const existingChunk = loadedChunksRef.current.get(chunkKey);
      if (existingChunk) {
        for (const oldBlock of existingChunk.blocks) {
          removeBlockCollider(oldBlock);
        }
      }

      // Deterministic sort to prevent reorder churn
      sortBlocksDeterministic(blocks);
      // Surface-only set for collision + rendering (see canonical note in the
      // server-load path). Computed once, reused for visibleBlocks below.
      const surfaceBlocks = computeSurfaceVisibleBlocks(x, z, blocks);
      // Small chunks sync (instant ground); big chunks → budgeted queue
      // (mass-sync collider creation on big trees = the freeze).
      if (surfaceBlocks.length <= SYNC_COLLIDER_CAP) {
        for (const block of surfaceBlocks) {
          ensureBlockCollider(block);
        }
      } else if (surfaceBlocks.length > 0) {
        const blocksForColliders = surfaceBlocks;
        let colliderIdx = 0;
        enqueueJob(`load-colliders:${chunkKey}`, () => {
          const end = Math.min(colliderIdx + COLLIDER_CREATION_BATCH, blocksForColliders.length);
          for (; colliderIdx < end; colliderIdx++) {
            ensureBlockCollider(blocksForColliders[colliderIdx]);
          }
          return colliderIdx >= blocksForColliders.length;
        });
      }
      cacheBlockCount += blocks.length;
      const newSig = computeChunkSignature(blocks);
      const newChunkData: ChunkData = {
        blocks,
        loadedAt,
        lastAccessedAt: loadedAt,
        hasOptimisticBlocks: blocks.some(b => b.id.startsWith('temp-')),
        signature: newSig
      };
      newChunkData.visibleBlocks = surfaceBlocks;
      loadedChunksRef.current.set(chunkKey, newChunkData);
      // B4: Update world signature for new chunk
      applyChunkSigChange(EMPTY_CHUNK_SIG, newSig);
      // Update height map for pathfinding
      updateChunkHeightMap(chunkKey, blocks);
      } // end inner per-chunk loop

      // Yield to the frame loop between batches so a big cached load can't
      // freeze the main thread (skip on the first batch during init).
      if (cacheBatchStart > 0 || initialLoadDone.current) {
        await new Promise<void>(resolve => {
          requestAnimationFrame(() => resolve());
        });
      }

      // Re-prioritize not-yet-processed chunks against the CURRENT player
      // position — if the player turned around mid-load, load what's nearest
      // NOW, not what was nearest when the load started.
      {
        const nextStart = cacheBatchStart + CACHE_PROCESS_BATCH;
        const pNow = playerChunkRef.current;
        if (pNow && nextStart < chunksFromCache.length) {
          const tail = chunksFromCache.slice(nextStart);
          tail.sort((a, b) =>
            Math.max(Math.abs(a.x - pNow.x), Math.abs(a.z - pNow.z)) -
            Math.max(Math.abs(b.x - pNow.x), Math.abs(b.z - pNow.z)));
          for (let i = 0; i < tail.length; i++) chunksFromCache[nextStart + i] = tail[i];
        }
      }
    }
    if (chunksFromCache.length > 0) {
      initLogStep('useChunkLoader.ts', `Loaded from cache: ${chunksFromCache.length} chunks, ${cacheBlockCount} blocks`);
    }

    // Fetch remaining chunks from server - fetch EACH CHUNK INDIVIDUALLY to avoid bounding box explosion
    // Previous approach used bounding box which could fetch millions of unwanted blocks
    if (chunksToFetchFromServer.length > 0) {
      const fetchStepId = initLogStartStep('useChunkLoader.ts', `Fetching ${chunksToFetchFromServer.length} chunks from Supabase...`);

      const wantedChunkKeys = new Set(chunksToFetchFromServer.map(c => `chunk_${c.x}_${c.z}`));

      // D-Flow: Start timing fetch phase
      const fetchT0 = performance.now();

      let blocks: PlacedBlock[] = [];
      let fetchFailed = false;
      const failedChunkCoords: Array<{ x: number; z: number }> = [];

      // Batched RPC fetch: 1-3 calls instead of 100-200 individual queries
      const RPC_BATCH_SIZE = 50;
      let useRpcFallback = false;

      for (let i = 0; i < chunksToFetchFromServer.length; i += RPC_BATCH_SIZE) {
        const batch = chunksToFetchFromServer.slice(i, i + RPC_BATCH_SIZE);
        const chunkParams = batch.map(({ x, z }) => ({ x, z }));

        const { data, error } = await supabase.rpc('fetch_chunks_batch', {
          p_world_id: worldId,
          p_chunks: chunkParams,
        });

        if (error) {
          // RPC not available (migration not applied yet) — fall back to per-chunk queries
          if (error.code === '42883' || error.message?.includes('function') || error.code === 'PGRST202') {
            console.warn('[ChunkLoader] Batched RPC not available, falling back to per-chunk fetch');
            useRpcFallback = true;
            break;
          }
          console.error('[ChunkLoader] Batched RPC error:', error.message);
          // Mark all chunks in this batch as failed
          for (const { x, z } of batch) {
            failedChunkCoords.push({ x, z });
          }
          continue;
        }

        if (data && data.length > 0) {
          // RPC returns rows without created_at/updated_at — add defaults for PlacedBlock compatibility
          for (let j = 0; j < data.length; j++) {
            const row = data[j];
            row.created_at = row.created_at ?? '';
            row.updated_at = row.updated_at ?? '';
          }
          blocks = blocks.concat(data as PlacedBlock[]);
        }
      }

      // Fallback: per-chunk individual queries (if RPC not available)
      if (useRpcFallback) {
        blocks = [];
        const PARALLEL_FETCH_LIMIT = 10;
        for (let i = 0; i < chunksToFetchFromServer.length; i += PARALLEL_FETCH_LIMIT) {
          const batch = chunksToFetchFromServer.slice(i, i + PARALLEL_FETCH_LIMIT);
          const batchPromises = batch.map(async ({ x, z }) => {
            const PAGE_SIZE = 1000;
            let chunkBlocks: PlacedBlock[] = [];
            let offset = 0;
            let hasMore = true;
            while (hasMore) {
              const { data: pageData, error: pageErr } = await supabase
                .from('placed_blocks')
                .select('*')
                .eq('world_id', worldId)
                .eq('chunk_x', x)
                .eq('chunk_z', z)
                .range(offset, offset + PAGE_SIZE - 1);
              if (pageErr) {
                return { x, z, blocks: null as PlacedBlock[] | null, failed: true };
              }
              if (pageData && pageData.length > 0) {
                chunkBlocks = chunkBlocks.concat(pageData);
                offset += pageData.length;
                hasMore = pageData.length === PAGE_SIZE;
              } else {
                hasMore = false;
              }
              if (offset >= 10000) { hasMore = false; }
            }
            return { x, z, blocks: chunkBlocks, failed: false };
          });
          const batchResults = await Promise.all(batchPromises);
          for (const result of batchResults) {
            if (result.failed || result.blocks === null) {
              failedChunkCoords.push({ x: result.x, z: result.z });
            } else {
              blocks = blocks.concat(result.blocks);
            }
          }
        }
      }

      // D-Flow: End fetch timing
      const fetchMs = performance.now() - fetchT0;

      console.log(`[ChunkLoader] Fetch complete: ${blocks.length} blocks, ${failedChunkCoords.length} failed, ${fetchMs.toFixed(0)}ms${useRpcFallback ? ' (fallback)' : ' (RPC)'}`);

      // Track failed chunks for retry
      if (failedChunkCoords.length > 0) {
        for (const { x, z } of failedChunkCoords) {
          const key = `chunk_${x}_${z}`;
          const existing = failedChunksRef.current.get(key);
          failedChunksRef.current.set(key, { x, z, attempts: (existing?.attempts ?? 0) + 1 });
        }
        if (fetchStepId) initLogErrorStep(fetchStepId, `${failedChunkCoords.length} chunks failed`);
      }

      // If ALL server chunks failed, bail early (cache may still be active)
      if (failedChunkCoords.length === chunksToFetchFromServer.length) {
        fetchFailed = true;
        console.error('[ChunkLoader] All chunk fetches failed');
        initLogStep('useChunkLoader.ts', `All ${chunksToFetchFromServer.length} server chunks failed (cache: ${chunksFromCache.length} chunks loaded)`);
        if (chunksFromCache.length > 0) {
          scheduleEmit();
        }
        return;
      }

      // Complete the fetch step (success or partial success)
      if (fetchStepId && failedChunkCoords.length === 0) {
        initLogFinishStep(fetchStepId, blocks.length);
      }

      // Get current versions for caching (only for successful chunks)
      const successfulChunks = chunksToFetchFromServer.filter(
        c => !failedChunkCoords.some(f => f.x === c.x && f.z === c.z)
      );
      const currentVersions = await fetchChunkVersions(successfulChunks);

      // D-Flow: Start build timing
      const buildT0 = performance.now();

      // Filter expired and group by chunk
      const activeBlocks = (blocks || []).filter(block => 
        !block.expires_at || new Date(block.expires_at) > now
      );
      initLogStep('useChunkLoader.ts', `Active blocks (non-expired)`, activeBlocks.length);

      const chunkGroups = new Map<string, PlacedBlock[]>();
      for (const block of activeBlocks) {
        const chunkKey = getChunkKey(block.position_x, block.position_z);
        if (!wantedChunkKeys.has(chunkKey)) continue;
        
        const existing = chunkGroups.get(chunkKey) || [];
        existing.push(block);
        chunkGroups.set(chunkKey, existing);
      }

      // Store chunks and prepare cache entries
      // Clear from failed set since fetch succeeded
      for (const { x, z } of chunksToFetchFromServer) {
        failedChunksRef.current.delete(`chunk_${x}_${z}`);
      }
      const chunksToCache: CachedChunk[] = [];
      let serverBlockCount = 0;

      // Priority queue: sort chunks by distance to player (closest first)
      const pChunkSort = playerChunkRef.current;
      const sortedServerChunks = [...chunksToFetchFromServer];
      if (pChunkSort) {
        sortedServerChunks.sort((a, b) => {
          const distA = Math.max(Math.abs(a.x - pChunkSort.x), Math.abs(a.z - pChunkSort.z));
          const distB = Math.max(Math.abs(b.x - pChunkSort.x), Math.abs(b.z - pChunkSort.z));
          return distA - distB;
        });
      }

      // Process chunks in yielding batches: closest first, emit after each batch
      // so the renderer can progressively display chunks without stalling
      const PROCESS_BATCH_SIZE = 10;

      for (let batchStart = 0; batchStart < sortedServerChunks.length; batchStart += PROCESS_BATCH_SIZE) {
        // Hard cap: stop processing if we've hit the chunk limit
        if (loadedChunksRef.current.size >= MAX_LOADED_CHUNKS) break;

        const batchEnd = Math.min(batchStart + PROCESS_BATCH_SIZE, sortedServerChunks.length);
        let batchChanged = false;

        for (let ci = batchStart; ci < batchEnd; ci++) {
          // Per-chunk cap check (concurrent calls may have added chunks)
          if (loadedChunksRef.current.size >= MAX_LOADED_CHUNKS) break;

          const { x, z } = sortedServerChunks[ci];
          const chunkKey = `chunk_${x}_${z}`;
          // Skip if already loaded (another concurrent call may have loaded it)
          if (loadedChunksRef.current.has(chunkKey)) continue;
          const chunkBlocks = chunkGroups.get(chunkKey) || [];

        // Empty chunks are valid - only skip if fetch explicitly failed
        if (failedChunkCoords.some(f => f.x === x && f.z === z)) {
          continue;
        }

        // Deterministic sort to prevent reorder churn
        sortBlocksDeterministic(chunkBlocks);

        // Surface-only set for collision + rendering (see canonical note in
        // the server-load path). Computed once, reused for visibleBlocks below.
        const surfaceBlocks = computeSurfaceVisibleBlocks(x, z, chunkBlocks);

        // Small chunks sync (instant ground); big chunks → budgeted queue
        // (mass-sync collider creation on big trees = the freeze).
        if (surfaceBlocks.length <= SYNC_COLLIDER_CAP) {
          for (const block of surfaceBlocks) {
            ensureBlockCollider(block);
          }
        } else if (surfaceBlocks.length > 0) {
          const blocksForColliders = surfaceBlocks;
          let colliderIdx = 0;
          enqueueJob(`load-colliders:${chunkKey}`, () => {
            const end = Math.min(colliderIdx + COLLIDER_CREATION_BATCH, blocksForColliders.length);
            for (; colliderIdx < end; colliderIdx++) {
              ensureBlockCollider(blocksForColliders[colliderIdx]);
            }
            return colliderIdx >= blocksForColliders.length;
          });
        }
        serverBlockCount += chunkBlocks.length;

        // CRITICAL: Remove old colliders before replacing chunk data
        const existingChunk = loadedChunksRef.current.get(chunkKey);
        if (existingChunk) {
          for (const oldBlock of existingChunk.blocks) {
            removeBlockCollider(oldBlock);
          }
        }

        const newSig = computeChunkSignature(chunkBlocks);
        const newChunkData: ChunkData = {
          blocks: chunkBlocks,
          loadedAt,
          lastAccessedAt: loadedAt,
          hasOptimisticBlocks: chunkBlocks.some(b => b.id.startsWith('temp-')),
          signature: newSig
        };
        newChunkData.visibleBlocks = surfaceBlocks;
        loadedChunksRef.current.set(chunkKey, newChunkData);
        // B4: Update world signature for new chunk from server
        applyChunkSigChange(EMPTY_CHUNK_SIG, newSig);

        batchChanged = true;
        // Update height map for pathfinding
        updateChunkHeightMap(chunkKey, chunkBlocks);

        // Prepare cache entry
        chunksToCache.push({
          key: `${worldId}:${x}:${z}`,
          worldId,
          chunkX: x,
          chunkZ: z,
          version: currentVersions.get(chunkKey) ?? 0,
          blocks: chunkBlocks,
          cachedAt: loadedAt
        });
        } // end inner per-chunk loop

        // After each batch: emit so renderer can display these chunks, then yield
        // to let the frame loop run (prevents stalling)
        if (batchChanged) {
          const isInit = !initialLoadDone.current;
          scheduleEmit(isInit);
        }

        // Yield to event loop between batches so game stays interactive
        // Skip yield for very first batch during init (player needs ground immediately)
        if (batchStart > 0 || initialLoadDone.current) {
          await new Promise<void>(resolve => {
            requestAnimationFrame(() => resolve());
          });
        }

        // Re-prioritize remaining server chunks against the CURRENT player
        // position so turning around mid-load loads the new-nearest first.
        {
          const nextStart = batchStart + PROCESS_BATCH_SIZE;
          const pNow = playerChunkRef.current;
          if (pNow && nextStart < sortedServerChunks.length) {
            const tail = sortedServerChunks.slice(nextStart);
            tail.sort((a, b) =>
              Math.max(Math.abs(a.x - pNow.x), Math.abs(a.z - pNow.z)) -
              Math.max(Math.abs(b.x - pNow.x), Math.abs(b.z - pNow.z)));
            for (let i = 0; i < tail.length; i++) sortedServerChunks[nextStart + i] = tail[i];
          }
        }
      } // end batch loop

      // D-Flow: End build timing, record chunk load
      const buildMs = performance.now() - buildT0;
      diagnostics.recordChunkLoad(fetchMs, buildMs);

      initLogStep('useChunkLoader.ts', `Loaded from server: ${sortedServerChunks.length} chunks, ${serverBlockCount} blocks`);

      // Batch save to cache (fire and forget)
      if (chunksToCache.length > 0) {
        initLogStep('useChunkLoader.ts', 'Saving chunks to IndexedDB cache...', chunksToCache.length);
        blockDB.saveCachedChunksBatch(chunksToCache).catch(err => {
          console.warn('Failed to cache chunks:', err);
        });
      }
    }

    // Evict excess chunks if we're over the limit after loading.
    // Uses evictRef to avoid circular useCallback dependency.
    if (loadedChunksRef.current.size > MAX_LOADED_CHUNKS && playerChunkRef.current) {
      evictAfterLoadRef.current?.();
    }

    // FIX: Single consolidated emit after ALL data (cache + server) is loaded
    // Use immediate emit during initial load for faster rendering
    // Note: First emit log happens inside doEmit() with actual counts
    const isInitialLoad = !initialLoadDone.current;
    scheduleEmit(isInitialLoad);

    } catch (err) {
      console.error('[ChunkLoader] loadSpecificChunks error:', err);
    }
  }, [worldId, scheduleEmit, fetchChunkVersions]);

  /**
   * Phase 3B: Get the edge stripe chunks when moving from one chunk to another
   * Returns only the new chunks that need to be loaded on the leading edge
   */
  const getStripeChunks = useCallback((
    prevChunkX: number,
    prevChunkZ: number,
    newChunkX: number,
    newChunkZ: number,
    radius: number
  ): Array<{ x: number; z: number }> => {
    const stripeChunks: Array<{ x: number; z: number }> = [];
    
    const deltaX = newChunkX - prevChunkX;
    const deltaZ = newChunkZ - prevChunkZ;

    // Handle X movement - load a vertical stripe
    if (deltaX !== 0) {
      const stripeX = deltaX > 0 ? newChunkX + radius : newChunkX - radius;
      for (let z = newChunkZ - radius; z <= newChunkZ + radius; z++) {
        stripeChunks.push({ x: stripeX, z });
      }
    }

    // Handle Z movement - load a horizontal stripe
    if (deltaZ !== 0) {
      const stripeZ = deltaZ > 0 ? newChunkZ + radius : newChunkZ - radius;
      for (let x = newChunkX - radius; x <= newChunkX + radius; x++) {
        // Avoid duplicating corner chunk if we also moved in X
        if (deltaX !== 0) {
          const cornerX = deltaX > 0 ? newChunkX + radius : newChunkX - radius;
          if (x === cornerX) continue;
        }
        stripeChunks.push({ x, z: stripeZ });
      }
    }

    return stripeChunks;
  }, []);

  // ============================================================================
  // Phase 3E: Velocity-Based Prefetching
  // ============================================================================

  /**
   * Phase 3E: Add a position sample to the ring buffer (zero allocation)
   */
  const addPositionSample = useCallback((x: number, z: number, t: number) => {
    const h = posHistRef.current;
    const s = h.samples[h.head];
    s.x = x;
    s.z = z;
    s.t = t;
    h.head = (h.head + 1) % POSITION_HISTORY_SIZE;
    h.count = Math.min(h.count + 1, POSITION_HISTORY_SIZE);
  }, []);

  /**
   * Phase 3E: Calculate velocity from position history
   * Returns null if stationary or not enough samples
   */
  const calculateVelocity = useCallback((): { dirX: number; dirZ: number; speed: number } | null => {
    const h = posHistRef.current;
    if (h.count < 2) return null;

    const newestIdx = (h.head - 1 + POSITION_HISTORY_SIZE) % POSITION_HISTORY_SIZE;
    const oldestIdx = (h.head - h.count + POSITION_HISTORY_SIZE) % POSITION_HISTORY_SIZE;

    const a = h.samples[oldestIdx];
    const b = h.samples[newestIdx];

    const dt = (b.t - a.t) / 1000;
    if (dt <= 0.05) return null; // Too short, unreliable

    const vx = (b.x - a.x) / dt;
    const vz = (b.z - a.z) / dt;
    const speed = Math.hypot(vx, vz);

    if (speed < PREFETCH_MIN_SPEED) return null; // Stationary

    return { dirX: vx / speed, dirZ: vz / speed, speed };
  }, []);

  /**
   * Phase 3E: Get prefetch stripe chunks ahead of player movement
   * Uses stripe-based approach matching existing loader patterns
   */
  const getPrefetchStripeChunks = useCallback((
    playerChunkX: number,
    playerChunkZ: number,
    dirX: number,
    dirZ: number
  ): Array<{ x: number; z: number }> => {
    const coords: Array<{ x: number; z: number }> = [];

    // Determine movement direction (threshold to avoid diagonal noise)
    const stepX = Math.abs(dirX) >= 0.3 ? Math.sign(dirX) : 0;
    const stepZ = Math.abs(dirZ) >= 0.3 ? Math.sign(dirZ) : 0;

    // No clear direction
    if (stepX === 0 && stepZ === 0) return coords;

    // Prefetch stripes at LOAD_RADIUS+1 up to LOAD_RADIUS+PREFETCH_DISTANCE
    for (let d = 1; d <= PREFETCH_DISTANCE; d++) {
      const r = LOAD_RADIUS + d;

      if (stepX !== 0) {
        const stripeX = playerChunkX + stepX * r;
        for (let z = playerChunkZ - LOAD_RADIUS; z <= playerChunkZ + LOAD_RADIUS; z++) {
          coords.push({ x: stripeX, z });
        }
      }

      if (stepZ !== 0) {
        const stripeZ = playerChunkZ + stepZ * r;
        for (let x = playerChunkX - LOAD_RADIUS; x <= playerChunkX + LOAD_RADIUS; x++) {
          // Avoid duplicating corner if also moving in X
          if (stepX !== 0) {
            const cornerX = playerChunkX + stepX * r;
            if (x === cornerX) continue;
          }
          coords.push({ x, z: stripeZ });
        }
      }
    }

    return coords;
  }, []);

  /**
   * Phase 3E: Cancel pending prefetch operations
   * Properly handles both requestIdleCallback and setTimeout
   */
  const cancelPrefetch = useCallback(() => {
    prefetchQueueRef.current = [];
    prefetchQueuedSetRef.current.clear();

    const h = prefetchHandleRef.current;
    if (!h) return;

    if (h.kind === 'idle' && typeof (globalThis as any).cancelIdleCallback === 'function') {
      (globalThis as any).cancelIdleCallback(h.id);
    } else if (h.kind === 'timeout') {
      clearTimeout(h.id);
    }
    prefetchHandleRef.current = null;
  }, []);

  /**
   * Phase 3E: Process prefetch queue in small batches during idle time
   * FIX: Added in-flight guard to prevent overlapping prefetch batches
   */
  const prefetchLoadingRef = useRef(false);
  
  const processPrefetchQueue = useCallback(async () => {
    prefetchHandleRef.current = null;

    // Guard: Only one prefetch batch at a time to prevent CPU/network spikes
    if (prefetchLoadingRef.current) return;
    if (!worldId) return;

    prefetchLoadingRef.current = true;
    
    try {
      // Pull a small batch
      const batch: Array<{ x: number; z: number }> = [];
      while (batch.length < PREFETCH_BATCH_SIZE && prefetchQueueRef.current.length > 0) {
        const item = prefetchQueueRef.current.shift()!;
        const key = `chunk_${item.x}_${item.z}`;
        prefetchQueuedSetRef.current.delete(key);

        // Skip if already loaded
        if (!loadedChunksRef.current.has(key)) {
          batch.push({ x: item.x, z: item.z });
        }
      }

      if (batch.length > 0) {
        // Await to ensure sequential prefetch batches
        await loadSpecificChunks(batch);
      }
    } catch (err) {
      console.warn('Prefetch load failed:', err);
    } finally {
      prefetchLoadingRef.current = false;
      
      // Schedule next batch if more to process
      if (prefetchQueueRef.current.length > 0) {
        schedulePrefetchWork();
      }
    }
  }, [worldId, loadSpecificChunks]);

  /**
   * Phase 3E: Schedule prefetch work using requestIdleCallback or setTimeout fallback
   */
  const schedulePrefetchWork = useCallback(() => {
    // Already scheduled
    if (prefetchHandleRef.current) return;

    if (typeof (globalThis as any).requestIdleCallback === 'function') {
      const id = (globalThis as any).requestIdleCallback(processPrefetchQueue, { timeout: 1000 });
      prefetchHandleRef.current = { kind: 'idle', id };
    } else {
      // Safari fallback
      const id = window.setTimeout(processPrefetchQueue, 50);
      prefetchHandleRef.current = { kind: 'timeout', id };
    }
  }, [processPrefetchQueue]);

  /**
   * Phase 3E: Enqueue prefetch chunks based on velocity
   * Called on every position update, not just chunk changes
   */
  const enqueuePrefetch = useCallback((
    worldX: number,
    worldZ: number,
    now: number
  ) => {
    // Guard: Don't prefetch if near memory limit
    if (loadedChunksRef.current.size > MAX_LOADED_CHUNKS - PREFETCH_HEADROOM) {
      return;
    }

    // Debounce
    if (now - lastPrefetchEnqueueAtRef.current < PREFETCH_DEBOUNCE_MS) {
      return;
    }

    const velocity = calculateVelocity();
    if (!velocity) return;

    const newDir = { dx: velocity.dirX, dz: velocity.dirZ };
    const lastDir = lastDirRef.current;

    // Check for significant direction change (dot product < 0.7 = ~45°)
    const dot = lastDir ? (lastDir.dx * newDir.dx + lastDir.dz * newDir.dz) : 1;
    if (!lastDir || dot < 0.7) {
      // Direction changed significantly - cancel old prefetches
      cancelPrefetch();
    }
    lastDirRef.current = newDir;

    // Get player chunk
    const playerChunkX = Math.floor(worldX / CHUNK_SIZE);
    const playerChunkZ = Math.floor(worldZ / CHUNK_SIZE);

    // Get candidate chunks
    const candidates = getPrefetchStripeChunks(playerChunkX, playerChunkZ, velocity.dirX, velocity.dirZ);

    // Enqueue candidates (deduplicated)
    for (const c of candidates) {
      const key = `chunk_${c.x}_${c.z}`;
      if (loadedChunksRef.current.has(key)) continue;
      if (prefetchQueuedSetRef.current.has(key)) continue;

      prefetchQueuedSetRef.current.add(key);
      prefetchQueueRef.current.push({ x: c.x, z: c.z });
    }

    // Start processing if we have items
    if (prefetchQueueRef.current.length > 0) {
      schedulePrefetchWork();
      lastPrefetchEnqueueAtRef.current = now;
    }
  }, [calculateVelocity, cancelPrefetch, getPrefetchStripeChunks, schedulePrefetchWork]);

  /**
   * Phase 3E: Reset prefetch state (called on world change)
   */
  const resetPrefetchState = useCallback(() => {
    cancelPrefetch();
    posHistRef.current.head = 0;
    posHistRef.current.count = 0;
    lastDirRef.current = null;
    lastPrefetchEnqueueAtRef.current = 0;
  }, [cancelPrefetch]);

  /**
   * Phase 3C: Get chunks for a specific ring around the center
   * Ring 1 = center chunk only (innermost)
   * Ring 2 = 8 chunks surrounding center (3x3 minus center)
   * Ring N = chunks at Chebyshev distance N-1 from center
   */
  const getRingChunks = useCallback((
    centerX: number,
    centerZ: number,
    ring: number
  ): Array<{ x: number; z: number }> => {
    const chunks: Array<{ x: number; z: number }> = [];
    // Convert to 0-based distance for calculation
    const distance = ring - 1;

    if (distance === 0) {
      // Center chunk only (ring 1)
      chunks.push({ x: centerX, z: centerZ });
    } else if (distance > 0) {
      // Ring N: all chunks at Chebyshev distance exactly (N-1)
      for (let dx = -distance; dx <= distance; dx++) {
        for (let dz = -distance; dz <= distance; dz++) {
          // Only include if on the edge (max distance equals ring distance)
          if (Math.max(Math.abs(dx), Math.abs(dz)) === distance) {
            chunks.push({ x: centerX + dx, z: centerZ + dz });
          }
        }
      }
    }

    return chunks;
  }, []);

  /**
   * Phase 3C: Load chunks progressively in rings (near-first)
   * Loads ring 1 first for fast initial display, then remaining rings
   */
  const loadProgressiveRings = useCallback(async (
    centerX: number,
    centerZ: number,
    maxRadius: number
  ): Promise<void> => {
    if (!worldId) return;

    // Load ring 1 first (center chunk) for quick initial display
    const ring1Chunks = getRingChunks(centerX, centerZ, 1);
    await loadSpecificChunks(ring1Chunks);

    // Then load remaining rings (starting from ring 2)
    for (let ring = 2; ring <= maxRadius + 1; ring++) {
      const ringChunks = getRingChunks(centerX, centerZ, ring);
      await loadSpecificChunks(ringChunks);
    }
  }, [worldId, getRingChunks, loadSpecificChunks]);

  /**
   * Refetch a single chunk (used for realtime updates)
   * Preserves optimistic blocks (temp-*) that haven't been confirmed yet
   * Phase 3.0: Uses scheduleEmit for batched emission
   * Phase 3A: Updates lastAccessedAt and hasOptimisticBlocks
   */
  const refetchSingleChunk = useCallback(async (
    chunkX: number,
    chunkZ: number
  ): Promise<void> => {
    if (!worldId) return;

    const chunkKey = `chunk_${chunkX}_${chunkZ}`;
    
    // Only refetch if chunk is currently loaded
    const existingChunkData = loadedChunksRef.current.get(chunkKey);
    if (!existingChunkData) {
      return;
    }

    // CRITICAL: Supabase default limit is 1000 rows - single chunks can have many blocks
    let serverBlocks: PlacedBlock[] | null = null;
    for (let attempt = 0; attempt < MAX_RETRY_ATTEMPTS; attempt++) {
      const { data, error } = await supabase
        .from('placed_blocks')
        .select('*')
        .eq('world_id', worldId)
        .eq('chunk_x', chunkX)
        .eq('chunk_z', chunkZ)
        .limit(20000);

      if (!error) {
        serverBlocks = data;
        break;
      }

      console.error(`Error refetching chunk (attempt ${attempt + 1}/${MAX_RETRY_ATTEMPTS}):`, error);
      if (attempt < MAX_RETRY_ATTEMPTS - 1) {
        await new Promise(r => setTimeout(r, RETRY_BASE_DELAY_MS * (2 ** attempt)));
      }
    }

    if (serverBlocks === null) {
      console.error(`[ChunkLoader] All retries failed for refetchSingleChunk (${chunkX},${chunkZ})`);
      return;
    }

    // Filter out expired blocks
    const now = new Date();
    const loadedAt = Date.now();
    const activeServerBlocks = (serverBlocks || []).filter(block => 
      !block.expires_at || new Date(block.expires_at) > now
    );

    // Keep optimistic blocks (temp-*) that don't have a server counterpart yet
    // This prevents flickering when we place a block and the refetch happens
    // before the block sync completes
    const optimisticBlocks = existingChunkData.blocks.filter(block => {
      // Only keep temp blocks
      if (!block.id.startsWith('temp-')) return false;
      
      // Check if server has a block at this position
      const hasServerBlock = activeServerBlocks.some(sb => 
        sb.position_x === block.position_x &&
        sb.position_y === block.position_y &&
        sb.position_z === block.position_z
      );
      
      // Keep optimistic block only if no server block exists at that position
      return !hasServerBlock;
    });

    // Merge: server blocks + unconfirmed optimistic blocks
    const mergedBlocks = [...activeServerBlocks, ...optimisticBlocks];

    // Deterministic sort to prevent reorder churn
    sortBlocksDeterministic(mergedBlocks);

    // B4: Check if blocks actually changed using numeric signature comparison
    const oldSignature = existingChunkData.signature;
    const newSignature = computeChunkSignature(mergedBlocks);
    const blocksChanged = !signaturesEqual(oldSignature, newSignature);

    if (!blocksChanged) {
      // Data is identical - just update timestamp, skip state change and emit
      existingChunkData.lastAccessedAt = loadedAt;
      return; // Early exit - no visual change needed
    }

    // B4: Update world signature incrementally
    applyChunkSigChange(oldSignature, newSignature);

    // FIX: Remove colliders for blocks that no longer exist (ghost collider cleanup)
    // This prevents invisible collision barriers from deleted blocks (e.g., chopped trees)
    const mergedBlockIds = new Set(mergedBlocks.map(b => b.id));
    for (const oldBlock of existingChunkData.blocks) {
      if (!mergedBlockIds.has(oldBlock.id)) {
        removeBlockCollider(oldBlock);
      }
    }

    // Ensure colliders exist for all current blocks
    for (const block of mergedBlocks) {
      ensureBlockCollider(block);
    }

    // Update chunk data with Phase 3A fields (only if blocks changed)
    const refetchedChunkData: ChunkData = {
      blocks: mergedBlocks,
      loadedAt,
      lastAccessedAt: loadedAt,
      hasOptimisticBlocks: optimisticBlocks.length > 0,
      signature: newSignature
    };
    refetchedChunkData.visibleBlocks = computeSurfaceVisibleBlocks(chunkX, chunkZ, mergedBlocks);
    loadedChunksRef.current.set(chunkKey, refetchedChunkData);
    // Update height map for pathfinding
    updateChunkHeightMap(chunkKey, mergedBlocks);

    // Phase 3D: Update cache with server data (only if no optimistic blocks)
    // We skip caching if there are optimistic blocks to avoid caching temp data
    if (optimisticBlocks.length === 0) {
      fetchChunkVersions([{ x: chunkX, z: chunkZ }]).then(versions => {
        const version = versions.get(chunkKey) ?? 0;
        blockDB.saveCachedChunk({
          key: `${worldId}:${chunkX}:${chunkZ}`,
          worldId,
          chunkX,
          chunkZ,
          version,
          blocks: activeServerBlocks,
          cachedAt: loadedAt
        }).catch(err => console.warn('Failed to update chunk cache:', err));
      });
    }

    // Phase 3.0: Use batched emit instead of synchronous callback (only if blocks changed)
    scheduleEmit();
  }, [worldId, scheduleEmit, fetchChunkVersions]);

  /**
   * Unload chunks that are beyond UNLOAD_RADIUS from player
   * Phase 3.0: Uses scheduleEmit for batched emission
   * Phase 3A: Respects pinned chunks (those with optimistic blocks)
   * B3: Uses budgeted work to spread collider removal across frames (prevents GC storms)
   *
   * CRITICAL FIX: All chunk data removals happen immediately with a SINGLE emit.
   * Previously, deferred unloads each triggered separate emits, causing cascading
   * O(N) incremental updates in InstancedAtlasBlockGroup (one per deferred chunk).
   * Only collider removal is budgeted (the slow part), not the data/emit path.
   */
  const unloadDistantChunks = useCallback((centerChunkX: number, centerChunkZ: number) => {
    const now = Date.now();
    let removedAny = false;

    for (const [chunkKey, chunkData] of loadedChunksRef.current) {
      const match = chunkKey.match(/^chunk_(-?\d+)_(-?\d+)$/);
      if (!match) continue;

      const chunkX = parseInt(match[1], 10);
      const chunkZ = parseInt(match[2], 10);

      // Use Chebyshev distance (max of dx, dz)
      const dx = Math.abs(chunkX - centerChunkX);
      const dz = Math.abs(chunkZ - centerChunkZ);
      const distance = Math.max(dx, dz);

      if (distance > UNLOAD_RADIUS) {
        // Phase 3A: Don't unload chunks with optimistic blocks
        if (chunkData.hasOptimisticBlocks) continue;

        // B3: Don't unload chunks that were loaded recently (prevents thrashing)
        if (now - chunkData.loadedAt < MIN_RESIDENCY_MS) continue;

        // D-Flow: Record chunk unload
        diagnostics.recordChunkUnload();

        // B4: Update world signature before removing
        applyChunkSigChange(chunkData.signature, EMPTY_CHUNK_SIG);

        // Remove chunk data immediately (so next emit reflects removal)
        loadedChunksRef.current.delete(chunkKey);
        removeChunkHeightMap(chunkKey);
        removedAny = true;

        // Synchronous removal (see eviction note): bounded + fast on the
        // surface set, prevents orphaned colliders accumulating in the grid.
        if (chunkData.blocks.length > 0) {
          const unloadBlocks = chunkData.visibleBlocks?.length
            ? chunkData.visibleBlocks
            : chunkData.blocks;
          for (let i = 0; i < unloadBlocks.length; i++) {
            removeBlockCollider(unloadBlocks[i]);
          }
        }
      }
    }

    // Single emit for ALL removals — prevents cascading incremental updates
    if (removedAny) {
      scheduleEmit();
    }
  }, [scheduleEmit, applyChunkSigChange]);

  // Wire up eviction ref now that both functions are defined
  evictAfterLoadRef.current = () => {
    if (playerChunkRef.current) {
      unloadDistantChunks(playerChunkRef.current.x, playerChunkRef.current.z);
      evictLRUChunks();
    }
  };

  /**
   * Update player position - called by game controller
   * Phase 3B: Uses incremental stripe loading instead of full square reload
   * Phase 3A: Updates lastAccessedAt for pinned chunks and runs LRU eviction
   * Phase 3E: Runs velocity sampling + prefetch on EVERY throttled call
   */
  const updatePlayerPosition = useCallback(async (worldX: number, worldZ: number) => {
    if (!worldId) return;
    // Don't load/unload chunks until initial load is complete
    if (!initialLoadDone.current) return;

    const now = Date.now();
    if (now - lastPositionUpdateRef.current < POSITION_UPDATE_THROTTLE) {
      return;
    }
    lastPositionUpdateRef.current = now;

    // Phase 3E: ALWAYS sample position for velocity calculation (even within same chunk)
    addPositionSample(worldX, worldZ, now);

    // Phase 3E: ALWAYS try to enqueue prefetch (runs even when still in same chunk)
    // B4: Disabled temporarily to isolate stutter sources
    if (PREFETCH_ENABLED) {
      enqueuePrefetch(worldX, worldZ, now);
    }

    const newChunkX = Math.floor(worldX / CHUNK_SIZE);
    const newChunkZ = Math.floor(worldZ / CHUNK_SIZE);

    const prevChunk = playerChunkRef.current;

    // Check if player moved to a different chunk
    if (!prevChunk || prevChunk.x !== newChunkX || prevChunk.z !== newChunkZ) {
      const hadPrevChunk = prevChunk !== null;
      const oldChunkX = prevChunk?.x ?? newChunkX;
      const oldChunkZ = prevChunk?.z ?? newChunkZ;
      
      playerChunkRef.current = { x: newChunkX, z: newChunkZ };

      // D-Flow: Track player chunk position and in-flight count
      diagnostics.playerChunkX = newChunkX;
      diagnostics.playerChunkZ = newChunkZ;
      diagnostics.chunksInFlight = 0;

      // Phase 3A: Update lastAccessedAt for all pinned (nearby) chunks
      const accessTime = Date.now();
      for (let dx = -UNLOAD_RADIUS; dx <= UNLOAD_RADIUS; dx++) {
        for (let dz = -UNLOAD_RADIUS; dz <= UNLOAD_RADIUS; dz++) {
          const chunkKey = `chunk_${newChunkX + dx}_${newChunkZ + dz}`;
          const chunkData = loadedChunksRef.current.get(chunkKey);
          if (chunkData) {
            chunkData.lastAccessedAt = accessTime;
          }
        }
      }

      // Phase 3B: Use incremental stripe loading for single-chunk movement
      // For multi-chunk moves (teleport, fast travel, large jumps), load ALL missing chunks
      // ATOMIC TRANSITIONS: Load new chunks FIRST, then unload old ones.
      if (hadPrevChunk) {
        const moveDistance = Math.max(Math.abs(newChunkX - oldChunkX), Math.abs(newChunkZ - oldChunkZ));

        // Determine which chunks to load
        let chunksToLoad: Array<{ x: number; z: number }>;

        if (moveDistance <= 1) {
          // Single chunk movement: use efficient stripe loading
          chunksToLoad = getStripeChunks(
            oldChunkX, oldChunkZ,
            newChunkX, newChunkZ,
            LOAD_RADIUS
          );
        } else {
          // Multi-chunk movement: find ALL missing chunks in new radius
          // This fixes the bug where teleporting/fast travel left chunks unloaded
          chunksToLoad = [];
          for (let dx = -LOAD_RADIUS; dx <= LOAD_RADIUS; dx++) {
            for (let dz = -LOAD_RADIUS; dz <= LOAD_RADIUS; dz++) {
              const cx = newChunkX + dx;
              const cz = newChunkZ + dz;
              const key = `chunk_${cx}_${cz}`;
              if (!loadedChunksRef.current.has(key)) {
                chunksToLoad.push({ x: cx, z: cz });
              }
            }
          }
        }

        if (chunksToLoad.length > 0) {
          // Increment transition ID so rapid crossings discard stale completions
          const transitionId = ++transitionIdRef.current;

          loadSpecificChunks(chunksToLoad)
            .then(() => {
              // Only unload if this is still the latest transition
              if (transitionIdRef.current !== transitionId) return;

              // Use CURRENT player position (not stale position from call time)
              const currentChunk = playerChunkRef.current;
              if (currentChunk) {
                unloadDistantChunks(currentChunk.x, currentChunk.z);
                evictLRUChunks();
              }
            })
            .catch(err => {
              console.warn('Chunk load error:', err);
              // Track failed chunks for retry
              for (const { x, z } of chunksToLoad) {
                const key = `chunk_${x}_${z}`;
                if (!loadedChunksRef.current.has(key)) {
                  failedChunksRef.current.set(key, { x, z, attempts: 1 });
                }
              }
              // Still unload on error to prevent unbounded memory growth
              if (transitionIdRef.current !== transitionId) return;
              const currentChunk = playerChunkRef.current;
              if (currentChunk) {
                unloadDistantChunks(currentChunk.x, currentChunk.z);
                evictLRUChunks();
              }
            });
        } else {
          // No new chunks needed (all already loaded), safe to unload immediately
          unloadDistantChunks(newChunkX, newChunkZ);
          evictLRUChunks();
        }
      } else {
        // No previous chunk - do full initial load (this one can block as it's startup)
        await loadChunksInRadius(newChunkX, newChunkZ, LOAD_RADIUS);
        // After initial load, clean up any stale chunks
        unloadDistantChunks(newChunkX, newChunkZ);
        evictLRUChunks();
      }
    }
  }, [worldId, loadChunksInRadius, loadSpecificChunks, getStripeChunks, unloadDistantChunks, evictLRUChunks, addPositionSample, enqueuePrefetch]);

  /**
   * Force initial load when world changes
   * Phase 3C: Uses progressive ring loading for smooth initial load
   * Phase 3D: Cleans up old cache entries periodically
   */
  const initializeForWorld = useCallback(async (startX: number, startZ: number) => {
    if (!worldId) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    initialLoadDone.current = false;

    // Clear previous world state
    const prevGridSize = worldCollisionGrid.size;
    clearPendingJobs();
    worldCollisionGrid.clear();
    loadedChunksRef.current.clear();
    // chunksInFlightRef no longer used for dedup (caused chunks to get stuck)
    clearAllHeightMaps();
    worldSigRef.current = { count: 0, xor: 0, sum: 0 };
    lastEmittedWorldKeyRef.current = '';

    const startChunkX = Math.floor(startX / CHUNK_SIZE);
    const startChunkZ = Math.floor(startZ / CHUNK_SIZE);
    playerChunkRef.current = { x: startChunkX, z: startChunkZ };

    initLogStep('useChunkLoader.ts', `Chunk loader ready (cleared ${prevGridSize} colliders, player at chunk ${startChunkX},${startChunkZ})`);

    // Phase 3D: Clean up old cache entries (fire and forget)
    blockDB.clearOldCachedChunks(CACHE_MAX_AGE_MS).catch(() => {});

    // Phase 3C: Use parallel loading for faster initial load
    // Load ring 1 (center) first for immediate visual feedback, then all remaining in a single batch
    const totalChunks = (2 * LOAD_RADIUS + 1) ** 2;

    // Build all chunk coordinates and required keys upfront
    // Rings are 1-based: ring 1 = center, ring N = distance N-1 from center
    const requiredChunkKeys = new Set<string>();
    const allChunksToLoad: Array<{ x: number; z: number }> = [];
    for (let ring = 1; ring <= LOAD_RADIUS + 1; ring++) {
      const ringChunks = getRingChunks(startChunkX, startChunkZ, ring);
      for (const { x, z } of ringChunks) {
        requiredChunkKeys.add(`chunk_${x}_${z}`);
        allChunksToLoad.push({ x, z });
      }
    }

    // Load ring 1 (center chunk) first for immediate visual feedback
    const ring1Chunks = getRingChunks(startChunkX, startChunkZ, 1);
    const ring1StepId = initLogStartStep('useChunkLoader.ts', `Loading ${totalChunks} chunks: ring 1 first...`);
    await loadSpecificChunks(ring1Chunks);
    if (ring1StepId) initLogFinishStep(ring1StepId, ring1Chunks.length);

    // Yield to let React render the closest blocks
    // Use setTimeout fallback (16ms ≈ 1 frame) since RAF is throttled when tab is hidden
    await new Promise(resolve => {
      const timeoutId = setTimeout(resolve, 16);
      requestAnimationFrame(() => {
        clearTimeout(timeoutId);
        resolve(undefined);
      });
    });

    // Load all remaining chunks in a SINGLE batch (parallel) instead of ring-by-ring
    const ring1Keys = new Set(ring1Chunks.map(c => `${c.x},${c.z}`));
    const remainingChunks = allChunksToLoad.filter(c => !ring1Keys.has(`${c.x},${c.z}`));

    if (remainingChunks.length > 0) {
      const remainingStepId = initLogStartStep('useChunkLoader.ts', `Loading remaining ${remainingChunks.length} chunks...`);
      await loadSpecificChunks(remainingChunks);
      if (remainingStepId) initLogFinishStep(remainingStepId, remainingChunks.length);
    }

    // PHASE 2: Init barrier - check for failed required chunks and retry before completing
    const getFailedRequiredChunks = () => {
      const failed: Array<{ x: number; z: number }> = [];
      for (const key of requiredChunkKeys) {
        // Check if chunk is loaded
        if (!loadedChunksRef.current.has(key)) {
          // Either in failed set or never loaded
          const failedInfo = failedChunksRef.current.get(key);
          if (failedInfo) {
            failed.push({ x: failedInfo.x, z: failedInfo.z });
          } else {
            // Parse chunk key to get coords
            const match = key.match(/^chunk_(-?\d+)_(-?\d+)$/);
            if (match) {
              failed.push({ x: parseInt(match[1], 10), z: parseInt(match[2], 10) });
            }
          }
        }
      }
      return failed;
    };

    let failedRequired = getFailedRequiredChunks();
    let retryAttempt = 0;
    const MAX_INIT_RETRIES = 3;

    while (failedRequired.length > 0 && retryAttempt < MAX_INIT_RETRIES) {
      retryAttempt++;
      initLogStep('useChunkLoader.ts', `Init barrier: retrying ${failedRequired.length} failed required chunks (attempt ${retryAttempt}/${MAX_INIT_RETRIES})`);

      // Clear from failed set before retry
      for (const { x, z } of failedRequired) {
        failedChunksRef.current.delete(`chunk_${x}_${z}`);
      }

      await loadSpecificChunks(failedRequired);

      // Check again
      failedRequired = getFailedRequiredChunks();
    }

    if (failedRequired.length > 0) {
      console.error(`[ChunkLoader] INIT WARNING: ${failedRequired.length} required chunks could not be loaded after ${MAX_INIT_RETRIES} retries`);
      initLogStep('useChunkLoader.ts', `WARNING: ${failedRequired.length} chunks still failed after retries`);
    }

    // Count total blocks loaded
    let totalBlocks = 0;
    const blockTypeCounts = new Map<string, number>();
    for (const chunkData of loadedChunksRef.current.values()) {
      totalBlocks += chunkData.blocks.length;
      for (const block of chunkData.blocks) {
        const type = block.block_type || 'unknown';
        blockTypeCounts.set(type, (blockTypeCounts.get(type) || 0) + 1);
      }
    }

    // Summarize blocks loaded with top types
    const sortedTypes = Array.from(blockTypeCounts.entries()).sort((a, b) => b[1] - a[1]);
    const topTypes = sortedTypes.slice(0, 3).map(([t, c]) => `${t}:${c}`).join(', ');
    initLogStep('useChunkLoader.ts', `Loaded ${totalBlocks} blocks (${blockTypeCounts.size} types: ${topTypes}...)`, worldCollisionGrid.size);
    
    initialLoadDone.current = true;
    setIsLoading(false);
  }, [worldId, getRingChunks, loadSpecificChunks]);

  /**
   * Clear all chunks (on world change)
   * Phase 3E: Also resets prefetch state
   * FIXED: Now properly removes all block colliders before clearing
   * B3: Also clears pending budgeted work jobs
   */
  const clearAllChunks = useCallback(() => {
    // B3: Cancel any pending collider removal jobs before clearing
    clearPendingJobs();

    // CRITICAL FIX: Clear the ENTIRE collision grid, not just tracked chunks.
    // Pending collider removal jobs may have orphaned colliders that aren't in loadedChunksRef.
    // This prevents the grid from accumulating 400K+ orphan colliders over time.
    worldCollisionGrid.clear();

    loadedChunksRef.current.clear();
    clearAllHeightMaps();
    playerChunkRef.current = null;
    initialLoadDone.current = false;
    emitScheduledRef.current = false; // Cancel any pending emit

    // B4: Reset world signature when clearing all chunks
    worldSigRef.current = { count: 0, xor: 0, sum: 0 };
    lastEmittedWorldKeyRef.current = '';

    // Clear failed chunks tracker
    failedChunksRef.current.clear();

    // Phase 3E: Reset prefetch state
    resetPrefetchState();

    // Emit empty blocks to clear the UI
    onBlocksChanged([]);
  }, [resetPrefetchState, onBlocksChanged]);

  // World change handling is now done via initializeForWorld which clears chunks internally
  // Removed separate effect to prevent race conditions with initialization

  // Periodic integrity check — ensures NO chunks within player radius are missing
  // Catches: failed chunks, chunks never attempted, chunks dropped due to race conditions
  useEffect(() => {
    if (!worldId) return;

    const intervalId = setInterval(() => {
      // Don't run integrity check until initial load is complete
      if (!initialLoadDone.current) return;

      const playerChunk = playerChunkRef.current;
      if (!playerChunk) return;

      // Use ref to get current LOAD_RADIUS (avoids stale closure)
      const radius = loadRadiusRef.current;

      // Collect ALL chunks that should be loaded but aren't
      const toLoad: Array<{ x: number; z: number }> = [];
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dz = -radius; dz <= radius; dz++) {
          const cx = playerChunk.x + dx;
          const cz = playerChunk.z + dz;
          const key = `chunk_${cx}_${cz}`;
          if (!loadedChunksRef.current.has(key)) {
            toLoad.push({ x: cx, z: cz });
          }
        }
      }

      // Also collect failed chunks (which may be outside current radius)
      const failed = failedChunksRef.current;
      for (const [key, info] of failed) {
        if (loadedChunksRef.current.has(key)) {
          failed.delete(key);
          continue;
        }
        // Only retry failed chunks if within range
        const dist = Math.max(Math.abs(info.x - playerChunk.x), Math.abs(info.z - playerChunk.z));
        if (dist <= radius) {
          const alreadyQueued = toLoad.some(c => c.x === info.x && c.z === info.z);
          if (!alreadyQueued) {
            toLoad.push({ x: info.x, z: info.z });
          }
        }
      }

      if (toLoad.length > 0) {
        console.log(`[ChunkLoader] Integrity check: loading ${toLoad.length} missing chunks within radius`);
        // Clear from failed set — loadSpecificChunks will re-add if they fail again
        for (const { x, z } of toLoad) {
          failed.delete(`chunk_${x}_${z}`);
        }
        loadSpecificChunks(toLoad).catch(err => {
          console.warn('[ChunkLoader] Integrity check load error:', err);
          // Re-add chunks that weren't loaded so they can be retried next cycle
          for (const { x, z } of toLoad) {
            const key = `chunk_${x}_${z}`;
            if (!loadedChunksRef.current.has(key) && !failedChunksRef.current.has(key)) {
              failedChunksRef.current.set(key, { x, z, attempts: MAX_RETRY_ATTEMPTS });
            }
          }
        });
      }
    }, FAILED_CHUNK_RETRY_INTERVAL);

    return () => clearInterval(intervalId);
  // Note: LOAD_RADIUS not in deps - it's read fresh on each interval tick
  }, [worldId, loadSpecificChunks]);

  // If the collision grid is cleared (debug key, hot reload, etc.), reinsert colliders
  // for all currently loaded blocks so collisions don't "turn off".
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const onGridCleared = () => {
      // Grid (incl. its voxel field) was wiped — re-add the voxel for every
      // loaded block. Use the surface set (same as the load path) so a clear
      // doesn't re-bloat collision with buried interior blocks.
      for (const chunkData of loadedChunksRef.current.values()) {
        const blocks = chunkData.visibleBlocks?.length
          ? chunkData.visibleBlocks
          : chunkData.blocks;
        for (const block of blocks) {
          ensureBlockCollider(block);
        }
      }
    };

    window.addEventListener('collisionGridCleared', onGridCleared);
    return () => window.removeEventListener('collisionGridCleared', onGridCleared);
  }, []);

  /**
   * Get the set of currently loaded chunk keys
   */
  const getLoadedChunkKeys = useCallback((): Set<string> => {
    return new Set(loadedChunksRef.current.keys());
  }, []);

  /**
   * Check if a specific chunk is loaded
   */
  const isChunkLoaded = useCallback((chunkX: number, chunkZ: number): boolean => {
    const chunkKey = `chunk_${chunkX}_${chunkZ}`;
    return loadedChunksRef.current.has(chunkKey);
  }, []);

  /**
   * BULK: Remove all blocks at specified positions with a SINGLE React re-render.
   * Used by tree chopping for instant tree disappearance.
   * 
   * PERFORMANCE: Uses scheduleEmit for batched RAF callback instead of
   * individual removes.
   * 
   * @param positions Array of {x, y, z} positions to remove
   * @returns Number of blocks removed
   */
  const removeBlocksByPositions = useCallback((positions: Array<{ x: number; y: number; z: number }>): number => {
    if (positions.length === 0) return 0;

    // Create a Set for O(1) lookups
    const positionSet = new Set<string>();
    for (const pos of positions) {
      positionSet.add(`${pos.x},${pos.y},${pos.z}`);
    }

    let removedCount = 0;

    // Iterate through all loaded chunks and filter out matching blocks
    for (const [chunkKey, chunkData] of loadedChunksRef.current.entries()) {
      const originalLength = chunkData.blocks.length;
      // B4: Save old signature before modification
      const oldSig = chunkData.signature;

      // Filter blocks, removing colliders for deleted blocks
      chunkData.blocks = chunkData.blocks.filter(block => {
        const posKey = `${block.position_x},${block.position_y},${block.position_z}`;
        if (positionSet.has(posKey)) {
          // Remove collider immediately
          removeBlockCollider(block);
          removedCount++;
          return false; // Remove from array
        }
        return true; // Keep in array
      });

      // Update lastAccessedAt and signature if blocks were removed
      if (chunkData.blocks.length !== originalLength) {
        chunkData.lastAccessedAt = Date.now();
        // B4: Update signature and world signature
        const newSig = computeChunkSignature(chunkData.blocks);
        chunkData.signature = newSig;
        applyChunkSigChange(oldSig, newSig);
        chunkData.visibleBlocks = undefined;
      }
    }

    // Single re-render at the end
    if (removedCount > 0) {
      scheduleEmit();
    }

    return removedCount;
  }, [scheduleEmit, applyChunkSigChange]);

  /**
   * Refresh all currently loaded chunks - used after missing tree blocks are restored
   * This refetches all loaded chunks from the server to pick up any blocks
   * that were inserted by the sync_all_missing_tree_blocks RPC.
   */
  const refreshLoadedChunks = useCallback(async (): Promise<void> => {
    if (!worldId) return;

    const chunkKeys = Array.from(loadedChunksRef.current.keys());
    for (const chunkKey of chunkKeys) {
      const match = chunkKey.match(/^chunk_(-?\d+)_(-?\d+)$/);
      if (!match) continue;

      const chunkX = parseInt(match[1], 10);
      const chunkZ = parseInt(match[2], 10);
      await refetchSingleChunk(chunkX, chunkZ);
    }
  }, [worldId, refetchSingleChunk]);

  // Return stable object using useMemo to prevent dependency cascades
  return useMemo(() => ({
    isLoading,
    updatePlayerPosition,
    initializeForWorld,
    refetchSingleChunk,
    refreshLoadedChunks, // For restoring missing tree blocks
    clearAllChunks,
    getLoadedChunkKeys,
    isChunkLoaded,
    loadedChunksRef,
    // New methods for optimistic updates
    addBlockOptimistically,
    addBlocksBatch, // BATCH: For tree growth - single re-render for N blocks
    replaceBlockByPosition,
    removeBlockById,
    removeBlocksByPositions, // BULK: For tree chopping - single re-render for N removes
    // Phase 2: Expose revision bump for external use (e.g., expired block cleanup)
    bumpWorldRevision: () => {
      worldRevisionRef.current++;
      if (onRevisionChanged) onRevisionChanged(worldRevisionRef.current);
    },
    LOAD_RADIUS,
    UNLOAD_RADIUS
  }), [
    isLoading,
    updatePlayerPosition,
    initializeForWorld,
    refetchSingleChunk,
    refreshLoadedChunks,
    clearAllChunks,
    getLoadedChunkKeys,
    isChunkLoaded,
    addBlockOptimistically,
    addBlocksBatch,
    replaceBlockByPosition,
    removeBlockById,
    removeBlocksByPositions
  ]);
}
