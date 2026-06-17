/**
 * Coin Drops editor — drop-in admin section for a monster tier. See docs/COIN_DROPS.md.
 *
 * Game-scoped + self-contained: it loads/saves its own row in `monster_coin_drops`
 * keyed (active-game data key, enemyBase, tier), so each game configures drops independently even
 * though the monster def tables are shared. Embed in any enemy design panel:
 *   <CoinDropsEditor enemyBase="shombie" tier={selectedTier} />
 */
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Plus, Trash2, Coins, Save } from 'lucide-react';
import { useActiveGame } from '@/config/activeGame';
import { gameDataKey } from '@/config/gameRegistry';
import type { CoinDropConfig } from './types';

interface CoinTheme { id: string; label: string; }

export function CoinDropsEditor({ enemyBase, tier }: { enemyBase: string; tier: number }) {
  const gameKey = gameDataKey(useActiveGame());
  const [themes, setThemes] = useState<CoinTheme[]>([]);
  const [rows, setRows] = useState<CoinDropConfig[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  // Coin types for the dropdown.
  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase
        .from('token_themes' as never)
        .select('id, display_name, coin_name, is_active')
        .order('display_name');
      if (!alive || !data) return;
      setThemes((data as unknown as Record<string, unknown>[])
        .filter(t => t.is_active)
        .map(t => ({ id: t.id as string, label: (t.display_name || t.coin_name || 'Coin') as string })));
    })();
    return () => { alive = false; };
  }, []);

  // Load this game's config for (enemyBase, tier).
  useEffect(() => {
    let alive = true;
    setDirty(false);
    (async () => {
      const { data } = await supabase
        .from('monster_coin_drops' as never)
        .select('coin_drops')
        .eq('game', gameKey).eq('enemy_base', enemyBase).eq('tier', tier)
        .maybeSingle();
      if (!alive) return;
      setRows(((data as unknown as { coin_drops?: CoinDropConfig[] })?.coin_drops) ?? []);
    })();
    return () => { alive = false; };
  }, [enemyBase, tier, gameKey]);

  const update = (i: number, patch: Partial<CoinDropConfig>) => {
    setRows(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r))); setDirty(true);
  };
  const remove = (i: number) => { setRows(rows.filter((_, idx) => idx !== i)); setDirty(true); };
  const add = () => {
    setRows([...rows, { coin: themes[0]?.id ?? '', chance: 50, min: 1, max: 5, source: 'game_pool' }]);
    setDirty(true);
  };
  const num = (v: string, f = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : f; };

  const save = async () => {
    setSaving(true);
    const { error } = await supabase.from('monster_coin_drops' as never).upsert({
      game: gameKey, enemy_base: enemyBase, tier, coin_drops: rows, updated_at: new Date().toISOString(),
    } as never, { onConflict: 'game,enemy_base,tier' } as never);
    setSaving(false);
    if (error) { toast.error(`Coin drops save failed: ${error.message}`); return; }
    toast.success(`Coin drops saved (${enemyBase} T${tier})`);
    setDirty(false);
  };

  return (
    <div className="rounded border p-3 space-y-2">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Coins className="h-4 w-4 text-yellow-400" /> Coin Drops
        <span className="text-xs font-normal text-muted-foreground">each row rolls independently on a kill</span>
        <Button size="sm" className="h-7 ml-auto" onClick={save} disabled={!dirty || saving}>
          <Save className="h-3 w-3 mr-1" /> {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>

      {rows.length === 0 && <div className="text-xs text-muted-foreground py-1">No coin drops. Add one below.</div>}

      {rows.length > 0 && (
        <div className="space-y-1">
          <div className="grid grid-cols-[1fr_70px_60px_60px_28px] gap-2 text-[10px] uppercase text-muted-foreground px-1">
            <span>Coin</span><span>Chance %</span><span>Min</span><span>Max</span><span></span>
          </div>
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-[1fr_70px_60px_60px_28px] gap-2 items-center">
              <select className="h-8 rounded border bg-background px-2 text-sm" value={r.coin}
                onChange={(e) => update(i, { coin: e.target.value })}>
                {themes.length === 0 && <option value="">Loading…</option>}
                {themes.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
              <Input type="number" min={0} max={100} step="0.5" value={r.chance}
                onChange={(e) => update(i, { chance: Math.max(0, Math.min(100, num(e.target.value))) })} />
              <Input type="number" min={1} value={r.min}
                onChange={(e) => { const min = Math.max(1, Math.round(num(e.target.value, 1))); update(i, { min, max: Math.max(min, r.max) }); }} />
              <Input type="number" min={1} value={r.max}
                onChange={(e) => update(i, { max: Math.max(r.min, Math.round(num(e.target.value, 1))) })} />
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => remove(i)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <Button variant="outline" size="sm" className="h-7" onClick={add} disabled={themes.length === 0}>
        <Plus className="h-3 w-3 mr-1" /> Add coin drop
      </Button>
    </div>
  );
}
