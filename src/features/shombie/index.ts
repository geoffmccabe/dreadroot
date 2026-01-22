// Types - explicit exports to avoid conflicts
export type { 
  ShombieDefinition, 
  ShombiePart, 
  PartTwitch, 
  ShombieInstance,
  HeadMovementType,
  ShombieBodyFire
} from './types';
export { SHOMBIE_BODY_PARTS, PARTS_PER_SHOMBIE, generatePartTwitches } from './types';

// Constants - explicit exports (HeadMovementType removed from here since it's a type not in constants)
export {
  CHUNK_SIZE,
  MAX_SHOMBIES_PER_CHUNK,
  MAX_TOTAL_SHOMBIES,
  SPAWN_CHECK_INTERVAL_MS,
  DEFAULT_SHOMBIE_COLOR,
  SHOMBIE_ATTACK_RANGE,
  SHOMBIE_ATTACK_COOLDOWN_MS,
  KNOCKBACK_DECAY_RATE,
  SHOMBIE_GRAVITY,
  SHOMBIE_RENDER_DISTANCE,
  SHOMBIE_SPAWN_BOUNDS,
  TIER_COLORS,
  TIER_RARITY,
  RARITY_COLORS,
  HEAD_FIRE_SIZE,
  HEAD_FIRE_HEIGHT,
  HEAD_FIRE_PARTICLE_COUNT,
  SHOMBIE_SCALE_VARIATION,
  SHOMBIE_EMERGENCE_DURATION_MS,
  SHOMBIE_GROUP_SPREAD_RADIUS,
  SPAWN_SEQUENCE_TIMEOUT_MS,
  SHOMBIE_CHASE_SPEED_MULTIPLIER,
  SHOMBIE_LEG_ANIMATION_MULTIPLIER,
  SHOMBIE_HITBOX_RADIUS,
  SHOMBIE_HITBOX_HEIGHT,
  HEAD_SLIDE_AMPLITUDE,
  HEAD_SLIDE_SPEED,
  HEAD_BOB_AMPLITUDE,
  HEAD_CIRCLE_RADIUS,
  ARM_SWING_AMPLITUDE,
  ARM_SWING_UP_DOWN,
  ELBOW_BEND_MIN,
  ELBOW_BEND_MAX,
  DEFAULT_SHOMBIE_TEXTURE_URL,
} from './constants';

// Components
export { ShombieRenderer } from './components/ShombieRenderer';
export type { ShombieRendererHandle } from './components/ShombieRenderer';
export { ShombieDesignPanel } from './components/ShombieDesignPanel';

// Hooks
export { useShombieDefinitions, getShombieDefinitionByTier, getShombieDefinitionsCache } from './hooks/useShombieDefinitions';
export { useShombieSystem } from './hooks/useShombieSystem';
