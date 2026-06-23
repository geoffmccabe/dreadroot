// PointsAdmin — Admin → Coins → POINTS (first tab). Manage in-game point systems (DP = Dread Points,
// later $PINK / $SIEGE) and how USD + each crypto converts INTO them, set manually or algorithmically.
// A point system is a token_asset(kind='points') + an internal token_theme. Conversions are one-way IN
// (the closed-loop rule — nothing converts OUT until GoBanq). See docs/DREAD_POINTS_PLAN.md.
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';

interface Asset { id: string; symbol: string; display_name: string; kind: string; usd_price: number | null; is_active: boolean; sort_order: number; }
interface Conversion { id: string; to_asset_id: string; from_asset_id: string | null; mode: 'algorithmic' | 'manual'; manual_rate: number | null; enabled: boolean; }

const fmt = (n: number | null) => n == null || !isFinite(n) ? '—' : (n >= 1 ? n.toLocaleString(undefined, { maximumFractionDigits: 4 }) : n.toPrecision(4));

export function PointsAdmin() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [conversions, setConversions] = useState<Conversion[]>([]);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newSym, setNewSym] = useState('');
  const [draftUsd, setDraftUsd] = useState<Record<string, string>>({}); // asset_id -> in-progress usd input

  const load = useCallback(async () => {
    const [{ data: a }, { data: c }] = await Promise.all([
      supabase.from('token_assets' as never).select('id,symbol,display_name,kind,usd_price,is_active,sort_order').order('sort_order'),
      supabase.from('currency_conversions' as never).select('*'),
    ]);
    setAssets((a as unknown as Asset[]) ?? []);
    setConversions((c as unknown as Conversion[]) ?? []);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const points = assets.filter((a) => a.kind === 'points');
  const sources = assets.filter((a) => a.kind !== 'points' && a.is_active);

  const setUsd = async (assetId: string, raw: string) => {
    const v = parseFloat(raw);
    if (Number.isNaN(v) || v <= 0) return;
    await supabase.from('token_assets' as never).update({ usd_price: v, updated_at: new Date().toISOString() } as never).eq('id', assetId);
    await load();
  };

  const convFor = (toId: string, fromId: string | null) => conversions.find((c) => c.to_asset_id === toId && c.from_asset_id === fromId);
  const saveConv = async (toId: string, fromId: string | null, patch: Partial<Conversion>) => {
    const existing = convFor(toId, fromId);
    if (existing) {
      await supabase.from('currency_conversions' as never).update({ ...patch, updated_at: new Date().toISOString() } as never).eq('id', existing.id);
    } else {
      await supabase.from('currency_conversions' as never).insert({ to_asset_id: toId, from_asset_id: fromId, mode: 'algorithmic', enabled: true, manual_rate: null, ...patch } as never);
    }
    await load();
  };

  const addPointSystem = async () => {
    const name = newName.trim(), sym = newSym.trim().toUpperCase();
    if (!name || !sym) { alert('Name and symbol required.'); return; }
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    const { data: asset, error } = await supabase.from('token_assets' as never)
      .insert({ symbol: sym, display_name: name, kind: 'points', usd_price: 0.0001, is_active: true, sort_order: 0 } as never)
      .select().single();
    if (error) { alert(error.message); return; }
    const { error: tErr } = await supabase.from('token_themes')
      .insert({ name: slug, display_name: name, ticker_symbol: sym, network: 'internal', is_active: true, asset_id: (asset as { id: string }).id } as never);
    if (tErr) { alert(tErr.message); return; }
    setNewName(''); setNewSym(''); setAdding(false); await load();
  };

  return (
    <div className="space-y-4 p-1">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-bold text-foreground">Point Systems</div>
          <div className="text-xs text-foreground/60">In-game spendable points. Everything converts <b>in</b>; nothing converts out (until GoBanq).</div>
        </div>
        <Button size="sm" variant="outline" onClick={() => setAdding((v) => !v)}>+ Add point system</Button>
      </div>

      {adding && (
        <Card className="p-3 flex items-end gap-2 flex-wrap">
          <div className="space-y-1"><div className="text-xs text-foreground/70">Name</div><Input className="h-8 w-44" placeholder="Pink Points" value={newName} onChange={(e) => setNewName(e.target.value)} /></div>
          <div className="space-y-1"><div className="text-xs text-foreground/70">Symbol</div><Input className="h-8 w-24" placeholder="PINK" value={newSym} onChange={(e) => setNewSym(e.target.value)} /></div>
          <Button size="sm" onClick={addPointSystem}>Create</Button>
          <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
        </Card>
      )}

      {points.map((pt) => {
        const dpUsd = pt.usd_price ?? 0;
        return (
          <Card key={pt.id} className="p-4 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <span className="font-bold text-foreground">{pt.display_name}</span>
                <Badge>{pt.symbol}</Badge>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-foreground/70">USD value of 1 {pt.symbol}: $</span>
                <Input className="h-8 w-28 text-sm" type="number" step="0.0001"
                  value={draftUsd[pt.id] ?? (pt.usd_price ?? '')}
                  onChange={(e) => setDraftUsd((m) => ({ ...m, [pt.id]: e.target.value }))}
                  onBlur={(e) => setUsd(pt.id, e.target.value)} />
                <span className="text-xs text-foreground/50">(1¢ = ${(0.01).toFixed(2)} → {dpUsd > 0 ? fmt(0.01 / dpUsd) : '—'} {pt.symbol})</span>
              </div>
            </div>

            <div className="border-t border-foreground/10 pt-2">
              <div className="text-xs font-bold uppercase tracking-wide text-foreground/70 mb-2">Conversions into {pt.symbol}</div>
              <div className="space-y-1.5">
                <ConvRow key="usd" label="USD" isUsd point={pt} conv={convFor(pt.id, null)} saveConv={(p) => saveConv(pt.id, null, p)} />
                {sources.map((src) => (
                  <ConvRow key={src.id} label={src.symbol} source={src} point={pt}
                    conv={convFor(pt.id, src.id)}
                    saveConv={(p) => saveConv(pt.id, src.id, p)}
                    setSrcUsd={(raw) => setUsd(src.id, raw)} />
                ))}
                {!sources.length && <div className="text-xs text-foreground/50">No other currencies yet — add coins/tokens in the Pools tab to convert from.</div>}
              </div>
            </div>
          </Card>
        );
      })}
      {!points.length && <div className="text-sm text-foreground/70">No point systems yet — click “+ Add point system”. (DP seeds from the migration.)</div>}
    </div>
  );
}

function ConvRow({ label, isUsd, source, point, conv, saveConv, setSrcUsd }: {
  label: string; isUsd?: boolean; source?: Asset; point: Asset;
  conv?: Conversion; saveConv: (patch: Partial<Conversion>) => void; setSrcUsd?: (raw: string) => void;
}) {
  const [draftRate, setDraftRate] = useState('');
  const [draftSrcUsd, setDraftSrcUsd] = useState('');
  const dpUsd = point.usd_price ?? 0;
  const srcUsd = isUsd ? 1 : (source?.usd_price ?? null);
  const mode = conv?.mode ?? 'algorithmic';
  const enabled = conv?.enabled ?? false;
  const algoRate = (srcUsd != null && dpUsd > 0) ? srcUsd / dpUsd : null;
  const rate = mode === 'manual' ? (conv?.manual_rate ?? null) : algoRate;

  return (
    <div className="flex items-center gap-2 flex-wrap text-sm">
      <span className="w-16 font-medium text-foreground/80">{label}</span>
      <Switch checked={enabled} onCheckedChange={(v) => saveConv({ enabled: v })} />
      <span className="text-xs text-foreground/50 w-10">{enabled ? 'on' : 'off'}</span>

      <span className="text-xs text-foreground/60">Manual</span>
      <Switch checked={mode === 'manual'} onCheckedChange={(v) => saveConv({ mode: v ? 'manual' : 'algorithmic' })} />

      {mode === 'algorithmic' && !isUsd && (
        <span className="flex items-center gap-1 text-xs text-foreground/60">
          USD/{label}: $
          <Input className="h-7 w-24 text-xs" type="number" step="any" placeholder={source?.usd_price?.toString() ?? '0'}
            value={draftSrcUsd} onChange={(e) => setDraftSrcUsd(e.target.value)}
            onBlur={(e) => { if (e.target.value) setSrcUsd?.(e.target.value); setDraftSrcUsd(''); }} />
        </span>
      )}
      {mode === 'manual' && (
        <span className="flex items-center gap-1 text-xs text-foreground/60">
          <Input className="h-7 w-28 text-xs" type="number" step="any" placeholder={conv?.manual_rate?.toString() ?? '0'}
            value={draftRate} onChange={(e) => setDraftRate(e.target.value)}
            onBlur={(e) => { if (e.target.value) saveConv({ manual_rate: parseFloat(e.target.value) }); setDraftRate(''); }} />
          {point.symbol} per 1 {label}
        </span>
      )}

      <span className="ml-auto text-xs text-foreground/70 tabular-nums">1 {label} = <b className="text-foreground">{fmt(rate)}</b> {point.symbol}</span>
    </div>
  );
}
