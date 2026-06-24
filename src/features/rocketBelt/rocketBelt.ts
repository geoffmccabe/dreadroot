// Rocket Belt — a Special-slot GEAR item (sits in equip slot 4, shown as E5). It is NOT a
// consumable: while equipped it grants a recharging forward-boost ability, like the jet
// boots. Hold (or tap) Shift+E to spend "bursts": each burst = 0.25s of fast-forward, so a
// tap is a small hop forward and holding chains bursts back-to-back until you run dry.
//
// Burst budget (max) scales with player level, belt tier, and VIP level — 4 bursts each:
//   bursts = 4 × ( ceil(level / 5) + tier + vipLevel )
//   • +4 per 5 player levels  (levels 1–5 = 4, 6–10 = 8, …)
//   • +4 per belt tier        (tier 1 = +4 … tier 10 = +40)
//   • +4 per VIP level         (VIP 3 = +12)
//   minimum (level 1–5, tier 1, no VIP) = 8 bursts = 2 seconds.
// Bursts regenerate 1 every 5 seconds. Computed in Fortress (has level + VIP + tier) and
// published to the rocketBelt store; FortressControls runs the runtime spend/regen.
//
// 10 tiers, item_number 239–248 (tier 1 = 239 … tier 10 = 248). The DB rows (items table)
// are created via SQL; these constants are the client-side contract that must match.
export const ROCKET_BELT_NAME = 'Rocket Belt';
export const ROCKET_BELT_BASE_ITEM_NUMBER = 239; // tier 1
export const ROCKET_BELT_MAX_ITEM_NUMBER = 248;  // tier 10
export const ROCKET_BELT_PRICE_DIVI_BASE = 20000; // tier 1 price; scales per tier in the SQL

export const BURST_SEC = 0.25;            // duration of one burst of fast-forward
export const BURSTS_PER_5_LEVELS = 4;     // +4 bursts per 5 player levels
export const BURSTS_PER_TIER = 4;         // +4 bursts per belt tier
export const BURSTS_PER_VIP_LEVEL = 4;    // +4 bursts per VIP level
export const BURST_REGEN_SEC = 5;         // regenerate 1 burst every 5 seconds

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

// Max bursts for a given player level + equipped belt tier + VIP level. 0 if no belt
// (tier < 1) — the belt is what grants the ability.
export function maxBursts(level: number, tier: number, vipLevel: number): number {
  if (!tier || tier < 1) return 0;
  const lvl = Math.max(1, level || 1);
  const levelBursts = Math.ceil(lvl / 5) * BURSTS_PER_5_LEVELS;
  const tierBursts = tier * BURSTS_PER_TIER;
  const vipBursts = Math.max(0, vipLevel || 0) * BURSTS_PER_VIP_LEVEL;
  return levelBursts + tierBursts + vipBursts;
}
