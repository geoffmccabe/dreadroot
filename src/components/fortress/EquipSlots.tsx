import React, { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useEquippedGear, SLOT_CATEGORY, type GearSlot, type ResolvedGear } from '@/hooks/useEquippedGear';
import { setActiveWeapon } from '@/config/activeWeapon';

// Replaces the old bottom-right "R for crosshairs" panel. Four equip slots that
// REFERENCE an owned item (weapon / armor / boots / potion). Drag an item from
// inventory or the quick-select hotbar onto a slot to equip it; click to unequip.
// The main use: choose the active weapon (drives firing) and the active potion.

const HUD_TEXT = 'hsl(var(--hud-text))';
const HUD_DIM = 'hsl(var(--hud-text-dim))';

const T1_BOOTS = '/rocket_boots_t1_256px.webp';

interface SlotDef { slot: GearSlot; label: string; glyph: string; }
const SLOTS: SlotDef[] = [
  { slot: 'weapon', label: 'Weapon', glyph: '🔫' },
  { slot: 'armor', label: 'Armor', glyph: '🛡️' },
  { slot: 'boots', label: 'Boots', glyph: '🥾' },
  { slot: 'potion', label: 'Potion', glyph: '🧪' },
];

// Parse the drag payload the HUD writes to dataTransfer and resolve to an item_id.
function itemIdFromDrag(e: React.DragEvent, equippedItems: Array<{ slot: number; itemId: string }>): string | null {
  const raw = e.dataTransfer.getData('text/plain');
  if (!raw) return null;
  try {
    const src = JSON.parse(raw) as { type: string; itemId?: string; slot?: number };
    if (src.type === 'inventory' || src.type === 'vault') return src.itemId ?? null;
    if (src.type === 'hotbar') return equippedItems.find(e2 => e2.slot === src.slot)?.itemId ?? null;
  } catch { /* ignore */ }
  return null;
}

export function EquipSlots({ equippedItems = [] }: { equippedItems?: Array<{ slot: number; itemId: string }> }) {
  const { gear, setGear } = useEquippedGear();
  const [hover, setHover] = useState<GearSlot | null>(null);

  // Keep the active-weapon store in sync with the equipped weapon, so the firing
  // system (FortressControls / frame loop) simulates that SW weapon's stats.
  const weaponItemNumber = gear.weapon?.itemNumber ?? null;
  useEffect(() => {
    if (weaponItemNumber == null) { setActiveWeapon(null); return; }
    let cancelled = false;
    (async () => {
      const { data } = await (supabase as unknown as {
        from: (t: string) => { select: (c: string) => { eq: (k: string, v: number) => { maybeSingle: () => Promise<{ data: Record<string, unknown> | null }> } } };
      }).from('weapon_stats').select('*').eq('item_number', weaponItemNumber).maybeSingle();
      if (cancelled || !data) { if (!cancelled) setActiveWeapon(null); return; }
      const d = data as Record<string, number | string | boolean | null>;
      setActiveWeapon({
        itemNumber: weaponItemNumber,
        name: (d.name as string) ?? 'Weapon',
        shootCooldown: (d.shoot_cooldown as number) ?? 0.15,
        maxDamage: (d.max_damage as number) ?? 25,
        fireSound: (d.fire_sound as string) ?? null,
        emptySound: (d.empty_sound as string) ?? null,
        reloadSound: (d.reload_sound as string) ?? null,
        isAutomatic: !!d.is_automatic,
        ammoClipAmount: (d.ammo_clip_amount as number) ?? null,
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

  const handleDrop = async (e: React.DragEvent, slot: GearSlot) => {
    e.preventDefault();
    setHover(null);
    const itemId = itemIdFromDrag(e, equippedItems);
    if (!itemId) return;
    // Validate the dropped item's category against the slot.
    const { data } = await (supabase as unknown as {
      from: (t: string) => { select: (c: string) => { eq: (k: string, v: string) => { maybeSingle: () => Promise<{ data: { item_category: string } | null }> } } };
    }).from('items').select('item_category').eq('id', itemId).maybeSingle();
    const cat = data?.item_category;
    if (!cat || !SLOT_CATEGORY[slot].includes(cat)) return; // wrong type for this slot
    void setGear(slot, itemId);
  };

  return (
    <div
      style={{ position: 'fixed', bottom: 16, right: 16, zIndex: 20, display: 'flex', flexDirection: 'column', gap: 6 }}
    >
      {SLOTS.map(({ slot, label, glyph }) => {
        const g: ResolvedGear | null = gear[slot];
        // Boots slot is never visually empty — falls back to the Tier-1 default.
        const sprite = g?.spriteUrl ?? (slot === 'boots' ? T1_BOOTS : null);
        const filled = !!g;
        const isHover = hover === slot;
        return (
          <div
            key={slot}
            title={g ? `${g.name} (click to unequip)` : `${label} — drag a ${label.toLowerCase()} here`}
            onDragOver={(e) => { e.preventDefault(); setHover(slot); }}
            onDragLeave={() => setHover((h) => (h === slot ? null : h))}
            onDrop={(e) => void handleDrop(e, slot)}
            onClick={() => { if (g) void setGear(slot, null); }}
            style={{
              width: 52, height: 52, borderRadius: 'var(--hud-radius, 8px)',
              background: isHover ? 'hsl(var(--hud-bg-hover))' : 'hsl(var(--hud-bg))',
              border: `1px solid ${isHover ? 'hsl(var(--hud-border-selected))' : 'hsl(var(--hud-border))'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              position: 'relative', cursor: g ? 'pointer' : 'default', userSelect: 'none',
            }}
          >
            {sprite ? (
              <img
                src={sprite}
                alt={label}
                style={{ width: 40, height: 40, objectFit: 'contain', opacity: filled ? 1 : 0.35 }}
              />
            ) : (
              <span style={{ fontSize: 22, opacity: 0.35, filter: 'grayscale(1)' }} aria-hidden>{glyph}</span>
            )}
            {/* tier badge */}
            {g?.tier ? (
              <span style={{ position: 'absolute', top: 1, left: 3, fontSize: 9, fontFamily: 'monospace', color: HUD_DIM }}>T{g.tier}</span>
            ) : null}
            {/* slot label */}
            <span style={{ position: 'absolute', bottom: -1, right: 3, fontSize: 8, color: HUD_DIM, fontFamily: 'monospace', textTransform: 'uppercase' }}>{label.slice(0, 4)}</span>
          </div>
        );
      })}
    </div>
  );
}
