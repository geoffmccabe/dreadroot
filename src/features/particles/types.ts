// Particle system types for three-nebula integration

export type ParticleEffectType = 
  | 'fire'
  | 'explosion' 
  | 'sparkles'
  | 'smoke'
  | 'magic'
  | 'impact'; // Bullet impact effect - short burst fire

export interface ParticleEffectConfig {
  type: ParticleEffectType;
  position: [number, number, number];
  scale?: number;
  duration?: number; // null for infinite
  color?: string; // Optional color override (hex)
  onComplete?: () => void;
}

export interface ActiveParticleEffect {
  id: string;
  config: ParticleEffectConfig;
  startTime: number;
}

// ─── Nebula Effect Editor Types ─────────────────────────────────────────────

export type NebulaEffectId = 'fire' | 'explosion' | 'sparkles' | 'smoke' | 'magic';

export const NEBULA_EFFECT_CODES: Record<NebulaEffectId, string> = {
  fire: 'EF1',
  explosion: 'EF2',
  sparkles: 'EF3',
  smoke: 'EF4',
  magic: 'EF5',
};

export const NEBULA_EFFECT_NAMES: Record<NebulaEffectId, string> = {
  fire: 'Fire',
  explosion: 'Explosion',
  sparkles: 'Sparkles',
  smoke: 'Smoke',
  magic: 'Magic',
};

export const NEBULA_EFFECT_IDS: NebulaEffectId[] = ['fire', 'explosion', 'sparkles', 'smoke', 'magic'];

// Unified editor params — common + optional effect-specific fields
export interface NebulaEditorParams {
  effectId: NebulaEffectId;
  // Common
  scale: number;
  preParticles: number;
  colorA: string;
  colorB: string;
  alphaStart: number;
  alphaEnd: number;
  // Force direction (common — controls particle gravity/direction)
  forceX: number;
  forceY: number;
  forceZ: number;
  // Fire / Sparkles / Magic
  driftX?: number;
  // Fire / Sparkles
  radiusMin?: number;
  radiusMax?: number;
  // Explosion / Magic
  radialVelocity?: number;
  // Explosion
  fadeEasing?: string;
  // Sparkles
  twinkleSpeed?: number;
  // Smoke
  scaleEnd?: number;
  // Magic
  springStrength?: number;
  friction?: number;
}

export interface CapturedNebulaEffect {
  code: string;
  effectId: NebulaEffectId;
  params: NebulaEditorParams;
  capturedAt: number;
}
