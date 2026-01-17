// Hook for managing tree growth timing
// Runs growth loop for trees owned by the current user

import { useEffect, useRef } from 'react';
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

/**
 * Calculate the current growth order from block count by replaying the blueprint
 */
function calculateOrderFromBlockCount(tree: PlantedTree): number {
  if (!tree.seed_definition) return 0;
  
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
  
  let blocksPlaced = 0;
  let currentOrder = 0;
  const maxOrder = getMaxGrowthOrder(blueprint);
  
  while (currentOrder <= maxOrder && blocksPlaced < tree.current_block_count) {
    blocksPlaced += getBlocksAtOrder(blueprint, currentOrder).length;
    if (blocksPlaced <= tree.current_block_count) {
      currentOrder++;
    }
  }
  
  return currentOrder;
}

export function useTreeGrowth({
  worldId,
  userId,
  plantedTrees,
  placeBlock,
  onGrowth,
}: UseTreeGrowthOptions): void {
  // Use refs to avoid dependency issues in the interval
  const plantedTreesRef = useRef(plantedTrees);
  const placeBlockRef = useRef(placeBlock);
  const onGrowthRef = useRef(onGrowth);
  const worldIdRef = useRef(worldId);
  const userIdRef = useRef(userId);
  
  // Track local growth order (not block count) to avoid re-reading stale data
  const localGrowthOrders = useRef<Map<string, number>>(new Map());
  const lastGrowthTime = useRef<Map<string, number>>(new Map());
  const lastPersistedTime = useRef<Map<string, number>>(new Map());
  const isGrowing = useRef(false);
  
  // Checkpoint interval - only persist to DB every 30 seconds max during growth
  const PERSIST_INTERVAL_MS = 30000;

  // Keep refs in sync with props (doesn't cause re-renders)
  useEffect(() => {
    plantedTreesRef.current = plantedTrees;
  }, [plantedTrees]);
  
  useEffect(() => {
    placeBlockRef.current = placeBlock;
  }, [placeBlock]);
  
  useEffect(() => {
    onGrowthRef.current = onGrowth;
  }, [onGrowth]);
  
  useEffect(() => {
    worldIdRef.current = worldId;
    userIdRef.current = userId;
  }, [worldId, userId]);

  // Initialize growth tracking for new trees
  useEffect(() => {
    for (const tree of plantedTrees) {
      if (localGrowthOrders.current.has(tree.id)) continue;
      if (!tree.seed_definition) continue;
      
      // Calculate order from block count
      const order = calculateOrderFromBlockCount(tree);
      localGrowthOrders.current.set(tree.id, order);
      // Set initial growth time to now so growth starts immediately
      lastGrowthTime.current.set(tree.id, Date.now());
    }
  }, [plantedTrees]);

  // Main growth loop - runs once on mount, uses refs to access current values
  useEffect(() => {
    if (!TREE_CONFIG.ENABLED) return;

    const growTreeByOne = async (tree: PlantedTree): Promise<boolean> => {
      const placeBlockFn = placeBlockRef.current;
      if (!tree.seed_definition || !placeBlockFn) {
        return false;
      }

      const seedDef = tree.seed_definition;
      
      // Use local order - should always be set by init effect
      const currentOrder = localGrowthOrders.current.get(tree.id) ?? 0;

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
        supabase
          .from('planted_trees')
          .update({ is_fully_grown: true })
          .eq('id', tree.id)
          .then(() => {});
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
      const textureUrl = seedDef.trunk_texture_url || undefined;
      let placedCount = 0;
      
      for (const block of blocksToPlace) {
        const placed = placeBlockFn(block.x, block.y, block.z, 'trunk', undefined, textureUrl);
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

        onGrowthRef.current?.(tree.id, totalBlocksPlaced);
      }
      
      return true;
    };

    const checkGrowth = async () => {
      const wId = worldIdRef.current;
      const uId = userIdRef.current;
      const trees = plantedTreesRef.current;
      const placeBlockFn = placeBlockRef.current;
      
      if (!wId || !uId || !placeBlockFn) return;
      
      // Prevent concurrent growth operations
      if (isGrowing.current) return;
      isGrowing.current = true;

      try {
        const now = Date.now();

        // Find a tree that needs growth
        for (const tree of trees) {
          if (tree.is_fully_grown) continue;
          if (tree.planted_by !== uId) continue;
          if (!tree.seed_definition) continue;

          const interval = getGrowthInterval(tree.seed_definition.growth_factor);
          const lastGrowth = lastGrowthTime.current.get(tree.id) || 0;
          
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
    const intervalId = setInterval(checkGrowth, 200);
    
    // Initial check
    setTimeout(checkGrowth, 50);

    return () => clearInterval(intervalId);
  }, []); // Empty deps - runs once, uses refs for current values
}
