// specialsStorage — superadmin-managed "special" set pieces for challenges (table `siege_specials`).
// A special is a hard-coded, world/map-specific idea (easter egg, scripted moment) that ONLY appears
// in the wave a superadmin drops it into. This module is just the metadata registry: each row tracks
// a name + auto-assigned code# + LIVE flag (+ optional world it belongs to). The actual behaviour is
// hard-coded in the runner, keyed by `code`. RLS restricts ALL access to superadmins.
//
// SQL (paste once in the Supabase dashboard) lives in the panel commit message. The table isn't in the
// generated types, so the query builder is cast (kept isolated to this file), mirroring challengeStorage.
import { supabase } from '@/integrations/supabase/client';

export interface SpecialRow {
  id: string;
  code: number;            // the code# referenced by a wave's special drop (auto-assigned, per game)
  name: string;
  game: string;
  world: string | null;    // mapId it belongs to (null = any world)
  description: string | null;
  live: boolean;           // only LIVE specials appear in the +Special dropdown
  updated_at: string;
}

const COLS = 'id,code,name,game,world,description,live,updated_at';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tbl = () => (supabase as any).from('siege_specials');

/** All specials for one game (the SPECIAL management modal), newest code# first. */
export async function listSpecials(game: string): Promise<SpecialRow[]> {
  const { data } = await tbl().select(COLS).eq('game', game).order('code', { ascending: true });
  return (data ?? []) as SpecialRow[];
}

/** LIVE specials for one game (the +Special dropdown). The caller filters further by world. */
export async function listLiveSpecials(game: string): Promise<SpecialRow[]> {
  const { data } = await tbl().select(COLS).eq('game', game).eq('live', true).order('code', { ascending: true });
  return (data ?? []) as SpecialRow[];
}

/** Create a blank special with the next free code# for this game. Returns the new row or an error. */
export async function createSpecial(game: string, userId: string): Promise<{ row?: SpecialRow; error?: string }> {
  const { data: maxRows } = await tbl().select('code').eq('game', game).order('code', { ascending: false }).limit(1);
  const nextCode = ((maxRows?.[0]?.code as number | undefined) ?? 0) + 1;
  const { data, error } = await tbl()
    .insert({ game, code: nextCode, name: `New Special ${nextCode}`, world: null, description: null, live: false, created_by: userId })
    .select(COLS).maybeSingle();
  if (error) return { error: error.message };
  return { row: data as SpecialRow };
}

/** Update a special's editable fields. Returns an error string or null. */
export async function updateSpecial(id: string, patch: Partial<Pick<SpecialRow, 'name' | 'world' | 'description' | 'live'>>): Promise<string | null> {
  const { error } = await tbl().update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
  return error ? error.message : null;
}

/** Delete a special. Returns an error string or null. */
export async function deleteSpecial(id: string): Promise<string | null> {
  const { error } = await tbl().delete().eq('id', id);
  return error ? error.message : null;
}
