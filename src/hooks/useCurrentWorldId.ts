import { useState, useEffect, useCallback } from 'react';
import { useWorlds, World } from './useWorlds';

const LOCAL_STORAGE_KEY = 'currentWorldId';

export function useCurrentWorldId() {
  const { worlds, isLoading, getDefaultWorld } = useWorlds();
  const [currentWorldId, setCurrentWorldIdState] = useState<string | null>(null);
  const [currentWorld, setCurrentWorld] = useState<World | null>(null);

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
    const defaultWorld = getDefaultWorld();
    if (defaultWorld) {
      setCurrentWorldIdState(defaultWorld.id);
      setCurrentWorld(defaultWorld);
    }
  }, [worlds, isLoading, getDefaultWorld]);

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
    const defaultWorld = getDefaultWorld();
    if (defaultWorld) {
      setCurrentWorldIdState(defaultWorld.id);
      setCurrentWorld(defaultWorld);
    }
  }, [getDefaultWorld]);

  return {
    currentWorldId,
    currentWorld,
    isLoading,
    setCurrentWorldId,
    clearWorldOverride
  };
}
