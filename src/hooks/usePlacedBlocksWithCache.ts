import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useIndexedDB, blockDB } from './useIndexedDB';
import { PlacedBlock } from '../types/blocks';
import { useChunkLoader } from './useChunkLoader';
import { getChunkKey } from '@/lib/chunkManager';
import { initLogStep, initLogStart, initLogFinish, initLogStartStep, initLogFinishStep, initLogErrorStep } from '@/contexts/InitializationContext';
import { preloadAmbientAudio, startAmbientAudio, setAmbientVolume } from '@/components/fortress/FortressAudio';
import { isTreeBlockType } from '@/features/trees/lib/blockTypeEncoder';
// B4: Removed canonicalizeTextureUrl - no longer needed after removing arraysShallowEqual
import { preloadBlockDefinitions } from '@/hooks/useBlocksData';
import { CAMERA_START_X, CAMERA_START_Z } from '@/components/fortress/fortressScene.constants';
import * as THREE from 'three';

interface DBBlock extends PlacedBlock {
  synced: boolean;
  local_id?: string;
  expires_at?: string;
}

// Removed temp UUID hack - now using real Supabase authentication

// B4: REMOVED expensive arraysShallowEqual - was creating Map of entire world on every emit
// Upstream suppression (signature comparison in useChunkLoader) now handles duplicate prevention

// Camera starting position imported from fortressScene.constants.ts

// Now accepts worldId for multi-world support
// Phase 2B: Uses useChunkLoader for player-radius-based loading
// B5: emitRadius controls how many chunks are flattened for emit (reduces downstream GC pressure)
// Phase 4: Uses worldRevision for efficient useMemo dependencies in consumers
export const usePlacedBlocksWithCache = (userId: string | null, worldId: string | null, emitRadius?: number, loadRadius?: number) => {
  const [blocks, setBlocks] = useState<PlacedBlock[]>([]);
  // Phase 4: Track revision for efficient dependency tracking
  const [worldRevision, setWorldRevision] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();
  const {
    addBlock,
    removeBlock: removeFromDB,
    getUnsyncedBlocks,
    updateBlock,
    init: initDB,
  } = useIndexedDB();
  
  // Track current world for cache scoping
  const currentWorldIdRef = useRef<string | null>(worldId);

  // Phase 4: REMOVED prevBlocksRef - signature-based gating in useChunkLoader handles this

  // PHASE 1: Cache authenticated user to avoid repeated auth calls
  const cachedUserRef = useRef<{ id: string; cachedAt: number } | null>(null);
  const USER_CACHE_TTL = 60000; // 1 minute cache

  const getCachedUserId = useCallback(async (): Promise<string | null> => {
    const now = Date.now();
    if (cachedUserRef.current && now - cachedUserRef.current.cachedAt < USER_CACHE_TTL) {
      return cachedUserRef.current.id;
    }
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      cachedUserRef.current = { id: user.id, cachedAt: now };
      return user.id;
    }
    return null;
  }, []);

  // Pre-warm the user cache when userId is available
  useEffect(() => {
    if (userId && !cachedUserRef.current) {
      cachedUserRef.current = { id: userId, cachedAt: Date.now() };
    }
  }, [userId]);

  // Track if user is in block mode for periodic syncing
  const isBlockModeRef = useRef(false);
  const syncIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const syncingRef = useRef(false);
  const syncBlockToSupabaseRef = useRef<((dbBlock: DBBlock) => Promise<any>) | null>(null);
  // Debounce sync to prevent auth token refresh from causing freezes
  const lastSyncTimeRef = useRef<number>(0);
  const SYNC_DEBOUNCE_MS = 30000; // Only sync every 30 seconds max

  // Phase 4: Update blocks state when chunks change
  const handleBlocksChanged = useCallback((newBlocks: PlacedBlock[]) => {
    setBlocks(newBlocks);
  }, []);

  // Phase 4: Update revision counter for efficient useMemo dependencies
  const handleRevisionChanged = useCallback((revision: number) => {
    setWorldRevision(revision);
  }, []);

  const chunkLoader = useChunkLoader({
    worldId,
    onBlocksChanged: handleBlocksChanged,
    onRevisionChanged: handleRevisionChanged,  // Phase 4: Track revision
    emitRadius,  // B5: Only flatten chunks within visual distance
    loadRadius,  // Dynamic load radius matching visual distance
  });
  
  // Store chunkLoader in a ref to use in callbacks without causing dependency changes
  const chunkLoaderRef = useRef(chunkLoader);
  chunkLoaderRef.current = chunkLoader;
  
  // Track if we've initialized for the current world
  const initializedWorldRef = useRef<string | null>(null);

  // REMOVED: syncWithSupabase is orphaned - chunk loader now handles all loading

  // Phase 2B: Initialize with chunk loading instead of full world load
  // Use ref to avoid chunkLoader dependency causing re-initialization
  const initializeCache = useCallback(async () => {
    if (!userId || !worldId) {
      setIsLoading(false);
      return;
    }
    
    // Skip if already initialized for this world
    if (initializedWorldRef.current === worldId) {
      return;
    }
    initializedWorldRef.current = worldId;
    
    // Start initialization overlay
    initLogStart();
    
    const initStepId = initLogStartStep('usePlacedBlocksWithCache.ts', 'Starting world initialization...');
    
    try {
      setIsLoading(true);
      
      initLogStep('usePlacedBlocksWithCache.ts', `User authenticated, world: ${worldId.slice(0, 8)}...`);

      // Preload block definitions FIRST (parallel with IndexedDB init)
      // This ensures PlacedBlocks can render immediately when chunks load
      const blockDefsPromise = preloadBlockDefinitions();

      // C7: IndexedDB initialization with start/finish
      const dbStepId = initLogStartStep('usePlacedBlocksWithCache.ts', 'Initializing IndexedDB...');
      await initDB();
      initLogFinishStep(dbStepId!);

      // ONE-TIME CACHE MIGRATION: Clear stale chunk cache for existing users
      // This ensures trees that grew before the cache invalidation fix will render
      const CACHE_VERSION_KEY = 'fortress_chunk_cache_version';
      const CURRENT_CACHE_VERSION = 3; // Bump this to force a cache clear for all users
      const storedVersion = parseInt(localStorage.getItem(CACHE_VERSION_KEY) || '0', 10);
      if (storedVersion < CURRENT_CACHE_VERSION) {
        console.log('[CacheMigration] Clearing stale chunk cache (v' + storedVersion + ' -> v' + CURRENT_CACHE_VERSION + ')');
        await blockDB.clearAllChunkCache();
        localStorage.setItem(CACHE_VERSION_KEY, String(CURRENT_CACHE_VERSION));
      }

      // Wait for block definitions to finish (should be done by now since it ran in parallel)
      const blockDefsStepId = initLogStartStep('usePlacedBlocksWithCache.ts', 'Loading block definitions...');
      await blockDefsPromise;
      initLogFinishStep(blockDefsStepId!);

      // CRITICAL: Initialize texture atlas BEFORE chunk loading starts
      // Tree blocks require atlas to render - if atlas isn't ready, trees won't show
      const atlasStepId = initLogStartStep('usePlacedBlocksWithCache.ts', 'Initializing texture atlas...');
      const { initializeAtlasTexture } = await import('@/hooks/useTextureAtlas');
      await initializeAtlasTexture();
      initLogFinishStep(atlasStepId!);

      // Sync textures from database to atlas (ensures atlas is populated)
      const syncStepId = initLogStartStep('usePlacedBlocksWithCache.ts', 'Syncing textures to atlas...');
      const { syncAtlasOnInit } = await import('@/hooks/useAtlasSync');
      await syncAtlasOnInit();
      initLogFinishStep(syncStepId!);

      // Fetch world's ambient music settings
      const { data: worldSettings } = await supabase
        .from('worlds')
        .select('ambient_music_url, ambient_music_volume')
        .eq('id', worldId)
        .single();

      const ambientUrl = worldSettings?.ambient_music_url || '/ambient_alien_planet_bkgd_1.mp3';
      const ambientVolume = worldSettings?.ambient_music_volume ?? 100;

      // Load ambient audio (parallel with chunk loader)
      const ambientAudioPromise = (async () => {
        const ambientStepId = initLogStartStep('FortressAudio.ts', 'Loading ambient audio...');
        setAmbientVolume(ambientVolume);
        const loaded = await preloadAmbientAudio(ambientUrl);
        initLogFinishStep(ambientStepId!, loaded ? 1 : 0);
        return loaded;
      })();

      // C7: Chunk loader initialization with start/finish
      const chunkStepId = initLogStartStep('usePlacedBlocksWithCache.ts', `Starting chunk loader at (${CAMERA_START_X}, ${CAMERA_START_Z})...`);
      await chunkLoaderRef.current.initializeForWorld(CAMERA_START_X, CAMERA_START_Z);
      initLogFinishStep(chunkStepId!);

      // Wait for ambient audio to finish loading (should be done by now)
      await ambientAudioPromise;

      // C7: Realtime subscription setup
      const realtimeStepId = initLogStartStep('usePlacedBlocksWithCache.ts', 'Setting up realtime subscription...');
      initLogFinishStep(realtimeStepId!);

      // Sync missing tree blocks in the background (fire-and-forget)
      // This uses tree_blueprints to restore any blocks that failed to sync
      supabase.rpc('sync_all_missing_tree_blocks', { p_world_id: worldId })
        .then(({ data, error }) => {
          if (error) {
            console.log('[TreeSync] Function not available yet - run migration first');
          } else if (data?.total_blocks_inserted > 0) {
            console.log(`[TreeSync] Restored ${data.total_blocks_inserted} missing tree blocks from ${data.trees_processed} trees`);
            // Trigger a soft refresh to load the restored blocks
            chunkLoaderRef.current.refreshLoadedChunks?.();
          }
        })
        .catch(() => {}); // Ignore if function doesn't exist yet

      // Signal that React rendering will begin
      initLogStep('usePlacedBlocksWithCache.ts', 'Queuing React re-render...');

      // Complete the main init step
      if (initStepId) initLogFinishStep(initStepId);

      // Wait for React to render the blocks before dismissing overlay
      // Use requestAnimationFrame + timeout to ensure rendering is complete
      initLogStep('usePlacedBlocksWithCache.ts', 'Waiting for render...');
      await new Promise<void>(resolve => {
        requestAnimationFrame(() => {
          // Wait for two more frames to ensure blocks are visible
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              setTimeout(resolve, 100); // Small buffer for GPU upload
            });
          });
        });
      });

      // Finish initialization overlay
      initLogStep('usePlacedBlocksWithCache.ts', 'World initialization complete!');
      initLogFinish();

      // Start ambient audio (will handle autoplay restrictions automatically)
      startAmbientAudio();
    } catch (error) {
      console.error('Error initializing:', error);
      initializedWorldRef.current = null; // Allow retry on error
      if (initStepId) initLogErrorStep(initStepId, String(error));
      initLogFinish();
    } finally {
      setIsLoading(false);
    }
  }, [userId, worldId, initDB]);

  // Phase 2C: chunk_versions realtime subscription
  // Per-chunk debounce timers to coalesce rapid updates
  const chunkDebounceTimers = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const CHUNK_REFETCH_DEBOUNCE_MS = 100; // Reduced from 300ms for faster multiplayer sync
  
  // Track chunks we recently modified locally to skip redundant refetch
  const recentlyModifiedChunks = useRef<Map<string, number>>(new Map());
  const LOCAL_MODIFICATION_GRACE_PERIOD = 2000; // 2 seconds for normal blocks
  
  // Track chunks with active tree growth (longer grace period)
  const activeGrowthChunks = useRef<Set<string>>(new Set());
  const TREE_GROWTH_GRACE_PERIOD = 15000; // 15 seconds for tree growth chunks

  const setupRealtimeSubscription = useCallback(() => {
    if (!worldId) return () => {};
    
    // Phase 2C: Subscribe to chunk_versions instead of placed_blocks
    // This is more efficient as we only get notified per-chunk, not per-block
    const channel = supabase
      .channel(`chunk_versions_${worldId}`)
      .on(
        'postgres_changes',
        {
          event: '*', // INSERT or UPDATE (new chunk or version bump)
          schema: 'public',
          table: 'chunk_versions',
          filter: `world_id=eq.${worldId}`
        },
        async (payload) => {
          // Removed console spam - was causing main thread contention
          
          const chunkX = (payload.new as any)?.chunk_x;
          const chunkZ = (payload.new as any)?.chunk_z;
          
          if (chunkX === undefined || chunkZ === undefined) {
            return;
          }
          
          const chunkKey = `chunk_${chunkX}_${chunkZ}`;
          
          // Only process if this chunk is currently loaded
          if (!chunkLoader.isChunkLoaded(chunkX, chunkZ)) {
            return; // Ignore changes to chunks we haven't loaded
          }
          
          // Skip refetch for chunks with active tree growth (longer grace period)
          // Tree growth continuously places blocks, so we need to suppress realtime refetch
          if (activeGrowthChunks.current.has(chunkKey)) {
            return;
          }
          
          // Skip refetch for chunks we recently modified locally
          // We already have optimistic data, no need to refetch our own changes
          const localModTime = recentlyModifiedChunks.current.get(chunkKey);
          if (localModTime && (Date.now() - localModTime) < LOCAL_MODIFICATION_GRACE_PERIOD) {
            return;
          }
          
          // Debounce: If we already have a pending refetch for this chunk, clear it
          const existingTimer = chunkDebounceTimers.current.get(chunkKey);
          if (existingTimer) {
            clearTimeout(existingTimer);
          }
          
          // Schedule a debounced refetch for this chunk
          const timer = setTimeout(async () => {
            chunkDebounceTimers.current.delete(chunkKey);
            
            // Refetch the single chunk
            await chunkLoader.refetchSingleChunk(chunkX, chunkZ);
            
            // Also sync IndexedDB for this chunk
            await syncChunkToIndexedDB(chunkX, chunkZ);
          }, CHUNK_REFETCH_DEBOUNCE_MS);
          
          chunkDebounceTimers.current.set(chunkKey, timer);
        }
      )
      .subscribe();

    return () => {
      // Clear all pending debounce timers on cleanup
      for (const timer of chunkDebounceTimers.current.values()) {
        clearTimeout(timer);
      }
      chunkDebounceTimers.current.clear();
      supabase.removeChannel(channel);
    };
  }, [worldId, chunkLoader]);
  
  // Helper to sync a single chunk's blocks to IndexedDB
  const syncChunkToIndexedDB = useCallback(async (chunkX: number, chunkZ: number) => {
    if (!worldId) return;
    
    try {
      // Fetch current blocks for this chunk
      // CRITICAL: Supabase default limit is 1000 rows - single chunks can have many blocks
      const { data: blocks, error } = await supabase
        .from('placed_blocks')
        .select('*')
        .eq('world_id', worldId)
        .eq('chunk_x', chunkX)
        .eq('chunk_z', chunkZ)
        .limit(20000);
      
      if (error) {
        console.error('Error syncing chunk to IndexedDB:', error);
        return;
      }
      
      // Add/update blocks in IndexedDB (batch would be more efficient)
      for (const block of blocks || []) {
        const dbBlock: DBBlock = { ...block, synced: true };
        await addBlock(dbBlock);
      }
    } catch (err) {
      console.error('Error syncing chunk to IndexedDB:', err);
    }
  }, [worldId, addBlock]);

  // Track world changes - reset initialization tracking
  useEffect(() => {
    if (currentWorldIdRef.current !== worldId) {
      currentWorldIdRef.current = worldId;
      // Reset initialization tracking for new world
      initializedWorldRef.current = null;
    }
  }, [worldId]);

  // Main initialization effect - runs once per world
  useEffect(() => {
    if (userId && worldId) {
      initializeCache();
    } else {
      setIsLoading(true);
      setBlocks([]);
      initializedWorldRef.current = null;
    }

    const cleanup = setupRealtimeSubscription();
    return cleanup;
  }, [userId, worldId, initializeCache, setupRealtimeSubscription]);

  // Periodic check to filter expired blocks from state (every 5 seconds)
  // This ensures blocks disappear within 5-10 seconds of expiring without FPS impact
  // OPTIMIZED: Uses early-exit pattern to avoid expensive work when no blocks are expiring
  useEffect(() => {
    const DEBUG_EXPIRATION_LOGGING = false;

    const interval = setInterval(() => {
      setBlocks(prev => {
        // FAST EXIT: If no blocks have expires_at, nothing can expire - zero work
        const hasExpiringBlocks = prev.some(b => b.expires_at);
        if (!hasExpiringBlocks) {
          return prev; // Same reference, no state update, no re-render
        }

        // Only create timestamp once (not per-block)
        const nowTimestamp = Date.now();

        // Check if any blocks are actually expired before filtering
        const hasExpiredBlocks = prev.some(b =>
          b.expires_at && new Date(b.expires_at).getTime() <= nowTimestamp
        );

        if (!hasExpiredBlocks) {
          return prev; // Same reference, minimal work done
        }

        // Only filter when blocks are actually expired (rare case)
        const activeBlocks = prev.filter(block =>
          !block.expires_at || new Date(block.expires_at).getTime() > nowTimestamp
        );

        if (DEBUG_EXPIRATION_LOGGING) {
          console.log(`[Expiration] Filtered out ${prev.length - activeBlocks.length} expired blocks`);
        }

        return activeBlocks;
      });
    }, 5000); // Check every 5 seconds

    return () => clearInterval(interval);
  }, []);

  // PHASE 1: Optimized block placement with INSTANT local feedback (no await for auth)
  const placeBlock = useCallback((x: number, y: number, z: number, blockType: string, expiresAt?: string, textureUrl?: string, branchDepth?: number) => {
    // Use cached user ID for instant placement - no await!
    const cachedUserId = cachedUserRef.current?.id || userId;
    
    if (!cachedUserId) {
      console.error('User not authenticated');
      toast({
        title: "Authentication required",
        description: "Please wait for authentication...",
        variant: "destructive"
      });
      return null;
    }

    if (!worldId) {
      console.error('No world selected');
      return null;
    }

    // Phase 4: Check for duplicate position via chunk loader (no blocks array in state)
    const chunkKey = getChunkKey(x, z);
    const chunkData = chunkLoaderRef.current.loadedChunksRef?.current.get(chunkKey);
    if (chunkData) {
      const isDuplicate = chunkData.blocks.some(block =>
        block.position_x === x &&
        block.position_y === y &&
        block.position_z === z
      );
      if (isDuplicate) return null;
    }

    // Generate temporary ID for instant feedback
    const tempId = `temp-${Date.now()}-${Math.random()}`;
    
    // Create optimistic block with world_id
    const optimisticBlock: any = {
      id: tempId,
      user_id: cachedUserId,
      world_id: worldId, // Include world_id
      position_x: x,
      position_y: y,
      position_z: z,
      block_type: blockType,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      texture_url: textureUrl || null, // Include texture_url for stable rendering
      branch_depth: branchDepth ?? undefined, // Include branch_depth for tree lightening
    };
    
    // Add expiration if provided
    if (expiresAt) {
      optimisticBlock.expires_at = expiresAt;
    }

    // INSTANT: Add to chunk loader (single source of truth) for immediate UI
    // Collider insertion is handled by ensureBlockCollider in chunk loader
    chunkLoader.addBlockOptimistically(optimisticBlock);

    // Mark this chunk as recently modified locally to skip redundant realtime refetch
    // (chunkKey already declared above for duplicate check)
    recentlyModifiedChunks.current.set(chunkKey, Date.now());

    // Add to IndexedDB and sync in background (fire-and-forget)
    const dbBlock: DBBlock = {
      ...optimisticBlock,
      synced: false,
      local_id: tempId
    };
    
    // Non-blocking: add to IndexedDB then sync
    // NEW ARCHITECTURE: Tree blocks now go to placed_blocks like all other blocks
    addBlock(dbBlock).then(() => {
      if (!isBlockModeRef.current) {
        syncBlockToSupabase(dbBlock).catch(() => {});
      }
    }).catch(() => {});

    return optimisticBlock;
  }, [userId, worldId, toast, addBlock, chunkLoader]); // Phase 4: Removed blocks dependency

  /**
   * BATCH: Place multiple blocks at once with a SINGLE React re-render.
   * Used by tree growth to prevent N re-renders when placing N blocks.
   */
  const placeBlocksBatch = useCallback((
    positions: Array<{ x: number; y: number; z: number; blockType: string; textureUrl?: string; branchDepth?: number }>
  ): PlacedBlock[] => {
    const cachedUserId = cachedUserRef.current?.id || userId;
    if (!cachedUserId || !worldId) return [];
    
    const blocksToAdd: PlacedBlock[] = [];
    
    // NOTE: Duplicate checking is done in chunkLoader.addBlocksBatch() which
    // operates on the live chunk refs. Checking against React `blocks` state here
    // would be O(n*m) AND miss blocks placed earlier in the same batch.
    
    for (const pos of positions) {
      const tempId = `temp-${Date.now()}-${Math.random()}`;
      const block: any = {
        id: tempId,
        user_id: cachedUserId,
        world_id: worldId,
        position_x: pos.x,
        position_y: pos.y,
        position_z: pos.z,
        block_type: pos.blockType,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        texture_url: pos.textureUrl || null,
        branch_depth: pos.branchDepth,
      };
      
      // Collider insertion is handled by ensureBlockCollider in chunk loader
      blocksToAdd.push(block);
    }
    
    if (blocksToAdd.length > 0) {
      // BATCH: Add all blocks with single React re-render
      // Duplicate positions are filtered inside addBlocksBatch
      chunkLoader.addBlocksBatch(blocksToAdd);
      
      // Mark chunks as recently modified AND as active growth chunks
      // This prevents realtime refetch from causing flashing during tree growth
      for (const block of blocksToAdd) {
        const chunkKey = getChunkKey(block.position_x, block.position_z);
        recentlyModifiedChunks.current.set(chunkKey, Date.now());
        
        // Mark as active growth chunk for tree blocks (longer suppression)
        // Uses isTreeBlockType helper which handles encoded types like 'trunk_0_5'
        if (isTreeBlockType(block.block_type)) {
          activeGrowthChunks.current.add(chunkKey);
          // Auto-clear after grace period AND invalidate IndexedDB cache
          // This ensures fresh fetch on next page load
          setTimeout(() => {
            activeGrowthChunks.current.delete(chunkKey);
            // Invalidate the IndexedDB cache for this chunk so it refetches on reload
            if (worldId) {
              const match = chunkKey.match(/^chunk_(-?\d+)_(-?\d+)$/);
              if (match) {
                const chunkX = parseInt(match[1], 10);
                const chunkZ = parseInt(match[2], 10);
                blockDB.invalidateCachedChunk(worldId, chunkX, chunkZ).catch(() => {});
              }
            }
          }, TREE_GROWTH_GRACE_PERIOD);
        }
      }
      
      // CRITICAL FIX: Sync batch blocks to IndexedDB and Supabase
      // Without this, tree blocks only exist locally and disappear on refresh
      // IMPROVED: Added error handling and retry logic for failed syncs
      for (const block of blocksToAdd) {
        const dbBlock: DBBlock = {
          ...block,
          synced: false,
          local_id: block.id
        };

        // Non-blocking: add to IndexedDB then sync to Supabase with retry
        addBlock(dbBlock).then(async () => {
          const syncWithRetry = async (retries = 3): Promise<void> => {
            try {
              await syncBlockToSupabaseRef.current?.(dbBlock);
            } catch (err) {
              if (retries > 0) {
                // Exponential backoff: 100ms, 400ms, 900ms
                await new Promise(resolve => setTimeout(resolve, (4 - retries) * (4 - retries) * 100));
                return syncWithRetry(retries - 1);
              }
              // Log failed syncs for tree blocks to help diagnose missing trees
              if (isTreeBlockType(block.block_type)) {
                console.warn(`[BlockSync] Failed to sync tree block at (${block.position_x}, ${block.position_y}, ${block.position_z}) after 3 retries`);
              }
            }
          };
          await syncWithRetry();
        }).catch(err => {
          // IndexedDB add failed - log for tree blocks
          if (isTreeBlockType(block.block_type)) {
            console.warn(`[BlockSync] Failed to add tree block to IndexedDB: ${err?.message || 'Unknown error'}`);
          }
        });
      }
    }
    
    return blocksToAdd;
  }, [userId, worldId, chunkLoader, addBlock]);

  // PHASE 1: Sync a single block to Supabase (uses cached user, fire-and-forget)
  const syncBlockToSupabase = useCallback(async (dbBlock: DBBlock) => {
    try {
      // Use cached user ID - only fetch if not cached
      const cachedUserId = cachedUserRef.current?.id || await getCachedUserId();
      if (!cachedUserId) return;

      const blockData: any = {
        user_id: cachedUserId,
        position_x: dbBlock.position_x,
        position_y: dbBlock.position_y,
        position_z: dbBlock.position_z,
        block_type: dbBlock.block_type,
      };
      
      // Add expiration if provided
      if (dbBlock.expires_at) {
        blockData.expires_at = dbBlock.expires_at;
      }
      
      // Add world_id if present
      if ((dbBlock as any).world_id) {
        blockData.world_id = (dbBlock as any).world_id;
      }
      
      // Add texture_url if present
      if ((dbBlock as any).texture_url) {
        blockData.texture_url = (dbBlock as any).texture_url;
      }

      // Use upsert to handle conflicts gracefully - now world-scoped
      const { data, error } = await supabase
        .from('placed_blocks')
        .upsert(blockData, {
          onConflict: 'world_id,position_x,position_y,position_z',
          ignoreDuplicates: false
        })
        .select()
        .single();

      if (error) {
        if (error.code === '23505') {
          await removeFromDB(dbBlock.id);
          return;
        }
        throw error;
      }

      // Update IndexedDB with real server data
      await updateBlock(dbBlock.id, {
        id: data.id,
        created_at: data.created_at,
        updated_at: data.updated_at,
        synced: true
      });

      // PHASE 2B: Use chunk loader to replace temp block with real block
      // This keeps the chunk map in sync with rendered state
      chunkLoader.replaceBlockByPosition(data);

      // CRITICAL FIX: Invalidate chunk cache for tree blocks after successful sync
      // This ensures the IndexedDB cache doesn't serve stale data on page reload
      if (isTreeBlockType(dbBlock.block_type) && blockData.world_id) {
        const chunkX = Math.floor(dbBlock.position_x / 16);
        const chunkZ = Math.floor(dbBlock.position_z / 16);
        blockDB.invalidateCachedChunk(blockData.world_id, chunkX, chunkZ).catch(() => {});
      }

      return data;
    } catch (error) {
      console.error('Error syncing block to Supabase:', error);
      throw error;
    }
  }, [getCachedUserId, removeFromDB, updateBlock]);

  // Keep the ref in sync with the callback
  useEffect(() => {
    syncBlockToSupabaseRef.current = syncBlockToSupabase;
  }, [syncBlockToSupabase]);

  // Batch sync unsynced blocks
  // NEW ARCHITECTURE: All blocks (including tree blocks) now sync to placed_blocks
  const batchSyncBlocks = async () => {
    try {
      const unsyncedBlocks = await getUnsyncedBlocks();
      if (unsyncedBlocks.length === 0) return;

      for (const block of unsyncedBlocks) {
        try {
          await syncBlockToSupabase(block);
        } catch (error) {}
      }
    } catch (error) {}
  };

  // Remove block with ownership check
  const removeBlock = async (blockId: string) => {
    try {
      
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        toast({
          title: "Authentication required",
          description: "You must be authenticated to remove blocks",
          variant: "destructive"
        });
        return false;
      }

      // Phase 4: Find block via chunks ref (no blocks array in state)
      let blockToRemove: PlacedBlock | undefined;
      const chunksRef = chunkLoaderRef.current.loadedChunksRef?.current;
      if (chunksRef) {
        for (const chunkData of chunksRef.values()) {
          blockToRemove = chunkData.blocks.find(b => b.id === blockId);
          if (blockToRemove) break;
        }
      }
      if (!blockToRemove) return false;

      // Check if user owns the block or is admin
      const { data: roles } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id);
      
      const isAdmin = roles?.some(r => r.role === 'admin');
      const isOwner = blockToRemove.user_id === user.id;

      if (!isOwner && !isAdmin) {
        toast({
          title: "Permission denied",
          description: "You can only remove blocks you placed",
          variant: "destructive"
        });
        return false;
      }

      // Optimistically remove from UI via chunk loader (single source of truth)
      chunkLoader.removeBlockById(blockId);
      
      // Mark this chunk as recently modified locally to skip redundant realtime refetch
      const chunkKey = getChunkKey(blockToRemove.position_x, blockToRemove.position_z);
      recentlyModifiedChunks.current.set(chunkKey, Date.now());
      
      // Remove from Supabase (RLS will enforce ownership)
      const { error } = await supabase
        .from('placed_blocks')
        .delete()
        .eq('id', blockId);
      
      if (error) {
        toast({
          title: "Failed to remove block",
          description: "Could not remove this block",
          variant: "destructive"
        });
        // Revert optimistic update by refetching the chunk
        const blockChunkX = Math.floor(blockToRemove.position_x / 16);
        const blockChunkZ = Math.floor(blockToRemove.position_z / 16);
        await chunkLoader.refetchSingleChunk(blockChunkX, blockChunkZ);
        return false;
      }
      
      await removeFromDB(blockId);
      
      // Phase 6: Add to overlap check queue for tree hole filling
      // Only for blocks above ground level (y > 0)
      if (worldId && blockToRemove.position_y > 0) {
        // Fire-and-forget: don't await, don't block UI
        (async () => {
          try {
            await supabase
              .from('overlap_check_queue')
              .upsert({
                world_id: worldId,
                position_x: Math.floor(blockToRemove.position_x),
                position_y: Math.floor(blockToRemove.position_y),
                position_z: Math.floor(blockToRemove.position_z),
              }, { onConflict: 'world_id,position_x,position_y,position_z' });
          } catch {
            // Silently ignore errors
          }
        })();
      }
      
      toast({
        title: "Block removed",
        description: "Block removed successfully",
      });
      return true;
    } catch (error) {
      console.error('Error in removeBlock:', error);
      toast({
        title: "Failed to remove block",
        description: "Could not remove this block",
        variant: "destructive"
      });
      return false;
    }
  };

  // PHASE 4: Adjusted batch sync interval to 10 seconds
  const setBlockMode = useCallback((enabled: boolean) => {
    isBlockModeRef.current = enabled;

    if (enabled) {
      syncIntervalRef.current = setInterval(() => {
        batchSyncBlocks();
      }, 10000); // Changed from 5s to 10s to reduce lag
    } else {
      // Stop periodic sync and do final sync
      if (syncIntervalRef.current) {
        clearInterval(syncIntervalRef.current);
        syncIntervalRef.current = null;
      }
      batchSyncBlocks();
    }
  }, []);

  // Server-side cleanup still runs independently via scheduled jobs
  // Client-side filtering happens in BlocksContext to avoid FPS drops
  useEffect(() => {
    return () => {
      if (syncIntervalRef.current) {
        clearInterval(syncIntervalRef.current);
      }
    };
  }, []);

  return {
    // Phase 4: Expose blocks (from EMIT_RADIUS chunks) and worldRevision (for efficient deps)
    blocks,
    worldRevision,
    isLoading: isLoading || chunkLoader.isLoading,
    placeBlock,
    placeBlocksBatch, // BATCH: For tree growth - single re-render for N blocks
    removeBlock,
    refreshBlocks: () => chunkLoader.initializeForWorld(CAMERA_START_X, CAMERA_START_Z),
    setBlockMode, // New function to enable/disable block mode
    // Phase 2B: Expose chunk loader functions
    updatePlayerPosition: chunkLoader.updatePlayerPosition,
    initializeForWorld: chunkLoader.initializeForWorld,
    getLoadedChunkKeys: chunkLoader.getLoadedChunkKeys,
    isChunkLoaded: chunkLoader.isChunkLoaded,
    refetchSingleChunk: chunkLoader.refetchSingleChunk,
    removeBlocksByPositions: chunkLoader.removeBlocksByPositions, // BULK: For tree chopping
    LOAD_RADIUS: chunkLoader.LOAD_RADIUS,
    UNLOAD_RADIUS: chunkLoader.UNLOAD_RADIUS,
    // B4: Expose loadedChunksRef for efficient blocksByChunk access
    loadedChunksRef: chunkLoader.loadedChunksRef
  };
};