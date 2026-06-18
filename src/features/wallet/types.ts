// Wallet types — the multi-coin view. An ASSET (brand: DIVI, USDT, points) groups its per-chain
// VARIANTS (token_themes rows). A player holds a balance per variant. See docs/CURRENCY_LEDGER_PLAN.md.

export type AssetKind = 'coin' | 'token' | 'points' | 'stablecoin';

export interface TokenAsset {
  id: string;
  symbol: string;
  display_name: string;
  kind: AssetKind;
  logo_url: string | null;
  sort_order: number;
}

export interface TokenVariant {
  id: string;                  // token_theme id
  asset_id: string | null;
  name: string;
  display_name: string;
  network: string;             // 'ethereum' | 'bsc' | 'base' | 'solana' | 'internal' …
  is_onchain: boolean;
  decimals: number;
  coin_image_url: string | null;
  ticker_symbol: string | null;
}

export interface WalletHolding {
  variant: TokenVariant;
  coins: number;
  address: string | null;      // on-chain address tied to this holding (if any)
}

export interface WalletAssetGroup {
  asset: TokenAsset;
  total: number;               // summed coins across the asset's variants
  holdings: WalletHolding[];   // one per chain the player holds this asset on
}

// Pretty chain labels for the indented rows.
const NETWORK_LABELS: Record<string, string> = {
  internal: 'Game (internal)',
  ethereum: 'Ethereum',
  bsc: 'BNB Chain',
  base: 'Base',
  solana: 'Solana',
  polygon: 'Polygon',
  arbitrum: 'Arbitrum',
};
export function networkLabel(network: string | null | undefined): string {
  if (!network) return NETWORK_LABELS.internal;            // pre-migration themes have no network column
  return NETWORK_LABELS[network] ?? (network.charAt(0).toUpperCase() + network.slice(1));
}
