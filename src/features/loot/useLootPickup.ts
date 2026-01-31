/**
 * useLootPickup - F-key proximity pickup for dropped world items.
 * Player must be within 2 blocks and press F to collect.
 * Items are exclusive to the killer for 30 seconds, then available to all.
 */

import { useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';
import type { DroppedWorldItem } from '@/features/shwarm/types';
import { useToast } from '@/hooks/use-toast';

const PICKUP_RANGE = 2.0; // blocks
const EXCLUSIVITY_MS = 30_000;
const PICKUP_DEBOUNCE_MS = 500;

interface UseLootPickupOptions {
  droppedItemsRef: React.RefObject<DroppedWorldItem[]>;
  userId: string | null;
  cameraRef: React.RefObject<THREE.Camera>;
  addItem: (itemId: string, quantity: number) => Promise<boolean>;
  onItemPickedUp: (dropId: string) => void;
}

export function useLootPickup({
  droppedItemsRef,
  userId,
  cameraRef,
  addItem,
  onItemPickedUp,
}: UseLootPickupOptions) {
  const lastPickupRef = useRef(0);
  const { toast } = useToast();

  const collectNearbyItem = useCallback(async () => {
    // Only allow pickup when pointer is locked (game is active)
    if (!document.pointerLockElement) return;

    const now = Date.now();
    if (now - lastPickupRef.current < PICKUP_DEBOUNCE_MS) return;

    const camera = cameraRef.current;
    const items = droppedItemsRef.current;
    if (!camera || !items || items.length === 0 || !userId) return;

    const px = camera.position.x;
    const py = camera.position.y;
    const pz = camera.position.z;

    let closestDist = Infinity;
    let closestItem: DroppedWorldItem | null = null;

    for (const item of items) {
      if (item.pickedUp) continue;

      // Exclusivity check
      if (now - item.droppedAt < EXCLUSIVITY_MS && item.killerUserId !== userId) {
        continue;
      }

      const dx = item.position.x - px;
      const dy = item.position.y - py;
      const dz = item.position.z - pz;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (dist < PICKUP_RANGE && dist < closestDist) {
        closestDist = dist;
        closestItem = item;
      }
    }

    if (!closestItem) return;

    lastPickupRef.current = now;
    closestItem.pickedUp = true; // Immediately mark to prevent double-pickup

    const success = await addItem(closestItem.itemId, 1);
    if (success) {
      onItemPickedUp(closestItem.id);
      toast({
        title: `Picked up ${closestItem.itemName}!`,
      });
    } else {
      closestItem.pickedUp = false; // Revert on failure
    }
  }, [userId, cameraRef, droppedItemsRef, addItem, onItemPickedUp, toast]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'KeyF') {
        collectNearbyItem();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [collectNearbyItem]);
}
