// The slot-click reducer. ONE function handles every click on every
// slot in every region (vault, inventory, hotbar). This is the entire
// drag/drop state machine — there is no HTML5 DnD, no separate per-
// region handlers, no payload-shape divergence between regions.
//
// Click table (Minecraft canonical):
//
//   cursor | slot       | left              | right           | shift+left
//   -------|------------|-------------------|-----------------|------------
//   empty  | empty      | no-op             | no-op           | no-op
//   empty  | has X      | pick up whole stk | take half       | instant xfer
//   has Y  | empty      | drop whole cursor | drop 1          | no-op
//   has Y  | has Y same | merge cursor→slot | drop 1          | no-op
//   has Y  | has X diff | swap (deferred)   | refuse          | no-op
//
// "Instant transfer" (shift-left) sends a slot's stack to the first
// available spot in the OPPOSITE region (vault↔inv) without ever
// touching the cursor.
//
// All cross-region moves go through the atomic transfer RPCs. All
// within-region moves are either local (inv↔inv positional swap) or
// hotbar equip RPC. The cursor itself is purely local state — picking
// up does NOT call any RPC; only the eventual drop does.

import type { CursorStackPayload } from './useCursorStack';
import type { SlotClickInput, SlotClickHandlers, SlotOccupant } from './types';

export interface SlotClickResult {
  /** Whether the cursor changed. */
  cursorAfter: CursorStackPayload | null;
  /** Human-readable status (for the debug badge). */
  status: string;
}

function occupantToCursor(occ: SlotOccupant, location: SlotClickInput['location'], qty: number): CursorStackPayload {
  const origin: CursorStackPayload['origin'] = (() => {
    if (location.region === 'inventory') {
      return { region: 'inventory', rowId: occ.rowId, gridSlot: location.gridSlot, fullQuantity: occ.quantity };
    }
    if (location.region === 'hotbar') {
      return { region: 'hotbar', slot: location.slot };
    }
    return { region: 'vault', page: location.page, slot: location.slot, fullQuantity: occ.quantity };
  })();
  return {
    itemId: occ.itemId,
    itemKey: occ.itemKey,
    quantity: qty,
    name: occ.name,
    tier: occ.tier,
    spriteUrl: occ.spriteUrl,
    nonStackable: occ.nonStackable,
    origin,
  };
}

/** The reducer. Returns the new cursor state + a status string.
 *  Side effects (RPC calls, local swaps) happen inside via handlers. */
export async function slotClick(
  input: SlotClickInput,
  cursor: CursorStackPayload | null,
  handlers: SlotClickHandlers,
): Promise<SlotClickResult> {
  const { location, occupant, button, shift, doubleClick } = input;

  // ── SHIFT + LEFT: instant transfer to opposite region ──────────
  if (shift && button === 'left' && !doubleClick) {
    if (!occupant) return { cursorAfter: cursor, status: 'shift-click: slot empty' };

    // vault → inventory (always; vault is "the chest")
    if (location.region === 'vault') {
      const ok = await handlers.transferVaultToInv(location.page, location.slot, occupant.quantity);
      return { cursorAfter: cursor, status: ok ? 'shift-xfer vault→inv OK' : 'shift-xfer vault→inv FAIL' };
    }
    // inventory → vault (first empty slot in active page, else any page)
    if (location.region === 'inventory') {
      const target = handlers.findFirstEmptyVaultSlot(handlers.activeVaultPage);
      if (!target) return { cursorAfter: cursor, status: 'shift-xfer: vault full' };
      const ok = await handlers.transferInvToVault([occupant.rowId], target.page, target.slot);
      return { cursorAfter: cursor, status: ok ? `shift-xfer inv→v${target.page}s${target.slot} OK` : 'shift-xfer FAIL' };
    }
    // hotbar → inventory: just unequip; the row already lives in inventory
    if (location.region === 'hotbar') {
      await handlers.setHotbarSlot(location.slot, null);
      return { cursorAfter: cursor, status: 'shift-xfer hotbar→inv OK' };
    }
  }

  // ── RIGHT-CLICK ─────────────────────────────────────────────────
  if (button === 'right') {
    // empty cursor, slot has stack → take half (ceil)
    if (!cursor && occupant) {
      if (occupant.nonStackable || occupant.quantity <= 1) {
        // Take all
        return { cursorAfter: occupantToCursor(occupant, location, occupant.quantity), status: 'cursor: picked up 1' };
      }
      const half = Math.ceil(occupant.quantity / 2);
      return { cursorAfter: occupantToCursor(occupant, location, half), status: `cursor: picked up ${half} (half)` };
    }
    // cursor has item, slot empty or same item → drop 1
    if (cursor && (!occupant || occupant.itemId === cursor.itemId)) {
      const dropped = await performDrop(cursor, 1, location, handlers);
      if (!dropped.ok) return { cursorAfter: cursor, status: `drop 1 FAIL: ${dropped.reason}` };
      const remaining = cursor.quantity - 1;
      return {
        cursorAfter: remaining > 0 ? { ...cursor, quantity: remaining } : null,
        status: `dropped 1 → ${location.region}`,
      };
    }
    // cursor different item, refuse
    return { cursorAfter: cursor, status: 'right-click: different item, no-op' };
  }

  // ── LEFT-CLICK (single) ────────────────────────────────────────
  if (button === 'left' && !doubleClick) {
    // Both empty: no-op
    if (!cursor && !occupant) return { cursorAfter: null, status: '' };

    // Cursor empty, slot has stack → pick up WHOLE stack
    if (!cursor && occupant) {
      return { cursorAfter: occupantToCursor(occupant, location, occupant.quantity), status: `cursor: picked up x${occupant.quantity}` };
    }

    // Cursor has item, slot empty → drop entire cursor
    if (cursor && !occupant) {
      const dropped = await performDrop(cursor, cursor.quantity, location, handlers);
      if (!dropped.ok) return { cursorAfter: cursor, status: `drop FAIL: ${dropped.reason}` };
      return { cursorAfter: null, status: `dropped x${cursor.quantity} → ${location.region}` };
    }

    // Cursor + slot have SAME item → merge cursor into slot
    if (cursor && occupant && occupant.itemId === cursor.itemId && !cursor.nonStackable) {
      const dropped = await performDrop(cursor, cursor.quantity, location, handlers);
      if (!dropped.ok) return { cursorAfter: cursor, status: `merge FAIL: ${dropped.reason}` };
      return { cursorAfter: null, status: `merged x${cursor.quantity} into ${location.region}` };
    }

    // Cursor + slot have DIFFERENT items → swap (deferred — needs
    // atomic swap RPC; for now refuse so the user has to clear).
    if (cursor && occupant && occupant.itemId !== cursor.itemId) {
      return { cursorAfter: cursor, status: 'swap not yet supported — clear slot first' };
    }

    // Cursor + slot both non-stackable same item → no merge possible
    return { cursorAfter: cursor, status: 'non-stackable: cannot merge' };
  }

  // ── DOUBLE-CLICK ───────────────────────────────────────────────
  if (doubleClick) {
    // Defer collect-all-matching; double-click on vault tile in the
    // legacy UI did "send to inventory" — preserve that behavior here
    // by short-circuiting to a shift-click style transfer.
    if (!cursor && occupant && location.region === 'vault') {
      const ok = await handlers.transferVaultToInv(location.page, location.slot, occupant.quantity);
      return { cursorAfter: null, status: ok ? `dblclick vault→inv x${occupant.quantity} OK` : 'dblclick vault→inv FAIL' };
    }
    return { cursorAfter: cursor, status: '' };
  }

  return { cursorAfter: cursor, status: '' };
}

// ── performDrop: routes cursor → slot through the right RPC ────────
async function performDrop(
  cursor: CursorStackPayload,
  qty: number,
  dst: SlotClickInput['location'],
  h: SlotClickHandlers,
): Promise<{ ok: boolean; reason?: string }> {
  const origin = cursor.origin;

  // Origin is INVENTORY
  if (origin.region === 'inventory') {
    if (dst.region === 'vault') {
      // Whole inventory row only (transfer takes row ids).
      const ok = await h.transferInvToVault([origin.rowId], dst.page, dst.slot);
      return { ok, reason: ok ? undefined : 'transferInvToVault rejected' };
    }
    if (dst.region === 'inventory') {
      // Pure positional swap, no RPC needed.
      h.swapInventorySlots(origin.gridSlot, dst.gridSlot);
      return { ok: true };
    }
    if (dst.region === 'hotbar') {
      // Equip this inventory item into a hotbar slot.
      await h.setHotbarSlot(dst.slot, cursor.itemId);
      return { ok: true };
    }
  }

  // Origin is HOTBAR
  if (origin.region === 'hotbar') {
    if (dst.region === 'hotbar') {
      // Hotbar swap: equip srcItem into dst, dstItem into src
      // For now just unequip src, equip into dst — half-implementation
      // until we add an atomic swap.
      await h.setHotbarSlot(origin.slot, null);
      await h.setHotbarSlot(dst.slot, cursor.itemId);
      return { ok: true };
    }
    if (dst.region === 'inventory') {
      // Unequip — the row stays in inventory wherever it was.
      await h.setHotbarSlot(origin.slot, null);
      return { ok: true };
    }
    if (dst.region === 'vault') {
      // Unequip then transfer. Need to find the inv row id for cursor.itemId.
      // Hotbar items are non-stack typically (or live as one row), so
      // the cursor.itemId maps to exactly one inv row. We don't have
      // a generic lookup in handlers yet — defer.
      return { ok: false, reason: 'hotbar→vault not yet supported (unequip first)' };
    }
  }

  // Origin is VAULT
  if (origin.region === 'vault') {
    if (dst.region === 'vault') {
      const ok = await h.transferVaultToVault(origin.page, origin.slot, dst.page, dst.slot, qty);
      return { ok };
    }
    if (dst.region === 'inventory' || dst.region === 'hotbar') {
      const ok = await h.transferVaultToInv(origin.page, origin.slot, qty);
      // Hotbar destination: equip after — defer for now
      return { ok };
    }
  }

  return { ok: false, reason: 'unhandled origin/destination combo' };
}
