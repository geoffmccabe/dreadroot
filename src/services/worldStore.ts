// The L1 Write API facade. All NEW write code goes through here.
// Existing direct supabase.from('table').insert/update/delete calls
// stay as-is during Phase D and get migrated incrementally (one
// table at a time, then RLS-locked in D8).
//
// Every method follows the same shape:
//   1. Generates a client request UUID (replay protection)
//   2. Calls a named SECURITY DEFINER RPC on Supabase
//   3. The RPC validates auth.uid() in its body, dedupes via
//      check_and_record_request, and returns a typed result
//
// Post-L2 the facade can be repointed at the L2 Durable Object
// without callers having to change — same method signatures.

import { supabase } from '@/integrations/supabase/client';

// ── Common shapes ───────────────────────────────────────────────────

export interface InventoryRow {
  id: string;
  user_id: string;
  item_type: string;
  item_id: string | null;
  quantity: number;
  created_at: string;
  updated_at: string;
}

/** Returned by every RPC. `replayed = true` means this exact
 *  request_id was already processed; the RPC did NOT re-apply the
 *  operation and the rows are the existing state. */
export interface WriteResult<T> {
  rows: T[];
  replayed: boolean;
}

// ── D1: grant_inventory_item ────────────────────────────────────────

/** Grant items to the caller's inventory. Server validates auth,
 *  caps quantity, dedupes by request id. Returns the affected
 *  inventory rows (one for stackable, N for non-stackable). */
export async function grantInventoryItem(
  itemId: string,
  quantity: number = 1,
  requestId?: string,
): Promise<WriteResult<InventoryRow>> {
  const reqId = requestId ?? crypto.randomUUID();
  const { data, error } = await supabase.rpc('grant_inventory_item', {
    p_item_id: itemId,
    p_quantity: quantity,
    p_client_request_id: reqId,
  });
  if (error) throw error;
  return data as WriteResult<InventoryRow>;
}

// ── Namespace export ────────────────────────────────────────────────

/** Namespace-style export. Callers can do either:
 *    import { worldStore } from '@/services/worldStore';
 *    worldStore.grantInventoryItem(...);
 *  OR:
 *    import { grantInventoryItem } from '@/services/worldStore';
 *    grantInventoryItem(...);
 *  Both forms are supported. New methods land here as they're added
 *  in subsequent Phase D sub-phases. */
export const worldStore = {
  grantInventoryItem,
};
