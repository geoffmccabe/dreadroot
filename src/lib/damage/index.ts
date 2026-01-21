// Universal Damage System - Barrel Exports

// Core types
export { 
  DamageType, 
  type DamageEvent, 
  type DamageResult,
  type DamageSource,
  type KnockbackData,
  type StatusEffectApplication,
  createDamageEvent,
} from './types';

// Status effects
export {
  StatusEffectType,
  type ActiveStatusEffect,
  STATUS_EFFECT_DEFAULTS,
  createActiveEffect,
  isEffectActive,
  shouldEffectTick,
} from './statusEffects';

// Modifiers
export {
  type DamageModifier,
  type ModifierContext,
  DEFAULT_MODIFIERS,
  calculateSteadyFromLevel,
  calculateKnockbackReduction,
  createDefaultModifierContext,
} from './modifiers';

// Pipeline
export {
  processDamageEvent,
  processSimpleDamage,
} from './pipeline';
