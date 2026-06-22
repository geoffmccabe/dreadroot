import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAuth } from '@/contexts/AuthContext';
import { getItemSpriteUrl } from '@/lib/itemSprite';
import { ItemTileVisual, useGridCapacity, vaultPageSlotToFlat } from '@/features/inventory-system';
import { equipColToSlot } from '@/features/inventory-system/gridModel';

interface ItemDef {
  id: string;
  name: string;
  item_number: number | null;
  tier: number;
  texture_url: string | null;
  item_category: string;
}

// One occupied slot to display: an item (its id carries its own tier) + how many.
interface DisplayStack {
  itemId: string;
  quantity: number;
  def: ItemDef;
}

function getSpriteUrl(def: ItemDef): string | null {
  return getItemSpriteUrl(def);
}

// ─── One slot square. Always a SQUARE (aspect-ratio 1) so it never stretches into
//     a rectangle when the panel is resized; empty slots render as bordered cells.

function SlotSquare({ stack }: { stack: DisplayStack | null }) {
  return (
    <div
      title={stack?.def.name}
      style={{
        aspectRatio: '1 / 1',
        width: '100%',
        background: 'hsla(var(--hud-bg-dim))',
        border: '1px solid hsla(var(--hud-border))',
        borderRadius: 'var(--hud-radius)',
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {stack && (
        <ItemTileVisual
          occupant={{
            spriteUrl: getSpriteUrl(stack.def),
            name: stack.def.name,
            tier: stack.def.tier > 0 ? stack.def.tier : null,
            quantity: stack.quantity,
          }}
          spriteSize={44}
        />
      )}
    </div>
  );
}

// Fixed 6-wide grid of square cells. minmax(0,1fr) lets the columns shrink; the
// per-cell aspect-ratio keeps every cell a perfect square at any panel width.
function SlotGridView({ cells }: { cells: (DisplayStack | null)[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: '6px', width: '100%' }}>
      {cells.map((c, i) => <SlotSquare key={i} stack={c} />)}
    </div>
  );
}

function Section({ label, cells }: { label: string; cells: (DisplayStack | null)[] }) {
  const total = cells.reduce((s, c) => s + (c?.quantity ?? 0), 0);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="text-sm font-bold" style={{ color: '#ffffff' }}>{label}</div>
        <div className="text-xs" style={{ color: 'hsl(var(--hud-text-dim))' }}>{total}</div>
      </div>
      <SlotGridView cells={cells} />
    </div>
  );
}

export function ItemsTab({ height = 500 }: { height?: number }) {
  const { user } = useAuth();
  const cap = useGridCapacity(user?.id);
  const [rows, setRows] = useState<any[]>([]);
  const [defs, setDefs] = useState<Map<string, ItemDef>>(new Map());
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user?.id) { setRows([]); setDefs(new Map()); setIsLoading(false); return; }
    setIsLoading(true);
    // Every region's items live in user_slots (equip / quick_select / inventory / vault).
    const { data: slotRows } = await supabase
      .from('user_slots' as any)
      .select('region, item_id, quantity, slot, page')
      .eq('user_id', user.id);

    const list = (slotRows as any[]) ?? [];
    const ids = Array.from(new Set(list.map((r) => r.item_id).filter(Boolean)));
    const map = new Map<string, ItemDef>();
    if (ids.length > 0) {
      const { data } = await supabase
        .from('items')
        .select('id, name, item_number, tier, texture_url, item_category')
        .in('id', ids);
      for (const d of data || []) map.set(d.id, d as ItemDef);
    }
    setRows(list);
    setDefs(map);
    setIsLoading(false);
  }, [user?.id]);

  useEffect(() => { load(); }, [load]);

  // Place a region's rows into a fixed-size array of cells, by slot, so EVERY slot
  // (filled or empty) is shown — not just the occupied ones.
  const buildCells = (region: string, capacity: number, indexOf: (r: any) => number): (DisplayStack | null)[] => {
    const cells: (DisplayStack | null)[] = new Array(Math.max(0, capacity)).fill(null);
    for (const r of rows) {
      if (r.region !== region || !r.item_id) continue;
      const def = defs.get(r.item_id);
      if (!def) continue;
      const idx = indexOf(r);
      if (idx < 0 || idx >= cells.length) continue;
      const cur = cells[idx];
      if (cur) cur.quantity += r.quantity ?? 1;
      else cells[idx] = { itemId: r.item_id, quantity: r.quantity ?? 1, def };
    }
    return cells;
  };

  // equip cols → db slot is a fixed permutation; invert it to find each item's column.
  const equipSlotToCol = (slot: number) => {
    for (let col = 1; col <= cap.equipSlots; col++) if (equipColToSlot(col) === slot) return col - 1;
    return -1;
  };

  const equipCells = buildCells('equip', cap.equipSlots, (r) => equipSlotToCol(r.slot));
  const qsCells = buildCells('quick_select', cap.qaCols, (r) => (r.slot ?? 0) - 1);
  const invCells = buildCells('inventory', cap.invCols * cap.invRows, (r) => r.slot ?? -1);
  const vaultCells = buildCells('vault', cap.vaultSlots, (r) => vaultPageSlotToFlat(r.page ?? 0, r.slot ?? 0, cap.vaultPageSize));

  // Forge candidates: total held across ALL regions of each item (display only).
  const totals = new Map<string, DisplayStack>();
  for (const r of rows) {
    if (!r.item_id) continue;
    const def = defs.get(r.item_id);
    if (!def) continue;
    const e = totals.get(r.item_id);
    if (e) e.quantity += r.quantity ?? 1;
    else totals.set(r.item_id, { itemId: r.item_id, quantity: r.quantity ?? 1, def });
  }
  const forgeable = Array.from(totals.values())
    .filter((s) => (s.def.name === 'Shpider Egg' ? s.quantity >= 2 : s.quantity >= 4))
    .sort((a, b) => (a.def.item_number ?? 999) - (b.def.item_number ?? 999) || a.def.tier - b.def.tier);

  if (isLoading) {
    return <p className="text-xs p-4" style={{ color: 'hsl(var(--hud-text-dim))' }}>Loading items...</p>;
  }

  return (
    <Tabs defaultValue="items" className="w-full">
      <TabsList className="grid w-full grid-cols-2 mb-3">
        <TabsTrigger value="items">Items</TabsTrigger>
        <TabsTrigger value="forge">Forge</TabsTrigger>
      </TabsList>

      {/* Items — every region's full slot grid, stacked vertically, read-only */}
      <TabsContent value="items" className="mt-0">
        <ScrollArea style={{ height: `${height - 56}px` }}>
          <div className="pr-4 space-y-4">
            <Section label="Equipped" cells={equipCells} />
            <Section label="Quick Select" cells={qsCells} />
            <Section label="Inventory" cells={invCells} />
            <Section label="Vault" cells={vaultCells} />
          </div>
        </ScrollArea>
      </TabsContent>

      {/* Forge — display only (forging happens at a Forge Point in the world) */}
      <TabsContent value="forge" className="mt-0">
        <ScrollArea style={{ height: `${height - 56}px` }}>
          <div className="pr-4 space-y-3">
            <Card className="p-3 text-center" style={{ background: 'hsla(var(--hud-bg-dim))' }}>
              <p className="text-sm font-semibold" style={{ color: 'hsl(var(--hud-text-bright))' }}>
                Find a Forge Point to Forge
              </p>
            </Card>
            {forgeable.length === 0 ? (
              <p className="text-xs" style={{ color: 'hsl(var(--hud-text-dim))' }}>
                Nothing to forge yet — collect 4 of an item (or 2 Shpider Eggs of the same tier).
              </p>
            ) : (
              <div className="space-y-1.5">
                <div className="text-sm font-bold" style={{ color: '#ffffff' }}>Forgeable</div>
                <SlotGridView cells={forgeable} />
              </div>
            )}
          </div>
        </ScrollArea>
      </TabsContent>
    </Tabs>
  );
}
