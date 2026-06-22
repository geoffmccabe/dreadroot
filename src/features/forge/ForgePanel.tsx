// ForgePanel — a self-contained, reusable Forge popup. Shows every item the
// player holds 4+ of (across Inventory + Quick Select); each gets a Forge button
// that combines 4 of tier N into 1 of tier N+1, with the forge sound + a short
// hammer animation. Drop it in anywhere (here: the SWW lobby forge zone).
//
// The actual mutation runs server-side via worldStore.forgeSlots (atomic, on the
// unified user_slots table). The old in-panel forge broke because its RPCs still
// targeted the legacy user_inventory table; this path is user_slots-correct.
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { worldStore } from '@/services/worldStore';
import { GamePanel } from '@/components/ui/GamePanel';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { getItemSpriteUrl } from '@/lib/itemSprite';
import { ItemTileVisual } from '@/features/inventory-system';
import { getSoundUrl } from '@/hooks/useGameSounds';
import { toast } from 'sonner';

const FORGE_COST = 4;            // 4 of tier N → 1 of tier N+1
const ANIM_MS = 2400;           // total forge animation length
const HAMMER_STEPS = 4;

interface ItemDef {
  id: string; name: string; tier: number;
  texture_url: string | null; item_category: string;
}
interface ForgeGroup { def: ItemDef; rowIds: string[]; }

function spriteOf(def: ItemDef): string | null {
  return getItemSpriteUrl(def as any);
}

// Resolve the next-tier item id (same name, tier+1). Auto-create it if missing
// so forging never dead-ends on an un-seeded tier (matches the prior behavior).
async function resolveNextTier(def: ItemDef): Promise<string | null> {
  const nextTier = def.tier + 1;
  const { data: found } = await supabase
    .from('items').select('id').eq('name', def.name).eq('tier', nextTier).limit(1);
  if (found && found.length > 0) return found[0].id;

  const { data: cur } = await supabase
    .from('items').select('key, name, item_number, item_category, rarity, class, texture_url, description')
    .eq('id', def.id).single();
  if (!cur) return null;
  const baseKey = (cur.key as string).replace(/_t\d+$/, '');
  const newKey = `${baseKey}_t${nextTier}`;
  const { data: byKey } = await supabase.from('items').select('id, tier').eq('key', newKey).maybeSingle();
  if (byKey) return byKey.tier === nextTier ? byKey.id : null;
  const { data: created } = await supabase
    .from('items')
    .insert({
      key: newKey, name: cur.name, item_number: null, item_category: cur.item_category,
      rarity: cur.rarity, tier: nextTier, cost: 0, class: cur.class,
      texture_url: cur.texture_url, description: cur.description,
    })
    .select('id').single();
  return created?.id ?? null;
}

export function ForgePanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useAuth();
  const [groups, setGroups] = useState<ForgeGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [forgingId, setForgingId] = useState<string | null>(null);
  const busyRef = useRef(false);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const load = useCallback(async () => {
    if (!user?.id) { setGroups([]); setIsLoading(false); return; }
    setIsLoading(true);
    const { data: rows } = await supabase
      .from('user_slots' as any)
      .select('id, item_id, region')
      .eq('user_id', user.id)
      .in('region', ['inventory', 'quick_select']);
    const list = (rows as any[]) ?? [];
    const ids = Array.from(new Set(list.map((r) => r.item_id).filter(Boolean)));
    const defs = new Map<string, ItemDef>();
    if (ids.length > 0) {
      const { data } = await supabase
        .from('items').select('id, name, tier, texture_url, item_category').in('id', ids);
      for (const d of data || []) defs.set(d.id, d as ItemDef);
    }
    const byItem = new Map<string, ForgeGroup>();
    for (const r of list) {
      const def = defs.get(r.item_id);
      if (!def) continue;
      const g = byItem.get(r.item_id);
      if (g) g.rowIds.push(r.id);
      else byItem.set(r.item_id, { def, rowIds: [r.id] });
    }
    const forgeable = Array.from(byItem.values())
      .filter((g) => g.rowIds.length >= FORGE_COST)
      .sort((a, b) => a.def.name.localeCompare(b.def.name) || a.def.tier - b.def.tier);
    setGroups(forgeable);
    setIsLoading(false);
  }, [user?.id]);

  useEffect(() => { if (open) load(); }, [open, load]);
  useEffect(() => () => { timersRef.current.forEach(clearTimeout); }, []);

  const handleForge = async (g: ForgeGroup) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setForgingId(g.def.id);

    // Sound: background loop-ish noise + spaced hammer hits.
    const bg = new Audio(getSoundUrl('forge_background', '/forge_bkgd_noise.mp3'));
    bg.volume = 0.4;
    bg.play().catch(() => {});
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let i = 0; i < HAMMER_STEPS; i++) {
      timers.push(setTimeout(() => {
        const h = new Audio(getSoundUrl('forge_hammer', '/forge_hammer.mp3'));
        h.volume = 0.5;
        h.play().catch(() => {});
      }, Math.round((i + 1) * (ANIM_MS / (HAMMER_STEPS + 1)))));
    }
    timersRef.current = timers;

    const start = Date.now();
    let ok = false;
    try {
      const nextId = await resolveNextTier(g.def);
      if (!nextId) throw new Error('Could not resolve next tier');
      await worldStore.forgeSlots(g.rowIds.slice(0, FORGE_COST), nextId);
      ok = true;
    } catch (err: any) {
      toast.error(`Forge failed: ${err?.message ?? String(err)}`);
    }

    const finish = () => {
      bg.pause();
      busyRef.current = false;
      setForgingId(null);
      if (ok) load();
    };
    if (!ok) { timers.forEach(clearTimeout); finish(); return; }
    timersRef.current.push(setTimeout(finish, Math.max(0, ANIM_MS - (Date.now() - start))));
  };

  if (!open) return null;

  return (
    <GamePanel open={open} onClose={onClose} title="Forge" defaultWidth={420} defaultHeight={520}>
      <p className="text-xs mb-3" style={{ color: 'hsl(var(--hud-text-dim))' }}>
        Combine {FORGE_COST} of an item (from Inventory or Quick Select) into 1 of the next tier.
      </p>
      {isLoading ? (
        <p className="text-xs" style={{ color: 'hsl(var(--hud-text-dim))' }}>Loading…</p>
      ) : groups.length === 0 ? (
        <p className="text-xs" style={{ color: 'hsl(var(--hud-text-dim))' }}>
          Nothing to forge yet — hold {FORGE_COST} of the same item.
        </p>
      ) : (
        <div className="space-y-2">
          {groups.map((g) => {
            const animating = forgingId === g.def.id;
            return (
              <div
                key={g.def.id}
                className="flex items-center gap-3 p-2 rounded-md"
                style={{
                  background: 'hsla(var(--hud-bg-dim))',
                  border: '1px solid hsla(var(--hud-border))',
                  opacity: forgingId && !animating ? 0.5 : 1,
                  transition: 'opacity 0.2s',
                }}
              >
                <div
                  style={{
                    position: 'relative', width: 48, height: 48, flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    filter: animating ? 'brightness(1.6)' : 'none',
                    animation: animating ? 'forgePulse 0.6s ease-in-out infinite' : 'none',
                  }}
                >
                  <ItemTileVisual
                    occupant={{ spriteUrl: spriteOf(g.def), name: g.def.name, tier: g.def.tier > 0 ? g.def.tier : null, quantity: g.rowIds.length }}
                    spriteSize={40}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate" style={{ color: 'hsl(var(--hud-text-bright))' }}>
                    {g.def.name}
                  </div>
                  <div className="text-xs" style={{ color: 'hsl(var(--hud-text-dim))' }}>
                    T{g.def.tier} → T{g.def.tier + 1} · have {g.rowIds.length}
                  </div>
                </div>
                <Button size="sm" disabled={!!forgingId} onClick={() => handleForge(g)}>
                  {animating ? 'Forging…' : 'Forge'}
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </GamePanel>
  );
}
