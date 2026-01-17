import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { BlockType } from '@/types/blocks';

let cachedBlocks: BlockType[] | null = null;
let cachedBlocksMap: Map<string, BlockType> | null = null;
let fetchPromise: Promise<void> | null = null;

// Force clear cache - call this when new block types are added
export const clearBlocksCache = () => {
  cachedBlocks = null;
  cachedBlocksMap = null;
  fetchPromise = null;
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

          console.log('Fetched items from DB:', data?.slice(0, 5).map(b => ({ name: b.name, class: b.class, tier: b.tier })));

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
          
          // Debug log for Harold block
          const haroldBlock = typedBlocks.find(b => b.key === 'harold');
          if (haroldBlock) {
            console.log('🎯 Harold block loaded:', {
              key: haroldBlock.key,
              texture_url: haroldBlock.texture?.diffuse,
              has_texture: !!haroldBlock.texture?.diffuse
            });
          }

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
      
      // Debug log for Harold block
      const haroldBlock = typedBlocks.find(b => b.key === 'harold');
      if (haroldBlock) {
        console.log('🎯 Harold block refreshed:', {
          key: haroldBlock.key,
          texture_url: haroldBlock.texture?.diffuse,
          has_texture: !!haroldBlock.texture?.diffuse
        });
      }

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
