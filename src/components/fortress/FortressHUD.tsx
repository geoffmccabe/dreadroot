import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';

import { Settings } from 'lucide-react';
import { FPSDisplay, DFlowOutputPanel } from '@/components/FPSCounter';
import { HealthBar } from '@/features/shwarm';
import { supabase } from '@/integrations/supabase/client';

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
        B = Block mode • L = Line • O = Open Shop • I = Inventory
      </div>
    </div>
  );
}

// Intentionally loose typing: this file is an extraction of HUD JSX
// from a large component, and we want minimal friction during refactor.
type FortressHUDProps = any;

export function FortressHUD(props: FortressHUDProps) {
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
    jetBoostAvailable = 0,
    jetBoostMax = 0,
    isGliding = false,
    equippedItems = [],
    updateEquippedSlot,
    inventoryOpen = false,
    setInventoryOpen,
    selectedSlot: selectedSlotProp = 1,
    onSelectSlot,
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

  const [itemDefs, setItemDefs] = useState<Map<string, { name: string; item_number: number | null; texture_url: string | null; tier: number | null }>>(new Map());

  const loadItemDefs = useCallback(async () => {
    if (allItemIds.length === 0) { setItemDefs(new Map()); return; }
    const { data } = await supabase
      .from('items')
      .select('id, name, item_number, texture_url, tier')
      .in('id', allItemIds);
    const map = new Map<string, { name: string; item_number: number | null; texture_url: string | null; tier: number | null }>();
    for (const d of data || []) map.set(d.id, d);
    setItemDefs(map);
  }, [allItemIds]);

  useEffect(() => { loadItemDefs(); }, [loadItemDefs]);

  // Helper: get sprite URL from item def
  const getSpriteUrl = useCallback((def: { texture_url: string | null; item_number: number | null } | undefined): string | null => {
    if (!def) return null;
    if (def.texture_url) return def.texture_url;
    if (def.item_number != null && def.item_number >= 0 && def.item_number <= 228) return `/item-sprites/${def.item_number}.webp`;
    return null;
  }, []);

  // Build hotbar slots 1-6
  const hotbarSlots = useMemo(() => {
    const slots: Array<{ slot: number; itemId: string | null; sprite: string | null; name: string | null; tier: number | null }> = [];
    for (let i = 1; i <= 6; i++) {
      const eq = (equippedItems as Array<{ slot: number; itemId: string }>).find((e: any) => e.slot === i);
      if (eq) {
        const def = itemDefs.get(eq.itemId);
        slots.push({ slot: i, itemId: eq.itemId, sprite: getSpriteUrl(def), name: def?.name || null, tier: def?.tier ?? null });
      } else {
        slots.push({ slot: i, itemId: null, sprite: null, name: null, tier: null });
      }
    }
    return slots;
  }, [equippedItems, itemDefs, getSpriteUrl]);

  // Set of item IDs currently equipped in hotbar
  const equippedItemIdSet = useMemo(
    () => new Set((equippedItems as Array<{ slot: number; itemId: string }>).map(e => e.itemId)),
    [equippedItems]
  );

  // Fixed 18-slot inventory grid — each slot holds an itemId or null
  // Items stay in their positions; equipping removes from slot but doesn't shift others
  const [invSlots, setInvSlots] = useState<Array<string | null>>(new Array(18).fill(null));

  // All inventory items with defs (regardless of equipped status, for lookups)
  const inventoryItemsMap = useMemo(() => {
    const map = new Map<string, { itemId: string; sprite: string | null; name: string | null; tier: number | null; quantity: number }>();
    for (const inv of (inventory || [])) {
      if (inv.item_type === 'item' && inv.item_id && inv.quantity > 0) {
        const def = itemDefs.get(inv.item_id);
        map.set(inv.item_id, {
          itemId: inv.item_id,
          sprite: getSpriteUrl(def),
          name: def?.name || null,
          tier: def?.tier ?? null,
          quantity: inv.quantity,
        });
      }
    }
    return map;
  }, [inventory, itemDefs, getSpriteUrl]);

  // Sync: place new inventory items into first empty slot, remove deleted items
  useEffect(() => {
    setInvSlots(prev => {
      const next = [...prev];
      const allInvIds = new Set(inventoryItemsMap.keys());
      // Remove items that no longer exist in inventory
      for (let i = 0; i < 18; i++) {
        if (next[i] && !allInvIds.has(next[i]!)) next[i] = null;
      }
      // Items currently placed in the grid
      const placedIds = new Set(next.filter(Boolean) as string[]);
      // Items currently equipped in hotbar don't need a grid slot
      // but keep them placed if they're already in a slot (they just won't render)
      // Find new items not yet placed anywhere
      for (const id of allInvIds) {
        if (!placedIds.has(id) && !equippedItemIdSet.has(id)) {
          const emptyIdx = next.indexOf(null);
          if (emptyIdx !== -1) next[emptyIdx] = id;
        }
      }
      return next;
    });
  }, [inventoryItemsMap, equippedItemIdSet]);

  // Build renderable grid: only show items that are NOT currently equipped
  const inventoryGridItems = useMemo(() => {
    return invSlots.map(id => {
      if (!id || equippedItemIdSet.has(id)) return null;
      return inventoryItemsMap.get(id) || null;
    });
  }, [invSlots, inventoryItemsMap, equippedItemIdSet]);

  // Drag source ref — stored in ref to avoid stale closures, survives re-renders
  const dragRef = useRef<{ type: 'hotbar'; slot: number } | { type: 'inventory'; itemId: string } | null>(null);

  const onDragStart = useCallback((e: React.DragEvent, source: { type: 'hotbar'; slot: number } | { type: 'inventory'; itemId: string }) => {
    dragRef.current = source;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', JSON.stringify(source));
    // Make the drag image just the target element
    if (e.currentTarget instanceof HTMLElement) {
      e.dataTransfer.setDragImage(e.currentTarget, 28, 28);
    }
  }, []);

  const onDropHotbar = useCallback((e: React.DragEvent, targetSlot: number) => {
    e.preventDefault();
    e.stopPropagation();
    const src = dragRef.current;
    dragRef.current = null;
    if (!src || !updateEquippedSlot) return;
    if (src.type === 'inventory') {
      updateEquippedSlot(targetSlot, src.itemId);
    } else if (src.type === 'hotbar' && src.slot !== targetSlot) {
      const srcData = hotbarSlots.find(s => s.slot === src.slot);
      const tgtData = hotbarSlots.find(s => s.slot === targetSlot);
      updateEquippedSlot(targetSlot, srcData?.itemId || null);
      updateEquippedSlot(src.slot, tgtData?.itemId || null);
    }
  }, [updateEquippedSlot, hotbarSlots]);

  const onDropInventory = useCallback((e: React.DragEvent, targetIdx: number) => {
    e.preventDefault();
    e.stopPropagation();
    const src = dragRef.current;
    dragRef.current = null;
    if (!src) return;
    if (src.type === 'hotbar') {
      // Hotbar → Inventory: unequip and place in target slot
      const hotbarItemId = hotbarSlots.find(s => s.slot === src.slot)?.itemId;
      if (updateEquippedSlot) updateEquippedSlot(src.slot, null);
      if (hotbarItemId) {
        setInvSlots(prev => {
          const next = [...prev];
          // Place in the target slot (swap if occupied)
          const existing = next[targetIdx];
          next[targetIdx] = hotbarItemId;
          // If target had an unequipped item, find it a home
          if (existing && existing !== hotbarItemId) {
            const srcSlotIdx = next.indexOf(null);
            if (srcSlotIdx !== -1) next[srcSlotIdx] = existing;
          }
          return next;
        });
      }
    } else if (src.type === 'inventory') {
      // Inventory → Inventory: swap the two slots
      const srcItemId = src.itemId;
      setInvSlots(prev => {
        const sourceIdx = prev.indexOf(srcItemId);
        if (sourceIdx === -1 || sourceIdx === targetIdx) return prev;
        const next = [...prev];
        [next[sourceIdx], next[targetIdx]] = [next[targetIdx], next[sourceIdx]];
        return next;
      });
    }
  }, [updateEquippedSlot, hotbarSlots]);

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
      <FPSDisplay isAdmin={userRoles?.includes?.('admin') || userRoles?.includes?.('superadmin')} />

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
          </div>
        </div>

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

      {/* Bottom-center hotbar + inventory grid */}
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
                        onDragStart={item ? (e) => onDragStart(e, { type: 'inventory', itemId: item.itemId }) : undefined}
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
                                {item.tier}
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
              return (
                <div
                  key={slot.slot}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '3px',
                  }}
                  onClick={() => setSelectedSlot(slot.slot)}
                >
                  {/* Slot square */}
                  <div
                    draggable={!!slot.itemId}
                    onDragStart={slot.itemId ? (e) => onDragStart(e, { type: 'hotbar', slot: slot.slot }) : undefined}
                    onDragEnter={allowDrop}
                    onDragOver={allowDrop}
                    onDrop={(e) => onDropHotbar(e, slot.slot)}
                    style={{
                      width: '56px',
                      height: '56px',
                      borderRadius: 'var(--hud-radius)',
                      border: isSelected
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
                        fontSize: '10px',
                        fontWeight: 700,
                        color: 'white',
                        fontFamily: 'var(--hud-font)',
                        lineHeight: 1,
                        textShadow: '0 0 3px rgba(0,0,0,0.8)',
                        pointerEvents: 'none',
                      }}>
                        {slot.tier}
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
