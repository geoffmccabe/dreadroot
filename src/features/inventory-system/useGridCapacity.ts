// useGridCapacity — THE single source of truth for the user's allocated grid sizes.
//
// Capacity is DATA, not constants (see docs/UNIFIED_GRID_PLAN.md). Items can grant more QA
// slots, a bigger inventory, a bigger vault. Every size the grid uses comes from here, so the
// rest of the system never hardcodes a count.
//
//   - Vault: already per-user via `user_vault_config` (page_count, cols, rows) — read live.
//   - QA + inventory: default today, but sourced in THIS one place so slot-expansion items can
//     grow them later (extend the query below) without touching grid logic or rendering.

import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { DEFAULT_CAPACITY, type GridCapacity } from './gridModel';

export function useGridCapacity(userId: string | null | undefined): GridCapacity {
  const [cap, setCap] = useState<GridCapacity>(DEFAULT_CAPACITY);

  useEffect(() => {
    if (!userId) { setCap(DEFAULT_CAPACITY); return; }
    let cancelled = false;
    (async () => {
      // Vault config is the one capacity already stored per-user. QA/inventory expansion items
      // will be read here too (e.g. count owned slot-expansion items → add to qaCols/invRows).
      const { data } = await (supabase as unknown as {
        from: (t: string) => { select: (c: string) => { eq: (k: string, v: string) => { maybeSingle: () => Promise<{ data: { page_count: number; cols: number; rows: number } | null }> } } };
      }).from('user_vault_config').select('page_count, cols, rows').eq('user_id', userId).maybeSingle();
      if (cancelled) return;

      const vaultCols = data?.cols ?? DEFAULT_CAPACITY.vaultCols;
      const vaultRowsPerPage = data?.rows ?? 5;
      const pageCount = data?.page_count ?? 4;

      setCap({
        ...DEFAULT_CAPACITY,
        // TODO(capacity): source qaCols / invCols / invRows from the user's slot-expansion
        // items here. Until those items exist, defaults apply — but this is the ONLY place to
        // change, and the grid already renders + moves against whatever is returned.
        vaultCols,
        vaultPageSize: vaultCols * vaultRowsPerPage,
        vaultSlots: pageCount * vaultCols * vaultRowsPerPage,
      });
    })();
    return () => { cancelled = true; };
  }, [userId]);

  return cap;
}
