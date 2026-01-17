// Tree System Configuration
// Toggle ENABLED to false to disable the entire feature

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
  
  // Testing mode - speeds up everything 100x
  TESTING_MODE: true,
  
  // Speed multipliers when TESTING_MODE is true
  SPEED_MULTIPLIER: 100,
  FRUIT_SPAWN_MULTIPLIER: 100,
  
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

// Default seed definitions for each tier (can be overridden in admin)
export const DEFAULT_TIER_NAMES = [
  'Sprout', 'Sapling', 'Seedling', 'Young Oak', 'Forest Pine',
  'Birch', 'Maple', 'Willow', 'Cedar', 'Redwood',
  'Ancient Oak', 'Elder Pine', 'Spirit Birch', 'Moon Maple', 'Storm Willow',
  'Crystal Cedar', 'Flame Redwood', 'Shadow Oak', 'Light Pine', 'Void Birch',
  'Celestial Maple', 'Thunder Willow', 'Frost Cedar', 'Solar Redwood', 'Lunar Oak',
  'Divine Pine', 'Eternal Birch', 'Cosmic Maple', 'World Willow', 'Yggdrasil'
] as const;
