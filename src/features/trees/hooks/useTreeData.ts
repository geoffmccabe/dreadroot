// Hook for fetching and subscribing to tree data
// Tree blocks are now stored in placed_blocks table (unified system)
// This hook only manages planted_trees (growth progress) and seed_definitions (planting UI)

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

export function useTreeData(worldId: string | null): TreeData & {
  refetch: () => Promise<void>;
  addTreeOptimistically: (tree: PlantedTree) => void;
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

      // Fetch planted trees and seed definitions (tree blocks now come from placed_blocks via chunk loader)
      const [treesRes, fruitsRes, seedsRes] = await Promise.all([
        supabase
          .from('planted_trees')
          .select('*, seed_definitions(*)')
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
  }, [worldId]);

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
      supabase.removeChannel(fruitsChannel);
      supabase.removeChannel(treesChannel);
    };
  }, [worldId, fetchData]);

  // Optimistically add a tree to the local state (for instant growth after planting)
  const addTreeOptimistically = useCallback((tree: PlantedTree) => {
    setPlantedTrees(prev => {
      // Don't add if already exists
      if (prev.some(t => t.id === tree.id)) return prev;
      return [...prev, tree];
    });
  }, []);

  return {
    plantedTrees,
    treeFruits,
    seedDefinitions,
    isLoading,
    error,
    refetch: fetchData,
    addTreeOptimistically,
  };
}
