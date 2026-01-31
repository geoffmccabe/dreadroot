// Types
export type {
  WalapaDefinition,
  WalapaPart,
  WalapaState,
  WalapaInstance,
  WalapaAIConfig,
  WalapaSoundConfig,
} from './types';
export {
  WALAPA_BODY_PARTS,
  PARTS_PER_WALAPA,
  WALAPA_TIER_COLORS,
  getTierSizeMultiplier,
  getTierDimensions,
  generateWalapaBodyBlocks,
} from './types';

// Constants
export {
  MAX_WALAPAS_TOTAL,
  SPAWN_CHECK_INTERVAL_MS,
  WALAPA_BASE_SPEED,
  WALAPA_FLOAT_HEIGHT,
  WALAPA_BOB_AMPLITUDE,
  WALAPA_BOB_SPEED,
  WALAPA_TAIL_SPEED,
  WALAPA_DEFAULT_MIN_TREE_TIER,
  WALAPA_DEFAULT_WAIT_TIME,
  WALAPA_SEARCH_RADIUS,
  WALAPA_OBSTACLE_AVOIDANCE_DISTANCE,
  WALAPA_WAYPOINT_ARRIVAL_THRESHOLD,
  WALAPA_RENDER_DISTANCE,
  WALAPA_SCALE_VARIATION,
  WALAPA_HITBOX_RADIUS,
  WALAPA_HITBOX_HEIGHT,
  WALAPA_MAX_RIDERS,
  WALAPA_RIDER_BOARD_DISTANCE,
  TIER_COLORS,
  TIER_RARITY,
  RARITY_COLORS,
  DEFAULT_WALAPA_BODY_COLOR,
  DEFAULT_WALAPA_BELLY_COLOR,
  DEFAULT_WALAPA_EYES_COLOR,
} from './constants';

// Components
export { WalapaDesignPanel } from './components/WalapaDesignPanel';
export { WalapaRenderer } from './components/WalapaRenderer';
export type { WalapaRendererHandle } from './components/WalapaRenderer';

// Hooks
export {
  useWalapaDefinitions,
  getWalapaDefinitionByTier,
  getWalapaDefinitionsCache,
  DEFAULT_WALAPA_DEFINITION,
} from './hooks/useWalapaDefinitions';
export { useWalapaSystem } from './hooks/useWalapaSystem';
