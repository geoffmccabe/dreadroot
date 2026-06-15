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

// ── Persistence ──────────────────────────────────────────────────────────────
// SAVED overrides (what each voxelized instance should be): key → { voxel, cell }. These survive
// reload via localStorage (the author's working copy) and can be baked into a shipped JSON
// (/siege/world/collider_overrides.json) so every player gets them. WorldObjectsLayer reads this
// when building an instance's collider: voxelize at `cell` if voxel, else the default box.
export interface SavedOverride { voxel: boolean; cell: number }
export const colliderOverrides = new Map<string, SavedOverride>();
const LS_KEY = 'sw_collider_overrides_v1';

try {
  const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(LS_KEY) : null;
  if (raw) for (const [k, v] of JSON.parse(raw) as [string, SavedOverride][]) colliderOverrides.set(k, v);
} catch { /* ignore corrupt/blocked storage */ }

export function setColliderOverride(key: string, voxel: boolean, cell: number): void {
  colliderOverrides.set(key, { voxel, cell });
  try { localStorage.setItem(LS_KEY, JSON.stringify([...colliderOverrides])); } catch { /* ignore */ }
}

/** Merge baked map overrides WITHOUT clobbering the author's local edits (localStorage wins). */
export function mergeBakedOverrides(entries: [string, SavedOverride][]): void {
  for (const [k, v] of entries) if (!colliderOverrides.has(k)) colliderOverrides.set(k, v);
}

/** JSON of all overrides — paste this to bake them into the shipped map for all players. */
export function exportColliderOverrides(): string {
  return JSON.stringify([...colliderOverrides]);
}
