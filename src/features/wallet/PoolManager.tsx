// PoolManager — admin tool to fund each coin's reserve pool from outside the game. Earning draws
// from these pools (funded = hard-capped; minted = uncapped game-generated, e.g. points). Lists
// every coin VARIANT (token_theme) with its pool balance / funded / dispensed + a top-up control.
// See docs/CURRENCY_LEDGER_PLAN.md.
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { fundPool } from '@/services/worldStore';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { networkLabel } from './types';

interface VariantRow { id: string; asset_id: string | null; display_name: string; name: string; network: string; ticker_symbol: string | null; }
interface AssetRow { id: string; symbol: string; }
interface PoolRow { token_theme_id: string; source: 'funded' | 'minted'; balance: number; total_funded: number; total_dispensed: number; }

const fmt = (n: number) => (n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 4 });

export function PoolManager() {
  const [variants, setVariants] = useState<VariantRow[]>([]);
  const [assets, setAssets] = useState<Map<string, AssetRow>>(new Map());
  const [pools, setPools] = useState<Map<string, PoolRow>>(new Map());
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [source, setSource] = useState<Record<string, 'funded' | 'minted'>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [vRes, aRes, pRes] = await Promise.all([
      supabase.from('token_themes').select('id, asset_id, display_name, name, network, ticker_symbol').eq('is_active', true),
      supabase.from('token_assets' as never).select('id, symbol'),
      supabase.from('token_pools' as never).select('token_theme_id, source, balance, total_funded, total_dispensed'),
    ]);
    setVariants((vRes.data as unknown as VariantRow[]) ?? []);
    setAssets(new Map(((aRes.data as unknown as AssetRow[]) ?? []).map((a) => [a.id, a])));
    setPools(new Map(((pRes.data as unknown as PoolRow[]) ?? []).map((p) => [p.token_theme_id, p])));
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const onFund = async (themeId: string) => {
    const amt = parseFloat(amounts[themeId] ?? '');
    if (!amt || amt <= 0) return;
    setBusy(themeId);
    try {
      await fundPool(themeId, amt, source[themeId] ?? 'funded');
      setAmounts((m) => ({ ...m, [themeId]: '' }));
      await load();
    } finally { setBusy(null); }
  };

  if (loading) return <div className="text-sm text-muted-foreground p-4">Loading pools…</div>;

  return (
    <div className="space-y-3 p-1">
      <p className="text-xs text-muted-foreground">
        Each coin earned in-game is drawn from its pool. <b>Funded</b> pools are hard-capped (fund them
        with real coins from outside). <b>Minted</b> pools are uncapped (game-generated, e.g. points).
        A coin with no pool still mints freely until you fund it.
      </p>
      {variants.map((v) => {
        const pool = pools.get(v.id);
        const symbol = (v.asset_id && assets.get(v.asset_id)?.symbol) || v.ticker_symbol || v.name.toUpperCase();
        const src = pool?.source ?? source[v.id] ?? 'funded';
        return (
          <Card key={v.id} className="p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-semibold">{symbol}</span>
                <span className="text-xs text-muted-foreground">{networkLabel(v.network)}</span>
                {pool ? (
                  <Badge variant={src === 'minted' ? 'secondary' : 'default'}>{src}</Badge>
                ) : (
                  <Badge variant="outline">no pool — mints freely</Badge>
                )}
              </div>
              <div className="text-right">
                <div className="font-bold tabular-nums">{fmt(pool?.balance ?? 0)}</div>
                <div className="text-[10px] text-muted-foreground">in reserve</div>
              </div>
            </div>
            {pool && (
              <div className="text-[11px] text-muted-foreground flex gap-4">
                <span>funded {fmt(pool.total_funded)}</span>
                <span>dispensed {fmt(pool.total_dispensed)}</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              {!pool && (
                <select
                  className="text-xs border rounded px-1 py-1 bg-background"
                  value={source[v.id] ?? 'funded'}
                  onChange={(e) => setSource((m) => ({ ...m, [v.id]: e.target.value as 'funded' | 'minted' }))}
                >
                  <option value="funded">funded</option>
                  <option value="minted">minted</option>
                </select>
              )}
              <Input
                type="number" min="0" placeholder="amount to add"
                value={amounts[v.id] ?? ''}
                onChange={(e) => setAmounts((m) => ({ ...m, [v.id]: e.target.value }))}
                className="h-8 text-sm"
              />
              <Button size="sm" disabled={busy === v.id} onClick={() => onFund(v.id)}>
                {busy === v.id ? '…' : 'Fund'}
              </Button>
            </div>
          </Card>
        );
      })}
      {!variants.length && <div className="text-sm text-muted-foreground">No coins defined yet.</div>}
    </div>
  );
}
