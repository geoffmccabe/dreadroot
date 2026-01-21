// Universal Damage System - Core Types
// Defines the damage event structure that flows through the pipeline

import * as THREE from 'three';

// Damage Types - extensible for future damage sources
export const DamageType = {
  PHYSICAL: 'physical',    // Melee attacks, collisions, enemy hits
  FIRE: 'fire',            // Burning, fire projectiles
  POISON: 'poison',        // Toxic/poison damage
  MAGIC: 'magic',          // Future: spells, magical attacks
  TRUE: 'true',            // Bypasses all armor/resistance
} as const;
export type DamageType = typeof DamageType[keyof typeof DamageType];

// Source of damage for logging/death messages
export interface DamageSource {
  type: 'enemy' | 'environment' | 'player' | 'dot';
  entityId?: string;       // Which enemy/player caused it
  entityName?: string;     // For death messages ("Killed by Shnake")
}

// Knockback data that can be modified by STEADY and other effects
export interface KnockbackData {
  direction: THREE.Vector3;
  baseForce: number;       // Original force before modifiers
  finalForce: number;      // After STEADY and resistance calculations
}

// Status effect to apply on hit
export interface StatusEffectApplication {
  effectType: string;      // StatusEffectType value
  duration: number;        // Duration in ms
  intensity?: number;      // For stacking/damage calculation
  sourceId?: string;       // What applied this effect
}

// The core damage event that flows through the pipeline
export interface DamageEvent {
  id: string;                                    // Unique ID for deduplication
  baseDamage: number;                            // Raw damage before modifiers
  finalDamage: number;                           // Calculated after pipeline (starts = baseDamage)
  damageType: DamageType;
  source: DamageSource;
  knockback?: KnockbackData;
  statusEffects?: StatusEffectApplication[];    // Effects to apply on hit
  timestamp: number;
  blocked: boolean;                              // Set true to cancel damage entirely
}

// Result returned after damage is applied
export interface DamageResult {
  blocked: boolean;
  reason?: 'invulnerable' | 'duplicate' | 'modifier' | 'dead';
  died?: boolean;
  finalDamage?: number;
}

// Helper to create a damage event with defaults
export function createDamageEvent(params: {
  baseDamage: number;
  damageType: DamageType;
  source: DamageSource;
  knockback?: { direction: THREE.Vector3; force: number };
  statusEffects?: StatusEffectApplication[];
  id?: string;
}): DamageEvent {
  return {
    id: params.id ?? `dmg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    baseDamage: params.baseDamage,
    finalDamage: params.baseDamage,
    damageType: params.damageType,
    source: params.source,
    knockback: params.knockback ? {
      direction: params.knockback.direction.clone(),
      baseForce: params.knockback.force,
      finalForce: params.knockback.force,
    } : undefined,
    statusEffects: params.statusEffects,
    timestamp: Date.now(),
    blocked: false,
  };
}
