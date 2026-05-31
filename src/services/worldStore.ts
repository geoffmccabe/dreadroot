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
};
