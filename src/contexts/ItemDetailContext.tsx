// ItemDetailContext — global "open the item detail modal" hook.
// Any HUD / inventory / vault component can call openItem(payload)
// from a right-click handler; the modal renders at app root.
//
// Payload is intentionally minimal — the modal will fetch the full
// item def from the items table by item_id (so tier, damage, rarity,
// category, etc. show up regardless of which surface called it).

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface ItemDetailSeed {
  itemId: string | null;
  name: string;
  sprite: string | null;
  itemNumber: number | null;
  tier: number | null;
  quantity: number;
}

export interface ItemDetailFull extends ItemDetailSeed {
  /** Full row from items table (looked up by itemId). May be null if
   *  the item_id doesn't exist or lookup is in flight. */
  fullDef: Record<string, any> | null;
}

interface ItemDetailContextType {
  open: ItemDetailFull | null;
  openItem: (seed: ItemDetailSeed) => void;
  close: () => void;
}

const Ctx = createContext<ItemDetailContextType | undefined>(undefined);

export function ItemDetailProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState<ItemDetailFull | null>(null);

  const openItem = useCallback((seed: ItemDetailSeed) => {
    setOpen({ ...seed, fullDef: null });
  }, []);
  const close = useCallback(() => setOpen(null), []);

  // Whenever a modal opens with an itemId, fetch the full item row
  // so we can show tier/damage/rarity/etc. without each caller
  // having to pre-load those.
  useEffect(() => {
    if (!open || !open.itemId || open.fullDef) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('items')
        .select('*')
        .eq('id', open.itemId)
        .maybeSingle();
      if (cancelled) return;
      setOpen(prev => prev && prev.itemId === open.itemId
        ? { ...prev, fullDef: data ?? null }
        : prev);
    })();
    return () => { cancelled = true; };
  }, [open?.itemId, open?.fullDef]);

  // Esc closes the modal.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  return (
    <Ctx.Provider value={{ open, openItem, close }}>
      {children}
    </Ctx.Provider>
  );
}

export function useItemDetail(): ItemDetailContextType {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useItemDetail must be inside <ItemDetailProvider>');
  return ctx;
}
