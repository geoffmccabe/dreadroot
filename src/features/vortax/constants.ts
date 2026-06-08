/**
 * Vortax constants (cloned from Shroomer).
 *
 * The Vortax is a ~20m-tall sphere-cloud giant. TIER 1 ONLY (no tier growth).
 * The shroomer body is ~2m at scale 1, so the base scale is ~10.
 */

export const CHUNK_SIZE = 16;

export const MAX_VORTAXES_PER_CHUNK = 50;
export const MAX_TOTAL_VORTAXES = 200; // 20m giants — far fewer than shroomers

export const SPAWN_CHECK_INTERVAL_MS = 5000;

export const DEFAULT_VORTAX_COLOR = 0x6a4a7c; // purple-ish cloud

export const VORTAX_ATTACK_RANGE = 1.2;
export const VORTAX_ATTACK_VERTICAL_REACH = 0.5;
export const PLAYER_HEIGHT = 1.6;
export const VORTAX_ATTACK_COOLDOWN_MS = 1000;

export const KNOCKBACK_DECAY_RATE = 8.0;
export const MAX_KNOCKBACK_SPEED = 150;

// Blast tumble (ragdoll-lite). Kept for parity with the shroomer adapter.
export const TUMBLE_WAIT_MS = 2000;
export const TUMBLE_RECOVER_MS = 500;
export const TUMBLE_RATE_MIN = 6;
export const TUMBLE_RATE_MAX = 13;

export const VORTAX_GRAVITY = 20.0;

// Maximum render distance — 20m giants are visible from much farther away.
export const VORTAX_RENDER_DISTANCE = 200;
export const VORTAX_ANIM_DISTANCE = 120;
export const MAX_HEAD_FLAMES = 50;

export const VORTAX_SPAWN_BOUNDS = {
  minX: -200,
  maxX: 200,
  minZ: -200,
  maxZ: 200,
  minY: 0,
  maxY: 50,
};

// Tier colors (vortax is tier 1, but keep the table for the design panel).
export const TIER_COLORS: Record<number, string[]> = {
  1: ['#FFFF00'],
  2: ['#00FF00'],
  3: ['#0088FF'],
  4: ['#8B00FF'],
  5: ['#FF0000'],
  6: ['#FFFFFF'],
  7: ['#FF69B4'],
  8: ['#FF0000', '#FF7F00', '#FFFF00', '#00FF00', '#0000FF', '#8B00FF'],
  9: ['#1a1a1a', '#330000'],
  10: ['#FFD700', '#FFA500'],
};

export const TIER_RARITY: Record<number, string> = {
  1: 'common', 2: 'uncommon', 3: 'rare', 4: 'epic', 5: 'legendary',
  6: 'divine', 7: 'mystic', 8: 'rainbow', 9: 'apocalyptic', 10: 'cosmic',
};

export const RARITY_COLORS: Record<string, string> = {
  common: '#9ca3af', uncommon: '#22c55e', rare: '#3b82f6', epic: '#a855f7',
  legendary: '#f59e0b', divine: '#ffffff', mystic: '#ec4899',
  rainbow: '#ff0000', apocalyptic: '#1a1a1a', cosmic: '#ffd700',
};

export const HEAD_FIRE_SIZE = 0.4;
export const HEAD_FIRE_HEIGHT = 0.5;
export const HEAD_FIRE_PARTICLE_COUNT = 60;

// Spawn variation. TIER 1 ONLY — base scale ~10 gives a ~20m giant.
export const VORTAX_SCALE_VARIATION = 0.2; // ±20% size variation
export const VORTAX_BASE_SCALE = 10;       // 20m tall (shroomer body ≈ 2m at scale 1)
export const VORTAX_EMERGENCE_DURATION_MS = 3000;
export const VORTAX_GROUP_SPREAD_RADIUS = 10; // bigger creatures → wider spread

export const SPAWN_SEQUENCE_TIMEOUT_MS = 3000;

export const VORTAX_CHASE_SPEED_MULTIPLIER = 1.0;
export const VORTAX_LEG_ANIMATION_MULTIPLIER = 2.0;

// Hitbox encloses the whole 20m body (radius + height scale with the instance).
export const VORTAX_HITBOX_RADIUS = 0.6;
export const VORTAX_HITBOX_HEIGHT = 2.2;

export const HEAD_SLIDE_AMPLITUDE = 0.4;
export const HEAD_SLIDE_SPEED = 2.0;
export const HEAD_BOB_AMPLITUDE = 0.3;
export const HEAD_CIRCLE_RADIUS = 0.125;

export type HeadMovementType = 'slide' | 'bob' | 'circle';

export const ARM_SWING_AMPLITUDE = 0.5;
export const ARM_SWING_UP_DOWN = 0.15;

export const ELBOW_BEND_MIN = 0;
export const ELBOW_BEND_MAX = 0.6;

export const DEFAULT_VORTAX_TEXTURE_URL = '/grass_texture_seamless.webp';

export const KNOCKDOWN_SLIDE_DISTANCE_PER_LEVEL = 1.0;
export const KNOCKDOWN_TILT_DURATION_MS = 400;
export const KNOCKDOWN_SLIDE_DURATION_MS = 800;
export const KNOCKDOWN_RECOVERY_DURATION_MS = 800;
export const KNOCKDOWN_TOTAL_DURATION_MS = KNOCKDOWN_TILT_DURATION_MS + KNOCKDOWN_SLIDE_DURATION_MS + KNOCKDOWN_RECOVERY_DURATION_MS;

export const VORTAX_COLLISION_RADIUS = 0.8;
export const VORTAX_SEPARATION_FORCE = 5.0;
export const VORTAX_SEPARATION_RADIUS = 1.4;

export const VORTAX_LANE_HALF_WIDTH = 8;
export const VORTAX_LANE_BREAK_DISTANCE = 12;

export const BODY_FIRE_SIZE = 0.3;
export const BODY_FIRE_HEIGHT = 0.4;

// Pop sound when a sphere is destroyed (user will add this asset).
export const VORTAX_POP_SOUND_URL = '/vortax_pop.mp3';
