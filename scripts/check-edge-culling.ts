// Neighbour-aware chunk-edge culling (2026-Aug-23). Run:
//   node --experimental-strip-types --loader ./scripts/ts-alias-loader.mjs scripts/check-edge-culling.ts
//
// The world measured GEOMETRY bound, and the culler was keeping the entire
// 1-block border of every chunk because it could only see one chunk at a time.
// The risk in fixing that is punching holes, so these assertions are mostly
// about NOT over-culling.
import { computeSurfaceVisibleBlocks, makeNeighbourSolid } from '../src/lib/chunkBinary.ts';

let failures = 0;
const assert = (c: boolean, m: string) => { if (!c) { console.error('  ✗ ' + m); failures++; } };

const TREE = 'fs_0_1';   // a tree block type: these are the ones culling applies to
type B = { position_x: number; position_y: number; position_z: number; block_type: string };
const mk = (x: number, y: number, z: number, t = TREE): B => ({ position_x: x, position_y: y, position_z: z, block_type: t });

/** A solid 16x16x4 slab filling chunk (cx,cz). */
function slab(cx: number, cz: number, y0 = 60, h = 4): B[] {
  const out: B[] = [];
  for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) for (let y = y0; y < y0 + h; y++) {
    out.push(mk(cx * 16 + x, y, cz * 16 + z));
  }
  return out;
}

const a = slab(0, 0);
const bEast = slab(1, 0);   // the chunk touching chunk 0's +X face

// 1. With NO neighbour lookup, behaviour is unchanged: the whole border stays.
const noLookup = computeSurfaceVisibleBlocks(0, 0, a as never);
const borderKept = noLookup.filter((b: B) => (b.position_x % 16) === 15).length;
assert(borderKept > 0, 'without a lookup the far border is still kept (old behaviour preserved)');

// 2. With the east neighbour LOADED and solid, chunk 0's east border is no
//    longer forced visible — those faces genuinely cannot be seen.
const loaded = new Map<string, { blocks: B[] }>([
  ['chunk_0_0', { blocks: a }],
  ['chunk_1_0', { blocks: bEast }],
]);
const withLookup = computeSurfaceVisibleBlocks(0, 0, a as never, makeNeighbourSolid(loaded as never));
assert(withLookup.length < noLookup.length,
  `neighbour-aware culling removes hidden border blocks (${noLookup.length} -> ${withLookup.length})`);

// 3. THE SAFETY PROPERTY: an UNLOADED neighbour must never cause culling.
//    Unknown has to mean "exposed", or moving into fresh terrain shows holes.
const onlySelf = new Map<string, { blocks: B[] }>([['chunk_0_0', { blocks: a }]]);
const unknownNeighbours = computeSurfaceVisibleBlocks(0, 0, a as never, makeNeighbourSolid(onlySelf as never));
assert(unknownNeighbours.length === noLookup.length,
  `an unloaded neighbour culls nothing extra (${noLookup.length} vs ${unknownNeighbours.length})`);

// 4. A block whose neighbour cell is genuinely EMPTY stays visible. Punch a
//    hole in the east neighbour and the matching border block must return.
const holed = bEast.filter((b) => !(b.position_x === 16 && b.position_y === 61 && b.position_z === 5));
const loadedHoled = new Map<string, { blocks: B[] }>([
  ['chunk_0_0', { blocks: a }],
  ['chunk_1_0', { blocks: holed }],
]);
const withHole = computeSurfaceVisibleBlocks(0, 0, a as never, makeNeighbourSolid(loadedHoled as never));
const facingHole = withHole.some((b: B) => b.position_x === 15 && b.position_y === 61 && b.position_z === 5);
assert(facingHole, 'a border block facing an empty neighbour cell stays visible (no hole)');
assert(withHole.length === withLookup.length + 1, 'exactly the one newly-exposed block came back');

// 5. Culling never empties a chunk (the existing safety net still applies).
assert(withLookup.length > 0, 'culling never returns an empty chunk');

// 6. Top and bottom layers stay visible — sky and underside are always exposed.
const hasTop = withLookup.some((b: B) => b.position_y === 63);
const hasBottom = withLookup.some((b: B) => b.position_y === 60);
assert(hasTop && hasBottom, 'top and bottom layers remain visible');

if (failures > 0) { console.error(`\n❌ edge culling: ${failures} failure(s)`); process.exit(1); }
console.log('✅ edge culling OK (unchanged without lookup / culls hidden borders / unloaded neighbour is safe / holes stay visible)');
