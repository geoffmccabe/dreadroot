/**
 * Coin drops — defaults + helpers. See docs/COIN_DROPS.md.
 *
 * The single source of tunable behavior. Slice 5 will surface these in admin;
 * until then they're the defaults the renderer uses.
 */
import type { CoinDropBehaviorConfig } from './types';

/** Killer-only visibility/pickup window; public afterward. Matches pickup_coin_drop. */
export const OWNERSHIP_WINDOW_MS = 60_000;

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
