/**
 * Wide Tree Constants
 *
 * Configuration for wide trees: thick tapering trunks with branching decorations.
 * Trunks taper from tier-dependent base radius down to 1 at top.
 * Tier 1-2: solid trunk (too thin for hollow interior).
 * Tier 3+: hollow trunk with spiral staircase and door.
 */

// ========== TIER LIMITS ==========
export const WIDE_MAX_TIERS = 10;

// ========== HEIGHT RANGE (overridable per seed) ==========
export const WIDE_MIN_HEIGHT = 30;
export const WIDE_MAX_HEIGHT = 100;

// ========== DOOR (tier 3+ only) ==========
export const WIDE_DOOR_WIDTH = 3;
export const WIDE_DOOR_HEIGHT = 4;

// ========== SPIRAL STAIRCASE ==========
export const WIDE_STAIR_INNER_RADIUS = 2;
export const WIDE_STAIR_BLOCKS_PER_ROTATION = 16;

// ========== BRANCH HEIGHT RANGE ==========
// Branches spawn between 25%-85% of tree height
export const WIDE_BRANCH_MIN_HEIGHT_RATIO = 0.25;
export const WIDE_BRANCH_MAX_HEIGHT_RATIO = 0.85;
export const WIDE_BRANCH_MIN_GAP = 3; // minimum vertical gap between branches

// ========== GLOW BARK ==========
export const WIDE_GLOW_BARK_COVERAGE = 0.3; // ~30% of eligible surfaces

// ========== BLOCK TYPE MAPPINGS ==========
export const WIDE_BLOCK_TYPES = {
  TRUNK: 'trunk',
  BRANCH: 'branch',
  STAIRS: 'trunk',
  DOOR_FRAME: 'trunk',
  GLOW_BARK: 'glow_bark',
} as const;

// ========== PER-TIER DEFAULTS ==========
export interface WideTierDefaults {
  diameter: number;
  radius: number;
  minHeight: number;
  maxHeight: number;
  leanAngle: number;
  sCurve: boolean;
  stemRandom: number;
  branchStartRadius: number;
}

export const WIDE_TIER_DEFAULTS: WideTierDefaults[] = [
  // Index 0 unused (tiers are 1-based)
  { diameter: 0, radius: 0, minHeight: 0, maxHeight: 0, leanAngle: 0, sCurve: false, stemRandom: 0, branchStartRadius: 0 },
  // Tier 1: 3 wide, solid trunk
  { diameter: 3, radius: 1, minHeight: 30, maxHeight: 35, leanAngle: 5, sCurve: false, stemRandom: 0, branchStartRadius: 2 },
  // Tier 2: 5 wide, solid trunk
  { diameter: 5, radius: 2, minHeight: 35, maxHeight: 42, leanAngle: 8, sCurve: false, stemRandom: 0, branchStartRadius: 2 },
  // Tier 3: 7 wide, hollow with staircase
  { diameter: 7, radius: 3, minHeight: 40, maxHeight: 50, leanAngle: 6, sCurve: true, stemRandom: 1, branchStartRadius: 3 },
  // Tier 4: 9 wide
  { diameter: 9, radius: 4, minHeight: 45, maxHeight: 57, leanAngle: 10, sCurve: false, stemRandom: 1, branchStartRadius: 3 },
  // Tier 5: 11 wide
  { diameter: 11, radius: 5, minHeight: 50, maxHeight: 65, leanAngle: 7, sCurve: false, stemRandom: 1, branchStartRadius: 3 },
  // Tier 6: 13 wide
  { diameter: 13, radius: 6, minHeight: 55, maxHeight: 72, leanAngle: 12, sCurve: true, stemRandom: 1, branchStartRadius: 4 },
  // Tier 7: 15 wide
  { diameter: 15, radius: 7, minHeight: 60, maxHeight: 80, leanAngle: 9, sCurve: false, stemRandom: 2, branchStartRadius: 4 },
  // Tier 8: 17 wide
  { diameter: 17, radius: 8, minHeight: 65, maxHeight: 87, leanAngle: 14, sCurve: false, stemRandom: 2, branchStartRadius: 4 },
  // Tier 9: 19 wide
  { diameter: 19, radius: 9, minHeight: 70, maxHeight: 95, leanAngle: 11, sCurve: true, stemRandom: 2, branchStartRadius: 5 },
  // Tier 10: 21 wide
  { diameter: 21, radius: 10, minHeight: 75, maxHeight: 100, leanAngle: 15, sCurve: false, stemRandom: 3, branchStartRadius: 5 },
];

/**
 * Get trunk base radius for a given tier.
 * Formula: floor((1 + 2 * tier) / 2)
 * T1=1, T2=2, T3=3, ... T10=10
 */
export function getWideTrunkRadiusForTier(tier: number): number {
  const clamped = Math.max(1, Math.min(tier, WIDE_MAX_TIERS));
  return WIDE_TIER_DEFAULTS[clamped].radius;
}

/**
 * Get branch start radius (how thick branches are at base) for a tier.
 * T1-2=2, T3-5=3, T6-8=4, T9-10=5
 */
export function getWideBranchStartRadius(tier: number): number {
  const clamped = Math.max(1, Math.min(tier, WIDE_MAX_TIERS));
  return WIDE_TIER_DEFAULTS[clamped].branchStartRadius;
}

/**
 * Whether this tier is hollow (has interior cavity, staircase, door).
 * Requires radius >= 3 (tier >= 3).
 */
export function isWideTreeHollow(tier: number): boolean {
  return tier >= 3;
}
