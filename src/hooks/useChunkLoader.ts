import { useState, useRef, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { PlacedBlock } from '@/types/blocks';
import { getChunkKey, CHUNK_SIZE } from '@/lib/chunkManager';

// Configuration for chunk loading
const LOAD_RADIUS = 4;    // Chunks to load around player (9x9 = 81 chunks max)
const UNLOAD_RADIUS = 6;  // Hysteresis: don't unload until this far away
const POSITION_UPDATE_THROTTLE = 200; // ms between position updates

interface ChunkData {
  blocks: PlacedBlock[];
  loadedAt: number;
}

interface UseChunkLoaderProps {
  worldId: string | null;
  onBlocksChanged: (blocks: PlacedBlock[]) => void;
}

/**
 * Hook to manage chunk-based loading of blocks based on player position.
 * Uses a single bounding query for initial/movement loads, and per-chunk
 * refetches for realtime updates.
 * 
 * This is the SINGLE SOURCE OF TRUTH for loaded blocks.
 */
export function useChunkLoader({ worldId, onBlocksChanged }: UseChunkLoaderProps) {
  // Loaded chunks: Map<chunkKey, ChunkData>
  const loadedChunksRef = useRef<Map<string, ChunkData>>(new Map());
  
  // Current player chunk position
  const playerChunkRef = useRef<{ x: number; z: number } | null>(null);
  
  // Throttle position updates
  const lastPositionUpdateRef = useRef(0);
  
  // Track if initial load has happened
  const [isLoading, setIsLoading] = useState(true);
  const initialLoadDone = useRef(false);
  
  // Track current world to clear on change
  const currentWorldRef = useRef<string | null>(null);

  /**
   * Flatten all loaded chunks into a single blocks array
   */
  const flattenLoadedBlocks = useCallback((): PlacedBlock[] => {
    const allBlocks: PlacedBlock[] = [];
    for (const chunkData of loadedChunksRef.current.values()) {
      allBlocks.push(...chunkData.blocks);
    }
    return allBlocks;
  }, []);

  /**
   * Add a block optimistically to the chunk loader's internal Map.
   * This ensures immediate UI feedback while awaiting server confirmation.
   */
  const addBlockOptimistically = useCallback((block: PlacedBlock): void => {
    const chunkKey = getChunkKey(block.position_x, block.position_z);
    const chunkData = loadedChunksRef.current.get(chunkKey);
    
    if (chunkData) {
      // Check for duplicates at the same position
      const existsAtPosition = chunkData.blocks.some(b => 
        b.position_x === block.position_x &&
        b.position_y === block.position_y &&
        b.position_z === block.position_z
      );
      
      if (!existsAtPosition) {
        chunkData.blocks.push(block);
        onBlocksChanged(flattenLoadedBlocks());
      }
    }
    // If chunk not loaded, block will appear when chunk loads
  }, [onBlocksChanged, flattenLoadedBlocks]);

  /**
   * Replace a temp block with the real server block (by position match)
   */
  const replaceBlockByPosition = useCallback((newBlock: PlacedBlock): void => {
    const chunkKey = getChunkKey(newBlock.position_x, newBlock.position_z);
    const chunkData = loadedChunksRef.current.get(chunkKey);
    
    if (chunkData) {
      const index = chunkData.blocks.findIndex(b => 
        b.position_x === newBlock.position_x &&
        b.position_y === newBlock.position_y &&
        b.position_z === newBlock.position_z
      );
      
      if (index >= 0) {
        chunkData.blocks[index] = newBlock;
        onBlocksChanged(flattenLoadedBlocks());
      }
    }
  }, [onBlocksChanged, flattenLoadedBlocks]);

  /**
   * Remove a block by ID from the chunk loader
   */
  const removeBlockById = useCallback((blockId: string): void => {
    for (const chunkData of loadedChunksRef.current.values()) {
      const index = chunkData.blocks.findIndex(b => b.id === blockId);
      if (index >= 0) {
        chunkData.blocks.splice(index, 1);
        onBlocksChanged(flattenLoadedBlocks());
        return;
      }
    }
  }, [onBlocksChanged, flattenLoadedBlocks]);

  /**
   * Load chunks in a bounding box around the player using a single query
   */
  const loadChunksInRadius = useCallback(async (
    centerChunkX: number,
    centerChunkZ: number,
    radius: number
  ): Promise<void> => {
    if (!worldId) return;

    const minChunkX = centerChunkX - radius;
    const maxChunkX = centerChunkX + radius;
    const minChunkZ = centerChunkZ - radius;
    const maxChunkZ = centerChunkZ + radius;

    // Single bounding query for all chunks in radius
    const { data: blocks, error } = await supabase
      .from('placed_blocks')
      .select('*')
      .eq('world_id', worldId)
      .gte('chunk_x', minChunkX)
      .lte('chunk_x', maxChunkX)
      .gte('chunk_z', minChunkZ)
      .lte('chunk_z', maxChunkZ);

    if (error) {
      console.error('Error loading chunks:', error);
      return;
    }

    // Filter out expired blocks
    const now = new Date();
    const activeBlocks = (blocks || []).filter(block => 
      !block.expires_at || new Date(block.expires_at) > now
    );

    // Group blocks by chunk
    const chunkGroups = new Map<string, PlacedBlock[]>();
    for (const block of activeBlocks) {
      const chunkKey = getChunkKey(block.position_x, block.position_z);
      const existing = chunkGroups.get(chunkKey) || [];
      existing.push(block);
      chunkGroups.set(chunkKey, existing);
    }

    // Generate all chunk keys that should be loaded
    const loadedAt = Date.now();
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        const chunkX = centerChunkX + dx;
        const chunkZ = centerChunkZ + dz;
        const chunkKey = `chunk_${chunkX}_${chunkZ}`;
        
        // Store chunk data (even if empty - means we loaded it)
        loadedChunksRef.current.set(chunkKey, {
          blocks: chunkGroups.get(chunkKey) || [],
          loadedAt
        });
      }
    }

    // Notify of blocks change
    onBlocksChanged(flattenLoadedBlocks());
  }, [worldId, onBlocksChanged, flattenLoadedBlocks]);

  /**
   * Refetch a single chunk (used for realtime updates)
   */
  const refetchSingleChunk = useCallback(async (
    chunkX: number,
    chunkZ: number
  ): Promise<void> => {
    if (!worldId) return;

    const chunkKey = `chunk_${chunkX}_${chunkZ}`;
    
    // Only refetch if chunk is currently loaded
    if (!loadedChunksRef.current.has(chunkKey)) {
      return;
    }

    const { data: blocks, error } = await supabase
      .from('placed_blocks')
      .select('*')
      .eq('world_id', worldId)
      .eq('chunk_x', chunkX)
      .eq('chunk_z', chunkZ);

    if (error) {
      console.error('Error refetching chunk:', error);
      return;
    }

    // Filter out expired blocks
    const now = new Date();
    const activeBlocks = (blocks || []).filter(block => 
      !block.expires_at || new Date(block.expires_at) > now
    );

    // Update chunk data
    loadedChunksRef.current.set(chunkKey, {
      blocks: activeBlocks,
      loadedAt: Date.now()
    });

    // Notify of blocks change
    onBlocksChanged(flattenLoadedBlocks());
  }, [worldId, onBlocksChanged, flattenLoadedBlocks]);

  /**
   * Unload chunks that are beyond UNLOAD_RADIUS from player
   */
  const unloadDistantChunks = useCallback((centerChunkX: number, centerChunkZ: number) => {
    const chunksToUnload: string[] = [];
    
    for (const chunkKey of loadedChunksRef.current.keys()) {
      const match = chunkKey.match(/^chunk_(-?\d+)_(-?\d+)$/);
      if (!match) continue;
      
      const chunkX = parseInt(match[1], 10);
      const chunkZ = parseInt(match[2], 10);
      
      // Use Chebyshev distance (max of dx, dz)
      const dx = Math.abs(chunkX - centerChunkX);
      const dz = Math.abs(chunkZ - centerChunkZ);
      const distance = Math.max(dx, dz);
      
      if (distance > UNLOAD_RADIUS) {
        chunksToUnload.push(chunkKey);
      }
    }

    if (chunksToUnload.length > 0) {
      for (const key of chunksToUnload) {
        loadedChunksRef.current.delete(key);
      }
      onBlocksChanged(flattenLoadedBlocks());
    }
  }, [onBlocksChanged, flattenLoadedBlocks]);

  /**
   * Update player position - called by game controller
   * Loads new chunks if player moved to a new chunk
   */
  const updatePlayerPosition = useCallback(async (worldX: number, worldZ: number) => {
    if (!worldId) return;

    const now = Date.now();
    if (now - lastPositionUpdateRef.current < POSITION_UPDATE_THROTTLE) {
      return;
    }
    lastPositionUpdateRef.current = now;

    const newChunkX = Math.floor(worldX / CHUNK_SIZE);
    const newChunkZ = Math.floor(worldZ / CHUNK_SIZE);

    const prevChunk = playerChunkRef.current;

    // Check if player moved to a different chunk
    if (!prevChunk || prevChunk.x !== newChunkX || prevChunk.z !== newChunkZ) {
      playerChunkRef.current = { x: newChunkX, z: newChunkZ };

      // Find chunks that need to be loaded (not already in loadedChunks)
      const chunksToLoad: Array<{ x: number; z: number }> = [];
      
      for (let dx = -LOAD_RADIUS; dx <= LOAD_RADIUS; dx++) {
        for (let dz = -LOAD_RADIUS; dz <= LOAD_RADIUS; dz++) {
          const chunkX = newChunkX + dx;
          const chunkZ = newChunkZ + dz;
          const chunkKey = `chunk_${chunkX}_${chunkZ}`;
          
          if (!loadedChunksRef.current.has(chunkKey)) {
            chunksToLoad.push({ x: chunkX, z: chunkZ });
          }
        }
      }

      // If there are chunks to load, do a bounding query
      if (chunksToLoad.length > 0) {
        await loadChunksInRadius(newChunkX, newChunkZ, LOAD_RADIUS);
      }

      // Unload distant chunks
      unloadDistantChunks(newChunkX, newChunkZ);
    }
  }, [worldId, loadChunksInRadius, unloadDistantChunks]);

  /**
   * Force initial load when world changes
   */
  const initializeForWorld = useCallback(async (startX: number, startZ: number) => {
    if (!worldId) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    initialLoadDone.current = false;
    loadedChunksRef.current.clear();
    
    const startChunkX = Math.floor(startX / CHUNK_SIZE);
    const startChunkZ = Math.floor(startZ / CHUNK_SIZE);
    playerChunkRef.current = { x: startChunkX, z: startChunkZ };

    await loadChunksInRadius(startChunkX, startChunkZ, LOAD_RADIUS);
    
    initialLoadDone.current = true;
    setIsLoading(false);
  }, [worldId, loadChunksInRadius]);

  /**
   * Clear all chunks (on world change)
   */
  const clearAllChunks = useCallback(() => {
    loadedChunksRef.current.clear();
    playerChunkRef.current = null;
    initialLoadDone.current = false;
    onBlocksChanged([]);
  }, [onBlocksChanged]);

  // Handle world changes
  useEffect(() => {
    if (currentWorldRef.current !== worldId) {
      currentWorldRef.current = worldId;
      clearAllChunks();
    }
  }, [worldId, clearAllChunks]);

  /**
   * Get the set of currently loaded chunk keys
   */
  const getLoadedChunkKeys = useCallback((): Set<string> => {
    return new Set(loadedChunksRef.current.keys());
  }, []);

  /**
   * Check if a specific chunk is loaded
   */
  const isChunkLoaded = useCallback((chunkX: number, chunkZ: number): boolean => {
    const chunkKey = `chunk_${chunkX}_${chunkZ}`;
    return loadedChunksRef.current.has(chunkKey);
  }, []);

  return {
    isLoading,
    updatePlayerPosition,
    initializeForWorld,
    refetchSingleChunk,
    clearAllChunks,
    getLoadedChunkKeys,
    isChunkLoaded,
    loadedChunksRef,
    // New methods for optimistic updates
    addBlockOptimistically,
    replaceBlockByPosition,
    removeBlockById,
    LOAD_RADIUS,
    UNLOAD_RADIUS
  };
}
