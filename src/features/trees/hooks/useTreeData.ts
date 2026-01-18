// Hook for fetching and subscribing to tree data
// Tree blocks are stored in placed_blocks table (unified system)
// This hook manages planted_trees (growth progress) and seed_definitions (planting UI)
// IMPORTANT: Only fetches FULLY GROWN trees to prevent flashing during local growth

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { PlantedTree, TreeFruit, SeedDefinition } from '../types';
import { TREE_CONFIG } from '../constants';

interface TreeData {
  plantedTrees: PlantedTree[];
  treeFruits: TreeFruit[];
  seedDefinitions: SeedDefinition[];
  isLoading: boolean;
  error: string | null;
}

export function useTreeData(
  worldId: string | null,
  userId: string | null = null
): TreeData & {
  refetch: () => Promise<void>;
} {
  const [plantedTrees, setPlantedTrees] = useState<PlantedTree[]>([]);
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

      // Build query for planted trees
      // Only fetch trees that are:
      // 1. Fully grown (is_fully_grown = true), OR
      // 2. Planted by other users (planted_by != userId)
      // This prevents local user's growing trees from entering React state
      let treesQuery = supabase
        .from('planted_trees')
        .select('*, seed_definitions(*)')
        .eq('world_id', worldId);

      // If we have a userId, filter to avoid local user's growing trees
      if (userId) {
        treesQuery = treesQuery.or(`is_fully_grown.eq.true,planted_by.neq.${userId}`);
      } else {
        // No user logged in, just get fully grown trees
        treesQuery = treesQuery.eq('is_fully_grown', true);
      }

      const [treesRes, fruitsRes, seedsRes] = await Promise.all([
        treesQuery,
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
      if (fruitsRes.error) throw fruitsRes.error;
      if (seedsRes.error) throw seedsRes.error;

      // Map the joined data correctly
      const mappedTrees = (treesRes.data || []).map(tree => ({
        ...tree,
        seed_definition: tree.seed_definitions as unknown as SeedDefinition,
      })) as PlantedTree[];

      setPlantedTrees(mappedTrees);
      setTreeFruits((fruitsRes.data || []) as TreeFruit[]);
      setSeedDefinitions((seedsRes.data || []) as SeedDefinition[]);
    } catch (err) {
      console.error('[TreeData] Fetch error:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch tree data');
    } finally {
      setIsLoading(false);
    }
  }, [worldId, userId]);

  // Initial fetch
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Real-time subscriptions
  useEffect(() => {
    if (!worldId || !TREE_CONFIG.ENABLED) return;

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
    // Only care about trees becoming fully grown or being deleted
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
          if (payload.eventType === 'INSERT') {
            // Only add if it's a fully grown tree or from another user
            const newTree = payload.new as any;
            if (newTree.is_fully_grown || (userId && newTree.planted_by !== userId)) {
              fetchData(); // Refetch to get joined seed_definition
            }
          } else if (payload.eventType === 'UPDATE') {
            const updatedTree = payload.new as any;
            // If a tree just became fully grown, add it to state
            if (updatedTree.is_fully_grown) {
              fetchData(); // Refetch to include newly grown tree
            } else {
              // Otherwise just merge updates for trees already in state
              setPlantedTrees(prev => prev.map(tree => {
                if (tree.id === updatedTree.id) {
                  return {
                    ...tree,
                    ...updatedTree,
                    seed_definition: tree.seed_definition,
                  };
                }
                return tree;
              }));
            }
          } else if (payload.eventType === 'DELETE') {
            setPlantedTrees(prev => prev.filter(t => t.id !== payload.old.id));
          }
        }
      )
      .subscribe();

    // Subscribe to seed_definitions changes (global, not filtered by world)
    const seedsChannel = supabase
      .channel('seed_definitions_global')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'seed_definitions',
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setSeedDefinitions(prev => {
              const newSeed = payload.new as SeedDefinition;
              // Insert in tier order
              const updated = [...prev, newSeed].sort((a, b) => a.tier - b.tier);
              return updated;
            });
          } else if (payload.eventType === 'UPDATE') {
            setSeedDefinitions(prev => 
              prev.map(s => s.id === payload.new.id ? payload.new as SeedDefinition : s)
            );
          } else if (payload.eventType === 'DELETE') {
            setSeedDefinitions(prev => prev.filter(s => s.id !== payload.old.id));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(fruitsChannel);
      supabase.removeChannel(treesChannel);
      supabase.removeChannel(seedsChannel);
    };
  }, [worldId, userId, fetchData]);

  return {
    plantedTrees,
    treeFruits,
    seedDefinitions,
    isLoading,
    error,
    refetch: fetchData,
  };
}
