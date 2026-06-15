// Manual voxelization overrides (the V tool). When the player voxelizes a rock/object, that
// instance becomes "managed" here: VoxelizeTool owns its colliders (voxel shell or a single
// box) and WorldObjectsLayer SKIPS building a collider for it — so the edit is permanent and
// survives streaming reloads (no double colliders). Keyed by type+rounded-world-position so it
// matches across reloads (the InstancedMesh is recreated, but the placement is the same).
import type * as THREE from 'three';

export interface ManagedEntry { boxes: THREE.Box3[]; voxel: boolean }

export const managedRocks = new Map<string, ManagedEntry>();

export function keyFor(fbx: string, x: number, z: number): string {
  return `${fbx}@${Math.round(x)},${Math.round(z)}`;
}
