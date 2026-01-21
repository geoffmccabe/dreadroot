/**
 * Wander Behavior - Random movement within bounds
 * 
 * Used when player is not nearby and enemy isn't threatened.
 */

import type { BehaviorContext, BehaviorModule, BehaviorResult } from '../types';
import { LOD_CONFIG } from '../types';

// Wander state stored in ctx.custom
interface WanderState {
  targetX?: number;
  targetY?: number;
  targetZ?: number;
  pauseUntil?: number;
}

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
    // Initialize wander state
    const state = ctx.custom as WanderState;
    state.targetX = undefined;
    state.targetY = undefined;
    state.targetZ = undefined;
    state.pauseUntil = undefined;
  },
  
  tick(ctx: BehaviorContext, _deltaMs: number): BehaviorResult {
    const state = ctx.custom as WanderState;
    const now = performance.now();
    
    // Check if pausing
    if (state.pauseUntil && now < state.pauseUntil) {
      return { kind: 'idle' };
    }
    
    // Check if we need a new target
    const needsNewTarget = 
      state.targetX === undefined ||
      state.targetY === undefined ||
      state.targetZ === undefined ||
      isNearTarget(ctx, state);
    
    if (needsNewTarget) {
      // Pick random destination within wander radius
      const wanderRadius = (ctx.custom.wanderRadius as number) ?? 8;
      const angle = Math.random() * Math.PI * 2;
      const dist = 2 + Math.random() * (wanderRadius - 2);
      
      state.targetX = ctx.ex + Math.cos(angle) * dist;
      state.targetZ = ctx.ez + Math.sin(angle) * dist;
      state.targetY = ctx.ey; // Stay at same height (adapters may override)
      
      // Random pause between movements
      if (Math.random() < 0.3) {
        state.pauseUntil = now + 1000 + Math.random() * 2000;
        return { kind: 'idle' };
      }
    }
    
    return {
      kind: 'move',
      tx: state.targetX!,
      ty: state.targetY!,
      tz: state.targetZ!,
      speedMultiplier: 0.5, // Wander slowly
    };
  },
  
  exit(ctx: BehaviorContext): void {
    // Clear wander state
    const state = ctx.custom as WanderState;
    state.targetX = undefined;
    state.targetY = undefined;
    state.targetZ = undefined;
    state.pauseUntil = undefined;
  },
};

function isNearTarget(ctx: BehaviorContext, state: WanderState): boolean {
  if (state.targetX === undefined) return true;
  
  const dx = ctx.ex - state.targetX;
  const dz = ctx.ez - state.targetZ!;
  return dx * dx + dz * dz < 1; // Within 1 block
}
