// globePatchIndex — a record of the terrain patches that were ACTUALLY BUILT, and the one true
// answer to "how high is the ground here?"
//
// WHY THIS EXISTS
// ---------------
// Standing on the planet needs a ground height. There were two independent ways of computing one:
//
//   the MESH BUILDER  used the deepest tile RESIDENT WHEN THE PATCH WAS BUILT, capped two quadtree
//                     levels above the patch depth (DATA_LAG), and band-limited its procedural
//                     detail to that patch's own vertex spacing.
//
//   the GROUND SAMPLER walked to the deepest tile resident RIGHT NOW at ANY level, with no cap,
//                     and band-limited its detail to a fixed constant.
//
// Those two agree only by coincidence. Inside a landmark region — the Grand Canyon, where the data
// goes down to 38 m samples — the sampler routinely used a tile several levels finer than the one
// the visible mesh was made from. On a canyon rim that is a difference of well over a hundred
// metres, and a creature placed at the sampler's height stands with its legs inside the drawn
// surface. A 1.8 m person placed the same way is simply gone.
//
// That is the reported bug, and it is the same shape as the last one: TWO code paths computing what
// should be ONE thing. So this module holds the record of what was really drawn, and the sampler
// asks it rather than guessing. Where a patch exists, the ground you stand on IS the ground you see,
// by construction rather than by luck.
//
// The old independent estimate is kept as a FALLBACK, for ground whose patch has not been built
// yet — flying high over unstreamed terrain, mostly. It is better than nothing and it is clearly
// marked as an estimate.

import {
  TILE, PLANET_RADIUS, directionToFaceUv, tileArcUnits, tileUvRange, uvToTileIndex,
} from './cubeSphere';
import { getTile, sampleTileBilinear, hasTile, requestTile } from './earthTiles';
import { detailMetres } from './globeDetail';

/** Vertices per patch side. 65 = 64 quads = 8,192 triangles. */
export const PATCH = 65;
/** Data level is this many quadtree levels shallower than the render depth. */
export const DATA_LAG = 2;
/** Deepest the render quadtree may go. Shared so the index can search the same range. */
export const MAX_RENDER_DEPTH = 12;

export interface NodeId { face: number; depth: number; x: number; y: number }

export const idKey = (n: NodeId) => `${n.face}:${n.depth}:${n.x}:${n.y}`;

export function parseKey(k: string): NodeId {
  const [face, depth, x, y] = k.split(':').map(Number);
  return { face, depth, x, y };
}

/**
 * Data level, tile index and sub-rectangle for a render node.
 *
 * `span` and `stride` are FLOATS. Once the render tree goes deeper than the data pyramid plus
 * DATA_LAG (which it does, so procedural detail has somewhere to live), a patch covers less than
 * one texel per vertex and must sample the tile bilinearly at fractional coordinates. Integer
 * indexing there silently reads undefined and produces NaN geometry.
 */
export function dataFor(n: NodeId, maxLevel: number, level = -1) {
  if (level < 0) level = Math.max(0, Math.min(n.depth - DATA_LAG, maxLevel));
  const shift = n.depth - level;                  // how many quadtree steps the tile is above us
  const tx = n.x >> shift, ty = n.y >> shift;
  const span = (TILE - 1) / Math.pow(2, shift);   // samples of the tile this patch covers
  const stride = span / (PATCH - 1);
  const ox = (n.x - (tx * Math.pow(2, shift))) * span;
  const oy = (n.y - (ty * Math.pow(2, shift))) * span;
  return { level, tx, ty, ox, oy, stride };
}

/** Vertex spacing of a patch at this depth, in game units. Band-limits the procedural octaves. */
export const patchSpacingUnits = (depth: number) => tileArcUnits(depth) / (PATCH - 1);

/** Built patches, by node key -> the data level the geometry was actually made from. */
const built = new Map<string, number>();
/** Deepest depth currently present, so the lookup does not scan levels that cannot match. */
let deepestBuilt = 0;

/** Live counts, so "is the ground being read from the mesh or estimated?" is answerable. */
export const patchIndexDiag = { built: 0, exact: 0, estimated: 0 };

export function notePatchBuilt(n: NodeId, level: number): void {
  built.set(idKey(n), level);
  if (n.depth > deepestBuilt) deepestBuilt = n.depth;
  patchIndexDiag.built = built.size;
}

export function notePatchRemoved(key: string): void {
  built.delete(key);
  patchIndexDiag.built = built.size;
  if (built.size === 0) deepestBuilt = 0;
}

export function clearPatchIndex(): void {
  built.clear();
  deepestBuilt = 0;
  patchIndexDiag.built = 0;
}

/**
 * The height of the surface AS DRAWN, in metres above sea level, or null if no patch covers this
 * direction yet.
 *
 * This reproduces the mesh builder's arithmetic exactly: same node, same data level, same tile
 * sample position, same band limit. At a patch vertex it is the identical number; between vertices
 * it differs from the mesh's linear interpolation only by the curvature of the height field across
 * one cell, which is metres, not hundreds of metres.
 */
export function renderedElevation(x: number, y: number, z: number): number | null {
  if (built.size === 0) return null;
  const { face, u, v } = directionToFaceUv(x, y, z);

  // Walk from the finest depth outward: the deepest patch covering this point is the one on screen.
  for (let depth = Math.min(deepestBuilt, MAX_RENDER_DEPTH); depth >= 0; depth--) {
    const nx = uvToTileIndex(u, depth);
    const ny = uvToTileIndex(v, depth);
    const level = built.get(`${face}:${depth}:${nx}:${ny}`);
    if (level === undefined) continue;

    const n: NodeId = { face, depth, x: nx, y: ny };
    const d = dataFor(n, level, level);
    const tile = getTile(face, d.level, d.tx, d.ty);
    if (!tile) continue;                       // evicted since it was built; try a coarser patch

    // Where this direction falls inside the patch, in patch-vertex coordinates.
    const [u0, u1] = tileUvRange(nx, depth);
    const [v0, v1] = tileUvRange(ny, depth);
    const ii = ((u - u0) / (u1 - u0)) * (PATCH - 1);
    const jj = ((v - v0) / (v1 - v0)) * (PATCH - 1);

    const baseM = sampleTileBilinear(tile, d.ox + ii * d.stride, d.oy + jj * d.stride);
    if (!Number.isFinite(baseM)) continue;
    patchIndexDiag.exact++;
    return baseM + detailMetres(x, y, z, PLANET_RADIUS, baseM, patchSpacingUnits(depth));
  }
  return null;
}

/**
 * The deepest RESIDENT tile covering this node, walking up until one is found.
 *
 * Levels 5-10 exist only inside the 225 landmark regions, so outside them level 5 simply 404s.
 * Refusing to subdivide when the ideal tile is missing capped the whole rest of the planet at
 * depth 6, i.e. one vertex every 2.44 km, which is why everywhere except a landmark rendered
 * perfectly flat. Procedural detail needs NO tiles, so the mesh must be free to subdivide past
 * the data and let a coarser tile supply the base shape at a finer stride.
 */
export function resolveLevel(n: NodeId, maxLevel: number): number {
  const ideal = Math.max(0, Math.min(n.depth - DATA_LAG, maxLevel));
  // NOTE `level >= 0`, and -1 when nothing is resident.
  //
  // The first version stopped at level > 0 and then returned 0 unconditionally, so it claimed a
  // tile was available even when level 0 had not loaded. childrenReady believed it, split anyway,
  // and the children had no data to build from: whole patches simply vanished, leaving square
  // holes in the planet.
  for (let level = ideal; level >= 0; level--) {
    const shift = n.depth - level;
    if (hasTile(n.face, level, n.x >> shift, n.y >> shift)) {
      // CLIMB ONE STEP AT A TIME, NOT STRAIGHT TO THE IDEAL. This is why the planet was flat.
      //
      // Geoff, twice: "there's no terrain... not even a terrain texture below me."
      //
      // This used to nudge the IDEAL tile only. Outside a landmark region the ideal level is 5 or
      // deeper, which does not exist and never will — so the request was for a tile that always
      // 404s, and levels 1 to 4, WHICH DO EXIST EVERYWHERE AND ARE THE ENTIRE SHAPE OF THE PLANET,
      // were never asked for at all. The walk found level 0 (the only level anything ever requested
      // explicitly), built from it, and stopped. One vertex every few hundred kilometres. A smooth
      // ball.
      //
      // Asking for the next level DOWN instead means the detail climbs 0 -> 1 -> 2 -> 3 -> 4 on
      // successive frames and stops naturally wherever the data runs out, with one probe per level
      // rather than an infinite retry of something absent.
      if (level < ideal) {
        const want = level + 1;
        const s2 = n.depth - want;
        void requestTile(n.face, want, n.x >> s2, n.y >> s2);
      }
      return level;
    }
  }
  // Nothing covers this node yet. Ask for the coarsest tile and report failure so the parent
  // keeps rendering instead of splitting into holes.
  void requestTile(n.face, 0, 0, 0);
  return -1;
}
