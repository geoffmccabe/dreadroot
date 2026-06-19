import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { getItemSpriteUrl } from '@/lib/itemSprite';
import { setActiveWeapon } from '@/config/activeWeapon';
import { cursorStackApi, useCursorStack, type CursorOrigin } from '@/features/inventory-system/useCursorStack';
import { equipTransfer } from '@/services/worldStore';
import { playSound } from '@/lib/spatialAudio';
import { getSoundUrl } from '@/hooks/useGameSounds';
import { useToast } from '@/hooks/use-toast';

// The four equip slots are a REAL region ('equip') in the unified user_slots system,
// so equipping MOVES the item out of inventory/QS (it can't be in two places). Drag an
// item onto a slot to equip it; click a filled slot to unequip (back to inventory).

const HUD_DIM = 'hsl(var(--hud-text-dim))';
const T1_BOOTS = '/rocket_boots_t1_256px.webp';
const EQUIP_FALLBACK = '/wooden_thud_sound.mp3';   // soft "place" sound for non-weapons / no reload clip

// equip slot number ↔ gear type (and accepted item_category per slot).
interface SlotDef { num: number; type: string; label: string; glyph: string; cats: string[]; }
const SLOTS: SlotDef[] = [
  { num: 1, type: 'weapon', label: 'Weapon', glyph: '🔫', cats: ['weapon'] },
  { num: 2, type: 'armor', label: 'Armor', glyph: '🛡️', cats: ['armor'] },
  { num: 3, type: 'boots', label: 'Boots', glyph: '🥾', cats: ['boots'] },
  { num: 4, type: 'potion', label: 'Potion', glyph: '🧪', cats: ['consumable', 'potion'] },
];

interface EquipItem { itemId: string; name: string; itemNumber: number | null; tier: number | null; category: string; spriteUrl: string | null; }
type EquipMap = Record<number, EquipItem | null>;
const EMPTY: EquipMap = { 1: null, 2: null, 3: null, 4: null };

// Loosely-typed client for user_slots (not in generated types in this shape).
const sb = supabase as unknown as {
  from: (t: string) => {
    select: (c: string) => {
      eq: (k: string, v: string) => { eq: (k2: string, v2: string) => Promise<{ data: Array<{ slot: number; item_id: string }> | null }> };
    };
  };
};

// Resolve a drop: whether the item fits the slot, its display def (for an instant optimistic tile),
// and the weapon's reload-sound key (so equipping a weapon plays its reload clip). item_category is a
// BROAD field (block/item/seed/…) that most weapons don't tag 'weapon', so the weapon slot ALSO
// accepts anything the game treats as a weapon: a weapon_stats row (same source the active-weapon
// system uses) or the flame glove by key. One items query + (weapon only) one weapon_stats query.
async function resolveDrop(def: SlotDef, itemId: string): Promise<{ ok: boolean; item: EquipItem | null; reloadKey: string | null }> {
  const { data: it } = await (supabase as unknown as {
    from: (t: string) => { select: (c: string) => { eq: (k: string, v: string) => { maybeSingle: () => Promise<{ data: { item_category: string | null; item_number: number | null; key: string | null; name: string; tier: number | null; texture_url: string | null } | null }> } } };
  }).from('items').select('item_category,item_number,key,name,tier,texture_url').eq('id', itemId).maybeSingle();
  if (!it) return { ok: false, item: null, reloadKey: null };
  const item: EquipItem = {
    itemId, name: it.name, itemNumber: it.item_number, tier: it.tier, category: it.item_category ?? '',
    spriteUrl: getItemSpriteUrl({ item_number: it.item_number, texture_url: it.texture_url } as { item_number: number | null; texture_url: string | null }),
  };
  if (it.item_category && def.cats.includes(it.item_category)) return { ok: true, item, reloadKey: null };
  if (def.type === 'weapon') {
    const isGlove = it.key === 'flame_glove' || (it.key ?? '').includes('glove');
    if (it.item_number != null) {
      const { data: ws } = await (supabase as unknown as {
        from: (t: string) => { select: (c: string) => { eq: (k: string, v: number) => { maybeSingle: () => Promise<{ data: { item_number: number; reload_sound: string | null } | null }> } } };
      }).from('weapon_stats').select('item_number,reload_sound').eq('item_number', it.item_number).maybeSingle();
      if (ws || isGlove) return { ok: true, item, reloadKey: ws?.reload_sound ?? null };
    } else if (isGlove) {
      return { ok: true, item, reloadKey: null };
    }
  }
  return { ok: false, item, reloadKey: null };
}

function originToRpc(origin: CursorOrigin): { region: string; page: number; slot: number } {
  if (origin.region === 'inventory') return { region: 'inventory', page: 0, slot: origin.gridSlot };
  if (origin.region === 'hotbar') return { region: 'quick_select', page: 0, slot: origin.slot };
  if (origin.region === 'equip') return { region: 'equip', page: 0, slot: origin.slot };
  return { region: 'vault', page: origin.page, slot: origin.slot };
}

export function EquipSlots({ gear, onMoved }: { gear: Array<{ slot: number; itemId: string }>; onMoved: () => void | Promise<void> }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [equip, setEquip] = useState<EquipMap>(EMPTY);
  const cursorHeld = useCursorStack((s) => !!s.cursor);

  // Resolve item defs for the SHARED equip gear (owned by useUserData) and build the slot map. No
  // private query/subscription anymore — equip changes arrive via the unified user_slots realtime.
  const gearKey = gear.map((g) => `${g.slot}:${g.itemId}`).sort().join('|');
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ids = gear.map((g) => g.itemId).filter(Boolean);
      const defs: Record<string, EquipItem> = {};
      if (ids.length) {
        const { data: items } = await (supabase as unknown as {
          from: (t: string) => { select: (c: string) => { in: (k: string, v: string[]) => Promise<{ data: Array<{ id: string; name: string; item_number: number | null; tier: number | null; item_category: string; texture_url: string | null }> | null }> } };
        }).from('items').select('id,name,item_number,tier,item_category,texture_url').in('id', ids);
        for (const it of items || []) {
          defs[it.id] = {
            itemId: it.id, name: it.name, itemNumber: it.item_number, tier: it.tier, category: it.item_category,
            spriteUrl: getItemSpriteUrl({ item_number: it.item_number, texture_url: it.texture_url } as { item_number: number | null; texture_url: string | null }),
          };
        }
      }
      if (cancelled) return;
      const next: EquipMap = { ...EMPTY };
      for (const g of gear) if (g.slot >= 1 && g.slot <= 4) next[g.slot] = defs[g.itemId] ?? null;
      setEquip(next);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gearKey]);

  // Drive the active-weapon store from the weapon slot (slot 1). Guns only.
  const weaponItemNumber = equip[1]?.itemNumber ?? null;
  useEffect(() => {
    if (weaponItemNumber == null) { setActiveWeapon(null); return; }
    let cancelled = false;
    (async () => {
      const { data } = await (supabase as unknown as {
        from: (t: string) => { select: (c: string) => { eq: (k: string, v: number) => { maybeSingle: () => Promise<{ data: Record<string, unknown> | null }> } } };
      }).from('weapon_stats').select('*').eq('item_number', weaponItemNumber).maybeSingle();
      if (cancelled) return;
      const d = data as Record<string, number | string | boolean | null> | null;
      if (!d || !d.is_gun) { setActiveWeapon(null); return; }
      const clip = typeof d.ammo_clip_amount === 'number' && d.ammo_clip_amount > 0 ? d.ammo_clip_amount : null;
      const cd = typeof d.shoot_cooldown === 'number' && d.shoot_cooldown > 0 ? d.shoot_cooldown : 0.15;
      setActiveWeapon({
        itemNumber: weaponItemNumber, name: (d.name as string) ?? 'Weapon',
        shootCooldown: cd, maxDamage: (d.max_damage as number) ?? 25,
        fireSound: (d.fire_sound as string) ?? null, emptySound: (d.empty_sound as string) ?? null,
        reloadSound: (d.reload_sound as string) ?? null, isAutomatic: !!d.is_automatic,
        ammoClipAmount: clip, reloadTime: (d.reload_time as number) ?? null,
        projectile: (d.projectile as string) ?? null, bulletsPerTap: (d.bullets_per_tap as number) ?? null,
        horizontalSpread: (d.horizontal_spread as number) ?? null, verticalSpread: (d.vertical_spread as number) ?? null,
        recoilDuration: (d.recoil_duration as number) ?? null,
      });
    })();
    return () => { cancelled = true; };
  }, [weaponItemNumber]);

  const firstEmptyInventorySlot = useCallback(async (): Promise<number | null> => {
    if (!user?.id) return null;
    const { data: occ } = await sb.from('user_slots').select('slot').eq('user_id', user.id).eq('region', 'inventory');
    const used = new Set((occ || []).map((r) => r.slot));
    for (let s = 1; s <= 18; s++) if (!used.has(s)) return s;
    return null;
  }, [user?.id]);

  const reportFail = (title: string, err: unknown) => {
    const e = err as { message?: string; code?: string; details?: string };
    toast({ title, description: String(e?.message ?? e?.details ?? e?.code ?? err).slice(0, 160), variant: 'destructive', duration: 6000 });
    console.error('[equip]', title, err);
  };

  const handlePointerUp = async (def: SlotDef) => {
    const cur = cursorStackApi.getCursor();
    if (cur) {
      const r = await resolveDrop(def, cur.itemId);
      if (!r.ok) { toast({ title: `That can't go in the ${def.label} slot`, duration: 2200 }); return; }
      // OPTIMISTIC: show the item in the slot + play the equip sound + clear the cursor INSTANTLY;
      // the DB move + shared reconcile happen in the background, so it feels immediate.
      setEquip((prev) => ({ ...prev, [def.num]: r.item }));
      cursorStackApi.setCursor(null);
      // Weapon slot: ALWAYS a reload sound (the weapon's reload_sound, or the default reload clip the
      // game uses) — never the thud. Other slots: the soft place sound.
      void playSound(def.type === 'weapon' ? getSoundUrl(r.reloadKey ?? 'rifle_reload', '/rifle_reload.mp3') : EQUIP_FALLBACK, 0.6);
      const from = originToRpc(cur.origin);
      try { await equipTransfer(from, { region: 'equip', page: 0, slot: def.num }); }
      catch (err) { reportFail('Equip failed', err); }
      void onMoved();   // reconcile: refreshes equip AND clears the source from inventory/QS
      return;
    }
    // No cursor + filled slot → unequip back to the first empty inventory slot (instant + bg move).
    if (equip[def.num]) {
      const removed = equip[def.num];
      setEquip((prev) => ({ ...prev, [def.num]: null }));   // optimistic clear
      void playSound(EQUIP_FALLBACK, 0.5);
      const dst = await firstEmptyInventorySlot();
      if (dst == null) { setEquip((prev) => ({ ...prev, [def.num]: removed })); toast({ title: 'Inventory full', duration: 2000 }); return; }
      try { await equipTransfer({ region: 'equip', page: 0, slot: def.num }, { region: 'inventory', page: 0, slot: dst }); }
      catch (err) { setEquip((prev) => ({ ...prev, [def.num]: removed })); reportFail('Unequip failed', err); }
      void onMoved();
    }
  };

  // Drag OUT of an equip slot: pressing a filled slot and dragging lifts the item onto the cursor
  // (origin = this equip slot), so releasing over an inv/QS tile routes through equip_transfer.
  // A plain click (no drag) falls through to handlePointerUp's click-to-unequip.
  const startEquipDrag = (def: SlotDef, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const item = equip[def.num];
    if (!item) return;
    const sx = e.clientX, sy = e.clientY;
    let lifted = false;
    function cleanup() {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', cleanup);
    }
    function onMove(ev: PointerEvent) {
      if (lifted) return;
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (dx * dx + dy * dy > 36) {   // ~6px drag threshold
        lifted = true;
        cursorStackApi.setCursor({
          itemId: item.itemId, itemKey: '', quantity: 1, name: item.name, tier: item.tier,
          spriteUrl: item.spriteUrl, nonStackable: true, origin: { region: 'equip', slot: def.num },
        });
        setEquip((prev) => ({ ...prev, [def.num]: null }));   // optimistic clear; reconciles on refetch
        cleanup();
      }
    }
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', cleanup);
  };

  return (
    <div style={{ position: 'fixed', bottom: 16, right: 16, zIndex: 20, display: 'flex', flexDirection: 'row', gap: 6 }}>
      {SLOTS.map((def) => {
        const g = equip[def.num];
        const bootsDefault = def.type === 'boots' && !g;
        const sprite = g?.spriteUrl ?? (bootsDefault ? T1_BOOTS : null);
        const bright = !!g || bootsDefault;
        return (
          <div
            key={def.num}
            title={g ? `${g.name} (drag off, or click to unequip)` : `${def.label} — drag a ${def.label.toLowerCase()} here`}
            onPointerDown={(e) => startEquipDrag(def, e)}
            onPointerUp={(e) => { if (e.button === 0) void handlePointerUp(def); }}
            style={{
              width: 60, height: 60, borderRadius: 'var(--hud-radius, 8px)',
              background: cursorHeld ? 'hsl(var(--hud-bg-hover))' : 'hsl(var(--hud-bg))',
              border: `1px solid ${cursorHeld ? 'hsl(var(--hud-border-selected))' : 'hsl(var(--hud-border))'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              position: 'relative', cursor: g || cursorHeld ? 'pointer' : 'default', userSelect: 'none',
            }}
          >
            {sprite ? (
              <img src={sprite} alt={def.label} style={{ width: 46, height: 46, objectFit: 'contain', opacity: bright ? 1 : 0.35 }} />
            ) : (
              <span style={{ fontSize: 24, opacity: 0.35, filter: 'grayscale(1)' }} aria-hidden>{def.glyph}</span>
            )}
            {g?.tier ? (
              <span style={{ position: 'absolute', top: 1, left: 3, fontSize: 9, fontFamily: 'monospace', color: HUD_DIM }}>T{g.tier}</span>
            ) : null}
            <span style={{
              position: 'absolute', top: 'calc(100% + 1.8px)', left: 0, right: 0,
              textAlign: 'center', fontSize: 9, fontWeight: 700,
              color: 'hsl(var(--hud-text))', fontFamily: 'var(--hud-font)',
              pointerEvents: 'none', textTransform: 'uppercase',
            }}>{def.label}</span>
          </div>
        );
      })}
    </div>
  );
}
