// THE unified inventory grid (see docs/UNIFIED_GRID_PLAN.md).
//
// One (row, col) coordinate space over all four regions. Each cell maps to a DB home
// {region, page, slot}. A MOVE is cell→cell; `canDropInEquip()` is the ONE rule-check that
// makes a destination special. Equip is row 1 of the SAME grid — not a separate system.
//
// CAPACITY IS DATA, NOT CONSTANTS. Items can grant more QA slots (7,8,9,0…), a bigger
// inventory, a bigger vault. EVERY size here comes from a GridCapacity the caller supplies
// (sourced from the user's allocation/upgrades + vault config). Nothing about sizing is
// hardcoded in the logic — DEFAULT_CAPACITY is only a fallback for before capacity is loaded.
//
// This module is PURE (no React, no Supabase) so the model + rules live in exactly one place.

export type GridRegion = 'equip' | 'quick_select' | 'inventory' | 'vault';
export interface DbSlot { region: GridRegion; page: number; slot: number; }
export interface Cell { row: number; col: number; }   // 1-based (row, col)

// ── Capacity: the user's allocated sizes (from upgrades / vault config) ───────────────
export interface GridCapacity {
  /** Number of equip cells. Roles are by DB slot number (see equipSlotRole); today 5. */
  equipSlots: number;
  /** Quick-select cells (row 2). Grows with QA-slot upgrades (e.g. 6 → 10). */
  qaCols: number;
  /** Inventory grid (rows 3..). Both grow with inventory upgrades. */
  invCols: number;
  invRows: number;
  /** Vault is ONE flat band of `vaultSlots` cells, displayed `vaultCols` wide. Grows with
   *  vault upgrades. `vaultPageSize` is for the page-number derivation only (pages are UI). */
  vaultCols: number;
  vaultSlots: number;
  vaultPageSize: number;
}

// Fallback ONLY (matches today's defaults) for the brief window before the user's real
// capacity loads. Real values must be passed in — never assume these.
export const DEFAULT_CAPACITY: GridCapacity = {
  equipSlots: 5,
  qaCols: 6,
  invCols: 6,
  invRows: 3,
  vaultCols: 5,
  vaultSlots: 100,   // 4 pages × 5 × 5 today
  vaultPageSize: 25, // 5 × 5
};

// ── Dynamic row bands (derived from capacity — never hardcoded) ───────────────────────
export interface RowBands {
  equipRow: number; qaRow: number;
  invFirstRow: number; invLastRow: number;
  vaultFirstRow: number; vaultLastRow: number; vaultRows: number;
}
export function rowBands(cap: GridCapacity): RowBands {
  const equipRow = 1;
  const qaRow = 2;
  const invFirstRow = 3;
  const invLastRow = invFirstRow + Math.max(1, cap.invRows) - 1;
  const vaultFirstRow = invLastRow + 1;
  const vaultRows = Math.max(1, Math.ceil(cap.vaultSlots / Math.max(1, cap.vaultCols)));
  const vaultLastRow = vaultFirstRow + vaultRows - 1;
  return { equipRow, qaRow, invFirstRow, invLastRow, vaultFirstRow, vaultLastRow, vaultRows };
}

// Equip visual column (1-based, left→right) → DB slot number. Layout: L, R, Armor, Boots,
// Special. (DB slot numbers are historical: 1=L, 5=R, 2=Armor, 3=Boots, 4=Special.) Columns
// beyond the known roles map 1:1 to their column index so extra equip cells are forward-safe.
const EQUIP_COL_TO_SLOT = [1, 5, 2, 3, 4] as const;
export function equipColToSlot(col: number): number {
  return col >= 1 && col <= EQUIP_COL_TO_SLOT.length ? EQUIP_COL_TO_SLOT[col - 1] : col;
}

// ── Coordinate ↔ DB slot (capacity-driven) ───────────────────────────────────────────
export function cellToDbSlot(cell: Cell, cap: GridCapacity): DbSlot | null {
  const { row, col } = cell;
  if (col < 1) return null;
  const b = rowBands(cap);
  if (row === b.equipRow) {
    if (col > cap.equipSlots) return null;
    return { region: 'equip', page: 0, slot: equipColToSlot(col) };
  }
  if (row === b.qaRow) {
    if (col > cap.qaCols) return null;
    return { region: 'quick_select', page: 0, slot: col };
  }
  if (row >= b.invFirstRow && row <= b.invLastRow) {
    if (col > cap.invCols) return null;
    return { region: 'inventory', page: 0, slot: (row - b.invFirstRow) * cap.invCols + (col - 1) };
  }
  if (row >= b.vaultFirstRow && row <= b.vaultLastRow) {
    if (col > cap.vaultCols) return null;
    const flatIdx = (row - b.vaultFirstRow) * cap.vaultCols + (col - 1);
    if (flatIdx >= cap.vaultSlots) return null;
    return { region: 'vault', ...vaultFlatToPageSlot(flatIdx, cap.vaultPageSize) };
  }
  return null;
}

export function dbSlotToCell(db: DbSlot, cap: GridCapacity): Cell | null {
  const b = rowBands(cap);
  switch (db.region) {
    case 'equip': {
      const col = EQUIP_COL_TO_SLOT.indexOf(db.slot as 1 | 5 | 2 | 3 | 4);
      return { row: b.equipRow, col: col >= 0 ? col + 1 : db.slot };
    }
    case 'quick_select':
      return { row: b.qaRow, col: db.slot };
    case 'inventory':
      return { row: b.invFirstRow + Math.floor(db.slot / cap.invCols), col: (db.slot % cap.invCols) + 1 };
    case 'vault': {
      const flatIdx = vaultPageSlotToFlat(db.page, db.slot, cap.vaultPageSize);
      return { row: b.vaultFirstRow + Math.floor(flatIdx / cap.vaultCols), col: (flatIdx % cap.vaultCols) + 1 };
    }
  }
}

// ── Equip slot roles ──────────────────────────────────────────────────────────────────
export type EquipRole = 'leftHand' | 'rightHand' | 'armor' | 'boots' | 'special';
export function equipSlotRole(slot: number): EquipRole | null {
  switch (slot) {
    case 1: return 'leftHand';
    case 5: return 'rightHand';
    case 2: return 'armor';
    case 3: return 'boots';
    case 4: return 'special';
    default: return null;
  }
}
export const isHandRole = (r: EquipRole | null): boolean => r === 'leftHand' || r === 'rightHand';

// ── Item classification the rules need (resolved once from items + weapon_stats) ──
export interface ItemClass {
  isGun: boolean;
  isTwoHanded: boolean;   // a two-handed gun = rifle (fills both hands)
  isGlove: boolean;
  isGrenade: boolean;
  category: string | null;
}

const ARMOR_CATS = ['armor'];
const BOOTS_CATS = ['boots'];
const SPECIAL_CATS = ['consumable', 'potion'];

export interface EquipDropResult {
  ok: boolean;
  reason?: string;
  /** A two-handed rifle is forced to the canonical left-hand slot (1) so it renders centered
   *  across both hands and the fire code (which reads slot 1) can use it. */
  redirectSlot?: number;
}

/**
 * THE equip rule-check — the only thing that makes the Equip row special.
 *   - hand slots accept a weapon / grenade / glove; a rifle (two-handed gun) needs BOTH hands
 *     free and is redirected to the canonical left slot.
 *   - armor / boots / special accept only their category.
 * `ctx.originSlot` is the equip slot the item is dragged FROM (excluded from the occupancy
 * test) so re-seating a rifle doesn't see itself as occupying a hand.
 */
export function canDropInEquip(
  item: ItemClass,
  targetSlot: number,
  ctx: { leftOccupied: boolean; rightOccupied: boolean; originSlot: number | null },
): EquipDropResult {
  const role = equipSlotRole(targetSlot);
  if (!role) return { ok: false, reason: 'No such equip slot' };

  if (isHandRole(role)) {
    if (!(item.isGun || item.isGrenade || item.isGlove)) {
      return { ok: false, reason: 'Only a weapon, grenade, or glove goes in a hand' };
    }
    if (item.isGun && item.isTwoHanded) {
      const leftBusy = ctx.leftOccupied && ctx.originSlot !== 1;
      const rightBusy = ctx.rightOccupied && ctx.originSlot !== 5;
      if (leftBusy || rightBusy) return { ok: false, reason: 'Free both hands for a rifle' };
      return { ok: true, redirectSlot: 1 };
    }
    return { ok: true };
  }

  const cat = (item.category ?? '').toLowerCase();
  const cats = role === 'armor' ? ARMOR_CATS : role === 'boots' ? BOOTS_CATS : SPECIAL_CATS;
  if (cats.includes(cat)) return { ok: true };
  return { ok: false, reason: `That doesn't go in the ${role} slot` };
}

// ── Vault flat-index ↔ (page, slot) — pages are UI-only; storage stays page+slot, derived ──
export function vaultFlatToPageSlot(flatIdx: number, pageSize: number): { page: number; slot: number } {
  const ps = Math.max(1, pageSize);
  return { page: Math.floor(flatIdx / ps), slot: flatIdx % ps };
}
export function vaultPageSlotToFlat(page: number, slot: number, pageSize: number): number {
  return page * Math.max(1, pageSize) + slot;
}
