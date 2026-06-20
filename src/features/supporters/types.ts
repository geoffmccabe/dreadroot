// Supporter tiers — types. VIP / VIP Demi-God / VIP God, each gated by token/NFT requirements OR a
// paid monthly subscription. Standalone tiers (no inheritance). See docs/SUPPORTER_TIERS_PLAN.md.

export interface SupporterTier {
  id: string;
  level: 1 | 2 | 3;
  name: string;
  monthly_usd: number;
  is_active: boolean;
  sort_order: number;
}

export type MatchMode = 'or' | 'and';   // per-requirement: 'or' alone qualifies; 'and' = must meet all 'and' rows
export type GateKind = 'token' | 'nft';

export interface SupporterRequirement {
  id: string;
  tier_id: string;
  match_mode: MatchMode;
  gate_kind: GateKind;
  token_theme_id: string | null;
  min_amount: number;
  nft_collection: string | null;   // EVM contract address, or WAX AtomicAssets collection
  nft_chain: string | null;         // 'ethereum' | 'wax' | 'solana' | …
  nft_name: string | null;          // collection name, auto-filled from the SSO contract registry
  nft_schema: string | null;
  nft_template_id: number | null;
  nft_min_count: number;
  label: string | null;
  sort_order: number;
}

export type BenefitValueType = 'count' | 'percent' | 'toggle';
export type BenefitCadence = 'once' | 'monthly' | 'persistent';

export interface SupporterBenefit {
  id: string;
  tier_id: string;
  benefit_key: string;
  value_type: BenefitValueType;
  value: number;
  cadence: BenefitCadence;
  enabled: boolean;
  note: string | null;
  sort_order: number;
}

export interface UserSubscription {
  id: string;
  user_id: string;
  tier_id: string;
  status: 'active' | 'pending' | 'cancelled' | 'expired';
  paid_until: string | null;
  method: string | null;
}

// Starter benefit catalog the admin picks from (more added later). Abilities are toggles/counts that
// stay active while the tier is held; grants are counts given once or monthly.
export const BENEFIT_CATALOG: { key: string; label: string; valueType: BenefitValueType; defaultCadence: BenefitCadence }[] = [
  { key: 'blocks',         label: 'Blocks (by type)',  valueType: 'count',   defaultCadence: 'monthly' },
  { key: 'tree_seeds',     label: 'Tree Seeds',        valueType: 'count',   defaultCadence: 'monthly' },
  { key: 'fortress_seeds', label: 'Fortress Seeds',    valueType: 'count',   defaultCadence: 'monthly' },
  { key: 'eggs',           label: 'Eggs',              valueType: 'count',   defaultCadence: 'monthly' },
  { key: 'chest_keys',     label: 'Chest Keys',        valueType: 'count',   defaultCadence: 'monthly' },
  { key: 'rocket_boots',   label: 'Rocket Boots (+1/level)', valueType: 'count', defaultCadence: 'persistent' },
  { key: 'glide_power',    label: 'Glide Power',       valueType: 'toggle',  defaultCadence: 'persistent' },
];
