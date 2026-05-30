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

// ── Inventory grants (D1 + D3) ──────────────────────────────────────
//
// All three grant flows go through one RPC: grant_inventory_row.
// The RPC validates by item_type:
//   • 'item'           — looks up items.key, applies stackable rules
//   • 'seed_tier_N'    — looks up seed_definitions
//   • anything else    — treated as a block key, looked up in blocks
// Stackability: items use the canonical non-stackable list; seeds and
// blocks always stack.

async function grantInventoryRow(
  itemType: string,
  itemId: string | null,
  quantity: number,
  requestId?: string,
): Promise<WriteResult<InventoryRow>> {
  const reqId = requestId ?? crypto.randomUUID();
  const { data, error } = await supabase.rpc('grant_inventory_row', {
    p_item_type: itemType,
    p_item_id: itemId,
    p_quantity: quantity,
    p_client_request_id: reqId,
  });
  if (error) throw error;
  return data as WriteResult<InventoryRow>;
}

/** Grant items from the `items` table (weapons, consumables, etc.). */
export async function grantInventoryItem(
  itemId: string,
  quantity: number = 1,
  requestId?: string,
): Promise<WriteResult<InventoryRow>> {
  return grantInventoryRow('item', itemId, quantity, requestId);
}

/** Grant a wisp block (uses item_type=blockKey, item_id=null). */
export async function grantInventoryBlock(
  blockKey: string,
  quantity: number = 1,
  requestId?: string,
): Promise<WriteResult<InventoryRow>> {
  return grantInventoryRow(blockKey, null, quantity, requestId);
}

/** Return a seed to inventory after chopping a tree. Stored as
 *  item_type=`seed_tier_${tier}`, item_id=seedDefId. */
export async function grantInventorySeed(
  seedDefId: string,
  tier: number,
  quantity: number = 1,
  requestId?: string,
): Promise<WriteResult<InventoryRow>> {
  return grantInventoryRow(`seed_tier_${tier}`, seedDefId, quantity, requestId);
}

// ── Namespace export ────────────────────────────────────────────────

/** Namespace-style export. Callers can use either form:
 *    import { worldStore } from '@/services/worldStore';
 *    worldStore.grantInventoryItem(...);
 *  OR:
 *    import { grantInventoryItem } from '@/services/worldStore';
 *    grantInventoryItem(...);
 *  Both supported. New methods land here as Phase D sub-phases ship. */
export const worldStore = {
  grantInventoryItem,
  grantInventoryBlock,
  grantInventorySeed,
};
