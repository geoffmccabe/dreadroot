// Fortress placement — turn the previewed voxels into real, owned world blocks, and the
// reverse ("chop the seed" → take the fortress down). The Fortress Seed is NOT consumed:
// placing binds it to the fortress (dormant); taking the fortress down frees it again.
//
// All DB access is best-effort and guarded so a missing table (SQL not yet run) degrades
// to a clear error instead of a crash. Block WRITES go through the BlocksContext batch API
// (passed in) so they persist + render through the normal pipeline.
import { supabase } from '@/integrations/supabase/client';
import { isPointInFSZ } from '@/features/enemies/ai/fortressSafeZone';
import { tierBlockType, FORTRESS_TIER_BLOCK_TYPES } from './fortressSeed';
import type { FortressVoxel } from './imageToFortress';

export interface WorldBlock { x: number; y: number; z: number; blockType: string; }
export interface FortressBounds { minX: number; maxX: number; minZ: number; maxZ: number; }

/** Local voxels → absolute world blocks (center is already snapped to the integer grid). */
export function worldBlocksFor(centerX: number, centerZ: number, voxels: FortressVoxel[]): WorldBlock[] {
  return voxels.map((v) => ({ x: centerX + v.x, y: v.y, z: centerZ + v.z, blockType: tierBlockType(v.tier) }));
}

/** Footprint AABB (X/Z) of the placed blocks — encloses the walls AND the courtyard. */
export function boundsFor(blocks: WorldBlock[]): FortressBounds {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const b of blocks) {
    if (b.x < minX) minX = b.x; if (b.x > maxX) maxX = b.x;
    if (b.z < minZ) minZ = b.z; if (b.z > maxZ) maxZ = b.z;
  }
  return { minX, maxX, minZ, maxZ };
}

const aabbOverlap = (a: FortressBounds, b: FortressBounds): boolean =>
  a.minX <= b.maxX && a.maxX >= b.minX && a.minZ <= b.maxZ && a.maxZ >= b.minZ;

export interface ValidateResult { ok: boolean; reason?: string; }

/** Validate a footprint before writing: clear of existing blocks, outside no-build/safe
 *  zones, and not overlapping another fortress (incl. its courtyard). Water + roads: TODO. */
export async function validatePlacement(worldId: string, bounds: FortressBounds): Promise<ValidateResult> {
  // 1) No-build / fortress safe zone (the central fortress + any active builder barrier).
  const corners: Array<[number, number]> = [
    [bounds.minX, bounds.minZ], [bounds.maxX, bounds.minZ],
    [bounds.minX, bounds.maxZ], [bounds.maxX, bounds.maxZ],
    [(bounds.minX + bounds.maxX) >> 1, (bounds.minZ + bounds.maxZ) >> 1],
  ];
  if (corners.some(([x, z]) => isPointInFSZ(x, 0, z))) {
    return { ok: false, reason: 'That spot is inside a no-build / fortress safe zone.' };
  }
  // 2) Existing blocks anywhere in the footprint (terrain isn't in placed_blocks, so empty
  //    ground reads as clear).
  try {
    const { data, error } = await (supabase as any)
      .from('placed_blocks').select('id')
      .eq('world_id', worldId)
      .gte('position_x', bounds.minX).lte('position_x', bounds.maxX)
      .gte('position_z', bounds.minZ).lte('position_z', bounds.maxZ)
      .limit(1);
    if (!error && data && data.length > 0) {
      return { ok: false, reason: 'There are already blocks in that space.' };
    }
  } catch { /* query failed — fall through (don't hard-block on a transient error) */ }
  // NOTE: build PERMISSIONS (owner + tribe only) are scaffolded in fortressTribe.ts but not
  // enforced yet — the owner placing their own fortress here is always allowed. The tribe
  // gate (blocking OTHER players from building in this zone) wires into the shared block-
  // placement path when the Tribe UI ships. [TODO: tribe]
  //
  // 3) Overlap with another fortress (including its courtyard).
  try {
    const { data } = await (supabase as any)
      .from('placed_fortresses').select('min_x,max_x,min_z,max_z').eq('world_id', worldId);
    for (const f of (data ?? [])) {
      if (aabbOverlap(bounds, { minX: f.min_x, maxX: f.max_x, minZ: f.min_z, maxZ: f.max_z })) {
        return { ok: false, reason: "That overlaps another fortress's footprint." };
      }
    }
  } catch { /* registry table not present yet — skip this check */ }
  return { ok: true };
}

export interface PlaceDeps {
  placeBlocksBatch: (positions: Array<{ x: number; y: number; z: number; blockType: string }>) => unknown;
}

/** Place the fortress: validate → write blocks → register the footprint (binds the seed). */
export async function placeFortress(
  worldId: string, centerX: number, centerZ: number, voxels: FortressVoxel[], deps: PlaceDeps,
): Promise<{ ok: boolean; reason?: string; count?: number }> {
  if (!voxels.length) return { ok: false, reason: 'Nothing to place — open the builder and position it first.' };
  const blocks = worldBlocksFor(centerX, centerZ, voxels);
  const bounds = boundsFor(blocks);
  const v = await validatePlacement(worldId, bounds);
  if (!v.ok) return v;

  const { data: auth } = await supabase.auth.getUser();
  const ownerId = auth.user?.id;
  if (!ownerId) return { ok: false, reason: 'Not signed in.' };

  deps.placeBlocksBatch(blocks.map((b) => ({ x: b.x, y: b.y, z: b.z, blockType: b.blockType })));

  try {
    await (supabase as any).from('placed_fortresses').insert({
      owner_id: ownerId, world_id: worldId,
      center_x: centerX, center_z: centerZ,
      min_x: bounds.minX, max_x: bounds.maxX, min_z: bounds.minZ, max_z: bounds.maxZ,
    });
  } catch { /* registry insert failed (table missing) — blocks still placed */ }
  return { ok: true, count: blocks.length };
}

export interface RemoveDeps {
  removeBlocksByPositions: (positions: Array<{ x: number; y: number; z: number }>) => number;
}

/** Take the fortress down (chop the seed): remove all its blocks and free the registry row. */
export async function removeFortress(
  worldId: string, deps: RemoveDeps,
): Promise<{ ok: boolean; reason?: string; count?: number }> {
  const { data: auth } = await supabase.auth.getUser();
  const ownerId = auth.user?.id;
  if (!ownerId) return { ok: false, reason: 'Not signed in.' };

  // Find this owner's fortress blocks in this world (the 5 tier types) and remove them
  // from memory (instant) + the DB (persisted).
  const { data: rows, error } = await (supabase as any)
    .from('placed_blocks').select('position_x,position_y,position_z')
    .eq('world_id', worldId).eq('user_id', ownerId)
    .in('block_type', FORTRESS_TIER_BLOCK_TYPES as unknown as string[]);
  if (error) return { ok: false, reason: 'Could not read your fortress blocks.' };
  const positions = (rows ?? []).map((r: any) => ({ x: r.position_x, y: r.position_y, z: r.position_z }));
  if (!positions.length) return { ok: false, reason: 'No fortress of yours found here.' };

  deps.removeBlocksByPositions(positions);
  try {
    await (supabase as any).from('placed_blocks').delete()
      .eq('world_id', worldId).eq('user_id', ownerId)
      .in('block_type', FORTRESS_TIER_BLOCK_TYPES as unknown as string[]);
    await (supabase as any).from('placed_fortresses').delete().eq('world_id', worldId).eq('owner_id', ownerId);
  } catch { /* best-effort DB cleanup */ }
  return { ok: true, count: positions.length };
}
