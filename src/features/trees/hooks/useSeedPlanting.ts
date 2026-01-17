// Hook for planting seeds
// Handles inventory check, tree creation, seed consumption

import { useCallback, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { SeedDefinition, PlantedTree } from '../types';
import { generateTreeBlueprint } from '../lib/treeGrowth';
import { TREE_CONFIG } from '../constants';
import { useToast } from '@/hooks/use-toast';

// Type for the placeBlock function from useBlocks
type PlaceBlockFn = (x: number, y: number, z: number, blockType: string, expiresAt?: string, textureUrl?: string) => any;

interface UseSeedPlantingOptions {
  worldId: string | null;
  userId: string | null;
  seedDefinitions: SeedDefinition[];
  placeBlock: PlaceBlockFn | null; // Inject placeBlock for optimistic updates
}

interface PlantSeedResult {
  success: boolean;
  error?: string;
  treeId?: string;
  tree?: PlantedTree; // Return full tree for optimistic addition to plantedTrees
}

export function useSeedPlanting({
  worldId,
  userId,
  seedDefinitions,
  placeBlock,
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

    if (!placeBlock) {
      return { success: false, error: 'Block placement not available' };
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

      // Place the first block IMMEDIATELY using optimistic update system
      // This appears instantly in the UI before any DB operations complete
      const firstBlock = blueprint.blocks.find(b => b.growthOrder === 0);
      if (firstBlock) {
        // Use placeBlock from useBlocks - instant optimistic update with texture!
        placeBlock(firstBlock.x, firstBlock.y, firstBlock.z, 'trunk', undefined, seedDef.trunk_texture_url || undefined);
      }

      // Create the planted tree record (async, doesn't block visibility)
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

      toast({
        title: `Planted ${seedDef.name}!`,
        description: `Growing ${blueprint.blocks.length} blocks`,
      });

      // Return the full tree with seed_definition for optimistic addition to plantedTrees
      const fullTree: PlantedTree = {
        ...newTree,
        seed_definition: seedDef,
      };

      return { success: true, treeId: newTree.id, tree: fullTree };
    } catch (err) {
      console.error('[SeedPlanting] Error:', err);
      return { success: false, error: 'Unexpected error while planting' };
    } finally {
      setIsPlanting(false);
    }
  }, [worldId, userId, seedDefinitions, placeBlock, toast]);

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
