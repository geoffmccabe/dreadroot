// Local Growth Manager - Ref-based growth system
// NEW ARCHITECTURE: Writes directly to placed_blocks via placeBlocksBatch
// No more tree_blocks table - unified block rendering path

import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { SeedDefinition, PlantedTree, TreeBlueprint, TreeGrowthOptions } from '../types';
import { generateTreeBlueprint, getBlocksAtOrder, getMaxGrowthOrder } from '../lib/treeGrowth';
import { TREE_CONFIG, getGrowthInterval } from '../constants';
import { collisionGrid } from '@/lib/spatialHashGrid';
import { encodeBlockType, getTextureUrlForTreeBlock } from '../lib/blockTypeEncoder';

// Check interval - 1 second max for FPS optimization
const GROWTH_CHECK_INTERVAL = 1000;

// Type for the placeBlocksBatch function from useBlocks
type PlaceBlocksBatchFn = (positions: Array<{ x: number; y: number; z: number; blockType: string; textureUrl?: string }>) => any[];

interface GrowingTree {
  id: string;
  worldId: string;
  blueprint: TreeBlueprint;
  currentOrder: number;
  lastGrowthTime: number;
  growthInterval: number;
  seedDef: SeedDefinition; // Store full seed def for texture lookups
  baseX: number;
  baseY: number;
  baseZ: number;
  growthSeed: number;
  createdAt: number; // Timestamp when tree was added to growth loop
}

interface UseLocalGrowthOptions {
  worldId: string | null;
  userId: string | null;
  placeBlocksBatch: PlaceBlocksBatchFn | null;
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
 * Mark all current growing trees as deleted to prevent any further block placement
 * This is called BEFORE clearing the map to ensure no race conditions
 */
export function markAllTreesDeleted() {
  if (growingTreesRefGlobal?.current) {
    for (const treeId of growingTreesRefGlobal.current.keys()) {
      deletedTreeIds.add(treeId);
    }
    console.log(`[LocalGrowth] Marked ${growingTreesRefGlobal.current.size} trees as deleted`);
  }
}

/**
 * Clear all pending blocks (stub for backwards compatibility)
 */
export function clearAllPendingBlocks() {
  // No longer needed - blocks go directly to placed_blocks (no-op stub)
}

/**
 * Clear pending blocks for a specific tree (stub for backwards compatibility)
 */
export function clearPendingBlocksForTree(_treeId: string) {
  // No longer needed - blocks go directly to placed_blocks (no-op stub)
}

/**
 * Clear all growing trees from memory (used for ghost tree cleanup)
 */
export function clearGrowingTrees() {
  if (growingTreesRefGlobal?.current) {
    growingTreesRefGlobal.current.clear();
  }
}

export function useLocalGrowth({
  worldId,
  userId,
  placeBlocksBatch,
}: UseLocalGrowthOptions) {
  // All growing trees stored in a ref - no React state = no re-renders
  const growingTreesRef = useRef<Map<string, GrowingTree>>(new Map());
  const placeBlocksBatchRef = useRef(placeBlocksBatch);
  const isGrowingRef = useRef(false);

  // Keep placeBlocksBatch ref in sync AND set global reference (once)
  useEffect(() => {
    placeBlocksBatchRef.current = placeBlocksBatch;
    // Set the global reference for external clearing
    growingTreesRefGlobal = growingTreesRef;
  }, [placeBlocksBatch]);

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
      seedDef, // Store full seed def for texture lookups
      baseX,
      baseY,
      baseZ,
      growthSeed,
      createdAt: Date.now(),
    };

    growingTreesRef.current.set(treeId, growingTree);
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
      growingTreesRef.current.delete(treeId);
    }
  }, []);

  // Main growth loop - checks once per second
  // NEW: Writes blocks to placed_blocks via placeBlocksBatch (not tree_blocks)
  useEffect(() => {
    if (!TREE_CONFIG.ENABLED) return;

    // Track last parent check per tree to avoid redundant checks
    const lastParentCheck = new Map<string, number>();
    const PARENT_CHECK_INTERVAL = 3000; // Check parent existence every 3 seconds

    const checkGrowth = async () => {
      const placeBlocksBatchFn = placeBlocksBatchRef.current;
      if (!placeBlocksBatchFn || isGrowingRef.current) return;

      isGrowingRef.current = true;
      const now = Date.now();

      try {
        // Collect all trees that need to grow this tick
        const treesToGrow: GrowingTree[] = [];
        
        for (const [id, tree] of growingTreesRef.current) {
          // CRITICAL: Check deleted set FIRST (sync, no race condition)
          if (deletedTreeIds.has(id)) {
            growingTreesRef.current.delete(id);
            continue;
          }
          
          // Handle temp trees specially - they need timeout protection
          if (id.startsWith('temp_')) {
            const tempAge = now - (tree.createdAt || tree.lastGrowthTime);
            const TEMP_TREE_TIMEOUT = 30000; // 30 seconds max for temp trees
            
            // If temp tree is too old, it's orphaned - stop it
            if (tempAge > TEMP_TREE_TIMEOUT) {
              growingTreesRef.current.delete(id);
              deletedTreeIds.add(id);
            }
            // Skip growth tick for temp trees - wait for DB ID assignment
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
              .then(() => {});

            // Remove from growing map
            growingTreesRef.current.delete(id);
            continue;
          }

          // Periodic parent check
          const lastCheck = lastParentCheck.get(id) ?? 0;
          if (now - lastCheck > PARENT_CHECK_INTERVAL) {
            const { data: parentExists, error: existsError } = await supabase
              .from('planted_trees')
              .select('id')
              .eq('id', tree.id)
              .maybeSingle();

            lastParentCheck.set(id, now);

            if (existsError || !parentExists) {
              growingTreesRef.current.delete(id);
              lastParentCheck.delete(id);
              continue;
            }
          }

          treesToGrow.push(tree);
        }

        // Process up to 3 trees per tick for better performance
        const maxTreesPerTick = 3;
        
        // BATCH: Collect ALL blocks from ALL trees to place in a single React update
        const allBlocksToPlace: Array<{ x: number; y: number; z: number; blockType: string; textureUrl?: string }> = [];
        const treesToUpdate: GrowingTree[] = [];
        
        // Verify each tree exists in DB BEFORE placing blocks
        const verifiedTrees: GrowingTree[] = [];
        for (let t = 0; t < Math.min(treesToGrow.length, maxTreesPerTick); t++) {
          const tree = treesToGrow[t];
          
          if (tree.id.startsWith('temp_')) {
            continue;
          }
          
          // Quick existence check
          const { data: exists } = await supabase
            .from('planted_trees')
            .select('id')
            .eq('id', tree.id)
            .maybeSingle();
          
          if (!exists) {
            growingTreesRef.current.delete(tree.id);
            deletedTreeIds.add(tree.id);
            continue;
          }
          
          verifiedTrees.push(tree);
        }
        
        for (const tree of verifiedTrees) {
          // Get blocks at this growth order
          const blocksToPlace = getBlocksAtOrder(tree.blueprint, tree.currentOrder);

          if (blocksToPlace.length > 0) {
            // Collect blocks for batch placement with encoded block_type
            for (const block of blocksToPlace) {
              const encodedType = encodeBlockType(block.type, block.branchDepth, tree.seedDef.tier);
              const textureUrl = getTextureUrlForTreeBlock(
                block.type,
                tree.seedDef.trunk_texture_url,
                tree.seedDef.branch_texture_url,
                tree.seedDef.fruit_texture_url
              );
              
              allBlocksToPlace.push({
                x: block.x,
                y: block.y,
                z: block.z,
                blockType: encodedType,
                textureUrl: textureUrl || undefined,
              });
            }
          }

          // Update ref state (no React re-render)
          tree.currentOrder++;
          tree.lastGrowthTime = now;
          treesToUpdate.push(tree);
        }
        
        // BATCH: Place ALL blocks from ALL trees with SINGLE React re-render
        // Blocks go directly to placed_blocks via the standard placeBlocksBatch path
        if (allBlocksToPlace.length > 0) {
          placeBlocksBatchFn(allBlocksToPlace);
        }
        
        // Update DB for trees that grew (fire-and-forget)
        for (const tree of treesToUpdate) {
          // Update current_block_count in DB periodically (every 10 orders) for resume support
          if (tree.currentOrder % 10 === 0) {
            const blocksPlacedSoFar = tree.blueprint.blocks
              .filter(b => b.growthOrder <= tree.currentOrder)
              .length;
            supabase
              .from('planted_trees')
              .update({ 
                current_block_count: blocksPlacedSoFar,
                last_growth_at: new Date().toISOString()
              })
              .eq('id', tree.id)
              .then(() => {});
          }
        }
      } finally {
        isGrowingRef.current = false;
      }
    };

    // Check once per second
    const intervalId = setInterval(checkGrowth, GROWTH_CHECK_INTERVAL);

    // Initial check after a short delay
    setTimeout(checkGrowth, 100);

    return () => {
      clearInterval(intervalId);
    };
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
 * Delete a tree using the tree_blueprints table (new architecture)
 * Falls back to blueprint regeneration if tree_blueprints is empty
 * 
 * IMPORTANT: Now uses delete_tree_with_blocks RPC for ownership-verified deletion
 */
export async function deleteTree(
  tree: PlantedTree,
  seedDef: SeedDefinition,
  removeBlocksByPositions?: (positions: Array<{ x: number; y: number; z: number }>) => number
): Promise<{ success: boolean; error?: string; deletedCount: number }> {
  try {
    // CRITICAL: Add tree to deleted set FIRST to prevent any pending blocks from being flushed
    deletedTreeIds.add(tree.id);
    
    // Get current user for ownership check
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Not authenticated', deletedCount: 0 };
    }
    
    // First try to get blueprint from tree_blueprints table (new architecture)
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
      // Fallback: Try old tree_blocks table
      const { data: treeBlocks, error: fetchError } = await supabase
        .from('tree_blocks')
        .select('position_x, position_y, position_z')
        .eq('tree_id', tree.id);

      if (!fetchError && treeBlocks && treeBlocks.length > 0) {
        blocksToDelete = treeBlocks.map(b => ({
          x: b.position_x,
          y: b.position_y,
          z: b.position_z,
        }));
      } else {
        // Final fallback: regenerate blueprint
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
    }

    // STEP 1: INSTANT local removal (blocks disappear immediately, single re-render)
    let locallyRemoved = 0;
    if (removeBlocksByPositions) {
      locallyRemoved = removeBlocksByPositions(blocksToDelete);
    } else {
      // Fallback: manual collider removal
      for (const block of blocksToDelete) {
        collisionGrid.removeByPosition(block.x, block.y, block.z);
      }
    }

    // STEP 2: Use new ownership-verified RPC for database deletion
    const { data: rpcResult, error: rpcError } = await supabase
      .rpc('delete_tree_with_blocks', {
        p_tree_id: tree.id,
        p_user_id: user.id,
        p_world_id: tree.world_id,
        p_block_positions: blocksToDelete,
      });

    if (rpcError) {
      // Fallback to old method on RPC error
      await supabase.from('tree_blocks').delete().eq('tree_id', tree.id);
      await supabase.from('planted_trees').delete().eq('id', tree.id);
    } else if (rpcResult && !(rpcResult as any).success) {
      return { success: false, error: (rpcResult as any).error, deletedCount: locallyRemoved };
    }

    return { success: true, deletedCount: locallyRemoved };
  } catch (err) {
    return { success: false, error: 'Unexpected error', deletedCount: 0 };
  }
}
