// Hook for managing tree growth timing
// Runs growth loop for trees owned by the current user

import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { PlantedTree } from '../types';
import { generateTreeBlueprint, getNextGrowthBlock } from '../lib/treeGrowth';
import { TREE_CONFIG, getGrowthInterval } from '../constants';

// Type for the placeBlock function from useBlocks
type PlaceBlockFn = (x: number, y: number, z: number, blockType: string, expiresAt?: string, textureUrl?: string) => any;

interface UseTreeGrowthOptions {
  worldId: string | null;
  userId: string | null;
  plantedTrees: PlantedTree[];
  placeBlock: PlaceBlockFn | null; // Inject placeBlock for optimistic updates
  onGrowth?: (treeId: string, blockCount: number) => void;
}

export function useTreeGrowth({
  worldId,
  userId,
  plantedTrees,
  placeBlock,
  onGrowth,
}: UseTreeGrowthOptions): void {
  // Track local block counts to avoid re-reading stale plantedTrees data
  const localBlockCounts = useRef<Map<string, number>>(new Map());
  const lastGrowthTime = useRef<Map<string, number>>(new Map());
  const isGrowing = useRef(false);

  const growTreeByOne = useCallback(async (tree: PlantedTree): Promise<boolean> => {
    if (!tree.seed_definition || !placeBlock) {
      return false;
    }

    const seedDef = tree.seed_definition;
    
    // Use local count if available, otherwise use DB count
    const currentCount = localBlockCounts.current.get(tree.id) ?? tree.current_block_count;

    // Generate blueprint (deterministic from seed)
    const blueprint = generateTreeBlueprint(
      tree.base_x,
      tree.base_y,
      tree.base_z,
      seedDef.tier,
      seedDef.width_factor,
      seedDef.branching_factor,
      tree.growth_seed
    );

    // Find next block to grow based on local count
    const nextBlock = getNextGrowthBlock(blueprint, currentCount);
    
    if (!nextBlock) {
      // Tree is fully grown
      await supabase
        .from('planted_trees')
        .update({ is_fully_grown: true })
        .eq('id', tree.id);
      return false;
    }

    // Use placeBlock from useBlocks for INSTANT optimistic update!
    // This makes the block appear immediately in the UI
    const placedBlock = placeBlock(nextBlock.x, nextBlock.y, nextBlock.z, 'trunk');

    if (!placedBlock) {
      // Position might be occupied - still increment count to continue growth
      localBlockCounts.current.set(tree.id, currentCount + 1);
      return true;
    }

    // Update local and remote counts
    const newBlockCount = currentCount + 1;
    localBlockCounts.current.set(tree.id, newBlockCount);
    lastGrowthTime.current.set(tree.id, Date.now());

    // Update tree progress in DB (async, doesn't block UI)
    supabase
      .from('planted_trees')
      .update({
        current_block_count: newBlockCount,
        last_growth_at: new Date().toISOString(),
        is_fully_grown: newBlockCount >= tree.target_block_count,
      })
      .eq('id', tree.id)
      .then(() => {});

    onGrowth?.(tree.id, newBlockCount);
    return true;
  }, [placeBlock, onGrowth]);

  // Main growth loop - processes one tree at a time
  useEffect(() => {
    if (!worldId || !userId || !TREE_CONFIG.ENABLED || !placeBlock) return;

    const checkGrowth = async () => {
      // Prevent concurrent growth operations
      if (isGrowing.current) return;
      isGrowing.current = true;

      try {
        const now = Date.now();

        // Find a tree that needs growth
        for (const tree of plantedTrees) {
          if (tree.is_fully_grown) continue;
          if (tree.planted_by !== userId) continue;
          if (!tree.seed_definition) continue;

          const interval = getGrowthInterval(tree.seed_definition.growth_factor);
          const lastGrowth = lastGrowthTime.current.get(tree.id) || new Date(tree.last_growth_at).getTime();
          
          // Check if enough time has passed
          if (now - lastGrowth >= interval) {
            await growTreeByOne(tree);
            break; // Only grow one tree per tick to spread load
          }
        }
      } finally {
        isGrowing.current = false;
      }
    };

    // Growth check interval - 200ms is responsive enough for 100ms growth intervals
    const interval = setInterval(checkGrowth, 200);
    
    // Initial check
    setTimeout(checkGrowth, 50);

    return () => clearInterval(interval);
  }, [worldId, userId, plantedTrees, placeBlock, growTreeByOne]);

  // Sync local counts when plantedTrees updates from DB
  useEffect(() => {
    for (const tree of plantedTrees) {
      const localCount = localBlockCounts.current.get(tree.id);
      // Only update if DB has higher count (another client grew the tree)
      if (localCount === undefined || tree.current_block_count > localCount) {
        localBlockCounts.current.set(tree.id, tree.current_block_count);
      }
    }
  }, [plantedTrees]);
}
