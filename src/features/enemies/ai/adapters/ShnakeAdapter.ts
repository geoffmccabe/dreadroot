/**
 * ShnakeAdapter - Bridges Shnake instances to the universal AI system
 * 
 * Phase 4: Full locomotion control - applyResult executes movement.
 */

import * as THREE from 'three';
import type { ShnakeInstance } from '@/features/shnake/types';
import type { PlantedTree } from '@/features/trees/types';
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
import { applyShnakeMove, applyShnakeAttack, type ShnakeLocomotionContext } from '../locomotion/ShnakeLocomotion';
import { EnemyManager } from '../EnemyManager';

/**
 * Extended shnake instance with AI state
 * Note: ai_config now comes from shnake.definition.ai_config (database column)
 */
export interface ShnakeWithAI extends ShnakeInstance {
  /** Timestamp of last damage taken */
  lastDamagedAt?: number;
}

// Module-level locomotion context (set by useEnemyAI hook)
let locomotionContext: {
  plantedTrees: PlantedTree[];
  worldBlocks: { position_x: number; position_y: number; position_z: number }[];
  treeBlocksByTier: Map<number, Map<string, string>> | null;
  onPlayerHit?: (damage: number, knockback: number, direction: THREE.Vector3) => void;
  onHeadMoved?: (shnakeId: string) => void;
} | null = null;

// Track attacked state per shnake (for canGoToGround)
const attackedStateMap = new Map<string, { wasAttacked: boolean; attackedAt: number }>();

/**
 * Set locomotion context for shnake movement execution.
 * Called by useEnemyAI hook when aiControlled=true.
 */
export function setShnakeLocomotionContext(ctx: typeof locomotionContext): void {
  locomotionContext = ctx;
}

/**
 * Mark a shnake as attacked (allows ground descent for 30s).
 */
export function markShnakeAttacked(shnakeId: string): void {
  attackedStateMap.set(shnakeId, { wasAttacked: true, attackedAt: performance.now() });
}

/**
 * Cleanup shnake resources when unregistered.
 */
export function cleanupShnakeResources(shnakeId: string): void {
  attackedStateMap.delete(shnakeId);
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
    shnake: ShnakeWithAI, 
    result: BehaviorResult, 
    _deltaMs: number
  ): void {
    // Only execute if AI is in control and we have locomotion context
    if (!EnemyManager.isAIControlled() || !locomotionContext) {
      return;
    }
    
    if (result.kind === 'idle') {
      return;
    }
    
    if (result.kind === 'move') {
      // Find the tree for this shnake
      const tree = locomotionContext.plantedTrees.find(t => t.id === shnake.treeId);
      if (!tree) return;
      
      // Check attacked state for canGoToGround
      const attackedState = attackedStateMap.get(shnake.id);
      const now = performance.now();
      let canGoToGround = false;
      
      if (attackedState?.wasAttacked) {
        // 30 second window after being attacked
        if (now - attackedState.attackedAt < 30000) {
          canGoToGround = true;
        } else {
          attackedState.wasAttacked = false;
        }
      }
      
      // Build locomotion context for this shnake
      const ctx: ShnakeLocomotionContext = {
        tree,
        treeBlocksByTier: locomotionContext.treeBlocksByTier,
        worldBlocks: locomotionContext.worldBlocks,
        canGoToGround,
        onHeadMoved: locomotionContext.onHeadMoved,
      };
      
      applyShnakeMove(shnake, result, ctx);
    }
    
    if (result.kind === 'attack') {
      applyShnakeAttack(shnake, result, locomotionContext.onPlayerHit);
    }
  },
  
  getBehaviors(shnake: ShnakeWithAI): BehaviorModule[] {
    const behaviors = shnake.definition.ai_config?.behaviors ?? DEFAULT_AI_CONFIG.behaviors;
    return getBehaviorsByIds(behaviors);
  },
};
