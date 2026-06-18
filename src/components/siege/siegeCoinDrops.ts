// siegeCoinDrops — drop currency when a Siege Worlds monster dies.
//
// For now every monster drops DIVI = round(initialHealth / 10). Monsters will later be able to
// drop different coins/tokens/points (admin-authored, like DreadRoot) — when that lands this is
// where the per-monster config roll replaces the flat formula. NO drops during a challenge (only
// the open-world game), per design.
import { spawnCoinDrop } from '@/services/worldStore';
import { spawnCoinDrops } from '@/features/coinDrops/coinDropBus';
import type { CoinDropInstance } from '@/features/coinDrops/types';
import { getActiveWorldId } from '@/config/activeWorld';
import { getChallengeState } from './challenge/challengeStore';

/** Fire once when a siege monster is killed. Open-world only; skips challenge kills + non-world
 *  contexts. amountHealth = the monster's initial (max) HP. */
export async function dropSiegeDivi(x: number, y: number, z: number, initialHealth: number): Promise<void> {
  if (getChallengeState().active) return;            // challenge mode → no DIVI drops
  const worldId = getActiveWorldId();
  if (!worldId) return;                              // no persistent world → can't credit
  const amount = Math.round(initialHealth / 10);
  if (amount <= 0) return;
  const floatCount = Math.min(10, Math.max(1, Math.round(amount / 10)));   // 1-10 sprites
  try {
    const drops = await spawnCoinDrop(worldId, 'divi', amount, floatCount, x, y, z);
    if (drops.length) spawnCoinDrops(drops as CoinDropInstance[]);
  } catch (e) {
    console.error('[siegeCoinDrops] DIVI drop failed', e);
  }
}
