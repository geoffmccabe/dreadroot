// Token-gating — types. A gate grants a named bonus when the user holds enough of a token (e.g.
// TLM / a planet coin) or owns the right Wax NFT. Holdings come from user_token_balances +
// user_nft_holdings (synced from LW-SSO). See docs/CURRENCY_LEDGER_PLAN.md.

export type GateKind = 'token' | 'nft';

export interface TokenGate {
  id: string;
  game: string | null;            // null = every game
  name: string;
  gate_kind: GateKind;
  // token gate:
  token_theme_id: string | null;
  min_amount: number;
  // nft gate:
  nft_collection: string | null;
  nft_schema: string | null;
  nft_template_id: number | null;
  nft_min_count: number;
  // payoff:
  bonus_key: string;              // e.g. 'damage_mult', 'xp_mult', 'access:vault'
  bonus_value: number;
  is_active: boolean;
  sort_order: number;
}

export interface NftHolding {
  collection: string;
  schema_name: string | null;
  template_id: number | null;
  asset_count: number;
}

/** Result of evaluating every active gate for a user. */
export interface GateEvaluation {
  /** bonus_key → aggregated value (summed across all gates that passed). */
  bonuses: Record<string, number>;
  /** the gates that are currently satisfied (for UI/debug). */
  active: TokenGate[];
}
