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
