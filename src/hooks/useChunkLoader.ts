import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { PlacedBlock } from '@/types/blocks';
import { getChunkKey, CHUNK_SIZE } from '@/lib/chunkManager';
import { blockDB, CachedChunk } from '@/hooks/useIndexedDB';

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
        chunkData.blocks[index] = newBlock;
        chunkData.lastAccessedAt = Date.now();
        
        // Phase 3A: Recompute hasOptimisticBlocks after replacement
        chunkData.hasOptimisticBlocks = chunkData.blocks.some(b => b.id.startsWith('temp-'));
        
        onBlocksChanged(flattenLoadedBlocks());
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
   * This provides smooth initial loading with immediate visibility
   */
  const loadProgressiveRings = useCallback(async (
    centerX: number,
    centerZ: number,
    maxRadius: number
  ): Promise<void> => {
    if (!worldId) return;

    // Load ring 0 (center) first for immediate visibility
    const ring0 = getRingChunks(centerX, centerZ, 0);
    await loadSpecificChunks(ring0);

    // Load remaining rings progressively
    for (let ring = 1; ring <= maxRadius; ring++) {
      const ringChunks = getRingChunks(centerX, centerZ, ring);
      await loadSpecificChunks(ringChunks);
      
      // Small delay between rings to prevent frame drops (except for close rings)
      if (ring >= 2) {
        await new Promise(resolve => setTimeout(resolve, 16)); // ~1 frame
      }
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

    // Update chunk data with Phase 3A fields
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

    // Phase 3.0: Use batched emit instead of synchronous callback
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
   */
  const updatePlayerPosition = useCallback(async (worldX: number, worldZ: number) => {
    if (!worldId) return;

    const now = Date.now();
    if (now - lastPositionUpdateRef.current < POSITION_UPDATE_THROTTLE) {
      return;
    }
    lastPositionUpdateRef.current = now;

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
      if (hadPrevChunk) {
        // Calculate stripe chunks for the movement direction
        const stripeChunks = getStripeChunks(
          oldChunkX, oldChunkZ,
          newChunkX, newChunkZ,
          LOAD_RADIUS
        );
        
        if (stripeChunks.length > 0) {
          await loadSpecificChunks(stripeChunks);
        }
      } else {
        // No previous chunk - do full initial load
        await loadChunksInRadius(newChunkX, newChunkZ, LOAD_RADIUS);
      }

      // Unload distant chunks
      unloadDistantChunks(newChunkX, newChunkZ);
      
      // Phase 3A: Run LRU eviction as safety cap
      evictLRUChunks();
    }
  }, [worldId, loadChunksInRadius, loadSpecificChunks, getStripeChunks, unloadDistantChunks, evictLRUChunks]);

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
    loadedChunksRef.current.clear();
    
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
    
    initialLoadDone.current = true;
    setIsLoading(false);
  }, [worldId, loadProgressiveRings]);

  /**
   * Clear all chunks (on world change)
   * Phase 3.0: Directly calls onBlocksChanged (not batched) for immediate clear
   */
  const clearAllChunks = useCallback(() => {
    loadedChunksRef.current.clear();
    playerChunkRef.current = null;
    initialLoadDone.current = false;
    emitScheduledRef.current = false; // Cancel any pending emit
    onBlocksChanged([]);
  }, [onBlocksChanged]);

  // Handle world changes
  useEffect(() => {
    if (currentWorldRef.current !== worldId) {
      currentWorldRef.current = worldId;
      clearAllChunks();
    }
  }, [worldId, clearAllChunks]);

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
