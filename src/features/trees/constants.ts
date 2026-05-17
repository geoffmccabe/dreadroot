// Tree System Configuration
// Toggle ENABLED to false to disable the entire feature

import type { FlameColorMode } from '@/components/fortress/UniversalFlameRenderer';

export const TREE_CONFIG: {
  ENABLED: boolean;
  TESTING_MODE: boolean;
  SPEED_MULTIPLIER: number;
  FRUIT_SPAWN_MULTIPLIER: number;
  BASE_GROWTH_INTERVAL: number;
  BASE_FRUIT_SPAWN_INTERVAL: number;
  BLOCKS_PER_TIER_HEIGHT: number;
  MIN_BRANCH_HEIGHT: number;
  GRAVITY: number;
  FRUIT_KNOCKBACK_DISTANCE: number;
  FRUIT_PICKUP_RANGE: number;
  MAX_VISIBLE_TREES: number;
  FRUSTUM_MARGIN: number;
} = {
  // Master toggle - set to false to disable trees entirely
  ENABLED: true,
  
  // Testing mode - speeds up everything (fruit spawn every 3.6s instead of
  // hourly = O(trees x 100k-block blueprint) scan + a doomed tree_fruits
  // insert every 3.6s). Off for any real/playable build.
  TESTING_MODE: false,
  
  // Speed multipliers when TESTING_MODE is true
  SPEED_MULTIPLIER: 10000,
  FRUIT_SPAWN_MULTIPLIER: 1000,
  
  // Base timing (in milliseconds)
  BASE_GROWTH_INTERVAL: 10000, // 10 seconds per block normally
  BASE_FRUIT_SPAWN_INTERVAL: 3600000, // 1 hour normally
  
  // Tree generation parameters
  BLOCKS_PER_TIER_HEIGHT: 3, // Tier 1 = 3 blocks, Tier 30 = 90 blocks
  MIN_BRANCH_HEIGHT: 2, // Branches start at least 2 blocks up
  
  // Physics
  GRAVITY: 9.8,
  FRUIT_KNOCKBACK_DISTANCE: 1, // Blocks moved when shot
  
  // Collection
  FRUIT_PICKUP_RANGE: 2, // Meters
  
  // Rendering
  MAX_VISIBLE_TREES: 100,
  FRUSTUM_MARGIN: 10,
};

// Calculate actual intervals based on testing mode
export function getGrowthInterval(growthFactor: number): number {
  const base = TREE_CONFIG.BASE_GROWTH_INTERVAL / growthFactor;
  return TREE_CONFIG.TESTING_MODE 
    ? base / TREE_CONFIG.SPEED_MULTIPLIER 
    : base;
}

export function getFruitSpawnInterval(): number {
  return TREE_CONFIG.TESTING_MODE
    ? TREE_CONFIG.BASE_FRUIT_SPAWN_INTERVAL / TREE_CONFIG.FRUIT_SPAWN_MULTIPLIER
    : TREE_CONFIG.BASE_FRUIT_SPAWN_INTERVAL;
}

// Rarity colors for UI
export const RARITY_COLORS = {
  common: '#9ca3af',
  uncommon: '#22c55e',
  rare: '#3b82f6',
  epic: '#a855f7',
  legendary: '#f59e0b',
} as const;

// ─── Fruit System Configuration ───────────────────────────────────────────────

export const FRUIT_CONFIG = {
  // Harvesting (F-key single press)
  HARVEST_RANGE: 3,                   // Base Chebyshev distance in blocks (bonus added at runtime)

  // Visibility (proximity-based)
  BASE_VISIBILITY: 30,                // Base visibility range in blocks
  VISIBILITY_LEVEL_DIVISOR: 6,        // Extra range = floor(level / this)
  MIN_OPACITY: 0.25,                  // Opacity at max visibility range
  MAX_VISIBLE_FRUITS: 50,             // Cap for rendering performance

  // Harvest rewards
  EGG_CHANCE: 0.01,                   // 1% chance of egg fruit on harvest
  MAX_FORGE_BONUS: 30,                // Maximum tier increase from a single forge

  // Spawning
  SPAWN_CHANCE_PER_BRANCH: 0.1,       // Multiplied by fruiting_factor per spawn tick
} as const;

// Fruit tier definition — extensible for future fruit codes (#FR1, #FR2, etc.)
export interface FruitTierDef {
  name: string;
  flameColors: [string, string, string];
  flameColorMode: FlameColorMode;
}

// Index 0 is unused; tiers are 1-indexed (FRUIT_TIERS[1] = Common, etc.)
export const FRUIT_TIERS: readonly FruitTierDef[] = [
  { name: '',            flameColors: ['#000000', '#000000', '#000000'], flameColorMode: 'static' }, // placeholder index 0
  { name: 'Common',      flameColors: ['#d4a84b', '#c49332', '#8b6914'], flameColorMode: 'static' },
  { name: 'Uncommon',    flameColors: ['#ff8c00', '#ff6600', '#cc4400'], flameColorMode: 'static' },
  { name: 'Rare',        flameColors: ['#ffd700', '#ffb800', '#cc8800'], flameColorMode: 'static' },
  { name: 'Epic',        flameColors: ['#22cc22', '#00aa00', '#006600'], flameColorMode: 'static' },
  { name: 'Legendary',   flameColors: ['#ff2222', '#cc0000', '#880000'], flameColorMode: 'static' },
  { name: 'Divine',      flameColors: ['#ffffff', '#f0f0ff', '#e0e0ff'], flameColorMode: 'static' },
  { name: 'Mystic',      flameColors: ['#ff69b4', '#ff00ff', '#cc00cc'], flameColorMode: 'static' },
  { name: 'Rainbow',     flameColors: ['#ff0000', '#00ff00', '#0000ff'], flameColorMode: 'rainbow' },
  { name: 'Apocalyptic', flameColors: ['#111111', '#1a0a00', '#ff4400'], flameColorMode: 'static' },
  { name: 'Cosmic',      flameColors: ['#ffd700', '#ffcc00', '#fff8dc'], flameColorMode: 'static' },
] as const;

// Get tier definition, falling back to Cosmic style for tiers > 10 (via forging)
export function getFruitTier(tier: number): FruitTierDef {
  if (tier >= 1 && tier < FRUIT_TIERS.length) return FRUIT_TIERS[tier];
  // Forged tiers above 10: use Cosmic colors with dynamic name
  return {
    name: `Tier ${tier}`,
    flameColors: FRUIT_TIERS[10].flameColors as [string, string, string],
    flameColorMode: FRUIT_TIERS[10].flameColorMode,
  };
}

// ─── Default Seed Definitions ────────────────────────────────────────────────

// Default seed definitions for each tier (can be overridden in admin)
export const DEFAULT_TIER_NAMES = [
  'Sprout', 'Sapling', 'Seedling', 'Young Oak', 'Forest Pine',
  'Birch', 'Maple', 'Willow', 'Cedar', 'Redwood',
  'Ancient Oak', 'Elder Pine', 'Spirit Birch', 'Moon Maple', 'Storm Willow',
  'Crystal Cedar', 'Flame Redwood', 'Shadow Oak', 'Light Pine', 'Void Birch',
  'Celestial Maple', 'Thunder Willow', 'Frost Cedar', 'Solar Redwood', 'Lunar Oak',
  'Divine Pine', 'Eternal Birch', 'Cosmic Maple', 'World Willow', 'Yggdrasil'
] as const;
