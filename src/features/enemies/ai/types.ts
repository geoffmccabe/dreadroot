/**
 * Universal Enemy Behavior System - Core Types
 * 
 * Zero-allocation design: uses numeric coords instead of THREE.Vector3
 * to prevent GC churn during hot loops.
 */

import type * as THREE from 'three';

// =============================================================================
// LOD (Level of Detail) System
// =============================================================================

export enum AILodLevel {
  FULL = 0,      // < 32m: Full tick every frame
  THROTTLED = 1, // 32-80m: Tick every ~150ms
  FROZEN = 2,    // > 80m: No updates, position cached
}

export const LOD_CONFIG = {
  FULL_DISTANCE: 32,
  THROTTLED_DISTANCE: 80,
  FROZEN_DISTANCE: 80,
  WAKE_DISTANCE: 70, // Hysteresis: only wake frozen enemies when closer than this
} as const;

export const TICK_INTERVALS_MS = {
  [AILodLevel.FULL]: 0,        // Every frame
  [AILodLevel.THROTTLED]: 150, // Every 150ms
  [AILodLevel.FROZEN]: Infinity,
} as const;

// =============================================================================
// Behavior Context (Zero-Allocation)
// =============================================================================

/**
 * Context passed to behavior evaluators each tick.
 * Uses numeric coordinates to avoid THREE.Vector3 allocations.
 */
export interface BehaviorContext {
  entityId: string;
  entityType: string; // 'shnake' | 'shwarm' | etc.
  
  // Enemy position (numeric)
  ex: number;
  ey: number;
  ez: number;
  
  // Player position (numeric)
  px: number;
  py: number;
  pz: number;
  
  // Derived values (computed once per tick)
  distToPlayer: number;
  hasLineOfSight: boolean;
  
  // Health state
  health: number;
  maxHealth: number;
  
  // Timing (milliseconds)
  msSinceLastAttack: number;
  msSinceLastDamaged: number;
  
  // Social awareness
  nearbyAllies: number;
  nearbyEnemies: number;
  
  // Enemy-specific data (avoids interface explosion)
  custom: Record<string, unknown>;
}

/**
 * Shared context that's computed once per frame and passed to all adapters.
 * Contains player info and shared scratch vectors.
 */
export interface SharedContext {
  playerX: number;
  playerY: number;
  playerZ: number;
  deltaMs: number;
  elapsedMs: number;
  
  // Scratch vectors for locomotion (reused, not allocated)
  scratchVec1: THREE.Vector3;
  scratchVec2: THREE.Vector3;
  scratchVec3: THREE.Vector3;
}

// =============================================================================
// Behavior Results
// =============================================================================

/**
 * Result returned by behavior tick functions.
 * Discriminated union for type-safe intent handling.
 */
export type BehaviorResult =
  | { kind: 'idle' }
  | { kind: 'move'; tx: number; ty: number; tz: number; speedMultiplier?: number }
  | { kind: 'attack'; damage: number; knockback: number; dirX: number; dirY: number; dirZ: number };

// =============================================================================
// Behavior Module Interface
// =============================================================================

/**
 * A behavior module implements a single behavior (sleep, chase, attack, etc.)
 * Modules are stateless - all state lives in the enemy instance.
 */
export interface BehaviorModule {
  /** Unique identifier for this behavior */
  id: string;
  
  /** Human-readable name */
  name: string;
  
  /**
   * Evaluate how appropriate this behavior is given the context.
   * @returns Score from 0.0 (never) to 1.0 (highest priority)
   */
  evaluate(ctx: BehaviorContext): number;
  
  /**
   * Called when transitioning TO this behavior.
   * Use for one-time setup (play sound, set flags).
   */
  enter?(ctx: BehaviorContext): void;
  
  /**
   * Execute one tick of this behavior.
   * @returns Intent for the locomotion layer to execute
   */
  tick(ctx: BehaviorContext, deltaMs: number): BehaviorResult;
  
  /**
   * Called when transitioning AWAY from this behavior.
   * Use for cleanup.
   */
  exit?(ctx: BehaviorContext): void;
}

// =============================================================================
// Enemy Adapter Interface
// =============================================================================

/**
 * Adapters bridge the universal AI system to specific enemy types.
 * Each enemy type (Shnake, Shwarm, etc.) implements this interface.
 */
export interface EnemyAdapter<TEnemy> {
  /** Get unique ID for this enemy instance */
  getId(enemy: TEnemy): string;
  
  /** Get enemy type identifier */
  getType(): string;
  
  /** Get current position for LOD calculations */
  getPosition(enemy: TEnemy): { x: number; y: number; z: number };
  
  /** Build behavior context from enemy state */
  buildContext(enemy: TEnemy, shared: SharedContext): BehaviorContext;
  
  /** Apply behavior result to enemy (movement, attack, etc.) */
  applyResult(enemy: TEnemy, result: BehaviorResult, deltaMs: number): void;
  
  /** Optional: get position for LOD anchor (defaults to getPosition) */
  getLodAnchor?(enemy: TEnemy): { x: number; y: number; z: number };
  
  /** Get behaviors enabled for this enemy */
  getBehaviors(enemy: TEnemy): BehaviorModule[];
}

// =============================================================================
// AI Configuration (stored in Supabase ai_config column)
// =============================================================================

export interface AIConfig {
  /** Which behaviors are enabled for this enemy tier */
  behaviors: string[];
  
  /** Distance at which enemy detects player */
  detectionRange: number;
  
  /** Distance at which enemy can attack */
  attackRange: number;
  
  /** Speed multiplier when angry */
  angrySpeedMultiplier: number;
  
  /** How long angry state lasts (ms) */
  angryDurationMs: number;
  
  /** Custom behavior-specific settings */
  custom?: Record<string, unknown>;
}

export const DEFAULT_AI_CONFIG: AIConfig = {
  behaviors: ['sleep', 'wander', 'chase', 'attack'],
  detectionRange: 32,
  attackRange: 1.5,
  angrySpeedMultiplier: 1.5,
  angryDurationMs: 30000,
};

// =============================================================================
// Enemy Entry for Spatial Index
// =============================================================================

export interface EnemyEntry {
  id: string;
  type: string;
  x: number;
  z: number;
  y: number;
}

// =============================================================================
// Registration Types
// =============================================================================

export interface RegisteredEnemy<TEnemy = unknown> {
  enemy: TEnemy;
  adapter: EnemyAdapter<TEnemy>;
  lodLevel: AILodLevel;
  lastTickTime: number;
  currentBehaviorId: string | null;
}
