// Hook for managing tree growth timing
// Runs growth loop for trees owned by the current user

import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { PlantedTree } from '../types';
import { generateTreeBlueprint, getNextGrowthBlock } from '../lib/treeGrowth';
import { TREE_CONFIG, getGrowthInterval } from '../constants';

interface UseTreeGrowthOptions {
  worldId: string | null;
  userId: string | null;
  plantedTrees: PlantedTree[];
  onGrowth?: (treeId: string, blockCount: number) => void;
}

export function useTreeGrowth({
  worldId,
  userId,
  plantedTrees,
  onGrowth,
}: UseTreeGrowthOptions): void {
  // Track local block counts to avoid re-reading stale plantedTrees data
  const localBlockCounts = useRef<Map<string, number>>(new Map());
  const lastGrowthTime = useRef<Map<string, number>>(new Map());
  const isGrowing = useRef(false);

  const growTreeByOne = useCallback(async (tree: PlantedTree): Promise<boolean> => {
    if (!tree.seed_definition) {
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

    // Insert the new block into placed_blocks (unified block system)
    // Tree blocks are just normal blocks with a texture_url override
    const { error: blockError } = await supabase
      .from('placed_blocks')
      .insert({
        user_id: tree.planted_by,
        world_id: tree.world_id,
        position_x: nextBlock.x,
        position_y: nextBlock.y,
        position_z: nextBlock.z,
        block_type: 'trunk',
        texture_url: seedDef.trunk_texture_url,
      });

    if (blockError) {
      // Duplicate key means block already exists - sync our count
      if (blockError.code === '23505') {
        // Query actual count from placed_blocks for this tree's positions
        // Since we don't track tree_id in placed_blocks, just increment and continue
        localBlockCounts.current.set(tree.id, currentCount + 1);
        return true;
      }
      console.error('[TreeGrowth] Failed to insert block:', blockError);
      return false;
    }

    // Update local and remote counts
    const newBlockCount = currentCount + 1;
    localBlockCounts.current.set(tree.id, newBlockCount);
    lastGrowthTime.current.set(tree.id, Date.now());

    // Update tree progress in DB
    await supabase
      .from('planted_trees')
      .update({
        current_block_count: newBlockCount,
        last_growth_at: new Date().toISOString(),
        is_fully_grown: newBlockCount >= tree.target_block_count,
      })
      .eq('id', tree.id);

    onGrowth?.(tree.id, newBlockCount);
    return true;
  }, [onGrowth]);

  // Main growth loop - processes one tree at a time
  useEffect(() => {
    if (!worldId || !userId || !TREE_CONFIG.ENABLED) return;

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
  }, [worldId, userId, plantedTrees, growTreeByOne]);

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
