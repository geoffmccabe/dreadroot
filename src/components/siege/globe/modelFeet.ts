// modelFeet — where is a model's origin relative to its own feet?
//
// A body's position on this planet is the location of its FEET. The renderer puts the model's
// ORIGIN at that point, which is only correct if the artist happened to place the origin at the
// feet. Plenty of models have it at the hips, or at the centre of the bounding box — and then the
// creature is drawn with its lower half inside the terrain. That is the "sinking into the ground
// halfway or more" that survived several attempts to fix it.
//
// This lives in its own module for two reasons: it was duplicated in both avatar renderers, and it
// is exactly the sort of small geometric helper that is easy to get subtly wrong and easy to test.
//
// THE MISTAKE WORTH RECORDING. The first version used Box3.setFromObject, which measures in WORLD
// space. By the time it ran, the model was parented under a group sitting on the planet's surface,
// so it returned a y around 63,710 and the resulting "lift" was a vast negative number that drove
// the creature further into the ground than before. Local bounds have to be built from geometry.

import * as THREE from 'three';

const _box = new THREE.Box3();
const _local = new THREE.Box3();
const _m = new THREE.Matrix4();
const _rootInv = new THREE.Matrix4();

/**
 * Distance from the model's lowest point up to its origin, in the MODEL's own units.
 *
 * Add this (times whatever scale the model is drawn at) to a feet position and the model stands on
 * the ground. Returns 0 for an empty or unmeasurable model, which leaves behaviour unchanged rather
 * than moving it somewhere arbitrary.
 */
export function footOffset(model: THREE.Object3D): number {
  _box.makeEmpty();
  model.updateMatrixWorld(true);
  _rootInv.copy(model.matrixWorld).invert();

  model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const gb = mesh.geometry.boundingBox;
    if (!gb) return;
    // The mesh's transform RELATIVE TO THE MODEL ROOT — not its world transform, which carries the
    // planet-sized offset that broke the first attempt.
    _m.multiplyMatrices(_rootInv, mesh.matrixWorld);
    _local.copy(gb).applyMatrix4(_m);
    _box.union(_local);
  });

  if (!Number.isFinite(_box.min.y)) return 0;
  const offset = -_box.min.y;

  // NEVER RETURN A NEGATIVE LIFT.
  //
  // A negative value would push the creature DOWN into the terrain, which is the opposite of this
  // function's entire purpose. It can happen legitimately — a model whose geometry sits above its
  // own origin — and it is what turned "sunk to the waist" into "sunk to the shoulders". Clamping
  // at zero means a model this cannot measure correctly is left exactly where it was rather than
  // being made worse, which is the right failure mode for a correction.
  return Math.max(0, offset);
}

/** The raw measurement, unclamped, for logging so the real number is known rather than guessed. */
export function footOffsetRaw(model: THREE.Object3D): number {
  footOffset(model);
  return Number.isFinite(_box.min.y) ? -_box.min.y : 0;
}
