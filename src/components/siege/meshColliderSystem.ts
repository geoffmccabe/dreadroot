// meshColliderSystem — true triangle-accurate collision for selected models
// (rocks, mountains). World-agnostic and GATED: inert unless a world opts in, so
// DreadRoot/Pinkland pay nothing.
//
// glTF rocks are far denser than they look (thousands of tris), so each model's
// collision geometry is DECIMATED (meshoptimizer) to a per-model keep-ratio, then
// a BVH is built from the simplified mesh. The < / > tool tunes the ratio live.
//
// BVH is stored per geometry KEY (uuid); instances reference the key, so
// re-decimating a model rebuilds its BVH and every instance + the debug overlay
// pick it up immediately. Mesh instances are tracked per streaming group so they
// clean up when a group streams out. Player collision: capsule push for walls;
// meshGroundHeight() feeds the existing ground system for standing on tops.

import * as THREE from 'three';
import { MeshBVH, type ExtendedTriangle } from 'three-mesh-bvh';
import { MeshoptSimplifier } from 'meshoptimizer';

export interface MeshInstanceInput {
  key: string;            // geometry uuid (BVH key)
  matrix: THREE.Matrix4;  // final model→world matrix (same as the rendered instance)
  geoBox: THREE.Box3;     // geometry-local bounding box
}

interface InstanceEntry {
  key: string;
  matrix: THREE.Matrix4;
  inverse: THREE.Matrix4;
  scale: number;
  aabb: THREE.Box3;
}

const bvhByKey = new Map<string, MeshBVH>();
const geoByKey = new Map<string, { original: THREE.BufferGeometry; ratio: number }>();
const fbxKeys = new Map<string, Set<string>>();
const groups = new Map<string, InstanceEntry[]>();
let enabled = false;
let probeCeilingY = -Infinity;

// meshoptimizer wasm loads async — gate decimation until ready (full mesh meanwhile).
let simplifierReady = false;
MeshoptSimplifier.ready.then(() => { simplifierReady = true; }).catch(() => {});

// Scratch — never allocate in the per-frame resolve.
const _segA = new THREE.Vector3();
const _seg = new THREE.Line3();
const _lbox = new THREE.Box3();
const _triPt = new THREE.Vector3();
const _capPt = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _delta = new THREE.Vector3();
const _m3 = new THREE.Matrix3();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scl = new THREE.Vector3();
const _playerAabb = new THREE.Box3();
const _ray = new THREE.Ray();
const _hitPt = new THREE.Vector3();

export function setMeshCollidersEnabled(on: boolean): void { enabled = on; }
export function meshCollidersEnabled(): boolean { return enabled; }
export function setPlayerProbeY(y: number): void { probeCeilingY = y; }

function triCount(geo: THREE.BufferGeometry): number {
  return (geo.index ? geo.index.count : geo.getAttribute('position').count) / 3;
}

/** Decimate to keep `ratio` of the triangles (1 = full). Falls back to the
 *  original geometry if the simplifier isn't ready or the data isn't decimatable. */
function decimate(geometry: THREE.BufferGeometry, ratio: number): THREE.BufferGeometry {
  if (ratio >= 0.999) return geometry;
  const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (!posAttr || (posAttr as unknown as { isInterleavedBufferAttribute?: boolean }).isInterleavedBufferAttribute || posAttr.itemSize !== 3) return geometry;
  if (!simplifierReady) return geometry;
  try {
    const vcount = posAttr.count;
    const positions = posAttr.array instanceof Float32Array ? posAttr.array : new Float32Array(posAttr.array as ArrayLike<number>);
    let index: Uint32Array;
    if (geometry.index) {
      index = geometry.index.array instanceof Uint32Array ? (geometry.index.array as Uint32Array) : new Uint32Array(geometry.index.array as ArrayLike<number>);
    } else {
      index = new Uint32Array(vcount);
      for (let i = 0; i < vcount; i++) index[i] = i;
    }
    const target = Math.max(3, Math.floor((index.length * ratio) / 3) * 3);
    if (target >= index.length) return geometry;
    const result = MeshoptSimplifier.simplify(index, positions, 3, target, 1.0);
    const newIndex = result && result[0];
    if (!newIndex || newIndex.length < 3) return geometry;
    // Own copies (don't share buffers with the rendered geometry) + valid bounds,
    // so a bad/degenerate decimation can never corrupt rendering or the BVH.
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(newIndex), 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  } catch { return geometry; }
}

/** Total live triangle count for a model's BVH (for the readout). */
export function meshModelTriCount(fbx: string): number {
  const ks = fbxKeys.get(fbx);
  if (!ks) return 0;
  let t = 0;
  for (const key of ks) { const b = bvhByKey.get(key); if (b) t += triCount(b.geometry); }
  return Math.round(t);
}

/** How many placed instances of this model currently have a live collider
 *  (0 = registered geometry but no instances => nothing to render/collide). */
export function meshModelInstanceCount(fbx: string): number {
  const ks = fbxKeys.get(fbx);
  if (!ks) return 0;
  let c = 0;
  for (const list of groups.values()) for (let i = 0; i < list.length; i++) if (ks.has(list[i].key)) c++;
  return c;
}

function buildBVH(key: string, ratio: number): void {
  const entry = geoByKey.get(key);
  if (!entry) return;
  try {
    bvhByKey.set(key, new MeshBVH(decimate(entry.original, ratio)));
    entry.ratio = ratio;
  } catch { /* skip — instance falls back to no mesh collider */ }
}

/** Register a model's geometry (idempotent per key) and build its decimated BVH. */
export function registerMeshGeometry(fbx: string, key: string, geometry: THREE.BufferGeometry, ratio = 1): void {
  if (!geoByKey.has(key)) geoByKey.set(key, { original: geometry, ratio: -1 });
  let ks = fbxKeys.get(fbx);
  if (!ks) { ks = new Set(); fbxKeys.set(fbx, ks); }
  ks.add(key);
  if (geoByKey.get(key)!.ratio !== ratio || !bvhByKey.has(key)) buildBVH(key, ratio);
}

/** Re-decimate all geometries of a model to a new keep-ratio (live < / > tuning).
 *  Returns the resulting total triangle count. */
export function setModelDecimation(fbx: string, ratio: number): number {
  const ks = fbxKeys.get(fbx);
  if (!ks) return 0;
  let tris = 0;
  for (const key of ks) {
    buildBVH(key, ratio);
    const bvh = bvhByKey.get(key);
    if (bvh) tris += triCount(bvh.geometry);
  }
  return Math.round(tris);
}

export function setGroupInstances(groupId: string, list: MeshInstanceInput[]): void {
  const entries: InstanceEntry[] = [];
  for (const it of list) {
    if (!geoByKey.has(it.key)) continue;
    it.matrix.decompose(_pos, _quat, _scl);
    const scale = (Math.abs(_scl.x) + Math.abs(_scl.y) + Math.abs(_scl.z)) / 3 || 1;
    entries.push({
      key: it.key,
      matrix: it.matrix.clone(),
      inverse: it.matrix.clone().invert(),
      scale,
      aabb: it.geoBox.clone().applyMatrix4(it.matrix),
    });
  }
  if (entries.length) groups.set(groupId, entries);
  else groups.delete(groupId);
}

export function clearGroup(groupId: string): void { groups.delete(groupId); }

export function clearMeshColliders(): void {
  bvhByKey.clear();
  geoByKey.clear();
  fbxKeys.clear();
  groups.clear();
}

export function forEachMeshInstance(cb: (geometry: THREE.BufferGeometry, matrix: THREE.Matrix4) => void): void {
  for (const list of groups.values()) {
    for (let i = 0; i < list.length; i++) {
      const bvh = bvhByKey.get(list[i].key);
      if (bvh) cb(bvh.geometry, list[i].matrix);
    }
  }
}

/** World AABB of each mesh-collider instance — for a reliable box-wireframe debug
 *  (same method as the green box overlay, just blue). */
export function forEachMeshInstanceBox(cb: (aabb: THREE.Box3) => void): void {
  for (const list of groups.values()) {
    for (let i = 0; i < list.length; i++) cb(list[i].aabb);
  }
}

/** Highest mesh-collider surface at (x,z), or null — feeds the ground system so
 *  the player stands ON mountains with correct gravity/jump (same path as terrain). */
export function meshGroundHeight(x: number, z: number, ceilingY?: number): number | null {
  if (!enabled || groups.size === 0) return null;
  // Ray from `ceilingY` (the querier's step-reach) downward — defaults to the
  // player's probe so existing player calls are unchanged; monsters pass their own.
  const ceil = ceilingY ?? probeCeilingY;
  let best: number | null = null;
  for (const list of groups.values()) {
    for (let i = 0; i < list.length; i++) {
      const inst = list[i];
      if (x < inst.aabb.min.x || x > inst.aabb.max.x || z < inst.aabb.min.z || z > inst.aabb.max.z) continue;
      if (ceil < inst.aabb.min.y) continue;
      const bvh = bvhByKey.get(inst.key);
      if (!bvh) continue;
      try {
        _ray.origin.set(x, ceil, z);
        _ray.direction.set(0, -1, 0);
        _ray.applyMatrix4(inst.inverse);
        const hit = bvh.raycastFirst(_ray, THREE.DoubleSide);
        if (hit) {
          _hitPt.copy(hit.point).applyMatrix4(inst.matrix);
          if (best === null || _hitPt.y > best) best = _hitPt.y;
        }
      } catch { /* a bad BVH must never crash movement */ }
    }
  }
  return best;
}

/** Nearest mesh-collider hit along a world-space ray segment, returned as the
 *  world distance from the origin (or null if nothing solid within maxDist).
 *  Lets bullets stop at the REAL surface of a building/rock instead of flying
 *  through it. (dx,dy,dz) must be a unit direction. Returns null instantly when
 *  the mesh system is off/empty, so it's free on non-siege worlds. */
export function raycastMesh(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  maxDist: number,
): number | null {
  if (!enabled || groups.size === 0) return null;
  let best: number | null = null;
  for (const list of groups.values()) {
    for (let i = 0; i < list.length; i++) {
      const inst = list[i];
      _ray.origin.set(ox, oy, oz);
      _ray.direction.set(dx, dy, dz);
      if (!_ray.intersectsBox(inst.aabb)) continue;          // world-space broad-phase
      const bvh = bvhByKey.get(inst.key);
      if (!bvh) continue;
      try {
        _ray.applyMatrix4(inst.inverse);                     // into instance-local space
        const hit = bvh.raycastFirst(_ray, THREE.DoubleSide);
        if (hit) {
          _hitPt.copy(hit.point).applyMatrix4(inst.matrix);  // hit point back to world
          const ddx = _hitPt.x - ox, ddy = _hitPt.y - oy, ddz = _hitPt.z - oz;
          const dist = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);
          if (dist <= maxDist && (best === null || dist < best)) best = dist;
        }
      } catch { /* a bad BVH must never crash the bullet loop */ }
    }
  }
  return best;
}

/** Resolve the player capsule against nearby mesh colliders (HORIZONTAL push;
 *  vertical is the ground system's job). Writes the correction into `out`. */
export function resolvePlayerMeshCollision(
  feetX: number, feetY: number, feetZ: number,
  radius: number, height: number,
  out: THREE.Vector3,
): boolean {
  out.set(0, 0, 0);
  if (!enabled || groups.size === 0) return false;
  _playerAabb.min.set(feetX - radius, feetY, feetZ - radius);
  _playerAabb.max.set(feetX + radius, feetY + height, feetZ + radius);
  let pushed = false;
  for (const list of groups.values()) {
    for (let i = 0; i < list.length; i++) {
      const inst = list[i];
      if (!inst.aabb.intersectsBox(_playerAabb)) continue;
      try {
        if (resolveOne(inst, feetX, feetY, feetZ, radius, height)) {
          out.add(_delta);
          pushed = true;
        }
      } catch { /* a bad BVH must never crash movement */ }
    }
  }
  return pushed;
}

function resolveOne(
  inst: InstanceEntry,
  feetX: number, feetY: number, feetZ: number,
  radius: number, height: number,
): boolean {
  const bvh = bvhByKey.get(inst.key);
  if (!bvh) return false;
  _segA.set(feetX, feetY + radius, feetZ).applyMatrix4(inst.inverse);
  _seg.start.copy(_segA);
  _seg.end.set(feetX, feetY + Math.max(radius, height - radius), feetZ).applyMatrix4(inst.inverse);
  const localRadius = radius / inst.scale;

  _lbox.makeEmpty();
  _lbox.expandByPoint(_seg.start);
  _lbox.expandByPoint(_seg.end);
  _lbox.min.addScalar(-localRadius);
  _lbox.max.addScalar(localRadius);

  let hit = false;
  bvh.shapecast({
    intersectsBounds: (box) => box.intersectsBox(_lbox),
    intersectsTriangle: (tri: ExtendedTriangle) => {
      const dist = tri.closestPointToSegment(_seg, _triPt, _capPt);
      if (dist < localRadius) {
        const depth = localRadius - dist;
        _dir.copy(_capPt).sub(_triPt);
        if (_dir.lengthSq() > 1e-12) {
          _dir.normalize();
          _seg.start.addScaledVector(_dir, depth);
          _seg.end.addScaledVector(_dir, depth);
          hit = true;
        }
      }
      return false;
    },
  });

  if (!hit) return false;
  _delta.copy(_seg.start).sub(_segA);
  _m3.setFromMatrix4(inst.matrix);
  _delta.applyMatrix3(_m3);
  return true;
}
