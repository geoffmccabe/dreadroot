// Types - explicit exports to avoid conflicts
export type {
  ShroomerDefinition,
  ShroomerPart,
  PartTwitch,
  ShroomerInstance,
  HeadMovementType,
  ShroomerBodyFire
} from './types';
export { SHROOMER_BODY_PARTS, PARTS_PER_SHROOMER, generatePartTwitches } from './types';

// Constants - explicit exports
export {
  CHUNK_SIZE,
  MAX_SHROOMERS_PER_CHUNK,
  MAX_TOTAL_SHROOMERS,
  SPAWN_CHECK_INTERVAL_MS,
  DEFAULT_SHROOMER_COLOR,
  SHROOMER_ATTACK_RANGE,
  SHROOMER_ATTACK_COOLDOWN_MS,
  KNOCKBACK_DECAY_RATE,
  SHROOMER_GRAVITY,
  SHROOMER_RENDER_DISTANCE,
  SHROOMER_SPAWN_BOUNDS,
  TIER_COLORS,
  TIER_RARITY,
  RARITY_COLORS,
  HEAD_FIRE_SIZE,
  HEAD_FIRE_HEIGHT,
  HEAD_FIRE_PARTICLE_COUNT,
  SHROOMER_SCALE_VARIATION,
  SHROOMER_EMERGENCE_DURATION_MS,
  SHROOMER_GROUP_SPREAD_RADIUS,
  SPAWN_SEQUENCE_TIMEOUT_MS,
  SHROOMER_CHASE_SPEED_MULTIPLIER,
  SHROOMER_LEG_ANIMATION_MULTIPLIER,
  SHROOMER_HITBOX_RADIUS,
  SHROOMER_HITBOX_HEIGHT,
  HEAD_SLIDE_AMPLITUDE,
  HEAD_SLIDE_SPEED,
  HEAD_BOB_AMPLITUDE,
  HEAD_CIRCLE_RADIUS,
  ARM_SWING_AMPLITUDE,
  ARM_SWING_UP_DOWN,
  ELBOW_BEND_MIN,
  ELBOW_BEND_MAX,
  DEFAULT_SHROOMER_TEXTURE_URL,
} from './constants';

// Components
export { ShroomerRenderer } from './components/ShroomerRenderer';
export type { ShroomerRendererHandle } from './components/ShroomerRenderer';
export { ShroomerDesignPanel } from './components/ShroomerDesignPanel';

// Hooks
export { useShroomerDefinitions, getShroomerDefinitionByTier, getShroomerDefinitionsCache } from './hooks/useShroomerDefinitions';
export { useShroomerSystem } from './hooks/useShroomerSystem';
