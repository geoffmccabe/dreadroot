import React, { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getItemSpriteUrl } from '@/lib/itemSprite';

// Resolved sound (looked up from the game_sounds catalog by sound_key).
interface ResolvedSound { url: string; bytes: number | null; }

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
  reticle_type: number | null;
  is_automatic: boolean | null;
  is_burst_fire: boolean | null;
  is_shotgun: boolean | null;
  is_sniper: boolean | null;
  is_rocket_launcher: boolean | null;
  is_melee_flame_attack: boolean | null;
  fire_sound: string | null;
  empty_sound: string | null;
  reload_sound: string | null;
  is_melee: boolean | null;
  swing_cooldown: number | null;
  raycast_length: number | null;
  melee_hit_flag: number | null;
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

const DASH = '—';

// Formatters — everything renders, null/empty shows as an em dash.
const txt = (v: unknown) => (v === null || v === undefined || v === '' ? DASH : String(v));
const boolv = (v: boolean | null | undefined) => (v == null ? DASH : v ? 'Yes' : 'No');
const secs = (v: number | null | undefined) => (v == null ? DASH : `${v}s`);
const enumv = (map: Record<number, string>, v: number | null | undefined) =>
  v == null ? DASH : map[v] ?? String(v);

function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 items-center min-h-[22px]">
      <span className="text-sm" style={{ color: HUD_DIM }}>{label}</span>
      <span className="text-sm text-right font-medium" style={{ color: HUD_BRIGHT }}>{value}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5 p-3 rounded-lg" style={{ background: 'hsl(0 0% 0% / 0.22)' }}>
      <div className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: HUD_BRIGHT }}>{title}</div>
      {children}
    </div>
  );
}

// A clickable sound: shows filename + size, plays the mp3 on click.
// `name` is the weapon_stats sound key; `sound` is its resolved game_sounds row.
function SoundButton({ name, sound }: { name: string | null | undefined; sound?: ResolvedSound }) {
  if (!name || name === '0' || !sound) {
    return <span className="text-sm font-medium" style={{ color: HUD_BRIGHT }}>{DASH}</span>;
  }
  const play = () => {
    const a = new Audio(sound.url);
    a.volume = 0.7;
    a.play().catch(() => { /* autoplay/user-gesture guard */ });
  };
  return (
    <button
      onClick={play}
      className="flex items-center gap-2 rounded px-2 py-1 text-xs transition-colors"
      style={{
        background: 'hsl(var(--hud-bg-hover))',
        border: '1px solid hsl(var(--hud-border))',
        color: HUD_BRIGHT,
      }}
    >
      <span aria-hidden>▶</span>
      <span className="font-mono">{name}.mp3</span>
      {sound.bytes != null && <span style={{ color: HUD_DIM }}>{fmtBytes(sound.bytes)}</span>}
    </button>
  );
}

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
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [soundMap, setSoundMap] = useState<Record<string, ResolvedSound>>({});

  useEffect(() => {
    setDims(null);
    setSoundMap({});
    if (!isOpen || !item || item.item_number == null) {
      setStats(null);
      return;
    }
    let cancelled = false;
    setLoading(true);

    // weapon_stats + game_sounds.file_bytes aren't in the generated types; cast.
    const sb = supabase as unknown as {
      from: (t: string) => {
        select: (c: string) => {
          eq: (k: string, v: number) => { maybeSingle: () => Promise<{ data: WeaponStats | null; error: unknown }> };
          in: (k: string, v: string[]) => Promise<{
            data: Array<{ sound_key: string; sound_url: string; file_bytes: number | null }> | null;
          }>;
        };
      };
    };

    (async () => {
      const { data: statRow, error } = await sb
        .from('weapon_stats').select('*').eq('item_number', item.item_number!).maybeSingle();
      if (error) console.error('[ItemDetail] weapon_stats query failed:', error);
      if (cancelled) return;
      setStats(statRow);
      setLoading(false);

      // Resolve this weapon's sounds against the canonical game_sounds catalog.
      const keys = [statRow?.fire_sound, statRow?.empty_sound, statRow?.reload_sound]
        .filter((k): k is string => !!k && k !== '0');
      if (keys.length === 0) return;
      const { data: sounds } = await sb
        .from('game_sounds').select('sound_key,sound_url,file_bytes').in('sound_key', keys);
      if (cancelled) return;
      const map: Record<string, ResolvedSound> = {};
      for (const r of sounds || []) map[r.sound_key] = { url: r.sound_url, bytes: r.file_bytes ?? null };
      setSoundMap(map);
    })();

    return () => { cancelled = true; };
  }, [isOpen, item]);

  if (!item) return null;

  const spriteUrl = getItemSpriteUrl(item);
  const s = stats;

  return (
    <Dialog open={isOpen} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        className="max-w-2xl max-h-[88vh] overflow-y-auto backdrop-blur-md"
        style={{
          background: 'hsl(211 30% 24% / 0.98)',
          border: '1px solid hsl(var(--hud-border))',
          color: HUD_TEXT,
        }}
      >
        <DialogHeader>
          <DialogTitle asChild>
            <div className="flex gap-4 items-start">
              {/* Sprite at native size (capped 512) + dimension label at bottom-right */}
              {spriteUrl && (
                <div style={{ flexShrink: 0 }}>
                  <img
                    src={spriteUrl}
                    alt={item.name}
                    onLoad={(e) => setDims({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
                    style={{ maxWidth: 512, maxHeight: 512, display: 'block', objectFit: 'contain' }}
                  />
                  <div
                    className="font-mono"
                    style={{ textAlign: 'right', fontSize: 11, color: HUD_DIM, marginTop: 2 }}
                  >
                    {dims ? `${dims.w}x${dims.h}px` : ''}
                  </div>
                </div>
              )}
              <div className="flex flex-col min-w-0">
                <span className="font-bold" style={{ color: HUD_BRIGHT, fontSize: '1.25rem', lineHeight: 1.2 }}>
                  {item.name}
                </span>
                <span className="font-mono" style={{ color: HUD_DIM, fontSize: 12, marginTop: 8 }}>
                  ID# {item.item_number ?? DASH}
                </span>
                {(s?.description || item.description) && (
                  <p className="text-sm italic" style={{ color: HUD_DIM, marginTop: 10 }}>
                    {s?.description || item.description}
                  </p>
                )}
              </div>
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <Section title="Identity">
            <Row label="Key" value={txt(item.key)} />
            <Row label="Category" value={txt(item.item_category)} />
            <Row label="Item type" value={enumv(ITEM_TYPE, s?.item_type)} />
            <Row label="Weapon class" value={enumv(WEAPON_TYPE, s?.weapon_type)} />
            <Row label="Ammo type" value={enumv(AMMO_TYPE, s?.weapon_ammo_type)} />
            <Row label="Forgeable" value={boolv(s?.forgeable)} />
            <Row label="Base ID" value={txt(s?.base_id)} />
            <Row label="Forge tier" value={txt(s?.weapon_level)} />
            <Row label="Max stack" value={txt(s?.max_stack)} />
            <Row label="Wear slot" value={txt(s?.wear_slot)} />
            <Row label="Throwable" value={boolv(s?.is_throwable)} />
            <Row label="Equip duration" value={secs(s?.equip_duration)} />
            <Row label="Max damage" value={txt(s?.max_damage)} />
          </Section>

          <Section title="Gun Stats">
            <Row label="Is gun" value={boolv(s?.is_gun)} />
            <Row label="Projectile" value={txt(s?.projectile)} />
            <Row label="Clip size" value={txt(s?.ammo_clip_amount)} />
            <Row label="Bullets per shot" value={txt(s?.bullets_per_tap)} />
            <Row label="Fire cooldown" value={secs(s?.shoot_cooldown)} />
            <Row label="Reload time" value={secs(s?.reload_time)} />
            <Row label="Time between shots" value={secs(s?.time_between_shots)} />
            <Row label="Effective range" value={txt(s?.effective_range)} />
            <Row label="Explosion radius" value={txt(s?.explosion_radius)} />
            <Row label="Reticle type" value={txt(s?.reticle_type)} />
            <Row label="Automatic" value={boolv(s?.is_automatic)} />
            <Row label="Burst fire" value={boolv(s?.is_burst_fire)} />
            <Row label="Shotgun" value={boolv(s?.is_shotgun)} />
            <Row label="Sniper" value={boolv(s?.is_sniper)} />
            <Row label="Rocket launcher" value={boolv(s?.is_rocket_launcher)} />
            <Row label="Flame attack" value={boolv(s?.is_melee_flame_attack)} />
          </Section>

          <Section title="Sounds">
            <Row label="Fire sound" value={<SoundButton name={s?.fire_sound} sound={s?.fire_sound ? soundMap[s.fire_sound] : undefined} />} />
            <Row label="Empty sound" value={<SoundButton name={s?.empty_sound} sound={s?.empty_sound ? soundMap[s.empty_sound] : undefined} />} />
            <Row label="Reload sound" value={<SoundButton name={s?.reload_sound} sound={s?.reload_sound ? soundMap[s.reload_sound] : undefined} />} />
          </Section>

          <Section title="Melee Stats">
            <Row label="Is melee" value={boolv(s?.is_melee)} />
            <Row label="Swing cooldown" value={secs(s?.swing_cooldown)} />
            <Row label="Reach" value={txt(s?.raycast_length)} />
            <Row label="Hit flag" value={txt(s?.melee_hit_flag)} />
            <Row label="Knockback" value={txt(s?.melee_knockback_distance)} />
            <Row label="Stun" value={secs(s?.melee_stun_duration)} />
          </Section>

          <Section title="Handling">
            <Row label="Horizontal spread" value={txt(s?.horizontal_spread)} />
            <Row label="Vertical spread" value={txt(s?.vertical_spread)} />
            <Row label="Recoil duration" value={secs(s?.recoil_duration)} />
            <Row label="Zoom speed" value={txt(s?.zoom_speed)} />
            <Row label="Scoped FOV" value={txt(s?.scoped_fov)} />
          </Section>

          <Section title="Special">
            <Row label="Fires by default" value={boolv(s?.default_can_fire)} />
            {s?.skin_bonuses ? (
              <pre className="text-xs whitespace-pre-wrap break-all" style={{ color: HUD_DIM }}>
                {JSON.stringify(s.skin_bonuses, null, 2)}
              </pre>
            ) : (
              <Row label="Skin bonuses" value={DASH} />
            )}
          </Section>

          {!loading && !s && (
            <p className="text-sm" style={{ color: HUD_DIM }}>
              No weapon_stats row for this item — fields above show catalog data only.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
