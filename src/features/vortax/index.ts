// Types - explicit exports to avoid conflicts
export type {
  VortaxDefinition,
  VortaxPart,
  PartTwitch,
  VortaxInstance,
  VortaxSphere,
  HeadMovementType,
  VortaxBodyFire
} from './types';
export {
  VORTAX_BODY_PARTS,
  PARTS_PER_VORTAX,
  VORTAX_BODY_HEIGHT,
  SPHERE_COUNTS,
  generatePartTwitches,
  generateVortaxSpheres,
} from './types';

// Constants - explicit exports
export {
  CHUNK_SIZE,
  MAX_VORTAXES_PER_CHUNK,
  MAX_TOTAL_VORTAXES,
  SPAWN_CHECK_INTERVAL_MS,
  DEFAULT_VORTAX_COLOR,
  VORTAX_ATTACK_RANGE,
  VORTAX_ATTACK_COOLDOWN_MS,
  KNOCKBACK_DECAY_RATE,
  VORTAX_GRAVITY,
  VORTAX_RENDER_DISTANCE,
  VORTAX_SPAWN_BOUNDS,
  TIER_COLORS,
  TIER_RARITY,
  RARITY_COLORS,
  HEAD_FIRE_SIZE,
  HEAD_FIRE_HEIGHT,
  HEAD_FIRE_PARTICLE_COUNT,
  VORTAX_SCALE_VARIATION,
  VORTAX_BASE_SCALE,
  VORTAX_EMERGENCE_DURATION_MS,
  VORTAX_GROUP_SPREAD_RADIUS,
  SPAWN_SEQUENCE_TIMEOUT_MS,
  VORTAX_CHASE_SPEED_MULTIPLIER,
  VORTAX_LEG_ANIMATION_MULTIPLIER,
  VORTAX_HITBOX_RADIUS,
  VORTAX_HITBOX_HEIGHT,
  HEAD_SLIDE_AMPLITUDE,
  HEAD_SLIDE_SPEED,
  HEAD_BOB_AMPLITUDE,
  HEAD_CIRCLE_RADIUS,
  ARM_SWING_AMPLITUDE,
  ARM_SWING_UP_DOWN,
  ELBOW_BEND_MIN,
  ELBOW_BEND_MAX,
  DEFAULT_VORTAX_TEXTURE_URL,
  VORTAX_POP_SOUND_URL,
} from './constants';

// Components
export { VortaxRenderer } from './components/VortaxRenderer';
export type { VortaxRendererHandle } from './components/VortaxRenderer';
export { VortaxDesignPanel } from './components/VortaxDesignPanel';

// Hooks
export { useVortaxDefinitions, getVortaxDefinitionByTier, getVortaxDefinitionsCache } from './hooks/useVortaxDefinitions';
export { useVortaxSystem } from './hooks/useVortaxSystem';
