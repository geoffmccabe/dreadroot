/**
 * ReturnHome Behavior - Navigate back to tree after revenge
 * 
 * After a shnake completes its revenge (dealt equal or more damage back),
 * it returns to its home tree. Once back on the tree, it clears revenge
 * state and resumes patrol.
 */

import type { BehaviorContext, BehaviorModule, BehaviorResult } from '../types';

// How close to tree base counts as "home"
const HOME_THRESHOLD = 5.0;

export const ReturnHomeBehavior: BehaviorModule = {
  id: 'returnHome',
  name: 'Return Home',
  
  evaluate(ctx: BehaviorContext): number {
    // Only active when returning home after revenge
    if (!ctx.state.returningHome) {
      return 0;
    }
    
    // Need home coordinates to return
    if (ctx.state.homeTreeBaseX === undefined) {
      return 0;
    }
    
    return 0.9; // High priority when returning home
  },
  
  enter(ctx: BehaviorContext): void {
    if (ctx.custom.onBehaviorChange) {
      (ctx.custom.onBehaviorChange as (behavior: string) => void)('returnHome');
    }
  },
  
  tick(ctx: BehaviorContext, _deltaMs: number): BehaviorResult {
    const homeX = ctx.state.homeTreeBaseX as number;
    const homeY = ctx.state.homeTreeBaseY as number;
    const homeZ = ctx.state.homeTreeBaseZ as number;
    
    // Calculate distance to home tree base
    const dx = homeX - ctx.ex;
    const dy = homeY - ctx.ey;
    const dz = homeZ - ctx.ez;
    const distToHome = Math.sqrt(dx * dx + dy * dy + dz * dz);
    
    // Check if we're home (close to tree and touching tree blocks)
    const isTouchingTree = ctx.custom.isTouchingTree as boolean | undefined;
    
    if (distToHome < HOME_THRESHOLD && isTouchingTree) {
      // We're home! Clear revenge state and return to patrol
      ctx.state.revengeTarget = null;
      ctx.state.returningHome = false;
      ctx.state.homeTreeId = undefined;
      ctx.state.homeTreeBaseX = undefined;
      ctx.state.homeTreeBaseY = undefined;
      ctx.state.homeTreeBaseZ = undefined;
      
      return { kind: 'idle' }; // Will switch to patrol on next tick
    }
    
    // Move toward home tree at normal speed
    return {
      kind: 'move',
      tx: homeX,
      ty: homeY + 2, // Aim slightly above base to climb the tree
      tz: homeZ,
      speedMultiplier: 1.0,
    };
  },
  
  exit(ctx: BehaviorContext): void {
    // Clear returning home flag if we exit for any reason
    ctx.state.returningHome = false;
  },
};
