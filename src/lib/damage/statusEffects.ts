// Status Effect System
// Manages DoT effects, debuffs, and buffs applied to players

export const StatusEffectType = {
  BURNING: 'burning',           // Fire DoT + visual effect
  POISONED: 'poisoned',         // Poison DoT
  SLOWED: 'slowed',             // Reduced movement speed
  INVULNERABLE: 'invulnerable', // I-frames after damage
  STUNNED: 'stunned',           // Cannot move (future)
  BLEEDING: 'bleeding',         // Physical DoT (future)
} as const;
export type StatusEffectType = typeof StatusEffectType[keyof typeof StatusEffectType];

// An active status effect on a player
export interface ActiveStatusEffect {
  id: string;
  type: StatusEffectType;
  startTime: number;
  duration: number;           // Total duration in ms
  intensity: number;          // Damage per tick, slow %, etc.
  tickInterval?: number;      // For DoT effects (ms between ticks)
  lastTickTime?: number;      // When last tick was applied
  sourceId?: string;          // What applied this effect
}

// Default configurations for each effect type
export const STATUS_EFFECT_DEFAULTS: Record<StatusEffectType, Partial<ActiveStatusEffect>> = {
  [StatusEffectType.BURNING]: { 
    tickInterval: 500,    // Tick every 0.5s
    intensity: 5,         // 5 damage per tick
    duration: 3000,       // 3 seconds default
  },
  [StatusEffectType.POISONED]: { 
    tickInterval: 1000,   // Tick every 1s
    intensity: 3,         // 3 damage per tick
    duration: 5000,       // 5 seconds default
  },
  [StatusEffectType.SLOWED]: { 
    intensity: 0.5,       // 50% speed reduction
    duration: 2000,       // 2 seconds default
  },
  [StatusEffectType.INVULNERABLE]: { 
    duration: 200,        // 200ms i-frames
    intensity: 1,         // Full invulnerability
  },
  [StatusEffectType.STUNNED]: {
    duration: 1000,       // 1 second default
    intensity: 1,         // Full stun
  },
  [StatusEffectType.BLEEDING]: {
    tickInterval: 750,    // Tick every 0.75s
    intensity: 2,         // 2 damage per tick
    duration: 4000,       // 4 seconds default
  },
};

// Create a new active status effect from an application
export function createActiveEffect(
  type: StatusEffectType,
  overrides?: Partial<ActiveStatusEffect>
): ActiveStatusEffect {
  const defaults = STATUS_EFFECT_DEFAULTS[type] ?? {};
  const now = Date.now();
  
  return {
    id: `effect-${type}-${now}-${Math.random().toString(36).slice(2, 6)}`,
    type,
    startTime: now,
    duration: defaults.duration ?? 1000,
    intensity: defaults.intensity ?? 1,
    tickInterval: defaults.tickInterval,
    lastTickTime: now,
    ...overrides,
  };
}

// Check if an effect is still active
export function isEffectActive(effect: ActiveStatusEffect): boolean {
  return Date.now() < effect.startTime + effect.duration;
}

// Check if a DoT effect should tick
export function shouldEffectTick(effect: ActiveStatusEffect): boolean {
  if (!effect.tickInterval) return false;
  const now = Date.now();
  const timeSinceLastTick = now - (effect.lastTickTime ?? effect.startTime);
  return timeSinceLastTick >= effect.tickInterval;
}
