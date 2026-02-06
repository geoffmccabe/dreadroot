import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { BlockType } from '@/types/blocks';
import { initLogStartStep, initLogFinishStep, initLogErrorStep } from '@/contexts/InitializationContext';

let cachedBlocks: BlockType[] | null = null;
let cachedBlocksMap: Map<string, BlockType> | null = null;
let fetchPromise: Promise<void> | null = null;

// Force clear cache - call this when new block types are added
export const clearBlocksCache = () => {
  cachedBlocks = null;
  cachedBlocksMap = null;
  fetchPromise = null;
};

// Preload block definitions - call this during app initialization
// Returns a promise that resolves when block definitions are loaded
export const preloadBlockDefinitions = async (): Promise<void> => {
  // If already cached, return immediately
  if (cachedBlocks && cachedBlocksMap) {
    return;
  }

  // If already fetching, wait for that promise
  if (fetchPromise) {
    await fetchPromise;
    return;
  }

  // Import supabase dynamically to avoid circular dependencies
  const { supabase } = await import('@/integrations/supabase/client');

  fetchPromise = (async () => {
    const stepId = initLogStartStep('useBlocksData.ts', 'Fetching block definitions from Supabase...');
    try {
      const { data, error } = await supabase
        .from('blocks')
        .select('*')
        .order('class', { ascending: true })
        .order('tier', { ascending: true })
        .order('cost', { ascending: true });

      if (error) throw error;

      const typedBlocks = (data || []).map((block: any) => ({
        id: block.id,
        key: block.key,
        name: block.name,
        description: block.description || '',
        cost: block.cost,
        category: block.category,
        rarity: block.rarity,
        class: block.class,
        tier: block.tier || 0,
        texture: block.texture_url ? { diffuse: block.texture_url } : undefined,
        properties: {
          ...(block.properties || {}),
          glowFactor: block.glow_factor || undefined
        }
      }));

      const blockMap = new Map();
      typedBlocks.forEach((block: any) => blockMap.set(block.key, block));

      cachedBlocks = typedBlocks;
      cachedBlocksMap = blockMap;

      if (stepId) initLogFinishStep(stepId, typedBlocks.length);
    } catch (error: any) {
      if (stepId) initLogErrorStep(stepId, error?.message || 'Failed to load block definitions');
      console.error('Failed to preload block definitions:', error);
      throw error;
    } finally {
      fetchPromise = null;
    }
  })();

  await fetchPromise;
};

export const useBlocksData = () => {
  const [blocks, setBlocks] = useState<BlockType[]>([]);
  const [blocksMap, setBlocksMap] = useState<Map<string, BlockType>>(new Map());
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadBlocks = async () => {
      // If already loaded, use cache
      if (cachedBlocks && cachedBlocksMap) {
        setBlocks(cachedBlocks);
        setBlocksMap(cachedBlocksMap);
        setIsLoading(false);
        return;
      }

      // If already fetching, wait for that promise
      if (fetchPromise) {
        await fetchPromise;
        if (cachedBlocks && cachedBlocksMap) {
          setBlocks(cachedBlocks);
          setBlocksMap(cachedBlocksMap);
          setIsLoading(false);
        }
        return;
      }

      // Start new fetch
      fetchPromise = (async () => {
        try {
      const { data, error } = await supabase
        .from('blocks')
        .select('*')
        .order('class', { ascending: true })
        .order('tier', { ascending: true })
        .order('cost', { ascending: true });

          if (error) throw error;

          const typedBlocks: BlockType[] = (data || []).map(block => ({
            id: block.id,
            key: block.key,
            name: block.name,
            description: block.description || '',
            cost: block.cost,
            category: block.category as BlockType['category'],
            rarity: block.rarity as BlockType['rarity'],
            class: block.class as BlockType['class'],
            tier: block.tier || 0,
            texture: block.texture_url ? { diffuse: block.texture_url } : undefined,
            properties: {
              ...(block.properties as BlockType['properties']),
              glowFactor: block.glow_factor || undefined
            }
          }));

          const blockMap = new Map<string, BlockType>();
          typedBlocks.forEach(block => blockMap.set(block.key, block));

          cachedBlocks = typedBlocks;
          cachedBlocksMap = blockMap;
          setBlocks(typedBlocks);
          setBlocksMap(blockMap);
        } catch (error) {
          console.error('Failed to load blocks:', error);
        } finally {
          setIsLoading(false);
          fetchPromise = null;
        }
      })();

      await fetchPromise;
    };

    loadBlocks();
    
    // Listen for block updates from admin panel
    const handleBlocksUpdated = () => {
      refreshBlocks();
    };
    
    window.addEventListener('blocksUpdated', handleBlocksUpdated);
    
    return () => {
      window.removeEventListener('blocksUpdated', handleBlocksUpdated);
    };
  }, []);

  const getBlockByKey = (key: string): BlockType | undefined => {
    return blocksMap.get(key);
  };

  const refreshBlocks = async () => {
    cachedBlocks = null;
    cachedBlocksMap = null;
    fetchPromise = null;
    setIsLoading(true);
    
    try {
      const { data, error } = await supabase
        .from('blocks')
        .select('*')
        .order('class', { ascending: true })
        .order('tier', { ascending: true })
        .order('cost', { ascending: true });

      if (error) throw error;

      const typedBlocks: BlockType[] = (data || []).map(block => ({
        id: block.id,
        key: block.key,
        name: block.name,
        description: block.description || '',
        cost: block.cost,
        category: block.category as BlockType['category'],
        rarity: block.rarity as BlockType['rarity'],
        class: block.class as BlockType['class'],
        tier: block.tier || 0,
        texture: block.texture_url ? { diffuse: block.texture_url } : undefined,
        properties: {
          ...(block.properties as BlockType['properties']),
          glowFactor: block.glow_factor || undefined
        }
      }));

      const blockMap = new Map<string, BlockType>();
      typedBlocks.forEach(block => blockMap.set(block.key, block));

      cachedBlocks = typedBlocks;
      cachedBlocksMap = blockMap;
      setBlocks(typedBlocks);
      setBlocksMap(blockMap);
    } catch (error) {
      console.error('Failed to refresh blocks:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return { blocks, blocksMap, isLoading, getBlockByKey, refreshBlocks };
};
