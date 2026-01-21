/**
 * Chase Behavior - Pursue player when detected
 * 
 * High priority when player is within detection range and has LOS.
 */

import type { BehaviorContext, BehaviorModule, BehaviorResult } from '../types';

export const ChaseBehavior: BehaviorModule = {
  id: 'chase',
  name: 'Chase',
  
  evaluate(ctx: BehaviorContext): number {
    const detectionRange = (ctx.custom.detectionRange as number) ?? 32;
    const attackRange = (ctx.custom.attackRange as number) ?? 1.5;
    
    // Don't chase if already in attack range
    if (ctx.distToPlayer < attackRange) {
      return 0.1;
    }
    
    // Don't chase if too far
    if (ctx.distToPlayer > detectionRange) {
      return 0.1;
    }
    
    // High priority if can see player
    if (ctx.hasLineOfSight) {
      // Higher score when closer
      const closeness = 1 - (ctx.distToPlayer / detectionRange);
      return 0.7 + closeness * 0.2; // 0.7 to 0.9
    }
    
    // Medium priority if recently saw player (based on last attack time as proxy)
    if (ctx.msSinceLastAttack < 5000) {
      return 0.5;
    }
    
    return 0.2;
  },
  
  enter(ctx: BehaviorContext): void {
    if (ctx.custom.onBehaviorChange) {
      (ctx.custom.onBehaviorChange as (behavior: string) => void)('chase');
    }
  },
  
  tick(ctx: BehaviorContext, _deltaMs: number): BehaviorResult {
    // Move directly toward player
    return {
      kind: 'move',
      tx: ctx.px,
      ty: ctx.py,
      tz: ctx.pz,
      speedMultiplier: 1.0,
    };
  },
  
  exit(_ctx: BehaviorContext): void {
    // Could trigger "lost target" animation
  },
};
