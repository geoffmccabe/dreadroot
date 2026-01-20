// Particle system types for three-nebula integration

export type ParticleEffectType = 
  | 'fire'
  | 'explosion' 
  | 'sparkles'
  | 'smoke'
  | 'magic';

export interface ParticleEffectConfig {
  type: ParticleEffectType;
  position: [number, number, number];
  scale?: number;
  duration?: number; // null for infinite
  onComplete?: () => void;
}

export interface ActiveParticleEffect {
  id: string;
  config: ParticleEffectConfig;
  startTime: number;
}
