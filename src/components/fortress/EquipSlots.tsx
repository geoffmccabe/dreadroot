import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { getItemSpriteUrl } from '@/lib/itemSprite';
import { setActiveWeapon, setRightWeapon, type ActiveWeaponStats } from '@/config/activeWeapon';
import { setRocketBelt } from '@/config/rocketBelt';
import { rocketBeltTierFromItemNumber } from '@/features/rocketBelt/rocketBelt';
import { useHandGrenades, handKind, setHandGrenade } from '@/config/handGrenade';
import { setFlameGlove } from '@/config/flameGlove';
import { setEquippedPickaxe, isPickaxe } from '@/components/siege/mining/equippedPickaxe';
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

// equip slot number ↔ gear type (and accepted item_category per slot). Slots 1 & 5 are the
// LEFT and RIGHT hands (each holds a pistol/grenade; a rifle fills BOTH). 2/3/4 stay armor/
// boots/potion. `hand: 'L'|'R'` marks the two hand slots so the layout can group them.
interface SlotDef { num: number; type: string; label: string; glyph: string; cats: string[]; hand?: 'L' | 'R'; }
const SLOTS: SlotDef[] = [
  { num: 1, type: 'weapon', label: 'L', glyph: '🔫', cats: ['weapon'], hand: 'L' },
  { num: 5, type: 'weapon', label: 'R', glyph: '🔫', cats: ['weapon'], hand: 'R' },
  { num: 2, type: 'armor', label: 'Armor', glyph: '🛡️', cats: ['armor'] },
  { num: 3, type: 'boots', label: 'Boots', glyph: '🥾', cats: ['boots'] },
  { num: 4, type: 'potion', label: 'Special', glyph: '🧪', cats: ['consumable', 'potion', 'gear'] },
];

interface EquipItem { itemId: string; name: string; itemNumber: number | null; tier: number | null; category: string; spriteUrl: string | null; }
type EquipMap = Record<number, EquipItem | null>;
const EMPTY: EquipMap = { 1: null, 2: null, 3: null, 4: null, 5: null };

// Resolve a drop: whether the item fits the slot, its display def (for an instant optimistic tile),
// and the weapon's reload-sound key (so equipping a weapon plays its reload clip). item_category is a
// BROAD field (block/item/seed/…) that most weapons don't tag 'weapon', so the weapon slot ALSO
// accepts anything the game treats as a weapon: a weapon_stats row (same source the active-weapon
// system uses) or the flame glove by key. One items query + (weapon only) one weapon_stats query.
async function resolveDrop(def: SlotDef, itemId: string): Promise<{ ok: boolean; item: EquipItem | null; reloadKey: string | null; isRifle: boolean }> {
  const { data: it } = await (supabase as unknown as {
    from: (t: string) => { select: (c: string) => { eq: (k: string, v: string) => { maybeSingle: () => Promise<{ data: { item_category: string | null; item_number: number | null; key: string | null; name: string; tier: number | null; texture_url: string | null } | null }> } } };
  }).from('items').select('item_category,item_number,key,name,tier,texture_url').eq('id', itemId).maybeSingle();
  if (!it) return { ok: false, item: null, reloadKey: null, isRifle: false };
  const item: EquipItem = {
    itemId, name: it.name, itemNumber: it.item_number, tier: it.tier, category: it.item_category ?? '',
    spriteUrl: getItemSpriteUrl({ item_number: it.item_number, texture_url: it.texture_url } as { item_number: number | null; texture_url: string | null }),
  };
  // Weapon/hand slots: ALWAYS resolve weapon_stats so isRifle is reliable — even if the
  // item also happens to carry item_category 'weapon' (which would otherwise early-return).
  if (def.type === 'weapon') {
    const isGlove = it.key === 'flame_glove' || (it.key ?? '').includes('glove');
    // A shpider EGG is a hand THROWABLE (like a grenade): accept it into a hand slot so it can be
    // dragged in, then G adopts it into the hand overlay + throws it (hatches a pet).
    if ((it.key ?? '').startsWith('shpider_egg')) return { ok: true, item, reloadKey: null, isRifle: false };
    // A PICKAXE is a two-handed mining TOOL (not a gun): it fills BOTH hands and renders centered
    // like a rifle (isRifle), but never fires (loadWeaponStats returns null for non-guns). Detect
    // by name/key so it needs no weapon_stats row — the existing pickaxe items just work.
    if (isPickaxe(it.name) || isPickaxe(it.key) || (it.item_category ?? '').toLowerCase() === 'pickaxe') {
      return { ok: true, item, reloadKey: null, isRifle: true };
    }
    if (it.item_number != null) {
      const { data: ws } = await (supabase as unknown as {
        from: (t: string) => { select: (c: string) => { eq: (k: string, v: number) => { maybeSingle: () => Promise<{ data: Record<string, unknown> | null }> } } };
      }).from('weapon_stats').select('*').eq('item_number', it.item_number).maybeSingle();
      // A rifle is TWO-HANDED. Safe-by-default: a gun is one-handed (pistol) UNLESS
      // explicitly flagged is_two_handed, so an unmarked gun is never wrongly centered.
      if (ws || isGlove) return { ok: true, item, reloadKey: (ws?.reload_sound as string) ?? null, isRifle: !!ws?.is_gun && !!ws?.is_two_handed };
    } else if (isGlove) {
      return { ok: true, item, reloadKey: null, isRifle: false };
    }
    return { ok: false, item, reloadKey: null, isRifle: false };
  }
  if (it.item_category && def.cats.includes(it.item_category)) return { ok: true, item, reloadKey: null, isRifle: false };
  return { ok: false, item, reloadKey: null, isRifle: false };
}

// Load a weapon's stats by item_number → the ActiveWeaponStats the fire code reads, plus
// whether it's a rifle or pistol (a rifle is two-handed; a pistol is one-handed). Shared by
// both hand slots (1 = left, 5 = right). Non-gun (e.g. flame glove) → { stats: null }.
async function loadWeaponStats(itemNumber: number): Promise<{ stats: ActiveWeaponStats | null; kind: 'rifle' | 'pistol' | null }> {
  const { data } = await (supabase as unknown as {
    from: (t: string) => { select: (c: string) => { eq: (k: string, v: number) => { maybeSingle: () => Promise<{ data: Record<string, unknown> | null }> } } };
  }).from('weapon_stats').select('*').eq('item_number', itemNumber).maybeSingle();
  const d = data as Record<string, number | string | boolean | null> | null;
  if (!d || !d.is_gun) return { stats: null, kind: null };
  const clip = typeof d.ammo_clip_amount === 'number' && d.ammo_clip_amount > 0 ? d.ammo_clip_amount : null;
  const cd = typeof d.shoot_cooldown === 'number' && d.shoot_cooldown > 0 ? d.shoot_cooldown : 0.15;
  const stats: ActiveWeaponStats = {
    itemNumber, name: (d.name as string) ?? 'Weapon',
    shootCooldown: cd, maxDamage: (d.max_damage as number) ?? 25,
    fireSound: (d.fire_sound as string) ?? null, emptySound: (d.empty_sound as string) ?? null,
    reloadSound: (d.reload_sound as string) ?? null, isAutomatic: !!d.is_automatic, isPistol: !d.is_two_handed,
    ammoClipAmount: clip, reloadTime: (d.reload_time as number) ?? null,
    projectile: (d.projectile as string) ?? null, bulletsPerTap: (d.bullets_per_tap as number) ?? null,
    horizontalSpread: (d.horizontal_spread as number) ?? null, verticalSpread: (d.vertical_spread as number) ?? null,
    recoilDuration: (d.recoil_duration as number) ?? null,
    recoilPitch: (d.camera_recoil_pitch as number) ?? null,
    recoilYaw: (d.camera_recoil_yaw as number) ?? null,
    adsRecoilScale: (d.ads_recoil_scale as number) ?? null,
    scopedFov: (d.scoped_fov as number) ?? null,
    zoomSpeed: (d.zoom_speed as number) ?? null,
    isSniper: (d.is_sniper as boolean) ?? null,
    scopeGraphicUrl: (d.scope_graphic_url as string) ?? null,
  };
  return { stats, kind: d.is_two_handed ? 'rifle' : 'pistol' };   // safe default: one-handed unless flagged two-handed
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
  // Kind of weapon in the LEFT hand (slot 1) — a rifle fills BOTH hands (icon centered
  // between L and R, right hand blocked); a pistol stays in one hand. null = empty/other.
  const [leftKind, setLeftKind] = useState<'rifle' | 'pistol' | null>(null);
  const cursor = useCursorStack((s) => s.cursor);
  const cursorHeld = !!cursor;
  const handGren = useHandGrenades();   // grenades shown in the L/R hand boxes (overlay)

  // Item defs for the SHARED equip gear (sprite/name/tier/itemNumber), fetched per id-set.
  const [defs, setDefs] = useState<Record<string, EquipItem>>({});
  const gearKey = gear.map((g) => `${g.slot}:${g.itemId}`).sort().join('|');
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ids = gear.map((g) => g.itemId).filter(Boolean);
      if (!ids.length) { if (!cancelled) setDefs({}); return; }
      const { data: items } = await (supabase as unknown as {
        from: (t: string) => { select: (c: string) => { in: (k: string, v: string[]) => Promise<{ data: Array<{ id: string; name: string; item_number: number | null; tier: number | null; item_category: string; texture_url: string | null }> | null }> } };
      }).from('items').select('id,name,item_number,tier,item_category,texture_url').in('id', ids);
      if (cancelled) return;
      const next: Record<string, EquipItem> = {};
      for (const it of items || []) {
        next[it.id] = {
          itemId: it.id, name: it.name, itemNumber: it.item_number, tier: it.tier, category: it.item_category,
          spriteUrl: getItemSpriteUrl({ item_number: it.item_number, texture_url: it.texture_url } as { item_number: number | null; texture_url: string | null }),
        };
      }
      setDefs(next);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gearKey]);

  // Base slot→item map derived from the shared `gear` prop (the source of truth, updated via
  // user_slots realtime). On TOP we apply an OPTIMISTIC overlay set the instant an item is
  // dropped onto a slot, so the equip + active-weapon (and thus the ability to SHOOT) appear
  // immediately instead of waiting on a realtime round-trip. The overlay only ADDS (never
  // clears), so it can't "lose" an item; it's dropped the moment the gear prop reflects the
  // change (gearKey changes), or reverted if the move fails. Drag-OUT uses a GHOST (below),
  // never a clear, so a cancelled drag can't look like a loss.
  const [optimistic, setOptimistic] = useState<Record<number, EquipItem>>({});
  // Drop an optimistic entry only once the gear prop CONFIRMS that exact item in that slot
  // AND its def has loaded — so the gear-derived tile is ready to take over with no flicker
  // and no momentary active-weapon gap (which would read as "NO WEAPON" mid-equip).
  useEffect(() => {
    setOptimistic((prev) => {
      const keys = Object.keys(prev);
      if (!keys.length) return prev;
      const n = { ...prev }; let changed = false;
      for (const s of keys) {
        const slot = Number(s);
        const g = gear.find((gg) => gg.slot === slot);
        if (g && g.itemId === prev[slot].itemId && defs[g.itemId]) { delete n[slot]; changed = true; }
      }
      return changed ? n : prev;
    });
  }, [gear, defs]);
  const equip: EquipMap = useMemo(() => {
    const m: EquipMap = { ...EMPTY };
    for (const g of gear) if (g.slot >= 1 && g.slot <= 5) m[g.slot] = defs[g.itemId] ?? null;
    for (const s of Object.keys(optimistic)) m[Number(s)] = optimistic[Number(s)];
    return m;
  }, [gear, defs, optimistic]);
  // True when this slot's item is currently riding the cursor (drag-out / pickup in progress).
  const isGhosted = (slot: number) => cursor?.origin.region === 'equip' && cursor.origin.slot === slot;

  // A flame glove fires via the FLAME path (setFlameGlove below + the flame-button bindings),
  // NEVER as a gun — even though its weapon_stats row carries is_gun=true (so the equip slot
  // accepts it). It must not populate the active/right weapon store, or in the RIGHT hand the
  // left mouse button would fall back to it (getFireWeapon) and fire BULLETS with the flame
  // sound. Detect by name, same as the publish effect below.
  const isGloveItem = (it: EquipItem | null) => !!it?.name && it.name.toLowerCase().includes('flame glove');
  const leftIsGlove = isGloveItem(equip[1]);
  const rightIsGlove = isGloveItem(equip[5]);
  // A pickaxe (two-handed mining tool) in the left hand owns BOTH hands — same as a rifle —
  // so the right hand stays empty/inactive. Detected by name (no weapon_stats row).
  const leftIsPickaxe = isPickaxe(equip[1]?.name);

  // LEFT hand (slot 1) drives the primary active weapon + leftKind (rifle vs pistol).
  const weaponItemNumber = equip[1]?.itemNumber ?? null;
  useEffect(() => {
    if (weaponItemNumber == null || leftIsGlove) { setActiveWeapon(null); setLeftKind(null); return; }
    let cancelled = false;
    (async () => {
      const { stats, kind } = await loadWeaponStats(weaponItemNumber);
      if (cancelled) return;
      setActiveWeapon(stats); setLeftKind(kind);
    })();
    return () => { cancelled = true; };
  }, [weaponItemNumber, leftIsGlove]);

  // RIGHT hand (slot 5) drives the second weapon. ANY gun here is fireable (left-click
  // falls back to it; with a left pistol too, right-click fires it). If the left holds a
  // rifle (two-handed) it owns both hands → no separate right weapon.
  const rightItemNumber = equip[5]?.itemNumber ?? null;
  useEffect(() => {
    if (rightItemNumber == null || leftKind === 'rifle' || leftIsPickaxe || rightIsGlove) { setRightWeapon(null); return; }
    let cancelled = false;
    (async () => {
      const { stats } = await loadWeaponStats(rightItemNumber);
      if (cancelled) return;
      setRightWeapon(stats);
    })();
    return () => { cancelled = true; };
  }, [rightItemNumber, leftKind, leftIsPickaxe, rightIsGlove]);

  // Pickaxe (two-handed mining tool, left hand) → publish its tier so the mining interaction
  // knows the player can mine, and at what tier. The item's `tier` IS the pickaxe tier.
  useEffect(() => {
    const px = equip[1];
    setEquippedPickaxe(leftIsPickaxe && px ? { tier: px.tier ?? 1, name: px.name } : null);
  }, [equip, leftIsPickaxe]);

  // Flame glove (one-handed) — active in EITHER hand, preferring the RIGHT if a glove is
  // worn in both (only one is used). Binds the flame to that hand's mouse button downstream.
  useEffect(() => {
    if (rightIsGlove) setFlameGlove({ hand: 'R', tier: equip[5]!.tier ?? 1 });
    else if (leftIsGlove) setFlameGlove({ hand: 'L', tier: equip[1]!.tier ?? 1 });
    else setFlameGlove(null);
  }, [equip, leftIsGlove, rightIsGlove]);

  // Rocket Belt (Special slot = 4, shown as E5) → publish the equipped tier so the movement
  // code can grant the Shift+E forward boost. Identified by item_number (239–248).
  useEffect(() => {
    const belt = equip[4];
    const tier = rocketBeltTierFromItemNumber(belt?.itemNumber);
    setRocketBelt(tier ? { tier: belt?.tier ?? tier } : null);
  }, [equip]);

  const reportFail = (title: string, err: unknown) => {
    const e = err as { message?: string; code?: string; details?: string };
    toast({ title, description: String(e?.message ?? e?.details ?? e?.code ?? err).slice(0, 160), variant: 'destructive', duration: 6000 });
    console.error('[equip]', title, err);
  };

  // First empty inventory slot (for auto-evicting a hand item when a rifle takes both hands).
  const firstEmptyInventorySlot = async (): Promise<number | null> => {
    if (!user?.id) return null;
    const { data } = await (supabase as unknown as {
      from: (t: string) => { select: (c: string) => { eq: (k: string, v: string) => { eq: (k2: string, v2: string) => Promise<{ data: Array<{ slot: number }> | null }> } } };
    }).from('user_slots').select('slot').eq('user_id', user.id).eq('region', 'inventory');
    const used = new Set<number>((data ?? []).map((rr) => rr.slot));
    for (let i = 0; i < 60; i++) { if (!used.has(i)) return i; }
    return null;
  };

  const handlePointerUp = async (def: SlotDef) => {
    const cur = cursorStackApi.getCursor();
    if (cur) {
      // INSTANT FEEDBACK (no DB wait): render the dropped item + play the place/reload sound NOW
      // straight from the cursor, which already carries sprite/name/tier. Validation + weapon
      // classification (which need item_number from the DB) run right after and refine/revert.
      const revert = (slot: number) => setOptimistic((prev) => { const n = { ...prev }; delete n[slot]; return n; });
      setOptimistic((prev) => ({
        ...prev,
        [def.num]: { itemId: cur.itemId, name: cur.name, itemNumber: null, tier: cur.tier, category: '', spriteUrl: cur.spriteUrl },
      }));
      void playSound(def.type === 'weapon' ? getSoundUrl('rifle_reload', '/rifle_reload.mp3') : EQUIP_FALLBACK, 0.6);
      cursorStackApi.setCursor(null);   // consume the cursor

      const r = await resolveDrop(def, cur.itemId);
      if (!r.ok) { revert(def.num); return; }   // wrong slot → silently snap back (no modal)
      // Hand rules. A RIFLE is two-handed → it lands in the canonical LEFT slot (1) and renders
      // CENTERED across both hands. EXCLUDE the slot being dragged FROM (it's being vacated).
      let targetNum = def.num;
      const fromEquipSlot = cur.origin.region === 'equip' ? cur.origin.slot : null;
      if (def.hand && r.isRifle) {
        targetNum = 1;   // canonical → centered + fireable (active weapon reads slot 1)
        // AUTO-EVICT both hands so the rifle can take them — no "free both hands" rejection.
        // Slot 1's item is swapped to the rifle's source by the equip_transfer below; the RIGHT
        // hand (slot 5) item goes back to inventory; any hand grenades are cleared (stay in QA).
        if (!!equip[5] && fromEquipSlot !== 5) {
          const dst = await firstEmptyInventorySlot();
          if (dst != null) {
            try { await equipTransfer({ region: 'equip', page: 0, slot: 5 }, { region: 'inventory', page: 0, slot: dst }); }
            catch (e) { console.error('[equip] evict right hand for rifle failed', e); }
          }
        }
        setHandGrenade('L', null); setHandGrenade('R', null);
      } else if (def.hand && !r.isRifle && (leftKind === 'rifle' || leftIsPickaxe) && fromEquipSlot !== 1) {
        // A one-handed item (pistol/grenade/glove) dropped while a TWO-HANDED item (rifle/pickaxe)
        // owns both hands → SWAP it out (give the player what they want), no rejection. The
        // one-hander takes the canonical hand (slot 1); equip_transfer swaps the two-hander back
        // to the dragged item's source slot. Slot 5 is empty here (the two-hander owns both hands).
        targetNum = 1;
      }
      // Refine: replace the instant tile with the FULL item (item_number → active weapon fires),
      // moving it to the final target slot (a rifle migrates from the dropped hand to slot 1).
      setOptimistic((prev) => {
        const n = { ...prev };
        if (targetNum !== def.num) delete n[def.num];
        if (r.item) n[targetNum] = r.item;
        return n;
      });
      const from = originToRpc(cur.origin);
      try {
        await equipTransfer(from, { region: 'equip', page: 0, slot: targetNum });
      } catch (err) {
        revert(targetNum);
        reportFail('Equip failed', err);
      }
      void onMoved();   // reconcile: refreshes equip AND clears the source from inventory/QS
      return;
    }
    // No cursor → a plain CLICK on a filled equip slot does NOTHING. Per the rules, items
    // move ONLY by drag-and-drop (drag the item out to inventory/QA to unequip).
  };

  // Drag OUT of an equip slot: pressing a filled slot and dragging lifts the item onto the cursor
  // (origin = this equip slot), so releasing over an inv/QS tile routes through equip_transfer.
  // A plain click (no drag) does nothing — moving is drag-only.
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
        // NO local mutation — the slot renders as a dimmed GHOST (isGhosted) while the item
        // rides the cursor. Cancel (ESC) just clears the cursor → slot un-ghosts; nothing lost.
        cleanup();
      }
    }
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', cleanup);
  };

  // A rifle in the LEFT hand fills BOTH hands: its icon is drawn centered across the L+R
  // boxes, and neither box shows its own sprite (right hand is blocked).
  const rifleAcrossHands = leftKind === 'rifle';

  const renderSlot = (def: SlotDef, suppressSprite = false) => {
    const g = equip[def.num];
    const ghosted = isGhosted(def.num);   // item is on the cursor → show dimmed, don't clear
    // A grenade assigned to this hand (stored in QA, shown here). Armed = bright, disarmed = dim.
    const gren = def.hand && !suppressSprite ? handGren[def.hand] : null;
    const bootsDefault = def.type === 'boots' && !g && !gren;
    const sprite = suppressSprite ? null : (gren?.spriteUrl ?? g?.spriteUrl ?? (bootsDefault ? T1_BOOTS : null));
    const spriteOpacity = ghosted ? 0.2 : gren ? (gren.armed ? 1 : 0.5) : ((!!g || bootsDefault) ? 1 : 0.35);
    const tierBadge = gren?.tier ?? (!suppressSprite ? g?.tier : null) ?? null;
    const armed = !!gren?.armed;
    const grenIsEgg = handKind(gren) === 'egg';
    const grenLabel = grenIsEgg ? 'Egg' : 'Grenade';
    const grenKey = 'G';   // eggs + grenades both throw with G now
    return (
      <div
        key={def.num}
        className={armed ? 'dr-armed-flash' : undefined}
        title={gren ? `${grenLabel} T${gren.tier} — ${armed ? `armed: ${grenKey} throws, right-click disarms` : `disarmed: ${grenKey} arms`}` : (g ? `${g.name} (drag to inventory to unequip)` : `${def.label} — drag a ${def.label.toLowerCase()} here`)}
        onPointerDown={(e) => startEquipDrag(def, e)}
        onPointerUp={(e) => { if (e.button === 0) void handlePointerUp(def); }}
        onDragStart={(e) => e.preventDefault()}
        style={{
          width: 60, height: 60, borderRadius: 'var(--hud-radius, 8px)',
          background: cursorHeld ? 'hsl(var(--hud-bg-hover))' : 'hsl(var(--hud-bg))',
          // Armed → bright-red flashing border via the .dr-armed-flash class (mirrors the green
          // "ready to drop" outline). Unarmed falls back to the normal/selected border.
          border: armed ? '2px solid hsla(0, 100%, 58%, 1)' : `1px solid ${cursorHeld ? 'hsl(var(--hud-border-selected))' : 'hsl(var(--hud-border))'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          position: 'relative', cursor: g || cursorHeld ? 'pointer' : 'default', userSelect: 'none',
        }}
      >
        {sprite ? (
          <img src={sprite} alt={def.label} draggable={false} style={{ width: 46, height: 46, objectFit: 'contain', opacity: spriteOpacity, WebkitUserDrag: 'none' } as React.CSSProperties} />
        ) : (
          <span style={{ fontSize: 24, opacity: 0.35, filter: 'grayscale(1)' }} aria-hidden>{def.glyph}</span>
        )}
        {tierBadge ? (
          <span style={{ position: 'absolute', top: 1, left: 3, fontSize: 9, fontFamily: 'monospace', color: HUD_DIM }}>T{tierBadge}</span>
        ) : null}
        <span style={{
          position: 'absolute', top: 'calc(100% + 1.8px)', left: 0, right: 0,
          textAlign: 'center', fontSize: 9, fontWeight: 700,
          color: 'hsl(var(--hud-text))', fontFamily: 'var(--hud-font)',
          pointerEvents: 'none', textTransform: 'uppercase',
        }}>{def.label}</span>
      </div>
    );
  };

  const left = SLOTS[0], right = SLOTS[1], gearSlots = SLOTS.slice(2);   // L, R, then armor/boots/potion
  return (
    <div style={{ position: 'fixed', bottom: 16, right: 16, zIndex: 20, display: 'flex', flexDirection: 'row', alignItems: 'flex-start', gap: 6 }}>
      {/* Hands: L + R side by side. A rifle bridges both with a centered icon. */}
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'row', gap: 6 }}>
        {renderSlot(left, rifleAcrossHands)}
        {renderSlot(right, rifleAcrossHands)}
        {rifleAcrossHands && equip[1]?.spriteUrl ? (
          // The centered rifle IS the drag handle — grabbing anywhere on it operates on
          // slot 1 (so you can drag it out to inventory/QA from either hand box).
          <img
            src={equip[1]!.spriteUrl!} alt="Rifle" draggable={false}
            title={`${equip[1]!.name} (drag to inventory to unequip)`}
            onPointerDown={(e) => startEquipDrag(left, e)}
            onPointerUp={(e) => { if (e.button === 0) void handlePointerUp(left); }}
            onDragStart={(e) => e.preventDefault()}
            style={{ position: 'absolute', top: 7, left: 0, right: 0, marginInline: 'auto', width: 84, height: 46, objectFit: 'contain', opacity: isGhosted(1) ? 0.2 : 1, cursor: 'pointer', pointerEvents: 'auto', WebkitUserDrag: 'none' } as React.CSSProperties}
          />
        ) : null}
      </div>
      {/* ¼-slot gap between the hands and the gear slots. */}
      <div style={{ width: 15, flex: '0 0 auto' }} />
      {gearSlots.map((def) => renderSlot(def))}
    </div>
  );
}
