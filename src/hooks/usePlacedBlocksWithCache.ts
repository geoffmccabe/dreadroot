import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useIndexedDB } from './useIndexedDB';
import { PlacedBlock } from '../types/blocks';

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

export const usePlacedBlocksWithCache = (userId: string | null) => {
  const [blocks, setBlocks] = useState<PlacedBlock[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();
  const {
    getAllBlocks,
    addBlock,
    addBlocksBatch,
    removeBlock: removeFromDB,
    removeBlocksBatch,
    getUnsyncedBlocks,
    markAsSynced,
    updateBlock,
    init: initDB
  } = useIndexedDB();

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

  const syncWithSupabase = useCallback(async (force = false) => {
    if (syncingRef.current) return;
    
    // Debounce: Skip if synced recently (unless forced)
    const now = Date.now();
    if (!force && now - lastSyncTimeRef.current < SYNC_DEBOUNCE_MS) {
      return;
    }
    
    try {
      syncingRef.current = true;
      lastSyncTimeRef.current = now;
      
      // Load blocks from IndexedDB first (instant)
      const cachedBlocks = await getAllBlocks();
      
      // Filter out expired blocks from cache
      const nowTime = new Date();
      const activeCachedBlocks = cachedBlocks
        .filter(block => !block.expires_at || new Date(block.expires_at) > nowTime)
        .map(block => ({
          id: block.id,
          user_id: block.user_id,
          position_x: block.position_x,
          position_y: block.position_y,
          position_z: block.position_z,
          block_type: block.block_type,
          created_at: block.created_at,
          updated_at: block.updated_at
        }));
      
      setBlocksIfChanged(activeCachedBlocks);

      
      // Get all blocks from Supabase
      const { data: supabaseBlocks, error } = await supabase
        .from('placed_blocks')
        .select('*');

      if (error) throw error;

      // BATCH: Remove blocks that no longer exist on server
      const serverIds = new Set(supabaseBlocks?.map(b => b.id) || []);
      const blocksToRemove = cachedBlocks
        .filter(block => !serverIds.has(block.id))
        .map(block => block.id);
      
      if (blocksToRemove.length > 0) {
        await removeBlocksBatch(blocksToRemove);
      }

      // BATCH: Add/update server blocks in cache
      const blocksToAdd: DBBlock[] = (supabaseBlocks || []).map(serverBlock => ({
        ...serverBlock,
        synced: true
      }));
      
      if (blocksToAdd.length > 0) {
        await addBlocksBatch(blocksToAdd);
      }

      // Filter out expired blocks before setting state
      const currentTime = new Date();
      const activeServerBlocks = (supabaseBlocks || []).filter(block => 
        !block.expires_at || new Date(block.expires_at) > currentTime
      );
      
      setBlocksIfChanged(activeServerBlocks);
    } catch (error) {
      console.error('Error syncing:', error);
    } finally {
      syncingRef.current = false;
    }
  }, []);

  const initializeCache = useCallback(async () => {
    if (!userId) {
      setIsLoading(false);
      return;
    }
    
    try {
      setIsLoading(true);
      await initDB();
      
      const cachedBlocks = await getAllBlocks();
      
      // Filter out expired blocks from cache
      const initTime = new Date();
      const activeInitBlocks = cachedBlocks
        .filter(block => !block.expires_at || new Date(block.expires_at) > initTime)
        .map((block: any) => ({
          id: block.id,
          user_id: block.user_id,
          position_x: block.position_x,
          position_y: block.position_y,
          position_z: block.position_z,
          block_type: block.block_type,
          created_at: block.created_at,
          updated_at: block.updated_at
        }));
      
      setBlocksIfChanged(activeInitBlocks);

      // Force sync on initialization (bypass debounce)
      await syncWithSupabase(true);
    } catch (error) {
      console.error('Error initializing:', error);
    } finally {
      setIsLoading(false);
    }
  }, [userId, syncWithSupabase]);

  const setupRealtimeSubscription = useCallback(() => {
    const channel = supabase
      .channel('placed_blocks_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'placed_blocks'
        },
        async (payload) => {
          if (payload.eventType === 'INSERT') {
            const newBlock = payload.new as PlacedBlock;
            
            // Skip if block is already expired
            if (newBlock.expires_at && new Date(newBlock.expires_at) <= new Date()) {
              return;
            }
            
            // Add to IndexedDB
            const dbBlock: DBBlock = { ...newBlock, synced: true };
            await addBlock(dbBlock);
            
            // Update local state - replace temp block or add new block
            setBlocksIfChanged(prev => {
              // Check if this is replacing a temp block at the same position
              const tempBlockIndex = prev.findIndex(block => 
                block.id.startsWith('temp-') &&
                block.position_x === newBlock.position_x &&
                block.position_y === newBlock.position_y &&
                block.position_z === newBlock.position_z
              );
              
              if (tempBlockIndex >= 0) {
                // Replace temp block with real block
                const updated = [...prev];
                updated[tempBlockIndex] = newBlock;
                return updated;
              }
              
              // Check if block already exists (prevent duplicates)
              const exists = prev.some(block => block.id === newBlock.id);
              if (exists) return prev;
              
              return [...prev, newBlock];
            });
          } else if (payload.eventType === 'DELETE') {
            const deletedId = payload.old.id;
            
            // Remove from IndexedDB
            await removeFromDB(deletedId);
            
            // Update local state
            setBlocksIfChanged(prev => prev.filter(block => block.id !== deletedId));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    if (userId) {
      initializeCache();
    } else {
      setIsLoading(true);
      setBlocksIfChanged([]);
    }
    
    const cleanup = setupRealtimeSubscription();
    return cleanup;
  }, [userId, initializeCache, setupRealtimeSubscription]);

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

    // Check for duplicate position FIRST before doing anything
    const isDuplicate = blocks.some(block => 
      block.position_x === x && 
      block.position_y === y && 
      block.position_z === z
    );
    
    if (isDuplicate) return null;
    
    // Generate temporary ID for instant feedback
    const tempId = `temp-${Date.now()}-${Math.random()}`;
    
    // Create optimistic block
    const optimisticBlock: any = {
      id: tempId,
      user_id: cachedUserId,
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

    // INSTANT: Update UI immediately
    setBlocksIfChanged(prev => [...prev, optimisticBlock]);

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
  }, [blocks, userId, toast, setBlocksIfChanged, addBlock]);

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

      // Use upsert to handle conflicts gracefully
      const { data, error } = await supabase
        .from('placed_blocks')
        .upsert(blockData, {
          onConflict: 'position_x,position_y,position_z',
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

      // PHASE 2: Direct state update to replace temp block with real block
      // Use setBlocksIfChanged to prevent unnecessary re-renders
      setBlocksIfChanged(prev => prev.map(block => 
        block.id === dbBlock.id ? data : block
      ));

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

      // Optimistically remove from UI
      setBlocksIfChanged(prev => prev.filter(block => block.id !== blockId));
      
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
        // Revert optimistic update
        await syncWithSupabase();
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
    isLoading,
    placeBlock,
    removeBlock,
    refreshBlocks: () => syncWithSupabase(true), // Force sync when manually refreshing
    setBlockMode // New function to enable/disable block mode
  };
};