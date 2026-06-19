// Wallet types — the multi-coin view, organised CHAIN-FIRST: a network/chain is the section, and
// the individual coins held on that chain are listed underneath. See docs/CURRENCY_LEDGER_PLAN.md.

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
  asset: TokenAsset;           // the brand this coin belongs to
  coins: number;
  address: string | null;      // on-chain address tied to this holding (if any)
}

// Pretty chain names for the section headers.
const NETWORK_LABELS: Record<string, string> = {
  ethereum: 'Ethereum',
  bsc: 'BNB Chain',
  base: 'Base',
  solana: 'Solana',
  polygon: 'Polygon',
  arbitrum: 'Arbitrum',
  wax: 'WAX',
};
export function networkLabel(network: string | null | undefined): string {
  if (!network || network === 'internal') return 'Game (Internal)';
  return NETWORK_LABELS[network] ?? (network.charAt(0).toUpperCase() + network.slice(1));
}

/** Section header for a chain group — appends "Chain/Network" so it's unmistakably a chain (the
 *  internal game ledger is labelled plainly, as it isn't a chain). */
export function chainSectionLabel(network: string | null | undefined): string {
  if (!network || network === 'internal') return 'Game (Internal)';
  return `${networkLabel(network)} Chain/Network`;
}

/** Display symbol — monetary instruments (coins/tokens/stablecoins) get a leading $ (e.g. $WATER);
 *  points do not. */
export function displaySymbol(asset: TokenAsset): string {
  const monetary = asset.kind === 'coin' || asset.kind === 'token' || asset.kind === 'stablecoin';
  return monetary ? `$${asset.symbol}` : asset.symbol;
}
