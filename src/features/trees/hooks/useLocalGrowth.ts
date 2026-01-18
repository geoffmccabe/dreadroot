// Local Growth Manager - Ref-based growth system
// Stores growing trees in refs, not React state, to prevent flashing
// Growth check runs once per second max

import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { SeedDefinition, PlantedTree, TreeBlueprint, TreeGrowthOptions } from '../types';
import { generateTreeBlueprint, getBlocksAtOrder, getMaxGrowthOrder } from '../lib/treeGrowth';
import { TREE_CONFIG, getGrowthInterval } from '../constants';
import { collisionGrid } from '@/lib/spatialHashGrid';
// Check interval - 1 second max for FPS optimization
const GROWTH_CHECK_INTERVAL = 1000;

// Type for the placeBlock function from useBlocks
type PlaceBlockFn = (x: number, y: number, z: number, blockType: string, expiresAt?: string, textureUrl?: string, branchDepth?: number) => any;

interface GrowingTree {
  id: string;
  worldId: string;
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

// Module-level reference for clearing growing trees from outside the hook
let growingTreesRefGlobal: React.MutableRefObject<Map<string, GrowingTree>> | null = null;

// Set of tree IDs that have been deleted - prevents race conditions
const deletedTreeIds = new Set<string>();

/**
 * Clear all growing trees from memory (used for ghost tree cleanup)
 */
export function clearGrowingTrees() {
  if (growingTreesRefGlobal?.current) {
    const count = growingTreesRefGlobal.current.size;
    growingTreesRefGlobal.current.clear();
    console.log(`[LocalGrowth] Cleared ${count} growing trees from memory`);
  }
  deletedTreeIds.clear();
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
  
  // Set the global reference for external clearing
  growingTreesRefGlobal = growingTreesRef;

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
      worldId: worldId || '',
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
  }, [worldId]);

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

  /**
   * Stop growing a specific tree (used when tree is deleted)
   */
  const stopGrowing = useCallback((treeId: string) => {
    // Add to deleted set IMMEDIATELY to prevent race conditions
    deletedTreeIds.add(treeId);
    if (growingTreesRef.current.has(treeId)) {
      console.log(`[LocalGrowth] Stopping growth for tree ${treeId}`);
      growingTreesRef.current.delete(treeId);
    }
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
          // CRITICAL: Check deleted set FIRST (sync, no race condition)
          if (deletedTreeIds.has(id)) {
            console.log(`[LocalGrowth] Tree ${id} was deleted, removing from growth`);
            growingTreesRef.current.delete(id);
            continue;
          }
          
          // Skip temp trees that haven't been saved to DB yet
          if (id.startsWith('temp_')) {
            continue;
          }

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

          // CRITICAL: Verify parent tree still exists before placing ANY blocks
          // This prevents orphan blocks when trees are deleted during growth
          const { data: parentExists, error: existsError } = await supabase
            .from('planted_trees')
            .select('id')
            .eq('id', tree.id)
            .maybeSingle();

          if (existsError || !parentExists) {
            console.log(`[LocalGrowth] Parent tree ${tree.id} no longer exists, stopping growth`);
            growingTreesRef.current.delete(id);
            continue;
          }

          // Get blocks at this growth order
          const blocksToPlace = getBlocksAtOrder(tree.blueprint, tree.currentOrder);

          // CRITICAL: Insert to tree_blocks FIRST - if this fails, skip block placement
          // This prevents orphan blocks that can't be deleted later
          if (blocksToPlace.length > 0) {
            const treeBlockInserts = blocksToPlace.map(block => ({
              tree_id: tree.id,
              world_id: tree.worldId,
              position_x: block.x,
              position_y: block.y,
              position_z: block.z,
              block_type: block.branchDepth && block.branchDepth > 0 ? 'branch' : 'trunk',
              growth_order: tree.currentOrder,
            }));
            
            const { error: treeBlockError } = await supabase
              .from('tree_blocks')
              .upsert(treeBlockInserts, { onConflict: 'world_id,position_x,position_y,position_z' });
            
            if (treeBlockError) {
              console.error('[LocalGrowth] Failed to insert tree_blocks, skipping block placement:', treeBlockError.message);
              // Don't place blocks - this prevents orphans
              continue;
            }
          }

          // Only place blocks AFTER tree_blocks insert succeeded
          for (const block of blocksToPlace) {
            placeBlockFn(block.x, block.y, block.z, 'trunk', undefined, tree.textureUrl, block.branchDepth);
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
    stopGrowing,
    growingTreesRef,
  };
}

/**
 * Delete a tree using the tree_blocks table (reliable)
 * Falls back to blueprint regeneration if tree_blocks is empty
 */
export async function deleteTree(
  tree: PlantedTree,
  seedDef: SeedDefinition
): Promise<{ success: boolean; error?: string; deletedCount: number }> {
  try {
    // First try to get blocks from tree_blocks table (most reliable)
    const { data: treeBlocks, error: fetchError } = await supabase
      .from('tree_blocks')
      .select('position_x, position_y, position_z')
      .eq('tree_id', tree.id);

    let blocksToDelete: { x: number; y: number; z: number }[] = [];

    if (!fetchError && treeBlocks && treeBlocks.length > 0) {
      // Use the stored blocks (reliable)
      blocksToDelete = treeBlocks.map(b => ({
        x: b.position_x,
        y: b.position_y,
        z: b.position_z,
      }));
      console.log(`[deleteTree] Using ${blocksToDelete.length} blocks from tree_blocks table`);
    } else {
      // Fallback: regenerate blueprint (less reliable)
      console.log('[deleteTree] Falling back to blueprint regeneration');
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
      blocksToDelete = blueprint.blocks.map(b => ({ x: b.x, y: b.y, z: b.z }));
    }

    // Delete all placed_blocks at these positions
    let deletedCount = 0;
    const colliderRemovalFailures: { x: number; y: number; z: number }[] = [];
    
    for (const block of blocksToDelete) {
      const { error } = await supabase
        .from('placed_blocks')
        .delete()
        .eq('world_id', tree.world_id)
        .eq('position_x', block.x)
        .eq('position_y', block.y)
        .eq('position_z', block.z);

      if (!error) {
        deletedCount++;
        // Also remove from collision grid - track failures for debugging
        const removed = collisionGrid.removeByPosition(block.x, block.y, block.z);
        if (!removed) {
          colliderRemovalFailures.push(block);
        }
      }
    }
    
    // If any colliders failed to be removed, log them for debugging
    if (colliderRemovalFailures.length > 0) {
      console.warn(`[deleteTree] ${colliderRemovalFailures.length} colliders failed to remove:`, 
        colliderRemovalFailures.slice(0, 5));
    }

    // Delete tree_blocks entries (cascade should handle this, but be explicit)
    await supabase
      .from('tree_blocks')
      .delete()
      .eq('tree_id', tree.id);

    // Delete the planted_trees record
    const { error: treeError } = await supabase
      .from('planted_trees')
      .delete()
      .eq('id', tree.id);

    if (treeError) {
      console.error('[deleteTree] Failed to delete tree record:', treeError);
      return { success: false, error: 'Failed to delete tree record', deletedCount };
    }

    console.log(`[deleteTree] Successfully deleted tree ${tree.id}, ${deletedCount} blocks removed`);
    return { success: true, deletedCount };
  } catch (err) {
    console.error('[deleteTree] Error:', err);
    return { success: false, error: 'Unexpected error', deletedCount: 0 };
  }
}
