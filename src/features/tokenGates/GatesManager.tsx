// GatesManager — admin UI to author token-gate rules: "hold >= X of a coin" or "own >= N matching
// Wax NFTs" -> a named bonus. Evaluated by useTokenGates against server-synced holdings. See
// docs/CURRENCY_LEDGER_PLAN.md.
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { displaySymbol, networkLabel, type TokenAsset } from '@/features/wallet/types';
import type { TokenGate } from './types';

interface VariantRow { id: string; asset_id: string | null; display_name: string; name: string; network: string; ticker_symbol: string | null; }
interface AssetRow extends TokenAsset { is_active?: boolean }

const blankToken = { name: '', gate_kind: 'token' as const, token_theme_id: '', min_amount: '', bonus_key: '', bonus_value: '' };
const blankNft = { name: '', gate_kind: 'nft' as const, nft_collection: '', nft_schema: '', nft_template_id: '', nft_min_count: '1', bonus_key: '', bonus_value: '' };

export function GatesManager() {
  const [gates, setGates] = useState<TokenGate[]>([]);
  const [coins, setCoins] = useState<{ id: string; label: string }[]>([]);
  const [kind, setKind] = useState<'token' | 'nft'>('token');
  const [form, setForm] = useState<Record<string, string>>({ ...blankToken });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [gRes, vRes, aRes] = await Promise.all([
      supabase.from('token_gates' as never).select('*').order('sort_order'),
      supabase.from('token_themes').select('id, asset_id, display_name, name, network, ticker_symbol').eq('is_active', true),
      supabase.from('token_assets' as never).select('*'),
    ]);
    setGates((gRes.data as unknown as TokenGate[]) ?? []);
    const assetById = new Map(((aRes.data as unknown as AssetRow[]) ?? []).map((a) => [a.id, a]));
    setCoins(((vRes.data as unknown as VariantRow[]) ?? []).map((v) => {
      const asset = (v.asset_id && assetById.get(v.asset_id)) || { id: v.id, symbol: v.ticker_symbol || v.name.toUpperCase(), display_name: v.display_name, kind: 'coin' as const, logo_url: null, sort_order: 0 };
      return { id: v.id, label: `${displaySymbol(asset)} — ${asset.display_name} (${networkLabel(v.network)})` };
    }));
  }, []);
  useEffect(() => { void load(); }, [load]);

  const setF = (k: string, v: string) => setForm((m) => ({ ...m, [k]: v }));
  const switchKind = (k: 'token' | 'nft') => { setKind(k); setForm(k === 'token' ? { ...blankToken } : { ...blankNft }); };

  const add = async () => {
    if (!form.name || !form.bonus_key) return;
    setBusy(true);
    try {
      const row: Record<string, unknown> = {
        name: form.name, gate_kind: kind, bonus_key: form.bonus_key, bonus_value: parseFloat(form.bonus_value) || 0,
      };
      if (kind === 'token') {
        if (!form.token_theme_id) { setBusy(false); return; }
        row.token_theme_id = form.token_theme_id; row.min_amount = parseFloat(form.min_amount) || 0;
      } else {
        row.nft_collection = form.nft_collection || null; row.nft_schema = form.nft_schema || null;
        row.nft_template_id = form.nft_template_id ? parseInt(form.nft_template_id, 10) : null;
        row.nft_min_count = parseInt(form.nft_min_count, 10) || 1;
      }
      await supabase.from('token_gates' as never).insert(row as never);
      setForm(kind === 'token' ? { ...blankToken } : { ...blankNft });
      await load();
    } finally { setBusy(false); }
  };

  const toggle = async (g: TokenGate) => { await supabase.from('token_gates' as never).update({ is_active: !g.is_active } as never).eq('id', g.id); await load(); };
  const del = async (id: string) => { await supabase.from('token_gates' as never).delete().eq('id', id); await load(); };

  const coinLabel = (id: string | null) => coins.find((c) => c.id === id)?.label ?? id ?? '';

  return (
    <div className="space-y-3 p-1">
      <p className="text-xs text-foreground/70">
        Grant a bonus when a player holds enough of a coin or owns the right Wax NFT. Bonuses fire off
        server-synced holdings (a client can't fake them). <b>bonus_key</b> is what the game reads
        (e.g. <code>xp_mult</code>, <code>damage_mult</code>, <code>access:vault</code>).
      </p>

      {/* Existing gates */}
      {gates.map((g) => (
        <Card key={g.id} className="p-3 flex items-center justify-between gap-2">
          <div className="text-sm text-foreground">
            <div className="flex items-center gap-2">
              <span className="font-semibold">{g.name}</span>
              <Badge variant={g.is_active ? 'default' : 'outline'}>{g.is_active ? 'active' : 'off'}</Badge>
            </div>
            <div className="text-foreground/75 text-xs">
              {g.gate_kind === 'token'
                ? `hold ≥ ${g.min_amount} of ${coinLabel(g.token_theme_id)}`
                : `own ≥ ${g.nft_min_count} NFT [${g.nft_collection ?? 'any'}${g.nft_schema ? '/' + g.nft_schema : ''}${g.nft_template_id ? '#' + g.nft_template_id : ''}]`}
              {' → '}<code>{g.bonus_key}</code> += {g.bonus_value}
            </div>
          </div>
          <div className="flex gap-1 shrink-0">
            <Button size="sm" variant="outline" onClick={() => toggle(g)}>{g.is_active ? 'Disable' : 'Enable'}</Button>
            <Button size="sm" variant="ghost" onClick={() => del(g.id)}>✕</Button>
          </div>
        </Card>
      ))}
      {!gates.length && <div className="text-sm text-foreground/70">No gates yet.</div>}

      {/* Add a gate */}
      <Card className="p-3 space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-foreground">New gate</span>
          <select className="text-xs border rounded px-1 py-1 bg-background ml-auto" value={kind} onChange={(e) => switchKind(e.target.value as 'token' | 'nft')}>
            <option value="token">Token (hold ≥)</option>
            <option value="nft">NFT (own ≥)</option>
          </select>
        </div>
        <Input className="h-8 text-sm" placeholder="name (e.g. TLM holder)" value={form.name} onChange={(e) => setF('name', e.target.value)} />
        {kind === 'token' ? (
          <div className="flex gap-2">
            <select className="text-xs border rounded px-1 bg-background flex-1" value={form.token_theme_id} onChange={(e) => setF('token_theme_id', e.target.value)}>
              <option value="">— coin —</option>
              {coins.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
            <Input className="h-8 text-sm w-28" type="number" placeholder="min amount" value={form.min_amount} onChange={(e) => setF('min_amount', e.target.value)} />
          </div>
        ) : (
          <div className="flex gap-2 flex-wrap">
            <Input className="h-8 text-sm flex-1" placeholder="collection (e.g. alien.worlds)" value={form.nft_collection} onChange={(e) => setF('nft_collection', e.target.value)} />
            <Input className="h-8 text-sm w-28" placeholder="schema (opt)" value={form.nft_schema} onChange={(e) => setF('nft_schema', e.target.value)} />
            <Input className="h-8 text-sm w-28" placeholder="template (opt)" value={form.nft_template_id} onChange={(e) => setF('nft_template_id', e.target.value)} />
            <Input className="h-8 text-sm w-20" type="number" placeholder="min #" value={form.nft_min_count} onChange={(e) => setF('nft_min_count', e.target.value)} />
          </div>
        )}
        <div className="flex gap-2">
          <Input className="h-8 text-sm flex-1" placeholder="bonus_key (e.g. xp_mult)" value={form.bonus_key} onChange={(e) => setF('bonus_key', e.target.value)} />
          <Input className="h-8 text-sm w-28" type="number" placeholder="value" value={form.bonus_value} onChange={(e) => setF('bonus_value', e.target.value)} />
          <Button size="sm" disabled={busy} onClick={add}>Add</Button>
        </div>
      </Card>
    </div>
  );
}
