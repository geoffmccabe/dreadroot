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

// DB write batching - flush accumulated writes every N seconds
const DB_FLUSH_INTERVAL = 5000; // 5 seconds

// Type for the placeBlocksBatch function from useBlocks
type PlaceBlocksBatchFn = (positions: Array<{ x: number; y: number; z: number; blockType: string; textureUrl?: string; branchDepth?: number }>) => any[];

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

// Module-level reference to pending tree blocks for cleanup from outside
let pendingTreeBlocksRefGlobal: React.MutableRefObject<Array<{
  tree_id: string;
  world_id: string;
  position_x: number;
  position_y: number;
  position_z: number;
  block_type: string;
  growth_order: number;
}>> | null = null;

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

/**
 * Remove pending blocks for a specific tree from the flush buffer
 * Called when a tree is deleted to prevent ghost blocks
 */
export function clearPendingBlocksForTree(treeId: string) {
  if (pendingTreeBlocksRefGlobal?.current) {
    const before = pendingTreeBlocksRefGlobal.current.length;
    pendingTreeBlocksRefGlobal.current = pendingTreeBlocksRefGlobal.current.filter(
      b => b.tree_id !== treeId
    );
    const removed = before - pendingTreeBlocksRefGlobal.current.length;
    if (removed > 0) {
      console.log(`[LocalGrowth] Cleared ${removed} pending blocks for deleted tree ${treeId}`);
    }
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
  
  // Phase 4: Batched DB writes - accumulate tree_blocks and flush periodically
  // This reduces realtime events and prevents chunk refetches during growth
  const pendingTreeBlocksRef = useRef<Array<{
    tree_id: string;
    world_id: string;
    position_x: number;
    position_y: number;
    position_z: number;
    block_type: string;
    growth_order: number;
  }>>([]);
  const lastDbFlushRef = useRef(Date.now());
  const isFlushingRef = useRef(false);
  
  // Store refs globally for access from deleteTree
  useEffect(() => {
    pendingTreeBlocksRefGlobal = pendingTreeBlocksRef;
    return () => {
      pendingTreeBlocksRefGlobal = null;
    };
  }, []);

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
  // OPTIMIZED: Batch DB operations, reduce parent checks
  useEffect(() => {
    if (!TREE_CONFIG.ENABLED) return;

    // Track last parent check per tree to avoid redundant checks
    // Use -Infinity as default so first check happens immediately
    const lastParentCheck = new Map<string, number>();
    const PARENT_CHECK_INTERVAL = 3000; // Check parent existence every 3 seconds (reduced from 10)

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

          // Periodic parent check - CRITICAL: First check must happen immediately (lastCheck defaults to 0)
          const lastCheck = lastParentCheck.get(id) ?? 0; // 0 ensures first check happens immediately
          if (now - lastCheck > PARENT_CHECK_INTERVAL) {
            const { data: parentExists, error: existsError } = await supabase
              .from('planted_trees')
              .select('id')
              .eq('id', tree.id)
              .maybeSingle();

            lastParentCheck.set(id, now);

            if (existsError || !parentExists) {
              console.log(`[LocalGrowth] Parent tree ${tree.id} no longer exists, stopping growth`);
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
        const allBlocksToPlace: Array<{ x: number; y: number; z: number; blockType: string; textureUrl?: string; branchDepth?: number }> = [];
        const treesToUpdate: GrowingTree[] = [];
        
        // CRITICAL: Verify each tree exists in DB BEFORE placing blocks
        // This prevents ghost trees from growing after DB cleanup
        const verifiedTrees: GrowingTree[] = [];
        for (let t = 0; t < Math.min(treesToGrow.length, maxTreesPerTick); t++) {
          const tree = treesToGrow[t];
          
          // Skip temp trees (they haven't been saved to DB yet, that's expected)
          if (tree.id.startsWith('temp_')) {
            verifiedTrees.push(tree);
            continue;
          }
          
          // Quick existence check - if tree was deleted from DB, stop growing it
          const { data: exists } = await supabase
            .from('planted_trees')
            .select('id')
            .eq('id', tree.id)
            .maybeSingle();
          
          if (!exists) {
            console.log(`[LocalGrowth] CRITICAL: Tree ${tree.id} not in DB, removing from growth immediately`);
            growingTreesRef.current.delete(tree.id);
            deletedTreeIds.add(tree.id);
            continue;
          }
          
          verifiedTrees.push(tree);
        }
        
        for (const tree of verifiedTrees) {
          // Get blocks at this growth order
          const blocksToPlace = getBlocksAtOrder(tree.blueprint, tree.currentOrder);

          // PHASE 4: Accumulate tree_blocks for batched DB write (reduces realtime events)
          if (blocksToPlace.length > 0) {
            for (const block of blocksToPlace) {
              pendingTreeBlocksRef.current.push({
                tree_id: tree.id,
                world_id: tree.worldId,
                position_x: block.x,
                position_y: block.y,
                position_z: block.z,
                block_type: block.type,
                growth_order: tree.currentOrder,
              });
            }
            
            // Collect blocks for batch placement (with tree-specific texture)
            for (const block of blocksToPlace) {
              allBlocksToPlace.push({
                x: block.x,
                y: block.y,
                z: block.z,
                blockType: block.type,
                textureUrl: tree.textureUrl,
                branchDepth: block.branchDepth
              });
            }
          }

          // Update ref state (no React re-render)
          tree.currentOrder++;
          tree.lastGrowthTime = now;
          treesToUpdate.push(tree);
        }
        
        // BATCH: Place ALL blocks from ALL trees with SINGLE React re-render
        if (allBlocksToPlace.length > 0) {
          placeBlocksBatchFn(allBlocksToPlace);
        }
        
        // PHASE 4: Flush pending tree_blocks to DB every DB_FLUSH_INTERVAL
        // This batches multiple growth ticks into a single DB write, reducing realtime events
        if (!isFlushingRef.current && pendingTreeBlocksRef.current.length > 0) {
          const timeSinceLastFlush = now - lastDbFlushRef.current;
          if (timeSinceLastFlush >= DB_FLUSH_INTERVAL) {
            isFlushingRef.current = true;
            // CRITICAL: Filter out any blocks for trees that were deleted while pending
            const blocksToFlush = pendingTreeBlocksRef.current.filter(
              b => !deletedTreeIds.has(b.tree_id)
            );
            pendingTreeBlocksRef.current = [];
            lastDbFlushRef.current = now;
            
            // Fire-and-forget DB write (use async IIFE to handle promise properly)
            if (blocksToFlush.length > 0) {
              (async () => {
                try {
                  const { error } = await supabase
                    .from('tree_blocks')
                    .upsert(blocksToFlush, { 
                      onConflict: 'world_id,position_x,position_y,position_z',
                      ignoreDuplicates: true
                    });
                  if (error) {
                    console.error('[LocalGrowth] Batched tree_blocks upsert error:', error.message);
                  }
                } finally {
                  isFlushingRef.current = false;
                }
              })();
            } else {
              isFlushingRef.current = false;
            }
          }
        }
        
        // Update DB for trees that grew (fire-and-forget, after React update)
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
    
    // Flush any remaining blocks when trees finish or on cleanup
    const flushPendingBlocks = async () => {
      if (pendingTreeBlocksRef.current.length > 0 && !isFlushingRef.current) {
        isFlushingRef.current = true;
        const blocksToFlush = [...pendingTreeBlocksRef.current];
        pendingTreeBlocksRef.current = [];
        
        await supabase
          .from('tree_blocks')
          .upsert(blocksToFlush, { 
            onConflict: 'world_id,position_x,position_y,position_z',
            ignoreDuplicates: true
          });
        
        isFlushingRef.current = false;
      }
    };

    // Check once per second
    const intervalId = setInterval(checkGrowth, GROWTH_CHECK_INTERVAL);

    // Initial check after a short delay
    setTimeout(checkGrowth, 100);

    return () => {
      clearInterval(intervalId);
      // Flush any pending blocks on cleanup
      flushPendingBlocks();
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
 * Delete a tree using the tree_blocks table (reliable)
 * Falls back to blueprint regeneration if tree_blocks is empty
 * 
 * PERFORMANCE OPTIMIZED: Uses bulk local removal + single DB query
 * 
 * @param tree - The planted tree to delete
 * @param seedDef - The seed definition for blueprint fallback
 * @param removeBlocksByPositions - Optional bulk removal function from chunk loader
 */
export async function deleteTree(
  tree: PlantedTree,
  seedDef: SeedDefinition,
  removeBlocksByPositions?: (positions: Array<{ x: number; y: number; z: number }>) => number
): Promise<{ success: boolean; error?: string; deletedCount: number }> {
  try {
    // CRITICAL: Add tree to deleted set FIRST to prevent any pending blocks from being flushed
    deletedTreeIds.add(tree.id);
    
    // Clear any pending blocks for this tree from the flush buffer
    clearPendingBlocksForTree(tree.id);
    
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

    // STEP 1: INSTANT local removal (blocks disappear immediately, single re-render)
    let locallyRemoved = 0;
    if (removeBlocksByPositions) {
      locallyRemoved = removeBlocksByPositions(blocksToDelete);
      console.log(`[deleteTree] Instantly removed ${locallyRemoved} blocks locally`);
    } else {
      // Fallback: manual collider removal (slower, but still works)
      for (const block of blocksToDelete) {
        collisionGrid.removeByPosition(block.x, block.y, block.z);
      }
    }

    // STEP 2: Database cleanup (runs in background, fire-and-forget style)
    // Use the bulk delete function for efficiency
    const positions = blocksToDelete.map(b => ({ x: b.x, y: b.y, z: b.z }));
    
    const { data: dbDeleteCount, error: bulkDeleteError } = await supabase
      .rpc('delete_tree_blocks', {
        p_world_id: tree.world_id,
        p_positions: positions
      });

    if (bulkDeleteError) {
      console.warn('[deleteTree] Bulk delete RPC failed, falling back to individual deletes:', bulkDeleteError.message);
      // Fallback to individual deletes (slower but works)
      for (const block of blocksToDelete) {
        await supabase
          .from('placed_blocks')
          .delete()
          .eq('world_id', tree.world_id)
          .eq('position_x', block.x)
          .eq('position_y', block.y)
          .eq('position_z', block.z);
      }
    } else {
      console.log(`[deleteTree] Bulk deleted ${dbDeleteCount} blocks from DB`);
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
      return { success: false, error: 'Failed to delete tree record', deletedCount: locallyRemoved };
    }

    console.log(`[deleteTree] Successfully deleted tree ${tree.id}, ${locallyRemoved} blocks removed`);
    return { success: true, deletedCount: locallyRemoved };
  } catch (err) {
    console.error('[deleteTree] Error:', err);
    return { success: false, error: 'Unexpected error', deletedCount: 0 };
  }
}
