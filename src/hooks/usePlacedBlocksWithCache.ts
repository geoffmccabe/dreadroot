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
const arraysShallowEqual = (a: PlacedBlock[], b: PlacedBlock[]): boolean => {
  if (a.length !== b.length) return false;
  
  // Create maps for O(1) lookup
  const mapA = new Map(a.map(block => [block.id, block]));
  const mapB = new Map(b.map(block => [block.id, block]));
  
  // Check if all IDs match and positions match
  for (const [id, blockA] of mapA) {
    const blockB = mapB.get(id);
    if (!blockB) return false;
    if (blockA.position_x !== blockB.position_x ||
        blockA.position_y !== blockB.position_y ||
        blockA.position_z !== blockB.position_z ||
        blockA.block_type !== blockB.block_type) {
      return false;
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
    removeBlock: removeFromDB,
    getUnsyncedBlocks,
    markAsSynced,
    updateBlock,
    init: initDB
  } = useIndexedDB();

  // Track previous blocks to prevent unnecessary updates
  const prevBlocksRef = useRef<PlacedBlock[]>([]);

  // Removed temp UUID - using real authentication now

  // Track if user is in block mode for periodic syncing
  const isBlockModeRef = useRef(false);
  const syncIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const syncingRef = useRef(false);

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

  const syncWithSupabase = useCallback(async () => {
    if (syncingRef.current) return;
    
    try {
      syncingRef.current = true;
      
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

      // Clear cache and rebuild with server data
      await getAllBlocks().then(async (cachedBlocks) => {
        // Remove blocks that no longer exist on server
        const serverIds = new Set(supabaseBlocks?.map(b => b.id) || []);
        
        for (const cachedBlock of cachedBlocks) {
          if (!serverIds.has(cachedBlock.id)) {
            await removeFromDB(cachedBlock.id);
          }
        }
      });

      // Add/update server blocks in cache
      for (const serverBlock of supabaseBlocks || []) {
        const dbBlock: DBBlock = {
          ...serverBlock,
          synced: true
        };
        await addBlock(dbBlock);
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
      
      setBlocksIfChanged(activeInitBlocks);

      await syncWithSupabase();
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
  useEffect(() => {
    const interval = setInterval(() => {
      setBlocksIfChanged(prev => {
        const now = new Date();
        const activeBlocks = prev.filter(block => 
          !block.expires_at || new Date(block.expires_at) > now
        );
        
        // Only update if any blocks were filtered out
        if (activeBlocks.length !== prev.length) {
          console.log(`[Expiration] Filtered out ${prev.length - activeBlocks.length} expired blocks`);
        }
        
        return activeBlocks;
      });
    }, 5000); // Check every 5 seconds

    return () => clearInterval(interval);
  }, [setBlocksIfChanged]);

  // Optimized block placement with instant local feedback
  const placeBlock = async (x: number, y: number, z: number, blockType: string, expiresAt?: string) => {
    try {
      // Get authenticated user
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
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
        user_id: user.id, // Use real user ID
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

      setBlocksIfChanged(prev => [...prev, optimisticBlock]);

      // Add to IndexedDB (not synced yet)
      const dbBlock: DBBlock = {
        ...optimisticBlock,
        synced: false,
        local_id: tempId
      };
      await addBlock(dbBlock);

      // If not in block mode, sync in background (non-blocking for instant placement)
      if (!isBlockModeRef.current) {
        syncBlockToSupabase(dbBlock).catch(() => {});
      }

      return optimisticBlock;
    } catch (error) {
      console.error('Error placing block:', error);
      toast({
        title: "Failed to place block",
        description: "Could not place block at this location",
        variant: "destructive"
      });
      return null;
    }
  };

  // Sync a single block to Supabase
  const syncBlockToSupabase = async (dbBlock: DBBlock) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const blockData: any = {
        user_id: user.id,
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

      // Update local state
      setBlocksIfChanged(prev => prev.map(block => 
        block.id === dbBlock.id ? data : block
      ));

      return data;
    } catch (error) {
      console.error('Error syncing block to Supabase:', error);
      throw error;
    }
  };

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

  const setBlockMode = useCallback((enabled: boolean) => {
    isBlockModeRef.current = enabled;

    if (enabled) {
      syncIntervalRef.current = setInterval(() => {
        batchSyncBlocks();
      }, 5000);
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
    refreshBlocks: syncWithSupabase,
    setBlockMode // New function to enable/disable block mode
  };
};