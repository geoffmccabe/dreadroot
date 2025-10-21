import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { BlockType } from '@/types/blocks';

let cachedBlocks: BlockType[] | null = null;
let cachedBlocksMap: Map<string, BlockType> | null = null;
let fetchPromise: Promise<void> | null = null;

export const useBlocksData = () => {
  const [blocks, setBlocks] = useState<BlockType[]>(cachedBlocks || []);
  const [blocksMap, setBlocksMap] = useState<Map<string, BlockType>>(cachedBlocksMap || new Map());
  const [isLoading, setIsLoading] = useState(!cachedBlocks);

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
        .order('cost', { ascending: true })
        .order('name', { ascending: true });

          if (error) throw error;

          const typedBlocks: BlockType[] = (data || []).map(block => ({
            id: block.id,
            key: block.key,
            name: block.name,
            description: block.description || '',
            cost: block.cost,
            category: block.category as BlockType['category'],
            rarity: block.rarity as BlockType['rarity'],
            texture: block.texture_url ? { diffuse: block.texture_url } : undefined,
            properties: block.properties as BlockType['properties']
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
        .order('cost', { ascending: true })
        .order('name', { ascending: true });

      if (error) throw error;

      const typedBlocks: BlockType[] = (data || []).map(block => ({
        id: block.id,
        key: block.key,
        name: block.name,
        description: block.description || '',
        cost: block.cost,
        category: block.category as BlockType['category'],
        rarity: block.rarity as BlockType['rarity'],
        texture: block.texture_url ? { diffuse: block.texture_url } : undefined,
        properties: block.properties as BlockType['properties']
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
