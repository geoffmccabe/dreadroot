/**
 * Revenge Behavior - Chase and attack player until damage is repaid
 * 
 * When damaged, shnakes pursue the player relentlessly until they deal
 * equal or greater damage back. They climb down from trees, fall to ground,
 * and chase on foot. Once satisfied, they transition to returnHome behavior.
 * 
 * Timeout: Revenge expires after 3 minutes if no damage dealt or received.
 * Damage resets the timer.
 */

import type { BehaviorContext, BehaviorModule, BehaviorResult } from '../types';

/** How long revenge lasts without damage exchange (3 minutes) */
export const REVENGE_TIMEOUT_MS = 3 * 60 * 1000;

/** How long headshot stun lasts (2 seconds) */
export const STUN_DURATION_MS = 2000;

export interface RevengeTarget {
  damageReceived: number;      // Total damage received from ALL attackers
  damageDealt: number;         // Total damage dealt to ANY player
  startedAt: number;
  lastDamageAt: number;        // Tracks when damage was last given/received
  currentTargetId: string | null; // ID of the player currently being chased
}

export const RevengeBehavior: BehaviorModule = {
  id: 'revenge',
  name: 'Revenge',
  
  evaluate(ctx: BehaviorContext): number {
    const revengeTarget = ctx.state.revengeTarget as RevengeTarget | null;
    
    if (!revengeTarget) {
      return 0; // No revenge needed
    }
    
    const now = performance.now();
    
    // Check timeout - give up after 3 minutes without damage exchange
    if (now - revengeTarget.lastDamageAt > REVENGE_TIMEOUT_MS) {
      // Timeout expired - clear revenge and return home
      ctx.state.revengeTarget = null;
      ctx.state.returningHome = true;
      return 0;
    }
    
    // ALWAYS pursue until timeout - shnakes are relentless!
    // (Previously stopped when damageDealt >= damageReceived, causing stuck behavior)
    return 0.95; // Very high priority - revenge is important!
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
    const revengeTarget = ctx.state.revengeTarget as RevengeTarget | null;
    
    // Check timeout first (this is the ONLY exit condition now)
    const now = performance.now();
    if (!revengeTarget || now - revengeTarget.lastDamageAt > REVENGE_TIMEOUT_MS) {
      ctx.state.revengeTarget = null;
      ctx.state.returningHome = true;
      return { kind: 'idle' };
    }
    
    // STUN CHECK: If stunned by headshot, stay idle until stun expires
    const stunnedUntil = ctx.state.stunnedUntil as number | undefined;
    if (stunnedUntil && now < stunnedUntil) {
      // Still stunned - can't move or attack
      return { kind: 'idle' };
    } else if (stunnedUntil) {
      // Stun just expired - clear it
      ctx.state.stunnedUntil = undefined;
    }
    
    // IMPORTANT: Shnakes now ALWAYS chase until timeout expires
    // They no longer stop when damageDealt >= damageReceived
    // This keeps them aggressive and prevents getting "stuck" after hitting player
    
    // Get attack parameters
    const attackRange = (ctx.custom.attackRange as number) ?? 1.5;
    const attackCooldownMs = (ctx.custom.attackCooldownMs as number) ?? 600;
    
    // If in attack range and cooldown passed, attack
    if (ctx.distToPlayer <= attackRange && ctx.msSinceLastAttack >= attackCooldownMs) {
      const damage = (ctx.custom.damage as number) ?? 10;
      const knockback = (ctx.custom.knockback as number) ?? 5;
      
      // Calculate direction to player (primarily HORIZONTAL for knockback)
      const dx = ctx.px - ctx.ex;
      const dz = ctx.pz - ctx.ez;
      const horizDist = Math.sqrt(dx * dx + dz * dz);
      
      // PURELY HORIZONTAL knockback - NO vertical component
      // This prevents knocking player straight up into the sky
      const dirX = horizDist > 0.1 ? dx / horizDist : 0;
      const dirY = 0; // ZERO vertical - prevents floating/flying bugs
      const dirZ = horizDist > 0.1 ? dz / horizDist : 1;
      
      return {
        kind: 'attack',
        damage,
        knockback,
        dirX,
        dirY,
        dirZ,
      };
    }
    
    // MOVEMENT STRATEGY:
    // 1. If shnake is above ground (ey > 0), climb DOWN first
    // 2. Once at ground level, chase player horizontally
    // 3. If player is elevated, climb UP toward them
    
    const angrySpeedMultiplier = (ctx.custom.angrySpeedMultiplier as number) ?? 2.0;
    
    // Trigger continuous angry undulations during chase
    if (ctx.custom.onTriggerWiggle) {
      (ctx.custom.onTriggerWiggle as () => void)();
    }
    
    // Calculate target position based on current height
    let targetY = ctx.py;
    
    // If we're high up (above ground), prioritize getting to ground level first
    // Then pursue player. This prevents flying through the sky.
    if (ctx.ey > 1 && ctx.py <= 1) {
      // Player is on ground but we're up high - descend first
      targetY = 0;
    }
    
    return {
      kind: 'move',
      tx: ctx.px,
      ty: targetY,
      tz: ctx.pz,
      speedMultiplier: angrySpeedMultiplier,
    };
  },
  
  exit(_ctx: BehaviorContext): void {
    // Keep revenge state - it gets cleared when returning home completes
    // or when shnake dies
  },
};

/**
 * Helper: Initialize or update revenge tracking for a shnake.
 * Call this when the shnake takes damage.
 * 
 * @param state - The behavior state object
 * @param damageReceived - Amount of damage taken
 * @param attackerId - ID of the player who dealt the damage (becomes new chase target)
 */
export function initializeRevenge(state: Record<string, unknown>, damageReceived: number, attackerId?: string): void {
  const now = performance.now();
  const existing = state.revengeTarget as RevengeTarget | null;
  
  if (existing) {
    // Add to existing revenge, update target to newest attacker, and reset timer
    state.revengeTarget = {
      damageReceived: existing.damageReceived + damageReceived,
      damageDealt: existing.damageDealt,
      startedAt: existing.startedAt,
      lastDamageAt: now,
      currentTargetId: attackerId ?? existing.currentTargetId, // Switch to new attacker
    } as RevengeTarget;
  } else {
    // Start new revenge
    state.revengeTarget = {
      damageReceived,
      damageDealt: 0,
      startedAt: now,
      lastDamageAt: now,
      currentTargetId: attackerId ?? null,
    } as RevengeTarget;
  }
}

/**
 * Helper: Record damage dealt by shnake during revenge.
 * Call this when the shnake successfully hits any player.
 */
export function recordRevengeDamageDealt(state: Record<string, unknown>, damageDealt: number): void {
  const now = performance.now();
  const existing = state.revengeTarget as RevengeTarget | null;
  
  if (existing) {
    state.revengeTarget = {
      damageReceived: existing.damageReceived,
      damageDealt: existing.damageDealt + damageDealt,
      startedAt: existing.startedAt,
      lastDamageAt: now, // Reset timeout on successful hit
      currentTargetId: existing.currentTargetId,
    } as RevengeTarget;
  }
}

/**
 * Helper: Stun a shnake for 2 seconds after headshot during revenge.
 * Call this when the shnake's head takes damage while in revenge mode.
 */
export function applyShnakeStun(state: Record<string, unknown>): void {
  const now = performance.now();
  state.stunnedUntil = now + STUN_DURATION_MS;
}
