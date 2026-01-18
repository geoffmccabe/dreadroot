import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { PlacedBlock } from '@/types/blocks';
import { getChunkKey, CHUNK_SIZE } from '@/lib/chunkManager';
import { blockDB, CachedChunk } from '@/hooks/useIndexedDB';
import { collisionGrid } from '@/lib/spatialHashGrid';
import * as THREE from 'three';

// Configuration for chunk loading
const LOAD_RADIUS = 4;    // Chunks to load around player (9x9 = 81 chunks max)
const UNLOAD_RADIUS = 6;  // Hysteresis: don't unload until this far away
const POSITION_UPDATE_THROTTLE = 200; // ms between position updates

// Phase 3A: Eviction configuration
// MAX must be >= (2*UNLOAD_RADIUS+1)^2 = 169, plus buffer
const MAX_LOADED_CHUNKS = 220;
const EVICTION_BATCH_SIZE = 10;

// Phase 3D: Cache configuration
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

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

interface ChunkData {
  blocks: PlacedBlock[];
  loadedAt: number;
  // Phase 3A: Track for LRU and pinning
  lastAccessedAt: number;
  hasOptimisticBlocks: boolean;
}

interface UseChunkLoaderProps {
  worldId: string | null;
  onBlocksChanged: (blocks: PlacedBlock[]) => void;
}

/**
 * CANONICAL collider cache keyed by block.id.
 * This prevents collider duplication when blocks are refetched/replaced,
 * which was causing the collisionGrid to inflate with stale colliders.
 */
const colliderByBlockId = new Map<string, THREE.Box3>();

// CRITICAL: Clear the collider cache when the collision grid is cleared.
// This MUST be a module-level listener so it runs synchronously before any
// chunk loading attempts to reuse stale collider references.
if (typeof window !== 'undefined') {
  window.addEventListener('collisionGridCleared', () => {
    console.log('[ChunkLoader] Module-level: Clearing colliderByBlockId cache');
    colliderByBlockId.clear();
  });
}

/**
 * Update collider bounds to match block position
 */
const updateBlockColliderBounds = (block: PlacedBlock, collider: THREE.Box3): void => {
  collider.min.set(block.position_x, block.position_y, block.position_z);
  collider.max.set(block.position_x + 1, block.position_y + 1, block.position_z + 1);
};

/**
 * Create a collider for a block and insert it into the collision grid.
 * Uses canonical cache to prevent collider duplication/leaks.
 * 
 * CRITICAL FIX: Previously, when blocks were refetched and the object identity
 * changed, a new Box3 was created, but the old one stayed in collisionGrid
 * (orphaned). This caused e5 to spike even with few blocks.
 */
const ensureBlockCollider = (block: PlacedBlock): void => {
  const existing = (block as any).__collider as THREE.Box3 | null | undefined;
  let collider = colliderByBlockId.get(block.id);

  if (!collider) {
    // No cached collider for this block ID
    if (existing) {
      // Adopt the block's existing collider into the cache
      collider = existing;
      colliderByBlockId.set(block.id, collider);
    } else {
      // Create a new collider
      collider = new THREE.Box3();
      colliderByBlockId.set(block.id, collider);
    }
  } else if (existing && existing !== collider) {
    // Block has a different collider than cached - remove the orphan
    collisionGrid.remove(existing);
  }

  // Update bounds (in case position changed, though blocks don't move)
  updateBlockColliderBounds(block, collider);

  // Ensure collider is in the grid (may have been cleared by hot reload/world switch)
  if (!collisionGrid.has(collider)) {
    collisionGrid.insert(collider);
  }

  (block as any).__collider = collider;
};

/**
 * Remove a block's collider from the collision grid and cache.
 */
const removeBlockCollider = (block: PlacedBlock): void => {
  const cached = colliderByBlockId.get(block.id);
  const collider = cached ?? ((block as any).__collider as THREE.Box3 | null | undefined);

  if (collider) {
    collisionGrid.remove(collider);
  }

  colliderByBlockId.delete(block.id);
  (block as any).__collider = null;
};

/**
 * Check if two block arrays are equivalent (same blocks at same positions with same properties)
 * Used to skip unnecessary re-renders when refetch returns identical data
 */
const blocksAreEquivalent = (a: PlacedBlock[], b: PlacedBlock[]): boolean => {
  if (a.length !== b.length) return false;
  if (a.length === 0) return true;
  
  // Create position-keyed map for O(1) lookup
  const mapA = new Map<string, PlacedBlock>();
  for (const block of a) {
    const key = `${block.position_x},${block.position_y},${block.position_z}`;
    mapA.set(key, block);
  }
  
  for (const blockB of b) {
    const key = `${blockB.position_x},${blockB.position_y},${blockB.position_z}`;
    const blockA = mapA.get(key);
    if (!blockA) return false;
    
    // Compare visual properties that affect rendering
    if (blockA.block_type !== blockB.block_type) return false;
    if (blockA.texture_url !== blockB.texture_url) return false;
  }
  
  return true;
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
export function useChunkLoader({ worldId, onBlocksChanged }: UseChunkLoaderProps) {
  // Loaded chunks: Map<chunkKey, ChunkData>
  const loadedChunksRef = useRef<Map<string, ChunkData>>(new Map());
  
  // Current player chunk position
  const playerChunkRef = useRef<{ x: number; z: number } | null>(null);
  
  // Throttle position updates
  const lastPositionUpdateRef = useRef(0);
  
  // Track if initial load has happened
  const [isLoading, setIsLoading] = useState(true);
  const initialLoadDone = useRef(false);
  
  // Track current world to clear on change
  const currentWorldRef = useRef<string | null>(null);

  // Phase 3.0: Single emit per frame batching
  const emitScheduledRef = useRef(false);

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
   * Phase 3.0: Schedule a single emission per animation frame
   * This prevents multiple React updates from rapid chunk operations
   */
  const scheduleEmit = useCallback(() => {
    if (emitScheduledRef.current) return;
    emitScheduledRef.current = true;

    requestAnimationFrame(() => {
      emitScheduledRef.current = false;
      const allBlocks: PlacedBlock[] = [];
      for (const chunkData of loadedChunksRef.current.values()) {
        allBlocks.push(...chunkData.blocks);
      }
      onBlocksChanged(allBlocks);
    });
  }, [onBlocksChanged]);

  /**
   * Flatten all loaded chunks into a single blocks array
   * NOTE: This is still used for synchronous operations like optimistic updates
   */
  const flattenLoadedBlocks = useCallback((): PlacedBlock[] => {
    const allBlocks: PlacedBlock[] = [];
    for (const chunkData of loadedChunksRef.current.values()) {
      allBlocks.push(...chunkData.blocks);
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
        // Remove colliders for all blocks in this chunk before deleting
        const chunkData = loadedChunksRef.current.get(key);
        if (chunkData) {
          for (const block of chunkData.blocks) {
            removeBlockCollider(block);
          }
        }
        loadedChunksRef.current.delete(key);
      }
      // Use batched emit
      scheduleEmit();
    }
  }, [isChunkPinned, scheduleEmit]);

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
        // Create collider for new block
        ensureBlockCollider(block);
        chunkData.blocks.push(block);
        // Phase 3A: Mark as having optimistic blocks (temp-*)
        if (block.id.startsWith('temp-')) {
          chunkData.hasOptimisticBlocks = true;
        }
        chunkData.lastAccessedAt = now;
        // INSTANT: Synchronous callback - no batching, no delays
        onBlocksChanged(flattenLoadedBlocks());
      }
    } else {
      // Chunk not loaded - create it with just this block for immediate visibility
      // Create collider for new block
      ensureBlockCollider(block);
      loadedChunksRef.current.set(chunkKey, {
        blocks: [block],
        loadedAt: now,
        lastAccessedAt: now,
        hasOptimisticBlocks: block.id.startsWith('temp-')
      });
      onBlocksChanged(flattenLoadedBlocks());
    }
  }, [onBlocksChanged, flattenLoadedBlocks]);

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
        
        // Transfer the collider reference from old block to new block
        // The collider is already in the grid, we just need to maintain the reference
        const oldCollider = (oldBlock as any).__collider as THREE.Box3 | undefined;
        if (oldCollider) {
          (preservedBlock as any).__collider = oldCollider;
          
          // CRITICAL FIX: Re-key the collider cache when block ID changes (temp -> real)
          // This prevents orphan colliders when temp-* IDs are replaced with server IDs
          if (oldBlock.id !== preservedBlock.id) {
            const cached = colliderByBlockId.get(oldBlock.id);
            if (cached === oldCollider) {
              colliderByBlockId.delete(oldBlock.id);
            }
            colliderByBlockId.set(preservedBlock.id, oldCollider);
          }
          
          // Clear old block's reference to prevent double-removal
          (oldBlock as any).__collider = null;
        }
        
        chunkData.blocks[index] = preservedBlock;
        chunkData.lastAccessedAt = Date.now();
        
        // Phase 3A: Recompute hasOptimisticBlocks after replacement
        chunkData.hasOptimisticBlocks = chunkData.blocks.some(b => b.id.startsWith('temp-'));
        
        // Only trigger React re-render if visual properties changed
        if (visualChanged) {
          onBlocksChanged(flattenLoadedBlocks());
        }
      }
    }
  }, [onBlocksChanged, flattenLoadedBlocks]);

  /**
   * Remove a block by ID from the chunk loader
   * Phase 3A: Update hasOptimisticBlocks when blocks are removed
   */
  const removeBlockById = useCallback((blockId: string): void => {
    for (const chunkData of loadedChunksRef.current.values()) {
      const index = chunkData.blocks.findIndex(b => b.id === blockId);
      if (index >= 0) {
        // Remove collider before removing block
        const block = chunkData.blocks[index];
        removeBlockCollider(block);
        
        chunkData.blocks.splice(index, 1);
        chunkData.lastAccessedAt = Date.now();
        
        // Phase 3A: Recompute hasOptimisticBlocks after removal
        chunkData.hasOptimisticBlocks = chunkData.blocks.some(b => b.id.startsWith('temp-'));
        
        onBlocksChanged(flattenLoadedBlocks());
        return;
      }
    }
  }, [onBlocksChanged, flattenLoadedBlocks]);

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

    // Single bounding query for all chunks in radius
    const { data: blocks, error } = await supabase
      .from('placed_blocks')
      .select('*')
      .eq('world_id', worldId)
      .gte('chunk_x', minChunkX)
      .lte('chunk_x', maxChunkX)
      .gte('chunk_z', minChunkZ)
      .lte('chunk_z', maxChunkZ);

    if (error) {
      console.error('Error loading chunks:', error);
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

    // Generate all chunk keys that should be loaded
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        const chunkX = centerChunkX + dx;
        const chunkZ = centerChunkZ + dz;
        const chunkKey = `chunk_${chunkX}_${chunkZ}`;
        
        const chunkBlocks = chunkGroups.get(chunkKey) || [];
        
        // Create colliders for all blocks in this chunk
        for (const block of chunkBlocks) {
          ensureBlockCollider(block);
        }
        
        // Store chunk data (even if empty - means we loaded it)
        // Phase 3A: Initialize with lastAccessedAt and hasOptimisticBlocks
        loadedChunksRef.current.set(chunkKey, {
          blocks: chunkBlocks,
          loadedAt,
          lastAccessedAt: loadedAt,
          hasOptimisticBlocks: chunkBlocks.some(b => b.id.startsWith('temp-'))
        });
      }
    }

    // Phase 3.0: Use batched emit instead of synchronous callback
    scheduleEmit();
  }, [worldId, scheduleEmit]);

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

    // Filter out already loaded chunks
    const toLoad = chunkCoords.filter(
      ({ x, z }) => !loadedChunksRef.current.has(`chunk_${x}_${z}`)
    );
    
    if (toLoad.length === 0) return;

    const loadedAt = Date.now();
    const now = new Date();

    // Phase 3D: Try to get chunks from cache
    let cachedChunks: Map<string, CachedChunk> = new Map();
    const USE_CHUNK_CACHE = true; // Re-enabled with fix
    if (USE_CHUNK_CACHE) {
      try {
        cachedChunks = await blockDB.getCachedChunksBatch(worldId, toLoad);
      } catch (err) {
        console.warn('Cache read failed, fetching from server:', err);
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

    // Fetch server versions for cached chunks to check staleness
    const chunksToFetchFromServer: Array<{ x: number; z: number }> = [...chunksWithoutCache];
    const chunksFromCache: Array<{ x: number; z: number; blocks: PlacedBlock[] }> = [];

    if (chunksWithCache.length > 0) {
      const serverVersions = await fetchChunkVersions(chunksWithCache.map(c => ({ x: c.x, z: c.z })));

      for (const { x, z, cached } of chunksWithCache) {
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
          chunksFromCache.push({ x, z, blocks: activeBlocks });
        } else {
          // Cache is stale - need to fetch from server
          chunksToFetchFromServer.push({ x, z });
        }
      }
    }

    // Load chunks from cache into memory (NO emit yet - wait for server data)
    for (const { x, z, blocks } of chunksFromCache) {
      const chunkKey = `chunk_${x}_${z}`;
      // Create colliders for all blocks from cache
      for (const block of blocks) {
        ensureBlockCollider(block);
      }
      loadedChunksRef.current.set(chunkKey, {
        blocks,
        loadedAt,
        lastAccessedAt: loadedAt,
        hasOptimisticBlocks: blocks.some(b => b.id.startsWith('temp-'))
      });
    }

    // Fetch remaining chunks from server
    if (chunksToFetchFromServer.length > 0) {
      const minChunkX = Math.min(...chunksToFetchFromServer.map(c => c.x));
      const maxChunkX = Math.max(...chunksToFetchFromServer.map(c => c.x));
      const minChunkZ = Math.min(...chunksToFetchFromServer.map(c => c.z));
      const maxChunkZ = Math.max(...chunksToFetchFromServer.map(c => c.z));

      const wantedChunkKeys = new Set(chunksToFetchFromServer.map(c => `chunk_${c.x}_${c.z}`));

      const { data: blocks, error } = await supabase
        .from('placed_blocks')
        .select('*')
        .eq('world_id', worldId)
        .gte('chunk_x', minChunkX)
        .lte('chunk_x', maxChunkX)
        .gte('chunk_z', minChunkZ)
        .lte('chunk_z', maxChunkZ);

      if (error) {
        console.error('Error loading chunks from server:', error);
        // Still emit what we have from cache
        if (chunksFromCache.length > 0) {
          scheduleEmit();
        }
        return;
      }

      // Get current versions for caching
      const currentVersions = await fetchChunkVersions(chunksToFetchFromServer);

      // Filter expired and group by chunk
      const activeBlocks = (blocks || []).filter(block => 
        !block.expires_at || new Date(block.expires_at) > now
      );

      const chunkGroups = new Map<string, PlacedBlock[]>();
      for (const block of activeBlocks) {
        const chunkKey = getChunkKey(block.position_x, block.position_z);
        if (!wantedChunkKeys.has(chunkKey)) continue;
        
        const existing = chunkGroups.get(chunkKey) || [];
        existing.push(block);
        chunkGroups.set(chunkKey, existing);
      }

      // Store chunks and prepare cache entries
      const chunksToCache: CachedChunk[] = [];

      for (const { x, z } of chunksToFetchFromServer) {
        const chunkKey = `chunk_${x}_${z}`;
        const chunkBlocks = chunkGroups.get(chunkKey) || [];
        
        // Create colliders for all blocks from server
        for (const block of chunkBlocks) {
          ensureBlockCollider(block);
        }
        
        loadedChunksRef.current.set(chunkKey, {
          blocks: chunkBlocks,
          loadedAt,
          lastAccessedAt: loadedAt,
          hasOptimisticBlocks: chunkBlocks.some(b => b.id.startsWith('temp-'))
        });

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
      }

      // Batch save to cache (fire and forget)
      if (chunksToCache.length > 0) {
        blockDB.saveCachedChunksBatch(chunksToCache).catch(err => {
          console.warn('Failed to cache chunks:', err);
        });
      }
    }

    // FIX: Single consolidated emit after ALL data (cache + server) is loaded
    scheduleEmit();
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
   * Ring 0 = center chunk only
   * Ring 1 = 8 chunks surrounding center (3x3 minus center)
   * Ring N = chunks at distance N from center
   */
  const getRingChunks = useCallback((
    centerX: number,
    centerZ: number,
    ring: number
  ): Array<{ x: number; z: number }> => {
    const chunks: Array<{ x: number; z: number }> = [];
    
    if (ring === 0) {
      // Center chunk only
      chunks.push({ x: centerX, z: centerZ });
    } else {
      // Ring N: all chunks at Chebyshev distance exactly N
      for (let dx = -ring; dx <= ring; dx++) {
        for (let dz = -ring; dz <= ring; dz++) {
          // Only include if on the edge (max distance equals ring)
          if (Math.max(Math.abs(dx), Math.abs(dz)) === ring) {
            chunks.push({ x: centerX + dx, z: centerZ + dz });
          }
        }
      }
    }
    
    return chunks;
  }, []);

  /**
   * Phase 3C: Load chunks progressively in rings (near-first)
   * Loads ring 0 first for fast initial display, then remaining rings
   */
  const loadProgressiveRings = useCallback(async (
    centerX: number,
    centerZ: number,
    maxRadius: number
  ): Promise<void> => {
    if (!worldId) return;

    // Load ring 0 first (immediate center chunk) for quick initial display
    const ring0Chunks = getRingChunks(centerX, centerZ, 0);
    await loadSpecificChunks(ring0Chunks);

    // Then load remaining rings
    for (let ring = 1; ring <= maxRadius; ring++) {
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

    const { data: serverBlocks, error } = await supabase
      .from('placed_blocks')
      .select('*')
      .eq('world_id', worldId)
      .eq('chunk_x', chunkX)
      .eq('chunk_z', chunkZ);

    if (error) {
      console.error('Error refetching chunk:', error);
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

    // Check if blocks actually changed before updating state
    // This prevents unnecessary re-renders (tree flashing during growth)
    const existingBlocks = existingChunkData.blocks;
    const blocksChanged = !blocksAreEquivalent(existingBlocks, mergedBlocks);

    if (!blocksChanged) {
      // Data is identical - just update timestamp, skip state change and emit
      existingChunkData.lastAccessedAt = loadedAt;
      return; // Early exit - no visual change needed
    }

    // FIX: Remove colliders for blocks that no longer exist (ghost collider cleanup)
    // This prevents invisible collision barriers from deleted blocks (e.g., chopped trees)
    const mergedBlockIds = new Set(mergedBlocks.map(b => b.id));
    for (const oldBlock of existingBlocks) {
      if (!mergedBlockIds.has(oldBlock.id)) {
        removeBlockCollider(oldBlock);
      }
    }

    // Ensure colliders exist for all current blocks
    for (const block of mergedBlocks) {
      ensureBlockCollider(block);
    }

    // Update chunk data with Phase 3A fields (only if blocks changed)
    loadedChunksRef.current.set(chunkKey, {
      blocks: mergedBlocks,
      loadedAt,
      lastAccessedAt: loadedAt,
      hasOptimisticBlocks: optimisticBlocks.length > 0
    });

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
   */
  const unloadDistantChunks = useCallback((centerChunkX: number, centerChunkZ: number) => {
    const chunksToUnload: string[] = [];
    
    for (const chunkKey of loadedChunksRef.current.keys()) {
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
        const chunkData = loadedChunksRef.current.get(chunkKey);
        if (chunkData?.hasOptimisticBlocks) {
          continue; // Skip - has pending optimistic blocks
        }
        chunksToUnload.push(chunkKey);
      }
    }

    if (chunksToUnload.length > 0) {
      for (const key of chunksToUnload) {
        // Remove colliders for all blocks in this chunk before deleting
        const chunkData = loadedChunksRef.current.get(key);
        if (chunkData) {
          for (const block of chunkData.blocks) {
            removeBlockCollider(block);
          }
        }
        loadedChunksRef.current.delete(key);
      }
      // Phase 3.0: Use batched emit
      scheduleEmit();
    }
  }, [scheduleEmit]);

  /**
   * Update player position - called by game controller
   * Phase 3B: Uses incremental stripe loading instead of full square reload
   * Phase 3A: Updates lastAccessedAt for pinned chunks and runs LRU eviction
   * Phase 3E: Runs velocity sampling + prefetch on EVERY throttled call
   */
  const updatePlayerPosition = useCallback(async (worldX: number, worldZ: number) => {
    if (!worldId) return;

    const now = Date.now();
    if (now - lastPositionUpdateRef.current < POSITION_UPDATE_THROTTLE) {
      return;
    }
    lastPositionUpdateRef.current = now;

    // Phase 3E: ALWAYS sample position for velocity calculation (even within same chunk)
    addPositionSample(worldX, worldZ, now);

    // Phase 3E: ALWAYS try to enqueue prefetch (runs even when still in same chunk)
    enqueuePrefetch(worldX, worldZ, now);

    const newChunkX = Math.floor(worldX / CHUNK_SIZE);
    const newChunkZ = Math.floor(worldZ / CHUNK_SIZE);

    const prevChunk = playerChunkRef.current;

    // Check if player moved to a different chunk
    if (!prevChunk || prevChunk.x !== newChunkX || prevChunk.z !== newChunkZ) {
      const hadPrevChunk = prevChunk !== null;
      const oldChunkX = prevChunk?.x ?? newChunkX;
      const oldChunkZ = prevChunk?.z ?? newChunkZ;
      
      playerChunkRef.current = { x: newChunkX, z: newChunkZ };

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

      // Phase 3B: Use incremental stripe loading for movement
      // FIX: Fire-and-forget to avoid blocking the render loop during movement
      if (hadPrevChunk) {
        // Calculate stripe chunks for the movement direction
        const stripeChunks = getStripeChunks(
          oldChunkX, oldChunkZ,
          newChunkX, newChunkZ,
          LOAD_RADIUS
        );
        
        if (stripeChunks.length > 0) {
          // Don't await - let chunks load asynchronously without blocking frames
          loadSpecificChunks(stripeChunks).catch(err => {
            console.warn('Stripe chunk load error:', err);
          });
        }
      } else {
        // No previous chunk - do full initial load (this one can block as it's startup)
        await loadChunksInRadius(newChunkX, newChunkZ, LOAD_RADIUS);
      }

      // Unload distant chunks
      unloadDistantChunks(newChunkX, newChunkZ);
      
      // Phase 3A: Run LRU eviction as safety cap
      evictLRUChunks();
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
    
    console.log(`[ChunkLoader] initializeForWorld called, grid size before clear: ${collisionGrid.size}`);
    
    // CRITICAL: Remove all block colliders before clearing chunks
    for (const [, chunkData] of loadedChunksRef.current) {
      for (const block of chunkData.blocks) {
        removeBlockCollider(block);
      }
    }
    loadedChunksRef.current.clear();
    
    console.log(`[ChunkLoader] Grid size after clear: ${collisionGrid.size}`);
    
    const startChunkX = Math.floor(startX / CHUNK_SIZE);
    const startChunkZ = Math.floor(startZ / CHUNK_SIZE);
    playerChunkRef.current = { x: startChunkX, z: startChunkZ };

    // Phase 3D: Clean up old cache entries (fire and forget)
    blockDB.clearOldCachedChunks(CACHE_MAX_AGE_MS).then(count => {
      if (count > 0) {
        console.log(`Phase 3D: Cleared ${count} old cached chunks`);
      }
    }).catch(err => {
      console.warn('Failed to clear old cache:', err);
    });

    // Phase 3C: Use progressive ring loading for smoother initial experience
    await loadProgressiveRings(startChunkX, startChunkZ, LOAD_RADIUS);
    
    console.log(`[ChunkLoader] initializeForWorld complete, grid size: ${collisionGrid.size}`);
    
    initialLoadDone.current = true;
    setIsLoading(false);
  }, [worldId, loadProgressiveRings]);

  /**
   * Clear all chunks (on world change)
   * Phase 3E: Also resets prefetch state
   * FIXED: Now properly removes all block colliders before clearing
   */
  const clearAllChunks = useCallback(() => {
    // CRITICAL: Remove all block colliders from the collision grid before clearing chunks
    for (const [, chunkData] of loadedChunksRef.current) {
      for (const block of chunkData.blocks) {
        removeBlockCollider(block);
      }
    }
    
    // CRITICAL FIX: Clear the canonical collider cache to prevent memory leaks
    // This ensures old colliders don't accumulate across world switches
    colliderByBlockId.clear();
    
    loadedChunksRef.current.clear();
    playerChunkRef.current = null;
    initialLoadDone.current = false;
    emitScheduledRef.current = false; // Cancel any pending emit
    
    // Phase 3E: Reset prefetch state
    resetPrefetchState();
    
    // Emit empty blocks to clear the UI
    onBlocksChanged([]);
  }, [resetPrefetchState, onBlocksChanged]);

  // World change handling is now done via initializeForWorld which clears chunks internally
  // Removed separate effect to prevent race conditions with initialization

  // If the collision grid is cleared (debug key, hot reload, etc.), reinsert colliders
  // for all currently loaded blocks so collisions don't "turn off".
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const onGridCleared = () => {
      console.log('[ChunkLoader] Grid cleared event received, reinserting colliders...');
      
      // CRITICAL: Clear the collider cache FIRST - old collider refs are now invalid
      // This prevents "collider.min.set is not a function" errors
      colliderByBlockId.clear();
      
      let reinsertedCount = 0;
      // Reinsert colliders for all loaded blocks (O(n) but only on rare clear events)
      for (const chunkData of loadedChunksRef.current.values()) {
        for (const block of chunkData.blocks) {
          ensureBlockCollider(block);
          reinsertedCount++;
        }
      }
      console.log(`[ChunkLoader] Reinserted ${reinsertedCount} block colliders`);
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

  // Return stable object using useMemo to prevent dependency cascades
  return useMemo(() => ({
    isLoading,
    updatePlayerPosition,
    initializeForWorld,
    refetchSingleChunk,
    clearAllChunks,
    getLoadedChunkKeys,
    isChunkLoaded,
    loadedChunksRef,
    // New methods for optimistic updates
    addBlockOptimistically,
    replaceBlockByPosition,
    removeBlockById,
    LOAD_RADIUS,
    UNLOAD_RADIUS
  }), [
    isLoading,
    updatePlayerPosition,
    initializeForWorld,
    refetchSingleChunk,
    clearAllChunks,
    getLoadedChunkKeys,
    isChunkLoaded,
    addBlockOptimistically,
    replaceBlockByPosition,
    removeBlockById
  ]);
}
