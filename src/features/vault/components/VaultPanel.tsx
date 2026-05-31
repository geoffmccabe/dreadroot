// VaultPanel — renders the vault page as a SlotGrid. All clicks dispatch
// through the parent's cursor-stack reducer (no HTML5 drag/drop). The
// vault registers its mutators with the VaultBridge so the HUD can
// build a unified slotClick handler that covers all three regions.

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
import { getItemSpriteUrl } from '@/lib/itemSprite';
import { SlotGrid, useCursorStack } from '@/features/inventory-system';
import type { SlotClickInput, SlotOccupant } from '@/features/inventory-system';

interface ItemDef {
  id: string;
  key: string;
  name: string;
  tier: number | null;
  item_number: number | null;
  texture_url: string | null;
  stackable?: boolean;
}

// Single source of truth is items.stackable (set in
// 20260601130000_item_ownership_invariants.sql). Key-based fallback
// only kicks in for legacy item defs that loaded before the column
// existed.
const isNonStackable = (def: ItemDef | undefined): boolean => {
  if (!def) return false;
  if (def.stackable === false) return true;
  const k = def.key;
  if (!k) return false;
  return k === 'health_potion'
    || k === 'grenade' || k.startsWith('grenade_t')
    || k === 'diamond'
    || k.startsWith('shpider_egg_t');
};

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
  preloadedDefs?: Map<string, { id: string; key: string | null; name: string; tier: number | null; item_number: number | null; texture_url: string | null }>;
  /** Unified slot-click handler from the HUD. Wraps the slotClick
   *  reducer with the full handler bag. Vault tile clicks dispatch
   *  through this so a single state machine handles vault, inventory,
   *  and hotbar uniformly. */
  onSlotClick: (input: SlotClickInput) => void;
}

// Tiny wrapper that adds ghost-source-slot rendering + inspect modal
// wiring to the vault grid. Kept inline because it's vault-specific.
function VaultSlotGridWithGhost({
  rows, cols, occupants, activePage, onSlotClick,
}: {
  rows: number; cols: number;
  occupants: Map<number, SlotOccupant>;
  activePage: number;
  onSlotClick: (input: SlotClickInput) => void;
}) {
  const cursor = useCursorStack((s) => s.cursor);
  const { openItem } = useItemDetail();
  return (
    <SlotGrid
      rows={rows}
      cols={cols}
      occupants={occupants}
      locationOf={(i) => ({ region: 'vault', page: activePage, slot: i })}
      onSlotClick={onSlotClick}
      onSlotInspect={(occ) => openItem({
        itemId: occ.itemId,
        name: occ.name,
        sprite: occ.spriteUrl,
        itemNumber: null,
        tier: occ.tier,
        quantity: occ.quantity,
      })}
      isSlotGhosted={(i) =>
        cursor?.origin.region === 'vault'
          && cursor.origin.page === activePage
          && cursor.origin.slot === i
      }
    />
  );
}

export function VaultPanel({
  isOpen,
  onClose,
  userId,
  preloadedDefs,
  onSlotClick,
}: VaultPanelProps) {
  const {
    pages, config, setSlot, removeFromSlot, replacePageLayout,
    transferFromInventory, transferToInventory, transferWithinVault,
  } = useVaultData(userId);
  const [activePage, setActivePage] = useState(0);
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

  // Item def cache for tiles. useVaultData also tracks defs but its
  // ensure-fetch is async; this local cache fills from preloadedDefs
  // and from the vault's own select.
  const vaultItemIds = useMemo(() => {
    const ids = new Set<string>();
    for (const p of pages) for (const r of p) if (r.itemId) ids.add(r.itemId);
    return Array.from(ids);
  }, [pages]);
  const [defs, setDefs] = useState<Map<string, ItemDef>>(new Map());
  useEffect(() => {
    if (!isOpen || vaultItemIds.length === 0) return;
    (async () => {
      const { data, error } = await supabase
        .from('items')
        .select('id, key, name, tier, item_number, texture_url, stackable')
        .in('id', vaultItemIds);
      if (error) {
        setDebugStatus(`vault: defs fetch ERR ${error.message ?? String(error)}`);
        return;
      }
      setDefs(prev => {
        const m = new Map(prev);
        for (const d of (data ?? []) as ItemDef[]) m.set(d.id, d);
        return m;
      });
    })();
  }, [isOpen, vaultItemIds.join(',')]);

  // Resolve an ItemDef from any source — own fetch, row's own joined
  // fields, or HUD-preloaded defs.
  const resolveDef = useCallback((row: VaultSlotDef): ItemDef | undefined => {
    const own = defs.get(row.itemId);
    if (own) return own;
    if (row.tier != null || row.textureUrl || row.itemNumber != null || row.name) {
      return {
        id: row.itemId,
        key: row.itemKey ?? '',
        name: row.name ?? '',
        tier: row.tier,
        item_number: row.itemNumber,
        texture_url: row.textureUrl,
      };
    }
    const pre = preloadedDefs?.get(row.itemId);
    if (pre) {
      return {
        id: pre.id, key: pre.key ?? '', name: pre.name,
        tier: pre.tier, item_number: pre.item_number, texture_url: pre.texture_url,
      };
    }
    return undefined;
  }, [defs, preloadedDefs]);

  // Build occupants map for the SlotGrid.
  const occupants = useMemo(() => {
    const map = new Map<number, SlotOccupant>();
    for (const r of pages[activePage] ?? []) {
      const def = resolveDef(r);
      const occ: SlotOccupant = {
        itemId: r.itemId,
        itemKey: def?.key ?? r.itemKey ?? '',
        quantity: r.quantity,
        name: def?.name ?? r.name ?? '',
        tier: def?.tier ?? r.tier,
        spriteUrl: getItemSpriteUrl(def ?? { item_number: r.itemNumber, texture_url: r.textureUrl }),
        nonStackable: isNonStackable(def),
        rowId: r.rowId,
      };
      map.set(r.slot, occ);
    }
    return map;
  }, [pages, activePage, resolveDef]);

  // ── ORG button ────────────────────────────────────────────────
  const handleOrg = useCallback(async () => {
    const sorted = sortVaultPage(pages[activePage] || []);
    await replacePageLayout(activePage, sorted.map((s, i) => ({
      slot: i, item_id: s.itemId, quantity: s.quantity,
    })));
  }, [pages, activePage, replacePageLayout]);

  // ── Bridge registration ───────────────────────────────────────
  // The HUD uses these to build the unified slotClick handler bag
  // and to know which vault page is currently visible (for shift-
  // click inv→vault destinations).
  const findFirstEmptySlot = useCallback((preferPage?: number) => {
    const tryPage = (p: number): number | null => {
      const occupied = new Set((pages[p] ?? []).map(r => r.slot));
      const cap = config.cols * config.rows;
      for (let s = 0; s < cap; s++) if (!occupied.has(s)) return s;
      return null;
    };
    const order: number[] = [];
    if (preferPage != null && preferPage < config.page_count) order.push(preferPage);
    for (let p = 0; p < config.page_count; p++) if (p !== preferPage) order.push(p);
    for (const p of order) {
      const s = tryPage(p);
      if (s != null) return { page: p, slot: s };
    }
    return null;
  }, [pages, config]);

  useEffect(() => {
    if (!isOpen) {
      registerBridge(null);
      return;
    }
    const b: VaultBridge = {
      removeFromSlot, setSlot,
      transferFromInventory, transferToInventory, transferWithinVault,
      findFirstEmptySlot,
      activePage,
    };
    registerBridge(b);
    return () => registerBridge(null);
  }, [
    isOpen, removeFromSlot, setSlot,
    transferFromInventory, transferToInventory, transferWithinVault,
    findFirstEmptySlot, activePage, registerBridge,
  ]);

  if (!isOpen) return null;

  return (
    <div
      style={{
        background: 'hsla(211, 30%, 51%, 0.45)',
        border: '1px solid hsla(211, 34%, 73%, 0.7)',
        borderRadius: 6,
        padding: 8,
      }}
    >
      {/* Page tabs + ORG + X close */}
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

      {/* Vault grid — all interaction routes through onSlotClick */}
      <VaultSlotGridWithGhost
        rows={config.rows}
        cols={config.cols}
        occupants={occupants}
        activePage={activePage}
        onSlotClick={onSlotClick}
      />
    </div>
  );
}
