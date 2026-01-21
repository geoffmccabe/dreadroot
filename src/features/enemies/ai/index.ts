/**
 * Universal Enemy Behavior System
 * 
 * Modular AI architecture with:
 * - LOD-based tick throttling
 * - Utility scoring for behavior selection
 * - Zero-allocation context design
 * - Adapter pattern for enemy type integration
 */

// Core types
export type {
  BehaviorContext,
  BehaviorState,
  SharedContext,
  BehaviorResult,
  BehaviorModule,
  EnemyAdapter,
  AIConfig,
  EnemyEntry,
  RegisteredEnemy,
} from './types';

export {
  AILodLevel,
  LOD_CONFIG,
  TICK_INTERVALS_MS,
  DEFAULT_AI_CONFIG,
} from './types';

// Core classes
export { EnemyManager } from './EnemyManager';
export { BehaviorBrain } from './BehaviorBrain';
export { EnemySpatialIndex } from './EnemySpatialIndex';

// Sensing
export { hasLineOfSight, canSeePoint } from './sensing/lineOfSight';

// Behaviors
export {
  behaviors,
  getBehaviorsByIds,
  getAllBehaviorIds,
  SleepBehavior,
  WanderBehavior,
  ChaseBehavior,
  AttackBehavior,
  AngryBehavior,
} from './behaviors';

// Adapters
export { ShnakeAdapter, ShwarmAdapter, ShombieAdapter } from './adapters';
export type { ShnakeWithAI, ShwarmWithAI, ShombieWithAI } from './adapters';

// Hooks
export { useEnemyAI } from './hooks';
