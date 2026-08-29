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

/** Does `item` stack in `region`? The vault stacks everything — that is its
 *  purpose. The QUICK BAR stacks throwables only: a grenade slot is the
 *  player's lethal count ("Grenade x12"), so it fills and empties by unit
 *  rather than by slot. Inventory never stacks — every unit is its own tile,
 *  which is the long-standing rule and the DB enforces it. */
function stacksIn(region: SlotClickInput['location']['region'], throwable?: boolean): boolean {
  return region === 'vault' || (region === 'hotbar' && !!throwable);
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
    throwable: occ.throwable,
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
  // Only for a shift-TAP (click). A shift-DRAG falls through to the pickup below, where it
  // grabs the WHOLE vault stack (vs one unit for a plain drag).
  if (shift && button === 'left' && !doubleClick && input.intent !== 'drag') {
    if (!occupant) return { cursorAfter: cursor, status: 'shift-click: slot empty' };

    if (location.region === 'vault') {
      // Vault → first empty inv slot.
      const dstSlot = handlers.findFirstEmptyInventorySlot();
      if (dstSlot == null) return { cursorAfter: cursor, status: 'shift-xfer: inv full' };
      const ok = await handlers.transferSlot(
        { region: 'vault', page: location.page, slot: location.slot },
        { region: 'inventory', page: 0, slot: dstSlot },
        1,
      );
      return { cursorAfter: cursor, status: ok ? 'shift-xfer vault→inv OK' : 'shift-xfer vault→inv FAIL' };
    }
    if (location.region === 'inventory') {
      // Prefer vault (first empty slot of active page); fall back to QS.
      const vaultTarget = handlers.findFirstEmptyVaultSlot(handlers.activeVaultPage);
      if (vaultTarget) {
        const ok = await handlers.transferSlot(
          { region: 'inventory', page: 0, slot: location.gridSlot },
          { region: 'vault', page: vaultTarget.page, slot: vaultTarget.slot },
          1,
        );
        return { cursorAfter: cursor, status: ok ? `shift-xfer inv→v${vaultTarget.page}s${vaultTarget.slot} OK` : 'shift-xfer FAIL' };
      }
      const qsTarget = handlers.findFirstEmptyHotbarSlot();
      if (qsTarget != null) {
        const ok = await handlers.transferSlot(
          { region: 'inventory', page: 0, slot: location.gridSlot },
          { region: 'quick_select', page: 0, slot: qsTarget },
          1,
        );
        return { cursorAfter: cursor, status: ok ? `shift-xfer inv→QS${qsTarget} OK` : 'shift-xfer FAIL' };
      }
      return { cursorAfter: cursor, status: 'shift-xfer: vault + QS both full' };
    }
    if (location.region === 'hotbar') {
      // QS → first empty inv slot.
      const dstSlot = handlers.findFirstEmptyInventorySlot();
      if (dstSlot == null) return { cursorAfter: cursor, status: 'shift-xfer: inv full' };
      const ok = await handlers.transferSlot(
        { region: 'quick_select', page: 0, slot: location.slot },
        { region: 'inventory', page: 0, slot: dstSlot },
        1,
      );
      return { cursorAfter: cursor, status: ok ? 'shift-xfer QS→inv OK' : 'shift-xfer QS→inv FAIL' };
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

    // A WHOLE stack on the cursor can only land somewhere that stacks — the
    // vault, or a quick-bar slot when the item is a throwable. Inventory and
    // equip hold one unit each and would lose the rest.
    if (cursor && cursor.quantity > 1 && !stacksIn(location.region, cursor.throwable)) {
      return { cursorAfter: cursor, status: 'whole stack → vault or quick bar' };
    }

    // Cursor empty, slot has stack → pick up. From a stacking slot (vault, or a
    // quick-bar throwable), a plain drag takes ONE unit and the rest stays put;
    // SHIFT+drag takes the WHOLE stack, which can then only be dropped
    // somewhere that stacks (enforced above). Inventory is 1-per-slot so the
    // occupant is already a single unit there.
    if (!cursor && occupant) {
      const qty = (stacksIn(location.region, occupant.throwable) && occupant.quantity > 1 && !shift)
        ? 1 : occupant.quantity;
      return { cursorAfter: occupantToCursor(occupant, location, qty), status: `cursor: picked up x${qty}` };
    }

    // Cursor has item, slot empty → drop into the slot. Vault slots
    // stack, so the whole cursor lands there; inventory/QS slots hold
    // exactly one unit, so only ONE unit drops and the cursor keeps the
    // remainder (lets a vault stack be peeled out one slot at a time).
    if (cursor && !occupant) {
      const dropQty = stacksIn(location.region, cursor.throwable) ? cursor.quantity : 1;
      const dropped = await performDrop(cursor, dropQty, location, handlers);
      if (!dropped.ok) return { cursorAfter: cursor, status: `drop FAIL: ${dropped.reason}` };
      const remaining = cursor.quantity - dropQty;
      return {
        cursorAfter: remaining > 0 ? { ...cursor, quantity: remaining } : null,
        status: `dropped x${dropQty} → ${location.region}`,
      };
    }

    // Cursor + slot have the SAME item → MERGE when the destination stacks: any
    // vault slot, or a quick-bar slot holding the same throwable (dropping a
    // grenade on your grenade tile adds to the count). Without this the drop
    // fell through to the swap below and simply exchanged the two, so a stack
    // could never be built by dragging.
    // Inventory stays 1-per-slot, so a same-item collision there still falls
    // through to the swap and just rearranges tiles.
    if (cursor && occupant && occupant.itemId === cursor.itemId
        && stacksIn(location.region, cursor.throwable ?? occupant.throwable)) {
      const dropped = await performDrop(cursor, cursor.quantity, location, handlers);
      if (!dropped.ok) return { cursorAfter: cursor, status: `merge FAIL: ${dropped.reason}` };
      return { cursorAfter: null, status: `merged x${cursor.quantity} into ${location.region}` };
    }

    // Cursor + slot collision (any region, any item): SWAP. Source
    // slot gets dst's old item, dst slot gets the cursor's item.
    if (cursor && occupant) {
      const swapped = await performSwap(cursor, location, handlers);
      if (!swapped.ok) return { cursorAfter: cursor, status: `swap FAIL: ${swapped.reason}` };
      return { cursorAfter: null, status: `swapped ${location.region}` };
    }

    return { cursorAfter: cursor, status: '' };
  }

  // ── DOUBLE-CLICK ───────────────────────────────────────────────
  if (doubleClick) {
    // NOTE: double-click-to-equip is handled in FortressHUD, not here. The
    // real implementation (hand assignment per weapon type, and evicting a
    // two-handed rifle so a pistol can take the right hand) already existed
    // there behind triple-click, and it needs async weapon lookups this pure
    // reducer has no business doing. Reusing it beats a second copy that would
    // drift.
    // Vault tile → send first unit to inventory (preserves legacy UX).
    if (!cursor && occupant && location.region === 'vault') {
      const dstSlot = handlers.findFirstEmptyInventorySlot();
      if (dstSlot == null) return { cursorAfter: cursor, status: 'dblclick: inv full' };
      const ok = await handlers.transferSlot(
        { region: 'vault', page: location.page, slot: location.slot },
        { region: 'inventory', page: 0, slot: dstSlot },
        1,
      );
      return { cursorAfter: null, status: ok ? `dblclick vault→inv OK` : 'dblclick vault→inv FAIL' };
    }
    return { cursorAfter: cursor, status: '' };
  }

  return { cursorAfter: cursor, status: '' };
}

// ── Region/slot helpers shared by performDrop and performSwap ─────────
function regionOf(
  loc: CursorStackPayload['origin'] | SlotClickInput['location']
): 'inventory' | 'quick_select' | 'vault' | 'equip' {
  if (loc.region === 'hotbar') return 'quick_select';
  return loc.region;
}
function slotOf(
  loc: CursorStackPayload['origin'] | SlotClickInput['location']
): number {
  if (loc.region === 'inventory') return loc.gridSlot;
  return loc.slot;
}
function pageOf(
  loc: CursorStackPayload['origin'] | SlotClickInput['location']
): number {
  return loc.region === 'vault' ? loc.page : 0;
}

// ── performDrop: cursor → empty (or same-stack vault) slot ────────────
async function performDrop(
  cursor: CursorStackPayload,
  qty: number,
  dst: SlotClickInput['location'],
  h: SlotClickHandlers,
): Promise<{ ok: boolean; reason?: string }> {
  const origin = cursor.origin;
  const from = { region: regionOf(origin), page: pageOf(origin), slot: slotOf(origin) };
  const to = { region: regionOf(dst), page: pageOf(dst), slot: slotOf(dst) };
  // Any move touching the equip region goes through equip_transfer (not transfer_slot).
  if (from.region === 'equip' || to.region === 'equip') {
    try {
      const ok = await h.equipTransfer(from, to);
      return { ok, reason: ok ? undefined : 'equipTransfer rejected' };
    } catch (e) {
      return { ok: false, reason: 'equip move failed: ' + ((e as Error)?.message ?? String(e)) };
    }
  }
  const ok = await h.transferSlot(
    from as { region: 'inventory' | 'quick_select' | 'vault'; page: number; slot: number },
    to as { region: 'inventory' | 'quick_select' | 'vault'; page: number; slot: number },
    qty,
  );
  return { ok, reason: ok ? undefined : 'transferSlot rejected' };
}

// ── performSwap: cursor → occupied slot (different item, or inv/qs same) ─
async function performSwap(
  cursor: CursorStackPayload,
  dst: SlotClickInput['location'],
  h: SlotClickHandlers,
): Promise<{ ok: boolean; reason?: string }> {
  const origin = cursor.origin;
  const from = { region: regionOf(origin), page: pageOf(origin), slot: slotOf(origin) };
  const to = { region: regionOf(dst), page: pageOf(dst), slot: slotOf(dst) };
  if (from.region === 'equip' || to.region === 'equip') {
    try {
      const ok = await h.equipTransfer(from, to);   // equip_transfer also handles the swap case
      return { ok, reason: ok ? undefined : 'equipTransfer rejected' };
    } catch (e) {
      return { ok: false, reason: 'equip move failed: ' + ((e as Error)?.message ?? String(e)) };
    }
  }
  const ok = await h.swapSlot(
    from as { region: 'inventory' | 'quick_select' | 'vault'; page: number; slot: number },
    to as { region: 'inventory' | 'quick_select' | 'vault'; page: number; slot: number },
  );
  return { ok, reason: ok ? undefined : 'swapSlot rejected' };
}
