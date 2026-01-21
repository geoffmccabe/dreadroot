/**
 * BehaviorBrain - Utility-based behavior selection
 * 
 * Evaluates all available behaviors and selects the highest-scoring one.
 * Handles transitions between behaviors (enter/exit callbacks).
 */

import type { BehaviorContext, BehaviorModule, BehaviorResult } from './types';

export interface BrainTickResult {
  result: BehaviorResult;
  newBehaviorId: string | null;
}

export class BehaviorBrain {
  /**
   * Evaluate behaviors and tick the selected one.
   * 
   * @param ctx Current behavior context
   * @param behaviors Available behavior modules
   * @param currentBehaviorId Currently active behavior (for transitions)
   * @param deltaMs Time since last tick
   * @returns Behavior result and new behavior ID
   */
  tick(
    ctx: BehaviorContext,
    behaviors: BehaviorModule[],
    currentBehaviorId: string | null,
    deltaMs: number
  ): BrainTickResult {
    if (behaviors.length === 0) {
      return { result: { kind: 'idle' }, newBehaviorId: null };
    }
    
    // Evaluate all behaviors and find highest score
    let bestBehavior: BehaviorModule | null = null;
    let bestScore = -1;
    
    for (const behavior of behaviors) {
      const score = behavior.evaluate(ctx);
      if (score > bestScore) {
        bestScore = score;
        bestBehavior = behavior;
      }
    }
    
    if (!bestBehavior) {
      return { result: { kind: 'idle' }, newBehaviorId: null };
    }
    
    // Handle behavior transitions
    if (bestBehavior.id !== currentBehaviorId) {
      // Exit old behavior
      if (currentBehaviorId) {
        const oldBehavior = behaviors.find(b => b.id === currentBehaviorId);
        oldBehavior?.exit?.(ctx);
      }
      
      // Enter new behavior
      bestBehavior.enter?.(ctx);
    }
    
    // Tick the selected behavior
    const result = bestBehavior.tick(ctx, deltaMs);
    
    return {
      result,
      newBehaviorId: bestBehavior.id,
    };
  }
  
  /**
   * Force exit from current behavior (for cleanup on death/despawn).
   */
  forceExit(
    ctx: BehaviorContext,
    behaviors: BehaviorModule[],
    currentBehaviorId: string | null
  ): void {
    if (!currentBehaviorId) return;
    
    const behavior = behaviors.find(b => b.id === currentBehaviorId);
    behavior?.exit?.(ctx);
  }
}
