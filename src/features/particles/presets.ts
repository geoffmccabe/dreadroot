// Particle effect presets for three-nebula
// Based on GPU renderer examples from https://three-nebula.org/examples/gpu-renderer

// Base64 particle texture - transparent soft circle (PNG with alpha channel)
// This is a 32x32 radial gradient white circle with transparent edges
const PARTICLE_TEXTURE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACXBIWXMAAAsTAAALEwEAmpwYAAABhElEQVRYhe2XMU7DQBBF3yxJgUQBHIAChyAFR+AIdJQcgTJH4AiUFBQcgQo4AFQUSHSAEE9hs9mNvWs7WSt8aSXH8s78P7OzHsMSIYRO+3mC0EEfUEZZ4AR4AO6AZeBU0p2kK0lXkm4k9SXdSrqU1JXUkXQhqS3pVNJJ+v6ppPbY+fOkAXQD9QQ+gDfgFbgGPiW9J5f3AG8I4QhYAjaAFWAT2ALWgXVgDegBC8ACMAcMgAHwDvSBt+SDEQEuJaX/bwBngCPgEPgBnoDH+G0DeDYzAYaBzd8HzA+QdA7MAJ9AV1IP+AAeg1APYAD0g9ADsA9sA9vx6raBDeC7xGS2FPgBnkfEFfAN3AMPIb6dgILXDCH0U+vQJFZ5BXwAzwN8l4TQ97j2gGP+/zJLMCk+TwJrgIVhO/H5JbACZJZlrBBCr4lwlkUYSf8bDWAROGRYc1Q4LwCWGW4zXWCO4d7xJnAS4usB+yGE/hjfJL+LawC1B2B5FPgVxw+B5VL/Pxd/AVKPNJWYuG0QAAAAAElFTkSuQmCC';

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

// ─── Nebula Editor Helpers ──────────────────────────────────────────────────

import type { NebulaEffectId, NebulaEditorParams } from './types';

// Helper to find a behaviour/initializer by type in an emitter
function findBehaviour(emitter: any, type: string): any | null {
  return emitter.behaviours?.find((b: any) => b.type === type) ?? null;
}
function findInitializer(emitter: any, type: string): any | null {
  return emitter.initializers?.find((i: any) => i.type === type) ?? null;
}

// Get default editor params by reading the base preset values
export function getDefaultEditorParams(effectId: NebulaEffectId): NebulaEditorParams {
  const preset = PARTICLE_PRESETS[effectId];
  const emitter = preset.emitters[0];
  const radius = findInitializer(emitter, 'Radius');
  const color = findBehaviour(emitter, 'Color');
  const alpha = findBehaviour(emitter, 'Alpha');
  const force = findBehaviour(emitter, 'Force');
  const drift = findBehaviour(emitter, 'RandomDrift');
  const radVel = findInitializer(emitter, 'RadialVelocity');
  const scale = findBehaviour(emitter, 'Scale');
  const spring = findBehaviour(emitter, 'Spring');

  const params: NebulaEditorParams = {
    effectId,
    scale: 1.0,
    preParticles: preset.preParticles,
    colorA: color?.properties?.colorA ?? '#FFFFFF',
    colorB: color?.properties?.colorB ?? '#FFFFFF',
    alphaStart: alpha?.properties?.alphaA ?? 1,
    alphaEnd: alpha?.properties?.alphaB ?? 0,
    forceX: force?.properties?.fx ?? 0,
    forceY: force?.properties?.fy ?? 0,
    forceZ: force?.properties?.fz ?? 0,
  };

  // Effect-specific defaults
  if (effectId === 'fire') {
    params.driftX = drift?.properties?.driftX ?? 0.5;
    params.radiusMin = radius?.properties?.min ?? 0.3;
    params.radiusMax = radius?.properties?.max ?? 0.8;
  } else if (effectId === 'explosion') {
    params.radialVelocity = radVel?.properties?.radius ?? 15;
    params.fadeEasing = alpha?.properties?.easing ?? 'easeOutQuart';
  } else if (effectId === 'sparkles') {
    params.driftX = drift?.properties?.driftX ?? 1;
    params.radiusMin = radius?.properties?.min ?? 0.1;
    params.radiusMax = radius?.properties?.max ?? 0.3;
    params.twinkleSpeed = emitter.rate?.perSecondMax ?? 0.1;
  } else if (effectId === 'smoke') {
    params.scaleEnd = scale?.properties?.scaleB ?? 3;
    params.radiusMax = radius?.properties?.max ?? 1.5;
  } else if (effectId === 'magic') {
    params.springStrength = spring?.properties?.spring ?? 0.02;
    params.friction = spring?.properties?.friction ?? 0.95;
    params.driftX = drift?.properties?.driftX ?? 1;
    params.radialVelocity = radVel?.properties?.radius ?? 5;
  }

  return params;
}

// Build a modified NebulaPreset from editor params.
// Uses spread-clone (not JSON.parse/JSON.stringify) to preserve texture references
// and avoid WebGL texSubImage2D errors from corrupted image data.
export function buildNebulaPreset(params: NebulaEditorParams): NebulaPreset {
  const { effectId } = params;
  const source = PARTICLE_PRESETS[effectId];
  const srcEmitter = source.emitters[0];

  // Spread-clone initializers and behaviours (shallow clone each object + properties)
  const initializers = srcEmitter.initializers.map((init: any) => ({
    ...init,
    properties: { ...init.properties },
  }));
  const behaviours = srcEmitter.behaviours.map((beh: any) => ({
    ...beh,
    properties: { ...beh.properties },
  }));
  const rate = { ...srcEmitter.rate };

  const emitter = {
    ...srcEmitter,
    rate,
    initializers,
    behaviours,
  };

  const preset: NebulaPreset = {
    ...source,
    preParticles: params.preParticles,
    emitters: [emitter],
  };

  // Apply common: Radius (scaled)
  const radius = findInitializer(emitter, 'Radius');
  if (radius) {
    const baseMin = params.radiusMin ?? radius.properties.min;
    const baseMax = params.radiusMax ?? radius.properties.max;
    radius.properties.min = baseMin * params.scale;
    radius.properties.max = baseMax * params.scale;
  }

  // Apply common: Colors
  const color = findBehaviour(emitter, 'Color');
  if (color) {
    color.properties.colorA = params.colorA;
    color.properties.colorB = params.colorB;
  }

  // Apply common: Alpha
  const alpha = findBehaviour(emitter, 'Alpha');
  if (alpha) {
    alpha.properties.alphaA = params.alphaStart;
    alpha.properties.alphaB = params.alphaEnd;
  }

  // Apply common: Force direction (add Force behaviour if missing)
  let force = findBehaviour(emitter, 'Force');
  if (!force) {
    force = { type: 'Force', properties: { fx: 0, fy: 0, fz: 0, life: null, easing: 'easeLinear' } };
    emitter.behaviours.push(force);
  }
  force.properties.fx = params.forceX;
  force.properties.fy = params.forceY;
  force.properties.fz = params.forceZ;

  // Effect-specific overrides
  if (effectId === 'fire') {
    const drift = findBehaviour(emitter, 'RandomDrift');
    if (drift && params.driftX !== undefined) {
      drift.properties.driftX = params.driftX;
      drift.properties.driftZ = params.driftX;
    }
  } else if (effectId === 'explosion') {
    const radVel = findInitializer(emitter, 'RadialVelocity');
    if (radVel && params.radialVelocity !== undefined) radVel.properties.radius = params.radialVelocity;
    if (alpha && params.fadeEasing) alpha.properties.easing = params.fadeEasing;
  } else if (effectId === 'sparkles') {
    const drift = findBehaviour(emitter, 'RandomDrift');
    if (drift && params.driftX !== undefined) {
      drift.properties.driftX = params.driftX;
      drift.properties.driftZ = params.driftX;
    }
    if (params.twinkleSpeed !== undefined) {
      rate.perSecondMin = params.twinkleSpeed * 0.5;
      rate.perSecondMax = params.twinkleSpeed;
    }
  } else if (effectId === 'smoke') {
    const scaleB = findBehaviour(emitter, 'Scale');
    if (scaleB && params.scaleEnd !== undefined) scaleB.properties.scaleB = params.scaleEnd;
  } else if (effectId === 'magic') {
    const spring = findBehaviour(emitter, 'Spring');
    if (spring) {
      if (params.springStrength !== undefined) spring.properties.spring = params.springStrength;
      if (params.friction !== undefined) spring.properties.friction = params.friction;
    }
    const drift = findBehaviour(emitter, 'RandomDrift');
    if (drift && params.driftX !== undefined) {
      drift.properties.driftX = params.driftX;
      drift.properties.driftZ = params.driftX;
    }
    const radVel = findInitializer(emitter, 'RadialVelocity');
    if (radVel && params.radialVelocity !== undefined) radVel.properties.radius = params.radialVelocity;
  }

  return preset;
}

