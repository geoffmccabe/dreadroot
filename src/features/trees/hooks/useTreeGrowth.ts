// Hook for managing tree growth timing
// Runs growth loop for trees owned by the current user

import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { PlantedTree, TreeGrowthOptions } from '../types';
import { generateTreeBlueprint, getBlocksAtOrder, getMaxGrowthOrder } from '../lib/treeGrowth';
import { TREE_CONFIG, getGrowthInterval } from '../constants';

// Type for the placeBlock function from useBlocks
type PlaceBlockFn = (x: number, y: number, z: number, blockType: string, expiresAt?: string, textureUrl?: string) => any;

interface UseTreeGrowthOptions {
  worldId: string | null;
  userId: string | null;
  plantedTrees: PlantedTree[];
  placeBlock: PlaceBlockFn | null; // Inject placeBlock for optimistic updates
  onGrowth?: (treeId: string, blockCount: number) => void;
}

/**
 * Build options object from seed definition for tree generation
 */
function buildGrowthOptions(seedDef: PlantedTree['seed_definition']): TreeGrowthOptions {
  if (!seedDef) return {};
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
  };
}

export function useTreeGrowth({
  worldId,
  userId,
  plantedTrees,
  placeBlock,
  onGrowth,
}: UseTreeGrowthOptions): void {
  // Track local growth order (not block count) to avoid re-reading stale data
  const localGrowthOrders = useRef<Map<string, number>>(new Map());
  const lastGrowthTime = useRef<Map<string, number>>(new Map());
  const lastPersistedTime = useRef<Map<string, number>>(new Map());
  const isGrowing = useRef(false);
  
  // Checkpoint interval - only persist to DB every 30 seconds max during growth
  const PERSIST_INTERVAL_MS = 30000;

  const growTreeByOne = useCallback(async (tree: PlantedTree): Promise<boolean> => {
    if (!tree.seed_definition || !placeBlock) {
      return false;
    }

    const seedDef = tree.seed_definition;
    
    // Use local order if available, otherwise derive from current_block_count
    const currentOrder = localGrowthOrders.current.get(tree.id) ?? tree.current_block_count;

    // Generate blueprint (deterministic from seed)
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

    const maxOrder = getMaxGrowthOrder(blueprint);
    
    // Check if fully grown
    if (currentOrder > maxOrder) {
      await supabase
        .from('planted_trees')
        .update({ is_fully_grown: true })
        .eq('id', tree.id);
      return false;
    }

    // Get ALL blocks at this growth order (includes decorations!)
    const blocksToPlace = getBlocksAtOrder(blueprint, currentOrder);
    
    if (blocksToPlace.length === 0) {
      // No blocks at this order, move to next
      localGrowthOrders.current.set(tree.id, currentOrder + 1);
      return true;
    }

    // Place ALL blocks at this order INSTANTLY
    // All blocks use trunk texture for now (future: per-type textures)
    const textureUrl = seedDef.trunk_texture_url || undefined;
    let placedCount = 0;
    
    for (const block of blocksToPlace) {
      const placed = placeBlock(block.x, block.y, block.z, 'trunk', undefined, textureUrl);
      if (placed) placedCount++;
    }

    // Update local state only - blocks are fire-and-forget
    const newOrder = currentOrder + 1;
    const now = Date.now();
    localGrowthOrders.current.set(tree.id, newOrder);
    lastGrowthTime.current.set(tree.id, now);

    const isFullyGrown = newOrder > maxOrder;
    const lastPersisted = lastPersistedTime.current.get(tree.id) || 0;
    const shouldPersist = isFullyGrown || (now - lastPersisted >= PERSIST_INTERVAL_MS);

    // Only update DB on completion or periodic checkpoint (reduces feedback loop)
    if (shouldPersist) {
      lastPersistedTime.current.set(tree.id, now);
      
      // Count total blocks placed so far for DB update
      let totalBlocksPlaced = 0;
      for (let o = 0; o <= currentOrder; o++) {
        totalBlocksPlaced += getBlocksAtOrder(blueprint, o).length;
      }

      // Update tree progress in DB (async, doesn't block UI)
      supabase
        .from('planted_trees')
        .update({
          current_block_count: totalBlocksPlaced,
          last_growth_at: new Date().toISOString(),
          is_fully_grown: isFullyGrown,
        })
        .eq('id', tree.id)
        .then(() => {});

      onGrowth?.(tree.id, totalBlocksPlaced);
    }
    
    return true;
  }, [placeBlock, onGrowth]);

  // Main growth loop - processes one tree at a time
  useEffect(() => {
    if (!worldId || !userId || !TREE_CONFIG.ENABLED || !placeBlock) return;

    const checkGrowth = async () => {
      // Prevent concurrent growth operations
      if (isGrowing.current) return;
      isGrowing.current = true;

      try {
        const now = Date.now();

        // Find a tree that needs growth
        for (const tree of plantedTrees) {
          if (tree.is_fully_grown) continue;
          if (tree.planted_by !== userId) continue;
          if (!tree.seed_definition) continue;

          const interval = getGrowthInterval(tree.seed_definition.growth_factor);
          const lastGrowth = lastGrowthTime.current.get(tree.id) || new Date(tree.last_growth_at).getTime();
          
          // Check if enough time has passed
          if (now - lastGrowth >= interval) {
            await growTreeByOne(tree);
            break; // Only grow one tree per tick to spread load
          }
        }
      } finally {
        isGrowing.current = false;
      }
    };

    // Growth check interval - 200ms is responsive enough for 100ms growth intervals
    const interval = setInterval(checkGrowth, 200);
    
    // Initial check
    setTimeout(checkGrowth, 50);

    return () => clearInterval(interval);
  }, [worldId, userId, plantedTrees, placeBlock, growTreeByOne]);

  // Sync local orders when plantedTrees updates from DB
  useEffect(() => {
    for (const tree of plantedTrees) {
      const localOrder = localGrowthOrders.current.get(tree.id);
      // If not tracked locally yet, calculate order from block count
      if (localOrder === undefined && tree.seed_definition) {
        // For new trees, we need to calculate what order we're at based on block count
        // Generate blueprint to determine order
        const seedDef = tree.seed_definition;
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
        
        // Find which order we're at based on block count
        let blocksPlaced = 0;
        let currentOrder = 0;
        const maxOrder = getMaxGrowthOrder(blueprint);
        
        while (currentOrder <= maxOrder && blocksPlaced < tree.current_block_count) {
          blocksPlaced += getBlocksAtOrder(blueprint, currentOrder).length;
          if (blocksPlaced <= tree.current_block_count) {
            currentOrder++;
          }
        }
        
        localGrowthOrders.current.set(tree.id, currentOrder);
        // Set initial growth time to now so growth starts immediately
        lastGrowthTime.current.set(tree.id, Date.now());
      }
    }
  }, [plantedTrees]);
}
