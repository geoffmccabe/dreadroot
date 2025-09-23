import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useIndexedDB } from './useIndexedDB';

export interface PlacedBlock {
  id: string;
  user_id: string | null;
  position_x: number;
  position_y: number;
  position_z: number;
  block_type: string;
  created_at: string;
  updated_at: string;
}

interface DBBlock extends PlacedBlock {
  synced: boolean;
  local_id?: string;
}

// Generate a proper UUID for temporary demo users
const generateTempUUID = () => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

export const usePlacedBlocksWithCache = () => {
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

  // Generate a consistent temp UUID for this session
  const [tempUserId] = useState(() => {
    const stored = localStorage.getItem('temp-user-id');
    if (stored) return stored;
    const newId = generateTempUUID();
    localStorage.setItem('temp-user-id', newId);
    return newId;
  });

  // Track if user is in block mode for periodic syncing
  const isBlockModeRef = useRef(false);
  const syncIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    initializeCache();
    const cleanup = setupRealtimeSubscription();
    return cleanup;
  }, []);

  // Initialize IndexedDB and load blocks
  const initializeCache = async () => {
    try {
      setIsLoading(true);
      await initDB();
      
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
            
            // Update local state
            setBlocks(prev => {
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
  const placeBlock = async (x: number, y: number, z: number, blockType: string) => {
    try {
      // Generate temporary ID for instant feedback
      const tempId = `temp-${Date.now()}-${Math.random()}`;
      
      // Create optimistic block
      const optimisticBlock: PlacedBlock = {
        id: tempId,
        user_id: tempUserId,
        position_x: x,
        position_y: y,
        position_z: z,
        block_type: blockType,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      // Add to local state immediately
      setBlocks(prev => [...prev, optimisticBlock]);

      // Add to IndexedDB (not synced yet)
      const dbBlock: DBBlock = {
        ...optimisticBlock,
        synced: false,
        local_id: tempId
      };
      await addBlock(dbBlock);

      // If not in block mode, sync immediately
      if (!isBlockModeRef.current) {
        await syncBlockToSupabase(dbBlock);
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
      const { data, error } = await supabase
        .from('placed_blocks')
        .insert([{
          user_id: dbBlock.user_id,
          position_x: dbBlock.position_x,
          position_y: dbBlock.position_y,
          position_z: dbBlock.position_z,
          block_type: dbBlock.block_type
        }])
        .select()
        .single();

      if (error) throw error;

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
      console.log(`Syncing ${unsyncedBlocks.length} unsynced blocks...`);

      for (const block of unsyncedBlocks) {
        try {
          await syncBlockToSupabase(block);
        } catch (error) {
          console.error(`Failed to sync block ${block.id}:`, error);
        }
      }
    } catch (error) {
      console.error('Error in batch sync:', error);
    }
  };

  // Remove block
  const removeBlock = async (blockId: string) => {
    try {
      // Remove from Supabase
      const { error } = await supabase
        .from('placed_blocks')
        .delete()
        .eq('id', blockId);

      if (error) throw error;

      // Remove from IndexedDB
      await removeFromDB(blockId);

      // Update local state
      setBlocks(prev => prev.filter(block => block.id !== blockId));

      toast({
        title: "Block removed",
        description: "Block removed successfully",
      });

      return true;
    } catch (error) {
      console.error('Error removing block:', error);
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

  // Cleanup on unmount
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