import React, { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useEquippedGear, SLOT_CATEGORY, type GearSlot, type ResolvedGear } from '@/hooks/useEquippedGear';
import { setActiveWeapon } from '@/config/activeWeapon';
import { cursorStackApi, useCursorStack } from '@/features/inventory-system/useCursorStack';

// Replaces the old bottom-right "R for crosshairs" panel. Four equip slots that
// REFERENCE an owned item (weapon / armor / boots / potion). With the inventory open,
// pick an item onto the cursor (the game's cursor-stack drag) and release it on a slot
// to equip it; click a filled slot to unequip. The main use: choose the active weapon
// (drives firing) and the active potion.

const HUD_DIM = 'hsl(var(--hud-text-dim))';
const T1_BOOTS = '/rocket_boots_t1_256px.webp';

interface SlotDef { slot: GearSlot; label: string; glyph: string; }
const SLOTS: SlotDef[] = [
  { slot: 'weapon', label: 'Weapon', glyph: '🔫' },
  { slot: 'armor', label: 'Armor', glyph: '🛡️' },
  { slot: 'boots', label: 'Boots', glyph: '🥾' },
  { slot: 'potion', label: 'Potion', glyph: '🧪' },
];

async function itemCategory(itemId: string): Promise<string | null> {
  const { data } = await (supabase as unknown as {
    from: (t: string) => { select: (c: string) => { eq: (k: string, v: string) => { maybeSingle: () => Promise<{ data: { item_category: string } | null }> } } };
  }).from('items').select('item_category').eq('id', itemId).maybeSingle();
  return data?.item_category ?? null;
}

export function EquipSlots() {
  const { gear, setGear } = useEquippedGear();
  // Re-render while an item is on the cursor so slots can show a drop highlight.
  const cursorHeld = useCursorStack((s) => !!s.cursor);

  // Keep the active-weapon store in sync with the equipped weapon, so the firing
  // system (FortressControls / frame loop) simulates that SW weapon's stats.
  // Only GUNS drive firing; a non-gun in the weapon slot leaves firing at defaults.
  const weaponItemNumber = gear.weapon?.itemNumber ?? null;
  useEffect(() => {
    if (weaponItemNumber == null) { setActiveWeapon(null); return; }
    let cancelled = false;
    (async () => {
      const { data } = await (supabase as unknown as {
        from: (t: string) => { select: (c: string) => { eq: (k: string, v: number) => { maybeSingle: () => Promise<{ data: Record<string, unknown> | null }> } } };
      }).from('weapon_stats').select('*').eq('item_number', weaponItemNumber).maybeSingle();
      if (cancelled) return;
      const d = data as Record<string, number | string | boolean | null> | null;
      if (!d || !d.is_gun) { setActiveWeapon(null); return; } // non-gun → default firing
      const clip = typeof d.ammo_clip_amount === 'number' && d.ammo_clip_amount > 0 ? d.ammo_clip_amount : null;
      const cd = typeof d.shoot_cooldown === 'number' && d.shoot_cooldown > 0 ? d.shoot_cooldown : 0.15;
      setActiveWeapon({
        itemNumber: weaponItemNumber,
        name: (d.name as string) ?? 'Weapon',
        shootCooldown: cd,
        maxDamage: (d.max_damage as number) ?? 25,
        fireSound: (d.fire_sound as string) ?? null,
        emptySound: (d.empty_sound as string) ?? null,
        reloadSound: (d.reload_sound as string) ?? null,
        isAutomatic: !!d.is_automatic,
        ammoClipAmount: clip,
        reloadTime: (d.reload_time as number) ?? null,
        projectile: (d.projectile as string) ?? null,
        bulletsPerTap: (d.bullets_per_tap as number) ?? null,
        horizontalSpread: (d.horizontal_spread as number) ?? null,
        verticalSpread: (d.vertical_spread as number) ?? null,
        recoilDuration: (d.recoil_duration as number) ?? null,
      });
    })();
    return () => { cancelled = true; };
  }, [weaponItemNumber]);

  // Release the cursor item on a slot → equip it (if its category fits), then clear
  // the cursor so the item returns to its origin (equip is a reference, not a move).
  const handlePointerUp = async (slot: GearSlot, g: ResolvedGear | null) => {
    const cur = cursorStackApi.getCursor();
    if (cur) {
      const cat = await itemCategory(cur.itemId);
      if (cat && SLOT_CATEGORY[slot].includes(cat)) {
        void setGear(slot, cur.itemId);
        cursorStackApi.setCursor(null); // item snaps back to its slot; equip references it
      }
      return; // wrong category → leave the cursor held so the player can place it elsewhere
    }
    if (g) void setGear(slot, null); // click a filled slot with no cursor → unequip
  };

  return (
    <div style={{ position: 'fixed', bottom: 16, right: 16, zIndex: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
      {SLOTS.map(({ slot, label, glyph }) => {
        const g: ResolvedGear | null = gear[slot];
        // Boots slot is never visually empty — falls back to the Tier-1 default.
        const sprite = g?.spriteUrl ?? (slot === 'boots' ? T1_BOOTS : null);
        const filled = !!g;
        return (
          <div
            key={slot}
            title={g ? `${g.name} (click to unequip)` : `${label} — drag a ${label.toLowerCase()} here`}
            onPointerUp={(e) => { if (e.button === 0) void handlePointerUp(slot, g); }}
            style={{
              width: 52, height: 52, borderRadius: 'var(--hud-radius, 8px)',
              background: cursorHeld ? 'hsl(var(--hud-bg-hover))' : 'hsl(var(--hud-bg))',
              border: `1px solid ${cursorHeld ? 'hsl(var(--hud-border-selected))' : 'hsl(var(--hud-border))'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              position: 'relative', cursor: g || cursorHeld ? 'pointer' : 'default', userSelect: 'none',
            }}
          >
            {sprite ? (
              <img src={sprite} alt={label} style={{ width: 40, height: 40, objectFit: 'contain', opacity: filled ? 1 : 0.35 }} />
            ) : (
              <span style={{ fontSize: 22, opacity: 0.35, filter: 'grayscale(1)' }} aria-hidden>{glyph}</span>
            )}
            {g?.tier ? (
              <span style={{ position: 'absolute', top: 1, left: 3, fontSize: 9, fontFamily: 'monospace', color: HUD_DIM }}>T{g.tier}</span>
            ) : null}
            <span style={{ position: 'absolute', bottom: -1, right: 3, fontSize: 8, color: HUD_DIM, fontFamily: 'monospace', textTransform: 'uppercase' }}>{label.slice(0, 4)}</span>
          </div>
        );
      })}
    </div>
  );
}
