// SupportersAdmin — the Admin > Users > Supporters tab. Lists the blockchains we support, then a
// card per tier (VIP / VIP Demi-God / VIP God) with its monthly $ amount + a REQUIREMENTS and a
// BENEFITS sub-panel. Config only (Phase 1) — benefits aren't wired into gameplay yet.
// See docs/SUPPORTER_TIERS_PLAN.md.
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { displaySymbol, networkLabel, type TokenAsset } from '@/features/wallet/types';
import { TierRequirementsEditor } from './TierRequirementsEditor';
import { TierBenefitsEditor } from './TierBenefitsEditor';
import type { SupporterTier } from './types';

interface VariantRow { id: string; asset_id: string | null; display_name: string; name: string; network: string; ticker_symbol: string | null; }
interface AssetRow extends TokenAsset { is_active?: boolean }

export function SupportersAdmin() {
  const [tiers, setTiers] = useState<SupporterTier[]>([]);
  const [coins, setCoins] = useState<{ id: string; label: string }[]>([]);
  const [chains, setChains] = useState<string[]>([]);
  const [amt, setAmt] = useState<Record<string, string>>({});
  const [pid, setPid] = useState<Record<string, { stripe: string; paypal: string }>>({});
  const [bfBusy, setBfBusy] = useState(false);
  const [bfStatus, setBfStatus] = useState<string | null>(null);

  // Siege Worlds VIP backfill — looks up each imported SW player's real DiviGo DIVI + Portal NFT and
  // assigns VIP. Runs in batches server-side; we keep calling until it reports the queue is drained.
  const runBackfill = async () => {
    setBfBusy(true);
    let processed = 0, divi = 0, portal = 0, matched = 0, applied = 0;
    try {
      for (let i = 0; i < 500; i++) {   // hard cap on rounds; each round handles a batch
        const { data, error } = await supabase.functions.invoke('sw-vip-backfill', { body: { limit: 50 } });
        if (error) { setBfStatus(`Stopped: ${error.message}`); break; }
        const d = data as { processed?: number; withDivi?: number; withPortal?: number; matchedToAccounts?: number; vipApplied?: number; note?: string; error?: string };
        if (d?.error) { setBfStatus(`Stopped: ${d.error}`); break; }
        processed += d.processed ?? 0; divi += d.withDivi ?? 0; portal += d.withPortal ?? 0;
        matched += d.matchedToAccounts ?? 0; applied += d.vipApplied ?? 0;
        setBfStatus(`Checked ${processed} linked players · ${divi} hold DIVI · ${portal} hold a Portal · ${matched} matched to accounts (${applied} VIP applied)…`);
        if (!d.processed || d.note === 'batch drained') { setBfStatus(`Done. Checked ${processed} · ${divi} with DIVI · ${portal} with Portal · ${matched} matched (${applied} VIP applied).`); break; }
      }
    } catch (e) {
      setBfStatus(`Stopped: ${(e as Error).message}`);
    } finally {
      setBfBusy(false);
    }
  };

  const load = useCallback(async () => {
    const [tRes, vRes, aRes] = await Promise.all([
      supabase.from('supporter_tiers' as never).select('*').order('level'),
      supabase.from('token_themes').select('id, asset_id, display_name, name, network, ticker_symbol').eq('is_active', true),
      supabase.from('token_assets' as never).select('*'),
    ]);
    setTiers((tRes.data as unknown as SupporterTier[]) ?? []);
    const assetById = new Map(((aRes.data as unknown as AssetRow[]) ?? []).map((a) => [a.id, a]));
    const variants = (vRes.data as unknown as VariantRow[]) ?? [];
    setCoins(variants.map((v) => {
      const asset = (v.asset_id && assetById.get(v.asset_id)) || { id: v.id, symbol: v.ticker_symbol || v.name.toUpperCase(), display_name: v.display_name, kind: 'coin' as const, logo_url: null, sort_order: 0 };
      return { id: v.id, label: `${displaySymbol(asset)} — ${asset.display_name} (${networkLabel(v.network)})` };
    }));
    setChains(Array.from(new Set(variants.map((v) => v.network || 'internal'))));
  }, []);
  useEffect(() => { void load(); }, [load]);

  const saveAmount = async (tier: SupporterTier) => {
    const v = parseFloat(amt[tier.id] ?? '');
    if (Number.isNaN(v)) return;
    await supabase.from('supporter_tiers' as never).update({ monthly_usd: v } as never).eq('id', tier.id);
    await load();
  };

  const savePid = async (tier: SupporterTier) => {
    const cur = pid[tier.id];
    if (!cur) return;
    await supabase.from('supporter_tiers' as never)
      .update({ stripe_price_id: cur.stripe.trim() || null, paypal_plan_id: cur.paypal.trim() || null } as never)
      .eq('id', tier.id);
    await load();
  };
  const pidVal = (tier: SupporterTier, k: 'stripe' | 'paypal') =>
    pid[tier.id]?.[k] ?? (k === 'stripe' ? tier.stripe_price_id : tier.paypal_plan_id) ?? '';
  const setPidVal = (tier: SupporterTier, k: 'stripe' | 'paypal', val: string) =>
    setPid((m) => ({ ...m, [tier.id]: {
      stripe: k === 'stripe' ? val : pidVal(tier, 'stripe'),
      paypal: k === 'paypal' ? val : pidVal(tier, 'paypal'),
    } }));

  return (
    <div className="space-y-4 p-1">
      {/* Blockchains we support */}
      <Card className="p-3">
        <div className="text-sm font-bold text-foreground mb-2">Blockchains</div>
        <div className="flex flex-wrap gap-2">
          {chains.map((c) => <Badge key={c} variant="secondary">{networkLabel(c)}</Badge>)}
          {!chains.length && <span className="text-xs text-foreground/60">No coins yet.</span>}
        </div>
      </Card>

      {/* Siege Worlds VIP backfill */}
      <Card className="p-3 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-bold text-foreground">Siege Worlds VIP backfill</div>
            <div className="text-xs text-foreground/60">Reads each imported Siege Worlds player's real DiviGo DIVI &amp; LightningWorks Portal and assigns their VIP level. Safe to re-run.</div>
          </div>
          <Button size="sm" variant="outline" className="shrink-0" disabled={bfBusy} onClick={runBackfill}>
            {bfBusy ? 'Running…' : 'Run backfill'}
          </Button>
        </div>
        {bfStatus && <div className="text-xs text-foreground/75">{bfStatus}</div>}
      </Card>

      {/* Tier cards */}
      {tiers.map((tier) => (
        <Card key={tier.id} className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="font-bold text-foreground">{tier.name}</span>
              <Badge variant="outline">level {tier.level}</Badge>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-foreground/70">$/mo</span>
              <Input
                className="h-8 text-sm w-24" type="number" placeholder={String(tier.monthly_usd)}
                value={amt[tier.id] ?? ''} onChange={(e) => setAmt((m) => ({ ...m, [tier.id]: e.target.value }))}
                onBlur={() => saveAmount(tier)}
              />
              <span className="text-xs text-foreground/60 tabular-nums">now: ${tier.monthly_usd}</span>
            </div>
          </div>

          {/* Payment processor ids — set after creating the recurring product in Stripe / PayPal */}
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="flex items-center gap-1.5 flex-1">
              <span className="text-xs text-foreground/70 w-24">Stripe price</span>
              <Input className="h-8 text-sm" placeholder="price_…"
                value={pidVal(tier, 'stripe')} onChange={(e) => setPidVal(tier, 'stripe', e.target.value)} onBlur={() => savePid(tier)} />
            </div>
            <div className="flex items-center gap-1.5 flex-1">
              <span className="text-xs text-foreground/70 w-24">PayPal plan</span>
              <Input className="h-8 text-sm" placeholder="P-…"
                value={pidVal(tier, 'paypal')} onChange={(e) => setPidVal(tier, 'paypal', e.target.value)} onBlur={() => savePid(tier)} />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="border-l-2 border-foreground/15 pl-3">
              <div className="text-xs font-bold uppercase tracking-wide text-foreground/80 mb-1.5">Requirements</div>
              <TierRequirementsEditor tierId={tier.id} coins={coins} />
            </div>
            <div className="border-l-2 border-foreground/15 pl-3">
              <div className="text-xs font-bold uppercase tracking-wide text-foreground/80 mb-1.5">Benefits</div>
              <TierBenefitsEditor tierId={tier.id} />
            </div>
          </div>
        </Card>
      ))}
      {!tiers.length && <div className="text-sm text-foreground/70">No tiers — paste the supporter_tiers migration.</div>}
    </div>
  );
}
