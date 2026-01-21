/**
 * Indignant Behavior - Reaction when body is hit but not damaged
 * 
 * When a bullet ricochets off a shnake's body (not head), the shnake
 * rears up and performs an S-wiggle animation while roaring loudly.
 * This is a short, high-priority interruption behavior.
 */

import type { BehaviorContext, BehaviorModule, BehaviorResult } from '../types';

// How long the indignant animation lasts
const INDIGNANT_DURATION_MS = 2000;

export const IndignantBehavior: BehaviorModule = {
  id: 'indignant',
  name: 'Indignant',
  
  evaluate(ctx: BehaviorContext): number {
    // Only active when indignant flag is set
    if (!ctx.state.isIndignant) {
      return 0;
    }
    
    // IMPORTANT: Don't interrupt revenge mode with indignant behavior
    // This prevents players from exploiting body shots to pause the attack
    if (ctx.state.revengeTarget) {
      ctx.state.isIndignant = false; // Clear it since we're ignoring it
      return 0;
    }
    
    // Check if we're still within the animation window
    const indignantStartTime = ctx.state.indignantStartTime as number | undefined;
    if (indignantStartTime) {
      const elapsed = performance.now() - indignantStartTime;
      if (elapsed >= INDIGNANT_DURATION_MS) {
        // Animation complete, clear state
        ctx.state.isIndignant = false;
        ctx.state.indignantStartTime = undefined;
        return 0;
      }
    }
    
    // Highest priority - interrupt everything else
    return 0.99;
  },
  
  enter(ctx: BehaviorContext): void {
    // Record start time for animation duration
    ctx.state.indignantStartTime = performance.now();
    
    // Trigger roar sound at 2x volume via custom callback
    const onIndignantRoar = ctx.custom.onIndignantRoar as ((volume: number) => void) | undefined;
    if (onIndignantRoar) {
      onIndignantRoar(2.0); // 2x normal volume
    }
    
    // Trigger wiggle animation
    const onTriggerWiggle = ctx.custom.onTriggerWiggle as ((shnakeId: string) => void) | undefined;
    if (onTriggerWiggle) {
      onTriggerWiggle(ctx.entityId);
    }
    
    if (ctx.custom.onBehaviorChange) {
      (ctx.custom.onBehaviorChange as (behavior: string) => void)('indignant');
    }
  },
  
  tick(ctx: BehaviorContext, _deltaMs: number): BehaviorResult {
    // Check if animation is complete
    const indignantStartTime = ctx.state.indignantStartTime as number | undefined;
    if (indignantStartTime) {
      const elapsed = performance.now() - indignantStartTime;
      if (elapsed >= INDIGNANT_DURATION_MS) {
        // Animation complete
        ctx.state.isIndignant = false;
        ctx.state.indignantStartTime = undefined;
        return { kind: 'idle' };
      }
    }
    
    // Return animate result for the S-wiggle
    // The locomotion layer will handle this specially
    return {
      kind: 'idle', // Stay in place during animation
      // Note: The actual wiggle animation is triggered in ShnakeRenderer
      // via the onTriggerWiggle callback in enter()
    };
  },
  
  exit(ctx: BehaviorContext): void {
    // Clear indignant state
    ctx.state.isIndignant = false;
    ctx.state.indignantStartTime = undefined;
  },
};

/**
 * Helper: Mark a shnake as indignant (body was hit).
 * Call this when a bullet ricochets off the shnake's body.
 */
export function markIndignant(state: Record<string, unknown>): void {
  state.isIndignant = true;
  state.indignantStartTime = undefined; // Will be set in enter()
}
