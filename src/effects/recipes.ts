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
  spawnRate: 6,
  spread: 0.18,
  rise: 1.0,
  gravity: 0.0,
  wind: [0, 0],
  flutterAmp: 0.3,
  flutterFreq: 1.1,
  spin: 0.5,
  size0: 0.35,
  size1: 1.5,
  opacity0: 0.5,
  opacity1: 0.0,
  color0: '#5e5e5e',
  color1: '#9a9a9a',
  cullDistance: 100,
  fadeStart: 80,
  fadeEnd: 100,
  importance: 0.25,
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
