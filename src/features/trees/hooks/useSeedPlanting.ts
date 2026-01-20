// Hook for planting seeds
// Handles inventory check, tree creation, seed consumption
// Now saves blueprints to tree_blueprints table for reliable growth/deletion

import { useCallback, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { SeedDefinition, TreeGrowthOptions } from '../types';
import { generateTreeBlueprint, getBlocksAtOrder } from '../lib/treeGrowth';
import { TREE_CONFIG } from '../constants';
import { useToast } from '@/hooks/use-toast';
import { encodeBlockType, getTextureUrlForTreeBlock } from '../lib/blockTypeEncoder';

// Type for the placeBlock function from useBlocks
type PlaceBlockFn = (x: number, y: number, z: number, blockType: string, expiresAt?: string, textureUrl?: string) => any;

// Type for the startGrowing function from useLocalGrowth
type StartGrowingFn = (
  treeId: string,
  seedDef: SeedDefinition,
  baseX: number,
  baseY: number,
  baseZ: number,
  growthSeed: number,
  startingOrder?: number
) => void;

// Type for the updateTreeId function from useLocalGrowth
type UpdateTreeIdFn = (tempId: string, realId: string) => void;

interface UseSeedPlantingOptions {
  worldId: string | null;
  userId: string | null;
  seedDefinitions: SeedDefinition[];
  placeBlock: PlaceBlockFn | null;
  startGrowing: StartGrowingFn;
  updateTreeId: UpdateTreeIdFn;
}

interface PlantSeedResult {
  success: boolean;
  error?: string;
  treeId?: string;
}

/**
 * Build options object from seed definition for tree generation
 */
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

export function useSeedPlanting({
  worldId,
  userId,
  seedDefinitions,
  placeBlock,
  startGrowing,
  updateTreeId,
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

      // Generate blueprint for first block placement and total count
      const blueprint = generateTreeBlueprint(
        baseX, baseY, baseZ,
        seedDef.tier,
        seedDef.width_factor,
        seedDef.branching_factor,
        growthSeed,
        buildGrowthOptions(seedDef)
      );

      // Place the first block(s) IMMEDIATELY using optimistic update system
      // Now using encoded block_type format: {type}_{depth}_{tier}
      const firstBlocks = getBlocksAtOrder(blueprint, 0);
      
      for (const block of firstBlocks) {
        const encodedType = encodeBlockType(block.type, block.branchDepth, seedDef.tier);
        const textureUrl = getTextureUrlForTreeBlock(
          block.type,
          seedDef.trunk_texture_url,
          seedDef.branch_texture_url,
          seedDef.fruit_texture_url
        );
        placeBlock(block.x, block.y, block.z, encodedType, undefined, textureUrl || undefined);
      }

      // Start local growth with temp ID (will update after DB insert)
      const tempId = `temp_${Date.now()}`;
      startGrowing(tempId, seedDef, baseX, baseY, baseZ, growthSeed, 1); // Start at order 1 since we placed order 0

      // Create the planted tree record
      // Server-side trigger will enforce chunk planting limits
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
          current_block_count: firstBlocks.length,
          is_fully_grown: false,
        })
        .select()
        .single();

      if (insertError) {
        console.error('[SeedPlanting] Insert error:', insertError);
        // Check for chunk limit error
        if (insertError.message?.includes('planting limit')) {
          toast({
            title: "Chunk limit reached",
            description: "Too many trees of this tier in this area",
            variant: "destructive"
          });
          return { success: false, error: 'Chunk planting limit exceeded' };
        }
        return { success: false, error: 'Failed to plant seed' };
      }

      // Update the temp ID to the real ID in the growth manager
      updateTreeId(tempId, newTree.id);

      // Save blueprint to tree_blueprints table (for reliable deletion)
      // Fire-and-forget - don't block the UI
      // Note: Cast needed until types are regenerated
      (supabase
        .from('tree_blueprints' as any)
        .insert({
          planted_tree_id: newTree.id,
          world_id: worldId,
          blueprint_data: {
            blocks: blueprint.blocks,
            maxHeight: blueprint.maxHeight,
            maxWidth: blueprint.maxWidth,
            tier: seedDef.tier,
            seedDefId: seedDef.id,
          },
          block_count: blueprint.blocks.length,
        } as any) as any)
        .then(({ error }: { error: any }) => {
          if (error) {
            console.error('[SeedPlanting] Blueprint save error:', error);
          }
        });

      toast({
        title: `Planted ${seedDef.name}!`,
        description: `Growing ${blueprint.blocks.length} blocks`,
      });

      return { success: true, treeId: newTree.id };
    } catch (err) {
      console.error('[SeedPlanting] Error:', err);
      return { success: false, error: 'Unexpected error while planting' };
    } finally {
      setIsPlanting(false);
    }
  }, [worldId, userId, seedDefinitions, placeBlock, toast, startGrowing, updateTreeId]);

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
