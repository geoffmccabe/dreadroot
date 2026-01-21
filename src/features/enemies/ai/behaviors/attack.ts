/**
 * Attack Behavior - Execute attack when in range
 * 
 * Highest priority when within attack range with attack ready.
 */

import type { BehaviorContext, BehaviorModule, BehaviorResult } from '../types';

export const AttackBehavior: BehaviorModule = {
  id: 'attack',
  name: 'Attack',
  
  evaluate(ctx: BehaviorContext): number {
    const attackRange = (ctx.custom.attackRange as number) ?? 1.5;
    const attackCooldownMs = (ctx.custom.attackCooldownMs as number) ?? 1000;
    
    // Must be in attack range
    if (ctx.distToPlayer > attackRange) {
      return 0;
    }
    
    // Must have attack ready (cooldown passed)
    if (ctx.msSinceLastAttack < attackCooldownMs) {
      return 0.3; // Stay in attack mode but don't actually attack
    }
    
    // Highest priority when ready to attack
    return 0.95;
  },
  
  enter(ctx: BehaviorContext): void {
    if (ctx.custom.onBehaviorChange) {
      (ctx.custom.onBehaviorChange as (behavior: string) => void)('attack');
    }
  },
  
  tick(ctx: BehaviorContext, _deltaMs: number): BehaviorResult {
    const attackCooldownMs = (ctx.custom.attackCooldownMs as number) ?? 1000;
    
    // Check cooldown
    if (ctx.msSinceLastAttack < attackCooldownMs) {
      return { kind: 'idle' };
    }
    
    // Get attack parameters from context
    const damage = (ctx.custom.damage as number) ?? 10;
    const knockback = (ctx.custom.knockback as number) ?? 5;
    
    // Calculate direction to player
    const dx = ctx.px - ctx.ex;
    const dy = ctx.py - ctx.ey;
    const dz = ctx.pz - ctx.ez;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    
    // Normalize direction (or default to forward if too close)
    const dirX = dist > 0.1 ? dx / dist : 0;
    const dirY = dist > 0.1 ? dy / dist : 0;
    const dirZ = dist > 0.1 ? dz / dist : 1;
    
    return {
      kind: 'attack',
      damage,
      knockback,
      dirX,
      dirY,
      dirZ,
    };
  },
  
  exit(_ctx: BehaviorContext): void {
    // Could trigger attack end animation
  },
};
