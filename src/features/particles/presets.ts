// Particle effect presets for three-nebula
// Based on GPU renderer examples from https://three-nebula.org/examples/gpu-renderer

// Base64 particle texture (soft circle)
const PARTICLE_TEXTURE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAABGdBTUEAAK/INwWK6QAAABl0RVh0U29mdHdhcmUAQWRvYmUgSW1hZ2VSZWFkeXHJZTwAAAJkSURBVHjaxJeJbusgEEW94S1L//83X18M2MSuLd2pbqc4wZGqRLrKBsyZhQHny7Jk73xVL8xpVhWrcmiB5lX+6GJ5YgQ2owbAm8oIwH1VgKZUmGcRqKGGPgtEQQAzGR8hQ59fAmhJHSAagigJ4E7GPWRXOYC6owAd1JM6wDQPADyMWUqZRMqmAojHp1Vn6EQQEgUNMJLnUjMyJsM49wygBkAPw9dVFwXRkncCIIW3GRgoTQUZn6HxCMAFEFd8TwEQ78X4rHbILoAUmeT+RFG4UhQ6MiIAE4W/UsYFjuVjAIa2nIY4q1R0GFtQWG3E84lqw2GO2QOoCKBVu0BAPgDSU0eUDjjQenNkV/AW/pWChhpMTelo1a64AOKM30vk18GzTHXCNtI/Knz3DFBgsUqBGIjTInXRY1yA9xkVoqW5tVq3pDR9A0hfF5BSARmVnh7RMDCaIdcNgbPBkgzn1Bu+SfIEFSpSBmkxyrMicb0fAEuCZrWnN89veA/4XcakrPcjBWzkTuLjlbfTQPOlBhz+HwkqqPXmPQDdrQItxE1moGof1S74j/8txk8EHhTQrAE8qlwfqS5yukm1x/rAJ9Jiaa6nyATqD78aUVBhFo8b1V4DdTXdCW+IxA1zB4JhiOhZMEWO1HqnvdoHZ4FAMIhV9REF8FiUm0jsYPEJx/Fm/N8OhH90HI9YRHesWbXXZwAShU8qThe7H8YAuJmw5yOd989uRINKRTJAhoF8jbqrHKfeCYdIISZfSq26bk/K+yO3YvfKrVgiwQBHnwt8ynPB25+M8hceTt/ybPhnryJ78+tLgAEAuCFyiQgQB30AAAAASUVORK5CYII=';

export interface NebulaPreset {
  preParticles: number;
  integrationType: string;
  emitters: any[];
}

// Fire effect - warm colors rising upward
export const firePreset: NebulaPreset = {
  preParticles: 200,
  integrationType: 'EULER',
  emitters: [
    {
      rate: { particlesMin: 5, particlesMax: 10, perSecondMin: 0.01, perSecondMax: 0.02 },
      position: { x: 0, y: 0, z: 0 },
      initializers: [
        { type: 'Mass', properties: { min: 1, max: 1, isEnabled: true } },
        { type: 'Life', properties: { min: 1, max: 2, isEnabled: true } },
        { type: 'BodySprite', properties: { texture: PARTICLE_TEXTURE, isEnabled: true } },
        { type: 'Radius', properties: { min: 0.3, max: 0.8, isEnabled: true } },
        { type: 'RadialVelocity', properties: { radius: 3, x: 0, y: 1, z: 0, theta: 15, isEnabled: true } },
      ],
      behaviours: [
        { type: 'Alpha', properties: { alphaA: 1, alphaB: 0, life: null, easing: 'easeOutCubic' } },
        { type: 'Color', properties: { colorA: '#FF6600', colorB: '#FF0000', life: null, easing: 'easeLinear' } },
        { type: 'Scale', properties: { scaleA: 1, scaleB: 0.3, life: null, easing: 'easeLinear' } },
        { type: 'Force', properties: { fx: 0, fy: 2, fz: 0, life: null, easing: 'easeLinear' } },
        { type: 'RandomDrift', properties: { driftX: 0.5, driftY: 0.2, driftZ: 0.5, delay: 0, life: null, easing: 'easeLinear' } },
      ],
    },
  ],
};

// Explosion effect - burst outward with fast fade
export const explosionPreset: NebulaPreset = {
  preParticles: 100,
  integrationType: 'EULER',
  emitters: [
    {
      rate: { particlesMin: 50, particlesMax: 80, perSecondMin: 0.001, perSecondMax: 0.001 },
      position: { x: 0, y: 0, z: 0 },
      initializers: [
        { type: 'Mass', properties: { min: 1, max: 3, isEnabled: true } },
        { type: 'Life', properties: { min: 0.5, max: 1.5, isEnabled: true } },
        { type: 'BodySprite', properties: { texture: PARTICLE_TEXTURE, isEnabled: true } },
        { type: 'Radius', properties: { min: 0.5, max: 1.2, isEnabled: true } },
        { type: 'RadialVelocity', properties: { radius: 15, x: 0, y: 0, z: 0, theta: 180, isEnabled: true } },
      ],
      behaviours: [
        { type: 'Alpha', properties: { alphaA: 1, alphaB: 0, life: null, easing: 'easeOutQuart' } },
        { type: 'Color', properties: { colorA: '#FFFF00', colorB: '#FF3300', life: null, easing: 'easeLinear' } },
        { type: 'Scale', properties: { scaleA: 1.5, scaleB: 0.1, life: null, easing: 'easeOutCubic' } },
      ],
    },
  ],
};

// Sparkles effect - twinkling magical particles
export const sparklesPreset: NebulaPreset = {
  preParticles: 150,
  integrationType: 'EULER',
  emitters: [
    {
      rate: { particlesMin: 3, particlesMax: 6, perSecondMin: 0.05, perSecondMax: 0.1 },
      position: { x: 0, y: 0, z: 0 },
      initializers: [
        { type: 'Mass', properties: { min: 0.5, max: 1, isEnabled: true } },
        { type: 'Life', properties: { min: 1, max: 3, isEnabled: true } },
        { type: 'BodySprite', properties: { texture: PARTICLE_TEXTURE, isEnabled: true } },
        { type: 'Radius', properties: { min: 0.1, max: 0.3, isEnabled: true } },
        { type: 'RadialVelocity', properties: { radius: 2, x: 0, y: 1, z: 0, theta: 60, isEnabled: true } },
      ],
      behaviours: [
        { type: 'Alpha', properties: { alphaA: 1, alphaB: 0, life: null, easing: 'easeInOutSine' } },
        { type: 'Color', properties: { colorA: '#FFFFFF', colorB: '#FFDD00', life: null, easing: 'easeLinear' } },
        { type: 'Scale', properties: { scaleA: 0.8, scaleB: 0.2, life: null, easing: 'easeLinear' } },
        { type: 'RandomDrift', properties: { driftX: 1, driftY: 0.5, driftZ: 1, delay: 0.2, life: null, easing: 'easeLinear' } },
      ],
    },
  ],
};

// Smoke effect - slow rising dark particles
export const smokePreset: NebulaPreset = {
  preParticles: 100,
  integrationType: 'EULER',
  emitters: [
    {
      rate: { particlesMin: 2, particlesMax: 4, perSecondMin: 0.1, perSecondMax: 0.2 },
      position: { x: 0, y: 0, z: 0 },
      initializers: [
        { type: 'Mass', properties: { min: 2, max: 4, isEnabled: true } },
        { type: 'Life', properties: { min: 3, max: 5, isEnabled: true } },
        { type: 'BodySprite', properties: { texture: PARTICLE_TEXTURE, isEnabled: true } },
        { type: 'Radius', properties: { min: 0.5, max: 1.5, isEnabled: true } },
        { type: 'RadialVelocity', properties: { radius: 1, x: 0, y: 1, z: 0, theta: 10, isEnabled: true } },
      ],
      behaviours: [
        { type: 'Alpha', properties: { alphaA: 0.6, alphaB: 0, life: null, easing: 'easeOutQuad' } },
        { type: 'Color', properties: { colorA: '#444444', colorB: '#222222', life: null, easing: 'easeLinear' } },
        { type: 'Scale', properties: { scaleA: 1, scaleB: 3, life: null, easing: 'easeOutQuad' } },
        { type: 'Force', properties: { fx: 0, fy: 0.5, fz: 0, life: null, easing: 'easeLinear' } },
        { type: 'RandomDrift', properties: { driftX: 0.3, driftY: 0.1, driftZ: 0.3, delay: 0.5, life: null, easing: 'easeLinear' } },
      ],
    },
  ],
};

// Magic effect - swirling colorful particles with spring behavior
export const magicPreset: NebulaPreset = {
  preParticles: 300,
  integrationType: 'EULER',
  emitters: [
    {
      rate: { particlesMin: 8, particlesMax: 15, perSecondMin: 0.02, perSecondMax: 0.05 },
      position: { x: 0, y: 0, z: 0 },
      initializers: [
        { type: 'Mass', properties: { min: 1, max: 2, isEnabled: true } },
        { type: 'Life', properties: { min: 2, max: 4, isEnabled: true } },
        { type: 'BodySprite', properties: { texture: PARTICLE_TEXTURE, isEnabled: true } },
        { type: 'Radius', properties: { min: 0.2, max: 0.5, isEnabled: true } },
        { type: 'RadialVelocity', properties: { radius: 5, x: 0, y: 0, z: 1, theta: 45, isEnabled: true } },
      ],
      behaviours: [
        { type: 'Alpha', properties: { alphaA: 1, alphaB: 0, life: null, easing: 'easeLinear' } },
        { type: 'Color', properties: { colorA: '#4F1500', colorB: '#0029FF', life: null, easing: 'easeLinear' } },
        { type: 'Scale', properties: { scaleA: 1, scaleB: 0.5, life: null, easing: 'easeLinear' } },
        { type: 'RandomDrift', properties: { driftX: 1, driftY: 2, driftZ: 1, delay: 0.1, life: null, easing: 'easeLinear' } },
        { type: 'Spring', properties: { x: 0, y: 0, z: 0, spring: 0.02, friction: 0.95, life: null, easing: 'easeLinear' } },
      ],
    },
  ],
};

// Impact effect - short burst fire for bullet hits (0.5 second, 0.25m base size)
export const impactPreset: NebulaPreset = {
  preParticles: 20,
  integrationType: 'EULER',
  emitters: [
    {
      rate: { particlesMin: 15, particlesMax: 20, perSecondMin: 0.001, perSecondMax: 0.001 }, // One-shot burst
      position: { x: 0, y: 0, z: 0 },
      initializers: [
        { type: 'Mass', properties: { min: 0.5, max: 1, isEnabled: true } },
        { type: 'Life', properties: { min: 0.15, max: 0.4, isEnabled: true } }, // Shorter life for 0.5s effect
        { type: 'BodySprite', properties: { texture: PARTICLE_TEXTURE, isEnabled: true } },
        { type: 'Radius', properties: { min: 0.03, max: 0.08, isEnabled: true } }, // ~0.25m total spread (scaled by size param)
        { type: 'RadialVelocity', properties: { radius: 1.5, x: 0, y: 1, z: 0, theta: 60, isEnabled: true } },
      ],
      behaviours: [
        { type: 'Alpha', properties: { alphaA: 1, alphaB: 0, life: null, easing: 'easeOutCubic' } },
        { type: 'Color', properties: { colorA: '#FFAA00', colorB: '#FF4400', life: null, easing: 'easeLinear' } }, // Yellow/orange fire
        { type: 'Scale', properties: { scaleA: 1.0, scaleB: 0.1, life: null, easing: 'easeOutCubic' } },
        { type: 'Force', properties: { fx: 0, fy: 0.8, fz: 0, life: null, easing: 'easeLinear' } },
        { type: 'RandomDrift', properties: { driftX: 0.3, driftY: 0.15, driftZ: 0.3, delay: 0, life: null, easing: 'easeLinear' } },
      ],
    },
  ],
};

export const PARTICLE_PRESETS = {
  fire: firePreset,
  explosion: explosionPreset,
  sparkles: sparklesPreset,
  smoke: smokePreset,
  magic: magicPreset,
  impact: impactPreset,
} as const;
