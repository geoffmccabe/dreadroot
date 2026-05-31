import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';

import { Settings, Store } from 'lucide-react';
import { FPSDisplay, DFlowOutputPanel, BlockDeleteHandler } from '@/components/FPSCounter';
import { HealthBar } from '@/features/shwarm';
import { supabase } from '@/integrations/supabase/client';
import { useItemDetail } from '@/contexts/ItemDetailContext';
import { useVaultBridge } from '@/contexts/VaultBridgeContext';
import { VaultPanel } from '@/features/vault';

// ─── Instructions Panel (bottom-right, collapsible) ──────────────

function InstructionsPanel({
  blockPlacementMode,
  selectedBlockType,
}: {
  blockPlacementMode: boolean;
  selectedBlockType: string | null;
}) {
  const [minimized, setMinimized] = useState(false);

  const panelStyle: React.CSSProperties = {
    position: 'fixed',
    bottom: '16px',
    right: '16px',
    zIndex: 20,
    borderRadius: 'var(--hud-radius)',
    border: '1px solid hsla(var(--hud-border))',
    background: 'hsla(var(--hud-bg))',
    color: 'hsl(var(--hud-text))',
    fontFamily: 'var(--hud-font)',
    cursor: 'pointer',
    userSelect: 'none',
  };

  if (minimized) {
    return (
      <div
        onClick={() => setMinimized(false)}
        style={{
          ...panelStyle,
          width: '32px',
          height: '32px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '16px',
          fontWeight: 600,
        }}
      >
        ?
      </div>
    );
  }

  return (
    <div
      onClick={() => setMinimized(true)}
      style={{
        ...panelStyle,
        padding: '8px 12px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        height: '74px',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ fontSize: '13px' }}>
        {blockPlacementMode
          ? (selectedBlockType
            ? 'Click to place block • Tab to see placed blocks'
            : 'Tab to see placed blocks • O to buy blocks')
          : 'R for crosshairs • Click to shoot'}
      </div>
      <div style={{ fontSize: '11px', opacity: 0.75, marginTop: '4px' }}>
        B = Block mode • L = Line • O = Shop • M = Market • I = Inventory
      </div>
    </div>
  );
}

// Intentionally loose typing: this file is an extraction of HUD JSX
// from a large component, and we want minimal friction during refactor.
type FortressHUDProps = any;

export function FortressHUD(props: FortressHUDProps) {
  const { openItem: openItemDetail } = useItemDetail();
  const vaultBridge = useVaultBridge();
  const {
    flyingCoins,
    currentTheme,
    availableThemes = [],
    tokenBalance,
    allTokenBalances = [],
    openPanel,
    inventory,
    blockPlacementMode,
    selectedBlockType,
    currentHealth,
    maxHealth,
    profile,
    user,
    userRoles,
    openAdminPanel,
    openMarketplace,
    jetBoostAvailable = 0,
    jetBoostMax = 0,
    isGliding = false,
    // Oxygen system
    oxygenSeconds = 0,
    isUnderwater = false,
    isOxygenCritical = false,
    equippedItems = [],
    updateEquippedSlot,
    addItem,
    removeInventoryRow,
    vaultOpen,
    inventoryOpen = false,
    setInventoryOpen,
    selectedSlot: selectedSlotProp = 1,
    onSelectSlot,
    onDeleteBlock,
    grenadeReadySlot = null,
    eggReadySlot = null,
    potionDrinkingSlot = null,
    onUseHotbarSlot,
  } = props;

  // Quick-select slot (1-6) — state lifted to parent, use prop + callback
  const selectedSlot = selectedSlotProp;
  const setSelectedSlot = onSelectSlot || (() => {});

  // Keyboard listener for quick-select keys 1-6
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't capture if user is typing in an input/textarea
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const num = parseInt(e.key);
      if (num >= 1 && num <= 6) {
        setSelectedSlot(num);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setSelectedSlot]);

  // Cycling coin display state
  const [cycleIndex, setCycleIndex] = useState(0);

  // Build list of coins user owns (balance >= 1) with their theme info
  const ownedCoins = useMemo(() => {
    const coins: Array<{ themeId: string; coins: number; imageUrl: string; name: string }> = [];

    for (const balance of allTokenBalances) {
      if (balance.coins >= 1) {
        const theme = availableThemes.find((t: any) => t.id === balance.token_theme_id);
        if (theme) {
          coins.push({
            themeId: balance.token_theme_id,
            coins: balance.coins,
            imageUrl: theme.coin_image_url || '/waterfall_coin.png',
            name: theme.display_name || theme.name || 'Coins'
          });
        }
      }
    }

    return coins;
  }, [allTokenBalances, availableThemes]);

  // Cycle through owned coins every 2 seconds
  useEffect(() => {
    if (ownedCoins.length <= 1) return;

    const interval = setInterval(() => {
      setCycleIndex(prev => (prev + 1) % ownedCoins.length);
    }, 2000);

    return () => clearInterval(interval);
  }, [ownedCoins.length]);

  // Reset cycle index if it goes out of bounds
  useEffect(() => {
    if (cycleIndex >= ownedCoins.length && ownedCoins.length > 0) {
      setCycleIndex(0);
    }
  }, [cycleIndex, ownedCoins.length]);

  // Get current display coin (either from cycle or fallback to current theme)
  const displayCoin = ownedCoins.length > 0
    ? ownedCoins[cycleIndex % ownedCoins.length]
    : {
        imageUrl: currentTheme?.coin_image_url || '/waterfall_coin.png',
        coins: tokenBalance?.coins || 0,
        name: currentTheme?.display_name || 'Coins'
      };

  // Collect ALL unique item IDs (equipped + inventory) for definition loading
  const allItemIds = useMemo(() => {
    const ids = new Set<string>();
    for (const e of (equippedItems as Array<{ slot: number; itemId: string }>)) {
      if (e.itemId) ids.add(e.itemId);
    }
    for (const inv of (inventory || [])) {
      if (inv.item_type === 'item' && inv.item_id && inv.quantity > 0) ids.add(inv.item_id);
    }
    return Array.from(ids);
  }, [equippedItems, inventory]);

  const [itemDefs, setItemDefs] = useState<Map<string, { name: string; key: string | null; item_number: number | null; texture_url: string | null; tier: number | null }>>(new Map());

  const loadItemDefs = useCallback(async () => {
    if (allItemIds.length === 0) { setItemDefs(new Map()); return; }
    const { data } = await supabase
      .from('items')
      .select('id, key, name, item_number, texture_url, tier')
      .in('id', allItemIds);
    const map = new Map<string, { name: string; key: string | null; item_number: number | null; texture_url: string | null; tier: number | null }>();
    for (const d of data || []) map.set(d.id, d);
    setItemDefs(map);
  }, [allItemIds]);

  // Item keys that don't stack — each row gets its own grid tile so
  // the 18-slot cap naturally limits how many a player can carry.
  // Mirrors useUserData.isNonStackableKey.
  const isNonStackableKey = useCallback((key: string | null | undefined): boolean => {
    if (!key) return false;
    return key === 'health_potion'
      || key === 'grenade' || key.startsWith('grenade_t')
      || key === 'diamond'
      || key.startsWith('shpider_egg_t');
  }, []);
  const nonStackableItemIds = useMemo(() => {
    const s = new Set<string>();
    for (const [id, def] of itemDefs) {
      if (isNonStackableKey(def.key)) s.add(id);
    }
    return s;
  }, [itemDefs, isNonStackableKey]);

  useEffect(() => { loadItemDefs(); }, [loadItemDefs]);

  // Helper: get sprite URL from item def
  const getSpriteUrl = useCallback((def: { texture_url: string | null; item_number: number | null } | undefined): string | null => {
    if (!def) return null;
    if (def.texture_url) return def.texture_url;
    if (def.item_number != null && def.item_number >= 0 && def.item_number <= 228) return `/item-sprites/${def.item_number}.webp`;
    return null;
  }, []);

  // Quantity lookup by item UUID — built from the inventory list so
  // the hotbar (and the grid) can show a stack badge that updates
  // immediately when an item is consumed.
  const quantityByItemId = useMemo(() => {
    const map = new Map<string, number>();
    for (const inv of (inventory || [])) {
      if (inv.item_id && inv.quantity > 0) {
        map.set(inv.item_id, (map.get(inv.item_id) ?? 0) + inv.quantity);
      }
    }
    return map;
  }, [inventory]);

  // Build hotbar slots 1-6
  const hotbarSlots = useMemo(() => {
    const slots: Array<{ slot: number; itemId: string | null; sprite: string | null; name: string | null; tier: number | null; quantity: number; isNonStack: boolean }> = [];
    for (let i = 1; i <= 6; i++) {
      const eq = (equippedItems as Array<{ slot: number; itemId: string }>).find((e: any) => e.slot === i);
      if (eq) {
        const def = itemDefs.get(eq.itemId);
        const isNonStack = nonStackableItemIds.has(eq.itemId);
        slots.push({
          slot: i,
          itemId: eq.itemId,
          sprite: getSpriteUrl(def),
          name: def?.name || null,
          tier: def?.tier ?? null,
          // For non-stackable items the count badge would imply "stack",
          // which contradicts the rule (each grenade / potion is its own
          // row). Show 0 here so the badge is suppressed in the render
          // path; the inventory grid shows each one as its own tile.
          quantity: isNonStack ? 0 : (quantityByItemId.get(eq.itemId) ?? 0),
          isNonStack,
        });
      } else {
        slots.push({ slot: i, itemId: null, sprite: null, name: null, tier: null, quantity: 0, isNonStack: false });
      }
    }
    return slots;
  }, [equippedItems, itemDefs, getSpriteUrl, quantityByItemId, nonStackableItemIds]);

  // Set of item IDs currently equipped in hotbar
  const equippedItemIdSet = useMemo(
    () => new Set((equippedItems as Array<{ slot: number; itemId: string }>).map(e => e.itemId)),
    [equippedItems]
  );

  // Fixed 18-slot inventory grid. Each slot holds a "grid key" — for
  // stackable items the key is the itemId (one tile per itemId, stacks
  // count via quantity badge), for non-stackable items the key is the
  // inventory row.id (each grenade / potion gets its own tile).
  const [invSlots, setInvSlots] = useState<Array<string | null>>(new Array(18).fill(null));

  // All renderable inventory entries, keyed by grid key (itemId for
  // stacks, rowId for non-stackable rows). One entry per future tile.
  const inventoryItemsMap = useMemo(() => {
    const map = new Map<string, { gridKey: string; itemId: string; sprite: string | null; name: string | null; tier: number | null; quantity: number; isNonStackRow: boolean; cooldownUntil: number | null }>();
    // Equipped slots claim items off the top of the inventory: one row
    // per equipped slot for non-stack items, or the whole item_id stack
    // for stackable items. Items "claimed" by an equipped slot don't
    // appear in the inventory grid — they appear only in QS. That makes
    // the user's mental model clean: each item lives in exactly one
    // place.
    const equippedBudget = new Map<string, number>();
    for (const eq of equippedItems) {
      if (eq.itemId) equippedBudget.set(eq.itemId, (equippedBudget.get(eq.itemId) ?? 0) + 1);
    }
    for (const inv of (inventory || [])) {
      if (inv.item_type !== 'item' || !inv.item_id || inv.quantity <= 0) continue;
      const def = itemDefs.get(inv.item_id);
      const nonStack = nonStackableItemIds.has(inv.item_id);
      if (nonStack) {
        // Skip this row if an equipped slot is claiming a row for this item.
        const budget = equippedBudget.get(inv.item_id) ?? 0;
        if (budget > 0) {
          equippedBudget.set(inv.item_id, budget - 1);
          continue;
        }
      } else {
        // Skip the whole stack if any equipped slot points at it.
        if (equippedItemIdSet.has(inv.item_id)) continue;
      }
      const gridKey = nonStack ? inv.id : inv.item_id;
      const prev = map.get(gridKey);
      const qty = nonStack ? 1 : (prev ? prev.quantity + inv.quantity : inv.quantity);
      const cd = (inv as any).cooldown_until
        ? new Date((inv as any).cooldown_until).getTime()
        : null;
      map.set(gridKey, {
        gridKey,
        itemId: inv.item_id,
        sprite: getSpriteUrl(def),
        name: def?.name || null,
        tier: def?.tier ?? null,
        quantity: qty,
        isNonStackRow: nonStack,
        cooldownUntil: cd,
      });
    }
    return map;
  }, [inventory, itemDefs, getSpriteUrl, nonStackableItemIds, equippedItems, equippedItemIdSet]);

  // Sync: place new entries into the first empty slot, remove ones
  // that no longer exist (consumed, dropped, etc.).
  useEffect(() => {
    setInvSlots(prev => {
      const next = [...prev];
      const allKeys = new Set(inventoryItemsMap.keys());
      for (let i = 0; i < 18; i++) {
        if (next[i] && !allKeys.has(next[i]!)) next[i] = null;
      }
      const placed = new Set(next.filter(Boolean) as string[]);
      for (const key of allKeys) {
        if (placed.has(key)) continue;
        // inventoryItemsMap already excludes equipped items, so any key
        // we see here genuinely needs a grid tile.
        const emptyIdx = next.indexOf(null);
        if (emptyIdx !== -1) next[emptyIdx] = key;
      }
      return next;
    });
  }, [inventoryItemsMap]);

  const inventoryGridItems = useMemo(() => {
    return invSlots.map(key => {
      if (!key) return null;
      return inventoryItemsMap.get(key) ?? null;
    });
  }, [invSlots, inventoryItemsMap]);

  // Drag source ref — stored in ref to avoid stale closures, survives re-renders.
  //
  // For inventory drags the source carries BOTH the grid key (rowId
  // for non-stackable items, itemId for stackable) and the itemId.
  // The earlier version only tracked itemId, which broke inventory→
  // inventory swaps for non-stack items: invSlots holds rowIds, so
  // prev.indexOf(itemId) returned -1 and the swap silently failed.
  // Also caused "dragging the 2nd grenade swaps the 1st grenade"
  // because indexOf returns the first match.
  type DragSource =
    | { type: 'hotbar'; slot: number }
    | { type: 'inventory'; gridKey: string; itemId: string }
    | { type: 'vault'; page: number; slot: number; itemId: string; quantity: number; fullQuantity: number };
  const dragRef = useRef<DragSource | null>(null);

  const onDragStart = useCallback((e: React.DragEvent, source: DragSource) => {
    dragRef.current = source;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', JSON.stringify(source));
    if (e.currentTarget instanceof HTMLElement) {
      e.dataTransfer.setDragImage(e.currentTarget, 28, 28);
    }
  }, []);

  // Read the drag source from dataTransfer (canonical, works for
  // cross-component drags like vault → HUD) and fall back to dragRef
  // for legacy paths.
  const readDragSource = useCallback((e: React.DragEvent): DragSource | null => {
    const raw = e.dataTransfer.getData('text/plain');
    if (raw) {
      try { return JSON.parse(raw) as DragSource; } catch { /* fall through */ }
    }
    return dragRef.current;
  }, []);

  const onDropHotbar = useCallback((e: React.DragEvent, targetSlot: number) => {
    e.preventDefault();
    e.stopPropagation();
    const src = readDragSource(e);
    dragRef.current = null;
    if (!src || !updateEquippedSlot) return;
    if (src.type === 'inventory') {
      // Inventory → Hotbar: equip the dragged item in target slot.
      // If targetSlot already had a different item equipped, that
      // item becomes unequipped (returns to its invSlots tile).
      updateEquippedSlot(targetSlot, src.itemId);
    } else if (src.type === 'hotbar' && src.slot !== targetSlot) {
      // Hotbar → Hotbar swap. Snapshot both itemIds BEFORE issuing
      // any updateEquippedSlot call — the local state setter mutates
      // the same array, so the second call would see the first call's
      // intermediate state and corrupt the swap.
      const srcId = hotbarSlots.find(s => s.slot === src.slot)?.itemId || null;
      const tgtId = hotbarSlots.find(s => s.slot === targetSlot)?.itemId || null;
      updateEquippedSlot(targetSlot, srcId);
      updateEquippedSlot(src.slot, tgtId);
    }
  }, [updateEquippedSlot, hotbarSlots, readDragSource]);

  const onDropInventory = useCallback(async (e: React.DragEvent, targetIdx: number) => {
    e.preventDefault();
    e.stopPropagation();
    const src = readDragSource(e);
    dragRef.current = null;
    if (!src) return;

    // Vault → Inventory: remove from vault, add to inventory. addItem
    // handles the stack-vs-non-stack rules. Source vault slot is
    // restored on failure.
    if (src.type === 'vault') {
      if (!vaultBridge || !addItem) return;
      const removed = await vaultBridge.removeFromSlot(src.page, src.slot, src.quantity);
      if (removed <= 0) return;
      const ok = await addItem(src.itemId, removed);
      if (!ok) {
        // Rollback into the source vault slot.
        await vaultBridge.setSlot(src.page, src.slot, src.itemId, removed);
      }
      return;
    }

    if (src.type === 'hotbar') {
      // Hotbar → Inventory. The equipped slot was previously claiming a
      // row off the inventory grid; unequipping releases that row, and
      // we place the resulting tile at the slot the user actually
      // dropped on.
      const hotbarItemId = hotbarSlots.find(s => s.slot === src.slot)?.itemId;
      const hotbarIsNonStack = hotbarItemId ? nonStackableItemIds.has(hotbarItemId) : false;
      if (!hotbarItemId) {
        if (updateEquippedSlot) updateEquippedSlot(src.slot, null);
        return;
      }

      if (hotbarIsNonStack) {
        // For non-stack: figure out which user_inventory row id will
        // appear in the grid after unequip. Pick any row for this item
        // that isn't already visible in invSlots (it's the one the
        // equipped slot was claiming).
        const visibleSet = new Set(invSlots.filter(Boolean) as string[]);
        const candidateRow = (inventory || []).find((inv: any) =>
          inv.item_type === 'item'
          && inv.item_id === hotbarItemId
          && inv.quantity > 0
          && !visibleSet.has(inv.id)
        );
        if (updateEquippedSlot) updateEquippedSlot(src.slot, null);
        if (!candidateRow) return; // shouldn't happen, but bail safely
        const rowId = (candidateRow as any).id;
        setInvSlots(prev => {
          const next = [...prev];
          const existing = next[targetIdx];
          next[targetIdx] = rowId;
          if (existing && existing !== rowId) {
            const srcSlotIdx = next.indexOf(null);
            if (srcSlotIdx !== -1) next[srcSlotIdx] = existing;
          }
          return next;
        });
        return;
      }

      // Stackable: same idea — place the item_id (its gridKey) at target.
      if (updateEquippedSlot) updateEquippedSlot(src.slot, null);
      setInvSlots(prev => {
        const next = [...prev];
        const existing = next[targetIdx];
        next[targetIdx] = hotbarItemId;
        if (existing && existing !== hotbarItemId) {
          const srcSlotIdx = next.indexOf(null);
          if (srcSlotIdx !== -1) next[srcSlotIdx] = existing;
        }
        return next;
      });
      return;
    }

    if (src.type === 'inventory') {
      // Inventory → Inventory swap. Use gridKey (rowId for non-stack
      // items, itemId for stackable) — invSlots is keyed by gridKey,
      // not itemId. Bug history: prior code used itemId and silently
      // failed for non-stack items and mis-swapped when the same
      // itemId appeared in multiple slots.
      const srcKey = src.gridKey;
      setInvSlots(prev => {
        const sourceIdx = prev.indexOf(srcKey);
        if (sourceIdx === -1 || sourceIdx === targetIdx) return prev;
        const next = [...prev];
        [next[sourceIdx], next[targetIdx]] = [next[targetIdx], next[sourceIdx]];
        return next;
      });
    }
  }, [updateEquippedSlot, hotbarSlots, nonStackableItemIds, inventory, invSlots, readDragSource, vaultBridge, addItem]);

  const allowDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  // Grid ref for computing drop target from mouse position
  const invGridRef = useRef<HTMLDivElement>(null);

  const onDropInventoryGrid = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const grid = invGridRef.current;
    if (!grid) return;
    const rect = grid.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    // Each cell is 56px with 10px gap → 66px pitch
    const col = Math.min(5, Math.max(0, Math.floor(x / 66)));
    const visualRow = Math.min(2, Math.max(0, Math.floor(y / 66)));
    // Visual top row = data row 2, visual bottom row = data row 0
    const dataRow = 2 - visualRow;
    const idx = dataRow * 6 + col;
    // Delegate to existing handler
    onDropInventory(e, idx);
  }, [onDropInventory]);

  return (
    <>
      {/* Flying coin animations */}
      {Array.isArray(flyingCoins) &&
        flyingCoins.map((coin: any) => (
          <div
            key={coin.id}
            className="fixed pointer-events-none z-50"
            style={{
              left: coin.startX,
              top: coin.startY,
              animation: 'flyToCoin 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards',
            }}
          >
            <img src={coin.imageUrl || '/waterfall_coin.png'} alt="coin" className="w-8 h-8 animate-spin" />
          </div>
        ))}

      {/* FPS Display */}
      <FPSDisplay
        isAdmin={userRoles?.includes?.('admin') || userRoles?.includes?.('superadmin')}
        userRoles={userRoles || []}
        onDeleteBlock={onDeleteBlock}
      />

      {/* D-Flow Output Panel */}
      <DFlowOutputPanel />

      {/* Bottom-left: status panel + admin gear */}
      <div
        className="fixed bottom-4 left-4 z-20"
        style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
      >
        {/* Status panel — click anywhere to open user panel */}
        <div
          onClick={() => openPanel('user')}
          style={{
            borderRadius: 'var(--hud-radius)',
            border: '1px solid hsla(var(--hud-border))',
            background: 'hsla(var(--hud-bg))',
            color: 'hsl(var(--hud-text))',
            fontFamily: 'var(--hud-font)',
            padding: '8px 12px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            cursor: 'pointer',
          }}
        >
          {/* User image */}
          {profile?.avatar_url && (
            <img
              src={profile.avatar_url}
              alt="User"
              style={{
                width: '48px',
                height: '48px',
                borderRadius: '50%',
                objectFit: 'cover',
                border: '1px solid hsla(var(--hud-border))',
                flexShrink: 0,
              }}
            />
          )}

          {/* Info columns */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {/* Row 1: Name - Level - Coins - Blocks */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px' }}>
              <span style={{ fontWeight: 600 }}>
                {profile?.display_name || 'Unknown'}
              </span>

              <span style={{ fontWeight: 600, opacity: 0.85 }}>
                LVL {profile?.current_level || 1}
              </span>

              <div
                style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
                title={displayCoin.name}
              >
                <img
                  src={displayCoin.imageUrl}
                  alt="coin"
                  style={{ width: '18px', height: '18px' }}
                />
                <span style={{ fontWeight: 700 }}>x{displayCoin.coins}</span>
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  background: blockPlacementMode ? 'hsla(var(--hud-highlight))' : 'transparent',
                  transform: 'scale(0.8)',
                  transformOrigin: 'center',
                }}
                title={(() => {
                  const totalBlocks = (inventory || [])
                    .filter((item: any) => item.quantity > 0)
                    .reduce((total: number, item: any) => total + item.quantity, 0);
                  return totalBlocks > 0
                    ? (selectedBlockType ? 'Exit block mode' : 'Enter block mode')
                    : 'Buy blocks from shop';
                })()}
              >
                <div style={{
                  width: '20px', height: '20px',
                  background: 'linear-gradient(135deg, #a8a29e, #78716c)',
                  borderRadius: '3px',
                  border: '1px solid #d6d3d1',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <div style={{
                    width: '14px', height: '14px',
                    background: 'linear-gradient(135deg, #d6d3d1, #a8a29e)',
                    borderRadius: '2px',
                    border: '1px solid #a8a29e',
                  }} />
                </div>
                <span style={{ fontWeight: 700 }}>
                  x{(inventory || [])
                    .filter((item: any) => item.quantity > 0)
                    .reduce((total: number, item: any) => total + item.quantity, 0)}
                </span>
              </div>

              {blockPlacementMode && selectedBlockType && (
                <span style={{
                  fontSize: '10px',
                  fontWeight: 600,
                  background: 'hsla(var(--hud-highlight))',
                  padding: '2px 6px',
                  borderRadius: '4px',
                }}>
                  BLOCK MODE: {selectedBlockType}
                </span>
              )}
            </div>

            {/* Row 2: Hearts - Health - Pts - Jets (20% smaller) */}
            <div style={{ transform: 'scale(0.8)', transformOrigin: 'left center' }}>
              <HealthBar
                currentHealth={currentHealth}
                maxHealth={maxHealth}
                totalPoints={profile?.total_points || 0}
                jetBoostAvailable={jetBoostAvailable}
                jetBoostMax={jetBoostMax}
                isGliding={isGliding}
                className="!bg-transparent !border-0 !p-0"
              />
            </div>

            {/* Oxygen/Bubbles display - only shows when underwater */}
            {isUnderwater && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '4px 8px',
                  borderRadius: 'var(--hud-radius)',
                  background: 'hsla(var(--hud-bg))',
                  border: '1px solid hsla(var(--hud-border))',
                  animation: isOxygenCritical ? 'pulse 0.5s ease-in-out infinite' : undefined,
                }}
              >
                <span style={{ fontSize: '16px' }}>&#x25CF;</span>
                <span style={{
                  fontSize: '14px',
                  fontWeight: 600,
                  color: isOxygenCritical ? '#ff4444' : 'inherit',
                }}>
                  {oxygenSeconds}s
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Marketplace button */}
        {openMarketplace && (
          <button
            onClick={() => openMarketplace()}
            title="Marketplace"
            style={{
              width: '36px',
              height: '36px',
              borderRadius: 'var(--hud-radius)',
              border: '1px solid hsla(var(--hud-border))',
              background: 'hsla(var(--hud-bg))',
              color: 'hsl(var(--hud-text))',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            <Store style={{ width: '18px', height: '18px' }} />
          </button>
        )}

        {/* Admin gear button — vertically centered with status panel */}
        {(userRoles?.includes?.('admin') || userRoles?.includes?.('superadmin')) && (
          <button
            onClick={() => openAdminPanel('coins')}
            title="Admin Panel"
            style={{
              width: '36px',
              height: '36px',
              borderRadius: 'var(--hud-radius)',
              border: '1px solid hsla(var(--hud-border))',
              background: 'hsla(var(--hud-bg))',
              color: 'hsl(var(--hud-text))',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            <Settings style={{ width: '18px', height: '18px' }} />
          </button>
        )}
      </div>

      {/* Instructions — match left panel height */}
      <InstructionsPanel
        blockPlacementMode={blockPlacementMode}
        selectedBlockType={selectedBlockType}
      />

      {/* Bottom-center hotbar + inventory grid + vault */}
      <div
        style={{
          position: 'fixed',
          bottom: '16px',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 20,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        {/* Vault rows — shown when vaultOpen (above Inventory) */}
        {vaultOpen && (
          <VaultPanel
            isOpen={vaultOpen}
            onClose={() => {}}
            userId={user?.id ?? null}
            inventory={inventory}
            equippedItems={equippedItems}
            addItem={addItem}
            removeInventoryRow={removeInventoryRow}
            updateEquippedSlot={updateEquippedSlot}
            preloadedDefs={itemDefs}
          />
        )}

        {/* Inventory grid — 3 rows × 6 cols, shown when inventoryOpen */}
        {inventoryOpen && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{
              fontSize: '11px',
              fontWeight: 700,
              color: 'hsl(var(--hud-text))',
              fontFamily: 'var(--hud-font)',
              letterSpacing: '0.05em',
            }}>
              INVENTORY
            </span>
            <div
              ref={invGridRef}
              onDragEnter={allowDrop}
              onDragOver={allowDrop}
              onDrop={onDropInventoryGrid}
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(6, 56px)',
                gap: '10px',
              }}
            >
              {(() => {
                const cells: React.ReactNode[] = [];
                // Render top row first (idx 12-17), then middle (6-11), then bottom (0-5)
                for (let row = 2; row >= 0; row--) {
                  for (let col = 0; col < 6; col++) {
                    const idx = row * 6 + col;
                    const item = inventoryGridItems[idx];
                    cells.push(
                      <div
                        key={`inv-${idx}`}
                        draggable={!!item}
                        onDragStart={item ? (e) => onDragStart(e, { type: 'inventory', gridKey: item.gridKey, itemId: item.itemId }) : undefined}
                        onContextMenu={item ? (e) => {
                          e.preventDefault();
                          openItemDetail({
                            itemId: item.itemId,
                            name: item.name ?? '',
                            sprite: item.sprite ?? null,
                            itemNumber: null,
                            tier: item.tier,
                            quantity: item.quantity,
                          });
                        } : undefined}
                        style={{
                          width: '56px',
                          height: '56px',
                          borderRadius: 'var(--hud-radius)',
                          border: '1px solid hsla(var(--hud-border))',
                          background: 'hsla(var(--hud-bg-dim))',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          overflow: 'hidden',
                          position: 'relative',
                          cursor: item ? 'grab' : 'default',
                        }}
                      >
                        {item && (
                          <>
                            {item.tier != null && (
                              <span style={{
                                position: 'absolute',
                                top: '2px',
                                left: '4px',
                                fontSize: '10px',
                                fontWeight: 700,
                                color: 'white',
                                fontFamily: 'var(--hud-font)',
                                lineHeight: 1,
                                textShadow: '0 0 3px rgba(0,0,0,0.8)',
                                pointerEvents: 'none',
                              }}>
                                T{item.tier}
                              </span>
                            )}
                            {item.sprite && (
                              <img
                                src={item.sprite}
                                alt={item.name || ''}
                                draggable={false}
                                style={{ width: '42px', height: '42px', objectFit: 'contain', pointerEvents: 'none' }}
                              />
                            )}
                            {item.quantity > 1 && (
                              <span style={{
                                position: 'absolute',
                                bottom: '2px',
                                right: '4px',
                                fontSize: '11px',
                                fontWeight: 700,
                                color: 'white',
                                fontFamily: 'var(--hud-font)',
                                lineHeight: 1,
                                textShadow: '0 0 3px rgba(0,0,0,0.9), 0 0 6px rgba(0,0,0,0.9)',
                                pointerEvents: 'none',
                              }}>
                                {item.quantity}x
                              </span>
                            )}
                            {(item as any).cooldownUntil && (item as any).cooldownUntil > Date.now() && (
                              <>
                                <div style={{
                                  position: 'absolute', inset: 0,
                                  background: 'rgba(0,0,0,0.6)',
                                  borderRadius: 'inherit',
                                  pointerEvents: 'none',
                                }} />
                                <span style={{
                                  position: 'absolute', inset: 0,
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  color: '#fff', fontWeight: 700, fontSize: 11,
                                  fontFamily: 'var(--hud-font)',
                                  textShadow: '0 0 3px rgba(0,0,0,0.9)',
                                  pointerEvents: 'none',
                                }}>
                                  {(() => {
                                    const ms = (item as any).cooldownUntil - Date.now();
                                    const mins = Math.ceil(ms / 60000);
                                    return mins >= 60 ? `${Math.ceil(mins/60)}h` : `${mins}m`;
                                  })()}
                                </span>
                              </>
                            )}
                          </>
                        )}
                      </div>
                    );
                  }
                }
                return cells;
              })()}
            </div>
          </div>
        )}

        {/* Hotbar — 6 quick-select item slots */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span style={{
            fontSize: '11px',
            fontWeight: 700,
            color: 'hsl(var(--hud-text))',
            fontFamily: 'var(--hud-font)',
            letterSpacing: '0.05em',
          }}>
            QUICK ACCESS
          </span>
          <div
            style={{
              display: 'flex',
              gap: '10px',
            }}
          >
            {hotbarSlots.map((slot) => {
              const isSelected = selectedSlot === slot.slot;
              const isGrenadeReady = grenadeReadySlot === slot.slot;
              const isEggReady = eggReadySlot === slot.slot;
              const isDrinking = potionDrinkingSlot === slot.slot;
              // Single-click: select the slot AND fire the activator
              // (drinks a potion, etc.) so the user doesn't need to
              // hit the digit key separately.
              const handleSlotClick = () => {
                setSelectedSlot(slot.slot);
                if (onUseHotbarSlot && slot.itemId) onUseHotbarSlot(slot.slot);
              };
              return (
                <div
                  key={slot.slot}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '3px',
                  }}
                  onClick={handleSlotClick}
                >
                  {/* Slot square */}
                  <div
                    draggable={!!slot.itemId}
                    onDragStart={slot.itemId ? (e) => onDragStart(e, { type: 'hotbar', slot: slot.slot }) : undefined}
                    onDragEnter={allowDrop}
                    onDragOver={allowDrop}
                    onDrop={(e) => onDropHotbar(e, slot.slot)}
                    onContextMenu={slot.itemId ? (e) => {
                      e.preventDefault();
                      openItemDetail({
                        itemId: slot.itemId,
                        name: slot.name ?? '',
                        sprite: slot.sprite ?? null,
                        itemNumber: null,
                        tier: slot.tier,
                        quantity: slot.quantity ?? 1,
                      });
                    } : undefined}
                    className={
                      isGrenadeReady ? 'grenade-ready-pulse'
                      : isEggReady ? 'egg-ready-pulse'
                      : isDrinking ? 'potion-drink-pulse'
                      : undefined
                    }
                    style={{
                      width: '56px',
                      height: '56px',
                      borderRadius: 'var(--hud-radius)',
                      border: isGrenadeReady
                        ? '2px solid #00ff66'
                        : isEggReady
                          ? '2px solid #000000'
                          : isDrinking
                            ? '2px solid #ff3a6a'
                            : isSelected
                              ? '2px solid white'
                              : '1px solid hsla(var(--hud-border))',
                      background: isSelected
                        ? 'hsla(var(--hud-bg))'
                        : 'hsla(var(--hud-bg-dim))',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      overflow: 'hidden',
                      transition: 'border 0.15s, background 0.15s',
                      position: 'relative',
                      cursor: slot.itemId ? 'grab' : 'pointer',
                    }}
                    title={slot.name || `Slot ${slot.slot}`}
                  >
                    {slot.tier != null && (
                      <span style={{
                        position: 'absolute',
                        top: '2px',
                        left: '4px',
                        // Match the bottom-right qty badge style: white
                        // text + heavy black text-shadow, no background
                        // pill, same hud-font. Slightly smaller than
                        // qty (9px vs 11px) per user request.
                        fontSize: '9px',
                        fontWeight: 700,
                        color: 'white',
                        fontFamily: 'var(--hud-font)',
                        lineHeight: 1,
                        textShadow: '0 0 3px rgba(0,0,0,0.9), 0 0 6px rgba(0,0,0,0.9)',
                        pointerEvents: 'none',
                        zIndex: 2,
                      }}>
                        T{slot.tier}
                      </span>
                    )}
                    {slot.sprite ? (
                      <img
                        src={slot.sprite}
                        alt={slot.name || ''}
                        draggable={false}
                        style={{ width: '42px', height: '42px', objectFit: 'contain', pointerEvents: 'none' }}
                      />
                    ) : null}
                    {/* Stack-count badge (bottom-right) — only shown when
                        more than one of this item is held. Format: "2x". */}
                    {slot.quantity > 1 && (
                      <span style={{
                        position: 'absolute',
                        bottom: '2px',
                        right: '4px',
                        fontSize: '11px',
                        fontWeight: 700,
                        color: 'white',
                        fontFamily: 'var(--hud-font)',
                        lineHeight: 1,
                        textShadow: '0 0 3px rgba(0,0,0,0.9), 0 0 6px rgba(0,0,0,0.9)',
                        pointerEvents: 'none',
                      }}>
                        {slot.quantity}x
                      </span>
                    )}
                  </div>
                  {/* Slot number — below square, 20% smaller */}
                  <span style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    color: isSelected ? 'hsl(var(--hud-text-bright))' : 'hsl(var(--hud-text))',
                    fontFamily: 'var(--hud-font)',
                    pointerEvents: 'none',
                  }}>
                    {slot.slot}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
