/**
 * check-ground-matches-mesh — the ground you STAND on must be the ground you SEE.
 *
 * Geoff, repeatedly: the Kaiju is sunk to its waist in the terrain, and the 1.8 m crowd is
 * invisible. Two earlier fixes assumed the model's origin was in the wrong place. It is not —
 * scripts/measure-glb-feet.mjs reads the .glb files and every one of them has its origin at the
 * feet, within a couple of centimetres.
 *
 * The real cause was two different answers to "how high is the ground here?":
 *
 *   the MESH   built each patch from the deepest tile resident AT BUILD TIME, capped two quadtree
 *              levels above the patch depth, with procedural detail band-limited to that patch's
 *              own vertex spacing;
 *
 *   the SAMPLER walked to the deepest tile resident NOW at ANY level, with detail band-limited to
 *              a fixed constant.
 *
 * Inside a landmark region, where real data reaches 38 m samples, the sampler ran several data
 * levels ahead of the visible mesh. This measures that gap on real Grand Canyon and Everest data,
 * and then checks the invariant that now makes it impossible: at a patch vertex, the sampler must
 * return the patch's own vertex height.
 *
 * Run: npm run check:ground-matches-mesh
 */

import {
  latLonToDirection, PLANET_RADIUS, directionToFaceUv, uvToTileIndex, tileUvRange,
  faceUvToDirection,
} from '../src/components/siege/globe/cubeSphere';
import { loadManifest, requestTile, getTile, hasTile, sampleTileBilinear } from '../src/components/siege/globe/earthTiles';
import { sampleGlobeSurface, sampleGlobeElevation, FINEST_RENDER_SPACING } from '../src/components/siege/globe/globeGround';
import { detailMetres } from '../src/components/siege/globe/globeDetail';
import {
  PATCH, DATA_LAG, dataFor, patchSpacingUnits, notePatchBuilt, clearPatchIndex, type NodeId,
} from '../src/components/siege/globe/globePatchIndex';

let failures = 0;
function ok(cond: boolean, label: string, detail = ''): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!cond) failures++;
}

/** Pull in every tile level covering a point, as a real client would while flying in. */
async function warm(lat: number, lon: number, maxLevel: number): Promise<void> {
  const d = new Float64Array(3);
  latLonToDirection(lat, lon, d);
  const { face, u, v } = directionToFaceUv(d[0], d[1], d[2]);
  for (let level = 0; level <= maxLevel; level++) {
    const cx = uvToTileIndex(u, level), cy = uvToTileIndex(v, level);
    const n = 1 << level;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= n || y >= n) continue;
        await requestTile(face, level, x, y);
      }
    }
  }
}

/** The mesh builder's own rule for which data level a patch gets built from. */
function resolveLevel(n: NodeId, maxLevel: number): number {
  const ideal = Math.max(0, Math.min(n.depth - DATA_LAG, maxLevel));
  for (let level = ideal; level >= 0; level--) {
    const shift = n.depth - level;
    if (hasTile(n.face, level, n.x >> shift, n.y >> shift)) return level;
  }
  return -1;
}

/**
 * The height buildPatchGeometry writes into vertex (ii, jj) of a patch, and the direction it
 * writes it at. Copied deliberately: if this and the shipped builder ever diverge, this check is
 * what says so.
 */
function patchVertex(n: NodeId, level: number, ii: number, jj: number) {
  const [u0, u1] = tileUvRange(n.x, n.depth);
  const [v0, v1] = tileUvRange(n.y, n.depth);
  const du = (u1 - u0) / (PATCH - 1);
  const dv = (v1 - v0) / (PATCH - 1);
  const dir = new Float64Array(3);
  faceUvToDirection(n.face, u0 + ii * du, v0 + jj * dv, dir);
  const d = dataFor(n, level, level);
  const tile = getTile(n.face, d.level, d.tx, d.ty);
  if (!tile) return null;
  const baseM = sampleTileBilinear(tile, d.ox + ii * d.stride, d.oy + jj * d.stride);
  const metres = baseM + detailMetres(dir[0], dir[1], dir[2], PLANET_RADIUS, baseM, patchSpacingUnits(n.depth));
  return { dir, metres };
}

const PLACES: [string, number, number][] = [
  ['Grand Canyon', 36.1069, -112.1129],
  ['Mount Everest', 27.9881, 86.9250],
];

/** Depths a patch under your feet realistically sits at while standing on the ground. */
const DEPTHS = [8, 10, 12];

console.log('\n== The ground you stand on IS the ground you see ==\n');

const mf = await loadManifest();
if (!mf) {
  console.log('  Could not load the tile manifest — no network? Skipping.');
  process.exit(0);
}

/** Worst disagreement seen under the OLD scheme, for the record. */
let worstOld = 0;
let worstOldWhere = '';

for (const [name, lat, lon] of PLACES) {
  console.log(`-- ${name} --`);
  await warm(lat, lon, mf.maxLevel);

  const d = new Float64Array(3);
  latLonToDirection(lat, lon, d);
  const { face, u, v } = directionToFaceUv(d[0], d[1], d[2]);

  for (const depth of DEPTHS) {
    const n: NodeId = { face, depth, x: uvToTileIndex(u, depth), y: uvToTileIndex(v, depth) };
    const level = resolveLevel(n, mf.maxLevel);
    if (level < 0) { console.log(`  depth ${depth}: no resident tile, skipped`); continue; }

    clearPatchIndex();
    notePatchBuilt(n, level);

    // Walk a diagonal of real patch vertices rather than one point, so a lucky agreement at the
    // centre cannot pass for a correct inversion.
    let worstHere = 0;
    let oldGapHere = 0;
    let samples = 0;
    for (let s = 4; s < PATCH - 4; s += 7) {
      const vert = patchVertex(n, level, s, s);
      if (!vert) continue;
      samples++;
      const [x, y, z] = vert.dir;

      // THE INVARIANT: the sampler must return the height of the vertex it is standing on.
      const got = sampleGlobeSurface(x, y, z);
      if (got == null) continue;
      worstHere = Math.max(worstHere, Math.abs(got - vert.metres));

      // ...and what the OLD scheme would have returned at the same point.
      const base = sampleGlobeElevation(x, y, z);
      if (base != null) {
        const old = base + detailMetres(x, y, z, PLANET_RADIUS, base, FINEST_RENDER_SPACING);
        oldGapHere = Math.max(oldGapHere, Math.abs(old - vert.metres));
      }
    }
    if (!samples) { console.log(`  depth ${depth}: no measurable vertices, skipped`); continue; }

    if (oldGapHere > worstOld) { worstOld = oldGapHere; worstOldWhere = `${name} depth ${depth}`; }
    console.log(
      `  depth ${depth} (data level ${level}, spacing ${patchSpacingUnits(depth).toFixed(3)} u): `
      + `sampler off by ${worstHere.toFixed(2)} m — the old scheme was off by ${oldGapHere.toFixed(1)} m`,
    );
    // A metre is well inside a footfall for a 300 m creature and far inside one for a 1.8 m
    // person; the failure being fixed was measured in hundreds.
    ok(worstHere < 1.0, `${name} depth ${depth}: feet land on the drawn surface`,
       `${worstHere.toFixed(3)} m`);
  }
  console.log('');
}

console.log(`  For the record: the worst old-scheme disagreement measured here was `
  + `${worstOld.toFixed(0)} m at ${worstOldWhere || 'nowhere'} — against a 300 m Kaiju that is `
  + `${(worstOld / 3).toFixed(0)}% of its height underground, and a 1.8 m person buried outright.\n`);

clearPatchIndex();
console.log(`${failures === 0 ? 'GROUND/MESH CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
