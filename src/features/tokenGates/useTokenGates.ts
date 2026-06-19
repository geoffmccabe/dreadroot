// useTokenGates — evaluates the admin-authored gate rules against a user's real holdings (token
// balances + Wax NFTs) and returns the bonuses they currently qualify for. Holdings are server-
// stored + RLS-protected (a client can't fake them — see the balance lockdown), so client-side
// evaluation of GAMEPLAY bonuses is safe. Anything granting real value must be re-checked server-
// side. See docs/CURRENCY_LEDGER_PLAN.md.
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { getActiveGame } from '@/config/activeGame';
import type { GateEvaluation, NftHolding, TokenGate } from './types';

type GateRow = TokenGate;
type BalRow = { token_theme_id: string; coins: number };

const EMPTY: GateEvaluation = { bonuses: {}, active: [] };

function nftCount(holdings: NftHolding[], g: TokenGate): number {
  let n = 0;
  for (const h of holdings) {
    if (g.nft_collection && h.collection !== g.nft_collection) continue;
    if (g.nft_schema && h.schema_name !== g.nft_schema) continue;
    if (g.nft_template_id != null && h.template_id !== g.nft_template_id) continue;
    n += h.asset_count;
  }
  return n;
}

export function useTokenGates(userId: string | null): GateEvaluation & { isLoading: boolean; refresh: () => Promise<void> } {
  const [evalResult, setEvalResult] = useState<GateEvaluation>(EMPTY);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    if (!userId) { setEvalResult(EMPTY); setIsLoading(false); return; }
    setIsLoading(true);
    try {
      const game = getActiveGame();
      const [gatesRes, balsRes, nftRes] = await Promise.all([
        supabase.from('token_gates' as never).select('*').eq('is_active', true),
        supabase.from('user_token_balances').select('token_theme_id, coins').eq('user_id', userId),
        supabase.from('user_nft_holdings' as never).select('collection, schema_name, template_id, asset_count').eq('user_id', userId),
      ]);

      const gates = ((gatesRes.data as unknown as GateRow[]) ?? []).filter((g) => !g.game || g.game === game);
      const balByTheme = new Map(((balsRes.data as unknown as BalRow[]) ?? []).map((b) => [b.token_theme_id, b.coins ?? 0]));
      const nfts = ((nftRes.data as unknown as NftHolding[]) ?? []);

      const bonuses: Record<string, number> = {};
      const active: TokenGate[] = [];
      for (const g of gates) {
        const passed = g.gate_kind === 'token'
          ? !!g.token_theme_id && (balByTheme.get(g.token_theme_id) ?? 0) >= g.min_amount
          : nftCount(nfts, g) >= g.nft_min_count;
        if (passed) {
          active.push(g);
          bonuses[g.bonus_key] = (bonuses[g.bonus_key] ?? 0) + g.bonus_value;
        }
      }
      setEvalResult({ bonuses, active });
    } catch (e) {
      console.error('[useTokenGates] load failed', e);
      setEvalResult(EMPTY);
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  useEffect(() => { void load(); }, [load]);

  return { ...evalResult, isLoading, refresh: load };
}
