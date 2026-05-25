// useVaultData — fetches the user's vault rows + config, resolves item
// defs for rendering, and exposes mutators that the panel uses to add,
// move, and remove rows. Reads/writes the user_vault + user_vault_config
// tables directly; all updates are optimistic with rollback on error.
//
// NOTE: stacking, splitting (vault → non-stackable inventory), and the
// vault ↔ inventory transfer rules live in the panel component — this
// hook is the storage layer only.

import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { VaultRow, VaultConfig, VaultSlotDef } from '../types';

interface ItemDef {
  id: string;
  key: string;
  name: string;
  tier: number | null;
  item_number: number | null;
  texture_url: string | null;
}

const DEFAULT_CONFIG: VaultConfig = { page_count: 4, cols: 5, rows: 5 };

export function useVaultData(userId: string | null) {
  const [rows, setRows] = useState<VaultRow[]>([]);
  const [config, setConfig] = useState<VaultConfig>(DEFAULT_CONFIG);
  const [itemDefs, setItemDefs] = useState<Map<string, ItemDef>>(new Map());
  const [isLoading, setIsLoading] = useState(true);

  // Initial fetch — vault rows, config, and item defs for every itemId
  // referenced. One round-trip-per-table is cheap and keeps the flow
  // simple; a single user's vault tops out at page_count * cols * rows
  // which is currently 100 rows.
  useEffect(() => {
    if (!userId) {
      setRows([]);
      setConfig(DEFAULT_CONFIG);
      setItemDefs(new Map());
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      const [{ data: vaultRows }, { data: cfg }] = await Promise.all([
        supabase.from('user_vault' as any).select('*').eq('user_id', userId),
        supabase.from('user_vault_config' as any).select('*').eq('user_id', userId).maybeSingle(),
      ]);
      if (cancelled) return;
      const rowsList = (vaultRows as VaultRow[] | null) || [];
      setRows(rowsList);
      if (cfg) {
        setConfig({
          page_count: (cfg as any).page_count,
          cols: (cfg as any).cols,
          rows: (cfg as any).rows,
        });
      } else {
        // No config row yet — first-time vault user. Create one with
        // the defaults so future updates have something to update.
        await supabase.from('user_vault_config' as any).insert({
          user_id: userId, ...DEFAULT_CONFIG,
        });
        setConfig(DEFAULT_CONFIG);
      }

      const itemIds = Array.from(new Set(rowsList.map(r => r.item_id)));
      if (itemIds.length > 0) {
        const { data: defs } = await supabase
          .from('items')
          .select('id, key, name, tier, item_number, texture_url')
          .in('id', itemIds);
        if (defs && !cancelled) {
          const map = new Map<string, ItemDef>();
          for (const d of defs as ItemDef[]) map.set(d.id, d);
          setItemDefs(map);
        }
      }
      setIsLoading(false);
    })();
    return () => { cancelled = true; };
  }, [userId]);

  // Re-fetch item defs lazily when a new itemId enters the vault (e.g.
  // user moves an unknown item from inventory). Cheap — only fires on
  // unseen ids, and only one query at a time per id.
  const fetchingRef = useRef<Set<string>>(new Set());
  const ensureItemDefs = useCallback(async (ids: string[]) => {
    const missing = ids.filter(id => !itemDefs.has(id) && !fetchingRef.current.has(id));
    if (missing.length === 0) return;
    for (const id of missing) fetchingRef.current.add(id);
    const { data } = await supabase
      .from('items')
      .select('id, key, name, tier, item_number, texture_url')
      .in('id', missing);
    if (data) {
      setItemDefs(prev => {
        const next = new Map(prev);
        for (const d of data as ItemDef[]) next.set(d.id, d);
        return next;
      });
    }
    for (const id of missing) fetchingRef.current.delete(id);
  }, [itemDefs]);

  // Build the per-page slot list every render. With ~100 rows max, this
  // is essentially free; no memoization needed.
  const pages: VaultSlotDef[][] = [];
  for (let p = 0; p < config.page_count; p++) pages.push([]);
  for (const row of rows) {
    if (row.page >= config.page_count) continue;
    const def = itemDefs.get(row.item_id);
    pages[row.page].push({
      rowId: row.id,
      page: row.page,
      slot: row.slot,
      itemId: row.item_id,
      itemKey: def?.key ?? '',
      name: def?.name ?? '',
      tier: def?.tier ?? null,
      itemNumber: def?.item_number ?? null,
      textureUrl: def?.texture_url ?? null,
      quantity: row.quantity,
    });
  }

  // ── Mutators ────────────────────────────────────────────────────
  // All mutators are optimistic. On DB failure we re-fetch to recover
  // truth; rolling back individual edits is more fragile than a small
  // refetch given vault row counts are tiny.

  const refetch = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase.from('user_vault' as any).select('*').eq('user_id', userId);
    setRows((data as VaultRow[] | null) || []);
  }, [userId]);

  /** Put `quantity` of an item into (page, slot). Creates the row if
   *  empty, stacks onto an existing row if same itemId, replaces if
   *  different (caller is expected to first pick up the existing stack
   *  onto the cursor in that case). Returns the resulting row. */
  const setSlot = useCallback(async (
    page: number, slot: number, itemId: string, quantity: number
  ): Promise<VaultRow | null> => {
    if (!userId || quantity <= 0) return null;
    await ensureItemDefs([itemId]);

    // Optimistic local update
    const tempId = `tmp-${Math.random().toString(36).slice(2)}`;
    let resultingRowId: string | null = null;
    setRows(prev => {
      const existing = prev.find(r => r.page === page && r.slot === slot);
      if (existing && existing.item_id === itemId) {
        resultingRowId = existing.id;
        return prev.map(r => r.id === existing.id
          ? { ...r, quantity: r.quantity + quantity }
          : r);
      }
      // empty or different item — replace
      const without = prev.filter(r => !(r.page === page && r.slot === slot));
      const row: VaultRow = { id: tempId, user_id: userId, page, slot, item_id: itemId, quantity };
      resultingRowId = tempId;
      return [...without, row];
    });

    // Database: try insert; on conflict do an upsert via RPC-less flow.
    const { data: existingDb } = await supabase
      .from('user_vault' as any)
      .select('*')
      .eq('user_id', userId).eq('page', page).eq('slot', slot)
      .maybeSingle();

    if (existingDb && (existingDb as any).item_id === itemId) {
      const newQty = (existingDb as any).quantity + quantity;
      const { data: updated, error } = await supabase
        .from('user_vault' as any)
        .update({ quantity: newQty })
        .eq('id', (existingDb as any).id)
        .select().single();
      if (error) { await refetch(); return null; }
      setRows(prev => prev.map(r => r.id === resultingRowId
        ? { ...(updated as any) } as VaultRow
        : r));
      return updated as any;
    }
    // Either no existing row, or different itemId. If different itemId,
    // we already cleared it from local state — delete on DB before
    // inserting.
    if (existingDb) {
      await supabase.from('user_vault' as any).delete().eq('id', (existingDb as any).id);
    }
    const { data: inserted, error } = await supabase
      .from('user_vault' as any)
      .insert({ user_id: userId, page, slot, item_id: itemId, quantity })
      .select().single();
    if (error) { await refetch(); return null; }
    setRows(prev => prev.map(r => r.id === resultingRowId
      ? { ...(inserted as any) } as VaultRow
      : r));
    return inserted as any;
  }, [userId, ensureItemDefs, refetch]);

  /** Take `quantity` from (page, slot). Deletes the row if quantity
   *  reaches 0. Returns the actual amount removed. */
  const removeFromSlot = useCallback(async (
    page: number, slot: number, quantity: number
  ): Promise<number> => {
    if (!userId || quantity <= 0) return 0;
    const row = rows.find(r => r.page === page && r.slot === slot);
    if (!row) return 0;
    const take = Math.min(row.quantity, quantity);
    const remaining = row.quantity - take;

    if (remaining <= 0) {
      setRows(prev => prev.filter(r => r.id !== row.id));
      const { error } = await supabase.from('user_vault' as any).delete().eq('id', row.id);
      if (error) await refetch();
    } else {
      setRows(prev => prev.map(r => r.id === row.id ? { ...r, quantity: remaining } : r));
      const { error } = await supabase
        .from('user_vault' as any)
        .update({ quantity: remaining })
        .eq('id', row.id);
      if (error) await refetch();
    }
    return take;
  }, [userId, rows, refetch]);

  /** Bulk replace a whole page's layout (used by ORG button). */
  const replacePageLayout = useCallback(async (
    page: number, newRows: Array<{ slot: number; item_id: string; quantity: number }>
  ): Promise<void> => {
    if (!userId) return;
    // Optimistic: rebuild local state for that page
    const otherPages = rows.filter(r => r.page !== page);
    const tempPageRows: VaultRow[] = newRows.map((r, i) => ({
      id: `tmp-${i}-${Math.random().toString(36).slice(2)}`,
      user_id: userId,
      page,
      slot: r.slot,
      item_id: r.item_id,
      quantity: r.quantity,
    }));
    setRows([...otherPages, ...tempPageRows]);

    // DB: wipe page, re-insert. Cheap (≤ cols*rows rows).
    await supabase.from('user_vault' as any).delete().eq('user_id', userId).eq('page', page);
    if (newRows.length > 0) {
      const toInsert = newRows.map(r => ({
        user_id: userId, page, slot: r.slot, item_id: r.item_id, quantity: r.quantity,
      }));
      await supabase.from('user_vault' as any).insert(toInsert);
    }
    await refetch();
  }, [userId, rows, refetch]);

  return {
    pages,
    config,
    isLoading,
    setSlot,
    removeFromSlot,
    replacePageLayout,
    ensureItemDefs,
    refetch,
  };
}
