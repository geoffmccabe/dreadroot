// challengeStorage — save/load Challenges to Supabase (table `challenges`, see SQL in the panel
// commit message / docs). Ownership + admin rules are enforced by Row-Level Security on the table;
// this module is just thin typed access. The `challenges` table isn't in the generated types yet,
// so we cast the query builder (kept isolated to this file).
import { supabase } from '@/integrations/supabase/client';
import type { Challenge } from './challengeTypes';

export interface ChallengeRow {
  id: string;
  user_id: string;
  name: string;
  creator_name: string | null;
  region: string | null;
  data: Challenge;
  updated_at: string;
}

const COLS = 'id,user_id,name,creator_name,region,data,updated_at';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tbl = () => (supabase as any).from('challenges');

/** Insert (new) or update (existing ch.id) — returns the saved row id or an error string. */
export async function saveChallenge(ch: Challenge, userId: string, creatorName: string): Promise<{ id?: string; error?: string }> {
  const base = { name: ch.name || 'Untitled', creator_name: creatorName, region: ch.region ?? null, data: ch };
  if (ch.id) {
    const { data, error } = await tbl().update({ ...base, updated_at: new Date().toISOString() }).eq('id', ch.id).select('id').maybeSingle();
    if (error) return { error: error.message };
    if (!data) return { error: "Couldn't save — not your challenge?" };
    return { id: data.id as string };
  }
  const { data, error } = await tbl().insert({ ...base, user_id: userId }).select('id').maybeSingle();
  if (error) return { error: error.message };
  return { id: data?.id as string };
}

/** Challenges owned by this user (for the creator's own "Open" list). */
export async function listMyChallenges(userId: string): Promise<ChallengeRow[]> {
  const { data } = await tbl().select(COLS).eq('user_id', userId).order('updated_at', { ascending: false });
  return (data ?? []) as ChallengeRow[];
}

/** All challenges (admins/superadmins — they can open + edit anyone's). */
export async function listAllChallenges(): Promise<ChallengeRow[]> {
  const { data } = await tbl().select(COLS).order('updated_at', { ascending: false }).limit(500);
  return (data ?? []) as ChallengeRow[];
}

/** Delete a challenge (RLS allows own + admin). Returns an error string or null. */
export async function deleteChallenge(id: string): Promise<string | null> {
  const { error } = await tbl().delete().eq('id', id);
  return error ? error.message : null;
}

/** The current user's roles (lightweight — avoids the heavy useUserData hook). */
export async function fetchRoles(userId: string): Promise<string[]> {
  const { data } = await supabase.from('user_roles').select('role').eq('user_id', userId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((r: any) => r.role as string);
}
