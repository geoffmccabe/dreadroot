// Append-only history of baked-map edits, in shared Supabase. Each published Save inserts one row
// per changed object (never updates/deletes — that's the append-only part), so the table IS the
// edit history. The current shared map = replay the log, latest row per place_key wins. A later
// Phase-2 timeline UI can read the same rows to scrub/rollback. Table isn't in the generated types,
// so the client is cast in THIS one place (same pattern as persistence.ts).
import { supabase } from '@/integrations/supabase/client';
import { getUid } from './persistence';
import type { XformOverride } from './bakedOverrides';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => (supabase as any).from('world_object_edits');

export interface EditRow { place_key: string; matrix: number[] | null; hide: boolean; created_at: string }

// Full history for a world, oldest → newest (the fold below relies on this order).
export async function fetchEdits(game: string, worldId: string): Promise<EditRow[]> {
  const { data, error } = await db()
    .select('place_key,matrix,hide,created_at')
    .eq('game', game).eq('world_id', worldId)
    .order('created_at', { ascending: true });
  if (error) { console.error('[overridesDb] fetch failed', error); return []; }
  return (data ?? []) as EditRow[];
}

// Fold the append-only log into the current override per key (last write wins).
export function foldEdits(rows: EditRow[]): Map<string, XformOverride> {
  const m = new Map<string, XformOverride>();
  for (const r of rows) m.set(r.place_key, r.hide ? { hide: true } : { matrix: r.matrix ?? undefined });
  return m;
}

// Append one row per changed object (the publish step). Returns false on failure so the UI can flag it.
export async function appendEdits(game: string, worldId: string, edits: { key: string; ov: XformOverride }[]): Promise<boolean> {
  if (!edits.length) return true;
  const editor_id = await getUid();
  const rows = edits.map(({ key, ov }) => ({
    game, world_id: worldId, place_key: key,
    matrix: ov.hide ? null : (ov.matrix ?? null), hide: !!ov.hide, editor_id,
  }));
  const { error } = await db().insert(rows);
  if (error) { console.error('[overridesDb] append failed', error); return false; }
  return true;
}
