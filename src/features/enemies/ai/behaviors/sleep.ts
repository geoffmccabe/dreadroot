/**
 * Sleep Behavior - Minimal processing when player is far away
 * 
 * High score when distant, returns idle to skip locomotion.
 */

import type { BehaviorContext, BehaviorModule, BehaviorResult } from '../types';
import { LOD_CONFIG } from '../types';

export const SleepBehavior: BehaviorModule = {
  id: 'sleep',
  name: 'Sleep',
  
  evaluate(ctx: BehaviorContext): number {
    // High priority when player is far away
    if (ctx.distToPlayer > LOD_CONFIG.THROTTLED_DISTANCE) {
      return 0.95;
    }
    
    // Medium priority when moderately far and not recently attacked
    if (ctx.distToPlayer > LOD_CONFIG.FULL_DISTANCE && ctx.msSinceLastDamaged > 60000) {
      return 0.6;
    }
    
    // Low priority otherwise
    return 0.1;
  },
  
  enter(ctx: BehaviorContext): void {
    // Could trigger sleep animation or sound
    if (ctx.custom.onBehaviorChange) {
      (ctx.custom.onBehaviorChange as (behavior: string) => void)('sleep');
    }
  },
  
  tick(_ctx: BehaviorContext, _deltaMs: number): BehaviorResult {
    // Do nothing - that's the point of sleeping
    return { kind: 'idle' };
  },
  
  exit(_ctx: BehaviorContext): void {
    // Wake up - could trigger alert animation
  },
};
