/**
 * ShwarmAdapter - Bridges Shwarm instances to the universal AI system
 * 
 * Phase 2: Wraps existing shwarm logic, will be called by EnemyManager
 * instead of the shwarm's own setInterval loop.
 */

import type { ShwarmInstance } from '@/features/shwarm/hooks/useShwarmSystem';
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
 * Extended shwarm instance with AI state
 */
export interface ShwarmWithAI extends ShwarmInstance {
  /** Timestamp of last damage taken */
  lastDamagedAt?: number;
  /** Last attack timestamp */
  lastAttackAt?: number;
  /** AI configuration from definition */
  aiConfig?: typeof DEFAULT_AI_CONFIG;
}

/**
 * Adapter for Shwarm enemies
 */
export const ShwarmAdapter: EnemyAdapter<ShwarmWithAI> = {
  getId(shwarm: ShwarmWithAI): string {
    return shwarm.id;
  },
  
  getType(): string {
    return 'shwarm';
  },
  
  getPosition(shwarm: ShwarmWithAI): { x: number; y: number; z: number } {
    // Calculate center of mass of alive blocks
    let cx = 0, cy = 0, cz = 0, count = 0;
    
    for (const block of shwarm.blocks) {
      if (block.isAlive) {
        cx += block.position.x;
        cy += block.position.y;
        cz += block.position.z;
        count++;
      }
    }
    
    if (count === 0) {
      // Fallback to first block position
      const first = shwarm.blocks[0];
      return {
        x: first?.position.x ?? 0,
        y: first?.position.y ?? 0,
        z: first?.position.z ?? 0,
      };
    }
    
    return {
      x: cx / count,
      y: cy / count,
      z: cz / count,
    };
  },
  
  buildContext(
    shwarm: ShwarmWithAI, 
    shared: SharedContext,
    state: BehaviorState
  ): BehaviorContext {
    const pos = this.getPosition(shwarm);
    const ex = pos.x;
    const ey = pos.y;
    const ez = pos.z;
    
    const dx = shared.playerX - ex;
    const dy = shared.playerY - ey;
    const dz = shared.playerZ - ez;
    const distToPlayer = Math.sqrt(dx * dx + dy * dy + dz * dz);
    
    const now = performance.now();
    const config = shwarm.aiConfig ?? DEFAULT_AI_CONFIG;
    
    // Calculate total health of alive blocks
    let totalHealth = 0;
    let maxHealth = 0;
    let aliveCount = 0;
    
    for (const block of shwarm.blocks) {
      if (block.isAlive) {
        totalHealth += block.currentHealth;
        maxHealth += block.maxHealth;
        aliveCount++;
      }
    }
    
    return {
      entityId: shwarm.id,
      entityType: 'shwarm',
      
      ex, ey, ez,
      px: shared.playerX,
      py: shared.playerY,
      pz: shared.playerZ,
      
      distToPlayer,
      hasLineOfSight: true, // Shwarms fly, assume LOS
      
      health: totalHealth,
      maxHealth: maxHealth || 1,
      
      msSinceLastAttack: shwarm.lastAttackAt ? now - shwarm.lastAttackAt : 999999,
      msSinceLastDamaged: shwarm.lastDamagedAt ? now - shwarm.lastDamagedAt : 999999,
      
      nearbyAllies: 0, // Will be filled by EnemyManager
      nearbyEnemies: 0,
      
      custom: {
        tier: shwarm.definition.tier,
        aliveBlockCount: aliveCount,
        totalBlockCount: shwarm.blocks.length,
        detectionRange: config.detectionRange,
        attackRange: config.attackRange,
        angryDurationMs: config.angryDurationMs,
        angrySpeedMultiplier: config.angrySpeedMultiplier,
        damage: shwarm.definition.damage_per_hit,
        knockback: 1 + shwarm.definition.tier, // TODO: Add knockback column to definition
        // TODO: Move to ai_config when Phase 3 adds DB column
        attackCooldownMs: 500,
        xFactor: shwarm.definition.x_factor,
        speed: shwarm.definition.speed,
      },
      
      state,
    };
  },
  
  applyResult(
    _shwarm: ShwarmWithAI, 
    _result: BehaviorResult, 
    _deltaMs: number
  ): void {
    // Phase 2: Results are purely advisory - NO MUTATIONS
    // Actual movement and attacks are handled by useShwarmMovement
    // This will be used in Phase 3 when we migrate locomotion control
  },
  
  getBehaviors(shwarm: ShwarmWithAI): BehaviorModule[] {
    const config = shwarm.aiConfig ?? DEFAULT_AI_CONFIG;
    return getBehaviorsByIds(config.behaviors);
  },
};
