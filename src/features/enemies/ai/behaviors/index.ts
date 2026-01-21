/**
 * Behavior Module Registry
 * 
 * Central registry of all available behavior modules.
 */

import type { BehaviorModule } from '../types';
import { SleepBehavior } from './sleep';
import { WanderBehavior } from './wander';
import { ChaseBehavior } from './chase';
import { AttackBehavior } from './attack';
import { AngryBehavior } from './angry';
import { PatrolBehavior } from './patrol';
import { RevengeBehavior } from './revenge';
import { ReturnHomeBehavior } from './returnHome';
import { IndignantBehavior } from './indignant';

// All available behaviors
export const behaviors = {
  sleep: SleepBehavior,
  wander: WanderBehavior,
  chase: ChaseBehavior,
  attack: AttackBehavior,
  angry: AngryBehavior,
  patrol: PatrolBehavior,
  revenge: RevengeBehavior,
  returnHome: ReturnHomeBehavior,
  indignant: IndignantBehavior,
} as const;

export type BehaviorId = keyof typeof behaviors;

/**
 * Get behavior modules by their IDs.
 * Returns modules in priority order (order matters for tie-breaking).
 */
export function getBehaviorsByIds(ids: string[]): BehaviorModule[] {
  const result: BehaviorModule[] = [];
  
  for (const id of ids) {
    const behavior = behaviors[id as BehaviorId];
    if (behavior) {
      result.push(behavior);
    }
  }
  
  return result;
}

/**
 * Get all available behavior IDs.
 */
export function getAllBehaviorIds(): BehaviorId[] {
  return Object.keys(behaviors) as BehaviorId[];
}

// Re-export individual behaviors
export { SleepBehavior } from './sleep';
export { WanderBehavior } from './wander';
export { ChaseBehavior } from './chase';
export { AttackBehavior } from './attack';
export { AngryBehavior } from './angry';
export { PatrolBehavior } from './patrol';
export { RevengeBehavior, initializeRevenge, recordRevengeDamageDealt } from './revenge';
export { ReturnHomeBehavior } from './returnHome';
export { IndignantBehavior, markIndignant } from './indignant';
