import React, { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getItemSpriteUrl } from '@/lib/itemSprite';

// Minimal shape for the clicked grid item (subset of the items table).
interface ItemLike {
  key: string;
  name: string;
  item_number: number | null;
  item_category: string;
  texture_url?: string | null;
  description?: string | null;
}

// weapon_stats row (companion table, not in generated types yet).
interface WeaponStats {
  item_number: number;
  name: string | null;
  description: string | null;
  item_type: number | null;
  weapon_type: number | null;
  weapon_ammo_type: number | null;
  base_id: number | null;
  weapon_level: number | null;
  forgeable: boolean | null;
  max_stack: number | null;
  wear_slot: number | null;
  is_throwable: boolean | null;
  equip_duration: number | null;
  max_damage: number | null;
  is_gun: boolean | null;
  shoot_cooldown: number | null;
  reload_time: number | null;
  ammo_clip_amount: number | null;
  bullets_per_tap: number | null;
  time_between_shots: number | null;
  projectile: string | null;
  effective_range: number | null;
  explosion_radius: number | null;
  is_automatic: boolean | null;
  is_burst_fire: boolean | null;
  is_shotgun: boolean | null;
  is_sniper: boolean | null;
  is_rocket_launcher: boolean | null;
  is_melee_flame_attack: boolean | null;
  fire_sound: string | null;
  empty_sound: string | null;
  reload_sound: string | null;
  swing_cooldown: number | null;
  raycast_length: number | null;
  melee_knockback_distance: number | null;
  melee_stun_duration: number | null;
  horizontal_spread: number | null;
  vertical_spread: number | null;
  recoil_duration: number | null;
  zoom_speed: number | null;
  scoped_fov: number | null;
  default_can_fire: boolean | null;
  skin_bonuses: unknown;
}

const ITEM_TYPE: Record<number, string> = {
  0: 'Consumable', 1: 'Explosive', 2: 'Gun', 3: 'Melee', 4: 'Coin', 5: 'Trophy', 6: 'Misc',
};
const WEAPON_TYPE: Record<number, string> = {
  0: 'None', 1: 'Gun', 2: 'Bow', 3: 'Sword', 4: 'Pistol', 5: 'Miner', 6: 'Glove', 7: 'Melee',
};
const AMMO_TYPE: Record<number, string> = {
  0: 'Bullet', 1: 'Flame', 2: 'Rocket', 3: 'None',
};

// HUD design tokens (light text on blue) — readable regardless of app theme.
const HUD_TEXT = 'hsl(var(--hud-text))';
const HUD_DIM = 'hsl(var(--hud-text-dim))';
const HUD_BRIGHT = 'hsl(var(--hud-text-bright))';

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className="flex justify-between gap-3">
      <span className="text-sm" style={{ color: HUD_DIM }}>{label}</span>
      <span className="text-sm text-right font-medium" style={{ color: HUD_BRIGHT }}>{value}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2 p-3 rounded-lg" style={{ background: 'hsl(0 0% 0% / 0.22)' }}>
      <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: HUD_BRIGHT }}>{title}</div>
      {children}
    </div>
  );
}

const yn = (v: boolean | null) => (v ? 'Yes' : null); // only show truthy flags, keep it clean
const sec = (v: number | null) => (v != null ? `${v}s` : null);
const num = (v: number | null) => (v != null ? `${v}` : null);

export function ItemDetailModal({
  item,
  isOpen,
  onClose,
}: {
  item: ItemLike | null;
  isOpen: boolean;
  onClose: () => void;
}) {
  const [stats, setStats] = useState<WeaponStats | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen || !item || item.item_number == null) {
      setStats(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    // weapon_stats isn't in the generated Database types; cast the client.
    (supabase as unknown as {
      from: (t: string) => {
        select: (c: string) => {
          eq: (k: string, v: number) => { maybeSingle: () => Promise<{ data: WeaponStats | null; error: unknown }> };
        };
      };
    })
      .from('weapon_stats')
      .select('*')
      .eq('item_number', item.item_number)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) console.error('[ItemDetail] weapon_stats query failed:', error);
        if (!cancelled) {
          setStats(data);
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [isOpen, item]);

  if (!item) return null;

  const spriteUrl = getItemSpriteUrl(item);
  const s = stats;
  const isGun = !!s?.is_gun;
  const isMelee = s?.item_type === 3 || s?.weapon_type === 7;
  const isExplosive = s?.item_type === 1 || !!s?.is_rocket_launcher;

  return (
    <Dialog open={isOpen} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        className="max-w-lg max-h-[85vh] overflow-y-auto backdrop-blur-md"
        style={{
          background: 'hsl(211 30% 24% / 0.98)',
          border: '1px solid hsl(var(--hud-border))',
          color: HUD_TEXT,
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            {spriteUrl && (
              <img
                src={spriteUrl}
                alt={item.name}
                style={{ width: 48, height: 48, objectFit: 'contain' }}
              />
            )}
            <div className="flex flex-col">
              <span className="text-base font-bold" style={{ color: HUD_BRIGHT }}>{item.name}</span>
              <span className="text-xs font-mono" style={{ color: HUD_DIM }}>
                ID# {item.item_number ?? '—'}
              </span>
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {(s?.description || item.description) && (
            <p className="text-sm italic" style={{ color: HUD_DIM }}>{s?.description || item.description}</p>
          )}

          <Section title="Identity">
            <Row label="Key" value={item.key} />
            <Row label="Category" value={item.item_category} />
            <Row label="Item type" value={s?.item_type != null ? ITEM_TYPE[s.item_type] ?? s.item_type : null} />
            <Row label="Weapon class" value={s?.weapon_type != null ? WEAPON_TYPE[s.weapon_type] ?? s.weapon_type : null} />
            <Row label="Forgeable" value={yn(s?.forgeable ?? null)} />
            <Row label="Base ID" value={num(s?.base_id ?? null)} />
            <Row label="Forge tier" value={num(s?.weapon_level ?? null)} />
            <Row label="Max stack" value={num(s?.max_stack ?? null)} />
            <Row label="Max damage" value={num(s?.max_damage ?? null)} />
          </Section>

          {isGun && (
            <Section title="Gun Stats">
              <Row label="Projectile" value={s?.projectile} />
              <Row label="Ammo type" value={s?.weapon_ammo_type != null ? AMMO_TYPE[s.weapon_ammo_type] ?? s.weapon_ammo_type : null} />
              <Row label="Fire cooldown" value={sec(s?.shoot_cooldown ?? null)} />
              <Row label="Reload time" value={sec(s?.reload_time ?? null)} />
              <Row label="Clip size" value={num(s?.ammo_clip_amount ?? null)} />
              <Row label="Bullets per shot" value={s?.bullets_per_tap ? num(s.bullets_per_tap) : null} />
              <Row label="Effective range" value={num(s?.effective_range ?? null)} />
              <Row label="Automatic" value={yn(s?.is_automatic ?? null)} />
              <Row label="Burst fire" value={yn(s?.is_burst_fire ?? null)} />
              <Row label="Shotgun" value={yn(s?.is_shotgun ?? null)} />
              <Row label="Sniper" value={yn(s?.is_sniper ?? null)} />
              <Row label="Flame attack" value={yn(s?.is_melee_flame_attack ?? null)} />
              {isExplosive && <Row label="Explosion radius" value={num(s?.explosion_radius ?? null)} />}
            </Section>
          )}

          {isMelee && (
            <Section title="Melee Stats">
              <Row label="Swing cooldown" value={sec(s?.swing_cooldown ?? null)} />
              <Row label="Reach" value={num(s?.raycast_length ?? null)} />
              <Row label="Knockback" value={num(s?.melee_knockback_distance ?? null)} />
              <Row label="Stun" value={sec(s?.melee_stun_duration ?? null)} />
            </Section>
          )}

          {isGun && (s?.horizontal_spread != null || s?.recoil_duration != null) && (
            <Section title="Handling">
              <Row label="Horizontal spread" value={num(s?.horizontal_spread ?? null)} />
              <Row label="Vertical spread" value={num(s?.vertical_spread ?? null)} />
              <Row label="Recoil duration" value={sec(s?.recoil_duration ?? null)} />
              <Row label="Zoom speed" value={num(s?.zoom_speed ?? null)} />
              <Row label="Scoped FOV" value={num(s?.scoped_fov ?? null)} />
            </Section>
          )}

          {!!s?.skin_bonuses && (
            <Section title="Special">
              <Row label="Fires by default" value={s?.default_can_fire ? 'Yes' : 'No'} />
              <pre className="text-xs whitespace-pre-wrap break-all" style={{ color: HUD_DIM }}>
                {JSON.stringify(s.skin_bonuses, null, 2)}
              </pre>
            </Section>
          )}

          {!loading && !s && (
            <p className="text-sm" style={{ color: HUD_DIM }}>No weapon stats for this item.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
