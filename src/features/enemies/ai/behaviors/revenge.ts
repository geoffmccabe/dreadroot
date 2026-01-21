/**
 * Revenge Behavior - Chase and attack player until damage is repaid
 * 
 * When damaged, shnakes pursue the player relentlessly until they deal
 * equal or greater damage back. They ignore tree constraints and move
 * at 1.5x speed. Once satisfied, they transition to returnHome behavior.
 */

import type { BehaviorContext, BehaviorModule, BehaviorResult } from '../types';

export const RevengeBehavior: BehaviorModule = {
  id: 'revenge',
  name: 'Revenge',
  
  evaluate(ctx: BehaviorContext): number {
    // Check if we have an active revenge target
    const revengeTarget = ctx.state.revengeTarget as { damageReceived: number; damageDealt: number } | null;
    
    if (!revengeTarget) {
      return 0; // No revenge needed
    }
    
    // Still seeking revenge (haven't dealt enough damage back)
    if (revengeTarget.damageDealt < revengeTarget.damageReceived) {
      return 0.95; // Very high priority - revenge is important!
    }
    
    // Revenge is satisfied, let returnHome take over
    return 0;
  },
  
  enter(ctx: BehaviorContext): void {
    // Store home tree position for later return
    if (!ctx.state.homeTreeId) {
      ctx.state.homeTreeId = ctx.custom.treeId as string;
      ctx.state.homeTreeBaseX = ctx.custom.treeBaseX as number;
      ctx.state.homeTreeBaseY = ctx.custom.treeBaseY as number;
      ctx.state.homeTreeBaseZ = ctx.custom.treeBaseZ as number;
    }
    
    // Notify behavior change
    if (ctx.custom.onBehaviorChange) {
      (ctx.custom.onBehaviorChange as (behavior: string) => void)('revenge');
    }
  },
  
  tick(ctx: BehaviorContext, _deltaMs: number): BehaviorResult {
    const revengeTarget = ctx.state.revengeTarget as { damageReceived: number; damageDealt: number } | null;
    
    if (!revengeTarget || revengeTarget.damageDealt >= revengeTarget.damageReceived) {
      // Revenge satisfied! Mark for return home
      ctx.state.returningHome = true;
      return { kind: 'idle' };
    }
    
    // Get attack parameters
    const attackRange = (ctx.custom.attackRange as number) ?? 1.5;
    const attackCooldownMs = (ctx.custom.attackCooldownMs as number) ?? 600;
    
    // If in attack range and cooldown passed, attack
    if (ctx.distToPlayer <= attackRange && ctx.msSinceLastAttack >= attackCooldownMs) {
      const damage = (ctx.custom.damage as number) ?? 10;
      const knockback = (ctx.custom.knockback as number) ?? 5;
      
      // Calculate direction to player
      const dx = ctx.px - ctx.ex;
      const dy = ctx.py - ctx.ey;
      const dz = ctx.pz - ctx.ez;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      
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
    }
    
    // Chase the player at 1.5x speed
    const angrySpeedMultiplier = (ctx.custom.angrySpeedMultiplier as number) ?? 1.5;
    
    return {
      kind: 'move',
      tx: ctx.px,
      ty: ctx.py,
      tz: ctx.pz,
      speedMultiplier: angrySpeedMultiplier,
    };
  },
  
  exit(ctx: BehaviorContext): void {
    // Keep revenge state - it gets cleared when returning home completes
    // or when shnake dies
  },
};

/**
 * Helper: Initialize revenge tracking for a shnake.
 * Call this when the shnake takes damage.
 */
export function initializeRevenge(state: Record<string, unknown>, damageReceived: number): void {
  const existing = state.revengeTarget as { damageReceived: number; damageDealt: number } | null;
  
  if (existing) {
    // Add to existing revenge
    state.revengeTarget = {
      damageReceived: existing.damageReceived + damageReceived,
      damageDealt: existing.damageDealt,
    };
  } else {
    // Start new revenge
    state.revengeTarget = {
      damageReceived,
      damageDealt: 0,
    };
  }
}

/**
 * Helper: Record damage dealt by shnake during revenge.
 * Call this when the shnake successfully hits the player.
 */
export function recordRevengeDamageDealt(state: Record<string, unknown>, damageDealt: number): void {
  const existing = state.revengeTarget as { damageReceived: number; damageDealt: number } | null;
  
  if (existing) {
    state.revengeTarget = {
      damageReceived: existing.damageReceived,
      damageDealt: existing.damageDealt + damageDealt,
    };
  }
}
