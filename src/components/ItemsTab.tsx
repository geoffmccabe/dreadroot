import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAuth } from '@/contexts/AuthContext';
import { getItemSpriteUrl } from '@/lib/itemSprite';
import { ItemTileVisual } from '@/features/inventory-system';

interface ItemDef {
  id: string;
  name: string;
  item_number: number | null;
  tier: number;
  texture_url: string | null;
  item_category: string;
}

// One aggregated stack to display: a specific item (id → its own tier) and how
// many of it the player holds in a given region.
interface DisplayStack {
  itemId: string;
  quantity: number;
  def: ItemDef;
}

function getSpriteUrl(def: ItemDef): string | null {
  return getItemSpriteUrl(def);
}

// ─── Read-only item grid (no drag/drop — this tab is just a summary) ──────────

function ItemsGrid({ items }: { items: DisplayStack[] }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
        gap: '6px',
        width: '100%',
      }}
    >
      {items.map((item) => (
        <div
          key={item.itemId}
          style={{
            background: 'hsla(var(--hud-bg-dim))',
            border: '1px solid hsla(var(--hud-border))',
            borderRadius: 'var(--hud-radius)',
            padding: '6px',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '2px',
            minWidth: 0,
            overflow: 'hidden',
          }}
        >
          <div style={{
            position: 'relative',
            width: '100%',
            maxWidth: '64px',
            aspectRatio: '1',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <ItemTileVisual
              occupant={{
                spriteUrl: getSpriteUrl(item.def),
                name: item.def.name,
                tier: item.def.tier > 0 ? item.def.tier : null,
                quantity: item.quantity,
              }}
              spriteSize={56}
            />
          </div>
          <span style={{
            fontSize: '10px', fontWeight: 500, lineHeight: '1.2',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%',
          }}>
            {item.def.name}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── One titled storage section (Equipped / QS / Inventory / Vault) ───────────

function Section({ label, items }: { label: string; items: DisplayStack[] }) {
  const total = items.reduce((s, i) => s + i.quantity, 0);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="text-sm font-bold" style={{ color: '#ffffff' }}>{label}</div>
        <div className="text-xs" style={{ color: 'hsl(var(--hud-text-dim))' }}>{total}</div>
      </div>
      {items.length === 0 ? (
        <p className="text-xs" style={{ color: 'hsl(var(--hud-text-dim))' }}>Empty.</p>
      ) : (
        <ItemsGrid items={items} />
      )}
    </div>
  );
}

// Region order + labels for the Items overview.
const REGIONS: { key: string; label: string }[] = [
  { key: 'equip', label: 'Equipped' },
  { key: 'quick_select', label: 'Quick Select' },
  { key: 'inventory', label: 'Inventory' },
  { key: 'vault', label: 'Vault' },
];

// Aggregate raw user_slots rows for one region into per-item stacks (one tile
// per item id, so different tiers stay separate — each tier is its own item id).
function aggregate(rows: any[], defs: Map<string, ItemDef>): DisplayStack[] {
  const m = new Map<string, DisplayStack>();
  for (const r of rows) {
    if (!r.item_id) continue;
    const def = defs.get(r.item_id);
    if (!def) continue;
    const qty = r.quantity ?? 1;
    const e = m.get(r.item_id);
    if (e) e.quantity += qty;
    else m.set(r.item_id, { itemId: r.item_id, quantity: qty, def });
  }
  return Array.from(m.values()).sort(
    (a, b) => (a.def.item_number ?? 999) - (b.def.item_number ?? 999) || a.def.tier - b.def.tier
  );
}

export function ItemsTab({ height = 500 }: { height?: number }) {
  const { user } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [defs, setDefs] = useState<Map<string, ItemDef>>(new Map());
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user?.id) { setRows([]); setDefs(new Map()); setIsLoading(false); return; }
    setIsLoading(true);
    // All items across every region live in user_slots (equip / quick_select /
    // inventory / vault). One round-trip gets the whole picture.
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

  // Per-region aggregated stacks.
  const byRegion = new Map<string, DisplayStack[]>();
  for (const { key } of REGIONS) {
    byRegion.set(key, aggregate(rows.filter((r) => r.region === key), defs));
  }

  // Forge candidates: total held (across ALL regions) of each item. Regular
  // items forge 4→1 next tier; Shpider Eggs forge 2→1. Display only.
  const totals = aggregate(rows, defs);
  const forgeable = totals.filter((s) =>
    s.def.name === 'Shpider Egg' ? s.quantity >= 2 : s.quantity >= 4
  );

  if (isLoading) {
    return <p className="text-xs p-4" style={{ color: 'hsl(var(--hud-text-dim))' }}>Loading items...</p>;
  }

  return (
    <Tabs defaultValue="items" className="w-full">
      <TabsList className="grid w-full grid-cols-2 mb-3">
        <TabsTrigger value="items">Items</TabsTrigger>
        <TabsTrigger value="forge">Forge</TabsTrigger>
      </TabsList>

      {/* Items — every storage region stacked vertically, read-only */}
      <TabsContent value="items" className="mt-0">
        <ScrollArea style={{ height: `${height - 56}px` }}>
          <div className="pr-4 space-y-4">
            {REGIONS.map(({ key, label }) => (
              <Section key={key} label={label} items={byRegion.get(key) ?? []} />
            ))}
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
                <ItemsGrid items={forgeable} />
              </div>
            )}
          </div>
        </ScrollArea>
      </TabsContent>
    </Tabs>
  );
}
