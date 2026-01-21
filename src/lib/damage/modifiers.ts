// Damage Modifier System
// Modifiers that alter incoming damage through the pipeline

import { DamageEvent, DamageType } from './types';

// Context about the player receiving damage
export interface ModifierContext {
  playerLevel: number;
  playerArmor: number;                                    // Total armor value
  resistances: Partial<Record<DamageType, number>>;       // % reduction per damage type (0-1)
  activeBuffs: string[];                                  // Active buff IDs
  steady: number;                                         // STEADY value for knockback reduction
}

// A modifier that can alter incoming damage
export interface DamageModifier {
  id: string;
  priority: number;              // Lower = runs first (0-100)
  source: 'armor' | 'buff' | 'level' | 'item' | 'spell' | 'resistance' | 'steady';
  apply: (event: DamageEvent, context: ModifierContext) => DamageEvent;
}

// Calculate STEADY value from level (floor of level/2)
export function calculateSteadyFromLevel(level: number): number {
  return Math.floor(level / 2);
}

// Get flat knockback reduction from STEADY (each point = 1 block reduction)
export function calculateKnockbackReduction(steady: number): number {
  return steady; // Flat subtraction, not percentage
}

// Default modifiers that always run in the pipeline
export const DEFAULT_MODIFIERS: DamageModifier[] = [
  // Armor reduction (priority 10 - runs early)
  // Formula: damage * (100 / (100 + armor)) - diminishing returns
  {
    id: 'armor-reduction',
    priority: 10,
    source: 'armor',
    apply: (event, ctx) => {
      // TRUE damage bypasses armor
      if (event.damageType === DamageType.TRUE) return event;
      if (ctx.playerArmor <= 0) return event;
      
      const reduction = 100 / (100 + ctx.playerArmor);
      return { 
        ...event, 
        finalDamage: event.finalDamage * reduction 
      };
    },
  },
  
  // Damage type resistance (priority 20)
  // Each damage type can have its own resistance %
  {
    id: 'type-resistance',
    priority: 20,
    source: 'resistance',
    apply: (event, ctx) => {
      // TRUE damage bypasses resistance
      if (event.damageType === DamageType.TRUE) return event;
      
      const resistance = ctx.resistances[event.damageType] ?? 0;
      // Cap at 90% reduction to prevent immunity
      const multiplier = 1 - Math.min(resistance, 0.9);
      return { 
        ...event, 
        finalDamage: event.finalDamage * multiplier 
      };
    },
  },
  
  // STEADY knockback reduction (priority 30)
  // Each point of STEADY = 1 block reduction (flat subtraction)
  {
    id: 'steady-knockback',
    priority: 30,
    source: 'steady',
    apply: (event, ctx) => {
      if (!event.knockback) return event;
      
      // Calculate total STEADY value (base from level + any modifiers)
      const baseSteady = calculateSteadyFromLevel(ctx.playerLevel);
      const totalSteady = baseSteady + ctx.steady;
      
      // Flat reduction: each STEADY point reduces knockback by 1 block
      const reducedForce = event.knockback.baseForce - totalSteady;
      
      return { 
        ...event, 
        knockback: { 
          ...event.knockback, 
          finalForce: Math.max(0, reducedForce) 
        }
      };
    },
  },
];

// Create default modifier context
export function createDefaultModifierContext(playerLevel: number = 1): ModifierContext {
  return {
    playerLevel,
    playerArmor: 0,
    resistances: {},
    activeBuffs: [],
    steady: 0,  // Additional STEADY beyond level-based value
  };
}
