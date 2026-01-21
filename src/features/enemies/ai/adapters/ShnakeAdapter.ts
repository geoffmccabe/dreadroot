/**
 * ShnakeAdapter - Bridges Shnake instances to the universal AI system
 * 
 * Phase 2: Wraps existing shnake logic, will be called by EnemyManager
 * instead of the shnake's own requestAnimationFrame loop.
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
 */
export interface ShnakeWithAI extends ShnakeInstance {
  /** Timestamp of last damage taken */
  lastDamagedAt?: number;
  /** AI configuration from definition */
  aiConfig?: typeof DEFAULT_AI_CONFIG;
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
    const config = shnake.aiConfig ?? DEFAULT_AI_CONFIG;
    
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
        detectionRange: config.detectionRange,
        attackRange: config.attackRange,
        angryDurationMs: config.angryDurationMs,
        angrySpeedMultiplier: config.angrySpeedMultiplier,
        damage: shnake.definition.damage_per_hit,
        knockback: shnake.definition.knockback,
        attackCooldownMs: 600,
      },
      
      state,
    };
  },
  
  applyResult(
    shnake: ShnakeWithAI, 
    result: BehaviorResult, 
    _deltaMs: number
  ): void {
    // Phase 2: Results are advisory - actual movement is still handled by useShnakeMovement
    // This will be used for tracking intent and debugging
    
    if (result.kind === 'attack') {
      // Attack intent is noted but actual attack handled by existing code
      shnake.lastAttackAt = performance.now();
    }
    
    // Move intents will be used in Phase 3 when we refactor locomotion
    // For now, the existing RAF loop handles actual movement
  },
  
  getBehaviors(shnake: ShnakeWithAI): BehaviorModule[] {
    const config = shnake.aiConfig ?? DEFAULT_AI_CONFIG;
    return getBehaviorsByIds(config.behaviors);
  },
};
