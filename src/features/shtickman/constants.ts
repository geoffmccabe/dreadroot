/**
 * Shtickman constants
 */

// Maximum shtickmen in the world at once
export const MAX_TOTAL_SHTICKMEN = 10;

// Minimum distance to spawn from player
export const SPAWN_MIN_DISTANCE = 8;

// Maximum spawn distance from player
export const SPAWN_MAX_DISTANCE = 20;

// Check interval for ensuring at least one exists
export const EXISTENCE_CHECK_INTERVAL_MS = 3000;

// Time between target changes while wandering (ms)
export const TARGET_CHANGE_INTERVAL_MS = 5000;

// Knockback decay rate per second
export const KNOCKBACK_DECAY_RATE = 8.0;

// Gravity for shtickmen
export const SHTICKMAN_GRAVITY = 20.0;

// Maximum render distance
export const SHTICKMAN_RENDER_DISTANCE = 100;

// Hitbox settings - cylinder for collision detection
export const SHTICKMAN_HITBOX_RADIUS = 1.0;

// Scale variation for visual variety (±10%)
export const SHTICKMAN_SCALE_VARIATION = 0.1;

// Roar sound chance per check interval (10%)
export const ROAR_CHANCE = 0.1;
export const ROAR_CHECK_INTERVAL_MS = 5000;
export const ROAR_VOLUME = 0.6;

// Proximity sound settings - plays when shtickman enters same chunk as player
export const PROXIMITY_SOUND_DISTANCE = 16; // One chunk size
export const PROXIMITY_SOUND_COOLDOWN_MS = 5000; // Cooldown between proximity sounds per shtickman
export const PROXIMITY_SOUND_VOLUME = 0.7;

// Default proximity sound (bundled with game)
export const DEFAULT_PROXIMITY_SOUND_URL = '/shtickman_sound.mp3';

// Tier colors matching bullet tier colors (fallback when no texture)
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

// ============================================
// Head and Eye Constants
// ============================================

// Head proportions - cylinder head
export const HEAD_WIDTH_RATIO = 2.0; // Head diameter is 2x body width
export const HEAD_HEIGHT_RATIO = 3.0; // Head is 3x taller than old cube head

// Eye animation constants
export const EYE_TRACKING_RANGE = 50; // Blocks - how far away to track players (about 3 chunks)
export const PUPIL_LERP_SPEED = 12; // How fast pupils move toward target (increased for more visible tracking)
export const RANDOM_LOOK_INTERVAL_MS = 1500; // How often to pick new random look direction
export const RANDOM_LOOK_VARIANCE = 0.8; // How far pupils wander randomly (-1 to 1 range)

// Eye geometry constants (relative to head size)
export const EYE_WIDTH_RATIO = 0.50; // Eye width as ratio of head diameter (2x larger)
export const EYE_HEIGHT_RATIO = 0.70; // Eye height as ratio of head diameter (2x larger)
export const EYE_DEPTH = 0.03; // Small extrusion from head surface
export const EYE_SEPARATION = 0.45; // Distance between eyes as ratio of head diameter
export const EYE_VERTICAL_POS = 0.15; // How far up the head the eyes sit (0 = center)
export const PUPIL_SIZE_RATIO = 0.35; // Pupil size as ratio of eye size
export const EYE_OUTLINE_WIDTH = 0.04; // Black outline width as ratio of eye size
