// Hook for fetching and subscribing to tree data
// Isolated from main codebase - uses its own tables

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { PlantedTree, TreeBlock, TreeFruit, SeedDefinition } from '../types';
import { TREE_CONFIG } from '../constants';

interface TreeData {
  plantedTrees: PlantedTree[];
  treeBlocks: TreeBlock[];
  treeFruits: TreeFruit[];
  seedDefinitions: SeedDefinition[];
  isLoading: boolean;
  error: string | null;
}

export function useTreeData(worldId: string | null): TreeData & {
  refetch: () => Promise<void>;
} {
  const [plantedTrees, setPlantedTrees] = useState<PlantedTree[]>([]);
  const [treeBlocks, setTreeBlocks] = useState<TreeBlock[]>([]);
  const [treeFruits, setTreeFruits] = useState<TreeFruit[]>([]);
  const [seedDefinitions, setSeedDefinitions] = useState<SeedDefinition[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!worldId || !TREE_CONFIG.ENABLED) {
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      // Fetch all data in parallel
      const [treesRes, blocksRes, fruitsRes, seedsRes] = await Promise.all([
        supabase
          .from('planted_trees')
          .select('*, seed_definitions(*)')
          .eq('world_id', worldId),
        supabase
          .from('tree_blocks')
          .select('*')
          .eq('world_id', worldId),
        supabase
          .from('tree_fruits')
          .select('*')
          .eq('world_id', worldId),
        supabase
          .from('seed_definitions')
          .select('*')
          .order('tier', { ascending: true }),
      ]);

      if (treesRes.error) throw treesRes.error;
      if (blocksRes.error) throw blocksRes.error;
      if (fruitsRes.error) throw fruitsRes.error;
      if (seedsRes.error) throw seedsRes.error;

      // Map the joined data correctly
      const mappedTrees = (treesRes.data || []).map(tree => ({
        ...tree,
        seed_definition: tree.seed_definitions as unknown as SeedDefinition,
      })) as PlantedTree[];

      // Create a lookup map from tree_id to seed_definition for texture URLs
      const treeToSeedMap = new Map<string, SeedDefinition>();
      mappedTrees.forEach(tree => {
        if (tree.seed_definition) {
          treeToSeedMap.set(tree.id, tree.seed_definition);
        }
      });

      // Enrich tree blocks with texture URLs from their parent tree's seed definition
      const enrichedBlocks = (blocksRes.data || []).map(block => {
        const seedDef = treeToSeedMap.get(block.tree_id);
        const textureUrl = block.block_type === 'trunk' 
          ? seedDef?.trunk_texture_url 
          : seedDef?.fruit_texture_url;
        return {
          ...block,
          texture_url: textureUrl || null,
        } as TreeBlock;
      });

      setPlantedTrees(mappedTrees);
      setTreeBlocks(enrichedBlocks);
      setTreeFruits((fruitsRes.data || []) as TreeFruit[]);
      setSeedDefinitions((seedsRes.data || []) as SeedDefinition[]);
    } catch (err) {
      console.error('[TreeData] Fetch error:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch tree data');
    } finally {
      setIsLoading(false);
    }
  }, [worldId]);

  // Initial fetch
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Real-time subscriptions
  useEffect(() => {
    if (!worldId || !TREE_CONFIG.ENABLED) return;

    // Subscribe to tree_blocks changes
    const blocksChannel = supabase
      .channel(`tree_blocks_${worldId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tree_blocks',
          filter: `world_id=eq.${worldId}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const newBlock = payload.new as TreeBlock;
            // Enrich with texture URL from plantedTrees
            setTreeBlocks(prev => {
              // Find the tree to get its seed definition texture
              const parentTree = plantedTrees.find(t => t.id === newBlock.tree_id);
              const seedDef = parentTree?.seed_definition;
              const textureUrl = newBlock.block_type === 'trunk' 
                ? seedDef?.trunk_texture_url 
                : seedDef?.fruit_texture_url;
              
              return [...prev, { ...newBlock, texture_url: textureUrl || null }];
            });
          } else if (payload.eventType === 'DELETE') {
            setTreeBlocks(prev => prev.filter(b => b.id !== payload.old.id));
          }
        }
      )
      .subscribe();

    // Subscribe to tree_fruits changes
    const fruitsChannel = supabase
      .channel(`tree_fruits_${worldId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tree_fruits',
          filter: `world_id=eq.${worldId}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setTreeFruits(prev => [...prev, payload.new as TreeFruit]);
          } else if (payload.eventType === 'UPDATE') {
            setTreeFruits(prev => 
              prev.map(f => f.id === payload.new.id ? payload.new as TreeFruit : f)
            );
          } else if (payload.eventType === 'DELETE') {
            setTreeFruits(prev => prev.filter(f => f.id !== payload.old.id));
          }
        }
      )
      .subscribe();

    // Subscribe to planted_trees changes
    const treesChannel = supabase
      .channel(`planted_trees_${worldId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'planted_trees',
          filter: `world_id=eq.${worldId}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            // Refetch to get joined seed_definition
            fetchData();
          } else if (payload.eventType === 'DELETE') {
            setPlantedTrees(prev => prev.filter(t => t.id !== payload.old.id));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(blocksChannel);
      supabase.removeChannel(fruitsChannel);
      supabase.removeChannel(treesChannel);
    };
  }, [worldId, fetchData, plantedTrees]);

  return {
    plantedTrees,
    treeBlocks,
    treeFruits,
    seedDefinitions,
    isLoading,
    error,
    refetch: fetchData,
  };
}
