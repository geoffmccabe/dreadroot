/**
 * check-mesh-separate — the thing keeping two Kaiju apart must be their MESHES, not a cylinder.
 *
 * Geoff: "they should be separated at all except for their mesh colliders not going through each
 * other. Are you still doing something with large cylinder colliders?"
 *
 * So this asserts the two claims that matter: that a real mesh test is what runs when the models are
 * there, and that it correctly falls back to a capsule when they are not — because the simulation
 * must keep working headless, where there is no art at all.
 *
 * Run: npm run check:mesh-separate
 */

import * as THREE from 'three';
import { registerHitMesh, unregisterHitMesh } from '../src/components/siege/globe/kaijuMeshHit';
import {
  meshSeparation, hasSepMesh, clearMeshSeparation, meshSepDiag, meshRay,
} from '../src/components/siege/globe/kaijuMeshSeparate';
import { PLANET_RADIUS, METRES_PER_UNIT } from '../src/components/siege/globe/cubeSphere';

let failures = 0;
function ok(cond: boolean, label: string, detail = ''): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!cond) failures++;
}

/** A body-sized box, standing on the planet's surface — the real distances from the world origin. */
function makeBody(id: string, alongX: number): THREE.Mesh {
  const g = new THREE.BoxGeometry(1, 3, 1);          // 100 m x 300 m x 100 m in game units
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial());
  const root = new THREE.Group();
  root.add(m);
  root.position.set(alongX, PLANET_RADIUS, 0);
  root.updateMatrixWorld(true);
  registerHitMesh(id, root);
  return m;
}

console.log('\n== Kaiju are kept apart by their meshes ==\n');

// --- 1. NO MESH, NO MESH TEST --------------------------------------------------------------------
// Headless there is no art, and the fight still has to work. -1 is the signal to use a capsule.
{
  clearMeshSeparation();
  const axis = new THREE.Vector3();
  ok(!hasSepMesh('nobody'), 'an agent with no model has no mesh collider');
  ok(meshSeparation('nobody', 'nobodyelse', 0, axis) === -1,
     'and asks the caller to fall back to a capsule rather than silently doing nothing');
}

// --- 2. WITH MESHES, THE MESHES DECIDE ------------------------------------------------------------
{
  clearMeshSeparation();
  const axis = new THREE.Vector3();
  const far = 4;      // 400 m apart, well clear of two 100 m-wide bodies
  makeBody('a', 0);
  const bRoot = makeBody('b', far);

  ok(hasSepMesh('a') && hasSepMesh('b'), 'both agents now have a real mesh collider');

  const apart = meshSeparation('a', 'b', 0, axis);
  ok(apart === 0, 'two Kaiju standing well apart need no push', `${apart}`);

  // Walk B in until the two boxes are nearly touching. Boxes are 1 unit wide, so surfaces meet at 1.
  const bParent = bRoot.parent!;
  const step = (x: number, t: number) => {
    bParent.position.set(x, PLANET_RADIUS, 0);
    bParent.updateMatrixWorld(true);
    return meshSeparation('a', 'b', t, axis);
  };

  const touching = step(1.02, 1);
  ok(touching > 0, 'brought within the margin, the mesh test asks for a push', `${(touching * METRES_PER_UNIT).toFixed(1)} m`);
  // The push must point from A toward B along the axis they actually approached on.
  ok(axis.x > 0.9, 'and it points from A toward B', `axis.x = ${axis.x.toFixed(3)}`);

  // Closer still must ask for MORE push, or the response has no relationship to the overlap.
  const closer = step(1.0, 2);
  ok(closer > touching, 'closer asks for more', `${(touching * METRES_PER_UNIT).toFixed(1)} m -> ${(closer * METRES_PER_UNIT).toFixed(1)} m`);

  // ...and the push never exceeds the margin it is holding, or two Kaiju would fling apart.
  ok(closer <= 4 / METRES_PER_UNIT + 1e-9, 'and never more than the margin it holds',
     `${(closer * METRES_PER_UNIT).toFixed(2)} m vs 4 m margin`);
}

// --- 3. IT IS THROTTLED ---------------------------------------------------------------------------
// Re-posing a mesh is the expensive half — 2.6 ms per Kaiju. At 60 Hz for four Kaiju that alone
// would eat two thirds of a frame, so it must run at 30 Hz and this is what proves it does.
{
  const axis = new THREE.Vector3();
  const before = meshSepDiag.bakes;
  for (let i = 0; i < 60; i++) meshSeparation('a', 'b', 10 + i / 600, axis);   // 60 calls in 0.1 s
  const bakes = meshSepDiag.bakes - before;
  // 0.1 s at 30 Hz is 3 refreshes per Kaiju, so 6 for the pair. Anything near 120 means no throttle.
  ok(bakes <= 10, 'sixty calls in a tenth of a second re-pose the meshes only a handful of times',
     `${bakes} bakes, not 120`);
}

// --- 4. A DROPPED MODEL DROPS ITS COLLIDER --------------------------------------------------------
// A cached posed twin left behind after a model unmounts is a solid invisible Kaiju standing where
// the real one used to be.
{
  const axis = new THREE.Vector3();
  unregisterHitMesh('b');
  ok(!hasSepMesh('b'), 'unregistering a model removes its mesh collider too');
  ok(meshSeparation('a', 'b', 20, axis) === -1, 'and the pair falls back to capsules');
}

// --- 5. BULLETS GO THROUGH THE MESH, NEVER A CAPSULE ----------------------------------------------
// THE REGRESSION THIS EXISTS FOR. Bullets did test real triangles, but through three.js's own
// skinned raycast, which walks every triangle — so it needed a budget of eight rays a frame, and
// WHEN THE BUDGET RAN OUT IT FELL BACK TO A CAPSULE. Two hundred soldiers spend eight rays instantly,
// so nearly every round stopped short on a shape fatter than the creature and sparked in open air.
// Geoff: "There's still a big red cylinder collider around the kaijus blocking the bullets!" That is
// what a shell of sparks in the shape of a cylinder looks like.
{
  clearMeshSeparation();
  makeBody('shooter-target', 0);
  const pt = new THREE.Vector3();
  const nrm = new THREE.Vector3();

  // Straight through the middle. The box is 1 unit wide, so the near face is at x = -0.5.
  const from = new THREE.Vector3(-3, PLANET_RADIUS, 0);
  const to = new THREE.Vector3(3, PLANET_RADIUS, 0);
  const t = meshRay('shooter-target', from, to, 100, pt, nrm);
  ok(t !== -1 && t != null, 'a round through the body hits the mesh');
  ok(Math.abs(pt.x + 0.5) < 0.05, 'and lands on the SURFACE, not out in the air short of it',
     `x = ${pt.x.toFixed(3)}, surface is at -0.500`);
  ok(nrm.x < -0.5, 'with the face normal pointing back at the shooter',
     `normal.x = ${nrm.x.toFixed(2)}`);

  // A round that passes well clear must MISS — not be caught by any approximate shape.
  const miss = meshRay('shooter-target',
    new THREE.Vector3(-3, PLANET_RADIUS, 4), new THREE.Vector3(3, PLANET_RADIUS, 4), 101, pt, nrm);
  ok(miss === null, 'a round passing 400 m to one side misses cleanly, with nothing to stop it');

  // NO BUDGET. Two hundred rounds in one frame must all get a real answer; the moment any of them
  // is answered by something other than the mesh, the cylinder is back.
  let mesh = 0;
  for (let i = 0; i < 200; i++) {
    if (meshRay('shooter-target', from, to, 102, pt, nrm) !== -1) mesh++;
  }
  ok(mesh === 200, 'two hundred rounds in a single frame ALL go through the mesh',
     `${mesh}/200 — any shortfall is the capsule coming back`);
}

// --- 6. THE QUERY MUST NOT DEGENERATE ------------------------------------------------------------
// THE REGRESSION THIS EXISTS FOR, and it cost Geoff a one-second freeze every time two Kaiju met.
//
// closestPointToGeometry walks one mesh's tree and, for every leaf, needs the nearest triangles of
// the OTHER mesh. It looks for `boundsTree` on that geometry to do it quickly; without it, it scans
// EVERY triangle of the other mesh for EVERY leaf. Measured on two real Kaiju in contact: 3,158 ms
// without, 7.15 ms with. Four hundred and forty times.
//
// This is a TIMING assertion rather than a check that some field is set, because the field is an
// implementation detail of a library and the frame budget is not.
{
  clearMeshSeparation();
  // Something with a real triangle count — twelve-triangle boxes are far too small to show it.
  const dense = (id: string, x: number) => {
    const g = new THREE.SphereGeometry(1.5, 48, 32);   // ~3,000 triangles, Kaiju-sized
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial());
    const root = new THREE.Group();
    root.add(m);
    root.position.set(x, PLANET_RADIUS, 0);
    root.updateMatrixWorld(true);
    registerHitMesh(id, root);
  };
  dense('dense-a', 0);
  dense('dense-b', 2.98);        // overlapping: the worst case for pruning, and the real one

  const axis = new THREE.Vector3();
  const t0 = Date.now();
  meshSeparation('dense-a', 'dense-b', 200, axis);
  const ms = Date.now() - t0;
  ok(ms < 120, 'a mesh query between two touching Kaiju completes in a sane time',
     `${ms} ms — without the other geometry's search tree this is thousands`);

  // ...and only ONE query may run per tick, however many pairs are asking.
  const before = Date.now();
  for (let i = 0; i < 20; i++) meshSeparation('dense-a', 'dense-b', 201, axis);
  ok(Date.now() - before < 200,
     'twenty pairs asking in the same tick share one query between them',
     `${Date.now() - before} ms for 20 calls`);
}

// --- 7. ONE PUSH PER MEASUREMENT ------------------------------------------------------------------
// THE REGRESSION THIS EXISTS FOR. A separation depth is a CORRECTION — "you are 3 m too close, move
// 3 m" — not a force to be applied continuously. The arena reads it three times a frame across the
// relaxation passes, and the cache holds an answer for fifteen frames, so returning the same depth
// on every read applied ONE measured overlap about forty-five times. Geoff: "The Red Demon Kaiju is
// skating and sliding around... he seems to bounce back and forth."
{
  clearMeshSeparation();
  const axis = new THREE.Vector3();
  makeBody('push-a', 0);
  makeBody('push-b', 1.02);          // inside the margin

  const first = meshSeparation('push-a', 'push-b', 300, axis);
  ok(first > 0, 'the first read of a fresh measurement asks for a push', `${first.toFixed(4)}`);

  // Every read after it, in the same frame and in the frames before the next query, must ask for
  // NOTHING. The bodies have not been re-measured, so there is no new correction to make.
  let extra = 0;
  for (let i = 0; i < 3; i++) extra += meshSeparation('push-a', 'push-b', 300, axis);   // same tick
  for (let f = 1; f < 6; f++) {
    for (let i = 0; i < 3; i++) extra += meshSeparation('push-a', 'push-b', 300 + f / 60, axis);
  }
  ok(extra === 0, 'and every re-read of it asks for nothing at all',
     `${extra.toFixed(4)} of extra push over 18 further reads — anything above zero is the skating`);

  // ...but once it is genuinely re-measured, it asks again.
  const later = meshSeparation('push-a', 'push-b', 300 + 0.5, axis);
  ok(later > 0, 'a fresh measurement later does ask again', `${later.toFixed(4)}`);
}

console.log(`\n${failures === 0 ? 'MESH SEPARATION CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
