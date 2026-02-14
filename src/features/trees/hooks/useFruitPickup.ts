// Hook for F-key fruit harvesting system
// Detects nearest fruit in range, shows prompt, harvests on F press

import { useCallback, useRef } from 'react';
import * as THREE from 'three';
import { supabase } from '@/integrations/supabase/client';
import { TreeFruit, PlantedTree } from '../types';
import { TREE_CONFIG, FRUIT_CONFIG, getFruitTier } from '../constants';
import { playSpatialSound } from '@/lib/spatialAudio';
import { getSoundUrl } from '@/hooks/useGameSounds';

interface UseFruitPickupOptions {
  treeFruits: TreeFruit[];
  plantedTrees: PlantedTree[];
  userId: string | null;
  cameraRef: React.RefObject<THREE.Camera>;
  toast: any;
  addItem?: (itemId: string, quantity: number) => Promise<boolean>;
  harvestRangeBonus?: number; // Extra range from items/stats
  onFruitRemoved?: (fruitId: string) => void; // Immediately remove from local state
}

// Roll a fruit tier: 50% chance to increase each step, 1-30
function rollFruitTier(isOwnTree: boolean): number {
  const roll = () => {
    let t = 1;
    while (Math.random() < 0.5 && t < 30) t++;
    return t;
  };
  // Own-tree bonus: roll twice, take higher
  if (isOwnTree) return Math.max(roll(), roll());
  return roll();
}

export function useFruitPickup({
  treeFruits,
  plantedTrees,
  userId,
  cameraRef,
  toast,
  addItem,
  harvestRangeBonus = 0,
  onFruitRemoved,
}: UseFruitPickupOptions) {
  const harvestingRef = useRef(false); // prevents double-completion

  // Keep refs to avoid stale closures
  const treeFruitsRef = useRef(treeFruits);
  treeFruitsRef.current = treeFruits;
  const plantedTreesRef = useRef(plantedTrees);
  plantedTreesRef.current = plantedTrees;
  const addItemRef = useRef(addItem);
  addItemRef.current = addItem;
  const harvestRangeBonusRef = useRef(harvestRangeBonus);
  harvestRangeBonusRef.current = harvestRangeBonus;
  const onFruitRemovedRef = useRef(onFruitRemoved);
  onFruitRemovedRef.current = onFruitRemoved;

  // Effective harvest range (base + bonus)
  const getHarvestRange = useCallback(() => {
    return FRUIT_CONFIG.HARVEST_RANGE + harvestRangeBonusRef.current;
  }, []);

  // Find closest collectible fruit within harvest range (Chebyshev distance)
  const findClosestFruit = useCallback((): TreeFruit | null => {
    const cam = cameraRef.current;
    if (!cam || !TREE_CONFIG.ENABLED) return null;

    const camPos = cam.position;
    const playerFeetY = Math.floor(camPos.y - 1.6);
    const playerHeadY = Math.floor(camPos.y - 0.6);
    const playerX = Math.floor(camPos.x);
    const playerZ = Math.floor(camPos.z);
    const range = getHarvestRange();

    let closest: TreeFruit | null = null;
    let closestDist = Infinity;

    for (const fruit of treeFruitsRef.current) {
      if (!fruit.is_collectible) continue;

      const fx = fruit.position_x;
      const fy = fruit.position_y;
      const fz = fruit.position_z;

      // Skip phantom/ghost fruit at origin (0,0,0) - known issue
      if (fx === 0 && fy === 0 && fz === 0) continue;

      const chebyFeet = Math.max(Math.abs(fx - playerX), Math.abs(fy - playerFeetY), Math.abs(fz - playerZ));
      const chebyHead = Math.max(Math.abs(fx - playerX), Math.abs(fy - playerHeadY), Math.abs(fz - playerZ));
      const cheby = Math.min(chebyFeet, chebyHead);

      if (cheby <= range && cheby < closestDist) {
        closestDist = cheby;
        closest = fruit;
      }
    }

    return closest;
  }, [cameraRef, getHarvestRange]);

  // Harvest the nearest fruit (called on F key press)
  const harvestNearest = useCallback(() => {
    if (!userId || !TREE_CONFIG.ENABLED || harvestingRef.current) return;

    const fruit = findClosestFruit();
    if (!fruit) return;

    harvestingRef.current = true;
    const fruitId = fruit.id;
    const treeId = fruit.tree_id;
    const fruitCode = fruit.fruit_code || 'FR1';

    // Determine if own tree
    const tree = plantedTreesRef.current.find(t => t.id === treeId);
    const isOwnTree = tree?.planted_by === userId;

    // Roll tier
    const rolledTier = rollFruitTier(isOwnTree);
    const tierDef = getFruitTier(rolledTier);

    // Play harvest sound
    playSpatialSound(getSoundUrl('fruit_pickup', '/axe_chop.mp3'), 0, { baseVolume: 0.4 });

    // Mark fruit as not collectible immediately in the ref so prompt hides before React re-renders
    fruit.is_collectible = false;

    // Immediately remove fruit from local state so it disappears from the tree
    onFruitRemovedRef.current?.(fruitId);

    // Optimistic: immediately add to fruit panel before DB round-trip
    const optimisticFruit = {
      id: crypto.randomUUID(),
      user_id: userId,
      fruit_code: fruitCode,
      tier: rolledTier,
      created_at: new Date().toISOString(),
    };
    window.dispatchEvent(new CustomEvent('fruitHarvested', { detail: optimisticFruit }));

    // Toast
    toast({
      title: `Tier ${rolledTier} ${tierDef.name} Harvested!`,
      description: isOwnTree ? 'Own-tree bonus applied' : undefined,
      duration: 3000,
    });

    // Async DB operations
    (async () => {
      try {
        // Delete from tree_fruits
        const { error: delError } = await supabase
          .from('tree_fruits')
          .delete()
          .eq('id', fruitId);

        if (delError) {
          console.error('[FruitHarvest] Delete error:', delError);
        }

        // Insert into user_fruits
        const { data: inserted, error: insError } = await supabase
          .from('user_fruits' as any)
          .insert({
            user_id: userId,
            fruit_code: fruitCode,
            tier: rolledTier,
          } as any)
          .select()
          .single();

        if (insError) {
          console.error('[FruitHarvest] Insert error:', insError);
        } else if (inserted) {
          // Replace optimistic fruit with real DB fruit (has real ID)
          window.dispatchEvent(new CustomEvent('fruitHarvestConfirmed', {
            detail: { optimisticId: optimisticFruit.id, real: inserted },
          }));
        }

        // 1% chance: egg fruit
        if (Math.random() < FRUIT_CONFIG.EGG_CHANCE && addItemRef.current) {
          const { data: eggItem } = await supabase
            .from('items')
            .select('id')
            .eq('key', 'egg_fruit')
            .single();

          if (eggItem) {
            const added = await addItemRef.current(eggItem.id, 1);
            if (added) {
              toast({
                title: 'Egg Fruit Found!',
                description: 'A mysterious egg-shaped fruit...',
                duration: 5000,
              });
            }
          }
        }

        console.log(`[FruitHarvest] Harvested T${rolledTier} ${tierDef.name} (own=${isOwnTree})`);
      } catch (err) {
        console.error('[FruitHarvest] Error:', err);
      } finally {
        harvestingRef.current = false;
      }
    })();
  }, [userId, findClosestFruit, toast]);

  return {
    findClosestFruit,
    harvestNearest,
  };
}
