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
  meshSeparation, hasSepMesh, clearMeshSeparation, meshSepDiag,
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

console.log(`\n${failures === 0 ? 'MESH SEPARATION CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
