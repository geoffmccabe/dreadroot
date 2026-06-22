// Fortress Seed — the consumable item that lets a player build & place a fortress.
// Bought from the Marketplace (50,000 DIVI), equipped into the Special slot, then
// Shift+B opens the Fortress Builder. Placing a fortress consumes the seed.
//
// The DB row (items table) is created via SQL (see the feature notes); these constants
// are the client-side contract that must match that row.
export const FORTRESS_SEED_KEY = 'fortress_seed';
export const FORTRESS_SEED_NAME = 'Fortress Seed';
export const FORTRESS_SEED_PRICE_DIVI = 50000;

// Seeds are TIERED. Normal seeds occupy item numbers 229..238 (tiers 1..10); Angelic seeds
// (5% drop, up to 3x height) occupy 249..258 (tiers 1..10). Higher tier = wider fortress.
export const NORMAL_SEED_NUMBER_MIN = 229;
export const NORMAL_SEED_NUMBER_MAX = 238;
export const ANGELIC_SEED_NUMBER_MIN = 249;
export const ANGELIC_SEED_NUMBER_MAX = 258;

export interface SeedConfig {
  tier: number;       // 1..10
  angelic: boolean;
  minD: number;       // narrowest buildable diameter for this tier
  maxD: number;       // widest buildable diameter
  heightMult: number; // max procedural height = ceil(heightMult * width); 1.5 normal, 3 angelic
}

// Tier T (1-based): width range [20 + (T-1)*4 .. 23 + (T-1)*4]. T1 20-23, T2 24-27, …
export function seedConfigFor(itemNumber: number | null, tier: number | null): SeedConfig | null {
  if (itemNumber == null) return null;
  let t: number;
  let angelic: boolean;
  if (itemNumber >= ANGELIC_SEED_NUMBER_MIN && itemNumber <= ANGELIC_SEED_NUMBER_MAX) {
    angelic = true; t = itemNumber - ANGELIC_SEED_NUMBER_MIN + 1;
  } else if (itemNumber >= NORMAL_SEED_NUMBER_MIN && itemNumber <= NORMAL_SEED_NUMBER_MAX) {
    angelic = false; t = itemNumber - NORMAL_SEED_NUMBER_MIN + 1;
  } else {
    return null; // not a fortress seed
  }
  if (tier && tier >= 1 && tier <= 10) t = tier; // prefer the explicit tier if set
  return { tier: t, angelic, minD: 20 + (t - 1) * 4, maxD: 23 + (t - 1) * 4, heightMult: angelic ? 3 : 1.5 };
}

export function isSeedNumber(n: number | null): boolean {
  return n != null && ((n >= NORMAL_SEED_NUMBER_MIN && n <= NORMAL_SEED_NUMBER_MAX) ||
    (n >= ANGELIC_SEED_NUMBER_MIN && n <= ANGELIC_SEED_NUMBER_MAX));
}

// Placed fortresses are written as five greyscale stone tiers, each its own block type
// so the placed blocks keep the 5-tone look (and are individually mineable/ownable).
// tier 1 = lightest … tier 5 = darkest, matching imageToFortress tiers.
export const FORTRESS_TIER_BLOCK_TYPES = [
  'fortress_stone_1',
  'fortress_stone_2',
  'fortress_stone_3',
  'fortress_stone_4',
  'fortress_stone_5',
] as const;

export function tierBlockType(tier: number): string {
  return FORTRESS_TIER_BLOCK_TYPES[Math.min(5, Math.max(1, tier)) - 1];
}
