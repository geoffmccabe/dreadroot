// useSupporterStatus — loads the supporter tiers (+ their requirements & benefits) and computes the
// player's CURRENT level: the highest tier they either meet on-chain (token/NFT requirements) OR have
// an active paid subscription for. Holdings come from the RLS-locked balance/NFT mirrors, so this is
// trustworthy for display. Phase 2/3 — display only; benefits aren't applied to gameplay yet.
// See docs/SUPPORTER_TIERS_PLAN.md.
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { SupporterTier, SupporterRequirement, SupporterBenefit, UserSubscription, NftHolding } from './types';

export interface TierStatus {
  tier: SupporterTier;
  requirements: SupporterRequirement[];
  benefits: SupporterBenefit[];
  qualifies: boolean;
  viaSubscription: boolean;
}

export interface SupporterStatus {
  tiers: TierStatus[];        // sorted by level asc
  currentLevel: number;       // 0 = Ordinary
  currentTier: SupporterTier | null;
  isLoading: boolean;
  refresh: () => Promise<void>;
}

type BalRow = { token_theme_id: string; coins: number };

function nftCount(holdings: NftHolding[], r: SupporterRequirement): number {
  let n = 0;
  for (const h of holdings) {
    if (r.nft_collection && h.collection !== r.nft_collection) continue;
    if (r.nft_schema && h.schema_name !== r.nft_schema) continue;
    if (r.nft_template_id != null && h.template_id !== r.nft_template_id) continue;
    n += h.asset_count;
  }
  return n;
}

export function useSupporterStatus(userId: string | null): SupporterStatus {
  const [tiers, setTiers] = useState<TierStatus[]>([]);
  const [currentLevel, setCurrentLevel] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [tRes, rRes, bRes, balRes, nftRes, subRes] = await Promise.all([
        supabase.from('supporter_tiers' as never).select('*').eq('is_active', true).order('level'),
        supabase.from('supporter_requirements' as never).select('*'),
        supabase.from('supporter_benefits' as never).select('*').eq('enabled', true).order('sort_order'),
        userId ? supabase.from('user_token_balances').select('token_theme_id, coins').eq('user_id', userId) : Promise.resolve({ data: [] }),
        userId ? supabase.from('user_nft_holdings' as never).select('collection, schema_name, template_id, asset_count').eq('user_id', userId) : Promise.resolve({ data: [] }),
        userId ? supabase.from('user_subscriptions' as never).select('tier_id, status, paid_until').eq('user_id', userId) : Promise.resolve({ data: [] }),
      ]);

      const allTiers = (tRes.data as unknown as SupporterTier[]) ?? [];
      const allReqs = (rRes.data as unknown as SupporterRequirement[]) ?? [];
      const allBenefits = (bRes.data as unknown as SupporterBenefit[]) ?? [];
      const balByTheme = new Map(((balRes.data as unknown as BalRow[]) ?? []).map((b) => [b.token_theme_id, b.coins ?? 0]));
      const nfts = ((nftRes.data as unknown as NftHolding[]) ?? []);
      const now = Date.now();
      const activeSub = new Set(((subRes.data as unknown as UserSubscription[]) ?? [])
        .filter((s) => s.status === 'active' && (!s.paid_until || new Date(s.paid_until).getTime() > now))
        .map((s) => s.tier_id));

      const satisfied = (r: SupporterRequirement) => r.gate_kind === 'token'
        ? !!r.token_theme_id && (balByTheme.get(r.token_theme_id) ?? 0) >= r.min_amount
        : nftCount(nfts, r) >= r.nft_min_count;

      let level = 0;
      const out: TierStatus[] = allTiers.map((tier) => {
        const requirements = allReqs.filter((r) => r.tier_id === tier.id);
        const benefits = allBenefits.filter((b) => b.tier_id === tier.id);
        const orReqs = requirements.filter((r) => r.match_mode === 'or');
        const andReqs = requirements.filter((r) => r.match_mode === 'and');
        const byReq = orReqs.some(satisfied) || (andReqs.length > 0 && andReqs.every(satisfied));
        const viaSubscription = activeSub.has(tier.id);
        const qualifies = byReq || viaSubscription;
        if (qualifies && tier.level > level) level = tier.level;
        return { tier, requirements, benefits, qualifies, viaSubscription };
      });

      setTiers(out);
      setCurrentLevel(level);
    } catch (e) {
      console.error('[useSupporterStatus] load failed', e);
      setTiers([]); setCurrentLevel(0);
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  useEffect(() => { void load(); }, [load]);

  const currentTier = tiers.find((t) => t.tier.level === currentLevel)?.tier ?? null;
  return { tiers, currentLevel, currentTier, isLoading, refresh: load };
}
