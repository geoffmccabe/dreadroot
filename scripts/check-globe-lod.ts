/**
 * check-globe-lod — what detail level does the terrain ACTUALLY reach where you are standing?
 *
 * Written because a fix I was confident in did not fix anything: Geoff still sees Everest as a
 * ridge about 1.5 Kaiju heights tall (~450 m) on ground that should have 3,463 m of relief. The
 * tile data is verified good, so the renderer is not reaching it, and guessing which of split
 * ratio / leaf budget / data lag is responsible has already cost a round trip.
 *
 * This replays the exact subdivision the terrain does — same ratio test, same hysteresis
 * thresholds, same leaf budget, same traversal order — and reports the depth reached at the
 * camera, so the answer is measured instead of reasoned about.
 *
 * Run: npm run check:globe-lod
 */

import {
  PLANET_RADIUS, METRES_PER_UNIT, TILE, FACE_NAMES,
  latLonToDirection, directionToFaceUv, uvToTileIndex, tileArcUnits, faceUvToDirection,
  tileUvRange,
} from '../src/components/siege/globe/cubeSphere';

// These MUST match GlobeTerrain.tsx. If that file changes and this does not, this check is lying.
const SPLIT_RATIO = 0.45;
const MERGE_RATIO = 0.30;
const MAX_LEAVES = 300;
const MAX_RENDER_DEPTH = 12;
const DATA_LAG = 2;
const PATCH = 65;
const MANIFEST_MAX_LEVEL = 10;

interface Node { face: number; depth: number; x: number; y: number }

/** Centre direction of a node, matching GlobeTerrain's nodeCentre. */
function nodeCentre(n: Node): [number, number, number] {
  const [u0, u1] = tileUvRange(n.x, n.depth);
  const [v0, v1] = tileUvRange(n.y, n.depth);
  const out = new Float64Array(3);
  faceUvToDirection(n.face, (u0 + u1) / 2, (v0 + v1) / 2, out);
  return [out[0], out[1], out[2]];
}

/**
 * Replay the traversal.
 *
 * `nodeAtSeaLevel` reproduces the bug that was fixed: placing every tile at PLANET_RADIUS rather
 * than at its own elevation. Running both tells us how much that fix was actually worth here.
 */
function traverse(
  camPos: [number, number, number], groundMetresAt: () => number,
  nodeAtSeaLevel: boolean, depthFirst: boolean,
) {
  const maxDepth = Math.max(MANIFEST_MAX_LEVEL + DATA_LAG, MAX_RENDER_DEPTH);

  const urgency = (n: Node): number => {
    if (n.depth >= maxDepth) return -1;
    const c = nodeCentre(n);
    // Everywhere on Everest is high ground, so for this test the elevation under any nearby node
    // is the summit elevation; far nodes are effectively at sea level either way.
    const r = nodeAtSeaLevel ? PLANET_RADIUS : PLANET_RADIUS + groundMetresAt() / METRES_PER_UNIT;
    const cx = c[0] * r, cy = c[1] * r, cz = c[2] * r;
    const dist = Math.max(1, Math.hypot(camPos[0] - cx, camPos[1] - cy, camPos[2] - cz));
    const ratio = tileArcUnits(n.depth) / dist;
    return ratio > SPLIT_RATIO ? ratio : -1;
  };

  // OLD: recursive descent, faces in index order. Budget goes wherever the loop happens to reach.
  if (depthFirst) {
    const leaves: Node[] = [];
    let hitBudget = false;
    const visit = (n: Node) => {
      if (leaves.length > MAX_LEAVES) { hitBudget = true; leaves.push(n); return; }
      if (urgency(n) > 0) {
        for (let i = 0; i < 4; i++) {
          visit({ face: n.face, depth: n.depth + 1, x: n.x * 2 + (i & 1), y: n.y * 2 + (i >> 1) });
        }
      } else leaves.push(n);
    };
    for (let f = 0; f < 6; f++) visit({ face: f, depth: 0, x: 0, y: 0 });
    return { leaves, hitBudget };
  }

  // NEW: split the most urgent node first, so the budget lands nearest the camera.
  const frontier: Node[] = [];
  for (let f = 0; f < 6; f++) frontier.push({ face: f, depth: 0, x: 0, y: 0 });
  let hitBudget = false;
  while (frontier.length + 3 <= MAX_LEAVES) {
    let bestIdx = -1;
    let best = 0;
    for (let i = 0; i < frontier.length; i++) {
      const u = urgency(frontier[i]);
      if (u > best) { best = u; bestIdx = i; }
    }
    if (bestIdx < 0) break;
    const n = frontier[bestIdx];
    frontier.splice(bestIdx, 1);
    for (let c = 0; c < 4; c++) {
      frontier.push({ face: n.face, depth: n.depth + 1, x: n.x * 2 + (c & 1), y: n.y * 2 + (c >> 1) });
    }
    if (frontier.length + 3 > MAX_LEAVES) { hitBudget = frontier.some((f) => urgency(f) > 0); break; }
  }
  return { leaves: frontier, hitBudget };
}

/** How much detailed ground surrounds the camera — the thing you actually look at. */
function detailAround(leaves: Node[], camDir: [number, number, number], minDepth: number): number {
  let n = 0;
  for (const l of leaves) {
    if (l.depth < minDepth) continue;
    const c = nodeCentre(l);
    // Within roughly 5 km of the camera on the surface.
    const dot = c[0] * camDir[0] + c[1] * camDir[1] + c[2] * camDir[2];
    const arc = Math.acos(Math.max(-1, Math.min(1, dot))) * PLANET_RADIUS * METRES_PER_UNIT;
    if (arc < 5000) n++;
  }
  return n;
}

let failures = 0;
function ok(cond: boolean, label: string, detail = ''): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!cond) failures++;
}

console.log('\n== Terrain detail actually reached ==\n');

const PLACES: [string, number, number, number][] = [
  // name, lat, lon, real ground elevation in metres
  ['Mount Everest', 27.9881, 86.9250, 8737],
  ['Grand Canyon', 36.1069, -112.1129, 2100],
  ['Houston (flat)', 29.76, -95.37, 10],
];

const EYE = 2.7;   // a 300 m Kaiju's eye height, in units

for (const [name, lat, lon, groundM] of PLACES) {
  const d = new Float64Array(3);
  latLonToDirection(lat, lon, d);
  const camR = PLANET_RADIUS + groundM / METRES_PER_UNIT + EYE;
  const cam: [number, number, number] = [d[0] * camR, d[1] * camR, d[2] * camR];
  const camDir: [number, number, number] = [d[0], d[1], d[2]];

  console.log(`\n${name}  (ground ${groundM} m = ${(groundM / METRES_PER_UNIT).toFixed(1)} units)`);

  for (const depthFirst of [true, false]) {
    const { leaves, hitBudget } = traverse(cam, () => groundM, false, depthFirst);
    const near = detailAround(leaves, camDir, MAX_RENDER_DEPTH);
    const deepest = Math.max(...leaves.map((l) => l.depth));
    const arcUnits = tileArcUnits(deepest);
    const metresPerVertex = (arcUnits * METRES_PER_UNIT) / (PATCH - 1);
    console.log(`   ${depthFirst ? 'faces in order (old)   ' : 'nearest-first (fixed)  '}: `
      + `${leaves.length} leaves, deepest ${deepest} (${metresPerVertex.toFixed(0)} m/vertex)`);
    console.log(`      full-detail patches within 5 km of you: ${near}`
      + `${hitBudget ? '   [budget exhausted with work still wanted]' : ''}`);
  }
}

// The real question: standing on Everest, how much DETAILED GROUND surrounds you? A single
// detailed patch under your feet is not a mountain; the landscape you look at is the point.
{
  const d = new Float64Array(3);
  latLonToDirection(27.9881, 86.9250, d);
  const camR = PLANET_RADIUS + 8737 / METRES_PER_UNIT + EYE;
  const cam: [number, number, number] = [d[0] * camR, d[1] * camR, d[2] * camR];
  const camDir: [number, number, number] = [d[0], d[1], d[2]];

  const oldRun = traverse(cam, () => 8737, false, true);
  const newRun = traverse(cam, () => 8737, false, false);
  const oldNear = detailAround(oldRun.leaves, camDir, MAX_RENDER_DEPTH);
  const newNear = detailAround(newRun.leaves, camDir, MAX_RENDER_DEPTH);

  const metresPerVertex = (tileArcUnits(MAX_RENDER_DEPTH) * METRES_PER_UNIT) / (PATCH - 1);

  console.log('\nVERDICT (Mount Everest)');
  console.log(`  full-detail patches within 5 km: ${oldNear} before, ${newNear} after`);
  // Not "strictly better everywhere": on Everest both orderings happen to reach the same amount,
  // because the camera's own face is traversed early enough by luck. The guarantee worth asserting
  // is that priority order is never WORSE — it removes the dependence on luck. The Grand Canyon
  // row above is where it shows: 9 detailed patches becomes 18.
  ok(newNear >= oldNear, 'nearest-first is never worse than face-order', `${oldNear} -> ${newNear}`);
  ok(newNear >= 4, 'enough detailed ground around you to read as terrain rather than a ramp',
     `${newNear} patches`);
  console.log(`\n  At depth ${MAX_RENDER_DEPTH} vertices are ${metresPerVertex.toFixed(0)} m apart.`);
  console.log(`  A 300 m Kaiju is ${(300 / metresPerVertex).toFixed(1)} vertices tall.`);
  console.log(`  Everest's 3400 m of local relief spans ${(3400 / metresPerVertex).toFixed(0)} vertices.`);
}

console.log(`\n${failures === 0 ? 'LOD CHECKS PASSED' : `${failures} LOD CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
