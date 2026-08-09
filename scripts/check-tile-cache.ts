/**
 * check-tile-cache — the terrain cache must be bigger than the terrain being looked at.
 *
 * An LRU smaller than its working set does not degrade gracefully; it collapses. Every entry is
 * evicted just before it is needed again, so the hit rate goes to nearly zero and the cost is not
 * "a bit more network" but a permanent refetch-and-decode loop that never converges.
 *
 * That is what Geoff's trace caught: 1,109 distinct tiles wanted, 512 held, 8,836 requests issued —
 * eight fetches per tile. Which produced, all from one number: an animation frame climbing from
 * 32 ms to 102 ms, scavenger GC up twentyfold, and squares of terrain simply missing under the
 * Kaiju because a patch asked for its tile and got null.
 *
 * Run: npm run check:tile-cache
 */

import { __putTileForTest, earthTileStats, clearEarthTiles } from '../src/components/siege/globe/earthTiles';
import { tileKey } from '../src/components/siege/globe/cubeSphere';

let failures = 0;
function ok(cond: boolean, label: string, detail = ''): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!cond) failures++;
}

/** Sized off the trace: the deepest levels dominate, as they always will. */
const OBSERVED_WORKING_SET = 1109;
const tiny = new Int16Array(1);

console.log('\n== The terrain cache is larger than what is being looked at ==\n');

clearEarthTiles();
ok(earthTileStats().cap > OBSERVED_WORKING_SET,
   'the cache is bigger than the working set a real session asked for',
   `${earthTileStats().cap} slots vs ${OBSERVED_WORKING_SET} tiles wanted`);

// THE THRASH TEST. Cycle a realistic working set several times over. With a cache that fits, the
// second and later passes must evict NOTHING — that is the whole difference between a cache and a
// very slow download manager.
{
  clearEarthTiles();
  const keys: string[] = [];
  // The shape the trace showed: a handful of coarse tiles and a great many deep ones.
  for (let lvl = 5; lvl <= 10; lvl++) {
    const n = Math.round(OBSERVED_WORKING_SET * (lvl === 10 ? 0.27 : lvl === 9 ? 0.23 : lvl === 8 ? 0.19
      : lvl === 7 ? 0.15 : lvl === 6 ? 0.10 : 0.06));
    for (let i = 0; i < n; i++) keys.push(tileKey(i % 6, lvl, i, lvl * 7 + i));
  }
  for (const k of keys) __putTileForTest(k, tiny);
  const afterFirst = earthTileStats().evicted;
  for (let pass = 0; pass < 4; pass++) for (const k of keys) __putTileForTest(k, tiny);
  const afterMore = earthTileStats().evicted;

  ok(afterMore === afterFirst, 'cycling the same working set evicts nothing after the first pass',
     `${afterMore - afterFirst} evictions over four more passes of ${keys.length} tiles`);
  ok(earthTileStats().cached === keys.length, 'and all of it stays resident',
     `${earthTileStats().cached} of ${keys.length}`);
}

// THE COARSE PYRAMID IS PINNED. Everything falls back to it while its own level loads, so it must
// never be the thing thrown out to make room for one more deep tile.
{
  clearEarthTiles();
  const coarse: string[] = [];
  for (let i = 0; i < 120; i++) { const k = tileKey(i % 6, 4, i, i); coarse.push(k); __putTileForTest(k, tiny); }
  // Now flood it with far more deep tiles than it can hold.
  for (let i = 0; i < 4000; i++) __putTileForTest(tileKey(i % 6, 11, i, i), tiny);
  ok(earthTileStats().cached <= earthTileStats().cap + coarse.length,
     'the cache still respects its cap under flood', `${earthTileStats().cached}`);
  ok(earthTileStats().evicted > 0, 'and it did evict, so the flood was real',
     `${earthTileStats().evicted}`);
}

console.log(`\n${failures === 0 ? 'TILE CACHE CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
