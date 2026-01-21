/**
 * ShwarmAdapter - Bridges Shwarm instances to the universal AI system
 * 
 * Phase 4: Full locomotion control - applyResult executes movement.
 */

import * as THREE from 'three';
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
import { 
  applyShwarmMove, 
  getOrCreateBlockTarget,
  type ShwarmBlockTarget,
  type ShwarmLocomotionContext,
} from '../locomotion/ShwarmLocomotion';
import { EnemyManager } from '../EnemyManager';
import { collisionGrid } from '@/lib/spatialHashGrid';

// Seeded random number generator for deterministic movement
function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

/**
 * Extended shwarm instance with AI state
 * Note: ai_config now comes from shwarm.definition.ai_config (database column)
 */
export interface ShwarmWithAI extends ShwarmInstance {
  /** Timestamp of last damage taken */
  lastDamagedAt?: number;
  /** Last attack timestamp */
  lastAttackAt?: number;
}

// Module-level locomotion context (set by useEnemyAI hook)
let locomotionContext: {
  onPlayerHit?: (damage: number, knockback: number, direction: THREE.Vector3) => void;
} | null = null;

// Per-shwarm RNG generators (cleaned up when shwarm unregisters)
const rngMap = new Map<string, () => number>();

// Block target data storage - shared with interpolation loop when AI controls
// Exported so useShwarmMovement can use it when aiControlled=true
export const shwarmBlockTargets = new Map<string, ShwarmBlockTarget>();

/**
 * Set locomotion context for shwarm movement execution.
 * Called by useEnemyAI hook when aiControlled=true.
 */
export function setShwarmLocomotionContext(ctx: typeof locomotionContext): void {
  locomotionContext = ctx;
}

/**
 * Cleanup shwarm resources when unregistered.
 * Called by EnemyManager when a shwarm is removed.
 */
export function cleanupShwarmResources(shwarmId: string, blocks: { id: string }[]): void {
  rngMap.delete(shwarmId);
  for (const block of blocks) {
    const target = shwarmBlockTargets.get(block.id);
    if (target?.collider) {
      collisionGrid.remove(target.collider);
    }
    shwarmBlockTargets.delete(block.id);
  }
}

/**
 * Get or create RNG for a shwarm
 */
function getRng(shwarmId: string, seed: number): () => number {
  if (!rngMap.has(shwarmId)) {
    rngMap.set(shwarmId, seededRandom(seed));
  }
  return rngMap.get(shwarmId)!;
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
    // OPTIMIZATION: Use cached center if available (set by useShwarmMovement)
    // This avoids O(blockCount) iteration every frame for LOD checks
    const cached = (shwarm as any).__aiCenter;
    if (cached && typeof cached.x === 'number') {
      return cached;
    }
    
    // Fallback: calculate center of mass (only if cache not present)
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
    
    // Use ai_config from definition (database column), fallback to defaults
    const defConfig = shwarm.definition.ai_config;
    const detectionRange = defConfig?.detectionRange ?? DEFAULT_AI_CONFIG.detectionRange;
    const attackRange = defConfig?.attackRange ?? DEFAULT_AI_CONFIG.attackRange;
    const angryDurationMs = defConfig?.angryDurationMs ?? DEFAULT_AI_CONFIG.angryDurationMs;
    const angrySpeedMultiplier = defConfig?.angrySpeedMultiplier ?? DEFAULT_AI_CONFIG.angrySpeedMultiplier;
    const attackCooldownMs = defConfig?.attackCooldownMs ?? 500;
    
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
      
      nearbyAllies: 0, // Not computed - no behaviors currently use it
      nearbyEnemies: 0,
      
      custom: {
        tier: shwarm.definition.tier,
        aliveBlockCount: aliveCount,
        totalBlockCount: shwarm.blocks.length,
        detectionRange,
        attackRange,
        angryDurationMs,
        angrySpeedMultiplier,
        attackCooldownMs,
        damage: shwarm.definition.damage_per_hit,
        knockback: 1 + shwarm.definition.tier,
        xFactor: shwarm.definition.x_factor,
        speed: shwarm.definition.speed,
      },
      
      state,
    };
  },
  
  applyResult(
    shwarm: ShwarmWithAI, 
    result: BehaviorResult, 
    _deltaMs: number
  ): void {
    // Only execute if AI is in control
    if (!EnemyManager.isAIControlled()) {
      return;
    }
    
    if (result.kind === 'idle') {
      return;
    }
    
    if (result.kind === 'move') {
      const rng = getRng(shwarm.id, shwarm.seed);
      
      // Pass blocks directly - locomotion already skips dead blocks internally
      // Avoids .filter() allocation per tick
      const ctx: ShwarmLocomotionContext = {
        playerX: result.tx,
        playerY: result.ty,
        playerZ: result.tz,
        blockTargets: shwarmBlockTargets,
        rng,
        tier: shwarm.definition.tier,
      };
      
      applyShwarmMove(shwarm, result, ctx, shwarm.blocks);
    }
    
    // Attack is handled by the interpolation loop in useShwarmMovement
    // Since shwarm attacks are per-block continuous collision detection
  },
  
  getBehaviors(shwarm: ShwarmWithAI): BehaviorModule[] {
    const behaviors = shwarm.definition.ai_config?.behaviors ?? DEFAULT_AI_CONFIG.behaviors;
    return getBehaviorsByIds(behaviors);
  },
};
