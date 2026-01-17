// Hook for planting seeds
// Handles inventory check, tree creation, seed consumption

import { useCallback, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { SeedDefinition } from '../types';
import { generateTreeBlueprint } from '../lib/treeGrowth';
import { TREE_CONFIG } from '../constants';
import { useToast } from '@/hooks/use-toast';

interface UseSeedPlantingOptions {
  worldId: string | null;
  userId: string | null;
  seedDefinitions: SeedDefinition[];
}

interface PlantSeedResult {
  success: boolean;
  error?: string;
  treeId?: string;
}

export function useSeedPlanting({
  worldId,
  userId,
  seedDefinitions,
}: UseSeedPlantingOptions) {
  const [isPlanting, setIsPlanting] = useState(false);
  const [selectedSeedTier, setSelectedSeedTier] = useState<number | null>(null);
  const { toast } = useToast();

  const plantSeed = useCallback(async (
    positionX: number,
    positionY: number,
    positionZ: number,
    tier: number
  ): Promise<PlantSeedResult> => {
    if (!worldId || !userId || !TREE_CONFIG.ENABLED) {
      return { success: false, error: 'Not ready to plant' };
    }

    const seedDef = seedDefinitions.find(s => s.tier === tier);
    if (!seedDef) {
      return { success: false, error: `Seed tier ${tier} not found` };
    }
    
    // Only allow planting seeds that have a name configured
    if (!seedDef.name || seedDef.name.trim() === '') {
      return { success: false, error: `Seed tier ${tier} is not configured yet` };
    }

    setIsPlanting(true);

    try {
      // Round positions to integers
      const baseX = Math.floor(positionX);
      const baseY = Math.floor(positionY);
      const baseZ = Math.floor(positionZ);

      // Check if position is already occupied by a tree
      const { data: existing } = await supabase
        .from('planted_trees')
        .select('id')
        .eq('world_id', worldId)
        .eq('base_x', baseX)
        .eq('base_y', baseY)
        .eq('base_z', baseZ)
        .maybeSingle();

      if (existing) {
        return { success: false, error: 'A tree is already planted here' };
      }

      // Generate random seed for this tree's growth pattern
      const growthSeed = Math.floor(Math.random() * 2147483647);

      // Calculate target block count from blueprint
      const blueprint = generateTreeBlueprint(
        baseX, baseY, baseZ,
        seedDef.tier,
        seedDef.width_factor,
        seedDef.branching_factor,
        growthSeed
      );

      // Create the planted tree record
      const { data: newTree, error: insertError } = await supabase
        .from('planted_trees')
        .insert({
          world_id: worldId,
          seed_definition_id: seedDef.id,
          planted_by: userId,
          base_x: baseX,
          base_y: baseY,
          base_z: baseZ,
          growth_seed: growthSeed,
          target_block_count: blueprint.blocks.length,
          current_block_count: 1, // Start with first block already placed
        })
        .select()
        .single();

      if (insertError) {
        console.error('[SeedPlanting] Insert error:', insertError);
        return { success: false, error: 'Failed to plant seed' };
      }

      // Place the first block immediately so the tree is visible right away
      // Uses the regular placed_blocks table - tree blocks are just normal blocks with a texture_url
      const firstBlock = blueprint.blocks.find(b => b.growthOrder === 0);
      if (firstBlock) {
        await supabase
          .from('placed_blocks')
          .insert({
            user_id: userId,
            world_id: worldId,
            position_x: firstBlock.x,
            position_y: firstBlock.y,
            position_z: firstBlock.z,
            block_type: 'trunk',
            texture_url: seedDef.trunk_texture_url,
          });
      }

      // TODO: Consume seed from inventory when inventory system is integrated
      // For now, planting is free during testing

      toast({
        title: `Planted ${seedDef.name}!`,
        description: `Tier ${tier} tree will grow ${blueprint.blocks.length} blocks`,
      });

      return { success: true, treeId: newTree.id };
    } catch (err) {
      console.error('[SeedPlanting] Error:', err);
      return { success: false, error: 'Unexpected error while planting' };
    } finally {
      setIsPlanting(false);
    }
  }, [worldId, userId, seedDefinitions, toast]);

  const cancelPlanting = useCallback(() => {
    setSelectedSeedTier(null);
  }, []);

  return {
    plantSeed,
    isPlanting,
    selectedSeedTier,
    setSelectedSeedTier,
    cancelPlanting,
  };
}
