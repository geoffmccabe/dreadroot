/**
 * Walapa Constants
 * Floating whale-like creatures that travel between tall trees
 */

// Spawning limits
export const MAX_WALAPAS_TOTAL = 100; // Allow many walapas for tree-to-tree travel
export const SPAWN_CHECK_INTERVAL_MS = 10000;

// Movement
export const WALAPA_BASE_SPEED = 4.0; // Player walking speed in blocks/second
export const WALAPA_FLOAT_HEIGHT = 2.0; // Height above tree top to float at
export const WALAPA_BOB_AMPLITUDE = 0.3; // Vertical bobbing amplitude
export const WALAPA_BOB_SPEED = 1.5; // Bobbing speed multiplier
export const WALAPA_TAIL_SPEED = 2.0; // Tail animation speed

// Tree targeting
export const WALAPA_DEFAULT_MIN_TREE_TIER = 1; // Visit any tier tree by default
export const WALAPA_DEFAULT_WAIT_TIME = 30; // Seconds to wait at each tree
export const WALAPA_SEARCH_RADIUS = 200; // Max distance to search for trees

// Pathfinding
export const WALAPA_OBSTACLE_AVOIDANCE_DISTANCE = 5.0; // Distance to start avoiding obstacles
export const WALAPA_WAYPOINT_ARRIVAL_THRESHOLD = 2.0; // Distance to consider waypoint reached

// Rendering
export const WALAPA_RENDER_DISTANCE = 150;
export const WALAPA_SCALE_VARIATION = 0.1; // ±10% size variation

// Hitbox
export const WALAPA_HITBOX_RADIUS = 1.5;
export const WALAPA_HITBOX_HEIGHT = 1.0;

// Rider system
export const WALAPA_MAX_RIDERS = 5; // Max players that can ride at once
export const WALAPA_RIDER_BOARD_DISTANCE = 3.0; // Distance player needs to be to board

// Colors for tiers (matching body colors)
export const TIER_COLORS: Record<number, number> = {
  1: 0x9ca3af,   // Grey
  2: 0x22c55e,   // Green
  3: 0x3b82f6,   // Blue
  4: 0xa855f7,   // Purple
  5: 0xf59e0b,   // Gold
  6: 0xffffff,   // White
  7: 0xec4899,   // Pink
  8: 0xff6b6b,   // Coral
  9: 0x1a1a1a,   // Dark
  10: 0xffd700,  // Bright gold
};

// Rarity names for each tier
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

// Rarity colors for UI
export const RARITY_COLORS: Record<string, string> = {
  common: '#9ca3af',
  uncommon: '#22c55e',
  rare: '#3b82f6',
  epic: '#a855f7',
  legendary: '#f59e0b',
  divine: '#ffffff',
  mystic: '#ec4899',
  rainbow: '#ff6b6b',
  apocalyptic: '#1a1a1a',
  cosmic: '#ffd700',
};

// Default texture placeholder
export const DEFAULT_WALAPA_BODY_COLOR = 0x6699cc; // Sky blue-ish
export const DEFAULT_WALAPA_BELLY_COLOR = 0xccddee; // Lighter underside
export const DEFAULT_WALAPA_EYES_COLOR = 0x111111; // Dark eyes
