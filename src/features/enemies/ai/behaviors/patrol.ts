/**
 * Patrol Behavior - Active movement around the tree
 * 
 * Shnakes pick a random tree block position as destination,
 * travel to it, then either pause briefly or pick a new destination.
 * Replaces Sleep/Wander for shnakes.
 */

import type { BehaviorContext, BehaviorModule, BehaviorResult } from '../types';

// Patrol timing constants
const PATROL_PAUSE_CHANCE = 0.3; // 30% chance to pause when reaching destination
const PATROL_PAUSE_MIN_MS = 1000; // 1 second minimum pause
const PATROL_PAUSE_MAX_MS = 3000; // 3 seconds maximum pause
const PATROL_DESTINATION_REACHED_THRESHOLD = 1.5; // Within 1.5 units = arrived

const DEBUG_PATROL = false;

export const PatrolBehavior: BehaviorModule = {
  id: 'patrol',
  name: 'Patrol',

  evaluate(ctx: BehaviorContext): number {
    if (DEBUG_PATROL) {
      console.log(`[Patrol] Evaluating for ${ctx.entityId}, distToPlayer=${ctx.distToPlayer.toFixed(1)}, hasLOS=${ctx.hasLineOfSight}`);
    }
    // Check if currently pursuing revenge (revenge takes priority)
    const revengeTarget = ctx.state.revengeTarget as { damageReceived: number; damageDealt: number } | null;
    if (revengeTarget && revengeTarget.damageDealt < revengeTarget.damageReceived) {
      return 0; // Let revenge behavior take over
    }
    
    // Check if returning home after revenge
    if (ctx.state.returningHome) {
      return 0; // Let returnHome behavior take over
    }
    
    // Check if indignant (body was hit)
    if (ctx.state.isIndignant) {
      return 0; // Let indignant behavior take over
    }
    
    // Attack takes priority when in range
    const attackRange = (ctx.custom.attackRange as number) ?? 1.5;
    if (ctx.distToPlayer <= attackRange) {
      return 0.2; // Very low, let attack take over
    }
    
    // Chase takes priority when player is close and visible
    const detectionRange = (ctx.custom.detectionRange as number) ?? 32;
    if (ctx.distToPlayer < detectionRange && ctx.hasLineOfSight) {
      return 0.3; // Lower than chase (0.7-0.9)
    }
    
    // Default behavior: actively patrol the tree
    return 0.75;
  },
  
  enter(ctx: BehaviorContext): void {
    // Clear any existing patrol state and pick new destination
    ctx.state.patrolTargetX = undefined;
    ctx.state.patrolTargetY = undefined;
    ctx.state.patrolTargetZ = undefined;
    ctx.state.patrolPauseUntil = undefined;
  },
  
  tick(ctx: BehaviorContext, _deltaMs: number): BehaviorResult {
    const now = performance.now();
    
    // Check if pausing
    const pauseUntil = ctx.state.patrolPauseUntil as number | undefined;
    if (pauseUntil && now < pauseUntil) {
      return { kind: 'idle' };
    }
    
    // Clear pause if expired
    if (pauseUntil) {
      ctx.state.patrolPauseUntil = undefined;
    }
    
    // Check if we have a destination
    const hasDestination = 
      ctx.state.patrolTargetX !== undefined &&
      ctx.state.patrolTargetY !== undefined &&
      ctx.state.patrolTargetZ !== undefined;
    
    // Check if we've reached our destination
    if (hasDestination) {
      const dx = (ctx.state.patrolTargetX as number) - ctx.ex;
      const dy = (ctx.state.patrolTargetY as number) - ctx.ey;
      const dz = (ctx.state.patrolTargetZ as number) - ctx.ez;
      const distToTarget = Math.sqrt(dx * dx + dy * dy + dz * dz);
      
      if (distToTarget < PATROL_DESTINATION_REACHED_THRESHOLD) {
        // Arrived! Roll for pause or immediate new destination
        if (Math.random() < PATROL_PAUSE_CHANCE) {
          // Pause for a bit
          const pauseTime = PATROL_PAUSE_MIN_MS + Math.random() * (PATROL_PAUSE_MAX_MS - PATROL_PAUSE_MIN_MS);
          ctx.state.patrolPauseUntil = now + pauseTime;
          ctx.state.patrolTargetX = undefined;
          ctx.state.patrolTargetY = undefined;
          ctx.state.patrolTargetZ = undefined;
          return { kind: 'idle' };
        }
        
        // Pick new destination immediately
        ctx.state.patrolTargetX = undefined;
        ctx.state.patrolTargetY = undefined;
        ctx.state.patrolTargetZ = undefined;
      }
    }
    
    // Need to pick a new destination?
    if (!hasDestination || ctx.state.patrolTargetX === undefined) {
      // OPTIMIZATION: Pick random position near tree base instead of iterating all blocks
      // This avoids O(n) iteration over thousands of tree blocks every patrol tick
      const treeBaseX = ctx.custom.treeBaseX as number | undefined;
      const treeBaseY = ctx.custom.treeBaseY as number | undefined;
      const treeBaseZ = ctx.custom.treeBaseZ as number | undefined;
      
      if (treeBaseX !== undefined && treeBaseY !== undefined && treeBaseZ !== undefined) {
        // Pick a random position within tree bounds
        const tier = ctx.custom.tier as number ?? 1;
        const treeRadius = 5 + tier * 2; // Larger trees for higher tiers
        const treeHeight = 10 + tier * 5;

        // Random offset from tree base
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.random() * treeRadius;
        const height = Math.random() * treeHeight;

        ctx.state.patrolTargetX = treeBaseX + Math.cos(angle) * radius;
        ctx.state.patrolTargetY = treeBaseY + height;
        ctx.state.patrolTargetZ = treeBaseZ + Math.sin(angle) * radius;

        if (DEBUG_PATROL) {
          console.log(`[Patrol] ${ctx.entityId} new target: (${ctx.state.patrolTargetX.toFixed(1)}, ${ctx.state.patrolTargetY.toFixed(1)}, ${ctx.state.patrolTargetZ.toFixed(1)})`);
        }
      } else {
        if (DEBUG_PATROL) {
          console.log(`[Patrol] ${ctx.entityId} no tree data - treeBaseX=${treeBaseX}, treeBaseY=${treeBaseY}, treeBaseZ=${treeBaseZ}`);
        }
        // No tree data available, just idle
        return { kind: 'idle' };
      }
    }
    
    // Move toward destination
    return {
      kind: 'move',
      tx: ctx.state.patrolTargetX as number,
      ty: ctx.state.patrolTargetY as number,
      tz: ctx.state.patrolTargetZ as number,
      speedMultiplier: 0.7, // Patrol is slower than chase
    };
  },
  
  exit(ctx: BehaviorContext): void {
    // Clear patrol state on exit
    ctx.state.patrolTargetX = undefined;
    ctx.state.patrolTargetY = undefined;
    ctx.state.patrolTargetZ = undefined;
    ctx.state.patrolPauseUntil = undefined;
  },
};
