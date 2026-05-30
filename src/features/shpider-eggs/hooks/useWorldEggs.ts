// World-eggs system. Fetches the owner's dropped shpider eggs, keeps
// them in sync via Supabase realtime, exposes a pickup function that
// deletes the world row and inserts a fresh inventory row with a
// 1-hour cooldown_until.

import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { supabase } from '@/integrations/supabase/client';
import { worldStore } from '@/services/worldStore';
import { useToast } from '@/hooks/use-toast';
import { playRejectionSound } from '@/components/fortress/FortressAudio';

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

/** Max horizontal (XZ) distance for "nearby" prompt + F-pickup.
 *  Y is excluded so the player's standing-height-above-ground doesn't
 *  eat into the budget — the egg can be on the floor and the player
 *  can be standing right next to it and still pick up. Generous
 *  enough that "walking past" picks up. */
export const EGG_PICKUP_REACH = 4.0;

export function useWorldEggs({ userId, cameraRef }: UseWorldEggsOptions) {
  const [eggs, setEggs] = useState<WorldEgg[]>([]);
  const eggsRef = useRef<WorldEgg[]>([]);
  useEffect(() => { eggsRef.current = eggs; }, [eggs]);
  const { toast } = useToast();

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
    const px = cam.position.x, pz = cam.position.z;
    let best: WorldEgg | null = null;
    let bestSq = EGG_PICKUP_REACH * EGG_PICKUP_REACH;
    for (const e of eggsRef.current) {
      const dx = e.x - px, dz = e.z - pz;
      const dsq = dx*dx + dz*dz;
      if (dsq < bestSq) { bestSq = dsq; best = e; }
    }
    return best;
  }, [cameraRef]);

  /** Atomic world-egg pickup via worldStore. Server deletes the world
   *  row, inserts a fresh inventory row, and applies the item's
   *  configured pickup cooldown in one transaction.
   *
   *  Visible UX:
   *   - success → success toast
   *   - no egg in range (but eggs exist) → "out of range" toast + rejection sound
   *   - RPC failure → error toast (with reason) + rejection sound
   *   - no eggs at all → silent (don't spam the player on every F press)
   */
  const pickupClosestEgg = useCallback(async (): Promise<WorldEgg | null> => {
    if (!userId) return null;

    const target = findClosestEgg();
    if (!target) {
      // Out-of-range diagnostic. Only show if eggs exist somewhere —
      // otherwise F probably means "harvest fruit" instead.
      const cam = cameraRef.current;
      if (cam && eggsRef.current.length > 0) {
        const cx = cam.position.x, cz = cam.position.z;
        let closestDist = Infinity;
        for (const e of eggsRef.current) {
          const d = Math.hypot(e.x - cx, e.z - cz);
          if (d < closestDist) closestDist = d;
        }
        toast({
          title: 'Egg out of reach',
          description: `Closest egg is ${closestDist.toFixed(1)}m away — get within ${EGG_PICKUP_REACH}m.`,
          variant: 'destructive',
          duration: 2500,
        });
        const r = (window as any).__rejectionSound;
        if (r) playRejectionSound(r);
      }
      return null;
    }

    try {
      await worldStore.pickupEgg(target.id);
      // Optimistic local removal — realtime DELETE will reconfirm.
      setEggs(prev => prev.filter(e => e.id !== target.id));
      toast({
        title: `Picked up T${target.tier} Shpider Egg!`,
        duration: 2500,
      });
      return target;
    } catch (err: any) {
      console.warn('[WorldEggs] pickup failed:', err);
      const reason = err?.message || err?.details || String(err);
      toast({
        title: 'Pickup failed',
        description: reason,
        variant: 'destructive',
        duration: 4000,
      });
      const r = (window as any).__rejectionSound;
      if (r) playRejectionSound(r);
      return null;
    }
  }, [findClosestEgg, userId, cameraRef, toast]);

  return { eggs, eggsRef, findClosestEgg, pickupClosestEgg };
}
