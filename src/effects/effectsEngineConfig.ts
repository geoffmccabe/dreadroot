// Engine-level effects config — NOT per-effect (that's the recipe). These are
// global caps + quality tiers, OVERRIDABLE PER GAME so different games on the
// same engine get different budgets without code edits. No hard-coded literals
// scattered through the renderer.

import type { QualityTier } from './types';

export interface EffectsEngineConfig {
  /** Max live puff instances per recipe pool (ring-buffer cap). */
  maxInstancesPerRecipe: number;
  /** Max concurrent continuous emitters (lowest-significance evicted past this). */
  maxEmitters: number;
  /** Spawn-rate + density multiplier per quality tier. */
  qualityScale: Record<QualityTier, number>;
  /** Default tier (mobile-leaning). */
  defaultQuality: QualityTier;
}

const DEFAULT: EffectsEngineConfig = {
  // Raised for the dense small-puff smoke (~60/s × 3s × several burns). Quads
  // are vertex-animated + mostly discarded, so the cost is fill (overdraw), not
  // count — small puffs keep overdraw down. Quality tier scales this on mobile.
  maxInstancesPerRecipe: 4000,
  // Cover a full grenade horde burning at once (MAX_BURNS=80) + a preview emitter.
  maxEmitters: 96,
  qualityScale: { low: 0.5, med: 0.8, high: 1.0 },
  defaultQuality: 'med',
};

// Per-game overrides keyed by GAME_ID. Empty today — the structure is the point:
// e.g. a heavier desktop game could bump caps; a mobile-only game could lower them.
const PER_GAME: Record<string, Partial<EffectsEngineConfig>> = {
  // 'siege-worlds': { maxInstancesPerRecipe: 1600 },
  // 'pinkland': {},
};

export function getEffectsConfig(gameId: string): EffectsEngineConfig {
  return { ...DEFAULT, ...(PER_GAME[gameId] ?? {}) };
}
