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
import { worldStore } from '@/services/worldStore';
import type { VaultRow, VaultConfig, VaultSlotDef } from '../types';

interface ItemDef {
  id: string;
  key: string;
  name: string;
  tier: number | null;
  item_number: number | null;
  texture_url: string | null;
  stackable?: boolean;
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
        // No config row yet — first-time vault user. RPC creates it
        // idempotently and returns the row (existing or just-created).
        try {
          const created = await worldStore.vaultEnsureConfig();
          if (created) {
            setConfig({
              page_count: created.page_count,
              cols: created.cols,
              rows: created.rows,
            });
          } else {
            setConfig(DEFAULT_CONFIG);
          }
        } catch (err) {
          console.error('[useVaultData] vaultEnsureConfig failed:', err);
          setConfig(DEFAULT_CONFIG);
        }
      }

      const itemIds = Array.from(new Set(rowsList.map(r => r.item_id)));
      if (itemIds.length > 0) {
        const { data: defs } = await supabase
          .from('items')
          .select('id, key, name, tier, item_number, texture_url, stackable')
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

  // Auto-refresh defs every time the rows list changes — catches
  // items added by refetch() (e.g. after a transfer) whose defs
  // weren't included in the initial mount-time fetch. Without this,
  // newly-transferred vault rows render as blank tiles forever.
  useEffect(() => {
    if (rows.length === 0) return;
    const ids = Array.from(new Set(rows.map(r => r.item_id)));
    ensureItemDefs(ids);
  }, [rows, ensureItemDefs]);

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

  /** Put `quantity` of an item into (page, slot). Server-authoritative:
   *  the RPC stacks on same-itemId or replaces if different and returns
   *  both the updated row and any deleted row id. Optimistic update is
   *  applied first; on RPC failure we refetch to recover. */
  const setSlot = useCallback(async (
    page: number, slot: number, itemId: string, quantity: number
  ): Promise<VaultRow | null> => {
    if (!userId || quantity <= 0) return null;
    await ensureItemDefs([itemId]);

    const tempId = `tmp-${Math.random().toString(36).slice(2)}`;
    setRows(prev => {
      const existing = prev.find(r => r.page === page && r.slot === slot);
      if (existing && existing.item_id === itemId) {
        return prev.map(r => r.id === existing.id
          ? { ...r, quantity: r.quantity + quantity }
          : r);
      }
      const without = prev.filter(r => !(r.page === page && r.slot === slot));
      const row: VaultRow = { id: tempId, user_id: userId, page, slot, item_id: itemId, quantity };
      return [...without, row];
    });

    try {
      const result = await worldStore.vaultSetSlot(page, slot, itemId, quantity);
      setRows(prev => {
        let next = prev;
        if (result.deletedRowIds.length > 0) {
          next = next.filter(r => !result.deletedRowIds.includes(r.id));
        }
        // Drop any tmp row at this slot, then merge real rows by id
        next = next.filter(r => !(r.id === tempId));
        for (const row of result.rows) {
          const idx = next.findIndex(r => r.id === row.id);
          if (idx >= 0) next[idx] = row;
          else next.push(row);
        }
        return next;
      });
      return result.rows[0] ?? null;
    } catch (err) {
      console.error('[useVaultData] vaultSetSlot failed:', err);
      await refetch();
      return null;
    }
  }, [userId, ensureItemDefs, refetch]);

  /** Take `quantity` from (page, slot). Server-authoritative: RPC
   *  decrements or deletes and returns the row delta. Optimistic
   *  update first; refetch on failure. */
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
    } else {
      setRows(prev => prev.map(r => r.id === row.id ? { ...r, quantity: remaining } : r));
    }

    try {
      const result = await worldStore.vaultRemoveFromSlot(page, slot, take);
      // Reconcile with server result (idempotent merge)
      setRows(prev => {
        let next = prev;
        if (result.deletedRowIds.length > 0) {
          next = next.filter(r => !result.deletedRowIds.includes(r.id));
        }
        for (const r of result.rows) {
          const idx = next.findIndex(x => x.id === r.id);
          if (idx >= 0) next[idx] = r;
          else next.push(r);
        }
        return next;
      });
    } catch (err) {
      console.error('[useVaultData] vaultRemoveFromSlot failed:', err);
      await refetch();
    }
    return take;
  }, [userId, rows, refetch]);

  /** Bulk replace a whole page's layout (used by ORG button). Single
   *  RPC does wipe + bulk insert atomically. */
  const replacePageLayout = useCallback(async (
    page: number, newRows: Array<{ slot: number; item_id: string; quantity: number }>
  ): Promise<void> => {
    if (!userId) return;
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

    try {
      const result = await worldStore.vaultReplacePage(page, newRows);
      setRows(prev => {
        const otherPagesNow = prev.filter(r => r.page !== page);
        return [...otherPagesNow, ...result.rows];
      });
    } catch (err) {
      console.error('[useVaultData] vaultReplacePage failed:', err);
      await refetch();
    }
  }, [userId, rows, refetch]);

  // ── Atomic transfers (item-history-backed) ─────────────────────
  // These prefer single-RPC transfers over the legacy 2-step
  // setSlot+removeFromSlot pattern. Server side is one transaction,
  // so a half-completed transfer can't lose items. Each call also
  // writes an item_history audit row.

  /** Move one or more inventory rows of the SAME item_id into a
   *  vault slot (stacks on a matching item, fills if empty). */
  const transferFromInventory = useCallback(async (
    inventoryRowIds: string[], page: number, slot: number,
  ): Promise<boolean> => {
    if (!userId || inventoryRowIds.length === 0) return false;
    try {
      const result = await worldStore.transferInventoryToVault(
        inventoryRowIds, page, slot,
      );
      await ensureItemDefs([result.itemId]);
      // Refetch is the simplest reconcile path here — inventory rows
      // were removed by the RPC, and the vault row got updated; both
      // sides need to converge. Vault rows are tiny so refetch is cheap.
      await refetch();
      return true;
    } catch (err) {
      console.error('[useVaultData] transferFromInventory failed:', err);
      await refetch();
      return false;
    }
  }, [userId, ensureItemDefs, refetch]);

  /** Move `quantity` from (page, slot) into inventory. */
  const transferToInventory = useCallback(async (
    page: number, slot: number, quantity: number,
  ): Promise<boolean> => {
    if (!userId || quantity <= 0) return false;
    try {
      await worldStore.transferVaultToInventory(page, slot, quantity);
      await refetch();
      return true;
    } catch (err) {
      console.error('[useVaultData] transferToInventory failed:', err);
      await refetch();
      return false;
    }
  }, [userId, refetch]);

  /** Move `quantity` between two vault slots. */
  const transferWithinVault = useCallback(async (
    srcPage: number, srcSlot: number,
    dstPage: number, dstSlot: number, quantity: number,
  ): Promise<boolean> => {
    if (!userId || quantity <= 0) return false;
    try {
      await worldStore.transferVaultToVault(
        srcPage, srcSlot, dstPage, dstSlot, quantity,
      );
      await refetch();
      return true;
    } catch (err) {
      console.error('[useVaultData] transferWithinVault failed:', err);
      await refetch();
      return false;
    }
  }, [userId, refetch]);

  return {
    pages,
    config,
    isLoading,
    setSlot,
    removeFromSlot,
    replacePageLayout,
    ensureItemDefs,
    refetch,
    transferFromInventory,
    transferToInventory,
    transferWithinVault,
  };
}
