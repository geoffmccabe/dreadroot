// Shared, game-agnostic data model for a placed 3D object (NOT a 1m voxel).
// One WorldObject = a model reference + a full transform (position, quaternion
// rotation, non-uniform scale). Quaternion (not euler) is gimbal-proof and the
// form VR controllers hand back, so the same model serves the future Rift driver.
// Persisted in the shared Supabase `world_objects` table; used by both DreadRoot
// and Siege Worlds.

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number]; // x, y, z, w

export interface WorldObject {
  id: string;          // uuid, shared by the local copy and the DB row
  modelUrl: string;    // glb/gltf url, or a 'builtin:<shape>' sentinel
  pos: Vec3;
  quat: Quat;          // identity = [0,0,0,1]
  scale: Vec3;         // uniform = equal components
  ownerId?: string | null;
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
