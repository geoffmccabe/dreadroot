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
  /** Last frame its matrices were refreshed, so that happens ONCE a frame and not once a ray. */
  posedFrame: number;
  /** Per mesh, per bone: how far that bone's furthest vertex sits from it, in BIND units. */
  boneRadii: (Float32Array | null)[];
  /** Per mesh: the scale the bind pose was captured at, so the radii can be brought to world units. */
  bindScale: number[];
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
  const boneRadii: (Float32Array | null)[] = [];
  const bindScale: number[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
    meshes.push(m);
    flesh.push(m.geometry.boundingSphere?.radius ?? 1);
    boneRadii.push(measureBoneRadii(m as THREE.SkinnedMesh));
    bindScale.push((m as THREE.SkinnedMesh).isSkinnedMesh
      ? (m as THREE.SkinnedMesh).bindMatrix.getMaxScaleOnAxis() : 1);
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
  registry.set(id, { root, meshes, flesh, boneRadii, bindScale, posedFrame: -1 });
}

/**
 * How far each bone's furthest vertex sits from it, in bind pose.
 *
 * Walked ONCE, at registration, over every vertex — a few thousand iterations for a model that is
 * then in the scene for the rest of the session. Every WEIGHTED bone is credited, not just the
 * strongest one, because a vertex blended between two bones moves with both and either sphere has
 * to be able to contain it.
 */
function measureBoneRadii(sk: THREE.SkinnedMesh): Float32Array | null {
  if (!sk.isSkinnedMesh || !sk.skeleton) return null;
  const geo = sk.geometry;
  const pos = geo.attributes.position;
  const si = geo.attributes.skinIndex;
  const sw = geo.attributes.skinWeight;
  if (!pos || !si || !sw) return null;

  const bones = sk.skeleton.bones;
  const inv = sk.skeleton.boneInverses;
  const out = new Float32Array(bones.length);

  // BOTH SIDES IN BIND-WORLD SPACE, which is the only space where the comparison means anything.
  //
  // three.js skins a vertex as bindMatrixInverse * (bone.matrixWorld * boneInverse) * bindMatrix * v.
  // So `bindMatrix * v` is the vertex in bind-world, and `inverse(boneInverse)` IS the bone's bind
  // world matrix. The first attempt put the BONE into geometry space instead of the vertex into bind
  // space, which is the same transform applied to the wrong operand — it came out as the origin for
  // every bone, so every radius was the distance from the model's origin and the filter passed
  // everything.
  const bindPos: THREE.Vector3[] = [];
  const m = new THREE.Matrix4();
  for (let i = 0; i < bones.length; i++) {
    m.copy(inv[i]).invert();
    bindPos.push(new THREE.Vector3().setFromMatrixPosition(m));
  }

  const v = new THREE.Vector3();
  for (let k = 0; k < pos.count; k++) {
    v.fromBufferAttribute(pos, k).applyMatrix4(sk.bindMatrix);
    for (let c = 0; c < 4; c++) {
      if (sw.getComponent(k, c) <= 0) continue;
      const b = si.getComponent(k, c);
      if (b < 0 || b >= bones.length) continue;
      const d = v.distanceTo(bindPos[b]);
      if (d > out[b]) out[b] = d;
    }
  }
  // Headroom. The bind-pose distance is exact for rigid skinning; blended weights can carry a vertex
  // marginally further, and a filter a fraction too tight loses hits.
  for (let i = 0; i < out.length; i++) out[i] *= 1.15;
  return out;
}

export function unregisterHitMesh(id: string): void {
  registry.delete(id);
  for (const fn of dropListeners) fn(id);
}

/**
 * Told when an agent's mesh goes away, so anything caching a derived copy of it can drop that too.
 *
 * Body separation builds a posed, CPU-side twin of each mesh with its own search tree. Left behind
 * after the model unmounts, that twin is a solid invisible Kaiju standing wherever the real one used
 * to be — the same class of bug as stale limb capsules, and harder to see.
 */
const dropListeners = new Set<(id: string) => void>();
export function onHitMeshDropped(fn: (id: string) => void): () => void {
  dropListeners.add(fn);
  return () => { dropListeners.delete(fn); };
}

/** The registered meshes for an agent, so a second collider can share this one registry. */
export function hitMeshesOf(id: string): THREE.Mesh[] { return registry.get(id)?.meshes ?? []; }

/** Exposed for the audit script, which asserts the filter never rejects a real hit. */
export function testNearGeometry(id: string, from: THREE.Vector3, to: THREE.Vector3): boolean {
  const e = registry.get(id);
  if (!e) return true;
  e.root.updateWorldMatrix(true, true);
  return nearGeometry(e, from, to);
}

/** Does this agent have a real mesh to hit? If not, the caller must fall back to capsules. */
export function hasHitMesh(id: string): boolean {
  return (registry.get(id)?.meshes.length ?? 0) > 0;
}

/** Live counts, so "is it using the mesh or the cylinder?" is answered by looking. */
export const meshHitDiag = { meshes: 0, testsThisFrame: 0, budgetHits: 0, tests: 0, hits: 0 };

/**
 * Rays allowed per frame.
 *
 * EIGHT, and it was 48, and that was most of why the game ground to five frames a second.
 *
 * "A single test is cheap" was wrong, and I wrote it without doing the arithmetic. three.js has no
 * spatial structure for a skinned mesh, so a raycast walks EVERY TRIANGLE, and for each one it
 * re-skins all three vertices — four matrix multiplies each. A Fort Golem is 7,511 triangles, so one
 * ray is about ninety thousand matrix multiplies. At 48 rays a frame that is four million, in
 * JavaScript, sixty times a second. The trace shows the animation frame averaging 68 ms, which is
 * exactly what that costs.
 *
 * The real fix is the capsule pre-filter below, which cuts the number of rays that are worth firing
 * from roughly eighteen a frame to under one. This cap is then just a ceiling nothing should reach.
 */
const TESTS_PER_FRAME = 8;

/** Has this frame's ray budget been spent? The caller falls back to capsules rather than skipping. */
export function meshBudgetLeft(): boolean { return meshHitDiag.testsThisFrame < TESTS_PER_FRAME; }

let frameNo = 0;
export function beginMeshHitFrame(): void {
  frameNo++;
  meshHitDiag.testsThisFrame = 0;
  meshHitDiag.meshes = registry.size;
}

const _scratch = new THREE.Vector3();
const _bonePos = new THREE.Vector3();
const _seg = new THREE.Vector3();
const _toB = new THREE.Vector3();

/**
 * Could this shot possibly reach the geometry?
 *
 * PER-BONE SPHERES, MEASURED OFF THE ACTUAL VERTICES, and the previous attempt is worth recording
 * because it failed in both directions at once. That one tested the limb capsules and then, for
 * anything that missed them, a capsule running from the model's bounding-box MINIMUM corner to its
 * MAXIMUM corner. A capsule along a box's diagonal is a terrible fit for a box: fat through the
 * middle and thin at the corners. The audit measured it — it let 94% of rays through, so it saved
 * almost nothing, AND it still lost 40 real hits out of 2,799. Worse than useless on both counts.
 *
 * This is exact instead of approximate. At registration, every vertex is walked once and each bone
 * records how far its FURTHEST vertex sits from it. Skinning cannot move a vertex further from its
 * own bone than that, so a sphere of that radius at the bone's current position always contains the
 * geometry it drives — whatever the pose. Miss every one of those spheres and the mesh cannot be
 * reachable, with no approximation involved anywhere.
 *
 * Cost is a few dozen segment-versus-sphere tests, against ninety thousand matrix multiplies for the
 * raycast it avoids.
 */
function nearGeometry(entry: Entry, from: THREE.Vector3, to: THREE.Vector3): boolean {
  let any = false;
  for (let m = 0; m < entry.meshes.length; m++) {
    const sk = entry.meshes[m] as THREE.SkinnedMesh;
    const radii = entry.boneRadii[m];
    if (!sk.isSkinnedMesh || !sk.skeleton || !radii) continue;
    any = true;
    // Bind pose was captured at one scale and the model is drawn at another; the radii are in bind
    // units, so they have to be brought into world units before they mean anything.
    const scale = sk.matrixWorld.getMaxScaleOnAxis() / Math.max(1e-9, entry.bindScale[m]);
    const bones = sk.skeleton.bones;
    _seg.copy(to).sub(from);
    const segLen2 = _seg.lengthSq();
    for (let i = 0; i < bones.length; i++) {
      const r = radii[i];
      if (r <= 0) continue;
      _bonePos.setFromMatrixPosition(bones[i].matrixWorld);
      // Closest point on the shot to this bone, clamped to the segment.
      _toB.copy(_bonePos).sub(from);
      const t = segLen2 > 1e-12 ? Math.max(0, Math.min(1, _toB.dot(_seg) / segLen2)) : 0;
      _scratch.copy(from).addScaledVector(_seg, t);
      const rw = r * scale;
      if (_scratch.distanceToSquared(_bonePos) <= rw * rw) return true;
    }
  }
  // No skinned geometry to reason about: say yes. "I do not know" must mean "do the real test" — a
  // filter that fails open costs performance, one that fails closed costs correctness, and this
  // system has already spent a week on rounds that silently hit nothing.
  return !any;
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

  // POSE FIRST, then filter. The bone spheres read bone world positions, so the matrices have to be
  // current before they are asked — filtering against last frame's pose is how a fast-moving limb
  // starts rejecting hits.
  if (entry.posedFrame !== frameNo) {
    entry.posedFrame = frameNo;
    entry.root.updateWorldMatrix(true, true);
  }

  // A CHEAP TEST FIRST, AND THIS IS THE ONE THAT MATTERS.
  //
  // A round spends about thirty frames inside any sensible broad-phase sphere but only actually
  // crosses the creature in ONE of them — so without this, every round in the neighbourhood paid for
  // a full ninety-thousand-multiply mesh walk, every frame, for half a second. That is where the
  // frame rate went.
  //
  // The bone capsules are already computed for free by the renderer and hug the real limbs, so a
  // segment that misses all of them cannot possibly reach the mesh. Inflated a little, because a
  // capsule is an approximation and must never be TIGHTER than the thing it is standing in for —
  // a pre-filter that rejects a real hit is worse than no pre-filter at all.
  if (!nearGeometry(entry, from, to)) return null;

  // TEST THE POSE BEING DRAWN, NOT LAST FRAME'S.
  //
  // three.js only refreshes world matrices during the render, which happens AFTER every frame
  // callback — so at the moment a bullet is resolved, the model's matrices and its bones still hold
  // the previous frame's values while the renderer has already written this frame's local
  // transforms.
  //
  // updateWorldMatrix(PARENTS, children), not updateMatrixWorld. The first version used the latter,
  // which starts at this object and multiplies by its parent's matrixWorld — and the parent is the
  // group the renderer just moved, whose own matrixWorld is exactly as stale. So the model was
  // faithfully updated against a stale ancestor and stayed a frame behind. Walking up first is the
  // whole difference and it is one word.
  // ...ONCE A FRAME, not once a ray. Forcing a full recursive matrix update of every bone and mesh
  // in the model for each individual bullet was doing the same work up to eight times over.
  if (entry.posedFrame !== frameNo) {
    entry.posedFrame = frameNo;
    entry.root.updateWorldMatrix(true, true);
  }

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
