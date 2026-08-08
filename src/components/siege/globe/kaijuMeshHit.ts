// kaijuMeshHit — REAL mesh colliders. Bullets hit the actual triangles of the actual model.
//
// Geoff: "You didn't do mesh colliders like I told you to do. Instead you made cylinders and they
// are really bad and will never work for a game like this where it's all about realism... Can you
// do mesh colliders for the kaijus or no?"
//
// Yes. I talked myself out of it on cost, and the cost turned out to be imaginary. These are the
// numbers I should have looked up before arguing:
//
//     elemental golem   3,872 triangles
//     red demon         5,472
//     mechanical golem  5,702
//     fort golem        7,511
//
// That is small. The reason mesh collision is normally avoided is per-FRAME collision — thousands
// of tests a second against a moving mesh, which is why games approximate with capsules. But a
// bullet here is not a per-frame test: it is resolved ONCE, at the instant it crosses the creature,
// and the crowd fires about thirty-six rounds a second between two hundred people. Thirty-six ray
// casts a second against eight thousand triangles is nothing.
//
// AND THREE.JS ALREADY SKINS IT. SkinnedMesh.raycast transforms every vertex by its bones before
// testing (getVertexPosition -> applyBoneTransform), so the triangles tested are the ones in the
// pose being DRAWN — an arm mid-swing is hit where the arm actually is. That is the thing capsules
// can never do, and it is free.
//
// What comes back is the exact point and the exact surface normal of the triangle struck, which is
// also what makes the ricochet correct rather than a guess: a round hitting a sloped shoulder
// deflects off that slope.
//
// This module holds no React and imports nothing but three, so the simulation keeps working
// headlessly — with no meshes registered it simply returns null and the caller falls back.

import * as THREE from 'three';

interface Entry {
  /** The model root, so its matrices can be forced up to date before a test. */
  root: THREE.Object3D;
  meshes: THREE.Mesh[];
  /**
   * How far a vertex can sit from its bone, per mesh. Bind-pose bounding radius, which is an upper
   * bound: no amount of posing moves flesh further from its own skeleton than it started.
   */
  flesh: number[];
}

const registry = new Map<string, Entry>();

/**
 * Register a model's meshes as the hit surface for an agent.
 *
 * Records how far flesh sits from bone in bind pose, which refreshSphere below needs and which is
 * an upper bound posing cannot exceed. The meshes are flattened into a list here so the hit test
 * never has to walk the hierarchy — it would otherwise pick up bones, helpers, and whatever gets
 * parented to the model later.
 */
export function registerHitMesh(id: string, root: THREE.Object3D): void {
  const meshes: THREE.Mesh[] = [];
  const flesh: number[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
    meshes.push(m);
    flesh.push(m.geometry.boundingSphere?.radius ?? 1);
    const sk = m as THREE.SkinnedMesh;
    if (sk.isSkinnedMesh) {
      // NEVER LET THREE.JS REJECT THE RAY ON ITS OWN BOUNDS.
      //
      // Geoff: "if the kaiju isn't moving then they don't hit it... they go through. But if I start
      // to move then it's as if the colliders appear."
      //
      // SkinnedMesh.raycast tests the ray against a bounding sphere BEFORE looking at a single
      // triangle, and that sphere is whatever was computed the first time anyone asked — from
      // whichever pose and whichever world transform happened to be current. Get it wrong and the
      // creature is silently unhittable, with no error and nothing to see, until something moves and
      // shakes the numbers loose. That is exactly the reported behaviour.
      //
      // The caller already does its own broad phase against the agent's position, so three's sphere
      // test buys nothing here and can only ever be a way to lose hits. It is replaced with a sphere
      // large enough to always pass, and the triangles decide.
      sk.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    }
  });
  registry.set(id, { root, meshes, flesh });
}

export function unregisterHitMesh(id: string): void { registry.delete(id); }

/** Does this agent have a real mesh to hit? If not, the caller must fall back to capsules. */
export function hasHitMesh(id: string): boolean {
  return (registry.get(id)?.meshes.length ?? 0) > 0;
}

/** Live counts, so "is it using the mesh or the cylinder?" is answered by looking. */
export const meshHitDiag = { meshes: 0, testsThisFrame: 0, budgetHits: 0, tests: 0, hits: 0 };

/**
 * Rays allowed per frame.
 *
 * A single test is cheap; a hundred at once would not be. Nothing near this is ever needed — about
 * thirty-six rounds a second are fired in total and only the ones actually crossing a creature get
 * this far — so the cap exists purely so that no future change can make this the frame budget.
 * Anything over it falls back to the capsule for that frame rather than being dropped.
 */
const TESTS_PER_FRAME = 12;

export function beginMeshHitFrame(): void {
  meshHitDiag.testsThisFrame = 0;
  meshHitDiag.meshes = registry.size;
}

const _raycaster = new THREE.Raycaster();
const _dir = new THREE.Vector3();
const _nm = new THREE.Matrix3();
const _hits: THREE.Intersection[] = [];
const _sides: THREE.Side[] = [];

/**
 * Where a shot from `from` to `to` first meets this agent's actual geometry.
 *
 * Returns the fraction along the shot, and writes the exact impact point and the world-space normal
 * of the triangle struck. Null for a miss, for an unregistered agent, or when the frame's ray budget
 * is spent — all three of which the caller treats the same way.
 */
export function meshHit(
  id: string, from: THREE.Vector3, to: THREE.Vector3,
  outPoint: THREE.Vector3, outNormal: THREE.Vector3,
): number | null {
  const entry = registry.get(id);
  if (!entry || entry.meshes.length === 0) return null;
  if (meshHitDiag.testsThisFrame >= TESTS_PER_FRAME) { meshHitDiag.budgetHits++; return null; }
  meshHitDiag.testsThisFrame++;
  meshHitDiag.tests++;

  _dir.copy(to).sub(from);
  const len = _dir.length();
  if (len < 1e-9) return null;
  _dir.divideScalar(len);

  // TEST THE POSE BEING DRAWN, NOT LAST FRAME'S.
  //
  // three.js only refreshes world matrices during the render, which happens AFTER every frame
  // callback — so at the moment a bullet is resolved, the model's matrices and its bones still hold
  // the previous frame's values while the renderer has already written this frame's local
  // transforms. Forcing the update costs a walk of a few dozen bones and makes the geometry tested
  // exactly the geometry about to be drawn.
  entry.root.updateMatrixWorld(true);

  _raycaster.set(from, _dir);
  _raycaster.near = 0;
  _raycaster.far = len;
  _hits.length = 0;

  // BOTH SIDES OF EVERY TRIANGLE.
  //
  // three.js skips back-facing triangles unless the material says otherwise, and these models are
  // converted from FBX — where inverted winding on some or all of a mesh is common and invisible,
  // because the renderer is happy to draw a surface lit from the wrong side. A ray, though, simply
  // finds nothing. Flipping to double-sided for the duration of the test removes that as a way to
  // lose hits, and it is restored immediately so nothing about the rendering changes.
  for (let i = 0; i < entry.meshes.length; i++) {
    const mat = entry.meshes[i].material as THREE.Material;
    _sides[i] = mat.side;
    mat.side = THREE.DoubleSide;
  }
  // Not recursive: the list was flattened at registration, so this walks exactly the meshes and
  // nothing else — no bones, no helpers, no chance of picking up whatever gets parented later.
  _raycaster.intersectObjects(entry.meshes, false, _hits);
  for (let i = 0; i < entry.meshes.length; i++) {
    (entry.meshes[i].material as THREE.Material).side = _sides[i];
  }
  if (_hits.length === 0) return null;
  meshHitDiag.hits++;

  // intersectObjects sorts by distance, so the first is the near surface — which is where a spark
  // belongs, and is also the face whose normal the round should bounce off.
  const h = _hits[0];
  outPoint.copy(h.point);
  if (h.face && h.object) {
    _nm.getNormalMatrix(h.object.matrixWorld);
    outNormal.copy(h.face.normal).applyMatrix3(_nm).normalize();
    // Faces can be wound either way and some of these models have inverted normals in places. The
    // normal must point back toward the shooter or the ricochet drives the round INTO the creature.
    if (outNormal.dot(_dir) > 0) outNormal.negate();
  } else {
    outNormal.copy(from).sub(to).normalize();
  }
  return h.distance / len;
}
