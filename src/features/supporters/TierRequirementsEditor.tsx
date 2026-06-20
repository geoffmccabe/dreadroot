// TierRequirementsEditor — the REQUIREMENTS sub-panel of a supporter tier. Each row is a token or
// NFT gate with a per-row OR/AND switch (OR = this alone qualifies; AND = part of the must-meet-all
// set). A user qualifies for the tier by holdings if any OR row is met or all AND rows are met
// (paying the subscription is always an alternative). See docs/SUPPORTER_TIERS_PLAN.md.
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { lookupNftName } from './nftLookup';
import type { SupporterRequirement } from './types';

const NFT_CHAINS = ['ethereum', 'wax', 'solana', 'base', 'bsc', 'polygon'];

export function TierRequirementsEditor({ tierId, coins }: { tierId: string; coins: { id: string; label: string }[] }) {
  const [reqs, setReqs] = useState<SupporterRequirement[]>([]);
  const [kind, setKind] = useState<'token' | 'nft'>('token');
  const [form, setForm] = useState<Record<string, string>>({ match_mode: 'or', token_theme_id: '', min_amount: '', nft_chain: 'ethereum', nft_collection: '', nft_name: '', nft_schema: '', nft_template_id: '', nft_min_count: '1' });
  const [looking, setLooking] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from('supporter_requirements' as never).select('*').eq('tier_id', tierId).order('sort_order');
    setReqs((data as unknown as SupporterRequirement[]) ?? []);
  }, [tierId]);
  useEffect(() => { void load(); }, [load]);

  const setF = (k: string, v: string) => setForm((m) => ({ ...m, [k]: v }));

  // Auto-fill the NFT collection name from the SSO contract registry when a contract is entered.
  const lookupName = async () => {
    if (kind !== 'nft' || !form.nft_collection.trim()) return;
    setLooking(true);
    try {
      const res = await lookupNftName(form.nft_chain, form.nft_collection);
      if (res?.found && res.name) setForm((m) => ({ ...m, nft_name: res.name as string }));
    } finally { setLooking(false); }
  };

  const add = async () => {
    setBusy(true);
    try {
      const row: Record<string, unknown> = { tier_id: tierId, match_mode: form.match_mode || 'or', gate_kind: kind };
      if (kind === 'token') {
        if (!form.token_theme_id) { setBusy(false); return; }
        row.token_theme_id = form.token_theme_id; row.min_amount = parseFloat(form.min_amount) || 0;
      } else {
        if (!form.nft_collection.trim()) { setBusy(false); return; }
        row.nft_chain = form.nft_chain || null;
        row.nft_collection = form.nft_collection.trim() || null;
        row.nft_name = form.nft_name || null;
        row.nft_schema = form.nft_schema || null;
        row.nft_template_id = form.nft_template_id ? parseInt(form.nft_template_id, 10) : null;
        row.nft_min_count = parseInt(form.nft_min_count, 10) || 1;
      }
      const { error } = await supabase.from('supporter_requirements' as never).insert(row as never);
      if (error) { console.error('[supporter_requirements] insert failed', error); alert(`Could not save: ${error.message}`); return; }
      setForm((m) => ({ ...m, token_theme_id: '', min_amount: '', nft_collection: '', nft_name: '', nft_schema: '', nft_template_id: '', nft_min_count: '1' }));
      await load();
    } finally { setBusy(false); }
  };
  const del = async (id: string) => { await supabase.from('supporter_requirements' as never).delete().eq('id', id); await load(); };
  const setMode = async (r: SupporterRequirement, mode: 'or' | 'and') => { await supabase.from('supporter_requirements' as never).update({ match_mode: mode } as never).eq('id', r.id); await load(); };

  const coinLabel = (id: string | null) => coins.find((c) => c.id === id)?.label ?? id ?? '';

  return (
    <div className="space-y-1.5">
      {reqs.map((r) => (
        <div key={r.id} className="flex items-center justify-between text-xs text-foreground gap-2">
          <div className="flex items-center gap-1.5">
            <button onClick={() => setMode(r, r.match_mode === 'or' ? 'and' : 'or')} title="toggle OR / AND">
              <Badge variant={r.match_mode === 'and' ? 'default' : 'secondary'}>{r.match_mode.toUpperCase()}</Badge>
            </button>
            <span>
              {r.gate_kind === 'token'
                ? `≥ ${r.min_amount} ${coinLabel(r.token_theme_id)}`
                : `own ≥ ${r.nft_min_count} ${r.nft_name || r.nft_collection || 'NFT'}${r.nft_chain ? ` (${r.nft_chain})` : ''}`}
            </span>
          </div>
          <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => del(r.id)}>✕</Button>
        </div>
      ))}
      {!reqs.length && <div className="text-xs text-foreground/60">No requirements — gated only by paying.</div>}

      {/* Add a requirement */}
      <div className="flex flex-wrap items-center gap-1.5 pt-1">
        <select className="text-xs border rounded px-1 py-1 bg-background" value={form.match_mode} onChange={(e) => setF('match_mode', e.target.value)}>
          <option value="or">OR</option><option value="and">AND</option>
        </select>
        <select className="text-xs border rounded px-1 py-1 bg-background" value={kind} onChange={(e) => setKind(e.target.value as 'token' | 'nft')}>
          <option value="token">Token</option><option value="nft">NFT</option>
        </select>
        {kind === 'token' ? (
          <>
            <select className="text-xs border rounded px-1 bg-background" value={form.token_theme_id} onChange={(e) => setF('token_theme_id', e.target.value)}>
              <option value="">— coin —</option>
              {coins.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
            <Input className="h-7 text-xs w-24" type="number" placeholder="min" value={form.min_amount} onChange={(e) => setF('min_amount', e.target.value)} />
          </>
        ) : (
          <>
            <select className="text-xs border rounded px-1 py-1 bg-background" value={form.nft_chain} onChange={(e) => setF('nft_chain', e.target.value)}>
              {NFT_CHAINS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <Input className="h-7 text-xs w-44" placeholder="contract / collection" value={form.nft_collection}
                   onChange={(e) => setF('nft_collection', e.target.value)} onBlur={lookupName} />
            <Input className="h-7 text-xs w-32" placeholder={looking ? 'looking up…' : 'name (auto)'}
                   value={form.nft_name} onChange={(e) => setF('nft_name', e.target.value)} />
            <Input className="h-7 text-xs w-14" type="number" placeholder="#" value={form.nft_min_count} onChange={(e) => setF('nft_min_count', e.target.value)} />
          </>
        )}
        <Button size="sm" className="h-7" disabled={busy} onClick={add}>Add</Button>
      </div>
    </div>
  );
}
