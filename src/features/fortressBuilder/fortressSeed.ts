// Fortress Seed — the consumable item that lets a player build & place a fortress.
// Bought from the Marketplace (50,000 DIVI), equipped into the Special slot, then
// Shift+B opens the Fortress Builder. Placing a fortress consumes the seed.
//
// The DB row (items table) is created via SQL (see the feature notes); these constants
// are the client-side contract that must match that row.
export const FORTRESS_SEED_KEY = 'fortress_seed';
export const FORTRESS_SEED_ITEM_NUMBER = 229;
export const FORTRESS_SEED_NAME = 'Fortress Seed';
export const FORTRESS_SEED_PRICE_DIVI = 50000;

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
