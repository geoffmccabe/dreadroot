// meshColliderSystem — true triangle-accurate collision for selected models
// (rocks, mountains), so the player walks the real surface instead of stair-
// stepped boxes. World-agnostic and GATED: when the active world doesn't enable
// mesh colliders, the whole system is inert (no BVH builds, no per-frame pass),
// so DreadRoot/Pinkland pay nothing and only worlds that opt in (SWW) run it.
//
// One BVH per GEOMETRY (keyed by geometry.uuid, shared across instances). Mesh
// instances are tracked PER GROUP (the streaming WorldObjectsLayer group), so a
// group cleanly removes its instances when it streams out — no duplicates. Player
// collision transforms the capsule into each nearby instance's local space and
// resolves against the BVH (canonical three-mesh-bvh capsule sweep), then pushes
// the player out in world space. Only instances whose world AABB is near the
// player are tested; mesh colliders are a hand-picked subset, so the count is low.

import * as THREE from 'three';
import { MeshBVH, type ExtendedTriangle } from 'three-mesh-bvh';

export interface MeshInstanceInput {
  key: string;            // geometry uuid (BVH key)
  matrix: THREE.Matrix4;  // final model→world matrix (same as the rendered instance)
  geoBox: THREE.Box3;     // geometry-local bounding box
}

interface InstanceEntry {
  bvh: MeshBVH;
  matrix: THREE.Matrix4;
  inverse: THREE.Matrix4;
  scale: number;
  aabb: THREE.Box3;
}

const bvhByKey = new Map<string, MeshBVH>();
const groups = new Map<string, InstanceEntry[]>();
let enabled = false;
// Ceiling for the ground raycast: the player's reachable step height. Updated each
// frame by MeshColliderPlayer so the ground probe only finds surfaces the player
// can actually step onto — never snaps them up the side of a tall wall/cliff.
let probeCeilingY = 4000;
export function setPlayerProbeY(y: number): void { probeCeilingY = y; }

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

/** Build (once) and return the BVH for a geometry. */
export function registerMeshGeometry(key: string, geometry: THREE.BufferGeometry): MeshBVH | null {
  let bvh = bvhByKey.get(key);
  if (bvh) return bvh;
  try {
    bvh = new MeshBVH(geometry.index ? geometry : geometry.toNonIndexed());
    bvhByKey.set(key, bvh);
    return bvh;
  } catch { return null; }
}

/** Replace a group's mesh-collider instances (call on the group's build). */
export function setGroupInstances(groupId: string, list: MeshInstanceInput[]): void {
  const entries: InstanceEntry[] = [];
  for (const it of list) {
    const bvh = bvhByKey.get(it.key);
    if (!bvh) continue;
    it.matrix.decompose(_pos, _quat, _scl);
    const scale = (Math.abs(_scl.x) + Math.abs(_scl.y) + Math.abs(_scl.z)) / 3 || 1;
    entries.push({
      bvh,
      matrix: it.matrix.clone(),
      inverse: it.matrix.clone().invert(),
      scale,
      aabb: it.geoBox.clone().applyMatrix4(it.matrix),
    });
  }
  if (entries.length) groups.set(groupId, entries);
  else groups.delete(groupId);
}

/** Remove a group's instances (call on the group's unmount). */
export function clearGroup(groupId: string): void { groups.delete(groupId); }

export function clearMeshColliders(): void { bvhByKey.clear(); groups.clear(); }

export function meshColliderStats(): { geometries: number; instances: number } {
  let n = 0;
  for (const g of groups.values()) n += g.length;
  return { geometries: bvhByKey.size, instances: n };
}

/**
 * Resolve the player capsule against nearby mesh colliders. Writes the world-space
 * position correction into `out`; returns true if it pushed. Capsule is vertical:
 * (feet + radius) up to (feet + height - radius).
 */
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
      if (!inst.aabb.intersectsBox(_playerAabb)) continue; // cheap proximity reject
      if (resolveOne(inst, feetX, feetY, feetZ, radius, height)) {
        out.add(_delta);
        pushed = true;
      }
    }
  }
  return pushed;
}

/**
 * Highest mesh-collider surface at (x,z), or null. A ray cast straight down from
 * high above; used to feed the engine's existing ground-height system so the
 * player stands ON mountains with correct gravity/jump (same path as terrain).
 */
export function meshGroundHeight(x: number, z: number): number | null {
  if (!enabled || groups.size === 0) return null;
  let best: number | null = null;
  for (const list of groups.values()) {
    for (let i = 0; i < list.length; i++) {
      const inst = list[i];
      if (x < inst.aabb.min.x || x > inst.aabb.max.x || z < inst.aabb.min.z || z > inst.aabb.max.z) continue;
      if (probeCeilingY < inst.aabb.min.y) continue; // player below this collider — can't stand on it
      _ray.origin.set(x, probeCeilingY, z);
      _ray.direction.set(0, -1, 0);
      _ray.applyMatrix4(inst.inverse);          // world ray → model space
      const hit = inst.bvh.raycastFirst(_ray, THREE.DoubleSide);
      if (hit) {
        _hitPt.copy(hit.point).applyMatrix4(inst.matrix); // model → world
        if (best === null || _hitPt.y > best) best = _hitPt.y;
      }
    }
  }
  return best;
}

function resolveOne(
  inst: InstanceEntry,
  feetX: number, feetY: number, feetZ: number,
  radius: number, height: number,
): boolean {
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
  inst.bvh.shapecast({
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
  _delta.copy(_seg.start).sub(_segA);   // local push delta
  _m3.setFromMatrix4(inst.matrix);
  _delta.applyMatrix3(_m3);             // → world (rotation + scale)
  return true;
}
