/**
 * useLootPickup - F-key proximity pickup for dropped world items.
 * Player must be within 2 blocks and press F to collect.
 *
 * Server is authoritative — the `pickup` callback wraps a single
 * atomic RPC (pickup_world_drop) that deletes the world row and
 * grants the item to the caller. Anyone can pick up any drop in
 * range, even during the 30s killer-only visibility window — the
 * server doesn't enforce killer-exclusivity for pickup, only for
 * visibility (rendered in DroppedItemRenderer.tsx).
 */

import { useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';
import type { DroppedWorldItem } from '@/features/shwarm/types';
import { useToast } from '@/hooks/use-toast';
import { getLocalPlayerSnapshot } from '@/hooks/usePlayerSnapshot';

const PICKUP_RANGE = 2.0; // blocks
const PICKUP_DEBOUNCE_MS = 500;

interface UseLootPickupOptions {
  droppedItemsRef: React.RefObject<DroppedWorldItem[]>;
  userId: string | null;
  cameraRef: React.RefObject<THREE.Camera>;
  /** Server-side atomic pickup. Returns true on success. */
  pickup: (dropId: string) => Promise<boolean>;
}

export function useLootPickup({
  droppedItemsRef,
  userId,
  cameraRef,
  pickup,
}: UseLootPickupOptions) {
  const lastPickupRef = useRef(0);
  const { toast } = useToast();

  const collectNearbyItem = useCallback(async () => {
    if (!document.pointerLockElement) return;

    const now = Date.now();
    if (now - lastPickupRef.current < PICKUP_DEBOUNCE_MS) return;

    const camera = cameraRef.current;
    const items = droppedItemsRef.current;
    if (!camera || !items || items.length === 0 || !userId) return;

    const snap = getLocalPlayerSnapshot();
    const px = snap.x, py = snap.y, pz = snap.z;

    let closestDist = Infinity;
    let closestItem: DroppedWorldItem | null = null;

    for (const item of items) {
      if (item.pickedUp) continue;
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
    closestItem.pickedUp = true; // optimistic local guard against double-fire

    const success = await pickup(closestItem.id);
    if (success) {
      toast({ title: `Picked up ${closestItem.itemName}!` });
      // Realtime DELETE will remove the row from droppedItemsRef.
    } else {
      closestItem.pickedUp = false;
    }
  }, [userId, cameraRef, droppedItemsRef, pickup, toast]);

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
