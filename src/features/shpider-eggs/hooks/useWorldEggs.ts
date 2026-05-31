// World-eggs system. Fetches the owner's dropped shpider eggs, keeps
// them in sync via Supabase realtime, exposes a pickup function that
// deletes the world row and inserts a fresh inventory row with a
// 1-hour cooldown_until.

import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { supabase } from '@/integrations/supabase/client';
import { worldStore } from '@/services/worldStore';
import { playRejectionSound } from '@/components/fortress/FortressAudio';
import { setDebugStatus } from '@/lib/debugStatus';

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
   *  configured pickup cooldown in one transaction. Plays the
   *  rejection sound when pickup fails (no egg in range, RPC error). */
  const pickupClosestEgg = useCallback(async (): Promise<WorldEgg | null> => {
    if (!userId) {
      setDebugStatus('egg: no user');
      return null;
    }

    const target = findClosestEgg();
    if (!target) {
      // Out-of-range: compute distance to closest egg so the HUD line
      // tells us how far away it actually is.
      const cam = cameraRef.current;
      if (cam && eggsRef.current.length > 0) {
        const cx = cam.position.x, cz = cam.position.z;
        let closestDist = Infinity;
        for (const e of eggsRef.current) {
          const d = Math.hypot(e.x - cx, e.z - cz);
          if (d < closestDist) closestDist = d;
        }
        setDebugStatus(`egg: OOR ${closestDist.toFixed(1)}m (need ≤${EGG_PICKUP_REACH}m)`);
      } else {
        setDebugStatus('egg: no eggs in world');
      }
      const r = (window as any).__rejectionSound;
      if (r) playRejectionSound(r);
      return null;
    }

    try {
      await worldStore.pickupEgg(target.id);
      setEggs(prev => prev.filter(e => e.id !== target.id));
      setDebugStatus(`egg: OK T${target.tier} picked up`);
      return target;
    } catch (err: any) {
      const reason = err?.message || err?.code || err?.details || String(err);
      console.warn('[WorldEggs] pickup failed:', err);
      setDebugStatus(`egg: ERR ${reason.slice(0, 80)}`);
      const r = (window as any).__rejectionSound;
      if (r) playRejectionSound(r);
      return null;
    }
  }, [findClosestEgg, userId, cameraRef]);

  return { eggs, eggsRef, findClosestEgg, pickupClosestEgg };
}
