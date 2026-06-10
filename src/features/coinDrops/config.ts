/**
 * Coin drops — defaults + helpers. See docs/COIN_DROPS.md.
 *
 * The single source of tunable behavior. Slice 5 will surface these in admin;
 * until then they're the defaults the renderer uses.
 */
import type { CoinDropBehaviorConfig } from './types';

/** Killer-only visibility/pickup window; public afterward. Matches pickup_coin_drop. */
export const OWNERSHIP_WINDOW_MS = 60_000;

/** Max floating sprites per drop — the normalization ceiling. */
export const MAX_FLOAT_COINS = 10;

/**
 * Unit normalization: how many floating sprites represent `amount`, given the
 * drop range's `max`. clamp(round(amount / max * 10), 1, 10).
 *   range 20–100: amount 20 → 2, 100 → 10.
 *   range 35–50 : amount 35 → 7,  50 → 10.
 * Each sprite then represents amount / count coins; the credited total is amount.
 */
export function normalizeFloatCount(amount: number, max: number): number {
  if (max <= 0) return 1;
  const n = Math.round((amount / max) * MAX_FLOAT_COINS);
  return Math.min(MAX_FLOAT_COINS, Math.max(1, n));
}

export const DEFAULT_COIN_DROP_BEHAVIOR: CoinDropBehaviorConfig = {
  // Spawn
  spawnScatterRadius: 0.6,
  spawnUpVelocity: 3.0,
  gravity: 9.0,
  settleHeight: 0.8,
  // Idle motion
  bobAmplitude: 0.12,
  bobFrequencyHz: 0.8,
  spinSpeed: 2.2,
  // Look
  scale: 0.15,            // 30% of the previous 0.5 — small coins
  scaleJitter: 0.15,
  baseOpacity: 1.0,
  glowAdditive: true,
  // Magnet + collect
  magnetRange: 6.0,
  magnetSpeed: 12.0,
  collectRange: 0.7,
  // Lifetime
  lifespanMsMin: 45_000,
  lifespanMsMax: 90_000,
  fadeOutMs: 800,
};
