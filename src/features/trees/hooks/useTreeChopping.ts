// Hook for chopping down trees and returning seeds to inventory
// Only the tree owner can chop their tree
// NEW ARCHITECTURE: Uses delete_tree_with_blocks RPC with blueprint positions

import { useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { worldStore } from '@/services/worldStore';
import { PlantedTree, SeedDefinition, TreeBlueprint, TreeGrowthOptions } from '../types';
import { deleteTree } from './useLocalGrowth';
import { useToast } from '@/hooks/use-toast';
import { blockDB } from '@/hooks/useIndexedDB';
import { collisionGrid } from '@/lib/spatialHashGrid';
import { generateTreeBlueprint } from '../lib/treeGrowth';
import { generateFungalTreeBlueprint } from '../lib/fungalTreeGenerator';
import { getSoundUrl } from '@/hooks/useGameSounds';

// Throttle chopping to prevent accidental double-chops
const CHOP_COOLDOWN_MS = 1000;
const CHUNK_SIZE = 16;

/**
 * Return a seed to a specific user's inventory (used when admin chops another user's tree).
 * Caller must hold the 'admin' app_role — enforced server-side by the RPC.
 */
export async function returnSeedToUser(seedDefId: string, seedDef: SeedDefinition, targetUserId: string): Promise<boolean> {
  try {
    await worldStore.adminGrantInventoryRow(
      targetUserId,
      `seed_tier_${seedDef.tier}`,
      seedDefId,
      1,
    );
    console.log(`[returnSeedToUser] Seed returned to user ${targetUserId.slice(0, 8)}`);
    return true;
  } catch (err) {
    console.error('[returnSeedToUser] admin_grant_inventory_row failed:', err);
    return false;
  }
}

interface UseTreeChoppingOptions {
  worldId: string | null;
  userId: string | null;
  userRoles?: string[];  // For admin/superadmin bypass
  plantedTrees: PlantedTree[];
  seedDefinitions: SeedDefinition[];
  returnSeed: (seedDefId: string) => Promise<boolean>;
  refetchChunk: (chunkX: number, chunkZ: number) => Promise<void>;
  refetchTrees?: () => Promise<void>;  // Force refresh tree data after chopping
  removeTreeFromState?: (treeId: string) => void;  // Immediately remove tree from local state
  stopGrowing?: (treeId: string) => void;
  removeBlocksByPositions?: (positions: Array<{ x: number; y: number; z: number }>) => number;
  onTreeChopped?: (tree: PlantedTree) => void;  // Callback when tree is successfully chopped (for Shnake cleanup etc)
}

interface ChopResult {
  success: boolean;
  error?: string;
  seedReturned?: boolean;
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

/**
 * Find which tree a block at the given position belongs to
 * Returns the CLOSEST tree by horizontal distance to avoid matching the wrong tree
 * when multiple trees have overlapping bounds
 */
function findTreeAtPosition(
  x: number,
  y: number,
  z: number,
  plantedTrees: PlantedTree[]
): PlantedTree | null {
  let closestTree: PlantedTree | null = null;
  let closestDistance = Infinity;

  for (const tree of plantedTrees) {
    const dx = Math.abs(x - tree.base_x);
    const dy = y - tree.base_y; // y should be at or above base
    const dz = Math.abs(z - tree.base_z);

    // Trees can spread based on tier, width_factor, and tree type
    const widthFactor = tree.seed_definition?.width_factor ?? 1;
    const tier = tree.seed_definition?.tier ?? 5;
    const treeType = tree.seed_definition?.tree_type || 'original';
    const maxSpread = treeType === 'fungal'
      ? Math.max(50, tier * 6) // Fungal caps can be very wide
      : Math.max(tier * 4 * widthFactor, 10);
    const maxHeight = treeType === 'fungal'
      ? 100 // Fungal trees: stem + gap + cap
      : tier * 12;

    // Check if position is within this tree's bounds
    if (dx <= maxSpread && dz <= maxSpread && dy >= -1 && dy <= maxHeight) {
      // Calculate horizontal distance to tree base
      const horizontalDist = Math.sqrt(dx * dx + dz * dz);

      // Keep the closest tree
      if (horizontalDist < closestDistance) {
        closestDistance = horizontalDist;
        closestTree = tree;
      }
    }
  }

  return closestTree;
}

/**
 * Play timber/tree falling sound when successfully chopping a tree
 */
async function playTimberSound(): Promise<void> {
  try {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const response = await fetch(getSoundUrl('timber_falling', '/timber_falling_sound.mp3'));
    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    
    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContext.destination);
    source.start();
  } catch (error) {
    console.warn('Failed to play timber sound:', error);
  }
}

/**
 * Get block positions for a tree - tries blueprint table first, then regenerates
 */
async function getTreeBlockPositions(
  tree: PlantedTree,
  seedDef: SeedDefinition
): Promise<{ x: number; y: number; z: number }[]> {
  // First try to get blueprint from tree_blueprints table
  const { data: blueprintData } = await supabase
    .from('tree_blueprints')
    .select('blueprint_data')
    .eq('planted_tree_id', tree.id)
    .maybeSingle();

  if (blueprintData?.blueprint_data) {
    const bp = blueprintData.blueprint_data as { blocks: Array<{ x: number; y: number; z: number }> };
    return bp.blocks.map(b => ({ x: b.x, y: b.y, z: b.z }));
  }

  // Fallback: regenerate blueprint based on tree type
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

  return blueprint.blocks.map(b => ({ x: b.x, y: b.y, z: b.z }));
}

export function useTreeChopping({
  worldId,
  userId,
  userRoles = [],
  plantedTrees,
  seedDefinitions,
  returnSeed,
  refetchChunk,
  refetchTrees,
  removeTreeFromState,
  stopGrowing,
  removeBlocksByPositions,
  onTreeChopped,
}: UseTreeChoppingOptions) {
  const { toast } = useToast();
  const lastChopTimeRef = useRef(0);
  const isChoppingRef = useRef(false);

  // Check if user can bypass ownership (admin/superadmin)
  const canBypassOwnership = userRoles.includes('admin') || userRoles.includes('superadmin');

  /**
   * Attempt to chop a tree at the given block position
   * Uses delete_tree_with_blocks RPC for ownership-verified deletion
   */
  const chopTreeAtPosition = useCallback(async (
    blockX: number,
    blockY: number,
    blockZ: number
  ): Promise<ChopResult> => {
    console.log(`[TreeChopping] chopTreeAtPosition called at (${blockX}, ${blockY}, ${blockZ})`);
    console.log(`[TreeChopping] worldId=${worldId}, userId=${userId}, plantedTrees.length=${plantedTrees.length}`);

    if (!worldId || !userId) {
      console.error('[TreeChopping] Not authenticated - worldId or userId missing');
      return { success: false, error: 'Not authenticated' };
    }

    // Throttle chopping
    const now = Date.now();
    if (now - lastChopTimeRef.current < CHOP_COOLDOWN_MS) {
      console.log('[TreeChopping] Throttled - please wait');
      return { success: false, error: 'Please wait before chopping again' };
    }

    if (isChoppingRef.current) {
      console.log('[TreeChopping] Already chopping');
      return { success: false, error: 'Already chopping' };
    }

    // Find which tree this block belongs to
    console.log(`[TreeChopping] Searching for tree at (${blockX}, ${blockY}, ${blockZ}) among ${plantedTrees.length} trees`);
    const tree = findTreeAtPosition(blockX, blockY, blockZ, plantedTrees);

    if (!tree) {
      console.warn('[TreeChopping] No tree found at position:', blockX, blockY, blockZ);
      console.log('[TreeChopping] Available trees:', plantedTrees.map(t => `${t.id.slice(0,8)} at (${t.base_x},${t.base_y},${t.base_z})`));
      return { success: false, error: 'No tree found at this position' };
    }

    console.log(`[TreeChopping] Found tree: ${tree.id.slice(0,8)} at base (${tree.base_x}, ${tree.base_y}, ${tree.base_z}), planted_by=${tree.planted_by?.slice(0,8)}`);

    // Check ownership (admin/superadmin can bypass)
    const isOwner = tree.planted_by === userId;
    console.log(`[TreeChopping] Ownership check: tree.planted_by=${tree.planted_by?.slice(0,8)}, userId=${userId?.slice(0,8)}, isOwner=${isOwner}, canBypass=${canBypassOwnership}`);
    if (!isOwner && !canBypassOwnership) {
      toast({
        title: "Not your tree",
        description: "You can only chop down trees you planted",
        variant: "destructive"
      });
      return { success: false, error: 'Not owner' };
    }

    // Get seed definition for this tree
    const seedDef = tree.seed_definition || seedDefinitions.find(s => s.id === tree.seed_definition_id);
    if (!seedDef) {
      console.error('[TreeChopping] Seed definition not found for tree');
      return { success: false, error: 'Seed definition not found' };
    }

    console.log(`[TreeChopping] Starting chop for tree ${tree.id.slice(0,8)}, seedDef: ${seedDef.name}`);
    isChoppingRef.current = true;
    lastChopTimeRef.current = now;

    try {
      // CRITICAL: Stop local growth FIRST to prevent new blocks from being placed
      stopGrowing?.(tree.id);

      // IMMEDIATELY remove tree from local state (labels disappear instantly)
      // Do this BEFORE deleteTree so user gets instant feedback
      if (removeTreeFromState) {
        console.log('[TreeChopping] Removing tree from local state immediately for tree:', tree.id);
        removeTreeFromState(tree.id);
        console.log('[TreeChopping] removeTreeFromState called successfully');
      } else {
        console.error('[TreeChopping] ERROR: removeTreeFromState is undefined! Labels will not be removed.');
      }

      // Play timber sound IMMEDIATELY (don't wait for DB operations)
      console.log('[TreeChopping] Playing timber sound...');
      playTimberSound(); // Fire and forget - no await

      // Notify that tree was chopped (for Shnake cleanup, etc.)
      if (onTreeChopped) {
        console.log('[TreeChopping] Calling onTreeChopped callback');
        onTreeChopped(tree);
      }

      // Delete the tree (local block removal + database cleanup)
      // Pass canBypassOwnership so admins can delete any tree
      console.log('[TreeChopping] Calling deleteTree...');
      const deleteResult = await deleteTree(tree, seedDef, removeBlocksByPositions, canBypassOwnership);
      console.log('[TreeChopping] deleteTree result:', deleteResult);

      if (!deleteResult.success) {
        // DB deletion failed - show error but don't restore visual state
        // (user already saw the tree disappear, showing it again would be confusing)
        console.error('[TreeChopping] Database deletion failed:', deleteResult.error);
        toast({
          title: "Warning",
          description: "Tree removed locally but database sync failed. It may reappear on refresh.",
          variant: "destructive"
        });
        // Still return success for the local removal
      }

      // Return the seed to the TREE OWNER (not the chopper)
      // This ensures that when admin/superadmin chops someone else's tree,
      // the seed goes back to the original planter
      const treeOwnerId = tree.planted_by;
      const isOwnTree = !treeOwnerId || treeOwnerId === userId;

      let seedReturned = false;
      if (isOwnTree || !treeOwnerId) {
        // Own tree or unknown owner - use the normal returnSeed which updates local inventory state
        seedReturned = await returnSeed(seedDef.id);
      } else {
        // Someone else's tree - return seed directly to the owner's inventory
        seedReturned = await returnSeedToUser(seedDef.id, seedDef, treeOwnerId);
      }

      if (seedReturned) {
        const description = isOwnTree
          ? `Seed returned to your inventory`
          : `Seed returned to the tree owner's inventory`;
        toast({
          title: `${seedDef.name || 'Tree'} chopped!`,
          description,
        });
      } else {
        toast({
          title: `${seedDef.name || 'Tree'} chopped!`,
          description: `${deleteResult.deletedCount} blocks removed`,
        });
      }

      // Clear IndexedDB cache for the affected chunk
      const chunkX = Math.floor(tree.base_x / CHUNK_SIZE);
      const chunkZ = Math.floor(tree.base_z / CHUNK_SIZE);
      
      if (worldId) {
        try {
          await blockDB.clearCachedChunksForWorld(worldId);
        } catch (cacheError) {
          // Silent failure - cache clearing is not critical
        }
      }

      // Refresh the affected chunk from the database
      await refetchChunk(chunkX, chunkZ);
      
      // Also refetch adjacent chunks if tree could have spanned across chunk boundaries
      const adjacentOffsets = [[-1, 0], [1, 0], [0, -1], [0, 1]];
      for (const [dx, dz] of adjacentOffsets) {
        await refetchChunk(chunkX + dx, chunkZ + dz);
      }

      // NOTE: We don't call refetchTrees() here because:
      // 1. removeTreeFromState already removed the tree from local state (labels disappear immediately)
      // 2. Calling refetchTrees could bring the tree back if there's any DB propagation delay
      // 3. The realtime subscription in useTreeData will handle any needed sync

      return { success: true, seedReturned };
    } catch (error) {
      console.error('[TreeChopping] Error:', error);
      toast({
        title: "Chop failed",
        description: "An unexpected error occurred",
        variant: "destructive"
      });
      return { success: false, error: 'Unexpected error' };
    } finally {
      isChoppingRef.current = false;
    }
  }, [worldId, userId, canBypassOwnership, plantedTrees, seedDefinitions, returnSeed, refetchChunk, removeTreeFromState, onTreeChopped, toast, stopGrowing, removeBlocksByPositions]);

  /**
   * Check if a position is on a tree that can be chopped by the current user
   * Returns true if: user owns the tree OR user is admin/superadmin (can chop any tree)
   */
  const isOwnedTreeAtPosition = useCallback((
    blockX: number,
    blockY: number,
    blockZ: number
  ): boolean => {
    if (!userId) {
      console.log('[TreeChopping] isOwnedTreeAtPosition: No userId');
      return false;
    }

    console.log(`[TreeChopping] isOwnedTreeAtPosition: Checking (${blockX}, ${blockY}, ${blockZ}), plantedTrees: ${plantedTrees.length}, canBypass=${canBypassOwnership}`);
    const tree = findTreeAtPosition(blockX, blockY, blockZ, plantedTrees);

    if (!tree) {
      console.log('[TreeChopping] isOwnedTreeAtPosition: No tree found at position');
      return false;
    }

    // Admin/superadmin can chop any tree
    const isOwned = tree.planted_by === userId;
    const canChop = isOwned || canBypassOwnership;
    console.log(`[TreeChopping] isOwnedTreeAtPosition: tree=${tree.id?.slice(0,8)}, isOwned=${isOwned}, canBypass=${canBypassOwnership}, canChop=${canChop}`);
    return canChop;
  }, [userId, plantedTrees, canBypassOwnership]);

  return {
    chopTreeAtPosition,
    isOwnedTreeAtPosition,
  };
}
