// Hook for planting seeds
// Handles inventory check, tree creation, seed consumption
// Now saves blueprints to tree_blueprints table for reliable growth/deletion

import { useCallback, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { SeedDefinition, TreeGrowthOptions, TreeBlueprint } from '../types';
import { generateTreeBlueprint, getBlocksAtOrder } from '../lib/treeGrowth';
import { generateFungalTreeBlueprint, getFungalBlocksAtOrder } from '../lib/fungalTreeGenerator';
import { generateWideTreeBlueprint, getWideBlocksAtOrder } from '../lib/wideTreeGenerator';
import { TREE_CONFIG } from '../constants';
import { useToast } from '@/hooks/use-toast';
import { encodeBlockType, getTextureUrlForTreeBlock } from '../lib/blockTypeEncoder';
import { recordPlantingEvent } from '../lib/treeDiagnosticsStore';

// Type for the placeBlock function from useBlocks
type PlaceBlockFn = (x: number, y: number, z: number, blockType: string, expiresAt?: string, textureUrl?: string) => any;

// NOTE: Server-side tree growth is now handled by the process_tree_growth() database function
// The client only places the first block(s) for immediate visual feedback
// startGrowing and updateTreeId are no longer needed

interface UseSeedPlantingOptions {
  worldId: string | null;
  userId: string | null;
  seedDefinitions: SeedDefinition[];
  placeBlock: PlaceBlockFn | null;
  // Optional water check - prevents planting in water/lava
  checkIsInWater?: (x: number, y: number, z: number) => boolean;
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
    shrineChance: seedDef.shrine_chance ?? 0.0001,
    symmetry: seedDef.symmetry ?? 'none',
    rootStyle: seedDef.root_style ?? 'none',
  };
}

export function useSeedPlanting({
  worldId,
  userId,
  seedDefinitions,
  placeBlock,
  checkIsInWater,
}: UseSeedPlantingOptions) {
  const [isPlanting, setIsPlanting] = useState(false);
  const [selectedSeedTier, setSelectedSeedTier] = useState<number | null>(null);
  const { toast } = useToast();

  const plantSeed = useCallback(async (
    positionX: number,
    positionY: number,
    positionZ: number,
    tier: number,
    forceTreeType?: 'original' | 'fungal' | 'wide'
  ): Promise<PlantSeedResult> => {
    if (!worldId || !userId || !TREE_CONFIG.ENABLED) {
      return { success: false, error: 'Not ready to plant' };
    }

    if (!placeBlock) {
      return { success: false, error: 'Block placement not available' };
    }

    // Find seed definition matching tier AND tree type
    let seedDef = forceTreeType
      ? seedDefinitions.find(s => s.tier === tier && s.tree_type === forceTreeType)
        || seedDefinitions.find(s => s.tier === tier) // fallback to any matching tier
      : seedDefinitions.find(s => s.tier === tier);

    // For fungal trees, create a default seed definition if none exists
    if (!seedDef && forceTreeType === 'fungal') {
      seedDef = {
        id: `fungal-default-${tier}`,
        tier,
        name: `Fungal T${tier}`,
        tree_type: 'fungal',
        trunk_texture_url: null,
        branch_texture_url: null,
        fruit_texture_url: null,
        fungal_stem_texture_url: null,
        fungal_cap_top_texture_url: null,
        fungal_cap_underside_texture_url: null,
        width_factor: 0.5,
        branching_factor: 0.5,
        fruiting_factor: 0.5,
        growth_factor: 0.5,
        cost: tier * 50,
        rarity: 'common',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        low_branch_height: 2,
        spike_chance: 0,
        spike_length: 3,
        nob_chance: 0,
        nob_size: 1,
        cross_chance: 0,
        cross_length: 3,
        shroom_chance: 0,
        shroom_length: 5,
        shroom_cap_diameter: 3,
        symmetry: 'none',
        shrine_chance: 0,
        root_style: 'none',
        fungal_min_height: null,
        fungal_max_height: null,
        fungal_min_cap_width: null,
        fungal_max_cap_width: null,
        fungal_stem_random: null,
        fungal_lean_angle: null,
        fungal_s_curve: null,
      } as SeedDefinition;
    }

    // For wide trees, create a default seed definition if none exists
    if (!seedDef && forceTreeType === 'wide') {
      seedDef = {
        id: `wide-default-${tier}`,
        tier,
        name: `Wide T${tier}`,
        tree_type: 'wide',
        trunk_texture_url: null,
        branch_texture_url: null,
        fruit_texture_url: null,
        fungal_stem_texture_url: null,
        fungal_cap_top_texture_url: null,
        fungal_cap_underside_texture_url: null,
        width_factor: 0.3,
        branching_factor: 0.5,
        fruiting_factor: 0.5,
        growth_factor: 0.5,
        cost: tier * 50,
        rarity: 'common',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        low_branch_height: 2,
        spike_chance: 0,
        spike_length: 4,
        nob_chance: 0,
        nob_size: 1,
        cross_chance: 0,
        cross_length: 4,
        shroom_chance: 0,
        shroom_length: 5,
        shroom_cap_diameter: 3,
        symmetry: 'none',
        shrine_chance: 0,
        root_style: 'none',
        fungal_min_height: null,
        fungal_max_height: null,
        fungal_min_cap_width: null,
        fungal_max_cap_width: null,
        fungal_stem_random: null,
        fungal_lean_angle: null,
        fungal_s_curve: null,
      } as SeedDefinition;
    }

    if (!seedDef) {
      return { success: false, error: `Seed tier ${tier} not found` };
    }

    // Only require name for regular trees, not forced fungal trees
    if (!forceTreeType && (!seedDef.name || seedDef.name.trim() === '')) {
      return { success: false, error: `Seed tier ${tier} is not configured yet` };
    }

    setIsPlanting(true);

    try {
      // Round positions to integers
      const baseX = Math.floor(positionX);
      const baseY = Math.floor(positionY);
      const baseZ = Math.floor(positionZ);

      // Check if position is in water/lava
      if (checkIsInWater && checkIsInWater(baseX, baseY, baseZ)) {
        toast({
          title: "Cannot plant here",
          description: "Trees cannot be planted in water or lava",
          variant: "destructive"
        });
        return { success: false, error: 'Cannot plant trees in water' };
      }

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

      // Generate blueprint based on tree type (forceTreeType overrides seed definition)
      let blueprint: TreeBlueprint;
      const treeType = forceTreeType || seedDef.tree_type || 'original';

      if (treeType === 'fungal') {
        // Fungal trees: giant hollow mushrooms
        blueprint = generateFungalTreeBlueprint(
          baseX, baseY, baseZ,
          seedDef.tier,
          growthSeed,
          seedDef
        );
      } else if (treeType === 'wide') {
        // Wide trees: thick tapering trunks with branching decorations
        blueprint = generateWideTreeBlueprint(
          baseX, baseY, baseZ,
          seedDef.tier,
          growthSeed,
          seedDef
        );
      } else {
        // Original trees: standard branching pattern
        blueprint = generateTreeBlueprint(
          baseX, baseY, baseZ,
          seedDef.tier,
          seedDef.width_factor,
          seedDef.branching_factor,
          growthSeed,
          buildGrowthOptions(seedDef)
        );
      }

      // Place the first block(s) IMMEDIATELY using optimistic update system
      // Now using encoded block_type format: {type}_{depth}_{tier}
      const firstBlocks = treeType === 'fungal'
        ? getFungalBlocksAtOrder(blueprint, 0)
        : treeType === 'wide'
        ? getWideBlocksAtOrder(blueprint, 0)
        : getBlocksAtOrder(blueprint, 0);

      for (const block of firstBlocks) {
        const encodedType = encodeBlockType(block.type, block.branchDepth, seedDef.tier);
        // Use fungal textures for fungal trees, falling back to original textures
        const trunkTex = treeType === 'fungal'
          ? (seedDef.fungal_stem_texture_url || seedDef.trunk_texture_url)
          : seedDef.trunk_texture_url;
        const branchTex = treeType === 'fungal'
          ? (seedDef.fungal_stem_texture_url || seedDef.branch_texture_url)
          : seedDef.branch_texture_url;
        const fruitTex = treeType === 'fungal'
          ? (seedDef.fungal_cap_top_texture_url || seedDef.fruit_texture_url)
          : seedDef.fruit_texture_url;
        const textureUrl = getTextureUrlForTreeBlock(block.type, trunkTex, branchTex, fruitTex);
        placeBlock(block.x, block.y, block.z, encodedType, undefined, textureUrl || undefined);
      }

      // NOTE: Tree growth is now handled server-side by the process_tree_growth() function
      // The server will pick up this tree and grow it based on elapsed time

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

      // Save blueprint to tree_blueprints table (required for server-side growth)
      // Must succeed for growth to work - await it
      const { error: blueprintError } = await (supabase
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
            treeType: treeType,
          },
          block_count: blueprint.blocks.length,
        } as any) as any);

      const bpSaved = !blueprintError;
      if (blueprintError) {
        console.error('[SeedPlanting] Blueprint save FAILED:', blueprintError.message || blueprintError.code || JSON.stringify(blueprintError));
      } else {
        console.log('[SeedPlanting] Blueprint saved successfully');
      }

      recordPlantingEvent({
        timestamp: Date.now(),
        position: { x: baseX, y: baseY, z: baseZ },
        tier: seedDef.tier,
        treeType: treeType,
        blueprintSaved: bpSaved,
        blueprintBlockCount: blueprint.blocks.length,
        seedDefId: seedDef.id,
        treeId: newTree.id,
        error: blueprintError ? (blueprintError.message || blueprintError.code || 'Blueprint save failed') : undefined,
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
