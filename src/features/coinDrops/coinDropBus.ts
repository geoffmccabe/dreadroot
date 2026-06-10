/**
 * Coin drop bus — decouples "a kill rolled some coins" from the in-scene renderer.
 * See docs/COIN_DROPS.md. Kill handlers call spawnCoinDrops(); the FloatingCoinManager
 * (mounted in the scene) subscribes via setCoinDropListener(). One listener (the manager).
 */
import type { CoinDropInstance } from './types';

let listener: ((drops: CoinDropInstance[]) => void) | null = null;

/** Hand newly-rolled floating coin instances to the renderer (no-op if unmounted). */
export function spawnCoinDrops(drops: CoinDropInstance[]): void {
  if (listener && drops.length) listener(drops);
}

/** The manager registers here on mount; returns an unsubscribe. */
export function setCoinDropListener(cb: (drops: CoinDropInstance[]) => void): () => void {
  listener = cb;
  return () => { if (listener === cb) listener = null; };
}
