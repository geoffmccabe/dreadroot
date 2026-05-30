// useWorldDrops — fetches and subscribes to world_drops, exposes
// spawn + pickup helpers that go through worldStore RPCs. Replaces the
// old in-memory droppedItemsRef array so drops now persist L1 and are
// visible to other players (with a 30s killer-only window — see
// DroppedItemRenderer.tsx for the visibility filter).

import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { supabase } from '@/integrations/supabase/client';
import { worldStore } from '@/services/worldStore';
import type { DroppedWorldItem } from '@/features/shwarm/types';

interface ItemDef {
  item_number: number;
  name: string;
}

interface UseWorldDropsOptions {
  userId: string | null;
}

function rowToDrop(
  row: any,
  itemDef: ItemDef | null,
): DroppedWorldItem {
  return {
    id: row.id,
    itemId: row.item_id,
    itemNumber: itemDef?.item_number ?? 0,
    itemName: itemDef?.name ?? '',
    position: new THREE.Vector3(
      Number(row.position_x),
      Number(row.position_y),
      Number(row.position_z),
    ),
    droppedAt: new Date(row.dropped_at).getTime(),
    killerUserId: row.killer_user_id,
    pickedUp: false,
  };
}

export function useWorldDrops({ userId }: UseWorldDropsOptions) {
  const [drops, setDrops] = useState<DroppedWorldItem[]>([]);
  const dropsRef = useRef<DroppedWorldItem[]>([]);
  useEffect(() => { dropsRef.current = drops; }, [drops]);

  // item_id → {item_number, name}. Populated on initial fetch via JOIN
  // and on realtime INSERTs via lazy lookup (cached).
  const itemDefsRef = useRef<Map<string, ItemDef>>(new Map());

  const fetchItemDef = useCallback(async (itemId: string): Promise<ItemDef | null> => {
    const cached = itemDefsRef.current.get(itemId);
    if (cached) return cached;
    const { data } = await supabase
      .from('items')
      .select('item_number, name')
      .eq('id', itemId)
      .maybeSingle();
    if (!data) return null;
    const def: ItemDef = { item_number: data.item_number ?? 0, name: data.name ?? '' };
    itemDefsRef.current.set(itemId, def);
    return def;
  }, []);

  // Initial fetch + realtime subscription.
  useEffect(() => {
    if (!userId) {
      setDrops([]);
      return;
    }
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from('world_drops')
        .select('id, item_id, killer_user_id, position_x, position_y, position_z, dropped_at, items(item_number, name)');
      if (cancelled) return;
      if (error) {
        console.warn('[useWorldDrops] fetch failed:', error.message);
        return;
      }
      const list: DroppedWorldItem[] = (data ?? []).map((row: any) => {
        const def: ItemDef = {
          item_number: row.items?.item_number ?? 0,
          name: row.items?.name ?? '',
        };
        itemDefsRef.current.set(row.item_id, def);
        return rowToDrop(row, def);
      });
      setDrops(list);
    })();

    const channel = supabase
      .channel('world_drops_all')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'world_drops' },
        async (payload) => {
          const row = payload.new as any;
          const def = await fetchItemDef(row.item_id);
          setDrops(prev =>
            prev.some(d => d.id === row.id) ? prev : [...prev, rowToDrop(row, def)],
          );
        },
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'world_drops' },
        (payload) => {
          const id = (payload.old as any)?.id;
          if (!id) return;
          setDrops(prev => prev.filter(d => d.id !== id));
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [userId, fetchItemDef]);

  /** Spawn a world drop via RPC. Realtime INSERT will populate state.
   *  The local itemDefs cache is also primed so the realtime payload
   *  resolves immediately when it arrives. */
  const spawnDrop = useCallback(
    async (
      itemId: string,
      itemNumber: number,
      itemName: string,
      position: THREE.Vector3,
    ): Promise<boolean> => {
      itemDefsRef.current.set(itemId, { item_number: itemNumber, name: itemName });
      try {
        await worldStore.spawnWorldDrop(itemId, {
          x: position.x,
          y: position.y,
          z: position.z,
        });
        return true;
      } catch (err) {
        console.warn('[useWorldDrops] spawn failed:', err);
        return false;
      }
    },
    [],
  );

  /** Atomic pickup. Server deletes the drop and grants the inventory
   *  row to the caller. Realtime DELETE will remove from state. */
  const pickupDrop = useCallback(async (dropId: string): Promise<boolean> => {
    try {
      await worldStore.pickupWorldDrop(dropId);
      return true;
    } catch (err) {
      console.warn('[useWorldDrops] pickup failed:', err);
      return false;
    }
  }, []);

  return { drops, dropsRef, spawnDrop, pickupDrop };
}
