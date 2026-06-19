// useWallet — the player's MULTI-COIN holdings. Reads the asset registry (token_assets) + every
// chain variant (token_themes) + the player's balances (user_token_balances), and returns a flat
// list of holdings (each carrying its asset + chain variant). The view groups them chain-first.
// Variants not yet linked to an asset are shown as their own asset, so nothing is hidden during the
// registry migration. See docs/CURRENCY_LEDGER_PLAN.md.
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { TokenAsset, TokenVariant, WalletHolding } from './types';

// token_assets + the new token_themes columns aren't in the generated types yet → cast through these.
type AssetRow = TokenAsset & { is_active?: boolean };
type ThemeRow = TokenVariant & { is_active?: boolean };
type BalRow = { token_theme_id: string; coins: number; blockchain_address: string | null };

export interface UseWalletReturn {
  holdings: WalletHolding[];
  isLoading: boolean;
  refresh: () => Promise<void>;
}

export function useWallet(userId: string | null): UseWalletReturn {
  const [holdings, setHoldings] = useState<WalletHolding[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    if (!userId) { setHoldings([]); setIsLoading(false); return; }
    setIsLoading(true);
    try {
      const [assetsRes, themesRes, balsRes] = await Promise.all([
        supabase.from('token_assets' as never).select('*'),
        supabase.from('token_themes').select('*').eq('is_active', true),
        supabase.from('user_token_balances').select('token_theme_id, coins, blockchain_address').eq('user_id', userId),
      ]);

      const assets = ((assetsRes.data as unknown as AssetRow[]) ?? []);
      const themes = ((themesRes.data as unknown as ThemeRow[]) ?? []);
      const bals = ((balsRes.data as unknown as BalRow[]) ?? []);

      const assetById = new Map(assets.map((a) => [a.id, a]));
      const themeById = new Map(themes.map((t) => [t.id, t]));

      const out: WalletHolding[] = [];
      for (const bal of bals) {
        const variant = themeById.get(bal.token_theme_id);
        if (!variant) continue;                              // orphan balance (theme deactivated) — skip
        // Resolve the asset; synthesize one from the variant if it isn't linked yet.
        const asset: TokenAsset = (variant.asset_id && assetById.get(variant.asset_id)) || {
          id: `theme:${variant.id}`,
          symbol: variant.ticker_symbol || variant.name.toUpperCase(),
          display_name: variant.display_name,
          kind: 'coin',
          logo_url: variant.coin_image_url,
          sort_order: 9999,
        };
        out.push({ variant, asset, coins: bal.coins ?? 0, address: bal.blockchain_address });
      }
      setHoldings(out);
    } catch (e) {
      console.error('[useWallet] load failed', e);
      setHoldings([]);
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  useEffect(() => { void load(); }, [load]);

  return { holdings, isLoading, refresh: load };
}
