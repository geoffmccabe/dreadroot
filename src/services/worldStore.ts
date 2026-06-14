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

/** Consume / delete RPCs return both updated rows AND ids of rows
 *  that were fully removed. Client merges accordingly. */
export interface ConsumeResult {
  rows: InventoryRow[];
  deletedRowIds: string[];
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

// ── Inventory consumes (D4) ─────────────────────────────────────────

interface RawConsumeRpcResult {
  rows: InventoryRow[];
  deleted_row_ids: string[];
  replayed: boolean;
}

function adaptConsume(raw: RawConsumeRpcResult): ConsumeResult {
  return {
    rows: raw.rows ?? [],
    deletedRowIds: raw.deleted_row_ids ?? [],
    replayed: raw.replayed ?? false,
  };
}

/** Decrement an inventory target by quantity. The target is either a
 *  block key (matches item_type) or an item UUID (matches item_id) —
 *  the RPC handles both by OR-matching. If quantity reaches 0 the
 *  row is deleted; its id comes back in deletedRowIds. */
export async function consumeInventoryTarget(
  target: string,
  quantity: number = 1,
  requestId?: string,
): Promise<ConsumeResult> {
  const reqId = requestId ?? crypto.randomUUID();
  const { data, error } = await supabase.rpc('consume_inventory_target', {
    p_target: target,
    p_quantity: quantity,
    p_client_request_id: reqId,
  });
  if (error) throw error;
  return adaptConsume(data as RawConsumeRpcResult);
}

/** Delete a specific inventory row by id (auth-checked). Used for
 *  non-stackable items where each row represents one slot. */
export async function deleteInventoryRow(
  rowId: string,
  requestId?: string,
): Promise<ConsumeResult> {
  const reqId = requestId ?? crypto.randomUUID();
  const { data, error } = await supabase.rpc('delete_inventory_row', {
    p_row_id: rowId,
    p_client_request_id: reqId,
  });
  if (error) throw error;
  return adaptConsume(data as RawConsumeRpcResult);
}

// ── Vault (D5) ──────────────────────────────────────────────────────

export interface VaultRow {
  id: string;
  user_id: string;
  page: number;
  slot: number;
  item_id: string;
  quantity: number;
}

export interface VaultConfig {
  user_id: string;
  page_count: number;
  cols: number;
  rows: number;
}

export interface VaultWriteResult {
  rows: VaultRow[];
  deletedRowIds: string[];
  replayed: boolean;
}

interface RawVaultRpcResult {
  rows: VaultRow[];
  deleted_row_ids?: string[];
  replayed: boolean;
}

function adaptVault(raw: RawVaultRpcResult): VaultWriteResult {
  return {
    rows: raw.rows ?? [],
    deletedRowIds: raw.deleted_row_ids ?? [],
    replayed: raw.replayed ?? false,
  };
}

export async function vaultSetSlot(
  page: number,
  slot: number,
  itemId: string,
  quantity: number,
  requestId?: string,
): Promise<VaultWriteResult> {
  const reqId = requestId ?? crypto.randomUUID();
  const { data, error } = await supabase.rpc('vault_set_slot', {
    p_page: page,
    p_slot: slot,
    p_item_id: itemId,
    p_quantity: quantity,
    p_client_request_id: reqId,
  });
  if (error) throw error;
  return adaptVault(data as RawVaultRpcResult);
}

export async function vaultRemoveFromSlot(
  page: number,
  slot: number,
  quantity: number,
  requestId?: string,
): Promise<VaultWriteResult> {
  const reqId = requestId ?? crypto.randomUUID();
  const { data, error } = await supabase.rpc('vault_remove_from_slot', {
    p_page: page,
    p_slot: slot,
    p_quantity: quantity,
    p_client_request_id: reqId,
  });
  if (error) throw error;
  return adaptVault(data as RawVaultRpcResult);
}

export async function vaultReplacePage(
  page: number,
  rows: Array<{ slot: number; item_id: string; quantity: number }>,
  requestId?: string,
): Promise<VaultWriteResult> {
  const reqId = requestId ?? crypto.randomUUID();
  const { data, error } = await supabase.rpc('vault_replace_page', {
    p_page: page,
    p_rows: rows,
    p_client_request_id: reqId,
  });
  if (error) throw error;
  return adaptVault(data as RawVaultRpcResult);
}

export async function vaultEnsureConfig(): Promise<VaultConfig | null> {
  const { data, error } = await supabase.rpc('vault_ensure_config');
  if (error) throw error;
  return (data as VaultConfig) ?? null;
}

// ── Equipped slots (D6) ─────────────────────────────────────────────

export interface EquippedRow {
  id: string;
  user_id: string;
  slot_type: string;
  item_id: string;
  equipped_at: string;
}

export interface EquippedWriteResult {
  rows: EquippedRow[];
  deletedRowIds: string[];
  replayed: boolean;
}

interface RawEquippedRpcResult {
  rows: EquippedRow[];
  deleted_row_ids?: string[];
  replayed: boolean;
}

function adaptEquipped(raw: RawEquippedRpcResult): EquippedWriteResult {
  return {
    rows: raw.rows ?? [],
    deletedRowIds: raw.deleted_row_ids ?? [],
    replayed: raw.replayed ?? false,
  };
}

export async function setEquippedSlot(
  slotType: string,
  itemId: string,
  requestId?: string,
): Promise<EquippedWriteResult> {
  const reqId = requestId ?? crypto.randomUUID();
  const { data, error } = await supabase.rpc('set_equipped_slot', {
    p_slot_type: slotType,
    p_item_id: itemId,
    p_client_request_id: reqId,
  });
  if (error) throw error;
  return adaptEquipped(data as RawEquippedRpcResult);
}

export async function clearEquippedSlot(
  slotType: string,
  requestId?: string,
): Promise<EquippedWriteResult> {
  const reqId = requestId ?? crypto.randomUUID();
  const { data, error } = await supabase.rpc('clear_equipped_slot', {
    p_slot_type: slotType,
    p_client_request_id: reqId,
  });
  if (error) throw error;
  return adaptEquipped(data as RawEquippedRpcResult);
}

export async function clearEquippedSlots(
  slotTypes: string[],
  requestId?: string,
): Promise<EquippedWriteResult> {
  const reqId = requestId ?? crypto.randomUUID();
  const { data, error } = await supabase.rpc('clear_equipped_slots', {
    p_slot_types: slotTypes,
    p_client_request_id: reqId,
  });
  if (error) throw error;
  return adaptEquipped(data as RawEquippedRpcResult);
}

// ── Currency (D7) ───────────────────────────────────────────────────

export interface BuyBlockResult {
  rows: InventoryRow[];
  deletedRowIds: string[];
  newBalance: number;
  replayed: boolean;
}

export interface CurrencyResult {
  newBalance: number;
  replayed: boolean;
}

export interface PointsResult {
  newTotalPoints: number;
  newLevel: number;
  leveledUp: boolean;
  replayed: boolean;
}

interface RawBuyBlockRpcResult {
  rows: InventoryRow[];
  deleted_row_ids?: string[];
  new_balance: number;
  replayed: boolean;
}

interface RawCurrencyRpcResult {
  new_balance: number;
  replayed: boolean;
}

interface RawPointsRpcResult {
  new_total_points: number;
  new_level: number;
  leveled_up: boolean;
  replayed: boolean;
}

/** Atomic spend-coins + grant-block. Either both happen or neither does. */
export async function buyBlock(
  blockKey: string,
  cost: number,
  tokenThemeId: string,
  requestId?: string,
): Promise<BuyBlockResult> {
  const reqId = requestId ?? crypto.randomUUID();
  const { data, error } = await supabase.rpc('buy_block', {
    p_block_key: blockKey,
    p_cost: cost,
    p_token_theme_id: tokenThemeId,
    p_client_request_id: reqId,
  });
  if (error) throw error;
  const raw = data as RawBuyBlockRpcResult;
  return {
    rows: raw.rows ?? [],
    deletedRowIds: raw.deleted_row_ids ?? [],
    newBalance: raw.new_balance,
    replayed: raw.replayed ?? false,
  };
}

export async function grantCurrency(
  tokenThemeId: string,
  amount: number,
  requestId?: string,
): Promise<CurrencyResult> {
  const reqId = requestId ?? crypto.randomUUID();
  const { data, error } = await supabase.rpc('grant_currency', {
    p_token_theme_id: tokenThemeId,
    p_amount: amount,
    p_client_request_id: reqId,
  });
  if (error) throw error;
  const raw = data as RawCurrencyRpcResult;
  return { newBalance: raw.new_balance, replayed: raw.replayed ?? false };
}

export async function grantPoints(
  amount: number,
  requestId?: string,
): Promise<PointsResult> {
  const reqId = requestId ?? crypto.randomUUID();
  const { data, error } = await supabase.rpc('grant_points', {
    p_amount: amount,
    p_client_request_id: reqId,
  });
  if (error) throw error;
  const raw = data as RawPointsRpcResult;
  return {
    newTotalPoints: raw.new_total_points,
    newLevel: raw.new_level,
    leveledUp: raw.leveled_up ?? false,
    replayed: raw.replayed ?? false,
  };
}

// ── Cooldown drops (D-cooldown) ────────────────────────────────────

export interface EggPickupResult {
  rows: InventoryRow[];
  deletedRowIds: string[];
  deletedWorldEggId: string | null;
  replayed: boolean;
}

interface RawEggPickupRpcResult {
  rows: InventoryRow[];
  deleted_row_ids?: string[];
  deleted_world_egg_id?: string | null;
  replayed: boolean;
}

/** Atomic world-egg pickup. Server deletes the world row, inserts a
 *  fresh inventory row, and applies the item's configured pickup
 *  cooldown — all in one transaction. */
export async function pickupEgg(
  worldEggId: string,
  requestId?: string,
): Promise<EggPickupResult> {
  const reqId = requestId ?? crypto.randomUUID();
  const { data, error } = await supabase.rpc('pickup_egg', {
    p_world_egg_id: worldEggId,
    p_client_request_id: reqId,
  });
  if (error) throw error;
  const raw = data as RawEggPickupRpcResult;
  return {
    rows: raw.rows ?? [],
    deletedRowIds: raw.deleted_row_ids ?? [],
    deletedWorldEggId: raw.deleted_world_egg_id ?? null,
    replayed: raw.replayed ?? false,
  };
}

/** Atomic forge: two source inventory rows of the same item_id become
 *  one result row of the next tier in the same forge_family. */
export async function forgeItems(
  sourceRowIds: string[],
  resultItemId: string,
  requestId?: string,
): Promise<ConsumeResult> {
  const reqId = requestId ?? crypto.randomUUID();
  const { data, error } = await supabase.rpc('forge_items', {
    p_source_row_ids: sourceRowIds,
    p_result_item_id: resultItemId,
    p_client_request_id: reqId,
  });
  if (error) throw error;
  return adaptConsume(data as RawConsumeRpcResult);
}

// ── Admin grants (D-admin) ──────────────────────────────────────────

/** Admin-only grant on behalf of another user. Caller must have the
 *  'admin' app_role. Used by inspector-delete (return block to owner)
 *  and admin tree-chop (return seed to tree owner) flows. */
export async function adminGrantInventoryRow(
  targetUserId: string,
  itemType: string,
  itemId: string | null,
  quantity: number,
  requestId?: string,
): Promise<WriteResult<InventoryRow>> {
  const reqId = requestId ?? crypto.randomUUID();
  const { data, error } = await supabase.rpc('admin_grant_inventory_row', {
    p_target_user_id: targetUserId,
    p_item_type: itemType,
    p_item_id: itemId,
    p_quantity: quantity,
    p_client_request_id: reqId,
  });
  if (error) throw error;
  const raw = data as { rows: InventoryRow[]; replayed: boolean };
  return { rows: raw.rows ?? [], replayed: raw.replayed ?? false };
}

// ── Token balance bootstrap (D-final-cleanup) ──────────────────────

export interface TokenBalanceRow {
  id: string;
  user_id: string;
  token_theme_id: string;
  coins: number;
  blockchain_address: string | null;
  created_at: string;
  updated_at: string;
}

/** Idempotent first-login balance creation. Returns the row whether
 *  it was just inserted or already existed. */
export async function ensureTokenBalance(
  tokenThemeId: string,
  startingCoins: number,
  requestId?: string,
): Promise<TokenBalanceRow | null> {
  const reqId = requestId ?? crypto.randomUUID();
  const { data, error } = await supabase.rpc('ensure_token_balance', {
    p_token_theme_id: tokenThemeId,
    p_starting_coins: startingCoins,
    p_client_request_id: reqId,
  });
  if (error) throw error;
  return (data as TokenBalanceRow) ?? null;
}

// ── World drops (D-drops) ───────────────────────────────────────────

export interface WorldDropRow {
  id: string;
  item_id: string;
  killer_user_id: string;
  position_x: number;
  position_y: number;
  position_z: number;
  dropped_at: string;
}

export interface SpawnDropResult {
  row: WorldDropRow | null;
  replayed: boolean;
}

export interface PickupDropResult {
  rows: InventoryRow[];
  deletedWorldDropId: string | null;
  replayed: boolean;
}

export async function spawnWorldDrop(
  itemId: string,
  position: { x: number; y: number; z: number },
  requestId?: string,
): Promise<SpawnDropResult> {
  const reqId = requestId ?? crypto.randomUUID();
  const { data, error } = await supabase.rpc('spawn_world_drop', {
    p_item_id: itemId,
    p_position_x: position.x,
    p_position_y: position.y,
    p_position_z: position.z,
    p_client_request_id: reqId,
  });
  if (error) throw error;
  const raw = data as { row: WorldDropRow | null; replayed: boolean };
  return { row: raw.row, replayed: raw.replayed ?? false };
}

export async function pickupWorldDrop(
  dropId: string,
  requestId?: string,
): Promise<PickupDropResult> {
  const reqId = requestId ?? crypto.randomUUID();
  const { data, error } = await supabase.rpc('pickup_world_drop', {
    p_drop_id: dropId,
    p_client_request_id: reqId,
  });
  if (error) throw error;
  const raw = data as {
    rows: InventoryRow[];
    deleted_world_drop_id: string | null;
    replayed: boolean;
  };
  return {
    rows: raw.rows ?? [],
    deletedWorldDropId: raw.deleted_world_drop_id,
    replayed: raw.replayed ?? false,
  };
}

// ── Atomic transfers (item-history foundation) ─────────────────────
//
// Single-transaction moves between inventory ⇄ vault. The server-side
// RPC delete-from-source AND insert-to-destination in one transaction
// so a half-completed transfer can NEVER lose items. Each call also
// writes an item_history row for full audit / future blockchain.

export interface TransferInvToVaultResult {
  vaultRow: VaultRow | null;
  removedInventoryRowIds: string[];
  itemId: string;
  quantity: number;
  replayed: boolean;
}

export interface TransferVaultToInvResult {
  inventoryRows: InventoryRow[];
  vaultRemaining: number;
  itemId: string;
  quantity: number;
  replayed: boolean;
}

export interface TransferVaultToVaultResult {
  destinationRow: VaultRow | null;
  itemId: string;
  quantity: number;
  replayed: boolean;
}

export async function transferInventoryToVault(
  inventoryRowIds: string[],
  targetPage: number,
  targetSlot: number,
  requestId?: string,
): Promise<TransferInvToVaultResult> {
  const reqId = requestId ?? crypto.randomUUID();
  const { data, error } = await supabase.rpc('transfer_inventory_to_vault', {
    p_inventory_row_ids: inventoryRowIds,
    p_target_page: targetPage,
    p_target_slot: targetSlot,
    p_client_request_id: reqId,
  });
  if (error) throw error;
  const raw = data as {
    replayed: boolean;
    vault_row: VaultRow[] | null;
    removed_inventory_row_ids: string[] | null;
    item_id: string;
    quantity: number;
  };
  return {
    vaultRow: raw.vault_row?.[0] ?? null,
    removedInventoryRowIds: raw.removed_inventory_row_ids ?? [],
    itemId: raw.item_id,
    quantity: raw.quantity,
    replayed: raw.replayed ?? false,
  };
}

export async function transferVaultToInventory(
  sourcePage: number,
  sourceSlot: number,
  quantity: number,
  requestId?: string,
): Promise<TransferVaultToInvResult> {
  const reqId = requestId ?? crypto.randomUUID();
  const { data, error } = await supabase.rpc('transfer_vault_to_inventory', {
    p_source_page: sourcePage,
    p_source_slot: sourceSlot,
    p_quantity: quantity,
    p_client_request_id: reqId,
  });
  if (error) throw error;
  const raw = data as {
    replayed: boolean;
    inventory_rows: InventoryRow[] | null;
    vault_remaining: number;
    item_id: string;
    quantity: number;
  };
  return {
    inventoryRows: raw.inventory_rows ?? [],
    vaultRemaining: raw.vault_remaining ?? 0,
    itemId: raw.item_id,
    quantity: raw.quantity,
    replayed: raw.replayed ?? false,
  };
}

export async function transferVaultToVault(
  srcPage: number,
  srcSlot: number,
  dstPage: number,
  dstSlot: number,
  quantity: number,
  requestId?: string,
): Promise<TransferVaultToVaultResult> {
  const reqId = requestId ?? crypto.randomUUID();
  const { data, error } = await supabase.rpc('transfer_vault_to_vault', {
    p_src_page: srcPage,
    p_src_slot: srcSlot,
    p_dst_page: dstPage,
    p_dst_slot: dstSlot,
    p_quantity: quantity,
    p_client_request_id: reqId,
  });
  if (error) throw error;
  const raw = data as {
    replayed: boolean;
    destination_row: VaultRow[] | null;
    item_id: string;
    quantity: number;
  };
  return {
    destinationRow: raw.destination_row?.[0] ?? null,
    itemId: raw.item_id,
    quantity: raw.quantity,
    replayed: raw.replayed ?? false,
  };
}

// ── Unified user_slots transfer (v4.11.0+) ─────────────────────────
//
// ONE RPC replaces 7. Handles every inv/qs/vault transfer combo. The
// from_/to_ region pair determines stacking + capacity rules; the
// RPC body enforces them and writes one item_history audit row.

export interface SlotRegion {
  region: 'inventory' | 'quick_select' | 'vault';
  page: number;
  slot: number;
}

export async function transferSlot(
  from: SlotRegion,
  to: SlotRegion,
  quantity: number,
  requestId?: string,
): Promise<{ replayed: boolean; itemId?: string; quantity?: number; noop?: boolean }> {
  const reqId = requestId ?? crypto.randomUUID();
  const { data, error } = await supabase.rpc('transfer_slot', {
    p_from_region: from.region,
    p_from_page: from.page,
    p_from_slot: from.slot,
    p_to_region: to.region,
    p_to_page: to.page,
    p_to_slot: to.slot,
    p_quantity: quantity,
    p_client_request_id: reqId,
  });
  if (error) throw error;
  return data as { replayed: boolean; itemId?: string; quantity?: number; noop?: boolean };
}

export async function grantSlot(
  region: 'inventory' | 'quick_select' | 'vault',
  itemId: string,
  quantity: number = 1,
  requestId?: string,
): Promise<{ replayed: boolean; granted: number }> {
  const reqId = requestId ?? crypto.randomUUID();
  const { data, error } = await supabase.rpc('grant_slot', {
    p_region: region,
    p_item_id: itemId,
    p_quantity: quantity,
    p_client_request_id: reqId,
  });
  if (error) throw error;
  return data as { replayed: boolean; granted: number };
}

export async function consumeSlot(
  region: 'inventory' | 'quick_select' | 'vault',
  page: number,
  slot: number,
  quantity: number = 1,
  requestId?: string,
): Promise<{ replayed: boolean }> {
  const reqId = requestId ?? crypto.randomUUID();
  const { data, error } = await supabase.rpc('consume_slot', {
    p_region: region,
    p_page: page,
    p_slot: slot,
    p_quantity: quantity,
    p_client_request_id: reqId,
  });
  if (error) throw error;
  return data as { replayed: boolean };
}

export async function swapSlot(
  from: SlotRegion,
  to: SlotRegion,
  requestId?: string,
): Promise<{ replayed: boolean; swapped?: boolean; moved?: boolean }> {
  const reqId = requestId ?? crypto.randomUUID();
  const { data, error } = await supabase.rpc('swap_slot', {
    p_from_region: from.region,
    p_from_page: from.page,
    p_from_slot: from.slot,
    p_to_region: to.region,
    p_to_page: to.page,
    p_to_slot: to.slot,
    p_client_request_id: reqId,
  });
  if (error) throw error;
  return data as { replayed: boolean; swapped?: boolean; moved?: boolean };
}

export async function ejectSlotToWorld(
  from: SlotRegion,
  position: { x: number; y: number; z: number },
  requestId?: string,
): Promise<{ replayed: boolean; drop_id?: string }> {
  const reqId = requestId ?? crypto.randomUUID();
  const { data, error } = await supabase.rpc('eject_slot_to_world', {
    p_from_region: from.region,
    p_from_page: from.page,
    p_from_slot: from.slot,
    p_position_x: position.x,
    p_position_y: position.y,
    p_position_z: position.z,
    p_client_request_id: reqId,
  });
  if (error) throw error;
  return data as { replayed: boolean; drop_id?: string };
}

// ── Quick Select transfers (QS-as-storage model) ───────────────────
//
// QS slots HOLD items (not references). Every move is atomic + audited.

// Detect Supabase "function not found" errors and rewrite them with
// the migration filename the user needs to run. Otherwise the user
// sees an opaque PostgREST PGRST202 with no clear remediation.
function rethrowMissingRpc(rpcName: string, migrationFile: string, error: any): never {
  const msg = String(error?.message ?? error);
  if (msg.includes('Could not find the function') || error?.code === 'PGRST202') {
    throw new Error(
      `[migration not deployed] RPC "${rpcName}" missing. Run ${migrationFile} in the Supabase SQL editor.`
    );
  }
  throw error;
}

const QS_MIGRATION = '20260601160000_quick_slots_are_storage.sql';

export async function transferInvToQs(
  inventoryRowId: string,
  qsSlot: number,
  requestId?: string,
): Promise<{ replayed: boolean }> {
  const reqId = requestId ?? crypto.randomUUID();
  const { data, error } = await supabase.rpc('transfer_inv_to_qs', {
    p_inventory_row_id: inventoryRowId,
    p_qs_slot: qsSlot,
    p_client_request_id: reqId,
  });
  if (error) rethrowMissingRpc('transfer_inv_to_qs', QS_MIGRATION, error);
  return data as { replayed: boolean };
}

export async function transferQsToInv(
  qsSlot: number,
  requestId?: string,
): Promise<{ replayed: boolean }> {
  const reqId = requestId ?? crypto.randomUUID();
  const { data, error } = await supabase.rpc('transfer_qs_to_inv', {
    p_qs_slot: qsSlot,
    p_client_request_id: reqId,
  });
  if (error) rethrowMissingRpc('transfer_qs_to_inv', QS_MIGRATION, error);
  return data as { replayed: boolean };
}

export async function transferQsToVault(
  qsSlot: number,
  vaultPage: number,
  vaultSlot: number,
  requestId?: string,
): Promise<{ replayed: boolean }> {
  const reqId = requestId ?? crypto.randomUUID();
  const { data, error } = await supabase.rpc('transfer_qs_to_vault', {
    p_qs_slot: qsSlot,
    p_vault_page: vaultPage,
    p_vault_slot: vaultSlot,
    p_client_request_id: reqId,
  });
  if (error) rethrowMissingRpc('transfer_qs_to_vault', QS_MIGRATION, error);
  return data as { replayed: boolean };
}

export async function transferVaultToQs(
  vaultPage: number,
  vaultSlot: number,
  qsSlot: number,
  requestId?: string,
): Promise<{ replayed: boolean }> {
  const reqId = requestId ?? crypto.randomUUID();
  const { data, error } = await supabase.rpc('transfer_vault_to_qs', {
    p_vault_page: vaultPage,
    p_vault_slot: vaultSlot,
    p_qs_slot: qsSlot,
    p_client_request_id: reqId,
  });
  if (error) rethrowMissingRpc('transfer_vault_to_qs', QS_MIGRATION, error);
  return data as { replayed: boolean };
}

export async function consumeQuickSlot(
  qsSlot: number,
  requestId?: string,
): Promise<{ replayed: boolean }> {
  // v4.11.0: route through the unified consume_slot RPC.
  return consumeSlot('quick_select', 0, qsSlot, 1, requestId);
}

// ── World blocks (Track 1B: validated place/mine RPCs) ──────────────

// Detects "this RPC isn't deployed yet" so the client can fall back to the
// direct write during the deploy→run-SQL window. PostgREST returns PGRST202
// for an unknown function; Postgres 42883 = function does not exist.
// TRANSITIONAL — delete these fallbacks at Track 1D (RLS lockdown).
function isMissingFunction(error: any): boolean {
  const code = error?.code;
  const msg = String(error?.message ?? '');
  return code === 'PGRST202' || code === '42883'
    || /could not find the function|function .* does not exist/i.test(msg);
}

/** Persist a placed block via the validated place_block RPC. Server
 *  enforces auth, world existence, spatial bounds, and caller-owns.
 *  Client placement stays optimistic; this is fire-and-forget like the
 *  prior upsert. Returns the persisted row. Falls back to a direct
 *  upsert if the RPC isn't deployed yet. */
export async function placeBlock(params: {
  worldId: string;
  x: number; y: number; z: number;
  blockType: string;
  textureUrl?: string | null;
  expiresAt?: string | null;
}): Promise<any> {
  const { data, error } = await supabase.rpc('place_block', {
    p_world_id: params.worldId,
    p_x: params.x, p_y: params.y, p_z: params.z,
    p_block_type: params.blockType,
    p_texture_url: params.textureUrl ?? null,
    p_expires_at: params.expiresAt ?? null,
  });
  if (!error) return data;
  if (!isMissingFunction(error)) throw error;
  // Fallback: pre-migration direct upsert (RLS still enforces ownership).
  const { data: { session } } = await supabase.auth.getSession();
  const uid = session?.user?.id;
  if (!uid) throw error;
  const row: any = {
    user_id: uid, world_id: params.worldId,
    position_x: params.x, position_y: params.y, position_z: params.z,
    block_type: params.blockType,
  };
  if (params.textureUrl) row.texture_url = params.textureUrl;
  if (params.expiresAt) row.expires_at = params.expiresAt;
  const { data: up, error: upErr } = await supabase
    .from('placed_blocks')
    .upsert(row, { onConflict: 'world_id,position_x,position_y,position_z', ignoreDuplicates: false })
    .select().single();
  if (upErr) throw upErr;
  return up;
}

/** Credit a kill via the validated record_kill RPC (server-side
 *  increment of user_combat_stats). Fire-and-forget from kill handlers;
 *  falls back to a no-op-safe throw if the RPC isn't deployed yet.
 *  enemy_type encodes the tier, e.g. `shwarm_t3`. */
export async function recordKill(enemyType: string): Promise<void> {
  const { error } = await supabase.rpc('record_kill', { p_enemy_type: enemyType, p_game: GAME_ID } as never);
  if (error && !isMissingFunction(error)) throw error;
  if (error && isMissingFunction(error)) {
    // Pre-migration fallback: direct select-then-update/insert.
    const { data: { session } } = await supabase.auth.getSession();
    const uid = session?.user?.id;
    if (!uid) return;
    const { data: existing } = await supabase.from('user_combat_stats')
      .select('id, kills').eq('user_id', uid).eq('enemy_type', enemyType).maybeSingle();
    if (existing) {
      await supabase.from('user_combat_stats')
        .update({ kills: (existing as any).kills + 1, updated_at: new Date().toISOString() })
        .eq('id', (existing as any).id);
    } else {
      await supabase.from('user_combat_stats')
        .insert({ user_id: uid, enemy_type: enemyType, kills: 1 });
    }
  }
}

/** Server-authoritative loot roll for a killed shwarm. The server looks
 *  up the drop rate + table, rolls, and spawns the world_drop (realtime
 *  delivers the visual). Returns true if the RPC ran; false ONLY when the
 *  RPC isn't deployed yet, so the caller can fall back to the legacy
 *  client-side roll during the deploy→run-SQL window. */
export async function rollShwarmDrop(
  tier: number, x: number, y: number, z: number,
): Promise<boolean> {
  const { error } = await supabase.rpc('roll_shwarm_drop', {
    p_tier: tier, p_x: x, p_y: y, p_z: z,
    p_client_request_id: crypto.randomUUID(),
  });
  if (!error) return true;
  if (isMissingFunction(error)) return false;
  throw error;
}

/** Coin drops — see docs/COIN_DROPS.md. Server reads the monster tier's
 *  game-scoped coin_drops config, rolls each entry, and inserts floating
 *  world_coin_drops instances (NO credit — pickup does that). Returns the
 *  inserted instances so the client can spawn the floating sprites. Empty array
 *  if the RPC isn't deployed yet (pre-migration) or nothing dropped. */
export async function rollMonsterCoinDrop(
  enemyBase: string, tier: number, worldId: string, x: number, y: number, z: number,
): Promise<unknown[]> {
  const { data, error } = await supabase.rpc('roll_monster_coin_drop', {
    p_enemy_base: enemyBase, p_tier: tier, p_world_id: worldId,
    p_x: x, p_y: y, p_z: z, p_game: GAME_ID,
  } as never);
  if (!error) return (data as unknown[]) ?? [];
  if (isMissingFunction(error)) return [];
  throw error;
}

/** Pick up a floating coin drop → credits the picker (server enforces the 60s
 *  killer-only window + idempotency). Returns the RPC result, or null if the
 *  RPC isn't deployed yet. */
export async function pickupCoinDrop(
  dropId: string,
): Promise<{ ok: boolean; amount?: number; new_balance?: number; reason?: string } | null> {
  const { data, error } = await supabase.rpc('pickup_coin_drop', { p_drop_id: dropId } as never);
  if (!error) return (data as { ok: boolean }) as never;
  if (isMissingFunction(error)) return null;
  throw error;
}

/** Server-rolled 1% shpider-egg drop on a wild-shpider kill (owner =
 *  caller). Returns whether an egg dropped. Falls back to the legacy
 *  client roll+insert if the RPC isn't deployed yet. */
export async function rollShpiderEgg(
  tier: number, x: number, y: number, z: number,
): Promise<{ dropped: boolean }> {
  const { data, error } = await supabase.rpc('roll_shpider_egg', {
    p_tier: tier, p_x: x, p_y: y, p_z: z, p_client_request_id: crypto.randomUUID(),
  });
  if (!error) return (data as { dropped: boolean }) ?? { dropped: false };
  if (!isMissingFunction(error)) throw error;
  // Fallback: client 1% roll + direct insert (pre-migration).
  if (Math.random() >= 0.01) return { dropped: false };
  const { data: { session } } = await supabase.auth.getSession();
  const uid = session?.user?.id;
  if (!uid) return { dropped: false };
  const { data: item } = await supabase.from('items').select('id').eq('key', `shpider_egg_t${tier}`).maybeSingle();
  await supabase.from('world_eggs' as any).insert({
    tier, owner_user_id: uid, position_x: x, position_y: y, position_z: z, item_id: (item as any)?.id ?? null,
  } as any);
  return { dropped: true };
}

/** Pet-death egg refund (owner = pet owner). Centralized insert; falls
 *  back to a direct insert if the RPC isn't deployed yet. */
export async function spawnPetEgg(
  tier: number, ownerUserId: string, x: number, y: number, z: number,
): Promise<boolean> {
  const { error } = await supabase.rpc('spawn_pet_egg', {
    p_tier: tier, p_owner_user_id: ownerUserId, p_x: x, p_y: y, p_z: z,
    p_client_request_id: crypto.randomUUID(),
  });
  if (!error) return true;
  if (!isMissingFunction(error)) throw error;
  const { data: item } = await supabase.from('items').select('id').eq('key', `shpider_egg_t${tier}`).maybeSingle();
  const { error: insErr } = await supabase.from('world_eggs' as any).insert({
    tier, owner_user_id: ownerUserId, position_x: x, position_y: y, position_z: z, item_id: (item as any)?.id ?? null,
  } as any);
  return !insErr;
}

/** Remove a placed block via the validated mine_block RPC. Server
 *  enforces auth + (owner OR admin) and enqueues the tree-hole check.
 *  Idempotent. Falls back to a direct delete if the RPC isn't deployed
 *  yet (overlap-enqueue is skipped in that transitional window only). */
export async function mineBlock(blockId: string): Promise<{ removed: boolean }> {
  const { data, error } = await supabase.rpc('mine_block', { p_block_id: blockId });
  if (!error) return (data as { removed: boolean }) ?? { removed: false };
  if (!isMissingFunction(error)) throw error;
  // Fallback: pre-migration direct delete (RLS still enforces ownership).
  const { error: delErr } = await supabase.from('placed_blocks').delete().eq('id', blockId);
  if (delErr) throw delErr;
  return { removed: true };
}

/** Remove a placed block by its position instead of its UUID. Needed once the chunk wire
 *  stops shipping the block id — the client identifies a block by its (world, cell), which is
 *  unique. Same server-side auth + (owner OR admin) check + overlap enqueue as mineBlock.
 *  Falls back to a position-matched direct delete if the RPC isn't deployed yet. */
export async function mineBlockAt(
  worldId: string, x: number, y: number, z: number,
): Promise<{ removed: boolean }> {
  const px = Math.floor(x), py = Math.floor(y), pz = Math.floor(z);
  const { data, error } = await supabase.rpc('mine_block_at', {
    p_world_id: worldId, p_x: px, p_y: py, p_z: pz,
  });
  if (!error) return (data as { removed: boolean }) ?? { removed: false };
  if (!isMissingFunction(error)) throw error;
  // Fallback: pre-migration direct delete (RLS still enforces ownership).
  const { error: delErr } = await supabase.from('placed_blocks').delete()
    .eq('world_id', worldId).eq('position_x', px).eq('position_y', py).eq('position_z', pz);
  if (delErr) throw delErr;
  return { removed: true };
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
  consumeInventoryTarget,
  deleteInventoryRow,
  vaultSetSlot,
  vaultRemoveFromSlot,
  vaultReplacePage,
  vaultEnsureConfig,
  setEquippedSlot,
  clearEquippedSlot,
  clearEquippedSlots,
  buyBlock,
  grantCurrency,
  grantPoints,
  pickupEgg,
  forgeItems,
  adminGrantInventoryRow,
  ensureTokenBalance,
  spawnWorldDrop,
  pickupWorldDrop,
  transferInventoryToVault,
  transferVaultToInventory,
  transferVaultToVault,
  transferInvToQs,
  transferQsToInv,
  transferQsToVault,
  transferVaultToQs,
  consumeQuickSlot,
  // Unified API (v4.11.0+) — prefer these over the region-pair RPCs.
  transferSlot,
  grantSlot,
  consumeSlot,
  swapSlot,
  ejectSlotToWorld,
  // Track 1B — validated world-block writes.
  placeBlock,
  mineBlock,
  mineBlockAt,
  recordKill,
  rollShwarmDrop,
  rollMonsterCoinDrop,
  pickupCoinDrop,
  rollShpiderEgg,
  spawnPetEgg,
};
