// Effect recipe registry with a hardcoded FALLBACK so the engine runs before
// (or without) any DB rows — never gate the visual on a fetch. Phase 2 will call
// registerRecipe() with rows loaded from `effect_definitions`; this fallback
// mirrors the seeded `fire-smoke` row so the two can't drift.

import type { EffectRecipe } from './types';

/** The FIRST smoke variant: grey smoke trailing off burning enemies. */
export const FIRE_SMOKE: EffectRecipe = {
  code: 'fire-smoke',
  family: 'smoke',
  backend: 'billboard',
  blend: 'alpha',
  lifetime: 3.0,
  // ~10x the puffs, much smaller, so it reads as smoke volume not discrete
  // circles. Interpolated spawn (see backend) spaces them evenly along motion.
  spawnRate: 60,
  spread: 0.14,
  rise: 1.0,
  gravity: 0.0,
  wind: [0, 0],
  flutterAmp: 0.3,
  flutterFreq: 1.1,
  spin: 0.5,
  size0: 0.12,
  size1: 0.6,
  opacity0: 0.32,
  opacity1: 0.0,
  color0: '#5e5e5e',
  color1: '#9a9a9a',
  cullDistance: 100,
  fadeStart: 80,
  fadeEnd: 100,
  importance: 0.25,
  // Spinning inward spiral laid over the smoke, slightly lighter, fading with it.
  spiral: true,
  spiralRate: 8,
  spiralSize0: 0.4,
  spiralSize1: 1.1,
  spiralOpacity: 0.5,
  spiralLighten: 0.22,
  spiralTurns: 2,
  spiralSpinMinSec: 0.5,
  spiralSpinMaxSec: 1.0,
};

const cache = new Map<string, EffectRecipe>([[FIRE_SMOKE.code, FIRE_SMOKE]]);

export function getRecipe(code: string): EffectRecipe {
  return cache.get(code) ?? FIRE_SMOKE;
}

export function registerRecipe(r: EffectRecipe): void {
  cache.set(r.code, r);
}

export function allRecipeCodes(): string[] {
  return [...cache.keys()];
}
