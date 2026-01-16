import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

const LOCAL_STORAGE_KEY = 'currentWorldId';

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

// Standalone hook that fetches worlds directly - avoids circular dependency with useWorlds
export function useCurrentWorldId() {
  const [worlds, setWorlds] = useState<World[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [currentWorldId, setCurrentWorldIdState] = useState<string | null>(null);
  const [currentWorld, setCurrentWorld] = useState<World | null>(null);

  // Fetch worlds directly (no dependency on useWorlds hook)
  useEffect(() => {
    const fetchWorlds = async () => {
      try {
        const { data, error } = await supabase
          .from('worlds')
          .select('*')
          .order('is_default', { ascending: false })
          .order('name');

        if (error) throw error;
        setWorlds((data as unknown as World[]) || []);
      } catch (err) {
        console.error('Error fetching worlds:', err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchWorlds();
  }, []);

  // Initialize world ID from localStorage or default
  useEffect(() => {
    if (isLoading || worlds.length === 0) return;

    // Check localStorage for admin override
    const storedWorldId = localStorage.getItem(LOCAL_STORAGE_KEY);
    
    if (storedWorldId) {
      // Verify stored world still exists
      const storedWorld = worlds.find(w => w.id === storedWorldId);
      if (storedWorld) {
        setCurrentWorldIdState(storedWorldId);
        setCurrentWorld(storedWorld);
        return;
      }
      // Clear invalid stored world
      localStorage.removeItem(LOCAL_STORAGE_KEY);
    }

    // Fall back to default world
    const defaultWorld = worlds.find(w => w.is_default) || worlds[0] || null;
    if (defaultWorld) {
      setCurrentWorldIdState(defaultWorld.id);
      setCurrentWorld(defaultWorld);
    }
  }, [worlds, isLoading]);

  // Update current world when worlds list changes
  useEffect(() => {
    if (currentWorldId && worlds.length > 0) {
      const world = worlds.find(w => w.id === currentWorldId);
      if (world) {
        setCurrentWorld(world);
      }
    }
  }, [currentWorldId, worlds]);

  // Set world ID (for admin testing)
  const setCurrentWorldId = useCallback((worldId: string) => {
    localStorage.setItem(LOCAL_STORAGE_KEY, worldId);
    setCurrentWorldIdState(worldId);
    
    const world = worlds.find(w => w.id === worldId);
    if (world) {
      setCurrentWorld(world);
    }
  }, [worlds]);

  // Clear override and use default
  const clearWorldOverride = useCallback(() => {
    localStorage.removeItem(LOCAL_STORAGE_KEY);
    const defaultWorld = worlds.find(w => w.is_default) || worlds[0] || null;
    if (defaultWorld) {
      setCurrentWorldIdState(defaultWorld.id);
      setCurrentWorld(defaultWorld);
    }
  }, [worlds]);

  return {
    currentWorldId,
    currentWorld,
    isLoading,
    setCurrentWorldId,
    clearWorldOverride
  };
}
