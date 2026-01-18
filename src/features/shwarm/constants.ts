/**
 * Shwarm system constants
 */

// Player spawn point (used for respawning after death)
export const PLAYER_SPAWN_POINT = {
  x: 0,
  y: 1.8,
  z: 0,
};

// Spawn bounds (reuse from useWispBlock MAP_BOUNDS)
export const SHWARM_SPAWN_BOUNDS = {
  minX: -130,
  maxX: 130,
  minZ: -130,
  maxZ: 130,
  minY: 1,  // spawn just above ground
  maxY: 5,  // don't spawn too high
};

// Rendering
export const MAX_SHWARM_BLOCKS = 100;
export const SHWARM_BLOCK_SIZE = 0.5; // half normal block size
export const SHWARM_HITBOX_SIZE = 0.5; // constant hitbox regardless of visual scale (0.5x0.5m)

// Visual scaling based on health
export const MIN_VISUAL_SCALE = 0.2; // 20% minimum visual size
export const MAX_VISUAL_SCALE = 1.0;

// Movement towards player
export const MOVE_TOWARDS_PLAYER = 1.5; // Always move 1.5 units towards player

// Movement
export const MOVEMENT_PHASE_MS = 1000; // 1-second movement phases
export const MIN_SHWARM_SPACING = 1.0; // Minimum distance between shwarm block centers
export const GRAVITY_FALL = 1.0; // Fall 1 unit per phase if above ground
export const GROUND_LEVEL = 0.25; // Half of 0.5 block size
export const SNAPSHOT_BROADCAST_INTERVAL_MS = 100; // 10Hz broadcast to other players

// Collision
export const PLAYER_HIT_RADIUS = 1.2; // player radius + half-block
export const PLAYER_HIT_DEBOUNCE_MS = 100; // prevent multi-hit in same overlap

// Bullet damage (fixed for now, later can be weapon-based)
export const BULLET_DAMAGE = 25;

// Network
export const SHWARM_CHANNEL_PREFIX = 'shwarm:';

// Colors
export const DEFAULT_SHWARM_COLOR = 0xff4444; // Red tint for default shwarm blocks
