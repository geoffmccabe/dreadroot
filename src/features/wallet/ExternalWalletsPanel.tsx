// ExternalWalletsPanel — lets a player link their Ethereum and Divi addresses so the holdings sync can
// read their real on-chain tokens/NFTs for token-gating and supporter tiers. Public addresses only
// (display/gating evidence, never spendable). Wax is linked separately via the embedded SSO wallet.
// The "Sync" button in the Support Level panel pulls holdings for every linked chain.
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { worldStore } from '@/services/worldStore';
import { supabase } from '@/integrations/supabase/client';
import { startDivigoConnect } from './divigoConnect';

interface ChainField { chain: string; label: string; placeholder: string; valid: (v: string) => boolean; }
const FIELDS: ChainField[] = [
  { chain: 'ethereum', label: 'Ethereum address', placeholder: '0x…', valid: (v) => /^0x[a-fA-F0-9]{40}$/.test(v.trim()) },
  { chain: 'solana',   label: 'Solana address',   placeholder: 'e.g. 5Fh…', valid: (v) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v.trim()) },
  { chain: 'divi',     label: 'Divi address',     placeholder: 'D…',  valid: (v) => v.trim().length >= 26 },
];

export function ExternalWalletsPanel({ userId }: { userId: string | null }) {
  const [vals, setVals] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [divigoLinked, setDivigoLinked] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!userId) { setSaved({}); setDivigoLinked(false); return; }
    Promise.all(FIELDS.map((f) => worldStore.getWalletLink(f.chain).then((a) => [f.chain, a] as const)))
      .then((pairs) => { if (alive) setSaved(Object.fromEntries(pairs.filter(([, a]) => a).map(([c, a]) => [c, a as string]))); });
    supabase.from('user_divigo_links' as never).select('verified').eq('user_id', userId).maybeSingle()
      .then(({ data }) => { if (alive) setDivigoLinked(!!(data as { verified?: boolean } | null)?.verified); });
    return () => { alive = false; };
  }, [userId]);

  const save = async (f: ChainField) => {
    const v = (vals[f.chain] ?? '').trim();
    if (!v || !f.valid(v)) { alert(`That doesn't look like a valid ${f.label}.`); return; }
    setBusy(f.chain);
    try {
      await worldStore.setWalletLink(f.chain, v);
      setSaved((s) => ({ ...s, [f.chain]: v }));
      setVals((s) => ({ ...s, [f.chain]: '' }));
    } finally { setBusy(null); }
  };

  return (
    <Card className="p-4 space-y-3">
      <div className="text-sm font-bold text-foreground">External Wallets</div>
      <p className="text-xs text-foreground/60">Link your public addresses so supporter tiers can verify your on-chain tokens &amp; NFTs. Then hit <span className="font-medium">↻ Sync</span> in Support Level.</p>
      {FIELDS.map((f) => (
        <div key={f.chain} className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-foreground/80">{f.label}</span>
            {saved[f.chain] && <span className="text-[11px] text-foreground/50 font-mono">{saved[f.chain].slice(0, 6)}…{saved[f.chain].slice(-4)}</span>}
          </div>
          <div className="flex items-center gap-2">
            <Input className="h-8 text-sm font-mono" placeholder={saved[f.chain] || f.placeholder}
              value={vals[f.chain] ?? ''} onChange={(e) => setVals((s) => ({ ...s, [f.chain]: e.target.value }))} />
            <Button size="sm" variant="outline" className="h-8" disabled={busy === f.chain || !userId}
              onClick={() => save(f)}>{busy === f.chain ? '…' : saved[f.chain] ? 'Update' : 'Link'}</Button>
          </div>
        </div>
      ))}

      {/* DiviGo verified link — proves wallet control (Telegram) + reads custodial DIVI the RPC can't see. */}
      <div className="pt-2 border-t border-foreground/10 space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-foreground/80">DiviGo (verified)</span>
          {divigoLinked && <span className="text-[11px] text-emerald-400">✓ Connected</span>}
        </div>
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] text-foreground/55 leading-snug">Confirm ownership in Telegram &amp; count your custodial DIVI toward tiers.</p>
          <Button size="sm" variant="outline" className="h-8 shrink-0" disabled={!userId} onClick={startDivigoConnect}>
            {divigoLinked ? 'Reconnect' : 'Connect'}
          </Button>
        </div>
      </div>
    </Card>
  );
}
