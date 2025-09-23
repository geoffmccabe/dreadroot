import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

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

// Generate a proper UUID for temporary demo users
const generateTempUUID = () => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

export const usePlacedBlocks = () => {
  const [blocks, setBlocks] = useState<PlacedBlock[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  // Generate a consistent temp UUID for this session (same as useUserData)
  const [tempUserId] = useState(() => {
    const stored = localStorage.getItem('temp-user-id');
    if (stored) return stored;
    const newId = generateTempUUID();
    localStorage.setItem('temp-user-id', newId);
    return newId;
  });

  useEffect(() => {
    loadBlocks();
    const cleanup = setupRealtimeSubscription();
    return cleanup;
  }, []);

  const loadBlocks = async () => {
    try {
      setIsLoading(true);
      const { data, error } = await supabase
        .from('placed_blocks')
        .select('*');

      if (error) throw error;
      setBlocks(data || []);
    } catch (error) {
      console.error('Error loading blocks:', error);
      toast({
        title: "Error",
        description: "Failed to load placed blocks",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

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
        (payload) => {
          console.log('Real-time event received:', payload.eventType, payload);
          if (payload.eventType === 'INSERT') {
            setBlocks(prev => {
              // Check if block already exists (avoid duplicates from optimistic updates)
              const exists = prev.some(block => block.id === payload.new.id);
              if (exists) return prev;
              return [...prev, payload.new as PlacedBlock];
            });
          } else if (payload.eventType === 'DELETE') {
            setBlocks(prev => prev.filter(block => block.id !== payload.old.id));
          }
        }
      )
      .on('system', {}, (status) => {
        console.log('Realtime status:', status);
      })
      .subscribe((status) => {
        console.log('Subscription status:', status);
        if (status === 'CHANNEL_ERROR') {
          console.error('Realtime subscription error, attempting to reconnect...');
          // Reconnect after a delay
          setTimeout(() => {
            setupRealtimeSubscription();
          }, 1000);
        }
      });

    return () => {
      console.log('Cleaning up realtime subscription');
      supabase.removeChannel(channel);
    };
  };

  const placeBlock = async (x: number, y: number, z: number, blockType: string, useInventory: boolean = true) => {
    try {
      // Check inventory if required
      if (useInventory) {
        // Check if user has blocks in inventory (this will be handled by the calling component)
        // For now, we just place the block
      }

      // Optimistic update - add block immediately for instant feedback
      const optimisticBlock: PlacedBlock = {
        id: `temp-${Date.now()}`, // Temporary ID
        user_id: tempUserId,
        position_x: x,
        position_y: y,
        position_z: z,
        block_type: blockType,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      setBlocks(prev => [...prev, optimisticBlock]);

      const { data, error } = await supabase
        .from('placed_blocks')
        .insert([{
          user_id: tempUserId,
          position_x: x,
          position_y: y,
          position_z: z,
          block_type: blockType
        }])
        .select()
        .single();

      if (error) throw error;
      
      // Replace optimistic block with real data
      setBlocks(prev => prev.map(block => 
        block.id === optimisticBlock.id ? data : block
      ));
      
      toast({
        title: "Block placed!",
        description: `${blockType} placed successfully`,
      });
      
      return data;
    } catch (error) {
      console.error('Error placing block:', error);
      
      // Remove optimistic block on error
      setBlocks(prev => prev.filter(block => !block.id.startsWith('temp-')));
      
      toast({
        title: "Failed to place block",
        description: "Could not place block at this location",
        variant: "destructive"
      });
      return null;
    }
  };

  const removeBlock = async (blockId: string) => {
    try {
      const { error } = await supabase
        .from('placed_blocks')
        .delete()
        .eq('id', blockId);

      if (error) throw error;
      
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

  return {
    blocks,
    isLoading,
    placeBlock,
    removeBlock,
    refreshBlocks: loadBlocks
  };
};