/**
 * check-model-feet — a creature must stand ON the ground, not inside it.
 *
 * Geoff reported the Kaiju sinking halfway or more into the terrain across several versions. The
 * cause was that a body's position is the location of its FEET while the renderer put the model's
 * ORIGIN there, which is only right if the artist placed the origin at the feet.
 *
 * The first fix was worse than the bug: it measured the bounding box in WORLD space, and by then the
 * model was parented on the planet's surface, so it returned a coordinate near 63,710 and drove the
 * creature far deeper. That regression is the third case below and it is the reason this file exists.
 *
 * Run: npm run check:model-feet
 */

import * as THREE from 'three';
import { footOffset } from '../src/components/siege/globe/modelFeet';

let failures = 0;
function ok(cond: boolean, label: string, detail = ''): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!cond) failures++;
}

console.log('\n== A creature stands on the ground, not in it ==\n');

// Origin at the centre of the body — the common case that buried the lower half.
{
  const m = new THREE.Group();
  m.add(new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1)));
  ok(Math.abs(footOffset(m) - 1) < 1e-6, 'origin at the centre lifts by half the height',
     footOffset(m).toFixed(3));
}

// Origin already at the feet — must not move it.
{
  const m = new THREE.Group();
  m.add(new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1).translate(0, 1, 0)));
  ok(Math.abs(footOffset(m)) < 1e-6, 'origin already at the feet is left alone',
     footOffset(m).toFixed(3));
}

// THE REGRESSION. Parented on the planet's surface, world-space bounds returned about -63,709.
{
  const planet = new THREE.Group();
  planet.position.set(0, 63710, 0);
  const model = new THREE.Group();
  model.add(new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1)));
  planet.add(model);
  planet.updateMatrixWorld(true);
  const lift = footOffset(model);
  ok(Math.abs(lift - 1) < 1e-6,
     'a model sitting on the planet still reports a LOCAL offset, not a planetary one',
     `${lift.toFixed(3)} — the world-space bug gave about -63709`);
}

// Transforms nested inside the model must be respected.
{
  const m = new THREE.Group();
  const child = new THREE.Group();
  child.position.set(0, 0.5, 0);
  child.add(new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1)));
  m.add(child);
  m.updateMatrixWorld(true);
  ok(Math.abs(footOffset(m) - 0.5) < 1e-6, 'offsets nested inside the model are respected',
     footOffset(m).toFixed(3));
}

// Several meshes: the lowest point of any of them is the feet.
{
  const m = new THREE.Group();
  m.add(new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1)));
  const boot = new THREE.Mesh(new THREE.BoxGeometry(1, 0.4, 1).translate(0, -1.2, 0));
  m.add(boot);
  m.updateMatrixWorld(true);
  ok(Math.abs(footOffset(m) - 1.4) < 1e-6, 'the lowest mesh of several defines the feet',
     footOffset(m).toFixed(3));
}

// Nothing to measure must change nothing.
ok(footOffset(new THREE.Group()) === 0, 'an empty model reports no lift');

console.log(`\n${failures === 0 ? 'MODEL FEET CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
