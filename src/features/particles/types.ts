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
