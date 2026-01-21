/**
 * ShnakeAdapter - Bridges Shnake instances to the universal AI system
 * 
 * Phase 3: Advisory mode - behaviors are evaluated but movement is still
 * handled by useShnakeMovement. applyResult is a no-op.
 */

import type { ShnakeInstance } from '@/features/shnake/types';
import type { 
  EnemyAdapter, 
  BehaviorContext, 
  BehaviorResult, 
  SharedContext,
  BehaviorState,
  BehaviorModule,
} from '../types';
import { getBehaviorsByIds } from '../behaviors';
import { DEFAULT_AI_CONFIG } from '../types';

/**
 * Extended shnake instance with AI state
 * Note: ai_config now comes from shnake.definition.ai_config (database column)
 */
export interface ShnakeWithAI extends ShnakeInstance {
  /** Timestamp of last damage taken */
  lastDamagedAt?: number;
}

/**
 * Adapter for Shnake enemies
 */
export const ShnakeAdapter: EnemyAdapter<ShnakeWithAI> = {
  getId(shnake: ShnakeWithAI): string {
    return shnake.id;
  },
  
  getType(): string {
    return 'shnake';
  },
  
  getPosition(shnake: ShnakeWithAI): { x: number; y: number; z: number } {
    // Use head segment position
    const head = shnake.segments[0];
    return {
      x: head.x + 0.5, // Center of cell
      y: head.y + 0.5,
      z: head.z + 0.5,
    };
  },
  
  buildContext(
    shnake: ShnakeWithAI, 
    shared: SharedContext,
    state: BehaviorState
  ): BehaviorContext {
    const head = shnake.segments[0];
    const ex = head.x + 0.5;
    const ey = head.y + 0.5;
    const ez = head.z + 0.5;
    
    const dx = shared.playerX - ex;
    const dy = shared.playerY - ey;
    const dz = shared.playerZ - ez;
    const distToPlayer = Math.sqrt(dx * dx + dy * dy + dz * dz);
    
    const now = performance.now();
    
    // Use ai_config from definition (database column), fallback to defaults
    const defConfig = shnake.definition.ai_config;
    const detectionRange = defConfig?.detectionRange ?? DEFAULT_AI_CONFIG.detectionRange;
    const attackRange = defConfig?.attackRange ?? DEFAULT_AI_CONFIG.attackRange;
    const angryDurationMs = defConfig?.angryDurationMs ?? DEFAULT_AI_CONFIG.angryDurationMs;
    const angrySpeedMultiplier = defConfig?.angrySpeedMultiplier ?? DEFAULT_AI_CONFIG.angrySpeedMultiplier;
    const attackCooldownMs = defConfig?.attackCooldownMs ?? 600;
    
    return {
      entityId: shnake.id,
      entityType: 'shnake',
      
      ex, ey, ez,
      px: shared.playerX,
      py: shared.playerY,
      pz: shared.playerZ,
      
      distToPlayer,
      hasLineOfSight: distToPlayer < 32, // Simplified for now - shnakes in tree have LOS
      
      health: shnake.headHealth,
      maxHealth: shnake.definition.health_per_segment,
      
      msSinceLastAttack: now - shnake.lastAttackAt,
      msSinceLastDamaged: shnake.lastDamagedAt ? now - shnake.lastDamagedAt : 999999,
      
      nearbyAllies: 0, // Will be filled by EnemyManager
      nearbyEnemies: 0,
      
      custom: {
        treeId: shnake.treeId,
        tier: shnake.tier,
        segmentCount: shnake.segments.length,
        detectionRange,
        attackRange,
        angryDurationMs,
        angrySpeedMultiplier,
        attackCooldownMs,
        damage: shnake.definition.damage_per_hit,
        knockback: shnake.definition.knockback,
      },
      
      state,
    };
  },
  
  applyResult(
    _shnake: ShnakeWithAI, 
    _result: BehaviorResult, 
    _deltaMs: number
  ): void {
    // Phase 3: Results are purely advisory - NO MUTATIONS
    // Actual movement and attacks are handled by useShnakeMovement
    // Future: migrate locomotion control here to unify AI decision-making
  },
  
  getBehaviors(shnake: ShnakeWithAI): BehaviorModule[] {
    const behaviors = shnake.definition.ai_config?.behaviors ?? DEFAULT_AI_CONFIG.behaviors;
    return getBehaviorsByIds(behaviors);
  },
};
