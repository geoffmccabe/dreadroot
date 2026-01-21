// Damage Pipeline Processor
// Processes damage events through all modifiers

import { DamageEvent } from './types';
import { DamageModifier, ModifierContext, DEFAULT_MODIFIERS } from './modifiers';

/**
 * Process a damage event through the modifier pipeline
 * @param event - The incoming damage event
 * @param context - Player's current state (armor, resistances, level, etc.)
 * @param customModifiers - Additional modifiers from items, buffs, spells
 * @returns The processed damage event with final values
 */
export function processDamageEvent(
  event: DamageEvent,
  context: ModifierContext,
  customModifiers: DamageModifier[] = []
): DamageEvent {
  // Combine default + custom modifiers, sort by priority (lower = first)
  const allModifiers = [...DEFAULT_MODIFIERS, ...customModifiers]
    .sort((a, b) => a.priority - b.priority);
  
  // Start with base damage as final damage
  let processedEvent: DamageEvent = { 
    ...event, 
    finalDamage: event.baseDamage,
    knockback: event.knockback ? {
      ...event.knockback,
      finalForce: event.knockback.baseForce,
    } : undefined,
  };
  
  // Run through pipeline
  for (const modifier of allModifiers) {
    // Stop processing if event was blocked
    if (processedEvent.blocked) break;
    
    try {
      processedEvent = modifier.apply(processedEvent, context);
    } catch (error) {
      console.error(`[DamagePipeline] Modifier ${modifier.id} failed:`, error);
      // Continue with unmodified event on error
    }
  }
  
  // Floor final damage (no fractional HP), minimum 0
  processedEvent.finalDamage = Math.max(0, Math.floor(processedEvent.finalDamage));
  
  // Floor final knockback force
  if (processedEvent.knockback) {
    processedEvent.knockback.finalForce = Math.max(0, processedEvent.knockback.finalForce);
  }
  
  return processedEvent;
}

/**
 * Quick helper to process damage with just level (for simple cases)
 */
export function processSimpleDamage(
  baseDamage: number,
  playerLevel: number
): number {
  const event: DamageEvent = {
    id: 'simple',
    baseDamage,
    finalDamage: baseDamage,
    damageType: 'physical',
    source: { type: 'environment' },
    timestamp: Date.now(),
    blocked: false,
  };
  
  const context: ModifierContext = {
    playerLevel,
    playerArmor: 0,
    resistances: {},
    activeBuffs: [],
    steady: 0,
  };
  
  const result = processDamageEvent(event, context);
  return result.finalDamage;
}
