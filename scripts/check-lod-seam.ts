/**
 * check-lod-seam — how badly do two neighbouring patches at different detail levels disagree?
 *
 * Geoff: "I land on a relatively flat and featureless area. Close by is a nicely textured area, and
 * the two areas don't line up well. I think it may be the intersection of two sectors on the map,
 * one with more detail and one with less."
 *
 * He read it exactly right. It is not a data boundary — the fine Grand Canyon data extends more
 * than 40 km in every direction from both the old and the new drop point. It is the RENDER quadtree:
 * a patch at depth 12 carries procedural octaves that a neighbouring depth-10 patch does not, and
 * an octave used to be either fully present or entirely absent. Crossing that line, a whole octave
 * appeared at once.
 *
 * This measures the disagreement directly: the same ground, evaluated at the vertex spacings of two
 * neighbouring quadtree depths, and the worst height difference between them.
 *
 * A RECORDED DEAD END. I tried to fix it by fading each octave in across the band limit instead of
 * switching it on. That does nothing: neighbouring depths differ by exactly a factor of two, which
 * is exactly one octave, so the ramp only moves where within the level the change happens. Widening
 * the fade to three octaves made it WORSE — 18.2 m to 23.2 m — because a wider band reaches up into
 * coarser octaves that carry far more amplitude, and the extra amplitude beats the finer division.
 * Both attempts were reverted.
 *
 * The seam is inherent to two patches having different vertex densities, and removing it needs
 * GEOMORPHING: blending each vertex between its own level and its parent's over the transition, in
 * the mesh builder. That is a real piece of work, not a constant to retune. Until then this file
 * exists to keep the number honest and to stop the next person re-running the same experiment.
 *
 * Run: npm run check:lod-seam
 */

import { detailMetres } from '../src/components/siege/globe/globeDetail';
import { PLANET_RADIUS, latLonToDirection } from '../src/components/siege/globe/cubeSphere';

let failures = 0;
function ok(cond: boolean, label: string, detail = ''): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!cond) failures++;
}

/** Patch vertex spacing at a quadtree depth, matching globePatchIndex.patchSpacingUnits. */
const spacingAt = (depth: number): number => (PLANET_RADIUS * Math.PI * 0.5) / Math.pow(2, depth) / 64;

/** Worst height difference between two spacings over a patch of ground, in metres. */
function seam(lat: number, lon: number, depthA: number, depthB: number): number {
  const sa = spacingAt(depthA), sb = spacingAt(depthB);
  const d = new Float64Array(3);
  let worst = 0;
  const N = 60;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      // A few kilometres of ground, which is what a patch boundary spans.
      const la = lat + (j / N - 0.5) * 0.03;
      const lo = lon + (i / N - 0.5) * 0.03;
      latLonToDirection(la, lo, d);
      // Ruggedness gate uses the measured base elevation; the canyon rim is about 2,150 m.
      const base = 2150;
      const a = detailMetres(d[0], d[1], d[2], PLANET_RADIUS, base, sa);
      const b = detailMetres(d[0], d[1], d[2], PLANET_RADIUS, base, sb);
      worst = Math.max(worst, Math.abs(a - b));
    }
  }
  return worst;
}

console.log('\n== How far apart do neighbouring detail levels draw the same ground? ==\n');
console.log('  Grand Canyon rim, 36.06 / -112.11\n');
console.log('  depths      vertex spacing         worst disagreement');
console.log('  ' + '-'.repeat(58));

let worstAdjacent = 0;
for (const [a, b] of [[11, 12], [10, 11], [9, 10], [10, 12]] as [number, number][]) {
  const m = seam(36.0616, -112.1076, a, b);
  console.log(`  ${a} vs ${b}     ${spacingAt(a).toFixed(2)} u vs ${spacingAt(b).toFixed(2)} u        `
    + `${m.toFixed(1).padStart(6)} m`);
  if (Math.abs(a - b) === 1) worstAdjacent = Math.max(worstAdjacent, m);
}

console.log('');
// REPORTED, NOT ASSERTED. There is no threshold this currently meets, and inventing a loose one
// so the suite goes green would hide the fact that the seam is unfixed. What IS asserted is that it
// does not get worse: 20 m is where it sits today with a hard band limit.
console.log(`  worst adjacent-level disagreement: ${worstAdjacent.toFixed(1)} m`);
ok(worstAdjacent < 22, 'the LOD seam has not grown worse than it is today',
   `${worstAdjacent.toFixed(1)} m — geomorphing is the real fix, see the header`);

// And the fade must not have flattened the terrain: the detail still has to be there.
{
  const d = new Float64Array(3);
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < 400; i++) {
    latLonToDirection(36.0616 + (i / 400 - 0.5) * 0.05, -112.1076, d);
    const v = detailMetres(d[0], d[1], d[2], PLANET_RADIUS, 2150, spacingAt(12));
    lo = Math.min(lo, v); hi = Math.max(hi, v);
  }
  console.log(`  procedural relief at full detail: ${(hi - lo).toFixed(0)} m`);
  // The procedural layer must actually be producing relief at creature scale. This transect is a
  // few kilometres, so it sees the finer octaves rather than the whole 490 m amplitude budget.
  ok(hi - lo > 40, 'procedural detail is present at creature scale', `${(hi - lo).toFixed(0)} m`);
}

console.log(`\n${failures === 0 ? 'LOD SEAM CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
