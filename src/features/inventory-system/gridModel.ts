// THE unified inventory grid (see docs/UNIFIED_GRID_PLAN.md).
//
// One (row, col) coordinate space over all four regions. Each cell maps to a DB home
// {region, page, slot}. A MOVE is cell→cell; `canDropInEquip()` is the ONE rule-check that
// makes a destination special. Equip is row 1 of the SAME grid — not a separate system.
//
// This module is PURE (no React, no Supabase) so the rules live in exactly one place and are
// trivially testable. Stage 2 routes equip drops through here instead of EquipSlots' own path.

export type GridRegion = 'equip' | 'quick_select' | 'inventory' | 'vault';
export interface DbSlot { region: GridRegion; page: number; slot: number; }

// ── Row bands & sizes ────────────────────────────────────────────────
export const ROW_EQUIP = 1;        // 5 cells
export const ROW_QA = 2;           // 6 cells
export const ROW_INV_FIRST = 3;    // rows 3..5
export const ROW_INV_LAST = 5;
export const ROW_VAULT_FIRST = 6;  // rows 6.. (one flat band; pages are UI-only)

export const EQUIP_COLS = 5;
export const QA_COLS = 6;
export const INV_COLS = 6;
export const INV_ROWS = 3;

// Equip visual column (1..5, left→right) → DB slot number. Layout: L, R, Armor, Boots, Special.
// (DB slot numbers are historical: 1=L, 5=R, 2=Armor, 3=Boots, 4=Special.)
export const EQUIP_COL_TO_SLOT = [1, 5, 2, 3, 4] as const;

// ── Equip slot roles ─────────────────────────────────────────────────
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

// Categories each non-hand equip slot accepts (mirror of EquipSlots' SLOTS table).
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
  return { page: Math.floor(flatIdx / pageSize), slot: flatIdx % pageSize };
}
export function vaultPageSlotToFlat(page: number, slot: number, pageSize: number): number {
  return page * pageSize + slot;
}
