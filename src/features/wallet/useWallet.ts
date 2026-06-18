// useWallet — the player's MULTI-COIN wallet. Reads the asset registry (token_assets) + every
// chain variant (token_themes) + the player's balances (user_token_balances), and groups them as
// asset → per-chain holdings. Themes not yet linked to an asset are shown as their own asset, so
// nothing is hidden during the registry migration. See docs/CURRENCY_LEDGER_PLAN.md.
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { TokenAsset, TokenVariant, WalletAssetGroup, WalletHolding } from './types';

// token_assets + the new token_themes columns aren't in the generated types yet → cast through these.
type AssetRow = TokenAsset & { is_active?: boolean };
type ThemeRow = TokenVariant & { is_active?: boolean };
type BalRow = { token_theme_id: string; coins: number; blockchain_address: string | null };

export interface UseWalletReturn {
  groups: WalletAssetGroup[];
  isLoading: boolean;
  refresh: () => Promise<void>;
}

export function useWallet(userId: string | null): UseWalletReturn {
  const [groups, setGroups] = useState<WalletAssetGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    if (!userId) { setGroups([]); setIsLoading(false); return; }
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
      const balByTheme = new Map(bals.map((b) => [b.token_theme_id, b]));

      // A holding exists for every variant the player has a balance row in.
      const groupMap = new Map<string, WalletAssetGroup>();
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
        let g = groupMap.get(asset.id);
        if (!g) { g = { asset, total: 0, holdings: [] }; groupMap.set(asset.id, g); }
        const holding: WalletHolding = { variant, coins: bal.coins ?? 0, address: bal.blockchain_address };
        g.holdings.push(holding);
        g.total += holding.coins;
      }

      const result = Array.from(groupMap.values());
      // Assets by sort_order then symbol; within an asset, chain variants by label.
      result.sort((a, b) => (a.asset.sort_order - b.asset.sort_order) || a.asset.symbol.localeCompare(b.asset.symbol));
      result.forEach((g) => g.holdings.sort((x, y) => x.variant.network.localeCompare(y.variant.network)));
      setGroups(result);
    } catch (e) {
      console.error('[useWallet] load failed', e);
      setGroups([]);
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  useEffect(() => { void load(); }, [load]);

  return { groups, isLoading, refresh: load };
}
