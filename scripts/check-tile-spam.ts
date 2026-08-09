/**
 * check-tile-spam — one 404 must answer for a whole subtree.
 *
 * Geoff: "loading kaiju mode is still filling console with junk spam errors. Hundreds of these."
 *
 * Those 404s are logged by the BROWSER, not by our code, so nothing can be caught or silenced to
 * remove them. The only way is to not make the request. A trace measured 1,653 failed tile requests
 * in 38 seconds, every one for a DISTINCT tile — so the existing "never ask twice" rule was already
 * perfect. What it lacked was the knowledge that a missing tile cannot have children.
 *
 * Run: npm run check:tile-spam
 */
import {
  clearEarthTiles, __noteStatusForTest, __wouldRequestTileForTest,
} from '../src/components/siege/globe/earthTiles';
import { tileKey } from '../src/components/siege/globe/cubeSphere';

let failures = 0;
function ok(cond: boolean, label: string, detail = ''): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!cond) failures++;
}

console.log('\n== One 404 answers for the whole subtree ==\n');

clearEarthTiles();
// The real case from Geoff's console: py face, level 6 (58,49) is absent, and the client then asked
// for 116_98 at level 7, 233_196 at level 8, and so on down.
ok(__wouldRequestTileForTest(2, 6, 58, 49), 'before any answer, the tile is worth asking for');
__noteStatusForTest(tileKey(2, 6, 58, 49), 404);
ok(!__wouldRequestTileForTest(2, 6, 58, 49), 'once refused, it is never asked again');

ok(!__wouldRequestTileForTest(2, 7, 116, 98), 'its level-7 child is not asked for either');
ok(!__wouldRequestTileForTest(2, 8, 233, 196), 'nor its level-8 grandchild');
ok(!__wouldRequestTileForTest(2, 10, 932, 784), 'nor anything four levels down');

// ...and it must not suppress the rest of the planet.
ok(__wouldRequestTileForTest(2, 7, 118, 98), 'a sibling outside that subtree is still asked for');
ok(__wouldRequestTileForTest(3, 7, 116, 98), 'the same coordinates on another FACE are unaffected');
ok(__wouldRequestTileForTest(2, 5, 29, 24), 'and the parent, which does exist, is still asked for');

// How much this actually saves, on the shape the trace measured: levels 5-10 under one dead level-5
// tile is 1 + 4 + 16 + 64 + 256 + 1024 requests, and should become 1.
{
  clearEarthTiles();
  __noteStatusForTest(tileKey(2, 5, 29, 24), 404);
  let asked = 0;
  for (let lv = 6; lv <= 10; lv++) {
    const span = 1 << (lv - 5);
    for (let dx = 0; dx < span; dx++) {
      for (let dy = 0; dy < span; dy++) {
        if (__wouldRequestTileForTest(2, lv, 29 * span + dx, 24 * span + dy)) asked++;
      }
    }
  }
  ok(asked === 0, 'a dead level-5 tile suppresses all 1,364 of its descendants',
     `${asked} would still be asked for`);
}

console.log(`\n${failures === 0 ? 'TILE SPAM CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
