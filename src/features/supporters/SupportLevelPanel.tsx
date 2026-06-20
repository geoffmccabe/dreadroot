// SupportLevelPanel — User Panel sub-panel under the user name. Shows the 4 levels (Ordinary → VIP →
// VIP Demi-God → VIP God), the player's current one, and for each tier what's required (token/NFT) OR
// the monthly price, plus the benefits. Display only — the Subscribe button is wired in Phase 4.
// See docs/SUPPORTER_TIERS_PLAN.md.
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useSupporterStatus, type TierStatus } from './useSupporterStatus';
import { BENEFIT_CATALOG, type SupporterRequirement, type SupporterBenefit } from './types';

const benefitLabel = (key: string) => BENEFIT_CATALOG.find((c) => c.key === key)?.label ?? key;

function benefitText(b: SupporterBenefit): string {
  const name = benefitLabel(b.benefit_key) + (b.note ? ` (${b.note})` : '');
  const cad = b.cadence === 'monthly' ? '/mo' : b.cadence === 'once' ? ' once' : '';
  if (b.value_type === 'toggle') return name;
  if (b.value_type === 'percent') return `+${b.value}% ${name}`;
  return `${b.value} ${name}${cad}`;
}

export function SupportLevelPanel({ userId }: { userId: string | null }) {
  const { tiers, currentLevel, isLoading, refresh } = useSupporterStatus(userId);
  const [coinLabel, setCoinLabel] = useState<Map<string, string>>(new Map());
  const [busy, setBusy] = useState<string | null>(null); // `${tierId}:${provider}` while redirecting
  const [syncing, setSyncing] = useState(false);

  async function syncHoldings() {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke('sync-wax-holdings', { body: {} });
      if (error || data?.error) alert(`Sync failed: ${error?.message ?? data?.error}`);
      await refresh();
    } catch (e) {
      alert(`Sync failed: ${(e as Error).message}`);
    } finally {
      setSyncing(false);
    }
  }

  async function subscribe(tierId: string, provider: 'stripe' | 'paypal') {
    setBusy(`${tierId}:${provider}`);
    try {
      const { data, error } = await supabase.functions.invoke('subscribe-checkout', {
        body: { tier_id: tierId, provider },
      });
      if (error || !data?.url) {
        alert(`Could not start checkout: ${error?.message ?? data?.error ?? 'unknown error'}`);
        setBusy(null);
        return;
      }
      window.location.href = data.url as string;
    } catch (e) {
      alert(`Checkout failed: ${(e as Error).message}`);
      setBusy(null);
    }
  }

  useEffect(() => {
    supabase.from('token_themes').select('id, ticker_symbol, display_name').then(({ data }) => {
      setCoinLabel(new Map(((data as { id: string; ticker_symbol: string | null; display_name: string }[]) ?? [])
        .map((t) => [t.id, t.ticker_symbol || t.display_name])));
    });
  }, []);

  const reqText = (r: SupporterRequirement): string => r.gate_kind === 'token'
    ? `≥ ${r.min_amount} ${coinLabel.get(r.token_theme_id ?? '') ?? 'coin'}`
    : `own ${r.nft_min_count} ${r.nft_name || r.nft_collection || 'NFT'}${r.nft_chain ? ` (${r.nft_chain})` : ''}`;

  const levelName = (lvl: number) => lvl === 0 ? 'Ordinary' : (tiers.find((t) => t.tier.level === lvl)?.tier.name ?? `Level ${lvl}`);

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-bold text-foreground">Support Level</span>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" disabled={syncing || !userId}
            onClick={syncHoldings} title="Pull your latest on-chain WAX holdings">
            {syncing ? '…' : '↻ Sync'}
          </Button>
          <Badge>{isLoading ? '…' : levelName(currentLevel)}</Badge>
        </div>
      </div>

      {tiers.map((ts: TierStatus) => {
        const orReqs = ts.requirements.filter((r) => r.match_mode === 'or');
        const andReqs = ts.requirements.filter((r) => r.match_mode === 'and');
        return (
          <div key={ts.tier.id} className={`rounded-md p-2.5 border ${ts.qualifies ? 'border-primary/50 bg-primary/5' : 'border-foreground/15'}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-foreground">{ts.tier.name}</span>
                {ts.qualifies
                  ? <Badge variant="default">{ts.viaSubscription ? 'subscribed' : 'unlocked'}</Badge>
                  : <Badge variant="outline">locked</Badge>}
              </div>
              {ts.tier.monthly_usd > 0 && <span className="text-xs text-foreground/70">${ts.tier.monthly_usd}/mo</span>}
            </div>

            {/* Requirements */}
            <div className="text-xs text-foreground/75 mt-1">
              {ts.requirements.length === 0
                ? <span>Subscribe to unlock.</span>
                : <>
                    <span className="font-medium text-foreground/80">Hold </span>
                    {orReqs.map((r, i) => <span key={r.id}>{i > 0 ? ' or ' : ''}{reqText(r)}</span>)}
                    {andReqs.length > 0 && <span>{orReqs.length ? ', or all of: ' : 'all of: '}{andReqs.map((r) => reqText(r)).join(' + ')}</span>}
                    {ts.tier.monthly_usd > 0 && <span> — or subscribe ${ts.tier.monthly_usd}/mo</span>}
                  </>}
            </div>

            {/* Benefits */}
            {ts.benefits.length > 0 && (
              <div className="text-xs text-foreground/70 mt-1">
                <span className="font-medium text-foreground/80">Benefits: </span>
                {ts.benefits.map((b) => benefitText(b)).join(' · ')}
              </div>
            )}

            {!ts.qualifies && ts.tier.monthly_usd > 0 && (
              <div className="flex items-center gap-2 mt-2">
                <span className="text-xs text-foreground/60">Subscribe ${ts.tier.monthly_usd}/mo:</span>
                <Button size="sm" variant="outline" className="h-7" disabled={!!busy}
                  onClick={() => subscribe(ts.tier.id, 'stripe')}>
                  {busy === `${ts.tier.id}:stripe` ? '…' : 'Card'}
                </Button>
                <Button size="sm" variant="outline" className="h-7" disabled={!!busy}
                  onClick={() => subscribe(ts.tier.id, 'paypal')}>
                  {busy === `${ts.tier.id}:paypal` ? '…' : 'PayPal'}
                </Button>
              </div>
            )}
          </div>
        );
      })}
      {!isLoading && !tiers.length && <div className="text-xs text-foreground/60">No supporter tiers configured.</div>}
    </Card>
  );
}
