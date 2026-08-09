/**
 * probe-terrain-live — run the REAL terrain resolver against the REAL server.
 *
 * I have now guessed wrong about this four times from traces and reading. This does not guess: it
 * takes actual latitudes and longitudes, computes the tiles the game would ask for, and fetches them
 * from assets.dreadroot.com exactly as the browser does.
 */
import { latLonToDirection, directionToFaceUv, uvToTileIndex, tileKey } from '../src/components/siege/globe/cubeSphere';
import { resolveLevel, type NodeId } from '../src/components/siege/globe/globePatchIndex';
import { requestTile, hasTile, earthTileStats } from '../src/components/siege/globe/earthTiles';

const SITES: [string, number, number][] = [
  ['Grand Canyon', 36.0616, -112.1076],
  ['Mount Everest', 27.9881, 86.9250],
  ['Dubai Marina', 25.0805, 55.1403],
  ['mid-Pacific', 0, -160],
];

const d = new Float64Array(3);
for (const [name, lat, lon] of SITES) {
  latLonToDirection(lat, lon, d);
  const { face, u, v } = directionToFaceUv(d[0], d[1], d[2]);
  const depth = 12;
  const node: NodeId = { face, depth, x: uvToTileIndex(u, depth), y: uvToTileIndex(v, depth) };

  // Drive the resolver the way the terrain loop does, awaiting whatever it asks for.
  let level = -1;
  for (let pass = 0; pass < 14; pass++) {
    level = resolveLevel(node, 10);
    // Await every level's fetch so the next pass sees the result.
    const waits: Promise<unknown>[] = [];
    for (let l = 0; l <= 10; l++) {
      const shift = depth - l;
      if (!hasTile(face, l, node.x >> shift, node.y >> shift)) {
        waits.push(requestTile(face, l, node.x >> shift, node.y >> shift));
      }
    }
    await Promise.all(waits);
  }
  const have: number[] = [];
  for (let l = 0; l <= 10; l++) {
    const shift = depth - l;
    if (hasTile(face, l, node.x >> shift, node.y >> shift)) have.push(l);
  }
  console.log(`${name.padEnd(15)} face ${face}  resolver settled at level ${String(level).padStart(2)}   `
    + `levels present: ${have.join(',') || 'NONE'}`);
}
const st = earthTileStats();
console.log(`\ncached ${st.cached}, absent ${st.missing}, failed ${st.failed}`);
