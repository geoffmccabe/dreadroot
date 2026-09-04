// Supabase read/write for the shared `world_objects` table. Game-agnostic: every
// call is scoped by (game, worldId). Writes are fire-and-forget (optimistic local
// update already happened) and log on failure. The table isn't in the generated
// Database types yet, so the client is cast in THIS ONE place — isolated tech debt
// until types.ts is regenerated.
import { supabase } from '@/integrations/supabase/client';
import { BOOT_MAP } from '@/config/game';
import type { WorldObject, TRS } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => (supabase as any).from('world_objects');

interface Row {
  id: string;
  model_url: string;
  pos_x: number; pos_y: number; pos_z: number;
  rot_x: number; rot_y: number; rot_z: number; rot_w: number;
  scale_x: number; scale_y: number; scale_z: number;
  owner_id: string | null;
  meta?: { flood?: WorldObject['flood'] } | null;   // optional jsonb column (added later); absent ⇒ undefined
}

function rowToObject(r: Row): WorldObject {
  return {
    id: r.id,
    modelUrl: r.model_url,
    pos: [r.pos_x, r.pos_y, r.pos_z],
    quat: [r.rot_x, r.rot_y, r.rot_z, r.rot_w],
    scale: [r.scale_x, r.scale_y, r.scale_z],
    ownerId: r.owner_id,
    flood: r.meta?.flood,
  };
}

// --- auth + capability (cached once per session) ---
let cachedUid: string | null | undefined;
let cachedCanEdit: boolean | undefined;

export async function getUid(): Promise<string | null> {
  if (cachedUid !== undefined) return cachedUid;
  const { data } = await supabase.auth.getUser();
  cachedUid = data.user?.id ?? null;
  return cachedUid;
}

// Edit mode is locked to admins/superadmins. RLS enforces writes too; this just
// keeps the toggle from doing anything for normal players.
export async function loadCanEdit(): Promise<boolean> {
  // ⚠ TESTING ONLY. On a boot-map build (Starblink) everyone may edit. Without this the whole
  // Arrange editor is silently inert: toggleEditMode() refuses, so its click, wheel and Escape
  // handlers all bail on their first line and clicking an object, Option+wheel scaling and Escape
  // release do nothing at all. The client-side role override elsewhere does not reach here,
  // because this asks the database about the real account, and the auto-login guest is a 'user'.
  // Stripped from dreadroot.com, where BOOT_MAP is null.
  if (BOOT_MAP) { cachedCanEdit = true; return true; }
  if (cachedCanEdit !== undefined) return cachedCanEdit;
  const uid = await getUid();
  if (!uid) { cachedCanEdit = false; return false; }
  const { data } = await supabase.from('user_roles').select('role').eq('user_id', uid);
  const roles = (data ?? []).map((r: { role: string }) => r.role);
  cachedCanEdit = roles.includes('admin') || roles.includes('superadmin');
  return cachedCanEdit;
}

// --- CRUD ---
export async function loadObjects(game: string, worldId: string): Promise<WorldObject[]> {
  const { data, error } = await db().select('*').eq('game', game).eq('world_id', worldId);
  if (error) { console.error('[objectEditor] load failed', error); return []; }
  return (data as Row[]).map(rowToObject);
}

export async function insertObject(game: string, worldId: string, o: WorldObject): Promise<void> {
  const owner_id = o.ownerId ?? (await getUid());
  const { error } = await db().insert({
    id: o.id, game, world_id: worldId, model_url: o.modelUrl,
    pos_x: o.pos[0], pos_y: o.pos[1], pos_z: o.pos[2],
    rot_x: o.quat[0], rot_y: o.quat[1], rot_z: o.quat[2], rot_w: o.quat[3],
    scale_x: o.scale[0], scale_y: o.scale[1], scale_z: o.scale[2],
    owner_id, updated_at: new Date().toISOString(),
  });
  if (error) console.error('[objectEditor] insert failed', error);
}

export async function persistTransform(id: string, t: TRS): Promise<void> {
  const { error } = await db().update({
    pos_x: t.pos[0], pos_y: t.pos[1], pos_z: t.pos[2],
    rot_x: t.quat[0], rot_y: t.quat[1], rot_z: t.quat[2], rot_w: t.quat[3],
    scale_x: t.scale[0], scale_y: t.scale[1], scale_z: t.scale[2],
    updated_at: new Date().toISOString(),
  }).eq('id', id);
  if (error) console.error('[objectEditor] update failed', error);
}

// Persist the object's `meta` jsonb (currently the flood footprint; later also per-water tint/glow).
// Kept OUT of insertObject so that, if the `meta` column hasn't been added yet, only this write
// fails (logged) — the base object + its transform still save. Add the column with:
//   alter table world_objects add column if not exists meta jsonb;
export async function persistMeta(id: string, meta: Record<string, unknown>): Promise<void> {
  const { error } = await db().update({ meta, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) console.error('[objectEditor] meta update failed (add a `meta jsonb` column?)', error);
}

export async function deleteObject(id: string): Promise<void> {
  const { error } = await db().delete().eq('id', id);
  if (error) console.error('[objectEditor] delete failed', error);
}
