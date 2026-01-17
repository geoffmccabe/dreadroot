// Hook for fruit collection with E key
// Handles proximity detection and inventory update

import { useEffect, useCallback, useRef } from 'react';
import * as THREE from 'three';
import { supabase } from '@/integrations/supabase/client';
import { TreeFruit } from '../types';
import { TREE_CONFIG } from '../constants';
import { useToast } from '@/hooks/use-toast';

interface UseFruitPickupOptions {
  treeFruits: TreeFruit[];
  userId: string | null;
  cameraRef: React.RefObject<THREE.Camera>;
  isLocked: boolean;
  onFruitCollected?: (fruit: TreeFruit) => void;
}

export function useFruitPickup({
  treeFruits,
  userId,
  cameraRef,
  isLocked,
  onFruitCollected,
}: UseFruitPickupOptions) {
  const { toast } = useToast();
  const lastPickupTime = useRef(0);

  const collectNearbyFruit = useCallback(async () => {
    if (!userId || !cameraRef.current || !TREE_CONFIG.ENABLED) return;

    // Debounce pickups
    const now = Date.now();
    if (now - lastPickupTime.current < 500) return;

    const cameraPos = cameraRef.current.position;

    // Find closest collectible fruit within range
    let closestFruit: TreeFruit | null = null;
    let closestDist = TREE_CONFIG.FRUIT_PICKUP_RANGE;

    for (const fruit of treeFruits) {
      if (!fruit.is_collectible) continue;

      const dx = fruit.position_x + 0.5 - cameraPos.x;
      const dy = fruit.position_y + 0.5 - cameraPos.y;
      const dz = fruit.position_z + 0.5 - cameraPos.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (dist < closestDist) {
        closestDist = dist;
        closestFruit = fruit;
      }
    }

    if (!closestFruit) return;

    lastPickupTime.current = now;

    // Delete the fruit (collection)
    const { error } = await supabase
      .from('tree_fruits')
      .delete()
      .eq('id', closestFruit.id);

    if (error) {
      console.error('[FruitPickup] Delete error:', error);
      return;
    }

    // TODO: Add to inventory when inventory system is integrated
    // For now, just show toast
    toast({
      title: 'Fruit collected!',
      description: `Tier ${closestFruit.tier} fruit`,
    });

    onFruitCollected?.(closestFruit);
  }, [userId, cameraRef, treeFruits, toast, onFruitCollected]);

  // Listen for E key
  useEffect(() => {
    if (!isLocked || !TREE_CONFIG.ENABLED) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'KeyE') {
        collectNearbyFruit();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isLocked, collectNearbyFruit]);

  // Get count of nearby collectible fruits (for UI indicator)
  const getNearbyFruitCount = useCallback((): number => {
    if (!cameraRef.current || !TREE_CONFIG.ENABLED) return 0;

    const cameraPos = cameraRef.current.position;
    let count = 0;

    for (const fruit of treeFruits) {
      if (!fruit.is_collectible) continue;

      const dx = fruit.position_x + 0.5 - cameraPos.x;
      const dy = fruit.position_y + 0.5 - cameraPos.y;
      const dz = fruit.position_z + 0.5 - cameraPos.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (dist < TREE_CONFIG.FRUIT_PICKUP_RANGE) {
        count++;
      }
    }

    return count;
  }, [cameraRef, treeFruits]);

  return {
    collectNearbyFruit,
    getNearbyFruitCount,
  };
}
