// World-eggs system. Fetches the owner's dropped shpider eggs, keeps
// them in sync via Supabase realtime, exposes a pickup function that
// deletes the world row and inserts a fresh inventory row with a
// 1-hour cooldown_until.

import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { supabase } from '@/integrations/supabase/client';

export interface WorldEgg {
  id: string;
  tier: number;
  ownerUserId: string;
  x: number;
  y: number;
  z: number;
}

interface UseWorldEggsOptions {
  userId: string | null;
  cameraRef: React.RefObject<THREE.Camera | null>;
}

/** Pickup cooldown — spec value, applied at pickup time. */
const EGG_PICKUP_COOLDOWN_MS = 60 * 60 * 1000;

/** Max world-space distance for "nearby" prompt + F-pickup. */
export const EGG_PICKUP_REACH = 2.2;

export function useWorldEggs({ userId, cameraRef }: UseWorldEggsOptions) {
  const [eggs, setEggs] = useState<WorldEgg[]>([]);
  const eggsRef = useRef<WorldEgg[]>([]);
  useEffect(() => { eggsRef.current = eggs; }, [eggs]);

  // Initial fetch + realtime subscription (owner-scoped via RLS).
  useEffect(() => {
    if (!userId) {
      setEggs([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('world_eggs' as any)
        .select('*')
        .eq('owner_user_id', userId);
      if (cancelled) return;
      if (error) {
        // Table may not exist yet — degrade silently.
        console.warn('[WorldEggs] fetch failed:', error.message);
        return;
      }
      setEggs((data ?? []).map((r: any) => ({
        id: r.id,
        tier: r.tier,
        ownerUserId: r.owner_user_id,
        x: Number(r.position_x), y: Number(r.position_y), z: Number(r.position_z),
      })));
    })();

    const channel = supabase
      .channel(`world_eggs_${userId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'world_eggs', filter: `owner_user_id=eq.${userId}` },
        (payload) => {
          const r: any = payload.new;
          setEggs(prev => prev.some(e => e.id === r.id) ? prev : [
            ...prev,
            { id: r.id, tier: r.tier, ownerUserId: r.owner_user_id,
              x: Number(r.position_x), y: Number(r.position_y), z: Number(r.position_z) },
          ]);
        },
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'world_eggs', filter: `owner_user_id=eq.${userId}` },
        (payload) => {
          const id = (payload.old as any)?.id;
          if (!id) return;
          setEggs(prev => prev.filter(e => e.id !== id));
        },
      )
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [userId]);

  /** Nearest world egg within EGG_PICKUP_REACH of the player camera,
   *  or null. Returns the owner's eggs only (the hook only fetches
   *  owner-scoped rows in the first place). */
  const findClosestEgg = useCallback((): WorldEgg | null => {
    const cam = cameraRef.current;
    if (!cam) return null;
    const px = cam.position.x, py = cam.position.y, pz = cam.position.z;
    let best: WorldEgg | null = null;
    let bestSq = EGG_PICKUP_REACH * EGG_PICKUP_REACH;
    for (const e of eggsRef.current) {
      const dx = e.x - px, dy = e.y - py, dz = e.z - pz;
      const dsq = dx*dx + dy*dy + dz*dz;
      if (dsq < bestSq) { bestSq = dsq; best = e; }
    }
    return best;
  }, [cameraRef]);

  /** Delete the world row and insert a fresh inventory row with a
   *  1-hour cooldown_until. Returns the picked-up egg or null. */
  const pickupClosestEgg = useCallback(async (): Promise<WorldEgg | null> => {
    const target = findClosestEgg();
    if (!target || !userId) return null;
    // Look up the item id for this tier.
    const { data: itemRow, error: itemErr } = await supabase
      .from('items')
      .select('id')
      .eq('key', `shpider_egg_t${target.tier}`)
      .maybeSingle();
    if (itemErr || !itemRow) {
      console.warn('[WorldEggs] no items row for', `shpider_egg_t${target.tier}`);
      return null;
    }
    const cooldownIso = new Date(Date.now() + EGG_PICKUP_COOLDOWN_MS).toISOString();
    // Delete the world row first (owner-scoped via RLS).
    const { error: delErr } = await supabase
      .from('world_eggs' as any)
      .delete()
      .eq('id', target.id);
    if (delErr) {
      console.warn('[WorldEggs] delete failed:', delErr.message);
      return null;
    }
    // Insert a fresh inventory row. Non-stackable so quantity=1 per
    // row. cooldown_until stays set until the timer clears.
    const { error: insErr } = await supabase
      .from('user_inventory')
      .insert({
        user_id: userId,
        item_type: 'item',
        item_id: itemRow.id,
        quantity: 1,
        cooldown_until: cooldownIso,
      } as any);
    if (insErr) {
      console.warn('[WorldEggs] inventory insert failed:', insErr.message);
      return null;
    }
    // Optimistic local removal — realtime DELETE will confirm soon.
    setEggs(prev => prev.filter(e => e.id !== target.id));
    return target;
  }, [findClosestEgg, userId]);

  return { eggs, eggsRef, findClosestEgg, pickupClosestEgg };
}
