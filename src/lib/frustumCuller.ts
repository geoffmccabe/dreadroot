/**
 * Frustum Culler
 *
 * Module-level frustum cache for manual box-based frustum culling.
 * Three.js built-in frustum culling uses bounding spheres which fail
 * for tall, narrow structures (trees 300+ blocks tall). Box intersection
 * handles elongated shapes correctly.
 *
 * Usage:
 * - Call updateFrustum(camera) once per frame (priority 5 in frameLoop)
 * - Call isBoxInFrustum(box) per mesh to test visibility
 */

import * as THREE from 'three';

const _frustum = new THREE.Frustum();
const _projScreenMatrix = new THREE.Matrix4();
let _initialized = false;

/**
 * Update the cached frustum from the camera's current matrices.
 * Call once per frame BEFORE any visibility tests.
 */
export function updateFrustum(camera: THREE.Camera): void {
  _projScreenMatrix.multiplyMatrices(
    camera.projectionMatrix,
    camera.matrixWorldInverse
  );
  _frustum.setFromProjectionMatrix(_projScreenMatrix);
  _initialized = true;
}

/**
 * Test whether a bounding box intersects the cached frustum.
 * Returns true if not yet initialized (safe default: render everything).
 */
export function isBoxInFrustum(box: THREE.Box3): boolean {
  if (!_initialized) return true;
  return _frustum.intersectsBox(box);
}
