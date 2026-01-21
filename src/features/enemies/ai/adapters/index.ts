/**
 * Enemy Adapters
 * 
 * Bridges between the universal AI system and specific enemy types.
 */

export { 
  ShnakeAdapter, 
  setShnakeLocomotionContext, 
  markShnakeAttacked, 
  markShnakeIndignant,
  initializeShnakeRevenge,
  recordShnakeRevengeDamage,
  cleanupShnakeResources 
} from './ShnakeAdapter';
export type { ShnakeWithAI } from './ShnakeAdapter';

export { ShwarmAdapter, setShwarmLocomotionContext, cleanupShwarmResources, shwarmBlockTargets } from './ShwarmAdapter';
export type { ShwarmWithAI } from './ShwarmAdapter';

export { ShombieAdapter, setShombieLocomotionContext } from './ShombieAdapter';
export type { ShombieWithAI } from './ShombieAdapter';
