/**
 * Wander Behavior - Random movement within bounds
 * 
 * Used when player is not nearby and enemy isn't threatened.
 * State is stored in ctx.state (persistent across ticks).
 */

import type { BehaviorContext, BehaviorModule, BehaviorResult } from '../types';
import { LOD_CONFIG } from '../types';

export const WanderBehavior: BehaviorModule = {
  id: 'wander',
  name: 'Wander',
  
  evaluate(ctx: BehaviorContext): number {
    // Don't wander if player is close
    if (ctx.distToPlayer < LOD_CONFIG.FULL_DISTANCE * 0.5) {
      return 0.1;
    }
    
    // Medium-high priority when player is at medium distance
    if (ctx.distToPlayer < LOD_CONFIG.FULL_DISTANCE) {
      return 0.4;
    }
    
    // Good priority when moderately far
    return 0.5;
  },
  
  enter(ctx: BehaviorContext): void {
    // Clear wander state on entry
    ctx.state.wanderTargetX = undefined;
    ctx.state.wanderTargetY = undefined;
    ctx.state.wanderTargetZ = undefined;
    ctx.state.wanderPauseUntil = undefined;
  },
  
  tick(ctx: BehaviorContext, _deltaMs: number): BehaviorResult {
    const now = performance.now();
    
    // Check if pausing
    if (ctx.state.wanderPauseUntil && now < ctx.state.wanderPauseUntil) {
      return { kind: 'idle' };
    }
    
    // Check if we need a new target
    const needsNewTarget = 
      ctx.state.wanderTargetX === undefined ||
      ctx.state.wanderTargetY === undefined ||
      ctx.state.wanderTargetZ === undefined ||
      isNearTarget(ctx);
    
    if (needsNewTarget) {
      // Pick random destination within wander radius
      const wanderRadius = (ctx.custom.wanderRadius as number) ?? 8;
      const angle = Math.random() * Math.PI * 2;
      const dist = 2 + Math.random() * (wanderRadius - 2);
      
      ctx.state.wanderTargetX = ctx.ex + Math.cos(angle) * dist;
      ctx.state.wanderTargetZ = ctx.ez + Math.sin(angle) * dist;
      ctx.state.wanderTargetY = ctx.ey; // Stay at same height (adapters may override)
      
      // Random pause between movements
      if (Math.random() < 0.3) {
        ctx.state.wanderPauseUntil = now + 1000 + Math.random() * 2000;
        return { kind: 'idle' };
      }
    }
    
    return {
      kind: 'move',
      tx: ctx.state.wanderTargetX!,
      ty: ctx.state.wanderTargetY!,
      tz: ctx.state.wanderTargetZ!,
      speedMultiplier: 0.5, // Wander slowly
    };
  },
  
  exit(ctx: BehaviorContext): void {
    // Clear wander state
    ctx.state.wanderTargetX = undefined;
    ctx.state.wanderTargetY = undefined;
    ctx.state.wanderTargetZ = undefined;
    ctx.state.wanderPauseUntil = undefined;
  },
};

function isNearTarget(ctx: BehaviorContext): boolean {
  if (ctx.state.wanderTargetX === undefined) return true;
  
  const dx = ctx.ex - ctx.state.wanderTargetX;
  const dz = ctx.ez - (ctx.state.wanderTargetZ ?? ctx.ez);
  return dx * dx + dz * dz < 1; // Within 1 block
}
