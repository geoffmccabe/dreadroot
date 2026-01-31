// Types
export type { ShtickmanDefinition, ShtickmanInstance } from './types';
export { getHeightBlocks, getHeadSizeBlocks } from './types';

// Constants
export {
  MAX_TOTAL_SHTICKMEN,
  SPAWN_MIN_DISTANCE,
  SPAWN_MAX_DISTANCE,
  EXISTENCE_CHECK_INTERVAL_MS,
  TARGET_CHANGE_INTERVAL_MS,
  KNOCKBACK_DECAY_RATE,
  SHTICKMAN_GRAVITY,
  SHTICKMAN_RENDER_DISTANCE,
  SHTICKMAN_HITBOX_RADIUS,
  SHTICKMAN_SCALE_VARIATION,
  TIER_COLORS,
  TIER_RARITY,
} from './constants';

// Components
export { ShtickmanRenderer } from './components/ShtickmanRenderer';
export type { ShtickmanRendererHandle } from './components/ShtickmanRenderer';
export { ShtickmanDesignPanel } from './components/ShtickmanDesignPanel';

// Hooks
export { useShtickmanDefinitions, getShtickmanDefinitionByTier, getShtickmanDefinitionsCache } from './hooks/useShtickmanDefinitions';
export { useShtickmanSystem } from './hooks/useShtickmanSystem';
