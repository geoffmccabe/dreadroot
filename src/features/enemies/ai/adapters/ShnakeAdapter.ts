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
import { getBehaviorsByIds, type RevengeTarget, STUN_DURATION_MS } from '../behaviors';
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
  treeById: Map<string, PlantedTree>;
  treeBlocksByTier: Map<number, Map<string, string>> | null;
  onPlayerHit?: (damage: number, knockback: number, direction: THREE.Vector3, shnakeId?: string) => void;
  onHeadMoved?: (shnakeId: string) => void;
  onIndignantRoar?: (shnakeId: string, volume: number) => void;
  onTriggerWiggle?: (shnakeId: string) => void;
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
 * Mark a shnake as indignant (body was hit, triggers wiggle animation).
 * This is called from FortressScene when a bullet ricochets off shnake body.
 */
export function markShnakeIndignant(shnakeId: string): void {
  const entry = EnemyManager.getEntry(shnakeId);
  if (entry) {
    entry.behaviorState.isIndignant = true;
  }
}

/**
 * Initialize revenge tracking for a shnake (called when head takes damage).
 * Also marks the shnake as attacked so it can descend to ground level.
 */
/**
 * Initialize revenge tracking for a shnake (called when head takes damage).
 * Also marks the shnake as attacked so it can descend to ground level.
 * 
 * @param shnakeId - The shnake's ID
 * @param damageReceived - Amount of damage taken
 * @param attackerId - ID of the player who dealt the damage (becomes new chase target)
 */
export function initializeShnakeRevenge(shnakeId: string, damageReceived: number, attackerId?: string): void {
  const entry = EnemyManager.getEntry(shnakeId);
  if (!entry) {
    console.warn(`[ShnakeAdapter] initializeShnakeRevenge: No entry for ${shnakeId}`);
    return;
  }
  
  // Mark as attacked so shnake can go to ground
  markShnakeAttacked(shnakeId);
  
  const now = performance.now();
  const state = entry.behaviorState;
  const existing = state.revengeTarget as RevengeTarget | null;
  
  // STUN MECHANIC: If already in revenge mode, headshot stuns for 2 seconds
  // This gives the player a chance to escape or deal more damage
  if (existing) {
    state.stunnedUntil = now + STUN_DURATION_MS;
    console.log(`[ShnakeAdapter] Headshot stun applied for ${STUN_DURATION_MS}ms`);
  }
  
  if (existing) {
    // Add to existing revenge, switch target to newest attacker, and reset timeout
    state.revengeTarget = {
      damageReceived: existing.damageReceived + damageReceived,
      damageDealt: existing.damageDealt,
      startedAt: existing.startedAt,
      lastDamageAt: now,
      currentTargetId: attackerId ?? existing.currentTargetId, // Switch to new attacker
    } as RevengeTarget;
    console.log(`[ShnakeAdapter] Added ${damageReceived} to revenge (total: ${existing.damageReceived + damageReceived}), new target: ${attackerId ?? 'same'}`);
  } else {
    // Start new revenge (no stun on first hit - only subsequent headshots stun)
    state.revengeTarget = {
      damageReceived,
      damageDealt: 0,
      startedAt: now,
      lastDamageAt: now,
      currentTargetId: attackerId ?? null,
    } as RevengeTarget;
    console.log(`[ShnakeAdapter] Started revenge with ${damageReceived} damage, target: ${attackerId ?? 'local'}`);
  }
}

/**
 * Record damage dealt by shnake during revenge (called when shnake hits any player).
 * Damage can be split across multiple players - shnake doesn't care who it hits.
 */
export function recordShnakeRevengeDamage(shnakeId: string, damageDealt: number): void {
  const entry = EnemyManager.getEntry(shnakeId);
  if (!entry) return;
  
  const now = performance.now();
  const state = entry.behaviorState;
  const existing = state.revengeTarget as RevengeTarget | null;
  
  if (existing) {
    state.revengeTarget = {
      damageReceived: existing.damageReceived,
      damageDealt: existing.damageDealt + damageDealt,
      startedAt: existing.startedAt,
      lastDamageAt: now, // Reset timeout on successful hit
      currentTargetId: existing.currentTargetId,
    } as RevengeTarget;
    
    const newTotal = existing.damageDealt + damageDealt;
    const satisfied = newTotal >= existing.damageReceived;
    console.log(`[ShnakeAdapter] Revenge damage dealt: ${damageDealt} (${newTotal}/${existing.damageReceived})${satisfied ? ' - SATISFIED!' : ''}`);
  }
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
    
    // OPTIMIZATION: Use pre-computed home position from behavior state or tree base
    // Instead of iterating all tier blocks every tick (was O(n) = thousands of iterations)
    // Patrol targets are set lazily by the patrol behavior itself
    const tree = locomotionContext?.treeById.get(shnake.treeId);
    
    // Check if touching tree: O(6) neighbor check instead of O(n) full scan
    // Only check head segment - if head is touching tree, shnake is "home"
    let isTouchingTree = false;
    if (locomotionContext?.treeBlocksByTier) {
      const tierBlocks = locomotionContext.treeBlocksByTier.get(shnake.tier);
      if (tierBlocks) {
        const head = shnake.segments[0];
        const neighbors = [
          `${head.x + 1},${head.y},${head.z}`, `${head.x - 1},${head.y},${head.z}`,
          `${head.x},${head.y + 1},${head.z}`, `${head.x},${head.y - 1},${head.z}`,
          `${head.x},${head.y},${head.z + 1}`, `${head.x},${head.y},${head.z - 1}`,
        ];
        isTouchingTree = neighbors.some(n => tierBlocks.has(n));
      }
    }
    
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
      
      nearbyAllies: 0, // Not computed - no behaviors currently use it
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
        // Tree data for patrol/returnHome behaviors - base position only, not all blocks
        treeBaseX: tree?.base_x,
        treeBaseY: tree?.base_y,
        treeBaseZ: tree?.base_z,
        isTouchingTree,
        // Pass tier blocks ref for O(1) lookups by patrol behavior (not iteration)
        treeBlocksByTier: locomotionContext?.treeBlocksByTier,
        // Indignant behavior callbacks
        onIndignantRoar: (volume: number) => {
          locomotionContext?.onIndignantRoar?.(shnake.id, volume);
        },
        onTriggerWiggle: () => {
          locomotionContext?.onTriggerWiggle?.(shnake.id);
        },
      },
      
      state,
    };
  },
  
  applyResult(
    shnake: ShnakeWithAI, 
    result: BehaviorResult, 
    _deltaMs: number,
    shared?: SharedContext
  ): void {
    // Only execute if AI is in control and we have locomotion context
    if (!EnemyManager.isAIControlled() || !locomotionContext) {
      return;
    }
    
    if (result.kind === 'idle') {
      return;
    }
    
    if (result.kind === 'move') {
      // O(1) tree lookup using treeById Map instead of O(n) find
      const tree = locomotionContext.treeById.get(shnake.treeId);
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
      
      // Build locomotion context for this shnake (no worldBlocks - uses collisionGrid O(1) lookup)
      const ctx: ShnakeLocomotionContext = {
        tree,
        treeBlocksByTier: locomotionContext.treeBlocksByTier,
        canGoToGround,
        tier: shnake.tier,
        deltaSeconds: (shared?.deltaMs ?? 100) / 1000,
        onHeadMoved: locomotionContext.onHeadMoved,
      };
      
      applyShnakeMove(shnake, result, ctx);
    }
    
    if (result.kind === 'attack') {
      // Need player position to verify attack range
      const playerX = shared?.playerX ?? 0;
      const playerY = shared?.playerY ?? 0;
      const playerZ = shared?.playerZ ?? 0;
      applyShnakeAttack(shnake, result, playerX, playerY, playerZ, locomotionContext.onPlayerHit);
    }
  },
  
  getBehaviors(shnake: ShnakeWithAI): BehaviorModule[] {
    const behaviors = shnake.definition.ai_config?.behaviors ?? DEFAULT_AI_CONFIG.behaviors;
    return getBehaviorsByIds(behaviors);
  },
};
