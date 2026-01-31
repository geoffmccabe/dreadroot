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

// Attack range in blocks (horizontal)
export const SHOMBIE_ATTACK_RANGE = 1.2;

// Attack vertical reach - shombie can only hit targets within this height above their head
export const SHOMBIE_ATTACK_VERTICAL_REACH = 0.5; // 0.5m above their head max

// Player height (camera is at eye level, feet are below)
export const PLAYER_HEIGHT = 1.6;

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

// Head fire effect settings (same as bullet impacts)
export const HEAD_FIRE_SIZE = 0.4;
export const HEAD_FIRE_HEIGHT = 0.5;
export const HEAD_FIRE_PARTICLE_COUNT = 60;

// Spawn variation settings
export const SHOMBIE_SCALE_VARIATION = 0.2; // ±20% size variation
export const SHOMBIE_EMERGENCE_DURATION_MS = 3000; // 3 seconds to rise from ground
export const SHOMBIE_GROUP_SPREAD_RADIUS = 3; // Blocks radius for group spawns

// Keyboard spawn sequence timeout
export const SPAWN_SEQUENCE_TIMEOUT_MS = 3000;

// Movement settings
export const SHOMBIE_CHASE_SPEED_MULTIPLIER = 1.0; // Base chase speed
export const SHOMBIE_LEG_ANIMATION_MULTIPLIER = 2.0; // Double leg animation when walking

// Hitbox settings - larger for reliable hit detection
export const SHOMBIE_HITBOX_RADIUS = 0.6; // Generous hitbox radius
export const SHOMBIE_HITBOX_HEIGHT = 2.2;

// Head animation settings
export const HEAD_SLIDE_AMPLITUDE = 0.4; // 0.4m side to side (reduced from 0.5)
export const HEAD_SLIDE_SPEED = 2.0; // Cycles per walk phase
export const HEAD_BOB_AMPLITUDE = 0.3; // 0.3m up and down
export const HEAD_CIRCLE_RADIUS = 0.125; // 0.25m diameter circle (radius = 0.125)

// Head movement types - each shombie gets one randomly at spawn
export type HeadMovementType = 'slide' | 'bob' | 'circle';

// Arm swing settings - more dramatic zombie arms
export const ARM_SWING_AMPLITUDE = 0.5; // Larger forward/back swing
export const ARM_SWING_UP_DOWN = 0.15; // Up/down motion during swing

// Elbow/knee bending - 90+ degree bends
export const ELBOW_BEND_MIN = 0; // Straight (180deg displayed as 0 offset)
export const ELBOW_BEND_MAX = 0.6; // Increased max bend offset (simulates 90+ deg)

// Default fortress texture for shombie body (fallback only)
export const DEFAULT_SHOMBIE_TEXTURE_URL = '/grass_texture_seamless.webp';

// Knockdown settings (headshot)
export const KNOCKDOWN_SLIDE_DISTANCE_PER_LEVEL = 1.0; // Slide 1 block per player level
export const KNOCKDOWN_TILT_DURATION_MS = 400; // Time to tilt backward to 90 degrees (flat on back)
export const KNOCKDOWN_SLIDE_DURATION_MS = 800; // Time to slide while on back
export const KNOCKDOWN_RECOVERY_DURATION_MS = 800; // Time to get back up (~2 seconds total)
export const KNOCKDOWN_TOTAL_DURATION_MS = KNOCKDOWN_TILT_DURATION_MS + KNOCKDOWN_SLIDE_DURATION_MS + KNOCKDOWN_RECOVERY_DURATION_MS;

// Shombie-to-shombie collision avoidance
export const SHOMBIE_COLLISION_RADIUS = 0.8; // Radius for shombie-shombie collisions
export const SHOMBIE_SEPARATION_FORCE = 5.0; // Force to push shombies apart

// Body fire settings (pinned to body parts when hit)
export const BODY_FIRE_SIZE = 0.3;
export const BODY_FIRE_HEIGHT = 0.4;
