/**
 * Angry Behavior - Aggressive pursuit after being damaged
 * 
 * Time-limited state with increased speed and aggression.
 */

import type { BehaviorContext, BehaviorModule, BehaviorResult } from '../types';

export const AngryBehavior: BehaviorModule = {
  id: 'angry',
  name: 'Angry',
  
  evaluate(ctx: BehaviorContext): number {
    const angryDurationMs = (ctx.custom.angryDurationMs as number) ?? 30000;
    const attackRange = (ctx.custom.attackRange as number) ?? 1.5;
    
    // Highest priority when recently damaged
    if (ctx.msSinceLastDamaged < angryDurationMs) {
      // Even higher if player is close
      if (ctx.distToPlayer < attackRange * 3) {
        return 0.92;
      }
      return 0.85;
    }
    
    // Also trigger if player is very close (personal space violation)
    if (ctx.distToPlayer < 3 && ctx.hasLineOfSight) {
      return 0.8;
    }
    
    return 0;
  },
  
  enter(ctx: BehaviorContext): void {
    if (ctx.custom.onBehaviorChange) {
      (ctx.custom.onBehaviorChange as (behavior: string) => void)('angry');
    }
    
    // Mark angry state for adapters that need it
    ctx.custom.isAngry = true;
  },
  
  tick(ctx: BehaviorContext, _deltaMs: number): BehaviorResult {
    const attackRange = (ctx.custom.attackRange as number) ?? 1.5;
    const angrySpeedMultiplier = (ctx.custom.angrySpeedMultiplier as number) ?? 1.5;
    
    // If in attack range, let attack behavior handle it
    if (ctx.distToPlayer < attackRange) {
      return { kind: 'idle' };
    }
    
    // Chase player at increased speed
    return {
      kind: 'move',
      tx: ctx.px,
      ty: ctx.py,
      tz: ctx.pz,
      speedMultiplier: angrySpeedMultiplier,
    };
  },
  
  exit(ctx: BehaviorContext): void {
    ctx.custom.isAngry = false;
  },
};
