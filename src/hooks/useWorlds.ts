import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface World {
  id: string;
  name: string;
  fortress_texture_url: string | null;
  ground_texture_url: string | null;
  sky_texture_url: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export function useWorlds() {
  const [worlds, setWorlds] = useState<World[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchWorlds = useCallback(async () => {
    try {
      setIsLoading(true);
      const { data, error } = await supabase
        .from('worlds')
        .select('*')
        .order('is_default', { ascending: false })
        .order('name');

      if (error) throw error;
      
      // Type assertion since worlds table is new
      setWorlds((data as unknown as World[]) || []);
      setError(null);
    } catch (err) {
      console.error('Error fetching worlds:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch worlds');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWorlds();
  }, [fetchWorlds]);

  const getDefaultWorld = useCallback((): World | null => {
    return worlds.find(w => w.is_default) || worlds[0] || null;
  }, [worlds]);

  const createWorld = useCallback(async (worldData: {
    name: string;
    fortress_texture_url?: string | null;
    ground_texture_url?: string | null;
    sky_texture_url?: string | null;
  }): Promise<World | null> => {
    try {
      const { data, error } = await supabase
        .from('worlds')
        .insert({
          name: worldData.name,
          fortress_texture_url: worldData.fortress_texture_url || null,
          ground_texture_url: worldData.ground_texture_url || null,
          sky_texture_url: worldData.sky_texture_url || null,
          is_default: false
        })
        .select()
        .single();

      if (error) throw error;
      
      await fetchWorlds();
      return data as unknown as World;
    } catch (err) {
      console.error('Error creating world:', err);
      throw err;
    }
  }, [fetchWorlds]);

  const updateWorld = useCallback(async (
    worldId: string,
    updates: Partial<Pick<World, 'name' | 'fortress_texture_url' | 'ground_texture_url' | 'sky_texture_url'>>
  ): Promise<void> => {
    try {
      const { error } = await supabase
        .from('worlds')
        .update(updates)
        .eq('id', worldId);

      if (error) throw error;
      await fetchWorlds();
    } catch (err) {
      console.error('Error updating world:', err);
      throw err;
    }
  }, [fetchWorlds]);

  const setDefaultWorld = useCallback(async (worldId: string): Promise<void> => {
    try {
      // Transaction: first set all to false, then set chosen to true
      // Note: This should ideally be a database function, but we'll do it client-side
      const { error: clearError } = await supabase
        .from('worlds')
        .update({ is_default: false })
        .neq('id', worldId);

      if (clearError) throw clearError;

      const { error: setError } = await supabase
        .from('worlds')
        .update({ is_default: true })
        .eq('id', worldId);

      if (setError) throw setError;
      
      await fetchWorlds();
    } catch (err) {
      console.error('Error setting default world:', err);
      throw err;
    }
  }, [fetchWorlds]);

  const deleteWorld = useCallback(async (worldId: string): Promise<void> => {
    try {
      // Check if it's the default world
      const world = worlds.find(w => w.id === worldId);
      if (world?.is_default) {
        throw new Error('Cannot delete the default world');
      }

      const { error } = await supabase
        .from('worlds')
        .delete()
        .eq('id', worldId);

      if (error) throw error;
      await fetchWorlds();
    } catch (err) {
      console.error('Error deleting world:', err);
      throw err;
    }
  }, [worlds, fetchWorlds]);

  return {
    worlds,
    isLoading,
    error,
    fetchWorlds,
    getDefaultWorld,
    createWorld,
    updateWorld,
    setDefaultWorld,
    deleteWorld
  };
}
