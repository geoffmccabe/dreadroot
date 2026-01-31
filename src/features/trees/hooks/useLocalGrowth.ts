// Local Growth Manager - Server-Side Growth Architecture
// Tree growth is now handled server-side by the process_tree_growth() database function
// This file only contains tree deletion logic and exports

import { supabase } from '@/integrations/supabase/client';
import { SeedDefinition, PlantedTree, TreeGrowthOptions } from '../types';
import { generateTreeBlueprint } from '../lib/treeGrowth';
import { generateFungalTreeBlueprint } from '../lib/fungalTreeGenerator';
import { worldCollisionGrid } from '@/lib/spatialHashGrid';

// Set of tree IDs that have been deleted - prevents race conditions
const deletedTreeIds = new Set<string>();

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

/**
 * Mark all current growing trees as deleted (legacy - now a no-op)
 * Kept for backwards compatibility with cleanup code
 */
export function markAllTreesDeleted() {
  // No-op - server handles growth now
}

/**
 * Clear all pending blocks (legacy - now a no-op)
 */
export function clearAllPendingBlocks() {
  // No-op - server handles growth now
}

/**
 * Clear pending blocks for a specific tree (legacy - now a no-op)
 */
export function clearPendingBlocksForTree(_treeId: string) {
  // No-op - server handles growth now
}

/**
 * Clear all growing trees from memory (legacy - now a no-op)
 */
export function clearGrowingTrees() {
  // No-op - server handles growth now
}

/**
 * Check if a tree ID has been marked as deleted
 */
export function isTreeDeleted(treeId: string): boolean {
  return deletedTreeIds.has(treeId);
}

/**
 * Mark a tree as deleted
 */
export function markTreeDeleted(treeId: string): void {
  deletedTreeIds.add(treeId);
}

/**
 * Stub hook for backwards compatibility
 * Growth is now server-side, so this just returns empty functions
 */
export function useLocalGrowth() {
  return {
    startGrowing: () => {},
    updateTreeId: () => {},
    isTreeGrowing: () => false,
    stopGrowing: (treeId: string) => {
      deletedTreeIds.add(treeId);
    },
    growingTreesRef: { current: new Map() },
  };
}

/**
 * Delete a tree using the tree_blueprints table
 * Falls back to blueprint regeneration if tree_blueprints is empty
 *
 * IMPORTANT: Uses delete_tree_with_blocks RPC for ownership-verified deletion
 * Admin/superadmin can bypass ownership check with isAdmin=true
 */
export async function deleteTree(
  tree: PlantedTree,
  seedDef: SeedDefinition,
  removeBlocksByPositions?: (positions: Array<{ x: number; y: number; z: number }>) => number,
  isAdmin: boolean = false
): Promise<{ success: boolean; error?: string; deletedCount: number }> {
  try {
    // Add tree to deleted set to prevent any issues
    deletedTreeIds.add(tree.id);

    // Get current user for ownership check
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Not authenticated', deletedCount: 0 };
    }

    // First try to get blueprint from tree_blueprints table
    const { data: blueprintData, error: bpError } = await supabase
      .from('tree_blueprints')
      .select('blueprint_data')
      .eq('planted_tree_id', tree.id)
      .maybeSingle();

    let blocksToDelete: { x: number; y: number; z: number }[] = [];

    if (!bpError && blueprintData?.blueprint_data) {
      // Use stored blueprint
      const bp = blueprintData.blueprint_data as { blocks: Array<{ x: number; y: number; z: number }> };
      blocksToDelete = bp.blocks.map(b => ({ x: b.x, y: b.y, z: b.z }));
    } else {
      // Regenerate blueprint from seed definition
      const treeType = seedDef.tree_type || 'original';
      let blueprint;
      if (treeType === 'fungal') {
        blueprint = generateFungalTreeBlueprint(
          tree.base_x, tree.base_y, tree.base_z,
          seedDef.tier, tree.growth_seed, seedDef
        );
      } else {
        blueprint = generateTreeBlueprint(
          tree.base_x, tree.base_y, tree.base_z,
          seedDef.tier, seedDef.width_factor, seedDef.branching_factor,
          tree.growth_seed, buildGrowthOptions(seedDef)
        );
      }
      blocksToDelete = blueprint.blocks.map(b => ({ x: b.x, y: b.y, z: b.z }));
    }

    // STEP 1: INSTANT local removal (blocks disappear immediately)
    let locallyRemoved = 0;
    if (removeBlocksByPositions) {
      locallyRemoved = removeBlocksByPositions(blocksToDelete);
    } else {
      // Fallback: manual collider removal
      for (const block of blocksToDelete) {
        worldCollisionGrid.removeByPosition(block.x, block.y, block.z);
      }
    }

    // STEP 2: Database deletion via RPC
    const effectiveUserId = isAdmin ? tree.planted_by : user.id;

    if (isAdmin) {
      console.log(`[deleteTree] Admin bypass - using tree owner ID: ${tree.planted_by.slice(0, 8)}`);
    }

    const { data: rpcResult, error: rpcError } = await supabase
      .rpc('delete_tree_with_blocks', {
        p_tree_id: tree.id,
        p_user_id: effectiveUserId,
        p_world_id: tree.world_id,
        p_block_positions: blocksToDelete,
      });

    if (rpcError) {
      console.error('[deleteTree] RPC error:', rpcError);
      // Fallback: direct deletion
      console.log('[deleteTree] Attempting fallback deletion...');
      const { error: bpErr } = await supabase.from('tree_blueprints').delete().eq('planted_tree_id', tree.id);
      if (bpErr) console.warn('[deleteTree] Blueprint delete failed:', bpErr);

      const { error: treeErr } = await supabase.from('planted_trees').delete().eq('id', tree.id);
      if (treeErr) {
        console.error('[deleteTree] Tree record delete failed:', treeErr);
        return { success: false, error: 'Failed to delete tree', deletedCount: locallyRemoved };
      }
    } else if (rpcResult && !(rpcResult as any).success) {
      console.error('[deleteTree] RPC returned failure:', rpcResult);
      return { success: false, error: (rpcResult as any).error, deletedCount: locallyRemoved };
    }

    return { success: true, deletedCount: locallyRemoved };
  } catch (err) {
    return { success: false, error: 'Unexpected error', deletedCount: 0 };
  }
}
