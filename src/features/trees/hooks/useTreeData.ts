// Hook for fetching and subscribing to tree data
// Tree blocks are stored in placed_blocks table (unified system)
// This hook manages planted_trees (growth progress) and seed_definitions (planting UI)
// IMPORTANT: Only fetches FULLY GROWN trees to prevent flashing during local growth

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { PlantedTree, TreeFruit, SeedDefinition, TreeGrowthOptions } from '../types';
import { TREE_CONFIG } from '../constants';
import { initLogStep } from '@/contexts/InitializationContext';
import { isTreeDeleted, markTreeDeleted } from './useLocalGrowth';
import { generateTreeBlueprint } from '../lib/treeGrowth';
import { generateFungalTreeBlueprint } from '../lib/fungalTreeGenerator';
import { generateWideTreeBlueprint } from '../lib/wideTreeGenerator';

interface TreeData {
  plantedTrees: PlantedTree[];
  treeFruits: TreeFruit[];
  seedDefinitions: SeedDefinition[];
  myIncompleteTrees: PlantedTree[];  // User's trees that need to resume growing
  isLoading: boolean;
  error: string | null;
}

function buildGrowthOptions(seedDef: SeedDefinition): TreeGrowthOptions {
  return {
    lowBranchHeight: seedDef.low_branch_height ?? 2,
    spikeChance: seedDef.spike_chance ?? 0,
    spikeLength: seedDef.spike_length ?? 3,
    nobChance: seedDef.nob_chance ?? 0,
    nobSize: seedDef.nob_size ?? 1,
    crossChance: seedDef.cross_chance ?? 0,
    crossLength: seedDef.cross_length ?? 3,
    shroomChance: seedDef.shroom_chance ?? 0,
    shroomLength: seedDef.shroom_length ?? 5,
    shroomCapDiameter: seedDef.shroom_cap_diameter ?? 3,
    symmetry: seedDef.symmetry ?? 'none',
  };
}

/**
 * Repair missing blueprints for any trees (incomplete or fully grown).
 * Uses growth_seed + seed_definition to regenerate the exact same blueprint.
 * Fully-grown trees need blueprints for fruit spawning and chopping.
 */
async function repairMissingBlueprints(trees: PlantedTree[]): Promise<void> {
  if (trees.length === 0) return;

  // Check which trees have blueprints (batch in groups of 100 to avoid query limits)
  const treeIds = trees.map(t => t.id);
  const hasBlueprint = new Set<string>();
  for (let i = 0; i < treeIds.length; i += 100) {
    const batch = treeIds.slice(i, i + 100);
    const { data: existingBps } = await supabase
      .from('tree_blueprints' as any)
      .select('planted_tree_id')
      .in('planted_tree_id', batch);
    for (const bp of (existingBps || []) as any[]) {
      hasBlueprint.add(bp.planted_tree_id);
    }
  }

  const missingTrees = trees.filter(t => !hasBlueprint.has(t.id) && t.seed_definition);

  if (missingTrees.length === 0) return;

  console.log(`[TreeData] Repairing ${missingTrees.length} missing blueprints...`);

  for (const tree of missingTrees) {
    const seedDef = tree.seed_definition!;
    const treeType = seedDef.tree_type || 'original';

    try {
      let blueprint;
      if (treeType === 'fungal') {
        blueprint = generateFungalTreeBlueprint(
          tree.base_x, tree.base_y, tree.base_z,
          seedDef.tier,
          tree.growth_seed,
          seedDef
        );
      } else if (treeType === 'wide') {
        blueprint = generateWideTreeBlueprint(
          tree.base_x, tree.base_y, tree.base_z,
          seedDef.tier,
          tree.growth_seed,
          seedDef
        );
      } else {
        blueprint = generateTreeBlueprint(
          tree.base_x, tree.base_y, tree.base_z,
          seedDef.tier,
          seedDef.width_factor,
          seedDef.branching_factor,
          tree.growth_seed,
          buildGrowthOptions(seedDef)
        );
      }

      const { error } = await (supabase
        .from('tree_blueprints' as any)
        .insert({
          planted_tree_id: tree.id,
          world_id: tree.world_id,
          blueprint_data: {
            blocks: blueprint.blocks,
            maxHeight: blueprint.maxHeight,
            maxWidth: blueprint.maxWidth,
            tier: seedDef.tier,
            seedDefId: seedDef.id,
            treeType: treeType,
          },
          block_count: blueprint.blocks.length,
        } as any) as any);

      if (error) {
        console.error(`[TreeData] Blueprint repair failed for tree ${tree.id.slice(0, 8)}:`, error.message);
      } else {
        console.log(`[TreeData] Blueprint repaired for tree ${tree.id.slice(0, 8)} (${blueprint.blocks.length} blocks)`);
      }
    } catch (err) {
      console.error(`[TreeData] Blueprint generation failed for tree ${tree.id.slice(0, 8)}:`, err);
    }
  }
}

export function useTreeData(
  worldId: string | null,
  userId: string | null = null
): TreeData & {
  refetch: () => Promise<void>;
  removeFruit: (fruitId: string) => void;
} {
  const [plantedTrees, setPlantedTrees] = useState<PlantedTree[]>([]);
  const [treeFruits, setTreeFruits] = useState<TreeFruit[]>([]);
  const [seedDefinitions, setSeedDefinitions] = useState<SeedDefinition[]>([]);
  const [myIncompleteTrees, setMyIncompleteTrees] = useState<PlantedTree[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const blueprintRepairDoneRef = useRef(false);

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

      // Also fetch user's own incomplete trees separately (for resuming growth)
      const myIncompleteQuery = userId 
        ? supabase
            .from('planted_trees')
            .select('*, seed_definitions(*)')
            .eq('world_id', worldId)
            .eq('planted_by', userId)
            .eq('is_fully_grown', false)
        : null;

      const [treesRes, fruitsRes, seedsRes, myIncompleteRes] = await Promise.all([
        treesQuery,
        supabase
          .from('tree_fruits')
          .select('*')
          .eq('world_id', worldId),
        supabase
          .from('seed_definitions')
          .select('*')
          .order('tier', { ascending: true }),
        myIncompleteQuery,
      ]);

      if (treesRes.error) throw treesRes.error;
      if (fruitsRes.error) throw fruitsRes.error;
      if (seedsRes.error) throw seedsRes.error;

      // Map the joined data correctly, excluding deleted trees
      const mappedTrees = (treesRes.data || [])
        .filter(tree => !isTreeDeleted(tree.id))
        .map(tree => ({
          ...tree,
          seed_definition: tree.seed_definitions as unknown as SeedDefinition,
        })) as PlantedTree[];

      // Map my incomplete trees as well, excluding deleted
      const mappedIncomplete = myIncompleteRes?.data
        ? (myIncompleteRes.data || [])
            .filter(tree => !isTreeDeleted(tree.id))
            .map(tree => ({
              ...tree,
              seed_definition: tree.seed_definitions as unknown as SeedDefinition,
            })) as PlantedTree[]
        : [];

      // Log planted trees by tier for initialization overlay
      const seedDefs = (seedsRes.data || []) as SeedDefinition[];
      const treesByTier = new Map<number, number>();
      for (const tree of mappedTrees) {
        const tier = tree.seed_definition?.tier || 0;
        treesByTier.set(tier, (treesByTier.get(tier) || 0) + 1);
      }
      
      // Log seed definitions count
      initLogStep('useTreeData.ts', `Seed definitions loaded`, seedDefs.length);
      
      // Log trees by tier (only non-zero, sorted T1 to T30)
      const sortedTiers = Array.from(treesByTier.entries()).sort((a, b) => a[0] - b[0]);
      if (sortedTiers.length > 0) {
        for (const [tier, count] of sortedTiers) {
          initLogStep('useTreeData.ts', `Planted Trees T${tier}`, count);
        }
      } else {
        initLogStep('useTreeData.ts', 'No planted trees in world');
      }

      // Combine main trees with user's own incomplete trees (deduplicated)
      const incompleteIds = new Set(mappedIncomplete.map(t => t.id));
      const combined = [
        ...mappedTrees.filter(t => !incompleteIds.has(t.id)),
        ...mappedIncomplete,
      ];
      setPlantedTrees(combined);
      setTreeFruits((fruitsRes.data || []) as TreeFruit[]);
      setSeedDefinitions(seedDefs);
      setMyIncompleteTrees(mappedIncomplete);

      // Repair missing blueprints for ALL trees (incomplete + fully grown)
      // Fully-grown trees need blueprints for fruit spawning and chopping
      const treesNeedingBlueprints = combined.filter(t => t.seed_definition);
      if (treesNeedingBlueprints.length > 0 && !blueprintRepairDoneRef.current) {
        blueprintRepairDoneRef.current = true;
        repairMissingBlueprints(treesNeedingBlueprints).catch(err => {
          console.error('[TreeData] Blueprint repair error:', err);
        });
      }
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
            const newTree = payload.new as any;
            if (isTreeDeleted(newTree.id)) {
              console.log(`[useTreeData] Ignoring INSERT for deleted tree: ${newTree.id.slice(0, 8)}`);
              return;
            }
            // Refetch for any new tree (including user's own growing trees)
            fetchData();
          } else if (payload.eventType === 'UPDATE') {
            const updatedTree = payload.new as any;
            // Ignore updates for deleted trees
            if (isTreeDeleted(updatedTree.id)) {
              console.log(`[useTreeData] Ignoring UPDATE for deleted tree: ${updatedTree.id.slice(0, 8)}`);
              return;
            }
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
            console.log(`[useTreeData] Received DELETE event for tree: ${payload.old.id?.slice(0, 8)}`);
            // Mark as deleted (in case it wasn't already)
            markTreeDeleted(payload.old.id);
            setPlantedTrees(prev => prev.filter(t => t.id !== payload.old.id));
            setMyIncompleteTrees(prev => prev.filter(t => t.id !== payload.old.id));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(fruitsChannel);
      supabase.removeChannel(treesChannel);
    };
  }, [worldId, userId, fetchData]);

  // Separate subscription for seed_definitions (global, not dependent on worldId)
  useEffect(() => {
    if (!TREE_CONFIG.ENABLED) return;

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
      supabase.removeChannel(seedsChannel);
    };
  }, []);

  // Immediately remove a fruit from local state (for instant visual removal on harvest)
  const removeFruit = useCallback((fruitId: string) => {
    setTreeFruits(prev => prev.filter(f => f.id !== fruitId));
  }, []);

  // Immediately remove a tree from local state (for instant UI updates when chopping)
  // Also marks tree as deleted to prevent it from coming back via realtime/refetch/growth
  const removeTree = useCallback((treeId: string) => {
    console.log(`[useTreeData] removeTree called for treeId: ${treeId.slice(0, 8)}`);

    // Mark as deleted in the central deletion tracker (prevents resurrection everywhere)
    markTreeDeleted(treeId);

    setPlantedTrees(prev => {
      const filtered = prev.filter(t => t.id !== treeId);
      console.log(`[useTreeData] plantedTrees: ${prev.length} -> ${filtered.length} (removed: ${prev.length - filtered.length})`);
      return filtered;
    });
    setMyIncompleteTrees(prev => {
      const filtered = prev.filter(t => t.id !== treeId);
      console.log(`[useTreeData] myIncompleteTrees: ${prev.length} -> ${filtered.length}`);
      return filtered;
    });
  }, []);

  return {
    plantedTrees,
    treeFruits,
    seedDefinitions,
    myIncompleteTrees,
    isLoading,
    error,
    refetch: fetchData,
    removeTree,  // For immediate UI updates when chopping
    removeFruit, // For immediate UI updates when harvesting
  };
}
