/**
 * Shombie constants
 */

// Chunk size for spawn calculations (matches world chunk size)
export const CHUNK_SIZE = 16;

// Maximum shombies per chunk tier
export const MAX_SHOMBIES_PER_CHUNK = 5;

// Total max shombies in the world
export const MAX_TOTAL_SHOMBIES = 100;

// Spawn interval in ms
export const SPAWN_CHECK_INTERVAL_MS = 5000;

// Default color when no texture
export const DEFAULT_SHOMBIE_COLOR = 0x4a7c59; // Zombie green

// Attack range in blocks
export const SHOMBIE_ATTACK_RANGE = 1.2;

// Attack cooldown
export const SHOMBIE_ATTACK_COOLDOWN_MS = 1000;

// Knockback decay rate per second
export const KNOCKBACK_DECAY_RATE = 8.0;

// Gravity for shombies
export const SHOMBIE_GRAVITY = 20.0;

// Maximum render distance
export const SHOMBIE_RENDER_DISTANCE = 80;

// Spawn bounds
export const SHOMBIE_SPAWN_BOUNDS = {
  minX: -200,
  maxX: 200,
  minZ: -200,
  maxZ: 200,
  minY: 0,
  maxY: 50,
};

// Tier colors matching bullet tier colors
export const TIER_COLORS: Record<number, string[]> = {
  1: ['#FFFF00'],                                                          // Common - Yellow
  2: ['#00FF00'],                                                          // Uncommon - Green
  3: ['#0088FF'],                                                          // Rare - Blue
  4: ['#8B00FF'],                                                          // Epic - Purple
  5: ['#FF0000'],                                                          // Legendary - Red
  6: ['#FFFFFF'],                                                          // Divine - White
  7: ['#FF69B4'],                                                          // Mystic - Pink
  8: ['#FF0000', '#FF7F00', '#FFFF00', '#00FF00', '#0000FF', '#8B00FF'],   // Rainbow
  9: ['#1a1a1a', '#330000'],                                               // Apocalyptic - Black/Dark Red
  10: ['#FFD700', '#FFA500'],                                              // Cosmic - Gold/Orange
};

// Tier rarity names
export const TIER_RARITY: Record<number, string> = {
  1: 'common',
  2: 'uncommon',
  3: 'rare',
  4: 'epic',
  5: 'legendary',
  6: 'divine',
  7: 'mystic',
  8: 'rainbow',
  9: 'apocalyptic',
  10: 'cosmic',
};

// Rarity display colors
export const RARITY_COLORS: Record<string, string> = {
  common: '#9ca3af',
  uncommon: '#22c55e',
  rare: '#3b82f6',
  epic: '#a855f7',
  legendary: '#f59e0b',
  divine: '#ffffff',
  mystic: '#ec4899',
  rainbow: '#ff0000',
  apocalyptic: '#1a1a1a',
  cosmic: '#ffd700',
};

// Head fire effect settings
export const HEAD_FIRE_SIZE = 0.15;
export const HEAD_FIRE_HEIGHT = 0.3;
export const HEAD_FIRE_DURATION = 999999; // Permanent while alive
