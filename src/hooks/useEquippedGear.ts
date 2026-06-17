import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { getItemSpriteUrl } from '@/lib/itemSprite';

// The four equip slots. Each REFERENCES an owned item (it stays in inventory/QS).
export type GearSlot = 'weapon' | 'armor' | 'boots' | 'potion';
export const GEAR_SLOTS: GearSlot[] = ['weapon', 'armor', 'boots', 'potion'];

// Which item_category an item must have to go in a given slot.
export const SLOT_CATEGORY: Record<GearSlot, string[]> = {
  weapon: ['weapon'],
  armor: ['armor'],
  boots: ['boots'],
  potion: ['consumable', 'potion'],
};

export interface ResolvedGear {
  itemId: string;
  name: string;
  itemNumber: number | null;
  tier: number | null;
  category: string;
  spriteUrl: string | null;
}

type GearMap = Record<GearSlot, ResolvedGear | null>;
const EMPTY: GearMap = { weapon: null, armor: null, boots: null, potion: null };

// user_equipped_gear isn't in the generated types yet — cast the client.
const sb = supabase as unknown as {
  from: (t: string) => {
    select: (c: string) => {
      eq: (k: string, v: string) => Promise<{ data: Array<{ slot_type: GearSlot; item_id: string | null }> | null }>;
      in: (k: string, v: string[]) => Promise<{ data: Array<{ id: string; name: string; item_number: number | null; tier: number | null; item_category: string; texture_url: string | null }> | null }>;
    };
    upsert: (row: Record<string, unknown>, opts: { onConflict: string }) => Promise<{ error: unknown }>;
    delete: () => { eq: (k: string, v: string) => { eq: (k2: string, v2: string) => Promise<{ error: unknown }> } };
  };
};

export function useEquippedGear() {
  const { user } = useAuth();
  const [gear, setGearState] = useState<GearMap>(EMPTY);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user?.id) { setGearState(EMPTY); setLoading(false); return; }
    setLoading(true);
    const { data: rows } = await sb.from('user_equipped_gear').select('slot_type,item_id').eq('user_id', user.id);
    const refs = (rows || []).filter(r => r.item_id);
    const ids = refs.map(r => r.item_id as string);
    let defs: Record<string, ResolvedGear> = {};
    if (ids.length) {
      const { data: items } = await sb.from('items')
        .select('id,name,item_number,tier,item_category,texture_url').in('id', ids);
      for (const it of items || []) {
        defs[it.id] = {
          itemId: it.id, name: it.name, itemNumber: it.item_number, tier: it.tier,
          category: it.item_category,
          spriteUrl: getItemSpriteUrl({ item_number: it.item_number, texture_url: it.texture_url } as { item_number: number | null; texture_url: string | null }),
        };
      }
    }
    const next: GearMap = { ...EMPTY };
    for (const r of refs) {
      const d = defs[r.item_id as string];
      if (d && (GEAR_SLOTS as string[]).includes(r.slot_type)) next[r.slot_type] = d;
    }
    setGearState(next);
    setLoading(false);
  }, [user?.id]);

  useEffect(() => { void load(); }, [load]);

  // Set or clear a slot. Optimistic; re-syncs definitions on success.
  const setGear = useCallback(async (slot: GearSlot, itemId: string | null) => {
    if (!user?.id) return;
    if (itemId) {
      const { error } = await sb.from('user_equipped_gear')
        .upsert({ user_id: user.id, slot_type: slot, item_id: itemId, updated_at: new Date().toISOString() }, { onConflict: 'user_id,slot_type' });
      if (error) { console.error('[equipGear] set failed', error); return; }
    } else {
      const { error } = await sb.from('user_equipped_gear').delete().eq('user_id', user.id).eq('slot_type', slot);
      if (error) { console.error('[equipGear] clear failed', error); return; }
    }
    await load();
  }, [user?.id, load]);

  return { gear, setGear, loading, reloadGear: load };
}
