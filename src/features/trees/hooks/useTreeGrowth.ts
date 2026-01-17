// Hook for managing tree growth timing
// Runs growth loop for trees owned by the current user

import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { PlantedTree, SeedDefinition } from '../types';
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
  const lastGrowthCheck = useRef<Map<string, number>>(new Map());

  const growTreeByOne = useCallback(async (tree: PlantedTree): Promise<boolean> => {
    if (!tree.seed_definition) {
      console.warn('[TreeGrowth] No seed definition for tree:', tree.id);
      return false;
    }

    const seedDef = tree.seed_definition;

    // Generate blueprint (recalculated each time - deterministic from seed)
    const blueprint = generateTreeBlueprint(
      tree.base_x,
      tree.base_y,
      tree.base_z,
      seedDef.tier,
      seedDef.width_factor,
      seedDef.branching_factor,
      tree.growth_seed
    );

    // Find next block to grow
    const nextBlock = getNextGrowthBlock(blueprint, tree.current_block_count);
    
    if (!nextBlock) {
      // Tree is fully grown
      const { error } = await supabase
        .from('planted_trees')
        .update({ is_fully_grown: true })
        .eq('id', tree.id);
      
      if (error) {
        console.error('[TreeGrowth] Failed to mark tree as fully grown:', error);
      }
      return false;
    }

    // Insert the new block
    const { error: blockError } = await supabase
      .from('tree_blocks')
      .insert({
        tree_id: tree.id,
        world_id: tree.world_id,
        position_x: nextBlock.x,
        position_y: nextBlock.y,
        position_z: nextBlock.z,
        block_type: nextBlock.type,
        growth_order: nextBlock.growthOrder,
      });

    if (blockError) {
      // Might be duplicate position - skip
      if (blockError.code === '23505') {
        console.warn('[TreeGrowth] Block position already exists, skipping');
      } else {
        console.error('[TreeGrowth] Failed to insert block:', blockError);
        return false;
      }
    }

    // Update tree progress
    const newBlockCount = tree.current_block_count + 1;
    const { error: updateError } = await supabase
      .from('planted_trees')
      .update({
        current_block_count: newBlockCount,
        last_growth_at: new Date().toISOString(),
        is_fully_grown: newBlockCount >= tree.target_block_count,
      })
      .eq('id', tree.id);

    if (updateError) {
      console.error('[TreeGrowth] Failed to update tree progress:', updateError);
      return false;
    }

    onGrowth?.(tree.id, newBlockCount);
    return true;
  }, [onGrowth]);

  // Main growth loop
  useEffect(() => {
    if (!worldId || !userId || !TREE_CONFIG.ENABLED) return;

    const checkGrowth = async () => {
      const now = Date.now();

      // Filter to trees that need growth
      const treesToGrow = plantedTrees.filter(tree => {
        if (tree.is_fully_grown) return false;
        if (tree.planted_by !== userId) return false;
        if (!tree.seed_definition) return false;

        const lastCheck = lastGrowthCheck.current.get(tree.id) || 0;
        const interval = getGrowthInterval(tree.seed_definition.growth_factor);
        const lastGrowthTime = new Date(tree.last_growth_at).getTime();
        
        // Check if enough time has passed since last growth
        return (now - lastGrowthTime >= interval) && (now - lastCheck >= interval);
      });

      // Grow each tree by one block
      for (const tree of treesToGrow) {
        lastGrowthCheck.current.set(tree.id, now);
        await growTreeByOne(tree);
      }
    };

    // Check every second
    const interval = setInterval(checkGrowth, 1000);
    
    // Initial check
    checkGrowth();

    return () => clearInterval(interval);
  }, [worldId, userId, plantedTrees, growTreeByOne]);
}
