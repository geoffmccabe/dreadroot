// Local Growth Manager - Ref-based growth system
// Stores growing trees in refs, not React state, to prevent flashing
// Growth check runs once per second max

import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { SeedDefinition, PlantedTree, TreeBlueprint, TreeGrowthOptions } from '../types';
import { generateTreeBlueprint, getBlocksAtOrder, getMaxGrowthOrder } from '../lib/treeGrowth';
import { TREE_CONFIG, getGrowthInterval } from '../constants';

// Check interval - 1 second max for FPS optimization
const GROWTH_CHECK_INTERVAL = 1000;

// Type for the placeBlock function from useBlocks
type PlaceBlockFn = (x: number, y: number, z: number, blockType: string, expiresAt?: string, textureUrl?: string) => any;

interface GrowingTree {
  id: string;
  blueprint: TreeBlueprint;
  currentOrder: number;
  lastGrowthTime: number;
  growthInterval: number;
  textureUrl: string | undefined;
  seedDefId: string;
  baseX: number;
  baseY: number;
  baseZ: number;
  growthSeed: number;
}

interface UseLocalGrowthOptions {
  worldId: string | null;
  userId: string | null;
  placeBlock: PlaceBlockFn | null;
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

export function useLocalGrowth({
  worldId,
  userId,
  placeBlock,
}: UseLocalGrowthOptions) {
  // All growing trees stored in a ref - no React state = no re-renders
  const growingTreesRef = useRef<Map<string, GrowingTree>>(new Map());
  const placeBlockRef = useRef(placeBlock);
  const isGrowingRef = useRef(false);

  // Keep placeBlock ref in sync
  useEffect(() => {
    placeBlockRef.current = placeBlock;
  }, [placeBlock]);

  /**
   * Start growing a new tree locally
   * Generates blueprint once and stores in ref
   */
  const startGrowing = useCallback((
    treeId: string,
    seedDef: SeedDefinition,
    baseX: number,
    baseY: number,
    baseZ: number,
    growthSeed: number,
    startingOrder: number = 0
  ) => {
    // Generate blueprint once
    const blueprint = generateTreeBlueprint(
      baseX,
      baseY,
      baseZ,
      seedDef.tier,
      seedDef.width_factor,
      seedDef.branching_factor,
      growthSeed,
      buildGrowthOptions(seedDef)
    );

    const growingTree: GrowingTree = {
      id: treeId,
      blueprint,
      currentOrder: startingOrder,
      lastGrowthTime: Date.now(),
      growthInterval: getGrowthInterval(seedDef.growth_factor),
      textureUrl: seedDef.trunk_texture_url || undefined,
      seedDefId: seedDef.id,
      baseX,
      baseY,
      baseZ,
      growthSeed,
    };

    growingTreesRef.current.set(treeId, growingTree);
    console.log(`[LocalGrowth] Started growing tree ${treeId}, ${blueprint.blocks.length} blocks`);
  }, []);

  /**
   * Update tree ID (used when temp ID is replaced with real DB ID)
   */
  const updateTreeId = useCallback((tempId: string, realId: string) => {
    const tree = growingTreesRef.current.get(tempId);
    if (tree) {
      growingTreesRef.current.delete(tempId);
      tree.id = realId;
      growingTreesRef.current.set(realId, tree);
    }
  }, []);

  /**
   * Check if a tree is currently growing locally
   */
  const isTreeGrowing = useCallback((treeId: string): boolean => {
    return growingTreesRef.current.has(treeId);
  }, []);

  // Main growth loop - checks once per second
  useEffect(() => {
    if (!TREE_CONFIG.ENABLED) return;

    const checkGrowth = async () => {
      const placeBlockFn = placeBlockRef.current;
      if (!placeBlockFn || isGrowingRef.current) return;

      isGrowingRef.current = true;
      const now = Date.now();

      try {
        for (const [id, tree] of growingTreesRef.current) {
          // Check if enough time has passed for this tree
          if (now - tree.lastGrowthTime < tree.growthInterval) continue;

          const maxOrder = getMaxGrowthOrder(tree.blueprint);

          // Check if fully grown
          if (tree.currentOrder > maxOrder) {
            // Update DB with final state (async, fire-and-forget)
            supabase
              .from('planted_trees')
              .update({
                is_fully_grown: true,
                current_block_count: tree.blueprint.blocks.length,
                last_growth_at: new Date().toISOString(),
              })
              .eq('id', tree.id)
              .then(() => {
                console.log(`[LocalGrowth] Tree ${id} fully grown`);
              });

            // Remove from growing map
            growingTreesRef.current.delete(id);
            continue;
          }

          // Get blocks at this growth order
          const blocksToPlace = getBlocksAtOrder(tree.blueprint, tree.currentOrder);

          // Place blocks
          for (const block of blocksToPlace) {
            placeBlockFn(block.x, block.y, block.z, 'trunk', undefined, tree.textureUrl);
          }

          // Update ref state (no React re-render)
          tree.currentOrder++;
          tree.lastGrowthTime = now;

          // Only grow one tree per tick to spread load
          break;
        }
      } finally {
        isGrowingRef.current = false;
      }
    };

    // Check once per second
    const intervalId = setInterval(checkGrowth, GROWTH_CHECK_INTERVAL);

    // Initial check after a short delay
    setTimeout(checkGrowth, 100);

    return () => clearInterval(intervalId);
  }, []);

  return {
    startGrowing,
    updateTreeId,
    isTreeGrowing,
    growingTreesRef,
  };
}

/**
 * Delete a tree by regenerating its blueprint and removing all blocks
 * This uses the dormant scaffold stored in planted_trees
 */
export async function deleteTree(
  tree: PlantedTree,
  seedDef: SeedDefinition
): Promise<{ success: boolean; error?: string; deletedCount: number }> {
  try {
    // Regenerate the blueprint from stored seed
    const blueprint = generateTreeBlueprint(
      tree.base_x,
      tree.base_y,
      tree.base_z,
      seedDef.tier,
      seedDef.width_factor,
      seedDef.branching_factor,
      tree.growth_seed,
      buildGrowthOptions(seedDef)
    );

    // Delete all blocks at blueprint positions
    let deletedCount = 0;
    for (const block of blueprint.blocks) {
      const { error } = await supabase
        .from('placed_blocks')
        .delete()
        .eq('world_id', tree.world_id)
        .eq('position_x', block.x)
        .eq('position_y', block.y)
        .eq('position_z', block.z);

      if (!error) deletedCount++;
    }

    // Delete the planted_trees record
    const { error: treeError } = await supabase
      .from('planted_trees')
      .delete()
      .eq('id', tree.id);

    if (treeError) {
      return { success: false, error: 'Failed to delete tree record', deletedCount };
    }

    return { success: true, deletedCount };
  } catch (err) {
    console.error('[deleteTree] Error:', err);
    return { success: false, error: 'Unexpected error', deletedCount: 0 };
  }
}
