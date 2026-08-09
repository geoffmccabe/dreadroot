/**
 * check-terrain-detail — the planet must actually climb to the detail that EXISTS.
 *
 * Geoff, twice, across several builds: "there's no terrain... not even a terrain texture below me."
 *
 * Terrain data is a pyramid. Levels 0 to 4 are global and always present; levels 5 to 10 exist only
 * over 225 landmark regions, so outside them the deep levels 404 forever and correctly.
 *
 * The resolver walks up from the level it WANTS until it finds one resident, then asks for a better
 * one so the detail sharpens. It asked for the IDEAL level — which outside a landmark is 5 or
 * deeper, and never arrives. So levels 1 to 4, which exist everywhere and are the entire shape of
 * the planet, were never requested at all. It found level 0, built from it, and stopped: one vertex
 * every few hundred kilometres, a smooth ball, no terrain.
 *
 * This drives the real resolver with a real tile cache and asserts it climbs to the deepest level
 * that exists, and stops there without hammering what does not.
 *
 * Run: npm run check:terrain-detail
 */

import { resolveLevel, type NodeId } from '../src/components/siege/globe/globePatchIndex';
import {
  __putTileForTest, __noteStatusForTest, __wouldRequestForTest, clearEarthTiles, earthTileStats,
} from '../src/components/siege/globe/earthTiles';
import { tileKey } from '../src/components/siege/globe/cubeSphere';

let failures = 0;
function ok(cond: boolean, label: string, detail = ''): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!cond) failures++;
}

/** What the real data looks like away from a landmark: 0-4 exist, everything deeper does not. */
const GLOBAL_MAX = 4;
const tiny = new Int16Array(1);

console.log('\n== Terrain climbs to the detail that exists ==\n');

// A patch deep enough to want level-10 data, somewhere with no landmark coverage.
const node: NodeId = { face: 0, depth: 12, x: 1234, y: 2345 };

clearEarthTiles();
// Only the coarsest tile is resident to begin with, as on arrival.
__putTileForTest(tileKey(node.face, 0, 0, 0), tiny);

// Run the resolver the way the terrain loop does — many times — and satisfy whatever it asks for,
// but only if that level actually exists.
let level = -1;
const asked = new Set<number>();
for (let frame = 0; frame < 40; frame++) {
  level = resolveLevel(node, 10);
  // Whatever it requested this frame, answer it the way the server would.
  for (let l = 0; l <= 10; l++) {
    const shift = node.depth - l;
    const k = tileKey(node.face, l, node.x >> shift, node.y >> shift);
    if (!__wouldRequestForTest(k)) continue;
    asked.add(l);
    if (l <= GLOBAL_MAX) __putTileForTest(k, tiny);
    else __noteStatusForTest(k, 404);
  }
}

ok(level === GLOBAL_MAX, 'it reaches the deepest level that actually exists',
   `settled at level ${level}, data exists to ${GLOBAL_MAX}`);
ok(level > 0, 'and is not stuck on the coarsest tile — which is a smooth ball, not a planet',
   `level ${level}`);
for (let l = 1; l <= GLOBAL_MAX; l++) {
  ok(asked.has(l), `it actually asked for level ${l}`);
}
// THE STORM TEST. Once it has settled, running the resolver forever must issue NO further
// requests. That is the difference between probing an absent level once and hammering it — the
// latter is what put a hundred and ten requests a second on the wire and starved the tiles that
// DO exist off the connection entirely.
{
  const before = earthTileStats().missing;
  let wouldFetch = 0;
  for (let frame = 0; frame < 200; frame++) {
    resolveLevel(node, 10);
    for (let l = 0; l <= 10; l++) {
      const shift = node.depth - l;
      if (__wouldRequestForTest(tileKey(node.face, l, node.x >> shift, node.y >> shift))) wouldFetch++;
    }
  }
  ok(wouldFetch === 0, 'once settled it issues no further requests, ever',
     `${wouldFetch} would still be fetched over 200 frames`);
  ok(earthTileStats().missing === before, 'and discovers nothing new', `${earthTileStats().missing}`);
}

// INSIDE a landmark region, where the deep data does exist, it must go all the way down.
{
  clearEarthTiles();
  __putTileForTest(tileKey(node.face, 0, 0, 0), tiny);
  let lv = -1;
  for (let frame = 0; frame < 40; frame++) {
    lv = resolveLevel(node, 10);
    for (let l = 0; l <= 10; l++) {
      const shift = node.depth - l;
      const k = tileKey(node.face, l, node.x >> shift, node.y >> shift);
      if (__wouldRequestForTest(k)) __putTileForTest(k, tiny);
    }
  }
  ok(lv === 10, 'and inside a landmark region it goes all the way to the finest data', `level ${lv}`);
}

console.log(`\n${failures === 0 ? 'TERRAIN DETAIL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
