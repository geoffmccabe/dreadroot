// VaultPanel — fixed-position overlay rendered directly ABOVE the
// HUD's inventory grid (no Dialog, no modal, no duplicate inventory
// column). The HUD's existing inventory + hotbar grids are the ONLY
// inventory rendering; cross-panel drag/drop works because both
// sides speak the same drag MIME (text/plain JSON, see HUD's
// onDragStart).
//
// Drag payload format (unified with FortressHUD):
//   { type: 'inventory', gridKey, itemId }                — from HUD inv tile
//   { type: 'hotbar',    slot }                           — from HUD QS tile
//   { type: 'vault',     page, slot, itemId, quantity, fullQuantity } — from vault tile
//
// Holding Shift while starting a drag from a vault tile drags only
// 1 item (Minecraft partial-drag).
//
// Right-click on a vault tile opens the item-detail modal.
// Double-click on a vault tile takes the whole stack into inventory.

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { UserInventoryItem } from '@/hooks/useUserData';
import { useVaultData } from '../hooks/useVaultData';
import type { VaultSlotDef } from '../types';
import { sortVaultPage } from '../lib/sortPage';
import { setDebugStatus } from '@/lib/debugStatus';
import { useItemDetail } from '@/contexts/ItemDetailContext';
import { useRegisterVaultBridge, type VaultBridge } from '@/contexts/VaultBridgeContext';
import { cn } from '@/lib/utils';

const TILE = 56;
const GAP = 6;

interface ItemDef {
  id: string;
  key: string;
  name: string;
  tier: number | null;
  item_number: number | null;
  texture_url: string | null;
}

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

interface VaultPanelProps {
  isOpen: boolean;
  onClose: () => void;
  forceCloseToken?: number;
  userId: string | null;
  inventory: UserInventoryItem[];
  equippedItems: Array<{ slot: number; itemId: string }>;
  addItem: (itemId: string, quantity: number) => Promise<boolean>;
  removeInventoryRow: (rowId: string) => Promise<boolean>;
  updateEquippedSlot: (slot: number, itemId: string | null) => Promise<void>;
  /** Item defs preloaded by the HUD's inventory. Used as a fast path
   *  so dropped items show their sprite + T# immediately while the
   *  vault's own fetch fills in any rows the HUD didn't know about. */
  preloadedDefs?: Map<string, { id: string; key: string | null; name: string; tier: number | null; item_number: number | null; texture_url: string | null }>;
}

export function VaultPanel({
  isOpen,
  onClose,
  userId,
  inventory,
  addItem,
  removeInventoryRow,
  preloadedDefs,
}: VaultPanelProps) {
  const {
    pages, config, setSlot, removeFromSlot, replacePageLayout,
    transferFromInventory, transferToInventory, transferWithinVault,
  } = useVaultData(userId);
  const [activePage, setActivePage] = useState(0);
  const { openItem } = useItemDetail();
  const registerBridge = useRegisterVaultBridge();

  // Release pointer-lock so clicks reach the overlay immediately.
  useEffect(() => {
    if (!isOpen) return;
    if (document.pointerLockElement) {
      try { document.exitPointerLock(); } catch { /* ignore */ }
    }
  }, [isOpen]);

  useEffect(() => {
    if (activePage >= config.page_count) setActivePage(0);
  }, [config.page_count, activePage]);

  // Item def cache for the items in vault rows (so we can render
  // sprite + tier on each tile).
  const vaultItemIds = useMemo(() => {
    const ids = new Set<string>();
    // VaultSlotDef uses camelCase `itemId` — NOT snake_case `item_id`.
    // Reading the wrong field silently produces [undefined] and the
    // items fetch returns 0 rows → no sprites in the entire panel.
    for (const p of pages) for (const r of p) if (r.itemId) ids.add(r.itemId);
    return Array.from(ids);
  }, [pages]);
  const [defs, setDefs] = useState<Map<string, ItemDef>>(new Map());
  useEffect(() => {
    if (!isOpen || vaultItemIds.length === 0) return;
    (async () => {
      const { data, error } = await supabase
        .from('items')
        .select('id, key, name, tier, item_number, texture_url')
        .in('id', vaultItemIds);
      if (error) {
        console.error('[vault] item def fetch failed:', error);
        setDebugStatus(`vault: defs fetch ERR ${error.message ?? String(error)}`);
        return;
      }
      // MERGE into existing defs rather than replace — the drop
      // handler seeds defs from the drag payload before this fetch
      // returns, so we mustn't wipe that.
      setDefs(prev => {
        const m = new Map(prev);
        for (const d of (data ?? []) as ItemDef[]) m.set(d.id, d);
        return m;
      });
      setDebugStatus(`vault: defs fetched ${data?.length ?? 0}/${vaultItemIds.length}`);
    })();
  }, [isOpen, vaultItemIds.join(',')]);

  // Build positional slot rows for the active page. Resolve def
  // from (in priority order): the row's own pre-joined fields
  // (populated by useVaultData's ensureItemDefs), the vault panel's
  // local defs cache (seeded by drop payload), then the HUD-preloaded
  // defs map. First-paint of a freshly-dropped item should resolve
  // via at least one of these.
  const activePageRows = useMemo(() => {
    const map = new Map<number, VaultSlotDef & { def?: ItemDef }>();
    for (const r of pages[activePage] ?? []) {
      const ownDef = defs.get(r.itemId);
      const preloadedDef = preloadedDefs?.get(r.itemId);
      // Synthesize a def from the row's own joined fields if either
      // tier or textureUrl/itemNumber is already populated — saves a
      // render frame while the defs map is still empty.
      const rowDef: ItemDef | undefined = (r.tier != null || r.textureUrl || r.itemNumber != null || r.name)
        ? {
            id: r.itemId,
            key: r.itemKey ?? '',
            name: r.name ?? '',
            tier: r.tier,
            item_number: r.itemNumber,
            texture_url: r.textureUrl,
          }
        : undefined;
      const def = ownDef ?? rowDef ?? (preloadedDef
        ? {
            id: preloadedDef.id,
            key: preloadedDef.key ?? '',
            name: preloadedDef.name,
            tier: preloadedDef.tier,
            item_number: preloadedDef.item_number,
            texture_url: preloadedDef.texture_url,
          }
        : undefined);
      map.set(r.slot, { ...r, def });
    }
    return map;
  }, [pages, activePage, defs, preloadedDefs]);

  // ── ORG button ────────────────────────────────────────────────
  const handleOrg = useCallback(async () => {
    const sorted = sortVaultPage(pages[activePage] || []);
    await replacePageLayout(activePage, sorted.map((s, i) => ({
      slot: i, item_id: s.itemId, quantity: s.quantity,
    })));
  }, [pages, activePage, replacePageLayout]);

  // ── Drag start (vault tile) ───────────────────────────────────
  const handleDragStartVault = useCallback((
    e: React.DragEvent, row: VaultSlotDef,
  ) => {
    e.dataTransfer.effectAllowed = 'move';
    // Shift+drag = drag only 1 item (Minecraft partial). Otherwise
    // drag the whole stack.
    const moveQty = e.shiftKey ? 1 : row.quantity;
    const payload = {
      type: 'vault' as const,
      page: row.page,
      slot: row.slot,
      itemId: row.itemId,
      quantity: moveQty,
      fullQuantity: row.quantity,
    };
    e.dataTransfer.setData('text/plain', JSON.stringify(payload));
    if (e.currentTarget instanceof HTMLElement) {
      e.dataTransfer.setDragImage(e.currentTarget, 28, 28);
    }
  }, []);

  // ── Drop on vault tile ────────────────────────────────────────
  const handleDropOnVault = useCallback(async (
    e: React.DragEvent, page: number, slot: number,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const raw = e.dataTransfer.getData('text/plain');
    if (!raw) return;
    let src: any;
    try { src = JSON.parse(raw); } catch { return; }

    // Inventory → vault (atomic, single RPC)
    if (src.type === 'inventory') {
      const rows = inventory.filter(
        (i) => i.item_type === 'item' && i.item_id === src.itemId && i.quantity > 0,
      );
      if (rows.length === 0) return;

      // Seed the local defs cache from the drag payload so the tile
      // renders sprite + T# IMMEDIATELY, before the vault refetch
      // returns.
      if (src.defName || src.defTextureUrl || src.defItemNumber != null) {
        setDefs(prev => {
          if (prev.has(src.itemId)) return prev;
          const next = new Map(prev);
          next.set(src.itemId, {
            id: src.itemId,
            key: '',
            name: src.defName ?? '',
            tier: src.defTier ?? null,
            item_number: src.defItemNumber ?? null,
            texture_url: src.defTextureUrl ?? null,
          });
          return next;
        });
      }

      const ok = await transferFromInventory(
        rows.map(r => r.id), page, slot,
      );
      if (ok) {
        setDebugStatus(`vault: inv→p${page}s${slot} OK (atomic)`);
        return;
      }
      // Fallback: ADD-to-vault first, then remove inventory rows.
      const totalQty = rows.reduce((acc, r) => acc + r.quantity, 0);
      let setOk: unknown = null;
      try { setOk = await setSlot(page, slot, src.itemId, totalQty); }
      catch (err) { console.error('[vault] inv→vault fallback setSlot threw:', err); }
      if (!setOk) {
        setDebugStatus(`vault: inv→p${page}s${slot} FAIL — item stays in inv`);
        return;
      }
      for (const r of rows) {
        try { await removeInventoryRow(r.id); }
        catch (err) { console.warn('[vault] removeInventoryRow failed:', err); }
      }
      setDebugStatus(`vault: inv→p${page}s${slot} OK (fallback)`);
      return;
    }

    // Hotbar → vault: not currently supported (hotbar slot doesn't carry
    // the actual item — unequip first by dragging to inventory). Silently
    // ignore.
    if (src.type === 'hotbar') {
      setDebugStatus(`vault: hotbar→vault not supported — drop on inventory first`);
      return;
    }

    // Vault → vault (atomic, single RPC) with legacy fallback.
    if (src.type === 'vault') {
      if (src.page === page && src.slot === slot) return; // same-slot no-op
      const moveQty = src.quantity as number;
      const ok = await transferWithinVault(
        src.page, src.slot, page, slot, moveQty,
      );
      if (ok) {
        setDebugStatus(`vault: move p${src.page}s${src.slot}→p${page}s${slot} OK (atomic)`);
        return;
      }
      // Fallback: SET target first, then remove from source. Same
      // duplicate-over-loss preference as elsewhere.
      let setOk: unknown = null;
      try { setOk = await setSlot(page, slot, src.itemId, moveQty); }
      catch (err) { console.error('[vault] move fallback setSlot threw:', err); }
      if (!setOk) {
        setDebugStatus(`vault: move FAIL — item stays at source`);
        return;
      }
      await removeFromSlot(src.page, src.slot, moveQty);
      setDebugStatus(`vault: move p${src.page}s${src.slot}→p${page}s${slot} OK (fallback)`);
      return;
    }
  }, [inventory, setSlot, removeFromSlot, removeInventoryRow]);

  const allowDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  // ── Double-click vault tile → push back into inventory ─────────
  // Try atomic transfer first (one-RPC, item_history-backed). If
  // that fails (e.g. migration not yet deployed → RPC 404), fall
  // back to ADD-FIRST + removeFromSlot so we still never lose the
  // item. Worst case is a duplicate; never data loss.
  const handleDoubleClickVault = useCallback(async (row: VaultSlotDef) => {
    const ok = await transferToInventory(row.page, row.slot, row.quantity);
    if (ok) {
      setDebugStatus(`vault: dblclick vault→inv x${row.quantity} OK (atomic)`);
      return;
    }
    // Fallback: legacy 2-step, ADD-FIRST so the item can't be lost.
    let added = false;
    try { added = await addItem(row.itemId, row.quantity); }
    catch (err) { console.error('[vault] dblclick fallback addItem threw:', err); }
    if (!added) {
      setDebugStatus(`vault: dblclick FAIL — item stays in vault`);
      return;
    }
    const removed = await removeFromSlot(row.page, row.slot, row.quantity);
    setDebugStatus(
      removed > 0
        ? `vault: dblclick vault→inv x${row.quantity} OK (fallback)`
        : `vault: dblclick — added to inv, vault not decremented (duplicate)`,
    );
  }, [transferToInventory, addItem, removeFromSlot]);

  // ── Right-click vault tile → detail modal ─────────────────────
  const handleRightClickVault = useCallback((
    e: React.MouseEvent, row: VaultSlotDef & { def?: ItemDef },
  ) => {
    e.preventDefault();
    openItem({
      itemId: row.itemId,
      name: row.def?.name ?? '',
      sprite: row.def ? spriteUrlForDef(row.def) : null,
      itemNumber: row.def?.item_number ?? null,
      tier: row.def?.tier ?? null,
      quantity: row.quantity,
    });
  }, [openItem]);

  // ── Bridge registration: expose vault ops to HUD ──────────────
  // HUD inventory + hotbar drop handlers call this when they receive
  // a drag payload with type: 'vault' so they can decrement the
  // source vault slot.
  useEffect(() => {
    if (!isOpen) {
      registerBridge(null);
      return;
    }
    const b: VaultBridge = {
      removeFromSlot, setSlot,
      transferFromInventory, transferToInventory,
      activePage,
    };
    registerBridge(b);
    return () => registerBridge(null);
  }, [
    isOpen, removeFromSlot, setSlot,
    transferFromInventory, transferToInventory,
    activePage, registerBridge,
  ]);

  if (!isOpen) return null;

  const slotsThisPage = config.cols * config.rows;

  // No fixed positioning — VaultPanel is now an inline block rendered
  // inside FortressHUD's bottom-center flex column so it stacks
  // cleanly above the Inventory + Hotbar grids.
  return (
    <div
      style={{
        background: 'hsla(211, 30%, 51%, 0.45)',
        border: '1px solid hsla(211, 34%, 73%, 0.7)',
        borderRadius: 6,
        padding: 8,
      }}
    >
      {/* Page tabs + ORG button + X close */}
      <div className="flex gap-1 mb-2 items-center">
        {Array.from({ length: config.page_count }, (_, p) => (
          <button
            key={p}
            type="button"
            onMouseEnter={() => setActivePage(p)}
            onClick={() => setActivePage(p)}
            className={cn(
              "text-xs px-2 py-1 rounded border transition",
              p === activePage ? "bg-white/20 border-white/60" : "border-white/20 hover:bg-white/10"
            )}
            style={{ color: 'hsl(0, 0%, 95%)' }}
          >
            Page {p + 1}
          </button>
        ))}
        <button
          type="button"
          onClick={handleOrg}
          className="text-xs px-2 py-1 rounded border border-white/30 hover:bg-white/10 transition ml-2"
          style={{ color: 'hsl(0, 0%, 95%)' }}
        >
          ORG
        </button>
        <span className="ml-3 text-[10px] opacity-70" style={{ color: 'hsl(0,0%,95%)' }}>
          VAULT
        </span>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto text-base px-2 py-0.5 rounded hover:bg-white/15 transition leading-none"
          style={{ color: 'hsl(0, 0%, 95%)' }}
          title="Close vault (V)"
          aria-label="Close vault"
        >
          ×
        </button>
      </div>

      {/* Vault grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${config.cols}, ${TILE}px)`,
          gap: `${GAP}px`,
        }}
      >
        {Array.from({ length: slotsThisPage }, (_, i) => {
          const row = activePageRows.get(i);
          const sprite = row?.def ? spriteUrlForDef(row.def) : null;
          return (
            <div
              key={`v-${activePage}-${i}`}
              draggable={!!row}
              onDragStart={row ? (e) => handleDragStartVault(e, row) : undefined}
              onDragEnter={allowDrop}
              onDragOver={allowDrop}
              onDrop={(e) => handleDropOnVault(e, activePage, i)}
              onDoubleClick={row ? () => handleDoubleClickVault(row) : undefined}
              onContextMenu={(e) => {
                e.preventDefault();
                if (row) handleRightClickVault(e, row);
              }}
              title={row?.def?.name ?? `Slot ${i}`}
              style={{
                width: TILE,
                height: TILE,
                borderRadius: 'var(--hud-radius, 4px)',
                border: '1px solid hsla(var(--hud-border, 0 0% 100% / 0.3))',
                background: 'hsla(var(--hud-bg-dim, 0 0% 0% / 0.4))',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                overflow: 'hidden', position: 'relative',
                cursor: row ? 'grab' : 'default',
              }}
            >
              {row?.def?.tier != null && (
                <span style={{
                  position: 'absolute', top: 2, left: 4,
                  fontSize: 10, fontWeight: 700, color: 'white',
                  textShadow: '0 0 3px rgba(0,0,0,0.8)', pointerEvents: 'none',
                }}>T{row.def.tier}</span>
              )}
              {sprite && (
                <img src={sprite} alt={row?.def?.name ?? ''} draggable={false}
                  style={{ width: 42, height: 42, objectFit: 'contain', pointerEvents: 'none' }} />
              )}
              {row && row.quantity > 1 && (
                <span style={{
                  position: 'absolute', bottom: 2, right: 4,
                  fontSize: 11, fontWeight: 700, color: 'white',
                  textShadow: '0 0 3px rgba(0,0,0,0.9)', pointerEvents: 'none',
                }}>{row.quantity}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
