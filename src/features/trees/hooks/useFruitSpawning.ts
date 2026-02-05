// Hook for spawning fruits on fully-grown non-fungal trees
// Runs on an interval, checks branch blocks in blueprints, and inserts fruits into tree_fruits

import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { PlantedTree, TreeFruit, BlueprintBlock } from '../types';
import { TREE_CONFIG, FRUIT_CONFIG, getFruitSpawnInterval } from '../constants';

interface UseFruitSpawningOptions {
  plantedTrees: PlantedTree[];
  treeFruits: TreeFruit[];
  worldId: string | null;
  userId: string | null;
}

// Branch-like block types that can have fruit hanging below them
const FRUIT_BEARING_TYPES = new Set([
  'branch', 'spike', 'nob', 'cross', 'shroom_cap',
]);

export function useFruitSpawning({
  plantedTrees,
  treeFruits,
  worldId,
  userId,
}: UseFruitSpawningOptions) {
  // Keep refs to avoid stale closures in the interval
  const treeFruitsRef = useRef(treeFruits);
  treeFruitsRef.current = treeFruits;
  const plantedTreesRef = useRef(plantedTrees);
  plantedTreesRef.current = plantedTrees;

  // Cache blueprints to avoid re-fetching every tick
  const blueprintCacheRef = useRef<Map<string, BlueprintBlock[]>>(new Map());

  const fetchBlueprint = useCallback(async (treeId: string): Promise<BlueprintBlock[] | null> => {
    const cached = blueprintCacheRef.current.get(treeId);
    if (cached) return cached;

    const { data, error } = await supabase
      .from('tree_blueprints' as any)
      .select('blueprint_data')
      .eq('planted_tree_id', treeId)
      .single();

    if (error || !data) return null;

    const blocks = (data as any).blueprint_data?.blocks as BlueprintBlock[] | undefined;
    if (!blocks) return null;

    blueprintCacheRef.current.set(treeId, blocks);
    return blocks;
  }, []);

  const spawnTick = useCallback(async () => {
    if (!worldId || !userId || !TREE_CONFIG.ENABLED) return;

    const trees = plantedTreesRef.current;
    const fruits = treeFruitsRef.current;

    // Debug logging disabled to reduce spam
    // console.log(`[FruitSpawning] Tick: ${trees.length} trees, ${fruits.length} existing fruits`);

    // Build a set of occupied fruit positions for fast lookup
    const occupiedPositions = new Set<string>();
    for (const f of fruits) {
      occupiedPositions.add(`${f.position_x},${f.position_y},${f.position_z}`);
    }

    // Filter to fully-grown non-fungal trees with fruiting_factor > 0
    // Only spawn on trees planted by this user to prevent multi-client race conditions
    let rejectedNotGrown = 0, rejectedNotOwned = 0, rejectedNoSeedDef = 0,
        rejectedFungal = 0, rejectedNoFruiting = 0;
    const eligibleTrees = trees.filter(t => {
      if (!t.is_fully_grown) { rejectedNotGrown++; return false; }
      if (t.planted_by !== userId) { rejectedNotOwned++; return false; }
      const seedDef = t.seed_definition;
      if (!seedDef) { rejectedNoSeedDef++; return false; }
      if (seedDef.tree_type === 'fungal') { rejectedFungal++; return false; }
      if ((seedDef.fruiting_factor ?? 0) <= 0) { rejectedNoFruiting++; return false; }
      return true;
    });

    // console.log(`[FruitSpawning] Eligible: ${eligibleTrees.length} | Rejected: notGrown=${rejectedNotGrown} notOwned=${rejectedNotOwned} noSeedDef=${rejectedNoSeedDef} fungal=${rejectedFungal} noFruiting=${rejectedNoFruiting}`);
    if (eligibleTrees.length === 0) return;

    // Process each eligible tree
    const inserts: Array<{
      world_id: string;
      tree_id: string;
      position_x: number;
      position_y: number;
      position_z: number;
      tier: number;
      is_falling: boolean;
      is_collectible: boolean;
      velocity_y: number;
    }> = [];

    let missingBlueprints = 0;
    let noBranches = 0;
    for (const tree of eligibleTrees) {
      const blueprint = await fetchBlueprint(tree.id);
      if (!blueprint) {
        missingBlueprints++;
        console.warn(`[FruitSpawning] Tree ${tree.id.slice(0, 8)} at (${tree.base_x},${tree.base_y},${tree.base_z}) — NO BLUEPRINT, skipping`);
        continue;
      }

      const seedDef = tree.seed_definition!;
      const spawnChance = FRUIT_CONFIG.SPAWN_CHANCE_PER_BRANCH * seedDef.fruiting_factor;

      // Find all branch-like blocks
      for (const block of blueprint) {
        if (!FRUIT_BEARING_TYPES.has(block.type)) continue;

        // Fruit spawns 1 block below the branch
        const fx = block.x;
        const fy = block.y - 1;
        const fz = block.z;

        // Skip if position is already occupied by a fruit
        const key = `${fx},${fy},${fz}`;
        if (occupiedPositions.has(key)) continue;

        // Skip if below ground
        if (fy < 0) continue;

        // Roll probability
        if (Math.random() >= spawnChance) continue;

        // Mark occupied to avoid duplicates in same tick
        occupiedPositions.add(key);

        inserts.push({
          world_id: worldId,
          tree_id: tree.id,
          position_x: fx,
          position_y: fy,
          position_z: fz,
          tier: 1,
          is_falling: false,
          is_collectible: true,
          velocity_y: 0,
        });
      }
    }

    if (missingBlueprints > 0) {
      console.warn(`[FruitSpawning] ${missingBlueprints} eligible trees had NO BLUEPRINT — they need repair (reload page to trigger repair)`);
    }

    if (inserts.length === 0) return;

    // Batch insert (realtime subscription in useTreeData will update local state)
    const { error } = await supabase
      .from('tree_fruits')
      .insert(inserts);

    if (error) {
      console.error('[FruitSpawning] Insert error:', error);
    } else {
      console.log(`[FruitSpawning] Spawned ${inserts.length} fruit(s)`);
    }
  }, [worldId, userId, fetchBlueprint]);

  useEffect(() => {
    if (!worldId || !userId || !TREE_CONFIG.ENABLED) return;

    const interval = getFruitSpawnInterval();
    console.log(`[FruitSpawning] Starting spawn loop (interval: ${interval}ms)`);

    // Run first tick after a short delay (let trees load)
    const initialTimeout = setTimeout(() => {
      spawnTick();
    }, 5000);

    const timer = setInterval(spawnTick, interval);

    return () => {
      clearTimeout(initialTimeout);
      clearInterval(timer);
    };
  }, [worldId, spawnTick]);

  // Clean up blueprint cache when trees change (e.g., tree chopped)
  useEffect(() => {
    const currentIds = new Set(plantedTrees.map(t => t.id));
    for (const cachedId of blueprintCacheRef.current.keys()) {
      if (!currentIds.has(cachedId)) {
        blueprintCacheRef.current.delete(cachedId);
      }
    }
  }, [plantedTrees]);
}
