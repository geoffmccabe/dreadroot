// Manual voxelization overrides (the V tool). When the player voxelizes a rock/object, that
// instance becomes "managed" here: VoxelizeTool owns its colliders (voxel shell or a single
// box) and WorldObjectsLayer SKIPS building a collider for it — so the edit is permanent and
// survives streaming reloads (no double colliders). Keyed by type+rounded-world-position so it
// matches across reloads (the InstancedMesh is recreated, but the placement is the same).
import type * as THREE from 'three';
import { supabase } from '@/integrations/supabase/client';

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
// voxel = greedy-box approximation (per-instance, keyed fbx@x,z).
// mesh  = true triangle collider (three-mesh-bvh), per-MODEL (keyed by fbx only),
//         so it applies to every copy of that rock/mountain. Requires the world's
//         meshColliders flag.
export interface SavedOverride { voxel: boolean; cell: number; mesh?: boolean }
export const colliderOverrides = new Map<string, SavedOverride>();
const LS_KEY = 'sw_collider_overrides_v1';

try {
  const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(LS_KEY) : null;
  if (raw) for (const [k, v] of JSON.parse(raw) as [string, SavedOverride][]) colliderOverrides.set(k, v);
} catch { /* ignore corrupt/blocked storage */ }

export function setColliderOverride(key: string, voxel: boolean, cell: number, mesh = false): void {
  colliderOverrides.set(key, { voxel, cell, mesh });
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

// ── Supabase sync (no clipboard/paste needed) ────────────────────────────────
// Voxelizing auto-saves to `siege_collider_overrides`; every player loads them on
// world start. Writes are admin-only via RLS (has_role(...,'admin')) so a normal
// player pressing V edits only their own localStorage, never the shared world.
// Table not in generated types yet → loose-typed access, degrades gracefully.
const SCO_GAME = 'siege-worlds';

export async function saveColliderOverrideToDB(key: string, voxel: boolean, cell: number, mesh = false): Promise<void> {
  try {
    await (supabase as any)
      .from('siege_collider_overrides')
      .upsert({ game_id: SCO_GAME, key, voxel, cell, mesh, updated_at: new Date().toISOString() },
              { onConflict: 'game_id,key' });
  } catch { /* admin-only / table absent — localStorage already has it */ }
}

/** Load shared overrides from the DB into the map (authoritative over baked JSON).
 *  Call before WorldObjectsLayer builds colliders. Safe if the table is absent. */
export async function loadColliderOverridesFromDB(): Promise<void> {
  try {
    const { data, error } = await (supabase as any)
      .from('siege_collider_overrides')
      .select('key,voxel,cell,mesh')
      .eq('game_id', SCO_GAME);
    if (error || !data) return;
    for (const row of data) colliderOverrides.set(row.key, { voxel: !!row.voxel, cell: Number(row.cell), mesh: !!row.mesh });
  } catch { /* ignore */ }
}
