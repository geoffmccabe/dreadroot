// VaultPanel — the big-chest UI. Left half is the vault grid (page
// tabs + cols×rows). Right half is the player's inventory grid +
// hotbar. Drag/drop between any of the three regions follows the
// Minecraft container model:
//   * left-click  = pick up whole stack / drop whole stack / merge
//   * right-click = pick up half / drop one
//   * shift+click = quick-transfer to the other side
// A cursor preview floats with the mouse while a stack is held. Esc
// closes the panel and returns the held stack to its origin.
//
// Styling: reuses the .admin-panel-dialog class so frosted-glass blur
// + scoped color tokens match the admin panel exactly.

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import type { UserInventoryItem } from '@/hooks/useUserData';
import { useVaultData } from '../hooks/useVaultData';
import type { CursorStack, VaultSlotDef } from '../types';
import { sortVaultPage } from '../lib/sortPage';

// ── Helpers ────────────────────────────────────────────────────────
function spriteUrlForDef(def: {
  texture_url?: string | null;
  textureUrl?: string | null;
  item_number?: number | null;
  itemNumber?: number | null;
}): string | null {
  const tex = def.texture_url ?? def.textureUrl ?? null;
  if (tex) return tex;
  const n = def.item_number ?? def.itemNumber ?? null;
  if (n != null && n >= 0 && n <= 228) return `/item-sprites/${n}.webp`;
  return null;
}

function isNonStackableKey(key: string | null | undefined): boolean {
  if (!key) return false;
  return key === 'health_potion' || key === 'grenade' || key.startsWith('grenade_t');
}

// ── Props ──────────────────────────────────────────────────────────
interface ItemDef {
  id: string;
  key: string;
  name: string;
  tier: number | null;
  item_number: number | null;
  texture_url: string | null;
}

interface VaultPanelProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string | null;
  inventory: UserInventoryItem[];
  equippedItems: Array<{ slot: number; itemId: string }>;
  // Server-verified mutators wired to useUserData.
  addItem: (itemId: string, quantity: number) => Promise<boolean>;
  removeInventoryRow: (rowId: string) => Promise<boolean>;
  updateEquippedSlot: (slot: number, itemId: string | null) => Promise<void>;
}

export function VaultPanel({
  isOpen,
  onClose,
  userId,
  inventory,
  equippedItems,
  addItem,
  removeInventoryRow,
  updateEquippedSlot,
}: VaultPanelProps) {
  const { pages, config, setSlot, removeFromSlot, replacePageLayout } = useVaultData(userId);
  const [activePage, setActivePage] = useState(0);
  const [cursor, setCursor] = useState<CursorStack | null>(null);
  const [cursorXY, setCursorXY] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Item defs for the inventory side (so we can render sprites + names).
  const inventoryItemIds = useMemo(() => {
    const ids = new Set<string>();
    for (const inv of inventory) if (inv.item_id && inv.quantity > 0) ids.add(inv.item_id);
    for (const eq of equippedItems) if (eq.itemId) ids.add(eq.itemId);
    return Array.from(ids);
  }, [inventory, equippedItems]);
  const [invDefs, setInvDefs] = useState<Map<string, ItemDef>>(new Map());
  useEffect(() => {
    if (!isOpen || inventoryItemIds.length === 0) return;
    (async () => {
      const { data } = await supabase
        .from('items')
        .select('id, key, name, tier, item_number, texture_url')
        .in('id', inventoryItemIds);
      if (data) {
        const m = new Map<string, ItemDef>();
        for (const d of data as ItemDef[]) m.set(d.id, d);
        setInvDefs(m);
      }
    })();
  }, [isOpen, inventoryItemIds.join(',')]);

  // Cursor follow.
  useEffect(() => {
    if (!isOpen) return;
    const onMove = (e: MouseEvent) => setCursorXY({ x: e.clientX, y: e.clientY });
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, [isOpen]);

  // Esc returns held stack to origin then closes.
  const returnCursorToOrigin = useCallback(async () => {
    if (!cursor) return;
    if (cursor.origin.kind === 'vault') {
      await setSlot(cursor.origin.page, cursor.origin.slot, cursor.itemId, cursor.quantity);
    } else if (cursor.origin.kind === 'inventory') {
      // Add back as `quantity` units. addItem already knows non-stack rules.
      await addItem(cursor.itemId, cursor.quantity);
    }
    setCursor(null);
  }, [cursor, setSlot, addItem]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        void returnCursorToOrigin();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose, returnCursorToOrigin]);

  // ── Inventory groups (stackable items collapse, non-stack rows
  //    stay separate). Mirrors FortressHUD logic so the UX matches.
  const inventoryEntries = useMemo(() => {
    type Entry = {
      key: string;          // rowId for non-stack, itemId for stack
      itemId: string;
      def: ItemDef | undefined;
      quantity: number;
      isNonStackRow: boolean;
      rowIds: string[];     // backing user_inventory rows
    };
    const byKey = new Map<string, Entry>();
    for (const inv of inventory) {
      if (inv.item_type !== 'item' || !inv.item_id || inv.quantity <= 0) continue;
      const def = invDefs.get(inv.item_id);
      const nonStack = isNonStackableKey(def?.key);
      const k = nonStack ? inv.id : inv.item_id;
      const existing = byKey.get(k);
      if (existing) {
        existing.quantity += inv.quantity;
        existing.rowIds.push(inv.id);
      } else {
        byKey.set(k, {
          key: k,
          itemId: inv.item_id,
          def,
          quantity: nonStack ? 1 : inv.quantity,
          isNonStackRow: nonStack,
          rowIds: [inv.id],
        });
      }
    }
    return Array.from(byKey.values());
  }, [inventory, invDefs]);

  // ── Vault slot click handler (Minecraft model) ─────────────────
  const handleVaultClick = useCallback(async (
    e: React.MouseEvent, page: number, slot: number
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const row = pages[page]?.find(s => s.slot === slot);
    const shift = e.shiftKey;
    const right = e.button === 2 || e.type === 'contextmenu';

    if (shift && row) {
      // Shift+click — quick-transfer vault → inventory.
      const ok = await addItem(row.itemId, row.quantity);
      if (ok) await removeFromSlot(page, slot, row.quantity);
      return;
    }

    if (!cursor && row) {
      // Pick up.
      const take = right ? Math.ceil(row.quantity / 2) : row.quantity;
      const removed = await removeFromSlot(page, slot, take);
      if (removed > 0) {
        setCursor({
          itemId: row.itemId, itemKey: row.itemKey, name: row.name, tier: row.tier,
          itemNumber: row.itemNumber, textureUrl: row.textureUrl, quantity: removed,
          origin: { kind: 'vault', page, slot },
        });
      }
      return;
    }

    if (cursor && !row) {
      // Drop into empty slot.
      const qty = right ? 1 : cursor.quantity;
      await setSlot(page, slot, cursor.itemId, qty);
      if (qty >= cursor.quantity) setCursor(null);
      else setCursor({ ...cursor, quantity: cursor.quantity - qty });
      return;
    }

    if (cursor && row && row.itemId === cursor.itemId) {
      // Merge onto same item.
      const qty = right ? 1 : cursor.quantity;
      await setSlot(page, slot, cursor.itemId, qty);
      if (qty >= cursor.quantity) setCursor(null);
      else setCursor({ ...cursor, quantity: cursor.quantity - qty });
      return;
    }

    if (cursor && row && row.itemId !== cursor.itemId) {
      // Swap: pick up the slot row, drop cursor stack.
      const pickedQty = row.quantity;
      const droppingQty = cursor.quantity;
      const droppingId = cursor.itemId;
      const pickedDef = {
        itemId: row.itemId, itemKey: row.itemKey, name: row.name, tier: row.tier,
        itemNumber: row.itemNumber, textureUrl: row.textureUrl,
      };
      await removeFromSlot(page, slot, pickedQty);
      await setSlot(page, slot, droppingId, droppingQty);
      setCursor({
        ...pickedDef,
        quantity: pickedQty,
        origin: { kind: 'vault', page, slot },
      });
    }
  }, [pages, cursor, addItem, removeFromSlot, setSlot]);

  // ── Inventory slot click handler ───────────────────────────────
  const handleInventoryClick = useCallback(async (
    e: React.MouseEvent, entry: typeof inventoryEntries[number] | null, _index: number
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const shift = e.shiftKey;
    const right = e.button === 2 || e.type === 'contextmenu';

    if (shift && entry) {
      // Shift+click — quick-transfer inventory → vault. Find first empty
      // slot on the active page, or stack onto matching slot.
      const stackTarget = pages[activePage].find(s => s.itemId === entry.itemId);
      if (stackTarget) {
        await setSlot(stackTarget.page, stackTarget.slot, entry.itemId, entry.quantity);
      } else {
        const used = new Set(pages[activePage].map(s => s.slot));
        let emptySlot = -1;
        for (let i = 0; i < config.cols * config.rows; i++) {
          if (!used.has(i)) { emptySlot = i; break; }
        }
        if (emptySlot < 0) return; // page full
        await setSlot(activePage, emptySlot, entry.itemId, entry.quantity);
      }
      // Remove the inventory rows that backed this entry.
      for (const rid of entry.rowIds) await removeInventoryRow(rid);
      return;
    }

    if (!cursor && entry) {
      // Pick up from inventory. For non-stack rows we always take 1
      // (each row IS one); for stacks we take all or half.
      const take = entry.isNonStackRow
        ? 1
        : (right ? Math.ceil(entry.quantity / 2) : entry.quantity);
      // For stack entries we have a single row, decrement it. For
      // non-stack entries, delete the row.
      if (entry.isNonStackRow) {
        await removeInventoryRow(entry.rowIds[0]);
      } else {
        // Take the whole row(s). Currently stack entries are exactly
        // one row; delete it (addItem will re-create on return).
        for (const rid of entry.rowIds) await removeInventoryRow(rid);
        // If a partial take, add the remainder back.
        if (take < entry.quantity) {
          await addItem(entry.itemId, entry.quantity - take);
        }
      }
      setCursor({
        itemId: entry.itemId,
        itemKey: entry.def?.key ?? '',
        name: entry.def?.name ?? '',
        tier: entry.def?.tier ?? null,
        itemNumber: entry.def?.item_number ?? null,
        textureUrl: entry.def?.texture_url ?? null,
        quantity: take,
        origin: { kind: 'inventory', rowId: entry.rowIds[0] },
      });
      return;
    }

    if (cursor && !entry) {
      // Drop into inventory. addItem handles non-stack splitting.
      const qty = right ? 1 : cursor.quantity;
      await addItem(cursor.itemId, qty);
      if (qty >= cursor.quantity) setCursor(null);
      else setCursor({ ...cursor, quantity: cursor.quantity - qty });
      return;
    }

    if (cursor && entry && entry.itemId === cursor.itemId) {
      // Merge — add 1 or all to inventory.
      const qty = right ? 1 : cursor.quantity;
      await addItem(cursor.itemId, qty);
      if (qty >= cursor.quantity) setCursor(null);
      else setCursor({ ...cursor, quantity: cursor.quantity - qty });
    }
  }, [cursor, pages, activePage, config, addItem, removeInventoryRow, setSlot]);

  // ── ORG button ─────────────────────────────────────────────────
  const handleOrg = useCallback(async () => {
    const sorted = sortVaultPage(pages[activePage] || []);
    await replacePageLayout(activePage, sorted.map((s, i) => ({
      slot: i, item_id: s.itemId, quantity: s.quantity,
    })));
  }, [pages, activePage, replacePageLayout]);

  // ── Render ─────────────────────────────────────────────────────
  if (!isOpen) return null;

  const slotsThisPage = config.cols * config.rows;
  const vaultMap = new Map<number, VaultSlotDef>();
  for (const s of (pages[activePage] || [])) vaultMap.set(s.slot, s);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) { void returnCursorToOrigin(); onClose(); } }}>
      <DialogContent
        ref={(node: HTMLDivElement | null) => {
          if (node) {
            node.style.setProperty('background', 'hsla(211, 30%, 51%, 0.35)', 'important');
            node.style.setProperty('border', '1px solid hsla(211, 34%, 73%, 0.8)', 'important');
            node.style.setProperty('border-radius', '6px', 'important');
          }
        }}
        className={cn(
          "admin-panel-dialog w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col"
        )}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>Vault</span>
            <button
              type="button"
              onClick={handleOrg}
              className="text-xs px-3 py-1 rounded border border-white/30 hover:bg-white/10 transition"
              style={{ color: 'hsl(0, 0%, 95%)' }}
            >
              ORG
            </button>
          </DialogTitle>
        </DialogHeader>

        {/* Page tabs — hover to switch */}
        <div className="flex gap-1 mb-3 flex-shrink-0">
          {Array.from({ length: config.page_count }, (_, p) => (
            <button
              key={p}
              type="button"
              onMouseEnter={() => setActivePage(p)}
              onClick={() => setActivePage(p)}
              className={cn(
                "text-xs px-3 py-1 rounded border transition",
                p === activePage ? "bg-white/15 border-white/50" : "border-white/20 hover:bg-white/5"
              )}
              style={{ color: 'hsl(0, 0%, 95%)' }}
            >
              Page {p + 1}
            </button>
          ))}
        </div>

        {/* Body: vault grid (left) + inventory (right) */}
        <div className="flex gap-6 flex-1 overflow-hidden">
          {/* VAULT GRID */}
          <div className="flex-1">
            <div
              className="grid gap-1"
              style={{ gridTemplateColumns: `repeat(${config.cols}, 56px)` }}
            >
              {Array.from({ length: slotsThisPage }, (_, i) => {
                const entry = vaultMap.get(i);
                return (
                  <VaultTile
                    key={`v-${activePage}-${i}`}
                    sprite={entry ? spriteUrlForDef(entry) : null}
                    name={entry?.name ?? null}
                    tier={entry?.tier ?? null}
                    quantity={entry?.quantity ?? 0}
                    onClick={(e) => handleVaultClick(e, activePage, i)}
                    onContextMenu={(e) => handleVaultClick(e, activePage, i)}
                  />
                );
              })}
            </div>
          </div>

          {/* INVENTORY */}
          <div style={{ width: 6 * 56 + 5 * 4 }}>
            <div className="text-xs mb-2 opacity-80" style={{ color: 'hsl(0, 0%, 95%)' }}>
              Inventory
            </div>
            <div
              className="grid gap-1 mb-4"
              style={{ gridTemplateColumns: `repeat(6, 56px)` }}
            >
              {Array.from({ length: 18 }, (_, i) => {
                const entry = inventoryEntries[i] || null;
                return (
                  <VaultTile
                    key={`i-${i}`}
                    sprite={entry ? spriteUrlForDef(entry.def ?? {}) : null}
                    name={entry?.def?.name ?? null}
                    tier={entry?.def?.tier ?? null}
                    quantity={entry?.quantity ?? 0}
                    onClick={(e) => handleInventoryClick(e, entry, i)}
                    onContextMenu={(e) => handleInventoryClick(e, entry, i)}
                  />
                );
              })}
            </div>

            <div className="text-xs mb-2 opacity-80" style={{ color: 'hsl(0, 0%, 95%)' }}>
              Hotbar
            </div>
            <div
              className="grid gap-1"
              style={{ gridTemplateColumns: `repeat(6, 56px)` }}
            >
              {Array.from({ length: 6 }, (_, i) => {
                const slot = i + 1;
                const eq = equippedItems.find(e => e.slot === slot);
                const def = eq ? invDefs.get(eq.itemId) : undefined;
                const qty = eq
                  ? inventory.filter(inv => inv.item_id === eq.itemId).reduce((a, inv) => a + inv.quantity, 0)
                  : 0;
                return (
                  <VaultTile
                    key={`h-${i}`}
                    sprite={def ? spriteUrlForDef(def) : null}
                    name={def?.name ?? null}
                    tier={def?.tier ?? null}
                    quantity={qty}
                    border="hotbar"
                  />
                );
              })}
            </div>
          </div>
        </div>

        {/* Cursor preview (portal'd via fixed position) */}
        {cursor && (
          <div
            style={{
              position: 'fixed',
              left: cursorXY.x + 8,
              top: cursorXY.y + 8,
              pointerEvents: 'none',
              zIndex: 9999,
              width: 48, height: 48,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.6))',
            }}
          >
            {(() => {
              const s = spriteUrlForDef(cursor);
              return s ? (
                <img src={s} alt={cursor.name} style={{ width: 42, height: 42, objectFit: 'contain' }} />
              ) : (
                <div style={{ width: 42, height: 42, background: 'hsla(211, 30%, 51%, 0.8)', borderRadius: 4 }} />
              );
            })()}
            {cursor.quantity > 1 && (
              <span style={{
                position: 'absolute', bottom: -2, right: -2,
                fontSize: 11, fontWeight: 700, color: 'white',
                textShadow: '0 0 3px rgba(0,0,0,0.9)',
              }}>{cursor.quantity}</span>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Single tile ────────────────────────────────────────────────────
function VaultTile({
  sprite, name, tier, quantity, onClick, onContextMenu, border,
}: {
  sprite: string | null;
  name: string | null;
  tier: number | null;
  quantity: number;
  onClick?: (e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  border?: 'hotbar';
}) {
  return (
    <div
      onClick={onClick}
      onContextMenu={onContextMenu}
      title={name ?? undefined}
      style={{
        width: 56, height: 56,
        borderRadius: 'var(--hud-radius)',
        border: border === 'hotbar'
          ? '1px solid hsla(45, 80%, 60%, 0.6)'
          : '1px solid hsla(var(--hud-border))',
        background: 'hsla(var(--hud-bg-dim))',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        overflow: 'hidden', position: 'relative',
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      {tier != null && quantity > 0 && (
        <span style={{
          position: 'absolute', top: 2, left: 4,
          fontSize: 10, fontWeight: 700, color: 'white',
          fontFamily: 'var(--hud-font)', lineHeight: 1,
          textShadow: '0 0 3px rgba(0,0,0,0.8)', pointerEvents: 'none',
        }}>{tier}</span>
      )}
      {sprite && (
        <img src={sprite} alt={name ?? ''} draggable={false}
          style={{ width: 42, height: 42, objectFit: 'contain', pointerEvents: 'none' }} />
      )}
      {quantity > 1 && (
        <span style={{
          position: 'absolute', bottom: 2, right: 4,
          fontSize: 11, fontWeight: 700, color: 'white',
          textShadow: '0 0 3px rgba(0,0,0,0.9)', pointerEvents: 'none',
        }}>{quantity}</span>
      )}
    </div>
  );
}
