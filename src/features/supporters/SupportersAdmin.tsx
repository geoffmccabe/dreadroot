// SupportersAdmin — the Admin > Users > Supporters tab. Lists the blockchains we support, then a
// card per tier (VIP / VIP Demi-God / VIP God) with its monthly $ amount + a REQUIREMENTS and a
// BENEFITS sub-panel. Config only (Phase 1) — benefits aren't wired into gameplay yet.
// See docs/SUPPORTER_TIERS_PLAN.md.
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
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
