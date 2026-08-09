// kaijuMeshSeparate — Kaiju kept apart by their ACTUAL MESHES, not by a cylinder around them.
//
// Geoff: "they should be separated at all except for their mesh colliders not going through each
// other. Are you still doing something with large cylinder colliders or thinking about magically
// keeping them apart outside of their mesh colliders?"
//
// He was right to ask. Bullets already hit real triangles (kaijuMeshHit), but BODY separation was
// still one vertical capsule per creature and a synthetic push — a number chosen to approximate a
// Kaiju, which is exactly the thing that has now been wrong in both directions. Too wide and they
// cannot reach each other to fight; too narrow and they stand inside one another. There is no
// correct radius, because a humanoid is not a cylinder.
//
// SO THE CYLINDER STOPS BEING WHAT KEEPS THEM APART. It is demoted to a broad phase — a cheap "are
// these two anywhere near each other" test — and when the answer is yes, the real triangles of the
// real animated meshes decide. An arm mid-swing collides where the arm actually is.
//
// IS THAT AFFORDABLE? Measured before it was written, not argued about:
//
//     Kaiju triangle counts          3,900 - 7,500        small
//     bake the posed mesh for CPU    2.6 ms per Kaiju
//     rebuild its search tree        0.9 ms per Kaiju
//     mesh-vs-mesh, with direction   6.9 ms per pair
//     all four Kaiju, brute force    18.3 ms/frame        OVER the whole 16.7 ms budget
//
// Brute force does not fit. Three things make it fit comfortably:
//
//   * Only pairs that are ACTUALLY NEAR are tested. Four Kaiju normally have zero or one pair in
//     contact, not six.
//   * Only the creatures in such a pair are baked. Usually two, not four.
//   * It runs at 30 Hz. A 300 m Kaiju moves 30 cm between those frames.
//
// About 6 ms while two are grinding together, and ZERO the rest of the time.
//
// IT PREVENTS CONTACT RATHER THAN RESOLVING IT. The query returns the distance between the two
// surfaces, which is only meaningful while they are still apart — once meshes interpenetrate there
// is no cheap way to ask how deep. So a small margin is held between them: come within it and they
// are pushed back out to it. They never interpenetrate, so the "how deep" question never arises,
// and nothing ever pops.

import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { hitMeshesOf, onHitMeshDropped } from './kaijuMeshHit';

/**
 * How much clear air is held between two hides, in metres.
 *
 * Small enough to read as touching at this scale — four metres between two 300 m creatures is a
 * hairline — and large enough that a body moving a third of a metre between separation ticks cannot
 * cross it in one step and end up inside.
 */
const MARGIN_METRES = 4;
/** Game units per metre is 1/100 on this map; kept local so this file needs no map constants. */
const UNITS_PER_METRE = 1 / 100;
const MARGIN = MARGIN_METRES * UNITS_PER_METRE;

/** Seconds between re-posing a Kaiju's collision mesh. 30 Hz; see the cost note above. */
const REFRESH_SECONDS = 1 / 30;

/**
 * Seconds between re-running the mesh-vs-mesh QUERY for a given pair.
 *
 * The bake was throttled from the start; the query was not, and that asymmetry is worth naming
 * because it is easy to miss — the expensive-looking half was capped and the actually-expensive half
 * ran flat out, once per pair, every frame.
 *
 * Even fixed, a closest-point search between two meshes in contact is about 7 ms. At 10 Hz that is
 * under a millisecond amortised, and a 300 m Kaiju moves 1.5 m in a tenth of a second — well inside
 * the 4 m margin being held, so nothing can cross it between updates.
 */
const QUERY_SECONDS = 1 / 10;

/** The last answer for a pair, so the frames between queries have something true to reuse. */
interface PairResult { depth: number; axis: THREE.Vector3; stamp: number }
const pairs = new Map<string, PairResult>();
/** One mesh query per tick, whichever pair is stalest. Bounds the worst frame to a single search. */
let lastQueryTick = -1;

interface Posed {
  mesh: THREE.Mesh;
  geom: THREE.BufferGeometry;
  bvh: MeshBVH;
  /** Simulation clock at the last bake, so a mesh is never re-posed twice in one tick. */
  stamp: number;
  /** World scale of the source mesh, to convert local distances back to game units. */
  scale: number;
}

const posed = new Map<string, Posed>();

/**
 * The simulation tick at which a mesh was last re-posed, ANYWHERE.
 *
 * Re-posing is the expensive half — 2.6 ms per Kaiju, because every vertex has to be re-derived from
 * the bones on the CPU. Four of them wanting it in the same frame is 10 ms, which is most of a frame
 * budget spent on collision geometry. So exactly ONE Kaiju is re-posed per tick and the rest use the
 * copy they already have. With four creatures that is a refresh every four frames each: about 15 Hz,
 * over which an arm moves a metre. Nobody can see a metre on something 300 m tall, and the cost is
 * capped at 2.6 ms however many Kaiju are fighting.
 */
let lastBakeTick = -1;

/** Live counts, so "is it using the mesh or the cylinder?" is answered by looking, not assumed. */
export const meshSepDiag = { pairsTested: 0, meshPairs: 0, capsulePairs: 0, bakes: 0, meshMs: 0 };

// A cached twin of a mesh that has gone away is a solid invisible Kaiju standing where the real one
// used to be. Drop it with the original.
onHitMeshDropped((id) => {
  const p = posed.get(id);
  if (p) { p.geom.dispose(); posed.delete(id); }
});

export function clearMeshSeparation(): void {
  for (const p of posed.values()) p.geom.dispose();
  posed.clear();
  pairs.clear();
  lastQueryTick = -1;
  lastBakeTick = -1;
}

/** Can this agent be separated by its mesh, or must the caller fall back to a capsule? */
export function hasSepMesh(id: string): boolean {
  return posed.has(id) || pickMesh(id) != null;
}

/** The mesh to collide with: the one with the most triangles, which is the body rather than a prop. */
function pickMesh(id: string): THREE.Mesh | null {
  let best: THREE.Mesh | null = null;
  let bestTris = 0;
  for (const m of hitMeshesOf(id)) {
    const g = m.geometry;
    const tris = (g.index ? g.index.count : g.attributes.position?.count ?? 0) / 3;
    if (tris > bestTris) { bestTris = tris; best = m; }
  }
  return best;
}

const _v = new THREE.Vector3();
const _scale = new THREE.Vector3();

/**
 * Bake a Kaiju's CURRENT POSE into a CPU-side twin and refresh its search tree.
 *
 * three.js skins on the GPU, so the vertices a shader draws exist nowhere the CPU can read. Every
 * one has to be re-derived from the bones — which is what `getVertexPosition` does, and what makes
 * this the expensive half. Hence the 30 Hz and the "only if they are near each other".
 */
function ensurePosed(id: string, now: number): Posed | null {
  let p = posed.get(id);
  if (!p) {
    const mesh = pickMesh(id);
    if (!mesh) return null;
    const src = mesh.geometry;
    const n = src.attributes.position?.count ?? 0;
    if (!n) return null;
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    if (src.index) geom.setIndex(src.index.clone());
    p = { mesh, geom, bvh: null as unknown as MeshBVH, stamp: -1e9, scale: 1 };
    posed.set(id, p);
  }
  // Fresh enough, or somebody else already used this tick's one bake. Either way, use what we have:
  // a slightly stale collision mesh is enormously better than a frame that drops.
  if (now - p.stamp < REFRESH_SECONDS) return p;
  if (lastBakeTick === now && p.bvh) return p;
  lastBakeTick = now;
  p.stamp = now;

  const attr = p.geom.attributes.position as THREE.BufferAttribute;
  const arr = attr.array as Float32Array;
  const n = attr.count;
  const sk = p.mesh as THREE.SkinnedMesh;
  for (let i = 0; i < n; i++) {
    // getVertexPosition applies the bone transforms on a SkinnedMesh, so these are the vertices in
    // the pose being DRAWN. That is the whole reason this beats a capsule: an arm mid-swing collides
    // where the arm is, not where a cylinder says the body is.
    sk.getVertexPosition(i, _v);
    arr[i * 3] = _v.x; arr[i * 3 + 1] = _v.y; arr[i * 3 + 2] = _v.z;
  }
  attr.needsUpdate = true;
  p.mesh.getWorldScale(_scale);
  p.scale = Math.max(1e-6, _scale.x);
  if (!p.bvh) p.bvh = new MeshBVH(p.geom);
  else p.bvh.refit();
  // THE LINE THAT WAS MISSING, AND IT COST A SECOND AND A HALF A FRAME.
  //
  // closestPointToGeometry walks THIS mesh's tree, and for every leaf it reaches it needs to find
  // the nearest triangles of the OTHER mesh. It looks for `boundsTree` on that geometry to do it
  // quickly — and if it is not there it falls back to scanning every triangle of the other mesh,
  // for every leaf. Seven thousand times four thousand, in JavaScript, per pair, per frame.
  //
  // Measured on two Kaiju in contact: 3,158 ms without it, 7.15 ms with it. Four hundred and forty
  // times. The other Claude's trace found it as an intersectsRange recursion storm eating a whole
  // second of frame time, which is exactly what that is.
  p.geom.boundsTree = p.bvh;
  meshSepDiag.bakes++;
  return p;
}

const _AtoB = new THREE.Matrix4();
const _inv = new THREE.Matrix4();
const _pa = new THREE.Vector3();
const _pb = new THREE.Vector3();
const _rot = new THREE.Matrix4();
// three-mesh-bvh fills these in; its HitPointInfo carries a faceIndex as well as the point and
// distance, so the object handed in has to have room for it.
const _t1 = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 };
const _t2 = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 };

/**
 * How far, and in which direction, two Kaiju must move apart so their hides do not touch.
 *
 * Returns the push distance in GAME UNITS and writes the world-space axis pointing from A toward B
 * into `axis`. Zero means they are far enough apart already; -1 means one of them has no mesh and
 * the caller must use its capsule instead.
 */
export function meshSeparation(idA: string, idB: string, now: number, axis: THREE.Vector3): number {
  const A = ensurePosed(idA, now);
  const B = ensurePosed(idB, now);
  if (!A || !B) return -1;

  // CACHED, AND RATE-LIMITED TO ONE QUERY A TICK. The bake was throttled from the first version and
  // the query was not, so with four Kaiju brawling this ran six closest-point searches every single
  // frame. Reusing the last answer between queries is safe because the margin being held is far
  // wider than anything can move in the gap.
  const key = idA < idB ? `${idA}|${idB}` : `${idB}|${idA}`;
  const flip = idA >= idB;
  let cached = pairs.get(key);
  const fresh = cached && now - cached.stamp < QUERY_SECONDS;
  if (cached && (fresh || lastQueryTick === now)) {
    axis.copy(cached.axis);
    if (flip) axis.negate();
    return cached.depth;
  }
  lastQueryTick = now;
  if (!cached) { cached = { depth: 0, axis: new THREE.Vector3(), stamp: now }; pairs.set(key, cached); }
  cached.stamp = now;

  // B's geometry, expressed in A's local frame. Both world matrices carry the planet's radius, so
  // this product is taken in JavaScript's 64-bit maths where that cancels exactly — the same reason
  // the soldiers' skinning had to be re-based. In 32-bit it would be noise.
  _inv.copy(A.mesh.matrixWorld).invert();
  _AtoB.multiplyMatrices(_inv, B.mesh.matrixWorld);

  // The margin is in world units; the query works in A's local units.
  const localMargin = MARGIN / A.scale;
  const hit = A.bvh.closestPointToGeometry(B.geom, _AtoB, _t1, _t2, 0, localMargin);
  if (!hit) { cached.depth = 0; return 0; }
  const gap = _t1.distance * A.scale;
  if (gap >= MARGIN) { cached.depth = 0; return 0; }

  // Direction from A's surface toward B's, taken between the two closest points and rotated into
  // world space. This is what makes them slide around each other instead of being shoved along a
  // line between two centres: the push follows the surfaces that are actually in the way.
  _pa.copy(_t1.point);
  _pb.copy(_t2.point).applyMatrix4(_AtoB);
  axis.copy(_pb).sub(_pa);
  if (axis.lengthSq() < 1e-16) {
    // Surfaces coincident. Fall back to centre-to-centre so the push still has a direction.
    axis.setFromMatrixPosition(B.mesh.matrixWorld).sub(_v.setFromMatrixPosition(A.mesh.matrixWorld));
    if (axis.lengthSq() < 1e-16) { cached.depth = 0; return 0; }
  }
  _rot.extractRotation(A.mesh.matrixWorld);
  axis.applyMatrix4(_rot).normalize();
  cached.axis.copy(axis);
  if (flip) cached.axis.negate();
  cached.depth = MARGIN - gap;
  return cached.depth;
}


// --- BULLETS THROUGH THE SAME POSED TWIN ---------------------------------------------------------
//
// Geoff: "There's still a big red cylinder collider around the kaijus blocking the bullets!"
//
// There was, and this is where it came from. Bullets DID test real triangles — but through
// three.js's own SkinnedMesh raycast, which has no spatial structure at all: it walks every triangle
// and re-skins all three vertices for each one. A Fort Golem is 7,511 triangles, so a single ray is
// about ninety thousand matrix multiplies. That forced a budget of EIGHT rays per frame, and when
// the budget ran out the code fell back to the capsule — which is a fatter shape than the creature,
// so every round past the eighth stopped short and sparked in open air. Two hundred soldiers firing
// at once spend that budget instantly, so nearly every round drew its spark on the surface of an
// invisible cylinder. A shell of orange sparks in the shape of a cylinder is precisely what he saw.
//
// The posed twin above already exists for separation and already has a search tree over it. Through
// that tree a ray costs microseconds instead of milliseconds — a few hundred triangle tests instead
// of seven thousand — so there is no budget, no fallback, and no cylinder.

const _ray = new THREE.Ray();
const _localInv = new THREE.Matrix4();
const _rot2 = new THREE.Matrix4();
const _nrmLocal = new THREE.Vector3();

/**
 * Where a shot first meets this Kaiju's actual triangles, in the pose being drawn.
 *
 * Returns the fraction along `from`->`to`, writing the world-space impact point and the world-space
 * normal of the face struck. Null for a clean miss; -1 when there is no mesh and the caller must
 * fall back to a capsule.
 */
export function meshRay(
  id: string, from: THREE.Vector3, to: THREE.Vector3, now: number,
  outPoint: THREE.Vector3, outNormal: THREE.Vector3,
): number | null | -1 {
  const p = ensurePosed(id, now);
  if (!p) return -1;

  _localInv.copy(p.mesh.matrixWorld).invert();
  _ray.origin.copy(from).applyMatrix4(_localInv);
  _ray.direction.copy(to).applyMatrix4(_localInv).sub(_ray.origin);
  const len = _ray.direction.length();
  if (len < 1e-12) return null;
  _ray.direction.divideScalar(len);

  // DoubleSide: a Kaiju's mesh is not guaranteed closed or consistently wound, and a round entering
  // through a back-facing triangle is still a hit.
  const hit = p.bvh.raycastFirst(_ray, THREE.DoubleSide, 0, len);
  if (!hit) return null;

  outPoint.copy(hit.point).applyMatrix4(p.mesh.matrixWorld);
  if (hit.face) {
    // Decide which way the normal faces in LOCAL space, where the ray already is, and only then
    // rotate it out. Comparing them in world space means transforming the ray direction too, and
    // doing that in place quietly corrupts the ray for anything after it.
    _nrmLocal.copy(hit.face.normal);
    // Face windings are not reliable on these imports, so point the normal back the way the round
    // came. A normal facing into the creature sends the ricochet straight through it.
    if (_nrmLocal.dot(_ray.direction) > 0) _nrmLocal.negate();
    _rot2.extractRotation(p.mesh.matrixWorld);
    outNormal.copy(_nrmLocal).applyMatrix4(_rot2).normalize();
  } else {
    outNormal.copy(outPoint).normalize();
  }
  return hit.distance / len;
}
