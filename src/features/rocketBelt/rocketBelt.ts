// Rocket Belt — a Special-slot item (sits in equip slot 4, shown as E5). Hold Shift+E to
// fire a FORWARD jet boost: the same fast forward dash the admin super-sprint uses, but
// metered by a per-minute fuel budget that scales with the belt's tier.
//
// 10 tiers, item_number 239–248 (tier 1 = 239 … tier 10 = 248). The DB rows (items table)
// are created via SQL; these constants are the client-side contract that must match.
export const ROCKET_BELT_NAME = 'Rocket Belt';
export const ROCKET_BELT_BASE_ITEM_NUMBER = 239; // tier 1
export const ROCKET_BELT_MAX_ITEM_NUMBER = 248;  // tier 10
export const ROCKET_BELT_PRICE_DIVI_BASE = 20000; // tier 1 price; scales per tier in the SQL

// Each tier grants 2 seconds of boost per 60-second window (T1 = 2s/min … T10 = 20s/min),
// spendable in 0.25s increments. Budget refills continuously over the window.
export const BOOST_SECONDS_PER_TIER = 2;
export const BOOST_REFILL_WINDOW_SEC = 60;
export const BOOST_INCREMENT_SEC = 0.25;

export function rocketBeltKeyForTier(tier: number): string {
  return `rocket_belt_t${tier}`;
}

export function rocketBeltItemNumberForTier(tier: number): number {
  return ROCKET_BELT_BASE_ITEM_NUMBER + (tier - 1);
}

// Returns 1–10 if the item_number is a Rocket Belt, else null.
export function rocketBeltTierFromItemNumber(n: number | null | undefined): number | null {
  if (n == null) return null;
  if (n < ROCKET_BELT_BASE_ITEM_NUMBER || n > ROCKET_BELT_MAX_ITEM_NUMBER) return null;
  return n - ROCKET_BELT_BASE_ITEM_NUMBER + 1;
}

// Total boost-seconds available per refill window for a given tier.
export function maxBoostSeconds(tier: number): number {
  return Math.max(0, tier) * BOOST_SECONDS_PER_TIER;
}
