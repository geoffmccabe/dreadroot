// Shared, game-agnostic data model for a placed 3D object (NOT a 1m voxel).
// One WorldObject = a model reference + a full transform (position, quaternion
// rotation, non-uniform scale). Quaternion (not euler) is gimbal-proof and the
// form VR controllers hand back, so the same model serves the future Rift driver.
// Persisted in the shared Supabase `world_objects` table; used by both DreadRoot
// and Siege Worlds.

import type { InstancedMesh } from 'three';

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number]; // x, y, z, w

// Reference to a single baked instance (e.g. an Enchanted Forest cliff) so the editor can
// move it in place: `key` is its stable position-based override key, `localArr` is the
// model-local transform so the live matrix = placement * local. mesh/instanceId are LIVE and
// may go stale after a streaming rebuild (the override still persists by key).
export interface BakedRef {
  key: string;
  fbx: string;
  localArr: number[];        // 16
  mesh: InstancedMesh;
  instanceId: number;
}

export interface WorldObject {
  id: string;          // uuid, shared by the local copy and the DB row
  modelUrl: string;    // glb/gltf url, or a 'builtin:<shape>' / 'baked:<fbx>' sentinel
  pos: Vec3;
  quat: Quat;          // identity = [0,0,0,1]
  scale: Vec3;         // uniform = equal components
  ownerId?: string | null;
  baked?: BakedRef;    // present ⇒ this is a baked map instance, not a DB-backed object
  external?: boolean;  // present ⇒ a transient live editable (e.g. a hand-attached weapon): flows
                       // through the panel + transform controls, but is NOT rendered here and NOT
                       // persisted — a bridge applies its transform to the real object.
}

// The transform triple, the unit every edit command moves between.
export interface TRS {
  pos: Vec3;
  quat: Quat;
  scale: Vec3;
}

export const IDENTITY_QUAT: Quat = [0, 0, 0, 1];

export function trsOf(o: WorldObject): TRS {
  return { pos: [...o.pos], quat: [...o.quat], scale: [...o.scale] };
}
