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

  // Removed temp UUID - using real authentication now

  // Track if user is in block mode for periodic syncing
  const isBlockModeRef = useRef(false);
  const syncIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Load blocks when userId becomes available
  useEffect(() => {
    if (userId) {
      console.log('✅ User authenticated, loading blocks for:', userId);
      initializeCache();
    } else {
      console.log('⏳ Waiting for user authentication...');
      setIsLoading(true);
      setBlocks([]);
    }
    
    const cleanup = setupRealtimeSubscription();
    return cleanup;
  }, [userId]); // Re-run when userId changes

  // Initialize IndexedDB and load blocks
  const initializeCache = async () => {
    if (!userId) {
      console.warn('⚠️ Cannot initialize cache without userId');
      setIsLoading(false);
      return;
    }
    
    try {
      setIsLoading(true);
      await initDB();
      
      console.log('💾 Loading blocks from IndexedDB...');
      
      // Load blocks from IndexedDB first (instant)
      const cachedBlocks = await getAllBlocks();
      setBlocks(cachedBlocks.map(block => ({
        id: block.id,
        user_id: block.user_id,
        position_x: block.position_x,
        position_y: block.position_y,
        position_z: block.position_z,
        block_type: block.block_type,
        created_at: block.created_at,
        updated_at: block.updated_at
      })));

      // Then sync with Supabase in background
      await syncWithSupabase();
    } catch (error) {
      console.error('Error initializing cache:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Sync with Supabase - load all blocks and update cache
  const syncWithSupabase = async () => {
    try {
      console.log('Syncing with Supabase...');
      
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

      // Update local state
      setBlocks(supabaseBlocks || []);
      
      console.log(`Synced ${supabaseBlocks?.length || 0} blocks from Supabase`);
    } catch (error) {
      console.error('Error syncing with Supabase:', error);
    }
  };

  // Setup real-time subscription for other users' changes
  const setupRealtimeSubscription = () => {
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
          console.log('Real-time event received:', payload.eventType);
          
          if (payload.eventType === 'INSERT') {
            const newBlock = payload.new as PlacedBlock;
            
            // Add to IndexedDB
            const dbBlock: DBBlock = { ...newBlock, synced: true };
            await addBlock(dbBlock);
            
            // Update local state - replace temp block or add new block
            setBlocks(prev => {
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
            setBlocks(prev => prev.filter(block => block.id !== deletedId));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  };

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
      
      if (isDuplicate) {
        console.warn('Block already exists at position', {x, y, z}, '- skipping placement');
        return null;
      }
      
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

      // Add to local state immediately
      setBlocks(prev => {
        console.log('Adding new block to state, previous count:', prev.length);
        const updated = [...prev, optimisticBlock];
        console.log('New block count:', updated.length);
        return updated;
      });
      
      console.log('Block placed successfully, returning ID:', tempId);

      // Add to IndexedDB (not synced yet)
      const dbBlock: DBBlock = {
        ...optimisticBlock,
        synced: false,
        local_id: tempId
      };
      await addBlock(dbBlock);

      // If not in block mode, sync in background (non-blocking for instant placement)
      if (!isBlockModeRef.current) {
        syncBlockToSupabase(dbBlock).catch(error => {
          console.error('Background sync failed:', error);
          // Block remains in IndexedDB as unsynced and will retry with next batch sync
        });
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
      
      if (!user) {
        console.error('Cannot sync: user not authenticated');
        return;
      }

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
        // Handle unique constraint violation gracefully
        if (error.code === '23505') {
          console.log('Block position already occupied, removing local temp block');
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
      setBlocks(prev => prev.map(block => 
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
      if (unsyncedBlocks.length === 0) {
        console.log('No unsynced blocks to process');
        return;
      }
      
      console.log(`Syncing ${unsyncedBlocks.length} unsynced blocks...`);

      for (const block of unsyncedBlocks) {
        try {
          await syncBlockToSupabase(block);
        } catch (error) {
          console.error(`Failed to sync block ${block.id}:`, error);
          // Don't retry immediately to prevent spam
        }
      }
    } catch (error) {
      console.error('Error in batch sync:', error);
      // Don't propagate the error to prevent sync loop
    }
  };

  // Remove block with ownership check
  const removeBlock = async (blockId: string) => {
    try {
      console.log('Attempting to remove block:', blockId);
      
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
      
      if (!blockToRemove) {
        console.error('Block not found in local state');
        return false;
      }

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
      setBlocks(prev => prev.filter(block => block.id !== blockId));
      
      // Remove from Supabase (RLS will enforce ownership)
      const { error } = await supabase
        .from('placed_blocks')
        .delete()
        .eq('id', blockId);
      
      if (error) {
        console.error('Failed to remove block from Supabase:', error);
        toast({
          title: "Failed to remove block",
          description: "Could not remove this block",
          variant: "destructive"
        });
        // Revert optimistic update
        await syncWithSupabase();
        return false;
      }
      
      // Remove from IndexedDB
      await removeFromDB(blockId);
      
      console.log('Block removed successfully');
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

  // Enable/disable block mode with periodic syncing
  const setBlockMode = useCallback((enabled: boolean) => {
    isBlockModeRef.current = enabled;
    console.log(`Block mode ${enabled ? 'enabled' : 'disabled'} - periodic sync ${enabled ? 'started' : 'stopped'}`);

    if (enabled) {
      // Start periodic sync every 5 seconds
      syncIntervalRef.current = setInterval(() => {
        console.log('Periodic sync triggered...');
        batchSyncBlocks();
      }, 5000);
    } else {
      // Stop periodic sync and do final sync
      if (syncIntervalRef.current) {
        clearInterval(syncIntervalRef.current);
        syncIntervalRef.current = null;
      }
      // Final sync when exiting block mode
      console.log('Performing final sync before exiting block mode...');
      batchSyncBlocks();
    }
  }, []);

  // Periodic cleanup of expired blocks
  useEffect(() => {
    const cleanupInterval = setInterval(async () => {
      try {
        const { data } = await supabase.rpc('delete_expired_blocks');
        if (data && data > 0) {
          console.log(`Cleaned up ${data} expired blocks`);
        }
      } catch (error) {
        console.error('Error cleaning up expired blocks:', error);
      }
    }, 60000); // Every 60 seconds

    return () => {
      clearInterval(cleanupInterval);
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