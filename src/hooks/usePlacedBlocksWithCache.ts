import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useIndexedDB } from './useIndexedDB';
import { PlacedBlock } from '../types/blocks';
import { useChunkLoader } from './useChunkLoader';
import { getChunkKey } from '@/lib/chunkManager';

interface DBBlock extends PlacedBlock {
  synced: boolean;
  local_id?: string;
  expires_at?: string;
}

// Removed temp UUID hack - now using real Supabase authentication

// Helper to check if blocks arrays are shallowly equal
// OPTIMIZED: Early exits to avoid expensive Map creation when possible
const arraysShallowEqual = (a: PlacedBlock[], b: PlacedBlock[]): boolean => {
  // FAST: Same reference = same array
  if (a === b) return true;
  
  // FAST: Different lengths = different arrays
  if (a.length !== b.length) return false;
  
  // FAST: Both empty = equal
  if (a.length === 0) return true;
  
  // Only create Map for larger arrays where O(1) lookup is worth it
  if (a.length > 50) {
    const mapB = new Map(b.map(block => [block.id, block]));
    
    for (const blockA of a) {
      const blockB = mapB.get(blockA.id);
      if (!blockB) return false;
      if (blockA.position_x !== blockB.position_x ||
          blockA.position_y !== blockB.position_y ||
          blockA.position_z !== blockB.position_z ||
          blockA.block_type !== blockB.block_type) {
        return false;
      }
    }
  } else {
    // For small arrays, linear search is faster than Map creation
    for (const blockA of a) {
      const blockB = b.find(block => block.id === blockA.id);
      if (!blockB) return false;
      if (blockA.position_x !== blockB.position_x ||
          blockA.position_y !== blockB.position_y ||
          blockA.position_z !== blockB.position_z ||
          blockA.block_type !== blockB.block_type) {
        return false;
      }
    }
  }
  
  return true;
};

// Camera starting position from Fortress.tsx: [-8, 1.8, 22]
const CAMERA_START_X = -8;
const CAMERA_START_Z = 22;

// Now accepts worldId for multi-world support
// Phase 2B: Uses useChunkLoader for player-radius-based loading
export const usePlacedBlocksWithCache = (userId: string | null, worldId: string | null) => {
  const [blocks, setBlocks] = useState<PlacedBlock[]>([]);
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

  // Track previous blocks to prevent unnecessary updates
  const prevBlocksRef = useRef<PlacedBlock[]>([]);

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
  
  // Debounce sync to prevent auth token refresh from causing freezes
  const lastSyncTimeRef = useRef<number>(0);
  const SYNC_DEBOUNCE_MS = 30000; // Only sync every 30 seconds max

  // Safe setBlocks that only updates if array actually changed
  const setBlocksIfChanged = useCallback((newBlocks: PlacedBlock[] | ((prev: PlacedBlock[]) => PlacedBlock[])) => {
    setBlocks(prev => {
      const nextBlocks = typeof newBlocks === 'function' ? newBlocks(prev) : newBlocks;
      
      // Only update if arrays are actually different (compare with prev state, not ref)
      if (arraysShallowEqual(prev, nextBlocks)) {
        return prev; // Return previous reference to prevent re-render
      }
      
      prevBlocksRef.current = nextBlocks;
      return nextBlocks;
    });
  }, []);

  // Phase 2B: Chunk loader integration
  const handleChunkBlocksChanged = useCallback((newBlocks: PlacedBlock[]) => {
    setBlocksIfChanged(newBlocks);
  }, [setBlocksIfChanged]);

  const chunkLoader = useChunkLoader({
    worldId,
    onBlocksChanged: handleChunkBlocksChanged
  });

  // REMOVED: syncWithSupabase is orphaned - chunk loader now handles all loading

  // Phase 2B: Initialize with chunk loading instead of full world load
  const initializeCache = useCallback(async () => {
    if (!userId || !worldId) {
      setIsLoading(false);
      return;
    }
    
    try {
      setIsLoading(true);
      await initDB();
      
      // Phase 2B: Use chunk loader for initial load from camera starting position
      await chunkLoader.initializeForWorld(CAMERA_START_X, CAMERA_START_Z);
    } catch (error) {
      console.error('Error initializing:', error);
    } finally {
      setIsLoading(false);
    }
  }, [userId, worldId, initDB, chunkLoader]);

  // Phase 2C: chunk_versions realtime subscription
  // Per-chunk debounce timers to coalesce rapid updates
  const chunkDebounceTimers = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const CHUNK_REFETCH_DEBOUNCE_MS = 100; // Reduced from 300ms for faster multiplayer sync
  
  // Track chunks we recently modified locally to skip redundant refetch
  const recentlyModifiedChunks = useRef<Map<string, number>>(new Map());
  const LOCAL_MODIFICATION_GRACE_PERIOD = 2000; // 2 seconds

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
          console.log('[Phase2C] chunk_versions realtime event:', payload);
          
          const chunkX = (payload.new as any)?.chunk_x;
          const chunkZ = (payload.new as any)?.chunk_z;
          const version = (payload.new as any)?.version;
          
          if (chunkX === undefined || chunkZ === undefined) {
            console.log('[Phase2C] Ignoring event - missing chunk coordinates');
            return;
          }
          
          const chunkKey = `chunk_${chunkX}_${chunkZ}`;
          
          // Only process if this chunk is currently loaded
          if (!chunkLoader.isChunkLoaded(chunkX, chunkZ)) {
            console.log(`[Phase2C] Ignoring chunk ${chunkKey} - not loaded`);
            return; // Ignore changes to chunks we haven't loaded
          }
          
          // Skip refetch for chunks we recently modified locally
          // We already have optimistic data, no need to refetch our own changes
          const localModTime = recentlyModifiedChunks.current.get(chunkKey);
          if (localModTime && (Date.now() - localModTime) < LOCAL_MODIFICATION_GRACE_PERIOD) {
            console.log(`[Phase2C] Skipping chunk ${chunkKey} - recently modified locally`);
            return;
          }
          
          console.log(`[Phase2C] Processing chunk ${chunkKey} version ${version} (from other user)`);
          
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
      const { data: blocks, error } = await supabase
        .from('placed_blocks')
        .select('*')
        .eq('world_id', worldId)
        .eq('chunk_x', chunkX)
        .eq('chunk_z', chunkZ);
      
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

  // Clear blocks when world changes
  useEffect(() => {
    if (currentWorldIdRef.current !== worldId) {
      // World changed - clear state immediately before loading new world
      setBlocks([]);
      currentWorldIdRef.current = worldId;
    }
  }, [worldId]);

  useEffect(() => {
    if (userId && worldId) {
      initializeCache();
    } else {
      setIsLoading(true);
      setBlocksIfChanged([]);
    }
    
    const cleanup = setupRealtimeSubscription();
    return cleanup;
  }, [userId, worldId, initializeCache, setupRealtimeSubscription]);

  // Periodic check to filter expired blocks from state (every 5 seconds)
  // This ensures blocks disappear within 5-10 seconds of expiring without FPS impact
  // OPTIMIZED: Uses early-exit pattern to avoid expensive work when no blocks are expiring
  useEffect(() => {
    const DEBUG_EXPIRATION_LOGGING = false; // Set to true for debugging block expiration
    
    const interval = setInterval(() => {
      setBlocksIfChanged(prev => {
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
  }, [setBlocksIfChanged]);

  // PHASE 1: Optimized block placement with INSTANT local feedback (no await for auth)
  const placeBlock = useCallback((x: number, y: number, z: number, blockType: string, expiresAt?: string) => {
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

    // Check for duplicate position FIRST before doing anything
    const isDuplicate = blocks.some(block => 
      block.position_x === x && 
      block.position_y === y && 
      block.position_z === z
    );
    
    if (isDuplicate) return null;
    
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
      updated_at: new Date().toISOString()
    };
    
    // Add expiration if provided
    if (expiresAt) {
      optimisticBlock.expires_at = expiresAt;
    }

    // INSTANT: Add to chunk loader (single source of truth) for immediate UI
    chunkLoader.addBlockOptimistically(optimisticBlock);
    
    // Mark this chunk as recently modified locally to skip redundant realtime refetch
    const chunkKey = getChunkKey(x, z);
    recentlyModifiedChunks.current.set(chunkKey, Date.now());

    // Add to IndexedDB and sync in background (fire-and-forget)
    const dbBlock: DBBlock = {
      ...optimisticBlock,
      synced: false,
      local_id: tempId
    };
    
    // Non-blocking: add to IndexedDB then sync
    addBlock(dbBlock).then(() => {
      if (!isBlockModeRef.current) {
        syncBlockToSupabase(dbBlock).catch(() => {});
      }
    }).catch(() => {});

    return optimisticBlock;
  }, [blocks, userId, worldId, toast, setBlocksIfChanged, addBlock]);

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

      return data;
    } catch (error) {
      console.error('Error syncing block to Supabase:', error);
      throw error;
    }
  }, [getCachedUserId, removeFromDB, updateBlock]);

  // Batch sync unsynced blocks
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

      // Check ownership before attempting delete
      const blockToRemove = blocks.find(b => b.id === blockId);
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
    blocks,
    isLoading: isLoading || chunkLoader.isLoading,
    placeBlock,
    removeBlock,
    refreshBlocks: () => chunkLoader.initializeForWorld(CAMERA_START_X, CAMERA_START_Z),
    setBlockMode, // New function to enable/disable block mode
    // Phase 2B: Expose chunk loader functions
    updatePlayerPosition: chunkLoader.updatePlayerPosition,
    initializeForWorld: chunkLoader.initializeForWorld,
    getLoadedChunkKeys: chunkLoader.getLoadedChunkKeys,
    isChunkLoaded: chunkLoader.isChunkLoaded,
    refetchSingleChunk: chunkLoader.refetchSingleChunk,
    LOAD_RADIUS: chunkLoader.LOAD_RADIUS,
    UNLOAD_RADIUS: chunkLoader.UNLOAD_RADIUS
  };
};